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

// Breathing room on top of the pin's own extent.
const MARGIN_PX = 36;

/**
 * How far Mapbox's NavigationControl reaches in from the top-right corner.
 *
 * Measured from `node_modules/mapbox-gl/dist/mapbox-gl.css`, not guessed:
 * `.mapboxgl-ctrl-top-right .mapboxgl-ctrl{margin:10px 10px 0 0}` and
 * `.mapboxgl-ctrl-group button{width:32px;height:32px}`. react-map-gl renders
 * three buttons (zoom in, zoom out, compass), so the control occupies y 10..106
 * and x 10..42 measured from the right edge.
 *
 * The clearance is bought on the HORIZONTAL axis deliberately. Keeping a pin
 * out from under the buttons by padding the TOP instead would need
 * 106 + 59 = 165px before any margin — a third of the map's height on a phone,
 * to solve a problem that lives in one corner. Padding the RIGHT past the
 * control costs 42px on one side and nothing anywhere else.
 */
const CONTROL_INSET_PX = 42;
// Slack between the pin's right edge and the control's left edge.
const CONTROL_CLEARANCE_PX = 12;

export const DAY_FIT_PADDING = {
  top: PIN_ABOVE_PX + MARGIN_PX,
  bottom: MARGIN_PX,
  left: PIN_SIDE_PX + MARGIN_PX,
  // No pin's graphic may reach the control: its right edge sits at
  // `right - PIN_SIDE_PX` from the frame, which must stay left of
  // CONTROL_INSET_PX. Pinned by a test, because the arithmetic is the fix.
  right: CONTROL_INSET_PX + PIN_SIDE_PX + CONTROL_CLEARANCE_PX,
};

export { CONTROL_INSET_PX, MARGIN_PX };

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
 * all three.
 *
 * The caller already did that before this module existed, and the BOUNDS were
 * never the bug — only the padding was. Stated here because the invariant is
 * easy to break from the call site and nothing else would catch it.
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
