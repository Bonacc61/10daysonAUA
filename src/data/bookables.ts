import type { CardEntry, MatchTag } from '../types';
import { activityKind, isPhotoService, HORSEBACK_TITLE } from './itemFit';

import { parseActivityCost } from './matcher';

// === What a traveller must BOOK, as opposed to merely pay for ==============
//
// The engine already had two rules in this area and neither is a count:
// MAX_PAID_OUTINGS_PER_DAY caps a single day, and the trip budget pool caps
// spend. Cheap outings are always affordable, so every day that could pay for
// one got one — measured 2026-08-18 at NINE paid outings on nine consecutive
// days for an adventurous family, ending with a $120 dive on the departure
// morning. See docs/superpowers/specs/2026-08-18-bookable-density-design.md.

// A food card: the curated restaurants ('Dinner at Gasparito', 'Zeerovers Fish
// Fry') and every lunchspot, all of which carry category 'Food'. A Viator
// dinner cruise or sunset sail is deliberately NOT a meal — it is an outing you
// booked, so it counts as one of the two.
export function isMealEntry(e: CardEntry): boolean {
  return e.kind === 'activity' && e.activity.category === 'Food';
}

// A card that spends the day's one paid slot: it costs money, and is not a
// restaurant. MOVED HERE from itineraryGenerator.ts on 2026-08-18 so that every
// "is this a booking" question is answered by one module; the generator
// re-exports it, so `tools/plan-diff.ts` and existing tests are unaffected.
//
// The test is PRICE, not the affiliate link, and that was a deliberate call.
// "Has a Book now button" (`viator_item_url` && paid) is what the card renders
// (ItineraryCard.tsx:47-49) and on the live catalog it agrees with price on all
// 328 Viator products — measured, zero divergence. The two differ on exactly
// three curated locals, which the owner ruled IN: the $11 Arikok gate, the $125
// Flamingo day pass and the $120 kitesurfing lesson are strenuous 2.5-3h
// outings whoever takes the payment, so a day should carry one of them and
// nothing else.
//
// Price also happens to be the only testable half. Every ViatorItem fixture in
// the suite — and all 20 items in the offline stub — carries
// `viator_item_url: ''`, so a link-based rule would be inert under `npm test`
// and every test written for it would pass against a rule that never fired.
//
// The generator's two call sites (the day-fill guards in itineraryGenerator.ts
// that decide whether a candidate can join a day already in progress) check
// the CANDIDATE only after their own meal and free-beach early-returns, so the
// meal exemption here is load-bearing on the COUNTING side alone —
// `today.filter(isPaidOuting)`, where a $35-60 Gasparito dinner already sitting
// on the day would otherwise spend its outing slot. Instrumented 2026-08-15: no
// live ordering reaches that today, which is why it is asserted on the
// predicate directly rather than through a generated plan. It is one
// staple-ordering change away from mattering.
//
// There is NO beach clause, and that is deliberate rather than an omission. An
// `isRevisitableBeach` test here would be strictly dead: it requires cost 0, and
// the price test below already rejects anything free. Every curated beach is
// free today (13 of 13 — the "Free + $16 gear" ones parse to 0), and no Viator
// product carries the `beaches` section at all (0 of 328, measured), so "beaches
// don't count" holds by construction. The one case that would separate them is a
// PAID beach, which does not exist in either catalog; if one is ever added it
// counts as the day's outing, and that is the line to revisit.
export function isPaidOuting(e: CardEntry): boolean {
  if (isMealEntry(e)) return false;
  return e.kind === 'group'
    ? e.bestSeller.price_usd > 0
    : parseActivityCost(e.activity.cost) > 0;
}

// --- The whitelist ---------------------------------------------------------
//
// Viator tags say what a product TOUCHES, not what it IS. An air-conditioned
// bus that stops at a snorkelling beach is tagged for snorkelling; a Harley
// rental is tagged off-road. So two of the kind-based families need a title
// guard on top of the kind. Measured on the live catalog 2026-08-19: the guards
// drop 17 of 88 `offroad` items (16 until the e-bike rule below) and 8 of 44
// `snorkel` items, including three
// with enough reviews to actually be placed — two Baby Beach shuttles ($55/111
// reviews and $40/51 reviews, to a beach the plan already carries as a free
// card) and a sightseeing bus.
//
// `activityKind` is a good dedup key and a poor eligibility filter. Any family
// added here later must be audited by title before it is trusted.
const JEEP_TITLE = /\b(jeeps?|4x4|4wd|off.?road|utv|atv|buggy|safari|natural pool|conchi)\b/i;
// ...and the vehicles that are NOT the jeep/UTV family however they are
// advertised. "Epic Off-Road Surron Electric Bike Tour in Aruba" ($160, 42
// reviews) reached the whitelist purely because "Off-Road" is in its name; it
// is an e-bike tour, the same class as the e-scooters that were already out —
// they are out only because no word in JEEP_TITLE happens to appear in their
// titles, which is luck rather than a rule.
//
// Applied to the OFF-ROAD row alone, deliberately. "scooter" is not a
// disqualifier everywhere: "Aruba Seabob Scooter Reef Tour" ($97, 231 reviews)
// is a sea scooter and clears the snorkel row on its own merits. Checked
// against the live catalog — of the 16 titles naming a bike, a moped or a
// scooter, the Surron tour is the only one JEEP_TITLE matches at all, and the
// three genuine off-road tours the owner named stay eligible ("Private
// Off-Road Adventure to Cave Pool and Tres Trapi", "Aruba Off Road Safari Tour
// to Natural Pool", "Aruba Off-Road ATV Tour" — none names a bike).
const TWO_WHEELER_TITLE = /\b(e[\s-]?bikes?|bikes?|biking|bicycles?|cycling|mopeds?|scooters?)\b/i;
// A title that NAMES a four-wheeler is a four-wheeler, whatever else it says.
// "Quad bike" and "dirt bike" are both standard ATV marketing, so bare `bike`
// above is not evidence of two wheels on its own — the offline stub's "ATV Quad
// Bike Adventure Tour" ($75, 622 reviews) went tier 1 → null on the e-bike rule
// alone, and that stub IS the catalog when `loadCatalog()` fails. The live feed
// is refetched at runtime with no deploy, so a relisted "Quad Bike" would delist
// a genuine ATV tour silently. Same principle as the natural-pool fix in the
// same commit: require POSITIVE evidence, and do not let one word in a title
// decide what a tour is.
const FOUR_WHEELER_TITLE = /\b(utv|atv|quads?|buggy|buggies|jeeps?|4x4|4wd)\b/i;
// Positive evidence that a `hike`-kind product is actually a walk.
const HIKE_TITLE = /\b(hik(?:e|ing)|trek(?:king)?|nature walk)\b/i;
const WATER_TITLE = /\b(snorkel(?:l?ing)?|catamaran|sail|cruise|boat|charter|seabob|reef|wreck|sea scooter|island|day pass)\b/i;

// Products named individually because no kind rule can reach them: the sanctuary
// classifies `sec:adventures-outdoor` and the submarine `sec:cruises-water`.
// These are `ViatorItem.id` — there is no product_code field on the type.
export const ANIMAL_SANCTUARY_ID = '7389P10';
export const JET_SKI_ID = '137607P22';
export const SUBMARINE_ID = '2455SUB';
export const DE_PALM_ISLAND_ID = '2455P18';

// Curated locals carry no Viator kind, so the paid ones are named. Absent from
// this set and therefore NOT bookables: `arikok-hiking` ($11 park gate) and
// `oranjestad-walking` ($25 optional guide), which are fees rather than advance
// bookings, and `flamingo-renaissance`, which no Viator product sells at all
// (zero of 328 titles name it) — it keeps its card and gains a direct link.
//
// Keeping the Arikok gate out matters more than its price suggests: at
// adventure 55 it is the most adventurous near-free item in the curated set.
const BOOKABLE_LOCAL_IDS = new Set(['antilla-wreck-dive', 'boca-catalina-snorkel', 'natural-pool-jeep']);

// Curated locals the whitelist names CONDITIONALLY — bookable for some
// travellers, tier null for others — as opposed to the three above (always
// tier 1) or the locals the whitelist never names at all (arikok-hiking,
// oranjestad-walking, flamingo-renaissance), which must stay placeable for
// everyone regardless of tags. `isExcludedPaidProduct` in
// itineraryGenerator.ts reads this set to draw exactly that line: a local
// listed here is refused when its condition fails, one absent from both this
// set and BOOKABLE_LOCAL_IDS is never refused. `kitesurfing-lesson` is the
// only one today (tier 1 for family-teens + high-adventure, or for an
// adventurous splurge traveller on a trip longer than 10 days; null otherwise)
// — a second conditional local is added here, not inferred from bookableTier.
export const CONDITIONALLY_BOOKABLE_LOCAL_IDS = new Set(['kitesurfing-lesson']);

export type BookableTier = 1 | 2;

/**
 * Which tier of the whitelist this entry belongs to, or null if it is not
 * something a traveller books ahead.
 *
 * Tier 1 is the curated must-do set and has first claim on the trip's booking
 * days. Tier 2 is placed only when a booking day is left over.
 *
 * `tags` is load-bearing: four families are persona-conditional, so the same
 * product is a bookable for one traveller and not for another. A test that
 * asserts only one direction would pass against an implementation that ignored
 * this argument entirely.
 */
export function bookableTier(e: CardEntry, tags: Set<MatchTag>): BookableTier | null {
  if (!isPaidOuting(e)) return null;

  const youngKids = tags.has('family-young-kids');
  const anyKids = youngKids || tags.has('family-teens');
  const teensAdventurous = tags.has('family-teens') && tags.has('high-adventure');
  // Owner's ruling 2026-08-21: an adventurous splurge traveller on an extended
  // itinerary gets the kitesurfing lesson too. All three conditions matter —
  // `splurge` because $120 for a lesson is a treat rather than a staple,
  // `high-adventure` because the card sits at adventure 85, and `long-trip`
  // because a 10-day plan has better uses for a booking day.
  const splurge = tags.has('treat-yourself') || tags.has('money-no-object');
  const adventurousSplurge = splurge && tags.has('high-adventure') && tags.has('long-trip');

  if (e.kind === 'activity') {
    if (BOOKABLE_LOCAL_IDS.has(e.activity.id)) return 1;
    if (e.activity.id === 'kitesurfing-lesson') return teensAdventurous || adventurousSplurge ? 1 : null;
    return null;
  }

  const item = e.bestSeller;
  // Named products FIRST. De Palm Island would otherwise pass the snorkel row
  // on its own merits — Viator tags it for snorkelling and its title contains
  // both "Island" and "Day Pass" — which would hand it to every traveller and
  // make its audience rule unreachable code.
  if (item.id === DE_PALM_ISLAND_ID) return anyKids ? 2 : null;
  if (item.id === SUBMARINE_ID) return youngKids ? 2 : null;
  if (item.id === ANIMAL_SANCTUARY_ID) return youngKids ? 1 : null;
  if (item.id === JET_SKI_ID) return teensAdventurous ? 1 : null;

  const kind = activityKind(item);
  // Horseback riding — TIER 2, and only on an EXTENDED itinerary.
  //
  // Owner's ruling 2026-08-21: horseback is for trips where the standard
  // curated activities are already depleted, which on a 10-day trip they are
  // not. Tier 2 keeps it off the days the must-do set wants; `long-trip` keeps
  // it off short trips entirely.
  //
  // "So a 10-day plan is unchanged" is what this said, and it is not quite
  // true. The row is unconditional in its NEGATIVE direction, so on a trip of
  // 10 days or fewer it also REMOVES something: "Horseback Riding and Natural
  // Pool Adventure in Aruba" ($189, 56 reviews) used to clear the off-road row
  // — JEEP_TITLE matches `natural pool` — and is now tier 1 -> null there.
  // Measured across 8 personas x {7,10} days x 3 seeds, no plan placed it
  // either way, so there is no observed regression; the eligibility change is
  // real all the same and this is the honest statement of it.
  //
  // Tested by TITLE and placed ABOVE the off-road row on purpose: Viator files
  // "Aruba Horseback Riding Tour For Advanced Riders" and "Horseback Riding and
  // Natural Pool Adventure in Aruba" under `offroad`, so a kind-only rule here
  // would hand them to every traveller through row 2 as jeep safaris.
  if (HORSEBACK_TITLE.test(item.title)) return tags.has('long-trip') ? 2 : null;

  if (kind === 'sail') return 1;
  if (kind === 'snorkel') return WATER_TITLE.test(item.title) ? 1 : null;
  if (kind === 'offroad') {
    const twoWheeled = TWO_WHEELER_TITLE.test(item.title) && !FOUR_WHEELER_TITLE.test(item.title);
    return JEEP_TITLE.test(item.title) && !twoWheeled ? 1 : null;
  }
  // Guided hikes — TIER 2, added 2026-08-21 on the owner's preference.
  //
  // Tier 2 and not tier 1 deliberately: a hike may take a booking day the
  // curated must-do set could not use, and may never displace a catamaran or a
  // jeep. That is what keeps this off short trips, where the whole point of the
  // 2026-08-18 density work was that a five-category island had grown nine
  // bookings.
  //
  // The guard follows the off-road row's shape — positive evidence, then the
  // vehicle exclusion — because `activityKind` is a poor eligibility filter and
  // the live `hike` bucket holds a mountain-bike tour (37 reviews) and a
  // bike/hike combo. Neither is a hike; both are refused here.
  //
  // MEASURED INERT, and left in deliberately rather than reverted. Across 1,680
  // live plans at each of 7, 10 and 14 days, this row placed a hike in ZERO of
  // them. Whitelisting was necessary and is not sufficient; two gates downstream
  // still refuse every candidate:
  //
  //  - Of 9 live hike products only 3 clear MIN_CHAMPION_REVIEWS, and 2 of those
  //    3 name the natural pool. `naturalPoolFor` always spends the pool on a
  //    JEEP (every budget tier above budget-conscious gets one), so those two
  //    are refused on NATURAL_POOL_FAMILY — the owner's one-visits-the-pool rule
  //    working exactly as specified, just never in the hike's favour.
  //  - The third, "Half Day Hike at Arikok National Park & Snorkel" (36 reviews,
  //    $115), is refused `booking cap` on every non-booking day and does not
  //    reach the fill pool on the booking days. Not cluster dedup — checked, it
  //    is its own champion.
  //
  // So the row is correct and load-bearing for whatever unblocks it; what it
  // needs is for `naturalPoolFor` to be able to choose a HIKE over a jeep for a
  // nature-leaning traveller. That is a separate decision with its own
  // measurement, not an edit to make here.
  if (kind === 'hike') {
    return HIKE_TITLE.test(item.title) && !TWO_WHEELER_TITLE.test(item.title) ? 2 : null;
  }

  // Photo services LAST (ruling R10, 2026-08-18 — moved below the kind rows).
  //
  // I4 (final whole-branch review, 2026-08-18): this row asked
  // `isContentProduct`, which is deliberately broad (`/photo|video/i`, an
  // unanchored substring test) because it exists for SCORING, where a miss
  // costs an influencer the thing they came for. As an eligibility rule it
  // admitted 24 live products the design spec deliberately excludes — five
  // clear-kayak tours, a $95 horseback ride with 1,292 reviews and a $120
  // "Private Dive + videographer", the last against a spec section titled
  // "Diving is deliberately out". Measured: the influencer persona placed
  // "50%OFF Aruba's #1Clear Kayak Experience@arubaphotoshootexperience" on
  // day 7 on both seeds. The row now asks `isPhotoService` — word-anchored on
  // the SHOOT — so a photoshoot is eligible and a kayak tour that throws in
  // photos is not. `isContentProduct` is unchanged: its breadth is right where
  // it is used (`contentCreatorBonus`), and this is a second question, not a
  // correction of the first.
  //
  // Below the kind rows regardless, because either predicate sitting first is
  // a false-positive trap: two genuine top-reviewed turtle snorkel tours merely
  // mention video in the title —
  //   "Private Turtle Snorkel Tour in Aruba +Professional video footage" ($95,
  //   733 reviews) and "Award-Winning Private Turtle Snorkeling Aruba | Video
  //   Included" ($89, 211 reviews) — and would have been excluded for every
  //   non-influencer traveller. Below the kind rows they clear row 3 first
  //   (WATER_TITLE matches "snorkel" itself) and never reach here.
  //
  // Tier 1 for a traveller who ticked "I'm an influencer" and null for
  // everyone else. `influencer` is one of only two Q8 pills that survived a
  // deliberate cull (docs/ROADMAP.md item 7) precisely because it DOES change
  // what the plan contains — `birthday` and `work-trip` were deleted for
  // doing nothing, on the principle that "a pill that reseeds is worse than
  // one that does nothing, because it fakes a response". Without this row,
  // R6's whitelist-only auto-fill rule would silently recreate that exact
  // defect: `contentCreatorBonus` (itemFit.ts) could keep scoring a
  // photoshoot for an influencer, but `isExcludedPaidProduct` would exclude it
  // before that score is ever consulted, same as sip-and-paint. This mirrors
  // an existing, sanctioned carve-out — `isAutoFillExcluded(item, influencer)`
  // already exempts photo services from auto-fill exclusion for exactly this
  // traveller — rather than inventing a new idea.
  if (isPhotoService(item)) return tags.has('influencer') ? 1 : null;
  return null;
}

/** Whether this entry is something the traveller books in advance. */
export function isBookable(e: CardEntry, tags: Set<MatchTag>): boolean {
  return bookableTier(e, tags) !== null;
}

// --- When a trip may book --------------------------------------------------
//
// One booking per 2.5 days, floor 1, cap 6 — the owner's rule, 2026-08-18.
// Everything else in that rule falls out of the CONSTRUCTION below rather than
// being enforced separately: arrival and departure days are outside the window,
// "never consecutive" is what latest-non-consecutive means, and with alternating
// days every other day is free of bookings, so "at least one unstructured middle
// day" needs no code of its own.
export const MAX_BOOKABLES = 6;
export const DAYS_PER_BOOKABLE = 2.5;

/**
 * The days of an `nDays` trip permitted to carry a bookable, ascending.
 *
 * Latest-first, because people book more readily once they have been on the
 * island a few days and trust the itinerary. A 10-day trip gets days 3, 5, 7, 9.
 *
 * It is FIXED rather than seed-varied, and that is a measured choice rather than
 * an oversight: there is no Regenerate button on the site — `Itinerary.tsx`
 * passes no seed and `Map.tsx` passes `{ seed: 0 }` — so a seed-weighted chooser
 * would carry a weighting table and tests for machinery nothing can trigger.
 * Swapping "always the latest" for "pick by seed" is a change to this function
 * alone if a Regenerate button ever ships.
 *
 * `mustInclude` are days a curated pre-pass has already committed to (the
 * balanced template places two bookables by construction). They are honoured
 * first and the remainder fill latest-first around them; an illegal or adjacent
 * one is dropped rather than bending the rules.
 *
 * A 10-day trip gets 4 and not the owner's "4 or 5" because 5 non-consecutive
 * days do not fit the window; 12 days is the first length that reaches 5.
 * Trips of 1 and 2 days drop the departure-day rule — on a 2-day trip day 2 IS
 * the departure day, and the alternative is a trip that can book nothing.
 */
export function bookingDays(nDays: number, mustInclude: number[] = []): number[] {
  const lo = nDays <= 1 ? 1 : 2;
  const hi = nDays <= 2 ? nDays : nDays - 1;
  if (hi < lo) return [];

  const width = hi - lo + 1;
  const wanted = Math.max(1, Math.min(MAX_BOOKABLES, Math.round(nDays / DAYS_PER_BOOKABLE)));
  const k = Math.min(wanted, Math.ceil(width / 2));

  const days: number[] = [];
  const free = (d: number) => d >= lo && d <= hi && days.every((x) => Math.abs(x - d) > 1);

  for (const d of [...mustInclude].sort((a, b) => a - b)) {
    if (days.length >= k) break;
    if (free(d)) days.push(d);
  }
  for (let d = hi; d >= lo && days.length < k; d -= 1) {
    if (free(d)) days.push(d);
  }
  return days.sort((a, b) => a - b);
}
