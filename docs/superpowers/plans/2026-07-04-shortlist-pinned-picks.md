# Shortlist → Pinned Picks on the Itinerary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the Explore shortlist to App-level state and guarantee every shortlisted pick appears as a placed, badged "★ Your pick" card on the generated itinerary.

**Architecture:** `shortlist: Set<string>` moves from `Explore.tsx` local state to `App.tsx`, passed to both `Explore` (read/write) and `Itinerary` (read-only). `generatePlan` gains a `pinned?: string[]` option; before the normal slot-fill loop, each pin is resolved to a `CardEntry`, assigned a (day, slot) pair deterministically, and stored with `pinned: true` on its `SlotEntry`. `resolveSlotEntry` short-circuits on `pinned` to return the exact face verbatim. A badge + header count surface the placed pins in the UI.

**Tech Stack:** React + TypeScript, Vite, Vitest (test runner). All changes are frontend-only — no Supabase schema change needed.

---

## Files

| File | Change |
|---|---|
| `src/types.ts` | Add `pinned?: boolean` to `SlotEntry` |
| `src/data/itineraryGenerator.ts` | Add `resolvePinId`, `getPinSlotPrefs`, `findPinSlot` helpers; update `generatePlan` signature + pre-pass |
| `src/data/itineraryGenerator.test.ts` | Pin-placement tests |
| `src/data/activitySource.ts` | Short-circuit in `resolveSlotEntry` for pinned group entries |
| `src/data/activitySource.test.ts` | Tests for the short-circuit |
| `src/App.tsx` | Add `shortlist`/`setShortlist` state; pass to `<Explore>` and `<Itinerary>` |
| `src/pages/Explore.tsx` | Replace local `added` state with `shortlist`/`setShortlist` props |
| `src/pages/Itinerary.tsx` | Accept `shortlist` prop; seed `generatePlan` with it; compute `pinnedCount`; render header count; pass `pinned` to `SortableCard` → `ItineraryCard` |
| `src/components/ItineraryCard.tsx` | Add `pinned?: boolean` prop; thread to `ActivityCardFront` and `GroupCard` |
| `src/components/GroupCard.tsx` | Add `pinned?: boolean` prop; pass to `GroupHeader` |
| `src/components/GroupHeader.tsx` | Add `pinned?: boolean` prop; render badge in header band |

---

## Task 1: Add `pinned` flag to `SlotEntry`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update `SlotEntry`**

In `src/types.ts`, change `SlotEntry` from:
```typescript
export type SlotEntry =
  | { kind: 'activity'; id: string }
  | { kind: 'group'; groupId: string; bestSellerId: string };
```
to:
```typescript
export type SlotEntry =
  | { kind: 'activity'; id: string; pinned?: boolean }
  | { kind: 'group'; groupId: string; bestSellerId: string; pinned?: boolean };
```

- [ ] **Step 2: Verify TypeScript compiles clean**

```bash
cd /root/10daysonaruba.com && npx tsc --noEmit
```
Expected: no errors (the new field is optional — all existing object literals are still valid).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add pinned flag to SlotEntry"
```

---

## Task 2: Generator pure-helper functions + tests

**Files:**
- Modify: `src/data/itineraryGenerator.ts`
- Modify: `src/data/itineraryGenerator.test.ts`

These three helpers are pure functions with no side-effects — write the tests first.

- [ ] **Step 1: Write failing tests**

Add to `src/data/itineraryGenerator.test.ts` (after existing `describe` blocks):

```typescript
import { isEveningItem } from './itemFit';
import type { CardEntry, Slot } from '../types';

// ---------- resolvePinId ---------------------------------------------------
describe('resolvePinId (exported for tests)', () => {
  it('resolves item:<id> to a group CardEntry with that item as bestSeller', () => {
    const cat = getCatalog();
    const item = cat.items[0];
    const result = resolvePinId(`item:${item.id}`, cat);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('group');
    if (result?.kind === 'group') expect(result.bestSeller.id).toBe(item.id);
  });

  it('returns null for a stale item id', () => {
    expect(resolvePinId('item:does-not-exist', getCatalog())).toBeNull();
  });

  it('resolves a bare activity id to an activity CardEntry', () => {
    const cat = getCatalog();
    const act = cat.activities[0];
    const result = resolvePinId(act.id, cat);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('activity');
  });

  it('returns null for a stale activity id', () => {
    expect(resolvePinId('no-such-activity', getCatalog())).toBeNull();
  });
});

// ---------- getPinSlotPrefs -----------------------------------------------
describe('getPinSlotPrefs (exported for tests)', () => {
  it('evening-item Viator: preferred=[evening], fallback=[morning,afternoon]', () => {
    const cat = getCatalog();
    // Find or make an evening Viator item
    const group = cat.groups[0];
    const eveningItem: import('../types').ViatorItem = {
      id: 'test-eve', group_id: group.id, title: 'Sunset Dinner Cruise', image_url: '',
      price_usd: 80, duration: '3 hrs', rating: 4.8, review_count: 200,
      viator_item_url: '', is_best_seller: true, display_order: 0,
    };
    const entry: CardEntry = { kind: 'group', group, bestSeller: eveningItem, others: [] };
    expect(isEveningItem(eveningItem)).toBe(true);
    const prefs = getPinSlotPrefs(entry);
    expect(prefs.preferred).toEqual(['evening']);
    expect(prefs.fallback).toEqual(['morning', 'afternoon']);
  });

  it('daytime Viator: preferred=[morning,afternoon], fallback=[]', () => {
    const cat = getCatalog();
    const group = cat.groups[0];
    const dayItem: import('../types').ViatorItem = {
      id: 'test-day', group_id: group.id, title: 'Snorkel Tour', image_url: '',
      price_usd: 60, duration: '3 hrs', rating: 4.7, review_count: 100,
      viator_item_url: '', is_best_seller: true, display_order: 0,
    };
    const entry: CardEntry = { kind: 'group', group, bestSeller: dayItem, others: [] };
    expect(isEveningItem(dayItem)).toBe(false);
    const prefs = getPinSlotPrefs(entry);
    expect(prefs.preferred).toEqual(['morning', 'afternoon']);
    expect(prefs.fallback).toEqual([]);
  });

  it('local Morning activity: preferred=[morning], fallback=[]', () => {
    const cat = getCatalog();
    const act = cat.activities.find(a => a.timeOfDay === 'Morning')!;
    const entry: CardEntry = { kind: 'activity', activity: act };
    const prefs = getPinSlotPrefs(entry);
    expect(prefs.preferred).toEqual(['morning']);
    expect(prefs.fallback).toEqual([]);
  });

  it('local Evening activity: preferred=[evening], fallback=[] (no overflow to daytime)', () => {
    const cat = getCatalog();
    const act = cat.activities.find(a => a.timeOfDay === 'Evening')!;
    const entry: CardEntry = { kind: 'activity', activity: act };
    const prefs = getPinSlotPrefs(entry);
    expect(prefs.preferred).toEqual(['evening']);
    expect(prefs.fallback).toEqual([]);
  });
});

// ---------- findPinSlot ---------------------------------------------------
describe('findPinSlot (exported for tests)', () => {
  // Helper: all slots available
  const allAvail = (_day: number, _slot: Slot) => true;
  // Helper: nothing available
  const noneAvail = (_day: number, _slot: Slot) => false;

  it('places on cursor day when preferred slot is free', () => {
    const result = findPinSlot(['morning'], [], 5, 1, allAvail);
    expect(result).toEqual({ day: 1, slot: 'morning' });
  });

  it('wraps to next day when cursor day preferred slot is taken', () => {
    // Day 1 morning taken, day 2 morning free
    const avail = (day: number, slot: Slot) => !(day === 1 && slot === 'morning');
    const result = findPinSlot(['morning'], [], 5, 1, avail);
    expect(result).toEqual({ day: 2, slot: 'morning' });
  });

  it('falls back to fallback slots after full preferred scan', () => {
    // No evening available on any day
    const noEvening = (_day: number, slot: Slot) => slot !== 'evening';
    const result = findPinSlot(['evening'], ['morning', 'afternoon'], 3, 1, noEvening);
    expect(result).not.toBeNull();
    expect(['morning', 'afternoon']).toContain(result?.slot);
  });

  it('returns null when no slot is available anywhere', () => {
    expect(findPinSlot(['morning', 'afternoon', 'evening'], [], 5, 1, noneAvail)).toBeNull();
  });

  it('wraps around the trip correctly', () => {
    // All days except last have morning taken; cursor starts at last day
    const avail = (day: number, slot: Slot) => day === 3 && slot === 'morning';
    const result = findPinSlot(['morning'], [], 5, 4, avail);
    // Starts at 4, tries 4,5,1,2,3 — should find day 3
    expect(result).toEqual({ day: 3, slot: 'morning' });
  });
});
```

- [ ] **Step 2: Run tests — expect failures (symbols not exported yet)**

```bash
cd /root/10daysonaruba.com && npx vitest run src/data/itineraryGenerator.test.ts 2>&1 | tail -20
```
Expected: compilation errors or test failures for `resolvePinId`, `getPinSlotPrefs`, `findPinSlot` not found.

- [ ] **Step 3: Implement helper functions in `itineraryGenerator.ts`**

Add before `generatePlan` in `src/data/itineraryGenerator.ts`:

```typescript
// ---------- Pin-placement helpers (exported for unit tests) ---------------

// Resolve an Explore shortlist id → CardEntry against the filtered catalog.
// id format: 'item:<viatorItemId>' for Viator items, '<activityId>' for local.
// Returns null if the id is stale (product no longer in catalog).
export function resolvePinId(rawId: string, catalog: Catalog): CardEntry | null {
  if (rawId.startsWith('item:')) {
    const itemId = rawId.slice(5);
    const item = catalog.items.find((i) => i.id === itemId);
    if (!item) return null;
    const group = catalog.groups.find((g) => g.id === item.group_id);
    if (!group) return null;
    const others = catalog.items.filter((i) => i.group_id === group.id && i.id !== item.id);
    return { kind: 'group', group, bestSeller: item, others };
  }
  const activity = catalog.activities.find((a) => a.id === rawId);
  if (!activity) return null;
  return { kind: 'activity', activity };
}

// Preferred and fallback slot lists for a resolved pin. Preference order
// controls the scan: preferred slots are tried on all days first; if none
// found, fallback slots are tried.
export function getPinSlotPrefs(entry: CardEntry): { preferred: Slot[]; fallback: Slot[] } {
  if (entry.kind === 'group') {
    // Viator items: title-only evening detection (same rule as isEveningItem in itemFit.ts).
    return isEveningItem(entry.bestSeller)
      ? { preferred: ['evening'], fallback: ['morning', 'afternoon'] }
      : { preferred: ['morning', 'afternoon'], fallback: [] };
  }
  // Local activity: honor timeOfDay exactly (no overflow to daytime for Evening picks).
  const tod = entry.activity.timeOfDay;
  if (tod === 'Morning')  return { preferred: ['morning'],   fallback: [] };
  if (tod === 'Evening')  return { preferred: ['evening'],   fallback: [] };
  return { preferred: ['afternoon'], fallback: [] };
}

// Scan from cursor (1-based, wraps modulo nDays) for the earliest day+slot that
// satisfies the preferred list; if none found, try the fallback list. Returns
// null when no legal slot remains in the entire trip.
export function findPinSlot(
  preferred: Slot[],
  fallback: Slot[],
  nDays: number,
  cursor: number,
  slotAvail: (day: number, slot: Slot) => boolean,
): { day: number; slot: Slot } | null {
  for (const slots of [preferred, fallback]) {
    if (slots.length === 0) continue;
    for (let i = 0; i < nDays; i++) {
      const d = ((cursor - 1 + i) % nDays) + 1;
      for (const slot of slots) {
        if (slotAvail(d, slot)) return { day: d, slot };
      }
    }
  }
  return null;
}
```

Also add to the imports at the top of `itineraryGenerator.ts`:
```typescript
import { fitItem, refaceForAnswers, budgetCap, activityKind, isEveningItem } from './itemFit';
```
(add `isEveningItem` to the existing `itemFit` import).

- [ ] **Step 4: Run tests — helpers should now pass**

```bash
cd /root/10daysonaruba.com && npx vitest run src/data/itineraryGenerator.test.ts 2>&1 | tail -20
```
Expected: the 3 new `describe` blocks all pass. Existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/itineraryGenerator.ts src/data/itineraryGenerator.test.ts
git commit -m "feat: add resolvePinId, getPinSlotPrefs, findPinSlot helpers (tested)"
```

---

## Task 3: Generator pin pre-pass + `generatePlan` signature

**Files:**
- Modify: `src/data/itineraryGenerator.ts`
- Modify: `src/data/itineraryGenerator.test.ts`

- [ ] **Step 1: Write failing tests for pin placement in generatePlan**

Add to `src/data/itineraryGenerator.test.ts`:

```typescript
// ---------- generatePlan — pinned picks ------------------------------------
describe('generatePlan — pinned picks', () => {
  // Helper to find all SlotEntries across a plan.
  function allEntries(plan: Day[]): import('../types').SlotEntry[] {
    return plan.flatMap(d =>
      [...d.morning, ...d.afternoon, ...d.evening]
    );
  }

  it('places a pinned Viator item in the plan with pinned=true', () => {
    const cat = getCatalog();
    const item = cat.items[0];
    const plan = generatePlan(DEFAULT_ANSWERS, cat, { pinned: [`item:${item.id}`] });
    const entries = allEntries(plan);
    const pinned = entries.filter(e => e.pinned);
    expect(pinned.length).toBe(1);
    expect(pinned[0].kind).toBe('group');
    if (pinned[0].kind === 'group') expect(pinned[0].bestSellerId).toBe(item.id);
  });

  it('places a pinned local activity with pinned=true', () => {
    const cat = getCatalog();
    const act = cat.activities[0];
    const plan = generatePlan(DEFAULT_ANSWERS, cat, { pinned: [act.id] });
    const entries = allEntries(plan);
    const pinned = entries.filter(e => e.pinned);
    expect(pinned.length).toBe(1);
    expect(pinned[0].kind).toBe('activity');
    if (pinned[0].kind === 'activity') expect(pinned[0].id).toBe(act.id);
  });

  it('does not duplicate a pinned id in the normal fill', () => {
    const cat = getCatalog();
    const item = cat.items[0];
    const plan = generatePlan(DEFAULT_ANSWERS, cat, { pinned: [`item:${item.id}`] });
    const entries = allEntries(plan);
    const count = entries.filter(
      e => e.kind === 'group' && e.bestSellerId === item.id
    ).length;
    expect(count).toBe(1); // appears exactly once
  });

  it('places an evening-suitable pin in an evening slot', () => {
    // Build a catalog with one evening Viator item
    const cat = getCatalog();
    const eveningGroup = cat.groups[0];
    const eveningItem: import('../types').ViatorItem = {
      id: 'eve-pin', group_id: eveningGroup.id, title: 'Sunset Dinner Cruise', image_url: '',
      price_usd: 80, duration: '3 hrs', rating: 4.8, review_count: 500,
      viator_item_url: '', is_best_seller: false, display_order: 99,
    };
    const cat2 = { ...cat, items: [...cat.items, eveningItem] };
    const plan = generatePlan(DEFAULT_ANSWERS, cat2, { pinned: [`item:eve-pin`] });
    const entries = allEntries(plan);
    // Find the pinned entry
    const pin = entries.find(e => e.pinned && e.kind === 'group' && e.bestSellerId === 'eve-pin');
    expect(pin).toBeDefined();
    // It must be in an evening slot
    const inEvening = plan.some(d => d.evening.some(e => e.pinned && e.kind === 'group' && e.bestSellerId === 'eve-pin'));
    expect(inEvening).toBe(true);
  });

  it('pins a budget-overrun item (budget exempt)', () => {
    const cat = getCatalog();
    // Find an expensive item
    const expensiveItem = cat.items.reduce((a, b) => b.price_usd > a.price_usd ? b : a);
    const budgetAnswers: Answers = { ...DEFAULT_ANSWERS, budget: 'Budget-conscious' };
    // Should not reject the pin due to budget
    const plan = generatePlan(budgetAnswers, cat, { pinned: [`item:${expensiveItem.id}`] });
    const entries = allEntries(plan);
    const pin = entries.find(e => e.pinned && e.kind === 'group' && e.bestSellerId === expensiveItem.id);
    expect(pin).toBeDefined();
  });

  it('drops a stale pin id silently (no crash, no pinned entry in plan)', () => {
    const plan = generatePlan(DEFAULT_ANSWERS, getCatalog(), { pinned: ['item:no-such-item'] });
    const entries = allEntries(plan);
    expect(entries.filter(e => e.pinned).length).toBe(0);
  });

  it('spreads multiple pins across different days', () => {
    const cat = getCatalog();
    const ids = cat.items.slice(0, 3).map(i => `item:${i.id}`);
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 5 }, cat, { pinned: ids });
    const pinnedEntries = allEntries(plan).filter(e => e.pinned);
    expect(pinnedEntries.length).toBe(ids.length);
    // Each on a different day
    const pinnedDays = plan
      .filter(d => [...d.morning, ...d.afternoon, ...d.evening].some(e => e.pinned))
      .map(d => d.day);
    expect(new Set(pinnedDays).size).toBe(ids.length);
  });

  it('pins never land in the open afternoon on arrival/departure days', () => {
    const cat = getCatalog();
    const act = cat.activities.find(a => a.timeOfDay === 'Afternoon')!;
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 5 }, cat, { pinned: [act.id] });
    // Day 1 and day 5 afternoon must be empty
    const day1Afternoon = plan[0].afternoon;
    const day5Afternoon = plan[plan.length - 1].afternoon;
    expect(day1Afternoon.some(e => e.pinned)).toBe(false);
    expect(day5Afternoon.some(e => e.pinned)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd /root/10daysonaruba.com && npx vitest run src/data/itineraryGenerator.test.ts 2>&1 | grep -E "PASS|FAIL|Error" | head -20
```
Expected: the new `describe` block fails (generatePlan doesn't accept `pinned` yet).

- [ ] **Step 3: Implement the pin pre-pass in `generatePlan`**

Replace the `export function generatePlan` signature and its top section in `src/data/itineraryGenerator.ts`:

```typescript
export function generatePlan(
  answers: Answers,
  catalog: Catalog,
  opts: { seed?: number; pinned?: string[] } = {},
): Day[] {
  const tags = answersToTags(answers);
  const prefSections = new Set<Section>();
  for (const t of tags) for (const s of INTEREST_SECTIONS[t] ?? []) prefSections.add(s);

  const nDays = Math.max(1, Math.min(answers.days || 1, 14));
  const seed = ((opts.seed ?? 0) ^ hashAnswers(answers)) >>> 0;
  const flags = new Set(answers.flags ?? []);
  const filteredCatalog = applyCatalogFlags(catalog, flags);
  const ctx: Ctx = { catalog: filteredCatalog, tags, prefSections, rand: rng(seed + 1), lastUsedDay: new Map() };

  const cap = budgetCap(tags);
  let budgetLeft = cap === Infinity ? Infinity : cap * nDays;

  // --- Pin pre-pass --------------------------------------------------------
  // Track which (day, slot) has been claimed by a pin so normal fill won't double-book.
  const pinClaimed = new Map<number, Set<Slot>>();

  // slotAvail: returns true when the slot is usable for a pin on this day.
  // Mirrors the normal fill's arrival/departure open-afternoon and no-early-mornings rules.
  const openAft = (day: number) => nDays > 1 && (day === 1 || day === nDays);
  const slotAvail = (day: number, slot: Slot): boolean => {
    if (slot === 'morning' && flags.has('no-early-mornings')) return false;
    if (slot === 'afternoon' && openAft(day)) return false;
    return !pinClaimed.get(day)?.has(slot);
  };

  // pinnedSlots: day → slot → { cardEntry, slotEntry } for pre-pass processing
  type PinPlacement = { cardEntry: CardEntry; slotEntry: SlotEntry };
  const pinnedSlots = new Map<number, Map<Slot, PinPlacement>>();

  let dayCursor = 1;

  for (const rawId of (opts.pinned ?? [])) {
    const resolved = resolvePinId(rawId, filteredCatalog);
    if (!resolved) continue; // stale id → drop silently

    const { preferred, fallback } = getPinSlotPrefs(resolved);
    const placement = findPinSlot(preferred, fallback, nDays, dayCursor, slotAvail);
    if (!placement) continue; // no legal slot remains in the trip

    const { day, slot } = placement;
    if (!pinClaimed.has(day)) pinClaimed.set(day, new Set());
    pinClaimed.get(day)!.add(slot);

    const baseEntry = toSlotEntry(resolved);
    const slotEntry: SlotEntry = { ...baseEntry, pinned: true };

    if (!pinnedSlots.has(day)) pinnedSlots.set(day, new Map());
    pinnedSlots.get(day)!.set(slot, { cardEntry: resolved, slotEntry });

    // Advance cursor past this day so pins spread across the trip.
    dayCursor = (day % nDays) + 1;
  }
  // -------------------------------------------------------------------------

  const days: Day[] = [];
  for (let d = 1; d <= nDays; d += 1) {
    const slots: Record<Slot, SlotEntry[]> = { morning: [], afternoon: [], evening: [] };
    const picks: CardEntry[] = [];
    const usedKinds = new Set<string>();
    let anchor: Region | undefined;

    const openAfternoon = nDays > 1 && (d === 1 || d === nDays);

    for (const slot of SECTIONS) {
      if (slot === 'afternoon' && openAfternoon) continue;
      if (slot === 'morning' && flags.has('no-early-mornings')) continue;

      // Check whether a pin pre-claimed this slot.
      const pin = pinnedSlots.get(d)?.get(slot);
      if (pin) {
        const { cardEntry: pick, slotEntry } = pin;
        // Pins are budget-exempt: they always place, but still debit the pool
        // (so normal fill doesn't overspend what the pin consumed).
        budgetLeft -= entryPrice(pick);
        ctx.lastUsedDay.set(entryId(pick), d);
        usedKinds.add(entryKind(pick));
        if (!anchor) anchor = entryRegion(pick);
        picks.push(pick);
        slots[slot].push(slotEntry);
        continue;
      }

      const pick = pickForSlot(ctx, slot, anchor, Math.max(0, budgetLeft), usedKinds);
      if (!pick) continue;
      budgetLeft -= entryPrice(pick);
      ctx.lastUsedDay.set(entryId(pick), d);
      usedKinds.add(entryKind(pick));
      if (!anchor) anchor = entryRegion(pick);
      picks.push(pick);
      slots[slot].push(toSlotEntry(pick));
    }

    days.push({
      day: d,
      title: titleFor(picks, d),
      color: DAY_COLORS[(d - 1) % DAY_COLORS.length],
      morning: slots.morning, afternoon: slots.afternoon, evening: slots.evening,
    });
  }

  return days;
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
cd /root/10daysonaruba.com && npx vitest run src/data/itineraryGenerator.test.ts 2>&1 | tail -30
```
Expected: all describe blocks (including the new pin placement ones) pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/itineraryGenerator.ts src/data/itineraryGenerator.test.ts
git commit -m "feat: generate plan with pinned picks pre-pass (budget-exempt, slotted, tested)"
```

---

## Task 4: `resolveSlotEntry` — honor pinned face verbatim

**Files:**
- Modify: `src/data/activitySource.ts`
- Modify: `src/data/activitySource.test.ts`

- [ ] **Step 1: Write failing tests**

Open `src/data/activitySource.test.ts`. Add:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveSlotEntry } from './activitySource';
import { getCatalog } from './activitySource';
import type { SlotEntry } from '../types';

describe('resolveSlotEntry — pinned short-circuit', () => {
  it('returns the exact pinned item verbatim (skips fit/budget re-facing)', () => {
    const cat = getCatalog();
    const item = cat.items[0];
    const entry: SlotEntry = { kind: 'group', groupId: item.group_id, bestSellerId: item.id, pinned: true };
    const result = resolveSlotEntry(entry, cat);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('group');
    if (result?.kind === 'group') {
      expect(result.bestSeller.id).toBe(item.id);
    }
  });

  it('falls back to normal re-facing when pinned id is stale (item no longer in catalog)', () => {
    const cat = getCatalog();
    const group = cat.groups[0];
    // Stale bestSellerId — not in catalog.items
    const stale: SlotEntry = { kind: 'group', groupId: group.id, bestSellerId: 'stale-id', pinned: true };
    const result = resolveSlotEntry(stale, cat);
    // Normal re-facing: returns the group's current best item, not null
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('group');
  });

  it('unpinned group entry still self-heals as before', () => {
    const cat = getCatalog();
    const item = cat.items[0];
    const entry: SlotEntry = { kind: 'group', groupId: item.group_id, bestSellerId: item.id };
    const result = resolveSlotEntry(entry, cat);
    expect(result?.kind).toBe('group');
  });
});
```

- [ ] **Step 2: Run tests — expect failures for the short-circuit tests**

```bash
cd /root/10daysonaruba.com && npx vitest run src/data/activitySource.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Add the pinned short-circuit to `resolveSlotEntry`**

In `src/data/activitySource.ts`, find the group branch of `resolveSlotEntry` (currently starting at `const g = catalog.groups.find...`). Add the short-circuit immediately before the existing pool-building code:

```typescript
export function resolveSlotEntry(
  slotEntry: SlotEntry, catalog: Catalog, tags?: Set<MatchTag>, slot?: Slot,
): CardEntry | null {
  if (slotEntry.kind === 'activity') {
    const a = catalog.activities.find((x) => x.id === slotEntry.id)
      ?? LUNCHSPOTS.find((x) => x.id === slotEntry.id);
    return a ? { kind: 'activity', activity: a } : null;
  }
  const g = catalog.groups.find((x) => x.id === slotEntry.groupId);
  if (!g) return null;

  const all = itemsInGroup(g.id, catalog);
  if (all.length === 0) return null;

  // Pinned short-circuit: if the stored id is still in the catalog, return it
  // verbatim — no fit/slot/budget re-facing. The generator placed this item
  // exactly because the user asked for it; we must honor that choice.
  // If the id has gone stale (live catalog refresh changed product codes),
  // fall through to the normal re-facing so the card never blanks.
  if (slotEntry.pinned) {
    const exact = all.find((x) => x.id === slotEntry.bestSellerId);
    if (exact) {
      return { kind: 'group', group: g, bestSeller: exact, others: all.filter((i) => i.id !== exact.id) };
    }
    // Stale: fall through to normal self-healing re-face below.
  }

  // ... rest of existing code unchanged ...
  const fits = (i: ViatorItem) => !tags || !fitItem(i, tags).rejected;
  const slotOk = (i: ViatorItem) => slot === undefined || itemSlotOk(i, slot);
  const fitSlot = all.filter((i) => fits(i) && slotOk(i));
  const fitOnly = all.filter(fits);
  const slotOnly = all.filter(slotOk);
  const pool = fitSlot.length ? fitSlot : fitOnly.length ? fitOnly : slotOnly.length ? slotOnly : all;

  const bs = pool.find((x) => x.id === slotEntry.bestSellerId)
          ?? (tags ? bestItemForAnswers(pool, tags) : null)
          ?? pool.find((x) => x.is_best_seller)
          ?? pool[0];
  if (!bs) return null;
  return { kind: 'group', group: g, bestSeller: bs, others: pool.filter((i) => i.id !== bs.id) };
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
cd /root/10daysonaruba.com && npx vitest run src/data/activitySource.test.ts 2>&1 | tail -20
```
Expected: all 3 new tests pass; no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/data/activitySource.ts src/data/activitySource.test.ts
git commit -m "feat: resolveSlotEntry honors pinned face verbatim, falls back on stale id"
```

---

## Task 5: Lift shortlist to App

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/Explore.tsx`

- [ ] **Step 1: Add `shortlist` state to `App.tsx`**

In `AppShell` in `src/App.tsx`, add after the existing state declarations:

```typescript
const [shortlist, setShortlist] = useState<Set<string>>(new Set());
```

Then update the `<Explore>` render line to pass the new props:
```tsx
{page === 'explore' && <Explore setPage={setPage} answers={answers} onLogin={() => setLoginOpen(true)} canSeeItinerary={canSeeItinerary} shortlist={shortlist} setShortlist={setShortlist} />}
```

And update the `<Itinerary>` render line:
```tsx
{page === 'itinerary' && (canSeeItinerary || shareId) && <Itinerary setPage={setPage} answers={answers} setAnswers={setAnswers} onLogin={() => setLoginOpen(true)} shareId={shareId} shortlist={shortlist} />}
```

- [ ] **Step 2: Update `Explore.tsx` Props + replace local state**

In `src/pages/Explore.tsx`, change Props from:
```typescript
type Props = { setPage: (p: PageId) => void; answers: Answers; onLogin: () => void; canSeeItinerary: boolean; };
```
to:
```typescript
type Props = {
  setPage: (p: PageId) => void;
  answers: Answers;
  onLogin: () => void;
  canSeeItinerary: boolean;
  shortlist: Set<string>;
  setShortlist: (s: Set<string>) => void;
};
```

Update the function signature to destructure the new props:
```typescript
export default function Explore({ setPage, answers, onLogin, canSeeItinerary, shortlist, setShortlist }: Props) {
```

Delete the local state line:
```typescript
// DELETE: const [added, setAdded] = useState<Set<string>>(new Set());
```

Replace the `toggleAdd` function to use `setShortlist`:
```typescript
const toggleAdd = (id: string) => {
  const next = new Set(shortlist);
  if (next.has(id)) next.delete(id); else next.add(id);
  setShortlist(next);
};
```

Replace all uses of `added` with `shortlist` in the component body:
- `added.size > 0` → `shortlist.size > 0`
- `{added.size} added` → `{shortlist.size} added`
- `added.has(...)` → `shortlist.has(...)`
- (The `setAdded` call is now inside `toggleAdd` using `setShortlist`, so all call sites of `toggleAdd` are unchanged)

- [ ] **Step 3: Verify TypeScript compiles clean**

```bash
cd /root/10daysonaruba.com && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd /root/10daysonaruba.com && npx vitest run 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/pages/Explore.tsx
git commit -m "feat: lift shortlist to App state, pass to Explore and Itinerary"
```

---

## Task 6: Itinerary seeds with shortlist + pinned count header

**Files:**
- Modify: `src/pages/Itinerary.tsx`

- [ ] **Step 1: Add `shortlist` to Itinerary Props**

In `src/pages/Itinerary.tsx`, find the Props type:
```typescript
type Props = { setPage: (p: PageId) => void; answers: Answers; setAnswers: (a: Answers) => void; onLogin: () => void; shareId: string | null };
```
Change to:
```typescript
type Props = { setPage: (p: PageId) => void; answers: Answers; setAnswers: (a: Answers) => void; onLogin: () => void; shareId: string | null; shortlist?: Set<string> };
```

Add `shortlist = new Set<string>()` to destructuring:
```typescript
export default function Itinerary({ setPage, answers, setAnswers, onLogin, shareId, shortlist = new Set() }: Props) {
```

- [ ] **Step 2: Seed `generatePlan` with pinned shortlist**

Find the `useState` initializer for the plan (line ~52):
```typescript
const [plan, setPlan] = useState<PlannedDay[]>(() => seedPlan(generatePlan(answers, catalog)));
```
Replace with:
```typescript
const [plan, setPlan] = useState<PlannedDay[]>(() =>
  seedPlan(generatePlan(answers, catalog, { pinned: [...shortlist] }))
);
```

- [ ] **Step 3: Compute `pinnedCount`**

Add after `const resolveEntry = ...` (around line ~179):

```typescript
// Count badge-eligible pinned cards: pinned=true AND resolved face matches stored id.
// Computed from the plan (not shortlist) so it stays truthful after swaps/saves.
const pinnedCount = useMemo(() => {
  let n = 0;
  for (const day of plan) {
    for (const section of SECTIONS) {
      for (const card of day[section]) {
        const e = card.entry;
        if (!e.pinned) continue;
        const resolved = resolveEntry(e, section as Slot);
        if (!resolved) continue;
        if (e.kind === 'activity') { n++; continue; }
        if (resolved.kind === 'group' && resolved.bestSeller.id === e.bestSellerId) n++;
      }
    }
  }
  return n;
}, [plan, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Render the header count**

In the itinerary header section (around line ~447, after the `<p>` with the subtitle), add:

```tsx
{pinnedCount > 0 && (
  <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', margin: '8px 0 0' }}>
    ★ {pinnedCount} of your {pinnedCount === 1 ? 'pick' : 'picks'} placed
  </p>
)}
```

- [ ] **Step 5: Compute `isPinned` in `SortableCard` and pass to `ItineraryCard`**

In the `SortableCard` function (around line ~700), add the isPinned calculation:

```typescript
// Compute badge eligibility: pinned entry AND resolved face matches stored id.
const isPinned = card.entry.pinned
  ? (card.entry.kind === 'activity'
      || (entry.kind === 'group' && entry.bestSeller.id === card.entry.bestSellerId))
  : false;
```

Then pass `pinned={isPinned}` to `<ItineraryCard>`:
```tsx
<ItineraryCard
  entry={entry}
  pinned={isPinned}
  flipped={flipped.has(card.uid)}
  swapping={swapping.has(card.uid)}
  onFlip={() => onFlip(card.uid)}
  onSwap={readOnly ? undefined : () => onOpenSwap(card.uid)}
  showReasons={!readOnly && reasonOpen.has(card.uid)}
  onPickReason={readOnly ? undefined : (reason) => onSwap(card.uid, section, entry, reason)}
  onAddItem={readOnly ? undefined : (item) => onAddItem(dayNum, section, item)}
/>
```

- [ ] **Step 6: Verify TypeScript compiles clean**

```bash
cd /root/10daysonaruba.com && npx tsc --noEmit 2>&1 | head -20
```
Expected: errors only about `pinned` prop not yet being accepted by `ItineraryCard` (fixed in Task 7).

- [ ] **Step 7: Commit (partial — TS errors OK, Task 7 completes it)**

```bash
git add src/pages/Itinerary.tsx
git commit -m "feat: Itinerary seeds plan with shortlist pins, shows count header"
```

---

## Task 7: Badge UI — `ItineraryCard`, `GroupCard`, `GroupHeader`

**Files:**
- Modify: `src/components/ItineraryCard.tsx`
- Modify: `src/components/GroupCard.tsx`
- Modify: `src/components/GroupHeader.tsx`

- [ ] **Step 1: Add `pinned` prop to `ItineraryCard` + thread to children**

In `src/components/ItineraryCard.tsx`, update Props:
```typescript
type Props = {
  entry: CardEntry;
  flipped: boolean;
  swapping: boolean;
  pinned?: boolean;
  onFlip: () => void;
  onSwap?: () => void;
  showReasons?: boolean;
  onPickReason?: (reason: SwapReason) => void;
  onAddItem?: (item: ViatorItem) => void;
};
```

Update the function signature:
```typescript
export default function ItineraryCard({
  entry, flipped, swapping, pinned, onFlip, onSwap,
  showReasons = false, onPickReason, onAddItem,
}: Props) {
```

Thread `pinned` to both card variants. Change the `front` assignment to:
```typescript
const front = entry.kind === 'activity'
  ? <ActivityCardFront a={entry.activity} bookUrl={bookUrl} pinned={pinned}
                       onFlip={onFlip} onSwap={onSwap}
                       showReasons={showReasons} onPickReason={onPickReason} />
  : <GroupCard group={entry.group} bestSeller={entry.bestSeller}
               others={entry.others} bookUrl={bookUrl} pinned={pinned}
               onSwap={onSwap} onFlip={onFlip}
               showReasons={showReasons} onPickReason={onPickReason}
               suggestionsOpen={suggestionsOpen}
               onToggleSuggestions={() => setSuggestionsOpen((v) => !v)}
               onAddItem={onAddItem} />;
```

- [ ] **Step 2: Add badge to `ActivityCardFront`**

In `src/components/ItineraryCard.tsx`, update `ActivityCardFront` Props and add badge:

```typescript
function ActivityCardFront({
  a, bookUrl, pinned, onFlip, onSwap, showReasons, onPickReason,
}: {
  a: Activity;
  bookUrl: string | null;
  pinned?: boolean;
  onFlip: () => void;
  onSwap?: () => void;
  showReasons?: boolean;
  onPickReason?: (reason: SwapReason) => void;
}) {
```

In the `.card-header-band` div, add the badge:
```tsx
<div className="card-header-band">
  <div className="chb-title">{a.category}</div>
  {pinned && (
    <span style={{ background: 'var(--yellow)', color: 'var(--ink)', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, flexShrink: 0, whiteSpace: 'nowrap' }}>★ Your pick</span>
  )}
</div>
```

- [ ] **Step 3: Add `pinned` prop to `GroupCard`**

In `src/components/GroupCard.tsx`, add `pinned?: boolean` to the Props type:
```typescript
type Props = {
  group: ViatorGroup;
  bestSeller: ViatorItem;
  others: ViatorItem[];
  bookUrl?: string | null;
  approved?: boolean;
  onApprove?: () => void;
  onSwap?: () => void;
  onFlip: () => void;
  pinned?: boolean;
  variant?: 'itinerary' | 'explore';
  showReasons?: boolean;
  onPickReason?: (reason: SwapReason) => void;
  suggestionsOpen?: boolean;
  onToggleSuggestions?: () => void;
  onAddItem?: (item: ViatorItem) => void;
};
```

Update the function signature to destructure `pinned`:
```typescript
export default function GroupCard({
  group, bestSeller, others, approved, onApprove, onSwap, onFlip, pinned,
  variant = 'itinerary', showReasons, onPickReason,
  suggestionsOpen, onToggleSuggestions, onAddItem, bookUrl,
}: Props) {
```

Pass `pinned` to `GroupHeader`:
```tsx
<GroupHeader group={group} href={tourUrl ?? undefined} pinned={pinned} />
```

- [ ] **Step 4: Add badge to `GroupHeader`**

In `src/components/GroupHeader.tsx`, update Props:
```typescript
type Props = {
  group: ViatorGroup;
  href?: string;
  showChevron?: boolean;
  pinned?: boolean;
};
```

Update function signature:
```typescript
export default function GroupHeader({ group, href, showChevron = true, pinned }: Props) {
```

Add the badge inside `inner`:
```typescript
const inner = (
  <>
    <div>
      <div className="chb-title">{group.name}</div>
      <div className="chb-subtitle">{group.tagline}</div>
    </div>
    {pinned && (
      <span style={{ background: 'var(--yellow)', color: 'var(--ink)', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, flexShrink: 0, whiteSpace: 'nowrap' }}>★ Your pick</span>
    )}
    {showChevron && href && <span aria-hidden className="chb-chev">›</span>}
  </>
);
```

- [ ] **Step 5: Verify TypeScript compiles clean**

```bash
cd /root/10daysonaruba.com && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 6: Run all tests**

```bash
cd /root/10daysonaruba.com && npx vitest run 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/ItineraryCard.tsx src/components/GroupCard.tsx src/components/GroupHeader.tsx
git commit -m "feat: show ★ Your pick badge on pinned cards in itinerary"
```

---

## Task 8: End-to-end smoke test + deploy

- [ ] **Step 1: Build check**

```bash
cd /root/10daysonaruba.com && npm run build 2>&1 | tail -10
```
Expected: build completes with no errors.

- [ ] **Step 2: Manual smoke test via dev server**

Open the Cloudflare tunnel (or `localhost:5173`). Verify:
1. Explore → add 2–3 activities using "+" buttons
2. The shortlist counter ("N added") updates correctly
3. Click "Build itinerary →" → Itinerary page loads
4. Header shows "★ N of your picks placed" (N matches the shortlist)
5. Each pinned card shows "★ Your pick" badge in its green header band
6. Non-pinned cards show no badge
7. A pinned card's "Swap this" removes the badge (swap clears the `pinned` flag)
8. Navigate back to Explore, the shortlist count is preserved
9. A signed-in user with a pre-existing saved trip: no badges/count after hydration (pins live in the generated plan, not the saved trip)

- [ ] **Step 3: Deploy to production**

```bash
cd /root/10daysonaruba.com && git push origin main
```

Expected: TransIP auto-deploy picks up the push within ~2 minutes.
