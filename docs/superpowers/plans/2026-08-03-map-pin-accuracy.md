# Map Pin Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every map pin sits on the real-world spot its activity takes place, traceable to a cited source, or no pin is drawn at all.

**Architecture:** Coordinates are researched once, offline, per item, and written to a committed registry (`src/data/itemCoords.ts`). The app reads static data — nothing resolves at runtime. A validator module plus an audit script (`npm run audit:coords`) enforce bounds, land/sea, precision, citation, and coverage over the plannable pool. The invented `GROUP_COORDS` centroids are deleted from both the map and the matching engine.

**Tech Stack:** React 19 + TypeScript + Vite, vitest, mapbox-gl / react-map-gl, Supabase edge functions (Deno), esbuild-bundled Node tools under `tools/`.

## Global Constraints

- Viator affiliate params (`pid=P00302487&mcid=42383`, `medium`) must survive any URL rewrite.
- `SERVICE_ROLE_KEY` must never appear in client code. `VITE_SUPABASE_ANON_KEY` is public and fine.
- Supabase RLS stays enabled on all tables. This plan adds no tables.
- No new data collection — no PostHog events, no Supabase inserts, no new personal data. Therefore no Privacy Policy change is required.
- localStorage key contracts are unchanged: `10doa:answers`, `10doa:starred`, `10doa:booked`, `10doa:analytics-consent`, `aruba.session`, `qDone`.
- The `SlotEntry` shape (`{ kind, id }` | `{ kind, groupId, bestSellerId }`) is unchanged. No storage migration.
- Every coordinate that ships carries a non-empty `cite`. Enforced by test, not convention.
- Marker displacement (`Map.tsx:180-192`, `R = 0.0016`) is **retained** — it is presentation-only and must be applied last, never feeding the registry, validators, route line, or engine.
- Run `/code-review` before pushing to `main`. Pushing to `main` deploys to production; there is no staging gate.
- Tests: vitest, colocated as `src/data/*.test.ts`, using `describe` / `it` / `expect` imported from `vitest`.

---

## File Structure

**Created:**
- `src/data/itemCoords.ts` — the registry. `Pin` type + `ITEM_PINS` record. The single source of pin truth. Pure data plus one lookup function.
- `src/data/coordValidate.ts` — pure validation predicates. Takes a coastline polygon as a *parameter* so no polygon is ever imported by app code and none can reach the client bundle.
- `src/data/coordValidate.test.ts` — validator unit tests.
- `src/data/itemCoords.test.ts` — registry integrity tests (citation present, bounds, land/sea, collisions).
- `tools/aruba-coastline.json` — simplified island polygon, audit-time only.
- `tools/places.ts` — Aruba place table used for authoring proposals. Never shipped.
- `tools/resolve-coords.ts` — the one-off proposal tool.
- `tools/audit-coords.ts` — the CI-gated audit.
- `tools/run-audit.cjs` — esbuild runner that bakes env, mirroring `tools/run-trace.cjs`.
- `docs/map/viator-location-probe.md` — probe findings.

**Modified:**
- `src/data/coords.ts` — `ACTIVITY_COORDS` / `VIATOR_ITEM_COORDS` / `GROUP_COORDS` deleted; re-exports `Coord` and exposes `pinForEntry`.
- `src/pages/Map.tsx:7,29-32` — duplicate `coordFor` deleted; reads registry; route line on true coords; popup gains pickup block.
- `src/data/itineraryGenerator.ts:26,567-571,1424` — `entryCoord` / `coordForEntry` repointed at the registry.
- `src/data/enRoute.ts:13,48` — reads registry instead of `ACTIVITY_COORDS`.
- `src/data/e2e-engine.test.ts:13,52`, `src/data/itineraryGenerator.test.ts:9,894,921` — updated to the registry.
- `supabase/functions/viator-cards/index.ts` — temporary read-only `op=locations` probe.
- `supabase/functions/viator-cards/normalize.ts:4-25` — `ViatorProduct` gains `logistics` / `itinerary`.
- `package.json` — `audit:coords` script.

---

### Task 1: Probe Viator location data

Read-only spike. Everything downstream depends on what Viator actually returns, and the API key lives in Supabase env, not locally — so the probe runs as an edge-function op, mirroring the existing temporary `op=counts` at `index.ts:101-110`.

**Files:**
- Modify: `supabase/functions/viator-cards/normalize.ts:4-25`
- Modify: `supabase/functions/viator-cards/index.ts` (add op near the existing `op=counts` block)
- Create: `docs/map/viator-location-probe.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/map/viator-location-probe.md`, documenting which of `itinerary.items[].pointOfInterestLocation.location.ref`, `logistics.start[].location.ref`, and `/locations/bulk` actually exist, and what share of products carry POI data. Task 4 reads this to decide whether `viator-poi` is a real source tier or a dead one.

- [ ] **Step 1: Extend the product type with the fields we want to inspect**

In `supabase/functions/viator-cards/normalize.ts`, add to the `ViatorProduct` type (after `tags?: number[];`):

```ts
  logistics?: {
    start?: Array<{ location?: { ref?: string } }>;
    end?: Array<{ location?: { ref?: string } }>;
    travelerPickup?: { allowCustomTravelerPickup?: boolean; locations?: Array<{ location?: { ref?: string } }> };
  };
  itinerary?: {
    itineraryType?: string;
    items?: Array<{ pointOfInterestLocation?: { location?: { ref?: string } } }>;
  };
```

- [ ] **Step 2: Add a `/locations/bulk` client call**

In `supabase/functions/viator-cards/viator.ts`, after `getProduct`:

```ts
export type ViatorLocation = {
  reference: string;
  provider?: string;
  name?: string;
  address?: { street?: string; city?: string; country?: string };
  center?: { latitude: number; longitude: number };
};

// Resolve location refs (from logistics / itinerary) to coordinates.
// Viator caps this endpoint at 500 refs per call.
export async function getLocationsBulk(refs: string[]): Promise<ViatorLocation[]> {
  if (refs.length === 0) return [];
  const r = await fetch(`${BASE}/locations/bulk`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ locations: refs.slice(0, 500) }),
  });
  if (!r.ok) throw new Error(`Viator locations ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const body = await r.json();
  return body?.locations ?? [];
}
```

- [ ] **Step 3: Add the temporary probe op**

In `supabase/functions/viator-cards/index.ts`, import `getLocationsBulk` alongside the existing viator imports, then add immediately after the `op === 'counts'` block (~line 110):

```ts
  // TEMPORARY: dump raw logistics/itinerary for a handful of products so the
  // pin-accuracy work can confirm what location data Viator actually returns.
  if (op === 'locations') {
    const codes = (url.searchParams.get('codes') ?? '').split(',').filter(Boolean);
    const out: Record<string, unknown> = {};
    const refs = new Set<string>();
    for (const code of codes) {
      try {
        const p = await getProduct(code);
        const poi = (p.itinerary?.items ?? [])
          .map((i) => i.pointOfInterestLocation?.location?.ref).filter(Boolean) as string[];
        const start = (p.logistics?.start ?? [])
          .map((s) => s.location?.ref).filter(Boolean) as string[];
        [...poi, ...start].forEach((r) => refs.add(r));
        out[code] = { title: p.title, itineraryType: p.itinerary?.itineraryType, poi, start };
      } catch (e) { out[code] = { error: String(e) }; }
    }
    let resolved: unknown = null;
    try { resolved = await getLocationsBulk([...refs]); } catch (e) { resolved = String(e); }
    return json({ products: out, resolved });
  }
```

- [ ] **Step 4: Deploy the function and run the probe**

```bash
npx supabase functions deploy viator-cards
```

Pick 20 real product codes spanning the catalog. `src/data/coords.ts` already lists live ids to start from — use these, which cover jeep tours and bus tours:

```bash
CODES='6841POOL,6841P7,6841ISLAND,2455NPJEEP,441143P1,441143P8,358826P1,39473P4,47774P4,300281P9,6593P16,137607P17,137607P20,5629889P1,324189P4,446074P1,139296P2,139296P3,6593P17,47774P1'
FN=$(grep '^VITE_VIATOR_FN_URL=' .env.production | cut -d= -f2-)
KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' .env.production | cut -d= -f2-)
curl -s "$FN?op=locations&codes=$CODES" -H "Authorization: Bearer $KEY" | tee /tmp/probe.json | head -60
```

Expected: JSON with a `products` map and a `resolved` array. Either shape is a valid result — the point is to learn the truth.

- [ ] **Step 5: Write up the findings**

Create `docs/map/viator-location-probe.md` recording, with real numbers from `/tmp/probe.json`:

- How many of the 20 products returned a non-empty `poi` array.
- How many returned a non-empty `start` array.
- Whether `resolved` contains `center.latitude` / `center.longitude` for those refs.
- A verdict line: **"`viator-poi` is a usable source tier: YES/NO"** and **"`departure` (pickup) data is available: YES/NO"**.

If POI data is absent, say so plainly — Task 4 then skips tier 1 and leans on the place table, and Task 9's pickup block renders its "Pickup unknown" case more often. The design survives either answer.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/viator-cards/normalize.ts supabase/functions/viator-cards/viator.ts supabase/functions/viator-cards/index.ts docs/map/viator-location-probe.md
git commit -m "feat(viator): read-only probe for product location data

Temporary op=locations dumps logistics/itinerary refs and resolves them via
/locations/bulk, so the pin-accuracy work can confirm what Viator returns
before designing around it."
```

---

### Task 2: Coordinate validators

Pure predicates with no I/O. The coastline polygon is passed **in** as a parameter so app code never imports it and it can never reach the client bundle.

**Files:**
- Create: `tools/aruba-coastline.json`
- Create: `src/data/coordValidate.ts`
- Test: `src/data/coordValidate.test.ts`

**Interfaces:**
- Consumes: `Coord` from `src/data/coords.ts` (`{ lng: number; lat: number }`).
- Produces:
  - `ARUBA_BBOX: { minLng: number; maxLng: number; minLat: number; maxLat: number }`
  - `type Ring = [number, number][]`
  - `inBounds(c: Coord): boolean`
  - `hasPrecision(c: Coord, minDecimals?: number): boolean`
  - `pointInRing(c: Coord, ring: Ring): boolean`
  - `distanceKm(a: Coord, b: Coord): number`
  - `kmToRing(c: Coord, ring: Ring): number`

- [ ] **Step 1: Fetch a real Aruba coastline polygon**

Do not hand-write coordinates.

**Do not use Nominatim.** Its `Aruba` result is the *administrative* boundary,
which includes territorial waters and spans lng `-70.27..-69.66`, lat
`12.26..12.82` — far beyond the island. A land/sea test against it calls the
open sea "land". Use the OSM island relation via Overpass instead:

```bash
mkdir -p tools
cat > /tmp/q.overpass <<'EOF'
[out:json][timeout:90];
rel["place"="island"]["name"="Aruba"];
out geom;
EOF
curl -s -X POST --data-binary @/tmp/q.overpass https://overpass-api.de/api/interpreter -o /tmp/aruba-island.json
node -e '
const rel = require("/tmp/aruba-island.json").elements[0];
// Stitch the relation'"'"'s ways into one closed ring.
const ways = rel.members.filter(m => m.type === "way" && m.geometry).map(m => m.geometry.map(p => [p.lon, p.lat]));
let ring = ways.shift(), guard = 0;
while (ways.length && guard++ < 5000) {
  const tail = ring[ring.length - 1];
  let i = ways.findIndex(w => w[0][0] === tail[0] && w[0][1] === tail[1]);
  if (i >= 0) { ring = ring.concat(ways.splice(i,1)[0].slice(1)); continue; }
  i = ways.findIndex(w => w[w.length-1][0] === tail[0] && w[w.length-1][1] === tail[1]);
  if (i >= 0) { ring = ring.concat(ways.splice(i,1)[0].reverse().slice(1)); continue; }
  break;
}
const step = Math.max(1, Math.floor(ring.length / 200));
let out = ring.filter((_, i) => i % step === 0);
if (out[0][0] !== out[out.length-1][0] || out[0][1] !== out[out.length-1][1]) out.push(out[0]);
require("fs").writeFileSync("tools/aruba-coastline.json", JSON.stringify({
  source: "OpenStreetMap relation place=island name=Aruba, via Overpass API",
  query: "[out:json];rel[\"place\"=\"island\"][\"name\"=\"Aruba\"];out geom;",
  fetched: new Date().toISOString().slice(0,10),
  note: "Coastline of the island landmass, NOT the Nominatim country boundary (which includes territorial waters). Thinned for a land/sea sanity check, not for cartography.",
  ring: out,
}));
const lngs = out.map(p=>p[0]), lats = out.map(p=>p[1]);
console.log("vertices:", out.length);
console.log("extent lng:", Math.min(...lngs).toFixed(4), "->", Math.max(...lngs).toFixed(4));
console.log("extent lat:", Math.min(...lats).toFixed(4), "->", Math.max(...lats).toFixed(4));
'
```

Expected: ~203 vertices, lng extent about `-70.0638 -> -69.8655`, lat about
`12.4118 -> 12.6234`. If the extent is much wider you have the territorial-waters
polygon, not the coastline.

**Note on tolerances, discovered here:** `baby-beach-snorkel`'s verified
coordinate sits **38 m offshore** in the lagoon, confirmed against the
full-resolution 8667-vertex ring — it is not a thinning artefact. Verified beach
and snorkel coordinates routinely sit slightly in the water, and for a snorkel
activity that is arguably more correct than a point on the sand. So the land/sea
rule is a *tolerance*, not a binary: `LAND_TOLERANCE_KM = 0.5` for ordinary
places, `SEA_TOLERANCE_KM = 3` for genuine offshore sites like the SS Antilla
wreck.

- [ ] **Step 2: Write the failing tests**

Create `src/data/coordValidate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inBounds, hasPrecision, pointInRing, kmToRing, distanceKm, type Ring } from './coordValidate';

const RING: Ring = JSON.parse(readFileSync('tools/aruba-coastline.json', 'utf8')).ring;

// Known-good reference points, same style as src/data/enRoute.test.ts
const ORANJESTAD    = { lng: -70.0270, lat: 12.5240 };  // town centre — land
const ARIKOK        = { lng: -69.9265, lat: 12.4988 };  // national park — land
const OFFSHORE_WEST = { lng: -70.1200, lat: 12.5400 };  // ~7km out to sea
const ANTILLA_WRECK = { lng: -70.0580, lat: 12.6020 };  // dive site — in water, near shore
const CARACAS       = { lng: -66.9036, lat: 10.4806 };  // mainland Venezuela — far outside

describe('inBounds', () => {
  it('accepts points on Aruba', () => {
    expect(inBounds(ORANJESTAD)).toBe(true);
    expect(inBounds(ARIKOK)).toBe(true);
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
  it('places Oranjestad on land', () => {
    expect(pointInRing(ORANJESTAD, RING)).toBe(true);
  });

  it('places Arikok on land', () => {
    expect(pointInRing(ARIKOK, RING)).toBe(true);
  });

  it('places an offshore point in the sea', () => {
    expect(pointInRing(OFFSHORE_WEST, RING)).toBe(false);
  });
});

describe('kmToRing', () => {
  it('puts a near-shore wreck within 3km of the coastline', () => {
    expect(kmToRing(ANTILLA_WRECK, RING)).toBeLessThan(3);
  });

  it('puts a far-offshore point well beyond 3km', () => {
    expect(kmToRing(OFFSHORE_WEST, RING)).toBeGreaterThan(3);
  });
});

describe('distanceKm', () => {
  it('measures the island end-to-end as roughly 30km', () => {
    const NW = { lng: -70.0514, lat: 12.6138 };  // California Lighthouse
    const SE = { lng: -69.8808, lat: 12.4138 };  // Baby Beach
    const d = distanceKm(NW, SE);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(35);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/data/coordValidate.test.ts`
Expected: FAIL — `Failed to resolve import "./coordValidate"`.

- [ ] **Step 4: Implement the validators**

Create `src/data/coordValidate.ts`:

```ts
import type { Coord } from './coords';

/**
 * Coordinate sanity checks for the pin registry. Pure and dependency-free.
 *
 * The coastline polygon is passed IN rather than imported, so no polygon data
 * is ever reachable from app code and none can end up in the client bundle.
 * Only tools/audit-coords.ts and the tests supply one.
 */

export type Ring = [number, number][];

// Aruba's extent with a small margin: the island spans roughly
// 12.41-12.63 N and 69.87-70.06 W. Anything outside is a data error,
// not a place on Aruba.
export const ARUBA_BBOX = { minLng: -70.09, maxLng: -69.85, minLat: 12.39, maxLat: 12.65 };

export function inBounds(c: Coord): boolean {
  return c.lng >= ARUBA_BBOX.minLng && c.lng <= ARUBA_BBOX.maxLng
    && c.lat >= ARUBA_BBOX.minLat && c.lat <= ARUBA_BBOX.maxLat;
}

// A coordinate rounded to fewer than 3 decimals (~110m) is a guess wearing the
// costume of a fact. Both components must clear the bar.
export function hasPrecision(c: Coord, minDecimals = 3): boolean {
  const decimals = (n: number) => {
    const s = String(n);
    const i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
  };
  return decimals(c.lng) >= minDecimals && decimals(c.lat) >= minDecimals;
}

// Standard ray casting. `ring` is [lng, lat] pairs, first point repeated last.
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

// Equirectangular approximation — accurate well past what a 30km island needs,
// and it matches the projection already used in src/data/enRoute.ts.
const LAT_KM = 110.574;
const LNG_KM = 111.320 * Math.cos((12.52 * Math.PI) / 180);

export function distanceKm(a: Coord, b: Coord): number {
  const dx = (a.lng - b.lng) * LNG_KM;
  const dy = (a.lat - b.lat) * LAT_KM;
  return Math.hypot(dx, dy);
}

// Shortest distance from a point to the coastline, measured to ring vertices.
// Vertex-only is sufficient at ~200 vertices around a 30km island (segments are
// short relative to the 3km tolerance it feeds).
export function kmToRing(c: Coord, ring: Ring): number {
  let best = Infinity;
  for (const [lng, lat] of ring) {
    const d = distanceKm(c, { lng, lat });
    if (d < best) best = d;
  }
  return best;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/coordValidate.test.ts`
Expected: PASS, 13 tests.

If `pointInRing(ARIKOK)` fails, the polygon fetch grabbed an offshore islet — re-run Step 1 and confirm the vertex count is in range.

- [ ] **Step 6: Commit**

```bash
git add tools/aruba-coastline.json src/data/coordValidate.ts src/data/coordValidate.test.ts
git commit -m "feat(coords): coordinate validators with real Aruba coastline

Bounds, precision, point-in-polygon and distance-to-coast checks. The polygon
is injected rather than imported so it never reaches the client bundle."
```

---

### Task 3: Registry types + migrate the 29 curated activities

Establishes the registry shape and moves existing hand-verified coordinates into it, keeping their citations. `GROUP_COORDS` is not deleted yet — Task 7 does that, once consumers are repointed.

**Files:**
- Create: `src/data/itemCoords.ts`
- Test: `src/data/itemCoords.test.ts`
- Read for reference: `src/data/coords.ts:5-51`

**Interfaces:**
- Consumes: `Coord` from `src/data/coords.ts`; validators from Task 2.
- Produces:
  - `type PinSource = 'viator-poi' | 'known-place' | 'departure' | 'curated'`
  - `type Pickup = { coord: Coord; name: string; time?: string }`
  - `type Pin = { coord: Coord; source: PinSource; cite: string; place?: string; pickup?: Pickup }`
  - `const ITEM_PINS: Record<string, Pin>`
  - `pinFor(id: string): Pin | undefined`

- [ ] **Step 1: Write the failing tests**

Create `src/data/itemCoords.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ITEM_PINS, pinFor } from './itemCoords';
import { inBounds, hasPrecision, pointInRing, kmToRing, type Ring } from './coordValidate';

const RING: Ring = JSON.parse(readFileSync('tools/aruba-coastline.json', 'utf8')).ring;
const entries = Object.entries(ITEM_PINS);

describe('registry integrity', () => {
  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('gives every pin a non-empty citation', () => {
    const uncited = entries.filter(([, p]) => !p.cite || p.cite.trim().length === 0);
    expect(uncited.map(([id]) => id)).toEqual([]);
  });

  it('rejects placeholder citations', () => {
    const placeholder = entries.filter(([, p]) => /^(tbd|todo|n\/a|\?+)$/i.test(p.cite.trim()));
    expect(placeholder.map(([id]) => id)).toEqual([]);
  });

  it('keeps every pin inside Aruba', () => {
    const out = entries.filter(([, p]) => !inBounds(p.coord));
    expect(out.map(([id]) => id)).toEqual([]);
  });

  it('keeps every pin at 3+ decimal precision', () => {
    const coarse = entries.filter(([, p]) => !hasPrecision(p.coord));
    expect(coarse.map(([id]) => id)).toEqual([]);
  });

  it('keeps every pin on land or within 3km of shore', () => {
    const bad = entries.filter(([, p]) => !pointInRing(p.coord, RING) && kmToRing(p.coord, RING) > 3);
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
});

describe('curated coverage', () => {
  // Regression fixture: these 29 ids had verified coordinates before the
  // registry existed and must not silently lose them.
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/itemCoords.test.ts`
Expected: FAIL — `Failed to resolve import "./itemCoords"`.

- [ ] **Step 3: Create the registry**

Create `src/data/itemCoords.ts`. Copy every coordinate verbatim from `src/data/coords.ts:6-51` — do not retype digits — and lift each existing trailing comment into `cite`.

```ts
import type { Coord } from './coords';

/**
 * The pin registry — the single source of truth for where an activity happens.
 *
 * Coordinates are researched ONCE, offline, per item (tools/resolve-coords.ts)
 * and committed here. Nothing resolves at runtime. Because the data is static
 * and committed, any coordinate change appears in a normal diff and goes through
 * /code-review — the registry is its own audit baseline.
 *
 * An id absent from ITEM_PINS draws NO PIN. That is a supported state, not a
 * gap: Map.tsx keeps the card in the photo strip and simply omits the marker.
 * There is deliberately no fallback coordinate anywhere in the codebase.
 */

export type PinSource =
  | 'viator-poi'    // Viator itinerary point-of-interest — authoritative
  | 'known-place'   // named Aruba place, cited
  | 'departure'     // no fixed destination; this IS where it happens
  | 'curated';      // hand-verified editorial activity

export type Pickup = { coord: Coord; name: string; time?: string };

export type Pin = {
  coord: Coord;
  source: PinSource;
  cite: string;      // REQUIRED — a reference a human can check. Enforced by test.
  place?: string;    // human-readable place name, shown on the card
  pickup?: Pickup;
};

export const ITEM_PINS: Record<string, Pin> = {
  // ── Curated editorial activities ──────────────────────────────────────────
  'eagle-beach-morning':          { coord: { lng: -70.0579, lat: 12.5492 }, source: 'curated', place: 'Eagle Beach',            cite: 'Wikipedia: Beaches of Aruba' },
  'baby-beach-snorkel':           { coord: { lng: -69.8808, lat: 12.4138 }, source: 'curated', place: 'Baby Beach',             cite: 'Wikipedia: Beaches of Aruba' },
  'arikok-hiking':                { coord: { lng: -69.9265, lat: 12.4988 }, source: 'curated', place: 'Arikok National Park',   cite: 'Wikipedia: Arikok National Park / latitude.to' },
  'california-lighthouse-sunset': { coord: { lng: -70.0514, lat: 12.6138 }, source: 'curated', place: 'California Lighthouse',  cite: 'Wikipedia: California Lighthouse infobox' },
  'flamingo-renaissance':         { coord: { lng: -70.0293, lat: 12.5009 }, source: 'curated', place: 'Renaissance Island',     cite: 'latlong.net: Renaissance Island' },
  'boca-catalina-snorkel':        { coord: { lng: -70.0515, lat: 12.6046 }, source: 'curated', place: 'Boca Catalina',          cite: 'Wikipedia: Beaches of Aruba' },
  'antilla-wreck-dive':           { coord: { lng: -70.0580, lat: 12.6020 }, source: 'curated', place: 'SS Antilla wreck',       cite: 'Wikipedia: SS Antilla' },
  'zeerovers-fresh-catch':        { coord: { lng: -69.9466, lat: 12.4461 }, source: 'curated', place: 'Zeerover, Savaneta',     cite: 'Tripexpert / OSM: Savaneta 270A pier' },
  'gasparito-restaurant':         { coord: { lng: -70.0415, lat: 12.5618 }, source: 'curated', place: 'Gasparito, Noord',       cite: 'Mapcarta' },
  'oranjestad-walking':           { coord: { lng: -70.0270, lat: 12.5240 }, source: 'curated', place: 'Oranjestad',             cite: 'latitude.to: Oranjestad' },
  'kitesurfing-lesson':           { coord: { lng: -70.0471, lat: 12.5858 }, source: 'curated', place: 'Hadicurari Beach',       cite: 'Hadicurari Beach — beginner kite lessons' },
  'natural-pool-jeep':            { coord: { lng: -69.9287, lat: 12.5246 }, source: 'curated', place: 'Conchi (Natural Pool)',  cite: 'Wikipedia: Natural Pool (Aruba)' },
  'malmok-beach':                 { coord: { lng: -70.0500, lat: 12.5980 }, source: 'curated', place: 'Malmok Beach',           cite: 'Wikipedia: Malmok / Beaches of Aruba' },
  'tres-trapi':                   { coord: { lng: -70.0555, lat: 12.5579 }, source: 'curated', place: 'Tres Trapi',             cite: 'PADI dive site listing' },
  'manchebo-beach':               { coord: { lng: -70.0580, lat: 12.5402 }, source: 'curated', place: 'Manchebo Beach',         cite: 'Wikipedia: Beaches of Aruba (onshore)' },
  'divi-beach':                   { coord: { lng: -70.0542, lat: 12.5259 }, source: 'curated', place: 'Druif Beach',            cite: 'latitude.to: Druif Beach' },
  'mangel-halto':                 { coord: { lng: -69.9695, lat: 12.4649 }, source: 'curated', place: 'Mangel Halto',           cite: 'Wikipedia: Mangel Halto' },
  'rodgers-beach':                { coord: { lng: -69.8841, lat: 12.4172 }, source: 'curated', place: "Rodger's Beach",         cite: 'Wikipedia: Beaches of Aruba' },
  'boca-grandi':                  { coord: { lng: -69.8739, lat: 12.4402 }, source: 'curated', place: 'Boca Grandi',            cite: 'Wikipedia: Beaches of Aruba' },

  // ── Curated lunch spots (outside the Viator catalog) ──────────────────────
  // NOTE: coords.ts flagged these as "town-level approximations". They are
  // carried over unchanged to keep this task a pure migration; Task 6 re-researches
  // them to real addresses and replaces these citations.
  'lunch-zeerover':         { coord: { lng: -69.9466, lat: 12.4461 }, source: 'curated', place: 'Zeerover, Savaneta',  cite: 'Savaneta pier (migrated from coords.ts; pending re-research)' },
  'lunch-oniels':           { coord: { lng: -69.9086, lat: 12.4300 }, source: 'curated', place: 'San Nicolas',         cite: 'San Nicolas (migrated from coords.ts; pending re-research)' },
  'lunch-hadicurari':       { coord: { lng: -70.0475, lat: 12.5865 }, source: 'curated', place: 'Hadicurari, Noord',   cite: 'Hadicurari beach (migrated from coords.ts; pending re-research)' },
  'lunch-pikas-corner':     { coord: { lng: -70.0375, lat: 12.5720 }, source: 'curated', place: 'Palm Beach',          cite: 'Palm Beach (migrated from coords.ts; pending re-research)' },
  'lunch-don-jacinto':      { coord: { lng: -70.0270, lat: 12.5240 }, source: 'curated', place: 'Oranjestad',          cite: 'Oranjestad (migrated from coords.ts; pending re-research)' },
  'lunch-pastechi-house':   { coord: { lng: -70.0180, lat: 12.5220 }, source: 'curated', place: 'Oranjestad',          cite: 'Oranjestad (migrated from coords.ts; pending re-research)' },
  'lunch-las-cafeteros':    { coord: { lng: -70.0010, lat: 12.5350 }, source: 'curated', place: 'Tanki Leendert',      cite: 'Tanki Leendert (migrated from coords.ts; pending re-research)' },
  'lunch-willems-pancakes': { coord: { lng: -70.0400, lat: 12.5750 }, source: 'curated', place: 'Noord',               cite: 'Noord (migrated from coords.ts; pending re-research)' },
  'lunch-lindas-pancakes':  { coord: { lng: -70.0415, lat: 12.5760 }, source: 'curated', place: 'Noord',               cite: 'Noord (migrated from coords.ts; pending re-research)' },
  'lunch-bingo':            { coord: { lng: -70.0420, lat: 12.5740 }, source: 'curated', place: 'Noord',               cite: 'Noord (migrated from coords.ts; pending re-research)' },
};

/** Look up a pin. Returns undefined — never a fallback — for unregistered ids. */
export function pinFor(id: string): Pin | undefined {
  return ITEM_PINS[id];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/itemCoords.test.ts`
Expected: PASS.

If the land/sea test fails on `antilla-wreck-dive`, that is expected and correct — it is a wreck in open water. Confirm `kmToRing` reports under 3km; if it does the test passes, and if it does not the polygon is wrong, not the coordinate.

- [ ] **Step 5: Commit**

```bash
git add src/data/itemCoords.ts src/data/itemCoords.test.ts
git commit -m "feat(coords): pin registry with the 29 curated activities migrated

Every pin now carries a mandatory citation, enforced by test. pinFor returns
undefined for unregistered ids — there is no fallback coordinate."
```

---

### Task 4: The resolution tool

Proposes pins for catalog items. Proposes only — it writes a review file, never the registry.

**Files:**
- Create: `tools/places.ts`
- Create: `tools/resolve-coords.ts`
- Read for reference: `tools/run-trace.cjs` (the esbuild-runner pattern), `docs/map/viator-location-probe.md` (Task 1)

**Interfaces:**
- Consumes: `ITEM_PINS`, `Pin`, `PinSource` from Task 3; `loadCatalog` / `getCatalog` from `src/data/activitySource`; `isAutoFillExcluded` from `src/data/itemFit`.
- Produces: `tools/places.ts` exporting `type Place = { id: string; name: string; aliases: string[]; coord: Coord; terrain: 'land' | 'water'; cite: string }` and `PLACES: Place[]`; plus `/tmp/coord-proposals.md` and `/tmp/coord-proposals.ts` at runtime.

- [ ] **Step 1: Create the place table**

Create `tools/places.ts`. Seed it from the coordinates already verified in `src/data/itemCoords.ts` — they are cited and reusable as place anchors.

```ts
import type { Coord } from '../src/data/coords';

/**
 * Aruba place table — AUTHORING INPUT ONLY.
 *
 * Used by tools/resolve-coords.ts to propose pins from product titles. This file
 * is never imported by app code and never ships: the registry holds literal
 * coordinates, so the browser needs no matching logic at all.
 *
 * Aliases are matched on word boundaries, longest-first. Keep single generic
 * words ("beach", "pier") OUT of alias lists — they over-match.
 */
export type Place = {
  id: string;
  name: string;
  aliases: string[];
  coord: Coord;
  terrain: 'land' | 'water';
  cite: string;
};

export const PLACES: Place[] = [
  { id: 'natural-pool', name: 'Conchi (Natural Pool)', aliases: ['natural pool', 'conchi', 'natural pools'], coord: { lng: -69.9287, lat: 12.5246 }, terrain: 'land',  cite: 'Wikipedia: Natural Pool (Aruba)' },
  { id: 'arikok',       name: 'Arikok National Park',  aliases: ['arikok', 'national park arikok'],          coord: { lng: -69.9265, lat: 12.4988 }, terrain: 'land',  cite: 'Wikipedia: Arikok National Park' },
  { id: 'baby-beach',   name: 'Baby Beach',            aliases: ['baby beach'],                              coord: { lng: -69.8808, lat: 12.4138 }, terrain: 'land',  cite: 'Wikipedia: Beaches of Aruba' },
  { id: 'eagle-beach',  name: 'Eagle Beach',           aliases: ['eagle beach'],                             coord: { lng: -70.0579, lat: 12.5492 }, terrain: 'land',  cite: 'Wikipedia: Beaches of Aruba' },
  { id: 'palm-beach',   name: 'Palm Beach',            aliases: ['palm beach'],                              coord: { lng: -70.0430, lat: 12.5720 }, terrain: 'land',  cite: 'Wikipedia: Palm Beach, Aruba' },
  { id: 'malmok',       name: 'Malmok Beach',          aliases: ['malmok'],                                  coord: { lng: -70.0500, lat: 12.5980 }, terrain: 'land',  cite: 'Wikipedia: Malmok' },
  { id: 'boca-catalina',name: 'Boca Catalina',         aliases: ['boca catalina'],                           coord: { lng: -70.0515, lat: 12.6046 }, terrain: 'land',  cite: 'Wikipedia: Beaches of Aruba' },
  { id: 'antilla',      name: 'SS Antilla wreck',      aliases: ['antilla', 'antilla wreck'],                coord: { lng: -70.0580, lat: 12.6020 }, terrain: 'water', cite: 'Wikipedia: SS Antilla' },
  { id: 'california-lh',name: 'California Lighthouse', aliases: ['california lighthouse'],                   coord: { lng: -70.0514, lat: 12.6138 }, terrain: 'land',  cite: 'Wikipedia: California Lighthouse' },
  { id: 'oranjestad',   name: 'Oranjestad',            aliases: ['oranjestad'],                              coord: { lng: -70.0270, lat: 12.5240 }, terrain: 'land',  cite: 'latitude.to: Oranjestad' },
  { id: 'san-nicolas',  name: 'San Nicolas',           aliases: ['san nicolas', 'san nicolaas'],             coord: { lng: -69.9086, lat: 12.4300 }, terrain: 'land',  cite: 'Wikipedia: San Nicolaas' },
  { id: 'savaneta',     name: 'Savaneta',              aliases: ['savaneta', 'zeerover', 'zeerovers'],       coord: { lng: -69.9466, lat: 12.4461 }, terrain: 'land',  cite: 'OSM: Savaneta 270A pier' },
  { id: 'mangel-halto', name: 'Mangel Halto',          aliases: ['mangel halto'],                            coord: { lng: -69.9695, lat: 12.4649 }, terrain: 'land',  cite: 'Wikipedia: Mangel Halto' },
  { id: 'tres-trapi',   name: 'Tres Trapi',            aliases: ['tres trapi', 'three steps'],               coord: { lng: -70.0555, lat: 12.5579 }, terrain: 'land',  cite: 'PADI dive site listing' },
  { id: 'boca-grandi',  name: 'Boca Grandi',           aliases: ['boca grandi'],                             coord: { lng: -69.8739, lat: 12.4402 }, terrain: 'land',  cite: 'Wikipedia: Beaches of Aruba' },
  { id: 'hadicurari',   name: 'Hadicurari Beach',      aliases: ['hadicurari', 'fisherman\'s huts'],         coord: { lng: -70.0471, lat: 12.5858 }, terrain: 'land',  cite: 'Hadicurari Beach' },
  { id: 'renaissance',  name: 'Renaissance Island',    aliases: ['renaissance island', 'flamingo beach'],    coord: { lng: -70.0293, lat: 12.5009 }, terrain: 'land',  cite: 'latlong.net: Renaissance Island' },
  { id: 'hooiberg',     name: 'Hooiberg',              aliases: ['hooiberg', 'haystack mountain'],           coord: { lng: -69.9997, lat: 12.5262 }, terrain: 'land',  cite: 'Wikipedia: Hooiberg' },
  { id: 'alto-vista',   name: 'Alto Vista Chapel',     aliases: ['alto vista'],                              coord: { lng: -70.0250, lat: 12.5942 }, terrain: 'land',  cite: 'Wikipedia: Alto Vista Chapel' },
  { id: 'de-palm',      name: 'De Palm Island',        aliases: ['de palm island'],                          coord: { lng: -69.9975, lat: 12.4720 }, terrain: 'land',  cite: 'OSM: De Palm Island' },
];
```

- [ ] **Step 2: Write the proposal tool**

Create `tools/resolve-coords.ts`:

```ts
/**
 * One-off pin proposal tool. PROPOSES ONLY — writes a review file, never the
 * registry. A human reads the proposals, accepts what is defensible, and pastes
 * the accepted block into src/data/itemCoords.ts.
 *
 * Coverage target is the PLANNABLE POOL, not the whole catalog: items the engine
 * can auto-place (isAutoFillExcluded === false AND review_count >= 25). Anything
 * else needs no pin, because the app never suggests it unasked.
 *
 * Run: npm run resolve:coords
 */
import { loadCatalog, getCatalog } from '../src/data/activitySource';
import { isAutoFillExcluded } from '../src/data/itemFit';
import { ITEM_PINS } from '../src/data/itemCoords';
import { PLACES } from './places';
import { writeFileSync } from 'node:fs';

const MIN_REVIEWS = 25;  // mirrors MIN_CHAMPION_REVIEWS in itineraryGenerator.ts:130

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

// Longest alias wins. Two DIFFERENT places matching is ambiguous -> no proposal.
// A guess is never the default; a human must promote it and supply a citation.
function matchPlace(text: string) {
  const t = norm(text);
  const hits = PLACES.flatMap((p) =>
    p.aliases
      .filter((a) => new RegExp(`\\b${norm(a).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))
      .map((a) => ({ place: p, alias: a })),
  );
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.alias.length - a.alias.length);
  const distinct = new Set(hits.map((h) => h.place.id));
  if (distinct.size > 1) return { ambiguous: true as const, hits };
  return { ambiguous: false as const, ...hits[0] };
}

async function main() {
  await loadCatalog();
  const catalog = getCatalog();

  const plannable = catalog.items.filter(
    (i) => !isAutoFillExcluded(i) && (i.review_count ?? 0) >= MIN_REVIEWS,
  );

  const rows: string[] = [];
  const accepted: string[] = [];
  let already = 0, proposed = 0, ambiguous = 0, none = 0;

  for (const item of plannable) {
    if (ITEM_PINS[item.id]) { already++; continue; }

    const byTitle = matchPlace(item.title);
    const byDesc = item.description ? matchPlace(item.description) : null;
    const m = byTitle ?? byDesc;
    const via = byTitle ? 'title' : 'description';

    if (!m) {
      none++;
      rows.push(`| ${item.id} | ${item.title} | — | NO MATCH → no pin | |`);
      continue;
    }
    if (m.ambiguous) {
      ambiguous++;
      const names = [...new Set(m.hits.map((h) => h.place.name))].join(' / ');
      rows.push(`| ${item.id} | ${item.title} | — | AMBIGUOUS (${names}) → no pin | |`);
      continue;
    }

    proposed++;
    const { coord, name, cite } = m.place;
    const link = `https://www.google.com/maps?q=${coord.lat},${coord.lng}`;
    rows.push(`| ${item.id} | ${item.title} | ${name} | via ${via}: "${m.alias}" | [check](${link}) |`);
    accepted.push(
      `  '${item.id}': { coord: { lng: ${coord.lng}, lat: ${coord.lat} }, ` +
      `source: 'known-place', place: '${name.replace(/'/g, "\\'")}', ` +
      `cite: '${cite.replace(/'/g, "\\'")}' },  // ${item.title.replace(/\n/g, ' ').slice(0, 60)}`,
    );
  }

  const report = [
    `# Coordinate proposals`, ``,
    `Catalog items: ${catalog.items.length}`,
    `Plannable pool (not auto-fill-excluded, >= ${MIN_REVIEWS} reviews): ${plannable.length}`,
    `Already registered: ${already}`,
    `Proposed: ${proposed}`,
    `Ambiguous (no pin): ${ambiguous}`,
    `No match (no pin): ${none}`, ``,
    `Review every row. Verify the coordinate against the map link before accepting.`,
    `Reject anything you cannot defend — an unregistered item simply draws no pin.`, ``,
    `| id | title | proposed place | basis | verify |`,
    `|---|---|---|---|---|`,
    ...rows,
  ].join('\n');

  writeFileSync('/tmp/coord-proposals.md', report);
  writeFileSync('/tmp/coord-proposals.ts', accepted.join('\n') + '\n');

  console.log(report.split('\n').slice(0, 10).join('\n'));
  console.log(`\nWrote /tmp/coord-proposals.md (${rows.length} rows) and /tmp/coord-proposals.ts`);
}

main();
```

- [ ] **Step 3: Add the runner and npm script**

Create `tools/run-resolve.cjs` by copying `tools/run-trace.cjs` and changing only the entry file and outfile:

```bash
sed -e 's#tools/itinerary-trace.ts#tools/resolve-coords.ts#g' \
    -e 's#/tmp/trace.mjs#/tmp/resolve.mjs#g' \
    tools/run-trace.cjs > tools/run-resolve.cjs
grep -n "resolve-coords\|resolve.mjs" tools/run-resolve.cjs
```

Expected: both substitutions appear. Then add to `package.json` scripts, after `"trace"`:

```json
    "resolve:coords": "node tools/run-resolve.cjs",
```

- [ ] **Step 4: Run it against the live catalog**

Run: `npm run resolve:coords`
Expected: a summary printing the plannable-pool size (per `docs/ROADMAP.md` this should land in the low hundreds, well under the ~361 raw catalog), then the two output files.

If the plannable pool comes back as 0, the catalog failed to load — check `.env.production` has `VITE_VIATOR_FN_URL` and `VITE_SUPABASE_ANON_KEY`, exactly as `tools/run-trace.cjs` warns about.

- [ ] **Step 5: Commit the tool (not the output)**

```bash
git add tools/places.ts tools/resolve-coords.ts tools/run-resolve.cjs package.json
git commit -m "feat(tools): one-off pin proposal tool scoped to the plannable pool

Proposes only — writes a review file, never the registry. Ambiguous and
unmatched items get no pin rather than a guess."
```

---

### Task 5: Research and commit the reviewed registry

**This is a human-in-the-loop task.** The tool proposes; a person accepts. Do not automate acceptance and do not paste `/tmp/coord-proposals.ts` in wholesale.

**Files:**
- Modify: `src/data/itemCoords.ts`
- Modify: `tools/places.ts` (add places discovered during review)

**Interfaces:**
- Consumes: `/tmp/coord-proposals.md` and `/tmp/coord-proposals.ts` from Task 4.
- Produces: a populated `ITEM_PINS` covering the plannable pool.

- [ ] **Step 1: Review every proposed row**

Open `/tmp/coord-proposals.md`. For each proposed row, click the verify link and confirm the coordinate is where the title says the activity happens. Accept only what you can defend.

Common rejections to expect:
- A title mentioning a place the tour merely *passes* ("drive past the California Lighthouse").
- A title naming a hotel rather than a destination.

- [ ] **Step 2: Handle the NO MATCH and AMBIGUOUS rows**

For each, decide one of three outcomes:

1. **It has a real destination the place table lacks** → add a `Place` to `tools/places.ts` with a citation, re-run `npm run resolve:coords`.
2. **It has no fixed destination** (sunset cruise, cooking class, spa, bar crawl, party bus) → add it to `ITEM_PINS` by hand with `source: 'departure'`, using the pickup/marina coordinate from the Task 1 probe if available. Cite it as the departure point.
3. **Its location genuinely cannot be determined** → leave it out. It draws no pin. This is a valid, expected outcome.

- [ ] **Step 3: Paste accepted entries into the registry**

Add accepted lines from `/tmp/coord-proposals.ts` into `ITEM_PINS` in `src/data/itemCoords.ts`, under a new comment block:

```ts
  // ── Viator catalog items (resolved 2026-08-03, reviewed) ──────────────────
```

- [ ] **Step 4: Re-research the ten lunch spots**

Replace each `pending re-research` citation from Task 3 with a real address-level coordinate and a checkable citation. These were self-described in `coords.ts` as town-level approximations, and the precision validator's 3-decimal floor does not catch a coordinate that is precise but wrong.

- [ ] **Step 5: Verify the registry passes its own tests**

Run: `npx vitest run src/data/itemCoords.test.ts`
Expected: PASS. Any failure names the offending id — fix that entry, do not relax the test.

- [ ] **Step 6: Commit**

```bash
git add src/data/itemCoords.ts tools/places.ts
git commit -m "feat(coords): populate the pin registry over the plannable pool

Every entry reviewed against its source. Items whose location could not be
determined are deliberately absent and will draw no pin."
```

---

### Task 6: Audit script

**Files:**
- Create: `tools/audit-coords.ts`
- Create: `tools/run-audit.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ITEM_PINS` (Task 3/5), validators (Task 2), `PLACES` (Task 4), `loadCatalog` / `getCatalog`, `isAutoFillExcluded`.
- Produces: `npm run audit:coords`, exiting 1 on any hard violation.

- [ ] **Step 1: Write the audit**

Create `tools/audit-coords.ts`:

```ts
/**
 * Coordinate audit — the ship gate for pin data.
 *
 * Hard failures (exit 1): out of bounds, coarse precision, missing citation,
 * land/sea mismatch, or a plannable item with no pin.
 * Warnings (exit 0): coordinate collisions, churn.
 *
 * Run: npm run audit:coords [-- --json]
 */
import { readFileSync } from 'node:fs';
import { loadCatalog, getCatalog } from '../src/data/activitySource';
import { isAutoFillExcluded } from '../src/data/itemFit';
import { ITEM_PINS } from '../src/data/itemCoords';
import { inBounds, hasPrecision, pointInRing, kmToRing, type Ring } from '../src/data/coordValidate';

const MIN_REVIEWS = 25;          // mirrors MIN_CHAMPION_REVIEWS
const MAX_SHARED_COORD = 3;      // more than this reads as a re-introduced centroid
const RING: Ring = JSON.parse(readFileSync('tools/aruba-coastline.json', 'utf8')).ring;

async function main() {
  const json = process.argv.includes('--json');
  const hard: string[] = [];
  const warn: string[] = [];

  // ---- validate every registry entry ----
  for (const [id, pin] of Object.entries(ITEM_PINS)) {
    if (!pin.cite?.trim())            hard.push(`${id}: missing citation`);
    if (!inBounds(pin.coord))         hard.push(`${id}: outside Aruba bbox (${pin.coord.lng}, ${pin.coord.lat})`);
    if (!hasPrecision(pin.coord))     hard.push(`${id}: coarser than 3 decimals`);
    if (!pointInRing(pin.coord, RING) && kmToRing(pin.coord, RING) > 3)
      hard.push(`${id}: in open water, >3km from shore`);
  }

  // ---- collisions ----
  const byCoord = new Map<string, string[]>();
  for (const [id, pin] of Object.entries(ITEM_PINS)) {
    const k = `${pin.coord.lng.toFixed(5)},${pin.coord.lat.toFixed(5)}`;
    byCoord.set(k, [...(byCoord.get(k) ?? []), id]);
  }
  const collisions = [...byCoord.entries()].filter(([, ids]) => ids.length > MAX_SHARED_COORD);
  for (const [k, ids] of collisions) warn.push(`${ids.length} items share ${k}: ${ids.slice(0, 5).join(', ')}…`);

  // ---- coverage over the plannable pool + churn ----
  await loadCatalog();
  const catalog = getCatalog();
  const plannable = catalog.items.filter(
    (i) => !isAutoFillExcluded(i) && (i.review_count ?? 0) >= MIN_REVIEWS,
  );
  const unpinned = plannable.filter((i) => !ITEM_PINS[i.id]);
  for (const i of unpinned) hard.push(`${i.id}: plannable but has no pin — "${i.title}"`);

  // Curated activities and lunch spots live outside the Viator catalog by design,
  // so absence from catalogIds says nothing about them. Only Viator-sourced pins
  // can go stale.
  const catalogIds = new Set(catalog.items.map((i) => i.id));
  const stale = Object.entries(ITEM_PINS)
    .filter(([id, pin]) => pin.source !== 'curated' && !catalogIds.has(id))
    .map(([id]) => id);
  for (const id of stale) warn.push(`${id}: registered but no longer in catalog — prune`);

  const bySource = Object.values(ITEM_PINS).reduce<Record<string, number>>(
    (acc, p) => ({ ...acc, [p.source]: (acc[p.source] ?? 0) + 1 }), {},
  );

  if (json) {
    console.log(JSON.stringify({ hard, warn, bySource, plannable: plannable.length, pinned: Object.keys(ITEM_PINS).length }, null, 2));
  } else {
    console.log(`\nRegistry: ${Object.keys(ITEM_PINS).length} pins`);
    console.log(`Coverage by source: ${JSON.stringify(bySource)}`);
    console.log(`Plannable pool: ${plannable.length}  ·  unpinned: ${unpinned.length}`);
    if (warn.length) { console.log(`\nWarnings (${warn.length}):`); warn.forEach((w) => console.log(`  ! ${w}`)); }
    if (hard.length) { console.log(`\nFAILURES (${hard.length}):`); hard.forEach((h) => console.log(`  ✗ ${h}`)); }
    else console.log('\nNo hard violations.');
  }

  process.exit(hard.length ? 1 : 0);
}

main();
```

- [ ] **Step 2: Add the runner and script**

```bash
sed -e 's#tools/itinerary-trace.ts#tools/audit-coords.ts#g' \
    -e 's#/tmp/trace.mjs#/tmp/audit.mjs#g' \
    tools/run-trace.cjs > tools/run-audit.cjs
grep -n "audit-coords\|audit.mjs" tools/run-audit.cjs
```

Add to `package.json` scripts:

```json
    "audit:coords": "node tools/run-audit.cjs",
```

- [ ] **Step 3: Run the audit**

Run: `npm run audit:coords`
Expected: exit 0, `No hard violations.` If it lists unpinned plannable items, go back to Task 5 and register them — do not weaken the check.

- [ ] **Step 4: Commit**

```bash
git add tools/audit-coords.ts tools/run-audit.cjs package.json
git commit -m "feat(tools): coordinate audit gate

Hard-fails on bad bounds, coarse precision, missing citation, open-water pins,
or a plannable item with no coordinate. Warns on collisions and churn."
```

---

### Task 7: Repoint every consumer at the registry, delete the fallbacks

**Files:**
- Modify: `src/data/coords.ts`
- Modify: `src/data/itineraryGenerator.ts:26,567-571,1424`
- Modify: `src/data/enRoute.ts:13,48`
- Modify: `src/data/e2e-engine.test.ts:13,52`
- Modify: `src/data/itineraryGenerator.test.ts:9,894,921`

**Interfaces:**
- Consumes: `pinFor` / `ITEM_PINS` (Task 3).
- Produces: `coords.ts` exporting `Coord` and `coordForEntry(e: SlotEntry): Coord | undefined`; `ACTIVITY_COORDS`, `VIATOR_ITEM_COORDS`, `GROUP_COORDS` no longer exist anywhere.

- [ ] **Step 1: Write the failing test**

Append to `src/data/itemCoords.test.ts`:

```ts
import { coordForEntry } from './coords';

describe('coordForEntry', () => {
  it('resolves a curated activity from the registry', () => {
    const c = coordForEntry({ kind: 'activity', id: 'arikok-hiking' });
    expect(c?.lat).toBeCloseTo(12.4988, 4);
  });

  it('returns undefined for an unregistered Viator item — no group fallback', () => {
    const c = coordForEntry({ kind: 'group', groupId: 'sailing-cruises', bestSellerId: 'no-such-item' });
    expect(c).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/itemCoords.test.ts -t "no group fallback"`
Expected: FAIL — currently returns the `sailing-cruises` centroid.

- [ ] **Step 3: Rewrite `src/data/coords.ts`**

Replace the whole file:

```ts
import type { SlotEntry } from '../types';
import { pinFor } from './itemCoords';

export type Coord = { lng: number; lat: number };

/**
 * Coordinate for a planned slot entry, from the pin registry.
 *
 * Returns undefined when the item has no researched coordinate. There is
 * deliberately NO fallback: the old GROUP_COORDS centroids gave ~340 catalog
 * items a coordinate that was invented, which the map drew as fact and the
 * engine treated as geography. Coverage is guaranteed over the plannable pool
 * (see tools/audit-coords.ts), so anything unresolved here is an item the app
 * never suggests unasked.
 */
export function coordForEntry(e: SlotEntry): Coord | undefined {
  const id = e.kind === 'activity' ? e.id : e.bestSellerId;
  return pinFor(id)?.coord;
}
```

- [ ] **Step 4: Repoint the generator**

In `src/data/itineraryGenerator.ts`, change the import at line 26 to:

```ts
import { coordForEntry, type Coord } from './coords';
import { pinFor } from './itemCoords';
```

Replace `entryCoord` (lines 567-571):

```ts
// Coordinate of a candidate, from the pin registry. undefined when the item has
// no researched coordinate — such picks are geographically neutral (no day-
// clustering penalty), exactly as unmapped items have always been.
function entryCoord(e: CardEntry): Coord | undefined {
  return pinFor(e.kind === 'activity' ? e.activity.id : e.bestSeller.id)?.coord;
}
```

Line 1424 (`.map(coordForEntry)`) needs no change — `coordForEntry` keeps its signature.

- [ ] **Step 5: Repoint enRoute**

In `src/data/enRoute.ts`, change line 13 to:

```ts
import { type Coord } from './coords';
import { pinFor } from './itemCoords';
```

and line 48 to:

```ts
  .map((s) => ({ ...s, coord: pinFor(s.id)?.coord }))
```

- [ ] **Step 6: Update the two engine tests**

In `src/data/e2e-engine.test.ts`, replace the import at line 13 with `import { pinFor } from './itemCoords'; import { type Coord } from './coords';` and line 52 with:

```ts
      pinFor(e.kind === 'activity' ? e.id : e.bestSellerId)?.coord;
```

Apply the same substitution in `src/data/itineraryGenerator.test.ts` at lines 9 and 921. At line 894, update the comment — it currently explains intra-day distance in terms of `GROUP_COORDS`:

```ts
  // Each item resolves to its own researched coordinate now (no group centroid),
  // so intra-day distance reflects real geography rather than shared group points.
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS. If a generator test fails on day clustering, do **not** adjust thresholds — record the failure and take it to Task 8's before/after diff, which exists to judge exactly this.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add src/data/coords.ts src/data/itineraryGenerator.ts src/data/enRoute.ts src/data/e2e-engine.test.ts src/data/itineraryGenerator.test.ts src/data/itemCoords.test.ts
git commit -m "refactor(coords): registry is the only coordinate source

Deletes ACTIVITY_COORDS, VIATOR_ITEM_COORDS and the six invented GROUP_COORDS
centroids. The map, the generator and the en-route picker all read one registry;
unresolved items are geographically neutral rather than silently placed."
```

---

### Task 8: Verify itinerary geography did not degrade

The engine's geography changed in Task 7. This task proves the change is an improvement, or catches it if not.

**Files:**
- Create: `docs/map/itinerary-geo-diff.md`
- Read: `tools/itinerary-trace.ts` (personas at lines ~30-37)

**Interfaces:**
- Consumes: `npm run trace` across the five personas.
- Produces: `docs/map/itinerary-geo-diff.md` — a before/after verdict.

- [ ] **Step 1: Capture the "after" traces**

```bash
for p in default foodie adventurer splurge family; do
  npm run trace -- --persona "$p" > "/tmp/trace-after-$p.txt" 2>&1
  echo "$p: $(wc -l < /tmp/trace-after-$p.txt) lines"
done
```

- [ ] **Step 2: Capture the "before" traces from the pre-change commit**

```bash
git stash list  # confirm clean
git worktree add /tmp/before HEAD~1
cd /tmp/before && npm ci --silent
for p in default foodie adventurer splurge family; do
  npm run trace -- --persona "$p" > "/tmp/trace-before-$p.txt" 2>&1
done
cd - && git worktree remove /tmp/before --force
```

- [ ] **Step 3: Diff and judge**

```bash
for p in default foodie adventurer splurge family; do
  echo "=== $p ==="
  diff <(grep -oE '^\s+(morning|afternoon|evening).*' "/tmp/trace-before-$p.txt") \
       <(grep -oE '^\s+(morning|afternoon|evening).*' "/tmp/trace-after-$p.txt") | head -30
done
```

- [ ] **Step 4: Write the verdict**

Create `docs/map/itinerary-geo-diff.md` recording, per persona: how many slots changed, whether any day now spans a visibly larger area, and a one-line verdict.

The bar: **no day whose geographic clustering degraded.** If a day now pairs the north tip with the far south where it previously did not, that item's coordinate is missing from the registry — go back to Task 5 and register it. Do not loosen the clustering constant.

- [ ] **Step 5: Commit**

```bash
git add docs/map/itinerary-geo-diff.md
git commit -m "docs: before/after itinerary geography diff across five personas"
```

---

### Task 9: Map reads the registry; route line on true coordinates

**Files:**
- Modify: `src/pages/Map.tsx:7,29-32,145-199`

**Interfaces:**
- Consumes: `pinFor`, `Pin` (Task 3).
- Produces: `DayEntry` gains `pin: Pin | null`; `AnyPopup` gains `pickup?: Pickup | null` and `place?: string | null`.

- [ ] **Step 1: Delete the duplicate resolver**

In `src/pages/Map.tsx`, replace the import at line 7:

```ts
import { pinFor, type Pin, type Pickup } from '../data/itemCoords';
```

Delete `coordFor` entirely (lines 29-32) and replace with:

```ts
function pinForEntry(entry: SlotEntry): Pin | null {
  return pinFor(entry.kind === 'activity' ? entry.id : entry.bestSellerId) ?? null;
}
```

- [ ] **Step 2: Carry the pin through `DayEntry`**

Change the `DayEntry` type (line 19) — replace `coord: Coord | null` with:

```ts
  coord: Coord | null; pin: Pin | null;
```

and in the `dayEntries` memo (line 158) replace `coord: coordFor(entry),` with:

```ts
        coord: pinForEntry(entry)?.coord ?? null,
        pin: pinForEntry(entry),
```

- [ ] **Step 3: Build the route from TRUE coordinates**

Replace `straightCoords` (lines 196-199). It currently reads `locatedEntries`, which is post-displacement — so two stops at one place produce a ~175m zigzag leg.

```ts
  // Route waypoints come from TRUE coordinates, before marker displacement, with
  // consecutive duplicates dropped. Displacement is a presentation offset only:
  // routing on displaced anchors drew a phantom ~175m leg between stops that are
  // actually at the same place.
  const straightCoords = useMemo((): [number, number][] => {
    const pts = dayEntries
      .filter((e): e is typeof e & { coord: Coord } => !!e.coord)
      .map((e): [number, number] => [e.coord.lng, e.coord.lat]);
    return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  }, [dayEntries]);
```

- [ ] **Step 4: Keep displacement, but source it from the pin**

`locatedEntries` (lines 172-193) is unchanged in behaviour — displacement stays exactly as it is. Confirm it still reads `e.coord` (now registry-sourced) and that no other code consumes its displaced coordinates.

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Map.tsx
git commit -m "fix(map): read pins from the registry, route on true coordinates

Deletes the duplicate coordFor resolver. The Directions call now uses resolved
coordinates with consecutive duplicates dropped, removing the phantom ~175m
zigzag between co-located stops. Marker displacement is unchanged."
```

---

### Task 10: Pickup block in the activity card

**Files:**
- Modify: `src/pages/Map.tsx:82,284,291-319,421-446`

**Interfaces:**
- Consumes: `Pin.pickup`, `Pin.place` (Task 3); `distanceKm` (Task 2).

- [ ] **Step 1: Extend the popup type and both call sites**

At line 82, add to `AnyPopup`:

```ts
  pickup?: Pickup | null; place?: string | null;
```

In the marker `onClick` (line 284) and the photo-strip `onClick` (line 425), add to the `setPopup({...})` object:

```ts
                pickup: e.pin?.pickup ?? null, place: e.pin?.place ?? null,
```

- [ ] **Step 2: Add the pickup block component**

Add above `PhotoPin` at the end of `src/pages/Map.tsx`:

```tsx
// Pickup block for the activity card. The pin marks where the activity happens;
// this says where you are collected, which is often somewhere else entirely.
// Four cases, per the design: differs from pin (with distance, so the gap reads
// as intentional rather than as a data error), same as pin, no pickup offered,
// unknown (render nothing — never guess, never leave a blank).
function PickupBlock({ pickup, coord }: { pickup: Pickup | null | undefined; coord: { lng: number; lat: number } }) {
  if (pickup === undefined) return null;          // unknown — omit entirely
  const style = { margin: '7px -10px -10px', padding: '7px 10px 8px', background: '#f4f0e4', borderTop: '1px solid #e3ddcc' };
  const head = { fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: '#8c8c8c', marginBottom: 3 };

  if (pickup === null) {
    return (
      <div style={style}>
        <div style={head}>Pickup</div>
        <div style={{ fontSize: 11.5, color: '#8c8c8c', fontStyle: 'italic' }}>No pickup — make your own way there</div>
      </div>
    );
  }
  const m = Math.round(distanceKm(pickup.coord, coord) * 1000);
  return (
    <div style={style}>
      <div style={head}>Pickup</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#3a352e', lineHeight: 1.35 }}>{pickup.name}</div>
      {pickup.time && <div style={{ fontSize: 10.5, color: '#8c8c8c', marginTop: 2 }}>{pickup.time}</div>}
      {m > 150 && (
        <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 3, fontStyle: 'italic' }}>
          {m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`} from the pin — the tour travels to the activity
        </div>
      )}
    </div>
  );
}
```

Add the import at the top of the file:

```ts
import { distanceKm } from '../data/coordValidate';
```

- [ ] **Step 3: Render it in the popup**

In the popup body (after the price/duration block, before the closing `</div>` at line 316), add:

```tsx
                  <PickupBlock pickup={popup.pickup} coord={{ lng: popup.lng, lat: popup.lat }} />
```

- [ ] **Step 4: Verify in the running app**

```bash
npm run dev
```

Open the Map page, click a pin with a `departure`-source entry. Confirm: the pickup name renders; the distance line appears only when pickup is more than 150m from the pin; nothing renders for an item with no `pickup` field.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run typecheck && npm test && npm run audit:coords
git add src/pages/Map.tsx
git commit -m "feat(map): pickup block in the activity card

Shows where you are collected when that differs from where the activity
happens, with the distance so the gap reads as intentional. Renders nothing
when Viator supplied no pickup data."
```

- [ ] **Step 6: Remove the temporary probe op**

The Task 1 probe op has served its purpose and should not stay in a production edge function.

```bash
# Delete the `if (op === 'locations')` block from supabase/functions/viator-cards/index.ts.
# Keep getLocationsBulk in viator.ts and the type extensions in normalize.ts —
# docs/map/viator-location-probe.md documents why they exist.
npx supabase functions deploy viator-cards
git add supabase/functions/viator-cards/index.ts
git commit -m "chore(viator): remove the temporary location probe op"
```

---

## Ship checklist

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run audit:coords` exits 0 with no hard violations
- [ ] `docs/map/itinerary-geo-diff.md` records no degraded day
- [ ] `grep -rn "GROUP_COORDS\|ACTIVITY_COORDS\|VIATOR_ITEM_COORDS" src/` returns nothing
- [ ] `/code-review` run and clean — **mandatory, pushing to `main` deploys to production**
