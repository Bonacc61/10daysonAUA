import { describe, it, expect } from 'vitest';
import { resolveSlotEntry, isTransportOnly, type Catalog } from './activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import type { Activity } from './activities';

const group = (id: string): ViatorGroup => ({
  id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
  display_order: 0, matched_by: [], region: 'islandwide', allowed_slots: [],
});
const item = (id: string, group_id: string, is_best_seller = false, display_order = 0): ViatorItem => ({
  id, group_id, title: id, image_url: '', price_usd: 0, duration: '',
  rating: 4.5, review_count: 1, viator_item_url: '', is_best_seller, display_order,
});
const titled = (title: string): ViatorItem => ({ ...item('x', 'g'), title });

describe('isTransportOnly — drops pure transfers, keeps experiences', () => {
  it('drops transport-only products', () => {
    for (const t of [
      'Private Airport Pickup',
      'Aruba Round-Trip Airport Transfer',
      'Private Transfer: Airport to Hotel',
      'Shared Hotel Shuttle',
      'Airport Taxi Service',
      'Private Car Service — Oranjestad',
      'Private Transportation Aruba',
      'Aruba Ground Transportation',
    ]) {
      expect(isTransportOnly(titled(t)), t).toBe(true);
    }
  });

  it('keeps jeep tours and the party bus even with a transport word', () => {
    for (const t of [
      'Aruba UTV Adventure to Natural Pool (Jeep Transfer)',
      'Arikok National Park 4x4 Jeep Safari',
      'Aruba Party Bus Pub Crawl',
    ]) {
      expect(isTransportOnly(titled(t)), t).toBe(false);
    }
  });

  it('keeps experiences that merely include a transfer/pickup', () => {
    for (const t of [
      'Champagne Sunset Sail with Hotel Pickup',
      'Natural Pool Snorkel Cruise (Round-Trip Transfer Included)',
      'Catamaran Snorkel Tour — Free Shuttle',
    ]) {
      expect(isTransportOnly(titled(t)), t).toBe(false);
    }
  });

  it('keeps ordinary experiences with no transport word', () => {
    for (const t of ['Sunset Dinner Cruise', 'Arikok Hiking Tour', 'Rum Distillery Tasting']) {
      expect(isTransportOnly(titled(t)), t).toBe(false);
    }
  });
});

describe('resolveSlotEntry — robust to catalog item-id drift (stub → live swap)', () => {
  it('falls back to the group best-seller when the stored item id is absent', () => {
    // The plan was generated against the stub catalog; after the live Viator
    // data swaps in, the stored bestSellerId no longer exists. The card must
    // still render (the bug: it returned null and the slot went blank).
    const catalog: Catalog = {
      activities: [],
      groups: [group('watersports')],
      items: [item('live-best', 'watersports', true), item('live-other', 'watersports', false, 1)],
    };
    const resolved = resolveSlotEntry(
      { kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-catamaran' },
      catalog,
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.kind).toBe('group');
    if (resolved!.kind === 'group') {
      expect(resolved!.bestSeller.id).toBe('live-best');
      expect(resolved!.others.map((o) => o.id)).toEqual(['live-other']);
    }
  });

  it('uses the exact stored item when it is present', () => {
    const catalog: Catalog = {
      activities: [],
      groups: [group('watersports')],
      items: [item('a', 'watersports', true), item('b', 'watersports')],
    };
    const resolved = resolveSlotEntry({ kind: 'group', groupId: 'watersports', bestSellerId: 'b' }, catalog);
    expect(resolved?.kind === 'group' ? resolved.bestSeller.id : null).toBe('b');
  });

  it('returns null when the group itself is gone', () => {
    const catalog: Catalog = { activities: [], groups: [], items: [] };
    expect(resolveSlotEntry({ kind: 'group', groupId: 'nope', bestSellerId: 'x' }, catalog)).toBeNull();
  });

  it('resolves an activity entry by id', () => {
    const eagle: Activity = {
      id: 'eagle', title: 'Eagle', category: 'Beaches', image: '', description: '',
      localsSay: '', cost: 'Free', duration: '', timeOfDay: 'Morning', fitReason: '',
      location: '', rating: 4.9, reviewCount: 1, matched_by: [],
    };
    const catalog: Catalog = { activities: [eagle], groups: [], items: [] };
    const resolved = resolveSlotEntry({ kind: 'activity', id: 'eagle' }, catalog);
    expect(resolved?.kind === 'activity' ? resolved.activity.id : null).toBe('eagle');
  });
});
