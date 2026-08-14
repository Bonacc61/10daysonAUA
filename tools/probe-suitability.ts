/**
 * Viator suitability probe — measures, never ships.
 *
 * Answers one question before anyone builds on it: **does the catalog carry
 * enough structured suitability data to answer a query like "good with a
 * toddler", and in what vocabulary?**
 *
 * The problem it exists for. Semantic search embeds `${title}. ${description}`
 * (supabase/functions/viator-cards/index.ts). Almost none of that text mentions
 * who a product suits, so a suitability query lands in an empty region of the
 * vector space and the ranking is decided by whatever block of near-identical
 * listings is largest. Measured 2026-08-14 against the live function: "good
 * with toddler" returned 30 results scoring 0.294–0.374 that were only NINE
 * distinct experience clusters, mostly UTV rentals — against 0.621 for a query
 * with a real referent ("Baby Beach") and 0.250 for deliberate nonsense
 * ("quarterly tax filing software"). The result set sat nearer the nonsense
 * floor than a genuine match.
 *
 * Length is not the lever, and this was measured rather than assumed: the same
 * day, the ingest began shipping full descriptions instead of the
 * `/products/search` teaser (191 → 611 chars, zero truncated). Re-running the
 * query afterwards returned 25 of the same 30 ids in the same band, with FEWER
 * distinct clusters. Marketing copy describes what you do at any length; it
 * never says who it is for.
 *
 * `/products/{code}` carries the missing half — `additionalInfo`,
 * `pricingInfo.ageBands`, the untruncated Overview and a fixed duration. That
 * endpoint is in Basic access (CLAUDE.md, verified) but is one call per product,
 * which is why it cannot go in the ingest and why this writes a snapshot instead.
 *
 * What it measures, and why each number matters:
 *
 *  1. **Coverage** per field — a field present on 30% of the catalog is a
 *     ranking hint, not a filter.
 *  2. **The additionalInfo VOCABULARY, with frequencies.** Viator emits
 *     standardised sentences; this dumps every distinct one so predicates are
 *     written against strings that exist rather than strings we imagined.
 *  3. **Signal lift** — how many products' embedded text would mention age,
 *     children or accessibility before and after. That is the whole thesis.
 *  4. **Discrimination** — whether the derived signal actually separates the
 *     products the failing query returned from the ones its golden entry
 *     expects. A signal present on everything filters nothing.
 *
 * It writes docs/map/viator-suitability.json and prints a summary. Nothing is
 * wired into the app: the tool proposes, a human reads the numbers and decides.
 * Same contract as the start-time probe, the coordinate registry and the
 * enrichment snapshot.
 *
 * Run:  node tools/run-probe-suitability.cjs [--limit N] [--concurrency N]
 *                                            [--out PATH]
 *
 * Needs VIATOR_API_KEY (or VIATOR_API_KEY_PRODUCTION) in the environment. The
 * key never enters the repo, the client bundle, or CI.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCatalog } from '../src/data/activitySource';
import type { ViatorItem } from '../src/types';

const BASE = (process.env.VIATOR_BASE_URL ?? 'https://api.viator.com/partner').replace(/\/$/, '');
const KEY = (process.env.VIATOR_API_KEY_PRODUCTION ?? process.env.VIATOR_API_KEY ?? '').trim();

const argv = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LIMIT = Number(arg('limit') ?? '0') || 0;
const CONCURRENCY = Number(arg('concurrency') ?? '6') || 6;
const OUT = arg('out') ?? 'docs/map/viator-suitability.json';

type AgeBand = { ageBand?: string; startAge?: number; endAge?: number };
type Product = {
  description?: string;
  additionalInfo?: Array<{ description?: string }>;
  pricingInfo?: { ageBands?: AgeBand[] };
  bookingRequirements?: { requiresAdultForBooking?: boolean };
  itinerary?: { duration?: { fixedDurationInMinutes?: number } };
};

/**
 * The derived booleans a search filter would actually be built on.
 *
 * Every one is read from a Viator string or a Viator number — nothing here is
 * inferred, paraphrased or generated, so there is no hallucination surface. The
 * point of the probe is to find out which of them are worth trusting.
 */
type Suitability = {
  /** "Infants and small children can ride in a pram or stroller" — a genuine toddler yes. */
  strollerOk: boolean;
  /** "Infants must sit on laps" / "Infant seats available" — babies are contemplated. */
  infantSeating: boolean;
  wheelchairOk: boolean;
  serviceAnimals: boolean;
  /** "Suitable for all physical fitness levels" — the "no walking, we are tired" signal. */
  allFitness: boolean;
  /** "Travelers should have a good/moderate level of physical fitness". */
  needsFitness: boolean;
  /** "Minimum age is N years", parsed out of additionalInfo. */
  statedMinAge: number | null;
  /** Lowest startAge across bands. Beware: see `singleAdultBand`. */
  bandMinAge: number | null;
  /** A real CHILD or INFANT band exists — i.e. the operator prices for children. */
  childBand: boolean;
  /**
   * The catalog's most dangerous false friend. A product priced with ONE
   * ADULT 0-99 band reports bandMinAge 0 while being adults-only in practice;
   * four of the five UTV rentals at the top of the failing query do exactly
   * this. Age bands alone are NOT a toddler filter, and this flag is how the
   * snapshot says so out loud.
   */
  singleAdultBand: boolean;
  requiresAdult: boolean | null;
};

type Probe = {
  id: string;
  title: string;
  status: number;
  /** Chars of description the INGEST sees today (the truncated teaser). */
  shortLen: number;
  /** Chars of description /products/{code} returns. */
  fullLen: number;
  additionalInfo: string[];
  /** Raw, so the snapshot builder is a pure transform of this file rather than
   *  a second reading of the API. */
  ageBands: AgeBand[];
  durationMin: number | null;
  suitability: Suitability | null;
  /** Does the text embedded TODAY say anything about age/children/access? */
  signalToday: boolean;
  /** Would the text say something once additionalInfo + age bands are added? */
  signalAfter: boolean;
};

// The vocabulary this probe reads. Deliberately literal: these are Viator's own
// standardised sentences, matched loosely enough to survive punctuation drift
// and no looser. A pattern that guesses would defeat the purpose of measuring.
const RE = {
  stroller: /infants? and small children can ride in a (pram|stroller)|pram or stroller/i,
  // Viator writes this three ways, and the lap variant uses a CURLY apostrophe
  // ("an adult’s lap") — matched by stopping before it rather than by trying to
  // spell it. The smoke run found 1 of 6 with the naive pattern.
  infantSeat: /infants? (must sit on laps|are required to sit on an adult)|(specialized )?infant seats? (are )?available/i,
  wheelchair: /wheelchair accessible/i,
  serviceAnimal: /service animals? allowed/i,
  allFitness: /suitable for all physical fitness levels/i,
  needsFitness: /should have (at least )?an? (good|moderate|high) level of physical fitness/i,
  minAge: /minimum age (?:is|to [a-z ]+ is) (\d+)/i,
  // A DRINKING age is not a participation age. "Minimum age to consume
  // alcoholic drinks is 18 years old" would otherwise mark a family boat trip
  // as 18+, which is the exact class of false exclusion that makes a filter
  // worse than no filter.
  alcoholAge: /alcohol|drink/i,
};

// What counts as "this text says something about who it suits". Used for the
// before/after lift, so it is applied to the SAME question on both sides.
const SIGNAL_RE = /\b(toddler|infant|baby|babies|child|children|kid|kids|age[ds]?|family|families|wheelchair|stroller|pram|accessible|fitness|mobility)\b/i;

function suitabilityOf(p: Product): Suitability {
  const info = (p.additionalInfo ?? []).map((a) => a.description ?? '');
  const joined = info.join(' • ');
  const bands = p.pricingInfo?.ageBands ?? [];
  const starts = bands.map((b) => b.startAge).filter((n): n is number => typeof n === 'number');
  // Per-sentence, so an alcohol clause disqualifies only itself rather than
  // suppressing a real minimum age stated elsewhere in the same product.
  const ageSentence = info.find((s) => RE.minAge.test(s) && !RE.alcoholAge.test(s));
  const minAgeMatch = ageSentence ? ageSentence.match(RE.minAge) : null;

  return {
    strollerOk: RE.stroller.test(joined),
    infantSeating: RE.infantSeat.test(joined),
    wheelchairOk: RE.wheelchair.test(joined),
    serviceAnimals: RE.serviceAnimal.test(joined),
    allFitness: RE.allFitness.test(joined),
    needsFitness: RE.needsFitness.test(joined),
    statedMinAge: minAgeMatch ? Number(minAgeMatch[1]) : null,
    bandMinAge: starts.length ? Math.min(...starts) : null,
    childBand: bands.some((b) => b.ageBand === 'CHILD' || b.ageBand === 'INFANT'),
    singleAdultBand: bands.length === 1 && bands[0]?.ageBand === 'ADULT',
    requiresAdult: p.bookingRequirements?.requiresAdultForBooking ?? null,
  };
}

async function fetchProduct(code: string): Promise<{ status: number; body: Product | null }> {
  // Retry only on 429 and 5xx, with a widening backoff. Anything else is a real
  // answer — including 403, which would be the tier verdict.
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${BASE}/products/${encodeURIComponent(code)}`, {
      headers: {
        'exp-api-key': KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US',
      },
    });
    if (r.status === 429 || r.status >= 500) {
      await r.text();
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
      continue;
    }
    if (!r.ok) { await r.text(); return { status: r.status, body: null }; }
    return { status: r.status, body: (await r.json()) as Product };
  }
  return { status: 429, body: null };
}

/** Run `jobs` with a fixed worker pool, preserving input order in the output. */
async function pool<T, R>(jobs: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await fn(jobs[i], i);
    }
  }));
  return out;
}

async function main() {
  if (!KEY) {
    console.error('VIATOR_API_KEY is not set. This probe needs a Viator Partner API key.');
    console.error('It is a Supabase secret in production; export a dev key to run this locally.');
    process.exit(1);
  }

  const catalog = await loadCatalog();
  let items: ViatorItem[] = catalog.items;
  if (items.length < 50) {
    console.error(`Only ${items.length} items — this is the offline stub, not the live catalog.`);
    console.error('Run from the repo root so .env.production is picked up.');
    process.exit(1);
  }
  if (LIMIT > 0) items = items.slice(0, LIMIT);

  console.log(`Probing ${items.length} products at concurrency ${CONCURRENCY}…\n`);

  let denied = 0;
  let done = 0;
  const results = await pool(items, CONCURRENCY, async (item): Promise<Probe> => {
    const shortLen = (item.description ?? '').length;
    const blank: Probe = {
      id: item.id, title: item.title, status: 403, shortLen, fullLen: 0,
      additionalInfo: [], ageBands: [], durationMin: null, suitability: null,
      signalToday: SIGNAL_RE.test(`${item.title}. ${item.description ?? ''}`),
      signalAfter: false,
    };
    // Stop burning requests once it is clear the key cannot see this endpoint.
    if (denied >= 5) return blank;

    const { status, body } = await fetchProduct(item.id);
    if (status === 403 || status === 401) denied++;
    if (++done % 25 === 0) console.log(`  …${done}/${items.length}`);
    if (!body) return { ...blank, status };

    const info = (body.additionalInfo ?? []).map((a) => (a.description ?? '').trim()).filter(Boolean);
    const suit = suitabilityOf(body);
    // The "after" text is what the design proposes to embed: title + the FULL
    // description + the suitability lines + an age sentence.
    const after = [
      item.title, body.description ?? '', info.join(' '),
      suit.childBand ? 'Children welcome.' : '', suit.statedMinAge ? `Minimum age ${suit.statedMinAge}.` : '',
    ].join(' ');

    return {
      id: item.id,
      title: item.title,
      status,
      shortLen,
      fullLen: (body.description ?? '').length,
      additionalInfo: info,
      ageBands: body.pricingInfo?.ageBands ?? [],
      durationMin: body.itinerary?.duration?.fixedDurationInMinutes ?? null,
      suitability: suit,
      signalToday: blank.signalToday,
      signalAfter: SIGNAL_RE.test(after),
    };
  });

  if (denied >= 5) {
    console.error(`\n✋ ${denied}+ calls returned 401/403 — this key cannot read /products/{code}.`);
    console.error('   Stopped early rather than issuing the rest of the requests.\n');
  }

  // --- Summary -------------------------------------------------------------
  const ok = results.filter((r) => r.status === 200);
  const n = ok.length;
  const pct = (x: number) => `${((x / n) * 100).toFixed(0)}%`;
  const count = (f: (s: Suitability) => boolean) => ok.filter((r) => r.suitability && f(r.suitability)).length;

  console.log('\n─── Coverage ─────────────────────────────────────────────');
  console.log(`  products probed            ${results.length}`);
  console.log(`  returned 200               ${n}  (${pct(n)})`);
  console.log(`  has additionalInfo         ${ok.filter((r) => r.additionalInfo.length > 0).length}  (${pct(ok.filter((r) => r.additionalInfo.length > 0).length)})`);
  console.log(`  has age bands              ${count((s) => s.bandMinAge !== null)}  (${pct(count((s) => s.bandMinAge !== null))})`);
  console.log(`  has fixed duration         ${ok.filter((r) => r.durationMin !== null).length}  (${pct(ok.filter((r) => r.durationMin !== null).length)})`);

  const avg = (f: (r: Probe) => number) => (ok.reduce((a, r) => a + f(r), 0) / n).toFixed(0);
  console.log(`  description chars          ${avg((r) => r.shortLen)} today → ${avg((r) => r.fullLen)} from /products/{code}`);

  console.log('\n─── Derived suitability signals ──────────────────────────');
  console.log(`  "pram or stroller"         ${count((s) => s.strollerOk)}  (${pct(count((s) => s.strollerOk))})`);
  console.log(`  infant seating mentioned   ${count((s) => s.infantSeating)}  (${pct(count((s) => s.infantSeating))})`);
  console.log(`  wheelchair accessible      ${count((s) => s.wheelchairOk)}  (${pct(count((s) => s.wheelchairOk))})`);
  console.log(`  service animals allowed    ${count((s) => s.serviceAnimals)}  (${pct(count((s) => s.serviceAnimals))})`);
  console.log(`  all fitness levels         ${count((s) => s.allFitness)}  (${pct(count((s) => s.allFitness))})`);
  console.log(`  needs a fitness level      ${count((s) => s.needsFitness)}  (${pct(count((s) => s.needsFitness))})`);
  console.log(`  states a minimum age       ${count((s) => s.statedMinAge !== null)}  (${pct(count((s) => s.statedMinAge !== null))})`);
  console.log(`  real CHILD/INFANT band     ${count((s) => s.childBand)}  (${pct(count((s) => s.childBand))})`);
  console.log(`  single ADULT 0-99 band     ${count((s) => s.singleAdultBand)}  (${pct(count((s) => s.singleAdultBand))})  ← age bands lie here`);

  console.log('\n─── Signal lift (the thesis) ─────────────────────────────');
  const today = ok.filter((r) => r.signalToday).length;
  const after = ok.filter((r) => r.signalAfter).length;
  console.log(`  embedded text mentions age/children/access TODAY   ${today}  (${pct(today)})`);
  console.log(`  …with additionalInfo + age bands appended          ${after}  (${pct(after)})`);

  // --- The vocabulary, with frequencies ------------------------------------
  // The most useful output: predicates should be written against strings that
  // exist. Anything appearing once is an operator's free text, not a facet.
  const freq = new Map<string, number>();
  for (const r of ok) for (const s of r.additionalInfo) freq.set(s, (freq.get(s) ?? 0) + 1);
  const vocab = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const standard = vocab.filter(([, c]) => c >= 5);
  console.log('\n─── additionalInfo vocabulary ────────────────────────────');
  console.log(`  ${vocab.length} distinct strings; ${standard.length} used by 5+ products (the facet-shaped ones)`);
  for (const [s, c] of standard.slice(0, 25)) {
    console.log(`   ${String(c).padStart(4)}  ${s.slice(0, 66)}`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    probedAt: new Date().toISOString(),
    base: BASE,
    counts: {
      probed: results.length, ok: n,
      withAdditionalInfo: ok.filter((r) => r.additionalInfo.length > 0).length,
      withAgeBands: count((s) => s.bandMinAge !== null),
      withDuration: ok.filter((r) => r.durationMin !== null).length,
      strollerOk: count((s) => s.strollerOk),
      infantSeating: count((s) => s.infantSeating),
      wheelchairOk: count((s) => s.wheelchairOk),
      serviceAnimals: count((s) => s.serviceAnimals),
      allFitness: count((s) => s.allFitness),
      needsFitness: count((s) => s.needsFitness),
      statedMinAge: count((s) => s.statedMinAge !== null),
      childBand: count((s) => s.childBand),
      singleAdultBand: count((s) => s.singleAdultBand),
      signalToday: today, signalAfter: after,
    },
    vocabulary: vocab.map(([text, products]) => ({ text, products })),
    products: results,
  }, null, 2) + '\n');
  console.log(`\nWrote ${OUT} — read it, then decide. Nothing is wired into the app.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
