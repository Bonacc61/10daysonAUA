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

describe('the card back always has something to show', () => {
  // 7 picks ship `localsSay: ''` (arashi-beach, palm-beach-strip,
  // boca-catalina-shore, alto-vista-chapel, california-dunes-sunset,
  // bushiribana-loop, san-nicolas-murals). Reading it unguarded rendered a
  // headed, full-height, EMPTY panel — and 4 of the 7 reach real itineraries.
  // CardBack chains localsSay -> description, so the invariant is that the
  // chain resolves, not that localsSay is populated.
  it.each(ACTIVITIES.map((a) => [a.id, a] as const))(
    '%s resolves a non-empty card-back tip',
    (_id, a) => {
      expect((a.localsSay?.trim() || a.description?.trim() || '').length).toBeGreaterThan(0);
    },
  );

  it('documents how many picks depend on the description fallback', () => {
    const viaDescription = ACTIVITIES.filter((a) => !a.localsSay?.trim());
    // Not asserting a fixed count — this is a canary. If it ever hits every
    // pick, localsSay has silently stopped being written.
    expect(viaDescription.length).toBeLessThan(ACTIVITIES.length);
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

  it('no local-pick rating renders without a nearby ratingSource guard', () => {
    // Matches JSX render sites for a local pick's rating — `{a.rating}`,
    // `{activity.rating}`, `{pick.activity.rating}`. Viator items are exempt:
    // `item.rating` / `bestSeller.rating` are real API values.
    //
    // Per-site with a proximity window, NOT per-file. A file-level check
    // (`src.includes('ratingSource')`) exempted the whole file once any guard
    // existed anywhere in it, so a new ungated star added to an already-gated
    // file passed silently — the single most likely regression.
    expect(ungatedRatingSites(files)).toEqual([]);
  });

  it('CAN fail: an ungated star in an already-gated file is caught', () => {
    // Proves the check above is not vacuous. Explore.tsx really does contain a
    // ratingSource guard, so this is exactly the case the old check missed.
    const gated = readFileSync(join(SRC, 'pages/Explore.tsx'), 'utf8');
    expect(gated).toContain('ratingSource');
    const sabotaged = `${gated}\nexport const Regression = () => <span>{a.rating}</span>;\n`;
    expect(ungatedRatingSites([['pages/Explore.tsx', sabotaged]])).toHaveLength(1);
  });
});

/**
 * Render sites for a local pick's rating that have no `ratingSource` guard
 * within GUARD_WINDOW lines above them (covering both an inline `&&` guard and
 * an enclosing conditional a few lines up).
 */
const GUARD_WINDOW = 6;
function ungatedRatingSites(files: ReadonlyArray<readonly [string, string]>): string[] {
  const ACTIVITY_RATING = /\{\s*(?:[a-zA-Z]+\.)?(?:a|activity)\.rating\s*\}|\.activity\.rating\s*\}/;
  const out: string[] = [];
  for (const [file, src] of files) {
    const lines = stripComments(src).split('\n');
    lines.forEach((line, i) => {
      if (!ACTIVITY_RATING.test(line)) return;
      const window = lines.slice(Math.max(0, i - GUARD_WINDOW), i + 1).join('\n');
      if (!window.includes('ratingSource')) out.push(`${file}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
  }
  return out;
}
