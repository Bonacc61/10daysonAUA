import { describe, it, expect } from 'vitest';
import { dayHues, hexToHsl, hslToHex } from './dayHues';

const DAY_RED = '#E63946';   // one of DAY_COLORS
const DAY_BLUE = '#3B82F6';

describe('dayHues', () => {
  it('round-trips a colour through HSL without drifting', () => {
    for (const hex of [DAY_RED, DAY_BLUE, '#22C55E', '#EAB308', '#8B5CF6']) {
      const back = hexToHsl(hex);
      const again = hexToHsl(hslToHex(back));
      // 1 degree / 1% tolerance for 8-bit rounding
      expect(Math.abs(again.h - back.h)).toBeLessThan(1.5);
      expect(Math.abs(again.s - back.s)).toBeLessThan(0.02);
      expect(Math.abs(again.l - back.l)).toBeLessThan(0.02);
    }
  });

  it('leaves a single-stop day exactly as it was', () => {
    expect(dayHues(DAY_RED, 1)).toEqual([DAY_RED]);
  });

  it('produces one distinct shade per stop', () => {
    const hues = dayHues(DAY_RED, 5);
    expect(hues).toHaveLength(5);
    expect(new Set(hues).size).toBe(5);
  });

  it('gets monotonically lighter, so stop order is readable', () => {
    const ls = dayHues(DAY_BLUE, 6).map((h) => hexToHsl(h).l);
    for (let i = 1; i < ls.length; i += 1) expect(ls[i]).toBeGreaterThan(ls[i - 1]);
  });

  it('stays recognisably the same colour — hue never drifts far from the base', () => {
    const base = hexToHsl(DAY_RED).h;
    for (const hex of dayHues(DAY_RED, 8)) {
      // circular distance between the shade hue and the day hue
      const d = Math.abs(((hexToHsl(hex).h - base + 540) % 360) - 180);
      expect(d).toBeLessThanOrEqual(12);   // within the declared drift
    }
  });

  it('keeps every shade inside the legible lightness band', () => {
    // A long day must not run to near-black or near-white, or the pin number
    // stops reading against it.
    for (const hex of dayHues(DAY_RED, 12)) {
      const l = hexToHsl(hex).l;
      expect(l).toBeGreaterThanOrEqual(0.28);
      expect(l).toBeLessThanOrEqual(0.74);
    }
  });

  it('clamps an already-dark or already-light day colour into the band', () => {
    // DAY_COLORS all sit mid-lightness, so the clamp never fires for them —
    // these extremes are what actually exercise it.
    for (const extreme of ['#101820', '#FFF4D6']) {
      for (const hex of dayHues(extreme, 10)) {
        const l = hexToHsl(hex).l;
        expect(l).toBeGreaterThanOrEqual(0.28);
        expect(l).toBeLessThanOrEqual(0.74);
      }
    }
  });

  it('survives a malformed colour rather than throwing in the render path', () => {
    expect(() => dayHues('not-a-colour', 3)).not.toThrow();
    expect(dayHues('not-a-colour', 3)).toHaveLength(3);
  });

  it('returns nothing for a day with no stops', () => {
    expect(dayHues(DAY_RED, 0)).toEqual([]);
  });
});
