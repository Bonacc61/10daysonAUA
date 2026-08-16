import { describe, it, expect } from 'vitest';
import { SNORKEL_GEAR, gearRentalFor, GEAR_RENTAL_IDS } from './gearRental';
import { ACTIVITIES } from './activities';

describe('the gear-rental record is about a real shop', () => {
  it('carries a source and the date it was read', () => {
    // Prices on someone else's website rot. A figure with no source and no date
    // is a number this site is asserting on its own authority, which is exactly
    // what the enrichment rules forbid for a claim about the real world.
    expect(SNORKEL_GEAR.source).toMatch(/^https:\/\/www\.aquawindies\.com\//);
    expect(SNORKEL_GEAR.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('quotes the full-set prices the shop publishes', () => {
    expect(SNORKEL_GEAR.fullSetHalfDayUsd).toBe(16);
    expect(SNORKEL_GEAR.fullSetDayUsd).toBe(24);
  });

  it('names what the shop sells, because it does sell', () => {
    // The first version said "Rental only, no sales" on the strength of the
    // homepage. The SHOP menu has a third item, /assortment, which is a retail
    // page: "At our shop you can find: … Masks, Snorkels, … Snorkel fins".
    // Surveying two of three pages and asserting about the third is not
    // "absence of a claim is not a claim of absence" — it is not having looked.
    expect(SNORKEL_GEAR.sellsItems).toEqual(['masks', 'snorkels', 'snorkel fins']);
    expect(SNORKEL_GEAR.assortmentSource).toMatch(/assortment$/);
  });

  it('quotes the procedure from the page it links to, not the scuba page', () => {
    // "credit card deposit, ID and scuba certification card (in case of scuba
    // gear)" is on /rental-equipment, inside a scuba paragraph. The snorkel
    // page names no deposit at all: "try on the gear, fill out the application
    // form, and take your rental equipment to the ocean!". A traveller who
    // clicks the link must find what the card told them.
    expect(SNORKEL_GEAR.procedure).toMatch(/form/i);
    expect(SNORKEL_GEAR.procedure).not.toMatch(/credit card|deposit|ID/i);
  });

  it('carries no field the card does not render', () => {
    // `sells` and `phone` were asserted by a test and rendered by nothing, so
    // flipping `sells` would have gone red for a reason unrelated to the card,
    // which reads as data-driven copy that was never data-driven.
    expect(Object.keys(SNORKEL_GEAR).sort()).toEqual([
      'address', 'assortmentSource', 'checkedOn', 'closed', 'fullSetDayUsd',
      'fullSetHalfDayUsd', 'hours', 'procedure', 'sellsItems', 'shop',
      'source', 'town', 'vestUsd',
    ]);
  });

  it('records that the shop is shut on Sundays', () => {
    // A trip-planning fact, not trivia: a Sunday snorkel needs gear collected
    // on Saturday.
    expect(SNORKEL_GEAR.closed).toBe('Sunday');
  });
});

describe('which activities offer it', () => {
  it('names only activities that exist', () => {
    const ids = new Set(ACTIVITIES.map((a) => a.id));
    expect([...GEAR_RENTAL_IDS].filter((id) => !ids.has(id))).toEqual([]);
  });

  it('covers every free shore-snorkel pick', () => {
    expect([...GEAR_RENTAL_IDS].sort()).toEqual([
      'arashi-beach', 'baby-beach-snorkel', 'boca-catalina-shore',
      'malmok-beach', 'mangel-halto', 'tres-trapi',
    ]);
  });

  it('offers nothing for a guided trip that supplies its own gear', () => {
    // The catamaran and the jeep tour both carry the snorkel tag but include
    // equipment in the fare — telling that traveller to go and rent a mask is
    // worse than saying nothing.
    expect(gearRentalFor('boca-catalina-snorkel')).toBeNull();
    expect(gearRentalFor('natural-pool-jeep')).toBeNull();
  });

  it('offers it for a free shore snorkel', () => {
    expect(gearRentalFor('tres-trapi')).toBe(SNORKEL_GEAR);
  });
});

describe('the front of the card no longer quotes a price nobody publishes', () => {
  it('has no activity still claiming a $10 rental', () => {
    // $10 appeared on five picks and on neither of the shop's own pages.
    expect(ACTIVITIES.filter((a) => /\$10 rental/.test(a.cost)).map((a) => a.id)).toEqual([]);
  });

  it('quotes the half-day set price on every pick that mentions gear', () => {
    const withGear = ACTIVITIES.filter((a) => /gear/i.test(a.cost));
    expect(withGear.map((a) => a.id).sort()).toEqual([
      'baby-beach-snorkel', 'boca-catalina-shore', 'malmok-beach',
      'mangel-halto', 'tres-trapi',
    ]);
    for (const a of withGear) {
      // Half-day, because a morning at a beach returned the same day is what
      // these picks actually are — the 24-hour rate is $24.
      expect(a.cost).toBe(`Free + $${SNORKEL_GEAR.fullSetHalfDayUsd} gear`);
    }
  });
});
