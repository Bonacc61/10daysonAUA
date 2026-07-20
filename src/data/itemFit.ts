import type { CardEntry, MatchTag, Section, Slot, ViatorItem } from '../types';
import { classifyTags } from './classify';
import { sectionsForTags, primarySection } from './exploreItems';

// === Per-item fit scoring — the granular half of the matching engine ========
// The matcher used to match whole GROUPS by a single overlapping tag and then
// show a fixed `is_best_seller` item that was never checked against the answers
// — so a $2300 luxury yacht could be the face of "Sailing & Cruises" for a
// budget couple. This module classifies every item (budget / interests /
// adventure via classify.ts) and scores it against the questionnaire, so each
// group card can show the best-FITTING item for that person, with a hard
// over-budget guard. Pure + unit-tested.

// Budget bands cheap → splurge. The index gap drives the over-budget guard.
const BUDGET_ORDER: MatchTag[] = ['budget', 'mid-range', 'treat-yourself', 'money-no-object'];
const isBudgetTag = (t: MatchTag) => BUDGET_ORDER.includes(t);
const budgetIdx = (t: MatchTag | undefined) => (t ? BUDGET_ORDER.indexOf(t) : -1);

// Per-tier daily spending ceiling (USD) implied by the budget answer. Used two
// ways: (1) no single activity priced above the cap is ever shown at that tier
// — the per-item guard below, enforced on every surface; (2) the generator caps
// the trip's AVERAGE daily activity spend at it (a pool of cap × days), so days
// can vary but the trip averages out. Mirrors the questionnaire copy (mid-range
// = "~$100–200/day").
export const BUDGET_DAY_CAP: Partial<Record<MatchTag, number>> = {
  'budget': 110,
  'mid-range': 200,
  'treat-yourself': 400,
  // money-no-object: no cap
};
export function budgetCap(tags: Set<MatchTag>): number {
  for (const b of BUDGET_ORDER) if (tags.has(b)) return BUDGET_DAY_CAP[b] ?? Infinity;
  return Infinity;
}

// Coarse adventure value per Explore section (0 chill … 100 adrenaline); an
// item's value is the max across its sections. Only used when an item has no
// curated `adventure` number — i.e. every live Viator item.
const SECTION_ADVENTURE: Record<Section, number> = {
  'adventures-outdoor': 75,
  'cruises-water':      45,
  'tours-sightseeing':  30,
  'culture-history':    20,
  'food-drink':         15,
  'beaches':            10,
};
const adventureFromSections = (sections: Section[]) =>
  sections.reduce((m, s) => Math.max(m, SECTION_ADVENTURE[s] ?? 30), 0);

export function itemSections(item: ViatorItem): Section[] {
  return item.sections ?? sectionsForTags(item.tags);
}

// --- Slot suitability -------------------------------------------------------
// Live Viator items carry no time-of-day, only their group's allowed_slots — so
// an off-road tour mis-grouped into an evening-allowed group can land at night.
// The evening slot is for evening experiences (dinner, sunset, drinks, shows);
// everything else is daytime. Daytime slots accept anything.
//
// Evening suitability is judged from the TITLE alone. We deliberately do NOT
// treat the food-drink section as an evening signal: on the live catalog the
// food-drink cluster is a grab-bag that also holds all-inclusive *day trips*,
// *morning* champagne sails, *breakfast* cruises and daytime walking/tasting
// tours — none of which belong at night. Those all lack an evening keyword, so
// a title-only test keeps them in daytime slots while still catching genuine
// evening experiences (sunset sails, dinner cruises, nightlife, cocktails).
const EVENING_RE = /sunset|dinner|night|evening|happy hour|nightlife|cocktail|after dark/i;
export function isEveningItem(item: ViatorItem): boolean {
  return EVENING_RE.test(item.title);
}
export function itemSlotOk(item: ViatorItem, slot: Slot): boolean {
  if (slot === 'evening') return isEveningItem(item);
  return !isEveningItem(item); // morning/afternoon: never surface evening-only items
}

// --- Activity kind (for same-day variety) -----------------------------------
// A coarse "what kind of thing is this" key so the generator won't put two near-
// duplicate activities on one day (e.g. an ATV desert tour and a Jeep safari —
// the same off-road tour with a different vehicle). Defining Viator tags first
// (vehicle/water-sport type), else the primary Explore section.
const KIND_BY_TAG: ReadonlyArray<readonly [readonly number[], string]> = [
  [[12035, 21421, 13126, 21704, 12038], 'offroad'], // 4WD / ATV / off-road / buggy / safari
  [[11912], 'snorkel'],
  [[12021], 'dive'],
  [[12062], 'jetski'],
  [[12047], 'kayak'],
  [[11974], 'sup'],
  [[13209], 'parasail'],
  [[13202], 'surf'],
  [[11888, 11885, 12979, 11963], 'sail'], // sailing / day cruise / catamaran / sunset
  [[11902], 'hike'],
  [[11973], 'horseback'],
  [[13143], 'zipline'],
];
export function activityKind(item: ViatorItem): string {
  const tags = new Set(item.tags ?? []);
  for (const [ids, kind] of KIND_BY_TAG) if (ids.some((t) => tags.has(t))) return kind;
  return `sec:${primarySection(itemSections(item))}`;
}

// The questionnaire MatchTags a live item satisfies (budget + interests + adventure band).
export function itemTags(item: ViatorItem): MatchTag[] {
  const sections = itemSections(item);
  const adventure = item.adventure ?? adventureFromSections(sections);
  return classifyTags({ priceUsd: item.price_usd, sections, adventure });
}

const userBudget = (tags: Set<MatchTag>) => BUDGET_ORDER.find((b) => tags.has(b));

export type ItemFit = { score: number; rejected: boolean };

// Score one item against the answers. The budget guard is HARD: an item two or
// more bands above the user's budget is rejected outright (a money-no-object
// yacht never reaches a budget/mid-range traveller). Everything else is additive
// so the best-fitting, most-booked item wins.
export function fitItem(item: ViatorItem, tags: Set<MatchTag>): ItemFit {
  // Hard per-item cap: no activity priced above the tier's daily budget is ever
  // shown (a $2300 yacht never reaches a budget/mid-range traveller, on any
  // surface). The trip-average cap is enforced separately in the generator.
  if (item.price_usd > budgetCap(tags)) return { score: -Infinity, rejected: true };

  const itags = itemTags(item);
  const ubi = budgetIdx(userBudget(tags));
  const ibi = budgetIdx(itags.find(isBudgetTag));

  let score = 0;
  // Interest + adventure-band overlap — the strongest fit signal.
  for (const t of itags) if (!isBudgetTag(t) && tags.has(t)) score += 3;
  // Budget closeness: exact band best; one over neutral; cheaper fine.
  if (ubi >= 0) {
    const d = ibi - ubi;
    score += d === 0 ? 3 : d === 1 ? 0 : 1;
  }
  // Popularity — catalog-relative percentile (0–1), scaled to 0–3 so a
  // broadly-loved item (catamaran, sunset sail) reliably outscores a niche one
  // (kayak photo shoot, submarine) within the same interest/budget tier.
  // popularity_score is set at catalog load time by normalizePopularity() and
  // self-adjusts as the catalog grows; ?? 0 keeps test fixtures that don't set
  // it from throwing.
  score += (item.popularity_score ?? 0) * 3;
  return { score, rejected: false };
}

// Best-fitting item for the answers, or null when every item is over budget.
export function bestItemForAnswers(items: ViatorItem[], tags: Set<MatchTag>): ViatorItem | null {
  let best: ViatorItem | null = null;
  let bestScore = -Infinity;
  for (const it of items) {
    const f = fitItem(it, tags);
    if (f.rejected) continue;
    if (f.score > bestScore) { bestScore = f.score; best = it; }
  }
  return best;
}

// Re-face every group entry with the best-fitting item for the answers, and
// drop groups whose entire inventory is over budget. Local-activity entries pass
// through untouched. This is what makes both generation and swap show items that
// actually match the questionnaire.
//
// `excludeIds` (optional) removes specific item ids from consideration — both
// group faces and local picks. The generator passes the trip's already-used ids
// so each group re-faces to its best *unused* item, letting one group surface a
// different item on each day (a group with 20 dinner cruises fills 20 evenings
// without ever repeating). Without it (swap, tests) behaviour is unchanged.
export function refaceForAnswers(
  entries: CardEntry[], tags: Set<MatchTag>, slot?: Slot, excludeIds?: Set<string>,
): CardEntry[] {
  const out: CardEntry[] = [];
  for (const e of entries) {
    if (e.kind !== 'group') {
      if (excludeIds?.has(e.activity.id)) continue; // a used local pick is exhausted
      // When a slot is given, only include activities whose timeOfDay matches.
      // matchPool pre-filters the primary pool, but widePool/anyPool fallbacks
      // in the swap pass the full catalog.activities without pre-filtering.
      if (slot) {
        const tod = slot === 'morning' ? 'Morning' : slot === 'afternoon' ? 'Afternoon' : 'Evening';
        if (e.activity.timeOfDay !== tod) continue;
      }
      out.push(e);
      continue;
    }
    // Pick the best-FITTING item as the card face (→ the stored bestSellerId),
    // so the group is scored and chosen by what the traveller would actually be
    // shown, not an arbitrary best-seller. Drop groups with nothing that fits.
    // When a slot is given, only slot-appropriate items are eligible (no daytime
    // tour in the evening), so a group with no evening item is dropped there.
    // The rendered "Other suggestions" are filtered at DISPLAY time in
    // resolveSlotEntry — the plan only stores the face id, so that's the one
    // place that controls every item the card shows.
    const pool = [e.bestSeller, ...e.others].filter(
      (i) => (!slot || itemSlotOk(i, slot)) && !excludeIds?.has(i.id),
    );
    const face = bestItemForAnswers(pool, tags);
    if (!face) continue;
    out.push({ ...e, bestSeller: face, others: pool.filter((i) => i.id !== face.id) });
  }
  return out;
}
