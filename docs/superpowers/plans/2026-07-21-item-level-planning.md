# Item-level Itinerary Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the itinerary generator plan at the *item* level (every Viator item competes individually) and dedup by *cluster* instead of retiring whole Viator groups — dissolving face-collapse, coarse dedup, and mislabel propagation.

**Architecture:** Replace `candidatesFor`'s group-collapse (`blendPools` + `refaceForAnswers`) with a builder that emits one `CardEntry` per item, wrapped in the existing `{kind:'group', group, bestSeller, others}` shape. Delete `usedGroupIds`; the existing `notSimilar` (cluster → tag-Jaccard → route-family) graduates from a secondary net to *the* dedup mechanism. `SlotEntry`, display, swap, and Explore are untouched.

**Tech Stack:** TypeScript, React, Vite, Vitest. All changes are in `src/data/itineraryGenerator.ts` and its test file.

**Spec:** `docs/superpowers/specs/2026-07-21-item-level-planning-design.md`

---

## Context an implementer needs

- **`CardEntry`** (`src/types.ts`) is a union: `{kind:'activity', activity}` or `{kind:'group', group, bestSeller, others}`. The "group" variant already holds exactly one item (`bestSeller`) plus its group — item-level planning reuses it verbatim: one candidate per item, `bestSeller` = that item.
- **Nothing in the generator reads `CardEntry.others`** — `scoreEntry`, `entryKind`, `entryCoord`, `notSimilar`, `routeFamilyOf`, `toSlotEntry`, `titleFor` all read only `bestSeller`/`group`. So item candidates are wrapped with `others: []`; display rebuilds `others` from the catalog in `resolveSlotEntry` (not touched).
- **`toSlotEntry`** turns a picked `CardEntry` into the persisted `SlotEntry`. For a group entry it emits `{kind:'group', groupId: group.id, bestSellerId: bestSeller.id}` — identical to today, so **no storage/display change**.
- **Dedup already lives in `pickForSlot`**: `unused` (item-level via `lastUsedDay`), and `notSimilar` (`experience_cluster_id` → tag-Jaccard fallback → route-family). These stay. Only the whole-group retirement (`usedGroupIds`) is removed.
- **Test command:** `npm test` runs the full Vitest suite. Single test: `npx vitest run src/data/itineraryGenerator.test.ts -t "<name substring>"`.
- **Typecheck:** `npx tsc -p tsconfig.app.json --noEmit`.

## Files

- Modify: `src/data/itineraryGenerator.ts` — imports, `Ctx` type, `candidatesFor`, `NO_FILTER` removal, two `usedGroupIds` write-site removals, `Ctx` init, premium-pre-pass comments.
- Modify: `src/data/itineraryGenerator.test.ts` — one RED test (drives the refactor) + two regression-guard tests.

---

### Task 1: RED test — two different items from one group can both land

**Files:**
- Modify: `src/data/itineraryGenerator.test.ts` (append inside the existing `describe('generatePlan — pacing + no unintended empty slots', ...)` block, after the tag-Jaccard test)

This is the behavior the old model *cannot* express: `usedGroupIds` retires the whole `sailing` group after the first pick, so only one of the two sail items ever appears. On current code this test FAILS; the refactor makes it pass.

- [ ] **Step 1: Write the failing test**

Add this `it(...)` block inside the `describe('generatePlan — pacing + no unintended empty slots', ...)` block (it can go right after the `'never places two Viator items with high tag overlap ...'` test):

```ts
  it('places two different items from the SAME group (dedup is per-cluster, not per-group)', () => {
    // A private charter and a Jolly Pirates cruise are both in the "sailing" group
    // but are distinct experiences (different cluster ids, no shared tags). The old
    // per-group dedup (usedGroupIds) let only one land; item-level planning places both.
    const sailing: ViatorGroup = {
      id: 'sailing', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: ['watersports'] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const charter: ViatorItem = {
      id: 'charter', group_id: 'sailing', title: 'Private Catamaran Charter',
      image_url: '', price_usd: 1450, duration: '', rating: 4.9, review_count: 40,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [11888],                        // 11888 = sailing -> 'sail' kind (crowd-pleaser)
      experience_cluster_id: 'cluster-charter',
    };
    const jolly: ViatorItem = {
      id: 'jolly', group_id: 'sailing', title: 'Jolly Pirates Snorkel Cruise',
      image_url: '', price_usd: 65, duration: '', rating: 4.7, review_count: 900,
      viator_item_url: '', is_best_seller: false, display_order: 1,
      tags: [11912],                        // 11912 = snorkel -> 'snorkel' kind (crowd-pleaser)
      experience_cluster_id: 'cluster-jolly',
    };
    // Both are placeable crowd-pleasers; different kinds + tag-Jaccard 0 (no shared
    // tags) + different clusters => notSimilar allows BOTH. is_best_seller:false on
    // jolly proves a non-face item still surfaces.
    // Filler beach days so all daytime slots can fill and the sail picks spread across days.
    const padGroups: ViatorGroup[] = Array.from({ length: 12 }, (_, n) => ({
      id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 1, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const padItems: ViatorItem[] = padGroups.map((g, n) => ({
      id: `pad-item-${n}`, group_id: g.id, title: `Beach Day ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 10,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      sections: ['beaches' as const], experience_cluster_id: `pad-cluster-${n}`,
    }));
    const cat: Catalog = { activities: [], groups: [sailing, ...padGroups], items: [charter, jolly, ...padItems] };
    // 5 days keeps the money-no-object premium pre-pass OUT of it (needs >= 7 days),
    // so this exercises normal item-level fill only.
    const ids = entryIds(generatePlan({ ...ADVENTURER, days: 5 }, cat));
    expect(ids.includes('charter')).toBe(true);
    expect(ids.includes('jolly')).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `npx vitest run src/data/itineraryGenerator.test.ts -t "places two different items from the SAME group"`
Expected: FAIL — only one of `charter`/`jolly` is in the plan (the group is retired after the first pick), so one of the two `expect(...).toBe(true)` assertions fails.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/data/itineraryGenerator.test.ts
git commit -m "test: two items from one group must both be placeable (RED)"
```

---

### Task 2: Item-level candidate builder + remove `usedGroupIds`

**Files:**
- Modify: `src/data/itineraryGenerator.ts` (imports lines 20–21; `NO_FILTER` line 56; `Ctx` field ~150–158; `candidatesFor` ~185–198; `Ctx` init ~483; two write sites ~623 and ~672)

This is one coherent change — TypeScript will not compile mid-way (the removed field is referenced until every site is updated), so do all edits, then compile, then run tests.

- [ ] **Step 1: Update the two imports**

Replace (line 20):
```ts
import { matchPool, blendPools, entryPrice } from './matcher';
```
with:
```ts
import { matchPool, entryPrice } from './matcher';
```

Replace (line 21):
```ts
import { fitItem, refaceForAnswers, budgetCap, activityKind, isEveningItem, isWaterBased, isCrowdPleaser, offroadAdrenalineBonus } from './itemFit';
```
with:
```ts
import { fitItem, budgetCap, activityKind, isEveningItem, isWaterBased, isCrowdPleaser, offroadAdrenalineBonus, itemSlotOk } from './itemFit';
```

- [ ] **Step 2: Remove the now-unused `NO_FILTER` constant**

Delete this line (line 56):
```ts
const NO_FILTER = { rejectedIds: new Set<string>(), rejectedGroupIds: new Set<string>() };
```

- [ ] **Step 3: Swap the `usedGroupIds` field for a `groupById` lookup in `Ctx`**

In the `Ctx` type, replace this block:
```ts
  // Once any item from a group is placed, the whole group is retired for the
  // rest of the trip. Prevents booking-option variants (adult/child/45-min)
  // of the same product from each claiming a separate day.
  usedGroupIds: Set<string>;
```
with:
```ts
  // groupId → group, built once. Each per-item candidate resolves its group
  // through this (for scoring via group.matched_by and for the stored
  // {groupId, bestSellerId} SlotEntry) without a per-item linear scan. Booking-
  // option variants of one product are now handled by cluster/tag dedup in
  // notSimilar, not by whole-group retirement.
  groupById: Map<string, ViatorGroup>;
```

- [ ] **Step 4: Rewrite `candidatesFor` to emit one candidate per item**

Replace the whole current `candidatesFor` (its doc comment + body, lines ~180–198) with:
```ts
// Candidates for a slot — ONE CardEntry per Viator item (no group face-collapse),
// plus local activities. useTags=null widens which items are eligible (drops the
// group-relevance narrowing), but the slot + budget guards ALWAYS use the real
// answers (ctx.tags): widening relevance must never resurface an item the traveller
// can't afford or that doesn't belong in this slot.
//
// Dedup is NOT done here — pickForSlot's `unused` (lastUsedDay, item-level) and
// `notSimilar` (cluster → tag-Jaccard → route-family) handle it, so the same
// experience never repeats while one group can still fill many days with its
// different items.
function candidatesFor(ctx: Ctx, slot: Slot, useTags: Set<MatchTag> | null): CardEntry[] {
  // Local activities: matched pool via matchPool (tag overlap + time-of-day);
  // widened pool is time-of-day only. (Empty groups arg — items handled below.)
  const activities = useTags === null
    ? ctx.catalog.activities.filter((a) => a.timeOfDay === SLOT_TOD[slot])
    : matchPool(ctx.catalog.activities, [], useTags, slot).activities;

  // One candidate per item. Hard filters (both pools): slot-appropriate + fits the
  // real answers (the hard budget guard). Relevance narrowing (matched pool only)
  // uses the item's GROUP matched_by — the same signal matchPool applied at group
  // level, now per item. Empty matched_by = wildcard (matches everyone), as before.
  const itemEntries: CardEntry[] = [];
  for (const item of ctx.catalog.items) {
    if (!itemSlotOk(item, slot)) continue;
    if (fitItem(item, ctx.tags).rejected) continue;
    const group = ctx.groupById.get(item.group_id);
    if (!group) continue; // data-integrity guard (mirrors blendPools' best-seller guard)
    if (useTags !== null && group.matched_by.length > 0
        && !group.matched_by.some((t) => useTags.has(t))) continue;
    // others:[] — the generator never reads it; display rebuilds it in resolveSlotEntry.
    itemEntries.push({ kind: 'group', group, bestSeller: item, others: [] });
  }

  const activityEntries: CardEntry[] = activities.map((a) => ({ kind: 'activity', activity: a }));
  // Items first (mirrors blendPools' groups-first commercial tie-break on equal fit).
  return [...itemEntries, ...activityEntries];
}
```

- [ ] **Step 5: Update the `Ctx` initialiser in `generatePlan`**

Find the `const ctx: Ctx = { ... }` line (~483). Replace the `usedGroupIds: new Set(),` fragment with `groupById: new Map(fillCatalog.groups.map((g) => [g.id, g])),`. The full line becomes:
```ts
  const ctx: Ctx = { catalog: fillCatalog, tags, prefSections, rand: rng(seed + 1), lastUsedDay: new Map(), groupById: new Map(fillCatalog.groups.map((g) => [g.id, g])), usedClusterIds: new Set(), usedTagSets: [], usedRouteFamilies: new Set() };
```

- [ ] **Step 6: Remove the `usedGroupIds` write in the pin branch**

In the pin-placement branch of the day loop, delete the single line `ctx.usedGroupIds.add(pick.group.id);`. The surrounding block becomes:
```ts
        if (pick.kind === 'group') {
          const cid = pick.bestSeller.experience_cluster_id;
          if (cid) ctx.usedClusterIds.add(cid);
          const tags = pick.bestSeller.tags ?? [];
          if (tags.length > 0) ctx.usedTagSets.push(tags);
        }
```
(This is the block immediately after `ctx.lastUsedDay.set(entryId(pick), d);` inside `if (pin) { ... }`.)

- [ ] **Step 7: Remove the `usedGroupIds` write in the normal-fill branch**

In the normal-fill branch (after `const pick = pickForSlot(...)`), delete the single line `ctx.usedGroupIds.add(pick.group.id);`. The surrounding block becomes:
```ts
      if (pick.kind === 'group') {
        const cid = pick.bestSeller.experience_cluster_id;
        if (cid) ctx.usedClusterIds.add(cid);
        const tags = pick.bestSeller.tags ?? [];
        if (tags.length > 0) ctx.usedTagSets.push(tags);
      }
```

- [ ] **Step 8: Typecheck — confirm no remaining references to removed symbols**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS (no errors). If it complains about `usedGroupIds`, `blendPools`, `refaceForAnswers`, or `NO_FILTER`, a reference was missed — fix it. Sanity grep: `grep -n "usedGroupIds\|blendPools\|refaceForAnswers\|NO_FILTER" src/data/itineraryGenerator.ts` should return nothing.

- [ ] **Step 9: Run the Task 1 test — it now PASSES**

Run: `npx vitest run src/data/itineraryGenerator.test.ts -t "places two different items from the SAME group"`
Expected: PASS — both `charter` and `jolly` appear in the plan.

- [ ] **Step 10: Run the full suite — no regressions**

Run: `npm test`
Expected: all suites green (existing generator, itemFit, matcher, e2e-engine, engineCoverage). The existing one-item-per-group fixtures behave identically under item-level planning; the existing cross-group cluster-dedup and tag-Jaccard tests still pass because `notSimilar` is unchanged.

- [ ] **Step 11: Commit**

```bash
git add src/data/itineraryGenerator.ts
git commit -m "feat(generator): plan at the item level, dedup by cluster not group

Replace the group face-collapse (blendPools + refaceForAnswers) with a
per-item candidate builder and delete usedGroupIds. notSimilar
(cluster -> tag-Jaccard -> route-family) is now the sole dedup mechanism.
SlotEntry, display, swap, and Explore are unchanged."
```

---

### Task 3: Regression-guard tests — same-group cluster dedup + route-family

**Files:**
- Modify: `src/data/itineraryGenerator.test.ts` (append two `it(...)` blocks in the same `describe` block as Task 1)

These lock in two invariants the refactor must preserve: same-*cluster* items never both appear (even within one group now that group-dedup is gone), and the route-family net still caps off-road tours at one per trip.

- [ ] **Step 1: Write both guard tests**

Add these two `it(...)` blocks inside `describe('generatePlan — pacing + no unintended empty slots', ...)`:

```ts
  it('never places two items in one group that share a cluster id', () => {
    // Same group, same cluster (e.g. an adult and a child booking option of one
    // snorkel product). Both carry the snorkel tag so they are high-scoring, placeable
    // crowd-pleasers; the shared cluster id must still keep them from both landing now
    // that whole-group retirement is gone.
    const grp: ViatorGroup = {
      id: 'snorkel', name: 'Snorkel Trips', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: ['watersports'] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const adult: ViatorItem = {
      id: 'snork-adult', group_id: 'snorkel', title: 'Catalina Bay Snorkel Trip (Adult)',
      image_url: '', price_usd: 0, duration: '', rating: 4.7, review_count: 200,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [11912],                        // 11912 = snorkel
      experience_cluster_id: 'cluster-snorkel',
    };
    const child: ViatorItem = {
      id: 'snork-child', group_id: 'snorkel', title: 'Catalina Bay Snorkel Trip (Child)',
      image_url: '', price_usd: 0, duration: '', rating: 4.7, review_count: 190,
      viator_item_url: '', is_best_seller: false, display_order: 1,
      tags: [11912],                        // 11912 = snorkel (same product, other booking option)
      experience_cluster_id: 'cluster-snorkel',
    };
    const padGroups: ViatorGroup[] = Array.from({ length: 12 }, (_, n) => ({
      id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 1, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const padItems: ViatorItem[] = padGroups.map((g, n) => ({
      id: `pad-item-${n}`, group_id: g.id, title: `Beach Day ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 10,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      sections: ['beaches' as const], experience_cluster_id: `pad-cluster-${n}`,
    }));
    const cat: Catalog = { activities: [], groups: [grp, ...padGroups], items: [adult, child, ...padItems] };
    const ids = entryIds(generatePlan({ ...ADVENTURER, days: 5 }, cat));
    expect(ids.includes('snork-adult') && ids.includes('snork-child')).toBe(false);
  });

  it('places at most one off-road tour per trip (route-family net)', () => {
    // Two off-road tours in different groups, different clusters, and NON-overlapping
    // tags (4WD tag vs ATV tag) so neither cluster-dedup nor tag-Jaccard fires — only
    // the route-family net keeps the trip to a single off-road experience.
    const groupA: ViatorGroup = {
      id: 'offroad-a', name: 'Jeep Co', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: ['adventure'] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const groupB: ViatorGroup = {
      id: 'offroad-b', name: 'ATV Co', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 1, matched_by: ['adventure'] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const jeep: ViatorItem = {
      id: 'jeep-tour', group_id: 'offroad-a', title: 'Guided Jeep Tour',
      image_url: '', price_usd: 0, duration: '', rating: 4.6, review_count: 100,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [12035], experience_cluster_id: 'cluster-a',   // 12035 = 4WD (offroad kind)
    };
    const atv: ViatorItem = {
      id: 'atv-tour', group_id: 'offroad-b', title: 'Self-drive ATV Adventure',
      image_url: '', price_usd: 0, duration: '', rating: 4.6, review_count: 100,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [21421], experience_cluster_id: 'cluster-b',   // 21421 = ATV (offroad kind)
    };
    const padGroups: ViatorGroup[] = Array.from({ length: 12 }, (_, n) => ({
      id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 2, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const padItems: ViatorItem[] = padGroups.map((g, n) => ({
      id: `pad-item-${n}`, group_id: g.id, title: `Beach Day ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 10,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      sections: ['beaches' as const], experience_cluster_id: `pad-cluster-${n}`,
    }));
    const cat: Catalog = { activities: [], groups: [groupA, groupB, ...padGroups], items: [jeep, atv, ...padItems] };
    const ids = entryIds(generatePlan({ ...ADVENTURER, days: 5 }, cat));
    const offroadPlaced = [ids.includes('jeep-tour'), ids.includes('atv-tour')].filter(Boolean).length;
    expect(offroadPlaced).toBeLessThanOrEqual(1);
  });
```

- [ ] **Step 2: Run both guard tests**

Run: `npx vitest run src/data/itineraryGenerator.test.ts -t "share a cluster id"` then
`npx vitest run src/data/itineraryGenerator.test.ts -t "at most one off-road tour"`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add src/data/itineraryGenerator.test.ts
git commit -m "test: guard same-group cluster dedup and route-family cap"
```

---

### Task 4: Refresh the premium-splurge comments (no behavior change)

**Files:**
- Modify: `src/data/itineraryGenerator.ts` (the premium-splurge pre-pass comment block, ~528–537, and the in-loop premium comment, ~638–643)

The pre-pass is kept, but its comments justify it by "group-dedup," which no longer exists. Update the wording to its real remaining job: guaranteeing an aspirational pick that score-based fill would not reliably surface for a money-no-object traveller.

- [ ] **Step 1: Update the pre-pass header comment**

Replace the comment block that begins `// --- Premium splurge pre-pass` (down to the line ending `// trips skip this (one cruise is plenty); non-splurge budgets never trigger it.`) with:
```ts
  // --- Premium splurge pre-pass ---------------------------------------------
  // A money-no-object traveller on a week-plus trip should get an aspirational
  // premium experience (e.g. a private charter). Normal item-level fill won't
  // reliably surface it: a $65 crowd-pleaser often out-scores a $1,450 charter on
  // within-tier popularity, so the cheap pick wins every slot. We place the top
  // premium pick(s) here and badge them "Signature splurge". Item-level fill and
  // cluster dedup then let the group's crowd-pleaser still land on another day
  // (charter and party cruise are different clusters). Shorter trips skip this
  // (one cruise is plenty); non-splurge budgets never trigger it.
```

- [ ] **Step 2: Update the in-loop premium comment**

Replace the comment block that begins `      // Premium splurge (money-no-object, long trip): placed like a pin but the` (down to `// and a party cruise share sail tags) — exactly the second pick we want.`) with:
```ts
      // Premium splurge (money-no-object, long trip): placed like a pin. We mark the
      // item id (lastUsedDay) and its experience CLUSTER, but NOT its tags: the
      // cluster id means "the same real-world experience," so normal fill won't place
      // an identical one, while the coarser tag-Jaccard fallback would wrongly suppress
      // a distinct-but-related crowd-pleaser (a charter and a party cruise share sail
      // tags) — exactly the second pick we want to keep eligible.
```

- [ ] **Step 3: Typecheck + full suite (comments only, must stay green)**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm test`
Expected: PASS, all green.

- [ ] **Step 4: Commit**

```bash
git add src/data/itineraryGenerator.ts
git commit -m "docs(generator): premium pre-pass comments reflect item-level model"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full typecheck + test run**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm test`
Expected: no type errors; every suite green, including the three new tests.

- [ ] **Step 2: Confirm the removed machinery is gone**

Run: `grep -n "usedGroupIds\|blendPools\|refaceForAnswers\|NO_FILTER" src/data/itineraryGenerator.ts`
Expected: no output.

- [ ] **Step 3: Confirm `blendPools` / `refaceForAnswers` still exist for the swap path**

Run: `grep -rn "refaceForAnswers\|blendPools" src/pages src/data/itemFit.ts src/data/matcher.ts`
Expected: still referenced by `src/pages/Itinerary.tsx` (swap) and defined in `itemFit.ts` / `matcher.ts`. They must NOT have been deleted — only the generator stopped using them.

---

## Amendment (during execution) — last-resort group dedup + e2e invariant

Task 2 as originally written (delete `usedGroupIds` entirely) regressed 2 stub tests
(`sailing-cruises` one-pick, geo-coherence) and the 5 live-catalog e2e "no duplicates"
tests. Cause: stub/thin-catalog items have **no cluster id and no tags**, so item-level
`notSimilar` had no signal and near-duplicates all landed. Corrected approach:

- **Keep `usedGroupIds`** (field + the `.add` in the pin and normal-fill branches; the
  premium branch still does NOT add). Add `groupById` too.
- **Gate its READ inside `notSimilar`**: it is consulted **only** for an item with no
  cluster id and no tags. Change the `if (tags.length === 0) return true;` line to:
  ```ts
      const tags = e.bestSeller.tags ?? [];
      if (tags.length === 0) {
        // No tags: with no cluster id either, the Viator group is the only "same
        // experience" signal left (hand-written stub / thin offline catalog) — dedup
        // by it. With a cluster id present, cluster dedup above already covers it.
        return cid ? true : !ctx.usedGroupIds.has(e.group.id);
      }
  ```
- The `Ctx` keeps BOTH `usedGroupIds: Set<string>` and `groupById: Map<string, ViatorGroup>`.

### Task 2b: Update the e2e "no duplicates" invariant

**File:** `src/data/e2e-engine.test.ts` (the `no duplicates — ${name}` test, ~line 79)

Item-level planning legitimately allows two DIFFERENT items from one Viator group, so the
"no duplicate groupId" assertion is the old contract. Replace the id-mapping + dupe check
with an item-level + cluster-level invariant:

```ts
    it(`no duplicates — ${name}`, () => {
      const plan = generatePlan(answers, catalog, { seed: 42 });
      const entries = allEntries(plan);
      // Never the same item twice (a group entry is identified by its shown item).
      const itemIds = entries.map(e => e.kind === 'group' ? e.bestSellerId : e.id);
      const seen = new Set<string>();
      const dupeItems: string[] = [];
      for (const id of itemIds) { if (seen.has(id)) dupeItems.push(id); seen.add(id); }
      expect(dupeItems, `duplicate items: ${[...new Set(dupeItems)].join(', ')}`).toEqual([]);
      // Never the same real-world experience twice (by cluster id, when present).
      const clusters = entries
        .filter((e): e is Extract<typeof e, { kind: 'group' }> => e.kind === 'group')
        .map(e => catalog.items.find(i => i.id === e.bestSellerId)?.experience_cluster_id)
        .filter((c): c is string => !!c);
      const seenC = new Set<string>();
      const dupeC: string[] = [];
      for (const c of clusters) { if (seenC.has(c)) dupeC.push(c); seenC.add(c); }
      expect(dupeC, `duplicate clusters: ${[...new Set(dupeC)].join(', ')}`).toEqual([]);
    });
```

Verify: `npx vitest run src/data/e2e-engine.test.ts` (needs `VITE_SUPABASE_ANON_KEY`; if the
suite is skipped in this environment, note that it could not be run live).

### Task 2c: Geo-coherence guard (item-level made the thin stub non-discriminating)

Removing whole-group retirement changed candidate selection on the thin `getCatalog()`
stub enough that the old geo test's average intra-day spread rose to ~12 km (guard `< 11`).
Investigation (throwaway probe against the **live** catalog) measured **7.9 km** — so
production geo is healthy; only the stub proxy broke. And on the stub the geo penalty now
barely moves the number (12.2 with penalty ≈ 12.3 without), so simply raising the stub
threshold would produce a *dead* guard. Resolution (user-approved: "e2e + rebuild stub
fixture"):

- **Rebuilt stub geo test** (`itineraryGenerator.test.ts`) on a purpose-built fixture:
  two real Viator groups ~15 km apart (`watersports` @ Palm Beach, `adventure-tours` @
  Arikok — both in `GROUP_COORDS`), each with 25 distinct-cluster, tag-less,
  single-section items. Same-group picks share a coord (spread 0); a mixed day spreads
  ~15 km. The geo penalty (~4.5 pts > score BAND) keeps every day single-region → guard
  `< 5 km`, which fails loudly if the penalty is removed.
- **Added a live e2e geo guard** (`e2e-engine.test.ts`): same average-intra-day-spread
  metric on the production catalog, guard `< 11 km` (measured ~7.9 km).

## Self-review notes (author)

- **Spec coverage:** item-level builder (Task 2 Step 4) ✓; delete `usedGroupIds` (Task 2 Steps 3,5,6,7) ✓; keep `notSimilar`/tag-Jaccard/route-family (untouched) ✓; `matched_by` via `item.group_id` (Task 2 Step 4, `group.matched_by.some(...)`, and `scoreEntry` unchanged) ✓; keep premium pre-pass, update comments (Task 4) ✓; no `SlotEntry`/display/swap/Explore change (Task 5 Steps 2–3 verify) ✓; 4 spec test cases: buried→surfaces + two-land (Task 1, combined), same-cluster (Task 3a), route-family (Task 3b), cross-group cluster (existing test, kept) ✓.
- **Type consistency:** `groupById: Map<string, ViatorGroup>` (declared Task 2 Step 3, built Step 5); `itemSlotOk` imported (Step 1) and used (Step 4); `ViatorGroup` already imported in the generator's type import. `candidatesFor` signature unchanged, so both call sites in `pickForSlot` still compile.
- **No placeholders:** every code step shows full code; every run step shows an exact command + expected result.
