import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mergeLocalMatches, type LocalMatch } from './activitySource';
import { ACTIVITIES } from './activities';
import type { Activity } from './activities';

/**
 * Guards the rule that a star only appears where a real platform rating backs it.
 *
 * The card back used to invent `{ rating: 4.2, mentions: 60, quote: 'Solid pick.
 * Goes on most r/Aruba shortlists.' }` under an r/Aruba badge for any pick with
 * no real quote — 14 of 26 — and every surface drew a star from `activity.rating`,
 * which is an editorial ranking weight no platform ever published. These tests
 * exist so that neither can come back by accident.
 */

const local = (over: Partial<Activity> = {}): Activity => ({
  id: 'test-pick', title: 'Test Pick', category: 'Beaches', image: '/x.jpg',
  description: '', localsSay: 'A local tip.', cost: 'Free', duration: '1 hr',
  timeOfDay: 'Morning', fitReason: '', location: 'Somewhere',
  rating: 4.9, reviewCount: 2847, matched_by: [], ...over,
});

describe('mergeLocalMatches — only a real Viator rating earns a star', () => {
  it('flags the rating when the match supplies a real one', () => {
    const [a] = mergeLocalMatches([local()], { 'test-pick': { rating: 4.3, review_count: 91 } });
    expect(a.ratingSource).toBe('viator');
    expect(a.rating).toBe(4.3);
    expect(a.reviewCount).toBe(91);
  });

  it('leaves the editorial rating UNFLAGGED when the match has no rating', () => {
    // The regression this guards: a match carries a link but no rating, and the
    // editorial 4.9 gets displayed as though Viator had published it.
    const [a] = mergeLocalMatches([local()], {
      'test-pick': { viator_item_url: 'https://viator.com/x?pid=P00302487' },
    });
    expect(a.ratingSource).toBeUndefined();
    expect(a.rating).toBe(4.9);               // still there — it drives ordering
    expect(a.viator_item_url).toContain('pid=P00302487');
  });

  it('treats a zero rating as no rating', () => {
    const [a] = mergeLocalMatches([local()], { 'test-pick': { rating: 0 } });
    expect(a.ratingSource).toBeUndefined();
  });

  it('leaves an unmatched pick completely untouched', () => {
    const input = local();
    const [a] = mergeLocalMatches([input], {} as Record<string, LocalMatch>);
    expect(a).toBe(input);
    expect(a.ratingSource).toBeUndefined();
  });

  it('never flags a purely editorial catalog — no local pick ships a star by default', () => {
    const merged = mergeLocalMatches(ACTIVITIES, {});
    expect(merged.filter((a) => a.ratingSource !== undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const SRC = join(__dirname, '..');

describe('no fabricated social proof anywhere in the app', () => {
  const files = sourceFiles(SRC).map((f) => [f, readFileSync(f, 'utf8')] as const);

  it('finds the source tree (guard against an empty scan passing vacuously)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each([
    ['Solid pick. Goes on most r/Aruba shortlists.', 'invented Reddit consensus'],
    ['Highly recommended by recent visitors.', 'invented TripAdvisor blurb'],
    ['FALLBACK_REDDIT', 'the fabricated Reddit fallback'],
    ['FALLBACK_TA', 'the fabricated TripAdvisor fallback'],
  ])('never contains %s (%s)', (needle) => {
    const hits = files.filter(([, src]) => src.includes(needle)).map(([f]) => f);
    expect(hits).toEqual([]);
  });

  it('never labels a booking-API rating as TripAdvisor in anything users see', () => {
    // Ratings come from Viator, not TripAdvisor. Borrowing the logo misattributes
    // a real number, which is the same defect as inventing one. Comments may
    // still discuss it — only rendered strings matter.
    const hits = files.filter(([, src]) => stripComments(src).includes('TripAdvisor')).map(([f]) => f);
    expect(hits).toEqual([]);
  });
});

/** Removes line and block comments so scans see only code and rendered text. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('every activity star is gated on ratingSource', () => {
  const files = sourceFiles(SRC).map((f) => [f, readFileSync(f, 'utf8')] as const);

  it('no file renders a local pick rating without consulting ratingSource', () => {
    // Matches JSX render sites for a local pick's rating — `{a.rating}`,
    // `{activity.rating}`, `{pick.activity.rating}`. Viator items are exempt:
    // `item.rating` / `bestSeller.rating` are real API values.
    // File-level rather than line-level: a guard is often an enclosing
    // conditional, and pinning exact line shapes made this fail on formatting.
    const ACTIVITY_RATING = /\{\s*(?:[a-zA-Z]+\.)?(?:a|activity)\.rating\s*\}|\.activity\.rating\s*\}/;
    const offenders = files
      .filter(([, src]) => {
        const code = stripComments(src);
        return ACTIVITY_RATING.test(code) && !code.includes('ratingSource');
      })
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('detects an ungated star if the guard is removed (the test can actually fail)', () => {
    const ACTIVITY_RATING = /\{\s*(?:[a-zA-Z]+\.)?(?:a|activity)\.rating\s*\}|\.activity\.rating\s*\}/;
    const regressed = 'export const X = () => <span>{a.rating}</span>;';
    expect(ACTIVITY_RATING.test(stripComments(regressed))).toBe(true);
    expect(stripComments(regressed).includes('ratingSource')).toBe(false);
  });
});
