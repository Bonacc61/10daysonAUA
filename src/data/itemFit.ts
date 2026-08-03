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

// Adventure value per activity KIND (0 chill … 100 adrenaline). Preferred over
// the section average because a section is far too blunt to gate a
// contraindication on: everything on the water shares 'cruises-water' (45), so a
// section-only cap threw out a gentle sunset catamaran for a `with-baby` (25) or
// `mobility` (30) traveller alongside the kitesurfing it was aimed at — the
// catamaran staple included. Kind comes from the item's own Viator tags.
// Values are chosen against the caps that read them (see applyCatalogFlags):
// with-baby 25, mobility 30, intense-hikes 52. Anything a cap must exclude has
// to sit strictly ABOVE it — `hike: 50` let every Viator hiking product through
// the intense-hikes cap while the equivalent curated local (arikok-hiking, 55)
// was correctly dropped, and `snorkel: 30` tied the mobility cap exactly.
const KIND_ADVENTURE: Record<string, number> = {
  sail: 15, kayak: 35, sup: 35, horseback: 40,
  snorkel: 32,   // > mobility 30: open-water entry off a boat
  hike: 55,      // > intense-hikes 52; matches the curated arikok-hiking local
  dive: 58, parasail: 60, jetski: 70, surf: 75, offroad: 80, zipline: 85,
};

// An item's adventure value (0 chill … 100 adrenaline). Derived from the item's
// OWN Viator tags, which the live feed gets right — unlike group_id, which it
// does not (80% of Aruba's off-road products are filed under "Sailing &
// Cruises"). Exported so the contraindication caps can filter per item instead
// of per group; a group-level cap let a 4x4 Natural Pool jeep tour through to a
// traveller who told us they have mobility limits.
export function itemAdventure(item: ViatorItem): number {
  if (item.adventure !== undefined) return item.adventure;
  const byKind = KIND_ADVENTURE[activityKind(item)];
  return byKind ?? adventureFromSections(itemSections(item));
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

// The section an item belongs to for MATCHING/grouping purposes. Prefers the
// item's activity kind over primarySection, because primarySection resolves ties
// by Explore's tab order — and 'cruises-water' sits first. A jeep safari that
// also carries a boat tag (Aruba's #1 product, "Island Jeep Safari with Natural
// Pool, Baby Beach and Lunch", does) therefore resolved to cruises-water and got
// filed as a watersport. Kind comes from the item's own tags and puts off-road
// ahead of sail, which is the answer a traveller would give.
const KIND_SECTION: Record<string, Section> = {
  offroad: 'adventures-outdoor', hike: 'adventures-outdoor',
  horseback: 'adventures-outdoor', zipline: 'adventures-outdoor',
  sail: 'cruises-water', snorkel: 'cruises-water', dive: 'cruises-water',
  jetski: 'cruises-water', kayak: 'cruises-water', sup: 'cruises-water',
  parasail: 'cruises-water', surf: 'cruises-water',
};
export function matchingSection(item: ViatorItem): Section {
  return KIND_SECTION[activityKind(item)] ?? primarySection(itemSections(item));
}

// Water/boat experiences — used by the no-boats (seasick) filter. Any item whose
// Explore section is cruises-water, or whose Viator tag-kind is a water sport,
// counts. Catches sunset sails, dinner cruises and snorkel trips that live in
// non-"watersports" groups (e.g. sailing-cruises), which the old group-level
// filter missed — the exact items a seasick traveller must never be shown.
const WATER_KINDS = new Set(['sail', 'snorkel', 'dive', 'jetski', 'kayak', 'sup', 'parasail', 'surf']);
// Last-resort title net. Both signals above are metadata, and the live feed's
// metadata is not reliable enough to stake a medical constraint on: the "Luxury
// Four-Course Caribbean Dinner Cruise" is filed under food-drink-experiences
// with no sailing tag, so it passed both tests and reached seasick travellers.
// A title that says cruise/sail/catamaran IS a boat, whatever the feed claims.
// "Sail" needs a word boundary so "sailfish" / "Sailors' Museum" don't match.
const WATER_TITLE_RE = /\b(cruise|cruises|sail|sails|sailing|catamaran|boat|yacht|kayak|snorkel(?:ing)?|submarine|ferry)\b/i;
export function isWaterBased(item: ViatorItem): boolean {
  if (itemSections(item).includes('cruises-water')) return true;
  if (WATER_KINDS.has(activityKind(item))) return true;
  return WATER_TITLE_RE.test(item.title);
}

// --- Crowd-pleasers (universal high-bookability picks) ----------------------
// A curated set of experience *types* that travellers reliably book and love —
// the ones you'd recommend to a friend regardless of their budget or adrenaline
// appetite (catamaran/sailing cruises, snorkel trips incl. Jolly Pirates, sunset
// sails & dinner cruises, and the Natural Pool / Arikok jeep tours). Identified
// by Viator tag-kind (robust on live data — survives product-code churn) plus
// destination keywords for the two location-specific ones. This is the lever
// that keeps the plan leading with things people actually book instead of niche
// listings (kayak photo shoots, submarine tours) that erode trust in the picks.
//
// Boat-based crowd-pleasers are stripped upstream by the `no-boats` flag before
// scoring, so a traveller who flags seasickness never has them boosted.
const CROWD_PLEASER_DEST = /natural pool|arikok|conchi/i;
// "sunset" (sails/cruises) and "dinner cruise" specifically — NOT any title with
// "dinner", so a landlocked farmhouse or steakhouse dinner isn't boosted for
// every persona. Land dinners still surface via normal food-drink interest fit.
const CROWD_PLEASER_EVENING = /sunset|dinner/i;
// ...and it must actually BE a sail or cruise. "sunset" alone over-matched badly
// on live data: a 6-review sunset photoshoot, a 39-review sip-and-paint class and
// a 12-review Hooiberg hike all counted as crowd-pleasers, which both exempted
// them from the popularity floor and handed them the +3 boost — letting exactly
// the niche listings this lever exists to suppress lead the plan instead.
const EVENING_VESSEL_RE = /\b(sail|sails|sailing|cruise|cruises|catamaran|boat|yacht)\b/i;
// Products that are a purchase or a service rather than a thing you do with a
// slot in your day. These are excluded from AUTO-FILL only: they stay in
// Explore, stay searchable, and still land in the plan if the traveller hearts
// one, because a pin resolves against the un-narrowed catalog. The rule is
// "we won't suggest this unasked", not "you can't have it".
//
// Measured on the live catalog before this existed: "Diamond Shopping
// Experience with Champagne" (216 reviews, so the review gate waves it through)
// was auto-placed in 15 of 45 generated plans, and photography sessions in 16.
// Review count cannot catch these — they are well-reviewed, they are simply not
// an outing.
const RETAIL_RE = /\b(shopping|diamonds?|jewel\w*|duty[- ]free|timeshare)\b/i;
// Anchored on the SHOOT, not on the word 'photographer': a dive listed as
// "Private Dive + videographer/Photographer" is a dive, not a photo service.
const PHOTO_SERVICE_RE = /\b(photoshoot|photography)\b|\bphoto shoot\b/i;

// Self-drive vehicle hire: you are handed a vehicle for the day, with no guide,
// no route and no content. "Harley-Davidson RENTALS ONLY 8 hrs" says so in its
// own title, and at 8 hrs it equals DAY_CAP_MIN exactly — auto-placing it turns
// a day of the itinerary into "here is a motorbike, good luck" and leaves no
// room for anything else. It was the single most-placed rental (15 of 54 trips).
//
// The word "rental" alone is too blunt: it must pair with a VEHICLE or an
// explicit self-drive phrase. That keeps the 30-minute Aruba Jet Ski Rental
// (214 reviews) — a normal beach watersport — and keeps guided dives that
// merely mention "rental equipment" in the title.
//
// Known gap: "Honda Talon 4 Seater Rental" is a UTV under a model name the
// pattern does not know. Left alone rather than chasing model names — it has 4
// reviews, so MIN_CHAMPION_REVIEWS already keeps it out of the fill pool.
const HIRE_RE = /\b(rental|rentals|hire)\b/i;
const VEHICLE_RE = /\b(harley|motorcycle|motorbike|utv|atv|quad|buggy|jeep|scooter|moped|golf cart|car)\b/i;
const SELF_DRIVE_RE = /\brentals only\b|\bon your own\b|\bself[- ]drive\b/i;

/**
 * True for products the generator must never suggest unasked. Auto-fill only —
 * Explore still lists them, search still finds them, and hearting one still
 * places it, because pins resolve against the un-narrowed catalog.
 */
export function isAutoFillExcluded(item: ViatorItem): boolean {
  const t = item.title;
  return RETAIL_RE.test(t)
    || PHOTO_SERVICE_RE.test(t)
    || (HIRE_RE.test(t) && (VEHICLE_RE.test(t) || SELF_DRIVE_RE.test(t)));
}

export function isCrowdPleaser(item: ViatorItem): boolean {
  const kind = activityKind(item);
  if (kind === 'sail' || kind === 'snorkel') return true;          // catamarans, snorkel + Jolly Pirates
  if (kind === 'offroad' && CROWD_PLEASER_DEST.test(item.title)) return true; // Natural Pool / Arikok jeep tours
  // sunset sails, dinner cruises — the evening word AND a vessel word.
  if (CROWD_PLEASER_EVENING.test(item.title) && EVENING_VESSEL_RE.test(item.title)) return true;
  return false;
}

// Aruba's off-road tours (Jeep / UTV / ATV / buggy) all run the same north-coast
// + Arikok + Natural Pool circuit, so they're one experience — the plan should
// carry at most one (see routeFamilyOf in the generator). This splits that one
// slot by ADRENALINE: self-drive UTV/ATV/buggy rentals are the high-thrill pick,
// guided jeep tours the comfortable one. The generator prefers self-drive for a
// high-adventure traveller and guided for a low-adventure one.
// Genuine self-drive adrenaline vehicles only — NOT "jeep rental" or an
// "e-scooter rental" (the broad word "rental" over-matched those).
const SELF_DRIVE_OFFROAD = /\b(utv|atv|quad|quads|buggy|buggies|dune ?buggy)\b/i;
export function isSelfDriveOffroad(item: ViatorItem): boolean {
  return activityKind(item) === 'offroad' && SELF_DRIVE_OFFROAD.test(item.title);
}

// Adrenaline nudge for the single off-road slot: a high-adventure traveller is
// pushed toward the self-drive UTV/ATV, a low-adventure one toward the guided
// jeep. Big enough to beat the crowd-pleaser boost that otherwise pins every
// budget onto a guided Natural-Pool jeep. Applied in BOTH face selection
// (bestItemForAnswers) and slot scoring so the chosen face is the right sub-type.
const ADRENALINE_BONUS = 5;
export function offroadAdrenalineBonus(item: ViatorItem, tags: Set<MatchTag>): number {
  if (activityKind(item) !== 'offroad') return 0;
  const selfDrive = isSelfDriveOffroad(item);
  if (tags.has('high-adventure') && selfDrive) return ADRENALINE_BONUS;
  if (tags.has('low-adventure') && !selfDrive) return ADRENALINE_BONUS;
  return 0;
}

// Scoring bonus for a crowd-pleaser — comparable in weight to a strong interest
// match (+3), so a universal favourite competes with, and usually beats, a
// niche or narrowly-expensive option in the same slot, without erasing the
// persona-specific picks the traveller explicitly asked for.
const CROWD_PLEASER_BOOST = 3;

// The questionnaire MatchTags a live item satisfies (budget + interests + adventure band).
export function itemTags(item: ViatorItem): MatchTag[] {
  // itemAdventure, not adventureFromSections: the contraindication caps and the
  // Q5 adventure band must read the SAME number. Deriving them separately had a
  // sunset catamaran counted as 15 by the cap and 45 (med-adventure) by the
  // scorer for every kind in KIND_ADVENTURE.
  return classifyTags({
    priceUsd: item.price_usd,
    sections: itemSections(item),
    adventure: itemAdventure(item),
  });
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

  const cp = isCrowdPleaser(item);

  let score = 0;
  // Interest + adventure-band overlap — the strongest fit signal.
  for (const t of itags) if (!isBudgetTag(t) && tags.has(t)) score += 3;
  // Budget closeness: exact band best; one over neutral; cheaper fine. Crowd-
  // pleasers are NOT penalised for being under the user's budget — a great cheap
  // experience is worth recommending to anyone, including a money-no-object
  // traveller (a $65 Jolly Pirates cruise competes with a $1,450 charter).
  if (ubi >= 0) {
    const d = ibi - ubi;
    if (d === 0) score += 3;              // exact tier
    else if (d === 1) score += 0;         // one tier over — neutral
    else if (d < 0) score += cp ? 3 : 1;  // cheaper — full credit for crowd-pleasers
    else score += 1;                       // 2+ over (rare; usually hard-capped above)
  }
  // Curation boost: nudge universally-loved experiences to the top of the slot,
  // budget- and adrenaline-agnostic, to maximise the odds the traveller books.
  if (cp) score += CROWD_PLEASER_BOOST;
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
    const score = f.score + offroadAdrenalineBonus(it, tags);
    if (score > bestScore) { bestScore = score; best = it; }
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
