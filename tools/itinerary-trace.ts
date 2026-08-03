/**
 * Itinerary trace — makes the matching engine narrate its own decisions.
 *
 * The engine discards candidates for five reported reasons and keeps no record,
 * so "why did two jeep safaris land on consecutive days?" normally means reading
 * 1000 lines of generator. This runs a real generatePlan with the `onTrace`
 * callback and prints, per slot, which fill-ladder rung fired and why every
 * other candidate lost.
 *
 * Run via the /itinerary-trace skill, or directly:
 *   npx esbuild tools/itinerary-trace.ts --bundle --platform=node --format=esm \
 *     --define:import.meta.env='{}' --outfile=/tmp/trace.mjs && node /tmp/trace.mjs
 */
import { generatePlan, type TraceEvent } from '../src/data/itineraryGenerator';
import { getCatalog, loadCatalog } from '../src/data/activitySource';
import type { Catalog } from '../src/data/activitySource';
import type { Answers } from '../src/App';
import type { Slot } from '../src/types';

const SLOTS: Slot[] = ['morning', 'afternoon', 'evening'];

const BASE: Answers = {
  days: 7, groupType: '', budget: '', interests: [], adventureLevel: 50,
  startOffset: 7, lodging: '', flags: [], specialNotes: '',
};

// Deliberately spread across the answer space — the personas whose plans diverge
// most are the ones that expose dedup and fill-ladder edges.
const PERSONAS: Record<string, Answers> = {
  default: BASE,
  foodie: { ...BASE, interests: ['Food & drink', 'Culture & history'], budget: 'Budget-conscious', adventureLevel: 10, groupType: 'Couple' },
  adventurer: { ...BASE, interests: ['Adventure & adrenaline', 'Water sports'], budget: 'Mid-range', adventureLevel: 95, groupType: 'Friends' },
  splurge: { ...BASE, interests: ['Water sports'], budget: 'Money no object', adventureLevel: 60, groupType: 'Couple' },
  family: { ...BASE, interests: ['Beaches & relaxation'], budget: 'Mid-range', adventureLevel: 25, groupType: 'Family with kids', flags: ['no-early-mornings'] },
};

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

const personaName = arg('persona') ?? 'default';
const persona = PERSONAS[personaName];
if (!persona) {
  console.error(`unknown persona "${personaName}". known: ${Object.keys(PERSONAS).join(', ')}`);
  process.exit(1);
}
const days = Number(arg('days') ?? persona.days);
const seed = Number(arg('seed') ?? 0);
const pinned = arg('pinned')?.split(',').filter(Boolean);
const dayFilter = arg('day') ? Number(arg('day')) : undefined;
const slotFilter = arg('slot') as Slot | undefined;
const why = arg('why')?.toLowerCase();      // trace one candidate across the trip
const onlyOpen = has('only-open');          // just the slots that ended empty
const verbose = has('verbose');             // list every rejection, not the top 3 per reason

// ---- catalog --------------------------------------------------------------
// Goes through the app's real loadCatalog(), NOT a hand-rolled fetch of the
// edge function. The raw payload is ~362 items; the app's catalog is ~334 after
// isTransportOnly, regroupItems and normalizePopularity. Tracing the raw payload
// would rank differently from the app this tool exists to explain — and the
// popularity bonus in itemFit would be inert because popularity_score is only
// assigned at load. Run via `npm run trace` so the env is baked in.
async function resolveCatalog(): Promise<{ catalog: Catalog; live: boolean }> {
  if (has('offline')) return { catalog: getCatalog(), live: false };
  const cat = await loadCatalog();          // silently returns the stub on failure
  const stub = getCatalog();
  return { catalog: cat, live: cat.items.length !== stub.items.length };
}

// ---- formatting -----------------------------------------------------------
const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

const REASON_LABEL: Record<string, string> = {
  'already-placed': 'already placed',
  'similar-to-placed': 'duplicate experience',
  'day-time-budget': 'day time budget',
  'same-kind-today': 'same kind today',
  'over-budget': 'over budget',
};

async function main() {
  const { catalog, live: isLive } = await resolveCatalog();
  const size = `${catalog.groups.length} groups, ${catalog.items.length} items`;
  // The stub carries no Viator tags and no cluster ids, so cluster dedup, tag
  // Jaccard and route-family retirement are all inert on it. Say so — a trace
  // read as "live" when it is not will send you chasing the wrong rule.
  const source = isLive
    ? `live (${size})`
    : `offline stub (${size}) — no live catalog\n`
      + `         NOTE: the stub has no tags or cluster ids, so cluster dedup, tag\n`
      + `         Jaccard and route-family retirement do not fire in this trace.`;

  const events: TraceEvent[] = [];
  const answers: Answers = { ...persona, days };
  const plan = generatePlan(answers, catalog, { seed, pinned, onTrace: (e) => events.push(e) });

  console.log(`\nItinerary trace — persona "${personaName}", ${days} days, seed ${seed}`);
  console.log(`catalog: ${source}`);
  if (pinned?.length) console.log(`pinned: ${pinned.join(', ')}`);

  // --why: one candidate's fate across the whole trip. Answers "I expected X —
  // where did it go?" without reading the full trace.
  if (why) {
    console.log(`\nTracking candidates matching "${why}":\n`);
    let hits = 0;
    for (const ev of events) {
      if (ev.type !== 'slot') continue;
      if (ev.picked && ev.picked.title.toLowerCase().includes(why)) {
        console.log(`  day ${ev.day} ${pad(ev.slot, 10)} PICKED   ${ev.picked.title}  [${ev.tier}]`);
        hits += 1;
      }
      for (const r of ev.rejections) {
        if (!r.title.toLowerCase().includes(why) && !r.id.toLowerCase().includes(why)) continue;
        console.log(`  day ${ev.day} ${pad(ev.slot, 10)} rejected ${pad(r.title, 44)} ${REASON_LABEL[r.reason]}${r.detail ? ` — ${r.detail}` : ''}`);
        hits += 1;
      }
    }
    if (!hits) console.log('  no candidate matched — it was filtered before the ladder (slot, flags, budget tier, the champion pool, or isAutoFillExcluded).');
    console.log();
    return;
  }

  for (let d = 1; d <= days; d += 1) {
    if (dayFilter && d !== dayFilter) continue;
    const dayEvents = events.filter((e) => e.day === d);
    const openSlots = dayEvents.filter((e) => e.type === 'slot' && !e.picked).length;
    if (onlyOpen && openSlots === 0) continue;

    console.log(`\nDay ${d} — ${plan[d - 1]?.title ?? ''}`);
    for (const slot of SLOTS) {
      if (slotFilter && slot !== slotFilter) continue;
      const ev = dayEvents.find((e) => e.slot === slot);
      if (!ev) continue;

      if (ev.type === 'skipped') {
        console.log(`  ${pad(slot, 10)} —  skipped (${ev.reason})`);
        continue;
      }
      if (ev.type === 'preplaced') {
        console.log(`  ${pad(slot, 10)} ▣  ${pad(ev.title, 46)} pre-placed (${ev.source})`);
        continue;
      }
      if (onlyOpen && ev.picked) continue;

      const head = ev.picked
        ? `✓  ${pad(ev.picked.title, 46)} $${ev.picked.price}`
        : `✗  ${pad('(slot left open)', 46)}`;
      const meta = `pool ${ev.matched}/${ev.widened}, survivors ${ev.survivors}`
        + (ev.tier ? `, rung ${ev.tier}` : '')
        + (ev.relaxedKind ? ', variety gate relaxed' : '')
        + (ev.maxPrice === 0 ? ', free-only day' : '');
      console.log(`  ${pad(slot, 10)} ${head}  ${meta}`);

      // Group rejections by reason: the count is usually the answer, the
      // examples tell you which rule to go look at.
      const byReason = new Map<string, typeof ev.rejections>();
      for (const r of ev.rejections) {
        if (!byReason.has(r.reason)) byReason.set(r.reason, []);
        byReason.get(r.reason)!.push(r);
      }
      for (const [reason, list] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`      ${pad(REASON_LABEL[reason] ?? reason, 22)} ${String(list.length).padStart(3)}`);
        for (const r of verbose ? list : list.slice(0, 3)) {
          console.log(`          ${pad(r.title, 46)} ${r.detail ?? ''}`);
        }
        if (!verbose && list.length > 3) console.log(`          … ${list.length - 3} more (--verbose)`);
      }
    }
  }

  const slotEvents = events.filter((e): e is Extract<TraceEvent, { type: 'slot' }> => e.type === 'slot');
  const open = slotEvents.filter((e) => !e.picked).length;
  console.log(`\n${slotEvents.length - open} of ${slotEvents.length} ladder slots filled, ${open} left open, `
    + `${events.filter((e) => e.type === 'preplaced').length} pre-placed.\n`);
}

main();
