import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  inBounds, hasPrecision, pointInRing, kmToRing, distanceKm,
  ARUBA_BBOX, LAND_TOLERANCE_KM, SEA_TOLERANCE_KM, type Ring,
} from './coordValidate';

const RING: Ring = JSON.parse(readFileSync('tools/aruba-coastline.json', 'utf8')).ring;

// Reference points, in the style of src/data/enRoute.test.ts.
const ORANJESTAD    = { lng: -70.0270, lat: 12.5240 };  // town centre — land
const ARIKOK        = { lng: -69.9265, lat: 12.4988 };  // national park — land
const EAGLE_BEACH   = { lng: -70.0579, lat: 12.5492 };  // beach — land
const NATURAL_POOL  = { lng: -69.9287, lat: 12.5246 };  // rock pool — land
const BABY_BEACH    = { lng: -69.8808, lat: 12.4138 };  // beach, but ~38m offshore in the lagoon
const ANTILLA_WRECK = { lng: -70.0580, lat: 12.6020 };  // wreck dive — genuinely at sea
const OFFSHORE_WEST = { lng: -70.1200, lat: 12.5400 };  // ~7km out — nothing is here
const CARACAS       = { lng: -66.9036, lat: 10.4806 };  // mainland Venezuela

describe('inBounds', () => {
  it('accepts points on Aruba', () => {
    expect(inBounds(ORANJESTAD)).toBe(true);
    expect(inBounds(ARIKOK)).toBe(true);
    expect(inBounds(BABY_BEACH)).toBe(true);
  });

  it('rejects a mainland coordinate', () => {
    expect(inBounds(CARACAS)).toBe(false);
  });

  it('rejects transposed lat/lng', () => {
    expect(inBounds({ lng: 12.5240, lat: -70.0270 })).toBe(false);
  });

  it('rejects a flipped longitude sign', () => {
    expect(inBounds({ lng: 70.0270, lat: 12.5240 })).toBe(false);
  });

  it('has a bbox that actually contains the real coastline', () => {
    for (const [lng, lat] of RING) {
      expect(lng).toBeGreaterThanOrEqual(ARUBA_BBOX.minLng);
      expect(lng).toBeLessThanOrEqual(ARUBA_BBOX.maxLng);
      expect(lat).toBeGreaterThanOrEqual(ARUBA_BBOX.minLat);
      expect(lat).toBeLessThanOrEqual(ARUBA_BBOX.maxLat);
    }
  });
});

describe('hasPrecision', () => {
  it('accepts a 4-decimal coordinate', () => {
    expect(hasPrecision({ lng: -70.0579, lat: 12.5492 })).toBe(true);
  });

  it('rejects a 1-decimal rounded guess', () => {
    expect(hasPrecision({ lng: -70.0, lat: 12.5 })).toBe(false);
  });

  it('rejects when only one component is coarse', () => {
    expect(hasPrecision({ lng: -70.0579, lat: 12.5 })).toBe(false);
  });
});

describe('pointInRing', () => {
  it('places inland points on land', () => {
    expect(pointInRing(ORANJESTAD, RING)).toBe(true);
    expect(pointInRing(ARIKOK, RING)).toBe(true);
    expect(pointInRing(EAGLE_BEACH, RING)).toBe(true);
    expect(pointInRing(NATURAL_POOL, RING)).toBe(true);
  });

  it('places open-sea points in the water', () => {
    expect(pointInRing(OFFSHORE_WEST, RING)).toBe(false);
    expect(pointInRing(ANTILLA_WRECK, RING)).toBe(false);
  });
});

describe('kmToRing', () => {
  // Baby Beach's verified coordinate sits ~38m into the lagoon. A strict
  // on-land rule would false-fail it — and every other beach or snorkel spot
  // whose point is a few metres offshore. This is why the rule is a tolerance.
  it('puts the Baby Beach coordinate just barely offshore', () => {
    expect(pointInRing(BABY_BEACH, RING)).toBe(false);
    expect(kmToRing(BABY_BEACH, RING)).toBeLessThan(LAND_TOLERANCE_KM);
  });

  it('puts a wreck dive offshore but within the sea tolerance', () => {
    expect(kmToRing(ANTILLA_WRECK, RING)).toBeLessThan(SEA_TOLERANCE_KM);
  });

  it('puts an open-sea point beyond the sea tolerance', () => {
    expect(kmToRing(OFFSHORE_WEST, RING)).toBeGreaterThan(SEA_TOLERANCE_KM);
  });
});

describe('distanceKm', () => {
  it('measures the island end-to-end as roughly 30km', () => {
    const CALIFORNIA_LH = { lng: -70.0514, lat: 12.6138 };
    const d = distanceKm(CALIFORNIA_LH, BABY_BEACH);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(35);
  });

  it('is symmetric', () => {
    expect(distanceKm(ORANJESTAD, ARIKOK)).toBeCloseTo(distanceKm(ARIKOK, ORANJESTAD), 9);
  });

  it('is zero for a point against itself', () => {
    expect(distanceKm(ARIKOK, ARIKOK)).toBe(0);
  });
});
