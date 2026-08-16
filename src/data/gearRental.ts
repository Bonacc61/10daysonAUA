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
  address: string;
  /** Full set = mask, snorkel and fins. */
  fullSetHalfDayUsd: number;
  fullSetDayUsd: number;
  vestUsd: number;
  hours: string;
  /** The day it is shut — a planning constraint, not trivia. */
  closed: string;
  /** What the shop asks for before handing gear over. */
  deposit: string;
  /** False when no purchase option is advertised anywhere on the site. */
  sells: boolean;
  phone: string;
  source: string;
  checkedOn: string;
};

export const SNORKEL_GEAR: GearRental = {
  shop: "Aqua Windie's",
  address: 'Caya Harmonia 4 (Lava Building), Oranjestad',
  fullSetHalfDayUsd: 16,
  fullSetDayUsd: 24,
  vestUsd: 6,
  hours: 'Mon–Sat 8am–5pm',
  closed: 'Sunday',
  deposit: 'credit card + ID',
  // Their site has a SHOP section, and everything in it is a rental. No retail
  // or purchase option is advertised anywhere on it, so the card does not offer
  // one. Absence of a claim is not a claim of absence — it says rental only.
  sells: false,
  phone: '+297 583 5669',
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
