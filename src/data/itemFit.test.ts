import { describe, it, expect } from 'vitest';
import { fitItem, bestItemForAnswers, itemTags, refaceForAnswers, isEveningItem, itemSlotOk, activityKind } from './itemFit';
import type { CardEntry, MatchTag, Section, ViatorItem } from '../types';

function item(over: Partial<ViatorItem>): ViatorItem {
  return {
    id: 'x', group_id: 'sailing-cruises', title: '', image_url: '',
    price_usd: 100, duration: '', rating: 4.7, review_count: 100,
    viator_item_url: '', is_best_seller: false, display_order: 0,
    sections: ['cruises-water'] as Section[], ...over,
  };
}
const tags = (...t: MatchTag[]) => new Set<MatchTag>(t);

const YACHT = item({ id: 'yacht', price_usd: 2300, review_count: 202, sections: ['cruises-water'] });
const CATA  = item({ id: 'cata', price_usd: 69, review_count: 2646, sections: ['cruises-water'] });

describe('itemTags', () => {
  it('classifies budget band + interests from price + sections', () => {
    expect(itemTags(CATA)).toContain('mid-range');       // $69
    expect(itemTags(CATA)).toContain('watersports');     // cruises-water
    expect(itemTags(YACHT)).toContain('money-no-object'); // $2300
  });
});

describe('fitItem — over-budget guard', () => {
  it('rejects a money-no-object item for a budget traveller', () => {
    expect(fitItem(YACHT, tags('budget', 'couple', 'beach-chill')).rejected).toBe(true);
  });
  it('rejects it for a mid-range traveller too (>= 2 bands over)', () => {
    expect(fitItem(YACHT, tags('mid-range')).rejected).toBe(true);
  });
  it('allows it for a money-no-object traveller (no cap)', () => {
    expect(fitItem(YACHT, tags('money-no-object')).rejected).toBe(false);
  });
  it('rejects the $2300 yacht for a treat-yourself traveller too (cap $400)', () => {
    expect(fitItem(YACHT, tags('treat-yourself')).rejected).toBe(true);
  });
  it('allows a sub-cap splurge for a treat-yourself traveller', () => {
    expect(fitItem(item({ id: 'tour', price_usd: 250 }), tags('treat-yourself')).rejected).toBe(false);
  });
  it('caps each tier: budget $110 / mid-range $200 / treat $400', () => {
    expect(fitItem(item({ price_usd: 120 }), tags('budget')).rejected).toBe(true);
    expect(fitItem(item({ price_usd: 100 }), tags('budget')).rejected).toBe(false);
    expect(fitItem(item({ price_usd: 210 }), tags('mid-range')).rejected).toBe(true);
    expect(fitItem(item({ price_usd: 190 }), tags('mid-range')).rejected).toBe(false);
  });
});

describe('bestItemForAnswers', () => {
  it('a budget couple gets the affordable catamaran, never the yacht', () => {
    const pick = bestItemForAnswers([YACHT, CATA], tags('budget', 'couple', 'beach-chill'));
    expect(pick?.id).toBe('cata');
  });
  it('returns null when every item is over budget', () => {
    expect(bestItemForAnswers([YACHT], tags('budget'))).toBeNull();
  });
  it('a money-no-object traveller can still get the yacht if it fits best', () => {
    const pick = bestItemForAnswers([YACHT, item({ id: 'land', price_usd: 2300, sections: ['adventures-outdoor'] })],
      tags('money-no-object', 'watersports'));
    expect(pick?.id).toBe('yacht'); // interest (cruises-water) beats the off-theme land tour
  });
});

describe('slot suitability', () => {
  it('a daytime off-road tour is never evening-appropriate', () => {
    const atv = item({ title: 'Aruba North Coast ATV Desert Adventure', sections: ['adventures-outdoor'], tags: [21421] });
    expect(isEveningItem(atv)).toBe(false);
    expect(itemSlotOk(atv, 'evening')).toBe(false);
    expect(itemSlotOk(atv, 'afternoon')).toBe(true);
  });
  it('evening keywords in the title make an item evening-appropriate', () => {
    expect(isEveningItem(item({ title: 'Sunset Catamaran Sail' }))).toBe(true);
    expect(isEveningItem(item({ title: 'Beachside Dinner Experience' }))).toBe(true);
    expect(isEveningItem(item({ title: 'Aruba Nightlife Party Bus' }))).toBe(true);
  });
  it('an evening item is NOT ok for morning or afternoon slots', () => {
    const party = item({ title: 'Aruba Nightlife Party Bus' });
    expect(itemSlotOk(party, 'morning')).toBe(false);
    expect(itemSlotOk(party, 'afternoon')).toBe(false);
    expect(itemSlotOk(party, 'evening')).toBe(true);
  });
  it('the food-drink section alone does NOT make a daytime item evening', () => {
    // The live food-drink cluster holds day trips, morning sails and breakfast
    // cruises. Section is not a time-of-day signal — only the title's keywords are.
    expect(isEveningItem(item({ title: 'All-Inclusive Day Trip', sections: ['food-drink'] }))).toBe(false);
    expect(isEveningItem(item({ title: 'Morning Champagne Sail', sections: ['food-drink'] }))).toBe(false);
    expect(isEveningItem(item({ title: 'A Tour', sections: ['food-drink'] }))).toBe(false);
  });
});

describe('activityKind — same-day variety', () => {
  it('an ATV tour and a Jeep safari are the same kind (off-road)', () => {
    expect(activityKind(item({ tags: [21421] }))).toBe('offroad'); // ATV
    expect(activityKind(item({ tags: [12035] }))).toBe('offroad'); // 4WD/Jeep
  });
  it('a snorkel sail and a sunset sail are different kinds', () => {
    expect(activityKind(item({ tags: [11912] }))).toBe('snorkel');
    expect(activityKind(item({ tags: [11963] }))).toBe('sail');
  });
});

describe('refaceForAnswers — local activity slot filtering', () => {
  const makeActivity = (id: string, tod: 'Morning' | 'Afternoon' | 'Evening') => ({
    kind: 'activity' as const,
    activity: {
      id, title: id, category: 'Beaches' as const, image: '', description: '', localsSay: '',
      cost: 'Free', duration: '2 hrs', timeOfDay: tod, fitReason: '', location: '',
      rating: 4.5, reviewCount: 100, adventure: 20, sections: ['beaches'] as Section[],
      matched_by: [] as MatchTag[],
    },
  });

  it('passes a morning activity through a morning slot filter', () => {
    const entry = makeActivity('morn', 'Morning');
    expect(refaceForAnswers([entry], new Set(), 'morning').length).toBe(1);
  });

  it('drops an evening activity from a morning pool', () => {
    const entry = makeActivity('eve', 'Evening');
    expect(refaceForAnswers([entry], new Set(), 'morning').length).toBe(0);
  });

  it('drops an evening activity from an afternoon pool', () => {
    const entry = makeActivity('eve', 'Evening');
    expect(refaceForAnswers([entry], new Set(), 'afternoon').length).toBe(0);
  });

  it('passes an evening activity through an evening slot filter', () => {
    const entry = makeActivity('eve', 'Evening');
    expect(refaceForAnswers([entry], new Set(), 'evening').length).toBe(1);
  });

  it('passes all timeOfDays through when no slot given (generator pre-filters)', () => {
    const entries = ['Morning', 'Afternoon', 'Evening'].map((tod) =>
      makeActivity(tod, tod as 'Morning' | 'Afternoon' | 'Evening'));
    expect(refaceForAnswers(entries, new Set()).length).toBe(3);
  });
});

describe('refaceForAnswers', () => {
  const group = { id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
    viator_group_url: '', display_order: 0, matched_by: ['couple'] as MatchTag[], region: 'palm-beach' as const,
    allowed_slots: ['afternoon'] as const };
  const entry: CardEntry = { kind: 'group', group: group as never, bestSeller: YACHT, others: [CATA] };

  it('swaps the card face to the fitting item for a budget couple', () => {
    const [refaced] = refaceForAnswers([entry], tags('budget', 'couple', 'beach-chill'));
    expect(refaced.kind === 'group' && refaced.bestSeller.id).toBe('cata');
  });
  it('drops the whole group when nothing fits the budget', () => {
    const onlyYacht: CardEntry = { kind: 'group', group: group as never, bestSeller: YACHT, others: [] };
    expect(refaceForAnswers([onlyYacht], tags('budget')).length).toBe(0);
  });
});
