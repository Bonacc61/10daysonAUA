import { describe, expect, test } from 'vitest';
import {
  itemCategory,
  advValue,
  keywordAdventure,
  vibePass,
  priceValue,
  pricePass,
  priceOf,
  bookingUrl,
  sectionsForTags,
  primarySection,
  filterExploreEntries,
  groupPasses,
  blendSearchResults,
  entryId,
  ratingOf,
  starsPass,
  reviewsPass,
  durationPass,
  privatePass,
  provenancePass,
  sortEntries,
  type ExploreEntry,
} from './exploreItems';
import { getCatalog, type Catalog } from './activitySource';
import type { Activity } from './activities';
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
    const e: ExploreEntry = { kind: 'item', item: { price_usd: 129 } as ViatorItem, category: 'Activities', adventure: 90, sections: [] };
    expect(priceOf(e)).toBe(129);
  });

  test('parses a local activity cost string ("Free" -> 0)', () => {
    const free: ExploreEntry = { kind: 'activity', activity: { cost: 'Free' } as never, category: 'Beaches', adventure: 8, sections: [] };
    const paid: ExploreEntry = { kind: 'activity', activity: { cost: '$65 guided' } as never, category: 'Tours', adventure: 40, sections: [] };
    expect(priceOf(free)).toBe(0);
    expect(priceOf(paid)).toBe(65);
  });
});

// --- bookingUrl (drives the "Book now" button) -----------------------------
describe('bookingUrl', () => {
  const item = (over: Partial<ViatorItem>): ExploreEntry =>
    ({ kind: 'item', item: { price_usd: 100, viator_item_url: 'https://viator/x', ...over } as ViatorItem, category: 'Tours', adventure: 50, sections: [] });
  const act = (cost: string, url?: string): ExploreEntry =>
    ({ kind: 'activity', activity: { cost, viator_item_url: url } as never, category: 'Food', adventure: 20, sections: [] });

  test('a paid Viator item is bookable', () => {
    expect(bookingUrl(item({}))).toBe('https://viator/x?medium=link');
  });

  test('a free item (price 0) is not bookable', () => {
    expect(bookingUrl(item({ price_usd: 0 }))).toBeNull();
  });

  test('a paid local pick with a booking link is bookable', () => {
    expect(bookingUrl(act('$65 guided', 'https://viator/y'))).toBe('https://viator/y?medium=link');
  });

  test('a free local pick is never bookable, even with a link', () => {
    expect(bookingUrl(act('Free', 'https://viator/z'))).toBeNull();
    expect(bookingUrl(act('Free + $10 rental', 'https://viator/z'))).toBeNull();
  });

  test('a paid local pick without a link is not bookable', () => {
    expect(bookingUrl(act('$35 pp'))).toBeNull();
  });
});

// --- sectionsForTags / primarySection (Viator tag → section mapping) -------
describe('sectionsForTags', () => {
  test('maps category tags to their section', () => {
    expect(sectionsForTags([11912])).toEqual(['cruises-water']);      // Snorkeling
    expect(sectionsForTags([22046])).toEqual(['adventures-outdoor']); // Adventure Tours
    expect(sectionsForTags([21911])).toEqual(['food-drink']);         // Food & Drink
  });

  test('multi-membership: a product in two categories joins both sections', () => {
    const s = sectionsForTags([11912, 21911]); // snorkel + food
    expect(s).toContain('cruises-water');
    expect(s).toContain('food-drink');
  });

  test('attribute/quality tags are ignored', () => {
    // 367661 = "Short term availability", 11938 = "Private and Luxury" (not categories)
    expect(sectionsForTags([367661, 11938, 22046])).toEqual(['adventures-outdoor']);
  });

  test('no category tag → catch-all Tours & Sightseeing', () => {
    expect(sectionsForTags([367661, 11938])).toEqual(['tours-sightseeing']);
    expect(sectionsForTags([])).toEqual(['tours-sightseeing']);
    expect(sectionsForTags(undefined)).toEqual(['tours-sightseeing']);
  });
});

describe('primarySection', () => {
  test('returns the first section by tab order', () => {
    expect(primarySection(['food-drink', 'cruises-water'])).toBe('cruises-water');
    expect(primarySection(['beaches'])).toBe('beaches');
    expect(primarySection([])).toBe('tours-sightseeing');
  });
});

// --- filterExploreEntries (integration against the real stub catalog) ------
describe('filterExploreEntries', () => {
  const catalog: Catalog = getCatalog();
  const ALL = { section: 'All', search: '', vibe: 50, price: 50 };

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

  test('section and search each narrow the results', () => {
    const cw = filterExploreEntries(catalog, { ...ALL, section: 'cruises-water' });
    expect(cw.length).toBeGreaterThan(0);
    expect(cw.every((e) => e.sections.includes('cruises-water'))).toBe(true);

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

// --- blendSearchResults ----------------------------------------------------
// Exact matches must outrank meaning matches. Cosine similarity blurs exactly
// the distinctions proper nouns depend on, so someone typing "Zeerover" is
// served by the substring layer and must not be out-ranked by something that
// merely feels similar.
describe('blendSearchResults', () => {
  const item = (id: string): ExploreEntry => ({
    kind: 'item',
    item: { id, group_id: 'g', title: id, image_url: '', price_usd: 0, duration: '', rating: 4, review_count: 1, viator_item_url: '', is_best_seller: false, display_order: 0 } as ViatorItem,
    category: 'Tours',
    adventure: 30,
    sections: ['tours-sightseeing'],
  });
  const ids = (out: ExploreEntry[]) => out.map(entryId);

  test('substring hits come first, in their existing order', () => {
    const all = [item('a'), item('b'), item('c')];
    expect(ids(blendSearchResults([all[1], all[0]], ['c'], all))).toEqual(['b', 'a', 'c']);
  });

  test('semantic ids follow in the order they were returned', () => {
    const all = [item('a'), item('b'), item('c')];
    expect(ids(blendSearchResults([], ['c', 'a'], all))).toEqual(['c', 'a']);
  });

  test('an entry in both appears once, in the substring block', () => {
    const all = [item('a'), item('b')];
    expect(ids(blendSearchResults([all[0]], ['a', 'b'], all))).toEqual(['a', 'b']);
  });

  test('an empty semantic list returns the substring hits untouched', () => {
    const all = [item('a'), item('b')];
    const hits = [all[1], all[0]];
    expect(blendSearchResults(hits, [], all)).toEqual(hits);
  });

  test('a semantic id with no matching entry is skipped rather than throwing', () => {
    const all = [item('a')];
    expect(ids(blendSearchResults([], ['ghost', 'a'], all))).toEqual(['a']);
  });
});

// --- ratingOf --------------------------------------------------------------
// The one place that answers "what rating does this entry have, and did a real
// crowd supply it". Both the stars filter and the rating sort read it, so they
// cannot disagree about what counts as rated.
describe('ratingOf', () => {
  const item = (rating: number, review_count: number): ExploreEntry =>
    ({ kind: 'item', item: { rating, review_count } as ViatorItem, category: 'Tours', adventure: 50, sections: [] });
  const act = (over: Partial<Activity>): ExploreEntry =>
    ({ kind: 'activity', activity: { rating: 4.7, reviewCount: 982, ...over } as Activity, category: 'Beaches', adventure: 8, sections: [] });

  test('a Viator product with stars and reviews is really rated', () => {
    expect(ratingOf(item(4.8, 1247))).toEqual({ stars: 4.8, reviews: 1247, real: true });
  });

  test('a product nobody reviewed is unrated, not rated zero', () => {
    expect(ratingOf(item(0, 0)).real).toBe(false);
  });

  test("a local pick's editorial numbers never count as a real rating", () => {
    expect(ratingOf(act({})).real).toBe(false);
  });

  test('a local pick matched to a Viator product carries that product rating', () => {
    expect(ratingOf(act({ ratingSource: 'viator' })).real).toBe(true);
  });
});

// --- the four extra filters ------------------------------------------------
describe('starsPass', () => {
  const rated = (rating: number): ExploreEntry =>
    ({ kind: 'item', item: { rating, review_count: 200 } as ViatorItem, category: 'Tours', adventure: 50, sections: [] });
  const unrated: ExploreEntry =
    { kind: 'item', item: { rating: 0, review_count: 0 } as ViatorItem, category: 'Tours', adventure: 50, sections: [] };
  const local: ExploreEntry =
    { kind: 'activity', activity: { rating: 4.2, reviewCount: 30 } as Activity, category: 'Beaches', adventure: 8, sections: [] };

  test('no threshold admits everything', () => {
    expect([rated(3.1), unrated, local].every((e) => starsPass(e, 0))).toBe(true);
    expect([rated(3.1), unrated, local].every((e) => starsPass(e, undefined))).toBe(true);
  });

  test('a rated product has to clear the bar', () => {
    expect(starsPass(rated(4.6), 4.5)).toBe(true);
    expect(starsPass(rated(4.4), 4.5)).toBe(false);
  });

  test('an unrated product drops the moment a bar is set', () => {
    expect(starsPass(unrated, 4.0)).toBe(false);
  });

  test('a local pick clears every bar — the founders vouch for it, not a crowd', () => {
    expect(starsPass(local, 4.8)).toBe(true);
  });
});

describe('reviewsPass', () => {
  const item = (review_count: number): ExploreEntry =>
    ({ kind: 'item', item: { rating: 4.8, review_count } as ViatorItem, category: 'Tours', adventure: 50, sections: [] });
  const local: ExploreEntry =
    { kind: 'activity', activity: { rating: 4.9, reviewCount: 2847 } as Activity, category: 'Beaches', adventure: 8, sections: [] };

  test('no threshold admits everything', () => {
    expect(reviewsPass(item(1), 0)).toBe(true);
    expect(reviewsPass(local, 0)).toBe(true);
  });

  test('a product needs that many real reviews', () => {
    expect(reviewsPass(item(50), 50)).toBe(true);
    expect(reviewsPass(item(49), 50)).toBe(false);
  });

  test('a local pick drops at any threshold — its review count is editorial', () => {
    expect(reviewsPass(local, 10)).toBe(false);
  });
});

describe('durationPass', () => {
  const item = (duration: string): ExploreEntry =>
    ({ kind: 'item', item: { duration } as ViatorItem, category: 'Tours', adventure: 50, sections: [] });

  test('"any" admits everything', () => {
    expect(durationPass(item('8 hrs'), 'any')).toBe(true);
    expect(durationPass(item('8 hrs'), undefined)).toBe(true);
  });

  test('each band holds the durations it names', () => {
    expect(durationPass(item('90 min'), 'short')).toBe(true);
    expect(durationPass(item('3 hrs'), 'short')).toBe(false);
    expect(durationPass(item('3 hrs'), 'half')).toBe(true);
    expect(durationPass(item('5 hrs'), 'long')).toBe(true);
    expect(durationPass(item('5 hrs'), 'half')).toBe(false);
    expect(durationPass(item('8 hrs'), 'long')).toBe(false);
    expect(durationPass(item('8 hrs'), 'full')).toBe(true);
    expect(durationPass(item('Full day'), 'full')).toBe(true);
  });

  // The three boundaries land exactly on durations the catalog advertises in
  // bulk — 67 of the 328 products run "4 hrs". Each must sit in the band whose
  // LABEL claims it, or a traveller loses a fifth of Explore to a button that
  // said it would keep them.
  test('a boundary duration lands in the band its label names', () => {
    expect(durationPass(item('2 hrs'), 'short')).toBe(false); // not "under 2h"
    expect(durationPass(item('2 hrs'), 'half')).toBe(true);   // "2–4h"
    expect(durationPass(item('4 hrs'), 'half')).toBe(true);   // "2–4h", not "4–6h"
    expect(durationPass(item('4 hrs'), 'long')).toBe(false);
    expect(durationPass(item('6 hrs'), 'long')).toBe(true);   // "4–6h", not "Full day"
    expect(durationPass(item('6 hrs'), 'full')).toBe(false);
  });

  test('every duration lands in exactly one band, so none can be lost', () => {
    const bands = ['short', 'half', 'long', 'full'] as const;
    for (const d of ['30 min', '1 hr', '2 hrs', '2.5 hrs', '3 hrs', '4 hrs', '4.5 hrs', '6 hrs', '8 hrs', 'Full day', '2–3 hrs']) {
      expect(bands.filter((b) => durationPass(item(d), b))).toHaveLength(1);
    }
  });

  test('a range lands on its midpoint, as the generator reads it', () => {
    expect(durationPass(item('2–3 hrs'), 'half')).toBe(true);
  });

  // durationMinutes() answers 180 for anything it cannot read, which sits inside
  // the 2-4h band — so without a known-ness check an unreadable duration would be
  // silently sorted into one band and hidden from every other.
  test('an unreadable duration is kept by every band rather than filed under one', () => {
    for (const band of ['short', 'half', 'long', 'full'] as const) {
      expect(durationPass(item('varies'), band)).toBe(true);
      expect(durationPass(item(''), band)).toBe(true);
    }
  });
});

describe('privatePass', () => {
  const item = (flags?: string[]): ExploreEntry =>
    ({ kind: 'item', item: { flags } as ViatorItem, category: 'Tours', adventure: 50, sections: [] });
  const local: ExploreEntry =
    { kind: 'activity', activity: {} as Activity, category: 'Beaches', adventure: 8, sections: [] };

  test('off, it admits everything', () => {
    expect(privatePass(item(undefined), false)).toBe(true);
    expect(privatePass(local, undefined)).toBe(true);
  });

  test('on, it keeps only products Viator itself flags as private', () => {
    expect(privatePass(item(['PRIVATE_TOUR', 'FREE_CANCELLATION']), true)).toBe(true);
    expect(privatePass(item(['FREE_CANCELLATION']), true)).toBe(false);
    expect(privatePass(item(undefined), true)).toBe(false);
    expect(privatePass(local, true)).toBe(false);
  });
});

describe('provenancePass', () => {
  const item: ExploreEntry = { kind: 'item', item: {} as ViatorItem, category: 'Tours', adventure: 50, sections: [] };
  const local: ExploreEntry = { kind: 'activity', activity: {} as Activity, category: 'Beaches', adventure: 8, sections: [] };

  test('"all" admits both kinds', () => {
    expect(provenancePass(item, 'all')).toBe(true);
    expect(provenancePass(local, undefined)).toBe(true);
  });

  test('"local" keeps only hand-written picks, "bookable" only Viator products', () => {
    expect(provenancePass(local, 'local')).toBe(true);
    expect(provenancePass(item, 'local')).toBe(false);
    expect(provenancePass(item, 'bookable')).toBe(true);
    expect(provenancePass(local, 'bookable')).toBe(false);
  });
});

// --- sortEntries -----------------------------------------------------------
describe('sortEntries', () => {
  const item = (id: string, over: Partial<ViatorItem>): ExploreEntry =>
    ({ kind: 'item', item: { id, rating: 4.8, review_count: 100, price_usd: 100, is_best_seller: false, ...over } as ViatorItem, category: 'Tours', adventure: 50, sections: [] });
  const local = (id: string, over: Partial<Activity> = {}): ExploreEntry =>
    ({ kind: 'activity', activity: { id, cost: 'Free', rating: 4.7, reviewCount: 900, ...over } as Activity, category: 'Beaches', adventure: 8, sections: [] });
  const ids = (out: ExploreEntry[]) => out.map(entryId);

  test('"recommended" leaves the house order exactly as it found it', () => {
    const list = [item('b', { price_usd: 300 }), item('a', { price_usd: 10 })];
    expect(sortEntries(list, 'recommended')).toBe(list);
  });

  test('price sorts run both ways, with free picks at the cheap end', () => {
    const list = [item('mid', { price_usd: 120 }), local('free'), item('top', { price_usd: 3656 })];
    expect(ids(sortEntries(list, 'price-asc'))).toEqual(['free', 'mid', 'top']);
    expect(ids(sortEntries(list, 'price-desc'))).toEqual(['top', 'mid', 'free']);
  });

  // The whole point of the rating sort: 124 products in the live catalog score
  // exactly 5.0, many off single-digit review counts. Stars alone would put the
  // least-known product on top of the page.
  test('among equal stars, the product a real crowd rated comes first', () => {
    const list = [item('thin', { rating: 5, review_count: 3 }), item('proven', { rating: 5, review_count: 9985 })];
    expect(ids(sortEntries(list, 'rating'))).toEqual(['proven', 'thin']);
  });

  // The founders' vouch is worth 5.0 off two reviews — enough to sit among the
  // best of the catalog, not enough to beat a product 94 other people also rated
  // five. This is the ordering rule; `ratingOf` still reports the pick as
  // unrated, so no number reaches the card.
  test('a vouched local pick sorts below a well-reviewed 5.0 and above a thin one', () => {
    const list = [
      item('thin', { rating: 5, review_count: 1 }),
      local('eagle-beach'),
      item('proven', { rating: 5, review_count: 9985 }),
    ];
    expect(ids(sortEntries(list, 'rating'))).toEqual(['proven', 'eagle-beach', 'thin']);
  });

  test('a vouched local pick outranks a lower-starred product however many reviews it has', () => {
    const list = [item('utv', { rating: 4.9, review_count: 8803 }), local('eagle-beach')];
    expect(ids(sortEntries(list, 'rating'))).toEqual(['eagle-beach', 'utv']);
  });

  test('the vouch is worth two reviews and no more when sorting by review count', () => {
    const list = [local('eagle-beach'), item('busy', { review_count: 8803 }), item('lone', { review_count: 1 })];
    expect(ids(sortEntries(list, 'reviews'))).toEqual(['busy', 'eagle-beach', 'lone']);
  });

  test('the vouch changes ranking only — the pick is still reported unrated', () => {
    expect(ratingOf(local('eagle-beach')).real).toBe(false);
    expect(reviewsPass(local('eagle-beach'), 2)).toBe(false);
  });

  test('an unrated PRODUCT still sinks below everything, vouched picks included', () => {
    const list = [item('new', { rating: 0, review_count: 0 }), item('rated', { rating: 4.0, review_count: 5 }), local('beach')];
    expect(ids(sortEntries(list, 'rating'))).toEqual(['beach', 'rated', 'new']);
    expect(ids(sortEntries(list, 'reviews'))).toEqual(['rated', 'beach', 'new']);
  });

  // A product with a review count but no rating is not rated — `ratingOf` says
  // so — and must not be ranked as though those reviews said something. Without
  // the two-block split, "most reviewed" would hand it the top of the page on
  // the strength of a score nobody gave it.
  test('"reviews" will not rank an unrated product on a bare count', () => {
    const list = [item('countOnly', { rating: 0, review_count: 5000 }), item('rated', { rating: 4.4, review_count: 30 })];
    expect(ids(sortEntries(list, 'reviews'))).toEqual(['rated', 'countOnly']);
  });

  test('"reviews" falls back to house order inside the unrated block', () => {
    const list = [
      item('quiet', { rating: 0, review_count: 0 }),
      item('featured', { rating: 0, review_count: 0, is_best_seller: true }),
    ];
    expect(ids(sortEntries(list, 'reviews'))).toEqual(['featured', 'quiet']);
  });

  test('"reviews" orders by how many people actually turned up', () => {
    const list = [item('few', { review_count: 8 }), item('many', { review_count: 731 }), item('some', { review_count: 40 })];
    expect(ids(sortEntries(list, 'reviews'))).toEqual(['many', 'some', 'few']);
  });

  test('sorting does not mutate the list it was given', () => {
    const list = [item('b', { price_usd: 300 }), item('a', { price_usd: 10 })];
    sortEntries(list, 'price-asc');
    expect(ids(list)).toEqual(['b', 'a']);
  });
});

// --- the extra filters through filterExploreEntries ------------------------
describe('filterExploreEntries — stars, reviews, duration, provenance', () => {
  const catalog: Catalog = getCatalog();
  const ALL = { section: 'All', search: '', vibe: 50, price: 50 };

  test('omitting every extra filter changes nothing', () => {
    expect(filterExploreEntries(catalog, ALL).length)
      .toBe(filterExploreEntries(catalog, { ...ALL, minStars: 0, minReviews: 0, duration: 'any', privateOnly: false, provenance: 'all' }).length);
  });

  test('a stars bar keeps every local pick and drops the products under it', () => {
    const out = filterExploreEntries(catalog, { ...ALL, minStars: 4.7 });
    expect(out.filter((e) => e.kind === 'activity').length).toBe(catalog.activities.length);
    for (const e of out) if (e.kind === 'item') expect(e.item.rating).toBeGreaterThanOrEqual(4.7);
    expect(out.filter((e) => e.kind === 'item').length).toBeLessThan(catalog.items.length);
  });

  test('a review bar drops the local picks, which have no crowd behind them', () => {
    const out = filterExploreEntries(catalog, { ...ALL, minReviews: 500 });
    expect(out.every((e) => e.kind === 'item')).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) if (e.kind === 'item') expect(e.item.review_count).toBeGreaterThanOrEqual(500);
  });

  test('a duration band narrows to that band', () => {
    const out = filterExploreEntries(catalog, { ...ALL, duration: 'short' });
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(catalog.items.length + catalog.activities.length);
  });

  test('provenance splits the catalog in two and loses nothing', () => {
    const local = filterExploreEntries(catalog, { ...ALL, provenance: 'local' });
    const bookable = filterExploreEntries(catalog, { ...ALL, provenance: 'bookable' });
    expect(local.every((e) => e.kind === 'activity')).toBe(true);
    expect(bookable.every((e) => e.kind === 'item')).toBe(true);
    expect(local.length + bookable.length).toBe(filterExploreEntries(catalog, ALL).length);
  });
});
