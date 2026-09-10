import { describe, it, expect } from 'vitest';
import { pageMeta, sharedItineraryMeta } from './head';
import { PAGE_TO_PATH, PRIVATE_PAGES, type PageId } from './pages';

const ALL = Object.keys(PAGE_TO_PATH) as PageId[];

describe('pageMeta', () => {
  it('gives every page a distinct, non-empty title', () => {
    const titles = ALL.map((p) => pageMeta(p).title);
    for (const t of titles) expect(t.length).toBeGreaterThan(10);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('gives every page a description within the length search engines show', () => {
    for (const p of ALL) {
      const d = pageMeta(p).description;
      expect(d.length).toBeGreaterThan(50);
      expect(d.length).toBeLessThanOrEqual(160);
    }
  });

  it('builds the canonical from the origin and the route path', () => {
    // Hardcoded literals prevent the test from passing when ORIGIN is corrupted.
    // If this test used ORIGIN in the expected value, breaking ORIGIN would
    // move both actual and expected together, leaving the test trivially true.
    expect(pageMeta('landing').canonical).toBe('https://10daysonaruba.com/');
    expect(pageMeta('explore').canonical).toBe('https://10daysonaruba.com/explore');
  });

  it('marks every private page noindex', () => {
    for (const p of PRIVATE_PAGES) expect(pageMeta(p).index).toBe(false);
  });

  it('marks the public pages indexable', () => {
    for (const p of ['landing', 'explore', 'questionnaire', 'privacy', 'terms', 'surprise'] as PageId[]) {
      expect(pageMeta(p).index).toBe(true);
    }
  });

  it('independently validates the public/private partition', () => {
    // Hardcoded lists, not derived from PRIVATE_PAGES. This test catches when a
    // page is removed from PRIVATE_PAGES — the above test cannot, because it only
    // iterates the pages already in PRIVATE_PAGES.
    const EXPECTED_PUBLIC: PageId[] = [
      'landing', 'explore', 'questionnaire', 'privacy', 'terms', 'surprise',
    ];
    const EXPECTED_PRIVATE: PageId[] = [
      'itinerary', 'map', 'dashboard', 'preview', 'stats',
    ];

    // Disjoint: no page is in both lists
    const publicSet = new Set(EXPECTED_PUBLIC);
    const privateSet = new Set(EXPECTED_PRIVATE);
    for (const p of publicSet) {
      expect(privateSet.has(p)).toBe(false);
    }
    for (const p of privateSet) {
      expect(publicSet.has(p)).toBe(false);
    }

    // Union is exactly all pages: no page added, removed, or uncategorized
    const allPages = new Set(Object.keys(PAGE_TO_PATH) as PageId[]);
    const unionSize = publicSet.size + privateSet.size;
    expect(unionSize).toBe(allPages.size);
    for (const p of publicSet) expect(allPages.has(p)).toBe(true);
    for (const p of privateSet) expect(allPages.has(p)).toBe(true);

    // Index values are correct
    for (const p of EXPECTED_PUBLIC) {
      expect(pageMeta(p).index).toBe(true);
    }
    for (const p of EXPECTED_PRIVATE) {
      expect(pageMeta(p).index).toBe(false);
    }
  });
});

describe('sharedItineraryMeta', () => {
  // A shared itinerary is one traveller's trip at a guessable public URL. It
  // must never enter a search index, however widely the link gets posted.
  it('is never indexable', () => {
    expect(sharedItineraryMeta('abc123').index).toBe(false);
  });

  it('canonicalises to its own share URL', () => {
    // Hardcoded literal: if this used ORIGIN, breaking ORIGIN would move both
    // actual and expected together, leaving the test passing with broken canonicals.
    expect(sharedItineraryMeta('abc123').canonical).toBe('https://10daysonaruba.com/i/abc123');
  });

  it('never puts the share id in the title or description', () => {
    const m = sharedItineraryMeta('abc123');
    expect(m.title).not.toContain('abc123');
    expect(m.description).not.toContain('abc123');
  });
});
