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
  → pin pre-pass                          // claim slots for shortlisted picks
  → day loop (d = 1 … nDays)
      for each slot (morning / afternoon / evening):
        candidatesFor(ctx, slot, tags)    // matchPool + blendPools + refaceForAnswers
        pickForSlot(ctx, slot, …)         // ranked fill ladder
        record pick → update ctx
```

### Context (`Ctx`)

Accumulates trip-wide state across the day loop:

| Field | Purpose |
|---|---|
| `lastUsedDay` | item-id → day number; prevents any id repeating |
| `usedGroupIds` | group-ids retired after first use; prevents booking-option variants repeating |
| `usedTagSets` | Viator tag-ID arrays of placed items; drives semantic dedup (see below) |

### Fill ladder (`pickForSlot`)

Four tiers, best → worst. Every tier is gated by `unused` (trip-wide no-repeat)
and `notSimilar` (tag-based semantic dedup). `kindOk` runs the whole ladder for
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

## Known limitations / open items

- **Same-day cross-slot**: `usedGroupIds` is updated after each slot pick, so
  a group could theoretically appear in morning AND afternoon of the same day
  (both picks are evaluated before either is recorded). Observed as low-risk
  with current catalog size.

- **Tag sparsity**: items with `tags: []` (e.g. stub local activities, or live
  products where Viator returned no tags) bypass semantic dedup entirely and
  rely on `usedGroupIds` + `lastUsedDay` only.

- **Threshold tuning**: `TAG_SIMILARITY_THRESHOLD = 0.35` was set
  conservatively. If the live catalog shows false positives (legitimate variety
  blocked) or false negatives (duplicates still slip through), adjust this
  constant in `itineraryGenerator.ts`.
