import { describe, expect, test } from 'vitest';
import {
  itemCategory,
  exploreCatalogCounts,
  advValue,
  keywordAdventure,
  vibePass,
  priceValue,
  pricePass,
  priceOf,
  bookUrlForEntry,
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
  poolPass,
  sailPass,
  sortEntries,
  rankRecommended,
  shrunkRating,
  templateFit,
  templateTarget,
  personaScore,
  type ExploreEntry,
} from './exploreItems';
import { getCatalog, type Catalog } from './activitySource';
import { LUNCHSPOTS, LUNCHSPOT_ACTIVITY_DUPES } from './lunchspots';
import type { Activity } from './activities';
import type { MatchTag, ViatorGroup, ViatorItem } from '../types';
import { fitItem } from './itemFit';

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

// --- bookUrlForEntry (drives the "Book now" button; renamed
// from `bookingUrl` in fix round 1 of task 8 to stop colliding with the
// Activity.bookingUrl field) -------------------------------------------------
describe('bookUrlForEntry', () => {
  const item = (over: Partial<ViatorItem>): ExploreEntry =>
    ({ kind: 'item', item: { price_usd: 100, viator_item_url: 'https://viator/x', ...over } as ViatorItem, category: 'Tours', adventure: 50, sections: [] });
  const act = (cost: string, url?: string, bookingUrlOverride?: string): ExploreEntry =>
    ({ kind: 'activity', activity: { cost, viator_item_url: url, bookingUrl: bookingUrlOverride } as never, category: 'Food', adventure: 20, sections: [] });

  test('a paid Viator item is bookable, and affiliate', () => {
    const r = bookUrlForEntry(item({}));
    expect(r).toEqual({ url: 'https://viator/x?medium=link', affiliate: true });
  });

  test('a free item (price 0) is not bookable', () => {
    expect(bookUrlForEntry(item({ price_usd: 0 }))).toBeNull();
  });

  test('a paid local pick with a Viator booking link is bookable, and affiliate', () => {
    const r = bookUrlForEntry(act('$65 guided', 'https://viator/y'));
    expect(r).toEqual({ url: 'https://viator/y?medium=link', affiliate: true });
  });

  test('a free local pick is never bookable, even with a link', () => {
    expect(bookUrlForEntry(act('Free', 'https://viator/z'))).toBeNull();
    expect(bookUrlForEntry(act('Free + $10 rental', 'https://viator/z'))).toBeNull();
  });

  test('a paid local pick without a link is not bookable', () => {
    expect(bookUrlForEntry(act('$35 pp'))).toBeNull();
  });

  // R17: this is the sixth call site — the Explore "Book now" button was
  // going through this function, which never consulted `Activity.bookingUrl`,
  // so Flamingo got a working link on the itinerary card and the Explore
  // tile click-through but no button in Explore at all.
  test('a paid local pick with a direct (non-Viator) booking link is bookable, and NOT affiliate', () => {
    const r = bookUrlForEntry(act('$125 day pass', undefined, 'https://renaissancearuba.idaypass.com/'));
    expect(r).toEqual({ url: 'https://renaissancearuba.idaypass.com/', affiliate: false });
    expect(r!.url).not.toContain('medium=link');
  });

  test('a Viator link wins over a direct link when an activity somehow has both', () => {
    const r = bookUrlForEntry(act('$65 guided', 'https://viator/y', 'https://direct.example/'));
    expect(r).toEqual({ url: 'https://viator/y?medium=link', affiliate: true });
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

// Lunch spots ride in `catalog.lunchspots`, not `catalog.activities` — that
// second list is the generator's swap pool and deliberately excludes them.
// Explore shows both, so "every activity" means both here.
const localTiles = (c: Catalog) => {
  const ids = new Set(c.activities.map((a) => a.id));
  const spots = (c.lunchspots ?? []).filter((l) => {
    const dupe = LUNCHSPOT_ACTIVITY_DUPES[l.id];
    return !dupe || !ids.has(dupe);
  });
  return c.activities.length + spots.length;
};

// --- filterExploreEntries (integration against the real stub catalog) ------
describe('filterExploreEntries', () => {
  const catalog: Catalog = getCatalog();
  const ALL = { section: 'All', search: '', vibe: 50, price: 50 };


  test('at default slider positions, every item and activity appears (nothing silently dropped)', () => {
    const out = filterExploreEntries(catalog, ALL);
    expect(out.filter((e) => e.kind === 'item').length).toBe(catalog.items.length);
    expect(out.filter((e) => e.kind === 'activity').length).toBe(localTiles(catalog));
  });

  test('every curated lunch spot gets a tile, except one that IS an activity', () => {
    const out = filterExploreEntries(catalog, ALL);
    const ids = new Set(out.flatMap((e) => (e.kind === 'activity' ? [e.activity.id] : [])));
    expect(LUNCHSPOTS.length).toBeGreaterThan(0);
    const absent = LUNCHSPOTS.filter((l) => !ids.has(l.id)).map((l) => l.id);
    // Exact set: a new same-venue pair has to be declared, not silently doubled.
    expect(absent.sort()).toEqual(Object.keys(LUNCHSPOT_ACTIVITY_DUPES).sort());
  });

  test('one restaurant, one tile — Zeerover does not appear twice', () => {
    const out = filterExploreEntries(catalog, ALL);
    const zeerover = out.filter((e) => e.kind === 'activity' && /zeerover/i.test(e.activity.title));
    expect(zeerover).toHaveLength(1);
    expect(zeerover[0].kind === 'activity' && zeerover[0].activity.id).toBe('zeerovers-fresh-catch');
  });

  // The header used to count `catalog.items` + `catalog.activities` while the
  // grid counted the deduped entry list, so it advertised 355 tiles over a page
  // showing 351 — the four picks `keepsOwnTile` folds into their product.
  test('the header counts agree with the grid, exactly', () => {
    const { items, localPicks } = exploreCatalogCounts(catalog);
    expect(items + localPicks).toBe(filterExploreEntries(catalog, ALL).length);
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

describe('poolPass', () => {
  const item = (title: string, description = ''): ExploreEntry =>
    ({ kind: 'item', item: { title, description } as ViatorItem, category: 'Tours', adventure: 50, sections: [] });
  const local = (title: string, description = ''): ExploreEntry =>
    ({ kind: 'activity', activity: { title, description } as Activity, category: 'Beaches', adventure: 8, sections: [] });

  const conchiJeep = item('Aruba Jeep Tour: Natural Pool, Caves and Baby Beach Adventure');
  const conchiHike = item('Arikok Sunrise Hiking Tour to Natural Pool + Transportation');
  // The whole reason the pool half reads descriptions: 6 of the 28 Conchi
  // products on the live catalog never say so in their title.
  const conchiByDesc = item('Private Jeep Tour to Arikok National Park', 'A 4x4 run through Arikok, stopping to swim at the Natural Pool.');
  // The Cave Pool is a different place — outside Arikok, and the only one the
  // quads can reach. One filter covers both, which is what keeps ATV answerable.
  const caveAtv = item('Aruba North Coast ATV Desert Adventure', 'End the trip by taking a refreshing dip at the Cave Pool.');
  const caveUtv = item('Aruba UTV Tour with Natural Cave Pool and Cliff Jumping');
  const unrelated = item('Aruba Sunset Catamaran Sail', 'Open bar and snorkelling off Boca Catalina.');

  test('off, it admits everything', () => {
    expect(poolPass(conchiJeep, false, 'any')).toBe(true);
    expect(poolPass(unrelated, undefined, undefined)).toBe(true);
    // The mode alone must not filter — it is a SUB-filter, and a mode left set
    // while the pool is switched off would otherwise narrow the page invisibly.
    expect(poolPass(unrelated, false, 'jeep')).toBe(true);
  });

  test('on, it keeps what goes to a pool and drops what does not', () => {
    expect(poolPass(conchiJeep, true, 'any')).toBe(true);
    expect(poolPass(conchiHike, true, 'any')).toBe(true);
    expect(poolPass(caveAtv, true, 'any')).toBe(true);
    expect(poolPass(caveUtv, true, 'any')).toBe(true);
    expect(poolPass(unrelated, true, 'any')).toBe(false);
  });

  test('the description counts, not just the title', () => {
    expect(poolPass(conchiByDesc, true, 'any')).toBe(true);
    expect(poolPass(conchiByDesc, true, 'jeep')).toBe(true);
  });

  test('the mode narrows within the pool', () => {
    expect(poolPass(conchiJeep, true, 'jeep')).toBe(true);
    expect(poolPass(conchiJeep, true, 'hike')).toBe(false);
    expect(poolPass(conchiHike, true, 'hike')).toBe(true);
    expect(poolPass(caveAtv, true, 'atv')).toBe(true);
    expect(poolPass(caveAtv, true, 'jeep')).toBe(false);
  });

  // UTV and ATV are separate buttons here, unlike itemFit's UTV_TITLE, which
  // treats the whole quad family as one for the generator's vehicle preference.
  test('UTV and ATV are separate buttons', () => {
    const utv = item('Aruba UTV Adventure to Natural Pool Jeep Transfer');
    expect(poolPass(utv, true, 'utv')).toBe(true);
    expect(poolPass(utv, true, 'atv')).toBe(false);
    expect(poolPass(caveAtv, true, 'utv')).toBe(false);
  });

  // The two halves read different text on purpose. Matching the mode on prose
  // too filed four live products under the wrong button; these are two of them.
  test('the pool reads the description, the mode does not', () => {
    const horseback = item('Horseback Ride Tour to Natural Pool in Arikok National Park',
      'The pool can only be reached by walking, horseback or 4x4.');
    expect(poolPass(horseback, true, 'any')).toBe(true);
    expect(poolPass(horseback, true, 'horseback')).toBe(true);
    expect(poolPass(horseback, true, 'jeep')).toBe(false);

    const sunriseHike = item('Sunrise Hike & Swim in Natural Pool',
      'Be the first swimmers, before the packed jeep riders arrive.');
    expect(poolPass(sunriseHike, true, 'hike')).toBe(true);
    expect(poolPass(sunriseHike, true, 'jeep')).toBe(false);
  });

  // Three Conchi tours name no vehicle beyond "Safari Tour", and they are jeeps
  // — the same alternation itemFit's JEEP_VEHICLE_TITLE uses.
  test('a safari is a jeep', () => {
    expect(poolPass(item('Aruba Natural Pools Northshore Safari Tour'), true, 'jeep')).toBe(true);
  });

  // A listing that never says how you get there answers to no vehicle, which is
  // the honest reading of a title that does not say.
  test('a tour that names no vehicle answers only to Any', () => {
    const silent = item('Natural Pool Caves and Beach Private Tour');
    expect(poolPass(silent, true, 'any')).toBe(true);
    for (const m of ['jeep', 'utv', 'atv', 'horseback', 'hike'] as const) {
      expect(poolPass(silent, true, m)).toBe(false);
    }
  });

  test('a local pick is filtered on its own words, not skipped', () => {
    expect(poolPass(local('Conchi Natural Pool', 'Reachable only by 4x4.'), true, 'any')).toBe(true);
    expect(poolPass(local('Eagle Beach', 'Wide white sand.'), true, 'any')).toBe(false);
  });
});

describe('sailPass', () => {
  // Ids that carry real start times in src/data/startTimes.json, so the time
  // facets are tested against the same snapshot the app ships:
  //   245504 -> 09:00   245508 -> 17:30   102406P4 -> 09:00, 13:00
  const sail = (id: string, title: string, description = ''): ExploreEntry =>
    ({ kind: 'item', item: { id, title, description, tags: [11888] } as unknown as ViatorItem,
       category: 'Tours', adventure: 40, sections: [] });
  const notASail: ExploreEntry =
    { kind: 'item', item: { id: '245504', title: 'Aruba Jeep Safari', description: 'Open bar and lunch.' } as ViatorItem,
      category: 'Tours', adventure: 70, sections: [] };
  const local: ExploreEntry =
    { kind: 'activity', activity: { title: 'Sunset at Arashi Beach' } as Activity, category: 'Beaches', adventure: 8, sections: [] };

  test('off, it admits everything', () => {
    expect(sailPass(notASail, false, [])).toBe(true);
    expect(sailPass(local, undefined, undefined)).toBe(true);
    // Facets alone must not filter — they are a SUB-filter of the checkbox.
    expect(sailPass(notASail, false, ['sunset'])).toBe(true);
  });

  test('on, it keeps sails and drops everything else', () => {
    expect(sailPass(sail('245508', 'Aruba Sunset Sail with Open Bar'), true, [])).toBe(true);
    expect(sailPass(notASail, true, [])).toBe(false);
    expect(sailPass(local, true, [])).toBe(false);
  });

  test('the time comes from the real departure, not the prose', () => {
    const morning = sail('245504', 'Half-Day Snorkel Sail Tour');
    expect(sailPass(morning, true, ['morning'])).toBe(true);
    expect(sailPass(morning, true, ['afternoon'])).toBe(false);
    expect(sailPass(morning, true, ['sunset'])).toBe(false);

    const evening = sail('245508', 'Catamaran Cruise');
    expect(sailPass(evening, true, ['sunset'])).toBe(true);
    expect(sailPass(evening, true, ['afternoon'])).toBe(false);
  });

  // "Sunset Champagne and Lobster sail" departs at 14:30. A traveller asking
  // for an afternoon sail does not mean that one, so the title wins the clock.
  test('a titled sunset sail is a sunset sail whatever time it leaves', () => {
    const early = sail('102406P4', 'Sunset Champagne and Lobster Sail');
    expect(sailPass(early, true, ['sunset'])).toBe(true);
    expect(sailPass(early, true, ['afternoon'])).toBe(false);
    expect(sailPass(early, true, ['morning'])).toBe(false);
  });

  test('a sail with two departures answers to both', () => {
    const both = sail('102406P4', 'Tropical Sailing Experience');
    expect(sailPass(both, true, ['morning'])).toBe(true);
    expect(sailPass(both, true, ['afternoon'])).toBe(true);
  });

  test('what is on board is read from the description too', () => {
    const s = sail('245504', 'Private Catamaran Charter', 'Includes a Caribbean lunch, an open bar and two snorkelling stops.');
    expect(sailPass(s, true, ['food'])).toBe(true);
    expect(sailPass(s, true, ['cocktails'])).toBe(true);
    expect(sailPass(s, true, ['snorkeling'])).toBe(true);
    const bare = sail('245504', 'Private Catamaran Charter', 'Three hours along the coast.');
    expect(sailPass(bare, true, ['food'])).toBe(false);
    expect(sailPass(bare, true, ['snorkeling'])).toBe(false);
  });

  // The rule that makes multi-select usable: three times are three answers to
  // one question, so they widen; what is on board narrows.
  test('times OR each other, everything else ANDs', () => {
    const morningSnorkel = sail('245504', 'Morning Snorkel Sail', 'Snorkelling and a light brunch.');
    const sunsetBar = sail('245508', 'Sunset Sail', 'Open bar on board.');

    // ANDing the times would make this pair impossible; ORing returns both.
    expect(sailPass(morningSnorkel, true, ['morning', 'sunset'])).toBe(true);
    expect(sailPass(sunsetBar, true, ['morning', 'sunset'])).toBe(true);

    // Across the groups it narrows: a morning sail with snorkelling, yes; the
    // sunset one, no, because it does not snorkel.
    expect(sailPass(morningSnorkel, true, ['morning', 'sunset', 'snorkeling'])).toBe(true);
    expect(sailPass(sunsetBar, true, ['morning', 'sunset', 'snorkeling'])).toBe(false);

    // And two on-board facets both have to hold.
    expect(sailPass(morningSnorkel, true, ['snorkeling', 'food'])).toBe(true);
    expect(sailPass(morningSnorkel, true, ['snorkeling', 'cocktails'])).toBe(false);
  });

  test('no facets means every sail', () => {
    expect(sailPass(sail('245508', 'Aruba Sunset Sail'), true, [])).toBe(true);
    expect(sailPass(sail('245508', 'Aruba Sunset Sail'), true, undefined)).toBe(true);
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

  // A vouched Viator product answers to "Local picks" as well as "Bookable" —
  // the mark says who recommends it, not who sells it. 37387P3 is the Jolly
  // Pirate afternoon sail, one of the three on the list.
  test('a vouched Viator product counts as a local pick AND as bookable', () => {
    const vouched: ExploreEntry =
      { kind: 'item', item: { id: '37387P3' } as ViatorItem, category: 'Tours', adventure: 40, sections: [] };
    const plain: ExploreEntry =
      { kind: 'item', item: { id: '245504' } as ViatorItem, category: 'Tours', adventure: 40, sections: [] };
    expect(provenancePass(vouched, 'local')).toBe(true);
    expect(provenancePass(vouched, 'bookable')).toBe(true);
    expect(provenancePass(plain, 'local')).toBe(false);
    expect(provenancePass(plain, 'bookable')).toBe(true);
  });

  // 'free' asks a price question in a row that otherwise asks who wrote the
  // tile, so these pin the one behaviour the row's shape does not imply.
  const priced = (cost: string): ExploreEntry =>
    ({ kind: 'activity', activity: { cost } as Activity, category: 'Beaches', adventure: 8, sections: [] });
  const product = (price_usd: number): ExploreEntry =>
    ({ kind: 'item', item: { price_usd } as ViatorItem, category: 'Tours', adventure: 50, sections: [] });

  test('"free" keeps what costs nothing and drops what does not', () => {
    expect(provenancePass(priced('Free'), 'free')).toBe(true);
    expect(provenancePass(priced('$11 entry'), 'free')).toBe(false);
    expect(provenancePass(product(0), 'free')).toBe(true);
    expect(provenancePass(product(89), 'free')).toBe(false);
  });

  test('"free" reads price, not provenance — a paid local pick is dropped', () => {
    // The failure this guards: implementing 'free' as "the local picks", which
    // passes every other assertion here because all 17 free entries are local.
    expect(provenancePass(priced('$99 pass'), 'free')).toBe(false);
    expect(provenancePass(priced('$99 pass'), 'local')).toBe(true);
  });

  test('"free" inherits parseActivityCost, gear surcharge and all', () => {
    // Baby Beach is 'Free + $16 gear'. It parses to 0, so it shows under Free —
    // the same answer the Price slider's left end already gives.
    expect(provenancePass(priced('Free + $16 gear'), 'free')).toBe(true);
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
    expect(out.filter((e) => e.kind === 'activity').length).toBe(localTiles(catalog));
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

// --- "Recommended" ----------------------------------------------------------
describe('shrunkRating', () => {
  const r = (stars: number, reviews: number) => ({ stars, reviews, real: true });

  test('a rating nobody has tested is pulled most of the way to the catalog mean', () => {
    // 9 reviews against a prior of 50 keeps ~15% of the product's own score.
    expect(shrunkRating(r(5, 9), 4.8)).toBeCloseTo(4.83, 2);
  });

  test('a rating thousands have tested keeps almost all of its own score', () => {
    expect(shrunkRating(r(5, 9985), 4.8)).toBeCloseTo(5.0, 2);
  });

  // The defect this whole term exists to fix.
  test('a well-tested 4.9 beats a barely-tested 5.0', () => {
    expect(shrunkRating(r(4.9, 8803), 4.8)).toBeGreaterThan(shrunkRating(r(5, 9), 4.8));
  });

  test('no reviews at all lands exactly on the catalog mean', () => {
    expect(shrunkRating(r(0, 0), 4.8)).toBeCloseTo(4.8, 5);
  });
});

describe('templateFit', () => {
  test('peaks at the template’s own average intensity', () => {
    expect(templateFit(22.5)).toBe(1);
  });

  test('a calm snorkel scores far above an off-road tour', () => {
    expect(templateFit(18)).toBeGreaterThan(0.9);
    expect(templateFit(85)).toBe(0);
  });

  test('never goes negative, however extreme the entry', () => {
    expect(templateFit(100)).toBe(0);
    expect(templateFit(0)).toBeGreaterThanOrEqual(0);
  });

  test('follows the target it is given', () => {
    expect(templateFit(85, 85)).toBe(1);
    expect(templateFit(22.5, 85)).toBe(0);
  });
});

// The template sets the default character; the traveller moves it. Without this,
// a 30%-weighted pull toward calm cancelled the persona term and an adrenaline
// answer produced a CALMER page (mean intensity 24) than a beach-chill one (27).
describe('templateTarget', () => {
  test('with no answers it is the template’s own character', () => {
    expect(templateTarget(false, 90)).toBe(22.5);
    expect(templateTarget(false, 50)).toBe(22.5);
  });

  test('once answered it meets the traveller halfway', () => {
    expect(templateTarget(true, 90)).toBe(56.25);
    expect(templateTarget(true, 0)).toBe(11.25);
  });

  test('the house taste always moderates — the target never reaches the extreme', () => {
    expect(templateTarget(true, 100)).toBeLessThan(100);
    expect(templateTarget(true, 100)).toBeGreaterThan(50);
  });
});

describe('personaScore', () => {
  // fitItem rejects anything over the budget tier's cap. On a plan that is
  // right; on a browse page it would hide a third of the catalog from a
  // budget traveller, so rankRecommended reads the score and drops the verdict.
  test('an over-budget product still scores rather than vanishing', () => {
    const tags = new Set<MatchTag>(['budget']);
    const raw = { price_usd: 3656, popularity_score: 0 } as ViatorItem;
    const lavish: ExploreEntry = { kind: 'item', item: raw, category: 'Tours', adventure: 50, sections: [] };
    expect(fitItem(raw, tags).rejected).toBe(true);
    expect(fitItem(raw, tags).score).toBe(-Infinity);
    // Finite, and at the floor rather than at negative infinity — the item ranks
    // last on fit but quality and the template can still carry it up the page.
    expect(personaScore(lavish, tags)).toBe(0);
  });

  test('a local pick scores on its own tags, three points per overlap', () => {
    const beach: ExploreEntry = {
      kind: 'activity',
      activity: { sections: ['beaches'], adventure: 8 } as Activity,
      category: 'Beaches', adventure: 8, sections: ['beaches'],
    };
    expect(personaScore(beach, new Set<MatchTag>(['low-adventure']))).toBeGreaterThan(0);
    expect(personaScore(beach, new Set<MatchTag>(['nightlife']))).toBe(0);
  });
});

describe('rankRecommended', () => {
  const NO_TAGS = { tags: new Set<MatchTag>(), hasPersona: false };
  const item = (id: string, over: Partial<ViatorItem>, adventure = 22): ExploreEntry =>
    ({ kind: 'item', item: { id, rating: 4.8, review_count: 100, price_usd: 100, popularity_score: 0, ...over } as ViatorItem, category: 'Tours', adventure, sections: [] });
  const ids = (out: ExploreEntry[]) => out.map(entryId);

  // The whole reason the old default was replaced.
  test('the is_best_seller pin no longer lifts anything', () => {
    const list = [
      item('pinned', { is_best_seller: true, rating: 5, review_count: 9 }),
      item('proven', { rating: 5, review_count: 9985 }),
    ];
    expect(ids(rankRecommended(list, NO_TAGS))).toEqual(['proven', 'pinned']);
  });

  // Ranked on quality alone the live top 8 came back as six off-road tours, all
  // sitting at adventure 85. Quality is a PERCENTILE, so this needs a realistic
  // spread to mean anything: with only two entries the percentiles collapse to
  // 0 and 1 and quality's 0.55 simply outweighs the template's 0.45, which is
  // arithmetic rather than behaviour.
  test('the best-reviewed off-road tour does not lead a page of calm alternatives', () => {
    const list = [
      item('utv', { rating: 5, review_count: 9985 }, 85),
      ...Array.from({ length: 8 }, (_, i) =>
        item(`calm${i}`, { rating: 4.9, review_count: 900 - i * 100 }, 20 + i)),
    ];
    const out = ids(rankRecommended(list, NO_TAGS));
    expect(out[0]).not.toBe('utv');
    expect(out.indexOf('utv')).toBeGreaterThan(4);
  });

  // Shrinkage is measured AGAINST the catalog mean, so the fixture has to look
  // like a catalog: three near-perfect entries average 4.9, and a 5.0 shrunk
  // toward 4.9 is still above a 4.9, so the thin one would win and the test
  // would be describing its own fixture rather than the behaviour. The fillers
  // pull the mean to ~4.67, which is where the live catalog sits (4.79).
  test('among equally calm entries, the better-reviewed one wins', () => {
    const list = [
      item('thin', { rating: 5, review_count: 4 }, 22),
      item('proven', { rating: 4.9, review_count: 5000 }, 22),
      ...Array.from({ length: 8 }, (_, i) => item(`filler${i}`, { rating: 4.6, review_count: 200 }, 22)),
    ];
    expect(ids(rankRecommended(list, NO_TAGS))[0]).toBe('proven');
  });

  // The fixture has to be one the persona term WOULD reorder, or the test passes
  // whether or not `hasPersona` is honoured. These two local picks are identical
  // except for their section, and 'watersports' matches exactly one of them.
  const pick = (id: string, section: 'beaches' | 'cruises-water'): ExploreEntry => ({
    kind: 'activity',
    activity: { id, sections: [section], adventure: 22, cost: 'Free' } as Activity,
    category: 'Beaches', adventure: 22, sections: [section],
  });

  test('with no answers the persona term cannot move anything', () => {
    const list = [pick('beach', 'beaches'), pick('boat', 'cruises-water')];
    const tags = new Set<MatchTag>(['watersports']);
    // Proof the fixture is sensitive: with the persona term ON, the tag reorders it.
    expect(ids(rankRecommended(list, { tags, hasPersona: true }))).toEqual(['boat', 'beach']);
    // ...and with it OFF, the same tags change nothing.
    expect(ids(rankRecommended(list, { tags, hasPersona: false }))).toEqual(ids(rankRecommended(list, NO_TAGS)));
  });

  test('answers reorder the page', () => {
    const watery: ExploreEntry = {
      kind: 'activity',
      activity: { id: 'snorkel-cove', sections: ['cruises-water'], adventure: 22 } as Activity,
      category: 'Watersports', adventure: 22, sections: ['cruises-water'],
    };
    const list = [item('generic', { rating: 5, review_count: 4000 }), watery];
    const before = ids(rankRecommended(list, NO_TAGS));
    const after = ids(rankRecommended(list, { tags: new Set<MatchTag>(['watersports']), hasPersona: true }));
    expect(before).toEqual(['generic', 'snorkel-cove']);
    expect(after).toEqual(['snorkel-cove', 'generic']);
  });

  // The bug the before/after print caught: an adrenaline answer used to return a
  // calmer page than a beach-chill one, because the template pulled everything
  // toward 22.5 whatever the traveller said.
  test('an adrenaline answer surfaces the intense entries, not the calm ones', () => {
    const list = [
      item('calm', { rating: 4.9, review_count: 900 }, 18),
      item('wild', { rating: 4.9, review_count: 900 }, 85),
    ];
    const chill = { tags: new Set<MatchTag>(), hasPersona: true, adventureLevel: 5 };
    const wild = { tags: new Set<MatchTag>(), hasPersona: true, adventureLevel: 95 };
    expect(ids(rankRecommended(list, chill))[0]).toBe('calm');
    expect(ids(rankRecommended(list, wild))[0]).toBe('wild');
  });

  // The regression the ship gate caught: ranking the BLENDED search list promoted
  // semantic-only matches above keyword ones, voiding the premise on which
  // VITE_SEMANTIC_SEARCH shipped at 65% recall.
  test('search-by-meaning results stay below the keyword hits', () => {
    const keyword = [
      item('kw-weak', { rating: 4.2, review_count: 30 }, 22),
      item('kw-strong', { rating: 5, review_count: 9000 }, 22),
    ];
    const tail = [item('semantic', { rating: 5, review_count: 9999 }, 22)];
    const out = ids(rankRecommended([...keyword, ...tail], { ...NO_TAGS, semanticTail: 1 }));
    // The tail entry outscores both keyword hits on every term and still sits last.
    expect(out).toEqual(['kw-strong', 'kw-weak', 'semantic']);
  });

  test('the keyword block is still ranked, the tail merely untouched', () => {
    const list = [
      item('weak', { rating: 4.2, review_count: 30 }, 22),
      item('strong', { rating: 5, review_count: 9000 }, 22),
      item('tailA', { rating: 5, review_count: 1 }, 22),
      item('tailB', { rating: 5, review_count: 9999 }, 22),
    ];
    const out = ids(rankRecommended(list, { ...NO_TAGS, semanticTail: 2 }));
    expect(out.slice(0, 2)).toEqual(['strong', 'weak']);   // reordered
    expect(out.slice(2)).toEqual(['tailA', 'tailB']);      // arrival order kept
  });

  test('a tail longer than the list does not throw or duplicate', () => {
    const list = [item('a', {}), item('b', {})];
    expect(ids(rankRecommended(list, { ...NO_TAGS, semanticTail: 9 }))).toEqual(['a', 'b']);
  });

  // shrunkRating with zero reviews returns exactly the catalog mean, which would
  // park the 34 unrated products at the 50th percentile — mid-page, above 150+
  // products a crowd actually rated.
  test('an unrated product is floored, not parked at the catalog average', () => {
    const list = [
      item('unrated', { rating: 0, review_count: 0 }, 22),
      item('mediocre', { rating: 4.3, review_count: 40 }, 22),
      item('good', { rating: 4.9, review_count: 900 }, 22),
    ];
    expect(ids(rankRecommended(list, NO_TAGS))).toEqual(['good', 'mediocre', 'unrated']);
  });

  test('a single entry, or none, comes back untouched', () => {
    const one = [item('only', {})];
    expect(rankRecommended(one, NO_TAGS)).toBe(one);
    expect(rankRecommended([], NO_TAGS)).toEqual([]);
  });

  test('entries that score identically keep the order they arrived in', () => {
    const list = [item('first', {}), item('second', {}), item('third', {})];
    expect(ids(rankRecommended(list, NO_TAGS))).toEqual(['first', 'second', 'third']);
  });

  test('sortEntries only ranks when it is given a traveller', () => {
    const list = [item('pinned', { is_best_seller: true, rating: 5, review_count: 9 }), item('proven', { rating: 5, review_count: 9985 })];
    expect(sortEntries(list, 'recommended')).toBe(list);                 // no ctx — untouched
    expect(ids(sortEntries(list, 'recommended', NO_TAGS))).toEqual(['proven', 'pinned']);
  });
});

// --- matched local picks are not shown twice --------------------------------
/**
 * `mergeLocalMatches` gives a curated pick its matched product's title, image,
 * rating and link — so the pick and the product become two tiles for one
 * bookable thing, differing only in a "Local pick" badge. Four picks are
 * matched on the live catalog and all four duplicated.
 *
 * The PRODUCT is the tile that survives. The pick has already adopted almost
 * everything editorial about the product, and what it keeps is wrong: its `cost`
 * is a hand-written string that has drifted from the live price (natural-pool-
 * jeep reads "$75 pp" against a product that now costs $99), and it renders that
 * beside a Book now button that charges the real price.
 */
describe('filterExploreEntries — a matched local pick and its product are one tile', () => {
  const catalogWith = (over: Partial<Activity>): Catalog => ({
    groups: [{ id: 'sailing-cruises', matched_by: [], region: 'palm-beach', allowed_slots: [] } as unknown as ViatorGroup],
    items: [{
      id: '6841POOL', group_id: 'sailing-cruises', title: 'Aruba Natural Pool Jeep Safari',
      price_usd: 99, duration: '4.5 hrs', rating: 5, review_count: 9319,
      viator_item_url: 'https://www.viator.com/tours/Aruba/x/d28-6841POOL', is_best_seller: false,
      display_order: 0, sections: ['adventures-outdoor'],
    } as ViatorItem],
    activities: [{
      id: 'natural-pool-jeep', title: 'Aruba Natural Pool Jeep Safari', category: 'Activities',
      image: '', description: '', localsSay: '', cost: '$75 pp', duration: '3–5 hrs',
      timeOfDay: 'Morning', fitReason: '', location: 'Arikok', rating: 5, reviewCount: 9319,
      ratingSource: 'viator', sections: ['adventures-outdoor'], matched_by: [],
      viator_item_url: 'https://www.viator.com/tours/Aruba/x/d28-6841POOL', ...over,
    } as Activity],
  });
  const ALL = { section: 'All', search: '', vibe: 50, price: 50 };

  test('the pick is dropped and the product kept, so the price on screen is the real one', () => {
    const out = filterExploreEntries(catalogWith({}), ALL);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('item');
    expect(priceOf(out[0])).toBe(99);
  });

  test('an UNMATCHED local pick is untouched — this must not eat the other 22', () => {
    const cat = catalogWith({ viator_item_url: undefined, ratingSource: undefined });
    expect(filterExploreEntries(cat, ALL)).toHaveLength(2);
  });

  test('a pick whose product is not in the catalog survives — it is the only tile for it', () => {
    const cat = catalogWith({});
    cat.items = [];
    const out = filterExploreEntries(cat, ALL);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('activity');
  });

  // Dedup runs before the filters, against the whole catalog: deduping against
  // the FILTERED list would resurrect the pick whenever a filter happened to
  // remove its product, which is the duplicate coming back under a section tab.
  test('the pick stays dropped even when a filter removes its product', () => {
    const out = filterExploreEntries(catalogWith({}), { ...ALL, section: 'beaches' });
    expect(out).toHaveLength(0);
  });
});

// Explore's "Local picks" button must cover lunch spots too — they are the most
// hand-written thing on the page. Asserted here rather than through the UI: the
// chip is a filter over `provenancePass`, and this is what it filters.
describe('lunch spots under the Local picks filter', () => {
  const catalog: Catalog = getCatalog();

  test('every lunch spot with a tile survives provenance: local', () => {
    const local = filterExploreEntries(catalog, {
      section: 'All', search: '', vibe: 50, price: 50, provenance: 'local',
    });
    const ids = new Set(local.flatMap((e) => (e.kind === 'activity' ? [e.activity.id] : [])));
    const expected = (catalog.lunchspots ?? [])
      .filter((l) => !LUNCHSPOT_ACTIVITY_DUPES[l.id])
      .map((l) => l.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.filter((id) => !ids.has(id))).toEqual([]);
  });

  test('and none of them survives provenance: bookable', () => {
    const bookable = filterExploreEntries(catalog, {
      section: 'All', search: '', vibe: 50, price: 50, provenance: 'bookable',
    });
    const ids = new Set(bookable.flatMap((e) => (e.kind === 'activity' ? [e.activity.id] : [])));
    expect((catalog.lunchspots ?? []).filter((l) => ids.has(l.id))).toEqual([]);
  });
});
