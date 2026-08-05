import { describe, it, expect } from 'vitest';
import { generatePlan } from './itineraryGenerator';
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
    const plan = generatePlan(BALANCED, cat, { seed: 0 });
    expect(idsAt(plan, 1, 'afternoon')).toContain('eagle-beach-morning');
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
