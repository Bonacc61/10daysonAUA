import { describe, it, expect } from 'vitest';
import { dayHues, hexToHsl, hslToHex } from './dayHues';
import { DAY_COLORS } from './itineraryGenerator';

const DAY_RED = '#E63946';   // one of DAY_COLORS
const DAY_BLUE = '#3B82F6';
// Smallest lightness gap between adjacent stops that still reads as two shades
// at pin size — roughly 3/255. Below this the pins look like a flat block.
const MIN_STEP_L = 0.012;

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

  // The two hand-picked colours above (red, blue) both sit far enough from the
  // lightness ceiling that they never exercised it. #FF6B47 (days 1 and 8) and
  // #8B5CF6 (day 6) do not: with a fixed spread they ran past MAX_L and the last
  // two stops of a long day clamped to the SAME lightness — visually one pin
  // colour repeated. Table-test the real list so a new day colour can't
  // reintroduce that silently.
  it.each(DAY_COLORS)('keeps every stop separable across a long day — %s', (dayColor) => {
    for (let count = 2; count <= 8; count += 1) {
      const ls = dayHues(dayColor, count).map((h) => hexToHsl(h).l);
      for (let i = 1; i < ls.length; i += 1) {
        expect(
          ls[i] - ls[i - 1],
          `${dayColor} with ${count} stops: steps ${i - 1}→${i} are ${ls[i - 1].toFixed(3)}→${ls[i].toFixed(3)}`,
        ).toBeGreaterThanOrEqual(MIN_STEP_L);
      }
    }
  });

  it('clamps an already-dark or already-light day colour into the band', () => {
    // These extremes sit outside the legible band entirely, so they exercise the
    // centring path rather than the spread path.
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
