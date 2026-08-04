import type { Coord } from './coords';
import { pinPlaces, type Pin } from './itemCoords';

/**
 * Lays out the markers for one day: every activity's primary location, plus the
 * further places a multi-stop activity visits.
 *
 * Two rules the map depends on:
 *
 * 1. **A multi-stop activity must read as ONE activity.** Its secondary markers
 *    carry the same stop number as the primary, are drawn lighter, and are
 *    joined to it by a dashed tether. Without that, "Arikok + Conchi + Baby
 *    Beach" looks like three separate things in the day rather than one tour.
 *
 * 2. **Displacement is presentation only.** Markers sharing a coordinate are
 *    fanned onto a small circle so none is hidden, but `trueCoord` is preserved
 *    so routing, the tether and the audit all still see the real point. The
 *    fan-out is computed across primaries AND stops together — a stop landing on
 *    another activity's pin has to be separated too.
 */

const DISPLACE_DEG = 0.0016;   // ~175m — enough to separate pins at our zoom levels

export type MarkerInput = {
  key: string;
  coord: Coord | null;
  pin: Pin | null;
};

export type LaidOutMarker<T> = T & {
  /** Where to draw it — displaced when markers share a point. */
  coord: Coord;
  /** Where it actually is. Never displaced. */
  trueCoord: Coord;
  /** Stop number, shared by an activity's primary and all its stops. */
  num: number;
  /** Index into the original day-entry list, so hue and card stay in step. */
  idx: number;
  primary: boolean;
  /** Human-readable place name for this specific marker, when known. */
  place?: string;
};

export function layoutMarkers<T extends MarkerInput>(entries: T[]): Array<LaidOutMarker<T>> {
  // One entry per drawable place, numbered by the activity it belongs to.
  const flat: Array<LaidOutMarker<T>> = [];
  let num = 0;
  entries.forEach((e, idx) => {
    if (!e.coord) return;               // no marker; it owns a route leg instead
    num++;
    const places = e.pin ? pinPlaces(e.pin) : [{ coord: e.coord, primary: true, place: undefined }];
    for (const place of places) {
      flat.push({
        ...e,
        key: place.primary ? e.key : `${e.key}-stop-${flat.length}`,
        coord: place.coord, trueCoord: place.coord,
        num, idx, primary: place.primary, place: place.place,
      });
    }
  });

  // Fan out anything sharing a point, primaries and stops alike.
  const counts = new Map<string, number>();
  const keyOf = (c: Coord) => `${c.lng.toFixed(5)},${c.lat.toFixed(5)}`;
  for (const m of flat) counts.set(keyOf(m.trueCoord), (counts.get(keyOf(m.trueCoord)) ?? 0) + 1);

  const seen = new Map<string, number>();
  return flat.map((m) => {
    const k = keyOf(m.trueCoord);
    const total = counts.get(k)!;
    if (total < 2) return m;
    const pos = seen.get(k) ?? 0;
    seen.set(k, pos + 1);
    const angle = (2 * Math.PI * pos) / total;
    return {
      ...m,
      coord: {
        lng: m.trueCoord.lng + DISPLACE_DEG * Math.cos(angle),
        lat: m.trueCoord.lat + DISPLACE_DEG * Math.sin(angle),
      },
    };
  });
}

/**
 * The places each multi-stop activity visits, in visit order, as TRUE
 * coordinates.
 *
 * True rather than displaced because these are fed to the Directions API to be
 * snapped to roads — a router asked to route from a point shifted 175m into the
 * sea gives a worse answer, and the day's route line already works this way.
 *
 * A straight line between two stops would say the activity teleports; a jeep
 * safari from Arikok to Baby Beach follows the coast road, and the tether should
 * show that.
 */
export function tetherLines<T extends MarkerInput>(
  markers: Array<LaidOutMarker<T>>,
): Array<{ idx: number; coords: [number, number][] }> {
  const byActivity = new Map<number, Array<LaidOutMarker<T>>>();
  for (const m of markers) byActivity.set(m.idx, [...(byActivity.get(m.idx) ?? []), m]);
  return [...byActivity.entries()]
    .filter(([, ms]) => ms.length > 1)
    .map(([idx, ms]) => ({
      idx,
      coords: ms.map((m) => [m.trueCoord.lng, m.trueCoord.lat] as [number, number]),
    }));
}
