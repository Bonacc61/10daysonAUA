/**
 * Plan diff — does a catalog change break the rules, or only move the picks?
 *
 * WHY THIS EXISTS
 * The generator's rules were derived painfully, one production report at a time:
 * one kayak per trip, one sail (daytime and evening alike), two outings and one
 * meal per day, ONE PAID outing per day (2026-08-15), nothing repeated except a
 * revisitable beach. Those rules are guarded by tests — but the tests run
 * against the OFFLINE STUB catalog
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
import { generatePlan, isBoatOuting, isSailOuting, isPaidOuting, MAX_PAID_OUTINGS_PER_DAY, SECOND_SAIL_MIN_DAYS } from '../src/data/itineraryGenerator';
import { loadCatalog } from '../src/data/activitySource';
import { activityKind, isFullDayProduct, isEveningItem } from '../src/data/itemFit';
import { parseActivityCost } from '../src/data/matcher';
import { LUNCHSPOTS } from '../src/data/lunchspots';

// routeFamilyOf retires kayaks and day passes into their own families BEFORE the
// sail test runs, so the trip-wide sail count has to exclude them the same way.
const KAYAK_RE = /\bkayak/i;
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
const CI = argv.includes('--ci');
// Rejects rather than coerces. `--days abc` used to parseInt to NaN, which
// generated near-empty plans, found no violations and exited 0 — a green run
// that measured nothing, which is the one output this tool must never produce.
const arg = (n: string, d: number) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = Number(argv[i + 1]);
  if (!Number.isInteger(v) || v < 1) {
    console.error(`plan-diff: --${n} needs a positive whole number, got ${JSON.stringify(argv[i + 1])}`);
    process.exit(2);
  }
  return v;
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

// The engine's OWN definitions. Getting these wrong is how a checker manufactures
// alarms: an earlier version of this file used isWaterBased for the boat cap
// (broader than the engine's boat test, which excludes kayak/jetski/sup) and a
// flat three-card ceiling counted over the wrong entries. Both reported
// violations that were not violations.
//
// The boat and sail tests are now IMPORTED rather than copied, because they got
// copied wrong again: when 'sec:cruises-water' was dropped from the engine's
// boat set (2026-08-12) this file kept the old set, which would have flagged a
// legal bus-tour-plus-catamaran day as a violation. The two numbers below are
// still mirrored — they are single integers with no derivation to drift.
const MAX_CARDS_PER_DAY = 3;    // itineraryGenerator.ts — meals included since 2026-08-12

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

  // Sails, and the one rule here that depends on TRIP LENGTH (2026-08-12).
  // Up to 7 days a trip gets ONE sail of any kind; from 8 days it may add a
  // second, but only of the other kind — a daytime snorkel sail and an evening
  // dinner sail. Two of one kind is never allowed at any length.
  //
  // This mirrored rule went stale the moment the split landed and reported 20
  // violations that were not violations, which is the third time today. The
  // threshold is imported rather than copied for exactly that reason.
  //
  // KNOWN GAP: `all` comes from itemsOf, which returns Viator products only, so
  // a sail sitting in a CURATED slot is invisible here. The engine counts those
  // (routeFamilyOf's non-group branch); this checker does not.
  const sailItems = all.filter((i) => isSailOuting(i) && !isFullDayProduct(i) && !KAYAK_RE.test(i.title));
  const daySails = sailItems.filter((i) => !isEveningItem(i)).length;
  const eveSails = sailItems.filter((i) => isEveningItem(i)).length;
  if (daySails > 1) out.push({ rule: 'one DAYTIME sail per trip', detail: `${daySails} placed` });
  if (eveSails > 1) out.push({ rule: 'one EVENING sail per trip', detail: `${eveSails} placed` });
  if (plan.length < SECOND_SAIL_MIN_DAYS && daySails + eveSails > 1) {
    out.push({ rule: `one sail per trip under ${SECOND_SAIL_MIN_DAYS} days`, detail: `${daySails + eveSails} placed on a ${plan.length}-day trip` });
  }

  // Nothing repeats (a revisitable free beach is an activity, not an item).
  const seenItem = new Map<string, number>();
  plan.forEach((d) => itemsOf(d).forEach((i) => seenItem.set(i.id, (seenItem.get(i.id) ?? 0) + 1)));
  for (const [id, n] of seenItem) if (n > 1) out.push({ rule: 'no repeated product', detail: `${id} ×${n}` });

  // ...and no repeated PAID CURATED activity either. The rule above reads
  // `itemsOf`, which returns Viator products only, so for as long as it stood
  // alone a repeated curated local was invisible to this checker — the same
  // KNOWN GAP called out on the sail rules above. Measured on the live catalog
  // (2026-08-17): 414 ids repeated at least once across 192 generated plans, every
  // one of them a FREE local, so this rule passes today and is not a bug being
  // papered over — it is the guard that keeps it that way.
  //
  // Free locals are exempt BY OWNER'S DECISION (2026-08-17): a free beach or
  // sunset viewpoint may appear more than once in a trip. Paid ones may not,
  // ever — being charged twice for the same thing is the complaint this exists
  // to catch, and no revisit gap makes it acceptable.
  // LUNCHSPOTS too, not just catalog.activities. All ten are paid ($6–30 pp) and
  // the en-route food post-pass places them, but they live in their own array —
  // so seeding from `catalog.activities` alone would have opened a second blind
  // spot while the comment above claimed to be closing the first one. The
  // generator's `usedPlaceKeys` stops a repeat today; this is what notices if
  // that ever stops being true.
  const actById = new Map([...catalog.activities, ...LUNCHSPOTS].map((a) => [a.id, a]));
  const seenAct = new Map<string, number>();
  plan.forEach((d) => SLOTS.flatMap((s) => d[s]).forEach((e) => {
    if (e.kind !== 'activity') return;
    const a = actById.get(e.id);
    if (!a || parseActivityCost(a.cost) === 0) return;   // free locals may repeat
    seenAct.set(e.id, (seenAct.get(e.id) ?? 0) + 1);
  }));
  for (const [id, n] of seenAct) {
    if (n > 1) out.push({ rule: 'no repeated PAID local', detail: `${id} ×${n}` });
  }

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
    // Day shape: at most three CARDS, meals and curated locals included
    // (2026-08-12 — the meal used to be exempt). Counted over every slot entry,
    // not `itemsOf`: that returns only Viator products, so a day of one tour
    // plus a lunch stop plus two free beaches would have scored 1 here.
    //
    // ONE assertion, not two. This and "two outings per day" had identical
    // conditions — both `> 3` — so every offending day was counted twice under
    // two names, inflating the totals and the per-rule table. The outings half
    // is not assertable from a finished plan anyway: a Viator card gives no
    // reliable signal of whether it is a meal.
    const cards = SLOTS.reduce((n, s) => n + d[s].length, 0);
    if (cards > MAX_CARDS_PER_DAY) {
      out.push({ rule: 'card ceiling', detail: `day ${d.day} has ${cards} (max ${MAX_CARDS_PER_DAY})` });
    }

    // One boat per day — the engine's own test, not "anything on water".
    const boats = itemsOf(d).filter(isBoatOuting).length;
    if (boats > 1) out.push({ rule: 'one boat per day', detail: `day ${d.day} has ${boats}` });

    // One PAID outing a day (2026-08-15). Counted over every slot entry, not
    // `itemsOf`: that returns Viator products only, and the rule deliberately
    // also counts the curated locals that cost money — the $11 Arikok gate, the
    // $99 Flamingo pass, the $120 kitesurfing lesson. Free beaches and the
    // curated restaurants are exempt.
    //
    // Both the predicate AND the number are IMPORTED, not mirrored, for the
    // reason this file's header already records about the boat and sail tests:
    // a hand-copied rule drifted and reported violations that were not
    // violations. Nothing about this check can go stale independently.
    //
    // KNOWN EXCEPTION, and why none of the five personas above can trip it: the
    // curated template places by construction and outranks the cap, so a
    // BALANCED traveller who is also a family gets two paid cards on day 2 (the
    // Antilla snorkel sail plus the Animal Sanctuary `kids` swap). That needs
    // mid-range AND adventure 34-66 AND a family group type; `family` here sits
    // at adventure 25, so it never receives the template. Add such a persona and
    // this will report 1 violation per trip that is BY DESIGN, not a regression.
    const paid = SLOTS.flatMap((s) => d[s]).filter((e) => {
      if (e.kind === 'group') {
        const item = itemById.get(e.bestSellerId);
        const group = catalog.groups.find((g) => g.id === e.groupId);
        return !!item && !!group && isPaidOuting({ kind: 'group', group, bestSeller: item, others: [] });
      }
      const activity = catalog.activities.find((a) => a.id === e.id);
      return !!activity && isPaidOuting({ kind: 'activity', activity });
    }).length;
    if (paid > MAX_PAID_OUTINGS_PER_DAY) out.push({ rule: 'one paid outing per day', detail: `day ${d.day} has ${paid}` });
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
    console.log('   Every plan is compared against ITSELF: "plans that changed: 0" and');
    console.log('   "rules broken BY enrichment: 0" are guaranteed and mean nothing here.');
    console.log('   The absolute violation count below IS real. Re-run after `npm run enrich`.\n');
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
  // A no-op run is not a pass. By hand it is a useful baseline, so exit 0 and
  // say so; under --ci it is a job that proved nothing while reporting success,
  // which is worse than a failure because nobody looks at a green build.
  if (enrichedCount === 0) {
    console.log('\nNo enrichment present — this run established the baseline and compared');
    console.log('nothing. The rule counts above are real; the BEFORE/AFTER diff is not.');
    if (CI) {
      console.error('plan-diff: --ci given but there is nothing to compare. Run `npm run enrich` first.');
      process.exit(3);
    }
    return;
  }
  console.log('\nNo rule that held before is broken after. Whatever moved, moved within the rules.');
})();
