# Explore taxonomy — Viator‑tag driven sections (Option A)

- **Date:** 2026-06-04
- **Status:** Approved design, pre-implementation
- **Scope:** `viator-cards` edge function + frontend (`exploreItems.ts`, `Explore.tsx`, `itineraryGenerator.ts`, data/types).
- **Branch:** `feat/viator-taxonomy`

## Problem

10daysonaruba's category tabs (`All, Beaches, Activities, Watersports, Food, Tours`) are a hand‑rolled set that doesn't line up with Viator's taxonomy, and the current pipeline assigns each Viator product to **one** of four groups via "first‑group‑wins" de‑dup, then maps that to one tab. This is:

- **Lossy / arbitrary** — Viator products are inherently multi‑category (a "Sunset Snorkel Sail with Dinner" is Cruises *and* Water *and* Food); we keep one bucket at random.
- **Misaligned** — the 6 editorial tabs don't map cleanly to Viator's parent→subcategory tree.
- **Inconsistent** — `Beaches` is local‑only (no Viator equivalent).
- **Coupled** — `itineraryGenerator.ts` also matches on these 6 categories, so the taxonomy is not just Explore tabs.

Now that the catalog is overwhelmingly Viator (~238 live items), the taxonomy should be **representative of Viator**: driven by each product's real tags, with multi‑membership.

## Goals

1. Categorize items by their **real Viator tags**, with **multi‑membership** (an item belongs to every section it matches).
2. Present **~6 curated, Viator‑aligned top‑level sections** as the tab bar.
3. Make the **backend own the taxonomy** — it emits each item's `tags` + computed `sections`; the frontend does no tag math.
4. **Reconcile the itinerary generator** to the new sections (one source of truth).
5. Retire the lossy group→category mapping.

## Non-goals (Phase B / later)

- **Subcategory drill‑down chips** (Viator subcategories within a section) — deferred; the emitted `tags` + tree names make it a clean follow‑up.
- Real per‑item **region/location** and the rating breakdown — separate deferred backend tasks.
- Reworking how inventory is *fetched* (the 4 anchor‑tag searches stay as the inventory net; only categorization changes).

## The sections (curated, provisional)

Each section = a stable `key`, a display `label`, and a set of Viator **parent** tag IDs (all descendants roll up via the tag tree). Beaches is local‑only.

| key | label | Viator parent tags (provisional — validate vs live tree) |
|---|---|---|
| `cruises-water` | Cruises & Water | 21701 (Cruises & Sailing), 20255 (Water Tours), water‑sports parents |
| `adventures-outdoor` | Adventures & Outdoor | 22046 (Adventure Tours), outdoor‑activities parents |
| `tours-sightseeing` | Tours & Sightseeing | Tours & Sightseeing / Day Trips parents (IDs from tree) |
| `food-drink-nightlife` | Food, Drink & Nightlife | 21911 (Food & Drink), nightlife parents |
| `culture-history` | Culture & History | Cultural & Theme Tours parents (IDs from tree) |
| `beaches` | Beaches | *(local picks only — no Viator tag)* |

> The exact parent‑tag IDs per section are **validated against the live `/products/tags` tree during implementation** (the `op=counts` probe already lists ~32 candidate category tag IDs). The set above is the starting point, tuned to what Aruba actually carries. `All` remains a pseudo‑section (no filter).

**Fallback:** any item whose tags roll up to no section is assigned a catch‑all (`tours-sightseeing`) so nothing is ever hidden. The count of such items is logged during the taxonomy refresh (no silent drops).

## Backend — `viator-cards` edge function

### 1. Viator tag tree (cached)
Fetch `/products/tags` (returns `{ tagId, allNamesByLocale/​parentTagIds }`) to get **id → name → parentTagIds**. The tree changes rarely.

- **Cache:** module‑level memo with a TTL (e.g. 24h) inside the function — warm instances reuse it; a cold start pays one fetch. (Upgrade path: a `viator_taxonomy` Supabase table on a daily refresh if cold‑start latency becomes an issue — same caching backbone the region task will want.)
- A pure helper `rollUpToSections(tags: number[], tree, sectionDefs): string[]` walks each tag's parent chain; if any ancestor (or the tag itself) is in a section's parent‑tag set, the item joins that section. Returns the de‑duped section keys.

### 2. Emit `tags` + `sections`
`normalize.ts` already keeps `tags`. `index.ts` currently omits them — emit `tags`, and add `sections: rollUpToSections(it.tags, tree, SECTION_DEFS)` to each item. Group membership is no longer used for categorization (the 4 anchor‑tag searches still gather inventory; cross‑group de‑dup by product id stays).

### 3. Section defs
`SECTION_DEFS` lives **in the function**: `{ key, parentTagIds: number[] }[]` — only the backend needs the parent‑tag rollup. The frontend keeps its own `SECTIONS: { key, label }[]` (labels are a UI concern). The **contract between them is the set of section `key`s** — the backend emits keys, the frontend labels them; the two key lists must agree. Both are small committed constants; a short comment in each points at the other so they don't drift.

## Frontend

### Data model
- `Section` type: `'cruises-water' | 'adventures-outdoor' | 'tours-sightseeing' | 'food-drink-nightlife' | 'culture-history' | 'beaches'`.
- `SECTIONS: { key: Section; label: string }[]` — the new tab source, replacing `CATEGORIES`.
- `ViatorItem` gains `tags?: number[]` and `sections?: string[]`.
- `Activity` gains `sections?: Section[]` (curated editorially for the ~19 picks; `category` stays for display/back‑compat). Beaches picks → `['beaches']`, etc.

### `exploreItems.ts`
- Replace `itemCategory` / `GROUP_TAXONOMY_TO_CATEGORY` with **section membership**: `itemSections(item): Section[]` (from `item.sections`, fallback catch‑all) and `entrySections(entry)`.
- `filterExploreEntries` filters by `opts.section` (`'All'` or a `Section`) via **membership** (`sections.includes(section)`), composed with vibe/price/search as today. Multi‑membership means an item can appear under several tabs.
- Card header shows the item's **primary section label** (first of its `sections`); local picks show their primary section.

### `Explore.tsx`
- Tab bar renders from `SECTIONS` (with `All`) instead of `CATEGORIES`.
- `state.category` → `state.section`. Everything else (sliders, Book now, clickable regions, descriptions) unchanged.

### Itinerary reconcile (`itineraryGenerator.ts`)
- `INTEREST_CATEGORIES` (interest → old categories) becomes **interest → Section[]**.
- `scoreEntry` / `prefCats` operate on section membership instead of the single `category`.
- Local activities contribute their `sections`; Viator group entries (if still used by the itinerary) use the items' `sections`.
- Net: the itinerary scores against the same section taxonomy Explore uses.

## Testing (vitest, TDD the pure logic)

- `rollUpToSections`: a fixture tag tree → correct section keys; multi‑membership (a tag under two section roots yields both); unknown tag → catch‑all; empty tags → catch‑all.
- `itemSections` / `entrySections`: reads `sections`, applies fallback.
- `filterExploreEntries`: section filter is membership‑based (an item in two sections appears under both; `All` shows everything); composes with vibe/price/search.
- Itinerary: interest→section mapping selects the right entries; a multi‑section item is eligible under any of its sections.
- Backend `normalize`/section computation unit‑tested with a fixture tree (no network).

## Rollout

1. Backend: tag‑tree fetch + cache, `rollUpToSections`, emit `tags`+`sections`; deploy `viator-cards`; verify live items carry sensible `sections` (log fallback count).
2. Frontend: `SECTIONS`, section‑based filter, tab bar, header label; itinerary reconcile; types + local‑pick `sections`.
3. Ship behind the usual build; verify on preview (stub gets `sections` too — assign stub items provisional sections for offline parity).

## Risks / open items

- **Provisional section→parent‑tag map** must be validated against the live `/products/tags` tree; tune before shipping.
- **Cold‑start fetch** of the tag tree — start with in‑memory memo; escalate to a cached table only if needed.
- **Stub parity:** assign `sections` to the 20 stub items + 19 local picks so the offline/preview build categorizes correctly.
- **Primary‑section choice** for the header label is order‑dependent — order each item's `sections` by section `displayOrder` so the "primary" is stable/sensible.
