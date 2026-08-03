# Matching Engine — Development Log

## Architecture overview

The matching engine lives in `src/data/itineraryGenerator.ts` and builds a
`Day[]` from questionnaire answers + catalog in a single deterministic pass.
Supporting modules:

| File | Role |
|---|---|
| `src/data/matcher.ts` | `matchPool` / `blendPools` — tag-based pool filtering |
| `src/data/itemFit.ts` | `fitItem` / `refaceForAnswers` / `isEveningItem` — per-item scoring + TOD |
| `src/data/answerTags.ts` | `answersToTags` — questionnaire → `MatchTag[]` |
| `src/data/activitySource.ts` | `getCatalog` — merges stub catalog with live Viator data |
| `src/data/activities.ts` | Stub local activities + `SAMPLE_ITINERARY` (Landing preview only) |
| `src/types.ts` | `ViatorGroup`, `ViatorItem`, `MatchTag`, `Slot`, `Section` |

### Pipeline (one call to `generatePlan`)

```
answersToTags(answers)
  → applyCatalogFlags(catalog, flags)     // no-boats / mobility / intense-hikes
  → isAutoFillExcluded + championsByExperience   // one well-reviewed champion per experience
  → pin pre-pass                          // claim slots for shortlisted picks
  → day loop (d = 1 … nDays)
      for each slot (morning / afternoon / evening):
        candidatesFor(ctx, slot, tags)    // matchPool + blendPools + refaceForAnswers
        pickForSlot(ctx, slot, …)         // ranked fill ladder
        record pick → update ctx
  → en-route food post-pass               // appends a lunch stop; NOT time-budgeted
```

### Context (`Ctx`)

Accumulates trip-wide state across the day loop:

| Field | Purpose |
|---|---|
| `lastUsedDay` | item-id → day number; no id repeats, except a free local `Beaches` activity, which may return after `REVISITABLE_MIN_DAY_GAP` (2) clear days — unless the traveller pinned it |
| `pinnedIds` | ids the traveller pinned; exempt from the beach-revisit allowance, so a pinned pick is placed exactly once |
| `usedClusterIds` | embedding clusters placed; a hit is conclusive, a miss falls through |
| `usedTagSets` | tag arrays of placed items; trip-wide Jaccard at 0.35 |
| `dayTagSets` | tag arrays placed TODAY, reset per day; stricter Jaccard at 0.08 |
| `usedRouteFamilies` | one off-road circuit, and one Conchi visit, per trip |
| `lastFamilyDay` | family → last day used; enforces FAMILY_MIN_DAY_GAP (boat outings) |
| `usedGroupIds` | last-resort group dedup; only for items with neither tags nor a cluster |
| `dayFamilies` | families placed TODAY; hard cap of one boat outing per day |
| `day` / `nDays` | current day and trip length; day-level eligibility (Conchi avoids the first and last day on trips longer than 2 days) |
| `trace?` | opt-in diagnostic callback; undefined in the app |
| `groupById` | group lookup for per-item candidates |

### Fill ladder (`pickForSlot`)

Four tiers, best → worst. Every tier is gated by `unused` (no id repeats, except a free local beach after a 2-day gap),
`notSimilar` (semantic dedup) and `feasible` (day/evening time budget); when
`maxPrice === 0` (the free-only arrival day) it returns before tiers 3-4. `kindOk` runs the whole ladder for
variety-introducing picks first, then relaxes for same-kind picks:

1. Affordable + on-theme
2. Affordable + widened (any slot)
3. Over-budget + on-theme
4. Over-budget + widened

When all tiers are exhausted the slot stays open ("Drop an activity here").

---

## Bug log

### 2026-07-06 — Submarine 5× duplicate (`usedGroupIds`)

**Symptom:** "Atlantis Submarine Tour" appeared on 5 consecutive days.

**Root cause:** The generator tracked used *item* IDs (`lastUsedDay`) but not
*group* IDs. The Atlantis group carries multiple booking-option items (adult,
child, 45-min, 65-min) with distinct product codes. Each day a different item
passed the dedup check — same real-world experience, five different IDs.

**Fix:** Added `usedGroupIds: Set<string>` to `Ctx`. Both paths in
`candidatesFor` filter `!ctx.usedGroupIds.has(g.id)`. When any item from a
group is placed, `ctx.usedGroupIds.add(group.id)`. Covered by the "fills
evening every day" test (rewritten to use 10 distinct groups × 1 item each).

---

### 2026-07-06 — Day 1 paid tours (`freeOnly`)

**Symptom:** Arrival day included full-price Viator tours.

**Root cause:** No arrival-day rule existed; the generator treated day 1 the
same as any other day.

**Fix:** `freeOnly = nDays > 1 && d === 1`; `maxP = freeOnly ? 0 : budgetLeft`.
Single-day trips are exempt. Pinned picks bypass the rule.

---

### 2026-07-06 — Wrong TOD slots in `SAMPLE_ITINERARY`

**Symptom:** "Dinner at Gasparito" appeared in the afternoon slot.

**Root cause:** The generator's TOD filtering (`matchPool`, `refaceForAnswers`)
is correct. The bug was in the hardcoded `SAMPLE_ITINERARY` array in
`activities.ts`, used only for the Landing page preview (days 1–2). Four
activities had wrong slot assignments:
- `natural-pool-jeep` (Morning) placed in afternoon
- `zeerovers` (Afternoon) placed in evening
- `baby-beach-snorkel` (Morning) placed in afternoon
- `kitesurfing-lesson` (Afternoon) placed in morning

**Fix:** Corrected all four slot assignments in `SAMPLE_ITINERARY`. Engine
logic untouched.

---

### 2026-07-08 — Cross-group semantic duplicates: tag Jaccard (initial fix)

**Symptom:** "Ultimate Island Jeep Safari with Natural Pool, Baby Beach &
Lunch" and "Aruba Natural Pool and Indian Cave Rugged Jeep Safari" suggested
on consecutive days.

**Root cause:** Two distinct Viator products (different codes, different
groups) representing the same real-world experience. `usedGroupIds` only
retires within a single group — it cannot detect cross-group semantic
duplicates.

**Why not title similarity?** Jaccard on title tokens is lexical: "Sunset
Sailing Cruise" and "Evening Catamaran Experience" score near zero despite
being the same outing. Viator's own tag IDs are a controlled vocabulary.

**Initial fix (shipped, now superseded as fallback):** `tagJaccard` on Viator
tag-ID arrays; `TAG_SIMILARITY_THRESHOLD = 0.35`. Catches obvious duplicates
but still has a ceiling: two products from different operators describing
identically-named tours can have divergent tag sets if Viator categorised them
differently.

---

### 2026-07-08 — Cross-group semantic duplicates: embedding clustering (primary fix)

**Why embeddings beat tag Jaccard:** Tag IDs are a controlled vocabulary but
inconsistently applied — Viator may tag two identical-experience products with
different leaf tags. Sentence embeddings encode *meaning*, not surface form, so
"Natural Pool Rugged Jeep Safari" and "Ultimate Island Jeep Safari with Natural
Pool" cluster together even with zero token or tag overlap.

**Architecture:** Embeddings are computed **at ingest time** inside the
`viator-cards` edge function, not at plan time. Only a cluster ID string ships
to the browser — no vectors in the client payload.

**`supabase/functions/viator-cards/embeddings.ts`** (new file):
- `activeProvider()` — checks env vars, returns `'openai' | 'voyage' | null`
- `embedBatch(texts)` — routes to the active provider
- `clusterByEmbedding(ids, embeddings, threshold)` — greedy O(n²) cosine
  clustering; items sorted by rating desc so the best product founds each
  cluster

**Provider router** (cheapest-first, no quality compromise for short texts):

| Priority | Provider | Model | Price | Dims |
|---|---|---|---|---|
| 1 | OpenAI | `text-embedding-3-small` | $0.02 / M tokens | 256 (reduced) |
| 2 | Voyage AI | `voyage-3-lite` | $0.02 / M tokens | 512 |

Set `OPENAI_API_KEY` **or** `VOYAGE_API_KEY` as a Supabase secret. If neither
is set the edge function logs a warning and items ship without cluster IDs —
the generator falls back to tag Jaccard automatically.

**Cost per ingest cycle (~400 items × ~50 tokens = ~20k tokens):**
≈ $0.0004 per sync. Cache TTL is 6 hours so worst-case cost is ~$0.002/day.
**Zero additional cost per user or per itinerary** — embeddings run once at
ingest, not once per plan.

**`experience_cluster_id` on `ViatorItem`:** assigned by the edge function;
items sharing an id are the same real-world experience. The cluster founder is
the highest-rated product in the cluster.

**Generator changes (`Ctx`):**
- `usedClusterIds: Set<string>` — retired when any cluster member is placed
- `notSimilar` predicate: checks `usedClusterIds` first (primary); falls back
  to tag Jaccard when `experience_cluster_id` is absent (no embedding run)

**Clustering threshold:** cosine similarity ≥ 0.88 → same experience.
Empirically, near-identical experiences score 0.92–0.98; clearly distinct
activities (hiking vs snorkelling) score < 0.70. Constant is named
`EMBEDDING_CLUSTER_THRESHOLD` in `index.ts` for easy tuning.

**Activation steps (one-time):**

1. Get an API key — either:
   - **OpenAI:** platform.openai.com → API keys → Create new secret key
   - **Voyage AI:** voyageai.com → sign up → API keys (Anthropic-backed, same price)

2. Set the secret in Supabase:
   ```bash
   supabase secrets set OPENAI_API_KEY=sk-...
   # or
   supabase secrets set VOYAGE_API_KEY=pa-...
   ```

3. Redeploy the edge function:
   ```bash
   SUPABASE_ACCESS_TOKEN=$(cat /root/.supabase_token) supabase functions deploy viator-cards
   ```

4. Verify it worked — the function logs:
   `[viator-cards] openai: 400 items → N experience clusters`
   Check Supabase dashboard → Edge Functions → viator-cards → Logs.

Until step 3 is done the function falls back silently to tag Jaccard dedup.
No frontend changes needed — cluster IDs flow through the existing catalog
response automatically.

**Tests:** `itineraryGenerator.test.ts`:
- "never places two items sharing an experience_cluster_id" — primary path
- "never places two Viator items with high tag overlap" — Jaccard fallback path

---

## Current state — embedding clustering

Present-tense. The dated entries above are records of what was built on the day;
where they disagree with this section, this section wins.

- **It is live.** Verified 2026-08-02 against the live `viator-cards` payload:
  all 361 items carry an `experience_cluster_id` (172 clusters). `index.ts`
  sets that field only inside `if (provider)`, so a provider secret is set and
  clustering runs on every ingest. The activation checklist in the 2026-07-08
  entry is done.
- **Threshold is `EMBEDDING_CLUSTER_THRESHOLD = 0.82`** (in `index.ts`), not the
  0.88 quoted in the July entry. Rationale is in the code comment: two
  Natural-Pool jeep safaris embed at ~0.83, two sunset dinner cruises at ~0.89,
  while genuinely distinct pairs sit at ~0.56–0.60.
- **The algorithm is union-find, not greedy founder-based.** `clusterByEmbedding`
  builds a parent array and unions any pair over threshold; the lowest index
  (highest rating) stays root. Greedy single-pass was the failure mode it
  replaced — two jeep safaris at 0.83 could attach to different founders and both
  survive.
- **Cluster dedup and tag Jaccard are layered nets.** `similarReason` checks
  `usedClusterIds` first; a hit is conclusive, a MISS falls through to tag
  Jaccard. Making the cluster authoritative either way was tried and reverted —
  `championsByExperience` already allows one item per cluster into the pool, so
  `usedClusterIds` almost never fires there, and different option codes of one
  base product get different cluster ids (2455SUB vs 2455SEMI). Jaccard does
  nearly all the real work on live data.

### What actually limits plan variety (measured 2026-08-02)

Over-clustering was the first suspect and it is **not** the main constraint.
Measured over 45 plans (5 personas × 7/10/14 days × 3 seeds) against the live
catalog through the real `loadCatalog()` pipeline, disabling cluster dedup
entirely recovers only ~16 slots and 14 products. Ranked by actual cost:

1. **The auto-fill pool rule** — dominant. The old within-budget-tier popularity
   percentile ranked *items* and was blind to experience structure: it kept many
   redundant variants of popular experiences while deleting whole experiences
   whose members were all modestly reviewed. It wiped **96 of 161 distinct
   experiences entirely**. Replaced by `championsByExperience` (below).
2. **Catalog size** — still the ceiling on *distinct* Viator experiences. 72 of
   155 eligible experiences (retail, photo services and self-drive vehicle hire
   excluded) have a member with 25+ reviews, giving a champion pool of ~81, and
   no-repeat dedup retires a cluster on first use. Open slots are no longer the
   symptom: since free local beaches became revisitable
   (`REVISITABLE_MIN_DAY_GAP = 2`) a 14-day trip fills every ladder slot on all
   five personas (measured 2026-08-03; the same runs before the change left 5-9
   open). What stays thin is the number of distinct Viator experiences — an
   ingestion problem; no constant fixes it.
   problem; no constant fixes it. (An earlier draft of this section said "~50",
   which conflated experiences *surfaced in plans* with experiences *available
   in the pool* — the pool figure is 81.)
3. **Cluster dedup** — third. Real but modest.

The pool sweep, same 45 plans:

| pool rule | open | experiences | mean rating | <25 reviews |
|---|---:|---:|---:|---:|
| percentile floor 0.6 (was live) | 343 | 44 | 4.69 | 10 of 59 |
| champion by raw rating | 207 | 89 | 4.35 | 41 of 93 |
| champion by shrunk rating, no gate | 244 | 83 | 4.40 | 38 of 87 |
| **champion + 25-review gate (shipped)** | **327** | **57** | 4.63 | 8 of 61 |
| champion + 50-review gate | 328 | 40 | 4.75 | 0 of 44 |

Two results worth keeping:

- **Bayesian shrinkage barely helps on its own** (row 2 → row 3). The problem is
  not picking the wrong member of a cluster; most clusters contain no
  well-reviewed member at all, so any champion of a thin cluster is thin. The
  absolute review gate is what does the work.
- **The big variety numbers are unreachable at acceptable quality.** 89
  experiences requires accepting 44% thinly-reviewed products. Of the 96
  experiences the old floor wiped, only ~6 clear a 25-review bar.

Method note: measure through `loadCatalog()`, not the raw edge-function payload —
the app filters transport-only items, regroups, and runs `normalizePopularity` at
load. Probing the raw payload makes the popularity floor look inert (it is not)
and mutating `popularity_score` to disable it also zeroes the ranking bonus in `itemFit.ts`
(`score += (item.popularity_score ?? 0) * 3`). The only clean lever is the pool rule itself.

### Cluster sizes (context, not the headline)

Union-find is transitive, so A~B and B~C merge A and C even when A and C are far
apart. Post-transport-filter the catalog is ~334 items in 161 clusters, sizes
73, 23, 15, 12, 9, 7, 7, 6 … 136 singletons. The 73-item cluster mixes
small-group UTV, private jeep and 4x4 Natural-Pool tours. Worth revisiting
`EMBEDDING_CLUSTER_THRESHOLD` eventually, but it ranks behind the two above.

To inspect: `npm run trace -- --persona adventurer --days 14 --verbose`, then grep
`experience cluster`. On a 14-day adventurer plan the rules now fire roughly
323 (tag Jaccard) / 110 (route family) / 12 (cluster), plus ~385 same-day
Jaccard and ~149 boat day-gap — the two newer rules sit earlier in the chain
and take counts that used to fall to Jaccard. Cluster fires rarely BY
DESIGN: `championsByExperience` has already admitted only one item per cluster
to the pool, so tag Jaccard is the net actually catching duplicates — which is
why making the cluster authoritative removed dedup almost entirely.

Note that rejection *counts* measure how often a rule fires, not what it costs —
a rule can fire constantly and cost nothing while alternatives remain.

## Known limitations / open items

- **Same-day cross-slot**: two items from one Viator group can land on the same
  day. Not a recording-order problem — the day loop records each pick's group,
  cluster and tags immediately, before the next slot is filled. The gap is that
  `similarReason` consults `usedGroupIds` ONLY for items with neither tags nor a
  cluster id, so two tagged items from one group are caught only if Jaccard clears
  a threshold — `SAME_DAY_SIMILARITY_THRESHOLD` (0.08) within one day, or
  `TAG_SIMILARITY_THRESHOLD` (0.35) across the trip. Observed as low-risk at current catalog size.

- **Tag sparsity**: items with `tags: []` (e.g. stub local activities, or live
  products where Viator returned no tags) bypass semantic dedup entirely and
  rely on `usedGroupIds` + `lastUsedDay` only.

- **Threshold tuning**: `TAG_SIMILARITY_THRESHOLD = 0.35` was set
  conservatively. If the live catalog shows false positives (legitimate variety
  blocked) or false negatives (duplicates still slip through), adjust this
  constant in `itineraryGenerator.ts`.
