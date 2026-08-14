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
    //
    // ONE allowance, narrowed on 2026-08-14 rather than dropped. The rule was
    // written when the only number available was `combinedAverageRating`, a
    // blend Viator computes — calling that "TripAdvisor" attributes to a
    // platform a figure it never published. `/products/{code}` also returns
    // `reviews.sources[]`, where a TRIPADVISOR entry carries its OWN total,
    // average and star histogram. Naming that one is accurate attribution, and
    // refusing to name it would be its own dishonesty: it would merge two
    // audiences that visibly disagree into a consensus neither reported.
    //
    // The allowance is a single file, and the test below pins what it may do.
    const ALLOWED = new Set(['src/data/reviewBreakdown.ts']);
    const hits = files
      .filter(([, src]) => stripComments(src).includes('TripAdvisor'))
      .map(([f]) => f)
      .filter((f) => ![...ALLOWED].some((a) => f.endsWith(a)));
    expect(hits).toEqual([]);
  });

  it('the one allowed file names a platform only from that platform\'s own data', () => {
    // What keeps the allowance honest: the label is looked up from the provider
    // field the API supplied, never attached to a combined figure. If someone
    // maps a bare average onto a platform name here, this fails.
    const src = readFileSync(join(SRC, 'data/reviewBreakdown.ts'), 'utf8');
    const code = stripComments(src);
    // The string appears exactly once, inside the provider lookup table.
    expect((code.match(/TripAdvisor/g) ?? []).length).toBe(1);
    expect(code).toMatch(/PROVIDER_LABEL[\s\S]*?T:\s*'TripAdvisor'/);
    // And nothing here reads a combined/average field to produce that label.
    expect(code).not.toMatch(/combined[A-Za-z]*\s*[:=]/);
  });
});

/**
 * Blanks comments while preserving line count and leaving code untouched.
 *
 * A naive "delete from the first double-slash to end of line" truncated any line
 * containing a URL — `href="https://x"` became `href="https:` — blinding every
 * scan below on that line. And collapsing block comments shifted line numbers,
 * so reported `file:line` was wrong and the proximity window below could pull in
 * a guard that was actually further away than it looked.
 */
function stripComments(src: string): string {
  return src
    // Block comments -> equally many blank lines, so numbering survives.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
    // Only whole-line comments. A trailing `//` after code is rare here and not
    // worth risking a string literal for.
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
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

  it('CAN fail: catches the ternary badge form, not just {a.rating}', () => {
    // The shipped Dashboard/SurpriseMe badges read the rating inside a ternary.
    // The first version of this regex required `}` right after `.rating` and so
    // sailed past them — the guards they depend on could have been deleted
    // silently.
    const ternary = `<span>{pick.kind === 'activity' ? pick.activity.rating : pick.item.rating}</span>`;
    expect(ungatedRatingSites([['x.tsx', ternary]])).toHaveLength(1);
  });

  it('does not flag a Viator rating — those are real', () => {
    const viator = `<span>{item.rating}</span>\n<span>{bestSeller.rating}</span>`;
    expect(ungatedRatingSites([['x.tsx', viator]])).toEqual([]);
  });

  it('CAN fail: a guard beyond the window does not launder a later star', () => {
    // Honest limitation: this is proximity, not scope analysis. An ungated star
    // placed WITHIN GUARD_WINDOW lines of a real guard still passes — the window
    // has to reach that far because the guard on ItineraryCard's badge sits 4
    // lines above the render. It catches the realistic regressions (a star in a
    // new file, a deleted guard, the ternary badge form) and not an adversarial
    // insertion tucked against an existing guard.
    const far = `{a.ratingSource === 'viator' && <span>{a.rating}</span>}${'\n'.repeat(7)}<span>{a.rating}</span>`;
    expect(ungatedRatingSites([['x.tsx', far]])).toHaveLength(1);
  });
});

/**
 * Render sites for a local pick's rating that have no `ratingSource` guard
 * within GUARD_WINDOW lines above them (covering both an inline `&&` guard and
 * an enclosing conditional a few lines up).
 */
const GUARD_WINDOW = 5;
function ungatedRatingSites(files: ReadonlyArray<readonly [string, string]>): string[] {
  // Any read of a local pick's rating inside a JSX expression. The earlier
  // pattern required `}` immediately after and so missed the ternary form this
  // very commit shipped — `{pick.kind === 'activity' ? pick.activity.rating :
  // pick.item.rating}` — meaning the guards on the Dashboard and SurpriseMe
  // badges could be deleted with the suite still green. Viator reads
  // (`item.rating`, `bestSeller.rating`) stay exempt: those are real.
  // `\b` before the object name so `pick.activity.rating` matches (the boundary
  // sits between `.` and `a`) while `data.rating` does not (no boundary inside a
  // word). `item.rating` and `bestSeller.rating` simply never match.
  const ACTIVITY_RATING = /\b(?:a|activity)\.rating\b/;
  // Ranking code is allowed to READ the weight — that is what it is for. Only
  // rendering it is forbidden. Approximated by: JSX files only, and not a
  // binding or a plain return. Without this the check flagged
  // exploreItems.ts:228 and itineraryGenerator.ts:212, which are the very uses
  // the field legitimately has.
  const BINDING = /^\s*(?:const|let|var|return)\b/;
  const out: string[] = [];
  for (const [file, src] of files) {
    if (!file.endsWith('.tsx')) continue;
    const lines = stripComments(src).split('\n');
    lines.forEach((line, i) => {
      if (!ACTIVITY_RATING.test(line) || BINDING.test(line)) return;
      const window = lines.slice(Math.max(0, i - GUARD_WINDOW), i + 1).join('\n');
      if (!window.includes('ratingSource')) out.push(`${file}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
  }
  return out;
}
