# Map pin accuracy — design

**Date:** 2026-08-03
**Status:** Draft — awaiting approval
**Scope:** Coordinate sourcing, validation, and marker rendering for the Map page.
Touches `src/data/coords.ts`, `src/pages/Map.tsx`, the `viator-cards` edge function,
and adds a gazetteer + audit script. No change to the matching engine, storage, or
the `SlotEntry` contract.

## Problem

A pin on the Map page asserts "this activity happens here". Today most pins cannot
support that claim.

Coordinates resolve through three tiers in `src/data/coords.ts` (`coordForEntry`,
mirrored by `coordFor` in `Map.tsx:29-32`):

| Tier | Entries | Provenance |
|---|---|---|
| `ACTIVITY_COORDS` | 29 | Hand-curated; comments cite Wikipedia / PADI / latitude.to |
| `VIATOR_ITEM_COORDS` | 22 | Hand-curated per product code; 18 of them point at Natural Pool, 4 at Palm Beach |
| `GROUP_COORDS` | 6 | **Invented centroids** — one representative point per Viator group |

The live catalog carries ~361 Viator items. Roughly **340 of them fall through to one
of six invented points.** A pin at `GROUP_COORDS['sailing-cruises']`
(`-70.0476, 12.5662`) is not a claim about where a catamaran sails from — it is a
placeholder rendered with the same visual authority as a verified coordinate.

This is worse than it looks, because `activitySource.ts` deliberately **re-files every
item by its Viator tags** — the ingest comment documents that 68 of 85 off-road tours
arrive filed under "Sailing & Cruises". So `group_id` is known-untrustworthy for
planning, yet `GROUP_COORDS` still keys the map fallback off it.

Three further defects:

1. **Deliberate displacement.** `Map.tsx:180-192` fans co-located pins onto a circle of
   radius `0.0016°` (~180 m) so they don't stack. Every pin in a collision is drawn
   ~180 m from the coordinate the data claims.
2. **A phantom route leg.** Because displacement moves the anchors,
   `straightCoords` (`Map.tsx:196-199`) feeds the Directions API two distinct points for
   two stops at one place, drawing a ~180 m zigzag between things that are co-located.
3. **No validation anywhere.** No bounds check, no land/sea check, no test. A
   transposed digit (`12.5` → `12.6`) ships silently and looks plausible on a
   small-scale map.

## Goal

Every pin the map draws is either (a) traceable to a cited source, or (b) not drawn.
No coordinate changes without showing up in a diff.

## Confirmed facts (from code)

- `coordForEntry` (`coords.ts:86-89`) and `coordFor` (`Map.tsx:29-32`) are duplicate
  implementations of the same precedence chain. Only `Map.tsx` is used for rendering.
- `normalize.ts:4-25` declares `ViatorProduct` with **no** location fields. Whatever
  location data Viator returns is discarded at ingest today.
- `Map.tsx:172-173` already filters coordless entries out of the map while keeping them
  in the photo strip. **"No pin" is an existing, working behaviour** — it needs no new
  UI, it just needs to stop being pre-empted by `GROUP_COORDS`.
- The lunch-spot block in `coords.ts:41-51` is self-described as "Town-level
  approximations" — admitted guesses, currently indistinguishable from verified points.
- `catalog_cache` + a TTL already exist in the edge function (`index.ts:25-37`), so
  there is a caching pattern to extend.

## Unverified assumption — probe before building

Viator Partner API v2 `/products/{code}` is expected to return:

- `logistics.start[].location.ref` — the meeting / pickup point
- `logistics.travelerPickup` — pickup arrangements
- `itinerary.items[].pointOfInterestLocation.location.ref` — **the places the tour
  actually visits**

and `/locations/bulk` is expected to resolve those refs to
`{ center: { latitude, longitude }, address, name }`.

**None of this is verified.** The API key lives in Supabase env, not locally. Products
typed `ACTIVITY` rather than `ITINERARY` may carry no POI list at all.

**Task 1 of implementation is a read-only probe** against ~20 real Aruba product codes
that dumps the raw `logistics` and `itinerary` blocks, so the design is confirmed
against reality before any code depends on it. If POI data turns out to be absent or
sparse, the gazetteer (below) absorbs the difference and the design still stands — only
the coverage mix changes.

## Decision: what a pin means

For a tour that collects you at a Palm Beach hotel and drives you to Conchi, the pin
goes on **Conchi**. The meeting point is real, useful, logistical data — it belongs in
the popup, not on the pin.

Consequence: Viator's meeting point is *not* the primary source. It is one input among
several, and it is the pin only for products that genuinely have no destination.

## Architecture

Four units, each independently testable.

### 1. Gazetteer — `src/data/places.ts`

A static, verified place table. ~70-90 entries covering Aruba beaches, dive sites,
landmarks, parks, towns, marinas, and the curated restaurants.

```ts
export type Place = {
  id: string;
  name: string;          // canonical display name
  aliases: string[];     // matched case- and diacritic-insensitively
  coord: Coord;
  kind: 'beach' | 'dive' | 'landmark' | 'town' | 'park' | 'marina' | 'restaurant';
  terrain: 'land' | 'water';   // drives the land/sea validator
  source: string;              // REQUIRED — citation URL or reference
  precision_m: number;         // how tightly this point represents the place
};
```

`source` is mandatory and enforced by test. It is the veracity chain: every coordinate
in the app traces to something a human can check. `precision_m` makes the
lunch-spot-style approximation explicit instead of implied.

The 29 existing `ACTIVITY_COORDS` migrate into this shape, keeping the citations already
present in their comments.

### 2. Resolver — `src/data/resolvePlace.ts`

Pure function, no I/O:

```ts
resolvePlace(text: string): { place: Place; alias: string } | null
```

- Normalises: lowercase, strip diacritics, collapse whitespace.
- Matches aliases on **word boundaries** (so "palm trees" never matches "Palm Beach").
- **Longest alias wins** ("Baby Beach Snorkel" beats "Beach").
- **Ambiguity returns `null`.** If two *different* places match, it does not guess.

That last rule is the accuracy-first choice: a null costs one pin, a wrong guess costs
the credibility of every pin.

### 3. Precedence chain — `src/data/coords.ts`

`coordForEntry` returns provenance, not a bare coordinate:

```ts
type ResolvedCoord = {
  coord: Coord;
  confidence: 'curated' | 'viator-poi' | 'gazetteer-title' | 'gazetteer-desc' | 'meeting-point';
  source: string;
};
```

| # | Source | Confidence |
|---|---|---|
| 1 | Curated override for this id | `curated` |
| 2 | Viator itinerary POI (from ingest) | `viator-poi` |
| 3 | Gazetteer match on item **title** | `gazetteer-title` |
| 4 | Gazetteer match on item **description** | `gazetteer-desc` |
| 5 | Viator meeting point (from ingest) | `meeting-point` |
| 6 | — | **no pin** |

**`GROUP_COORDS` is deleted.** Every case it currently absorbs is better served by rows
2-6. The duplicate `coordFor` in `Map.tsx` is deleted too; `Map.tsx` imports the one
implementation.

Row 5 is not a fallback in disguise — for a sunset catamaran cruise, a cooking class, or
a spa treatment, the departure point *is* where the activity takes place. It is labelled
in the UI because for a tour it would mean something different.

### 4. Ingest enrichment — `viator-cards` edge function

Extend `ViatorProduct` with `logistics` and `itinerary`, extract location refs,
batch-resolve them via `/locations/bulk`, and write `dest_coord` / `meet_coord` /
`meet_address` onto each item.

**Cost control.** `/products/{code}` is one call per product; a naive implementation adds
~361 calls to every catalog refresh, against today's paged search only. Locations are
near-static, so: a `product_locations` table keyed by `product_code`, populated on first
sight and read from cache thereafter. Steady-state cost is only newly-appeared products.
This table holds no personal data — no GDPR retention obligation, no Privacy Policy
change.

### Where each step runs

| Step | Runs | Why |
|---|---|---|
| Viator location fetch | Ingest (edge fn) | Needs the API key |
| Gazetteer resolution | **Browser, from static data** | Deterministic; audit script imports the identical module |
| Validation | **Build / CI only** | Coastline polygon must not ship to the client |

Resolving the gazetteer client-side rather than at ingest is deliberate: the audit script
imports `resolvePlace` directly, so what CI validates is byte-for-byte what the browser
computes. No parity drift between two implementations. Cost is ~10 KB of static place
data in the bundle and string matching over ~80 entries per render — negligible.

## Validation — `src/data/coordValidate.ts`

Pure predicates, unit-tested, run at build/CI time.

| # | Rule | Catches |
|---|---|---|
| 1 | **Bounds** — inside Aruba's bbox (approx. lng `[-70.08, -69.86]`, lat `[12.40, 12.64]`; exact extents confirmed during implementation) | Transposed lat/lng, sign flips, digit typos |
| 2 | **Land/sea** — point-in-polygon against a simplified Aruba coastline. `terrain:'land'` must be on land; `terrain:'water'` must be in water **and** within 3 km of shore | Beaches in the sea, dive sites inland, mid-Caribbean coordinates |
| 3 | **Precision** — at least 3 decimal places (~110 m) | Coarse rounded guesses presented as fact |
| 4 | **Collision report** — flag any coordinate shared by more than 3 distinct products | A re-introduced centroid, silently |
| 5 | **Meet-vs-dest delta** — both known and >25 km apart | Bad location-ref resolution |

Rules 1-3 are hard failures. Rules 4-5 are warnings requiring human sign-off.

The coastline polygon (~200 vertices, from OSM / Natural Earth) lives in `tools/`, is
imported only by the audit script, and never enters the client bundle.

## Audit script — `tools/audit-coords.ts`

`npm run audit:coords`. Sits alongside the existing `tools/itinerary-trace.ts`.

- Resolves every catalog item and every curated activity through the real precedence
  chain, importing the same modules the app imports.
- Runs every validator.
- Reports: coverage by confidence tier, all violations, and the 20 most-reused
  coordinates.
- **Exits 1 on any hard violation.**

Flags: `--json` for machine output; `--live` to hit the live catalog (manual);
default runs against a committed catalog fixture so CI is deterministic and offline.

**The snapshot is the actual assurance mechanism.** `docs/map/coord-audit-baseline.json`
records the resolved coordinate for every id. The script diffs against it and fails on
unexplained drift. A coordinate can then never change without a human seeing the change
in a reviewed diff — which is the property being asked for. `/code-review` before any
push to `main` is already mandatory, so this lands in an existing gate.

### Test suite — `src/data/coords.test.ts`

- Every curated coordinate passes bounds + land/sea + precision.
- Every gazetteer entry has a non-empty `source`.
- No two gazetteer places share a coordinate.
- Resolver fixture table: known titles → expected place.
- Resolver returns `null` for a curated list of ambiguous and place-free titles.
- Regression fixtures pinning all 29 existing activity coordinates.

## Rendering — cluster, don't displace

The fan-out in `Map.tsx:180-192` is removed. Co-located stops become **one marker at the
true coordinate**, with the stack drawn inside the marker's own box in CSS.

The distinction: offsetting pixels within a marker is drawing. Offsetting the anchor is
a claim about geography.

- `locatedEntries` groups by coordinate key and returns `{ coord, stops[] }`. Stop
  numbering stays global and chronological (`1..N`).
- `PhotoPin` gains a stacked variant — same photo disc, a count badge, two offset sheets
  behind it.
- The popup gains a list mode for multi-stop clusters. Single-stop clusters render
  exactly the popup that exists today.
- `straightCoords` drops consecutive duplicate points before calling the Directions API,
  removing the phantom zigzag leg.

**Scoped decision: cluster on exact coincidence only, not proximity.** Zoom-aware
clustering (supercluster-style) is a substantially larger change and is not needed — the
displacement bug only fires on exact 5-decimal coordinate matches today. Two genuinely
distinct places 200 m apart overlapping at zoom 11 is a legibility annoyance, not a
veracity problem, and is out of scope.

Reviewed interactively as a side-by-side demo before approval.

## UI honesty

### Pickup point in the activity card (required)

The card that opens on pin click gains a **pickup block**, below price/duration:

| Case | Renders |
|---|---|
| Pickup known, differs from pin | Pickup name + address, pickup time when available, and the distance from the pin, with the note that the tour travels to the activity |
| Pickup known, same as pin | Pickup name + time only — no distance line, since there is nothing to reconcile |
| No pickup offered | "No pickup — make your own way there" |
| Pickup unknown (no Viator data) | Block omitted entirely — never guessed, never blank |

The distance line is what makes the split pin/pickup model legible: it tells the reader
*why* the pin is somewhere they are not being collected. Without it, a Palm Beach pickup
on a Conchi pin reads as a data error.

In a multi-stop cluster the list rows show the pickup name only; the full block appears
when a single stop is opened.

This block is the reason the destination-vs-meeting-point decision is safe to make: the
logistics data is not discarded, it is relocated to where it is actually useful.

### Rest

- A pin resolved at `confidence: 'meeting-point'` is labelled as a departure point, so it
  is never mistaken for a destination.
- No badge on curated / POI / gazetteer pins — an accuracy indicator on a pin that is
  accurate is noise.
- Coordless items render no pin and stay in the photo strip. Existing behaviour, now
  reached honestly.

## Non-goals

- Zoom-aware proximity clustering.
- Geocoding street addresses for restaurants beyond the curated set.
- Changing the matching engine, `SlotEntry`, or any localStorage contract.
- Backfilling coordinates for products Viator has no location data for — those correctly
  render no pin.

## Risks

| Risk | Mitigation |
|---|---|
| Viator POI data absent or sparse | Probe first (Task 1). Gazetteer absorbs the difference; only the coverage mix changes |
| Ingest API call volume | `product_locations` cache table; steady state is new products only |
| Gazetteer maintenance burden | ~80 entries, static, source-cited. Audit script reports coverage so gaps are visible |
| Pin coverage drops visibly on launch | Expected and correct — the current coverage is partly false. Audit report quantifies it before/after so the trade is a decision, not a surprise |

## Success criteria

1. `npm run audit:coords` exits 0, with zero hard violations.
2. `GROUP_COORDS` no longer exists in the codebase.
3. Every coordinate the app can render traces to a `source` string or a Viator location
   ref.
4. No rendered marker sits at a coordinate other than the one its data claims —
   verified by a test asserting marker anchors equal resolved coordinates.
5. The audit baseline is committed, and CI fails on undiffed coordinate drift.
