import { describe, it, expect } from 'vitest';
import { layoutMarkers, tetherLines } from './markerLayout';
import type { Pin } from './itemCoords';

const A = { lng: -70.0579, lat: 12.5492 };
const B = { lng: -69.9287, lat: 12.5246 };
const C = { lng: -69.8808, lat: 12.4138 };

const pin = (coord: typeof A, stops?: Array<typeof A>): Pin => ({
  coord, source: 'known-place', cite: 'test', place: 'Primary',
  ...(stops ? { stops: stops.map((s) => ({ coord: s, cite: 'test', place: 'Stop' })) } : {}),
});
const entry = (key: string, coord: typeof A | null, p: Pin | null) => ({ key, coord, pin: p });

describe('layoutMarkers', () => {
  it('draws one marker per activity when none has stops', () => {
    const out = layoutMarkers([entry('a', A, pin(A)), entry('b', B, pin(B))]);
    expect(out).toHaveLength(2);
    expect(out.map(m => m.num)).toEqual([1, 2]);
    expect(out.every(m => m.primary)).toBe(true);
  });

  it('draws a marker for every stop of a multi-stop activity', () => {
    const out = layoutMarkers([entry('a', A, pin(A, [B, C]))]);
    expect(out).toHaveLength(3);
    expect(out.filter(m => m.primary)).toHaveLength(1);
  });

  it('gives an activity and all its stops the SAME number, so they read as one', () => {
    const out = layoutMarkers([entry('a', A, pin(A, [B, C])), entry('b', C, pin(C))]);
    const first = out.filter(m => m.idx === 0);
    expect(new Set(first.map(m => m.num)).size).toBe(1);
    expect(first[0].num).toBe(1);
    // the following activity is still numbered 2, not 4 — stops do not consume numbers
    expect(out.find(m => m.idx === 1)!.num).toBe(2);
  });

  it('skips an activity with no coordinate — it owns a route leg instead', () => {
    const out = layoutMarkers([entry('a', A, pin(A)), entry('b', null, null), entry('c', C, pin(C))]);
    expect(out).toHaveLength(2);
    expect(out.map(m => m.num)).toEqual([1, 2]);
  });

  it('gives every marker a unique key, so React does not collapse them', () => {
    const out = layoutMarkers([entry('a', A, pin(A, [B, C])), entry('b', B, pin(B, [C]))]);
    expect(new Set(out.map(m => m.key)).size).toBe(out.length);
  });
});

describe('layoutMarkers — displacement', () => {
  it('leaves a lone marker exactly on its coordinate', () => {
    const [m] = layoutMarkers([entry('a', A, pin(A))]);
    expect(m.coord).toEqual(A);
    expect(m.trueCoord).toEqual(A);
  });

  it('separates two activities sharing a point', () => {
    const out = layoutMarkers([entry('a', A, pin(A)), entry('b', A, pin(A))]);
    expect(out[0].coord).not.toEqual(out[1].coord);
  });

  it('separates a STOP that lands on another activity primary', () => {
    // The bug this guards: fanning only primaries left a stop hidden underneath.
    const out = layoutMarkers([entry('a', A, pin(A, [B])), entry('b', B, pin(B))]);
    const atB = out.filter(m => m.trueCoord.lng === B.lng && m.trueCoord.lat === B.lat);
    expect(atB).toHaveLength(2);
    expect(atB[0].coord).not.toEqual(atB[1].coord);
  });

  it('never moves trueCoord — routing and the audit must see the real point', () => {
    const out = layoutMarkers([entry('a', A, pin(A)), entry('b', A, pin(A))]);
    out.forEach(m => expect(m.trueCoord).toEqual(A));
  });

  it('displaces by roughly 175m, not more', () => {
    const out = layoutMarkers([entry('a', A, pin(A)), entry('b', A, pin(A))]);
    const LAT = 110.574, LNG = 111.320 * Math.cos((12.52 * Math.PI) / 180);
    for (const m of out) {
      const d = Math.hypot((m.coord.lng - A.lng) * LNG, (m.coord.lat - A.lat) * LAT) * 1000;
      expect(d).toBeGreaterThan(100);
      expect(d).toBeLessThan(260);
    }
  });
});

describe('tetherLines', () => {
  it('returns nothing when no activity has stops', () => {
    expect(tetherLines(layoutMarkers([entry('a', A, pin(A)), entry('b', B, pin(B))]))).toEqual([]);
  });

  it('joins a multi-stop activity primary-first, in visit order', () => {
    const out = tetherLines(layoutMarkers([entry('a', A, pin(A, [B, C]))]));
    expect(out).toHaveLength(1);
    expect(out[0].coords).toHaveLength(3);
    expect(out[0].coords[0]).toEqual([A.lng, A.lat]);
  });

  it('emits one tether per multi-stop activity, not one for the day', () => {
    const out = tetherLines(layoutMarkers([entry('a', A, pin(A, [B])), entry('b', C, pin(C, [B]))]));
    expect(out).toHaveLength(2);
  });

  it('connects the DRAWN positions, so the line meets the markers', () => {
    // Both activities sit at A, so both get displaced; the tether must follow.
    const markers = layoutMarkers([entry('a', A, pin(A, [A])), entry('b', B, pin(B))]);
    const [t] = tetherLines(markers);
    const drawn = markers.filter(m => m.idx === 0).map(m => [m.coord.lng, m.coord.lat]);
    expect(t.coords).toEqual(drawn);
  });
});
