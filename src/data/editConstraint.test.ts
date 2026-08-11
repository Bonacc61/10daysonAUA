import { describe, it, expect } from 'vitest';
import { constrainByEdit, CHIP_CONSTRAINTS, describeConstraint, satisfiableByRotation } from './editConstraint';
import type { EditConstraint } from './editConstraint';
import type { Activity } from './activities';
import type { CardEntry, MatchTag, Region, Section, ViatorGroup, ViatorItem } from '../types';

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

const mkItem = (id: string, group_id: string, opts: Partial<ViatorItem> = {}): ViatorItem => ({
  id, group_id, title: id, image_url: '',
  price_usd: 0, duration: '', rating: 4.5, review_count: 1,
  viator_item_url: '', is_best_seller: false, display_order: 0, ...opts,
});

// A group card entry. `price`, `region`, and any item overrides (tags, adventure)
// are the dimensions the constraints actually read.
const grp = (
  id: string, price: number,
  opts: { region?: Region; item?: Partial<ViatorItem>; matched_by?: MatchTag[] } = {},
): CardEntry => ({
  kind: 'group',
  group: mkGroup(id, { region: opts.region ?? 'palm-beach', matched_by: opts.matched_by ?? [] }),
  bestSeller: mkItem(`${id}-bs`, id, { price_usd: price, is_best_seller: true, ...opts.item }),
  others: [],
});

const act = (
  id: string, cost: string,
  opts: { category?: Activity['category']; sections?: Section[]; adventure?: number; matched_by?: MatchTag[] } = {},
): CardEntry => ({
  kind: 'activity',
  activity: mkActivity(id, {
    cost,
    category: opts.category ?? 'Activities',
    sections: opts.sections,
    adventure: opts.adventure,
    matched_by: opts.matched_by ?? [],
  }),
});

const ids = (out: CardEntry[]) => out.map((e) => (e.kind === 'activity' ? e.activity.id : e.group.id));

describe('constrainByEdit — price', () => {
  it('cheaper keeps only strictly-cheaper candidates, cheapest first', () => {
    const current = act('cur', '$25');
    const cands = [grp('yacht', 2132), act('cheap', '$15'), grp('mid', 80), act('cheapest', '$5')];
    expect(ids(constrainByEdit(cands, { cheaper: true }, current))).toEqual(['cheapest', 'cheap']);
  });

  it('cheaper returns nothing when none are cheaper — never falls back to pricier', () => {
    const current = act('cur', 'Free');
    const cands = [grp('a', 80), act('b', '$10')];
    expect(constrainByEdit(cands, { cheaper: true }, current)).toEqual([]);
  });

  it('maxPriceUsd keeps only candidates at or under the cap', () => {
    const current = grp('cur', 200);
    const cands = [grp('a', 40), grp('b', 60), grp('c', 90)];
    expect(ids(constrainByEdit(cands, { maxPriceUsd: 60 }, current))).toEqual(['a', 'b']);
  });

  it('maxPriceUsd returns nothing when everything is over the cap', () => {
    const current = grp('cur', 200);
    expect(constrainByEdit([grp('a', 90)], { maxPriceUsd: 50 }, current)).toEqual([]);
  });
});

describe('constrainByEdit — region and kind', () => {
  it('differentRegion excludes the current region', () => {
    const current = grp('cur', 50, { region: 'palm-beach' });
    const cands = [grp('same', 50, { region: 'palm-beach' }), grp('other', 50, { region: 'arikok' })];
    expect(ids(constrainByEdit(cands, { differentRegion: true }, current))).toEqual(['other']);
  });

  it('differentRegion falls back to the full pool rather than emptying it', () => {
    const current = grp('cur', 50, { region: 'palm-beach' });
    const cands = [grp('same', 50, { region: 'palm-beach' })];
    expect(ids(constrainByEdit(cands, { differentRegion: true }, current))).toEqual(['same']);
  });

  it('region keeps only candidates in the named region', () => {
    const current = grp('cur', 50, { region: 'palm-beach' });
    const cands = [grp('eagle', 50, { region: 'eagle-beach' }), grp('arikok', 50, { region: 'arikok' })];
    expect(ids(constrainByEdit(cands, { region: 'eagle-beach' }, current))).toEqual(['eagle']);
  });

  it('differentKind excludes the current category', () => {
    const current = act('cur', '$25', { category: 'Watersports' });
    const cands = [act('w', '$30', { category: 'Watersports' }), act('f', '$30', { category: 'Food' })];
    expect(ids(constrainByEdit(cands, { differentKind: true }, current))).toEqual(['f']);
  });
});

describe('constrainByEdit — flags', () => {
  it('no-boats drops water-based group entries', () => {
    const current = act('cur', '$25');
    // tag 11888 is 'sailing' in KIND_BY_TAG — isWaterBased reads the item's own tags.
    const cands = [grp('sail', 90, { item: { tags: [11888] } }), grp('jeep', 90, { item: { tags: [12035] } })];
    expect(ids(constrainByEdit(cands, { flags: ['no-boats'] }, current))).toEqual(['jeep']);
  });

  it('no-boats drops activities filed under cruises-water', () => {
    const current = act('cur', '$25');
    const cands = [act('snorkel', '$40', { sections: ['cruises-water'] }), act('beach', 'Free', { sections: ['beaches'] })];
    expect(ids(constrainByEdit(cands, { flags: ['no-boats'] }, current))).toEqual(['beach']);
  });

  it('with-baby caps candidate adventure at 25', () => {
    const current = act('cur', '$25');
    const cands = [act('calm', 'Free', { adventure: 10 }), act('wild', '$90', { adventure: 80 })];
    expect(ids(constrainByEdit(cands, { flags: ['with-baby'] }, current))).toEqual(['calm']);
  });

  it('mobility caps candidate adventure at 30 — looser than with-baby', () => {
    const current = act('cur', '$25');
    const cands = [act('gentle', 'Free', { adventure: 28 }), act('hike', '$40', { adventure: 55 })];
    expect(ids(constrainByEdit(cands, { flags: ['mobility'] }, current))).toEqual(['gentle']);
  });

  it('a flag constraint does NOT fall back when it empties the pool — a contraindication is not a preference', () => {
    const current = act('cur', '$25');
    const cands = [act('wild', '$90', { adventure: 80 })];
    expect(constrainByEdit(cands, { flags: ['with-baby'] }, current)).toEqual([]);
  });
});

describe('constrainByEdit — no-car', () => {
  it('drops activities that require a car', () => {
    const current = act('cur', '$25');
    const cands = [
      { kind: 'activity' as const, activity: mkActivity('drive', { requires_car: true }) },
      { kind: 'activity' as const, activity: mkActivity('walk') },
    ];
    expect(ids(constrainByEdit(cands, { flags: ['no-car'] }, current))).toEqual(['walk']);
  });

  it('keeps Viator groups, which include hotel pickup', () => {
    const current = act('cur', '$25');
    const cands = [grp('tour', 90)];
    expect(ids(constrainByEdit(cands, { flags: ['no-car'] }, current))).toEqual(['tour']);
  });
});

describe('satisfiableByRotation', () => {
  it('allows rotation for price-only and empty constraints', () => {
    expect(satisfiableByRotation({})).toBe(true);
    expect(satisfiableByRotation({ cheaper: true })).toBe(true);
    expect(satisfiableByRotation({ maxPriceUsd: 50 })).toBe(true);
  });

  it('blocks rotation for anything another item in the same group cannot satisfy', () => {
    expect(satisfiableByRotation({ flags: ['no-boats'] })).toBe(false);
    expect(satisfiableByRotation({ region: 'arikok' })).toBe(false);
    expect(satisfiableByRotation({ interests: ['food-drink'] })).toBe(false);
    expect(satisfiableByRotation({ adventure: 'lower' })).toBe(false);
  });
});

describe('constrainByEdit — interests and adventure direction', () => {
  it('interests keeps candidates matching any named tag', () => {
    const current = act('cur', '$25');
    const cands = [act('food', '$30', { matched_by: ['food-drink'] }), act('dive', '$30', { matched_by: ['watersports'] })];
    expect(ids(constrainByEdit(cands, { interests: ['food-drink'] }, current))).toEqual(['food']);
  });

  it('adventure lower keeps only calmer candidates than the current card', () => {
    const current = act('cur', '$25', { adventure: 50 });
    const cands = [act('calm', 'Free', { adventure: 20 }), act('wilder', '$90', { adventure: 80 })];
    expect(ids(constrainByEdit(cands, { adventure: 'lower' }, current))).toEqual(['calm']);
  });

  it('adventure higher keeps only more intense candidates than the current card', () => {
    const current = act('cur', '$25', { adventure: 50 });
    const cands = [act('calm', 'Free', { adventure: 20 }), act('wilder', '$90', { adventure: 80 })];
    expect(ids(constrainByEdit(cands, { adventure: 'higher' }, current))).toEqual(['wilder']);
  });
});

describe('constrainByEdit — composition and relaxation', () => {
  it('an empty constraint returns the candidates untouched', () => {
    const current = act('cur', '$25');
    const cands = [grp('a', 80), act('b', '$10')];
    expect(constrainByEdit(cands, {}, current)).toEqual(cands);
  });

  it('composes fields as an intersection', () => {
    const current = act('cur', '$100');
    const cands = [
      grp('cheap-boat', 20, { item: { tags: [11888] } }),
      grp('cheap-jeep', 30, { item: { tags: [12035] } }),
      grp('pricey-jeep', 900, { item: { tags: [12035] } }),
    ];
    expect(ids(constrainByEdit(cands, { cheaper: true, flags: ['no-boats'] }, current))).toEqual(['cheap-jeep']);
  });

  it('relaxes the soft constraint before the hard one when the intersection is empty', () => {
    // Nothing is both cheaper AND in the named region. Price is protected, so
    // region gives way — a cheaper pick elsewhere beats a pricier one nearby.
    const current = grp('cur', 100, { region: 'palm-beach' });
    const cands = [grp('cheap-elsewhere', 20, { region: 'arikok' }), grp('pricey-here', 900, { region: 'eagle-beach' })];
    expect(ids(constrainByEdit(cands, { cheaper: true, region: 'eagle-beach' }, current))).toEqual(['cheap-elsewhere']);
  });
});

describe('CHIP_CONSTRAINTS', () => {
  it('maps every swap chip to a constraint', () => {
    expect(CHIP_CONSTRAINTS['too-pricey']).toEqual({ cheaper: true });
    expect(CHIP_CONSTRAINTS['too-far']).toEqual({ differentRegion: true });
    expect(CHIP_CONSTRAINTS['not-our-vibe']).toEqual({ differentKind: true });
    expect(CHIP_CONSTRAINTS['done-it']).toEqual({});
    expect(CHIP_CONSTRAINTS['just-show-another']).toEqual({});
  });
});

describe('describeConstraint', () => {
  it('describes what the code will actually do, in the traveller\'s terms', () => {
    expect(describeConstraint({ cheaper: true, flags: ['no-boats'] }))
      .toEqual(['cheaper', 'nothing on the water']);
  });

  it('returns an empty list for an empty constraint', () => {
    expect(describeConstraint({})).toEqual([]);
  });

  it('names an explicit budget rather than just saying cheaper', () => {
    expect(describeConstraint({ maxPriceUsd: 50 })).toEqual(['under $50']);
  });

  it('renders nothing for values it has no copy for — a caption never claims unknown work', () => {
    const hostile = { flags: ['drop-tables'], interests: ['nonsense'], region: 'the-moon' } as unknown as EditConstraint;
    expect(describeConstraint(hostile)).toEqual([]);
  });

  it('ignores a nonsensical budget rather than printing it', () => {
    expect(describeConstraint({ maxPriceUsd: 0 })).toEqual([]);
    expect(describeConstraint({ maxPriceUsd: -5 })).toEqual([]);
  });
});

// Type-level guard: the constraint vocabulary must stay closed. This is the
// property that makes an LLM safe on this path — it picks from a menu.
describe('EditConstraint vocabulary', () => {
  it('accepts only known MatchTags and Regions', () => {
    const ok: EditConstraint = { interests: ['food-drink'], region: 'eagle-beach' };
    expect(ok.interests).toEqual(['food-drink']);
  });
});
