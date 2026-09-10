import { describe, it, expect, vi } from 'vitest';
import { ACTIVITIES } from '../data/activities';
import { reviewSourcesFor } from '../data/reviewBreakdown';
import { whatToExpectFor } from '../data/whatToExpect';
import SNAPSHOT from '../data/seoCatalog.json';
import type { SeoCatalogItem } from './catalog';

const ITEMS = (SNAPSHOT as { items: SeoCatalogItem[] }).items;

// The "requires both platforms" case below cannot be built from a real catalog
// fixture: verified against the live snapshot, there is no product that has
// prose AND reviews from exactly one platform AND >= MIN_SEO_REVIEWS on that
// platform (single-platform products never clear the review floor here) — so
// any fixture-search for that combination would either find nothing (and the
// test would have to skip, which is the vacuous pattern this file is fixing)
// or find a product that fails for an unrelated reason (missing reviews),
// which asserts `false` without exercising the platform check at all. Mocking
// the two data sources for one synthetic id isolates the platform condition
// directly instead of hoping the catalog happens to contain a case for it.
// vi.mock calls are hoisted above the imports below by vitest, so the
// `import('./floor')` picks up these mocked modules.
vi.mock('../data/reviewBreakdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/reviewBreakdown')>();
  return {
    ...actual,
    reviewSourcesFor: (id: string) =>
      id === '__test-one-platform-enough-reviews__'
        ? [{ p: 'V', n: 40, a: 4.5, c: [0, 0, 0, 10, 30] }]
        : actual.reviewSourcesFor(id),
  };
});
vi.mock('../data/whatToExpect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/whatToExpect')>();
  return {
    ...actual,
    whatToExpectFor: (id: string) =>
      id === '__test-one-platform-enough-reviews__' ? 'A narrative to summarise.' : actual.whatToExpectFor(id),
  };
});

import { productEarnsPage, curatedEarnsPage, selectPages, MIN_SEO_REVIEWS } from './floor';

describe('MIN_SEO_REVIEWS', () => {
  it('reuses the engine threshold rather than inventing a second one', () => {
    expect(MIN_SEO_REVIEWS).toBe(25);
  });
});

describe('productEarnsPage', () => {
  it('refuses a product with no review data at all', () => {
    expect(productEarnsPage('definitely-not-a-product-code')).toBe(false);
  });

  it('requires prose — both platforms and a big review count are not enough', () => {
    const proseless = ITEMS.find(
      (i) => !whatToExpectFor(i.id) && reviewSourcesFor(i.id).length >= 2,
    );
    expect(proseless, 'fixture: expected at least one prose-less product').toBeDefined();
    expect(productEarnsPage(proseless!.id)).toBe(false);
  });

  it('requires both platforms — prose and enough reviews on one platform are not enough', () => {
    // See the mock setup above: the real catalog has no product that clears
    // prose and MIN_SEO_REVIEWS on a single platform, so this id is synthetic.
    expect(productEarnsPage('__test-one-platform-enough-reviews__')).toBe(false);
  });

  it('accepts a product that clears all three conditions', () => {
    const good = ITEMS.filter((i) => productEarnsPage(i.id));
    expect(good.length).toBeGreaterThan(0);
    for (const i of good.slice(0, 5)) {
      expect(whatToExpectFor(i.id)).toBeTruthy();
      const platforms = new Set(reviewSourcesFor(i.id).map((r) => r.p));
      expect(platforms.has('V') && platforms.has('T')).toBe(true);
    }
  });
});

describe('curatedEarnsPage', () => {
  it('accepts a curated pick with a hand-written localsSay', () => {
    expect(curatedEarnsPage(ACTIVITIES.find((a) => a.id === 'eagle-beach-morning')!)).toBe(true);
  });

  it('refuses the picks whose localsSay is deliberately empty', () => {
    expect(curatedEarnsPage(ACTIVITIES.find((a) => a.id === 'arashi-beach')!)).toBe(false);
  });
});

describe('selectPages', () => {
  // The number the spec commits to. It is allowed to drift with the catalog,
  // but not silently: this test is the alarm.
  it('selects 19 curated picks', () => {
    expect(selectPages(ITEMS).curated).toHaveLength(19);
  });

  it('selects a product set in the size the spec measured', () => {
    const { products } = selectPages(ITEMS);
    expect(products.length).toBeGreaterThanOrEqual(30);
    expect(products.length).toBeLessThanOrEqual(50);
  });
});
