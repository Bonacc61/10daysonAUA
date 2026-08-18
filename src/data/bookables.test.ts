import { describe, it, expect } from 'vitest';
import { bookableTier, isBookable, ANIMAL_SANCTUARY_ID, JET_SKI_ID, SUBMARINE_ID, DE_PALM_ISLAND_ID } from './bookables';
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
