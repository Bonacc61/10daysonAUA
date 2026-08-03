import type { Coord } from './coords';

/**
 * Turns a day's activities into route waypoints and per-leg ownership.
 *
 * Two problems this solves:
 *
 * 1. **Waypoints must be true coordinates.** Markers are displaced ~175m to stop
 *    co-located pins overlapping; routing on those displaced anchors drew a
 *    phantom zigzag between stops that are actually at the same place. So legs
 *    are built here, from the real coordinates, before any displacement.
 *
 * 2. **An activity with no coordinate must stay visible.** ~33 catalog items
 *    have no location to pin — hotel-pickup tours where the departure point is
 *    the traveller's own hotel, and products that publish nothing. Dropping them
 *    off the map leaves a traveller with an activity that shows nothing;
 *    inventing a point is what this whole project exists to stop. Instead such an
 *    activity OWNS the leg spanning it, and the map colours that stretch in its
 *    hue: "this happens somewhere along here", which is what is known.
 *
 * See docs/superpowers/specs/2026-08-03-map-pin-accuracy-design.md.
 */

export type LegPlan = {
  /** Waypoints in day order, consecutive duplicates removed. */
  waypoints: Array<{ coord: Coord; idx: number }>;
  /**
   * One entry per leg (so `waypoints.length - 1` of them). Each holds the
   * indices — into the original activity list — of the activities that own that
   * leg. Usually one; more when several coordless activities share a span.
   */
  legOwners: number[][];
};

export function planLegs(entries: Array<{ coord: Coord | null }>): LegPlan {
  const waypoints: LegPlan['waypoints'] = [];
  const legOwners: number[][] = [];
  const pending: number[] = [];

  entries.forEach((e, idx) => {
    if (!e.coord) {
      // Leading coordless activities have nothing to connect back to, so they are
      // not queued at all — they get no segment rather than an invented origin.
      if (waypoints.length) pending.push(idx);
      return;
    }
    const last = waypoints[waypoints.length - 1];
    if (last && last.coord.lng === e.coord.lng && last.coord.lat === e.coord.lat) {
      // Same point as the previous stop: no leg exists between them, so anything
      // pending keeps waiting for a leg that actually spans distance.
      return;
    }
    if (waypoints.length) legOwners.push(pending.length ? pending.splice(0) : [idx]);
    waypoints.push({ coord: e.coord, idx });
  });

  // Trailing coordless activities have no following stop, so no segment.
  return { waypoints, legOwners };
}

/**
 * Split one leg's coordinates between the activities sharing it, so each keeps a
 * distinct hue instead of several lines overplotting. Slices overlap by one
 * point so the drawn segments join up with no visible gap.
 */
export function splitLeg(line: [number, number][], parts: number): [number, number][][] {
  if (parts <= 1 || line.length < 2) return [line];

  // Every owner gets a drawable slice AND the route reaches the destination.
  //
  // Two bugs lived here. The first returned ONE slice for two owners on a
  // two-point line, so the second of two adjacent coordless activities vanished
  // from the map — the exact disappearance this feature prevents. The fix for
  // that introduced a worse one: fixed-width slicing walked off the end, and
  // 205 of 295 (length x owners) combinations stopped short of the destination
  // pin — a 10-point leg split 5 ways ended at point 5 of 9.
  //
  // Both are avoided by cutting at proportional indices computed from the ends,
  // so the first slice always starts at 0 and the last always ends at n-1.
  let pts = line;
  if (pts.length < parts + 1) {
    // Not enough points to give every owner its own cut: subdivide by linear
    // interpolation. This adds no geographic claim — it subdivides a straight
    // line that is already being drawn between two real coordinates.
    const dense: [number, number][] = [];
    const segs = pts.length - 1;
    const perSeg = Math.ceil(parts / segs) + 1;
    for (let i = 0; i < segs; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      for (let k = 0; k < perSeg; k++) {
        const t = k / perSeg;
        dense.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      }
    }
    dense.push(pts[pts.length - 1]);
    pts = dense;
  }

  const n = pts.length;
  const out: [number, number][][] = [];
  for (let i = 0; i < parts; i++) {
    const from = Math.round((i * (n - 1)) / parts);
    const to = Math.round(((i + 1) * (n - 1)) / parts);
    // Slices share their boundary point, so the drawn segments join with no gap.
    const slice = pts.slice(from, to + 1);
    if (slice.length >= 2) out.push(slice);
  }
  return out.length === parts ? out : [pts];
}
