import { describe, it, expect } from 'vitest';
import { generatePlan, durationMinutes } from './itineraryGenerator';
import { getCatalog } from './activitySource';
import { DEFAULT_ANSWERS } from '../App';
import type { Answers } from '../App';
import type { Activity, Day } from './activities';
import type { Catalog } from './activitySource';
import type { MatchTag, ViatorGroup, ViatorItem, SlotEntry } from '../types';
import { ACTIVITY_COORDS, VIATOR_ITEM_COORDS, GROUP_COORDS, type Coord } from './coords';
import { distanceKm } from './enRoute';

const catalog = getCatalog();

// A large, Viator-dominated catalog: many groups per theme so the matched pool
// per persona exceeds a 5-day plan (no fallback widening needed). Proves the
// generator tailors strongly when the Viator pool is rich — the real target the
// current 4-group ingestion will grow into. allowed_slots:[] = any slot.
function bigViatorCatalog(): Catalog {
  const groups: ViatorGroup[] = [];
  const items: ViatorItem[] = [];
  const themes: Record<string, MatchTag[]> = {
    adventure:  ['adventure', 'high-adventure'],
    watersports: ['watersports', 'high-adventure'],
    food:       ['food-drink'],
    culture:    ['culture-history'],
  };
  for (const [theme, tags] of Object.entries(themes)) {
    for (let n = 0; n < 8; n += 1) {
      const id = `${theme}-${n}`;
      groups.push({
        id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
        display_order: n, matched_by: tags, region: 'islandwide', allowed_slots: [],
      });
      items.push({
        id: `${id}-best`, group_id: id, title: id, image_url: '',
        price_usd: 100, duration: '2 hrs', rating: 4.5, review_count: 1,
        viator_item_url: '', is_best_seller: true, display_order: 0,
      });
    }
  }
  return { activities: [], groups, items };
}

const themeOf = (bestSellerId: string) => bestSellerId.split('-')[0];

// Two deliberately opposite personas. Their plans must look materially different
// — this is the assertion that locks in the Q2 fix (answers actually tailor the
// itinerary) and stops regression to "the same 5 days for everyone".
const FOODIE: Answers = {
  ...DEFAULT_ANSWERS,
  days: 5,
  interests: ['Food & drink', 'Culture & history'],
  budget: 'Budget-conscious',
  adventureLevel: 10,
  groupType: 'Couple',
};
const ADVENTURER: Answers = {
  ...DEFAULT_ANSWERS,
  days: 5,
  interests: ['Adventure & adrenaline', 'Watersports'],
  budget: 'Money no object',
  adventureLevel: 95,
  groupType: 'Friends',
};

// All entry ids in a plan (activity id or group bestSellerId), as a flat list.
function entryIds(plan: Day[]): string[] {
  const ids: string[] = [];
  for (const d of plan) {
    for (const slot of [d.morning, d.afternoon, d.evening]) {
      for (const e of slot) {
        ids.push(e.kind === 'activity' ? e.id : e.bestSellerId);
      }
    }
  }
  return ids;
}

describe('generatePlan — day count (fixes the 9→5 cap)', () => {
  it('produces exactly as many days as requested, above the old 5-day sample limit', () => {
    expect(generatePlan({ ...DEFAULT_ANSWERS, days: 9 }, catalog).length).toBe(9);
  });

  it('honors a 1-day trip', () => {
    expect(generatePlan({ ...DEFAULT_ANSWERS, days: 1 }, catalog).length).toBe(1);
  });

  it('honors the slider maximum of 14 days', () => {
    expect(generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, catalog).length).toBe(14);
  });
});

describe('generatePlan — tailoring (fixes "same plan for everyone")', () => {
  it('produces materially different plans for opposite personas', () => {
    // Positional overlap: same pick in the same day+slot. (Set overlap is the
    // wrong metric here — the catalog is ~the size of a 5-day plan, so both
    // personas consume nearly all of it; what differs is *where* each pick lands.)
    const foodie = entryIds(generatePlan(FOODIE, catalog));
    const adventurer = entryIds(generatePlan(ADVENTURER, catalog));

    const n = Math.min(foodie.length, adventurer.length);
    let same = 0;
    for (let i = 0; i < n; i += 1) if (foodie[i] === adventurer[i]) same += 1;
    const overlap = same / n;

    expect(overlap).toBeLessThan(0.5);
  });
});

describe('generatePlan — pacing + no unintended empty slots', () => {
  it('fills morning every day (large daytime pool), with open afternoons on arrival/departure', () => {
    // 10 days stays within the stub catalog's pool (10 local morning activities
    // + 2 morning Viator groups = 12 distinct entries). Longer trips leave late
    // mornings open once the pool is exhausted — correct behaviour, covered by
    // the no-repeat test.
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 10 }, catalog);
    plan.forEach((d, i) => {
      expect(d.morning.length).toBeGreaterThanOrEqual(1);
      const isArrivalOrDeparture = i === 0 || i === plan.length - 1;
      if (isArrivalOrDeparture) {
        // Intentionally open — restores the "Drop an activity here" zone.
        expect(d.afternoon.length).toBe(0);
      }
    });
  });

  // The no-repeat guarantee (an activity never appears twice across the trip) is
  // deliberately preferred over a full evening: once the distinct evening pool is
  // exhausted the slot stays open ("Drop an activity here") rather than repeating.
  it('never repeats an activity across the whole trip, even on a long trip', () => {
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, catalog));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fills evening every day when the evening pool is deep enough (no forced gaps)', () => {
    // 10 distinct evening groups (one per night) + 20 distinct day groups (two per
    // day for morning & afternoon). Each group is retired after its first use, so
    // the pool must be as large as the plan to guarantee every slot fills.
    const eveGroups: ViatorGroup[] = Array.from({ length: 10 }, (_, n) => ({
      id: `nightlife-${n}`, name: `nightlife-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: ['evening' as const],
    }));
    const eveItems: ViatorItem[] = eveGroups.map((g, n) => ({
      id: `eve-${n}`, group_id: g.id, title: `Sunset Dinner Cruise ${n}`,
      image_url: '', price_usd: 0, duration: '2 hrs', rating: 4.6, review_count: 100,
      viator_item_url: '', is_best_seller: true, display_order: 0, sections: ['food-drink' as const],
    }));
    const dayGroups: ViatorGroup[] = Array.from({ length: 20 }, (_, n) => ({
      id: `day-${n}`, name: `day-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const dayItems: ViatorItem[] = dayGroups.map((g, n) => ({
      id: `dayitem-${n}`, group_id: g.id, title: `Beach Day ${n}`,
      image_url: '', price_usd: 0, duration: '2 hrs', rating: 4.6, review_count: 100,
      viator_item_url: '', is_best_seller: true, display_order: 0, sections: ['beaches' as const],
    }));
    const rich: Catalog = { activities: [], groups: [...dayGroups, ...eveGroups], items: [...dayItems, ...eveItems] };
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 10 }, rich);
    plan.forEach((d) => expect(d.evening.length).toBeGreaterThanOrEqual(1));
  });

  it('never places two items sharing an experience_cluster_id (embedding dedup)', () => {
    // Two groups from different operators assigned the same cluster id at ingest
    // (simulating what the embedding router would produce). Only one should appear.
    const CLUSTER = 'natural-pool-jeep-safari';
    const groupA: ViatorGroup = {
      id: 'jeep-a', name: 'Jeep Safari A', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const groupB: ViatorGroup = {
      id: 'jeep-b', name: 'Jeep Safari B', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 1, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const itemA: ViatorItem = {
      id: 'jeep-a-item', group_id: 'jeep-a', title: 'Natural Pool Rugged Jeep Safari',
      image_url: '', price_usd: 0, duration: '', rating: 4.7, review_count: 200,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      experience_cluster_id: CLUSTER,
    };
    const itemB: ViatorItem = {
      id: 'jeep-b-item', group_id: 'jeep-b', title: 'Ultimate Island Jeep Safari with Natural Pool',
      image_url: '', price_usd: 0, duration: '', rating: 4.6, review_count: 180,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      experience_cluster_id: CLUSTER,
    };
    const padGroups: ViatorGroup[] = Array.from({ length: 20 }, (_, n) => ({
      id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 2, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const padItems: ViatorItem[] = padGroups.map((g, n) => ({
      id: `pad-item-${n}`, group_id: g.id, title: `Activity ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 50,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      experience_cluster_id: `unique-cluster-${n}`,
    }));
    const cat: Catalog = { activities: [], groups: [groupA, groupB, ...padGroups], items: [itemA, itemB, ...padItems] };
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 5 }, cat));
    expect(ids.includes('jeep-a-item') && ids.includes('jeep-b-item')).toBe(false);
  });

  it('never places two Viator items with high tag overlap (tag-Jaccard fallback dedup)', () => {
    // Two groups share specific Viator tag IDs — fallback path when no embedding
    // cluster id is set. Only one should appear in the plan.
    const SHARED_TAGS = [21421, 13126, 22046]; // e.g. 4WD/Jeep + Outdoor + specific tag
    const groupA: ViatorGroup = {
      id: 'jeep-a', name: 'Jeep Safari A', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const groupB: ViatorGroup = {
      id: 'jeep-b', name: 'Jeep Safari B', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 1, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const itemA: ViatorItem = {
      id: 'jeep-a-item', group_id: 'jeep-a', title: 'Natural Pool Rugged Jeep Safari',
      image_url: '', price_usd: 0, duration: '', rating: 4.7, review_count: 200,
      viator_item_url: '', is_best_seller: true, display_order: 0, tags: SHARED_TAGS,
    };
    const itemB: ViatorItem = {
      id: 'jeep-b-item', group_id: 'jeep-b', title: 'Ultimate Island Jeep Safari with Natural Pool',
      image_url: '', price_usd: 0, duration: '', rating: 4.6, review_count: 180,
      viator_item_url: '', is_best_seller: true, display_order: 0, tags: SHARED_TAGS,
    };
    // Pad with enough distinct day groups so the plan fills normally.
    const padGroups: ViatorGroup[] = Array.from({ length: 20 }, (_, n) => ({
      id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 2, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const padItems: ViatorItem[] = padGroups.map((g, n) => ({
      id: `pad-item-${n}`, group_id: g.id, title: `Activity ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 50,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [99000 + n], // distinct tags — no overlap with SHARED_TAGS or each other
    }));
    const cat: Catalog = {
      activities: [],
      groups: [groupA, groupB, ...padGroups],
      items: [itemA, itemB, ...padItems],
    };
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 5 }, cat));
    const hasA = ids.includes('jeep-a-item');
    const hasB = ids.includes('jeep-b-item');
    // At most one of the two semantically identical jeep safaris should appear.
    expect(hasA && hasB).toBe(false);
  });

  it('places two different items from the SAME group (dedup is per-cluster, not per-group)', () => {
    // A private charter and a Jolly Pirates cruise are both in the "sailing" group
    // but are distinct experiences (different cluster ids, no shared tags). The old
    // per-group dedup (usedGroupIds) let only one land; item-level planning places both.
    const sailing: ViatorGroup = {
      id: 'sailing', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: ['watersports'] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const charter: ViatorItem = {
      id: 'charter', group_id: 'sailing', title: 'Private Catamaran Charter',
      image_url: '', price_usd: 1450, duration: '', rating: 4.9, review_count: 40,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [11888],                        // 11888 = sailing -> 'sail' kind (crowd-pleaser)
      experience_cluster_id: 'cluster-charter',
    };
    const jolly: ViatorItem = {
      id: 'jolly', group_id: 'sailing', title: 'Jolly Pirates Snorkel Cruise',
      image_url: '', price_usd: 65, duration: '', rating: 4.7, review_count: 900,
      viator_item_url: '', is_best_seller: false, display_order: 1,
      tags: [11912],                        // 11912 = snorkel -> 'snorkel' kind (crowd-pleaser)
      experience_cluster_id: 'cluster-jolly',
    };
    // Both are placeable crowd-pleasers; different kinds + tag-Jaccard 0 (no shared
    // tags) + different clusters => notSimilar allows BOTH. is_best_seller:false on
    // jolly proves a non-face item still surfaces.
    const padGroups: ViatorGroup[] = Array.from({ length: 12 }, (_, n) => ({
      id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 1, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const padItems: ViatorItem[] = padGroups.map((g, n) => ({
      id: `pad-item-${n}`, group_id: g.id, title: `Beach Day ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 10,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      sections: ['beaches' as const], experience_cluster_id: `pad-cluster-${n}`,
    }));
    const cat: Catalog = { activities: [], groups: [sailing, ...padGroups], items: [charter, jolly, ...padItems] };
    // 5 days keeps the money-no-object premium pre-pass OUT of it (needs >= 7 days),
    // so this exercises normal item-level fill only.
    const ids = entryIds(generatePlan({ ...ADVENTURER, days: 5 }, cat));
    expect(ids.includes('charter')).toBe(true);
    expect(ids.includes('jolly')).toBe(true);
  });

  it('dedups high-tag-overlap items even when they carry DIFFERENT cluster ids', () => {
    // The live regression: without an embedding provider, the feed assigns a
    // per-product cluster code (6841ISLAND vs 6841POOL) to two near-identical
    // Natural-Pool jeep safaris, so cluster-dedup misses them. The tag-Jaccard net
    // must still fire even though a (distinct) cluster id is present — previously
    // it was short-circuited whenever any cluster id existed.
    const SHARED_TAGS = [12035, 21421, 22046, 367660, 367661]; // overlapping offroad tags
    const groupA: ViatorGroup = {
      id: 'jeep-a', name: 'Jeep Safari A', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const groupB: ViatorGroup = {
      id: 'jeep-b', name: 'Jeep Safari B', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 1, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const itemA: ViatorItem = {
      id: 'jeep-a-item', group_id: 'jeep-a', title: 'Ultimate Island Jeep Safari with Natural Pool',
      image_url: '', price_usd: 0, duration: '', rating: 4.7, review_count: 200,
      viator_item_url: '', is_best_seller: true, display_order: 0, tags: SHARED_TAGS,
      experience_cluster_id: '6841ISLAND',
    };
    const itemB: ViatorItem = {
      id: 'jeep-b-item', group_id: 'jeep-b', title: 'Aruba Natural Pool Rugged Jeep Safari',
      image_url: '', price_usd: 0, duration: '', rating: 4.6, review_count: 180,
      viator_item_url: '', is_best_seller: true, display_order: 0, tags: SHARED_TAGS,
      experience_cluster_id: '6841POOL',
    };
    const padGroups: ViatorGroup[] = Array.from({ length: 20 }, (_, n) => ({
      id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 2, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const padItems: ViatorItem[] = padGroups.map((g, n) => ({
      id: `pad-item-${n}`, group_id: g.id, title: `Activity ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 50,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [99000 + n], experience_cluster_id: `unique-${n}`,
    }));
    const cat: Catalog = { activities: [], groups: [groupA, groupB, ...padGroups], items: [itemA, itemB, ...padItems] };
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 5 }, cat));
    expect(ids.includes('jeep-a-item') && ids.includes('jeep-b-item')).toBe(false);
  });

  it('fills a single-day trip’s afternoon (no arrival/departure split)', () => {
    // The invariant is that a 1-day trip is NOT given the multi-day arrival/
    // departure "open afternoon" pacing — morning and afternoon both fill.
    // Evening is intentionally not asserted: the 8h/day feasibility cap can
    // legitimately leave it empty once two daytime activities are booked.
    const [d] = generatePlan({ ...DEFAULT_ANSWERS, days: 1 }, catalog);
    expect(d.morning.length).toBeGreaterThanOrEqual(1);
    expect(d.afternoon.length).toBeGreaterThanOrEqual(1);
  });

  it('never places two items in one group that share a cluster id', () => {
    // Same group, same cluster (e.g. an adult and a child booking option of one
    // snorkel product). Both carry the snorkel tag so they are high-scoring, placeable
    // crowd-pleasers; the shared cluster id must still keep them from both landing now
    // that whole-group retirement is gone.
    const grp: ViatorGroup = {
      id: 'snorkel', name: 'Snorkel Trips', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: ['watersports'] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const adult: ViatorItem = {
      id: 'snork-adult', group_id: 'snorkel', title: 'Catalina Bay Snorkel Trip (Adult)',
      image_url: '', price_usd: 0, duration: '', rating: 4.7, review_count: 200,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [11912],                        // 11912 = snorkel
      experience_cluster_id: 'cluster-snorkel',
    };
    const child: ViatorItem = {
      id: 'snork-child', group_id: 'snorkel', title: 'Catalina Bay Snorkel Trip (Child)',
      image_url: '', price_usd: 0, duration: '', rating: 4.7, review_count: 190,
      viator_item_url: '', is_best_seller: false, display_order: 1,
      tags: [11912],                        // 11912 = snorkel (same product, other booking option)
      experience_cluster_id: 'cluster-snorkel',
    };
    const padGroups: ViatorGroup[] = Array.from({ length: 12 }, (_, n) => ({
      id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 1, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const padItems: ViatorItem[] = padGroups.map((g, n) => ({
      id: `pad-item-${n}`, group_id: g.id, title: `Beach Day ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 10,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      sections: ['beaches' as const], experience_cluster_id: `pad-cluster-${n}`,
    }));
    const cat: Catalog = { activities: [], groups: [grp, ...padGroups], items: [adult, child, ...padItems] };
    const ids = entryIds(generatePlan({ ...ADVENTURER, days: 5 }, cat));
    expect(ids.includes('snork-adult') && ids.includes('snork-child')).toBe(false);
  });

  it('places at most one off-road tour per trip (route-family net)', () => {
    // Two off-road tours in different groups, different clusters, and NON-overlapping
    // tags (4WD tag vs ATV tag) so neither cluster-dedup nor tag-Jaccard fires — only
    // the route-family net keeps the trip to a single off-road experience.
    const groupA: ViatorGroup = {
      id: 'offroad-a', name: 'Jeep Co', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: ['adventure'] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const groupB: ViatorGroup = {
      id: 'offroad-b', name: 'ATV Co', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 1, matched_by: ['adventure'] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const jeep: ViatorItem = {
      id: 'jeep-tour', group_id: 'offroad-a', title: 'Guided Jeep Tour',
      image_url: '', price_usd: 0, duration: '', rating: 4.6, review_count: 100,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [12035], experience_cluster_id: 'cluster-a',   // 12035 = 4WD (offroad kind)
    };
    const atv: ViatorItem = {
      id: 'atv-tour', group_id: 'offroad-b', title: 'Self-drive ATV Adventure',
      image_url: '', price_usd: 0, duration: '', rating: 4.6, review_count: 100,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [21421], experience_cluster_id: 'cluster-b',   // 21421 = ATV (offroad kind)
    };
    const padGroups: ViatorGroup[] = Array.from({ length: 12 }, (_, n) => ({
      id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 2, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const padItems: ViatorItem[] = padGroups.map((g, n) => ({
      id: `pad-item-${n}`, group_id: g.id, title: `Beach Day ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 10,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      sections: ['beaches' as const], experience_cluster_id: `pad-cluster-${n}`,
    }));
    const cat: Catalog = { activities: [], groups: [groupA, groupB, ...padGroups], items: [jeep, atv, ...padItems] };
    const ids = entryIds(generatePlan({ ...ADVENTURER, days: 5 }, cat));
    const offroadPlaced = [ids.includes('jeep-tour'), ids.includes('atv-tour')].filter(Boolean).length;
    expect(offroadPlaced).toBeLessThanOrEqual(1);
  });
});

describe('generatePlan — variety vs determinism', () => {
  it('is deterministic for a given seed', () => {
    const a = generatePlan(ADVENTURER, catalog, { seed: 1 });
    const b = generatePlan(ADVENTURER, catalog, { seed: 1 });
    expect(a).toEqual(b);
  });

  it('varies the plan across reseeds (regenerate feels alive)', () => {
    const base = JSON.stringify(generatePlan(ADVENTURER, catalog, { seed: 1 }));
    const anyDifferent = [2, 3, 4, 5].some(
      (s) => JSON.stringify(generatePlan(ADVENTURER, catalog, { seed: s })) !== base,
    );
    expect(anyDifferent).toBe(true);
  });
});

describe('generatePlan — tailoring scales with a rich Viator catalog', () => {
  const big = bigViatorCatalog();

  it('gives opposite personas near-disjoint, on-theme Viator plans', () => {
    const foodie = entryIds(generatePlan(FOODIE, big));
    const adventurer = entryIds(generatePlan(ADVENTURER, big));

    // Set overlap (meaningful now the pool >> plan size) should be tiny.
    const fSet = new Set(foodie);
    const sharedSet = new Set(adventurer.filter((id) => fSet.has(id)));
    expect(sharedSet.size / new Set([...foodie, ...adventurer]).size).toBeLessThan(0.2);

    // And the picks are actually on-theme for each persona.
    const foodieThemes = foodie.map(themeOf);
    const advThemes = adventurer.map(themeOf);
    expect(foodieThemes.every((t) => t === 'food' || t === 'culture')).toBe(true);
    expect(advThemes.every((t) => t === 'adventure' || t === 'watersports')).toBe(true);
  });
});

describe('generatePlan — popularity floor (bookability)', () => {
  const cat = getCatalog(); // normalizePopularity ran — every item has a score

  it('never auto-fills an item from the bottom quartile of its budget tier', () => {
    const byId = new Map(cat.items.map((i) => [i.id, i]));
    for (const seed of [1, 2, 3]) {
      const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, cat, { seed });
      for (const day of plan) {
        for (const e of [...day.morning, ...day.afternoon, ...day.evening]) {
          if (e.kind !== 'group' || e.pinned) continue;
          const item = byId.get(e.bestSellerId);
          if (!item) continue;
          expect(item.popularity_score ?? 1).toBeGreaterThanOrEqual(0.25);
        }
      }
    }
  });

  it('a pinned niche item still lands (explicit choice beats the floor)', () => {
    const niche = cat.items
      .filter((i) => (i.popularity_score ?? 1) < 0.25)
      .sort((a, b) => (a.popularity_score ?? 0) - (b.popularity_score ?? 0))[0];
    expect(niche).toBeDefined(); // stub catalog has bottom-quartile items
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 5 }, cat, { pinned: [`item:${niche.id}`] });
    const placed = plan.some((d) =>
      [...d.morning, ...d.afternoon, ...d.evening].some(
        (e) => e.pinned && e.kind === 'group' && e.bestSellerId === niche.id,
      ),
    );
    expect(placed).toBe(true);
  });
});

describe('generatePlan — premium splurge (money-no-object, week-plus)', () => {
  const cat = getCatalog();
  const MNO: Answers = {
    ...DEFAULT_ANSWERS, budget: 'Money no object', adventureLevel: 30,
    groupType: 'Couple', interests: ['beach-chill', 'watersports'],
  };
  const sailingEntries = (plan: Day[]) =>
    plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
      .filter((e): e is { kind: 'group'; groupId: string; bestSellerId: string } =>
        e.kind === 'group' && e.groupId === 'sailing-cruises');

  it('a 9-day trip surfaces the private charter AND a second sailing-cruises cruise', () => {
    const plan = generatePlan({ ...MNO, days: 9 }, cat, { seed: 1 });
    const sc = sailingEntries(plan);
    expect(sc.some((e) => e.bestSellerId === 'private-charter')).toBe(true);
    expect(sc.length).toBeGreaterThanOrEqual(2); // charter + a crowd-pleaser cruise
  });

  it('the premium charter carries splurge=true (badge) and is not marked pinned', () => {
    const plan = generatePlan({ ...MNO, days: 9 }, cat, { seed: 1 });
    const charter = plan
      .flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
      .find((e) => e.kind === 'group' && e.bestSellerId === 'private-charter');
    expect(charter?.splurge).toBe(true);
    expect(charter?.pinned).toBeFalsy();
  });

  it('a 5-day trip keeps just one sailing-cruises pick (no premium pre-pass under a week)', () => {
    const plan = generatePlan({ ...MNO, days: 5 }, cat, { seed: 1 });
    expect(sailingEntries(plan).length).toBeLessThanOrEqual(1);
  });

  it('a mid-range traveller never gets the premium charter (over budget, gated to money-no-object)', () => {
    const midRange: Answers = { ...MNO, budget: 'Mid-range' };
    for (let s = 0; s < 6; s += 1) {
      const plan = generatePlan({ ...midRange, days: 9 }, cat, { seed: s });
      expect(sailingEntries(plan).some((e) => e.bestSellerId === 'private-charter')).toBe(false);
    }
  });
});

describe('generatePlan — en-route food suggestion', () => {
  const cat = getCatalog();

  it('offers Zeerover on a day that drives out to the far south (Boca Grandi pinned)', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 6 }, cat, { seed: 1, pinned: ['boca-grandi'] });
    const bocaDay = plan.find((d) => [...d.morning, ...d.afternoon, ...d.evening]
      .some((e) => e.kind === 'activity' && e.id === 'boca-grandi'));
    expect(bocaDay).toBeDefined();
    const dayIds = [...bocaDay!.morning, ...bocaDay!.afternoon, ...bocaDay!.evening]
      .flatMap((e) => (e.kind === 'activity' ? [e.id] : []));
    expect(dayIds).toContain('zeerovers-fresh-catch');
  });

  it('never offers an en-route food stop to a no-car traveller', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 8, flags: ['no-car'] }, cat, { seed: 1, pinned: ['boca-grandi'] });
    expect(entryIds(plan)).not.toContain('zeerovers-fresh-catch');
  });

  it('never places the same food place twice on a trip', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 10 }, cat, { seed: 2 });
    const zeeroverCount = entryIds(plan).filter((id) => id === 'lunch-zeerover' || id === 'zeerovers-fresh-catch').length;
    expect(zeeroverCount).toBeLessThanOrEqual(1);
  });
});

describe('generatePlan — one off-road tour per trip (shared route family)', () => {
  // Off-road tours (jeep/UTV/ATV — offroad tag 12035) all run the same Aruba
  // circuit, so at most one should appear across the whole trip regardless of
  // length, even from different groups / clusters.
  const OFF = 12035;
  const mkGroup = (n: number): ViatorGroup => ({
    id: `off-${n}`, name: `off-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: n, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  const mkItem = (n: number, title: string): ViatorItem => ({
    id: `off-item-${n}`, group_id: `off-${n}`, title,
    image_url: '', price_usd: 90, duration: '', rating: 4.7, review_count: 200,
    viator_item_url: '', is_best_seller: true, display_order: 0,
    tags: [OFF], experience_cluster_id: `cluster-${n}`,
  });
  const pad: { g: ViatorGroup[]; i: ViatorItem[] } = { g: [], i: [] };
  for (let n = 0; n < 20; n += 1) {
    pad.g.push({ id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 5, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const });
    pad.i.push({ id: `pad-item-${n}`, group_id: `pad-${n}`, title: `Beach ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 50,
      viator_item_url: '', is_best_seller: true, display_order: 0, tags: [90000 + n], experience_cluster_id: `pad-c-${n}` });
  }

  it('places at most one off-road tour on a long trip, even across groups', () => {
    const cat: Catalog = {
      activities: [],
      groups: [mkGroup(1), mkGroup(2), mkGroup(3), ...pad.g],
      items: [
        mkItem(1, 'Natural Pool Rugged Jeep Safari'),
        mkItem(2, 'Aruba UTV Adventure to Natural Pool'),
        mkItem(3, 'Private 4x4 Off-Road Arikok Tour'),
        ...pad.i,
      ],
    };
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 12, interests: ['adventure'] }, cat));
    const offroadCount = ids.filter((id) => /off-item-/.test(id)).length;
    expect(offroadCount).toBeLessThanOrEqual(1);
  });
});

describe('generatePlan — day-level geographic clustering', () => {
  // Two Viator groups ~15 km apart (Palm Beach watersports vs Arikok adventure-tours),
  // each with many distinct-cluster, tag-less, single-section items. coordOf resolves
  // each item to its GROUP_COORDS point, so a day that stays in one group has intra-day
  // spread 0 and a day that mixes groups spreads ~15 km. All items share one Explore
  // section, so same-day kind-variety never forces a cross-region pick, and distinct
  // cluster ids let item-level fill place several per group across the trip. The geo
  // penalty (~4.5 pts here, above the score BAND) should keep every day single-region →
  // tight average; remove it and each anchor's far twin scatters picks past the guard.
  // (The old getCatalog() stub was too thin/homogeneous to measure this once planning
  // went item-level; production geo is guarded live in e2e-engine.test.ts.)
  const mkItems = (groupId: string, prefix: string): ViatorItem[] =>
    Array.from({ length: 25 }, (_, n) => ({
      id: `${prefix}-${n}`, group_id: groupId, title: `${prefix} ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.5, review_count: 50,
      viator_item_url: '', is_best_seller: n === 0, display_order: n,
      sections: ['beaches' as const], experience_cluster_id: `${prefix}-cluster-${n}`,
    }));
  const groups: ViatorGroup[] = [
    { id: 'watersports', name: 'watersports', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: [] as MatchTag[], region: 'palm-beach' as const, allowed_slots: [] as const },
    { id: 'adventure-tours', name: 'adventure-tours', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 1, matched_by: [] as MatchTag[], region: 'arikok' as const, allowed_slots: [] as const },
  ];
  const cat: Catalog = {
    activities: [],
    groups,
    items: [...mkItems('watersports', 'west'), ...mkItems('adventure-tours', 'far')],
  };
  const coordOf = (e: SlotEntry): Coord | undefined =>
    e.kind === 'activity' ? ACTIVITY_COORDS[e.id] : (VIATOR_ITEM_COORDS[e.bestSellerId] ?? GROUP_COORDS[e.groupId]);

  it('keeps each day geographically coherent (average intra-day spread stays tight)', () => {
    let sum = 0;
    let cnt = 0;
    for (let seed = 0; seed < 6; seed += 1) {
      const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 7 }, cat, { seed });
      for (const d of plan) {
        const cs = [...d.morning, ...d.afternoon, ...d.evening]
          .map(coordOf)
          .filter((c): c is Coord => !!c);
        let spread = 0;
        for (let i = 0; i < cs.length; i += 1)
          for (let j = i + 1; j < cs.length; j += 1) spread = Math.max(spread, distanceKm(cs[i], cs[j]));
        sum += spread;
        cnt += 1;
      }
    }
    // The two groups sit ~15 km apart; a day that mixes them spreads ~15 km. With the
    // geo penalty every day stays single-region (spread ≈ 0). Guard at 5 km fails loudly
    // if the penalty is removed (mixing pushes the average toward ~7 km).
    expect(sum / cnt).toBeLessThan(5);
  });
});

describe('generatePlan — premium splurge does not duplicate a pinned item', () => {
  const cat = getCatalog();
  const MNO: Answers = {
    ...DEFAULT_ANSWERS, budget: 'Money no object', adventureLevel: 30,
    groupType: 'Couple', interests: ['beach-chill', 'watersports'],
  };

  it('pinning the private charter keeps it appearing exactly once (no pin+premium double-place)', () => {
    for (let s = 0; s < 6; s += 1) {
      const plan = generatePlan({ ...MNO, days: 9 }, cat, { seed: s, pinned: ['item:private-charter'] });
      const charterCount = plan
        .flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
        .filter((e) => e.kind === 'group' && e.bestSellerId === 'private-charter').length;
      expect(charterCount).toBe(1);
    }
  });
});

describe('generatePlan — day feasibility (≤8h, buffers, spread)', () => {
  const DAY_CAP = 480;
  const BUFFER = 60;
  // Total wall-clock a day consumes: activity minutes + a buffer between each pair.
  const dayMinutes = (d: Day, cat: Catalog): number => {
    const entries: SlotEntry[] = [...d.morning, ...d.afternoon, ...d.evening];
    const mins = entries.map((e) => durationMinutes(
      e.kind === 'group'
        ? cat.items.find((i) => i.id === e.bestSellerId)?.duration
        : cat.activities.find((a) => a.id === e.id)?.duration,
    ));
    return mins.reduce((a, b) => a + b, 0) + Math.max(0, entries.length - 1) * BUFFER;
  };
  const uniformCatalog = (duration: string): Catalog => {
    const groups: ViatorGroup[] = Array.from({ length: 24 }, (_, n) => ({
      id: `g-${n}`, name: `g-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const items: ViatorItem[] = groups.map((g, n) => ({
      id: `i-${n}`, group_id: g.id, title: `Activity ${n}`, image_url: '',
      price_usd: 0, duration, rating: 4.5, review_count: 100,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [70000 + n], experience_cluster_id: `c-${n}`,
    }));
    return { activities: [], groups, items };
  };

  it('durationMinutes parses ranges, hours, minutes, and full-day', () => {
    expect(durationMinutes('2–3 hrs')).toBe(150); // en-dash range, unit dropped on low end → midpoint
    expect(durationMinutes('3 hrs')).toBe(180);
    expect(durationMinutes('3.5 hrs')).toBe(210);
    expect(durationMinutes('90 min')).toBe(90);
    expect(durationMinutes('Full day')).toBe(420);
    expect(durationMinutes('')).toBe(180); // unparseable → conservative default
    // Mixed-unit ranges the live edge function emits (normalize.ts durationLabel).
    expect(durationMinutes('45 min–1.5 hrs')).toBe(68); // (45 + 90) / 2 = 67.5 → 68
    expect(durationMinutes('30 min–1 hr')).toBe(45);    // (30 + 60) / 2
    expect(durationMinutes('30–45 min')).toBe(38);      // both minutes → (30 + 45) / 2 = 37.5 → 38
  });

  it('never books more than 8h (incl. buffers) on any day', () => {
    const cat = uniformCatalog('3 hrs'); // 3h items: two fit (7h), a third would be 11h
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 7 }, cat, { seed: 3 });
    plan.forEach((d) => expect(dayMinutes(d, cat)).toBeLessThanOrEqual(DAY_CAP));
  });

  it('a >window activity occupies its slot alone and spreads into the next', () => {
    // 6h items overrun every slot window: morning fills, afternoon is blocked by
    // the spread, and evening can’t fit under the 8h cap — one activity per day.
    const cat = uniformCatalog('6 hrs');
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 5 }, cat, { seed: 1 });
    plan.forEach((d) => {
      const filled = d.morning.length + d.afternoon.length + d.evening.length;
      expect(filled).toBeLessThanOrEqual(1);
      expect(dayMinutes(d, cat)).toBeLessThanOrEqual(DAY_CAP);
    });
  });
});

describe('generatePlan — theme matches the anchor (longest) activity', () => {
  it('every day title equals its longest activity’s category', () => {
    const cat = getCatalog();
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 6 }, cat, { seed: 2 });
    for (const d of plan) {
      const entries: SlotEntry[] = [...d.morning, ...d.afternoon, ...d.evening];
      if (entries.length === 0) continue;
      const withMeta = entries.map((e) => e.kind === 'group'
        ? { min: durationMinutes(cat.items.find((i) => i.id === e.bestSellerId)?.duration), cat: cat.groups.find((g) => g.id === e.groupId)?.name }
        : { min: durationMinutes(cat.activities.find((a) => a.id === e.id)?.duration), cat: cat.activities.find((a) => a.id === e.id)?.category });
      const anchor = withMeta.reduce((best, x) => x.min > best.min ? x : best, withMeta[0]);
      expect(d.title).toBe(anchor.cat);
    }
  });
});
