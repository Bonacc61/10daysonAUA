/**
 * Sweeps the semantic-search similarity floor against the golden set.
 *
 * WHY THIS EXISTS
 * `MIN_SIMILARITY = 0.20` in supabase/functions/search/index.ts was chosen by
 * feel and shipped that way. run-search-golden.cjs reports one recall number at
 * whatever value is deployed, which is not a measurement of the threshold —
 * one point is not a curve. This runs the same queries once, keeps the SCORES
 * the golden runner throws away, and recomputes recall at every floor at or
 * above the deployed one.
 *
 *   node tools/search-threshold-sweep.cjs
 *
 * WHAT IT CANNOT DO, and this is the important part. The floor is applied
 * server-side, so a run only ever sees results already above the deployed
 * value. Sweeping DOWN — the direction that could raise recall — needs a
 * redeploy, and this tool says so rather than pretending the curve is complete.
 *
 * It also asks WHY an expected item is missing, which the recall number alone
 * cannot tell you. The honest split is coarser than it looks: when the response
 * is full at MATCH_COUNT, a missing item either ranked below the cut or scored
 * under the floor, and one response cannot separate those. What DOES separate
 * them is the lowest score actually returned — if the 30th result comfortably
 * clears the floor, the floor never engaged and the CAP is what is binding.
 *
 * Reads VITE_SEARCH_FN_URL, VITE_SUPABASE_ANON_KEY and VITE_VIATOR_FN_URL from
 * ./.env.production. Burns real embedding tokens: 25 scored queries per run,
 * against a 60/hour rate limit.
 */
const { readFileSync } = require('node:fs');

const raw = (() => {
  try { return readFileSync(`${process.cwd()}/.env.production`, 'utf8'); }
  catch { return ''; }
})();
const read = (k) => (raw.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

const FN = read('VITE_SEARCH_FN_URL');
const ANON = read('VITE_SUPABASE_ANON_KEY');
const CATALOG = read('VITE_VIATOR_FN_URL');
if (!FN || !ANON || !CATALOG) {
  console.error('Need VITE_SEARCH_FN_URL, VITE_SUPABASE_ANON_KEY and VITE_VIATOR_FN_URL in ./.env.production.');
  process.exit(1);
}

const GOLDEN = require('./search-golden.json');
// The deployed floor. Anything below this is unmeasurable from here.
const DEPLOYED_FLOOR = 0.20;
const FLOORS = [0.20, 0.22, 0.24, 0.26, 0.28, 0.30, 0.34, 0.38, 0.45];
const MATCH_COUNT = 30; // mirrors supabase/functions/search/index.ts

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchOnce(q) {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) return { status: r.status, results: [] };
  const body = await r.json();
  return { status: 200, results: body.results ?? [] };
}

(async () => {
  const cr = await fetch(CATALOG, { headers: { Authorization: `Bearer ${ANON}`, apikey: ANON } });
  const cat = await cr.json();
  const title = new Map((cat.items ?? []).map((i) => [i.id, i.title]));
  console.log(`catalog: ${title.size} items\n`);

  const cases = [...GOLDEN.intent, ...GOLDEN.names];
  const rows = [];

  for (const c of cases) {
    const { status, results } = await searchOnce(c.q);
    if (status !== 200) { console.log(`  ! HTTP ${status} for "${c.q}"`); continue; }
    // Which expected fragments matched, and at what score.
    const found = c.expect.map((frag) => {
      const hit = results.find((r) => (title.get(r.id) ?? '').toLowerCase().includes(frag.toLowerCase()));
      return { frag, score: hit ? hit.score : null };
    });
    rows.push({ q: c.q, expect: c.expect.length, found, n: results.length,
                lo: results.length ? Math.min(...results.map((r) => r.score)) : null });
    await sleep(250);
  }

  // --- Recall curve -------------------------------------------------------
  console.log('─── recall vs similarity floor ─────────────────────────────');
  console.log('  floor   recall   (recall is over the 25 scored queries)');
  for (const f of FLOORS) {
    let sum = 0;
    for (const r of rows) {
      const hits = r.found.filter((x) => x.score !== null && x.score >= f).length;
      sum += r.expect ? hits / r.expect : 1;
    }
    const pct = (100 * sum) / rows.length;
    const mark = f === DEPLOYED_FLOOR ? '  ← deployed' : '';
    console.log(`  ${f.toFixed(2)}    ${pct.toFixed(1).padStart(5)}%${mark}`);
  }

  // --- Why the misses are missing ----------------------------------------
  let belowFloor = 0, outOfRange = 0, hit = 0;
  let countBound = 0;
  for (const r of rows) {
    if (r.n >= MATCH_COUNT) countBound++;
    for (const f of r.found) {
      if (f.score !== null) hit++;
      else if (r.n >= MATCH_COUNT) outOfRange++;
      else belowFloor++;
    }
  }
  console.log('\n─── why an expected item is missing ────────────────────────');
  console.log(`  found                          ${hit}`);
  console.log(`  missing, response FULL at ${MATCH_COUNT}   ${outOfRange}   ← ranked below the cut OR under the floor;`);
  console.log(`                                        one response cannot tell which — see headroom below`);
  console.log(`  missing, response NOT full      ${belowFloor}   ← nothing else cleared ${DEPLOYED_FLOOR} to return`);
  console.log(`\n  queries where match_count was binding: ${countBound}/${rows.length}`);

  console.log('\n─── headroom ───────────────────────────────────────────────');
  const lows = rows.filter((r) => r.lo !== null).map((r) => r.lo);
  if (lows.length) {
    console.log(`  lowest score actually returned: ${Math.min(...lows).toFixed(3)}`);
    console.log(`  median lowest-per-query:        ${lows.sort((a, b) => a - b)[Math.floor(lows.length / 2)].toFixed(3)}`);
  }
  console.log(`\n  Floors BELOW ${DEPLOYED_FLOOR} are not measurable from here — the function`);
  console.log('  filters before responding. Testing those needs a redeploy.');
})();
