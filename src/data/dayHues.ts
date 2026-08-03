// Per-stop shades of a single day colour.
//
// Every stop on a day used to render in exactly the day's colour, so a map with
// five pins showed five identical markers — you could tell WHICH DAY you were
// looking at but not which stop was which, and the route line joining them was
// one flat colour with no sense of direction.
//
// These keep the day's hue and saturation and walk the LIGHTNESS instead, so the
// set still reads unmistakably as one day while each stop is distinguishable and
// the order is legible: first stop darkest, last lightest. A small hue drift is
// added on top because two adjacent lightness steps of a saturated colour can be
// hard to separate at pin size.

const SPREAD_L = 0.30;   // total lightness travelled across a day, in HSL L
const DRIFT_H = 10;      // degrees of hue drift across a day
// Keep every shade legible against the map and against white pin text.
const MIN_L = 0.30;
const MAX_L = 0.72;

export type Hsl = { h: number; s: number; l: number };

export function hexToHsl(hex: string): Hsl {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 0, s: 0, l: 0.5 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * `count` shades of `baseHex`, darkest first. One stop returns the base colour
 * unchanged, so a single-stop day looks exactly as it always did.
 */
export function dayHues(baseHex: string, count: number): string[] {
  if (count <= 0) return [];
  const base = hexToHsl(baseHex);
  if (count === 1) return [baseHex];
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);              // 0 … 1 across the day
    const l = base.l - SPREAD_L / 2 + SPREAD_L * t;
    return hslToHex({
      h: base.h - DRIFT_H / 2 + DRIFT_H * t,
      s: base.s,
      l: Math.min(MAX_L, Math.max(MIN_L, l)),
    });
  });
}
