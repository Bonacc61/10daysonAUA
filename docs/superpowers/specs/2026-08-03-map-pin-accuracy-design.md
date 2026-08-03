# Map pin accuracy — design

**Date:** 2026-08-03
**Status:** Draft — awaiting approval
**Scope:** Where map pins are sourced from, how they are verified, and the activity card's
pickup block. Touches `src/data/coords.ts`, `src/pages/Map.tsx`, `src/data/enRoute.ts`,
`src/data/itineraryGenerator.ts` (coordinate reads only), and adds a resolution tool +
audit script under `tools/`. No change to storage or the `SlotEntry` contract.

## Problem

A pin on the Map page asserts "this activity happens here". Today most pins cannot
support that claim.

Coordinates resolve through three tiers in `src/data/coords.ts` (`coordForEntry`,
duplicated as `coordFor` in `Map.tsx:29-32`, which is the one actually used to render):

| Tier | Entries | Provenance |
|---|---|---|
| `ACTIVITY_COORDS` | 29 | Hand-curated; comments cite Wikipedia / PADI / latitude.to |
| `VIATOR_ITEM_COORDS` | 22 | Hand-curated per product code; 18 point at Natural Pool, 4 at Palm Beach |
| `GROUP_COORDS` | 6 | **Invented centroids** — one representative point per Viator group |

The live catalog carries ~361 Viator items. Roughly **340 of them fall through to one of
six invented points.** A pin at `GROUP_COORDS['sailing-cruises']` (`-70.0476, 12.5662`)
is not a claim about where a catamaran sails from — it is a placeholder rendered with the
same visual authority as a verified coordinate.

This is worse than it looks, because `activitySource.ts` deliberately **re-files every
item by its Viator tags** — its own comment documents that 68 of 85 off-road tours arrive
filed under "Sailing & Cruises". `group_id` is known-untrustworthy for planning, yet
`GROUP_COORDS` still keys the map fallback off it.

Two further defects:

1. **A phantom route leg.** The ~180 m marker fan-out (`Map.tsx:180-192`) moves anchors,
   so `straightCoords` (`Map.tsx:196-199`) feeds the Directions API two distinct points
   for two stops at one place, drawing a zigzag between things that are co-located.
2. **No validation anywhere.** No bounds check, no land/sea check, no test. A transposed
   digit (`12.5` → `12.6`) ships silently and looks plausible at map scale.

## Goal

Every pin sits on the real-world spot the activity takes place, traceable to a cited
source. Anything that cannot meet that bar draws no pin. No coordinate ever changes
without appearing in a reviewed diff.

## Approach — resolve once, register, verify forever

Coordinates are researched **once**, per item, offline, and written to a committed
registry. The app reads static data. Nothing resolves at runtime.

This is chosen over runtime resolution (gazetteer matching in the browser) because
per-item research is more accurate than pattern-matching, and because a committed file is
reviewable. It is chosen over automated live enrichment because a coordinate that ships
unreviewed is exactly the failure mode being eliminated.

The tool proposes. A human accepts. Only accepted coordinates ship.

### The registry — `src/data/itemCoords.ts`

The single source the app reads. One entry per item that earns a pin:

```ts
export type PinSource =
  | 'viator-poi'      // Viator itinerary point-of-interest
  | 'known-place'     // named Aruba place, cited
  | 'departure'       // no fixed destination; this is where it departs from
  | 'curated';        // hand-verified editorial activity

export type Pin = {
  coord: Coord;
  source: PinSource;
  cite: string;        // REQUIRED — URL or reference a human can check
  place?: string;      // human-readable place name, for the card
  pickup?: { coord: Coord; name: string; time?: string };
};

export const ITEM_PINS: Record<string, Pin> = { /* … */ };
```

`cite` is mandatory and enforced by test. It is the veracity chain: every coordinate in
the app traces to something checkable. The 29 existing `ACTIVITY_COORDS` migrate into
this shape, keeping the citations already in their comments.

**Items absent from the registry render no pin.** That is a supported state, not a gap —
`Map.tsx:172-173` already filters coordless entries off the map while keeping them in the
photo strip. It just needs to stop being pre-empted by `GROUP_COORDS`.

`GROUP_COORDS` is deleted. The duplicate `coordFor` in `Map.tsx` is deleted; `Map.tsx`
imports the one implementation.

### The one-off pass — `tools/resolve-coords.ts`

Run manually, never in CI, never at runtime. For each catalog item it reads title,
description, tags, and (if the probe below confirms it) Viator location data, then
proposes a pin:

1. **Viator itinerary POI**, if available → `viator-poi`. Authoritative.
2. **Named place in the title**, resolved against an Aruba place table maintained
   alongside the tool → `known-place`.
3. **Named place in the description** → `known-place`, lower confidence.
4. **No destination exists** (sunset cruise, cooking class, spa, bar crawl) → the
   departure point, tagged `departure`. For these the departure point *is* where the
   activity takes place; it is not a fallback.
5. **Nothing resolvable** → proposed as `no-pin`.

Output is a review table — item, title, proposed coordinate, source, citation, and a
map link — plus a patch to `ITEM_PINS`. **Low-confidence proposals default to `no-pin`.**
A guess is never the default; a human must promote it and supply a citation.

The Aruba place table (~80 beaches, dive sites, landmarks, parks, towns, marinas) lives
under `tools/`, not `src/`. It is authoring input. It does not ship — the registry holds
literal coordinates, so the browser needs no matching logic at all.

### Coverage scope — the plannable pool, not the whole catalog

The registry does **not** need to cover all ~361 catalog items. It needs to cover
everything the app can put in front of a traveller as a suggestion. The engine already
narrows that set with two existing rules:

- **`isAutoFillExcluded`** (`itemFit.ts:244`) — the never-suggest-unasked rule: retail
  ("Diamond Shopping Experience"), photo services, self-drive vehicle hire.
- **`MIN_CHAMPION_REVIEWS = 25`** (`itineraryGenerator.ts:130`) — the popularity floor
  that keeps niche listings (6-review sunset photoshoots, 12-review Hooiberg hikes) out
  of the fill pool.

Per `docs/ROADMAP.md` (verified 2026-08-02): ~155 eligible experiences after exclusions,
champion pool ~81. Plus the 29 curated activities, which lead.

**Required coverage = the 29 curated activities + every item that passes both rules.**
That is a few hundred at the outside and realistically a few dozen distinct locations,
which is what makes one-off research viable.

Items outside the pool render no pin. They can still reach a plan if a traveller
explicitly hearts one — pins resolve against the un-narrowed catalog (`itemFit.ts:206-210`)
— and in that case the card simply has no marker. Honest, and rare by construction.

### Why this removes the coordinate fallback entirely

`GROUP_COORDS` is not only a map fallback. It also feeds the generator's geography:
`entryCoord` (`itineraryGenerator.ts:567-571`), the day-clustering penalty (`:585`), the
day anchor (`:1290`, `:1335`, `:1381`), and the en-route lunch stop (`:1424`).
`enRoute.ts:48` reads `ACTIVITY_COORDS` directly.

Deleting a coarse fallback would normally make ~340 items geo-neutral inside the engine
and loosen day clustering. **Scoping coverage to the plannable pool removes that risk:**
every item the engine can auto-place carries a precise registry coordinate, so the engine
ends up with strictly better geographic data than the group centroids gave it.

Therefore `GROUP_COORDS` is deleted outright — from the map *and* the engine. There is no
rough-coordinate tier anywhere in the codebase. The engine, the en-route picker, and the
map all read the one registry.

Generated itineraries will shift slightly, because the engine's geography becomes truer.
This is verified, not assumed: a before/after itinerary diff across the five
`tools/itinerary-trace.ts` personas is a required step, and any day whose clustering
degrades is investigated before merge.

### Ongoing churn

The catalog changes; a static registry goes stale. The audit script reports both
directions:

- **In catalog, unregistered** → renders no pin until someone runs the pass. Honest by
  construction.
- **Registered, no longer in catalog** → prune.

Steady state is a short delta, not a re-run of the whole catalog.

## Unverified assumption — probe first

Viator Partner API v2 `/products/{code}` is expected to return
`itinerary.items[].pointOfInterestLocation.location.ref` (places the tour visits) and
`logistics.start[].location.ref` (meeting point), with `/locations/bulk` resolving refs to
`{ center: { latitude, longitude }, address, name }`.

**None of this is verified.** The API key lives in Supabase env, not locally, and
`normalize.ts:4-25` declares no location fields — whatever Viator returns is discarded at
ingest today. Products typed `ACTIVITY` rather than `ITINERARY` may carry no POI list.

**Task 1 is a read-only probe** against ~20 real Aruba product codes, dumping raw
`logistics` and `itinerary` blocks. If POI data is sparse, steps 2-4 of the pass absorb
the difference and the design stands — only the source mix changes.

Because resolution is one-off, this probe is also the *only* Viator API work needed. No
ingest change, no `product_locations` table, no added per-refresh API cost.

## Validation — `src/data/coordValidate.ts`

Pure predicates, unit-tested, run at build/CI time.

| # | Rule | Catches |
|---|---|---|
| 1 | **Bounds** — inside Aruba's bbox (approx. lng `[-70.08, -69.86]`, lat `[12.40, 12.64]`; exact extents confirmed during implementation) | Transposed lat/lng, sign flips, digit typos |
| 2 | **Land/sea** — point-in-polygon against a simplified Aruba coastline. Land places on land; dive/snorkel sites in water **and** within 3 km of shore | Beaches in the sea, dive sites inland, mid-Caribbean coordinates |
| 3 | **Precision** — at least 3 decimal places (~110 m) | Coarse rounded guesses presented as fact |
| 4 | **Citation present** — non-empty `cite` on every entry | Coordinates entering without provenance |
| 5 | **Collision report** — flag any coordinate shared by more than 3 distinct items | A re-introduced centroid, silently |
| 6 | **Pickup-vs-pin delta** — both known and >25 km apart | Bad location-ref resolution |

Rules 1-4 are hard failures. Rules 5-6 are warnings requiring human sign-off.

The coastline polygon (~200 vertices, from OSM / Natural Earth) lives in `tools/`, is
imported only by the audit script, and never enters the client bundle.

## Audit script — `tools/audit-coords.ts`

`npm run audit:coords`. Sits alongside the existing `tools/itinerary-trace.ts`.

- Validates every registry entry against all six rules.
- Reports coverage by source tier, all violations, the 20 most-reused coordinates, and
  the churn delta in both directions.
- **Exits 1 on any hard violation.**

Flags: `--json` for machine output; `--live` to diff the registry against the live
catalog (manual). Default runs against the committed registry plus a catalog fixture, so
CI is deterministic and offline.

**The registry is itself the assurance mechanism.** Because coordinates are static and
committed, any change to one appears in a normal diff and goes through review. There is no
separate baseline file to maintain — the data *is* the baseline. `/code-review` before any
push to `main` is already mandatory, so this lands inside an existing gate.

### Test suite — `src/data/coords.test.ts`

- Every registry entry passes bounds + land/sea + precision + citation.
- No entry carries an empty or placeholder `cite`.
- Coordinates shared by >3 items are listed in an explicit allowlist, so a new collision
  fails the build until acknowledged.
- Regression fixtures pinning all 29 existing activity coordinates.
- `coordForEntry` returns `undefined` — not a fallback — for unregistered ids.

## Rendering — displacement retained (decided)

**Decision: keep the fan-out in `Map.tsx:180-192` as it stands.** Clustering was
prototyped and reviewed interactively across three scenarios; displacement was chosen for
legibility. Every stop keeps its own visible, individually-clickable pin.

Recorded accurately: in a collision a pin is drawn **~175 m** from the coordinate its data
claims (measured 176 m / 174 m / 174 m at `R = 0.0016°`). That is a *presentation* offset
applied after resolution.

Constraints this places on the rest of the design:

- **Displacement is applied last**, in the marker render path only. The registry, the
  validators, and the audit script always see the true coordinate.
- **The route line uses true coordinates**, with consecutive duplicates dropped before
  the Directions API call. This removes the phantom ~175 m zigzag between co-located
  stops without touching the pins. Pins stay legible; the route stays honest. This is the
  one rendering change in scope.
- **Collisions will become more frequent**, not less, once `GROUP_COORDS` is deleted —
  genuinely co-located tours will start sharing real marina and trailhead coordinates
  rather than fake centroids. Understood and accepted.
- Rule 5 (collision report) therefore matters more under this choice, since a
  re-introduced centroid is visually indistinguishable from a legitimate shared point.

## Activity card — pickup block (required)

The card that opens on pin click gains a **pickup block**, below price/duration:

| Case | Renders |
|---|---|
| Pickup known, differs from pin | Pickup name + address, time when available, and distance from the pin, noting the tour travels to the activity |
| Pickup known, same as pin | Pickup name + time only — no distance line, nothing to reconcile |
| No pickup offered | "No pickup — make your own way there" |
| Pickup unknown | Block omitted entirely — never guessed, never blank |

The distance line is what makes the split legible: it tells the reader *why* the pin is
somewhere they are not being collected. Without it, a Palm Beach pickup on a Conchi pin
reads as a data error.

Because displacement is retained, every stop keeps its own pin and card, so the block
always renders in full — no condensed multi-stop variant.

A pin with `source: 'departure'` is labelled as a departure point, so it is never mistaken
for a destination. No badge on `viator-poi` / `known-place` / `curated` pins — an accuracy
indicator on an accurate pin is noise.

### Pickup data is volatile — treat it differently from geography

The one-off registry is right for coordinates because geography is static: Eagle Beach
will not move. **Pickup arrangements are not static.** An operator can change a meeting
point or a departure time at any point, and a registry captured once will keep asserting
the old one.

This asymmetry is handled by scope, not by re-fetching:

- The pickup block states the pickup **location**, which is stable in practice (operators
  change hotels-vs-pier rarely).
- Pickup **time** renders only when Viator supplied one, and is presented as indicative.
- The card already links to the Viator product page, which is the authoritative source for
  what a traveller must actually do on the day. The block is orientation, not instruction.
- `cite` on a pickup records when it was captured, so staleness is visible in the registry
  rather than invisible in the UI.

If pickup accuracy later needs to be guaranteed rather than indicative, that is a live
lookup and a separate piece of work — explicitly out of scope here.

## Non-goals

- **Marker clustering of any kind.** Prototyped, reviewed side-by-side, declined.
- Runtime or ingest-time coordinate resolution. Resolution is one-off and offline.
- Geocoding street addresses for restaurants beyond the curated set.
- Changing matching-engine *logic*, `SlotEntry`, or any localStorage contract. The engine's
  coordinate *reads* are repointed at the registry; its scoring rules are untouched.
- Backfilling coordinates for items with no determinable location — those correctly
  render no pin.

## Risks

| Risk | Mitigation |
|---|---|
| Viator POI data absent or sparse | Probe first. Place-name resolution and departure points absorb the difference; only the source mix changes |
| Registry goes stale as catalog churns | Audit reports the delta both ways; unregistered items render no pin rather than a wrong one |
| Manual review effort across ~361 items | Tool proposes with citations, human accepts; most items resolve to a small set of repeated places (18 already map to Natural Pool alone) |
| Pin coverage drops visibly | Expected and correct — current coverage is substantially false. Audit quantifies before/after so the trade is a decision, not a surprise |
| Captured pickup data goes stale | Pickup is scoped as indicative orientation, not instruction; the Viator link remains authoritative. Capture date recorded in `cite`. Guaranteed pickup accuracy is a separate live-lookup piece of work |

## Success criteria

1. `npm run audit:coords` exits 0 with zero hard violations.
2. `GROUP_COORDS` no longer exists in the codebase.
3. Every coordinate the app can render carries a non-empty `cite`.
4. `coordForEntry` returns `undefined` for unregistered items — no fallback coordinate
   exists anywhere in the resolution path.
5. Displacement is presentation-only — verified by a test asserting the registry
   coordinate, the route-line vertex, and the audited coordinate are identical, and that
   the offset is applied solely in the render path.
6. The audit's churn report is clean, or every outstanding item is explicitly accepted.
7. **Every item in the plannable pool has a registry pin** — audit fails if an item passes
   `isAutoFillExcluded` and the review floor but has no coordinate.
8. A before/after itinerary diff across all five trace personas shows no day whose
   geographic clustering degraded.
