import { describe, it, expect } from 'vitest';
import { resolveSlotEntry, isTransportOnly, isPartyBus, isExcludedFromCatalog, regroupItems, mergeLocalMatches, type Catalog } from './activitySource';
import { parseActivityCost } from './matcher';
import { isRetailProduct } from './itemFit';
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

describe('isPartyBus — kept out of the catalog entirely', () => {
  it('drops party buses and drink crawls', () => {
    for (const t of [
      'Aruba Nightlife Party Bus Tour, Free Cocktails, Live DJ & Host',
      'Aruba Happy Hour Party Bus Pub Crawl',
      "One Happy Bar Crawl Explore Aruba's Palm Beach Nightlife",
      'Open-air Party Bus Tour with Dutch Pancake or American Breakfast',
      'Halloween Party Bus',
      'Sunset Party Bus tour with Champagne toast on the beach & Karaoke',
    ]) {
      expect(isPartyBus(titled(t)), t).toBe(true);
      expect(isExcludedFromCatalog(titled(t)), t).toBe(true);
    }
  });

  it('keeps ordinary sightseeing bus tours — the bare word "bus" is not the signal', () => {
    for (const t of [
      'Best of Aruba by Bus',
      'Colorful Beach Bus Sightseeing Tour of Aruba',
      'Half-Day Aruba Sightseeing Tour & Beach in an Air-condition Bus',
      'Open Air Beach Bus Tour of Aruba',
      'Aruba open bus Shore Excursion',
    ]) {
      expect(isPartyBus(titled(t)), t).toBe(false);
      expect(isExcludedFromCatalog(titled(t)), t).toBe(false);
    }
  });

  it('is a catalog-level drop, so a transfer and a party bus are both excluded', () => {
    expect(isExcludedFromCatalog(titled('Private Airport Pickup'))).toBe(true);
    expect(isExcludedFromCatalog(titled('Sunset Dinner Cruise'))).toBe(false);
  });
});

describe('isRetailProduct — a shopping errand is not an outing', () => {
  it('drops the diamond showroom, duty-free and timeshare pitches', () => {
    for (const t of [
      'Diamond Shopping Experience with Champagne',
      'Aruba Duty-Free Shopping Tour',
      'Oranjestad Jewelry Showroom Visit',
      'Timeshare Presentation with Free Breakfast',
    ]) {
      expect(isRetailProduct(titled(t)), t).toBe(true);
      expect(isExcludedFromCatalog(titled(t)), t).toBe(true);
    }
  });

  it('does not fire on "Small-Group", which contains "mall"', () => {
    // Five live products are named this way. Word boundaries are the whole
    // reason the pattern is safe.
    for (const t of [
      'Aruba Small-Group UTV Adventure',
      'Small Group Snorkeling at Mangel Halto Aruba',
      'Aruba North Coastline: Small-Group Horseback Riding Tour',
    ]) {
      expect(isRetailProduct(titled(t)), t).toBe(false);
      expect(isExcludedFromCatalog(titled(t)), t).toBe(false);
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

// The six anchors the live feed ships, with their real viator_taxonomy tags —
// the map regroupItems derives section membership from.
const TAXO_GROUPS: ViatorGroup[] = [
  ['adventure-tours', 'Adventure Tours', '22046', 1],
  ['watersports', 'Watersports', '20255', 2],
  ['sailing-cruises', 'Sailing & Cruises', '21701', 3],
  ['food-drink-experiences', 'Food & Drink Experiences', '21911', 4],
  ['sightseeing-tours', 'Sightseeing Tours', '21725', 5],
  ['art-culture-history', 'Culture & History', '21910', 6],
].map(([id, name, viator_taxonomy, display_order]) => ({
  id, name, viator_taxonomy, display_order,
  tagline: '', viator_group_url: '', matched_by: [], region: 'islandwide', allowed_slots: [],
} as ViatorGroup));

const taggedItem = (id: string, title: string, group_id: string, tags: number[]): ViatorItem => ({
  id, title, group_id, tags, image_url: '', price_usd: 100, duration: '3 hrs',
  rating: 4.5, review_count: 100, viator_item_url: '', is_best_seller: false, display_order: 0,
});

const groupOf = (items: ViatorItem[], id: string) => items.find((i) => i.id === id)!.group_id;

describe('resolveSlotEntry — a stored id that has left the catalog', () => {
  // The plan stores only ids, and the catalog moves under them: product codes
  // churn, and whole classes of product are dropped at ingest (transfers, party
  // buses, retail). Every SURFACE that renders a stored card has to go through
  // this function, or the same plan renders two different ways.
  //
  // Reported: a card showed its photo in the itinerary and no photo on the map.
  // The map was looking the stored id up in catalog.items directly, so a card
  // whose product had been removed rendered as a photo-less, price-less pin
  // whose title had quietly fallen back to the GROUP name.
  const g = group('sightseeing-tours');
  const survivor: ViatorItem = {
    ...item('kept', 'sightseeing-tours', true),
    title: 'Luxury Four-Course Caribbean Dinner Cruise Experience',
    image_url: 'https://example.test/dinner-cruise.jpg',
    price_usd: 172,
  };
  const cat: Catalog = { activities: [], groups: [g], items: [survivor] };

  it('re-faces to a surviving item in the same group, with its photo', () => {
    const stored = { kind: 'group' as const, groupId: 'sightseeing-tours', bestSellerId: 'removed-party-bus' };
    const resolved = resolveSlotEntry(stored, cat, undefined, 'evening');
    expect(resolved?.kind).toBe('group');
    if (resolved?.kind !== 'group') return;
    expect(resolved.bestSeller.id).toBe('kept');
    expect(resolved.bestSeller.image_url).toBe('https://example.test/dinner-cruise.jpg');
    expect(resolved.bestSeller.price_usd).toBe(172);
  });

  it('keeps the stored item when it is still in the catalog', () => {
    const stored = { kind: 'group' as const, groupId: 'sightseeing-tours', bestSellerId: 'kept' };
    const resolved = resolveSlotEntry(stored, cat, undefined, 'evening');
    expect(resolved?.kind === 'group' && resolved.bestSeller.id).toBe('kept');
  });
});

describe('regroupItems — re-files items the feed put in the wrong bucket', () => {
  it('moves an off-road tour out of Sailing & Cruises', () => {
    // 12035 = 4WD/Jeep. This is the live catalog's actual shape: 68 of Aruba's
    // 85 off-road products arrive filed under sailing-cruises.
    const out = regroupItems(TAXO_GROUPS, [taggedItem('utv', 'Aruba UTV & ATV Adventure', 'sailing-cruises', [12035])]);
    expect(groupOf(out, 'utv')).toBe('adventure-tours');
  });

  it('leaves within-section placement alone (only cross-section misfiling moves)', () => {
    // The feed's choice between two cruises-water anchors is a judgement call,
    // not an error — and the offline stub's items carry no Viator tags, so
    // re-deciding it would collapse every watersport into the sailing group.
    const out = regroupItems(TAXO_GROUPS, [
      taggedItem('sub', 'Aruba Atlantis Submarine Tour', 'watersports', [21701]),
      taggedItem('cat', 'Catamaran Snorkel Sail', 'sailing-cruises', [11912]),
    ]);
    expect(groupOf(out, 'sub')).toBe('watersports');
    expect(groupOf(out, 'cat')).toBe('sailing-cruises');
  });

  it('moves a food item out of a watersports group into food & drink', () => {
    const out = regroupItems(TAXO_GROUPS, [
      taggedItem('rum2', 'Rum Distillery Tasting', 'watersports', [21911]),
    ]);
    expect(groupOf(out, 'rum2')).toBe('food-drink-experiences');
  });

  it('leaves a correctly-filed item alone', () => {
    const out = regroupItems(TAXO_GROUPS, [taggedItem('rum', 'Rum Distillery Tasting', 'food-drink-experiences', [21911])]);
    expect(groupOf(out, 'rum')).toBe('food-drink-experiences');
  });

  it('keeps the original group when nothing resolves', () => {
    // No groups to map into → every item must survive untouched rather than
    // losing its group_id and vanishing from itemsInGroup lookups.
    const out = regroupItems([], [taggedItem('x', 'Something', 'mystery-group', [12035])]);
    expect(groupOf(out, 'x')).toBe('mystery-group');
  });

  it('never drops or duplicates an item', () => {
    const input = [
      taggedItem('a', 'UTV Adventure', 'sailing-cruises', [12035]),
      taggedItem('b', 'Sunset Sail', 'food-drink-experiences', [11888]),
      taggedItem('c', 'Walking Tour', 'watersports', [21910]),
    ];
    const out = regroupItems(TAXO_GROUPS, input);
    expect(out).toHaveLength(input.length);
    expect(new Set(out.map((i) => i.id))).toEqual(new Set(input.map((i) => i.id)));
  });
});

describe('resolveSlotEntry — a regrouped item does not re-face a stored plan', () => {
  // regroupItems rewrites group_id at ingest, which orphans the groupId stored in
  // every saved trip and shared link. Before resolveSlotEntry resolved by item id
  // first, 195 of 333 live entries re-faced to a DIFFERENT product on the upgrade
  // — pinned "★ Your pick" cards included, badge intact.
  const groups = [group('sailing-cruises'), group('adventure-tours')];
  const jeep = { ...item('jeep', 'adventure-tours', false, 0), title: 'Jeep Safari' };
  const sail = { ...item('sail', 'sailing-cruises', true, 0), title: 'Sunset Sail' };
  const catalog: Catalog = { activities: [], groups, items: [jeep, sail] };

  it('keeps the stored product when its group changed underneath the plan', () => {
    // Plan was saved when 'jeep' was (wrongly) filed under sailing-cruises.
    const stored = { kind: 'group' as const, groupId: 'sailing-cruises', bestSellerId: 'jeep' };
    const r = resolveSlotEntry(stored, catalog);
    expect(r?.kind === 'group' ? r.bestSeller.id : null).toBe('jeep');
    expect(r?.kind === 'group' ? r.group.id : null).toBe('adventure-tours');
  });

  it('keeps a PINNED stored product across a regroup', () => {
    const stored = { kind: 'group' as const, groupId: 'sailing-cruises', bestSellerId: 'jeep', pinned: true };
    const r = resolveSlotEntry(stored, catalog);
    expect(r?.kind === 'group' ? r.bestSeller.id : null).toBe('jeep');
  });

  it('still self-heals when the stored item id is genuinely gone', () => {
    // Live refresh changed product codes: fall back to the stored group.
    const stored = { kind: 'group' as const, groupId: 'sailing-cruises', bestSellerId: 'vanished' };
    const r = resolveSlotEntry(stored, catalog);
    expect(r?.kind === 'group' ? r.bestSeller.id : null).toBe('sail');
  });
});

// --- mergeLocalMatches: a matched pick must not quote a stale price ---------
/**
 * A matched local pick keeps its hand-written `cost` string, and those strings
 * had drifted from the live Viator price on three of the four live matches —
 * "$75 pp" against a tour selling at $99, "$60 pp" against $79, "$25 guided"
 * against $39 — printed beside a Book now button that charges the real amount.
 *
 * The price is NOT available from the endpoint that builds a match:
 * /products/{code} carries `pricingInfo`, which describes only the pricing MODEL
 * (PER_PERSON, age bands) and holds no amount at all. It is available from
 * /products/search, which is what already built `catalog.items` — so the fix is
 * to read it back off the matched product rather than to fetch anything.
 */
describe('mergeLocalMatches — price and duration come from the matched product', () => {
  const pick = (over: Partial<Activity> = {}): Activity => ({
    id: 'natural-pool-jeep', title: 'Natural Pool 4x4 & Snorkel Tour', category: 'Activities',
    image: '', description: '', localsSay: '', cost: '$75 pp', duration: '3–5 hrs',
    timeOfDay: 'Morning', fitReason: '', location: 'Arikok', rating: 4.8, reviewCount: 120,
    matched_by: [], ...over,
  });
  const product = (over: Partial<ViatorItem> = {}): ViatorItem => ({
    id: '6841POOL', group_id: 'adventure-tours', title: 'Aruba Natural Pool Jeep Safari',
    image_url: '', price_usd: 99, duration: '4.5 hrs', rating: 5, review_count: 9319,
    viator_item_url: '', is_best_seller: false, display_order: 0, ...over,
  });
  const match = {
    title: 'Aruba Natural Pool Jeep Safari', rating: 5, review_count: 9319,
    viator_item_url: 'https://www.viator.com/tours/Aruba/x/d28-6841POOL?pid=P00302487',
  };

  it('adopts the live price and duration instead of the stale editorial ones', () => {
    const [out] = mergeLocalMatches([pick()], { 'natural-pool-jeep': match }, [product()]);
    expect(out.cost).toBe('$99 pp');
    expect(out.duration).toBe('4.5 hrs');
  });

  it('keeps the editorial cost when the matched product is not in the catalog', () => {
    const [out] = mergeLocalMatches([pick()], { 'natural-pool-jeep': match }, []);
    expect(out.cost).toBe('$75 pp');
    expect(out.duration).toBe('3–5 hrs');
  });

  // A free local pick that happens to carry a link must never sprout a price.
  it('leaves an unmatched pick completely alone', () => {
    const free = pick({ id: 'eagle-beach', cost: 'Free', duration: '2 hrs' });
    const [out] = mergeLocalMatches([free], {}, [product()]);
    expect(out.cost).toBe('Free');
    expect(out.duration).toBe('2 hrs');
  });

  it('ignores a product carrying no usable price rather than printing "$0 pp"', () => {
    const [out] = mergeLocalMatches([pick()], { 'natural-pool-jeep': match }, [product({ price_usd: 0, duration: '' })]);
    expect(out.cost).toBe('$75 pp');
    expect(out.duration).toBe('3–5 hrs');
  });

  it('the adopted cost still parses back to the same number', () => {
    const [out] = mergeLocalMatches([pick()], { 'natural-pool-jeep': match }, [product()]);
    expect(parseActivityCost(out.cost)).toBe(99);
  });
});
