import { describe, it, expect } from 'vitest';
import { planLegs, splitLeg } from './routeLegs';

const A = { lng: -70.0579, lat: 12.5492 };   // Eagle Beach
const B = { lng: -69.9287, lat: 12.5246 };   // Natural Pool
const C = { lng: -69.8808, lat: 12.4138 };   // Baby Beach

const at = (coord: typeof A | null) => ({ coord });

describe('planLegs — waypoints', () => {
  it('keeps every located stop in day order', () => {
    const { waypoints } = planLegs([at(A), at(B), at(C)]);
    expect(waypoints.map(w => w.idx)).toEqual([0, 1, 2]);
  });

  it('drops consecutive duplicate coordinates, which would draw a zero-length leg', () => {
    const { waypoints, legOwners } = planLegs([at(A), at(A), at(B)]);
    expect(waypoints.map(w => w.idx)).toEqual([0, 2]);
    expect(legOwners).toHaveLength(1);
  });

  it('keeps a repeat coordinate that is not consecutive', () => {
    // Returning to the same beach later in the day is a real leg out and back.
    const { waypoints } = planLegs([at(A), at(B), at(A)]);
    expect(waypoints.map(w => w.idx)).toEqual([0, 1, 2]);
  });

  it('produces one fewer leg than waypoints', () => {
    const { waypoints, legOwners } = planLegs([at(A), at(B), at(C)]);
    expect(legOwners).toHaveLength(waypoints.length - 1);
  });

  it('produces no legs for a day with a single stop', () => {
    expect(planLegs([at(A)]).legOwners).toEqual([]);
  });

  it('produces nothing for a day with no located stops', () => {
    const { waypoints, legOwners } = planLegs([at(null), at(null)]);
    expect(waypoints).toEqual([]);
    expect(legOwners).toEqual([]);
  });
});

describe('planLegs — who owns each leg', () => {
  it('gives a leg to the activity it arrives at', () => {
    const { legOwners } = planLegs([at(A), at(B), at(C)]);
    expect(legOwners).toEqual([[1], [2]]);
  });

  it('hands the spanning leg to a coordless activity between two stops', () => {
    // index 1 has no coordinate: it owns the A→C leg, so it stays visible.
    const { waypoints, legOwners } = planLegs([at(A), at(null), at(C)]);
    expect(waypoints.map(w => w.idx)).toEqual([0, 2]);
    expect(legOwners).toEqual([[1]]);
  });

  it('shares one leg between several consecutive coordless activities', () => {
    const { legOwners } = planLegs([at(A), at(null), at(null), at(C)]);
    expect(legOwners).toEqual([[1, 2]]);
  });

  it('gives a leading coordless activity no segment — nothing to connect back to', () => {
    const { waypoints, legOwners } = planLegs([at(null), at(A), at(B)]);
    expect(waypoints.map(w => w.idx)).toEqual([1, 2]);
    expect(legOwners).toEqual([[2]]);
  });

  it('gives a trailing coordless activity no segment', () => {
    const { legOwners } = planLegs([at(A), at(B), at(null)]);
    expect(legOwners).toEqual([[1]]);
  });

  it('never invents an origin for a day that is entirely coordless but for one stop', () => {
    const { waypoints, legOwners } = planLegs([at(null), at(A), at(null)]);
    expect(waypoints.map(w => w.idx)).toEqual([1]);
    expect(legOwners).toEqual([]);
  });
});

describe('splitLeg', () => {
  const line: [number, number][] = Array.from({ length: 11 }, (_, i) => [i, 0]);

  it('returns the line unchanged for a single owner', () => {
    expect(splitLeg(line, 1)).toEqual([line]);
  });

  it('splits into one piece per owner', () => {
    expect(splitLeg(line, 3)).toHaveLength(3);
  });

  it('makes consecutive pieces share a point, so the drawn route has no gaps', () => {
    const parts = splitLeg(line, 3);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i][0]).toEqual(parts[i - 1][parts[i - 1].length - 1]);
    }
  });

  it('never emits a piece too short to draw', () => {
    for (const parts of [splitLeg(line, 2), splitLeg(line, 3), splitLeg(line, 5)]) {
      parts.forEach(p => expect(p.length).toBeGreaterThanOrEqual(2));
    }
  });

  // This test used to assert `splitLeg(tiny, 3) === [tiny]` — one slice for three
  // owners — which blessed the exact defect the feature exists to prevent: the
  // second and third activities got no segment and disappeared from the map
  // entirely. A straight-line leg is only two points, so this fired whenever the
  // Directions call failed or two coordless activities were adjacent.
  it('gives every owner a slice even when the line is only two points', () => {
    const tiny: [number, number][] = [[0, 0], [1, 1]];
    for (const parts of [2, 3, 5]) {
      const out = splitLeg(tiny, parts);
      expect(out).toHaveLength(parts);
      out.forEach(p => expect(p.length).toBeGreaterThanOrEqual(2));
    }
  });

  it('keeps densified slices on the original line', () => {
    // Interpolation may add points, but never off the segment it subdivides.
    const tiny: [number, number][] = [[0, 0], [10, 10]];
    for (const seg of splitLeg(tiny, 4)) {
      for (const [x, y] of seg) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(10);
        expect(Math.abs(x - y)).toBeLessThan(1e-9);   // stays on y = x
      }
    }
  });

  it('still starts at the origin and ends at the destination', () => {
    const tiny: [number, number][] = [[0, 0], [10, 10]];
    const out = splitLeg(tiny, 3);
    expect(out[0][0]).toEqual([0, 0]);
    expect(out[out.length - 1][out[out.length - 1].length - 1]).toEqual([10, 10]);
  });

  // Exhaustive, because both bugs in this function were shape-dependent and the
  // hand-picked cases missed them. The first fix dropped an owner on short
  // lines; the second walked off the end, leaving 205 of these 295 combinations
  // stopping short of the destination pin. Neither was visible from an example.
  it('holds for every line length and owner count we can hit', () => {
    for (let len = 2; len <= 60; len++) {
      for (let parts = 2; parts <= 6; parts++) {
        const line: [number, number][] = Array.from({ length: len }, (_, i) => [i, 0]);
        const out = splitLeg(line, parts);

        expect(out, `len=${len} parts=${parts}: every owner needs a slice`).toHaveLength(parts);
        out.forEach(seg => expect(seg.length).toBeGreaterThanOrEqual(2));
        expect(out[0][0], `len=${len} parts=${parts}: must start at the origin`).toEqual([0, 0]);
        const last = out[out.length - 1];
        expect(last[last.length - 1], `len=${len} parts=${parts}: must reach the destination`).toEqual([len - 1, 0]);
        for (let i = 1; i < out.length; i++) {
          expect(out[i][0], `len=${len} parts=${parts}: slice ${i} must join the previous`)
            .toEqual(out[i - 1][out[i - 1].length - 1]);
        }
      }
    }
  });
});
