import { describe, it, expect } from 'vitest';
import { matchPool, blendPools } from './matcher';
import type { Activity } from './activities';
import type { ViatorGroup, ViatorItem, MatchTag } from '../types';
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
