import { describe, it, expect } from 'vitest';
import { generatePlan, REVISITABLE_MIN_DAY_GAP, SAN_NICOLAS_BEACHES, SAN_NICOLAS_MIN_DAY_GAP, CORE_BEACHES } from './itineraryGenerator';
import { getCatalog } from './activitySource';
import { DEFAULT_ANSWERS } from '../App';
import { BALANCED_TEMPLATE, isBalancedTraveller, resolveBalancedTemplate } from './balancedTemplate';
import { answersToTags } from './answerTags';
import type { Answers } from '../App';
import type { Slot } from '../types';

const SLOTS: Slot[] = ['morning', 'afternoon', 'evening'];
const cat = getCatalog();
const BALANCED: Answers = {
  ...DEFAULT_ANSWERS, days: 10, groupType: 'Couple',
  budget: 'Mid-range', adventureLevel: 50,
};

// Every id in that slot, not just the first. The template's contract is that
// its entry lands on that DAY and SLOT — never that it is the leading card.
// Reading index 0 was fine until the en-route food stop began inserting itself
// ahead of the afternoon's activity (you eat, then you go to the beach), which
// broke these tests without breaking the thing they check.
const idsAt = (plan: ReturnType<typeof generatePlan>, day: number, slot: Slot) =>
  (plan[day - 1]?.[slot] ?? []).map((e) => (e.kind === 'activity' ? e.id : e.bestSellerId));

describe('balanced template', () => {
  it('applies to the middle of BOTH sliders and nothing else', () => {
    expect(isBalancedTraveller(answersToTags(BALANCED))).toBe(true);
    // adventure outside 34–66
    expect(isBalancedTraveller(answersToTags({ ...BALANCED, adventureLevel: 95 }))).toBe(false);
    expect(isBalancedTraveller(answersToTags({ ...BALANCED, adventureLevel: 10 }))).toBe(false);
    // budget away from the middle
    expect(isBalancedTraveller(answersToTags({ ...BALANCED, budget: 'Money no object' }))).toBe(false);
    expect(isBalancedTraveller(answersToTags({ ...BALANCED, budget: 'Budget-conscious' }))).toBe(false);
  });

  it('places every template entry on its own day and slot', () => {
    const plan = generatePlan(BALANCED, cat, { seed: 0 });
    for (const t of BALANCED_TEMPLATE) {
      expect(idsAt(plan, t.day, t.slot), `day ${t.day} ${t.slot}`).toContain(t.id);
    }
  });

  it('claims the arrival afternoon the engine would otherwise leave open', () => {
    // Day 1 afternoon is normally kept open for pacing; the template's answer
    // there is a free beach, which is exactly the light thing that rule wants.
    // The card changed on 2026-08-12 (eagle-beach-morning -> divi-beach, which
    // is an actual Afternoon card); the guarantee under test is that the slot
    // is CLAIMED, so assert that rather than a particular beach.
    const plan = generatePlan(BALANCED, cat, { seed: 0 });
    expect(idsAt(plan, 1, 'afternoon')).toContain('divi-beach');
  });

  it('leaves the template alone for other personas', () => {
    // A splurge adventurer must not be handed the curated balanced shape.
    const plan = generatePlan(
      { ...BALANCED, budget: 'Money no object', adventureLevel: 95 }, cat, { seed: 0 },
    );
    const exact = BALANCED_TEMPLATE.filter((t) => idsAt(plan, t.day, t.slot).includes(t.id)).length;
    expect(exact).toBeLessThan(BALANCED_TEMPLATE.length / 2);
  });

  it('truncates cleanly to a shorter trip instead of overflowing', () => {
    const plan = generatePlan({ ...BALANCED, days: 5 }, cat, { seed: 0 });
    expect(plan).toHaveLength(5);
    for (const t of BALANCED_TEMPLATE.filter((x) => x.day <= 5)) {
      expect(idsAt(plan, t.day, t.slot), `day ${t.day} ${t.slot}`).toContain(t.id);
    }
  });

  it('drops entries whose activity a flag has filtered out', () => {
    // no-car removes the requires_car picks; the template must lose those
    // silently rather than forcing them back in.
    const resolved = resolveBalancedTemplate(
      { ...cat, activities: cat.activities.filter((a) => !a.requires_car) }, 10,
    );
    expect(resolved.length).toBeLessThan(BALANCED_TEMPLATE.length);
    expect(resolved.every((r) => !r.activity.requires_car)).toBe(true);
  });

  it('still fills the slots the template deliberately leaves free', () => {
    // Day 5 afternoon (a sunset sail, no curated card) and every evening are the
    // engine's to fill — the template is a starting point, not the whole plan.
    const plan = generatePlan(BALANCED, cat, { seed: 0 });
    const evenings = plan.filter((d) => d.evening.length > 0).length;
    expect(evenings).toBeGreaterThan(3);
  });

  it('honours a pin over the template for the same slot', () => {
    // Activities pin by bare id; the 'item:' prefix is for Viator products.
    const plan = generatePlan(BALANCED, cat, { seed: 0, pinned: ['rodgers-beach'] });
    const placed = plan.flatMap((d) => SLOTS.flatMap((s) => d[s]))
      .filter((e) => e.kind === 'activity' && e.id === 'rodgers-beach');
    expect(placed.length).toBe(1);
    expect(placed[0].pinned).toBe(true);
  });
});

describe('template slots never contradict the card text', () => {
  it('places Eagle Beach only in mornings', () => {
    // Regression, 2026-08-12: it sat in the day 1 and day 9 AFTERNOONS while
    // the card is titled "Morning Session" and describes sand "uncrowded
    // before 9am". The template is allowed to override a card's timeOfDay —
    // that is why it names slots itself — but not when the card's own words
    // give the slot away to the traveller reading it.
    const slots = BALANCED_TEMPLATE
      .filter((e) => e.id === 'eagle-beach-morning')
      .map((e) => e.slot);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s === 'morning')).toBe(true);
  });

  it('leaves a clear day between two placements of the same card', () => {
    // The template repeats free beaches on purpose, but its own contract is the
    // engine's: revisitable after a CLEAR day (REVISITABLE_MIN_DAY_GAP = 2).
    // Nothing enforced that here — template entries are placed by construction
    // and never pass the fill ladder — so putting Palm Beach on day 9 while it
    // already sat on day 10 produced the same beach on consecutive days, and
    // every test still passed. Caught in review on 2026-08-13, guarded now.
    const days = new Map<string, number[]>();
    for (const e of BALANCED_TEMPLATE) {
      days.set(e.id, [...(days.get(e.id) ?? []), e.day]);
    }
    const tooClose = [...days.entries()].flatMap(([id, ds]) => {
      const sorted = [...ds].sort((a, b) => a - b);
      // slice(1) offsets by one, so sorted[i] IS the previous placement. Kept as
      // a single flatMap rather than filter().map() — filtering first renumbers
      // the indices, and the message would then name the wrong preceding day.
      return sorted.slice(1).flatMap((d, i) => (
        d - sorted[i] < REVISITABLE_MIN_DAY_GAP ? [`${id}: day ${sorted[i]} then day ${d}`] : []
      ));
    });
    expect(tooClose).toEqual([]);
  });

  // The two beach-rotation rules (2026-08-22). Same reason the clear-day test
  // above exists: the template places by construction and never passes the fill
  // ladder that enforces these, so its guard has to live here.
  it('spends the San Nicolas cluster once, and opens it with Baby Beach', () => {
    const visits = BALANCED_TEMPLATE
      .filter((e) => SAN_NICOLAS_BEACHES.includes(e.id))
      .sort((a, b) => a.day - b.day);
    expect(visits.length, 'no San Nicolas beach in the template at all').toBeGreaterThan(0);
    expect(visits[0].id, 'the first trip south must be Baby Beach').toBe('baby-beach-snorkel');
    const tooClose = visits.slice(1).flatMap((e, i) => (
      e.day - visits[i].day < SAN_NICOLAS_MIN_DAY_GAP
        ? [`${visits[i].id} day ${visits[i].day} then ${e.id} day ${e.day}`] : []
    ));
    expect(tooClose).toEqual([]);
  });

  it('gives every core beach a turn before repeating any beach', () => {
    const catalog = getCatalog();
    const byId = new Map(catalog.activities.map((a) => [a.id, a]));
    // The day each core beach first appears. A core beach the template never
    // places at all fails here rather than vacuously passing — the six ARE the
    // curated plan's beach spine, and one silently dropped from the table is the
    // regression this test is for.
    const firstSeen = CORE_BEACHES.map((id) => {
      const days = BALANCED_TEMPLATE.filter((e) => e.id === id).map((e) => e.day);
      return { id, day: days.length ? Math.min(...days) : Infinity };
    });
    expect(firstSeen.filter((x) => x.day === Infinity).map((x) => x.id)).toEqual([]);
    // Zero margin by construction: allCoreDown is 9 (boca-catalina-shore, day 9
    // morning) and palm-beach-strip's second appearance is also day 9, so this
    // passes on `9 < 9` being false. Moving either row by one day flips it —
    // which is the point, but means a failure here is a real conflict and not a
    // rounding artefact.
    const allCoreDown = Math.max(...firstSeen.map((x) => x.day));

    const days = new Map<string, number[]>();
    for (const e of BALANCED_TEMPLATE) days.set(e.id, [...(days.get(e.id) ?? []), e.day]);
    const early = [...days.entries()].flatMap(([id, ds]) => {
      if (ds.length < 2 || byId.get(id)?.category !== 'Beaches') return [];
      const second = [...ds].sort((a, b) => a - b)[1];
      return second < allCoreDown
        ? [`${id} repeats on day ${second}, before the core six are down (day ${allCoreDown})`] : [];
    });
    expect(early).toEqual([]);
  });

  it('never places a card whose title names a time of day into a conflicting slot', () => {
    // Generalises the above to the one signal a traveller can actually see:
    // the title. A card called "... Sunrise ..." or "... Morning ..." belongs
    // in a morning; "... Sunset ..." or "... Evening ..." belongs in an evening.
    const TITLE_TOD: Array<[RegExp, Slot]> = [
      [/\b(sunrise|morning|breakfast)\b/i, 'morning'],
      [/\b(sunset|evening|night|dinner)\b/i, 'evening'],
    ];
    const catalog = getCatalog();
    const byId = new Map(catalog.activities.map((a) => [a.id, a]));

    // One pre-existing exception, recorded rather than silently fixed: the
    // curated plan puts "California Dunes at Sunset" in the day 6 AFTERNOON.
    // It is the same defect this test exists to catch, but moving it is a
    // product decision about the canonical template, not a bug fix — the
    // template does not model evening slots at all. Documented in
    // balancedTemplate.ts; first candidate if this class comes up again.
    const KNOWN = ['day 6 afternoon: "California Dunes at Sunset" (title implies evening)'];

    const offenders = BALANCED_TEMPLATE.flatMap((e) => {
      const a = byId.get(e.id);
      if (!a) return [];
      const rule = TITLE_TOD.find(([re]) => re.test(a.title));
      if (!rule || rule[1] === e.slot) return [];
      return [`day ${e.day} ${e.slot}: "${a.title}" (title implies ${rule[1]})`];
    });
    // Anything NEW fails; the known one may only ever shrink out of this list.
    expect(offenders.filter((o) => !KNOWN.includes(o))).toEqual([]);
  });
});
