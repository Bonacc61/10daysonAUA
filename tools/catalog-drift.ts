/**
 * Catalog drift — re-measures the numbers this codebase reasons with, and says
 * what moved.
 *
 * WHY THIS EXISTS
 * The specs, the roadmap and several tuned constants cite measurements of the
 * LIVE Viator catalog: "144 of 328 items fall into generic buckets", "11 distinct
 * adventure values", "72 of 155 eligible experiences clear the review floor".
 * Those numbers justify design decisions, and they are measurements of a third
 * party's data that changes without telling us. A unit test cannot see this —
 * the truth lives on Viator's servers.
 *
 * This is the regression detector for that class of drift. It re-measures,
 * diffs against a committed baseline, and reports.
 *
 *   node tools/run-drift.cjs              # measure and compare
 *   node tools/run-drift.cjs --update     # accept current numbers as the baseline
 *
 * Exit code is 1 when something moved beyond tolerance, so a scheduled run can
 * be quiet until it matters.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadCatalog } from '../src/data/activitySource';
import { activityKind, itemAdventure, isAutoFillExcluded, isCrowdPleaser } from '../src/data/itemFit';

const BASELINE = 'tools/catalog-baseline.json';

// Absolute tolerance per metric. Catalog churn is normal; a design decision
// quietly becoming wrong is not. These are deliberately loose — this should
// speak up rarely and mean it when it does.
const TOLERANCE: Record<string, number> = {
  items: 25,
  kindResolved: 20,
  genericBucket: 20,
  distinctAdventure: 3,
  noTags: 5,
  noCluster: 5,
  distinctClusters: 25,
  overReviewFloor: 20,
  autoFillExcluded: 15,
};

const MIN_CHAMPION_REVIEWS = 25;   // mirrors itineraryGenerator.ts

type Metrics = Record<string, number>;

function measure(items: Parameters<typeof activityKind>[0][]): Metrics {
  const generic = items.filter((i) => activityKind(i).startsWith('sec:')).length;
  return {
    items: items.length,
    kindResolved: items.length - generic,
    genericBucket: generic,
    distinctAdventure: new Set(items.map(itemAdventure)).size,
    noTags: items.filter((i) => !i.tags || i.tags.length === 0).length,
    noCluster: items.filter((i) => !i.experience_cluster_id).length,
    distinctClusters: new Set(items.map((i) => i.experience_cluster_id ?? i.id)).size,
    overReviewFloor: items.filter((i) => isCrowdPleaser(i) || (i.review_count ?? 0) >= MIN_CHAMPION_REVIEWS).length,
    autoFillExcluded: items.filter((i) => isAutoFillExcluded(i)).length,
  };
}

const LABEL: Record<string, string> = {
  items: 'catalog items',
  kindResolved: 'kind resolved from Viator tags',
  genericBucket: 'items in a generic sec: bucket',
  distinctAdventure: 'distinct adventure values',
  noTags: 'items with no tags',
  noCluster: 'items with no cluster id',
  distinctClusters: 'distinct experience clusters',
  overReviewFloor: `items over the ${MIN_CHAMPION_REVIEWS}-review floor`,
  autoFillExcluded: 'items excluded from auto-fill',
};

(async () => {
  const update = process.argv.includes('--update');
  const catalog = await loadCatalog();

  if (catalog.items.length < 50) {
    console.error(`only ${catalog.items.length} items — that is the offline stub, not the live catalog.`);
    console.error('Run from the repo root so ./.env.production is readable.');
    process.exit(2);
  }

  const now = measure(catalog.items);
  const stamp = new Date().toISOString().slice(0, 10);

  if (update) {
    writeFileSync(BASELINE, JSON.stringify({ measured: stamp, metrics: now }, null, 2) + '\n');
    console.log(`baseline written (${stamp}):`);
    for (const [k, v] of Object.entries(now)) console.log(`  ${String(v).padStart(5)}  ${LABEL[k]}`);
    return;
  }

  let base: { measured: string; metrics: Metrics };
  try {
    base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  } catch {
    console.error(`no baseline at ${BASELINE}. Run with --update to create one.`);
    process.exit(2);
    return;
  }

  const moved: string[] = [];
  console.log(`catalog drift — baseline ${base.measured}, measured ${stamp}\n`);
  for (const key of Object.keys(now)) {
    const from = base.metrics[key];
    const to = now[key];
    const delta = to - (from ?? to);
    const tol = TOLERANCE[key] ?? 0;
    const flag = from === undefined ? ' (new metric)' : Math.abs(delta) > tol ? '  ⚠ BEYOND TOLERANCE' : '';
    if (flag.includes('⚠')) moved.push(`${LABEL[key]}: ${from} -> ${to} (${delta > 0 ? '+' : ''}${delta}, tolerance ±${tol})`);
    const arrow = delta === 0 ? '   =' : `${delta > 0 ? '+' : ''}${delta}`.padStart(4);
    console.log(`  ${String(from ?? '—').padStart(5)} -> ${String(to).padStart(5)}  ${arrow}  ${LABEL[key]}${flag}`);
  }

  // The golden sets need a deployed edge function and an API key. Say so rather
  // than failing — they join this report the day those exist.
  console.log('\ngolden sets:');
  for (const [name, file, envVar] of [
    ['itinerary-edit', 'tools/edit-golden.json', 'VITE_ITINERARY_EDIT_FN_URL'],
    ['search', 'tools/search-golden.json', 'VITE_SEARCH_FN_URL'],
  ] as const) {
    let exists = true;
    try { readFileSync(file); } catch { exists = false; }
    const configured = (process.env[envVar] ?? '').length > 0;
    console.log(`  ${name.padEnd(16)} ${!exists ? 'not written yet' : !configured ? `not run — ${envVar} unset (function not deployed)` : 'ready — run its own runner'}`);
  }

  if (moved.length) {
    console.log('\n⚠ moved beyond tolerance:');
    for (const m of moved) console.log(`  - ${m}`);
    console.log('\nThese numbers are cited in docs/ROADMAP.md and the specs under');
    console.log('docs/superpowers/specs/. If the shift is real, the reasoning that rests');
    console.log('on them needs re-reading — then `--update` the baseline.');
    process.exit(1);
  }
  console.log('\nnothing beyond tolerance.');
})();
