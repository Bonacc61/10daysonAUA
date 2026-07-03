# Shortlist → pinned "must-do" picks on the itinerary

- **Date:** 2026-07-03
- **Status:** Approved, not yet implemented
- **Scope:** Frontend only — `src/App.tsx`, `src/pages/Explore.tsx`, `src/pages/Itinerary.tsx`, `src/types.ts`, `src/data/itineraryGenerator.ts`, `src/data/activitySource.ts` + tests.
- **Baseline:** the uncommitted point-3 working tree (`refaceForAnswers(excludeIds)`, slot-aware `resolveSlotEntry`, keyword-only `isEveningItem`). This spec does not implement against HEAD.

## Problem

Explore's shortlist is dead state: `added` is local to `Explore.tsx` (lost on navigation, unreachable by Itinerary), and "Build itinerary →" only navigates. Users who shortlist activities then have to hunt for them in the generated plan — and usually won't find them, because `generatePlan` gives shortlisted items no privileged status.

## Goals

1. Shortlist survives navigation and reaches the itinerary.
2. Every shortlisted pick is auto-placed on the timeline as a **guaranteed must-do**: exact item, suitable slot, no duplicate, never dropped for budget.
3. Placed picks are visibly marked: "★ Your pick" badge + "N of your picks placed" header count.

## Non-goals

- Persisting the shortlist itself across hard reloads (pins baked into the plan persist via the saved trip; the raw shortlist doesn't need to).
- Merging picks into an already-saved trip for signed-in users — hydration wins (see §5 for why the UI stays truthful anyway). Revisit if users hit it.
- "Couldn't be slotted" messaging. With daytime overflow (§3.2) a pick goes unplaced only when picks exceed the trip's legal slots; v1 doesn't surface that.
- Any change to Explore filtering/UI beyond consuming the lifted state.

## Design

### 1. Lift shortlist to App (Point 1)

`added: Set<string>` moves from `Explore.tsx:97` to `App.tsx` as `shortlist`/`setShortlist`, passed to `Explore` (replaces its local state; `toggleAdd` unchanged) and `Itinerary` (read-only). Id formats unchanged: `item:<viatorId>`, `<activityId>`.

**Plan lifecycle is unchanged**: Itinerary regenerates the plan in its `useState` initializer on every mount (existing behavior — anonymous edits already don't survive navigation). That remount is exactly what folds newly added picks in on each Explore → Itinerary round-trip. Do **not** lift or memoize the plan. Signed-in users: saved-trip hydration replaces the generated plan as today.

### 2. `pinned` flag (data model)

`SlotEntry` gains `pinned?: boolean`. Because the plan is a tree of `SlotEntry`s, the flag threads generator → `seedPlan` → `PlannedCard.entry` → `resolveSlotEntry` → saved trip (`upsertTrip` stores the plan as plain JSON) with no extra plumbing.

Lifecycle in Itinerary is free, no new code: swap/replace paths construct fresh entries (never carry `pinned` → badge drops — correct, it's no longer the user's pick); `moveCard` moves the card wholesale (preserved); `removeCard` deletes it.

### 3. Seed the generator (Point 2)

`generatePlan(answers, catalog, { seed?, pinned?: string[] })`. Itinerary seeds it: `seedPlan(generatePlan(answers, catalog, { pinned: [...shortlist] }))`. Before the normal fill loop:

1. **Resolve** each id → pinned `SlotEntry` (`item:<id>` → `{kind:'group', groupId: item.group_id, bestSellerId: item.id, pinned: true}`; local id → `{kind:'activity', id, pinned: true}`). Drop stale ids (not in catalog).
2. **Slot suitability** follows the same rules as normal fill: Viator pins use `isEveningItem`/`itemSlotOk` — evening-suitable pins prefer evening **trip-wide** (take any free evening on any day first; overflow to a free daytime slot only when no evening slot remains in the trip — daytime slots accept anything per `itemSlotOk`); daytime pins never take evening. Local-activity pins use `Activity.timeOfDay` exactly (Morning → morning etc.), as normal fill does — local evening picks do **not** overflow to daytime. Pins never use the open afternoon on arrival/departure days. A pick goes unplaced only when no legal slot remains.
3. **Spread** deterministically (no RNG): pins in shortlist insertion order, one shared day-cursor ascending from day 1, wrapping; a pin skips days with no legal free slot and is unplaced after one full cycle without one. Max one pin per (day, slot).
4. **Budget-exempt**: placed pins (only) debit the trip budget pool (so normal fill can't overspend the tier cap), but a pin is never rejected for cost.
5. **Placed pins feed the day's state exactly like normal picks**: id → `usedIds` (no duplicate fill), kind → `usedKinds` (no ATV-tour + Jeep-safari same day), first pin sets the day's region `anchor` and leads the day's `picks` (so `titleFor` names the day after the user's pick).

### 4. Honor exactly (render)

`resolveSlotEntry` short-circuits on `entry.pinned`: if `bestSellerId` is still in the group's items, face = that item verbatim — skip the fit/slot/budget re-facing (which would otherwise silently swap an over-cap or off-vibe pick). `others` still computed, so manual swap stays possible. If the id has gone stale (live catalog refresh changed product codes), fall back to the normal re-facing path so the card never blanks.

### 5. Surface (UI)

- **"★ Your pick"** badge in the card header band when `entry.pinned` **and** the resolved face id equals the pinned `bestSellerId` — so a stale-id substitute (§4) never wears the badge.
- Itinerary header: **"★ N of your picks placed"**, N = badge-eligible pinned cards in the current plan; hidden when N = 0. Computing N from the plan (not the shortlist) keeps it truthful everywhere: a trip saved *before this feature* (or whose pins were all swapped away) has no pinned cards → hidden; a trip saved *with* pins correctly shows badges + count again on reload; no reference to a shortlist size that can drift. **No hydration special-casing** — N-from-plan is the whole rule.

## Testing

Unit (pure generator/resolve layer, mirrors existing test style):

- Pin placement: exact item placed; evening-suitable pin → evening, overflow to daytime only when no evening remains trip-wide; daytime pin never in evening; local pin honors `timeOfDay`; deterministic spread across days; picks > legal slots leaves extras unplaced (and undebited); stale ids dropped; no pin in arrival/departure open afternoons.
- Budget: pin over the cap still placed; pool debited.
- Interaction with fill: pinned id never duplicated; pinned kind not repeated same day.
- `resolveSlotEntry`: pinned entry returns face verbatim even when it fails fit/slot filters; stale pinned id falls back to re-facing; unpinned behavior unchanged.

Manual: shortlist in Explore → Build itinerary → picks visible with badge + correct count; signed-in user with a **pre-feature** saved trip sees no badges/count after hydration; a trip saved with pins shows both again on reload.
