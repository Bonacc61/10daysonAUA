import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ITEM_PINS, pinFor, pinPlaces } from './itemCoords';
import {
  inBounds, hasPrecision, pointInRing, kmToRing, distanceKm,
  LAND_TOLERANCE_KM, SEA_TOLERANCE_KM, type Ring,
} from './coordValidate';

const RING: Ring = JSON.parse(readFileSync('tools/aruba-coastline.json', 'utf8')).ring;
const entries = Object.entries(ITEM_PINS);

// Every place every pin covers, flattened. A multi-stop activity's secondary
// coordinates must clear exactly the same bar as its primary — an unchecked
// stop is the easiest place for a bad coordinate to hide.
const places = entries.flatMap(([id, p]) =>
  pinPlaces(p).map((pl, i) => [`${id}${pl.primary ? '' : ` (stop ${i})`}`, pl] as const));

describe('registry integrity', () => {
  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('gives every pin and stop a non-empty citation', () => {
    const uncited = places.filter(([, p]) => !p.cite || p.cite.trim().length === 0);
    expect(uncited.map(([id]) => id)).toEqual([]);
  });

  it('rejects placeholder citations', () => {
    const placeholder = entries.filter(([, p]) => /^(tbd|todo|n\/a|\?+|-)$/i.test(p.cite.trim()));
    expect(placeholder.map(([id]) => id)).toEqual([]);
  });

  it('keeps every pin and stop inside Aruba', () => {
    const out = places.filter(([, p]) => !inBounds(p.coord));
    expect(out.map(([id]) => id)).toEqual([]);
  });

  // A coordinate that rounds to 2 decimals is either a genuine guess or an
  // authored 4-decimal value that happened to land on a round number — JavaScript
  // cannot tell them apart, since -70.0500 === -70.05. Every entry flagged so far
  // has turned out to be a genuine guess (malmok-beach was ~300m off, lunch-oniels
  // ~570m), so the check stays a hard failure with an explicit shrinking allowlist
  // rather than a warning.
  //
  // Task 5 must empty this list. Do not add to it without a research attempt.
  const PENDING_RESEARCH = new Set([
    'lunch-willems-pancakes',  // no OSM record found 2026-08-03; still town-level
  ]);

  it('keeps every pin and stop at 3+ decimal precision', () => {
    const coarse = places
      .filter(([id]) => !PENDING_RESEARCH.has(id))
      .filter(([, p]) => !hasPrecision(p.coord));
    expect(coarse.map(([id]) => id)).toEqual([]);
  });

  it('has an allowlist that only contains entries still marked pending', () => {
    // Stops the allowlist outliving the problem: once an entry is re-researched
    // its cite loses the marker, and this fails until it is removed from the set.
    const stale = [...PENDING_RESEARCH].filter(
      (id) => !ITEM_PINS[id] || !/pending re-research/i.test(ITEM_PINS[id].cite));
    expect(stale).toEqual([]);
  });

  it('keeps every pin and stop on land or within the sea tolerance of shore', () => {
    const bad = places.filter(([, p]) =>
      !pointInRing(p.coord, RING) && kmToRing(p.coord, RING) > SEA_TOLERANCE_KM);
    expect(bad.map(([id]) => id)).toEqual([]);
  });

  it('keeps mainland pins on land or barely offshore', () => {
    // Anything not explicitly marked `offshore` is a mainland place, and a
    // mainland place more than LAND_TOLERANCE_KM out to sea is a research error.
    // Driving this off the pin's own flag rather than a list of exempt ids means
    // new dive sites and islets declare themselves instead of rotting the test.
    const bad = places.filter(([, p]) =>
      !p.offshore
      && !pointInRing(p.coord, RING)
      && kmToRing(p.coord, RING) > LAND_TOLERANCE_KM);
    expect(bad.map(([id]) => id)).toEqual([]);
  });

  it('keeps offshore pins off the mainland but within the sea tolerance', () => {
    // A pin flagged offshore that is actually inland means the flag was copied
    // onto the wrong entry.
    const water = places.filter(([, p]) => p.offshore);
    expect(water.length).toBeGreaterThan(0);
    const bad = water.filter(([, p]) => kmToRing(p.coord, RING) > SEA_TOLERANCE_KM);
    expect(bad.map(([id]) => id)).toEqual([]);
  });

  it('never repeats the primary coordinate as one of its own stops', () => {
    // A duplicated coordinate would draw two markers on top of each other and
    // imply the activity spans somewhere it does not.
    const dupes = entries.filter(([, p]) =>
      (p.stops ?? []).some((s) => s.coord.lng === p.coord.lng && s.coord.lat === p.coord.lat));
    expect(dupes.map(([id]) => id)).toEqual([]);
  });

  it('keeps multi-stop activities plausibly close together', () => {
    // Aruba is ~30km end to end. Stops further apart than that are not one
    // activity, they are a mis-assignment.
    const tooFar = entries.filter(([, p]) =>
      (p.stops ?? []).some((s) => distanceKm(p.coord, s.coord) > 30));
    expect(tooFar.map(([id]) => id)).toEqual([]);
  });

  it('gives every pickup a coordinate inside Aruba', () => {
    const bad = entries.filter(([, p]) => p.pickup && !inBounds(p.pickup.coord));
    expect(bad.map(([id]) => id)).toEqual([]);
  });
});

describe('pinFor', () => {
  it('returns a known curated activity', () => {
    const pin = pinFor('eagle-beach-morning');
    expect(pin?.source).toBe('curated');
    expect(pin?.coord.lat).toBeCloseTo(12.5492, 4);
  });

  it('returns undefined for an unregistered id — never a fallback', () => {
    expect(pinFor('no-such-activity-id')).toBeUndefined();
  });

  it('returns undefined rather than throwing on an empty id', () => {
    expect(pinFor('')).toBeUndefined();
  });
});

describe('curated coverage', () => {
  // Regression fixture: these 29 ids had verified coordinates in the old
  // ACTIVITY_COORDS table and must not silently lose them in the migration.
  const CURATED = [
    'eagle-beach-morning', 'baby-beach-snorkel', 'arikok-hiking',
    'california-lighthouse-sunset', 'flamingo-renaissance', 'boca-catalina-snorkel',
    'antilla-wreck-dive', 'zeerovers-fresh-catch', 'gasparito-restaurant',
    'oranjestad-walking', 'kitesurfing-lesson', 'natural-pool-jeep',
    'malmok-beach', 'tres-trapi', 'manchebo-beach', 'divi-beach',
    'mangel-halto', 'rodgers-beach', 'boca-grandi',
    'lunch-zeerover', 'lunch-oniels', 'lunch-hadicurari', 'lunch-pikas-corner',
    'lunch-don-jacinto', 'lunch-pastechi-house', 'lunch-las-cafeteros',
    'lunch-willems-pancakes', 'lunch-lindas-pancakes', 'lunch-bingo',
  ];

  it('carries all 29 previously-curated coordinates', () => {
    const missing = CURATED.filter((id) => !ITEM_PINS[id]);
    expect(missing).toEqual([]);
  });

  it('preserves the exact coordinates the old table held', () => {
    // Spot-check the extremes of the island — a transposition or a dropped digit
    // during migration would move these visibly.
    expect(ITEM_PINS['california-lighthouse-sunset'].coord).toEqual({ lng: -70.0514, lat: 12.6138 });
    expect(ITEM_PINS['baby-beach-snorkel'].coord).toEqual({ lng: -69.8808, lat: 12.4138 });
    expect(ITEM_PINS['natural-pool-jeep'].coord).toEqual({ lng: -69.9287, lat: 12.5246 });
  });
});
