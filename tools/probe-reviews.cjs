/**
 * Viator review-breakdown probe — measures, then proposes a snapshot.
 *
 * WHAT IT COLLECTS, and why it has to be a separate offline pass:
 *
 *   The catalog is built from /products/search, which already returns the full
 *   `description` (the Overview) and a per-provider rating summary. What it does
 *   NOT return is `reviews.sources[].reviewCounts` — the 1★…5★ histogram. That
 *   only appears on /products/{product-code}, one call per product.
 *
 *   328 sequential detail calls take over a minute, which is why this does not
 *   live inside the `viator-cards` ingest: an edge function on a cache miss has
 *   a traveller waiting on it. Run offline, commit the result, and the cost per
 *   visitor is zero no matter how many visitors there are.
 *
 * WHAT IT CANNOT COLLECT: the review TEXT. /reviews/product returns 403
 * FORBIDDEN on Basic access (verified 2026-08-14). Showing what people wrote
 * needs a Full Access application, and scraping the public page instead would be
 * fragile, cacheable only by us, and a licensing question rather than a
 * technical one. The histogram is the honest substitute: it shows the SPREAD,
 * which is the thing an average hides.
 *
 *   node tools/probe-reviews.cjs [--limit N] [--concurrency N]
 *
 * Writes docs/map/viator-reviews.json (evidence, every field kept) and
 * src/data/reviewBreakdown.json (the display-facing subset). A human reads the
 * numbers and commits. Needs VIATOR_API_KEY in .env.local.
 */
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

const env = (f) => { try { return readFileSync(`${process.cwd()}/${f}`, 'utf8'); } catch { return ''; } };
const read = (raw, k) => (raw.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() ?? '';

const prod = env('.env.production');
const local = env('.env.local');
const KEY = process.env.VIATOR_API_KEY || read(local, 'VIATOR_API_KEY') || read(local, 'VIATOR_API_KEY_PRODUCTION');
const CATALOG = read(prod, 'VITE_VIATOR_FN_URL');
const ANON = read(prod, 'VITE_SUPABASE_ANON_KEY');

if (!KEY) { console.error('VIATOR_API_KEY not set (.env.local or environment).'); process.exit(1); }
if (!CATALOG || !ANON) { console.error('Need VITE_VIATOR_FN_URL + VITE_SUPABASE_ANON_KEY in .env.production.'); process.exit(1); }

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const LIMIT = Number(arg('limit') ?? '0') || 0;
const CONCURRENCY = Number(arg('concurrency') ?? '4') || 4;

const H = { 'exp-api-key': KEY, Accept: 'application/json;version=2.0', 'Accept-Language': 'en-US' };

async function detail(code) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://api.viator.com/partner/products/${encodeURIComponent(code)}`, { headers: H });
    if (r.status === 429 || r.status >= 500) {
      await r.text();
      await new Promise((s) => setTimeout(s, 500 * 2 ** attempt));
      continue;
    }
    if (!r.ok) { await r.text(); return { status: r.status, body: null }; }
    return { status: r.status, body: await r.json() };
  }
  return { status: 429, body: null };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); }
  }));
  return out;
}

(async () => {
  const cr = await fetch(CATALOG, { headers: { Authorization: `Bearer ${ANON}`, apikey: ANON } });
  const cat = await cr.json();
  let items = cat.items ?? [];
  if (LIMIT > 0) items = items.slice(0, LIMIT);
  console.log(`probing ${items.length} products at concurrency ${CONCURRENCY}…\n`);

  let denied = 0, done = 0;
  const rows = await pool(items, CONCURRENCY, async (it) => {
    if (denied >= 5) return { id: it.id, status: 403, sources: [], overview: '' };
    const { status, body } = await detail(it.id);
    if (status === 401 || status === 403) denied++;
    if (++done % 40 === 0) console.log(`  …${done}/${items.length}`);
    const sources = (body?.reviews?.sources ?? []).map((s) => ({
      provider: s.provider,
      total: s.totalCount ?? 0,
      average: s.averageRating ?? null,
      // 1..5 → count. Absent providers simply have none.
      counts: Object.fromEntries((s.reviewCounts ?? []).map((c) => [c.rating, c.count])),
    }));
    return {
      id: it.id,
      status,
      title: it.title,
      sources,
      combined: body?.reviews?.combinedAverageRating ?? null,
      totalReviews: body?.reviews?.totalReviews ?? 0,
      // LENGTH not text. The Overview reaches the app through the catalog —
      // /products/search already returns it in full — so keeping 216KB of the
      // same prose in the evidence file would be a second copy that can drift
      // from the first. What the evidence is for is proving the API HAS it.
      overviewLen: (body?.description ?? '').trim().length,
      overviewHead: (body?.description ?? '').trim().slice(0, 120),
      // A SECOND supplier text, present on a minority of products and absent
      // from /products/search entirely — which is why the catalog cannot carry
      // it and this probe must. On 472918P1 the rendered Viator page shows THIS
      // and not `description`, which is how the mismatch was found: our card
      // was faithful to the API field the docs call the overview, and still did
      // not match the page. Where both exist they differ (2 of 2 sampled), so
      // they are complementary rather than duplicates.
      activityInfo: (body?.itinerary?.activityInfo?.description ?? '').trim(),
    };
  });

  if (denied >= 5) {
    console.error(`\n✋ ${denied}+ calls returned 401/403 — this key cannot read /products/{code}. Stopped early.`);
  }

  const ok = rows.filter((r) => r.status === 200);
  const withHist = ok.filter((r) => r.sources.some((s) => Object.keys(s.counts).length > 0));
  const withOverview = ok.filter((r) => r.overviewLen > 0);
  const lens = withOverview.map((r) => r.overviewLen).sort((a, b) => a - b);

  console.log('\n─── coverage ───────────────────────────────────────────────');
  console.log(`  probed                 ${rows.length}`);
  console.log(`  HTTP 200               ${ok.length}`);
  console.log(`  with a star histogram  ${withHist.length}`);
  console.log(`  with an Overview       ${withOverview.length}`);
  if (lens.length) {
    console.log(`  Overview length        min ${lens[0]}  median ${lens[Math.floor(lens.length / 2)]}  max ${lens[lens.length - 1]}`);
    console.log(`  …longer than the 200-char cap the catalog applies today: ${lens.filter((l) => l > 200).length}`);
  }

  const withExtra = ok.filter((r) => r.activityInfo.length > 0);
  console.log(`  with activityInfo text ${withExtra.length}  ← absent from /products/search, so only this probe can see it`);

  const providers = {};
  ok.forEach((r) => r.sources.forEach((s) => { providers[s.provider] = (providers[s.provider] ?? 0) + 1; }));
  console.log(`  providers seen         ${Object.entries(providers).map(([k, v]) => `${k}:${v}`).join('  ')}`);

  mkdirSync(dirname('docs/map/viator-reviews.json'), { recursive: true });
  writeFileSync('docs/map/viator-reviews.json', JSON.stringify({
    probedAt: new Date().toISOString(),
    counts: { probed: rows.length, ok: ok.length, withHistogram: withHist.length, withOverview: withOverview.length },
    products: rows,
  }, null, 2) + '\n');

  // Display subset: the HISTOGRAM only, and deliberately terse.
  //
  // Keys are one letter and counts are a bare 1..5 array because this ships in
  // the client bundle: the readable shape was 339KB, of which 216KB was Overview
  // prose that does not belong here at all — the catalog already carries it, for
  // free, on a request every visitor makes anyway. What is left is 28KB.
  //   p: provider, V(iator) | T(ripAdvisor)
  //   n: total reviews   a: average   c: [1★,2★,3★,4★,5★] counts
  const snapshot = {};
  for (const r of ok) {
    const sources = r.sources.filter((s) => s.total > 0);
    if (!sources.length) continue;
    snapshot[r.id] = sources.map((s) => ({
      p: s.provider === 'VIATOR' ? 'V' : s.provider === 'TRIPADVISOR' ? 'T' : s.provider,
      n: s.total,
      a: s.average,
      c: [1, 2, 3, 4, 5].map((k) => s.counts[k] ?? 0),
    }));
  }
  // No pretty-printing: this is bundled, and the indentation was 40% of it.
  writeFileSync('src/data/reviewBreakdown.json', JSON.stringify(snapshot) + '\n');

  // The extra Overview text, for the minority of products that have it. Kept in
  // its own file rather than folded into the histogram snapshot so that each is
  // regenerated, reviewed and reasoned about on its own terms.
  const extra = {};
  for (const r of ok) if (r.activityInfo) extra[r.id] = r.activityInfo;
  writeFileSync('src/data/overviewExtra.json', JSON.stringify(extra) + '\n');
  console.log(`Wrote src/data/overviewExtra.json (${Object.keys(extra).length} entries).`);
  console.log(`\nWrote docs/map/viator-reviews.json (evidence) and src/data/reviewBreakdown.json (${Object.keys(snapshot).length} entries).`);
  console.log('Nothing is wired into the app by this tool — read the numbers, then decide.');
})();
