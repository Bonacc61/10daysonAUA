// "On your route" suggestions: when the generated day already sends the traveller
// driving out to a far corner of the island, surface a curated food stop that
// sits on that drive — the thing you'd pass anyway. The motivating case: an
// Arikok + Boca Grandi day routes you straight down the south coast through
// Savaneta, right past Zeerover Fish Fry, so Zeerover should be offered.
//
// Geometry is deliberately simple and road-agnostic: we compare the straight-line
// "detour" of stopping at a spot (base→spot→destination) against going direct
// (base→destination). A tiny detour means it's on the way. This is coarse but
// robust, and matches the intuition of "you drive past it" far better than the
// old region-bucket match (Savaneta and Boca Grandi are different buckets).

import { ACTIVITY_COORDS, type Coord } from './coords';

// Representative point for the west-coast resort strip (Eagle / Palm Beach),
// where the large majority of hotels sit — the assumed start of each day's drive.
export const RESORT_ANCHOR: Coord = { lng: -70.0540, lat: 12.5590 };

// A day only earns an en-route food suggestion when its farthest activity is a
// real drive from the resort strip — otherwise it's a stay-near-the-beach day
// and a food detour makes no sense.
const MIN_TRIP_KM = 7;
// A spot counts as "on the way" when stopping there adds at most this much to the
// straight-line trip. Kept generous because real roads wander vs. our straight
// lines, but tight enough that only genuinely-passed spots qualify.
const MAX_DETOUR_KM = 3.5;
// How far along the base→destination drive a spot must sit to count as a real
// "stop on the way out there" rather than a grab-something-before-you-leave spot
// next to the resort. Zeerover on the south run projects ~0.7 of the way to Boca
// Grandi; an Oranjestad snack bar projects ~0.2 (too close to home) and is out.
const MIN_ALONG = 0.45;
const MAX_ALONG = 1.1; // allow slightly past the destination, not a wild overshoot

// Curated food stops that can be offered as an en-route pick. `id` is the card
// inserted into the plan; Zeerover uses the real `zeerovers-fresh-catch` activity
// (rich card + coordinate, so it pins and shows a photo on the Map), the rest are
// curated lunch spots (now given coords in coords.ts + resolved on the Map). The
// coordinate comes from ACTIVITY_COORDS so there's one source of truth; `placeKey`
// collapses a spot and any twin entry to one real-world place (see PLACE_KEY_BY_ID).
type RouteStop = { id: string; coord: Coord; placeKey: string };
const ROUTE_STOPS: RouteStop[] = [
  { id: 'zeerovers-fresh-catch', placeKey: 'zeerover' },     // Savaneta — full activity card
  { id: 'lunch-oniels',          placeKey: 'oniels' },       // San Nicolas
  { id: 'lunch-hadicurari',      placeKey: 'hadicurari' },   // Hadicurari beach, Noord
  { id: 'lunch-pikas-corner',    placeKey: 'pikas' },        // Palm Beach
  { id: 'lunch-don-jacinto',     placeKey: 'don-jacinto' },  // Oranjestad
]
  .map((s) => ({ ...s, coord: ACTIVITY_COORDS[s.id] }))
  .filter((s): s is RouteStop => !!s.coord);

// Map any food-ish plan-card id to its real-world place, so a Zeerover already
// placed as the `zeerovers-fresh-catch` activity blocks the `lunch-zeerover`
// en-route/manual pick (and vice versa).
const PLACE_KEY_BY_ID: Record<string, string> = {
  'zeerovers-fresh-catch': 'zeerover',
  'lunch-zeerover': 'zeerover',
  ...Object.fromEntries(ROUTE_STOPS.map((s) => [s.id, s.placeKey])),
};

export function foodPlaceKey(id: string): string | undefined {
  return PLACE_KEY_BY_ID[id];
}

// Equirectangular km distance — accurate enough for a 30km-wide island.
export function distanceKm(a: Coord, b: Coord): number {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dx = (b.lng - a.lng) * Math.cos(midLat) * 111.32;
  const dy = (b.lat - a.lat) * 110.57;
  return Math.hypot(dx, dy);
}

// Extra km added by stopping at `spot` on the way from `from` to `to`.
export function detourKm(from: Coord, spot: Coord, to: Coord): number {
  return distanceKm(from, spot) + distanceKm(spot, to) - distanceKm(from, to);
}

// Local km-plane offset of `p` from `origin` (equirectangular).
function offsetKm(origin: Coord, p: Coord): { x: number; y: number } {
  const midLat = ((origin.lat + p.lat) / 2) * (Math.PI / 180);
  return { x: (p.lng - origin.lng) * Math.cos(midLat) * 111.32, y: (p.lat - origin.lat) * 110.57 };
}

// Fraction of the way `spot` sits along the `from`→`to` segment (its projection):
// 0 at the start, 1 at the destination, negative behind the start. Used to keep
// near-home spots from counting as en-route stops.
export function routeFraction(from: Coord, to: Coord, spot: Coord): number {
  const b = offsetKm(from, to);
  const p = offsetKm(from, spot);
  const len2 = b.x * b.x + b.y * b.y;
  return len2 === 0 ? 0 : (p.x * b.x + p.y * b.y) / len2;
}

// Choose the best en-route food stop for a day, or null. `dayCoords` are the
// mapped coordinates of the day's planned activities; the destination is the one
// farthest from the resort strip. Returns the least-detour qualifying stop whose
// place key isn't already used on the trip.
export function pickEnRouteStop(
  dayCoords: Coord[],
  usedPlaceKeys: Set<string>,
): { id: string; placeKey: string } | null {
  if (dayCoords.length === 0) return null;
  let dest = dayCoords[0];
  let destKm = distanceKm(RESORT_ANCHOR, dest);
  for (const c of dayCoords) {
    const d = distanceKm(RESORT_ANCHOR, c);
    if (d > destKm) { dest = c; destKm = d; }
  }
  if (destKm < MIN_TRIP_KM) return null; // not a road-trip day

  let best: { id: string; placeKey: string; detour: number } | null = null;
  for (const stop of ROUTE_STOPS) {
    if (usedPlaceKeys.has(stop.placeKey)) continue;
    const along = routeFraction(RESORT_ANCHOR, dest, stop.coord);
    if (along < MIN_ALONG || along > MAX_ALONG) continue; // near home, or past the destination
    const detour = detourKm(RESORT_ANCHOR, stop.coord, dest);
    if (detour > MAX_DETOUR_KM) continue;
    if (!best || detour < best.detour) best = { id: stop.id, placeKey: stop.placeKey, detour };
  }
  return best ? { id: best.id, placeKey: best.placeKey } : null;
}
