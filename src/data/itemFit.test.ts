import { describe, it, expect } from 'vitest';
import { fitItem, bestItemForAnswers, itemTags, refaceForAnswers } from './itemFit';
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
  it('allows it for a money-no-object traveller', () => {
    expect(fitItem(YACHT, tags('money-no-object')).rejected).toBe(false);
  });
  it('allows a one-band-over splurge (treat-yourself → money-no-object item)', () => {
    expect(fitItem(YACHT, tags('treat-yourself')).rejected).toBe(false);
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
