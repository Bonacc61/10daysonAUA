// Where to get a mask and fins for the free shore-snorkel spots.
//
// The island's best snorkelling — Tres Trapi's turtles, the Antilla off Malmok,
// Baby Beach's lagoon — costs nothing to reach and is useless without gear. The
// cards said "Free + $10 rental" and gave no idea where; $10 appears on neither
// of the shop's own price pages, so it was a number this site was asserting on
// its own authority.
//
// EVERY FIGURE HERE IS THE OPERATOR'S, QUOTED AND DATED. Prices on someone
// else's website rot, and the fix for that is a visible source and a date the
// reader can weigh — not a number that looks authoritative because it is
// printed in a box. Same rule the enrichment module applies to `evidence`:
// quoting the operator is not the site making a claim.
//
// THE TWO PAGES DISAGREE, on 2026-08-16:
//
//   /rent-snorkel-gear   mask & snorkel $12, fins $12, FULL SET $24 per 24h,
//                        half-day (same-day return) $8 / $8 / $16, vest $6
//   /rental-equipment    mask and snorkel $9.00, fins $9.00, snorkel vest $8.00,
//                        per 24 hours, alongside the scuba kit
//
// The snorkel-specific page is used, because it is the page about this exact
// product and the only one offering a half-day rate — which is what a morning
// at a beach actually is. The dive-shop list reads as the general equipment
// table where snorkel items are a footnote. The discrepancy is recorded rather
// than resolved: if a traveller is charged $9, we were not wrong about which
// page we read.

export type GearRental = {
  shop: string;
  /** The strip has no room for a street; the linked page carries one. */
  town: string;
  /** Full set = mask, snorkel and fins. */
  fullSetHalfDayUsd: number;
  fullSetDayUsd: number;
  vestUsd: number;
  hours: string;
  /** The day it is shut — a planning constraint, not trivia. */
  closed: string;
  /** Gear the shop's own assortment page lists. No prices are published. */
  sellsItems: string[];
  assortmentSource: string;
  source: string;
  checkedOn: string;
};

export const SNORKEL_GEAR: GearRental = {
  shop: "Aqua Windie's",
  town: 'Oranjestad',
  fullSetHalfDayUsd: 16,
  fullSetDayUsd: 24,
  vestUsd: 6,
  hours: 'Mon–Sat 8am–5pm',
  closed: 'Sunday',
  // The SHOP menu has three items: Rent Dive Gear, Rent Snorkel Gear, and
  // Assortment. The third is retail — "At our shop you can find: … Masks,
  // Snorkels, … Snorkel fins" — with no prices anywhere on it. An earlier
  // version of this file said "rental only, no sales" on the strength of the
  // homepage alone; two of three pages surveyed is not grounds for a claim
  // about the third.
  sellsItems: ['masks', 'snorkels', 'snorkel fins'],
  assortmentSource: 'https://www.aquawindies.com/assortment',
  source: 'https://www.aquawindies.com/rent-snorkel-gear',
  checkedOn: '2026-08-16',
};

/**
 * The free shore-snorkel picks — the ones where you arrive with nothing.
 *
 * An explicit list rather than a rule over tags. `11912` (snorkel) is carried by
 * the guided catamaran and the Natural Pool jeep tour too, and both include
 * equipment in the fare: telling that traveller to go and rent a mask is worse
 * than saying nothing. Which picks need gear is an editorial call, so it is
 * written down as one.
 */
export const GEAR_RENTAL_IDS: ReadonlySet<string> = new Set([
  'baby-beach-snorkel',
  'malmok-beach',
  'tres-trapi',
  'mangel-halto',
  'boca-catalina-shore',
  'arashi-beach',
]);

export function gearRentalFor(activityId: string): GearRental | null {
  return GEAR_RENTAL_IDS.has(activityId) ? SNORKEL_GEAR : null;
}
