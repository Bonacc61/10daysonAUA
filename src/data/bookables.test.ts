import { describe, it, expect } from 'vitest';
import { bookableTier, isBookable, bookingDays, ANIMAL_SANCTUARY_ID, JET_SKI_ID, SUBMARINE_ID, DE_PALM_ISLAND_ID } from './bookables';
import type { CardEntry, MatchTag, Section, ViatorGroup, ViatorItem } from '../types';
import type { Activity } from './activities';

const tags = (...t: MatchTag[]) => new Set<MatchTag>(t);

const GROUP: ViatorGroup = { id: 'g', name: 'g', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'islandwide', allowed_slots: [] };

function group(over: Partial<ViatorItem>): CardEntry {
  const bestSeller: ViatorItem = {
    id: 'x', group_id: 'g', title: '', image_url: '', price_usd: 100, duration: '',
    rating: 4.7, review_count: 100, viator_item_url: '', is_best_seller: false,
    display_order: 0, sections: ['cruises-water'] as Section[], ...over,
  };
  return { kind: 'group', group: GROUP, bestSeller, others: [] };
}

function local(over: Partial<Activity>): CardEntry {
  return { kind: 'activity', activity: {
    id: 'a', title: '', category: 'Activities', image: '', description: '', localsSay: '',
    cost: '$50', duration: '', timeOfDay: 'Morning', fitReason: '', location: '',
    rating: 4.5, reviewCount: 10, matched_by: [], ...over,
  } as Activity };
}

// tag 11888 = sailing, 11912 = snorkelling, 12035 = 4WD/off-road (see KIND_BY_TAG)
const SAIL = group({ title: 'Sunset Catamaran Sail', tags: [11888] });
const SNORKEL_BOAT = group({ title: 'Antilla Wreck Snorkel Cruise', tags: [11912] });
const BEACH_SHUTTLE = group({ title: 'Aruba Baby Beach Express Tour', tags: [11912] });
const JEEP = group({ title: 'Natural Pool Rugged Jeep Safari', tags: [12035] });
const ESCOOTER = group({ title: 'Guided 3-Hour E-Scooter Island Tour in Aruba', tags: [12035] });

describe('bookableTier — kind families', () => {
  it('accepts a sail for anyone', () => {
    expect(bookableTier(SAIL, tags('couple', 'mid-range'))).toBe(1);
  });

  it('accepts a snorkel boat but rejects a beach shuttle wearing the snorkel tag', () => {
    expect(bookableTier(SNORKEL_BOAT, tags('couple'))).toBe(1);
    expect(bookableTier(BEACH_SHUTTLE, tags('couple'))).toBe(null);
  });

  it('accepts a jeep safari but rejects an e-scooter wearing the off-road tag', () => {
    expect(bookableTier(JEEP, tags('couple'))).toBe(1);
    expect(bookableTier(ESCOOTER, tags('couple'))).toBe(null);
  });

  it('rejects anything free, because a booking costs money', () => {
    expect(bookableTier(group({ title: 'Free Sail', tags: [11888], price_usd: 0 }), tags('couple'))).toBe(null);
  });
});

describe('bookableTier — persona-conditional families, both directions', () => {
  const sanctuary = group({ id: ANIMAL_SANCTUARY_ID, title: 'Half-Day Aruba Animal Sanctuary Guided Tour' });
  const jetski = group({ id: JET_SKI_ID, title: 'Aruba Jet Ski Rental' });
  const sub = group({ id: SUBMARINE_ID, title: 'Aruba Atlantis Submarine Tour' });
  const dePalm = group({ id: DE_PALM_ISLAND_ID, title: 'Aruba De Palm Island Day Pass', tags: [11912] });
  const kite = local({ id: 'kitesurfing-lesson', title: "Kitesurfing at Fisherman's Huts", cost: '$120 lesson' });

  it('animal sanctuary: young kids only', () => {
    expect(bookableTier(sanctuary, tags('family-young-kids'))).toBe(1);
    expect(bookableTier(sanctuary, tags('couple'))).toBe(null);
    expect(bookableTier(sanctuary, tags('family-teens'))).toBe(null);
  });

  it('jet ski and kitesurfing: teens AND high-adventure', () => {
    expect(bookableTier(jetski, tags('family-teens', 'high-adventure'))).toBe(1);
    expect(bookableTier(jetski, tags('family-teens', 'med-adventure'))).toBe(null);
    expect(bookableTier(jetski, tags('friends', 'high-adventure'))).toBe(null);
    expect(bookableTier(kite, tags('family-teens', 'high-adventure'))).toBe(1);
    expect(bookableTier(kite, tags('family-teens'))).toBe(null);
  });

  it('submarine is tier 2 for young kids and nothing for teens', () => {
    expect(bookableTier(sub, tags('family-young-kids'))).toBe(2);
    expect(bookableTier(sub, tags('family-teens'))).toBe(null);
    expect(bookableTier(sub, tags('couple'))).toBe(null);
  });

  it('De Palm Island is tier 2 for kids of either age and NOT reachable via the snorkel row', () => {
    expect(bookableTier(dePalm, tags('family-young-kids'))).toBe(2);
    expect(bookableTier(dePalm, tags('family-teens'))).toBe(2);
    // The carve-out. Its Viator tag is snorkelling and its title says "Island"
    // and "Day Pass", so without an explicit id check it would pass row 3.
    expect(bookableTier(dePalm, tags('couple', 'mid-range'))).toBe(null);
  });
});

describe('bookableTier — content products (ruling R8)', () => {
  // isContentProduct reads the TITLE ("photoshoot"/"photography"/"photo shoot",
  // or the broader footage/video net) — see itemFit.ts. Untagged and unnamed by
  // id, so it must be tested by title like the curated locals above.
  const photoshoot = group({ id: 'photo-1', title: 'Private Vacation Photoshoot with Photographer in Aruba' });

  it('is tier 1 for a traveller who ticked "I am an influencer"', () => {
    expect(bookableTier(photoshoot, tags('influencer'))).toBe(1);
  });

  it('is null for a traveller who did not — both directions matter, or the tag is decorative', () => {
    expect(bookableTier(photoshoot, tags('couple', 'mid-range'))).toBe(null);
  });
});

describe('bookableTier — curated locals', () => {
  it('accepts the three curated boat and jeep trips', () => {
    for (const id of ['antilla-wreck-dive', 'boca-catalina-snorkel', 'natural-pool-jeep']) {
      expect(bookableTier(local({ id, cost: '$60 pp' }), tags('couple'))).toBe(1);
    }
  });

  it('rejects the park gate, the optional guide and the Flamingo pass', () => {
    expect(bookableTier(local({ id: 'arikok-hiking', cost: '$11 entry' }), tags('couple'))).toBe(null);
    expect(bookableTier(local({ id: 'oranjestad-walking', cost: '$25 guided' }), tags('couple'))).toBe(null);
    expect(bookableTier(local({ id: 'flamingo-renaissance', cost: '$125 day pass' }), tags('treat-yourself'))).toBe(null);
  });

  it('rejects restaurants, which are meals rather than outings', () => {
    expect(bookableTier(local({ id: 'gasparito-restaurant', category: 'Food', cost: '$35–60 pp' }), tags('couple'))).toBe(null);
  });
});

describe('isBookable', () => {
  it('agrees with bookableTier on presence', () => {
    expect(isBookable(SAIL, tags('couple'))).toBe(true);
    expect(isBookable(ESCOOTER, tags('couple'))).toBe(false);
  });
});

describe('bookingDays', () => {
  // Verified against a reference implementation run over all 14 lengths while
  // the spec was written. If you change the formula, regenerate this table
  // rather than editing rows to match.
  const EXPECTED: Record<number, number[]> = {
    1: [1], 2: [2], 3: [2], 4: [3], 5: [2, 4], 6: [3, 5], 7: [2, 4, 6],
    8: [3, 5, 7], 9: [2, 4, 6, 8], 10: [3, 5, 7, 9], 11: [4, 6, 8, 10],
    12: [3, 5, 7, 9, 11], 13: [4, 6, 8, 10, 12], 14: [3, 5, 7, 9, 11, 13],
  };

  it('matches the schedule table for every trip length', () => {
    for (const [n, days] of Object.entries(EXPECTED)) {
      expect(bookingDays(Number(n))).toEqual(days);
    }
  });

  it('never books the arrival or the departure day on a real trip', () => {
    for (let n = 3; n <= 14; n += 1) {
      const days = bookingDays(n);
      expect(days).not.toContain(1);
      expect(days).not.toContain(n);
    }
  });

  it('never books two days running', () => {
    for (let n = 1; n <= 14; n += 1) {
      const days = bookingDays(n);
      for (let i = 1; i < days.length; i += 1) expect(days[i] - days[i - 1]).toBeGreaterThan(1);
    }
  });

  it('caps at six however long the trip', () => {
    expect(bookingDays(14).length).toBe(6);
  });

  it('honours days a curated template has already claimed', () => {
    // The balanced template places a wreck snorkel on day 2 and a natural-pool
    // jeep on day 4, both by construction and both bookables. They are pinned
    // into the schedule and the rest fill latest-first.
    expect(bookingDays(10, [2, 4])).toEqual([2, 4, 7, 9]);
  });

  it('ignores a pinned day that is illegal or adjacent to another', () => {
    expect(bookingDays(10, [1])).toEqual([3, 5, 7, 9]);   // arrival day
    expect(bookingDays(10, [10])).toEqual([3, 5, 7, 9]);  // departure day
    // 5 is adjacent to 4, so it is skipped; the schedule still fills to its full count,
    // the same as when a pinned day is illegal — both are "cannot be honoured" cases
    expect(bookingDays(10, [4, 5])).toEqual([2, 4, 7, 9]);
  });
});
