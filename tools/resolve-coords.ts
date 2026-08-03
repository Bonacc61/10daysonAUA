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
import { writeFileSync } from 'node:fs';

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

  const distinct = [...new Map(hits.map((h) => [h.place.id, h.place])).values()];
  if (distinct.length > 1) return { kind: 'ambiguous', places: distinct };
  return { kind: 'hit', place: hits[0].place, alias: hits[0].alias };
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

  const rows: string[] = [];
  const accepted: string[] = [];
  let already = 0, proposed = 0, ambiguous = 0, none = 0;

  for (const item of plannable) {
    if (ITEM_PINS[item.id]) { already++; continue; }

    const byTitle = matchPlace(item.title);
    const byDesc = item.description ? matchPlace(item.description) : null;
    const m = byTitle ?? byDesc;
    const via = byTitle ? 'title' : 'description';
    const title = item.title.replace(/\s+/g, ' ').trim();

    if (!m) {
      none++;
      rows.push(`| \`${item.id}\` | ${title} | — | NO MATCH → no pin | |`);
      continue;
    }
    if (m.kind === 'ambiguous') {
      ambiguous++;
      rows.push(`| \`${item.id}\` | ${title} | — | AMBIGUOUS (${m.places.map((p) => p.name).join(' / ')}) → no pin | |`);
      continue;
    }

    proposed++;
    const { coord, name, cite } = m.place;
    const link = `https://www.google.com/maps?q=${coord.lat},${coord.lng}`;
    rows.push(`| \`${item.id}\` | ${title} | ${name} | via ${via}: "${m.alias}" | [check](${link}) |`);
    accepted.push(
      `  '${item.id}': { coord: { lng: ${coord.lng}, lat: ${coord.lat} }, `
      + `source: 'known-place', place: '${name.replace(/'/g, "\\'")}', `
      + `cite: '${cite.replace(/'/g, "\\'")}' },  // ${title.slice(0, 60)}`,
    );
  }

  const report = [
    '# Coordinate proposals', '',
    `Catalog items: ${catalog.items.length}`,
    `Plannable pool (not auto-fill-excluded, >= ${MIN_REVIEWS} reviews): ${plannable.length}`,
    `Already registered: ${already}`,
    `Proposed: ${proposed}`,
    `Ambiguous (no pin): ${ambiguous}`,
    `No match (no pin): ${none}`, '',
    'Review every row. Verify the coordinate against the map link before accepting.',
    'Reject anything you cannot defend — an unregistered item simply draws no pin.', '',
    '| id | title | proposed place | basis | verify |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');

  writeFileSync('/tmp/coord-proposals.md', report);
  writeFileSync('/tmp/coord-proposals.ts', accepted.join('\n') + '\n');

  console.log(report.split('\n').slice(0, 9).join('\n'));
  console.log(`\nWrote /tmp/coord-proposals.md (${rows.length} rows) and /tmp/coord-proposals.ts`);
}

main();
