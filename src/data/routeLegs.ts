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

  // Every owner must get a drawable slice. A straight-line leg is only two
  // points, so naive slicing produced ONE slice for two owners and the second
  // activity vanished from the map entirely — exactly the disappearance this
  // feature exists to prevent. Densify first so there is always enough to go
  // round: linear interpolation adds no geographic claim, it just subdivides a
  // line that is already being drawn.
  let pts = line;
  const needed = parts + 1;
  if (pts.length < needed) {
    const dense: [number, number][] = [];
    const segs = pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const steps = Math.ceil((needed - 1) / segs);
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        dense.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      }
    }
    dense.push(pts[pts.length - 1]);
    pts = dense;
  }

  const per = Math.max(2, Math.ceil(pts.length / parts));
  const out: [number, number][][] = [];
  for (let i = 0; i < parts; i++) {
    const slice = pts.slice(i * (per - 1), i * (per - 1) + per);
    if (slice.length >= 2) out.push(slice);
  }
  // Anything still short is padded from the tail so no owner is dropped.
  while (out.length < parts && out.length > 0) out.push(out[out.length - 1]);
  return out.length ? out : [line];
}
