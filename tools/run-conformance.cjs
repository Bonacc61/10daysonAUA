/**
 * Runs tools/conformance.json against the deployed `search` function and reports
 * how many returned activities CONTRADICT what was asked.
 *
 * Sibling of tools/run-search-golden.cjs, asking the opposite question. The
 * golden runner measures RECALL — did the expected things come back — and is
 * structurally blind to what came back beside them. This one ignores what is
 * missing entirely and only asks whether what arrived conforms.
 *
 *   node tools/run-conformance.cjs [--verbose]
 *
 * Deliberately NOT a vitest file, for the same reason as the golden runner: it
 * needs a deployed function and burns real embedding tokens, and `npm test` must
 * stay offline and free. The JUDGING is offline — the facets are local — but the
 * results being judged are not.
 *
 * EXITS 1 WHEN THERE ARE VIOLATIONS, AND TODAY THAT IS THE EXPECTED OUTCOME.
 * This tool is written before the feature it measures, so that "it works now"
 * can be a number rather than an impression.
 *
 * Reads VITE_SEARCH_FN_URL and VITE_SUPABASE_ANON_KEY from ./.env.production.
 * Run from the repo root. Note the search function is rate limited to 60 calls
 * per hour per caller, shared with the golden runner — a run costs one call per
 * `decidable` query.
 */
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const VERBOSE = process.argv.includes('--verbose');

const raw = (() => {
  try { return readFileSync(`${process.cwd()}/.env.production`, 'utf8'); }
  catch { return ''; }
})();
const read = (k) => (raw.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

const FN = read('VITE_SEARCH_FN_URL');
const ANON = read('VITE_SUPABASE_ANON_KEY');
if (!FN || !ANON) {
  console.error('Need VITE_SEARCH_FN_URL and VITE_SUPABASE_ANON_KEY in ./.env.production. Run from the repo root.');
  process.exit(1);
}

// Resolve ids -> the facets the app actually sees, through loadCatalog. Going
// through it rather than the raw edge-function payload matters: mergeEnrichment
// is called inside loadCatalog and gates on confidence, so the raw snapshot has
// facets the app does NOT act on. Judging against those would score a filter
// that never ran.
const out = 'node_modules/.cache/conformance-catalog.mjs';
execFileSync('node_modules/.bin/esbuild', [
  '--bundle', '--platform=node', '--format=esm', '--log-level=warning',
  `--define:import.meta.env=${JSON.stringify({ VITE_VIATOR_FN_URL: read('VITE_VIATOR_FN_URL'), VITE_SUPABASE_ANON_KEY: ANON })}`,
  `--outfile=${out}`, '--loader=ts',
], {
  input: `
    import { loadCatalog } from '${process.cwd()}/src/data/activitySource';
    const c = await loadCatalog();
    const map = {};
    for (const i of c.items) map[i.id] = {
      title: i.title, price_usd: i.price_usd, vessel: i.vessel, setting: i.setting,
      physical: i.physical, kids: i.kids, adventure: i.adventure,
      // Every facet a rule can name must be listed here. A field omitted from
      // this projection reads as undefined - i.e. UNKNOWN - for every item,
      // which silently turns its rule into a vacuous zero rather than an error.
      // Not hypothetical: adding indoor and swim_required to conformance.json
      // before listing them here made the rule unsatisfiable, and only
      // --selftest's satisfiable-AND-violable check caught it.
      swim_required: i.swim_required, indoor: i.indoor,
    };
    // Curated locals carry no enrichment at all, so every facet is undefined and
    // they count as UNKNOWN rather than as passes. That is the honest reading:
    // nothing has judged them.
    for (const a of c.activities) map[a.id] = { title: a.title, curated: true };
    console.log(JSON.stringify(map));
  `,
  stdio: ['pipe', 'inherit', 'inherit'],
});

const facets = JSON.parse(execFileSync('node', [out], { encoding: 'utf8' }).trim());
const spec = JSON.parse(readFileSync(`${process.cwd()}/tools/conformance.json`, 'utf8'));

const valueAt = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * 'unknown' is returned whenever the facet is absent, and it is NEVER folded
 * into 'pass'. A run can be violation-free and still prove nothing, which is
 * why coverage is printed next to every score.
 */
function judge(rule, item) {
  const v = valueAt(item, rule.facet);
  if (v === undefined) return 'unknown';
  switch (rule.op) {
    // `null` is a POSITIVE claim here — "explicitly aboard nothing" — while
    // undefined means nobody looked. Collapsing the two would turn 113 unjudged
    // products into passes.
    case 'isNull':  return v === null ? 'pass' : 'fail';
    case 'notNull': return v !== null ? 'pass' : 'fail';
    case 'isTrue':  return v === true ? 'pass' : 'fail';
    case 'isFalse': return v === false ? 'pass' : 'fail';
    case 'eq':      return v === rule.value ? 'pass' : 'fail';
    case 'neq':     return v !== rule.value ? 'pass' : 'fail';
    case 'notIn':   return rule.value.includes(v) ? 'fail' : 'pass';
    case 'lte':     return v <= rule.value ? 'pass' : 'fail';
    case 'gte':     return v >= rule.value ? 'pass' : 'fail';
    default: throw new Error(`unknown op "${rule.op}" in conformance.json`);
  }
}

/**
 * `--selftest`: prove the judge can return BOTH verdicts before believing either.
 *
 * A checker that always reports violations is as worthless as one that never
 * does, and this file's whole job is to be believed when it prints a zero. So
 * the guard is symmetric, the same shape as searchPool.test.ts's reachability
 * rule: for every query, a set built to CONFORM must score 0, and a set built to
 * CONTRADICT must score more than 0. Offline, free, no network.
 */
function selftest() {
  const fail = (m) => { console.error(`selftest FAILED: ${m}`); process.exit(1); };

  // Operators, including the distinction the whole file rests on.
  const cases = [
    [{ facet: 'vessel', op: 'isNull' }, { vessel: null }, 'pass'],
    [{ facet: 'vessel', op: 'isNull' }, { vessel: 'boat' }, 'fail'],
    [{ facet: 'vessel', op: 'isNull' }, {}, 'unknown'],
    [{ facet: 'physical.mobility_ok', op: 'isTrue' }, { physical: { mobility_ok: false } }, 'fail'],
    [{ facet: 'physical.mobility_ok', op: 'isTrue' }, { physical: undefined }, 'unknown'],
    [{ facet: 'physical.demand', op: 'notIn', value: ['high'] }, { physical: { demand: 'high' } }, 'fail'],
    [{ facet: 'physical.demand', op: 'notIn', value: ['high'] }, { physical: { demand: 'low' } }, 'pass'],
    [{ facet: 'price_usd', op: 'lte', value: 120 }, { price_usd: 172 }, 'fail'],
    [{ facet: 'price_usd', op: 'lte', value: 120 }, { price_usd: 0 }, 'pass'],
    [{ facet: 'adventure', op: 'gte', value: 55 }, { adventure: 20 }, 'fail'],
  ];
  for (const [rule, item, want] of cases) {
    const got = judge(rule, item);
    if (got !== want) fail(`${rule.op} on ${JSON.stringify(item)} -> ${got}, wanted ${want}`);
  }

  // A curated local carries no facets, so it must be unjudged rather than clean.
  if (judge({ facet: 'vessel', op: 'isNull' }, { title: 'x', curated: true }) !== 'unknown') {
    fail('a curated local with no facets was judged rather than counted unknown');
  }

  const all = Object.values(facets);
  for (const entry of spec.decidable) {
    const verdictsFor = (it) => entry.rules.map((r) => judge(r, it));
    const violates = (it) => verdictsFor(it).some((v) => v === 'fail');

    // Built to conform: every real catalog item that passes every rule.
    const conforming = all.filter((it) => verdictsFor(it).every((v) => v === 'pass'));
    if (conforming.length === 0) fail(`no catalog item can satisfy "${entry.q}" — the rule is unsatisfiable, not strict`);
    if (conforming.some(violates)) fail(`an item built to conform scored a violation on "${entry.q}"`);

    // Built to contradict: items the data actively rules out. If none exists,
    // the rule cannot discriminate and would score a vacuous zero forever.
    const contradicting = all.filter(violates);
    if (contradicting.length === 0) fail(`nothing in the catalog can violate "${entry.q}" — the rule is vacuous`);
  }

  console.log(`selftest ok — ${cases.length} operator cases, and every rule both satisfiable and violable against the real catalog.`);
  process.exit(0);
}
if (process.argv.includes('--selftest')) selftest();

async function search(q) {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) return { status: r.status, ids: [] };
  const body = await r.json();
  return { status: 200, ids: (body.results ?? []).map((x) => x.id) };
}

(async () => {
  let totalViolations = 0, totalJudged = 0, totalReturned = 0;
  const rows = [];

  for (const entry of spec.decidable) {
    const { status, ids } = await search(entry.q);
    if (status !== 200) {
      console.log(`\n"${entry.q}"\n  -> HTTP ${status}; skipped. (429 = rate limit; the golden runner shares the 60/hour budget.)`);
      continue;
    }

    let judged = 0, violations = 0;
    const offenders = [];
    for (const id of ids) {
      const item = facets[id];
      if (!item) continue;                  // ranked an id the catalog no longer has
      // An item violates the QUERY if it fails ANY of its rules. Rules are AND:
      // "walks slowly" means low demand AND mobility-friendly, and an item that
      // fails either is wrong for the person who typed it.
      const verdicts = entry.rules.map((r) => judge(r, item));
      if (verdicts.some((v) => v !== 'unknown')) judged++;
      const broken = entry.rules.filter((r, i) => verdicts[i] === 'fail');
      if (broken.length) {
        violations++;
        offenders.push({ title: item.title, why: broken.map((r) => r.facet).join(', ') });
      }
    }

    totalViolations += violations;
    totalJudged += judged;
    totalReturned += ids.length;
    rows.push({ q: entry.q, returned: ids.length, judged, violations, offenders });
  }

  console.log('\nCONFORMANCE — do the results contradict what was asked?\n');
  console.log('  violations / judged / returned   query');
  console.log('  ' + '-'.repeat(70));
  for (const r of rows) {
    const cov = r.returned ? Math.round((r.judged / r.returned) * 100) : 0;
    const flag = r.violations ? '!' : ' ';
    console.log(`${flag} ${String(r.violations).padStart(9)} /${String(r.judged).padStart(7)} /${String(r.returned).padStart(9)}   "${r.q}"  [${cov}% judgeable]`);
    if (r.violations && (VERBOSE || r.offenders.length <= 3)) {
      for (const o of r.offenders.slice(0, VERBOSE ? 99 : 3)) {
        console.log(`      ${o.title.slice(0, 58)}  (${o.why})`);
      }
      if (!VERBOSE && r.offenders.length > 3) console.log(`      … ${r.offenders.length - 3} more, --verbose for all`);
    }
  }

  const coverage = totalReturned ? Math.round((totalJudged / totalReturned) * 100) : 0;
  console.log('  ' + '-'.repeat(70));
  console.log(`  ${totalViolations} violations across ${totalJudged} judgeable results of ${totalReturned} returned (${coverage}% judgeable)\n`);

  if (spec.deferred?.length) {
    console.log(`  ${spec.deferred.length} queries DEFERRED — no facet exists to judge them:`);
    for (const d of spec.deferred) console.log(`    "${d.q}"  needs ${d.needs.split('.')[0]}`);
    console.log('');
  }

  // A violation-free run at low coverage has not shown that search works, so the
  // number to read is the pair, not the zero.
  console.log(totalViolations === 0
    ? '  No contradiction among the results the data can judge.'
    : `  Search is returning activities that contradict the query.`);
  process.exit(totalViolations === 0 ? 0 : 1);
})();
