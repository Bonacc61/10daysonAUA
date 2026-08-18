import { describe, it, expect } from 'vitest';
import { generatePlan } from './itineraryGenerator';
import { bookableTier, bookingDays } from './bookables';
import { resolveSlotEntry, type Catalog } from './activitySource';
import { answersToTags } from './answerTags';
import { ACTIVITIES } from './activities';
import { DEFAULT_ANSWERS, type Answers } from '../App';
import type { ViatorGroup, ViatorItem } from '../types';

// R2 ruling (2026-08-18): the offline stub catalog (`getCatalog()`) carries 20
// items and NONE of them carry Viator tag ids, so `activityKind` falls back to
// `sec:<section>` for all of them and zero classify into the `sail`, `snorkel`
// or `offroad` families the whitelist is built from. A density test written
// against `getCatalog()` would assert over plans with no bookables in them at
// all — every assertion here would pass trivially. This fixture exists so the
// tests can fail.
//
// Real ACTIVITIES (not invented locals) supply the curated bookables
// (antilla-wreck-dive, boca-catalina-snorkel, natural-pool-jeep) and the free
// beaches that fill the non-booking days, exactly as in production.
function fixture(): Catalog {
  const groups: ViatorGroup[] = [
    { id: 'sailing', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: [], region: 'islandwide', allowed_slots: [] },
    { id: 'premium-sailing', name: 'Private Charters', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: [], region: 'islandwide', allowed_slots: [] },
    { id: 'offroad-tours', name: 'Off-Road Tours', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 1, matched_by: [], region: 'islandwide', allowed_slots: [] },
    { id: 'misc-tours', name: 'Other Tours', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 2, matched_by: [], region: 'islandwide', allowed_slots: [] },
  ];

  const mk = (
    id: string, group_id: string, title: string, tags: number[], price: number,
  ): ViatorItem => ({
    id, group_id, title, image_url: '', price_usd: price, duration: '', rating: 4.7,
    // MIN_CATALOG_TO_FLOOR is 60; this fixture is far smaller, so the
    // champion-review floor never applies regardless — every item still gets a
    // real review count so a floor bug can never masquerade as something else.
    review_count: 500, viator_item_url: '', is_best_seller: false, display_order: 0, tags,
  });

  const items: ViatorItem[] = [
    // Money-no-object tier and on the whitelist (kind 'sail' returns tier 1
    // unconditionally): the one candidate the premium-splurge pre-pass can
    // actually place for SPLURGE below, since every other item in this fixture
    // prices under the $300 money-no-object floor. Its own group, so it does
    // not shadow `sail-day`/`sail-eve` in `bestPerGroup` (one splurge per
    // GROUP) — it claims the trip's 'sail' route family instead, same as a
    // real private charter would.
    mk('private-charter', 'premium-sailing', 'Private Luxury Catamaran Charter for Two', [11888], 650),
    // Tier 1, everyone: two DIFFERENT sail families (day / evening).
    mk('sail-day', 'sailing', 'Premium Catamaran Afternoon Sail: Snorkeling and Lunch', [11888], 75),
    mk('sail-eve', 'sailing', 'Aruba Sunset Sail Dinner Cruise with Open Bar', [11888], 137),
    // Tier 1, everyone: snorkel family, title passes the water guard.
    mk('snorkel-boat', 'sailing', 'Antilla Shipwreck and Catalina Bay Snorkel Sail', [11912], 79),
    // Tier 1, everyone: off-road family, TWO different route families —
    // natural-pool (title names it) vs generic offroad (does not) — which is
    // what lets a 10-day trip reach four distinct bookings.
    mk('jeep-conchi', 'offroad-tours', 'Aruba Natural Pool and Indian Cave Rugged Jeep Safari', [12035], 99),
    mk('jeep-utv', 'offroad-tours', 'Aruba UTV & ATV Adventure', [12035], 162),
    // Excluded: wears the off-road tag but fails the JEEP_TITLE guard.
    mk('escooter', 'offroad-tours', 'Guided 3-Hour E-Scooter Island Tour in Aruba', [12035], 89),
    // Excluded: wears the snorkel tag but fails the WATER_TITLE guard.
    mk('shuttle', 'misc-tours', 'Aruba Baby Beach Express Tour', [11912], 55),
    // Tier 1, young kids only, reached by product id (no kind rule reaches it).
    mk('7389P10', 'misc-tours', 'Half-Day Aruba Animal Sanctuary Guided Tour', [], 57),
    // Tier 1, adventurous teens only, reached by product id.
    mk('137607P22', 'misc-tours', 'Aruba Jet Ski Rental', [12062], 58),
    // Tier 2, young kids only, reached by product id.
    mk('2455SUB', 'misc-tours', 'Aruba Atlantis Submarine Tour', [], 112),
    // Tier 2, kids of either age — and the carve-out: wears the snorkel tag and
    // passes the water guard, so it must NOT be reachable for a childless
    // traveller (the named-id check has to run before the generic snorkel row).
    mk('2455P18', 'misc-tours', 'Aruba De Palm Island Day Pass', [11912], 135),
    // Excluded: a paid outing, but not on the whitelist at all.
    mk('walking', 'misc-tours', 'Aruba Downtown Historic and Cultural Walking Tour', [], 39),
    // Excluded: the originally reported bug.
    mk('sip-paint', 'misc-tours', 'Sip and Paint Aruba Sunset Creative Experience', [], 65),
    // Excluded, and the ONLY money-no-object-tier item in this fixture: a $650
    // paid product that names none of the twelve kinds and holds no named-id
    // exemption, so it is not on the whitelist. Being the sole premium-tier
    // candidate, it is what the premium-splurge pre-pass would place for a
    // money-no-object traveller if `fitsDayShape` did not also apply
    // `isExcludedPaidProduct` (R6 extension, task-4-addendum.md) — every other
    // check the splurge pass runs (fit, route family, boat clash) it clears.
    mk('luxury-cabana', 'misc-tours', 'Private Butler Beach Cabana Experience', [], 650),
  ];

  return { activities: ACTIVITIES, groups, items };
}

const CATALOG = fixture();
const EXCLUDED_IDS = new Set(['escooter', 'shuttle', 'walking', 'sip-paint']);

function bookedDaysOf(answers: Answers, seed = 0): number[] {
  const tags = answersToTags(answers);
  const out: number[] = [];
  for (const day of generatePlan(answers, CATALOG, { seed })) {
    const entries = [...day.morning, ...day.afternoon, ...day.evening];
    const any = entries.some((se) => {
      const card = resolveSlotEntry(se, CATALOG, tags);
      return card ? bookableTier(card, tags) !== null : false;
    });
    if (any) out.push(day.day);
  }
  return out;
}

function allPlacedIds(answers: Answers, seed = 0): string[] {
  const ids: string[] = [];
  for (const day of generatePlan(answers, CATALOG, { seed })) {
    for (const se of [...day.morning, ...day.afternoon, ...day.evening]) {
      if (se.kind === 'group') ids.push(se.bestSellerId);
    }
  }
  return ids;
}

const COUPLE: Answers = {
  ...DEFAULT_ANSWERS, days: 10, groupType: 'Couple',
  budget: 'Mid-range', interests: ['Beach & chill'], adventureLevel: 50,
};

// This persona is the mutation-sensitive proof that `mayBook` gates the fill
// ladder. `no-boats` removes every Viator item tagged sail/snorkel from the
// catalog (src/data/itineraryGenerator.ts, the `no-boats` flag handler) —
// which ALSO empties the two water-based beach staples (`catamaran-sail`,
// `beach-dinner` in src/data/staples.ts), so this scenario is the one place in
// this file where every bookable placement is attributable to the ladder
// itself, not to a not-yet-gated pre-pass (see the Task 4 note below). Verified
// by temporarily disabling the `mayBook` check in `withinDayShape`: `jeep-utv`
// (tier 1, family 'offroad') then lands on day 2 — a day outside
// `bookingDays(10)` — where with the gate restored it does not.
const OFFROAD_NO_BOATS: Answers = {
  ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with teens', budget: 'Treat yourself',
  interests: ['Adventure & adrenaline'], adventureLevel: 85, flags: ['no-boats'],
};

describe('bookable density — the trip-wide cap', () => {
  it('never books more days than the schedule allows, and every booked day is legal', () => {
    const booked = bookedDaysOf(OFFROAD_NO_BOATS);
    // The whole point of this fixture: without it, every assertion in this
    // suite passes trivially against an engine that places no bookables.
    expect(booked.length).toBeGreaterThan(0);
    expect(booked.length).toBeLessThanOrEqual(bookingDays(10).length);
    const allowed = new Set(bookingDays(10));
    for (const d of booked) expect(allowed.has(d)).toBe(true);
  });

  it('never books the arrival or the departure day', () => {
    const booked = bookedDaysOf(COUPLE);
    expect(booked.length).toBeGreaterThan(0);
    expect(booked).not.toContain(1);
    expect(booked).not.toContain(10);
  });

  // Task 4 gates the premium-splurge and beach-staple pre-passes through
  // `fitsDayShape`, so the 'catamaran-sail'/'beach-dinner' staples (and the
  // splurge charter) can no longer land next to a legally-scheduled ladder
  // booking with nothing checking the schedule. Promoted from `it.fails`
  // (ruling R7, 2026-08-18) now that the pre-passes are gated.
  it('never books two days running', () => {
    const booked = bookedDaysOf(COUPLE);
    for (let i = 1; i < booked.length; i += 1) expect(booked[i] - booked[i - 1]).toBeGreaterThan(1);
  });
});

const SPLURGE: Answers = {
  ...DEFAULT_ANSWERS, days: 10, groupType: 'Couple',
  budget: 'Money no object', interests: ['Watersports'], adventureLevel: 60,
};

describe('bookable density — the pre-passes obey the schedule', () => {
  it('holds for a money-no-object traveller, whose splurge pre-pass places directly', () => {
    const booked = bookedDaysOf(SPLURGE);
    expect(booked.length).toBeLessThanOrEqual(bookingDays(10).length);
    expect(booked).not.toContain(1);
    expect(booked).not.toContain(10);
    for (let i = 1; i < booked.length; i += 1) expect(booked[i] - booked[i - 1]).toBeGreaterThan(1);
  });

  // R11 (carried over from Task 3's review): `ctx.bookedDays.add(d)` in the
  // fill ladder was provably uncovered until this task gated the pre-passes —
  // every whitelist family carries a trip-wide route family, so the ladder can
  // supply at most ~4 distinct bookables, and the ungated staple pre-passes
  // used to overshoot the cap on their own, masking the ladder's own
  // accounting completely. Pinning a bookable onto a day OUTSIDE
  // `bookingDays(nDays)` and letting the ladder fill the legal days exercises
  // both the pin's debit and the ladder's own debit: the total booked days must
  // never exceed the schedule's length.
  it('counts a pin outside the schedule against the trip-wide cap, alongside the ladder', () => {
    const legalDays = new Set(bookingDays(10));
    const tags = answersToTags(OFFROAD_NO_BOATS);
    // Verified by running generatePlan directly: pinning 'jeep-conchi' with
    // dayCursor starting at 1 lands it on day 1 — the arrival day, which
    // `bookingDays` always excludes — so this pin is guaranteed to fall
    // outside the schedule without needing to hand-pick a day.
    const pinnedId = 'item:jeep-conchi';
    const plan = generatePlan(OFFROAD_NO_BOATS, CATALOG, { seed: 0, pinned: [pinnedId] });
    const pinDay = plan.find((day) => [...day.morning, ...day.afternoon, ...day.evening]
      .some((se) => se.kind === 'group' && se.bestSellerId === 'jeep-conchi'))?.day;
    expect(pinDay).toBeDefined();
    expect(legalDays.has(pinDay!)).toBe(false); // confirms the pin is off-schedule
    const booked: number[] = [];
    for (const day of plan) {
      const entries = [...day.morning, ...day.afternoon, ...day.evening];
      const any = entries.some((se) => {
        const card = resolveSlotEntry(se, CATALOG, tags);
        return card ? bookableTier(card, tags) !== null : false;
      });
      if (any) booked.push(day.day);
    }
    expect(booked.length).toBeLessThanOrEqual(bookingDays(10).length);
  });
});

describe('bookable density — the whitelist excludes what it must', () => {
  // Promoted from `it.fails` (ruling R6/R7, 2026-08-18): a Viator product that
  // is a paid outing and not on the whitelist is now excluded from auto-fill
  // entirely (`isExcludedPaidProduct` in itineraryGenerator.ts, applied in the
  // ladder's `withinDayShape`), not merely kept out of the trip-wide COUNT.
  it('never places the e-scooter, the shuttle, the walking tour or the sip-and-paint, for any persona', () => {
    const personas: Answers[] = [
      COUPLE,
      { ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with young kids', budget: 'Mid-range', interests: ['Adventure & adrenaline'], adventureLevel: 80 },
      { ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with teens', budget: 'Treat yourself', interests: ['Watersports'], adventureLevel: 90 },
      { ...DEFAULT_ANSWERS, days: 10, groupType: 'Solo', budget: 'Budget-conscious', interests: ['Culture & history'], adventureLevel: 20 },
    ];
    const placed = personas.flatMap((a) => allPlacedIds(a));
    expect(placed.length).toBeGreaterThan(0);
    for (const id of EXCLUDED_IDS) expect(placed).not.toContain(id);
  });

  // Task 4's own hole (R6 extension, task-4-addendum.md): the ladder's
  // `withinDayShape` already refused a non-whitelist paid product, but the
  // premium-splurge pre-pass placed unconditionally and never asked. Sourced
  // straight from `filteredCatalog` (not the champion-narrowed fill pool, see
  // the pass's own comment), `luxury-cabana` is the ONLY money-no-object-tier
  // item in this fixture, so it is exactly what the splurge pass would place
  // for SPLURGE across every seed if `fitsDayShape` did not also apply
  // `isExcludedPaidProduct`.
  it('never places the premium splurge pre-pass\'s own non-whitelist pick', () => {
    for (let seed = 0; seed < 5; seed += 1) {
      expect(allPlacedIds(SPLURGE, seed)).not.toContain('luxury-cabana');
    }
  });
});
