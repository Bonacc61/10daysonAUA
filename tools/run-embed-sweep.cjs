/**
 * Offline A/B sweep of what the search corpus EMBEDS, and at how many dimensions.
 *
 * Why this exists: every previous attempt to answer "does the suitability corpus
 * help?" measured it in production, where a corpus rewrite takes minutes to settle
 * and `search_items` orders through an APPROXIMATE (HNSW) index. Two measurements
 * were lost to that. At 328 items an EXACT brute-force cosine scan is instant, so
 * this reproduces the ranking arithmetic locally and the settling problem simply
 * does not exist.
 *
 *   node tools/run-embed-sweep.cjs            # needs OPENAI_API_KEY in .env.local
 *   node tools/run-embed-sweep.cjs --dry      # corpus + reachability only, no key, no cost
 *
 * WHAT IT IS NOT: this is not the deployed system. It differs in three ways that
 * are documented rather than hidden, because each one moves the ABSOLUTE number
 * while leaving the arm-to-arm COMPARISON — the thing this tool exists to make —
 * intact:
 *   1. It scans the 328-item client catalog. `item_embeddings` holds ~366 rows
 *      (the raw payload before regroupItems), so production spends some of its 30
 *      slots on products the client filters out anyway.
 *   2. Exact cosine, not HNSW. Production recall <= this recall, never above.
 *   3. Both halves of the corpus are here: the Viator payload and, since
 *      2026-08-15, the 26 curated locals that viator-cards now embeds too.
 *
 * Deliberately NOT a vitest file: it needs a network call and a real key, and
 * `npm test` must stay offline and free.
 */
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const DRY = process.argv.includes('--dry');

// ── Config mirrored from the deployed function ─────────────────────────────
// These three are what make the local number comparable to the live one. If any
// of them changes in supabase/functions/, change it here or the comparison lies.
const MATCH_COUNT = 30;      // search/index.ts:26
const MIN_SIMILARITY = 0.20; // search/index.ts:35
const OPENAI_MODEL = 'text-embedding-3-small';

// Lines carried by more than this share of the catalog are shared boilerplate,
// not signal: "Suitable for all physical fitness levels" is on 71% of products.
// Measured 2026-08-15 — the top four lines (71/55/51/50%) are all of that kind.
const BOILERPLATE_CUTOFF = 0.40;

const env = (() => {
  try { return readFileSync(`${process.cwd()}/.env.local`, 'utf8'); }
  catch { return ''; }
})();
const readEnv = (k) => process.env[k]
  || (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim()
  || '';
const prodEnv = (() => {
  try { return readFileSync(`${process.cwd()}/.env.production`, 'utf8'); }
  catch { return ''; }
})();
const readProd = (k) => (prodEnv.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

// ── Catalog ────────────────────────────────────────────────────────────────
// Bundled through the app's own loadCatalog, the way run-search-golden.cjs does,
// so "what is in the catalog" has exactly one definition in this repo.
function loadCatalog() {
  const out = 'node_modules/.cache/embed-sweep-catalog.mjs';
  execFileSync('node_modules/.bin/esbuild', [
    '--bundle', '--platform=node', '--format=esm', '--log-level=warning',
    `--define:import.meta.env=${JSON.stringify({
      VITE_VIATOR_FN_URL: readProd('VITE_VIATOR_FN_URL'),
      VITE_SUPABASE_ANON_KEY: readProd('VITE_SUPABASE_ANON_KEY'),
    })}`,
    `--outfile=${out}`, '--loader=ts',
  ], {
    input: `
      import { loadCatalog } from '${process.cwd()}/src/data/activitySource';
      const c = await loadCatalog();
      console.log(JSON.stringify({
        items: c.items.map((i) => ({ id: i.id, title: i.title, description: i.description ?? '' })),
        activities: c.activities.map((a) => ({ id: a.id, title: a.title })),
      }));
    `,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  return JSON.parse(execFileSync('node', [out], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim());
}

// ── The curated locals ─────────────────────────────────────────────────────
// Since 2026-08-15 `viator-cards` embeds these alongside the Viator payload, so
// the corpus this tool scans has to include them or it is measuring a system
// that no longer exists. Their text is fixed by `npm run build:curated` and does
// not vary by arm — only the Viator half is composed differently per arm.
function loadCurated() {
  const raw = readFileSync(`${process.cwd()}/supabase/functions/viator-cards/curatedData.ts`, 'utf8');
  const body = raw.slice(raw.indexOf('= ['), raw.lastIndexOf(']') + 1).replace(/^=\s*/, '');
  return JSON.parse(body.replace(/,(\s*])/, '$1').replace(/(\{|,)\s*(id|text):/g, '$1"$2":'));
}

// ── Suitability profiles (the generated snapshot) ──────────────────────────
function loadProfiles() {
  const raw = readFileSync(`${process.cwd()}/supabase/functions/viator-cards/suitabilityData.ts`, 'utf8');
  const body = raw.slice(raw.indexOf('= {') + 2, raw.lastIndexOf('}') + 1);
  return JSON.parse(body.replace(/,(\s*})/, '$1'));
}

// Split a profile into its sentences. Viator's `additionalInfo` lines are whole
// sentences ending in a period, which is what suitability.ts joined them on.
const lines = (profile) => profile.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);

/** Drop lines carried by more than `cutoff` of the profiled catalog. */
function discriminativeOnly(profiles, cutoff) {
  const freq = {};
  const vals = Object.values(profiles);
  for (const v of vals) for (const l of new Set(lines(v))) freq[l] = (freq[l] || 0) + 1;
  const common = new Set(Object.entries(freq)
    .filter(([, n]) => n / vals.length > cutoff)
    .map(([l]) => l));
  const out = {};
  for (const [id, v] of Object.entries(profiles)) {
    out[id] = lines(v).filter((l) => !common.has(l)).join(' ');
  }
  return { profiles: out, dropped: [...common], freq, total: vals.length };
}

// ── Text variants ──────────────────────────────────────────────────────────
// Arm A is byte-for-byte what viator-cards deploys today (index.ts:212). Arms B
// and C add a suitability profile through the same composer the edge function
// would use, so the only thing varying across arms is the TEXT.
const SEARCH_TEXT_MAX = 2000;
function searchText(title, description, profile, maxChars = SEARCH_TEXT_MAX) {
  const head = `${title}. `;
  const tail = profile ? ` ${profile}` : '';
  const budget = maxChars - head.length - tail.length;
  if (budget <= 0) return `${title}.${tail}`.slice(0, maxChars);
  return `${head}${description.slice(0, budget)}${tail}`;
}

// ── Embedding ──────────────────────────────────────────────────────────────
async function embedBatch(texts, dims, key) {
  const out = [];
  for (let i = 0; i < texts.length; i += 128) {
    const chunk = texts.slice(i, i + 128);
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, input: chunk, dimensions: dims }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const body = await r.json();
    // Sort by `index` — the API does not promise input order, and a silent
    // mis-pairing here would look like a quality result, not an error.
    out.push(...body.data.slice().sort((a, b) => a.index - b.index).map((d) => d.embedding));
    process.stderr.write(`    embedded ${Math.min(i + 128, texts.length)}/${texts.length}\r`);
  }
  process.stderr.write('                                        \r');
  return out;
}

const norm = (v) => { const m = Math.hypot(...v); return m ? v.map((x) => x / m) : v; };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// ── Scoring, mirroring tools/run-search-golden.cjs ─────────────────────────
const has = (list, frag) => list.some((t) => (t ?? '').toLowerCase().includes(frag.toLowerCase()));

function score(golden, titlesById, queryVecs, itemVecs, itemIds) {
  let recallSum = 0, n = 0, firstRankFails = 0;
  const perQuery = [];
  let qi = 0;
  for (const group of ['intent', 'names']) {
    for (const c of golden[group]) {
      const qv = queryVecs[qi++];
      const scored = itemIds
        .map((id, i) => ({ id, sim: dot(qv, itemVecs[i]) }))
        .filter((x) => x.sim >= MIN_SIMILARITY)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, MATCH_COUNT);
      const got = scored.map((x) => titlesById[x.id]).filter(Boolean);
      const hits = c.expect.filter((f) => has(got, f));
      const recall = c.expect.length ? hits.length / c.expect.length : 1;
      recallSum += recall; n++;
      let wrongFirst = false;
      if (c.mustNotRankFirst?.length && got[0]) {
        wrongFirst = c.mustNotRankFirst.some((f) => got[0].toLowerCase().includes(f.toLowerCase()));
        if (wrongFirst) firstRankFails++;
      }
      perQuery.push({
        group, q: c.q, hits: hits.length, of: c.expect.length, recall,
        returned: scored.length,
        topSim: scored[0]?.sim ?? 0,
        lowSim: scored[scored.length - 1]?.sim ?? 0,
        wrongFirst,
        missing: c.expect.filter((f) => !has(got, f)),
      });
    }
  }
  return { recall: recallSum / n, firstRankFails, perQuery };
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  const golden = JSON.parse(readFileSync(`${process.cwd()}/tools/search-golden.json`, 'utf8'));
  const profiles = loadProfiles();
  const curated = process.argv.includes('--no-curated') ? [] : loadCurated();
  console.log('loading catalog through the app\'s own loadCatalog…');
  const cat = loadCatalog();

  const titlesById = {};
  for (const i of cat.items) titlesById[i.id] = i.title;
  for (const a of cat.activities) titlesById[a.id] = a.title;

  const disc = discriminativeOnly(profiles, BOILERPLATE_CUTOFF);

  // ── Corpus report ────────────────────────────────────────────────────────
  const profiled = cat.items.filter((i) => profiles[i.id]).length;
  const distinct = new Set(cat.items.map((i) => profiles[i.id] ?? '')).size;
  console.log(`\n=== corpus ===`);
  console.log(`  catalog items (embedded)   ${cat.items.length}`);
  console.log(`  curated locals (embedded since 2026-08-15) ${curated.length} of ${cat.activities.length}`);
  console.log(`  items carrying a profile   ${profiled}`);
  console.log(`  DISTINCT profile strings   ${distinct}  <- the separating power of arm B`);
  console.log(`\n  lines dropped as boilerplate (>${Math.round(BOILERPLATE_CUTOFF * 100)}% of ${disc.total} profiles):`);
  for (const l of disc.dropped.sort((a, b) => disc.freq[b] - disc.freq[a])) {
    console.log(`    ${String(Math.round(100 * disc.freq[l] / disc.total)).padStart(3)}%  ${l}`);
  }
  const distinctC = new Set(cat.items.map((i) => disc.profiles[i.id] ?? '')).size;
  console.log(`  DISTINCT profile strings after the drop  ${distinctC}  <- arm C`);

  // ── Reachability: what CAN this golden set ever score? ────────────────────
  // A fragment that matches no embedded title is unreachable by semantic search
  // at any dimension count, with any text. It caps the achievable recall, and
  // scoring against 100% without knowing that cap invites tuning at a ceiling.
  console.log(`\n=== reachability (no key needed) ===`);
  // Curated entries are embedded since 2026-08-15, so their titles count.
  const curatedIds = new Set(curated.map((c) => c.id));
  const embeddedTitles = [
    ...cat.items.map((i) => i.title),
    ...cat.activities.filter((a) => curatedIds.has(a.id)).map((a) => a.title),
  ];
  let reachable = 0, totalFrags = 0, cappedRecall = 0, nq = 0;
  const unreachable = [];
  for (const group of ['intent', 'names']) {
    for (const c of golden[group]) {
      let r = 0;
      for (const f of c.expect) {
        totalFrags++;
        if (has(embeddedTitles, f)) { reachable++; r++; }
        else unreachable.push(`${f}  (query: "${c.q}")`);
      }
      cappedRecall += c.expect.length ? r / c.expect.length : 1; nq++;
    }
  }
  console.log(`  expected fragments reachable in the embedded corpus: ${reachable}/${totalFrags}`);
  console.log(`  CEILING on overall recall for this golden set: ${Math.round((100 * cappedRecall) / nq)}%`);
  if (unreachable.length) {
    console.log(`  unreachable — present in no embedded title:`);
    for (const u of unreachable) console.log(`    ${u}`);
    console.log(`  (the golden runner scores on TITLES, so a fragment naming a place a`);
    console.log(`   curated entry only MENTIONS — "savaneta" is in Zeerovers' location text,`);
    console.log(`   not its title — stays unscoreable even though it is now embedded.)`);
  }

  const key = readEnv('OPENAI_API_KEY');
  if (DRY || !key) {
    console.log(`\n=== sweep skipped ===`);
    console.log(DRY
      ? '  --dry given; no embeddings requested, nothing spent.'
      : '  No OPENAI_API_KEY in .env.local or the environment. Everything above is\n  offline; add a key to run the 3 text variants x 2 dimension counts below.');
    return;
  }

  // ── The sweep ────────────────────────────────────────────────────────────
  const queries = [...golden.intent, ...golden.names].map((c) => c.q);
  const itemIds = cat.items.map((i) => i.id);
  const ARMS = [
    { name: 'A  title + description (deployed today)', text: (i) => `${i.title}. ${i.description}`.slice(0, 500) },
    { name: 'B  + full suitability corpus', text: (i) => searchText(i.title, i.description, profiles[i.id] ?? '') },
    { name: 'C  + discriminative lines only', text: (i) => searchText(i.title, i.description, disc.profiles[i.id] ?? '') },
  ];
  const DIMS = [256, 1536];
  const only = (process.argv.find((a) => a.startsWith('--arms=')) || '').split('=')[1];
  const armList = only ? ARMS.filter((a) => only.split(',').includes(a.name[0])) : ARMS;
  const dimsOnly = (process.argv.find((a) => a.startsWith('--dims=')) || '').split('=')[1];
  const dimList = dimsOnly ? dimsOnly.split(',').map(Number) : DIMS;

  const results = [];
  const itemIdsAll = [...itemIds, ...curated.map((c) => c.id)];
  for (const arm of armList) {
    const texts = [...cat.items.map(arm.text), ...curated.map((c) => c.text)];
    for (const dims of dimList) {
      console.log(`\nembedding: ${arm.name} @ ${dims}d`);
      const itemVecs = (await embedBatch(texts, dims, key)).map(norm);
      const queryVecs = (await embedBatch(queries, dims, key)).map(norm);
      const s = score(golden, titlesById, queryVecs, itemVecs, itemIdsAll);
      results.push({ arm: arm.name, dims, ...s });
      console.log(`  overall recall ${Math.round(100 * s.recall)}%   wrong-first ${s.firstRankFails}`);
    }
  }

  // ── Table ────────────────────────────────────────────────────────────────
  console.log(`\n=== sweep ===`);
  console.log(`  ${'arm'.padEnd(42)} ${dimList.map((d)=>(d+'d').padStart(7)).join('')}`);
  for (const arm of armList) {
    const r = dimList.map((d) => results.find((x) => x.arm === arm.name && x.dims === d));
    console.log(`  ${arm.name.padEnd(42)} ${r.map((x)=>(Math.round(100*x.recall)+'%').padStart(7)).join('')}`);
  }
  console.log(`\n  ceiling for this golden set: ${Math.round((100 * cappedRecall) / nq)}%  (reachability, above)`);

  // ── The diagnostic the score alone cannot give ───────────────────────────
  // The dimensionality hypothesis predicts SEPARATION, not just recall: if 256d
  // is cramped, 1536d should spread a weak query's scores apart. If the text is
  // the problem, the band stays flat and low at every dimension count.
  console.log(`\n=== score spread on the queries that fail (the dimensionality test) ===`);
  console.log(`  A flat band just above the 0.20 floor means the concept is absent from`);
  console.log(`  the text. A widening band at 1536d means the space was cramped.`);
  for (const r of results) {
    const weak = r.perQuery.filter((q) => q.recall < 0.5);
    if (!weak.length) { console.log(`  ${r.arm} @ ${r.dims}d — no failing queries`); continue; }
    const avgTop = weak.reduce((s, q) => s + q.topSim, 0) / weak.length;
    const avgLow = weak.reduce((s, q) => s + q.lowSim, 0) / weak.length;
    console.log(`  ${r.arm.padEnd(42)} @${String(r.dims).padStart(5)}d  ${weak.length} failing, band ${avgLow.toFixed(3)}–${avgTop.toFixed(3)} (spread ${(avgTop - avgLow).toFixed(3)})`);
  }
})();
