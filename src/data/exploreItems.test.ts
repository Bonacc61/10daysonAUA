import { describe, expect, test } from 'vitest';
import {
  itemCategory,
  advValue,
  keywordAdventure,
  vibePass,
  priceValue,
  pricePass,
  priceOf,
  filterExploreEntries,
  groupPasses,
  type ExploreEntry,
} from './exploreItems';
import { getCatalog, type Catalog } from './activitySource';
import type { ViatorGroup, ViatorItem } from '../types';

// --- itemCategory ----------------------------------------------------------
describe('itemCategory', () => {
  test('maps each Viator group id to its content bucket', () => {
    expect(itemCategory({ group_id: 'adventure-tours' } as ViatorItem)).toBe('Activities');
    expect(itemCategory({ group_id: 'watersports' } as ViatorItem)).toBe('Watersports');
    expect(itemCategory({ group_id: 'sailing-cruises' } as ViatorItem)).toBe('Tours');
    expect(itemCategory({ group_id: 'food-drink-experiences' } as ViatorItem)).toBe('Food');
  });

  test('falls back to Tours for an unknown group', () => {
    expect(itemCategory({ group_id: 'mystery-group' } as ViatorItem)).toBe('Tours');
  });
});

// --- advValue --------------------------------------------------------------
describe('advValue', () => {
  test('a curated adventure value wins over everything else', () => {
    expect(advValue({ adventure: 28, matched_by: ['high-adventure'], category: 'Watersports' })).toBe(28);
  });

  test('without a curated value, averages explicit adventure tags', () => {
    // med (55) + high (88) → 71.5
    expect(advValue({ matched_by: ['med-adventure', 'high-adventure'], category: 'Watersports' })).toBeCloseTo(71.5);
  });

  test('with neither, falls back to the category proxy', () => {
    expect(advValue({ matched_by: [], category: 'Beaches' })).toBe(8);
    expect(advValue({ category: 'Activities' })).toBe(68);
  });

  test('a title keyword beats the group-tag / category fallback (for live items)', () => {
    // a chill-titled item sitting in a high-adventure-tagged group reads chill
    expect(advValue({ title: 'Champagne Sunset Sail', matched_by: ['high-adventure'], category: 'Watersports' })).toBeLessThanOrEqual(33);
  });

  test('a curated value still beats the title keyword', () => {
    expect(advValue({ adventure: 28, title: 'Aruba UTV Cliff Jumping', category: 'Activities' })).toBe(28);
  });
});

// --- keywordAdventure (classifies LIVE items by their title) ---------------
describe('keywordAdventure', () => {
  test('adrenaline keywords score high (>= 67)', () => {
    for (const t of ['Aruba UTV Tour with Cave Pool and Cliff Jumping', "Kitesurfing Lesson at Fisherman's Huts", 'ATV Quad Bike Adventure', 'Ziplining at De Palm Island']) {
      expect(keywordAdventure(t)!).toBeGreaterThanOrEqual(67);
    }
  });

  test('chill keywords score low (<= 33)', () => {
    for (const t of ['Catamaran Snorkel Cruise to Antilla Shipwreck', 'Half-Day Private Snorkel & Mangrove Experience', 'Champagne Sunset Sail with Open Bar', 'Rum and Chocolate Sensory Journey', 'Private Beach Dinner Under the Stars']) {
      expect(keywordAdventure(t)!).toBeLessThanOrEqual(33);
    }
  });

  test('an adrenaline keyword wins over a chill one in the same title', () => {
    expect(keywordAdventure('ATV ride plus a relaxing snorkel stop')!).toBeGreaterThanOrEqual(67);
  });

  test('boat tours and yacht charters read as chill', () => {
    expect(keywordAdventure('Private Boat Tour in Aruba')!).toBeLessThanOrEqual(33);
    expect(keywordAdventure('Luxury Private Yacht Charter Aruba')!).toBeLessThanOrEqual(33);
  });

  test('a guided dive is classified (moderate), not left to the group fallback', () => {
    const v = keywordAdventure('Aruba 2-Tank guided Dive for certified divers');
    expect(v).toBeDefined();
    expect(v!).toBeGreaterThan(33);
    expect(v!).toBeLessThan(67);
  });

  test('generic island tours / transfers / buses default to chill', () => {
    for (const t of ['Aruba Island Tour', 'Private Airport Transfer in Aruba', 'Aruba Atlantis Submarine Tour', 'Best of Aruba by Bus', 'Highlights of Aruba Island Tour']) {
      expect(keywordAdventure(t)!).toBeLessThanOrEqual(33);
    }
  });

  test('thrill vehicles score high even when titled "tour"', () => {
    expect(keywordAdventure('Aruba Seabob Scooter Reef Tour')!).toBeGreaterThanOrEqual(67);
    expect(keywordAdventure('Honda Talon 4 Seater Rental')!).toBeGreaterThanOrEqual(67);
  });

  test('a jeep tour stays balanced — the generic "tour" default must not override it', () => {
    const v = keywordAdventure('Full day Aruba Jeep Tour Arikok Park');
    expect(v!).toBeGreaterThan(33);
    expect(v!).toBeLessThan(67);
  });

  test('returns undefined when no keyword matches (caller falls back)', () => {
    expect(keywordAdventure('A Mystery Aruba Outing')).toBeUndefined();
  });
});

// --- vibePass --------------------------------------------------------------
describe('vibePass', () => {
  test('centre (50) admits everything', () => {
    expect(vibePass(0, 50)).toBe(true);
    expect(vibePass(100, 50)).toBe(true);
  });

  test('full adrenaline (100) admits only adventure >= 67', () => {
    expect(vibePass(67, 100)).toBe(true);
    expect(vibePass(66, 100)).toBe(false);
    expect(vibePass(10, 100)).toBe(false);
  });

  test('full chill (0) admits only adventure <= 33', () => {
    expect(vibePass(33, 0)).toBe(true);
    expect(vibePass(34, 0)).toBe(false);
    expect(vibePass(90, 0)).toBe(false);
  });

  test('monotonic: a chill activity dropped at a high vibe stays dropped higher', () => {
    expect(vibePass(20, 60)).toBe(true);
    expect(vibePass(20, 75)).toBe(false);
    expect(vibePass(20, 100)).toBe(false);
  });
});

// --- priceValue ------------------------------------------------------------
describe('priceValue', () => {
  test('bands price into the old budget buckets', () => {
    expect(priceValue(0)).toBe(0);
    expect(priceValue(49)).toBe(38);
    expect(priceValue(50)).toBe(63);
    expect(priceValue(100)).toBe(63);
    expect(priceValue(101)).toBe(90);
    expect(priceValue(1450)).toBe(90); // outlier still just "$100+"
  });
});

// --- pricePass -------------------------------------------------------------
describe('pricePass', () => {
  test('centre admits everything', () => {
    expect(pricePass(0, 50)).toBe(true);
    expect(pricePass(90, 50)).toBe(true);
  });

  test('full free (0) admits only the Free band (value 0)', () => {
    expect(pricePass(0, 0)).toBe(true);
    expect(pricePass(38, 0)).toBe(false);
    expect(pricePass(90, 0)).toBe(false);
  });

  test('full splurge (100) admits only the $100+ band (value 90)', () => {
    expect(pricePass(90, 100)).toBe(true);
    expect(pricePass(63, 100)).toBe(false);
    expect(pricePass(0, 100)).toBe(false);
  });
});

// --- priceOf ---------------------------------------------------------------
describe('priceOf', () => {
  test('reads price_usd for an item', () => {
    const e: ExploreEntry = { kind: 'item', item: { price_usd: 129 } as ViatorItem, category: 'Activities', adventure: 90 };
    expect(priceOf(e)).toBe(129);
  });

  test('parses a local activity cost string ("Free" -> 0)', () => {
    const free: ExploreEntry = { kind: 'activity', activity: { cost: 'Free' } as never, category: 'Beaches', adventure: 8 };
    const paid: ExploreEntry = { kind: 'activity', activity: { cost: '$65 guided' } as never, category: 'Tours', adventure: 40 };
    expect(priceOf(free)).toBe(0);
    expect(priceOf(paid)).toBe(65);
  });
});

// --- filterExploreEntries (integration against the real stub catalog) ------
describe('filterExploreEntries', () => {
  const catalog: Catalog = getCatalog();
  const ALL = { category: 'All', search: '', vibe: 50, price: 50 };

  test('at default slider positions, every item and activity appears (nothing silently dropped)', () => {
    const out = filterExploreEntries(catalog, ALL);
    expect(out.filter((e) => e.kind === 'item').length).toBe(catalog.items.length);
    expect(out.filter((e) => e.kind === 'activity').length).toBe(catalog.activities.length);
  });

  test('Chill + Free shows only free, low-adventure activities (beaches/walks)', () => {
    const out = filterExploreEntries(catalog, { ...ALL, vibe: 0, price: 0 });
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      expect(priceOf(e)).toBe(0);
      expect(e.adventure).toBeLessThanOrEqual(33);
    }
    const ids = out.map((e) => (e.kind === 'activity' ? e.activity.id : e.item.id));
    expect(ids).toContain('eagle-beach-morning');
  });

  test('Adrenaline + Splurge shows only expensive, high-adventure activities (kitesurf/UTV tier)', () => {
    const out = filterExploreEntries(catalog, { ...ALL, vibe: 100, price: 100 });
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      expect(priceOf(e)).toBeGreaterThan(100);
      expect(e.adventure).toBeGreaterThanOrEqual(67);
    }
    const ids = out.map((e) => (e.kind === 'activity' ? e.activity.id : e.item.id));
    expect(ids).toContain('utv-cave-pool');
  });

  test('the snorkel cruise to Antilla is no longer treated as adrenaline', () => {
    const out = filterExploreEntries(catalog, { ...ALL, vibe: 0 }); // chill end
    const ids = out.filter((e) => e.kind === 'item').map((e) => (e as { item: ViatorItem }).item.id);
    expect(ids).toContain('snorkel-catamaran');
  });

  test('category and search each narrow the results', () => {
    const food = filterExploreEntries(catalog, { ...ALL, category: 'Food' });
    expect(food.every((e) => e.category === 'Food')).toBe(true);

    const search = filterExploreEntries(catalog, { ...ALL, search: 'snorkel' });
    expect(search.length).toBeGreaterThan(0);
    expect(search.length).toBeLessThan(catalog.items.length + catalog.activities.length);
  });

  test('best-sellers sort ahead of equal-or-lower-rated non-best-sellers', () => {
    const out = filterExploreEntries(catalog, ALL);
    const firstItem = out.find((e) => e.kind === 'item') as { item: ViatorItem };
    expect(firstItem.item.is_best_seller).toBe(true);
  });
});

// --- groupPasses -----------------------------------------------------------
describe('groupPasses', () => {
  const catalog: Catalog = getCatalog();
  const group = (id: string): ViatorGroup => catalog.groups.find((g) => g.id === id)!;

  test('a mixed group (watersports) shows at both vibe extremes', () => {
    expect(groupPasses(group('watersports'), catalog, 0, 50)).toBe(true);   // has a chill snorkel cruise
    expect(groupPasses(group('watersports'), catalog, 100, 50)).toBe(true); // has adrenaline kitesurf
  });

  test('a uniformly chill group (food-drink) hides at full adrenaline', () => {
    expect(groupPasses(group('food-drink-experiences'), catalog, 100, 50)).toBe(false);
  });

  test('every (all-paid) group hides at the Free price extreme', () => {
    for (const g of catalog.groups) {
      expect(groupPasses(g, catalog, 50, 0)).toBe(false);
    }
  });
});
