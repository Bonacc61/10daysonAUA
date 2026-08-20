import { describe, it, expect } from 'vitest';
import {
  dayCamera, dayFitPadding, PIN_ABOVE_PX, PIN_SIDE_PX, SINGLE_PIN_ZOOM, DAY_MAX_ZOOM,
  CONTROL_INSET_PX, CONTROL_CLEARANCE_PX, MARGIN_PX, MAX_PADDING_FRACTION,
} from './mapCamera';

const c = (lng: number, lat: number) => ({ lng, lat });

// The canvas a 1440x900 laptop actually gives the map, measured on the live
// site: 900 less the 70px nav and the 273px bottom panel.
const LAPTOP = { width: 1440, height: 557 };

describe('dayCamera', () => {
  it('draws no camera for a day with no located pins', () => {
    expect(dayCamera([], LAPTOP)).toBeNull();
  });

  it('centres on a lone pin, because a single point has no bounds to fit', () => {
    expect(dayCamera([c(-70.03, 12.55)], LAPTOP)).toEqual({
      kind: 'center', center: [-70.03, 12.55], zoom: SINGLE_PIN_ZOOM,
    });
  });

  // The bug this module was extracted for: every drawn marker has to be inside
  // the box, including the extra stops of a multi-stop tour and the copies
  // `layoutMarkers` fans out when two activities share a coordinate.
  it('bounds every coordinate it is given, in both axes', () => {
    const coords = [c(-70.05, 12.42), c(-69.87, 12.61), c(-70.01, 12.50), c(-69.93, 12.44)];
    const cam = dayCamera(coords, LAPTOP);
    expect(cam?.kind).toBe('fit');
    if (cam?.kind !== 'fit') return;
    const [[w, s], [e, n]] = cam.bounds;
    for (const p of coords) {
      expect(p.lng).toBeGreaterThanOrEqual(w);
      expect(p.lng).toBeLessThanOrEqual(e);
      expect(p.lat).toBeGreaterThanOrEqual(s);
      expect(p.lat).toBeLessThanOrEqual(n);
    }
    // The box is the tightest one that does it — no slack built into the
    // bounds, because the slack belongs in the PADDING where it is expressed
    // in screen pixels and survives a zoom change.
    expect([w, s, e, n]).toEqual([-70.05, 12.42, -69.87, 12.61]);
  });

  it('caps the zoom so a clustered day still shows where on the island it is', () => {
    const cam = dayCamera([c(-70.0400, 12.5600), c(-70.0402, 12.5601)], LAPTOP);
    expect(cam?.kind === 'fit' && cam.maxZoom).toBe(DAY_MAX_ZOOM);
  });

  /**
   * The padding has to clear the MARKER, not the coordinate. `PhotoPin` is
   * anchored bottom, so it hangs 59px above its point and 25px either side —
   * padding that only clears the point clips the photo of any edge pin, which
   * a traveller reads as a pin that is missing rather than a frame that is
   * tight. Asserted per side so a future tweak cannot quietly go under.
   */
  it('pads by more than the pin graphic on every side', () => {
    const cam = dayCamera([c(-70.05, 12.42), c(-69.87, 12.61)], LAPTOP);
    expect(cam?.kind).toBe('fit');
    if (cam?.kind !== 'fit') return;
    expect(cam.padding.top).toBeGreaterThan(PIN_ABOVE_PX);
    expect(cam.padding.left).toBeGreaterThan(PIN_SIDE_PX);
    expect(cam.padding.right).toBeGreaterThan(PIN_SIDE_PX);
    // Nothing is drawn BELOW the coordinate, so the bottom needs margin only —
    // and must not be zero, or the southernmost pin touches the frame.
    expect(cam.padding.bottom).toBeGreaterThan(0);
    expect(cam.padding.bottom).toBeLessThan(cam.padding.top);
  });

  /**
   * The assertion this module exists for, and the one an earlier version of
   * this test got wrong: it checked `top > 90` — the control's HEIGHT alone,
   * ignoring the 59px of marker that also has to fit above the coordinate — so
   * it passed while a pin in the top-right corner was still 39px under the zoom
   * buttons. A test that cannot fail is worse than no test, because it is
   * counted as cover.
   *
   * The real invariant is horizontal: the easternmost pin's RIGHT EDGE sits at
   * `right - PIN_SIDE_PX` from the frame's right edge, and the control reaches
   * CONTROL_INSET_PX in. The first must clear the second, whatever the day's
   * shape, so no pin can ever be both northernmost and under the buttons.
   */
  it('keeps the easternmost pin clear of the zoom control', () => {
    // Asserted at the NARROWEST real device as well as a comfortable one. The
    // clearance is a floor that the small-canvas clamp is allowed to scale
    // down, so checking it only at 1440px would pass while a phone lost it: it
    // survives every canvas width down to 237px and goes negative at 236px,
    // which no shipping device gives the map.
    // Asserted against the FULL floor, not just the inset. `> CONTROL_INSET_PX`
    // alone could not fail: with the floor deleted outright the proportional
    // margin still cleared 44px on its own at both widths, so the test passed
    // against code that had lost the guarantee.
    for (const vp of [LAPTOP, { width: 320, height: 400 }]) {
      const pinRightEdgeFromFrame = dayFitPadding(vp).right - PIN_SIDE_PX;
      expect(pinRightEdgeFromFrame).toBeGreaterThanOrEqual(CONTROL_INSET_PX + CONTROL_CLEARANCE_PX);
    }
  });

  /**
   * Reported 2026-08-20: "the map is too zoomed in by default — I always have
   * to zoom out a bit to see all the pins of that day."
   *
   * Measured on live production before this change, at every viewport from
   * 1920x1080 down to 390x844: the slack above the northernmost pin and below
   * the southernmost was 37px and 36px — i.e. exactly MARGIN_PX, on both
   * edges, on every single day. The camera was framing each day at the
   * tightest zoom the padding would legally allow.
   *
   * Aruba's day routes run north-south and the map canvas is short and wide
   * (1440x557 on a laptop), so the VERTICAL axis always binds; at the same
   * time 1354 of 1440 horizontal pixels sat empty over open sea. A fixed 36px
   * margin is a different amount of breathing room on a 557px canvas than on a
   * 277px one, which is why the margin scales with the canvas now.
   */
  it('leaves breathing room proportional to the canvas, so no pin hugs an edge', () => {
    const cam = dayCamera([c(-70.05, 12.42), c(-69.87, 12.61)], LAPTOP);
    expect(cam?.kind).toBe('fit');
    if (cam?.kind !== 'fit') return;
    // The southernmost pin's slack IS padding.bottom, since nothing draws below
    // a bottom-anchored marker. It must be a real share of the canvas, not 36px.
    expect(cam.padding.bottom).toBeGreaterThan(MARGIN_PX);
    expect(cam.padding.bottom).toBeGreaterThanOrEqual(Math.round(0.1 * LAPTOP.height));
    // Above the northernmost pin's GRAPHIC, same rule.
    expect(cam.padding.top - PIN_ABOVE_PX).toBeGreaterThanOrEqual(Math.round(0.1 * LAPTOP.height));
  });

  it('scales that room with the canvas rather than spending a fixed 36px', () => {
    const tall = dayCamera([c(-70.05, 12.42), c(-69.87, 12.61)], { width: 1440, height: 557 });
    const short = dayCamera([c(-70.05, 12.42), c(-69.87, 12.61)], { width: 1440, height: 277 });
    if (tall?.kind !== 'fit' || short?.kind !== 'fit') throw new Error('expected fits');
    expect(tall.padding.bottom).toBeGreaterThan(short.padding.bottom);
  });

  /**
   * The failure mode the fixed padding could actually produce, as opposed to
   * merely feel tight. On a landscape phone (844x390) the bottom panel leaves
   * the map 47px of height — less than the 131px of vertical padding the old
   * constant demanded. Mapbox got a negative box to fit into and returned a
   * garbage camera: measured on live production, 14 of 14 markers across five
   * days landed OUTSIDE the canvas, most of them several hundred pixels above
   * it. A frame that is merely tight is recoverable by pinching; a frame that
   * throws every pin off the map is not.
   */
  it('never lets the padding swallow the canvas it is padding', () => {
    for (const vp of [{ width: 844, height: 47 }, { width: 320, height: 90 }, { width: 200, height: 40 }]) {
      const cam = dayCamera([c(-70.05, 12.42), c(-69.87, 12.61)], vp);
      if (cam?.kind !== 'fit') throw new Error('expected a fit');
      const vertical = cam.padding.top + cam.padding.bottom;
      const horizontal = cam.padding.left + cam.padding.right;
      expect(vertical).toBeLessThanOrEqual(vp.height * MAX_PADDING_FRACTION);
      expect(horizontal).toBeLessThanOrEqual(vp.width * MAX_PADDING_FRACTION);
      // What that buys: a strictly positive box for mapbox to fit into.
      expect(vp.height - vertical).toBeGreaterThan(0);
      expect(vp.width - horizontal).toBeGreaterThan(0);
    }
  });

});
