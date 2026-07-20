import { describe, it, expect } from 'vitest';
import { flagsFromNotes, effectiveFlags } from './notesFlags';
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
    const flags = effectiveFlags({ ...DEFAULT_ANSWERS, flags: ['honeymoon'], specialNotes: 'I get seasick' });
    expect(flags.has('honeymoon')).toBe(true);
    expect(flags.has('no-boats')).toBe(true);
  });

  it('a pill and a note that imply the same flag collapse to one', () => {
    const flags = effectiveFlags({ ...DEFAULT_ANSWERS, flags: ['no-boats'], specialNotes: 'seasick' });
    expect([...flags].filter((f) => f === 'no-boats').length).toBe(1);
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
