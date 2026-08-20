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
export const PIN_ABOVE_PX = 59;   // 50px circle + 9px tail, less the tail's -1 margin = 58 drawn; rounded up
export const PIN_SIDE_PX = 25;    // half of the 50px circle

/**
 * Breathing room on top of the pin's own extent, as a FLOOR.
 *
 * It used to be the whole story, and that was the bug. Measured on live
 * production at every viewport from 1920x1080 down to 390x844, the slack above
 * the northernmost pin and below the southernmost came out at 37px and 36px on
 * every single day — the camera was framing each day at the tightest zoom the
 * padding legally allowed, so the pins sat on the edges of the frame.
 *
 * Reported as "the map is too zoomed in by default — I always have to zoom out
 * a bit to see all the pins of that day", which is exactly a traveller
 * supplying by hand the margin the camera never left.
 */
export const MARGIN_PX = 36;

/**
 * The share of each axis given to breathing room, over and above the pin
 * graphic itself.
 *
 * Proportional rather than fixed because 36px is a different amount of room on
 * the 557px-tall canvas a 1440x900 laptop gives the map than on the 277px one a
 * 1440x620 window gives it — and the vertical axis is the one that binds.
 * Aruba's day routes run north-south while the map canvas is short and wide, so
 * the fit is always decided by height; at 1440x557 the horizontal axis had 1354
 * of 1440 pixels to spare over open sea while the vertical had 36.
 *
 * 0.15 buys back roughly a third of a zoom level at laptop size (the box the
 * bounds must fit into goes from 426px to 330px of height), which is the "zoom
 * out a bit" the report asked for, and it behaves the same on a phone as on a
 * desktop because it is scale-free.
 */
const BREATHING_FRACTION = 0.15;

/**
 * The most of an axis the padding may ever consume.
 *
 * Without this the padding can exceed the canvas outright: on a landscape phone
 * (844x390) the bottom panel leaves the map 47px of height against 131px of
 * demanded vertical padding, and mapbox handed a negative box to fit into
 * returns a garbage camera. Measured on live production before this change: 14
 * of 14 markers across five days landed outside the canvas, most of them
 * several hundred pixels above it. Clamping keeps the box strictly positive, so
 * a map too short to frame a day nicely still frames it correctly.
 *
 * What it does NOT promise: below roughly 218px of canvas height the clamp
 * drives `top` under PIN_ABOVE_PX — at 844x47 it lands on 20px against a 59px
 * pin graphic — so the northernmost pin's photo is clipped. That is an accepted
 * degradation rather than a regression, since the same viewport used to throw
 * every marker off the canvas entirely; the pin-clearance guarantee is
 * unconditional only while the canvas is big enough to honour it. The real fix
 * is a minimum height for the map, which belongs in Map.tsx's layout.
 */
export const MAX_PADDING_FRACTION = 0.6;

/**
 * How far Mapbox's NavigationControl reaches in from the top-right corner.
 *
 * Measured from `node_modules/mapbox-gl/dist/mapbox-gl.css`, not guessed:
 * `.mapboxgl-ctrl-top-right .mapboxgl-ctrl{margin:10px 10px 0 0}`,
 * `.mapboxgl-ctrl-group button{width:32px;height:32px}` and
 * `.mapboxgl-ctrl-group:not(:empty){box-shadow:0 0 0 2px}` — which paints
 * OUTSIDE the layout box, so the visible inset is 10 + 32 + 2. react-map-gl
 * renders three buttons (zoom in, zoom out, compass; `showCompass` defaults on
 * and Map.tsx overrides nothing), so the control occupies y 10..108 and x 10..44
 * measured from the right edge.
 *
 * The clearance is bought on the HORIZONTAL axis deliberately. Keeping a pin
 * out from under the buttons by padding the TOP instead would need
 * 106 + 59 = 165px before any margin — a third of the map's height on a phone,
 * to solve a problem that lives in one corner. Padding the RIGHT past the
 * control costs 42px on one side and nothing anywhere else.
 */
const CONTROL_INSET_PX = 44;
// Slack between the pin's right edge and the control's left edge. Exported so
// the test can assert the FULL floor: asserting only `> CONTROL_INSET_PX` let a
// build that had dropped the floor entirely still pass, because the
// proportional margin happened to clear the inset on its own at the widths
// under test.
export const CONTROL_CLEARANCE_PX = 12;

export type Viewport = { width: number; height: number };

export type FitPadding = { top: number; bottom: number; left: number; right: number };

/**
 * The fit padding for a given map canvas.
 *
 * Each side clears the pin GRAPHIC — `PhotoPin` is anchored bottom, so it
 * occupies 59px above its coordinate and 25px either side, and nothing below —
 * and then adds breathing room so no pin ends up on the frame's edge.
 *
 * The right side additionally clears the zoom control. That floor is kept
 * whatever the breathing room works out to: no pin's graphic may reach the
 * buttons, because its right edge sits at `right - PIN_SIDE_PX` from the frame
 * and the control reaches CONTROL_INSET_PX in. Pinned by a test, because the
 * arithmetic is the fix.
 *
 * Scope, stated so it is not read as more than it is: this clears the ZOOM
 * CONTROL. It does not clear the "Map your trip" CTA panel, which is ~240px
 * wide and renders over the map whenever `canSeeItinerary` is false while pins
 * still draw beneath it. That overlap predates this module and is not addressed
 * here.
 */
export function dayFitPadding(viewport: Viewport): FitPadding {
  const slackY = Math.max(MARGIN_PX, Math.round(BREATHING_FRACTION * viewport.height));
  const slackX = Math.max(MARGIN_PX, Math.round(BREATHING_FRACTION * viewport.width));

  const padding: FitPadding = {
    top: PIN_ABOVE_PX + slackY,
    bottom: slackY,
    left: PIN_SIDE_PX + slackX,
    right: Math.max(CONTROL_INSET_PX + PIN_SIDE_PX + CONTROL_CLEARANCE_PX, PIN_SIDE_PX + slackX),
  };

  // Shrink an axis proportionally when it would swallow its own canvas, so the
  // box handed to mapbox stays strictly positive. Both sides scale together:
  // the ratio between them is what keeps the marker centred on what it points
  // at, and a canvas this small has no room for the control clearance anyway.
  const [top, bottom] = clampAxis(padding.top, padding.bottom, viewport.height);
  const [left, right] = clampAxis(padding.left, padding.right, viewport.width);
  return { top, bottom, left, right };
}

// Returned as a pair rather than a keyed object so the caller builds the padding
// as a plain literal: four named keys TypeScript checks, instead of a spread of
// computed keys it has to be told to trust.
function clampAxis(a: number, b: number, extent: number): [number, number] {
  const budget = extent * MAX_PADDING_FRACTION;
  const total = a + b;
  const scale = total > budget ? budget / total : 1;
  // Flooring can only shrink, so `a + b <= budget` survives it, and both inputs
  // are positive with scale in (0,1] — no side can come out negative.
  return [Math.floor(a * scale), Math.floor(b * scale)];
}

export { CONTROL_INSET_PX };

// A lone pin has no bounds to fit, so it gets a fixed zoom. 13 shows roughly
// the surrounding neighbourhood — enough to place it against a coastline.
export const SINGLE_PIN_ZOOM = 13;

// Clustered days would otherwise fit to street level, where a traveller loses
// any sense of where on the island they are.
export const DAY_MAX_ZOOM = 14;

export type DayCamera =
  | { kind: 'fit'; bounds: [[number, number], [number, number]]; padding: FitPadding; maxZoom: number }
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
 *
 * `viewport` is the map CANVAS in CSS pixels, not the window: the padding is a
 * share of it, and on this page the bottom panel takes a third of the window's
 * height before the map sees any of it.
 */
export function dayCamera(coords: Coord[], viewport: Viewport): DayCamera | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) {
    return { kind: 'center', center: [coords[0].lng, coords[0].lat], zoom: SINGLE_PIN_ZOOM };
  }
  const lngs = coords.map((c) => c.lng);
  const lats = coords.map((c) => c.lat);
  return {
    kind: 'fit',
    bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    padding: dayFitPadding(viewport),
    maxZoom: DAY_MAX_ZOOM,
  };
}
