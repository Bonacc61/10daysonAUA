import { describe, it, expect } from 'vitest';
import { pickEnRouteStop, detourKm, distanceKm, foodPlaceKey, RESORT_ANCHOR } from './enRoute';

const BOCA_GRANDI = { lng: -69.8739, lat: 12.4402 };
const ARIKOK = { lng: -69.9265, lat: 12.4988 };
const PALM_BEACH = { lng: -70.0375, lat: 12.5720 };
const CALIFORNIA_LH = { lng: -70.0514, lat: 12.6138 };

describe('enRoute geometry', () => {
  it('measures the resort strip ~near Palm Beach as a short hop', () => {
    expect(distanceKm(RESORT_ANCHOR, PALM_BEACH)).toBeLessThan(3);
  });

  it('stopping at Zeerover on the way to the far south is a tiny detour', () => {
    const zeerover = { lng: -69.9466, lat: 12.4461 };
    expect(detourKm(RESORT_ANCHOR, zeerover, BOCA_GRANDI)).toBeLessThan(2.5);
  });
});

describe('pickEnRouteStop', () => {
  it('offers Zeerover for an Arikok + Boca Grandi day (drives through Savaneta)', () => {
    const pick = pickEnRouteStop([ARIKOK, BOCA_GRANDI], new Set());
    expect(pick?.id).toBe('zeerovers-fresh-catch');
  });

  it('ignores near-home spots — a Boca Grandi day is not "served" by an Oranjestad snack bar', () => {
    // don-jacinto (Oranjestad) sits near the chord but only ~0.2 of the way out,
    // so the route-fraction gate must exclude it in favour of Zeerover.
    const pick = pickEnRouteStop([BOCA_GRANDI], new Set());
    expect(pick?.id).toBe('zeerovers-fresh-catch');
  });

  it('offers nothing on a stay-near-the-resort day', () => {
    expect(pickEnRouteStop([PALM_BEACH], new Set())).toBeNull();
  });

  it('offers nothing when the drive heads the opposite way (north tip)', () => {
    expect(pickEnRouteStop([CALIFORNIA_LH], new Set())).toBeNull();
  });

  it('does not re-offer a place already used on the trip', () => {
    const pick = pickEnRouteStop([BOCA_GRANDI], new Set(['zeerover']));
    expect(pick?.placeKey).not.toBe('zeerover');
  });

  it('returns null for a day with no mapped coordinates', () => {
    expect(pickEnRouteStop([], new Set())).toBeNull();
  });
});

describe('foodPlaceKey', () => {
  it('collapses the Zeerover activity and lunch-spot twins to one place', () => {
    expect(foodPlaceKey('zeerovers-fresh-catch')).toBe('zeerover');
    expect(foodPlaceKey('lunch-zeerover')).toBe('zeerover');
  });

  it('is undefined for a non-food id', () => {
    expect(foodPlaceKey('arikok-hiking')).toBeUndefined();
  });
});
