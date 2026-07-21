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
import { otherItemsInGroup } from './activitySource';
import type { Activity, Day } from './activities';
import type { CardEntry, MatchTag, Region, Section, Slot, SlotEntry, ViatorItem, ViatorGroup } from '../types';
import { SECTIONS } from './itineraryPlan';
import { matchPool, blendPools, entryPrice } from './matcher';
import { fitItem, refaceForAnswers, budgetCap, activityKind, isEveningItem, isWaterBased, isCrowdPleaser } from './itemFit';
import { primarySection } from './exploreItems';
import { answersToTags } from './answerTags';
import { effectiveFlags } from './notesFlags';
import { LUNCHSPOTS } from './lunchspots';
import { coordForEntry, ACTIVITY_COORDS, VIATOR_ITEM_COORDS, GROUP_COORDS, type Coord } from './coords';
import { pickEnRouteStop, foodPlaceKey, distanceKm } from './enRoute';
import { budgetTag } from './classify';

const DAY_COLORS = ['#FF6B47', '#3B82F6', '#22C55E', '#EAB308', '#E63946', '#8B5CF6', '#0EA5E9'];

// Jaccard similarity between two Viator tag-ID arrays. Returns 0 when either
// array is empty (no tags = no signal). Broad parent tags (e.g. "Outdoor
// Activities") appear in many products and contribute proportionally less to
// the score because they also inflate the union; specific leaf tags (e.g.
// "4WD & Jeep Tours") dominate by concentrating the intersection.
function tagJaccard(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  let intersection = 0;
  for (const t of b) if (setA.has(t)) intersection++;
  const union = setA.size + b.length - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Two Viator items whose tag Jaccard meets this threshold are treated as the
// same real-world experience and not placed in the same plan. 0.35 catches
// e.g. two Natural Pool jeep-safari listings (many shared specific tags) while
// keeping a snorkel cruise (zero jeep tags) eligible on the same trip.
const TAG_SIMILARITY_THRESHOLD = 0.35;

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

// Popularity floor for the auto-generated plan: items in the bottom quartile of
// their budget tier (popularity_score < 0.25, set by normalizePopularity at
// catalog load) never enter the fill pool. Bookability philosophy: suggest few,
// highly-booked activities rather than fill every slot with niche products.
// Percentile-based, so the floor rescales automatically with the live catalog.
// Items without a score (raw test fixtures) pass — only a known-low rank drops.
const MIN_FILL_POPULARITY = 0.25;

// Premium splurge rule: money-no-object travellers on a trip of at least
// PREMIUM_MIN_DAYS get one aspirational premium pick per DAYS_PER_PREMIUM days
// (a private charter IN ADDITION to the crowd-pleaser cruise). Shorter trips get
// just the one cruise. Both express "a week's worth of trip earns one splurge".
const PREMIUM_MIN_DAYS = 7;
const DAYS_PER_PREMIUM = 7;

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
  // Once any item from a group is placed, the whole group is retired for the
  // rest of the trip. Prevents booking-option variants (adult/child/45-min)
  // of the same product from each claiming a separate day.
  usedGroupIds: Set<string>;
  // Cluster IDs (from embedding-based clustering at ingest) of placed Viator
  // items. When an item is placed its cluster is retired for the rest of the
  // trip, preventing semantically identical listings (e.g. two Natural Pool
  // jeep-safari products from different operators) from both appearing.
  // Falls back to tag Jaccard when cluster IDs are absent.
  usedClusterIds: Set<string>;
  // Tag-ID fingerprints used as fallback when no embedding cluster is available.
  usedTagSets: number[][];
};

// Candidates for a slot. useTags=null widens which GROUPS are eligible (time-of-
// day only), but the card face + over-budget guard always use the real answers
// (ctx.tags) via refaceForAnswers — widening relevance must never resurface an
// item the traveller can't afford or wouldn't want.
//
// usedGroupIds excludes entire Viator groups once any of their items has been
// placed, so the same experience never repeats (e.g. "Atlantis Submarine Tour"
// across 5 days). Local activities are excluded by lastUsedDay (item-level).
function candidatesFor(ctx: Ctx, slot: Slot, useTags: Set<MatchTag> | null): CardEntry[] {
  const usedIds = new Set(ctx.lastUsedDay.keys());
  if (useTags === null) {
    const activities = ctx.catalog.activities.filter((a) => a.timeOfDay === SLOT_TOD[slot]);
    const groups = ctx.catalog.groups.filter(
      (g) => (g.allowed_slots.length === 0 || g.allowed_slots.includes(slot))
           && !ctx.usedGroupIds.has(g.id),
    );
    return refaceForAnswers(blendPools(activities, groups, ctx.catalog.items, NO_FILTER), ctx.tags, slot, usedIds);
  }
  const { activities, groups: matchedGroups } = matchPool(ctx.catalog.activities, ctx.catalog.groups, useTags, slot);
  const groups = matchedGroups.filter((g) => !ctx.usedGroupIds.has(g.id));
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

// Coordinate of a candidate: the activity's own point, the shown Viator item's
// point, or the item's group-area fallback. undefined when unmapped.
function entryCoord(e: CardEntry): Coord | undefined {
  return e.kind === 'activity'
    ? ACTIVITY_COORDS[e.activity.id]
    : VIATOR_ITEM_COORDS[e.bestSeller.id] ?? GROUP_COORDS[e.group.id];
}

// Day-level geographic clustering. Once a day has an anchor point (its first
// coord-bearing pick — the morning outing, or a pin/premium), later picks are
// penalised by how far they sit from it, so a day stays in one part of the
// island instead of criss-crossing (a north-tip dive + a far-south beach). Soft
// by design: within NEAR_KM there's no penalty (local variety survives), and a
// far pick is only pushed down the ranking — still placed if nothing closer is
// left, rather than leaving a slot empty. Coord-less picks (islandwide cruises
// from the west-coast marina, downtown walks) are neutral.
const NEAR_KM = 6;
const GEO_PENALTY_PER_KM = 0.5;
function geoPenalty(e: CardEntry, anchorCoord: Coord | undefined): number {
  if (!anchorCoord) return 0;
  const c = entryCoord(e);
  if (!c) return 0;
  return Math.max(0, distanceKm(anchorCoord, c) - NEAR_KM) * GEO_PENALTY_PER_KM;
}

function ranked(ctx: Ctx, cands: CardEntry[], anchor: Region | undefined, anchorCoord: Coord | undefined): CardEntry[] {
  const scored = cands.map((e) => ({ e, s: scoreEntry(e, ctx.tags, ctx.prefSections) - geoPenalty(e, anchorCoord) }));
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
  ctx: Ctx, slot: Slot, anchor: Region | undefined, anchorCoord: Coord | undefined,
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
  // Semantic dedup: skip candidates that represent an already-placed experience.
  // Primary signal: embedding-derived cluster ID (set at ingest by viator-cards).
  // Fallback: Viator tag-ID Jaccard (used when no embedding provider was set).
  // Local activities (no Viator tags, no cluster ID) bypass both — they dedupe
  // by item ID via lastUsedDay only.
  const notSimilar = (e: CardEntry): boolean => {
    if (e.kind !== 'group') return true;
    const cid = e.bestSeller.experience_cluster_id;
    if (cid) return !ctx.usedClusterIds.has(cid);
    // Fallback: tag Jaccard
    const tags = e.bestSeller.tags ?? [];
    if (tags.length === 0) return true;
    return !ctx.usedTagSets.some((used) => tagJaccard(tags, used) >= TAG_SIMILARITY_THRESHOLD);
  };

  const matchedAll = ranked(ctx, candidatesFor(ctx, slot, ctx.tags), anchor, anchorCoord);
  const widenedAll = ranked(ctx, candidatesFor(ctx, slot, null), anchor, anchorCoord);
  const matched = matchedAll.filter(affordable);
  const widened = widenedAll.filter(affordable);

  // Fill ladder, best → worst, every tier restricted to UNUSED + NOT-SIMILAR
  // picks: affordable on-theme → affordable widened → over-budget on-theme →
  // over-budget widened. `kindOk` gates every tier by same-day kind variety.
  // When nothing remains, we return null and the slot stays open.
  const runLadder = (kindOk: (e: CardEntry) => boolean): CardEntry | null => {
    const ok = (list: CardEntry[]) => list.filter(kindOk).filter(notSimilar);
    const firstTwo = ok(matched).find(unused) ?? ok(widened).find(unused) ?? null;
    // When maxPrice === 0 (arrival-day free-only rule), never fall through to the
    // over-budget tiers — leave the slot open rather than place a paid item.
    if (firstTwo !== null || maxPrice === 0) return firstTwo;
    return ok(matchedAll).find(unused) ?? ok(widenedAll).find(unused) ?? null;
  };

  return runLadder(newKind) ?? runLadder(() => true);
}

// FNV-1a hash of the tailoring-relevant answers, so the default seed (and thus
// the default plan) differs between personas while staying stable per persona.
function applyCatalogFlags(catalog: Catalog, flags: Set<string>): Catalog {
  if (flags.size === 0) return catalog;
  let { activities, groups, items } = catalog;

  if (flags.has('no-boats')) {
    // Remove every water/boat experience for a seasick traveller. Two levels:
    //  1. groups explicitly tagged 'watersports' are dropped wholesale;
    //  2. individual water items (cruises-water section or a water tag-kind) are
    //     dropped across ALL groups — this catches sailing-cruises sunset sails
    //     and dinner cruises the group-level filter alone missed, which the
    //     crowd-pleaser boost would otherwise push to the top of the plan.
    activities = activities.filter(a => !(a.sections ?? []).includes('cruises-water'));
    groups = groups.filter(g => !g.matched_by.includes('watersports' as MatchTag));
    items = items.filter(i => !isWaterBased(i));
  }

  if (flags.has('no-car')) {
    activities = activities.filter(a => !a.requires_car);
    // Viator tours include hotel pickup — no group filtering needed.
  }

  // mobility: cap at adventure ~30 (excludes arikok, natural pool, kitesurfing)
  // intense-hikes: cap at adventure ~52 (excludes arikok ~55, natural pool ~70, kitesurfing ~85)
  // with-baby: cap at adventure ~25 (keeps beaches, food, sunsets; drops snorkel, hikes, watersports)
  const adventureCap = flags.has('mobility') ? 30
    : flags.has('intense-hikes') ? 52
    : flags.has('with-baby') ? 25
    : null;
  if (adventureCap !== null) {
    activities = activities.filter(a => (a.adventure ?? 20) <= adventureCap);
    const excludeTags: MatchTag[] = adventureCap <= 30
      ? ['adventure', 'nature-hiking', 'watersports']
      : ['adventure'];
    groups = groups.filter(g => !g.matched_by.some(t => excludeTags.includes(t)));
  }

  const groupIds = new Set(groups.map(g => g.id));
  items = items.filter(i => groupIds.has(i.group_id));
  return { activities, groups, items };
}

function hashAnswers(a: Answers): number {
  const s = JSON.stringify([
    a.days, a.groupType, a.budget, [...a.interests].sort(), a.adventureLevel, a.lodging,
    [...(a.flags ?? [])].sort(),
    // Include specialNotes so a contraindication note ("seasick" → no-boats) that
    // changes the filtered catalog also changes the seed — keeps the seed a
    // faithful identifier of the plan it produces.
    a.specialNotes ?? '',
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

// ---------- Pin-placement helpers (exported for unit tests) ------------------

// Resolve an Explore shortlist id → CardEntry against the filtered catalog.
// id format: 'item:<viatorItemId>' for Viator items, '<activityId>' for local.
// Returns null if the id is stale (product no longer in catalog).
export function resolvePinId(rawId: string, catalog: Catalog): CardEntry | null {
  if (rawId.startsWith('item:')) {
    const itemId = rawId.slice(5);
    const item = catalog.items.find((i) => i.id === itemId);
    if (!item) return null;
    const group = catalog.groups.find((g) => g.id === item.group_id);
    if (!group) return null;
    const others = catalog.items.filter((i) => i.group_id === group.id && i.id !== item.id);
    return { kind: 'group', group, bestSeller: item, others };
  }
  const activity = catalog.activities.find((a) => a.id === rawId);
  if (!activity) return null;
  return { kind: 'activity', activity };
}

// Preferred and fallback slot lists for a resolved pin.
export function getPinSlotPrefs(entry: CardEntry): { preferred: Slot[]; fallback: Slot[] } {
  if (entry.kind === 'group') {
    return isEveningItem(entry.bestSeller)
      ? { preferred: ['evening'], fallback: ['morning', 'afternoon'] }
      : { preferred: ['morning', 'afternoon'], fallback: [] };
  }
  const tod = entry.activity.timeOfDay;
  if (tod === 'Morning')   return { preferred: ['morning'],   fallback: [] };
  if (tod === 'Evening')   return { preferred: ['evening'],   fallback: [] };
  return { preferred: ['afternoon'], fallback: [] };
}

// Scan from cursor (1-based, wraps modulo nDays) for the earliest day+slot that
// satisfies the preferred list; if none found, try the fallback list.
export function findPinSlot(
  preferred: Slot[],
  fallback: Slot[],
  nDays: number,
  cursor: number,
  slotAvail: (day: number, slot: Slot) => boolean,
): { day: number; slot: Slot } | null {
  for (const slots of [preferred, fallback]) {
    if (slots.length === 0) continue;
    for (let i = 0; i < nDays; i++) {
      const d = ((cursor - 1 + i) % nDays) + 1;
      for (const slot of slots) {
        if (slotAvail(d, slot)) return { day: d, slot };
      }
    }
  }
  return null;
}

export function generatePlan(
  answers: Answers,
  catalog: Catalog,
  opts: { seed?: number; pinned?: string[] } = {},
): Day[] {
  const tags = answersToTags(answers);
  const prefSections = new Set<Section>();
  for (const t of tags) for (const s of INTEREST_SECTIONS[t] ?? []) prefSections.add(s);

  const nDays = Math.max(1, Math.min(answers.days || 1, 14));
  const seed = ((opts.seed ?? 0) ^ hashAnswers(answers)) >>> 0;
  // Ticked Q8 pills UNION free-text contraindications ("seasick" → no-boats).
  const flags = effectiveFlags(answers);
  const filteredCatalog = applyCatalogFlags(catalog, flags);
  // The auto-fill pool excludes low-bookability items (bottom of their budget
  // tier by popularity) — we'd rather leave a slot open than suggest a niche
  // product few travellers actually book. Explore still shows everything, and
  // pins resolve against the unfloored catalog: an explicit shortlist choice
  // always beats this heuristic. Crowd-pleasers are exempt from the floor: they
  // are curated as universally bookable, so a lightly-reviewed catamaran or
  // Natural Pool tour must not be filtered out before its boost can apply.
  const flooredItems = filteredCatalog.items.filter(
    (i) => i.popularity_score === undefined || i.popularity_score >= MIN_FILL_POPULARITY || isCrowdPleaser(i),
  );
  // Prefer the bookable Viator experience over a hand-written local pick that
  // duplicates it: if the live catalog actually has a matching guided tour, drop
  // the self-guided local from the auto-fill pool so the slot goes to the
  // bookable one (the local stays in Explore). If no Viator equivalent is present
  // (edge fn down, thin stub), the local remains as the fallback.
  const dupedLocal = (a: Activity): boolean =>
    !!a.viatorDupe && filteredCatalog.items.some((it) => a.viatorDupe!.test(it.title));
  const fillCatalog: Catalog = {
    ...filteredCatalog,
    items: flooredItems,
    // Drop bookable-Viator-duplicated locals, and reserve en-route food twins
    // (e.g. the standalone Zeerover activity) for the route post-pass so they
    // surface on the day you actually drive past them — not scattered onto a
    // random food day on the opposite coast by normal fill.
    activities: filteredCatalog.activities.filter((a) => !dupedLocal(a) && !foodPlaceKey(a.id)),
  };
  const ctx: Ctx = { catalog: fillCatalog, tags, prefSections, rand: rng(seed + 1), lastUsedDay: new Map(), usedGroupIds: new Set(), usedClusterIds: new Set(), usedTagSets: [] };

  // Trip-wide budget pool: keeps the AVERAGE daily activity spend within the
  // tier cap (budget-conscious ≈ $110/day on average), letting days vary while
  // the trip averages out. Infinity for tiers with no cap (money-no-object).
  const cap = budgetCap(tags);
  let budgetLeft = cap === Infinity ? Infinity : cap * nDays;

  // --- Pin pre-pass: claim slots for shortlisted picks before normal fill. ----
  // Pins are budget-exempt — the user chose these explicitly so they always
  // land regardless of cost. They still debit the budget pool so normal fill
  // respects what a pin consumed.
  const pinClaimed = new Map<number, Set<Slot>>();
  const openAft = (day: number) => nDays > 1 && (day === 1 || day === nDays);
  const slotAvail = (day: number, slot: Slot): boolean => {
    if (slot === 'morning' && flags.has('no-early-mornings')) return false;
    if (slot === 'afternoon' && openAft(day)) return false;
    return !pinClaimed.get(day)?.has(slot);
  };

  type PinPlacement = { cardEntry: CardEntry; slotEntry: SlotEntry };
  const pinnedSlots = new Map<number, Map<Slot, PinPlacement>>();
  let dayCursor = 1;

  for (const rawId of (opts.pinned ?? [])) {
    const resolved = resolvePinId(rawId, filteredCatalog);
    if (!resolved) continue;

    const { preferred, fallback } = getPinSlotPrefs(resolved);
    const placement = findPinSlot(preferred, fallback, nDays, dayCursor, slotAvail);
    if (!placement) continue;

    const { day, slot } = placement;
    if (!pinClaimed.has(day)) pinClaimed.set(day, new Set());
    pinClaimed.get(day)!.add(slot);

    const slotEntry: SlotEntry = { ...toSlotEntry(resolved), pinned: true };
    if (!pinnedSlots.has(day)) pinnedSlots.set(day, new Map());
    pinnedSlots.get(day)!.set(slot, { cardEntry: resolved, slotEntry });

    // Advance cursor so pins spread across the trip.
    dayCursor = (day % nDays) + 1;
  }
  // ---------------------------------------------------------------------------

  // --- Premium splurge pre-pass ---------------------------------------------
  // A money-no-object traveller on a week-plus trip should get aspirational
  // premium experiences (a private charter) IN ADDITION to the universal crowd-
  // pleasers, not instead of them — they're distinct enough to do both. But such
  // items share a Viator group with the group's crowd-pleaser (a private charter
  // and a party cruise are both "sailing-cruises"), so normal group-dedup would
  // surface only one. We place the top premium pick(s) here, exempt from group-
  // dedup and marked used at the ITEM level only — so the group stays open for
  // its crowd-pleaser via normal fill, and both land on different days. Shorter
  // trips skip this (one cruise is plenty); non-splurge budgets never trigger it.
  const premiumSlots = new Map<number, Map<Slot, PinPlacement>>();
  if (tags.has('money-no-object') && nDays >= PREMIUM_MIN_DAYS) {
    const maxPremium = Math.floor(nDays / DAYS_PER_PREMIUM); // 1 for a week, 2 for a fortnight
    // Items already claimed by a pin — pins live in pinnedSlots, NOT lastUsedDay
    // (which the day loop fills later), so we derive the id set explicitly to
    // avoid placing a pinned item a second time as a premium pick.
    const pinnedItemIds = new Set<string>();
    for (const daySlots of pinnedSlots.values())
      for (const { cardEntry } of daySlots.values()) pinnedItemIds.add(entryId(cardEntry));

    // Best premium-tier item per group (one splurge per group), highest fit first.
    const bestPerGroup = new Map<string, { item: ViatorItem; group: ViatorGroup; score: number }>();
    for (const item of fillCatalog.items) {
      if (budgetTag(item.price_usd) !== 'money-no-object') continue; // premium tier only
      if (pinnedItemIds.has(item.id)) continue;                      // already pinned
      const fit = fitItem(item, tags);
      if (fit.rejected) continue;
      const group = fillCatalog.groups.find((g) => g.id === item.group_id);
      if (!group) continue;
      const cur = bestPerGroup.get(group.id);
      // Tiebreak on id so equal-score picks are stable across catalog orderings.
      if (!cur || fit.score > cur.score || (fit.score === cur.score && item.id < cur.item.id)) {
        bestPerGroup.set(group.id, { item, group, score: fit.score });
      }
    }
    const ranked = [...bestPerGroup.values()]
      .sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : 1))
      .slice(0, maxPremium);

    let premCursor = nDays > 1 ? 2 : 1; // bias away from the arrival (day 1) chill day
    const usedPremiumClusters = new Set<string>(); // no two identical splurges
    for (const { item, group } of ranked) {
      const cid = item.experience_cluster_id;
      if (cid && usedPremiumClusters.has(cid)) continue; // same experience as an earlier splurge
      // `others` from the full FILTERED catalog (not the popularity-floored fill
      // pool) so the card's swap alternatives match a pinned card's, and sorted
      // by display_order via the shared helper.
      const others = otherItemsInGroup(group.id, item.id, filteredCatalog);
      const cardEntry: CardEntry = { kind: 'group', group, bestSeller: item, others };
      const { preferred, fallback } = getPinSlotPrefs(cardEntry);
      const placement = findPinSlot(preferred, fallback, nDays, premCursor, slotAvail);
      if (!placement) continue;
      const { day, slot } = placement;
      if (!pinClaimed.has(day)) pinClaimed.set(day, new Set());
      pinClaimed.get(day)!.add(slot);
      if (cid) usedPremiumClusters.add(cid);
      // `splurge: true` (not `pinned`) — auto-suggested aspirational pick, shown
      // with a "Signature splurge" badge rather than the "★ Your pick" pin badge.
      if (!premiumSlots.has(day)) premiumSlots.set(day, new Map());
      premiumSlots.get(day)!.set(slot, { cardEntry, slotEntry: { ...toSlotEntry(cardEntry), splurge: true } });
      premCursor = (day % nDays) + 1;
    }
  }
  // ---------------------------------------------------------------------------

  const days: Day[] = [];
  for (let d = 1; d <= nDays; d += 1) {
    const slots: Record<Slot, SlotEntry[]> = { morning: [], afternoon: [], evening: [] };
    const picks: CardEntry[] = [];
    const usedKinds = new Set<string>(); // activity-kinds placed today (variety)
    let anchor: Region | undefined;
    let anchorCoord: Coord | undefined; // day's geographic centre (first coord-bearing pick)

    // Arrival (first) and departure (last) days keep an open afternoon — a
    // lighter pace, and it surfaces the "Drop an activity here" zone between the
    // morning and evening cards. Single-day trips stay full (no arrival/departure
    // split). Mirrors the original hand-curated itinerary's pacing.
    const openAfternoon = nDays > 1 && (d === 1 || d === nDays);

    for (const slot of SECTIONS) {
      if (slot === 'afternoon' && openAfternoon) continue;
      if (slot === 'morning' && flags.has('no-early-mornings')) continue;

      const pin = pinnedSlots.get(d)?.get(slot);
      if (pin) {
        const { cardEntry: pick, slotEntry } = pin;
        budgetLeft -= entryPrice(pick);
        ctx.lastUsedDay.set(entryId(pick), d);
        if (pick.kind === 'group') {
          ctx.usedGroupIds.add(pick.group.id);
          const cid = pick.bestSeller.experience_cluster_id;
          if (cid) ctx.usedClusterIds.add(cid);
          const tags = pick.bestSeller.tags ?? [];
          if (tags.length > 0) ctx.usedTagSets.push(tags);
        }
        usedKinds.add(entryKind(pick));
        if (!anchor) anchor = entryRegion(pick);
        if (!anchorCoord) anchorCoord = entryCoord(pick);
        picks.push(pick);
        slots[slot].push(slotEntry);
        continue;
      }

      // Premium splurge (money-no-object, long trip): placed like a pin but the
      // group is NOT retired — its crowd-pleaser should still surface elsewhere.
      // We mark the item id (lastUsedDay) and its experience CLUSTER, but NOT its
      // tags: cluster id means "the same real-world experience," so normal fill
      // won't place an identical one, while the coarser tag-Jaccard fallback
      // would wrongly suppress a distinct-but-related crowd-pleaser (a charter
      // and a party cruise share sail tags) — exactly the second pick we want.
      const premium = premiumSlots.get(d)?.get(slot);
      if (premium) {
        const { cardEntry: pick, slotEntry } = premium;
        budgetLeft -= entryPrice(pick);
        ctx.lastUsedDay.set(entryId(pick), d);
        if (pick.kind === 'group') {
          const cid = pick.bestSeller.experience_cluster_id;
          if (cid) ctx.usedClusterIds.add(cid);
        }
        usedKinds.add(entryKind(pick));
        if (!anchor) anchor = entryRegion(pick);
        if (!anchorCoord) anchorCoord = entryCoord(pick);
        picks.push(pick);
        slots[slot].push(slotEntry);
        continue;
      }

      // Arrival day (day 1) is a free/chill settle-in day — no paid tours.
      // Single-day trips are exempted (the traveller has no other day).
      const freeOnly = nDays > 1 && d === 1;
      const maxP = freeOnly ? 0 : Math.max(0, budgetLeft);
      const pick = pickForSlot(ctx, slot, anchor, anchorCoord, maxP, usedKinds);
      if (!pick) continue;
      budgetLeft -= entryPrice(pick);
      ctx.lastUsedDay.set(entryId(pick), d);
      if (pick.kind === 'group') {
        ctx.usedGroupIds.add(pick.group.id);
        const cid = pick.bestSeller.experience_cluster_id;
        if (cid) ctx.usedClusterIds.add(cid);
        const tags = pick.bestSeller.tags ?? [];
        if (tags.length > 0) ctx.usedTagSets.push(tags);
      }
      usedKinds.add(entryKind(pick));
      if (!anchor) anchor = entryRegion(pick);
      if (!anchorCoord) anchorCoord = entryCoord(pick);
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

  // --- En-route food post-pass ------------------------------------------------
  // If a day's plan drives out to a far corner of the island, offer a curated
  // food stop that sits on that drive (e.g. Zeerover on an Arikok/Boca Grandi
  // day — you pass straight through Savaneta). Appended as an ordinary afternoon
  // food card: swappable/removable like the manual "Suggest lunch spot" pick.
  // Skipped for no-car travellers (they aren't driving there) and for days that
  // already include a food card. A place is never offered twice on a trip.
  if (!flags.has('no-car')) {
    const isFoodActivityId = (id: string): boolean =>
      (catalog.activities.find((x) => x.id === id) ?? LUNCHSPOTS.find((x) => x.id === id))?.category === 'Food';
    const entryIsFood = (e: SlotEntry): boolean =>
      e.kind === 'activity' ? isFoodActivityId(e.id) : e.groupId === 'food-drink-experiences';
    const entryFoodKey = (e: SlotEntry): string | undefined =>
      foodPlaceKey(e.kind === 'activity' ? e.id : e.bestSellerId);

    // Seed with food places already in the plan so we never double-book one.
    const usedPlaceKeys = new Set<string>();
    for (const day of days)
      for (const slot of SECTIONS)
        for (const e of day[slot]) { const k = entryFoodKey(e); if (k) usedPlaceKeys.add(k); }

    for (const day of days) {
      // An existing lunch/daytime food card blocks the stop; an evening dinner
      // doesn't — a roadside lunch and a night-out dinner happily coexist.
      if (day.morning.some(entryIsFood) || day.afternoon.some(entryIsFood)) continue;
      const coords = SECTIONS
        .flatMap((slot) => day[slot])
        .map(coordForEntry)
        .filter((c): c is Coord => !!c);
      const pick = pickEnRouteStop(coords, usedPlaceKeys);
      if (!pick) continue;
      usedPlaceKeys.add(pick.placeKey);
      day.afternoon.push({ kind: 'activity', id: pick.id });
    }
  }
  // ---------------------------------------------------------------------------

  return days;
}
