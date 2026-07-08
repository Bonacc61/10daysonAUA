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

### 2026-07-08 — Cross-group semantic duplicates (`usedTagSets` + tag Jaccard)

**Symptom:** "Ultimate Island Jeep Safari with Natural Pool, Baby Beach &
Lunch" and "Aruba Natural Pool and Indian Cave Rugged Jeep Safari" suggested
on consecutive days.

**Root cause:** These are two distinct Viator products (different product
codes, different groups) that represent the same real-world experience. The
`usedGroupIds` fix only retires within a single group — it cannot detect that
two products from *different* groups are semantically identical.

**Why not title similarity?** Jaccard on title tokens is lexical: "Sunset
Sailing Cruise" and "Evening Catamaran Experience" would score near zero
despite being the same outing. Viator's own tag IDs are a controlled
vocabulary — two jeep-safari products will share specific leaf tags (e.g.
"4WD & Jeep Tours", tag ID 21421) even when their titles diverge.

**Fix:** Added `usedTagSets: number[][]` to `Ctx`. Function `tagJaccard`
computes Jaccard similarity between two tag-ID arrays. Predicate `notSimilar`
in `pickForSlot` skips any Viator candidate whose tag Jaccard against any
already-placed item's tags meets `TAG_SIMILARITY_THRESHOLD = 0.35`. Tags are
pushed to `usedTagSets` whenever a group item is placed (both pins and regular
picks). Local activities (no Viator tags) are unaffected.

**Threshold rationale:** 0.35 means ≥35% tag overlap → same experience.
Two jeep safaris to the Natural Pool share multiple specific tags (4WD/Jeep +
location-adjacent tags), easily exceeding 0.35. A snorkel cruise shares at
most the broad "Outdoor Activities" parent tag with a jeep safari — Jaccard
stays well below 0.35. Threshold is a named constant for easy tuning.

**Test:** `itineraryGenerator.test.ts` — "never places two Viator items with
high tag overlap" — two groups with identical `SHARED_TAGS`, padded with 20
distinct groups; asserts at most one of the two semantic duplicates appears.

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
