import { describe, it, expect } from 'vitest';
import { flagsFromNotes, effectiveFlags, flagAppliesTo } from './notesFlags';
import { generatePlan } from './itineraryGenerator';
import { getCatalog } from './activitySource';
import { DEFAULT_ANSWERS } from '../App';
import type { Day } from './activities';
import type { SlotEntry } from '../types';

describe('flagsFromNotes — contraindication keyword parsing', () => {
  it('empty / absent notes → no flags', () => {
    expect(flagsFromNotes('')).toEqual([]);
    expect(flagsFromNotes(undefined)).toEqual([]);
    expect(flagsFromNotes('We love catamarans and sunsets!')).toEqual([]);
  });

  it('seasick phrasings → no-boats', () => {
    expect(flagsFromNotes('I get seasick')).toContain('no-boats');
    expect(flagsFromNotes('prone to sea-sickness')).toContain('no-boats');
    expect(flagsFromNotes('My wife has motion sickness')).toContain('no-boats');
  });

  it('mobility phrasings → mobility', () => {
    expect(flagsFromNotes('my dad uses a wheelchair')).toContain('mobility');
    expect(flagsFromNotes('limited mobility for grandma')).toContain('mobility');
    expect(flagsFromNotes("can't walk far")).toContain('mobility');
  });

  it('no-car phrasings → no-car', () => {
    expect(flagsFromNotes('we have no rental car')).toContain('no-car');
    expect(flagsFromNotes("we don't want a car")).toContain('no-car');
  });

  it('does NOT flag no-car on "no car seat" (false-exclusion guard)', () => {
    expect(flagsFromNotes('we have no car seat for the baby')).not.toContain('no-car');
  });

  it('does NOT false-trigger with-baby on the "Baby Beach" place name', () => {
    // Bare "baby" is intentionally not a pattern — Baby Beach is a real Aruba spot.
    expect(flagsFromNotes('We really want to visit Baby Beach')).toEqual([]);
  });

  it('multiple constraints in one note', () => {
    const flags = flagsFromNotes('I get seasick and my mother needs a wheelchair');
    expect(flags).toContain('no-boats');
    expect(flags).toContain('mobility');
  });
});

describe('effectiveFlags — pills UNION notes', () => {
  it('merges ticked pills with parsed notes, de-duplicated', () => {
    const flags = effectiveFlags({ ...DEFAULT_ANSWERS, groupType: 'Couple', flags: ['honeymoon'], specialNotes: 'I get seasick' });
    expect(flags.has('honeymoon')).toBe(true);
    expect(flags.has('no-boats')).toBe(true);
  });

  it('a pill and a note that imply the same flag collapse to one', () => {
    const flags = effectiveFlags({ ...DEFAULT_ANSWERS, flags: ['no-boats'], specialNotes: 'seasick' });
    expect([...flags].filter((f) => f === 'no-boats').length).toBe(1);
  });
});

describe('flagAppliesTo — group-type gating', () => {
  it('unrestricted flags apply to every group', () => {
    for (const g of ['Solo', 'Couple', 'Friends', 'Family with young kids', 'Family with teens', 'Multi-gen']) {
      expect(flagAppliesTo('no-boats', g)).toBe(true);
      expect(flagAppliesTo('mobility', g)).toBe(true);
      expect(flagAppliesTo('avoid-crowds', g)).toBe(true);
    }
  });

  it('honeymoon is couples-only', () => {
    expect(flagAppliesTo('honeymoon', 'Couple')).toBe(true);
    expect(flagAppliesTo('honeymoon', 'Solo')).toBe(false);
    expect(flagAppliesTo('honeymoon', 'Friends')).toBe(false);
  });

  it('with-baby applies to groups a baby could plausibly join', () => {
    expect(flagAppliesTo('with-baby', 'Family with young kids')).toBe(true);
    expect(flagAppliesTo('with-baby', 'Multi-gen')).toBe(true);
    expect(flagAppliesTo('with-baby', 'Solo')).toBe(false);
  });

  it('an unknown flag is unrestricted rather than rejected', () => {
    expect(flagAppliesTo('some-future-flag', 'Solo')).toBe(true);
  });

  // flags arrive from localStorage and from the `answers` jsonb of a public shared
  // itinerary, so the key is untrusted. An Object.prototype key must not throw —
  // a throw here unwinds React during render and blanks the page (there is no
  // ErrorBoundary), which a share link could trigger for every visitor.
  it('an Object.prototype key is inert, not a crash', () => {
    for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(() => flagAppliesTo(key, 'Couple')).not.toThrow();
      expect(flagAppliesTo(key, 'Couple')).toBe(true);
    }
  });

  it('effectiveFlags survives a prototype-key flag in saved answers', () => {
    const answers = { ...DEFAULT_ANSWERS, groupType: 'Couple', flags: ['toString', 'no-boats'] };
    expect(() => effectiveFlags(answers)).not.toThrow();
    expect(effectiveFlags(answers).has('no-boats')).toBe(true);
  });
});

describe('effectiveFlags — inapplicable ticked flags are inert', () => {
  // Saved answers (localStorage `10doa:answers`) outlive UI changes, so a flag can
  // survive there for a group the questionnaire no longer offers it to. The engine
  // must ignore it — otherwise a pill the traveller cannot see still shapes the plan.
  it('drops a stale with-baby from a group that cannot select it', () => {
    const flags = effectiveFlags({ ...DEFAULT_ANSWERS, groupType: 'Solo', flags: ['with-baby', 'no-boats'] });
    expect(flags.has('with-baby')).toBe(false);
    expect(flags.has('no-boats')).toBe(true);
  });

  it('drops a stale honeymoon from a solo trip', () => {
    const flags = effectiveFlags({ ...DEFAULT_ANSWERS, groupType: 'Solo', flags: ['honeymoon'] });
    expect(flags.has('honeymoon')).toBe(false);
  });

  it('keeps the flag once the group makes it applicable again', () => {
    const answers = { ...DEFAULT_ANSWERS, flags: ['honeymoon'] };
    expect(effectiveFlags({ ...answers, groupType: 'Friends' }).has('honeymoon')).toBe(false);
    expect(effectiveFlags({ ...answers, groupType: 'Couple' }).has('honeymoon')).toBe(true);
  });

  it('a notes-derived flag is never gated by group', () => {
    // Group restrictions describe which pills to offer, not what the traveller wrote.
    const flags = effectiveFlags({ ...DEFAULT_ANSWERS, groupType: 'Solo', flags: [], specialNotes: 'I get seasick' });
    expect(flags.has('no-boats')).toBe(true);
  });
});

describe('generatePlan — free-text seasick note excludes boats end-to-end', () => {
  const catalog = getCatalog();
  const allEntries = (plan: Day[]): SlotEntry[] =>
    plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]);

  it('a seasick note (no pill) removes the sunset-sail crowd-pleaser', () => {
    for (let s = 0; s < 8; s += 1) {
      const plan = generatePlan(
        { ...DEFAULT_ANSWERS, days: 9, interests: ['watersports', 'beach-chill'], specialNotes: 'I get seasick on boats' },
        catalog,
        { seed: s },
      );
      const faces = allEntries(plan)
        .filter((e) => e.kind === 'group')
        .map((e) => (e as { kind: 'group'; bestSellerId: string }).bestSellerId);
      expect(faces).not.toContain('sunset-sail');
      expect(faces).not.toContain('snorkel-catamaran');
    }
  });
});
