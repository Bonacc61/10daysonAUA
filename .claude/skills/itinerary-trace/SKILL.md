---
name: itinerary-trace
description: Make the matching engine explain a slot decision. Use when an itinerary looks wrong — a duplicate or near-duplicate activity, a slot left empty, a pick that ignores the persona, or an activity the user expected that never appeared. Answers "why did the engine do that" without reading the generator.
---

# Itinerary trace

The generator discards candidates for five reported reasons and keeps no record.
Once `generatePlan` returns you have the winners and nothing else — which is why
diagnosing a duplicate historically meant simulating 1000 lines of
`itineraryGenerator.ts` by hand. This makes the engine narrate instead.

## Run it

Always from the repo root (the live catalog key is read from `./.env.production`).

```bash
npm run trace -- --persona adventurer --days 7
```

The live Viator catalog is the default. **Duplicate bugs almost never reproduce
on the offline stub** — it has no Viator tags and no cluster ids, so cluster
dedup, tag-Jaccard and route-family retirement are all inert on it. If the tool
prints `offline stub … — no live catalog` treat the trace as unreliable for any dedup
question and fix the fallback cause first.

### Flags

| Flag | Effect |
|---|---|
| `--persona <name>` | `default`, `foodie`, `adventurer`, `splurge`, `family` |
| `--days N` | trip length (default: the persona's) |
| `--seed N` | regenerate variant; same seed = same plan |
| `--pinned a,b` | simulate shortlisted picks |
| `--why <text>` | **start here for most bugs** — one candidate's fate across the whole trip |
| `--only-open` | just the slots that ended empty |
| `--day N`, `--slot morning` | narrow the output |
| `--verbose` | list every rejection instead of the top 3 per reason |
| `--offline` | force the stub (fast, but see the warning above) |

## Reading the output

```
afternoon  ✓  Arikok National Park 4x4 Jeep Safari   $89  pool 18/21, survivors 10, rung affordable+on-theme
    same kind today          7
        Jet Ski Rental — Palm Beach          kind "sec:cruises-water" already placed today
```

- **pool a/b** — candidates in the matched pool / the widened pool, before dedup.
- **survivors** — cleared every gate but were out-ranked. Not rejections: `ranked`
  put the pick first. Survivors > 0 with an empty slot is impossible.
- **rung** — which rung of the fill ladder fired: `affordable+on-theme` →
  `affordable+widened` → `over-budget+on-theme` → `over-budget+widened` →
  `last-resort`. The last one fires ONLY to stop a day rendering blank, after
  every other rung returned nothing; it takes a FREE card and will repeat one
  rather than leave the day empty. Seeing it means that day had no other card at
  all, so read it as a statement about catalogue depth, not a normal pick.
- **variety gate relaxed** — nothing of a new kind was available, so `newKind` had
  to be dropped. Frequent relaxation means the pool is too thin for the trip length.
- **free-only day** — arrival day of a multi-day trip; the over-budget rungs never
  run, so price is genuinely decisive there. Since 2026-08-17 the same is true of
  EVERY slot on a budget-conscious trip: that tier skips the over-budget rungs at
  any remaining balance — whenever the price exceeds what is LEFT in the pool, not
  only at zero, so a $90 outing is already decisive with $30 remaining. The slot
  then takes a free local or stays open. Those are the only two places price
  decides anything.

### Rejection reasons

| Reason | Rule | Where |
|---|---|---|
| `already placed` | this exact id is elsewhere in the trip | `lastUsedDay` |
| `duplicate experience` | route family, boat day-gap, one-boat-per-day, same-day Jaccard, cluster id, trip-wide Jaccard, or group | `similarReason` |
| `day time budget` | past 8h of daytime activity, or past the 4h evening cap | `DAY_CAP_MIN` / `EVENING_CAP_MIN` |
| `same kind today` | variety gate, first pass only | `entryKind` |
| `over budget` | free-only arrival day, or a budget-conscious trip with its pool spent | `maxPrice === 0 \|\| tags.has('budget')` |

`duplicate experience` always names which of the six rules fired, with the
Jaccard score where relevant — that is usually the whole diagnosis.

## Typical investigations

**"Two near-identical tours on consecutive days."**
`npm run trace -- --persona adventurer --days 7 --why "natural pool"`
Find the day the second one was picked. If the earlier one is absent from that
slot's rejections, no dedup rule saw it — check whether the item has tags and a
cluster id at all (see [tag sparsity](../../../docs/matching-engine/development-log.md)).

**"This slot is empty."**
`npm run trace -- --persona family --days 10 --only-open`
Read the reason counts. A large `day time budget` count means the day is
overbooked upstream, not that the pool is thin.

**"I expected activity X and never got it."**
`--why "<part of the title>"`. If nothing matches at all, it was filtered
*before* the ladder — by slot, a Q8 flag, budget tier, the champion pool
(`MIN_CHAMPION_REVIEWS`), or `isAutoFillExcluded` —
and the trace cannot see it. Check `fitItem` (Viator items), the per-item price
gate in `candidatesFor` (curated locals — `fitItem` takes a ViatorItem and never
sees an Activity), or `applyCatalogFlags`.

## After you fix something

Append a postmortem to `docs/matching-engine/development-log.md` in the existing
symptom / root cause / fix format, and add a regression test to
`src/data/itineraryGenerator.test.ts`. That log is the only record of why the
thresholds are what they are.

## How it works

`generatePlan` takes an optional `onTrace` callback (`src/data/itineraryGenerator.ts`).
When absent — always, in the app — nothing is computed. When present, `pickForSlot`
classifies each candidate **after** the pick, over the same `ctx` state the ladder
just used, so the trace reports the decision that was actually made rather than a
re-simulation of it. `similarReason` returns the reason string and `notSimilar` is
derived from it, so the explanation and the decision can never diverge.
