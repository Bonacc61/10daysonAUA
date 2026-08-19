import type { Coord } from './coords';

/**
 * How the map should frame ONE day's pins.
 *
 * Pure and separately tested for the same reason `markerLayout.ts` is: the
 * interesting cases here are geometric, they are invisible in code review, and
 * the effect that used to hold this logic could only be checked by opening the
 * page.
 *
 * The numbers come from the marker itself. `PhotoPin` draws a 50px circle plus
 * a 9px tail and the `<Marker>` is anchored BOTTOM, so the graphic occupies
 * 59px ABOVE its coordinate and 25px either side of it — nothing below. Padding
 * that only clears the coordinate therefore clips the photo of any pin sitting
 * near an edge, which reads to a traveller as a missing pin rather than a tight
 * frame.
 */
export const PIN_ABOVE_PX = 59;   // 50px circle + 9px tail
export const PIN_SIDE_PX = 25;    // half of the 50px circle

// Breathing room on top of the pin's own extent. The top also has to clear
// Mapbox's NavigationControl (top-right, ~90px tall including its 10px offset),
// or the last pin of a north-coast day sits under the zoom buttons.
const MARGIN_PX = 36;
const CONTROL_PX = 90;

export const DAY_FIT_PADDING = {
  top: Math.max(PIN_ABOVE_PX, CONTROL_PX) + MARGIN_PX,
  bottom: MARGIN_PX,
  left: PIN_SIDE_PX + MARGIN_PX,
  right: PIN_SIDE_PX + MARGIN_PX,
};

// A lone pin has no bounds to fit, so it gets a fixed zoom. 13 shows roughly
// the surrounding neighbourhood — enough to place it against a coastline.
export const SINGLE_PIN_ZOOM = 13;

// Clustered days would otherwise fit to street level, where a traveller loses
// any sense of where on the island they are.
export const DAY_MAX_ZOOM = 14;

export type DayCamera =
  | { kind: 'fit'; bounds: [[number, number], [number, number]]; padding: typeof DAY_FIT_PADDING; maxZoom: number }
  | { kind: 'center'; center: [number, number]; zoom: number };

/**
 * The camera for a day's pins, or null when the day draws none.
 *
 * `coords` must be EVERY drawn marker — the fanned-out duplicates and the extra
 * stops of a multi-stop tour included, i.e. the output of `layoutMarkers` and
 * not the day's entries. A day whose jeep safari draws three pins is framed by
 * all three; framing it by the activity's primary coordinate alone leaves the
 * other two off screen, which is the shape of the bug this replaced.
 */
export function dayCamera(coords: Coord[]): DayCamera | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) {
    return { kind: 'center', center: [coords[0].lng, coords[0].lat], zoom: SINGLE_PIN_ZOOM };
  }
  const lngs = coords.map((c) => c.lng);
  const lats = coords.map((c) => c.lat);
  return {
    kind: 'fit',
    bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    padding: DAY_FIT_PADDING,
    maxZoom: DAY_MAX_ZOOM,
  };
}
