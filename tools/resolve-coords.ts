/**
 * One-off pin proposal tool. PROPOSES ONLY — writes a review file, never the
 * registry. A human reads the proposals, accepts what is defensible, and pastes
 * the accepted block into src/data/itemCoords.ts.
 *
 * Coverage target is the PLANNABLE POOL, not the whole catalog: items the engine
 * can auto-place (isAutoFillExcluded === false AND review_count >= 25). Anything
 * else needs no pin, because the app never suggests it unasked.
 *
 * Title/description matching is the PRIMARY mechanism, not a fallback. The
 * 2026-08-03 probe established Viator carries no destination data at all —
 * 0 of 20 Aruba products had itinerary POI records. See
 * docs/map/viator-location-probe.md.
 *
 * Run: npm run resolve:coords
 */
import { loadCatalog, getCatalog } from '../src/data/activitySource';
import { isAutoFillExcluded } from '../src/data/itemFit';
import { ITEM_PINS } from '../src/data/itemCoords';
import { PLACES, type Place } from './places';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

/**
 * Meeting-point text pulled from the Viator API (`logistics.start[].description`),
 * keyed by product code. Written by the op=meeting probe.
 *
 * This is the only licensed source for where a sail or cruise departs from: the
 * `location.ref` beside it resolves to a Google Place ID carrying no name and no
 * coordinates, and the product web pages sit behind DataDome and return 403.
 */
const MEETING: Record<string, { start?: Array<{ description?: string | null }> }> =
  existsSync('/tmp/meeting-text.json')
    ? JSON.parse(readFileSync('/tmp/meeting-text.json', 'utf8'))
    : {};

function meetingText(id: string): string {
  return (MEETING[id]?.start ?? []).map((s) => s.description ?? '').join(' ').trim();
}

const MIN_REVIEWS = 25;  // mirrors MIN_CHAMPION_REVIEWS, itineraryGenerator.ts:130

/** Lowercase, strip diacritics, normalise quotes and whitespace. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Match =
  | { kind: 'hit'; place: Place; alias: string }
  | { kind: 'ambiguous'; places: Place[] }
  | null;

/**
 * Any two DISTINCT places matching makes the text ambiguous, and ambiguity yields
 * no proposal — a human resolves it in review. A null costs one pin; a wrong
 * guess costs the credibility of every pin.
 *
 * Alias length is deliberately NOT used to break ties between different places.
 * It was, briefly, and it silently produced wrong answers: "Aruba Natural Pool
 * Jeep Adventure – Natural Bridge & Casibari" pinned to Natural Bridge purely
 * because that alias is two characters longer than "natural pool". Multi-stop
 * tours genuinely have no single destination; the reviewer picks, not the sort.
 *
 * Length still breaks ties WITHIN one place (so "california lighthouse" reports
 * the longer alias it actually matched), and one place matching several of its
 * own aliases is never ambiguous.
 */
function matchPlace(text: string): Match {
  const t = norm(text);
  const hits: Array<{ place: Place; alias: string }> = [];
  for (const place of PLACES) {
    for (const alias of place.aliases) {
      const a = norm(alias);
      if (new RegExp(`\\b${escapeRe(a)}\\b`).test(t)) hits.push({ place, alias: a });
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.alias.length - a.alias.length);

  // Drop hits whose alias is contained in another hit's alias. A more specific
  // name for the same spot is not a second destination: "Hadicurari Pier" also
  // matches "hadicurari" (the beach), and "California Lighthouse" also matches
  // "california" (the wreck). Without this, every nested place name would be
  // reported as an ambiguity the reviewer has to resolve by hand.
  //
  // Genuinely distinct places still survive, because their aliases do not
  // contain one another — "arikok" and "baby beach" both remain, so a tour
  // naming both is still flagged.
  const specific = hits.filter(
    (h) => !hits.some((o) => o.alias !== h.alias && o.alias.includes(h.alias)),
  );

  const distinct = [...new Map(specific.map((h) => [h.place.id, h.place])).values()];
  if (distinct.length > 1) return { kind: 'ambiguous', places: distinct };
  return { kind: 'hit', place: specific[0].place, alias: specific[0].alias };
}

/**
 * Match a meeting-point description. A named venue (pier, marina, beach club)
 * always wins over a hotel landmark, because the prose uses the hotel to say
 * WHERE the pier is — "Pelican Pier is located between the Holiday Inn Hotel and
 * the Playa Linda Beach Resort" is one departure point, not three.
 */
function matchMeeting(text: string): Match {
  const t = norm(text);
  const hit = (roles: Array<Place['role']>) => {
    const pool = PLACES.filter((p) => roles.includes(p.role));
    const hits: Array<{ place: Place; alias: string }> = [];
    for (const place of pool) {
      for (const alias of place.aliases) {
        const a = norm(alias);
        if (new RegExp(`\\b${escapeRe(a)}\\b`).test(t)) hits.push({ place, alias: a });
      }
    }
    if (!hits.length) return null;
    hits.sort((a, b) => b.alias.length - a.alias.length);
    const specific = hits.filter((h) => !hits.some((o) => o.alias !== h.alias && o.alias.includes(h.alias)));
    const distinct = [...new Map(specific.map((h) => [h.place.id, h.place])).values()];
    if (distinct.length > 1) return { kind: 'ambiguous' as const, places: distinct };
    return { kind: 'hit' as const, place: specific[0].place, alias: specific[0].alias };
  };
  // venues first; only fall back to hotel landmarks when no venue is named
  return hit(['venue']) ?? hit(['landmark']) ?? hit([undefined]);
}

async function main() {
  // loadCatalog() RETURNS the live catalog; getCatalog() is the stub accessor and
  // would silently give 20 items instead of ~360. Compare the two so a silent
  // fallback (loadCatalog swallows every error) is loud rather than invisible.
  const catalog = await loadCatalog();
  const isStub = catalog === getCatalog();
  if (isStub) {
    console.error(
      'ERROR: got the offline stub catalog, not the live one.\n'
      + '  Run from the repo root with VITE_VIATOR_FN_URL and VITE_SUPABASE_ANON_KEY\n'
      + '  in ./.env.production. Proposals against the stub are meaningless.',
    );
    process.exit(1);
  }

  const plannable = catalog.items.filter(
    (i) => !isAutoFillExcluded(i) && (i.review_count ?? 0) >= MIN_REVIEWS,
  );

  // Products with no nameable destination. Splitting these matters for review:
  // a sunset sail can sensibly take a departure pin, a roving island tour cannot
  // take any pin at all, and lumping them together hides that difference.
  const SAIL_RE = /\b(sail|sailing|cruise|catamaran|yacht|schooner|boat charter)\b/i;
  const ROVING_RE = /\b(island tour|utv|atv|jeep|off[- ]road|scooter|harley|buggy|horseback|e-?bike|surron|sightseeing|countryside|trikes?)\b/i;

  type Row = { id: string; title: string; place?: Place; alias?: string; via?: string; cands?: Place[]; meeting?: string };
  const accept: Row[] = [], check: Row[] = [], pick: Row[] = [], departure: Row[] = [], leave: Row[] = [];
  const registryLine = (id: string, p: Place, title: string) =>
    `  '${id}': { coord: { lng: ${p.coord.lng}, lat: ${p.coord.lat} }, `
    + `source: 'known-place', place: '${p.name.replace(/'/g, "\\'")}', `
    + `cite: '${p.cite.replace(/'/g, "\\'")}' },  // ${title.slice(0, 60)}`;

  let already = 0;
  for (const item of plannable) {
    if (ITEM_PINS[item.id]) { already++; continue; }
    const title = item.title.replace(/\s+/g, ' ').trim();
    const byTitle = matchPlace(item.title);
    const byDesc = item.description ? matchPlace(item.description) : null;
    const m = byTitle ?? byDesc;
    const row: Row = { id: item.id, title };

    if (!m) {
      // No destination in the title or description. Try the meeting-point text —
      // for a sail or a class, where it departs from IS where it happens.
      const mt = meetingText(item.id);
      const mm = mt ? matchMeeting(mt) : null;
      if (mm && mm.kind === 'hit') {
        (SAIL_RE.test(title) && !ROVING_RE.test(title) ? departure : leave).push({
          ...row, place: mm.place, alias: mm.alias, via: 'meeting point', meeting: mt,
        });
      } else {
        (SAIL_RE.test(title) && !ROVING_RE.test(title) ? departure : leave).push({ ...row, meeting: mt || undefined });
      }
    } else if (m.kind === 'ambiguous') {
      pick.push({ ...row, cands: m.places });
    } else {
      const r = { ...row, place: m.place, alias: m.alias, via: byTitle ? 'title' : 'description' };
      (byTitle ? accept : check).push(r);
    }
  }

  // Group A by proposed place so identical decisions are made once, not 42 times.
  const byPlace = new Map<string, Row[]>();
  for (const r of accept) byPlace.set(r.place!.id, [...(byPlace.get(r.place!.id) ?? []), r]);
  const groups = [...byPlace.entries()].sort((a, b) => b[1].length - a[1].length);

  const gmaps = (p: Place) => `https://www.google.com/maps?q=${p.coord.lat},${p.coord.lng}`;
  const L: string[] = [];
  L.push('# Coordinate review', '');
  L.push(`Catalog ${catalog.items.length} · plannable ${plannable.length} · already registered ${already}`, '');
  L.push(`| Group | What it is | Count | Your job |`);
  L.push(`|---|---|---:|---|`);
  L.push(`| A | Title names one known place | ${accept.length} | Accept per place, in bulk |`);
  L.push(`| B | Only the description matched | ${check.length} | Judgement — the place may be incidental |`);
  L.push(`| C | Two or more places named | ${pick.length} | Pick the primary destination |`);
  L.push(`| D | Sail/cruise, no destination | ${departure.length} | Optional departure pin |`);
  L.push(`| E | Roving tour / class, no destination | ${leave.length} | Leave unpinned |`);
  L.push('', '---', '');

  L.push(`## A — Accept in bulk (${accept.length} items, ${groups.length} distinct places)`, '');
  L.push('Each block is one place. Check the map link once, then accept the whole block.', '');
  for (const [pid, rows] of groups) {
    const p = rows[0].place!;
    L.push(`### ${p.name} — ${rows.length} item${rows.length > 1 ? 's' : ''}  ·  [map](${gmaps(p)})`);
    L.push(`\`${p.coord.lng}, ${p.coord.lat}\` · ${p.cite}`, '');
    for (const r of rows) L.push(`- ${r.title}  <br/>  <sub>matched "${r.alias}" · \`${r.id}\`</sub>`);
    L.push('', '```ts');
    for (const r of rows) L.push(registryLine(r.id, r.place!, r.title));
    L.push('```', '');
    void pid;
  }

  L.push('---', '', `## B — Description-only matches (${check.length})`, '');
  L.push('The title says nothing; the place came from the description, so it may be a', 'passing mention rather than the destination. Reject freely.', '');
  for (const r of check) {
    L.push(`- **${r.title}**  <br/>  → ${r.place!.name} (matched "${r.alias}" in description) · [map](${gmaps(r.place!)}) · \`${r.id}\``);
    L.push(`  <br/><sub>\`${registryLine(r.id, r.place!, r.title).trim()}\`</sub>`);
  }

  L.push('', '---', '', `## C — Pick the primary destination (${pick.length})`, '');
  L.push('Multi-stop tours. The resolver refuses to choose between named places —', 'alias length is not a reason to prefer one destination over another.', '');
  for (const r of pick) {
    L.push(`- **${r.title}** · \`${r.id}\``);
    for (const c of r.cands!) L.push(`  - ${c.name} · [map](${gmaps(c)}) · \`${registryLine(r.id, c, r.title).trim()}\``);
  }

  L.push('', '---', '', `## D — Sails and cruises: optional departure pin (${departure.length})`, '');
  L.push('No destination exists — the departure point IS where the activity happens.', 'Only pin these where you know the actual marina or pier.', '');
  for (const r of departure) L.push(`- ${r.title} · \`${r.id}\``);

  L.push('', '---', '', `## E — Leave unpinned (${leave.length})`, '');
  L.push('Roving island tours, classes, pub crawls, unnamed dive sites. These have no', 'single location. No pin is the correct answer; the card still shows in the strip.', '');
  for (const r of leave) L.push(`- ${r.title} · \`${r.id}\``);

  writeFileSync('/tmp/coord-review.md', L.join('\n'));
  writeFileSync('/tmp/coord-proposals.ts', accept.map((r) => registryLine(r.id, r.place!, r.title)).join('\n') + '\n');

  // Structured form for the interactive reviewer (tools/review-server.mjs).
  const slim = (p: Place) => ({ id: p.id, name: p.name, coord: p.coord, cite: p.cite, terrain: p.terrain, role: p.role ?? null });
  writeFileSync('/tmp/coord-proposals.json', JSON.stringify({
    catalogItems: catalog.items.length,
    plannable: plannable.length,
    groupA: groups.map(([pid, rows]) => ({
      placeId: pid,
      place: slim(rows[0].place!),
      items: rows.map((r) => ({ id: r.id, title: r.title, alias: r.alias })),
    })),
    groupB: check.map((r) => ({ id: r.id, title: r.title, alias: r.alias, place: slim(r.place!) })),
    groupC: pick.map((r) => ({ id: r.id, title: r.title, candidates: r.cands!.map(slim) })),
    groupD: departure.map((r) => ({ id: r.id, title: r.title, meeting: r.meeting ?? null,
      proposed: r.place ? slim(r.place) : null, alias: r.alias ?? null })),
    groupE: leave.map((r) => ({ id: r.id, title: r.title, meeting: r.meeting ?? null,
      proposed: r.place ? slim(r.place) : null, alias: r.alias ?? null })),
    places: PLACES.map(slim),
  }, null, 1));

  console.log(`plannable ${plannable.length}  ·  A accept ${accept.length} (${groups.length} places)`
    + `  ·  B check ${check.length}  ·  C pick ${pick.length}  ·  D departure ${departure.length}  ·  E leave ${leave.length}`);
  console.log('\nWrote /tmp/coord-review.md and /tmp/coord-proposals.ts');
}

main();
