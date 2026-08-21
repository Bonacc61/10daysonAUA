import { describe, it, expect } from 'vitest';
import { activityTags, answersToTags } from './answerTags';
import { ACTIVITIES } from './activities';
import { DEFAULT_ANSWERS } from '../App';
import type { Answers } from '../App';

// What the dashboard's "Personalized for you" panel does with the local picks.
const picksFor = (a: Answers) => {
  const tags = answersToTags(a);
  return ACTIVITIES.filter((p) => activityTags(p).some((t) => tags.has(t)));
};

const profile = (over: Partial<Answers>): Answers => ({ ...DEFAULT_ANSWERS, ...over } as Answers);

describe('activityTags — giving the local picks something to match on', () => {
  it('derives an interest tag from the pick\'s Explore section', () => {
    const eagle = ACTIVITIES.find((a) => a.id === 'eagle-beach-morning')!;
    expect(activityTags(eagle)).toContain('beach-chill');

    const zeerovers = ACTIVITIES.find((a) => a.id === 'zeerovers-fresh-catch')!;
    expect(activityTags(zeerovers)).toContain('food-drink');
  });

  it('bands the adventure score exactly as the questionnaire does', () => {
    // Eagle Beach is adventure 8, kitesurfing is 85.
    expect(activityTags(ACTIVITIES.find((a) => a.id === 'eagle-beach-morning')!)).toContain('low-adventure');
    expect(activityTags(ACTIVITIES.find((a) => a.id === 'kitesurfing-lesson')!)).toContain('high-adventure');
    expect(activityTags(ACTIVITIES.find((a) => a.id === 'arikok-hiking')!)).toContain('med-adventure');
  });

  it('never returns an empty set, which the matcher would read as a wildcard', () => {
    for (const a of ACTIVITIES) expect(activityTags(a).length).toBeGreaterThan(0);
  });
});

describe('the Personalized panel actually discriminates', () => {
  // The bug: every pick ships matched_by: [], so hasOverlap's wildcard rule
  // returned all 26 to every traveller no matter what they answered.
  it('shows fewer than all the picks for a specific profile', () => {
    const beachy = picksFor(profile({ interests: ['Beach & chill'], adventureLevel: 5 }));
    expect(beachy.length).toBeGreaterThan(0);
    expect(beachy.length).toBeLessThan(ACTIVITIES.length);
  });

  it('gives a thrill-seeker and a beach-lounger different picks', () => {
    const chill  = picksFor(profile({ interests: ['Beach & chill'], adventureLevel: 5 }));
    const thrill = picksFor(profile({ interests: ['Adventure & adrenaline'], adventureLevel: 95 }));

    const chillIds  = new Set(chill.map((a) => a.id));
    const thrillIds = new Set(thrill.map((a) => a.id));
    expect([...thrillIds].some((id) => !chillIds.has(id))).toBe(true);
    expect([...chillIds].some((id) => !thrillIds.has(id))).toBe(true);
  });

  it('puts kitesurfing in front of a thrill-seeker and not a low-adventure beach day', () => {
    const chillIds  = picksFor(profile({ interests: ['Beach & chill'], adventureLevel: 5 })).map((a) => a.id);
    const thrillIds = picksFor(profile({ interests: ['Adventure & adrenaline'], adventureLevel: 95 })).map((a) => a.id);
    expect(thrillIds).toContain('kitesurfing-lesson');
    expect(chillIds).not.toContain('kitesurfing-lesson');
  });

  it('still finds something for a traveller who ticked no interests', () => {
    // The adventure band alone has to carry it — an empty panel would be worse
    // than the bug.
    expect(picksFor(DEFAULT_ANSWERS).length).toBeGreaterThan(0);
  });
});

// ── The trip-length tag ──────────────────────────────────────────────────────
// `long-trip` is emitted by trip LENGTH rather than by anything the traveller
// picks, and it is the only thing gating three of the 2026-08-21 curation rules
// (horseback, kitesurfing, and the dive once its product reaches the catalog).
//
// Tested HERE and not only through `bookableTier`, because every bookables test
// builds its tag set by hand: deleting the emission entirely left all 36 of
// them green. This is the test that fails when the tag stops being produced.
describe('answersToTags — long-trip', () => {
  const at = (days: number) => answersToTags(profile({ days }));

  it('is absent at ten days and present at eleven', () => {
    // The owner's rule is "longer than 10 days", so 10 is the last trip that
    // behaves exactly as it did before any of this.
    expect(at(10).has('long-trip')).toBe(false);
    expect(at(11).has('long-trip')).toBe(true);
  });

  it('is absent for every shorter trip and present for every longer one', () => {
    for (const d of [1, 3, 5, 7, 8, 9, 10]) expect(at(d).has('long-trip')).toBe(false);
    for (const d of [11, 12, 13, 14]) expect(at(d).has('long-trip')).toBe(true);
  });

  it('depends on nothing but the length', () => {
    const long = answersToTags(profile({
      days: 14, budget: 'Budget-conscious', adventureLevel: 0, groupType: 'Solo', interests: [],
    }));
    expect(long.has('long-trip')).toBe(true);
  });
});
