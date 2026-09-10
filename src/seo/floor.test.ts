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

import { productEarnsPage, curatedEarnsPage, selectPages, departedPages, MIN_SEO_REVIEWS } from './floor';

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

// src/seo/slugs.ts promises "a vanished product keeps its URL". The generator
// used to loop only over the current selection, which made that false: an id
// the floor stopped choosing simply stopped being emitted, and dist/ is
// mirrored with --delete. This is the function that keeps the promise.
describe('departedPages', () => {
  const REGISTRY = { 'ALIVE-1': 'alive-one', 'GONE-1': 'gone-one', 'GONE-2': 'gone-two' };
  const stub = (id: string, gone?: true) =>
    ({ id, title: id, image_url: '', viator_item_url: '', duration: '', price_usd: 0, review_count: 0, gone }) as SeoCatalogItem;

  it('returns a gone product that already owns a published URL', () => {
    const out = departedPages([stub('ALIVE-1'), stub('GONE-1', true)], REGISTRY);
    expect(out.map((i) => i.id)).toEqual(['GONE-1']);
  });

  it('returns it even though the quality floor would reject it outright', () => {
    // The point of the function. These synthetic ids carry no reviewBreakdown
    // and no prose, so productEarnsPage is false for them — proof that
    // retention is not quietly riding on the floor still selecting the item.
    expect(productEarnsPage('GONE-1')).toBe(false);
    expect(selectPages([stub('GONE-1', true)]).products).toHaveLength(0);
    expect(departedPages([stub('GONE-1', true)], REGISTRY)).toHaveLength(1);
  });

  it('leaves live products alone — they are the floor\'s business', () => {
    expect(departedPages([stub('ALIVE-1')], REGISTRY)).toHaveLength(0);
  });

  it('skips a gone product that never had a URL, rather than minting one', () => {
    expect(departedPages([stub('NEVER-PUBLISHED', true)], REGISTRY)).toHaveLength(0);
  });
});
