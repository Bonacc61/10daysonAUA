/**
 * Runs tools/search-golden.json against the deployed `search` function and
 * reports recall per query.
 *
 * Deliberately NOT a vitest file: it needs a deployed function and burns real
 * embedding tokens, and `npm test` must stay offline and free. Run it by hand
 * whenever the similarity floor, the embedded text composition, or the model
 * changes — those are the three things that silently move ranking quality.
 *
 *   node tools/run-search-golden.cjs
 *
 * Reads VITE_SEARCH_FN_URL and VITE_SUPABASE_ANON_KEY from ./.env.production,
 * and the catalog through the app's own loadCatalog so ids can be resolved back
 * to titles. Run from the repo root.
 */
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const raw = (() => {
  try { return readFileSync(`${process.cwd()}/.env.production`, 'utf8'); }
  catch { return ''; }
})();
const read = (k) => (raw.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

const FN = read('VITE_SEARCH_FN_URL');
const ANON = read('VITE_SUPABASE_ANON_KEY');
if (!FN || !ANON) {
  console.error('Need VITE_SEARCH_FN_URL and VITE_SUPABASE_ANON_KEY in ./.env.production.');
  console.error('If the search function is not deployed yet, that is why — this cannot run before it is.');
  process.exit(1);
}

// Resolve ids -> titles through the app's catalog, bundled the way run-trace does.
const out = 'node_modules/.cache/search-golden-catalog.mjs';
execFileSync('node_modules/.bin/esbuild', [
  '--bundle', '--platform=node', '--format=esm', '--log-level=warning',
  `--define:import.meta.env=${JSON.stringify({ VITE_VIATOR_FN_URL: read('VITE_VIATOR_FN_URL'), VITE_SUPABASE_ANON_KEY: ANON })}`,
  `--outfile=${out}`,
  // `--loader=ts`, not `--stdin-loader=ts`. The latter is not an esbuild flag
  // (checked against 0.21.5) and made this runner exit 1 before it ever reached
  // the network — which is why it had never actually run: the search function
  // was not deployed either, so the failure looked like the expected one.
  '--loader=ts',
], {
  input: `
    import { loadCatalog } from '${process.cwd()}/src/data/activitySource';
    const c = await loadCatalog();
    const map = {};
    for (const i of c.items) map[i.id] = i.title;
    for (const a of c.activities) map[a.id] = a.title;
    console.log(JSON.stringify(map));
  `,
  stdio: ['pipe', 'inherit', 'inherit'],
});

const titles = JSON.parse(execFileSync('node', [out], { encoding: 'utf8' }).trim());
const golden = JSON.parse(readFileSync(`${process.cwd()}/tools/search-golden.json`, 'utf8'));

async function search(q) {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) return { status: r.status };
  const body = await r.json();
  return { status: 200, ids: (body.results ?? []).map((x) => x.id) };
}

const has = (list, frag) => list.some((t) => (t ?? '').toLowerCase().includes(frag.toLowerCase()));

(async () => {
  let recallSum = 0, n = 0, firstRankFails = 0;

  for (const group of ['intent', 'names']) {
    console.log(`\n=== ${group} ===`);
    for (const c of golden[group]) {
      const res = await search(c.q);
      if (res.status !== 200) { console.log(`  ✗ "${c.q}" — HTTP ${res.status}`); n++; continue; }
      const got = res.ids.map((id) => titles[id]).filter(Boolean);
      const hits = c.expect.filter((f) => has(got, f));
      const recall = c.expect.length ? hits.length / c.expect.length : 1;
      recallSum += recall; n++;

      let flag = '';
      if (c.mustNotRankFirst?.length && got[0]) {
        if (c.mustNotRankFirst.some((f) => got[0].toLowerCase().includes(f.toLowerCase()))) {
          flag = `  ⚠ WRONG FIRST RESULT: "${got[0]}"`;
          firstRankFails++;
        }
      }
      const bar = `${hits.length}/${c.expect.length}`;
      console.log(`  ${(recall >= 0.5 ? '✓' : '✗')} ${bar.padEnd(5)} "${c.q}"${flag}`);
      if (recall < 0.5) console.log(`        top 3: ${got.slice(0, 3).join(' | ') || '(none)'}`);
    }
  }

  console.log('\n=== adversarial (read these; they are not scored) ===');
  for (const a of golden.adversarial) {
    const q = a.q === 'PADDING_200' ? 'x'.repeat(201) : a.q;
    const res = await search(q);
    console.log(`\n  ${JSON.stringify(q.length > 40 ? q.slice(0, 37) + '…' : q)}`);
    console.log(`    -> HTTP ${res.status}${res.ids ? `, ${res.ids.length} results` : ''}`);
    console.log(`    expect: ${a.note}`);
  }

  console.log(`\noverall recall: ${Math.round((100 * recallSum) / n)}%  (target ≥ 80% before enabling)`);
  if (firstRankFails) {
    console.log(`⚠ ${firstRankFails} name quer${firstRankFails === 1 ? 'y' : 'ies'} ranked the wrong thing first.`);
    console.log('  Expected — semantic search is weak on proper nouns. It is why the client');
    console.log('  puts substring hits above these (blendSearchResults). Only alarming if the');
    console.log('  real match is absent entirely rather than merely second.');
  }
})();
