import type { CardEntry, MatchTag, Section, Slot, ViatorItem } from '../types';
import { classifyTags } from './classify';
import { sectionsForTags, primarySection } from './exploreItems';
import { ITEM_PINS, CHECKIN_QUOTES } from './itemCoords';
import { scheduleTimeOfDay } from './startTimes';

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
// Contraindication flag → the adventure ceiling it imposes, in the order the
// generator has always resolved them. FIRST MATCH WINS, not the tightest: a
// traveller who ticks both `mobility` and `with-baby` gets 30, not 25. That is
// existing behaviour, preserved here deliberately — this table was extracted so
// applyCatalogFlags (the plan) and constrainByEdit (a swap) cannot drift apart,
// not to change what either one does. Whether first-match is the right rule for
// two stacked contraindications is a real question, and a separate one.
export const FLAG_ADVENTURE_CAP: ReadonlyArray<readonly [flag: string, cap: number]> = [
  ['mobility', 30],       // excludes arikok, natural pool, kitesurfing
  ['intense-hikes', 52],  // excludes arikok ~55, natural pool ~70, kitesurfing ~85
  ['with-baby', 25],      // keeps beaches, food, sunsets; drops snorkel, hikes, watersports
];

export function adventureCapForFlags(flags: ReadonlySet<string>): number | null {
  for (const [flag, cap] of FLAG_ADVENTURE_CAP) if (flags.has(flag)) return cap;
  return null;
}

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

// Conchi — the Natural Pool — sits inside Arikok National Park, and the park
// gates close at 16:00. Anything that has to drive through Arikok to reach it is
// a MORNING trip or it does not happen: an afternoon departure cannot get in,
// round the north coast and back out before closing. Matched on the title
// because it is the only reliable signal — 22 live products mention it and they
// classify as four different activity kinds (off-road, hike, cruise, snorkel),
// so nothing derived from tags covers them all.
const NATURAL_POOL_RE = /natural pool|conchi/i;
export function isNaturalPool(item: { title: string }): boolean {
  return NATURAL_POOL_RE.test(item.title);
}

// Some products say when they run in their own title — "Premium Catamaran
// Afternoon Sail", "UTV Morning Tour". 14 live products do. The engine used to
// read only evening-vs-daytime, so the Jolly Pirate AFTERNOON sail was being
// suggested as a morning card: the itinerary contradicted the product name it
// was printing.
//
// "morning or afternoon" means the operator runs both and the traveller picks,
// so it must NOT pin — a naive first-match rule would read it as morning-only.
// "or midday/noon" is in there for "Sea Glass Island Kayak Tour Aruba in Morning
// or Midday", which is the same offer worded differently.
const TOD_BOTH_RE = /\b(morning|afternoon)\s+or\s+(morning|afternoon|midday|noon)\b/i;
const TOD_TITLE_RE = /\b(morning|afternoon)\b/i;
export function titleTimeOfDay(item: { title: string }): 'morning' | 'afternoon' | undefined {
  if (TOD_BOTH_RE.test(item.title)) return undefined;
  const m = item.title.match(TOD_TITLE_RE);
  return m ? (m[1].toLowerCase() as 'morning' | 'afternoon') : undefined;
}

// Correctness-level slot suitability: an evening product belongs in an evening,
// Conchi belongs in a morning. This is what the DISPLAY chokepoint
// (`resolveSlotEntry`) reads, so it must stay a statement about what would be
// wrong — never a preference — or every stored plan re-faces the moment the
// preference changes.
export function itemSlotOk(item: ViatorItem, slot: Slot): boolean {
  if (isNaturalPool(item)) return slot === 'morning'; // Arikok shuts at 16:00
  if (slot === 'evening') return isEveningItem(item);
  return !isEveningItem(item); // morning/afternoon: never surface evening-only items
}

// The stricter rule used when CHOOSING what to suggest: also honour a time of
// day the product states in its own name, so the "Jolly Pirate Afternoon Sail"
// is never offered as a morning card.
//
// Deliberately separate from `itemSlotOk`. Folding this in there reached
// `resolveSlotEntry`, which re-faces a stored card whose id is not in the
// slot-filtered pool — so ~5% of Viator cards in already-saved and
// already-SHARED itineraries silently became a different product. A shared link
// showing something other than what was shared is a worse outcome than an
// imperfectly-slotted card in an old plan.
// Since 2026-08-13 the product's own Viator SCHEDULE is consulted where the
// title says nothing, which is most of the catalog: 316 of 328 carry no
// morning/afternoon word at all, and 114 of those sit outside the evening regex
// and depart only ever before noon or only ever after.
// That is what stopped a 9am walking tour being offered as an afternoon card
// while its own card said "Departs 9:00am".
//
// Title first, schedule second — not because the title is better evidence, but
// because it is the operator's own naming and the two never disagree: measured
// across all 328 products, ZERO titles are contradicted by their schedule. The
// order is therefore free, and this way the fallback cannot overturn a stated
// name if that ever changes.
//
// Still only here, never in `itemSlotOk`, for the reason above it.
export function itemSlotOkForFill(item: ViatorItem, slot: Slot): boolean {
  if (!itemSlotOk(item, slot)) return false;
  if (slot === 'evening') return true;
  // The Arikok gate beats a published departure time where they disagree, but
  // it does NOT beat the product's own name. 441143P8 ("Natural Pool Jeep
  // Adventure") publishes a single 14:00 departure while the park closes at
  // 16:00, and `itemSlotOk` has already pinned it to a morning — so consulting
  // the schedule made it false for morning AND false for afternoon, and the
  // product vanished from the fill ladder, the swap pool and the rotate path
  // with nothing anywhere saying why. Dropping it is the one response that
  // helps nobody: physical access wins.
  //
  // Only the SCHEDULE is suppressed, not the title check above it. A blanket
  // early return would also make a future "Natural Pool Afternoon Tour"
  // eligible for mornings. No live product needs that today — none of the 22
  // matching this regex carries a time word — which is exactly why it has to be
  // written down rather than left to a `return true`.
  const tod = titleTimeOfDay(item)
    ?? (isNaturalPool(item) ? undefined : scheduleTimeOfDay(item.id));
  return tod === undefined || tod === slot;
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
// A SECOND layer, read only where the tags say nothing.
//
// The tag feed is authoritative when it speaks, and silent for 144 of 328
// products — which then fell back to `sec:<section>`, i.e. to the Explore
// CATEGORY. That is far too coarse to dedupe on: 74 products shared
// `sec:tours-sightseeing`, so the engine believed a submarine, a bus tour and a
// walking tour were the same kind of thing and suppressed them as duplicates of
// each other.
//
// The titles were carrying the answer the whole time. `sec:cruises-water` held
// "2-Tank guided Dive", "Night Shore Diving", "Private Sailing", "Kids
// Parasailing" and a horseback tour mis-filed into the water section;
// `sec:adventures-outdoor` held four horseback tours, a UTV and a jeep.
//
// DELIBERATELY the same twelve kinds, no new vocabulary. Every kind carries an
// adrenaline value in KIND_ADVENTURE that the contraindication caps read
// (mobility 30, intense-hikes 52, with-baby 25), so inventing a thirteenth is a
// decision about who gets excluded from a plan — a separate, product-level call.
// This only recovers products that ARE one of the twelve and were missing a tag.
//
// Order is priority, not preference: a title naming two activities resolves to
// the one that defines the outing. "Champagne Sailing and Snorkelling" is a sail
// with snorkelling on it, not a snorkel trip on a boat.
//
// Word boundaries throughout, because the failure mode is a false positive on a
// place name — Aruba has a Surfside Beach, and `surf` without a boundary would
// file a beach picnic as a watersport.
const KIND_BY_TITLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(utv|atv|4x4|4wd|off[\s-]?road|jeep|buggy|dune ?buggy)\b/i, 'offroad'],
  [/\bhorse ?back|\bhorse ?riding\b/i, 'horseback'],
  [/\bparasail(ing)?\b/i, 'parasail'],
  [/\bzip[\s-]?lin(e|ing)\b/i, 'zipline'],
  [/\bjet[\s-]?ski/i, 'jetski'],
  [/\bkayak/i, 'kayak'],
  [/\bpaddle[\s-]?board(ing)?\b/i, 'sup'],
  [/\b(scuba|padi)\b|\bdiv(e|ing)\b/i, 'dive'],
  [/\b(sail(ing|boat)?|catamaran|trimaran)\b/i, 'sail'],
  [/\bsnorkel(ing|ling)?\b/i, 'snorkel'],
  [/\bsurf(ing|board)?\b/i, 'surf'],
  [/\bhik(e|ing)\b|\btrek(king)?\b/i, 'hike'],
];

/** The kind a product's TITLE names, or '' when it names none of the twelve. */
export function titleKind(item: { title: string }): string {
  for (const [re, kind] of KIND_BY_TITLE) if (re.test(item.title)) return kind;
  return '';
}

// Every kind KIND_BY_TAG can produce. Enrichment may only speak in this
// vocabulary — a value outside it is a schema violation, not a new kind.
export const KIND_VOCABULARY: ReadonlySet<string> = new Set(KIND_BY_TAG.map(([, kind]) => kind));

export function activityKind(item: ViatorItem): string {
  const tags = new Set(item.tags ?? []);
  for (const [ids, kind] of KIND_BY_TAG) if (ids.some((t) => tags.has(t))) return kind;
  // Enrichment speaks only where the tags do not — the 144 live items that
  // would otherwise land in a generic `sec:` bucket. The 184 that KIND_BY_TAG
  // resolves are measured and are never overridden.
  if (item.enriched_kind) return item.enriched_kind;
  // NOT `titleKind` — deliberately, and this is the trap. `activityKind` is not
  // only a dedup key: regroupItems() calls matchingSection(), which reads
  // KIND_SECTION, so changing an item's kind RE-FILES IT INTO A DIFFERENT GROUP.
  // Wiring the title layer in here recovered 35 of the 144 generic items and
  // filled six more slots per 20 plans — and also moved a $2,300 yacht into a
  // group a budget-conscious traveller sees, failing two engine-coverage tests
  // and one flags test. See ROADMAP item 13.
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

/**
 * Where a water-based trip collects you — the one thing you must get right or
 * you miss the boat. Returns null unless a HUMAN-VERIFIED collection point is
 * on record.
 *
 * Not scoped to water since 2026-08-15 — see the comment on the source check
 * below. `DepartureNote` says "from" for a boat and "at" for anything else, so
 * a ranch or a restaurant reads correctly as a meeting point rather than a pier.
 *
 * There is no automatic source for this. Measured 2026-08-12 across the live
 * catalog: of 135 water-based items, exactly ONE description mentions a clock
 * time and ONE mentions check-in or boarding — zero carry a time, a check-in
 * cue and a place together. The 2026-08-03 Viator probe
 * (docs/map/viator-location-probe.md) independently found the API's
 * meeting-point refs unusable: ~29% resolve at all, and the ones that do are
 * hotels on a pickup round. So this reads the committed pin registry and
 * nothing else, exactly as coordinates do.
 *
 * A check-in line is therefore absent on most cards and omitted rather than
 * guessed. Adding a verbatim entry to CHECKIN_QUOTES makes it appear with no
 * code change.
 *
 * `Pin.pickup` is deliberately NOT consulted: no pin in the registry carries
 * one, so a branch for it would be untested code standing in for data that
 * does not exist.
 */
export function departurePointFor(
  item: ViatorItem,
): { place: string; checkin?: string; approx: boolean } | null {
  // NOT gated on `isWaterBased` since 2026-08-15. It used to be, on the reading
  // that only a boat has a collection point — but a walking food tour meets at a
  // named restaurant and a horseback ride at a named ranch, and 17 live products
  // had a human-verified meeting point that the card threw away. What makes a
  // place safe to print is the pin's SOURCE, checked below; the terrain never
  // was the safeguard.
  const pin = ITEM_PINS[item.id];
  // ONLY a 'departure' pin means "this is the collection point". A
  // 'known-place' pin is the DESTINATION — rendering "departs from SS Antilla
  // wreck" would point a traveller at a WW2 shipwreck lying offshore, and two
  // live sail products are pinned exactly that way.
  if (!pin || pin.source !== 'departure' || !pin.place) return null;
  // `approx` marks a pin the registry itself calls a deliberate approximation —
  // the hotel a meeting-point description names rather than the pier on its
  // beach, or a bare street name. 11 of the 35 qualifying cards are these. They
  // are still worth showing (right beach, right hotel) but must not be stated
  // as the doorway, so the card says "near" there and never "from".
  return { place: pin.place, checkin: CHECKIN_QUOTES[item.id], approx: !!pin.approx };
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
// slot in your day. Photo services and vehicle hire are excluded from AUTO-FILL
// only: they stay in Explore, stay searchable, and still land in the plan if the
// traveller hearts one, because a pin resolves against the un-narrowed catalog.
// The rule for those is "we won't suggest this unasked", not "you can't have it".
//
// RETAIL is different — see isRetailProduct below, which activitySource drops
// from the catalog outright.
//
// Measured on the live catalog before this existed: "Diamond Shopping
// Experience with Champagne" (216 reviews, so the review gate waves it through)
// was auto-placed in 15 of 45 generated plans, and photography sessions in 16.
// Review count cannot catch these — they are well-reviewed, they are simply not
// an outing.
const RETAIL_RE = /\b(shopping|diamonds?|jewel\w*|duty[- ]free|timeshare)\b/i;

/**
 * Shopping trips, diamond showrooms, duty-free and timeshare pitches. Not an
 * outing at all — a retail errand with a booking page.
 *
 * `isExcludedFromCatalog` (activitySource) drops these before the catalog is
 * built, so they never reach Explore, search, the swap pool or a plan. Kept in
 * `isAutoFillExcluded` too: that is the guard for the offline stub and for any
 * future path that builds a catalog without going through loadCatalog.
 *
 * Word-boundary anchored, which matters more than it looks — "Small-Group"
 * contains "mall", and there are five such products on the live catalog.
 */
export function isRetailProduct(item: ViatorItem): boolean {
  return RETAIL_RE.test(item.title);
}
// Anchored on the SHOOT, not on the word 'photographer': a dive listed as
// "Private Dive + videographer/Photographer" is a dive, not a photo service.
const PHOTO_SERVICE_RE = /\b(photoshoot|photography)\b|\bphoto shoot\b/i;

// Products that hand the traveller usable photo/video content — a sunset
// photoshoot, a turtle snorkel with "Professional video footage", a clear-kayak
// drone shoot. What most travellers treat as an upsell is the whole point of the
// trip for someone who ticked "I'm an influencer" in Q8, so the flag both lifts
// the auto-fill block above and boosts these in scoring.
//
// Deliberately BROADER than PHOTO_SERVICE_RE, and deliberately a substring test
// rather than word-anchored. The two regexes answer opposite questions: the
// exclusion is a quality floor, so it stays conservative; this one is opt-in by
// an explicit request, so a miss is worse than a loose match. Word boundaries
// cost real inventory here — two live products advertise the operator handle
// "@arubaphotoshootexperience", where nothing precedes "photo" but a letter.
// The substrings have no false friends in tour titles: everything containing
// "photo" (photographer, photogenic) or "video" (videographer, videoshoot) is
// the thing being asked for.
const CONTENT_CREATOR_RE = /photo|video/i;
export function isContentProduct(item: ViatorItem): boolean {
  return CONTENT_CREATOR_RE.test(item.title);
}

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
 *
 * `influencer` (the Q8 flag) lifts the PHOTO branch and only that branch: the
 * whole rule is "we won't suggest this unasked", and a traveller who ticked
 * "I'm an influencer" has asked. Retail and self-drive hire stay excluded —
 * a diamond showroom is not an outing for anyone, influencer or not.
 */
export function isAutoFillExcluded(item: ViatorItem, influencer = false): boolean {
  const t = item.title;
  return RETAIL_RE.test(t)
    || (!influencer && PHOTO_SERVICE_RE.test(t))
    || (HIRE_RE.test(t) && (VEHICLE_RE.test(t) || SELF_DRIVE_RE.test(t)));
}

// Products whose whole proposition is "somewhere to take the children" — an
// island water-park day pass, a kids' parasail. They are perfectly good
// products, they are simply the wrong thing to hand a couple or a solo
// traveller unasked, and the De Palm Island Day Pass (370 reviews, popularity
// 0.86, and a crowd-pleaser by kind because it carries a snorkelling tag) was
// scoring its way into every persona's plan.
//
// Signal, in order of trust:
//  1. Viator tag 12043 "Water Parks" — the feed's own classification. One
//     product in the app's catalog carries it, and it is De Palm Island. (The
//     raw feed has a second, "De Palm Island All-Inclusive Day Trip with
//     Transport" — 1,428 reviews — which isTransportOnly drops in the app,
//     because its title says "Transport" and EXPERIENCE_RE has no "trip". Note
//     that filter runs in loadCatalog, NOT in e2e-engine.test.ts, which builds
//     its catalog straight from the edge-function payload — so the e2e suite
//     does see that product even though production never does.)
//  2. A title net, because tag coverage is thin and churns: "day pass",
//     "water park", "kids".
//
// Viator's 11919 "Kid-Friendly" tag is deliberately NOT used. It is applied to
// 2 of 337 live products, and one of them is the 1,584-review "Full-Day Aruba
// History and Must-See Landmarks Tour" — a general tour that belongs in
// anyone's plan. The tag marks "children are welcome", not "this is for
// children", and gating on it would drop good products from adult plans.
//
// This gates AUTO-FILL only, like isAutoFillExcluded: the product stays in
// Explore, stays searchable, and a hearted one still lands in the plan.
const WATER_PARK_TAG = 12043;
const KIDS_TITLE_RE = /\bday pass\b|\bwater ?parks?\b|\bkids?\b|\bchildren'?s?\b/i;
// A product sold specifically to a couple: a proposal shoot, a romantic picnic
// for two, a couples painting class. Not a judgement about who may enjoy it —
// a solo traveller is welcome on a sunset sail, and this deliberately does NOT
// catch those. It catches titles that name the audience, because handing a
// PROPOSAL PHOTOSHOOT to someone who ticked "Solo" is the engine telling them
// it wasn't listening.
//
// Reported case: "Aruba Eagle Beach Romantic Sunset Picnic in a Luxury Cabana"
// in 90 of 120 Solo plans. It scored 1.6483516 as Solo, Couple and Friends
// alike — nothing in the engine asked who the traveller was.
//
// Explicit markers only. Measured over the 328 live items, this matches 6, and
// a wider pattern adding `intimate|anniversary` matches exactly the same 6 —
// so those two words earn nothing and only add false friends ("intimate group
// setting", a company's "20th Anniversary Tour"). `\bcouples?\b` is kept
// despite "a couple of hours" because that phrasing does not occur in a title.
const COUPLES_TITLE_RE = /\b(romantic|romance|couples?|honeymoon|proposal|for two)\b/i;
export function isCouplesOriented(item: ViatorItem): boolean {
  return COUPLES_TITLE_RE.test(item.title);
}

export function isKidsOriented(item: ViatorItem): boolean {
  return (item.tags ?? []).includes(WATER_PARK_TAG) || KIDS_TITLE_RE.test(item.title);
}

// A product that takes the whole daytime, whatever duration the feed reports.
// "Aruba De Palm Island Day Pass" says 6 hrs, which the slot maths reads as a
// long morning still leaving 120 minutes of the afternoon — but you take a
// ferry to an island and stay there; the day is spent. `entryDurationMin`
// floors these at FULL_DAY_MIN so the existing overrun rule clears the rest of
// the day on its own.
//
// Title-matched on "day pass", NOT on Viator's 11928 "Full-day Tours" tag. That
// tag is on 20 live products and is not trustworthy for this: it is applied to
// "Aruba Half day Private Jeep Tour" and to a 3-hour sightseeing boat tour.
// A pass IS the day; a tag that says so while the title says "half day" is not
// something to block an afternoon on.
const DAY_PASS_RE = /\bday pass\b/i;
export function isFullDayProduct(item: ViatorItem): boolean {
  return DAY_PASS_RE.test(item.title);
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

// Content boost for the `influencer` flag — the same weight as CROWD_PLEASER_BOOST,
// because that is what it is: a content product is to someone shooting the trip
// what a catamaran is to everyone else. Lifting the auto-fill block alone is not
// enough on its own; these listings are structurally low on reviews (median 9 on
// the live catalog) and popularity is worth up to +3, so they lose the tiebreaks.
//
// Measured on the live catalog (4 personas × 10 seeds, 7-day trips): the outcome
// is IDENTICAL for every value from 2 upward — 30/40 trips place a content
// product, 1 per trip. The ceiling is structural, not a scoring question: all
// four content products that clear the review floor sit in just two of the six
// Viator groups, and the group/cluster dedup rules allow one apiece. So this
// number only has to clear the knee at 2, and going higher buys nothing while
// costing the plan its marquee picks. Do not raise it expecting more placements.
const CONTENT_BOOST = 3;
export function contentCreatorBonus(item: ViatorItem, tags: Set<MatchTag>): number {
  return tags.has('influencer') && isContentProduct(item) ? CONTENT_BOOST : 0;
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
  // Q8 "Crowded spots" — see the tag's note in types.ts. Read here rather than
  // in applyCatalogFlags because the honest answer is a reordering, not an
  // exclusion, and applyCatalogFlags only knows how to remove things.
  const quiet = tags.has('avoid-crowds');

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
  // Suppressed for a traveller who asked to avoid crowds — `isCrowdPleaser` is
  // literally the "everyone books this" signal, and boosting it for someone who
  // ticked "crowded spots" would fight the answer they gave.
  if (cp && !quiet) score += CROWD_PLEASER_BOOST;
  // Popularity — catalog-relative percentile (0–1), scaled to 0–3 so a
  // broadly-loved item (catamaran, sunset sail) reliably outscores a niche one
  // (kayak photo shoot, submarine) within the same interest/budget tier.
  // popularity_score is set at catalog load time by normalizePopularity() and
  // self-adjusts as the catalog grows; ?? 0 keeps test fixtures that don't set
  // it from throwing.
  // Inverted for avoid-crowds, not zeroed: neutrality would only stop PREFERRING
  // the busy ones, and the traveller asked for the opposite of busy. A quiet
  // beach at the 10th percentile now scores where a headline catamaran did.
  //
  // Deliberately a preference and not a filter. Popularity is a proxy for crowds
  // — a good one on this catalog, where the most-reviewed products are the mass
  // catamarans and the island day-pass — but only a proxy, and hard-excluding on
  // a proxy would strip the plan of things that are simply well-loved. This
  // reorders; it never removes.
  const pop = item.popularity_score ?? 0;
  score += (quiet ? 1 - pop : pop) * 3;
  return { score, rejected: false };
}

// Best-fitting item for the answers, or null when every item is over budget.
export function bestItemForAnswers(items: ViatorItem[], tags: Set<MatchTag>): ViatorItem | null {
  let best: ViatorItem | null = null;
  let bestScore = -Infinity;
  for (const it of items) {
    const f = fitItem(it, tags);
    if (f.rejected) continue;
    const score = f.score + offroadAdrenalineBonus(it, tags) + contentCreatorBonus(it, tags);
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
    // itemSlotOkForFill, not itemSlotOk: this is a SUGGESTION path (the swap
    // pool), so it should honour a time of day the product states in its own
    // title. Safe to tighten here — refaceForAnswers is not the display
    // chokepoint, so it cannot re-face a stored plan the way resolveSlotEntry
    // can. Before this it was offering the "Premium Catamaran Morning Sail" as
    // an afternoon swap.
    const pool = [e.bestSeller, ...e.others].filter(
      (i) => (!slot || itemSlotOkForFill(i, slot)) && !excludeIds?.has(i.id),
    );
    const face = bestItemForAnswers(pool, tags);
    if (!face) continue;
    out.push({ ...e, bestSeller: face, others: pool.filter((i) => i.id !== face.id) });
  }
  return out;
}
