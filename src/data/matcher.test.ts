import { describe, it, expect } from 'vitest';
import { matchPool, blendPools, parseActivityCost, entryPrice, constrainBySwapReason } from './matcher';
import type { Activity } from './activities';
import type { ViatorGroup, ViatorItem, MatchTag, CardEntry } from '../types';
import { DEFAULT_ANSWERS } from '../App';

const mkActivity = (id: string, opts: Partial<Activity> = {}): Activity => ({
  id, title: id, category: 'Activities',
  image: '', description: '', localsSay: '',
  cost: 'Free', duration: '1 hr',
  timeOfDay: 'Morning', fitReason: '',
  location: '', rating: 4.5, reviewCount: 1,
  matched_by: [], ...opts,
});

const mkGroup = (id: string, opts: Partial<ViatorGroup> = {}): ViatorGroup => ({
  id, name: id, tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0,
  matched_by: [], region: 'islandwide',
  allowed_slots: [], ...opts,
});

const mkItem = (id: string, group_id: string, is_best_seller = false): ViatorItem => ({
  id, group_id, title: id, image_url: '',
  price_usd: 0, duration: '', rating: 4.5, review_count: 1,
  viator_item_url: '', is_best_seller, display_order: 0,
});

describe('matchPool — pool A (activities)', () => {
  it('includes activity when any matched_by tag is in answer set', () => {
    const a = mkActivity('a1', { matched_by: ['watersports'] });
    const tags = new Set<MatchTag>(['watersports']);
    expect(matchPool([a], [], tags, 'morning').activities).toEqual([a]);
  });

  it('excludes activity whose matched_by has no overlap with answer set', () => {
    const a = mkActivity('a1', { matched_by: ['nightlife'] });
    const tags = new Set<MatchTag>(['watersports']);
    expect(matchPool([a], [], tags, 'morning').activities).toEqual([]);
  });

  it('treats empty matched_by as wildcard — always included', () => {
    const a = mkActivity('a1', { matched_by: [] });
    const tags = new Set<MatchTag>(['watersports']);
    expect(matchPool([a], [], tags, 'morning').activities).toEqual([a]);
  });

  it('filters by slot via timeOfDay', () => {
    const a = mkActivity('a1', { timeOfDay: 'Evening' });
    const tags = new Set<MatchTag>();
    expect(matchPool([a], [], tags, 'morning').activities).toEqual([]);
    expect(matchPool([a], [], tags, 'evening').activities).toEqual([a]);
  });
});

describe('matchPool — pool B (groups)', () => {
  it('includes group when any matched_by tag is in answer set', () => {
    const g = mkGroup('g1', { matched_by: ['adventure'] });
    const tags = new Set<MatchTag>(['adventure']);
    expect(matchPool([], [g], tags, 'morning').groups).toEqual([g]);
  });

  it('treats empty matched_by as wildcard', () => {
    const g = mkGroup('g1', { matched_by: [] });
    expect(matchPool([], [g], new Set(), 'morning').groups).toEqual([g]);
  });

  it('filters by allowed_slots; empty allowed_slots = any', () => {
    const morningOnly = mkGroup('g1', { allowed_slots: ['morning'] });
    const anySlot     = mkGroup('g2', { allowed_slots: [] });
    const tags = new Set<MatchTag>();
    expect(matchPool([], [morningOnly, anySlot], tags, 'evening').groups)
      .toEqual([anySlot]);
  });
});

describe('blendPools — top-picks first, commercial tie-breaker', () => {
  it('returns activities and groups, groups winning on ties', () => {
    const a = mkActivity('a1');
    const g = mkGroup('g1');
    const items = [mkItem('i1', 'g1', true)];
    const blended = blendPools([a], [g], items, { rejectedIds: new Set(), rejectedGroupIds: new Set() });
    // First entry should be the group (commercial tie-breaker on equal fit).
    expect(blended[0].kind).toBe('group');
  });

  it('excludes rejected activities and rejected groups', () => {
    const a = mkActivity('a1');
    const g = mkGroup('g1');
    const items = [mkItem('i1', 'g1', true)];
    const blended = blendPools([a], [g], items,
      { rejectedIds: new Set(['a1']), rejectedGroupIds: new Set(['g1']) });
    expect(blended).toEqual([]);
  });

  it('skips a group with no best-seller item (data integrity guard)', () => {
    const g = mkGroup('g1');
    const items: ViatorItem[] = []; // no best-seller for g1
    const blended = blendPools([], [g], items,
      { rejectedIds: new Set(), rejectedGroupIds: new Set() });
    expect(blended).toEqual([]);
  });
});

describe('answer-tag end-to-end (sanity)', () => {
  it('DEFAULT_ANSWERS has adventureLevel 50', () => {
    expect(DEFAULT_ANSWERS.adventureLevel).toBe(50);
  });
});

describe('parseActivityCost', () => {
  it('treats "Free" as 0', () => expect(parseActivityCost('Free')).toBe(0));
  it('treats "Free + $10 rental" as 0', () => expect(parseActivityCost('Free + $10 rental')).toBe(0));
  it('extracts the from-price', () => {
    expect(parseActivityCost('$65 guided')).toBe(65);
    expect(parseActivityCost('$8–15 pp')).toBe(8);
    expect(parseActivityCost('$11 + $45 tour')).toBe(11);
  });
});

describe('constrainBySwapReason', () => {
  const act = (id: string, cost: string, category: Activity['category'] = 'Activities'): CardEntry =>
    ({ kind: 'activity', activity: mkActivity(id, { cost, category }) });
  const grp = (id: string, price: number, region: ViatorGroup['region'] = 'palm-beach'): CardEntry =>
    ({ kind: 'group', group: mkGroup(id, { region }), bestSeller: { ...mkItem(`${id}-bs`, id, true), price_usd: price }, others: [] });

  it('too-pricey keeps only cheaper candidates (fixes the $25→$2132 yacht bug)', () => {
    const current = act('cur', '$25');
    const cands = [grp('yacht', 2132), act('cheap', '$15'), grp('mid', 80)];
    const out = constrainBySwapReason(cands, 'too-pricey', current);
    expect(out).toEqual([act('cheap', '$15')]);
  });

  it('too-pricey falls back to all candidates when none are cheaper', () => {
    const current = act('cur', 'Free'); // 0 — nothing cheaper
    const cands = [grp('a', 80), act('b', '$10')];
    expect(constrainBySwapReason(cands, 'too-pricey', current)).toEqual(cands);
  });

  it('not-our-vibe excludes the same category/group', () => {
    const current = act('cur', '$25', 'Watersports');
    const cands = [act('w', '$30', 'Watersports'), act('f', '$30', 'Food')];
    const out = constrainBySwapReason(cands, 'not-our-vibe', current);
    expect(out.every((c) => c.kind === 'activity' && c.activity.category !== 'Watersports')).toBe(true);
  });

  it('too-far excludes the same region (group entries)', () => {
    const current = grp('cur', 50, 'palm-beach');
    const cands = [grp('same', 60, 'palm-beach'), grp('far', 60, 'noord')];
    const out = constrainBySwapReason(cands, 'too-far', current);
    expect(out).toEqual([grp('far', 60, 'noord')]);
  });

  it('just-show-another applies no constraint', () => {
    const current = act('cur', '$25');
    const cands = [grp('yacht', 2132), act('cheap', '$15')];
    expect(constrainBySwapReason(cands, 'just-show-another', current)).toEqual(cands);
  });

  it('entryPrice reads group fromPrice and parses activity cost', () => {
    expect(entryPrice(grp('g', 129))).toBe(129);
    expect(entryPrice(act('a', '$65 guided'))).toBe(65);
  });
});
