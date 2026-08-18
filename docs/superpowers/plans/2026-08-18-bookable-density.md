# Bookable Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap a trip at 4–5 advance bookings drawn from a persona-conditional whitelist, placed on a fixed non-consecutive schedule that never touches the arrival or departure day.

**Architecture:** A new module `src/data/bookables.ts` owns two ideas the engine does not currently have — *which* paid outings are worth booking (`bookableTier`) and *when* a trip may book (`bookingDays`). `itineraryGenerator.ts` gains two fields on its `Ctx` and consults them at the three gates that already exist (`fitsDayShape` for the pre-passes, `withinDayShape` for the fill ladder, and a tier-1-first retry in `pickForSlot`). Nothing about ranking, scoring or the budget pool changes.

**Tech Stack:** TypeScript, React, Vite, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-bookable-density-design.md` — read it before Task 1. The plan argues from it and does not repeat its reasoning.

## Global Constraints

- **`MAX_PAID_OUTINGS_PER_DAY` is unchanged.** It answers a different question (day intensity) from the new cap (advance bookings). Do not merge them.
- **Ranking is unchanged.** The schedule decides where and how many; the existing fit score still decides which.
- **The whitelist is consulted in the generator only.** `refaceForAnswers` in `itemFit.ts` builds the Swap shelf and must never learn about it, or diving disappears from the site.
- **Affiliate parameters belong on Viator URLs only.** `viatorLink()` appends `medium=link`; it must never be applied to `bookingUrl`.
- **Product ids are `ViatorItem.id`.** There is no `product_code` field. The four hard-coded ids are `7389P10` (animal sanctuary), `137607P22` (jet ski), `2455SUB` (submarine), `2455P18` (De Palm Island).
- **Every test must be mutation-checked**, per `.claude/CLAUDE.md`: break the code, confirm the test goes red, restore. Steps below say when.
- **Run the full suite** with `npx vitest run`. Exclude nothing; the untracked `.claude/worktrees/` copy is not present on this branch.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/data/bookables.ts` | **New.** What counts as a paid outing, which family it belongs to, which tier, and which days of a trip may carry one. Owns `isMealEntry` and `isPaidOuting`, moved here from the generator so all "is this a booking" logic sits in one place. |
| `src/data/bookables.test.ts` | **New.** Unit tests for the above, both directions on every persona-conditional family. |
| `src/data/itineraryGenerator.ts` | Modified. Imports and re-exports `isPaidOuting`; adds two `Ctx` fields; enforces at three gates. |
| `src/data/bookableDensity.test.ts` | **New.** Plan-level invariants across personas × seeds. |
| `src/data/exploreItems.ts` | Modified. Gains `bookUrlForActivity`. |
| `src/data/activities.ts` | Modified. `Activity.bookingUrl`, and the Flamingo link. |
| `src/components/ItineraryCard.tsx`, `src/pages/Explore.tsx`, `src/pages/Dashboard.tsx`, `src/pages/SurpriseMe.tsx` | Modified. Call the helper instead of five copies of the same expression. |
| `tools/plan-diff.ts` | Modified. Imports the predicates rather than mirroring them. |

---

### Task 1: The bookable whitelist

**Files:**
- Create: `src/data/bookables.ts`
- Create: `src/data/bookables.test.ts`
- Modify: `src/data/itineraryGenerator.ts` (remove `isMealEntry` / `isPaidOuting`, import and re-export instead)

**Interfaces:**
- Consumes: `activityKind` from `./itemFit`, `parseActivityCost` from `./matcher`, `CardEntry` / `MatchTag` from `../types`.
- Produces: `isMealEntry(e)`, `isPaidOuting(e)`, `bookableTier(e, tags): 1 | 2 | null`, `isBookable(e, tags): boolean`, and the four exported id constants.

- [ ] **Step 1: Write the failing test**

Create `src/data/bookables.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bookableTier, isBookable, ANIMAL_SANCTUARY_ID, JET_SKI_ID, SUBMARINE_ID, DE_PALM_ISLAND_ID } from './bookables';
import type { CardEntry, MatchTag, Section, ViatorGroup, ViatorItem } from '../types';
import type { Activity } from './activities';

const tags = (...t: MatchTag[]) => new Set<MatchTag>(t);

const GROUP: ViatorGroup = { id: 'g', name: 'g', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'islandwide', allowed_slots: [] };

function group(over: Partial<ViatorItem>): CardEntry {
  const bestSeller: ViatorItem = {
    id: 'x', group_id: 'g', title: '', image_url: '', price_usd: 100, duration: '',
    rating: 4.7, review_count: 100, viator_item_url: '', is_best_seller: false,
    display_order: 0, sections: ['cruises-water'] as Section[], ...over,
  };
  return { kind: 'group', group: GROUP, bestSeller, others: [] };
}

function local(over: Partial<Activity>): CardEntry {
  return { kind: 'activity', activity: {
    id: 'a', title: '', category: 'Activities', image: '', description: '', localsSay: '',
    cost: '$50', duration: '', timeOfDay: 'Morning', fitReason: '', location: '',
    rating: 4.5, reviewCount: 10, matched_by: [], ...over,
  } as Activity };
}

// tag 11888 = sailing, 11912 = snorkelling, 12035 = 4WD/off-road (see KIND_BY_TAG)
const SAIL = group({ title: 'Sunset Catamaran Sail', tags: [11888] });
const SNORKEL_BOAT = group({ title: 'Antilla Wreck Snorkel Cruise', tags: [11912] });
const BEACH_SHUTTLE = group({ title: 'Aruba Baby Beach Express Tour', tags: [11912] });
const JEEP = group({ title: 'Natural Pool Rugged Jeep Safari', tags: [12035] });
const ESCOOTER = group({ title: 'Guided 3-Hour E-Scooter Island Tour in Aruba', tags: [12035] });

describe('bookableTier — kind families', () => {
  it('accepts a sail for anyone', () => {
    expect(bookableTier(SAIL, tags('couple', 'mid-range'))).toBe(1);
  });

  it('accepts a snorkel boat but rejects a beach shuttle wearing the snorkel tag', () => {
    expect(bookableTier(SNORKEL_BOAT, tags('couple'))).toBe(1);
    expect(bookableTier(BEACH_SHUTTLE, tags('couple'))).toBe(null);
  });

  it('accepts a jeep safari but rejects an e-scooter wearing the off-road tag', () => {
    expect(bookableTier(JEEP, tags('couple'))).toBe(1);
    expect(bookableTier(ESCOOTER, tags('couple'))).toBe(null);
  });

  it('rejects anything free, because a booking costs money', () => {
    expect(bookableTier(group({ title: 'Free Sail', tags: [11888], price_usd: 0 }), tags('couple'))).toBe(null);
  });
});

describe('bookableTier — persona-conditional families, both directions', () => {
  const sanctuary = group({ id: ANIMAL_SANCTUARY_ID, title: 'Half-Day Aruba Animal Sanctuary Guided Tour' });
  const jetski = group({ id: JET_SKI_ID, title: 'Aruba Jet Ski Rental' });
  const sub = group({ id: SUBMARINE_ID, title: 'Aruba Atlantis Submarine Tour' });
  const dePalm = group({ id: DE_PALM_ISLAND_ID, title: 'Aruba De Palm Island Day Pass', tags: [11912] });
  const kite = local({ id: 'kitesurfing-lesson', title: "Kitesurfing at Fisherman's Huts", cost: '$120 lesson' });

  it('animal sanctuary: young kids only', () => {
    expect(bookableTier(sanctuary, tags('family-young-kids'))).toBe(1);
    expect(bookableTier(sanctuary, tags('couple'))).toBe(null);
    expect(bookableTier(sanctuary, tags('family-teens'))).toBe(null);
  });

  it('jet ski and kitesurfing: teens AND high-adventure', () => {
    expect(bookableTier(jetski, tags('family-teens', 'high-adventure'))).toBe(1);
    expect(bookableTier(jetski, tags('family-teens', 'med-adventure'))).toBe(null);
    expect(bookableTier(jetski, tags('friends', 'high-adventure'))).toBe(null);
    expect(bookableTier(kite, tags('family-teens', 'high-adventure'))).toBe(1);
    expect(bookableTier(kite, tags('family-teens'))).toBe(null);
  });

  it('submarine is tier 2 for young kids and nothing for teens', () => {
    expect(bookableTier(sub, tags('family-young-kids'))).toBe(2);
    expect(bookableTier(sub, tags('family-teens'))).toBe(null);
    expect(bookableTier(sub, tags('couple'))).toBe(null);
  });

  it('De Palm Island is tier 2 for kids of either age and NOT reachable via the snorkel row', () => {
    expect(bookableTier(dePalm, tags('family-young-kids'))).toBe(2);
    expect(bookableTier(dePalm, tags('family-teens'))).toBe(2);
    // The carve-out. Its Viator tag is snorkelling and its title says "Island"
    // and "Day Pass", so without an explicit id check it would pass row 3.
    expect(bookableTier(dePalm, tags('couple', 'mid-range'))).toBe(null);
  });
});

describe('bookableTier — curated locals', () => {
  it('accepts the three curated boat and jeep trips', () => {
    for (const id of ['antilla-wreck-dive', 'boca-catalina-snorkel', 'natural-pool-jeep']) {
      expect(bookableTier(local({ id, cost: '$60 pp' }), tags('couple'))).toBe(1);
    }
  });

  it('rejects the park gate, the optional guide and the Flamingo pass', () => {
    expect(bookableTier(local({ id: 'arikok-hiking', cost: '$11 entry' }), tags('couple'))).toBe(null);
    expect(bookableTier(local({ id: 'oranjestad-walking', cost: '$25 guided' }), tags('couple'))).toBe(null);
    expect(bookableTier(local({ id: 'flamingo-renaissance', cost: '$125 day pass' }), tags('treat-yourself'))).toBe(null);
  });

  it('rejects restaurants, which are meals rather than outings', () => {
    expect(bookableTier(local({ id: 'gasparito-restaurant', category: 'Food', cost: '$35–60 pp' }), tags('couple'))).toBe(null);
  });
});

describe('isBookable', () => {
  it('agrees with bookableTier on presence', () => {
    expect(isBookable(SAIL, tags('couple'))).toBe(true);
    expect(isBookable(ESCOOTER, tags('couple'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/bookables.test.ts`
Expected: FAIL — `Failed to resolve import "./bookables"`.

- [ ] **Step 3: Create the module**

Create `src/data/bookables.ts`:

```ts
import type { CardEntry, MatchTag } from '../types';
import { activityKind } from './itemFit';
import { parseActivityCost } from './matcher';

// === What a traveller must BOOK, as opposed to merely pay for ==============
//
// The engine already had two rules in this area and neither is a count:
// MAX_PAID_OUTINGS_PER_DAY caps a single day, and the trip budget pool caps
// spend. Cheap outings are always affordable, so every day that could pay for
// one got one — measured 2026-08-18 at NINE paid outings on nine consecutive
// days for an adventurous family, ending with a $120 dive on the departure
// morning. See docs/superpowers/specs/2026-08-18-bookable-density-design.md.

// A food card: the curated restaurants ('Dinner at Gasparito', 'Zeerovers Fish
// Fry') and every lunchspot, all of which carry category 'Food'. A Viator
// dinner cruise or sunset sail is deliberately NOT a meal — it is an outing you
// booked, so it counts as one of the two.
export function isMealEntry(e: CardEntry): boolean {
  return e.kind === 'activity' && e.activity.category === 'Food';
}

// A card that spends the day's one paid slot: it costs money, and is not a
// restaurant. MOVED HERE from itineraryGenerator.ts on 2026-08-18 so that every
// "is this a booking" question is answered by one module; the generator
// re-exports it, so `tools/plan-diff.ts` and existing tests are unaffected.
//
// The test is PRICE, not the affiliate link, and that was a deliberate call.
// "Has a Book now button" (`viator_item_url` && paid) is what the card renders
// and on the live catalog it agrees with price on all 328 Viator products —
// measured, zero divergence. The two differ on exactly three curated locals,
// which the owner ruled IN: the $11 Arikok gate, the $125 Flamingo day pass and
// the $120 kitesurfing lesson are strenuous outings whoever takes the payment.
//
// Price is also the only testable half. Every ViatorItem fixture in the suite
// carries `viator_item_url: ''`, so a link-based rule would be inert under
// `npm test` and every test written for it would pass against a rule that never
// fired.
export function isPaidOuting(e: CardEntry): boolean {
  if (isMealEntry(e)) return false;
  return e.kind === 'group'
    ? e.bestSeller.price_usd > 0
    : parseActivityCost(e.activity.cost) > 0;
}

// --- The whitelist ---------------------------------------------------------
//
// Viator tags say what a product TOUCHES, not what it IS. An air-conditioned
// bus that stops at a snorkelling beach is tagged for snorkelling; a Harley
// rental is tagged off-road. So two of the kind-based families need a title
// guard on top of the kind. Measured on the live catalog 2026-08-18: the guards
// drop 16 of 88 `offroad` items and 8 of 44 `snorkel` items, including three
// with enough reviews to actually be placed — two Baby Beach shuttles ($55/111
// reviews and $40/51 reviews, to a beach the plan already carries as a free
// card) and a sightseeing bus.
//
// `activityKind` is a good dedup key and a poor eligibility filter. Any family
// added here later must be audited by title before it is trusted.
const JEEP_TITLE = /\b(jeeps?|4x4|4wd|off.?road|utv|atv|buggy|safari|natural pool|conchi)\b/i;
const WATER_TITLE = /\b(snorkel(?:l?ing)?|catamaran|sail|cruise|boat|charter|seabob|reef|wreck|sea scooter|island|day pass)\b/i;

// Products named individually because no kind rule can reach them: the sanctuary
// classifies `sec:adventures-outdoor` and the submarine `sec:cruises-water`.
// These are `ViatorItem.id` — there is no product_code field on the type.
export const ANIMAL_SANCTUARY_ID = '7389P10';
export const JET_SKI_ID = '137607P22';
export const SUBMARINE_ID = '2455SUB';
export const DE_PALM_ISLAND_ID = '2455P18';

// Curated locals carry no Viator kind, so the paid ones are named. Absent from
// this set and therefore NOT bookables: `arikok-hiking` ($11 park gate) and
// `oranjestad-walking` ($25 optional guide), which are fees rather than advance
// bookings, and `flamingo-renaissance`, which no Viator product sells at all
// (zero of 328 titles name it) — it keeps its card and gains a direct link.
//
// Keeping the Arikok gate out matters more than its price suggests: at
// adventure 55 it is the most adventurous near-free item in the curated set.
const BOOKABLE_LOCAL_IDS = new Set(['antilla-wreck-dive', 'boca-catalina-snorkel', 'natural-pool-jeep']);

export type BookableTier = 1 | 2;

/**
 * Which tier of the whitelist this entry belongs to, or null if it is not
 * something a traveller books ahead.
 *
 * Tier 1 is the curated must-do set and has first claim on the trip's booking
 * days. Tier 2 is placed only when a booking day is left over.
 *
 * `tags` is load-bearing: three families are persona-conditional, so the same
 * product is a bookable for one traveller and not for another. A test that
 * asserts only one direction would pass against an implementation that ignored
 * this argument entirely.
 */
export function bookableTier(e: CardEntry, tags: Set<MatchTag>): BookableTier | null {
  if (!isPaidOuting(e)) return null;

  const youngKids = tags.has('family-young-kids');
  const anyKids = youngKids || tags.has('family-teens');
  const teensAdventurous = tags.has('family-teens') && tags.has('high-adventure');

  if (e.kind === 'activity') {
    if (BOOKABLE_LOCAL_IDS.has(e.activity.id)) return 1;
    if (e.activity.id === 'kitesurfing-lesson') return teensAdventurous ? 1 : null;
    return null;
  }

  const item = e.bestSeller;
  // Named products FIRST. De Palm Island would otherwise pass the snorkel row
  // on its own merits — Viator tags it for snorkelling and its title contains
  // both "Island" and "Day Pass" — which would hand it to every traveller and
  // make its audience rule unreachable code.
  if (item.id === DE_PALM_ISLAND_ID) return anyKids ? 2 : null;
  if (item.id === SUBMARINE_ID) return youngKids ? 2 : null;
  if (item.id === ANIMAL_SANCTUARY_ID) return youngKids ? 1 : null;
  if (item.id === JET_SKI_ID) return teensAdventurous ? 1 : null;

  const kind = activityKind(item);
  if (kind === 'sail') return 1;
  if (kind === 'snorkel') return WATER_TITLE.test(item.title) ? 1 : null;
  if (kind === 'offroad') return JEEP_TITLE.test(item.title) ? 1 : null;
  return null;
}

/** Whether this entry is something the traveller books in advance. */
export function isBookable(e: CardEntry, tags: Set<MatchTag>): boolean {
  return bookableTier(e, tags) !== null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/bookables.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Move the two predicates out of the generator**

In `src/data/itineraryGenerator.ts`, delete the `isMealEntry` function and the `isPaidOuting` function together with their comment blocks (they sit just above `MAX_PAID_OUTINGS_PER_DAY` and just below `isFullDayEntry`). Leave `MAX_PAID_OUTINGS_PER_DAY` where it is. Add to the import block at the top:

```ts
import { bookableTier, isBookable, isMealEntry, isPaidOuting, bookingDays } from './bookables';
```

and, next to the other re-exports, keep the old import path working for `tools/plan-diff.ts` and the existing test suite:

```ts
// Re-exported rather than moved outright: `tools/plan-diff.ts` and several
// tests import it from here, and a module that only forwards a symbol is
// cheaper than a rename across six files.
export { isPaidOuting } from './bookables';
```

Note `bookingDays` is imported now and used in Task 3; TypeScript will flag it as unused until then, so add it in Task 3 instead if your editor treats that as an error.

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: PASS. Nothing should change behaviourally — this step only moves code.

- [ ] **Step 7: Mutation-check the title guards**

Temporarily change `WATER_TITLE.test(item.title) ? 1 : null` to `1`.
Run: `npx vitest run src/data/bookables.test.ts`
Expected: FAIL on "rejects a beach shuttle wearing the snorkel tag". Restore, re-run, confirm green. Repeat for `JEEP_TITLE`.

- [ ] **Step 8: Commit**

```bash
git add src/data/bookables.ts src/data/bookables.test.ts src/data/itineraryGenerator.ts
git commit -m "feat(engine): a paid outing and a booking are not the same thing"
```

---

### Task 2: The booking-day schedule

**Files:**
- Modify: `src/data/bookables.ts`
- Modify: `src/data/bookables.test.ts`

**Interfaces:**
- Produces: `bookingDays(nDays: number, mustInclude?: number[]): number[]` — the days of a trip permitted to carry a bookable, ascending. Also `MAX_BOOKABLES` and `DAYS_PER_BOOKABLE`.

- [ ] **Step 1: Write the failing test**

Append to `src/data/bookables.test.ts`:

```ts
import { bookingDays } from './bookables';

describe('bookingDays', () => {
  // Verified against a reference implementation run over all 14 lengths while
  // the spec was written. If you change the formula, regenerate this table
  // rather than editing rows to match.
  const EXPECTED: Record<number, number[]> = {
    1: [1], 2: [2], 3: [2], 4: [3], 5: [2, 4], 6: [3, 5], 7: [2, 4, 6],
    8: [3, 5, 7], 9: [2, 4, 6, 8], 10: [3, 5, 7, 9], 11: [4, 6, 8, 10],
    12: [3, 5, 7, 9, 11], 13: [4, 6, 8, 10, 12], 14: [3, 5, 7, 9, 11, 13],
  };

  it('matches the schedule table for every trip length', () => {
    for (const [n, days] of Object.entries(EXPECTED)) {
      expect(bookingDays(Number(n))).toEqual(days);
    }
  });

  it('never books the arrival or the departure day on a real trip', () => {
    for (let n = 3; n <= 14; n += 1) {
      const days = bookingDays(n);
      expect(days).not.toContain(1);
      expect(days).not.toContain(n);
    }
  });

  it('never books two days running', () => {
    for (let n = 1; n <= 14; n += 1) {
      const days = bookingDays(n);
      for (let i = 1; i < days.length; i += 1) expect(days[i] - days[i - 1]).toBeGreaterThan(1);
    }
  });

  it('caps at six however long the trip', () => {
    expect(bookingDays(14).length).toBe(6);
  });

  it('honours days a curated template has already claimed', () => {
    // The balanced template places a wreck snorkel on day 2 and a natural-pool
    // jeep on day 4, both by construction and both bookables. They are pinned
    // into the schedule and the rest fill latest-first.
    expect(bookingDays(10, [2, 4])).toEqual([2, 4, 7, 9]);
  });

  it('ignores a pinned day that is illegal or adjacent to another', () => {
    expect(bookingDays(10, [1])).toEqual([3, 5, 7, 9]);   // arrival day
    expect(bookingDays(10, [10])).toEqual([3, 5, 7, 9]);  // departure day
    // 5 is adjacent to 4, so it is dropped — and the schedule still fills to its
    // full count of 4, exactly as it does when a pinned day is illegal rather than
    // adjacent. Corrected 2026-08-18: this line asserted [4, 7, 9], which contradicted
    // the reference implementation in Step 3 and would have let a template collision
    // silently cost the traveller a booking.
    expect(bookingDays(10, [4, 5])).toEqual([2, 4, 7, 9]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/bookables.test.ts -t bookingDays`
Expected: FAIL — `bookingDays is not a function`.

- [ ] **Step 3: Implement**

Append to `src/data/bookables.ts`:

```ts
// --- When a trip may book --------------------------------------------------
//
// One booking per 2.5 days, floor 1, cap 6 — the owner's rule, 2026-08-18.
// Everything else in that rule falls out of the CONSTRUCTION below rather than
// being enforced separately: arrival and departure days are outside the window,
// "never consecutive" is what latest-non-consecutive means, and with alternating
// days every other day is free of bookings, so "at least one unstructured middle
// day" needs no code of its own.
export const MAX_BOOKABLES = 6;
export const DAYS_PER_BOOKABLE = 2.5;

/**
 * The days of an `nDays` trip permitted to carry a bookable, ascending.
 *
 * Latest-first, because people book more readily once they have been on the
 * island a few days and trust the itinerary. A 10-day trip gets days 3, 5, 7, 9.
 *
 * It is FIXED rather than seed-varied, and that is a measured choice rather than
 * an oversight: there is no Regenerate button on the site — `Itinerary.tsx`
 * passes no seed and `Map.tsx` passes `{ seed: 0 }` — so a seed-weighted chooser
 * would carry a weighting table and tests for machinery nothing can trigger.
 * Swapping "always the latest" for "pick by seed" is a change to this function
 * alone if a Regenerate button ever ships.
 *
 * `mustInclude` are days a curated pre-pass has already committed to (the
 * balanced template places two bookables by construction). They are honoured
 * first and the remainder fill latest-first around them; an illegal or adjacent
 * one is dropped rather than bending the rules.
 *
 * A 10-day trip gets 4 and not the owner's "4 or 5" because 5 non-consecutive
 * days do not fit the window; 12 days is the first length that reaches 5.
 * Trips of 1 and 2 days drop the departure-day rule — on a 2-day trip day 2 IS
 * the departure day, and the alternative is a trip that can book nothing.
 */
export function bookingDays(nDays: number, mustInclude: number[] = []): number[] {
  const lo = nDays <= 1 ? 1 : 2;
  const hi = nDays <= 2 ? nDays : nDays - 1;
  if (hi < lo) return [];

  const width = hi - lo + 1;
  const wanted = Math.max(1, Math.min(MAX_BOOKABLES, Math.round(nDays / DAYS_PER_BOOKABLE)));
  const k = Math.min(wanted, Math.ceil(width / 2));

  const days: number[] = [];
  const free = (d: number) => d >= lo && d <= hi && days.every((x) => Math.abs(x - d) > 1);

  for (const d of [...mustInclude].sort((a, b) => a - b)) {
    if (days.length >= k) break;
    if (free(d)) days.push(d);
  }
  for (let d = hi; d >= lo && days.length < k; d -= 1) {
    if (free(d)) days.push(d);
  }
  return days.sort((a, b) => a - b);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/bookables.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-check**

Change `Math.abs(x - d) > 1` to `Math.abs(x - d) > 0`.
Run: `npx vitest run src/data/bookables.test.ts -t bookingDays`
Expected: FAIL on "never books two days running" and on the schedule table. Restore and confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/data/bookables.ts src/data/bookables.test.ts
git commit -m "feat(engine): a trip books late, and never two days running"
```

---

### Task 3: Carry the schedule on `Ctx` and enforce it in the fill ladder

**Files:**
- Modify: `src/data/itineraryGenerator.ts` — the `Ctx` type (~line 435), `generatePlan` (~line 1714), `withinDayShape` inside `fillSlot` (~line 2158)

**Interfaces:**
- Consumes: `bookingDays`, `bookableTier` from Task 1 and 2.
- Produces: `Ctx.bookingDaySet: Set<number>` and `Ctx.bookedDays: Set<number>`, plus the helper `mayBook(ctx, day): boolean`.

- [ ] **Step 1: Add the two `Ctx` fields**

In the `Ctx` type, after `usedRouteFamilies`:

```ts
  // Days permitted to carry a bookable, and the days that already do. Together
  // they are the trip-wide COUNT cap the engine never had: bookedDays.size is
  // how many advance bookings this trip has, and it may not exceed
  // bookingDaySet.size. See docs/superpowers/specs/2026-08-18-bookable-density-design.md.
  //
  // Two sets rather than a counter because a pin is exempt from the SCHEDULE but
  // not from the COUNT: a shortlisted tour lands on whatever day it lands on and
  // still spends one of the trip's bookings.
  bookingDaySet: Set<number>;
  bookedDays: Set<number>;
```

- [ ] **Step 2: Add the gate helper**

Below `routeFamilyOf` in the same file:

```ts
// Whether a bookable may be placed on this day. Pins bypass the SCHEDULE half
// (an explicit shortlist choice always lands) but never this function — see the
// pin pre-pass, which marks the day booked without asking.
function mayBook(ctx: Ctx, day: number): boolean {
  if (ctx.bookedDays.has(day)) return false;                  // one booking per day
  if (ctx.bookedDays.size >= ctx.bookingDaySet.size) return false;  // trip cap spent
  return ctx.bookingDaySet.has(day);
}
```

- [ ] **Step 3: Write the failing test**

Create `src/data/bookableDensity.test.ts` with a first case (the fixture helper is filled out in Task 7; for now build a minimal one):

```ts
import { describe, it, expect } from 'vitest';
import { generatePlan } from './itineraryGenerator';
import { bookableTier, bookingDays } from './bookables';
import { getCatalog, resolveSlotEntry } from './activitySource';
import { answersToTags } from './answerTags';
import { DEFAULT_ANSWERS, type Answers } from '../App';

const catalog = getCatalog();

function bookedDaysOf(answers: Answers, seed = 0): number[] {
  const tags = answersToTags(answers);
  const out: number[] = [];
  for (const day of generatePlan(answers, catalog, { seed })) {
    const entries = [...day.morning, ...day.afternoon, ...day.evening];
    const any = entries.some((se) => {
      const card = resolveSlotEntry(se, catalog, tags);
      return card ? bookableTier(card, tags) !== null : false;
    });
    if (any) out.push(day.day);
  }
  return out;
}

const COUPLE: Answers = { ...DEFAULT_ANSWERS, days: 10, groupType: 'Couple',
  budget: 'Mid-range', interests: ['Beach & chill'], adventureLevel: 50 };

describe('bookable density — the trip-wide cap', () => {
  it('never books more days than the schedule allows', () => {
    const booked = bookedDaysOf(COUPLE);
    expect(booked.length).toBeLessThanOrEqual(bookingDays(10).length);
  });

  it('never books two days running', () => {
    const booked = bookedDaysOf(COUPLE);
    for (let i = 1; i < booked.length; i += 1) expect(booked[i] - booked[i - 1]).toBeGreaterThan(1);
  });

  it('never books the arrival or the departure day', () => {
    const booked = bookedDaysOf(COUPLE);
    expect(booked).not.toContain(1);
    expect(booked).not.toContain(10);
  });
});
```

Check `resolveSlotEntry`'s real signature in `src/data/activitySource.ts` before running — it takes the slot in some call sites — and match it.

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/data/bookableDensity.test.ts`
Expected: FAIL — the couple currently books five consecutive days (2–6), so both the consecutive and the count assertions go red.

- [ ] **Step 5: Populate the sets in `generatePlan`**

Immediately after the balanced-template pre-pass closes (the `// ---` line ending it, ~line 1714) and before `premiumSlots` is declared:

```ts
  // --- The trip's booking schedule -------------------------------------------
  // Computed HERE and not earlier because the balanced template places two
  // bookables by construction — a wreck snorkel on day 2 and a natural-pool jeep
  // on day 4 — and those days are pinned into the schedule rather than moved.
  // The template's day placement carries geography and day-theme reasoning that
  // a generic "latest legal pattern" would throw away.
  const templateBookingDays = [...templateSlots.entries()]
    .filter(([, slots]) => [...slots.values()].some((p) => bookableTier(p.cardEntry, tags) !== null))
    .map(([day]) => day);
  for (const d of bookingDays(nDays, templateBookingDays)) ctx.bookingDaySet.add(d);
  for (const d of templateBookingDays) if (ctx.bookingDaySet.has(d)) ctx.bookedDays.add(d);

  // A pin is exempt from the schedule — the traveller chose it explicitly — but
  // it still spends one of the trip's bookings, exactly as it is budget-exempt
  // while still debiting the budget pool.
  for (const [day, slots] of pinnedSlots) {
    for (const p of slots.values()) {
      if (bookableTier(p.cardEntry, tags) !== null) ctx.bookedDays.add(day);
    }
  }
  // ---------------------------------------------------------------------------
```

and initialise the two fields where `ctx` is built (~line 1525), adding to the object literal:

```ts
bookingDaySet: new Set<number>(), bookedDays: new Set<number>(),
```

- [ ] **Step 6: Enforce in the ladder**

In `withinDayShape` inside `fillSlot`, immediately after the existing `MAX_PAID_OUTINGS_PER_DAY` line:

```ts
      // The trip-wide booking cap. Strictly tighter than the per-day rule above,
      // which still governs everything that merely costs money — a day may still
      // read "jeep safari + a free beach + a sunset".
      if (bookableTier(e, ctx.tags) !== null && !mayBook(ctx, d)) return false;
```

and where a pick is committed (just after `budgetLeft -= entryPrice(pick);`):

```ts
    if (bookableTier(pick, ctx.tags) !== null) ctx.bookedDays.add(d);
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run src/data/bookableDensity.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the whole suite**

Run: `npx vitest run`
Expected: Some existing engine tests will fail — they assert on plans that used to carry more paid outings. Read each failure before changing it. A test asserting "a paid outing appears on day N" where N is no longer a booking day should be updated; a test asserting a rule this change does not touch should not. Record which you changed and why in the commit message.

- [ ] **Step 9: Commit**

```bash
git add src/data/itineraryGenerator.ts src/data/bookableDensity.test.ts
git commit -m "feat(engine): the trip has a booking budget, not just a spending one"
```

---

### Task 4: Enforce at the pre-passes

**Files:**
- Modify: `src/data/itineraryGenerator.ts` — `fitsDayShape` (~line 1754), and the pin pre-pass

**Interfaces:**
- Consumes: `mayBook` from Task 3.

The premium splurge and beach-staple pre-passes both go through `fitsDayShape`; the pin and template passes do not. Task 3 already handled the template (its days are pinned into the schedule) and pins (exempt, but they mark the day booked). This task closes the remaining two.

- [ ] **Step 1: Write the failing test**

Append to `src/data/bookableDensity.test.ts`:

```ts
const SPLURGE: Answers = { ...DEFAULT_ANSWERS, days: 10, groupType: 'Couple',
  budget: 'Money no object', interests: ['Watersports'], adventureLevel: 60 };

it('holds for a money-no-object traveller, whose splurge pre-pass places directly', () => {
  const booked = bookedDaysOf(SPLURGE);
  expect(booked.length).toBeLessThanOrEqual(bookingDays(10).length);
  expect(booked).not.toContain(1);
  expect(booked).not.toContain(10);
  for (let i = 1; i < booked.length; i += 1) expect(booked[i] - booked[i - 1]).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/bookableDensity.test.ts -t money-no-object`
Expected: FAIL — the premium pre-pass places a private charter without consulting the schedule.

- [ ] **Step 3: Add the gate to `fitsDayShape`**

Inside `fitsDayShape`, after the existing paid-outing check:

```ts
    // Same trip-wide booking cap the ladder applies. The pre-passes place
    // UNCONDITIONALLY once they get here, so a rule enforced only in the ladder
    // is a rule the premium charter and the catamaran staple walk straight past.
    if (bookableTier(entry, tags) !== null && !mayBook(ctx, day)) return false;
```

- [ ] **Step 4: Mark the day booked when a pre-pass places**

At each of the two sites where a pre-pass commits — `premiumSlots.get(day)!.set(...)` and the equivalent line in the beach-staple pass — add immediately before:

```ts
    if (bookableTier(cardEntry, tags) !== null) ctx.bookedDays.add(day);
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/data/bookableDensity.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation-check**

Delete the line added in Step 3.
Run: `npx vitest run src/data/bookableDensity.test.ts -t money-no-object`
Expected: FAIL. Restore and confirm green.

- [ ] **Step 7: Run the whole suite and commit**

```bash
npx vitest run
git add src/data/itineraryGenerator.ts src/data/bookableDensity.test.ts
git commit -m "fix(engine): the pre-passes obey the booking schedule too"
```

---

### Task 5: Tier 1 gets first claim

**Files:**
- Modify: `src/data/itineraryGenerator.ts` — `pickForSlot` (~line 1004)

**Interfaces:**
- Consumes: `bookableTier`.

Without this, a family with kids can spend an early booking day on the submarine and reach the end of the trip with no catamaran — inverting the owner's priority. `pickForSlot` already runs `runLadder(kindOk)`; this adds a first pass that refuses tier 2, falling back to the full ladder only when tier 1 cannot fill the slot.

- [ ] **Step 1: Write the failing test**

Append to `src/data/bookableDensity.test.ts`:

```ts
import { SUBMARINE_ID, DE_PALM_ISLAND_ID } from './bookables';

const FAMILY: Answers = { ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with young kids',
  budget: 'Mid-range', interests: ['Beach & chill'], adventureLevel: 40 };

it('never spends a booking day on a tier 2 extra while tier 1 is unplaced', () => {
  const tags = answersToTags(FAMILY);
  const seen: Array<{ day: number; tier: number }> = [];
  for (const day of generatePlan(FAMILY, catalog, { seed: 0 })) {
    for (const se of [...day.morning, ...day.afternoon, ...day.evening]) {
      const card = resolveSlotEntry(se, catalog, tags);
      const tier = card ? bookableTier(card, tags) : null;
      if (tier !== null) seen.push({ day: day.day, tier });
    }
  }
  // Every tier 2 booking must come after every tier 1 booking.
  const lastTier1 = Math.max(-1, ...seen.filter((s) => s.tier === 1).map((s) => s.day));
  for (const s of seen.filter((s) => s.tier === 2)) expect(s.day).toBeGreaterThan(lastTier1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/bookableDensity.test.ts -t "tier 2"`
Expected: FAIL, or PASS by accident on the stub catalog. If it passes, confirm it is a real pass by temporarily making `bookableTier` return 2 for sails and re-running — it must go red. Restore.

- [ ] **Step 3: Implement the two-phase ladder**

In `pickForSlot`, where `runLadder` is currently called once, replace with:

```ts
  // Tier 1 first. The curated must-do set has first claim on the trip's booking
  // days; a tier 2 extra may only take one the must-do set cannot use. Without
  // this a family books the submarine on day 3 and never gets a catamaran.
  const tier1Only = (e: CardEntry) => kindOk(e) && bookableTier(e, ctx.tags) !== 2;
  return runLadder(tier1Only) ?? runLadder(kindOk);
```

Keep the existing `kindOk` parameter and the existing `lastResort` behaviour untouched; this wraps them.

- [ ] **Step 4: Run to verify it passes, then mutation-check**

Run: `npx vitest run src/data/bookableDensity.test.ts`
Expected: PASS.
Then change `runLadder(tier1Only) ?? runLadder(kindOk)` to `runLadder(kindOk)` and confirm the tier test goes red. Restore.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npx vitest run
git add src/data/itineraryGenerator.ts src/data/bookableDensity.test.ts
git commit -m "feat(engine): the catamaran outranks the submarine"
```

---

### Task 6: Plan-level invariants across personas

**Files:**
- Modify: `src/data/bookableDensity.test.ts`

This is the test that would have caught the reported bug. Everything before it tested one persona at a time.

- [ ] **Step 1: Write the test**

```ts
const PERSONAS: Record<string, Answers> = {
  'adventurous family, young kids': { ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with young kids',
    budget: 'Mid-range', interests: ['Adventure & adrenaline', 'Beach & chill'], adventureLevel: 80 },
  'adventurous family, teens': { ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with teens',
    budget: 'Mid-range', interests: ['Adventure & adrenaline', 'Watersports'], adventureLevel: 85 },
  'balanced couple': { ...DEFAULT_ANSWERS, days: 10, groupType: 'Couple',
    budget: 'Mid-range', interests: ['Beach & chill'], adventureLevel: 50 },
  'budget solo': { ...DEFAULT_ANSWERS, days: 10, groupType: 'Solo',
    budget: 'Budget-conscious', interests: ['Nature & hiking'], adventureLevel: 30 },
  'splurge couple': { ...DEFAULT_ANSWERS, days: 10, groupType: 'Couple',
    budget: 'Money no object', interests: ['Watersports'], adventureLevel: 60 },
};

describe('bookable density — every persona, every seed', () => {
  for (const [name, answers] of Object.entries(PERSONAS)) {
    for (const seed of [0, 1, 2, 3]) {
      it(`${name}, seed ${seed}`, () => {
        const tags = answersToTags(answers);
        const booked = bookedDaysOf(answers, seed);
        const allowed = bookingDays(answers.days);

        expect(booked.length).toBeLessThanOrEqual(allowed.length);
        expect(booked).not.toContain(1);
        expect(booked).not.toContain(answers.days);
        for (let i = 1; i < booked.length; i += 1) {
          expect(booked[i] - booked[i - 1]).toBeGreaterThan(1);
        }

        // Every bookable placed must be in the whitelist FOR THIS TRAVELLER.
        for (const day of generatePlan(answers, catalog, { seed })) {
          for (const se of [...day.morning, ...day.afternoon, ...day.evening]) {
            const card = resolveSlotEntry(se, catalog, tags);
            if (!card) continue;
            // A paid outing that is not a bookable must not exist in a
            // generated plan at all — that is the whitelist doing its job.
            if (isPaidOuting(card)) expect(bookableTier(card, tags)).not.toBeNull();
          }
        }
      });
    }
  }
});
```

Import `isPaidOuting` from `./bookables` at the top of the file.

- [ ] **Step 2: Run**

Run: `npx vitest run src/data/bookableDensity.test.ts`
Expected: 20 cases PASS. If a paid non-bookable slips through, find which gate it walked past rather than loosening the assertion.

- [ ] **Step 3: Commit**

```bash
git add src/data/bookableDensity.test.ts
git commit -m "test(engine): nine bookings on nine consecutive days, asserted against"
```

---

### Task 7: Keep `tools/plan-diff.ts` honest

**Files:**
- Modify: `tools/plan-diff.ts`

Its own header records what mirroring a rule costs: a previous copy used `isWaterBased` for the boat cap and reported violations that were not violations.

- [ ] **Step 1: Read the file's existing imports from `itineraryGenerator`**

Run: `grep -n "^import\|isPaidOuting\|MAX_PAID" tools/plan-diff.ts`

- [ ] **Step 2: Add the new predicates and an assertion**

Import `bookableTier` and `bookingDays` from `../src/data/bookables`, and add a check alongside the existing per-day paid-outing assertion: the number of days carrying a bookable must not exceed `bookingDays(nDays).length`, and no two may be consecutive.

- [ ] **Step 3: Run it against the live catalog**

Run: `npm run plan-diff`
Expected: no violations reported. This is the first run against real data rather than the stub — treat any violation as a real finding and fix the engine, not the tool.

- [ ] **Step 4: Commit**

```bash
git add tools/plan-diff.ts
git commit -m "chore(tools): plan-diff asserts the booking cap from the engine's own predicate"
```

---

### Task 8: A direct booking link for Flamingo Beach

**Files:**
- Modify: `src/data/activities.ts` (type + the `flamingo-renaissance` entry)
- Modify: `src/data/exploreItems.ts` (new helper)
- Modify: `src/components/ItineraryCard.tsx:49`, `src/pages/Explore.tsx:452`, `src/pages/Dashboard.tsx:117` and `:137`, `src/pages/SurpriseMe.tsx:54` and `:79`
- Create: `src/data/bookUrl.test.ts`

**Interfaces:**
- Produces: `bookUrlForActivity(a: Activity): { url: string; affiliate: boolean } | null`

- [ ] **Step 1: Write the failing test**

Create `src/data/bookUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bookUrlForActivity } from './exploreItems';
import { ACTIVITIES } from './activities';

const byId = (id: string) => ACTIVITIES.find((a) => a.id === id)!;

describe('bookUrlForActivity', () => {
  it('gives Flamingo the operator link, with no affiliate parameter on it', () => {
    const r = bookUrlForActivity(byId('flamingo-renaissance'));
    expect(r).not.toBeNull();
    expect(r!.url).toBe('https://renaissancearuba.idaypass.com/');
    expect(r!.url).not.toContain('medium=link');
    expect(r!.affiliate).toBe(false);
  });

  it('still adds the affiliate parameter to a Viator-linked activity', () => {
    const r = bookUrlForActivity({ ...byId('antilla-wreck-dive'),
      viator_item_url: 'https://viator.com/tours/x?pid=P00302487&mcid=42383' });
    expect(r!.affiliate).toBe(true);
    expect(r!.url).toContain('medium=link');
    expect(r!.url).toContain('pid=P00302487');
  });

  it('gives a free activity no link at all', () => {
    expect(bookUrlForActivity(byId('eagle-beach-morning'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/bookUrl.test.ts`
Expected: FAIL — `bookUrlForActivity` is not exported.

- [ ] **Step 3: Add the field and the link**

In `src/data/activities.ts`, add to the `Activity` type beside `viator_item_url`:

```ts
  /**
   * A DIRECT, non-affiliate booking URL. Deliberately not `viator_item_url`:
   * every surface runs that field through `viatorLink()`, which appends
   * `medium=link` — an affiliate parameter with no business on an operator's own
   * booking page. A commission-bearing link and a courtesy link are different
   * things and should not share a field.
   *
   * `flamingo-renaissance` is its only holder: zero of 328 Viator products name
   * Flamingo or Renaissance, so the pass can only be booked with the hotel.
   */
  bookingUrl?: string;
```

and on the `flamingo-renaissance` entry add `bookingUrl: 'https://renaissancearuba.idaypass.com/',`.

- [ ] **Step 4: Add the helper**

In `src/data/exploreItems.ts`, beside `viatorLink`:

```ts
/**
 * The book link for a curated activity, and whether it earns us anything.
 *
 * One helper rather than a sixth copy: this expression was duplicated at five
 * call sites, each some form of `viator_item_url && cost > 0 ? viatorLink(...)`.
 * Adding a second source of truth to five near-identical expressions is how they
 * drift, and this repo already carries scar tissue from exactly that.
 *
 * The `affiliate` flag lets the button be honest: a Viator link reads "Book now",
 * a direct one reads "Book direct".
 */
export function bookUrlForActivity(a: Activity): { url: string; affiliate: boolean } | null {
  if (parseActivityCost(a.cost) <= 0) return null;
  if (a.viator_item_url) return { url: viatorLink(a.viator_item_url), affiliate: true };
  if (a.bookingUrl) return { url: a.bookingUrl, affiliate: false };
  return null;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/data/bookUrl.test.ts`
Expected: PASS.

- [ ] **Step 6: Replace the five call sites**

At each of `ItineraryCard.tsx:49`, `Explore.tsx:452`, `Dashboard.tsx:117`, `Dashboard.tsx:137`, `SurpriseMe.tsx:54`, `SurpriseMe.tsx:79`, call `bookUrlForActivity(activity)` and use `.url`. In `ItineraryCard.tsx` also use `.affiliate` to choose the label: `Book now ↗` when true, `Book direct ↗` when false.

- [ ] **Step 7: Render-test the label**

Add to `src/components/ItineraryCard.dom.test.tsx` (or create it with a `// @vitest-environment jsdom` docblock, following `DepartureNote.dom.test.tsx`): rendering the Flamingo card shows a link to `renaissancearuba.idaypass.com` labelled "Book direct", and rendering a Viator-linked card shows "Book now".

- [ ] **Step 8: Mutation-check the affiliate guard**

Change `if (a.bookingUrl) return { url: a.bookingUrl, affiliate: false };` to `return { url: viatorLink(a.bookingUrl), affiliate: false };`.
Run: `npx vitest run src/data/bookUrl.test.ts`
Expected: FAIL on "no affiliate parameter on it". Restore and confirm green.

- [ ] **Step 9: Verify in a real build**

Run: `npm run build && npm run preview`
Open the itinerary, find the Flamingo card, confirm the link opens the day-pass site. Do NOT use `npm run dev` for this — see the dev-server advisories in `.claude/CLAUDE.md`.

- [ ] **Step 10: Commit**

```bash
git add src/data/activities.ts src/data/exploreItems.ts src/data/bookUrl.test.ts src/components src/pages
git commit -m "feat(cards): Flamingo gets the operator's link, and no affiliate tag on it"
```

---

### Task 9: Measure the result and write it down

**Files:**
- Modify: `docs/matching-engine/development-log.md`
- Modify: `docs/ROADMAP.md`

The spec's "Expected effect" section is a projection and says so. This task replaces it with a measurement.

- [ ] **Step 1: Measure**

Run: `npm run trace -- --persona adventurer --days 10` and `npm run plan-diff`, and record for each of the five personas in Task 6: bookings placed, which days, total spend, and open slots.

- [ ] **Step 2: Write the log entry**

Add an entry to `docs/matching-engine/development-log.md` giving the before figures (9 bookings, days 2–10, $972 for the adventurous family; 5 bookings, days 2–6, $475 for the balanced couple) against the measured after figures. Say plainly if a persona now books fewer times than the schedule allows and why — running out of tier 1 families is expected, not a bug.

- [ ] **Step 3: Correct the spec**

Replace the projected "$400–500" in section 8 of the spec with the measured number, and delete the sentence marking it a projection.

- [ ] **Step 4: Add the follow-on work to the roadmap**

`docs/ROADMAP.md` gains rows for the two pieces this change deliberately left out: the free-alternative honesty layer, and free self-guided adventure content for the curated set (17 of 26 locals are free, 13 of those are beaches, and the non-beach content tops out at adventure 50 — so an adventure-85 traveller's six non-booking days read like a beach-and-chill traveller's).

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(engine): what the booking cap actually did, measured"
```

---

## Self-Review

**Spec coverage.** Section 1 (whitelist, both tiers, curated locals, Flamingo and diving exclusions) → Task 1. Section 2 (schedule) → Task 2. Section 2b (supply check) → measured in Task 9 rather than coded; it is an analysis, not a requirement. Section 3 (five enforcement paths) → Tasks 3, 4, 5: ladder, `fitsDayShape` for premium and staple, template via `mustInclude`, pins via the debit loop. Section 4 (template reconciliation) → Task 3 Step 5. Section 5 (out of scope) → nothing to build; the two named follow-ons are filed in Task 9 Step 4. Section 6 (verification) → Tasks 1, 2, 6, 7, and the id-resolution test noted below. Section 7 (Flamingo link) → Task 8. Section 8 (expected effect) → Task 9.

**Gap found and closed:** the spec asks for a test that every hard-coded product id still resolves against the live catalog. No task carried it. Add to Task 6 as a final case, reading the live catalog via `loadCatalog()` and asserting each of `ANIMAL_SANCTUARY_ID`, `JET_SKI_ID`, `SUBMARINE_ID`, `DE_PALM_ISLAND_ID` is present — skipped when the loader falls back to the offline stub, so `npm test` stays offline and free.

**Type consistency.** `bookableTier` returns `1 | 2 | null` in every task. `bookingDays(nDays, mustInclude?)` is called with one argument in Tasks 2 and 6 and two in Task 3. `bookUrlForActivity` returns `{ url, affiliate } | null` in both Task 8 and its test. `Ctx.bookingDaySet` and `Ctx.bookedDays` are named identically in Tasks 3, 4 and 5.

**Known risk.** Task 3 Step 8 expects existing engine tests to fail, and the plan cannot say which — the suite is ~950 tests and several assert on generated plans that used to carry more paid outings. Whoever executes it must read each failure rather than updating assertions to match new output, which is how a test that cannot fail gets written.
