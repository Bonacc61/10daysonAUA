/**
 * Plan diff — does a catalog change break the rules, or only move the picks?
 *
 * WHY THIS EXISTS
 * The generator's rules were derived painfully, one production report at a time:
 * one kayak per trip, one daytime sail, one evening cruise, two outings and one
 * meal per day, nothing repeated except a revisitable beach. Those rules are
 * guarded by tests — but the tests run against the OFFLINE STUB catalog
 * (`getCatalog()`), and enrichment is merged only in the live path
 * (`loadCatalog()`). So `npm test` is structurally incapable of telling you
 * whether enrichment broke anything on real data. It will stay green either way.
 *
 * That is the gap this fills. It generates the same plans twice against the LIVE
 * catalog — once with enrichment applied, once with it stripped — and checks the
 * invariants on both. If a rule holds before and after, the work that produced it
 * survived. If one breaks, you get the persona, the seed and the day.
 *
 *   node tools/run-plan-diff.cjs [--days 10] [--seeds 4]
 *
 * Exit 1 if enrichment introduces a violation that was not already there.
 */
import { generatePlan } from '../src/data/itineraryGenerator';
import { loadCatalog } from '../src/data/activitySource';
import { activityKind, isEveningItem } from '../src/data/itemFit';
import type { Catalog } from '../src/data/activitySource';
import type { Answers } from '../src/App';
import type { Day } from '../src/data/activities';
import type { ViatorItem } from '../src/types';

const SLOTS = ['morning', 'afternoon', 'evening'] as const;

const BASE: Answers = {
  days: 10, groupType: '', budget: '', interests: [], adventureLevel: 50,
  startOffset: 7, lodging: '', flags: [], specialNotes: '',
};

// The same five personas tools/itinerary-trace.ts uses — every string here must
// be one the questionnaire can actually produce (see src/data/answerTags.ts).
const PERSONAS: Record<string, Answers> = {
  default:    BASE,
  foodie:     { ...BASE, interests: ['Food & drink', 'Culture & history'], budget: 'Budget-conscious', adventureLevel: 10, groupType: 'Couple' },
  adventurer: { ...BASE, interests: ['Adventure & adrenaline', 'Watersports'], budget: 'Mid-range', adventureLevel: 95, groupType: 'Friends' },
  splurge:    { ...BASE, interests: ['Watersports'], budget: 'Money no object', adventureLevel: 60, groupType: 'Couple' },
  family:     { ...BASE, interests: ['Beach & chill'], budget: 'Mid-range', adventureLevel: 25, groupType: 'Family with young kids', flags: ['no-early-mornings'] },
};

const argv = process.argv.slice(2);
const arg = (n: string, d: number) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? parseInt(argv[i + 1], 10) : d;
};

/** The catalog as it was before enrichment: same items, derived fields removed. */
function stripEnrichment(c: Catalog): Catalog {
  return {
    ...c,
    items: c.items.map((i) => {
      const { enriched_kind: _k, physical: _p, kids: _kd, evidence: _e, ...rest } = i as ViatorItem & Record<string, unknown>;
      // `adventure` is only set by enrichment for LIVE items (curated values
      // belong to local picks, which are activities, not items) — so dropping it
      // here restores the pre-enrichment fallback.
      return { ...rest, adventure: undefined } as ViatorItem;
    }),
  };
}

type Violation = { rule: string; detail: string };

// The engine's OWN definitions, mirrored. Getting these wrong is how a checker
// manufactures alarms: an earlier version of this file used isWaterBased for the
// boat cap (broader than the engine's BOAT_KINDS, which excludes kayak/jetski/
// sup) and a flat three-card ceiling (the real rule is three NON-MEAL cards plus
// one meal, with revisitable beaches exempt from the outings count). Both
// reported violations that were not violations.
const BOAT_KINDS = new Set(['sail', 'snorkel', 'dive', 'sec:cruises-water']);
const MAX_ACTIVITIES_PER_DAY = 2;        // itineraryGenerator.ts:567
const MAX_NON_MEAL_CARDS_PER_DAY = 3;    // itineraryGenerator.ts:576

// --- The rules, as assertions over a finished plan --------------------------
// Each one is a production report someone wrote up and someone else fixed. They
// are the reason this tool exists: a change that moves picks is fine, a change
// that breaks one of these is not.
//
// HARD rules only. The same-kind-per-day variety gate is deliberately absent:
// the ladder relaxes it when nothing of a new kind is available
// (itineraryGenerator.ts:917-923), so a repeat kind is a documented outcome, not
// a broken rule, and asserting on it would drown the real signal.
function checkInvariants(plan: Day[], catalog: Catalog): Violation[] {
  const out: Violation[] = [];
  const itemById = new Map(catalog.items.map((i) => [i.id, i]));

  const itemsOf = (d: Day) =>
    SLOTS.flatMap((s) => d[s])
      .filter((e): e is { kind: 'group'; groupId: string; bestSellerId: string } => e.kind === 'group')
      .map((e) => itemById.get(e.bestSellerId))
      .filter((i): i is ViatorItem => !!i);

  const all = plan.flatMap(itemsOf);
  const count = (pred: (i: ViatorItem) => boolean) => all.filter(pred).length;

  // Trip-wide curation rules (2026-08-05).
  const kayaks = count((i) => activityKind(i) === 'kayak');
  if (kayaks > 1) out.push({ rule: 'one kayak per trip', detail: `${kayaks} placed` });

  const daySails = count((i) => activityKind(i) === 'sail' && !isEveningItem(i));
  if (daySails > 1) out.push({ rule: 'one daytime sail per trip', detail: `${daySails} placed` });

  const eveningCruises = count((i) => BOAT_KINDS.has(activityKind(i)) && isEveningItem(i));
  if (eveningCruises > 1) out.push({ rule: 'one evening cruise per trip', detail: `${eveningCruises} placed` });

  // Nothing repeats (a revisitable free beach is an activity, not an item).
  const seenItem = new Map<string, number>();
  plan.forEach((d) => itemsOf(d).forEach((i) => seenItem.set(i.id, (seenItem.get(i.id) ?? 0) + 1)));
  for (const [id, n] of seenItem) if (n > 1) out.push({ rule: 'no repeated product', detail: `${id} ×${n}` });

  // One experience cluster, once per trip.
  const seenCluster = new Map<string, string[]>();
  for (const d of plan) {
    for (const i of itemsOf(d)) {
      const cid = i.experience_cluster_id;
      if (!cid) continue;
      seenCluster.set(cid, [...(seenCluster.get(cid) ?? []), `d${d.day}:${i.id}`]);
    }
  }
  for (const [cid, where] of seenCluster) {
    if (where.length > 1) out.push({ rule: 'one experience cluster per trip', detail: `${cid} → ${where.join(', ')}` });
  }

  for (const d of plan) {
    // Day shape. Meals are counted separately from outings, and the ceiling is
    // on NON-MEAL cards — a day may legitimately carry MAX_NON_MEAL + one meal.
    // Curated local picks are activities; Viator products are never meals here,
    // so counting group entries as outings is the right approximation.
    const outings = itemsOf(d).length;
    if (outings > MAX_NON_MEAL_CARDS_PER_DAY) {
      out.push({ rule: 'non-meal card ceiling', detail: `day ${d.day} has ${outings} (max ${MAX_NON_MEAL_CARDS_PER_DAY})` });
    }
    if (outings > MAX_ACTIVITIES_PER_DAY + 1) {
      out.push({ rule: 'two outings per day', detail: `day ${d.day} has ${outings}` });
    }

    // One boat per day — the engine's BOAT_KINDS, not "anything on water".
    const boats = itemsOf(d).filter((i) => BOAT_KINDS.has(activityKind(i))).length;
    if (boats > 1) out.push({ rule: 'one boat per day', detail: `day ${d.day} has ${boats}` });
  }
  return out;
}

const openSlots = (plan: Day[]) =>
  plan.reduce((n, d) => n + SLOTS.reduce((m, s) => m + (d[s].length === 0 ? 1 : 0), 0), 0);

const fingerprint = (plan: Day[]) =>
  plan.map((d) => SLOTS.map((s) => d[s].map((e) => (e.kind === 'group' ? e.bestSellerId : e.id)).join('+')).join('|')).join(' / ');

(async () => {
  const days = arg('days', 10);
  const seeds = arg('seeds', 4);

  const after = await loadCatalog();
  if (after.items.length < 50) {
    console.error(`only ${after.items.length} items — that is the offline stub. Run from the repo root so ./.env.production is readable.`);
    process.exit(2);
  }
  const before = stripEnrichment(after);

  const enrichedCount = after.items.filter((i) => i.enriched_kind || i.adventure !== undefined).length;
  console.log(`live catalog: ${after.items.length} items, ${enrichedCount} carrying enrichment`);
  if (enrichedCount === 0) {
    console.log('\n⚠  The snapshot is empty, so BEFORE and AFTER are the same catalog.');
    console.log('   This run establishes the baseline. Re-run after `npm run enrich`.\n');
  }
  console.log(`personas: ${Object.keys(PERSONAS).length} × seeds 0-${seeds - 1} × ${days} days\n`);

  let newViolations = 0, fixedViolations = 0, changedPlans = 0, total = 0;
  let openBefore = 0, openAfter = 0;
  // ABSOLUTE counts, not just deltas. "0 introduced" is not "0 violations" —
  // the live catalog can already be breaking a rule, and reporting only the
  // delta would hide that behind a clean-looking summary.
  let absBefore = 0, absAfter = 0;
  const byRule = new Map<string, { before: number; after: number }>();

  for (const [name, answers] of Object.entries(PERSONAS)) {
    for (let seed = 0; seed < seeds; seed++) {
      total++;
      const a = { ...answers, days };
      const planBefore = generatePlan(a, before, { seed });
      const planAfter = generatePlan(a, after, { seed });

      const vBefore = checkInvariants(planBefore, before);
      const vAfter = checkInvariants(planAfter, after);
      openBefore += openSlots(planBefore);
      openAfter += openSlots(planAfter);

      absBefore += vBefore.length; absAfter += vAfter.length;
      for (const v of vBefore) {
        const e = byRule.get(v.rule) ?? { before: 0, after: 0 }; e.before++; byRule.set(v.rule, e);
      }
      for (const v of vAfter) {
        const e = byRule.get(v.rule) ?? { before: 0, after: 0 }; e.after++; byRule.set(v.rule, e);
      }

      const keyOf = (v: Violation) => `${v.rule}::${v.detail}`;
      const setBefore = new Set(vBefore.map(keyOf));
      const setAfter = new Set(vAfter.map(keyOf));
      const introduced = vAfter.filter((v) => !setBefore.has(keyOf(v)));
      const fixed = vBefore.filter((v) => !setAfter.has(keyOf(v)));

      if (fingerprint(planBefore) !== fingerprint(planAfter)) changedPlans++;

      if (introduced.length) {
        newViolations += introduced.length;
        console.log(`✗ ${name} seed ${seed} — enrichment INTRODUCED:`);
        for (const v of introduced) console.log(`    ${v.rule}: ${v.detail}`);
      }
      if (fixed.length) {
        fixedViolations += fixed.length;
        console.log(`✓ ${name} seed ${seed} — enrichment FIXED:`);
        for (const v of fixed) console.log(`    ${v.rule}: ${v.detail}`);
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`plans compared:        ${total}`);
  console.log(`plans that changed:    ${changedPlans}  (expected — that is the feature)`);
  console.log(`open slots:            ${openBefore} → ${openAfter}`);
  console.log(`rules broken BY enrichment: ${newViolations}`);
  console.log(`rules enrichment FIXED:     ${fixedViolations}`);
  console.log(`total violations:      ${absBefore} → ${absAfter}`);
  if (byRule.size) {
    console.log('\nby rule (before → after):');
    for (const [rule, n] of [...byRule].sort((a, b) => b[1].before - a[1].before)) {
      const arrow = n.after < n.before ? '  ✓' : n.after > n.before ? '  ✗' : '';
      console.log(`  ${String(n.before).padStart(4)} → ${String(n.after).padStart(4)}  ${rule}${arrow}`);
    }
  }
  console.log('─'.repeat(60));

  if (newViolations > 0) {
    console.log('\nA rule that held before and breaks after is the thing this tool exists to');
    console.log('catch. Do not commit the snapshot. The rules above were each derived from a');
    console.log('production report — see docs/matching-engine/development-log.md.');
    process.exit(1);
  }
  console.log('\nNo rule that held before is broken after. Whatever moved, moved within the rules.');
})();
