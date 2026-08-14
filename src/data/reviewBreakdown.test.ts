import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { combinedBreakdown, reviewSourcesFor, hasBreakdown } from './reviewBreakdown';
import { whatToExpectFor } from './whatToExpect';
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

describe('whatToExpect — a different page section, not a second Overview', () => {
  it('carries the running order, kept apart from the Overview', () => {
    // 8936P1 is the case that proved these are different sections: its
    // "What to expect" opens on check-in logistics, and merging it into the
    // Overview put the zodiac shuttle above the pitch it was meant to follow.
    const wte = whatToExpectFor('8936P1');
    expect(wte).toMatch(/After check in at our desk/i);
    expect(wte).not.toMatch(/Have a warm Aruban welcome/i);
  });

  it('is empty for a product that publishes only an Overview', () => {
    expect(whatToExpectFor('no-such-product')).toBe('');
  });
});

describe('every product card has both halves', () => {
  // The audit that found the gap: 45 of 368 products have no reviews on any
  // platform, and the ratings half used to vanish for those — a card that looks
  // half-built rather than one whose product is simply new.
  it('classifies the no-review products rather than dropping them', () => {
    const snap = SNAPSHOT as Record<string, unknown>;
    // A product either has a histogram, or it has none and the card must fall
    // back to the explicit "No reviews yet" state — never to an empty half.
    const ids = Object.keys(snap);
    expect(ids.length).toBeGreaterThan(300);
    // 45382P429 is the card that exposed this: zero reviews, no histogram.
    expect(snap['45382P429']).toBeUndefined();
    expect(combinedBreakdown('45382P429')).toBeNull();
  });

  it('CardBack renders a no-reviews half instead of omitting it', () => {
    // No DOM to render in, so this pins the branch in source — the same gap
    // that let the r/Aruba misattribution ship.
    const src = readFileSync(new URL('../components/CardBack.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/twoHalves && !showBreakdown && !showTravellers/);
    expect(src).toMatch(/No reviews yet/);
    // And two halves must no longer be conditional on having ratings at all.
    expect(src).not.toMatch(/twoHalves =[\s\S]{0,120}showBreakdown \|\| showTravellers/);
  });
});
