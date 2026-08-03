/**
 * Coordinate audit — the ship gate for pin data.
 *
 * Hard failures (exit 1): a pin outside Aruba, coarser than 3 decimals, missing
 * a citation, sitting in open water without saying so, or a plannable catalog
 * item that has neither a pin nor a recorded decision to leave it unpinned.
 *
 * Warnings (exit 0, human sign-off): coordinate collisions and catalog churn.
 *
 * The reviewed-vs-unreviewed distinction matters. An item somebody looked at and
 * declined — a hotel-pickup tour with no fixed departure point — is a finished
 * decision. An item nobody has opened is an unknown. Only the second is a gate
 * failure, otherwise the gate would punish the correct answer.
 *
 * Run: npm run audit:coords [-- --json]
 */
import { readFileSync, existsSync } from 'node:fs';
import { loadCatalog, getCatalog } from '../src/data/activitySource';
import { isAutoFillExcluded } from '../src/data/itemFit';
import { ITEM_PINS, pinPlaces } from '../src/data/itemCoords';
import {
  inBounds, hasPrecision, pointInRing, kmToRing,
  LAND_TOLERANCE_KM, SEA_TOLERANCE_KM, type Ring,
} from '../src/data/coordValidate';

const MIN_REVIEWS = 25;        // mirrors MIN_CHAMPION_REVIEWS, itineraryGenerator.ts:130
const MAX_SHARED_COORD = 3;    // more than this reads as a re-introduced centroid
const RING: Ring = JSON.parse(readFileSync('tools/aruba-coastline.json', 'utf8')).ring;
const DECISIONS = 'docs/map/coord-decisions-2026-08-03.json';

// Coordinates that are legitimately shared by many products, with the reason.
// A shared point is not automatically wrong — eight operators really do run jeep
// safaris to the same rock pool — but it must be acknowledged, not assumed.
const ALLOWED_COLLISIONS: Record<string, string> = {
  '-69.92870,12.52460': 'Conchi (Natural Pool) — the island\'s most-booked destination',
  '-69.94850,12.49970': 'Arikok National Park entrance',
  '-69.87930,12.41370': 'Baby Beach',
  '-70.05770,12.60210': 'SS Antilla wreck — every turtle/wreck snorkel goes here',
  '-70.04610,12.57440': 'Pelican Pier — several operators share it',
  '-69.96950,12.46430': 'Mangel Halto — the island\'s main mangrove snorkel and kayak spot',
  '-70.04470,12.57760': 'MooMba Beach — Jolly Pirates and others sail from here',
  '-70.04490,12.57590': 'Holiday Inn pier — several catamarans board here',
  '-70.04300,12.56200': 'Palm Beach hotel strip — the four open-bus sightseeing tours all board here',
  '-70.05190,12.60490': 'Boca Catalina — the standard turtle-snorkel stop, mostly as a secondary stop on Antilla wreck trips',
};

type Finding = { id: string; msg: string };

async function main() {
  const asJson = process.argv.includes('--json');
  const hard: Finding[] = [];
  const warn: Finding[] = [];

  // ── every pin and every secondary stop ────────────────────────────────────
  for (const [id, pin] of Object.entries(ITEM_PINS)) {
    for (const [i, place] of pinPlaces(pin).entries()) {
      const where = place.primary ? id : `${id} (stop ${i})`;
      if (!place.cite?.trim()) hard.push({ id: where, msg: 'missing citation' });
      if (!inBounds(place.coord)) {
        hard.push({ id: where, msg: `outside Aruba (${place.coord.lng}, ${place.coord.lat})` });
        continue;  // distance checks are meaningless off-island
      }
      if (!hasPrecision(place.coord) && !/pending re-research/i.test(place.cite ?? '')) {
        hard.push({ id: where, msg: 'coarser than 3 decimals and not flagged pending' });
      }
      const onLand = pointInRing(place.coord, RING);
      const km = kmToRing(place.coord, RING);
      if (!onLand && km > SEA_TOLERANCE_KM) {
        hard.push({ id: where, msg: `${km.toFixed(1)}km out to sea` });
      } else if (!onLand && !place.offshore && km > LAND_TOLERANCE_KM) {
        hard.push({ id: where, msg: `${Math.round(km * 1000)}m offshore but not marked offshore` });
      }
    }
    if (pin.approx && pin.source !== 'departure') {
      hard.push({ id, msg: `approx on a '${pin.source}' pin — approximation is only for departure points` });
    }
    if (pin.approx && !/approx/i.test(pin.cite)) {
      hard.push({ id, msg: 'flagged approximate but the citation does not say so' });
    }
  }

  // ── collisions ────────────────────────────────────────────────────────────
  // Counts secondary stops as well as primaries: a centroid re-introduced as a
  // stop across many items is the same failure this rule exists to catch, and
  // keying only on the primary would miss it entirely.
  const byCoord = new Map<string, string[]>();
  for (const [id, pin] of Object.entries(ITEM_PINS)) {
    for (const place of pinPlaces(pin)) {
      const k = `${place.coord.lng.toFixed(5)},${place.coord.lat.toFixed(5)}`;
      byCoord.set(k, [...(byCoord.get(k) ?? []), place.primary ? id : `${id}#stop`]);
    }
  }
  for (const [k, ids] of byCoord) {
    if (ids.length <= MAX_SHARED_COORD) continue;
    const reason = ALLOWED_COLLISIONS[k];
    if (reason) warn.push({ id: k, msg: `${ids.length} items — expected: ${reason}` });
    else hard.push({ id: k, msg: `${ids.length} items share this point with no recorded reason: ${ids.slice(0, 4).join(', ')}…` });
  }

  // ── coverage over the plannable pool ──────────────────────────────────────
  const catalog = await loadCatalog();
  if (catalog === getCatalog()) {
    console.error('ERROR: got the offline stub catalog. Run from the repo root with a populated .env.production.');
    process.exit(2);
  }
  const plannable = catalog.items.filter(
    (i) => !isAutoFillExcluded(i) && (i.review_count ?? 0) >= MIN_REVIEWS,
  );
  const decisions: Record<string, { action?: string }> =
    existsSync(DECISIONS) ? JSON.parse(readFileSync(DECISIONS, 'utf8')) : {};

  const unpinned = plannable.filter((i) => !ITEM_PINS[i.id]);
  const declined = unpinned.filter((i) => decisions[i.id]?.action === 'reject');
  // Only an explicit REJECT excuses a missing pin. Treating any decision as
  // sufficient would hide the one error this gate exists to catch: a reviewer
  // accepts a pin in the UI and forgets to apply it to the registry. The item is
  // then unpinned, has a decision, and would slip through both buckets silently.
  const unreviewed = unpinned.filter((i) => decisions[i.id]?.action !== 'reject');
  const acceptedButMissing = unreviewed.filter((i) => decisions[i.id]?.action === 'accept');
  for (const i of unreviewed) {
    hard.push({
      id: i.id,
      msg: decisions[i.id]
        ? `ACCEPTED IN REVIEW BUT NOT IN THE REGISTRY — "${i.title.slice(0, 46)}"`
        : `plannable, no pin, never reviewed — "${i.title.slice(0, 54)}"`,
    });
  }

  // ── churn ─────────────────────────────────────────────────────────────────
  const catalogIds = new Set(catalog.items.map((i) => i.id));
  for (const [id, pin] of Object.entries(ITEM_PINS)) {
    if (pin.source !== 'curated' && !catalogIds.has(id)) {
      warn.push({ id, msg: 'registered but no longer in the catalog — prune' });
    }
  }

  const bySource = Object.values(ITEM_PINS).reduce<Record<string, number>>(
    (a, p) => ({ ...a, [p.source]: (a[p.source] ?? 0) + 1 }), {});
  const stops = Object.values(ITEM_PINS).reduce((n, p) => n + (p.stops?.length ?? 0), 0);

  if (asJson) {
    console.log(JSON.stringify({ hard, warn, bySource, stops,
      plannable: plannable.length, pinned: Object.keys(ITEM_PINS).length,
      declined: declined.length, unreviewed: unreviewed.length,
      acceptedButMissing: acceptedButMissing.length }, null, 2));
  } else {
    console.log(`\nRegistry      ${Object.keys(ITEM_PINS).length} pins + ${stops} secondary stops`);
    console.log(`By source     ${JSON.stringify(bySource)}`);
    console.log(`Approximate   ${Object.values(ITEM_PINS).filter((p) => p.approx).length}`);
    console.log(`\nPlannable pool ${plannable.length}`);
    console.log(`  pinned              ${plannable.length - unpinned.length}`);
    console.log(`  reviewed, declined  ${declined.length}`);
    console.log(`  never reviewed      ${unreviewed.length - acceptedButMissing.length}`);
    console.log(`  ACCEPTED, NOT APPLIED ${acceptedButMissing.length}`);
    if (warn.length) {
      console.log(`\nWarnings (${warn.length}) — need sign-off, not a build failure:`);
      warn.forEach((w) => console.log(`  ! ${w.id}: ${w.msg}`));
    }
    if (hard.length) {
      console.log(`\nFAILURES (${hard.length}):`);
      hard.slice(0, 25).forEach((h) => console.log(`  ✗ ${h.id}: ${h.msg}`));
      if (hard.length > 25) console.log(`  … and ${hard.length - 25} more`);
    } else {
      console.log('\nNo hard violations.');
    }
  }
  process.exit(hard.length ? 1 : 0);
}

main();
