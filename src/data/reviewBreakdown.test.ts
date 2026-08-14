import { describe, it, expect } from 'vitest';
import { combinedBreakdown, reviewSourcesFor, hasBreakdown } from './reviewBreakdown';
import { overviewExtraFor } from './overviewExtra';
import SNAPSHOT from './reviewBreakdown.json';

/**
 * Pins the discrepancy that prompted this: the card said 154 reviews while the
 * Viator page said 206, and the Overview text was not on the page at all.
 */
describe('combinedBreakdown — the card must agree with the Viator page', () => {
  it('sums platforms to the total the page prints', () => {
    // 472918P1: Viator 154 + TripAdvisor 52 = 206, which is what the page shows.
    // Reporting either platform alone is accurate and still reads as stale.
    const b = combinedBreakdown('472918P1');
    expect(b).not.toBeNull();
    expect(b!.total).toBe(206);
    expect(reviewSourcesFor('472918P1').map((s) => s.n).sort((x, y) => y - x)).toEqual([154, 52]);
  });

  it('reproduces Viator\'s own combined average from the summed counts', () => {
    // (2x1 + 1x4 + 203x5) / 206 = 4.956 — the API returns 4.9563107. This is
    // their arithmetic, not ours; if the two ever diverge, the sum is wrong.
    const b = combinedBreakdown('472918P1')!;
    expect(b.counts).toEqual([2, 0, 0, 1, 203]);
    expect(b.average).toBe(5);
    const weighted = b.counts.reduce((s, c, i) => s + c * (i + 1), 0) / b.total;
    expect(weighted).toBeCloseTo(4.9563107, 3);
  });

  it('every stored histogram sums to its own reported total', () => {
    // Guards the snapshot itself: a per-platform total that disagrees with its
    // star counts would silently skew every card built from it.
    const bad: string[] = [];
    for (const id of Object.keys(SNAPSHOT as Record<string, unknown>)) {
      for (const s of reviewSourcesFor(id)) {
        const sum = s.c.reduce((a, b) => a + b, 0);
        if (sum !== s.n) bad.push(`${id}/${s.p}: counts ${sum} vs total ${s.n}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('is silent for a product with no reviews', () => {
    expect(combinedBreakdown('no-such-product')).toBeNull();
    expect(hasBreakdown('no-such-product')).toBe(false);
  });
});

describe('overviewExtra — the text the page shows that the catalog cannot', () => {
  it('carries the second Overview for the product that exposed the mismatch', () => {
    const extra = overviewExtraFor('472918P1');
    expect(extra.length).toBeGreaterThan(200);
    // The page's Overview leads with this line; `description` never mentions it.
    expect(extra).toMatch(/first-time snorkelers/i);
  });

  it('is empty for a product that only has the catalog description', () => {
    expect(overviewExtraFor('no-such-product')).toBe('');
  });
});
