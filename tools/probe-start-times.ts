/**
 * Viator start-time probe — measures, never ships.
 *
 * Answers one question before anyone builds on it: how many of our catalog's
 * products actually publish a start time, and how many of those would yield a
 * SLOT CONSTRAINT the generator could act on.
 *
 * Today the engine reads time-of-day for a Viator product from its TITLE alone.
 * On the live catalog that leaves 295 of 366 items with no signal at all, so
 * they are placed morning-or-afternoon arbitrarily — which is why a 09:00
 * walking tour gets suggested for an afternoon. See ROADMAP items 10 and 11.
 *
 * This runs against `/availability/schedules/{product-code}`, which Viator's
 * docs place in BASIC access — the tier we already use for /products/search and
 * /products/{code}. If that is wrong for our key, every call returns 403 and
 * this script says so loudly and stops rather than burning 366 requests.
 *
 * It writes docs/map/viator-start-times.json and prints a summary. Nothing is
 * wired into the app: the tool proposes, a human reads the numbers and decides.
 * Same contract as the coordinate registry and the enrichment snapshot.
 *
 * Run:  node tools/run-probe-start-times.cjs [--limit N] [--concurrency N]
 *                                            [--cutoff HH:MM] [--out PATH]
 *
 * Needs VIATOR_API_KEY (or VIATOR_API_KEY_PRODUCTION) in the environment. The
 * key never enters the repo, the client bundle, or CI.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCatalog } from '../src/data/activitySource';
import { titleTimeOfDay, isEveningItem } from '../src/data/itemFit';
import type { ViatorItem } from '../src/types';

const BASE = (process.env.VIATOR_BASE_URL ?? 'https://api.viator.com/partner').replace(/\/$/, '');
const KEY = (process.env.VIATOR_API_KEY_PRODUCTION ?? process.env.VIATOR_API_KEY ?? '').trim();

const argv = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LIMIT = Number(arg('limit') ?? '0') || 0;
const CONCURRENCY = Number(arg('concurrency') ?? '4') || 4;
const OUT = arg('out') ?? 'docs/map/viator-start-times.json';
// Noon by default. Deliberately a knob: the whole point of the probe is to see
// how the buckets move, and a cutoff chosen before the data is a guess.
const CUTOFF = arg('cutoff') ?? '12:00';

// Viator nests start times three levels down, per SEASON and per DAY OF WEEK.
// A product therefore has a SET of start times, not one — modelling it as a
// single value is the trap this shape exists to make visible.
type Schedule = {
  productCode?: string;
  bookableItems?: Array<{
    productOptionCode?: string;
    seasons?: Array<{
      startDate?: string;
      endDate?: string;
      pricingRecords?: Array<{
        daysOfWeek?: string[];
        timedEntries?: Array<{ startTime?: string; unavailableDates?: unknown[] }>;
      }>;
    }>;
  }>;
};

type Probe = {
  id: string;
  title: string;
  /** HTTP status of the schedules call. */
  status: number;
  /** Distinct start times, "HH:MM", sorted. Empty when the product is untimed. */
  startTimes: string[];
  /** How many (season × pricingRecord) blocks contributed — >1 means it varies. */
  blocks: number;
  /** What the ENGINE currently believes, for comparison. */
  titleSignal: 'morning' | 'afternoon' | 'evening' | 'none';
  /** What the start times would license: a real constraint, or nothing. */
  verdict: 'morning-only' | 'afternoon-only' | 'spans-cutoff' | 'untimed' | 'error';
};

const minutes = (hhmm: string): number => {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

function collectStartTimes(s: Schedule): { times: string[]; blocks: number } {
  const set = new Set<string>();
  let blocks = 0;
  for (const item of s.bookableItems ?? []) {
    for (const season of item.seasons ?? []) {
      for (const rec of season.pricingRecords ?? []) {
        blocks++;
        for (const t of rec.timedEntries ?? []) {
          const raw = (t.startTime ?? '').trim();
          if (!raw) continue;
          // Normalise "9:00" and "09:00:00" to "09:00" so the set dedupes.
          const m = raw.match(/^(\d{1,2}):(\d{2})/);
          if (m) set.add(`${m[1].padStart(2, '0')}:${m[2]}`);
        }
      }
    }
  }
  return { times: [...set].sort(), blocks };
}

function verdictFor(times: string[], cutoffMin: number): Probe['verdict'] {
  if (times.length === 0) return 'untimed';
  const mins = times.map(minutes).filter((n) => !Number.isNaN(n));
  if (mins.length === 0) return 'untimed';
  if (mins.every((m) => m < cutoffMin)) return 'morning-only';
  if (mins.every((m) => m >= cutoffMin)) return 'afternoon-only';
  return 'spans-cutoff';
}

function titleSignalFor(item: ViatorItem): Probe['titleSignal'] {
  if (isEveningItem(item)) return 'evening';
  return titleTimeOfDay(item) ?? 'none';
}

async function fetchSchedule(code: string): Promise<{ status: number; body: Schedule | null }> {
  const url = `${BASE}/availability/schedules/${encodeURIComponent(code)}`;
  // Retry only on 429 and 5xx, with a widening backoff. Anything else is a
  // real answer — including 403, which is the tier verdict we came for.
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, {
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
    return { status: r.status, body: (await r.json()) as Schedule };
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
  let items = catalog.items;
  if (items.length < 50) {
    console.error(`Only ${items.length} items — this is the offline stub, not the live catalog.`);
    console.error('Run from the repo root so .env.production is picked up.');
    process.exit(1);
  }
  if (LIMIT > 0) items = items.slice(0, LIMIT);

  const cutoffMin = minutes(CUTOFF);
  if (Number.isNaN(cutoffMin)) { console.error(`--cutoff must be HH:MM, got "${CUTOFF}"`); process.exit(1); }

  console.log(`Probing ${items.length} products at concurrency ${CONCURRENCY}, cutoff ${CUTOFF}…\n`);

  let denied = 0;
  let done = 0;
  const results = await pool(items, CONCURRENCY, async (item) => {
    // Stop burning requests once it is clear the key cannot see this endpoint.
    if (denied >= 5) return { id: item.id, title: item.title, status: 403, startTimes: [], blocks: 0, titleSignal: titleSignalFor(item), verdict: 'error' } as Probe;

    const { status, body } = await fetchSchedule(item.id);
    if (status === 403 || status === 401) denied++;
    const { times, blocks } = body ? collectStartTimes(body) : { times: [], blocks: 0 };
    if (++done % 25 === 0) console.log(`  …${done}/${items.length}`);
    return {
      id: item.id,
      title: item.title,
      status,
      startTimes: times,
      blocks,
      titleSignal: titleSignalFor(item),
      verdict: status === 200 ? verdictFor(times, cutoffMin) : 'error',
    } as Probe;
  });

  if (denied >= 5) {
    console.error(`\n✋ ${denied}+ calls returned 401/403 — this key cannot read /availability/schedules.`);
    console.error('   That is the tier answer: ROADMAP item 11 needs a Full Access application first.');
    console.error('   Stopped early rather than issuing the rest of the requests.\n');
  }

  // --- Summary -------------------------------------------------------------
  const n = results.length;
  const by = (v: Probe['verdict']) => results.filter((r) => r.verdict === v).length;
  const ok = results.filter((r) => r.status === 200);
  const timed = ok.filter((r) => r.startTimes.length > 0);
  const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;

  console.log('\n─── Coverage ─────────────────────────────────────────────');
  console.log(`  products probed          ${n}`);
  console.log(`  schedules returned 200   ${ok.length}  (${pct(ok.length)})`);
  console.log(`  …with ≥1 start time      ${timed.length}  (${pct(timed.length)})`);
  console.log(`  …untimed (open ticket)   ${by('untimed')}`);
  console.log(`  errors / denied          ${by('error')}`);

  console.log('\n─── Would it constrain the slot? ─────────────────────────');
  console.log(`  morning-only  (all < ${CUTOFF})   ${by('morning-only')}  (${pct(by('morning-only'))})`);
  console.log(`  afternoon-only (all ≥ ${CUTOFF})  ${by('afternoon-only')}  (${pct(by('afternoon-only'))})`);
  console.log(`  spans the cutoff — no constraint  ${by('spans-cutoff')}  (${pct(by('spans-cutoff'))})`);

  const multi = timed.filter((r) => r.startTimes.length > 1).length;
  const varies = timed.filter((r) => r.blocks > 1).length;
  console.log('\n─── Shape of the data ────────────────────────────────────');
  console.log(`  more than one start time  ${multi} of ${timed.length} timed products`);
  console.log(`  more than one season/DOW block  ${varies}  (a set, not a value)`);

  // What this would actually FIX: products the engine currently slots blind.
  const blind = results.filter((r) => r.titleSignal === 'none');
  const rescued = blind.filter((r) => r.verdict === 'morning-only' || r.verdict === 'afternoon-only');
  console.log('\n─── Against today\'s title-only heuristic ─────────────────');
  console.log(`  no title signal today     ${blind.length}`);
  console.log(`  …of those, constrained by start times  ${rescued.length}`);
  const contradicts = results.filter((r) =>
    (r.titleSignal === 'morning' && r.verdict === 'afternoon-only')
    || (r.titleSignal === 'afternoon' && r.verdict === 'morning-only'));
  console.log(`  titles CONTRADICTED by the schedule    ${contradicts.length}`);
  for (const c of contradicts.slice(0, 10)) {
    console.log(`      ${c.id}  "${c.title.slice(0, 46)}"  title=${c.titleSignal} times=${c.startTimes.join(',')}`);
  }

  const walk = results.find((r) => r.id === '62666P1');
  if (walk) {
    console.log('\n─── The product that started this ────────────────────────');
    console.log(`  62666P1  "${walk.title}"`);
    console.log(`  status ${walk.status}  startTimes=[${walk.startTimes.join(', ')}]  verdict=${walk.verdict}`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    probedAt: new Date().toISOString(),
    base: BASE,
    cutoff: CUTOFF,
    counts: {
      probed: n, ok: ok.length, timed: timed.length,
      morningOnly: by('morning-only'), afternoonOnly: by('afternoon-only'),
      spansCutoff: by('spans-cutoff'), untimed: by('untimed'), error: by('error'),
      blindToday: blind.length, rescued: rescued.length, titleContradicted: contradicts.length,
    },
    products: results,
  }, null, 2) + '\n');
  console.log(`\nWrote ${OUT} — read it, then decide. Nothing is wired into the app.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
