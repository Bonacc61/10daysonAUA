import { describe, it, expect } from 'vitest';
import {
  dayCamera, DAY_FIT_PADDING, PIN_ABOVE_PX, PIN_SIDE_PX, SINGLE_PIN_ZOOM, DAY_MAX_ZOOM,
} from './mapCamera';

const c = (lng: number, lat: number) => ({ lng, lat });

describe('dayCamera', () => {
  it('draws no camera for a day with no located pins', () => {
    expect(dayCamera([])).toBeNull();
  });

  it('centres on a lone pin, because a single point has no bounds to fit', () => {
    expect(dayCamera([c(-70.03, 12.55)])).toEqual({
      kind: 'center', center: [-70.03, 12.55], zoom: SINGLE_PIN_ZOOM,
    });
  });

  // The bug this module was extracted for: every drawn marker has to be inside
  // the box, including the extra stops of a multi-stop tour and the copies
  // `layoutMarkers` fans out when two activities share a coordinate.
  it('bounds every coordinate it is given, in both axes', () => {
    const coords = [c(-70.05, 12.42), c(-69.87, 12.61), c(-70.01, 12.50), c(-69.93, 12.44)];
    const cam = dayCamera(coords);
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
    const cam = dayCamera([c(-70.0400, 12.5600), c(-70.0402, 12.5601)]);
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
    const cam = dayCamera([c(-70.05, 12.42), c(-69.87, 12.61)]);
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

  it('clears the top-right zoom control, which the pin extent alone does not', () => {
    // 90px of control + margin. A north-coast day's last pin sat under the
    // zoom buttons when the padding was a flat 80 on every side.
    expect(DAY_FIT_PADDING.top).toBeGreaterThan(90);
  });
});
