# Explore — individual Viator items, vibe & price filtered

- **Date:** 2026-06-04
- **Status:** Implemented & deployed to production
- **Scope:** Frontend (`src/pages/Explore.tsx` + `src/data/exploreItems.ts`) **and** the `viator-cards` Supabase edge function.
- **Branch:** `feat/explore-phase1-items`

> This started as a frontend-only "Phase 1". During the build it absorbed two items originally deferred to later phases — **fetching far more inventory** (edge-function paging) and a **title-keyword adventure classifier** so live items are labelled correctly. The spec below reflects what shipped.

## Problem

On the old Explore page every Viator activity was buried inside one of four **group cards** (`adventure-tours`, `watersports`, `sailing-cruises`, `food-drink-experiences`). Each `GroupCard` surfaced only the group's best-seller, and the edge function only emitted 8 items/group (32 total), so the vast majority of Aruba's bookable Viator inventory was invisible and unfilterable.

We want **every individual Viator item URL represented as its own tile**, as many as feasible, each filterable by **vibe** (relax ⇆ adrenaline) and **price** (free ⇆ splurge).

## Goals

1. Render **every item in `catalog.items`** as its own tile — a single flat, ranked grid of individual Viator items + local picks. **No group cards.**
2. Fetch **as many bookable Viator activities as possible** (not the old 32).
3. Two graded sliders that compose (logical AND) with each other, category, and search:
   - **"Vibe"** (Chill → Adrenaline), seeded from `answers.adventureLevel`.
   - **"Price"** (Free → Splurge) — **replaces** the old Budget buttons.
   - e.g. Chill + Free ⇒ free beaches / sunset walks; Adrenaline + Splurge ⇒ kitesurf / UTV-tour tier.
4. Each tile shows a **provenance badge** ("Viator" vs "Local pick") and a **vibe pill** (Chill / Balanced / Adrenaline).
5. Correct per-activity vibe labelling for **both** stub and **live** data — a relaxing snorkel/mangrove cruise must not read as "adrenaline".

## Non-goals (still deferred)

- Deriving vibe from Viator's per-product numeric `tags` taxonomy — not emitted by the function; we use a **title-keyword classifier** instead (below). A future phase can emit `tags` and map them.
- Caching / cron prefetch and **Explore pagination / virtualization** — the grid renders all (~260) tiles at once. If that gets heavy, add windowing.
- Interest/group-type based *ranking* of tiles beyond best-seller + rating.
- The pre-existing "Add → Build itinerary" shortlist being local-only — untouched.

## Design overview

Explore renders **one flat, ranked grid**: every Viator item tile + every local-pick tile that passes the filters, sorted by best-seller boost then rating. All filter/score logic lives in the pure, unit-tested `src/data/exploreItems.ts` so `Explore.tsx` stays a thin view.

## Backend — Viator inventory (`supabase/functions/viator-cards`)

- `viator.ts` gains `searchProductsPaged(destinationId, tagIds, max)`: page 1 (50/request) reveals `totalCount`, then the remaining pages are fetched **in parallel**, so wall time is ~2 round-trips regardless of page count. `searchProducts` gains a `start` param.
- `index.ts` replaces `SEARCH_COUNT`/`EMIT_CAP` (8/group) with `PER_GROUP_MAX = 150` and emits **all** unique products per group (cross-group de-dupe, first group wins).
- Result: **~238 live items** (was 32), fetched in ~5s. Per-group after de-dupe: food-drink 40, sailing 140, watersports 33, adventure 25. `verify_jwt` stays on; on any error the frontend still falls back to the stub.
- Deployed via `supabase functions deploy viator-cards` (project `mrfblzsihpecockhsnqe`).

## Data model — `adventure` value + resolution

Optional curated value `adventure?: number` (0 chill → 100 adrenaline) added to `ViatorItem` (`src/types.ts`) and `Activity` (`src/data/activities.ts`), populated inline for the stub catalog (see Appendix A).

`advValue()` resolves an entry's adventure score in precedence order:

1. **Curated `adventure`** (stub items / local picks).
2. **Title-keyword classifier** `keywordAdventure(title)` — the key step for **live** items, which arrive with only a title (no `adventure`, no per-item tags). Four tiers, first hit wins (prefix-at-word-start matching, e.g. `zip`→`ziplining`):
   - **85 (adrenaline):** utv, atv, quad, buggy, zip, kite, jet ski, off-road, cliff, dune, parasail, tubing, snuba, seabob, talon, raider, wakeboard, flyboard, e-foil, rappel, bungee, skydiv, paraglid …
   - **18 (chill):** snorkel, sail, cruis, sunset, dinner, tasting, rum, wine, cooking, beach, catamaran, boat, yacht, mangrove, turtle, flamingo …
   - **50 (moderate):** hik, jeep, safari, 4x4/4wd, bike, kayak, paddle, horseback, cave, segway, scooter, harley, scuba, dive, nature …
   - **18 (generic-chill catch-all, checked last):** tour, transfer, transport, pickup, shuttle, bus, van, excursion, sightsee, highlight, landmark, submarine, sanctuary, waterpark, pub crawl, sip, paint, breakfast, museum, historic … — so a plain "Island Tour"/"Airport Transfer" reads chill **without** overriding jeep/kayak → balanced.
3. **Explicit adventure `MatchTag`s** averaged (`low/med/high` → 15/55/88).
4. **Category proxy** (`Beaches 8, Food 18, Tours 40, Watersports 72, Activities 68`).

Verified on the 238 live items: only **1** reaches the tag/category fallback; spread 🪂41 / ⚖48 / 🌴148.

## `src/data/exploreItems.ts` (pure, tested)

```ts
type ExploreEntry =
  | { kind: 'item'; item: ViatorItem; category: Category; adventure: number }
  | { kind: 'activity'; activity: Activity; category: Category; adventure: number };

itemCategory(item): Category                              // group_id → bucket (no 'All')
keywordAdventure(title): number | undefined               // 4-tier title classifier
advValue({ adventure?, title?, matched_by?, category }): number   // resolution above
vibePass(adventure, vibe): boolean                        // graded; see below
priceOf(entry): number                                    // price_usd | parsed cost ("Free"→0)
priceValue(price): number                                 // Free 0 / <$50 38 / $50–100 63 / $100+ 90
pricePass(priceValue, price): boolean                     // same mechanic as vibePass
filterExploreEntries(catalog, { category, search, vibe, price }): ExploreEntry[]
groupPasses(group, catalog, vibe, price): boolean         // retained utility (tested; unused by the flat grid)
```

### Slider semantics (both graded hard filters)

`v ∈ [0,100]`, centre 50, `t = (v - 50) / 50`:
- `t === 0` → show everything.
- `t > 0` → keep `value >= t * 67` (drops the lowest first; at 100 only the top third ≥ 67).
- `t < 0` → keep `value <= 100 - |t| * 67` (at 0 only the bottom third ≤ 33 — for Price, only Free survives).

Vibe pill: **🪂 Adrenaline** (`adv ≥ 67`), **🌴 Chill** (`adv ≤ 33`), else **⚖ Balanced**.

**The two sliders AND together** (verified against the stub): *Chill+Free* → the free beach/walk picks; *Adrenaline+Splurge* → UTV ($129) + Kitesurf ($120) tier; *centre/centre* → everything.

## Rendering (`src/pages/Explore.tsx`)

- Single grid from `filterExploreEntries(catalog, {category, search, vibe, price})`; no group cards.
- Subtitle reflects the real loaded total (`catalog.items.length` activities + local picks).
- Tile: provenance badge top-left ("Viator" cream / "Local pick" yellow), vibe pill top-right, header band = category, image, rating, title, group-name/location line, optional coral `fitReason`, clamped description, `duration` + `$price` chips, "View details" → URL (`target="_blank" rel="noopener"`), Add button.
- Sidebar: two `.trip-slider` range inputs — **Vibe** ("🌴 Chill" / "Adrenaline 🪂", seeded from `answers.adventureLevel`) and **Price** ("✨ Free" / "Splurge 💸", default centre). No "New" badges. The Budget button group is removed. Both are local state; neither writes back to the trip plan.
- `src/App.tsx` passes `answers` to `Explore`.

## Edge cases

- **No questionnaire:** `adventureLevel` defaults to 50 → both sliders centred → everything shown.
- **Live catalog swap:** live items have no curated `adventure`; `advValue()` uses the title classifier (then tags/proxy). Only ~1/238 needs the fallback.
- **Free extreme:** all Viator items are paid → only free local picks survive. Expected.
- **Empty set:** "No results" panel nudging the user to recentre the sliders / clear search.

## Testing — `src/data/exploreItems.test.ts` (vitest, 82 tests in suite)

- `itemCategory`, `advValue` precedence (curated > keyword > tag > proxy), `vibePass`/`pricePass` extremes + monotonicity, `priceValue` bands.
- `keywordAdventure`: adrenaline / chill / moderate hits; adrenaline beats chill in a mixed title; generic "tour/transfer/bus" → chill; thrill vehicles (seabob/talon) high even when titled "tour"; jeep tour stays balanced; unmatched → undefined.
- `filterExploreEntries`: nothing dropped at defaults; each filter narrows; best-seller sorts first. Slider composition: Chill+Free / Adrenaline+Splurge / centre.
- `groupPasses` retained-utility behaviour.

## Appendix A — curated stub adventure values

Viator items: utv-cave-pool 90 · jeep-arikok 68 · horseback-beach 45 · atv-quad 85 · ziplining 88 · snorkel-catamaran 28 · kitesurf-lesson 85 · jetski-rental 75 · paddleboard-tour 32 · scuba-discovery 58 · sunset-sail 12 · pirate-cruise 48 · private-charter 18 · dolphin-watch 22 · lunch-cruise 15 · beach-dinner 8 · food-tour 22 · rum-tasting 15 · cooking-class 14 · wine-dinner 8

Local picks: eagle-beach-morning 8 · baby-beach-snorkel 18 · arikok-hiking 55 · california-lighthouse-sunset 8 · flamingo-renaissance 12 · boca-catalina-snorkel 32 · antilla-wreck-dive 60 · zeerovers-fresh-catch 12 · gasparito-restaurant 8 · oranjestad-walking 20 · kitesurfing-lesson 85 · natural-pool-jeep 70 · malmok-beach 28 · tres-trapi 25 · manchebo-beach 6 · divi-beach 6 · mangel-halto 25 · rodgers-beach 8 · boca-grandi 30

(Live items are classified by title, not these values.)
