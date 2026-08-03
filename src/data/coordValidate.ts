import type { Coord } from './coords';

/**
 * Coordinate sanity checks for the pin registry. Pure and dependency-free.
 *
 * The coastline polygon is passed IN rather than imported, so no polygon data
 * is reachable from app code and none can end up in the client bundle. Only
 * tools/audit-coords.ts and the tests supply one.
 *
 * These catch gross errors — a transposed digit, a flipped sign, a point in the
 * open sea or on another island. They cannot tell you a coordinate is on the
 * wrong beach; only a cited source can do that (see src/data/itemCoords.ts).
 */

export type Ring = [number, number][];

// Aruba's real coastline spans lng -70.0638..-69.8655, lat 12.4118..12.6234
// (OpenStreetMap, see tools/aruba-coastline.json). The bbox adds a small margin
// so legitimate just-offshore points still pass; a test asserts every coastline
// vertex falls inside it.
export const ARUBA_BBOX = { minLng: -70.09, maxLng: -69.85, minLat: 12.39, maxLat: 12.65 };

// How far from the coastline a point may sit before it looks wrong.
//
// LAND_TOLERANCE_KM is not zero because verified beach coordinates routinely sit
// a few metres into the water: baby-beach-snorkel's Wikipedia-sourced point is
// 38m offshore in the lagoon, and for a snorkel activity that is arguably more
// correct than a point on the sand. A strict on-land rule would reject it and
// every coordinate like it.
//
// SEA_TOLERANCE_KM allows genuine offshore sites — the SS Antilla wreck dive is
// legitimately in open water — while still catching a point in the mid-Caribbean.
export const LAND_TOLERANCE_KM = 0.5;
export const SEA_TOLERANCE_KM = 3;

export function inBounds(c: Coord): boolean {
  return c.lng >= ARUBA_BBOX.minLng && c.lng <= ARUBA_BBOX.maxLng
    && c.lat >= ARUBA_BBOX.minLat && c.lat <= ARUBA_BBOX.maxLat;
}

/**
 * A coordinate rounded to fewer than `minDecimals` places (3 ≈ 110m) is a guess
 * wearing the costume of a fact. Both components must clear the bar.
 */
export function hasPrecision(c: Coord, minDecimals = 3): boolean {
  const decimals = (n: number) => {
    const s = String(n);
    const i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
  };
  return decimals(c.lng) >= minDecimals && decimals(c.lat) >= minDecimals;
}

/** Ray casting. `ring` is [lng, lat] pairs with the first point repeated last. */
export function pointInRing(c: Coord, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = (yi > c.lat) !== (yj > c.lat);
    if (straddles && c.lng < ((xj - xi) * (c.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Equirectangular approximation, matching the projection already used in
// src/data/enRoute.ts. Accurate well past what a 30km island needs.
const LAT_KM = 110.574;
const LNG_KM = 111.320 * Math.cos((12.52 * Math.PI) / 180);

export function distanceKm(a: Coord, b: Coord): number {
  const dx = (a.lng - b.lng) * LNG_KM;
  const dy = (a.lat - b.lat) * LAT_KM;
  return Math.hypot(dx, dy);
}

/**
 * Shortest distance from a point to the coastline, measured to the nearest
 * SEGMENT rather than the nearest vertex.
 *
 * Vertex-only was wrong in a way that mattered. The thinned ring has 203
 * vertices with a mean spacing of 361m but a maximum of 1.38km on the west
 * coast — the Eagle/Manchebo stretch where many pins sit. A point exactly on
 * that shoreline measured up to 690m to the nearest vertex, above the 500m land
 * tolerance, so a perfectly correct coordinate could hard-fail and invite
 * someone to "fix" a good number. Measured overestimates before this change:
 * Palm Beach 312m true / 439m reported, De Palm Pier 6m true / 207m reported.
 */
export function kmToRing(c: Coord, ring: Ring): number {
  const px = c.lng * LNG_KM, py = c.lat * LAT_KM;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0] * LNG_KM, ay = ring[j][1] * LAT_KM;
    const bx = ring[i][0] * LNG_KM, by = ring[i][1] * LAT_KM;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Project the point onto the segment, clamped to its ends.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}
