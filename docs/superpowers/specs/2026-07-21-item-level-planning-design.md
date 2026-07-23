# Item-level itinerary planning — design

**Date:** 2026-07-21
**Status:** Approved for planning
**Scope:** Layer A (the generator, `src/data/itineraryGenerator.ts`) only. No storage,
display, or swap-flow changes.

## Problem

The itinerary generator plans **by Viator group**, a structural unit inherited from
the Explore page's category cards, not from any need of the itinerary engine. Two
consequences of the group being load-bearing in planning:

1. **Face-collapse (the buried ATV).** `candidatesFor` → `blendPools` →
   `refaceForAnswers` collapses each group to a single "face" item. Only one item per
   group ever competes for a slot. A cheap ATV that is mis-filed into `sailing-cruises`
   loses that group's single face to a catamaran and never surfaces, even though it
   would out-score most candidates on its own merits.
2. **Coarse dedup → bolt-on hacks.** Once any item is placed, `usedGroupIds` retires
   the **whole group** for the trip. This is so blunt it forced two workarounds: the
   premium-splurge exemption (to let a private charter *and* a Jolly Pirates cruise
   both land — both are `sailing-cruises`) and the route-family set (to stop two
   off-road tours). Both patch a granularity problem.
3. **Mislabel propagation.** Because the group label drives planning, a bad label
   (ATV → sailing) corrupts the plan, not just the display.

Embeddings were activated this week but are currently a bolt-on: `experience_cluster_id`
is only a *secondary* dedup check inside a still-group-shaped pipeline. This design
makes the item the planning unit and the embedding cluster the dedup unit.

## Confirmed facts (from code)

- **Clustering is global.** `clusterByEmbedding` (viator-cards edge fn) runs union-find
  over cosine similarity across the **entire** item list, not per-group. A mis-filed
  ATV genuinely co-clusters with real ATVs across group boundaries. Cluster id = the
  highest-rated member's id.
- **Cluster ids can degrade.** When no embedding provider key is set, or the embedding
  API call throws, the `catch` block ships each item with
  `experience_cluster_id = <its own raw product code>` (every item its own cluster).
  The browser cannot distinguish a real cluster from a degenerate one. Therefore the
  **tag-Jaccard fallback in `notSimilar` must stay** as the graceful-degradation net.
- **`CardEntry` carries the item + its group.** The `{ kind: 'group', group, bestSeller,
  others }` shape already holds a single item (`bestSeller`) plus its group. Item-level
  planning reuses this shape verbatim: one candidate per item, `bestSeller` = that item.
- **The persisted contract is `SlotEntry = {groupId, bestSellerId}`.** Derivable from
  the chosen item (`item.group_id`, `item.id`), so **no storage or display change is
  required** — the generator keeps emitting the same `SlotEntry`.
- **Nothing in the generator reads `CardEntry.others`.** `scoreEntry`, `entryKind`,
  `entryCoord`, `notSimilar`, `routeFamilyOf`, `toSlotEntry` all read only
  `bestSeller`/`group`. Display rebuilds `others` from the catalog in `resolveSlotEntry`.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | **Generator only.** `SlotEntry`, `resolveSlotEntry`, swap "other suggestions", and Explore are all untouched. |
| 2 | Off-road dedup | **Keep the route-family net** (`routeFamilyOf`). One off-road tour per trip regardless of whether jeep/UTV/ATV variants co-cluster at the 0.82 threshold. |
| 3 | `matched_by` editorial signal | **Read via `item.group_id`.** `scoreEntry` already reads `e.group.matched_by`; no data migration. Groups become a per-item metadata attribute. |
| 4 | tag-Jaccard fallback | **Keep as fallback.** Cluster is the dedup unit; tag-Jaccard rides underneath for when the embedding step is absent/fails. |
| 5 | Premium-splurge pre-pass | **Keep it.** It still does a job item-level fill does not: guarantee an aspirational splurge (+ "Signature splurge" badge) for money-no-object travellers, whom score-based fill would otherwise skew toward cheap crowd-pleasers. Only its stale "exempt from group-dedup" comments are updated. |

## Design

### Chosen approach (of three considered)

- **A — New item-level candidate builder in the generator; leave `blendPools` /
  `refaceForAnswers` / `matchPool` untouched for the swap path.** *(chosen)* Surgical;
  the swap flow keeps calling the existing group-level helpers, so only the generator
  switches to items.
- B — Generalize `blendPools`/`refaceForAnswers` to emit per-item, shared by generator
  and swap. *Rejected:* touches the swap flow = out of "generator only" scope, riskier.
- C — Add an `expandToItems` post-step after the group-card pipeline. *Rejected:* hacky
  layering that collapses to faces then undoes it.

### The candidate builder

Replace `candidatesFor`'s use of `blendPools` + `refaceForAnswers` with a builder that
emits **one `CardEntry` per item**:

- **Items:** for each item in `ctx.catalog.items`, keep it iff
  `itemSlotOk(item, slot)` **and** `!fitItem(item, ctx.tags).rejected`. The budget guard
  always uses the real answers (`ctx.tags`), even in the widened pool — widening
  relevance must never resurface an unaffordable item (today's rule, preserved).
  Wrap each survivor as `{ kind: 'group', group, bestSeller: item, others: [] }` where
  `group` comes from a `Map<groupId, ViatorGroup>` built once. Items whose `group_id`
  is not in the catalog's groups are dropped (data-integrity guard, mirrors
  `blendPools`'s current best-seller guard). `others` is left empty — see facts above.
- **Matched vs widened relevance:** preserve today's signal.
  - *Matched* pool (`useTags = ctx.tags`): items whose **group's `matched_by`** overlaps
    the answers — the same filter `matchPool` applies at group level, now per item via
    `item.group_id`.
  - *Widened* pool (`useTags = null`): all slot-ok + fit-ok items regardless of group
    relevance.
- **Local activities:** unchanged. Keep flowing through `matchPool` (matched) / the
  time-of-day filter (widened) exactly as today, appended to the item candidates.

`CardEntry` is unchanged, so `toSlotEntry` still yields `{groupId, bestSellerId}`.

### Dedup

- **Remove `usedGroupIds` from `candidatesFor`** (no more whole-group candidate
  filtering) — planning is item-level.
- **`notSimilar` becomes the primary dedup**, per item, in this hierarchy:
  `experience_cluster_id` → tag-Jaccard → **group (last resort)** → route-family.
- **No regression on booking-variants.** Adult/child/45-min variants of one product
  share a cluster (or Jaccard ≈ 1.0), so `notSimilar` still blocks them. Genuinely
  different same-group items (charter vs Jolly Pirates) are now *allowed* — the
  intended behavior change.

> **Amendment (2026-07-21, during execution):** The original design said to *delete
> `usedGroupIds` entirely*. Execution surfaced that it was quietly doing a second job:
> deduping items that have **no cluster id AND no tags** — the state of every item in
> the hand-written stub (the shipped offline fallback) and thin catalogs. With no
> signal, item-level `notSimilar` had nothing to compare, so near-duplicates (e.g. all
> five stub sailing cruises) all landed. **Resolution:** keep `usedGroupIds` but demote
> it to the *last-resort* dedup signal — consulted in `notSimilar` **only** when an item
> has neither a cluster id nor tags. Signal-bearing items still dedup by cluster/tag, so
> two genuinely different same-group items still co-exist. The premium pre-pass still
> does **not** add to `usedGroupIds` (so a splurge + a crowd-pleaser cruise both land).
> This preserves the goal (item-level, cluster-primary dedup); it only fixes the
> degenerate no-signal case.

### Premium-splurge pre-pass

Kept as-is functionally. Update the comments that justify it by "group-dedup" (which no
longer exists) to state its real remaining job: guaranteeing an aspirational pick that
score-based fill would not reliably surface for a money-no-object traveller. Its internal
`bestPerGroup` pre-filter and `usedPremiumClusters` dedup continue to work under
item-level fill (marks item id + cluster used; different clusters still both land).

### What is explicitly NOT changing

- `SlotEntry` shape and localStorage contract.
- `resolveSlotEntry`, `otherItemsInGroup`, `itemsInGroup` — swap "other suggestions"
  still shows same-*group* items (a possible separate follow-up: same-cluster).
- `blendPools`, `refaceForAnswers`, `matchPool` — retained for the swap flow and tests.
- Explore page and its group category cards.
- The edge function / ingest / embeddings.

## Testing

Fixtures in `itineraryGenerator.test.ts` are almost all one-item-per-group, so group-
and item-dedup are observationally identical there — those tests pass unchanged. The
existing cluster-dedup test ("never places two items sharing an experience_cluster_id")
stays green.

New coverage to add (the multi-item-per-group cases the old model could not express):

1. **Buried candidate surfaces.** A group whose best-scoring face is item X, but which
   also contains a higher-merit item Y for the given answers, must be able to place Y —
   Y is no longer buried behind X's single face.
2. **Two different items from one group both land.** A charter and a Jolly Pirates
   cruise (same group, different clusters, both in budget/relevance) can both appear on
   different days — previously blocked by `usedGroupIds`.
3. **Same-cluster items still deduped.** Two items in one group sharing a cluster id
   (or tag-Jaccard ≥ threshold) still never both appear.
4. **Route-family still enforced.** Two off-road tours (different clusters) still yield
   at most one per trip.

Run `npm test` — all existing generator, itemFit, matcher, e2e-engine, and
engineCoverage suites must stay green.

## Success criteria

- The generator produces plans where every item competes individually (no face-collapse).
- Dedup is by cluster/tag/route-family, not by group.
- `usedGroupIds` is fully removed; no other machinery is added.
- `SlotEntry` output is byte-compatible with today's for equivalent inputs where the
  chosen item is unchanged; saved trips and the swap flow are unaffected.
- `npm test` green, including the four new cases above.
