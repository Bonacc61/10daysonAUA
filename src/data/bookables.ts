import type { CardEntry, MatchTag } from '../types';
import { activityKind } from './itemFit';
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
// and on the live catalog it agrees with price on all 328 Viator products —
// measured, zero divergence. The two differ on exactly three curated locals,
// which the owner ruled IN: the $11 Arikok gate, the $125 Flamingo day pass and
// the $120 kitesurfing lesson are strenuous outings whoever takes the payment.
//
// Price is also the only testable half. Every ViatorItem fixture in the suite
// carries `viator_item_url: ''`, so a link-based rule would be inert under
// `npm test` and every test written for it would pass against a rule that never
// fired.
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
// guard on top of the kind. Measured on the live catalog 2026-08-18: the guards
// drop 16 of 88 `offroad` items and 8 of 44 `snorkel` items, including three
// with enough reviews to actually be placed — two Baby Beach shuttles ($55/111
// reviews and $40/51 reviews, to a beach the plan already carries as a free
// card) and a sightseeing bus.
//
// `activityKind` is a good dedup key and a poor eligibility filter. Any family
// added here later must be audited by title before it is trusted.
const JEEP_TITLE = /\b(jeeps?|4x4|4wd|off.?road|utv|atv|buggy|safari|natural pool|conchi)\b/i;
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

export type BookableTier = 1 | 2;

/**
 * Which tier of the whitelist this entry belongs to, or null if it is not
 * something a traveller books ahead.
 *
 * Tier 1 is the curated must-do set and has first claim on the trip's booking
 * days. Tier 2 is placed only when a booking day is left over.
 *
 * `tags` is load-bearing: three families are persona-conditional, so the same
 * product is a bookable for one traveller and not for another. A test that
 * asserts only one direction would pass against an implementation that ignored
 * this argument entirely.
 */
export function bookableTier(e: CardEntry, tags: Set<MatchTag>): BookableTier | null {
  if (!isPaidOuting(e)) return null;

  const youngKids = tags.has('family-young-kids');
  const anyKids = youngKids || tags.has('family-teens');
  const teensAdventurous = tags.has('family-teens') && tags.has('high-adventure');

  if (e.kind === 'activity') {
    if (BOOKABLE_LOCAL_IDS.has(e.activity.id)) return 1;
    if (e.activity.id === 'kitesurfing-lesson') return teensAdventurous ? 1 : null;
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
  if (kind === 'sail') return 1;
  if (kind === 'snorkel') return WATER_TITLE.test(item.title) ? 1 : null;
  if (kind === 'offroad') return JEEP_TITLE.test(item.title) ? 1 : null;
  return null;
}

/** Whether this entry is something the traveller books in advance. */
export function isBookable(e: CardEntry, tags: Set<MatchTag>): boolean {
  return bookableTier(e, tags) !== null;
}
