import { describe, it, expect } from 'vitest';
import { generatePlan } from './itineraryGenerator';
import { resolveSlotEntry, type Catalog } from './activitySource';
import { fitItem } from './itemFit';
import { parseActivityCost } from './matcher';
import { answersToTags } from './answerTags';
import { DEFAULT_ANSWERS, type Answers } from '../App';
import type { Activity } from './activities';
import type { MatchTag, Section, SlotEntry, ViatorGroup, ViatorItem } from '../types';

// A catalog shaped like the real one: themed groups whose items span a wide
// price range — including a luxury outlier (the $2300 yacht that started this) —
// plus a few cheap local activities so every persona can fill its days.
function fixture(): Catalog {
  const groups: ViatorGroup[] = [];
  const items: ViatorItem[] = [];
  const mk = (group: string, n: number, price: number, sections: Section[]): ViatorItem => ({
    id: `${group}-${n}`, group_id: group, title: `${group} ${price}`, image_url: '',
    price_usd: price, duration: '', rating: 4.6, review_count: 500,
    viator_item_url: '', is_best_seller: n === 0, display_order: n, sections,
  });
  const themes: { id: string; sections: Section[]; matched_by: MatchTag[]; prices: number[] }[] = [
    { id: 'sailing-cruises', sections: ['cruises-water'], matched_by: ['beach-chill', 'couple', 'cruise-day'],
      prices: [2300, 60, 75, 90, 110] }, // luxury yacht first (the real bug)
    { id: 'watersports', sections: ['cruises-water'], matched_by: ['watersports', 'high-adventure'],
      prices: [55, 70, 95, 130] },
    { id: 'adventure-tours', sections: ['adventures-outdoor'], matched_by: ['adventure', 'high-adventure', 'nature-hiking'],
      prices: [80, 120, 260] },
    { id: 'food-drink', sections: ['food-drink'], matched_by: ['food-drink', 'couple'],
      prices: [20, 45, 70, 150] },
    { id: 'culture', sections: ['culture-history'], matched_by: ['culture-history'],
      prices: [25, 40, 65] },
    { id: 'beaches', sections: ['beaches'], matched_by: ['beach-chill'],
      prices: [0, 10, 25] },
  ];
  for (const t of themes) {
    groups.push({ id: t.id, name: t.id, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: t.matched_by, region: 'islandwide', allowed_slots: [] });
    t.prices.forEach((p, n) => items.push(mk(t.id, n, p, t.sections)));
  }
  // Cheap local picks across time-of-day so even a budget persona fills 5 days.
  const act = (id: string, tod: Activity['timeOfDay'], sections: Section[]): Activity => ({
    id, title: id, category: 'Beaches', image: '', description: '', localsSay: '', cost: 'Free',
    duration: '', timeOfDay: tod, fitReason: '', location: '', rating: 4.7, reviewCount: 100,
    adventure: 10, sections, matched_by: [],
  });
  const activities = [
    act('beach-am', 'Morning', ['beaches']), act('beach-pm', 'Afternoon', ['beaches']),
    act('dinner-1', 'Evening', ['food-drink']), act('dinner-2', 'Evening', ['food-drink']),
    act('stroll-pm', 'Afternoon', ['culture-history']), act('sunset', 'Evening', ['beaches']),
  ];
  return { activities, groups, items };
}

const CATALOG = fixture();
const YACHT_ID = 'sailing-cruises-0';

// Every budget label × a representative spread of the other answer dimensions.
const BUDGETS = ['Budget-conscious', 'Mid-range', 'Treat yourself', 'Money no object'];
const INTERESTS = [['Beach & chill'], ['Watersports'], ['Adventure & adrenaline'], ['Food & drink'], ['Culture & history']];
const GROUPS = ['Couple', 'Friends'];
const ADV = [10, 95];

function personas(): Answers[] {
  const out: Answers[] = [];
  for (const budget of BUDGETS)
    for (const interests of INTERESTS)
      for (const groupType of GROUPS)
        for (const adventureLevel of ADV)
          out.push({ ...DEFAULT_ANSWERS, days: 5, budget, interests, groupType, adventureLevel, lodging: 'Palm Beach' });
  return out;
}

// Flatten a plan to its SlotEntry list.
function entries(plan: ReturnType<typeof generatePlan>): SlotEntry[] {
  return plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]);
}

describe('engine coverage — no suggestion ever violates the answers', () => {
  it('across 80 personas, no card face OR "Other suggestion" is over budget', () => {
    const violations: string[] = [];
    for (const a of personas()) {
      const tags = answersToTags(a);
      const plan = generatePlan(a, CATALOG);
      for (const se of entries(plan)) {
        const card = resolveSlotEntry(se, CATALOG, tags);
        if (!card || card.kind !== 'group') continue;
        const shown = [card.bestSeller, ...card.others];
        for (const it of shown) {
          if (fitItem(it, tags).rejected) {
            violations.push(`${a.budget}/${a.interests[0]}: ${it.id} ($${it.price_usd})`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('budget-conscious trips average <= $110/day in activity spend', () => {
    for (const a of personas()) {
      if (a.budget !== 'Budget-conscious') continue;
      const tags = answersToTags(a);
      let total = 0;
      for (const se of entries(generatePlan(a, CATALOG))) {
        const card = resolveSlotEntry(se, CATALOG, tags);
        if (!card) continue;
        total += card.kind === 'group' ? card.bestSeller.price_usd : parseActivityCost(card.activity.cost);
      }
      expect(total / a.days).toBeLessThanOrEqual(110);
    }
  });

  it('the $2300 yacht is never shown to a budget or mid-range traveller (face or suggestion)', () => {
    for (const a of personas()) {
      if (a.budget !== 'Budget-conscious' && a.budget !== 'Mid-range') continue;
      const tags = answersToTags(a);
      for (const se of entries(generatePlan(a, CATALOG))) {
        const card = resolveSlotEntry(se, CATALOG, tags);
        if (!card || card.kind !== 'group') continue;
        const ids = [card.bestSeller.id, ...card.others.map((o) => o.id)];
        expect(ids).not.toContain(YACHT_ID);
      }
    }
  });
});

describe('resolveSlotEntry — answer-aware display chokepoint', () => {
  const sailing: SlotEntry = { kind: 'group', groupId: 'sailing-cruises', bestSellerId: YACHT_ID };

  it('self-heals a stale yacht face to an affordable sail for a budget couple', () => {
    const tags = answersToTags({ ...DEFAULT_ANSWERS, budget: 'Budget-conscious', interests: ['Beach & chill'], groupType: 'Couple' });
    const card = resolveSlotEntry(sailing, CATALOG, tags);
    expect(card?.kind).toBe('group');
    if (card?.kind === 'group') {
      expect(card.bestSeller.id).not.toBe(YACHT_ID);
      expect(card.others.map((o) => o.id)).not.toContain(YACHT_ID);
      expect(card.bestSeller.price_usd).toBeLessThan(300);
    }
  });

  it('still shows the yacht to a money-no-object traveller', () => {
    const tags = answersToTags({ ...DEFAULT_ANSWERS, budget: 'Money no object', interests: ['Beach & chill'], groupType: 'Couple' });
    const card = resolveSlotEntry(sailing, CATALOG, tags);
    if (card?.kind === 'group') {
      const ids = [card.bestSeller.id, ...card.others.map((o) => o.id)];
      expect(ids).toContain(YACHT_ID);
    }
  });

  it('without tags (no answers) keeps the legacy unfiltered behaviour', () => {
    const card = resolveSlotEntry(sailing, CATALOG);
    if (card?.kind === 'group') {
      const ids = [card.bestSeller.id, ...card.others.map((o) => o.id)];
      expect(ids).toContain(YACHT_ID);
    }
  });
});
