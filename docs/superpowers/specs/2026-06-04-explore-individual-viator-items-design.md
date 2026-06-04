# Explore — Individual Viator items, vibe-filtered (Phase 1)

- **Date:** 2026-06-04
- **Status:** Approved design, pre-implementation
- **Scope:** Frontend only (`10daysonaruba.com`, the production repo). No backend / edge-function changes.
- **Branch:** `feat/explore-phase1-items`

## Problem

On the Explore page (`src/pages/Explore.tsx`) every Viator activity is buried inside one of four **group cards** (`adventure-tours`, `watersports`, `sailing-cruises`, `food-drink-experiences`). Each `GroupCard` surfaces only the group's best-seller; the other items in the group are passed as `others` but never get their own representation. So of ~20 stub items (and the live catalog), only ~4 are individually visible.

We want **every Viator item/activity to have its own tile on Explore**, and we want the user to be able to narrow the list to their preferred **vibe** (relax ⇆ adrenaline) and **budget**.

## Goals

1. Render **every item in `catalog.items`** as its own tile on Explore, alongside the existing group cards and local activity tiles.
2. Add a graded **"Vibe" slider** filter (Relax → Adrenaline).
3. Keep the existing **budget / category / search** filters working over the new item tiles.
4. Each tile shows a **provenance badge** ("Viator" vs "Local pick") and a **vibe pill** (Chill / Balanced / Adrenaline) so the filtering is legible.
5. Correct per-activity vibe labelling — a relaxing snorkel cruise must not read as "adrenaline".

## Non-goals (deferred to later phases)

- Raising the catalog cap or fetching more of Viator's inventory (`EMIT_CAP`, Partner API paging) — **Phase 2/3**.
- Deriving vibe from Viator's per-product `tags` taxonomy — **Phase 2**.
- Caching / cron / Explore pagination — **Phase 3**.
- Interest/group-type based *ranking* of tiles (beyond best-seller + rating) — deferred; Phase 1's questionnaire personalization is the vibe slider + budget only.
- Fixing the pre-existing fact that Explore's "Add → Build itinerary" shortlist is local-only and does not carry the selection into the itinerary — out of scope, untouched.

## Design overview

Explore renders, top to bottom:

1. **Group cards** (pinned) — unchanged `GroupCard` in `variant="explore"`. A group card is shown only if **any item in that group passes the current vibe filter** (plus the existing category/budget/search checks on its best-seller), so e.g. "Watersports" still appears while the slider is on Chill because it contains a chill snorkel cruise.
2. **One merged, ranked grid** of every Viator item tile + every local activity tile that passes all filters. Sorted: best-seller boost, then rating.

Best-sellers therefore appear twice — once in their group card and once as their own tile. This redundancy was reviewed and accepted (the group card is a "browse the whole category on Viator" affordance; the item tile is the specific bookable activity).

All filter/score logic lives in a new pure, unit-tested module so `Explore.tsx` stays a thin view.

## Data model change — curated `adventure` value

Add an optional curated adventure value (0 = full chill → 100 = full adrenaline) to both catalog entry types:

```ts
// src/types.ts — ViatorItem
adventure?: number;   // 0 chill … 100 adrenaline (curated)

// src/data/activities.ts — Activity
adventure?: number;
```

Populate it inline for every entry in `src/data/viator-stub.ts` (20 items) and `src/data/activities.ts` (19 picks). The curated values used in the approved mockup are the reference (see Appendix A). This is cheap because the catalog is hand-maintained (~40 entries) and it removes the mislabelling entirely.

**Fallback for entries without a curated value** (e.g. items fetched live by `loadCatalog()` in a later phase): derive in `advValue()` from explicit adventure `MatchTag`s (`low/med/high-adventure` → 15 / 55 / 88, averaged), else a per-category proxy (`Beaches 8, Food 18, Tours 40, Watersports 72, Activities 68`).

## New module — `src/data/exploreItems.ts` (pure, tested)

Mirrors the style of `src/data/matcher.ts` (pure functions, no React). API:

```ts
type ExploreEntry =
  | { kind: 'item'; item: ViatorItem; category: Category; adventure: number }
  | { kind: 'activity'; activity: Activity; category: Category; adventure: number };

// Category bucket for a Viator item (moves GROUP_TAXONOMY_TO_CATEGORY here).
// `Category` here is a content bucket — 'Beaches' | 'Activities' | 'Watersports'
// | 'Food' | 'Tours' — i.e. CATEGORIES without the 'All' filter sentinel.
itemCategory(item: ViatorItem, groups: ViatorGroup[]): Category

// Curated value if present, else adventure-tag avg, else category proxy.
advValue(entry: { adventure?: number; matched_by?: MatchTag[]; category: Category }): number

// Graded vibe filter. See semantics below.
vibePass(adventure: number, vibe: number): boolean

// price for budget matching: ViatorItem.price_usd | parsed Activity.cost
matchBudget(price: number, budget: string): boolean

// The full pipeline: build entries from the catalog, apply category/budget/
// search/vibe hard filters, sort by best-seller then rating.
filterExploreEntries(
  catalog: Catalog,
  opts: { category: string; budget: string; search: string; vibe: number },
): ExploreEntry[]

// Whether a group card should show under the current vibe (any item passes).
groupPassesVibe(group: ViatorGroup, catalog: Catalog, vibe: number): boolean
```

### Vibe slider semantics (graded hard filter)

`vibe ∈ [0,100]`, center = 50. Let `t = (vibe - 50) / 50` (∈ [-1, +1]).

- `t === 0` (center): **show everything**.
- `t > 0` (toward adrenaline): keep entries with `adventure >= t * 67` — drops the chillest first; at `vibe = 100` only `adventure ≥ 67` survive.
- `t < 0` (toward chill): keep entries with `adventure <= 100 - |t| * 67` — drops the most intense first; at `vibe = 0` only `adventure ≤ 33` survive.

The constant `67` makes the extremes resolve to exactly the high (≥67) / low (≤33) thirds. Verified counts against the current stub (39 entries): `vibe 0 → 26`, `25 → 31`, `50 → 39`, `75 → 13`, `100 → 8` — a smooth gradient, everything at center, only the matching extreme at the ends.

The vibe pill on a tile reads **🪂 Adrenaline** (`adv ≥ 67`), **🌴 Chill** (`adv ≤ 33`), else **⚖ Balanced**.

## Rendering changes (`src/pages/Explore.tsx`)

- Replace the inline item-filtering with `filterExploreEntries(catalog, {category, budget, search, vibe})`.
- Group-card list keeps its current build but its visibility filter gains `groupPassesVibe(...)`.
- Render order: group cards, then the merged entry grid (`item` → Viator tile, `activity` → existing local tile markup).
- **Provenance badge** top-left of each tile: "Viator" (cream) vs "Local pick" (yellow). **Vibe pill** top-right.
- Viator item tile fields: header band = `itemCategory`; image `image_url`; rating `rating`; title `title`; context line = group name; optional coral `fitReason` chip; clamped `description`; chips `duration` + `$price_usd`; "View details" → `viator_item_url` (`target="_blank" rel="noopener"`); Add button keyed `item:${id}`.
- Local activity tile: unchanged except the added provenance badge + vibe pill.

### "Vibe" sidebar control

A range input (`0–100`, reusing the existing `.trip-slider` styling) added to the sidebar below Budget, labelled "Vibe" with ends "🌴 Chill" / "Adrenaline 🪂" and a one-line description of the current state. It is **local component state**, seeded from `answers.adventureLevel`; it does **not** write back to the trip plan.

### App wiring (`src/App.tsx`)

`Explore` currently receives only `setPage`. Pass `answers` so the vibe slider can seed from `answers.adventureLevel`:

```tsx
{page === 'explore' && <Explore setPage={setPage} answers={answers} />}
```

`Explore`'s props type gains `answers: Answers`.

## Edge cases

- **No questionnaire completed:** `answers.adventureLevel` defaults to 50 → slider starts centered → everything shown. Correct.
- **`'Free'` budget:** never matches a paid Viator item; local activities cover Free. Expected, unchanged.
- **Live catalog swap:** `useCatalog()` swaps stub → live mid-session. Live items lack a curated `adventure`, so `advValue()` falls back to tags/category proxy. Tiles still render and filter; precision improves in Phase 2.
- **Empty result set:** existing "No results" panel, with copy nudging the user to loosen the vibe slider / filters.
- **Items with missing `description`/`fitReason`:** chips/blurb render conditionally (already handled by `?`-guards).

## Testing — `src/data/exploreItems.test.ts` (vitest)

- `itemCategory` maps each group id to the right bucket; unknown → `'Tours'`.
- `advValue`: curated value wins; tag-average fallback; category-proxy fallback.
- `vibePass`: center passes all; `vibe=100` passes only `adv≥67` and rejects `adv<67`; `vibe=0` passes only `adv≤33`; monotonic (raising vibe never re-admits a chiller item).
- `matchBudget`: each band incl. numeric `price_usd` and parsed `cost` strings; `'Free'` excludes paid items.
- `filterExploreEntries`: every catalog item appears when filters are at defaults (no item silently dropped); category/budget/search/vibe each narrow correctly; sort puts best-sellers ahead of equal-rated non-best-sellers.
- `groupPassesVibe`: a mixed group (watersports) shows at both chill and adrenaline extremes; a uniform group (food-drink) hides at full adrenaline.

## Appendix A — curated adventure values (reference)

Viator items: utv-cave-pool 90 · jeep-arikok 68 · horseback-beach 45 · atv-quad 85 · ziplining 88 · snorkel-catamaran 28 · kitesurf-lesson 85 · jetski-rental 75 · paddleboard-tour 32 · scuba-discovery 58 · sunset-sail 12 · pirate-cruise 48 · private-charter 18 · dolphin-watch 22 · lunch-cruise 15 · beach-dinner 8 · food-tour 22 · rum-tasting 15 · cooking-class 14 · wine-dinner 8

Local picks: eagle-beach-morning 8 · baby-beach-snorkel 18 · arikok-hiking 55 · california-lighthouse-sunset 8 · flamingo-renaissance 12 · boca-catalina-snorkel 32 · antilla-wreck-dive 60 · zeerovers-fresh-catch 12 · gasparito-restaurant 8 · oranjestad-walking 20 · kitesurfing-lesson 85 · natural-pool-jeep 70 · malmok-beach 28 · tres-trapi 25 · manchebo-beach 6 · divi-beach 6 · mangel-halto 25 · rodgers-beach 8 · boca-grandi 30

These are an editorial starting point and can be tuned during implementation.
