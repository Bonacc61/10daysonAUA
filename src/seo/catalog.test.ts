import { describe, it, expect } from 'vitest';
import { mergeSnapshotItems, type SeoCatalogItem } from './catalog';

// Fixtures are built here rather than taken from the committed snapshot: the
// whole subject is a product ABSENT from the catalog, and the snapshot by
// definition contains none.
const item = (id: string, over: Partial<SeoCatalogItem> = {}): SeoCatalogItem => ({
  id,
  title: `Product ${id}`,
  image_url: `https://example.test/${id}.jpg`,
  viator_item_url: `https://www.viator.com/tours/Aruba/x/d28-${id}?mcid=42383&pid=P00302487`,
  duration: '3 hrs',
  price_usd: 99,
  review_count: 40,
  ...over,
});

describe('mergeSnapshotItems', () => {
  it('keeps a product the catalog no longer returns, flagged gone', () => {
    const merged = mergeSnapshotItems([item('A')], [item('A'), item('B')]);
    const b = merged.find((i) => i.id === 'B');
    expect(b, 'B vanished from the snapshot — its URL would 404 on the next deploy').toBeDefined();
    expect(b!.gone).toBe(true);
  });

  it('keeps the retained product\'s last-known title and image', () => {
    // Those two fields are the entire reason retention works: they are what
    // the page needs in order to keep existing at its published URL.
    const previous = item('B', { title: 'Sunset Sail from Palm Beach', image_url: 'https://example.test/sail.jpg' });
    const merged = mergeSnapshotItems([item('A')], [item('A'), previous]);
    const b = merged.find((i) => i.id === 'B')!;
    expect(b.title).toBe('Sunset Sail from Palm Beach');
    expect(b.image_url).toBe('https://example.test/sail.jpg');
  });

  it('leaves a live product unflagged', () => {
    const merged = mergeSnapshotItems([item('A'), item('B')], [item('A'), item('B')]);
    expect(merged.every((i) => i.gone === undefined)).toBe(true);
  });

  it('clears the flag when a gone product comes back into the catalog', () => {
    // The live row is rebuilt from the catalog response, so a returning
    // product must not inherit the flag its old row carried. A merge that
    // spread `previous` over `live` would leave it stranded as noindex
    // forever, out of the sitemap, with no booking link.
    const merged = mergeSnapshotItems([item('A'), item('B')], [item('A'), item('B', { gone: true })]);
    expect(merged.find((i) => i.id === 'B')!.gone).toBeUndefined();
  });

  it('takes the live row, not the stale one, for a product still in the catalog', () => {
    const merged = mergeSnapshotItems(
      [item('A', { price_usd: 120 })],
      [item('A', { price_usd: 99 })],
    );
    expect(merged.find((i) => i.id === 'A')!.price_usd).toBe(120);
  });

  it('stays gone across a second refresh rather than being resurrected or dropped', () => {
    const first = mergeSnapshotItems([item('A')], [item('A'), item('B')]);
    const second = mergeSnapshotItems([item('A')], first);
    expect(second.map((i) => i.id)).toEqual(['A', 'B']);
    expect(second.find((i) => i.id === 'B')!.gone).toBe(true);
  });

  it('sorts by id so the committed diff stays reviewable', () => {
    const merged = mergeSnapshotItems([item('C'), item('A')], [item('B')]);
    expect(merged.map((i) => i.id)).toEqual(['A', 'B', 'C']);
  });

  it('is a plain copy on a first run, with no previous snapshot', () => {
    const merged = mergeSnapshotItems([item('A'), item('B')], []);
    expect(merged).toHaveLength(2);
    expect(merged.some((i) => i.gone)).toBe(false);
  });
});
