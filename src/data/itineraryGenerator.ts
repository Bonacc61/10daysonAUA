// Builds the *initial* itinerary from the questionnaire answers — the piece the
// app was missing (the page used to ship a static 5-day SAMPLE_ITINERARY sliced
// by day count, so answers never tailored it and >5 days was clamped to 5).
//
// Pure + deterministic given a seed, so it's unit-testable and a "regenerate"
// just passes a fresh seed. The caller wraps the returned Day[] with seedPlan()
// to attach per-card uids.
//
// Reuses the already-built+tested matcher (matchPool / blendPools / answersToTags)
// and adds the scoring that actually differentiates picks — needed because every
// local activity currently has matched_by: [] (a wildcard that matches everyone),
// so without scoring a foodie and an adventurer would get the same local picks.

import type { Answers } from '../App';
import type { Catalog } from './activitySource';
import type { Activity, Day } from './activities';
import type { CardEntry, MatchTag, Region, Section, Slot, SlotEntry } from '../types';
import { SECTIONS } from './itineraryPlan';
import { matchPool, blendPools, entryPrice } from './matcher';
import { fitItem, refaceForAnswers, budgetCap, activityKind } from './itemFit';
import { primarySection } from './exploreItems';
import { answersToTags } from './answerTags';

const DAY_COLORS = ['#FF6B47', '#3B82F6', '#22C55E', '#EAB308', '#E63946', '#8B5CF6', '#0EA5E9'];

const SLOT_TOD: Record<Slot, Activity['timeOfDay']> = {
  morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening',
};

const NO_FILTER = { rejectedIds: new Set<string>(), rejectedGroupIds: new Set<string>() };

// interest tag → Explore sections it favours. This is what tailors the
// wildcard-tagged local picks (groups already differentiate via matched_by).
// Same section taxonomy Explore filters on (see exploreItems.ts SECTIONS).
const INTEREST_SECTIONS: Partial<Record<MatchTag, Section[]>> = {
  'beach-chill':     ['beaches'],
  'watersports':     ['cruises-water'],
  'food-drink':      ['food-drink'],
  'nature-hiking':   ['adventures-outdoor', 'tours-sightseeing'],
  'adventure':       ['adventures-outdoor', 'cruises-water', 'tours-sightseeing'],
  'culture-history': ['culture-history', 'tours-sightseeing'],
  'nightlife':       ['food-drink'],
  'wellness-spa':    ['beaches'],
};

// mulberry32 — tiny deterministic PRNG so a seed reproduces a plan exactly.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function entryId(e: CardEntry): string {
  return e.kind === 'activity' ? e.activity.id : e.bestSeller.id;
}
function entryRegion(e: CardEntry): Region | undefined {
  return e.kind === 'group' ? e.group.region : undefined;
}
function entryRating(e: CardEntry): number {
  return e.kind === 'activity' ? e.activity.rating : e.bestSeller.rating;
}
function toSlotEntry(e: CardEntry): SlotEntry {
  return e.kind === 'activity'
    ? { kind: 'activity', id: e.activity.id }
    : { kind: 'group', groupId: e.group.id, bestSellerId: e.bestSeller.id };
}

function scoreEntry(e: CardEntry, tags: Set<MatchTag>, prefSections: Set<Section>): number {
  if (e.kind === 'group') {
    // Per-item fit of the *shown* card (interests + adventure + budget + popularity,
    // from classify.ts) plus the group's editorial signal (group type, lodging,
    // theme). The face was already chosen by refaceForAnswers, so it's never an
    // over-budget reject here.
    let score = fitItem(e.bestSeller, tags).score;
    for (const t of e.group.matched_by) if (tags.has(t)) score += 2;
    return score;
  }
  // Local activity: wildcard matched_by, so the section affinity does the work.
  let score = 0;
  for (const t of e.activity.matched_by) if (tags.has(t)) score += 2;
  if ((e.activity.sections ?? []).some((s) => prefSections.has(s))) score += 3;
  const price = entryPrice(e);
  if (tags.has('budget')) score += price === 0 ? 2 : price < 50 ? 1 : price > 100 ? -1 : 0;
  if (tags.has('money-no-object') || tags.has('treat-yourself')) score += price > 100 ? 1 : 0;
  return score;
}

type Ctx = {
  catalog: Catalog;
  tags: Set<MatchTag>;
  prefSections: Set<Section>;
  rand: () => number;
  lastUsedDay: Map<string, number>;
};

// Candidates for a slot. useTags=null widens which GROUPS are eligible (time-of-
// day only), but the card face + over-budget guard always use the real answers
// (ctx.tags) via refaceForAnswers — widening relevance must never resurface an
// item the traveller can't afford or wouldn't want.
//
// Already-used ids are excluded at face-selection time, so each group re-faces to
// its best *unused* item: a single group with many items surfaces a different one
// each day instead of collapsing to one fixed face (the reason evenings used to
// repeat — the whole slot was often served by one group's single best-seller).
function candidatesFor(ctx: Ctx, slot: Slot, useTags: Set<MatchTag> | null): CardEntry[] {
  const usedIds = new Set(ctx.lastUsedDay.keys());
  if (useTags === null) {
    const activities = ctx.catalog.activities.filter((a) => a.timeOfDay === SLOT_TOD[slot]);
    const groups = ctx.catalog.groups.filter(
      (g) => g.allowed_slots.length === 0 || g.allowed_slots.includes(slot),
    );
    return refaceForAnswers(blendPools(activities, groups, ctx.catalog.items, NO_FILTER), ctx.tags, slot, usedIds);
  }
  const { activities, groups } = matchPool(ctx.catalog.activities, ctx.catalog.groups, useTags, slot);
  return refaceForAnswers(blendPools(activities, groups, ctx.catalog.items, NO_FILTER), ctx.tags, slot, usedIds);
}

// A coarse "kind" for an entry, used to keep a single day varied (no two near-
// duplicate activities, e.g. an ATV tour and a Jeep safari).
function entryKind(e: CardEntry): string {
  return e.kind === 'group'
    ? activityKind(e.bestSeller)
    : `sec:${primarySection(e.activity.sections ?? [])}`;
}

// Score-rank first; shuffle the top equal-score band (variety on regen); then
// cluster that band by the day's anchor region (soft tiebreak), rating last.
// Width of the "comparably good" band, in score points. Entries within BAND of
// the top score are treated as interchangeable so a reseed (regenerate) can pick
// a different one — variety without a meaningful quality drop. Exact-top-only
// (BAND 0) gives no variety when one item dominates the slot.
const BAND = 1;

function ranked(ctx: Ctx, cands: CardEntry[], anchor: Region | undefined): CardEntry[] {
  const scored = cands.map((e) => ({ e, s: scoreEntry(e, ctx.tags, ctx.prefSections) }));
  const maxS = scored.reduce((m, x) => Math.max(m, x.s), -Infinity);
  // Shuffle the within-BAND top band (variety on regen), then stably partition
  // by anchor-region so clustering only breaks ties — the shuffle order survives
  // among same-cluster entries. No rating sort inside the band: it would override
  // the shuffle and kill variety; band members are comparably-fit by score.
  const top = shuffle(scored.filter((x) => x.s >= maxS - BAND), ctx.rand);
  top.sort((a, b) => {
    const ar = anchor && entryRegion(a.e) === anchor ? 1 : 0;
    const br = anchor && entryRegion(b.e) === anchor ? 1 : 0;
    return br - ar;
  });
  const rest = scored
    .filter((x) => x.s < maxS - BAND)
    .sort((a, b) => b.s - a.s || entryRating(b.e) - entryRating(a.e));
  return [...top.map((x) => x.e), ...rest.map((x) => x.e)];
}

// `maxPrice` is the remaining trip budget — candidates costing more are skipped
// so the trip's average daily spend stays within the tier cap. `usedKinds` are
// the activity-kinds already placed today; picks that introduce a NEW kind win,
// so a day stays varied (never an ATV tour and a Jeep safari on the same day).
// Free/cheap local picks keep slots filled once the budget tightens.
function pickForSlot(
  ctx: Ctx, slot: Slot, anchor: Region | undefined,
  maxPrice: number, usedKinds: Set<string>,
): CardEntry | null {
  const affordable = (e: CardEntry) => entryPrice(e) <= maxPrice;
  // `unused` is trip-wide: lastUsedDay holds every id placed on any prior day,
  // so an unused pick has never appeared in the plan. We NEVER return a used id
  // — the same activity showing up twice (and, with the small evening pool,
  // twice in the evening) is exactly the bug this fixes. An exhausted pool
  // leaves the slot open ("Drop an activity here") rather than repeating.
  const unused = (e: CardEntry) => !ctx.lastUsedDay.has(entryId(e));
  const newKind = (e: CardEntry) => !usedKinds.has(entryKind(e));

  const matchedAll = ranked(ctx, candidatesFor(ctx, slot, ctx.tags), anchor);
  const widenedAll = ranked(ctx, candidatesFor(ctx, slot, null), anchor);
  const matched = matchedAll.filter(affordable);
  const widened = widenedAll.filter(affordable);

  // Fill ladder, best → worst, every tier restricted to UNUSED picks so no
  // activity is ever repeated: affordable on-theme → affordable widened →
  // over-budget on-theme → over-budget widened (a rare over-budget-but-distinct
  // pick beats a duplicate). `kindOk` gates every tier by same-day kind, so we
  // run the whole ladder for new kinds first and only rerun it allowing a repeat
  // kind when that would otherwise leave the slot empty. When nothing unused
  // remains, we return null and the slot stays open.
  const runLadder = (kindOk: (e: CardEntry) => boolean): CardEntry | null => {
    const ok = (list: CardEntry[]) => list.filter(kindOk);
    return (
         ok(matched).find(unused)
      ?? ok(widened).find(unused)
      ?? ok(matchedAll).find(unused)
      ?? ok(widenedAll).find(unused)
    ) ?? null;
  };

  return runLadder(newKind) ?? runLadder(() => true);
}

// FNV-1a hash of the tailoring-relevant answers, so the default seed (and thus
// the default plan) differs between personas while staying stable per persona.
function hashAnswers(a: Answers): number {
  const s = JSON.stringify([
    a.days, a.groupType, a.budget, [...a.interests].sort(), a.adventureLevel, a.lodging,
  ]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function titleFor(picks: CardEntry[], day: number): string {
  const first = picks[0];
  if (!first) return `Day ${day}`;
  return first.kind === 'group' ? first.group.name : first.activity.category;
}

export function generatePlan(
  answers: Answers,
  catalog: Catalog,
  opts: { seed?: number } = {},
): Day[] {
  const tags = answersToTags(answers);
  const prefSections = new Set<Section>();
  for (const t of tags) for (const s of INTEREST_SECTIONS[t] ?? []) prefSections.add(s);

  const nDays = Math.max(1, Math.min(answers.days || 1, 14));
  const seed = ((opts.seed ?? 0) ^ hashAnswers(answers)) >>> 0;
  const ctx: Ctx = { catalog, tags, prefSections, rand: rng(seed + 1), lastUsedDay: new Map() };

  // Trip-wide budget pool: keeps the AVERAGE daily activity spend within the
  // tier cap (budget-conscious ≈ $110/day on average), letting days vary while
  // the trip averages out. Infinity for tiers with no cap (money-no-object).
  const cap = budgetCap(tags);
  let budgetLeft = cap === Infinity ? Infinity : cap * nDays;

  const days: Day[] = [];
  for (let d = 1; d <= nDays; d += 1) {
    const slots: Record<Slot, SlotEntry[]> = { morning: [], afternoon: [], evening: [] };
    const picks: CardEntry[] = [];
    const usedKinds = new Set<string>(); // activity-kinds placed today (variety)
    let anchor: Region | undefined;

    // Arrival (first) and departure (last) days keep an open afternoon — a
    // lighter pace, and it surfaces the "Drop an activity here" zone between the
    // morning and evening cards. Single-day trips stay full (no arrival/departure
    // split). Mirrors the original hand-curated itinerary's pacing.
    const openAfternoon = nDays > 1 && (d === 1 || d === nDays);

    for (const slot of SECTIONS) {
      if (slot === 'afternoon' && openAfternoon) continue;
      const pick = pickForSlot(ctx, slot, anchor, Math.max(0, budgetLeft), usedKinds);
      if (!pick) continue;
      budgetLeft -= entryPrice(pick);
      ctx.lastUsedDay.set(entryId(pick), d);
      usedKinds.add(entryKind(pick));
      if (!anchor) anchor = entryRegion(pick);
      picks.push(pick);
      slots[slot].push(toSlotEntry(pick));
    }

    days.push({
      day: d,
      title: titleFor(picks, d),
      color: DAY_COLORS[(d - 1) % DAY_COLORS.length],
      morning: slots.morning, afternoon: slots.afternoon, evening: slots.evening,
    });
  }

  return days;
}
