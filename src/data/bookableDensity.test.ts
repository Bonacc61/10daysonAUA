import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { generatePlan } from './itineraryGenerator';
import {
  bookableTier, bookingDays, isPaidOuting,
  ANIMAL_SANCTUARY_ID, JET_SKI_ID, SUBMARINE_ID, DE_PALM_ISLAND_ID,
} from './bookables';
// The same module again as a namespace, so the C3 test at the bottom of this
// file can inject a fault into it. Every other test here uses the named
// imports above, which are the same live bindings.
import * as bookablesModule from './bookables';
import { resolveSlotEntry, type Catalog } from './activitySource';
import { activityKind, isNaturalPool } from './itemFit';
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
    mk('private-charter', 'premium-sailing', 'Private Luxury Catamaran Charter (up to 12 guests)', [11888], 650),
    // Tier 1, everyone: two DIFFERENT sail families (day / evening).
    mk('sail-day', 'sailing', 'Premium Catamaran Afternoon Sail: Snorkeling and Lunch', [11888], 75),
    mk('sail-eve', 'sailing', 'Aruba Sunset Sail Dinner Cruise with Open Bar', [11888], 137),
    // Tier 1, everyone: snorkel family, title passes the water guard.
    mk('snorkel-boat', 'sailing', 'Antilla Shipwreck and Catalina Bay Snorkel Sail', [11912], 79),
    // Tier 1, everyone: the off-road family. These were TWO route families
    // until 2026-08-19 — 'natural-pool' when the title named the pool and
    // 'offroad' when it did not — which is how a 10-day trip reached four
    // distinct bookings here. They are ONE family now (they are one excursion),
    // so this fixture supplies three, not four; every count assertion below is
    // an upper bound and none of them moved.
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
  // fill ladder was provably uncovered until this task gated the pre-passes.
  // R12 (2026-08-18, fix round 1): the FIRST attempt at this test used
  // `OFFROAD_NO_BOATS`, whose `no-boats` flag strips every whitelisted family
  // down to two (`natural-pool` and generic `offroad`, one family since
  // 2026-08-19) — never enough candidates to exceed a 4-day schedule
  // regardless of whether any debit line works.
  // This persona keeps boats AND unlocks the two named-id bookables
  // (`137607P22` needs `teensAdventurous`, `2455P18` needs `anyKids`, both
  // true for 'Family with teens'), so six distinct bookable "demand units"
  // compete for a cap of four: day-sail (private-charter/sail-day/snorkel-boat,
  // one wins), evening-cruise (sail-eve), off-road (jeep-conchi, pinned
  // off-schedule below, and jeep-utv — two demand units when this was written,
  // one route family since 2026-08-19), and the two family-less named ids.
  // That surplus is what makes overshoot observable at all.
  //
  // Mutation-verified individually against this exact scenario (seed 0,
  // `if (false && ...)` in place of each line in turn, everything else left
  // correct): disabling the PREMIUM pass's debit (~line 1922) let
  // `private-charter` place without counting, and `137607P22` then joined it
  // on day 9 (total 5). Disabling the STAPLE pass's debit (~line 2025) did
  // the same via `sail-eve`. Disabling the LADDER's own debit (~line 2227)
  // did the same via `2455P18`/`137607P22`. All three restored: total holds
  // at exactly 4. This is the first time in this project any of the three
  // has been proven load-bearing by a black-box test rather than by reading
  // the diff.
  const RICH_TEENS_SPLURGE: Answers = {
    ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with teens', budget: 'Money no object',
    interests: ['Adventure & adrenaline', 'Watersports'], adventureLevel: 85,
  };
  it('counts a pin outside the schedule against the trip-wide cap, alongside every debiting pass', () => {
    const legalDays = new Set(bookingDays(10));
    const tags = answersToTags(RICH_TEENS_SPLURGE);
    // Verified by running generatePlan directly: pinning 'jeep-conchi' with
    // dayCursor starting at 1 lands it on day 1 — the arrival day, which
    // `bookingDays` always excludes — so this pin is guaranteed to fall
    // outside the schedule without needing to hand-pick a day.
    const pinnedId = 'item:jeep-conchi';
    const plan = generatePlan(RICH_TEENS_SPLURGE, CATALOG, { seed: 0, pinned: [pinnedId] });
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

// Ruling R15 (2026-08-18, task 6b): `isExcludedPaidProduct` used to exempt
// every curated local (`e.kind === 'group'` gated it to Viator products only)
// on the theory that locals are hand-picked editorial that just happen to
// cost money — true for the Arikok gate, the Oranjestad guide and the
// Flamingo pass, but NOT for `kitesurfing-lesson`, which the whitelist DOES
// name (tier 1 for family-teens + high-adventure only, bookables.ts). The old
// blanket exemption let it reach a family with young kids, who should never
// be offered a $120, adventure-85 kitesurfing lesson at all. The fix narrows
// the exemption to locals `CONDITIONALLY_BOOKABLE_LOCAL_IDS` does not name.
//
// `Treat yourself` budget (not Mid-range) on purpose: kitesurfing-lesson is
// one of only two curated locals over the $110 mid-range price ceiling
// (`fitItem`'s own gate, itemFit.ts — approved 2026-08-17, see the comment on
// `candidatesFor`), so a mid-range persona can never place it regardless of
// R15 and would make both directions of this test pass vacuously.
const KITESURF_YOUNG_KIDS: Answers = {
  ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with young kids',
  budget: 'Treat yourself', interests: ['Watersports'], adventureLevel: 85,
};
const KITESURF_TEENS_HIGH_ADVENTURE: Answers = {
  ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with teens',
  budget: 'Treat yourself', interests: ['Watersports'], adventureLevel: 85,
};

// This block uses a LOCALS-ONLY catalog (no Viator groups/items) rather than
// the module-level `CATALOG` fixture above. `CATALOG`'s synthetic sail/jeep
// items exist to test the whitelist/booking-day interaction and, as a side
// effect, out-compete some curated locals for a slot regardless of R15 —
// confirmed directly: on `CATALOG`, `arikok-hiking` does not survive fill for
// the CARVE_OUT persona below on any of seeds 0-3, even though
// `isExcludedPaidProduct` never touches it (it is not on the whitelist at
// all, before or after this ruling). Isolating R15 from that unrelated
// competition is the point of this catalog, not a weaker test — every
// assertion below is about whether the RULE let something through, not about
// which candidate wins a crowded slot.
const LOCALS_ONLY_CATALOG: Catalog = { activities: ACTIVITIES, groups: [], items: [] };
function placedLocalIdsOn(catalog: Catalog, answers: Answers, seed = 0): string[] {
  const ids: string[] = [];
  for (const day of generatePlan(answers, catalog, { seed })) {
    for (const se of [...day.morning, ...day.afternoon, ...day.evening]) {
      if (se.kind === 'activity') ids.push(se.id);
    }
  }
  return ids;
}

describe('bookable density — a curated local named conditionally is excluded when its condition fails (R15)', () => {
  it('never offers kitesurfing-lesson to a family with young kids', () => {
    for (let seed = 0; seed < 4; seed += 1) {
      expect(placedLocalIdsOn(LOCALS_ONLY_CATALOG, KITESURF_YOUNG_KIDS, seed)).not.toContain('kitesurfing-lesson');
    }
  });

  it('still offers kitesurfing-lesson to a family with teens at high adventure', () => {
    for (let seed = 0; seed < 4; seed += 1) {
      expect(placedLocalIdsOn(LOCALS_ONLY_CATALOG, KITESURF_TEENS_HIGH_ADVENTURE, seed)).toContain('kitesurfing-lesson');
    }
  });

  // The carve-out R15 must not break: curated locals the whitelist never
  // named (fees and advice cards, not bookings) must stay placeable exactly
  // as before. NOT `mid-range`: 'Mid-range' + `med-adventure` is
  // `isBalancedTraveller` (balancedTemplate.ts), whose curated template names
  // neither Arikok nor Oranjestad and, on a 10-day trip, leaves only two
  // slots (day 8 morning, day 10 afternoon) for the fill ladder to reach
  // either one — confirmed directly: on that combination `arikok-hiking`
  // fails to survive fill on every seed 0-3, for reasons unrelated to R15
  // (ordinary slot competition, same with or without this ruling).
  // 'Budget-conscious' routes the whole trip through the ordinary fill
  // ladder instead, where both are reliably chosen for this interest pair.
  const CARVE_OUT: Answers = {
    ...DEFAULT_ANSWERS, days: 10, groupType: 'Solo', budget: 'Budget-conscious',
    interests: ['Nature & hiking', 'Culture & history'], adventureLevel: 55,
  };
  it('still places the Arikok park gate and the Oranjestad guide', () => {
    for (let seed = 0; seed < 4; seed += 1) {
      const placed = placedLocalIdsOn(LOCALS_ONLY_CATALOG, CARVE_OUT, seed);
      expect(placed).toContain('arikok-hiking');
      expect(placed).toContain('oranjestad-walking');
    }
  });
});

// Task 5: tier 1 (the curated must-do set) has first claim on the trip's
// booking days; tier 2 (Atlantis Submarine, De Palm Island) may only take a
// day tier 1 could not use. Family with young kids sees both tiers in this
// fixture: '7389P10' (animal sanctuary, tier 1, young-kids-only) alongside
// '2455SUB' (submarine, tier 2, young-kids-only) and '2455P18' (De Palm
// Island, tier 2, any kids) — exactly the case the rule exists to order.
//
// NOT 'Mid-range' + med-adventure (roughly 34-66): that combination is
// `isBalancedTraveller`, which seeds the trip from the curated day-by-day
// template (balancedTemplate.ts) instead of the fill ladder — its "kids"
// alternative places '7389P10'/'2455P18'/'2455SUB' on FIXED template days by
// construction, entirely outside `pickForSlot`. That is a real ordering gap
// too (day 5's De Palm Island precedes day 9's staple-placed catamaran), but
// it belongs to the template, which this task does not touch. 'Treat
// yourself' + adventureLevel 20 keeps both tiers reachable while routing
// every booking through the ladder this task actually changes — confirmed by
// running this exact persona/seed against the pre-fix ladder, where it fails
// with De Palm Island (tier 2) on day 7 and the natural-pool jeep (tier 1)
// still unplaced until day 9.
const FAMILY: Answers = {
  ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with young kids',
  budget: 'Treat yourself', interests: ['Watersports'], adventureLevel: 20,
};

describe('bookable density — tier 1 has first claim', () => {
  it('never spends a booking day on a tier 2 extra while tier 1 is unplaced', () => {
    const tags = answersToTags(FAMILY);
    const seen: Array<{ day: number; tier: number }> = [];
    for (const day of generatePlan(FAMILY, CATALOG, { seed: 0 })) {
      for (const se of [...day.morning, ...day.afternoon, ...day.evening]) {
        const card = resolveSlotEntry(se, CATALOG, tags);
        const tier = card ? bookableTier(card, tags) : null;
        if (tier !== null) seen.push({ day: day.day, tier });
      }
    }
    // Guard against the trivial pass this suite exists to rule out: this
    // persona must actually book something, or the assertion below holds
    // vacuously regardless of what the engine does. (Tier 2 itself need not
    // appear — when tier 1 alone can cover every booking day, as it correctly
    // does here once fixed, that IS the rule working.)
    expect(seen.length).toBeGreaterThan(0);
    // Every tier 2 booking must come after every tier 1 booking.
    const lastTier1 = Math.max(-1, ...seen.filter((s) => s.tier === 1).map((s) => s.day));
    for (const s of seen.filter((s) => s.tier === 2)) expect(s.day).toBeGreaterThan(lastTier1);
  });
});


// Task 5 follow-on (ruling R13, 2026-08-18): the balanced template
// (balancedTemplate.ts) places unconditionally — it goes through neither
// `fitsDayShape` nor `withinDayShape` the way the premium/staple pre-passes
// and the fill ladder do — so its own bookable swaps ("kids" alternatives
// especially) could break the trip cap, the one-booking-per-day rule and the
// no-consecutive-days rule all at once. Measured on the live catalog: a
// balanced family with young kids got SIX bookings against a cap of four, two
// of them stacked on day 2 alone; a balanced family with teens got exactly
// four but on {2,4,5,9} — 4 and 5 adjacent. `isBalancedTraveller` requires
// `med-adventure` (34-66) AND `mid-range`, which this fixture's `fitItem`
// does not reject for either persona, and both personas' template
// alternatives resolve against real ids this fixture already carries
// ('7389P10', '2455SUB', '2455P18' as items; every curated default —
// 'alto-vista-chapel', 'palm-beach-strip', 'san-nicolas-murals', etc. — from
// the real `ACTIVITIES` array `CATALOG` already uses) — so this fixture DOES
// reach the template path with no changes needed; confirmed directly by
// inspecting the generated plan's per-day bookable counts before writing
// these assertions.
function bookablesByDay(answers: Answers, seed = 0, pinned: string[] = []): Map<number, number> {
  const tags = answersToTags(answers);
  const perDay = new Map<number, number>();
  for (const day of generatePlan(answers, CATALOG, { seed, pinned })) {
    let n = 0;
    for (const se of [...day.morning, ...day.afternoon, ...day.evening]) {
      const card = resolveSlotEntry(se, CATALOG, tags);
      if (card && bookableTier(card, tags) !== null) n += 1;
    }
    if (n > 0) perDay.set(day.day, n);
  }
  return perDay;
}

const BALANCED_YOUNG_KIDS: Answers = {
  ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with young kids',
  budget: 'Mid-range', interests: ['Beach & chill'], adventureLevel: 50,
};
const BALANCED_TEENS: Answers = {
  ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with teens',
  budget: 'Mid-range', interests: ['Beach & chill'], adventureLevel: 50,
};

describe('bookable density — the balanced template obeys the schedule too (R13)', () => {
  it('holds the cap, one-per-day and no-consecutive-days rules for a balanced family with young kids', () => {
    const perDay = bookablesByDay(BALANCED_YOUNG_KIDS);
    const days = [...perDay.keys()].sort((a, b) => a - b);
    // Guard: this persona's template swaps two "kids" alternatives into
    // bookables (the animal sanctuary and, for young kids, the submarine),
    // so without R13 this is exactly the case that overshoots.
    expect(days.length).toBeGreaterThan(0);
    expect(days.length).toBeLessThanOrEqual(bookingDays(10).length);
    for (const d of days) expect(perDay.get(d)).toBe(1); // one booking per day
    for (let i = 1; i < days.length; i += 1) expect(days[i] - days[i - 1]).toBeGreaterThan(1); // never consecutive
  });

  it('holds the cap, one-per-day and no-consecutive-days rules for a balanced family with teens', () => {
    const perDay = bookablesByDay(BALANCED_TEENS);
    const days = [...perDay.keys()].sort((a, b) => a - b);
    expect(days.length).toBeGreaterThan(0);
    expect(days.length).toBeLessThanOrEqual(bookingDays(10).length);
    for (const d of days) expect(perDay.get(d)).toBe(1);
    for (let i = 1; i < days.length; i += 1) expect(days[i] - days[i - 1]).toBeGreaterThan(1);
  });
});

// Task 6: breadth. Every task before this one tested one persona at a time.
// This is the test that would have caught the reported bug — an adventurous
// family with kids got nine paid activities on nine consecutive days, ending
// with a $120 dive on the departure morning and a fill ladder that reached far
// enough down the catalog to suggest a sip-and-paint class. The five personas
// below are exactly the ones already defined earlier in this file (COUPLE,
// SPLURGE, OFFROAD_NO_BOATS, BALANCED_YOUNG_KIDS, BALANCED_TEENS) — reused
// rather than redeclared, per the Task 5/6 addendum.
const PERSONAS: Record<string, Answers> = {
  couple: COUPLE,
  splurge: SPLURGE,
  'offroad, no boats': OFFROAD_NO_BOATS,
  'balanced, young kids': BALANCED_YOUNG_KIDS,
  'balanced, teens': BALANCED_TEENS,
};

// FIXED by ruling R14 (2026-08-18, task 6b). The four 'balanced, teens' cases
// below were red on the branch this test was written on. Root cause was in
// balancedTemplate.ts, not in the task that added this describe block.
//
// `altTypesFor` (balancedTemplate.ts:93-99) files BOTH `family-young-kids` and
// `family-teens` under one `AltType: 'kids'`. Two of the template's three
// 'kids' alternatives resolve to a Viator product `bookableTier` restricts to
// YOUNG KIDS ONLY: the animal sanctuary (`7389P10`, day 2 afternoon,
// balancedTemplate.ts:124) and the Atlantis Submarine (`2455SUB`, day 7
// morning, balancedTemplate.ts:151) — see bookables.ts's
// `if (item.id === SUBMARINE_ID) return youngKids ? 2 : null;` and the
// `ANIMAL_SANCTUARY_ID` row right above it. A 'Family with teens' traveller
// (youngKids === false) got both swapped in anyway, because the template
// placed by construction and never consulted `bookableTier`/
// `isExcludedPaidProduct` the way the fill ladder and the pre-passes do.
//
// The design spec anticipated exactly this failure mode for these two
// products by name and called for separate predicates: "The two therefore
// need different audience predicates, and they must be named distinctly...
// Reusing the word 'kids' for both meanings is how this gets broken later."
// (docs/superpowers/specs/2026-08-18-bookable-density-design.md, "Tier 2 —
// contingent extras"). De Palm Island (`2455P18`, day 5), the template's third
// 'kids' alternative, was unaffected — `bookableTier` allows it for teens too
// (`anyKids`) — which is why only two of the three swaps were wrong and only
// this one persona among the five failed.
//
// R14 closes it at the template's own gate, not by re-cutting `altTypesFor`:
// itineraryGenerator.ts's template-placement loop now reverts a 'kids'
// alternative `isExcludedPaidProduct` rejects back to its curated default
// (`alto-vista-chapel` for day 2, `san-nicolas-murals` for day 7), the same
// fallback shape R13 already used for the schedule/cap rules. De Palm Island
// keeps reaching both age groups because it is never excluded in the first
// place. Confirmed with a direct trace (BALANCED_TEENS, seed 0): day 2 and
// day 7 both now carry their free curated default instead of the young-kids-
// only product, reproducible on every seed 0-3.
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
        for (let i = 1; i < booked.length; i += 1) expect(booked[i] - booked[i - 1]).toBeGreaterThan(1);

        // The assertion this task exists for: every paid Viator PRODUCT placed
        // anywhere in the plan must be a bookable for THIS traveller — that is
        // the whitelist doing its job, not merely the trip-wide cap doing its
        // job. Scoped to `kind === 'group'` on purpose, matching
        // `isExcludedPaidProduct`'s own scope (itineraryGenerator.ts): curated
        // LOCAL activities are deliberately exempt from this rule. The design
        // spec is explicit that this is not an oversight — three curated
        // locals (the Arikok gate, the Oranjestad guide, the kitesurfing
        // lesson) can spend a day's one paid-outing slot
        // (`MAX_PAID_OUTINGS_PER_DAY`) "while not necessarily being one of the
        // trip's four bookables. Two overlapping predicates, two distinct
        // purposes; neither replaces the other."
        // (docs/superpowers/specs/2026-08-18-bookable-density-design.md,
        // "Relationship to MAX_PAID_OUTINGS_PER_DAY"). Asserting this for
        // curated locals too would fail against correct code, not buggy code.
        for (const day of generatePlan(answers, CATALOG, { seed })) {
          for (const se of [...day.morning, ...day.afternoon, ...day.evening]) {
            const card = resolveSlotEntry(se, CATALOG, tags);
            if (!card || card.kind !== 'group') continue;
            if (isPaidOuting(card)) expect(bookableTier(card, tags)).not.toBeNull();
          }
        }
      });
    }
  }
});

// Task 6 addendum: the design spec requires proof that the four hard-coded
// product ids `bookableTier` reaches by id (not by Viator kind) still resolve
// against the LIVE catalog, because a catalog refresh can silently drop or
// renumber one and nothing else in this suite would notice — every other test
// here runs against the fixture, which carries these ids by construction
// regardless of whether Viator still sells them.
//
// I5 (final whole-branch review, 2026-08-18): this used to call `loadCatalog()`
// and skip when the item count matched the offline stub's. It skipped ALWAYS.
// `loadCatalog()` reads `import.meta.env.VITE_SUPABASE_ANON_KEY`, which vitest
// does not populate at runtime, so it took its own catch-and-fall-back-to-stub
// path on every run and the four ids were never checked against anything — the
// exact failure the spec wrote this test for. It now reads `.env.production`
// off disk and calls the edge function directly, which is the pattern
// `e2e-engine.test.ts` and `influencer-e2e.test.ts` already use for the same
// reason.
//
// Still offline-safe: no key on disk skips the whole describe, and a fetch or
// payload failure skips the test with a warning rather than failing it. Both
// skips say so out loud, because a guard that quietly does nothing is what I5
// was.
function loadEnvKey(key: string): string | undefined {
  try {
    const raw = readFileSync(new URL('../../.env.production', import.meta.url), 'utf8');
    return raw.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim();
  } catch { return undefined; }
}
const ANON_KEY = loadEnvKey('VITE_SUPABASE_ANON_KEY');
const FN_URL = loadEnvKey('VITE_VIATOR_FN_URL')
  ?? 'https://mrfblzsihpecockhsnqe.supabase.co/functions/v1/viator-cards';

if (!ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[bookableDensity] SKIPPED: no VITE_SUPABASE_ANON_KEY in .env.production — '
    + 'the live-catalog id check did not run.',
  );
}

describe.skipIf(!ANON_KEY)('bookable density — the live catalog', () => {
  let items: ViatorItem[] = [];
  let groups: ViatorGroup[] = [];
  let reachable = false;

  beforeAll(async () => {
    try {
      const res = await fetch(FN_URL, {
        headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY! },
      });
      if (!res.ok) throw new Error(`viator-cards ${res.status}`);
      const data = (await res.json()) as { items?: ViatorItem[]; groups?: ViatorGroup[] };
      items = data.items ?? [];
      groups = data.groups ?? [];
      if (items.length === 0) throw new Error('viator-cards returned no items');
      reachable = true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[bookableDensity] SKIPPED: live catalog unreachable (${String(e)}) — `
        + 'the live-catalog checks did not run.');
    }
  }, 60_000);

  it('resolves the four named-id bookables', (ctx) => {
    if (!reachable) { ctx.skip(); return; }
    // A short payload would make the four assertions below fail for the wrong
    // reason. The live catalog has carried 300+ products all through this
    // branch; anything less is a broken fetch, not a re-curation.
    expect(items.length).toBeGreaterThanOrEqual(300);
    const liveIds = new Set(items.map((i) => i.id));
    for (const id of [ANIMAL_SANCTUARY_ID, JET_SKI_ID, SUBMARINE_ID, DE_PALM_ISLAND_ID]) {
      expect(liveIds.has(id)).toBe(true);
    }
  });

  // A KNOWN CONSEQUENCE, pinned rather than fixed (final whole-branch review,
  // 2026-08-18). A traveller who ticked "we get seasick" (`no-boats`) now
  // books NOTHING: the flag strips every sail and snorkel product from the
  // catalog, which leaves off-road as the only tier 1 family open to a
  // childless traveller — and a budget ceiling or a low adventure slider
  // excludes that too. Measured here on the live catalog, 10 days, seeds 0-1,
  // Couple + Budget-conscious + adventure 20 + `no-boats`: 0 bookings, against
  // 6 paid products and $422 on the merge base.
  //
  // The owner has ruled this an owner decision rather than something to patch
  // at the end of a build — the alternatives are inventing a boat-free
  // bookable family or relaxing the budget/adventure gates, and both are
  // product calls. This pins it so the behaviour is deliberate rather than
  // accidental: if it ever changes, someone chose to change it.
  //
  // LIVE and not the fixture, because the fixture does not reproduce it — its
  // synthetic $99 jeep clears a budget cap that every live off-road product
  // fails. The second assertion is what stops the first passing vacuously:
  // the same traveller with the flag cleared books normally, so a zero above
  // is the flag's doing and not a dead engine.
  it('books nothing for a budget, low-adventure traveller who cannot take a boat', (ctx) => {
    if (!reachable) { ctx.skip(); return; }
    const live: Catalog = { activities: ACTIVITIES, groups, items };
    const seasick: Answers = {
      ...DEFAULT_ANSWERS, days: 10, groupType: 'Couple', budget: 'Budget-conscious',
      interests: ['Beach & chill'], adventureLevel: 20, flags: ['no-boats'],
    };
    const bookedOn = (answers: Answers, seed: number): number[] => {
      const tags = answersToTags(answers);
      const out: number[] = [];
      for (const day of generatePlan(answers, live, { seed })) {
        const any = [...day.morning, ...day.afternoon, ...day.evening].some((se) => {
          const card = resolveSlotEntry(se, live, tags);
          return card ? bookableTier(card, tags) !== null : false;
        });
        if (any) out.push(day.day);
      }
      return out;
    };
    for (let seed = 0; seed < 2; seed += 1) {
      expect(bookedOn(seasick, seed)).toEqual([]);
      expect(bookedOn({ ...seasick, flags: [] }, seed).length).toBeGreaterThan(0);
    }
  });
});

// C1 (final whole-branch review, 2026-08-18). Every density test above runs at
// TEN days, which is why nothing caught this: on a 4-day balanced trip the
// template places two bookables by construction — `antilla-wreck-dive` on day 2
// morning and `natural-pool-jeep` on day 4 morning — and
// `bookingDays(4, [2, 4])` returns `[2]` alone, because the window is `[2, 3]`
// and `k = ceil(width / 2) = 1`. Day 4 (the DEPARTURE day) therefore left the
// schedule while its booking stayed put: 2 bookings against a cap of 1, one of
// them a $75 jeep safari on the morning the traveller flies home. Measured on
// the live catalog, seed 0, Mid-range + adventure 50, all three group types.
//
// R13's second pass reverted only entries recorded in `templateAltFallback` —
// template ALTERNATIVES. `natural-pool-jeep` is a template DEFAULT, and the
// comment there asserted that case was unreachable. It was reached.
//
// These lengths are the coverage that was missing, not a spot check: 4 is the
// failing case, but 1 and 2 exercise `bookingDays`' short-trip carve-outs
// (day 1 and the departure day are legal there and nowhere else), and 5-8 walk
// the window widening one day at a time.
describe('bookable density — every balanced trip length, 1 to 8 days', () => {
  const BALANCED: Record<string, Answers> = {
    couple: COUPLE,
    'young kids': BALANCED_YOUNG_KIDS,
    teens: BALANCED_TEENS,
  };
  for (const [name, base] of Object.entries(BALANCED)) {
    for (let n = 1; n <= 8; n += 1) {
      it(`${name}, ${n} day${n === 1 ? '' : 's'}`, () => {
        const answers = { ...base, days: n };
        const perDay = bookablesByDay(answers);
        const days = [...perDay.keys()].sort((a, b) => a - b);
        // The trip-wide COUNT cap.
        expect(days.length).toBeLessThanOrEqual(bookingDays(n).length);
        // One booking per day.
        for (const d of days) expect(perDay.get(d)).toBe(1);
        // Never two days running.
        for (let i = 1; i < days.length; i += 1) expect(days[i] - days[i - 1]).toBeGreaterThan(1);
        // Never the arrival or the departure day — dropped by `bookingDays`
        // itself for trips of 1 and 2 days, where the traveller has no other
        // day to move the booking to.
        if (n >= 3) {
          expect(days).not.toContain(1);
          expect(days).not.toContain(n);
        }
        // Every booked day is one the schedule legalises. Balanced travellers
        // get the template's own days pinned into it, so the legal set is
        // `bookingDays(n, templateDays)` rather than the plain pattern — and
        // the template's bookable days are a subset of {2, 4}.
        const allowed = new Set(bookingDays(n, [2, 4]));
        for (const d of days) expect(allowed.has(d)).toBe(true);
      });
    }
  }
});


// C2 (2026-08-19). A pin is exempt from the SCHEDULE but not from the COUNT:
// the traveller's own choice lands wherever it lands, and then it has spent one
// of the trip's bookings. `ctx.bookedDays` used to gain the pinned days only
// AFTER the balanced template had committed and after R13 rule 1's trim had
// run, so the pin arrived on top of a full template allocation. Measured on the
// live catalog: an initial narrow sweep of 2,400 pinned cases found 328 (13.7%)
// over the cap, and the full 11,340-case sweep that verified the fix measured
// 1,224 (10.8%) before against 0 after. Every failing case was one
// of them an `isBalancedTraveller` persona — the only kind with a template to
// overspend. The two below are the concrete ones, measured on THIS fixture
// before the fix:
//   4-day balanced couple, `item:jeep-conchi` pinned  → 2 bookings, cap 1
//     (the pin on day 1, `antilla-wreck-dive` on day 2)
//   10-day balanced young kids, `item:sail-day` pinned → 5 bookings, cap 4
//     (the pin joined `antilla-wreck-dive` on day 2, and days 4, 7 and 9 all
//     kept theirs)
//
// Counted as BOOKINGS and not booked DAYS on purpose: the 10-day case put two
// on one day, so a day count alone reads 4 and passes.
describe('bookable density — a pin spends a booking (C2)', () => {
  const total = (perDay: Map<number, number>): number => [...perDay.values()].reduce((a, b) => a + b, 0);

  it('a 4-day balanced couple who pins a jeep safari gets ONE booking, not two', () => {
    const answers = { ...COUPLE, days: 4 };
    const perDay = bookablesByDay(answers, 0, ['item:jeep-conchi']);
    // `bookingDays(4, [2, 4])` is `[2]` — a cap of one for the whole trip.
    expect(bookingDays(4, [2, 4]).length).toBe(1);
    expect(total(perDay)).toBeLessThanOrEqual(bookingDays(4, [2, 4]).length);
    // Not vacuous: the cap held by dropping the TEMPLATE's booking, not by
    // dropping the traveller's own pick — the pin is still in the plan.
    expect(total(perDay)).toBe(1);
    const plan = generatePlan(answers, CATALOG, { seed: 0, pinned: ['item:jeep-conchi'] });
    const placed = plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
      .some((se) => se.kind === 'group' && se.bestSellerId === 'jeep-conchi');
    expect(placed).toBe(true);
  });

  it('a 10-day balanced family with young kids who pins a sail stays at four bookings', () => {
    const perDay = bookablesByDay(BALANCED_YOUNG_KIDS, 0, ['item:sail-day']);
    expect(total(perDay)).toBeLessThanOrEqual(bookingDays(10, [2, 4]).length);
    expect(total(perDay)).toBeGreaterThan(0);
    // One booking per day still holds — the pin and the template's wreck
    // snorkel both wanted day 2, and only one of them may have it.
    for (const n of perDay.values()) expect(n).toBe(1);
  });

  // The trim iterates templateSlots in ASCENDING day order, and when the pins
  // have spent part of the cap that choice is OBSERVABLE — it decides which of
  // the template's bookables survives. Pinned here because the reviewer flipped
  // the sort to descending and all 86 tests stayed green: exactly the test that
  // cannot fail this project keeps warning about.
  //
  // 9 days, young kids, one pin is the case that separates them. The template
  // wants days 2 (`antilla-wreck-dive`, tier 1), 4 (`natural-pool-jeep`, tier 1)
  // and 7 (`2455SUB`, the Atlantis submarine, tier 2), so
  // `bookingDays(9, [2, 4, 7])` is `[2, 4, 7]` — a cap of three — and the pin on
  // day 1 spends one of them. Ascending keeps 2 and 4 and drops the submarine;
  // descending keeps 4 and the submarine and drops the wreck snorkel.
  //
  // Ascending is right because of what those tiers mean: tier 1 has first claim
  // (bookable-density design, section 3), and the template's tier-1 bookables
  // are its early ones. The cost is real and worth a reader knowing it was
  // weighed — keeping the earliest front-loads the trip, against the late bias
  // `bookingDays` is built on ("people book more readily once they have been on
  // the island a few days"). A dropped tier-1 booking was judged the worse plan.
  it('keeps the EARLIEST template bookables when a pin has spent part of the cap', () => {
    const answers = { ...BALANCED_YOUNG_KIDS, days: 9 };
    const tags = answersToTags(answers);
    const plan = generatePlan(answers, CATALOG, { seed: 0, pinned: ['item:jeep-conchi'] });
    const bookedIds = new Map<number, string[]>();
    for (const day of plan) {
      const ids = [...day.morning, ...day.afternoon, ...day.evening]
        .map((se) => resolveSlotEntry(se, CATALOG, tags))
        .filter((c): c is NonNullable<typeof c> => !!c && bookableTier(c, tags) !== null)
        .map((c) => (c.kind === 'group' ? c.bestSeller.id : c.activity.id));
      if (ids.length) bookedIds.set(day.day, ids);
    }
    // The cap: three, and the pin has one of them.
    expect(bookingDays(9, [2, 4, 7])).toEqual([2, 4, 7]);
    expect([...bookedIds.keys()].sort((a, b) => a - b)).toEqual([1, 2, 4]);
    expect(bookedIds.get(1)).toEqual(['jeep-conchi']);
    // The two tier-1 curated bookables survived...
    expect(bookedIds.get(2)).toEqual(['antilla-wreck-dive']);
    expect(bookedIds.get(4)).toEqual(['natural-pool-jeep']);
    // ...and the tier-2 submarine is the one that went, from anywhere in the
    // plan — not merely moved to a later day.
    const everything = plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
      .map((se) => (se.kind === 'group' ? se.bestSellerId : ''));
    expect(everything).not.toContain('2455SUB');
  });

  // Breadth, so the fix is not two hand-picked cases: every balanced persona,
  // every trip length the template covers, every whitelisted pin this fixture
  // can resolve.
  const PINS = ['item:jeep-conchi', 'item:sail-day', 'item:sail-eve', 'item:snorkel-boat', 'item:jeep-utv'];
  for (const [name, base] of Object.entries({ couple: COUPLE, 'young kids': BALANCED_YOUNG_KIDS, teens: BALANCED_TEENS })) {
    for (let n = 3; n <= 10; n += 1) {
      it(`${name}, ${n} days, every pin`, () => {
        for (const pin of PINS) {
          const perDay = bookablesByDay({ ...base, days: n }, 0, [pin]);
          expect(total(perDay)).toBeLessThanOrEqual(bookingDays(n, [2, 4]).length);
          for (const c of perDay.values()) expect(c).toBe(1);
        }
      });
    }
  }
});

// C3 (2026-08-19). The invariant that closes R13 rule 1 — "no template bookable
// survives on a day the schedule does not legalise" — used to be a `throw`.
// `generatePlan` runs inside a `useState` initialiser (src/pages/Itinerary.tsx)
// and there is no ErrorBoundary anywhere in `src/`, so that throw would unwind
// React during render and hand the traveller a blank page instead of an
// itinerary with one booking too many. Same house rule as `flagAppliesTo`'s
// Object.prototype case (src/data/notesFlags.test.ts): degrade, do not crash.
//
// The path is unreachable from `generatePlan`'s own inputs by construction —
// rule 1's trim removes exactly the entries the check looks for, and both read
// the same `ctx.bookingDaySet`, so no combination of answers, catalog, seed or
// pins can separate them. That is what makes it an invariant. To prove the
// degradation works rather than merely reading it, this test injects the fault
// the invariant exists to catch: `bookableTier` is made to lie ONCE, and only
// after the schedule has been computed, so the trim skips `natural-pool-jeep`
// on day 4 exactly as a future broken trim would. Nothing in the source is
// bent for the test — the lie is in a collaborator, and the code under test
// runs unmodified.
//
// 4 days and a balanced couple because that is the C1 geometry: the template
// puts `antilla-wreck-dive` on day 2 and `natural-pool-jeep` on day 4, and
// `bookingDays(4, [2, 4])` legalises day 2 alone.
describe('bookable density — a template bookable outside the schedule degrades, it does not throw (C3)', () => {
  it('drops the slot, warns with the day and the product id, and still returns a plan', () => {
    const answers = { ...COUPLE, days: 4 };
    const tags = answersToTags(answers);
    const realTier = bookablesModule.bookableTier;
    const realDays = bookablesModule.bookingDays;
    let armed = false;
    let lied = false;
    vi.spyOn(bookablesModule, 'bookingDays').mockImplementation((n, must) => {
      armed = true; // the schedule is now fixed; everything after this is the trim
      return realDays(n, must);
    });
    vi.spyOn(bookablesModule, 'bookableTier').mockImplementation((e, t) => {
      const real = realTier(e, t);
      if (armed && !lied && real !== null && e.kind === 'activity' && e.activity.id === 'natural-pool-jeep') {
        lied = true;
        return null; // the trim now believes day 4 carries nothing bookable
      }
      return real;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const plan = generatePlan(answers, CATALOG, { seed: 0 });

      // The fault actually landed — without this the rest could pass vacuously
      // against an engine the injection never reached.
      expect(lied).toBe(true);
      expect(warn).toHaveBeenCalled();
      const said = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(said).toContain('day 4');
      expect(said).toContain('natural-pool-jeep');

      // A plan, not a crash, and not a hollow one: four days, every day carrying
      // at least one card.
      expect(plan).toHaveLength(4);
      for (const day of plan) {
        expect([...day.morning, ...day.afternoon, ...day.evening].length).toBeGreaterThan(0);
      }
      // And the degradation left the plan LEGAL: day 4 no longer books.
      const bookedOn = (n: number): number => (plan.find((d) => d.day === n)
        ? [...plan.find((d) => d.day === n)!.morning, ...plan.find((d) => d.day === n)!.afternoon,
          ...plan.find((d) => d.day === n)!.evening]
          .filter((se) => { const c = resolveSlotEntry(se, CATALOG, tags); return c ? realTier(c, tags) !== null : false; }).length
        : 0);
      expect(bookedOn(4)).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// === 2026-08-19: one route family for every off-road excursion ==============
//
// `routeFamilyOf` used to answer 'natural-pool' when the title named the pool
// and 'offroad' when it did not. Each retired independently, so a trip got one
// of each. Measured over the LIVE catalog — 576 plans, 6 group types × 4
// budgets × 3 adventure levels × 4 interest sets × 2 seeds, 10-day trips — 188
// (32.6%) carried more than one off-road excursion, and every offending plan
// was that exact pair. The clearest case among the four products involved:
// "Island Jeep Safari with Natural Pool Baby Beach and Lunch" and "Elite Jeep
// Safari with lunch and beer and open bar" are the same excursion, the same
// vehicle, the same place — one names the pool and the other does not.
//
// The catalog below is the module fixture and NOT `getCatalog()`, for the
// reason R2 records at the top of this file: the offline stub carries no Viator
// tag ids, so nothing in it classifies as off-road and every assertion here
// would pass against any engine at all.
//
// It does need two changes to the fixture, and both are it becoming MORE like
// the live catalog rather than less. On the fixture as it stands the bug
// cannot reproduce, for two reasons that have nothing to do with route
// families: `jeep-conchi` and `jeep-utv` share a Viator GROUP (which the
// generator retires after one placement) and carry IDENTICAL tag arrays (so the
// Jaccard similarity rule reads the second as a duplicate of the first). The
// route family exists precisely because neither of those nets catches the real
// pair — it "spans groups on purpose", and the live products' tag sets differ.
// So the two are split into separate groups and given the two distinct
// off-road tags Viator actually uses, 12035 (4WD/Jeep) and 21421 (ATV).
// Measured with those two changes and the fix reverted: 355 of the 576 cases
// below carry two off-road excursions. With the fix: 0.
function offroadCatalog(): Catalog {
  const base = fixture();
  return {
    ...base,
    groups: [...base.groups, { id: 'utv-tours', name: 'UTV & ATV Tours', tagline: '',
      viator_taxonomy: '', viator_group_url: '', display_order: 3, matched_by: [],
      region: 'islandwide', allowed_slots: [] }],
    items: base.items.map((i) => {
      if (i.id === 'jeep-conchi') return { ...i, tags: [12035, 903, 904] };
      if (i.id === 'jeep-utv') return { ...i, group_id: 'utv-tours', tags: [21421, 901, 902] };
      return i;
    }),
  };
}
const OFFROAD_CATALOG = offroadCatalog();

// An off-road excursion as a TRAVELLER would recognise one, deliberately
// independent of the family names the engine uses: a Viator product Viator's
// own tags call off-road, or one whose title names the natural pool. Asserting
// on `routeFamilyOf` would only prove the function agrees with itself.
function offroadCardsIn(answers: Answers, seed: number): string[] {
  const tags = answersToTags(answers);
  const out: string[] = [];
  for (const day of generatePlan(answers, OFFROAD_CATALOG, { seed })) {
    for (const se of [...day.morning, ...day.afternoon, ...day.evening]) {
      const card = resolveSlotEntry(se, OFFROAD_CATALOG, tags);
      if (!card || card.kind !== 'group') continue;
      if (activityKind(card.bestSeller) === 'offroad' || isNaturalPool(card.bestSeller)) {
        out.push(card.bestSeller.id);
      }
    }
  }
  return out;
}

describe('route families — one off-road excursion per trip', () => {
  const GROUP_TYPES = ['Solo', 'Couple', 'Friends', 'Family with young kids', 'Family with teens', 'Multi-gen'];
  const BUDGETS = ['Budget-conscious', 'Mid-range', 'Treat yourself', 'Money no object'];
  const ADVENTURE = [20, 50, 85];
  const INTEREST_SETS = [
    ['Beach & chill'],
    ['Adventure & adrenaline'],
    ['Watersports', 'Adventure & adrenaline'],
    ['Nature & hiking', 'Culture & history'],
  ];

  it('places at most one, across all 576 persona/seed combinations', () => {
    let plans = 0;
    let withOne = 0;
    const offenders: string[] = [];
    const distinct = new Set<string>();
    for (const groupType of GROUP_TYPES) {
      for (const budget of BUDGETS) {
        for (const adventureLevel of ADVENTURE) {
          for (const interests of INTEREST_SETS) {
            for (const seed of [0, 1]) {
              const answers: Answers = { ...DEFAULT_ANSWERS, days: 10, groupType, budget, adventureLevel, interests };
              const found = offroadCardsIn(answers, seed);
              plans += 1;
              if (found.length > 0) withOne += 1;
              for (const id of found) distinct.add(id);
              if (found.length > 1) {
                offenders.push(`${groupType}/${budget}/adv${adventureLevel}/${interests.join('+')}/seed${seed}: ${found.join(' + ')}`);
              }
            }
          }
        }
      }
    }
    expect(plans).toBe(576);
    expect(offenders).toEqual([]);
    // ...and not vacuously. Every assertion above is an upper bound, so an
    // engine placing no off-road tour at all would satisfy all of them — which
    // is exactly what the offline stub does, and why this fixture exists.
    expect(withOne).toBeGreaterThan(400);
    // NARROWED 2026-08-21, deliberately. This asserted both off-road products
    // stayed reachable — the original bug was that they were reachable at the
    // SAME TIME, and a fix that just deleted one from the catalog would be no
    // fix. That still holds for the `offenders` and `withOne` assertions above,
    // which are the ones that caught the bug.
    //
    // What changed is which of the two wins. The natural pool pre-pass now
    // guarantees every traveller above budget-conscious a Conchi excursion, and
    // off-road is a one-per-trip route family, so that single slot goes to the
    // natural pool product. `jeep-utv` is left reachable only to a
    // budget-conscious traveller, and in THIS fixture it is priced at $162
    // against that tier's $110 ceiling — so nothing in the sweep can reach it.
    //
    // Measured on the live catalog before accepting this: the off-road slot was
    // already going to a natural pool product for the default, adventurer and
    // splurge personas, because 15 of the 22 live natural pool products are
    // themselves jeep or UTV tours. The variety this gives up is smaller on
    // real data than this fixture makes it look.
    expect(distinct).toEqual(new Set(['jeep-conchi']));
  });
});

// === 2026-08-19: the private upgrade for a money-no-object traveller ========
//
// When a booking is placed for a traveller carrying `money-no-object`, the
// standard pick is REPLACED by the private version of the same route family.
// It replaces rather than adds, so the trip's booking cap is untouched.
//
// The candidate is sourced from the flag-filtered catalog and NOT from the
// champion-narrowed fill pool, and that is the whole feature: a private tour
// and its group version very likely share an `experience_cluster_id`, and
// `championsByExperience` keeps one item per cluster — the well-reviewed group
// one, every time. Sourced from the fill pool this would find nothing and look
// implemented while doing nothing, which is exactly how the influencer feature
// died. The two catalogs below exist to prove it did not happen again.
//
// The fixture needs 60+ items for any of this to be observable at all:
// `MIN_CATALOG_TO_FLOOR` is 60, so below that the generator skips
// `championsByExperience` entirely and the private variant would stay in the
// fill pool whatever the sourcing. The 50 padding items are paid products the
// whitelist does not name, so `isExcludedPaidProduct` keeps them out of the
// plan — they change the pool's SIZE and nothing else.
function privateUpgradeCatalog(shareCluster: boolean): Catalog {
  const base = fixture();
  const mkFiller = (n: number): ViatorItem => ({
    id: `filler-${n}`, group_id: 'misc-tours', title: `Aruba Sightseeing Coach Tour ${n}`,
    image_url: '', price_usd: 50, duration: '', rating: 4.5, review_count: 500,
    viator_item_url: '', is_best_seller: false, display_order: 0, tags: [],
    experience_cluster_id: `filler-cluster-${n}`,
  });
  const items: ViatorItem[] = base.items.map((i) => (i.id === 'jeep-conchi'
    ? { ...i, experience_cluster_id: 'offroad-cluster' }
    : { ...i, experience_cluster_id: `own-cluster-${i.id}` }));
  items.push({
    id: 'jeep-private', group_id: 'offroad-tours',
    // RETITLED 2026-08-21 to mirror the live catalog, where every credible
    // private off-road tour IS a Conchi run — there is no private jeep that
    // skips the natural pool with reviews behind it. The off-road private now
    // reaches a money-no-object plan through `naturalPoolFor` (dearest-first
    // above mid-range) rather than through the ladder's `privateUpgradeFor`,
    // because the natural pool pre-pass claims the off-road booking first. The
    // assertions below are unchanged and still test the same end state.
    title: 'Private Jeep Safari to the Natural Pool with Your Own Guide',
    image_url: '', price_usd: 250, duration: '', rating: 4.8,
    // Clears MIN_CHAMPION_REVIEWS (25), which the upgrade rule requires — the
    // priciest private sails on the live catalog have 4, 0 and 2 reviews, so
    // "dearest" without a floor picks junk. It still loses its cluster to
    // `jeep-conchi`, which has 500 reviews AND is a crowd-pleaser.
    review_count: 40,
    viator_item_url: '', is_best_seller: false, display_order: 0, tags: [12035],
    experience_cluster_id: shareCluster ? 'offroad-cluster' : 'private-own-cluster',
  });
  // The dearest private off-road tour in this catalog, and worthless: 3
  // reviews. The rule takes the DEAREST that clears the champion floor, not the
  // dearest, and this is what makes that half of the rule testable — drop the
  // floor and this wins every assertion below.
  items.push({
    id: 'jeep-private-junk', group_id: 'offroad-tours',
    title: 'Private Luxury Natural Pool Jeep Safari Experience', image_url: '', price_usd: 400,
    duration: '', rating: 5, review_count: 3, viator_item_url: '', is_best_seller: false,
    display_order: 0, tags: [12035], experience_cluster_id: 'junk-cluster',
  });
  for (let n = 0; n < 50; n += 1) items.push(mkFiller(n));
  return { ...base, items };
}
const CLUSTERED = privateUpgradeCatalog(true);    // private variant hidden by the champion pass
const UNCLUSTERED = privateUpgradeCatalog(false); // private variant is its own champion

// The same catalog with the private variant renamed — the two gate tests below
// need a private off-road tour that the auto-fill rules or the slot rules
// refuse, and no such product exists on the live catalog today.
function withPrivateTitle(catalog: Catalog, title: string): Catalog {
  return { ...catalog, items: catalog.items.map((i) => (i.id === 'jeep-private' ? { ...i, title } : i)) };
}


function placedIdsOn(catalog: Catalog, answers: Answers, seed: number): string[] {
  const ids: string[] = [];
  for (const day of generatePlan(answers, catalog, { seed })) {
    for (const se of [...day.morning, ...day.afternoon, ...day.evening]) {
      if (se.kind === 'group') ids.push(se.bestSellerId);
    }
  }
  return ids;
}

const RICH: Answers = {
  ...DEFAULT_ANSWERS, days: 10, groupType: 'Couple', budget: 'Money no object',
  interests: ['Adventure & adrenaline'], adventureLevel: 60,
};
// The SAME traveller one budget tier down. $250 is under this tier's $400
// per-item ceiling, so if the private jeep never appears it is because of the
// tag and not because they could not afford it.
const NEARLY_RICH: Answers = { ...RICH, budget: 'Treat yourself' };

// SUPERSEDED 2026-08-21 — READ THIS BEFORE TRUSTING ANY TEST IN THIS BLOCK.
//
// Every test below still passes and NONE of them proves the private upgrade
// works any more. The natural pool pre-pass claims the trip's single off-road
// booking before the ladder runs, so the ladder's off-road upgrade can never
// fire. Confirmed by mutation: stubbing the ladder's upgrade to
// `if (false && upgrade && …)` fails 2 tests here at HEAD and 0 with the
// pre-pass in place. Deleting `itemSlotOkForFill` from the upgrade's `allowed`
// also leaves the suite green.
//
// The two unmarked tests pass because `jeep-private` was retitled to a natural
// pool title (mirroring the live catalog, where every credible private off-road
// tour IS a Conchi run) and the PRE-PASS places it — the right end state, for
// an entirely different reason than the one they were written for.
//
// Retargeting to the SAIL family was tried and does not work either: the
// premium splurge pre-pass places `private-charter` itself, so the ladder's
// `fresh` check blocks the upgrade before the slot guard is consulted. Whether
// `privateUpgradeFor` in the ladder is now substantially dead is a separate
// investigation.
//
// The guard is UNCHANGED and still correct. What is gone is this block's
// ability to catch its removal. Left in place rather than deleted so the gap is
// visible; do not read a green run here as evidence.
describe('the private upgrade — money-no-object gets the private variant', () => {
  it('replaces the standard off-road booking with the private one', () => {
    for (const seed of [0, 1, 2]) {
      const placed = placedIdsOn(CLUSTERED, RICH, seed);
      expect(placed).toContain('jeep-private');
      // REPLACES, never adds: the standard version is not in the plan as well.
      expect(placed).not.toContain('jeep-conchi');
    }
  });

  it('leaves a treat-yourself traveller on the standard one, though they could afford it', () => {
    for (const seed of [0, 1, 2]) {
      const placed = placedIdsOn(CLUSTERED, NEARLY_RICH, seed);
      expect(placed).toContain('jeep-conchi');
      expect(placed).not.toContain('jeep-private');
    }
  });

  // The assertion that stops this feature dying quietly. In CLUSTERED the
  // private jeep shares its experience cluster with the 500-review, crowd-
  // pleasing `jeep-conchi` and so is NOT in the champion-narrowed fill pool —
  // proven by the treat-yourself case above, which searches the same catalog
  // through the ordinary ladder and never reaches it. In UNCLUSTERED it has a
  // cluster to itself and IS a champion. The upgrade must fire identically in
  // both: sourced from the fill pool it would fire only in UNCLUSTERED, and
  // this test is what turns that into a red build rather than a silent no-op.
  it('fires whether or not the champion pass would have kept the private variant', () => {
    for (const seed of [0, 1, 2]) {
      expect(placedIdsOn(CLUSTERED, RICH, seed)).toContain('jeep-private');
      expect(placedIdsOn(UNCLUSTERED, RICH, seed)).toContain('jeep-private');
    }
  });

  // Two gates the substitution has to honour that `feasible` does not cover,
  // both added after review on 2026-08-19. Neither has a live reproduction —
  // 360 live plans across all six group types place no auto-fill-excluded
  // private, and today's top-ranked off-road private happens to be
  // afternoon-legal — so both are pinned here on the synthetic catalog, where
  // the offending product can be made to exist.
  it('refuses a private variant the auto-fill rules exclude', () => {
    // RICH is a Couple, so `withChildren` is false and a kids product is out.
    // The upgrade path sources from filteredCatalog, which skips the champion
    // narrowing deliberately — it must not also skip this.
    const kidsPrivate = withPrivateTitle(CLUSTERED, 'Private Kids Jeep Safari to the Natural Pool');
    for (const seed of [0, 1, 2]) {
      const placed = placedIdsOn(kidsPrivate, RICH, seed);
      expect(placed).not.toContain('jeep-private');
      // ...and the standard pick still stands. An upgrade refused is never a
      // reason to leave the slot empty.
      expect(placed).toContain('jeep-conchi');
    }
  });

  it('refuses a private variant the slot cannot legally hold', () => {
    const eveningPrivate = withPrivateTitle(CLUSTERED, 'Private Sunset Jeep Safari at Arikok');
    for (const seed of [0, 1, 2]) {
      const placed = placedIdsOn(eveningPrivate, RICH, seed);
      expect(placed).not.toContain('jeep-private');
      expect(placed).toContain('jeep-conchi');
    }
  });

  // Replacing rather than adding means the trip books exactly as often as it
  // did before, on exactly the same days.
  it('leaves the booking count and the booking days untouched', () => {
    const tags = answersToTags(RICH);
    const bookedOn = (answers: Answers): number[] => {
      const out: number[] = [];
      for (const day of generatePlan(answers, CLUSTERED, { seed: 0 })) {
        const any = [...day.morning, ...day.afternoon, ...day.evening].some((se) => {
          const card = resolveSlotEntry(se, CLUSTERED, tags);
          return card ? bookableTier(card, answersToTags(answers)) !== null : false;
        });
        if (any) out.push(day.day);
      }
      return out;
    };
    const rich = bookedOn(RICH);
    expect(rich.length).toBeGreaterThan(0);
    expect(rich.length).toBeLessThanOrEqual(bookingDays(10).length);
    expect(rich).toEqual(bookedOn(NEARLY_RICH));
  });
});
