# Catalog enrichment — design

**Date:** 2026-08-11
**Status:** Draft — awaiting approval
**Scope:** A committed, human-reviewed snapshot of LLM-derived attributes for live Viator
items, merged into the catalog at load time. Adds a tool under `tools/`, a generated
`src/data/enrichment.json`, one pure merge function in `src/data/activitySource.ts`, and one
line in `activityKind()` (`src/data/itemFit.ts`). No edge-function change, no migration, no
new runtime dependency, no change to storage or the `SlotEntry` contract.

## Problem

The matching engine reasons about a Viator item through two derived values: its **kind**
(`activityKind`) and its **adventure level** (`itemAdventure`). Both are derived from the
item's Viator tag ids, and on the live catalog both are far coarser than the code around
them assumes.

Measured 2026-08-11 against the live catalog via the app's own `loadCatalog()` — 328 items:

| kind | items |
|---|---|
| offroad | 85 |
| **sec:tours-sightseeing** | **74** |
| **sec:cruises-water** | **32** |
| sail | 29 |
| **sec:adventures-outdoor** | **27** |
| kayak | 23 |
| snorkel | 20 |
| **sec:food-drink** | **11** |
| horseback / hike / dive / jetski / sup | 27 |

`activityKind()` recognises the 12 tag families in `KIND_BY_TAG`; everything else falls
through to `sec:<primarySection>`. **144 of 328 items — 43.9% — land in four generic
buckets.** Of those 144, only 40 have a title that plainly states their kind; the other 104
are knowable only from the description prose.

Three consequences, in order of severity:

1. **`entryKind()` (`itineraryGenerator.ts:707`) reads `activityKind` for same-day
   variety.** The engine therefore believes all 74 `sec:tours-sightseeing` products are the
   same kind of thing, and all 32 `sec:cruises-water` products likewise.
2. **The generic buckets are a recurring source of hand-written workarounds.**
   `DAY_SAIL_TITLE_RE` exists because "a dozen real snorkel sails land in the generic
   `sec:cruises-water` bucket — including the 527-review Antilla Shipwreck sail. A splurge
   plan was carrying a catamaran sail plus two of these." The `KAYAK_RE` fallback in
   `routeFamilyOf` is the same wound. Each incident produces another title regex.
3. **`itemAdventure` carries no information beyond kind.** Zero live items have a curated
   `adventure`; all 328 resolve through `adventureFromSections`/`KIND_ADVENTURE` into
   **11 distinct values**, and the counts match the kind counts exactly (85 items at 80 =
   the 85 offroad items; 74 at 30 = the 74 sightseeing items). The Explore Vibe slider —
   which Explore gives a whole panel to — sorts the catalog into chill=134 / balanced=59 /
   adrenaline=135 using a relabelling of the kind taxonomy. Q5's `adventureLevel` band and
   the `mobility` / `with-baby` ceilings read the same value.

Separately, `mobility` and `with-baby` are implemented as adventure ceilings — a number
that means something else standing in for a physical fact about the experience.

**Not a problem:** tag sparsity. The same measurement found **zero** items with `tags: []`
and **zero** without an `experience_cluster_id`. The `docs/ROADMAP.md` entry describing that
fallback path guards a case the live catalog does not contain.

**Not addressed by this design:** catalog size. 72 of 155 eligible experiences clear the
review floor, and the ~300 open slots at 14 days are the day-shape cap working as intended.
Broader Viator taxonomy ingestion remains the fix for distinct-experience variety. This
design does not create inventory.

## Goal

Every item the engine can place carries a real activity kind and a real intensity value,
traceable to a quoted sentence from the operator's own listing, reviewed by a human before
it ships. Physical-demand and kid-suitability signals exist for the first time — able to
narrow a constrained traveller's options, never to promise them anything.

Nothing resolves at runtime. Nothing ships unreviewed. An item without enrichment behaves
exactly as it does today.

## Approach — enrich offline, review the diff, merge at load

This follows the pattern `docs/superpowers/specs/2026-08-03-map-pin-accuracy-design.md`
established for coordinates: **the tool proposes, a human accepts, only accepted data
ships.** It is chosen over enriching inside the `viator-cards` edge function because that
function rebuilds on a *cache miss* (6h TTL, single `catalog_cache` row) — the user whose
request expires the cache would pay for the enrichment, and prod behaviour would change
without a commit.

The feature has two lives that never run at the same time.

### Life 1 — build time, on demand

```
tools/enrich-catalog.ts
  │
  ├─ loadCatalog()          the app's own path, bundled as tools/itinerary-trace.ts is
  ├─ filter                 items surviving isExcludedFromCatalog() only — anything that
  │                          function drops never reaches a surface, so never pay for it
  ├─ diff vs snapshot       skip every product code already enriched
  ├─ Claude, batched        one structured-output call per batch of 20 items
  └─ write                  src/data/enrichment.json, keys sorted, plus a run summary
```

Run via `node tools/run-enrich.cjs` (mirrors `run-trace.cjs` — esbuild bundle with
`--define:import.meta.env`, then node). Requires `ANTHROPIC_API_KEY` in the local
environment; the key never enters the repo, the client bundle, or CI.

### Life 2 — runtime, every page load

```
loadCatalog()  (src/data/activitySource.ts)
  fetch viator-cards  →  items[]
  regroupItems(...)
  normalizePopularity(...)
  mergeEnrichment(items, ENRICHMENT)   ← the one new step
  → Catalog
```

`mergeEnrichment(items, enrichment)` is pure: for each item, look up
`enrichment[item.id]`, attach the accepted fields, return a new array. It sits alongside
the two passes already doing exactly this kind of in-memory work over the same array. No
network call, no await, no new failure branch.

**An unenriched item is not a broken item — it is today's item.** A Viator product that
appears between snapshot runs falls through to the existing heuristics. There is no error
state and no loading state to handle.

## The snapshot — `src/data/enrichment.json`

Generated data, not hand-edited. JSON rather than a TypeScript module for that reason; if a
value needs overriding by hand, that belongs in a curated override map in TS that wins over
the snapshot — deliberately out of scope until a real disagreement appears.

```json
{
  "8936P1": {
    "kind": "sail",
    "adventure": 35,
    "physical": { "demand": "low", "mobility_ok": true },
    "kids": { "min_age": 4, "baby_ok": false },
    "confidence": "high",
    "evidence": "relaxing catamaran cruise… snorkel stop with ladder access"
  }
}
```

`kind` is drawn from exactly the `KIND_BY_TAG` vocabulary — `offroad`, `snorkel`, `dive`,
`jetski`, `kayak`, `sup`, `parasail`, `surf`, `sail`, `hike`, `horseback`, `zipline` — plus
`null` when none fits. A value outside that set is a schema violation, not a new kind.

`mergeEnrichment` writes the accepted fields onto the item under explicit names, so nothing
in the engine has to know the snapshot's shape:

| snapshot key | field on `ViatorItem` | read by |
|---|---|---|
| `kind` | `enriched_kind?: string` | `activityKind()` |
| `adventure` | `adventure?: number` (the existing optional field) | `itemAdventure()` |
| `physical` | `physical?: { demand, mobility_ok }` | `applyCatalogFlags` (`mobility`) |
| `kids` | `kids?: { min_age, baby_ok }` | `applyCatalogFlags` (`with-baby`) |
| `evidence` | `evidence?: string` | UI only, verbatim |

`confidence` is consumed at merge time and never reaches `ViatorItem` — a field that fails
its tier's threshold is simply not attached.

Two fields are not attributes and matter as much as the ones that are:

- **`confidence`** — how the authority tiers below are enforced.
- **`evidence`** — a **verbatim** span from the product's `description`. It is what makes
  the diff reviewable: the reviewer is not asked to trust `"mobility_ok": true`, they are
  shown the sentence it came from. It is also the only thing that may be rendered to a
  traveller (see Tier 2).

## Authority tiers

### Tier 1 — internal ranking signals: `kind`, `adventure`

Full authority. The worst case for a bad value is a mediocre pick, which the swap button
already handles.

**`kind` fills the gap and never overrides.** `KIND_BY_TAG` resolves 184 items from real
Viator tags and is measured; enrichment speaks only where `activityKind()` would have
returned `sec:`:

```ts
export function activityKind(item: ViatorItem): string {
  const tags = new Set(item.tags ?? []);
  for (const [ids, kind] of KIND_BY_TAG) if (ids.some((t) => tags.has(t))) return kind;
  if (item.enriched_kind) return item.enriched_kind;        // ← new
  return `sec:${primarySection(itemSections(item))}`;
}
```

Blast radius is exactly the 144 generic-bucket items; the 184 tag-resolved items do not
move. `DAY_SAIL_TITLE_RE` and the `KAYAK_RE` branch of `routeFamilyOf` stay in place for
this change — they are harmless once kind is right, and retiring them is a separate,
separately-verified pass.

**`adventure` overrides.** The `KIND_ADVENTURE` table it replaces is an uncurated fallback
with no measurement behind it. Enrichment wins wherever present.

`itemAdventure` currently carries safety weight, because `mobility` and `with-baby` are
implemented as ceilings on it. Tier 2 is what keeps replacing it from being risky.

### Tier 2 — may filter, never promise: `physical`, `kids`

**Engine.** These become the real signal behind the `mobility` and `with-baby` flags, so
those flags stop using an intensity number as a proxy for a physical fact.

**The invariant: enrichment may only narrow, never widen.**

- `mobility_ok: false` **adds** an exclusion for a traveller who ticked `mobility`.
- `mobility_ok: true` **lifts nothing.** Existing ceilings stay exactly as they are.
- `kids` behaves identically with respect to `with-baby` and the Family group types.

The worst case is that a constrained traveller sees a slightly smaller pool than they could
have. Nobody is turned away at a dock because a model was confident about a marketing
blurb.

This is a real cost, honestly stated: travellers with mobility constraints or a baby have
the fewest options already, and the widening direction is where the largest UX win for them
lives. It is deferred until the extraction's measured error rate makes it a decision backed
by evidence rather than optimism.

**UI.** No badges. No "wheelchair accessible", no "great with toddlers". Where this data
surfaces at all, **the `evidence` string renders verbatim, attributed to the listing**:

> The operator's listing says: *"short, flat walk from the parking area; no climbing
> required."*

Not a paraphrase — a paraphrase is the site's own voice making a claim, which is the
category `CardBack.tsx` already refused for ratings. This way a bad extraction produces a
visibly irrelevant quote rather than a confident falsehood. **No evidence quote, no copy** —
silently. Absence of data is never rendered as anything.

### Confidence gating

|  | tier 1 (`kind`, `adventure`) | tier 2 (`physical`, `kids`) |
|---|---|---|
| `high` | used | used |
| `medium` | used | **dropped at merge** |
| `low` | dropped | dropped |

Dropped means the field is not written into the snapshot at all, and the item falls back to
today's behaviour. There is no third state to handle.

## The extraction call

Model **`claude-opus-5`**, via `@anthropic-ai/sdk` (a devDependency — the tool is the only
consumer, and it never reaches the client bundle). Structured output via
`client.messages.parse()` with `output_config.format` and a Zod schema, so the model is
constrained to the field set and the `kind` enum rather than asked politely for JSON.

Input per item: `title`, `description`, and the item's Viator tag ids. Batched 20 items per
call to amortise the instructions; `max_tokens` sized with headroom, since thinking is on
by default on this model and counts against the same cap.

Cost, for the record: ~328 items at roughly 300 input / 150 output tokens each is on the
order of **$2 for a full rebuild** at $5/$25 per Mtok, and near zero for incremental runs.
The Batch API would halve that at the cost of an async polling loop; not worth the
complexity at this volume. Cost is not a design constraint here — review time is.

## Verification

### 1. Golden set, before anything ships

Hand-label **40 items stratified across the four generic buckets** (18 sightseeing, 8
cruises-water, 8 adventures-outdoor, 6 food-drink): kind, an adventure band, mobility-ok,
kids-ok. The tool reports per-attribute agreement against those labels.

The narrowing-only invariant makes this gate deliberately lopsided:

- **`kind` gets a hard gate** — it moves the generator. ≥90% agreement before shipping, and
  every disagreement read.
- **`physical` / `kids` filtering barely needs one.** Since `true` lifts nothing, the only
  value that acts is `false`, and a wrong `false` costs one option out of many.
- **`adventure` gets a sanity gate, not a precision one** — nothing gentle above 80, nothing
  strenuous below 25. The middle need not be exact; it is an ordering signal.

### 2. Tests take their own enrichment map

`mergeEnrichment` takes the map as a parameter. `loadCatalog()` passes the real snapshot;
tests pass a small fixture over the stub items. Nothing in the suite reads
`enrichment.json`, so a re-run can never turn the suite red — or, worse, green.

### 3. Before/after plan diff

Run `tools/itinerary-trace.ts` before and after the merge across its five personas, seeds
0–5, at 14 days — the same harness that produced the roadmap's ~300–350 open-slot baseline
(measured 2026-08-05).

- **Expected to change:** which items land. 144 items getting real kinds *should* move
  plans. That is the feature.
- **Expected to improve:** same-day near-duplicates. Two `sec:tours-sightseeing` products on
  one day were invisible to `entryKind` and are catchable now.
- **Expected to hold:** the curation rules (one kayak, one daytime sail, one evening cruise
  per trip) and the day shape. These are invariants, not outcomes.
- **Watch:** open-slot count. A jump well past ~350 means finer kinds are over-suppressing —
  74 items splitting into a dozen real kinds gives the dedup rule *more* distinctions to
  reject on. This is the main risk in the design, which is why the diff runs before the
  snapshot is committed rather than after.

### 4. Generator test failures get sorted, not silenced

Some of the 1,848 lines of generator tests encode current bucket behaviour and will fail.
**A test that fails because a real item's kind changed gets its fixture updated; a test that
fails because a rule stopped holding is a bug.** Every failure goes in one of those two
piles, and a rule failure is never fixed by editing the assertion.

### 5. Numbers the tool prints every run

```
kind resolved:        184/328 (56.1%)  →  328/328 (100%)
distinct adventure values:      11     →  47
snapshot: 328 items, 46KB raw / 14KB gzipped
new: 328   changed: 0   dropped: 0
```

`changed` on an existing product code is the suspicious number — a product's kind should not
move — and is flagged separately from `new`.

## Staging

**v1 ships:** `kind`, `adventure`, `physical`, `kids`.

**Deferred — region.** `docs/map/viator-location-probe.md` found Viator ships no destination
data at all (0 of 20 products carried an itinerary POI), but 14 of 20 carry free-prose
`logistics.start` meeting text — "our address is Bucutiweg #34 or if using GPS, it is easier
to locate The Fish House Restaurant at Varadero Marina". That prose is a far better input
for region than the description, and it is not in the catalog payload today; it came from a
temporary `op=locations` probe. Region enrichment therefore starts with getting meeting text
into the payload, and is its own piece of work.

**Deferred — seasickness/open-water exposure, indoor/outdoor, cluster labels.** Real, not
scoped here.

**Deferred — the widening direction for tier 2**, pending measured extraction quality.

**Deferred — retiring `DAY_SAIL_TITLE_RE` and the `KAYAK_RE` branch.** Correct once kind is
right; needs its own before/after diff.

**Deferred — a scheduled GitHub Action.** `deploy.yml` already provides the machinery, and a
weekly job that runs the tool and opens a PR would automate the *running* while keeping the
human gate on the *merging*. Whether it is worth the surface area depends on how fast Viator
products churn, which nobody has measured. The tool's second run reports exactly that
number (`new` / `changed` / `dropped`), so the decision costs a week of waiting and nothing
else.

## GDPR

No personal data is involved. The enrichment input is Viator product listings — public
commercial copy — and the tool runs on a developer machine, not in the app. No new
processing of user data, no new sub-processor in the request path, and therefore **no
`src/pages/Privacy.tsx` change**. `ANTHROPIC_API_KEY` lives in the local environment only;
it must never appear in client code, in the repo, or in an edge function, exactly as
`SERVICE_ROLE_KEY` must not.
