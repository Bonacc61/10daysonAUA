import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { combinedBreakdown, reviewSourcesFor, hasBreakdown } from './reviewBreakdown';
import EVIDENCE from '../../docs/map/viator-reviews.json';
import { whatToExpectFor } from './whatToExpect';
import SNAPSHOT from './reviewBreakdown.json';

/**
 * Pins the discrepancy that prompted this: the card said one platform's count
 * while the Viator page said the combined one, and the Overview text was not on
 * the page at all. (The figures were 154 vs 206 when it was found; they read 157
 * vs 212 after the 2026-08-21 refresh, which is why nothing here pins them.)
 */
describe('combinedBreakdown — the card must agree with the Viator page', () => {
  it('sums platforms to the total the page prints', () => {
    // 472918P1: Viator + TripAdvisor, which together are what the page shows.
    // Reporting either platform alone is accurate and still reads as stale.
    //
    // Asserted against the sum of the snapshot's own per-platform figures
    // rather than a literal. The literals used to be 154 + 52 = 206; a refresh
    // on 2026-08-21 made them 157 + 55 = 212 and broke this test, which looked
    // like a code regression and was a week of new reviews. The claim being
    // made here is "total is every platform added up", and that claim does not
    // move when the numbers do — while a component returning one platform's
    // count still fails it.
    const sources = reviewSourcesFor('472918P1');
    expect(sources.length).toBeGreaterThan(1);   // or "combined" means nothing
    const b = combinedBreakdown('472918P1');
    expect(b).not.toBeNull();
    expect(b!.total).toBe(sources.reduce((t, s) => t + s.n, 0));
    // and emphatically NOT the largest single platform
    expect(b!.total).toBeGreaterThan(Math.max(...sources.map((s) => s.n)));
  });

  it('the displayed average is the one its own star counts imply', () => {
    // The star counts must add up to the total, and the average shown must be
    // the average those counts produce. That is Viator's arithmetic, not ours.
    //
    // Compared with a tolerance, not with `Math.round`. An earlier version of
    // this test asserted `b.average === Math.round(weighted)` and passed only
    // because 472918P1 happens to sit at 4.9576: ONE new 1-star review takes it
    // to 4.939, `average` becomes 4.9, the round is still 5, and the suite goes
    // red over a product getting slightly worse. That is the same
    // refresh-brittleness this file set out to remove, moved rather than fixed.
    const b = combinedBreakdown('472918P1')!;
    expect(b.counts.reduce((t, c) => t + c, 0)).toBe(b.total);
    const weighted = b.counts.reduce((s, c, i) => s + c * (i + 1), 0) / b.total;
    expect(Math.abs(b.average - weighted)).toBeLessThanOrEqual(0.05);
  });

  it('every product agrees with the evidence Viator itself returned', () => {
    // The external anchor, and the reason it is worth the file read.
    //
    // Deriving expectations from the snapshot proves the code reads the snapshot
    // correctly and NOTHING about whether the snapshot is right. Doubling every
    // number in it leaves all of those assertions green — measured. The evidence
    // file is a separate artefact written by the same probe run, carrying
    // Viator's OWN `totalReviews` and `combined` average per product, so it can
    // disagree; and a doubled, truncated or plausibly-invented snapshot would
    // make it disagree 322 times over.
    //
    // Reading a docs/ artefact from a test has precedent here — startTimes.test
    // does the same — and both files regenerate in one run, so a refresh moves
    // them together and this stays green.
    const evidence = EVIDENCE as { products: { id: string; totalReviews: number; combined: number | null }[] };
    const checked: string[] = [];
    const wrong: string[] = [];
    for (const p of evidence.products) {
      const b = combinedBreakdown(p.id);
      if (!b) continue;                     // no histogram captured — nothing to check
      checked.push(p.id);
      if (b.total !== p.totalReviews) wrong.push(`${p.id}: total ${b.total} vs Viator ${p.totalReviews}`);
      if (typeof p.combined === 'number') {
        const weighted = b.counts.reduce((s, c, i) => s + c * (i + 1), 0) / b.total;
        if (Math.abs(weighted - p.combined) > 0.005) {
          wrong.push(`${p.id}: implied ${weighted.toFixed(4)} vs Viator ${p.combined}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // Guards against a vacuous pass: if the evidence and the snapshot ever stop
    // sharing ids, the loop above checks nothing and says so here.
    expect(checked.length).toBeGreaterThan(300);
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
  // The audit that found the gap: 43 of 365 products have no reviews on any
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
