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
import { isWaterBased, isAutoFillExcluded } from './itemFit';
import { parseActivityCost } from './matcher';

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

// The auto-fill pool: one champion per experience cluster, gated on 25 reviews.
// These fixtures deliberately exceed MIN_CATALOG_TO_FLOOR (60) — below it the
// generator skips narrowing entirely, which is why every other fixture in this
// file leaves championsByExperience untested.
describe('generatePlan — champion-per-experience fill pool', () => {
  const NARROWING_MIN = 60;

  // n items spread over `clusters` experience clusters. Reviews ascend with the
  // index, so the highest-index member of a cluster is its rightful champion.
  function clusteredCatalog(opts: {
    n?: number; clusters: number; reviews: (i: number) => number;
  }): Catalog {
    const n = opts.n ?? 90;
    const groups: ViatorGroup[] = [{
      id: 'g', name: 'g', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: [], region: 'islandwide', allowed_slots: [],
    }];
    const items: ViatorItem[] = Array.from({ length: n }, (_, i) => ({
      id: `it-${String(i).padStart(3, '0')}`, group_id: 'g', title: `item ${i}`,
      image_url: '', price_usd: 50, duration: '2 hrs', rating: 4.5,
      review_count: opts.reviews(i), viator_item_url: '',
      is_best_seller: false, display_order: i,
      experience_cluster_id: `c-${i % opts.clusters}`,
    }));
    return { activities: [], groups, items };
  }

  const placedIds = (cat: Catalog, answers = { ...DEFAULT_ANSWERS, days: 10 }, seed = 1) =>
    generatePlan(answers, cat, { seed })
      .flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
      .filter((e) => e.kind === 'group')
      .map((e) => (e as { bestSellerId: string }).bestSellerId);

  it('places at most one item per experience cluster across the trip', () => {
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 500 });
    expect(cat.items.length).toBeGreaterThanOrEqual(NARROWING_MIN);
    const ids = placedIds(cat);
    const byId = new Map(cat.items.map((i) => [i.id, i]));
    const clusters = ids.map((id) => byId.get(id)!.experience_cluster_id);
    expect(new Set(clusters).size).toBe(clusters.length);
  });

  it('never auto-fills a champion with fewer than 25 reviews', () => {
    // Half the clusters are entirely thin; they must not reach the plan.
    const cat = clusteredCatalog({ clusters: 30, reviews: (i) => (i % 2 === 0 ? 2 : 400) });
    const byId = new Map(cat.items.map((i) => [i.id, i]));
    for (const id of placedIds(cat)) {
      expect(byId.get(id)!.review_count).toBeGreaterThanOrEqual(25);
    }
  });

  it('falls back to the full catalog rather than blanking the plan', () => {
    // Nothing clears the gate. An absolute gate (unlike the percentile it
    // replaced) can empty the pool, and a blank itinerary is the worst output
    // this app can produce.
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 3 });
    expect(placedIds(cat).length).toBeGreaterThan(0);
  });

  it('is deterministic for a given catalog and seed', () => {
    // NOTE: the guarantee is per-catalog, not per-catalog-CONTENT. The champion
    // set is order-independent (the tiebreak is a strict tuple), but the returned
    // array is in first-seen-cluster order, and ranked() shuffles the top score
    // band in pool order — so a reordered catalog legitimately yields a different
    // plan. That was equally true of the percentile filter this replaced.
    const cat = clusteredCatalog({ clusters: 30, reviews: (i) => 30 + i });
    expect(placedIds(cat)).toEqual(placedIds(cat));
    expect(placedIds(cat, { ...DEFAULT_ANSWERS, days: 10 }, 7))
      .not.toEqual(placedIds(cat, { ...DEFAULT_ANSWERS, days: 10 }, 1));
  });

  // Regression cover for the three engine rules that shipped without any, and
  // for the bug that produced: making the embedding cluster authoritative
  // removed the only semantic net that fires, because championsByExperience has
  // already thinned each cluster to one item. Near-identical products with
  // DIFFERENT cluster ids (2455SUB vs 2455SEMI on the live feed) then co-occur.
  it('blocks a near-duplicate that has a different cluster id but overlapping tags', () => {
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 400 });
    // Two "same experience, different option code" items: distinct clusters,
    // heavily overlapping Viator tags. Only one may land across the trip.
    const shared = [101, 102, 103, 104, 105, 106, 107, 108];
    cat.items[0] = { ...cat.items[0], id: 'sub-full', title: 'Atlantis Submarine Expedition', experience_cluster_id: 'X-SUB', tags: shared };
    cat.items[1] = { ...cat.items[1], id: 'sub-semi', title: 'Atlantis Semi-Submarine Cruise', experience_cluster_id: 'X-SEMI', tags: shared };
    const placed = placedIds(cat, { ...DEFAULT_ANSWERS, days: 14 }, 3);
    const both = placed.includes('sub-full') && placed.includes('sub-semi');
    expect(both).toBe(false);
  });

  // NOTE the "aaa-" ids. championsByExperience breaks a rating/review tie on
  // `item.id < cur.id`, so a fixture named `retail-1` loses cluster c-0 to
  // `it-030` and never enters the pool at all — the test would then pass with
  // the retail filter deleted. Sorting first forces the retail item to WIN its
  // cluster, so the filter is the only thing that can keep it out.
  it('never auto-fills a retail or photo-service product', () => {
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 500 });
    cat.items[0] = { ...cat.items[0], id: 'aaa-retail', title: 'Diamond Shopping Experience with Champagne' };
    cat.items[1] = { ...cat.items[1], id: 'aaa-photo', title: 'Professional Sunset Photoshoot in Aruba' };
    const placed = placedIds(cat, { ...DEFAULT_ANSWERS, days: 14 }, 1);
    expect(placed).not.toContain('aaa-retail');
    expect(placed).not.toContain('aaa-photo');
  });

  // The rule itself, asserted directly — deterministic, and the only honest way
  // to state "the jet ski survives", since whether any given item wins a slot
  // depends on ranking against the rest of the fixture.
  it('classifies self-drive hire as excluded and watersport hire as an activity', () => {
    const item = (title: string): ViatorItem => ({
      id: 't', group_id: 'g', title, image_url: '', price_usd: 100, duration: '2 hrs',
      rating: 4.5, review_count: 100, viator_item_url: '', is_best_seller: false, display_order: 0,
    });
    // Handed a vehicle for the day — no guide, no route, no content.
    expect(isAutoFillExcluded(item('Harley-Davidson RENTALS ONLY 8 hrs'))).toBe(true);
    expect(isAutoFillExcluded(item('Aruba UTV Rental: 4-Seater for Adventure Exploration'))).toBe(true);
    expect(isAutoFillExcluded(item('Aruba Jeep Rental Adventure'))).toBe(true);
    expect(isAutoFillExcluded(item('Aruba Rental Explore On Your Own'))).toBe(true);
    // Real activities that merely carry the word.
    expect(isAutoFillExcluded(item('Aruba Jet Ski Rental — Exciting Water Adventures Await'))).toBe(false);
    expect(isAutoFillExcluded(item('Aruba 2-Tank Guided Dive for Certified Divers / rental equipment'))).toBe(false);
    expect(isAutoFillExcluded(item('Catamaran Sail & Snorkel at Boca Catalina'))).toBe(false);
  });

  it('keeps two near-alike picks off the SAME day but allows them on different days', () => {
    // The reported case: a local snorkel beach and a snorkel catamaran are a
    // fine Tuesday and Wednesday, but a poor Tuesday. Two items sharing most of
    // their tags must never share a day; they may still both appear in the trip.
    // Tags are chosen to sit BETWEEN the two thresholds: 2 shared of 18 union =
    // Jaccard 0.111, which is >= the 0.08 same-day rule but < the 0.35 trip-wide
    // one. Identical tags would be blocked trip-wide and the same-day rule would
    // never be the deciding factor — the test would then pass with it disabled.
    // Every other item is evening-only, so these two are the ONLY things that can
    // fill a daytime slot: with the rule off they share a day, with it on they
    // cannot.
    const A = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const B = [1, 2, 11, 12, 13, 14, 15, 16, 17, 18];
    const cat = clusteredCatalog({ n: 62, clusters: 31, reviews: () => 400 });
    cat.items = cat.items.map((i, n) => {
      if (n === 0) return { ...i, id: 'aaa-snorkel-0', title: 'Snorkel Sail Alpha', tags: A, experience_cluster_id: 'SNORK-0' };
      if (n === 1) return { ...i, id: 'aaa-snorkel-1', title: 'Snorkel Sail Beta', tags: B, experience_cluster_id: 'SNORK-1' };
      return { ...i, title: `Sunset Nightlife Session ${n}`, tags: [300 + n, 400 + n] };
    });
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, cat, { seed: 6 });
    for (const d of plan) {
      const sameDay = [...d.morning, ...d.afternoon, ...d.evening]
        .filter((e) => e.kind === 'group' && /^aaa-snorkel-/.test((e as { bestSellerId: string }).bestSellerId));
      expect(sameDay.length).toBeLessThanOrEqual(1);
    }
  });

  // Conchi sits inside Arikok, whose gates shut at 16:00 — so it is a morning
  // trip or it does not happen — and it is one place, so once per trip, and not
  // on the day you land or fly out.
  it('places Natural Pool once, in a morning, and never on the first or last day', () => {
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 400 });
    cat.items = cat.items.map((i, n) => (n < 3
      ? { ...i, id: `aaa-np-${n}`, title: `Aruba Natural Pool Safari ${n}`, experience_cluster_id: `NP-${n}` }
      : i));
    const days = 10;
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days }, cat, { seed: 6 });
    const hits: { day: number; slot: string }[] = [];
    plan.forEach((d, i) => (['morning', 'afternoon', 'evening'] as const).forEach((s) => {
      if (d[s].some((e) => e.kind === 'group' && /^aaa-np-/.test((e as { bestSellerId: string }).bestSellerId))) {
        hits.push({ day: i + 1, slot: s });
      }
    }));
    expect(hits.length).toBe(1);   // exactly one — at 0 the assertions below are vacuous
    for (const h of hits) {
      expect(h.slot).toBe('morning');                     // Arikok shuts at 16:00
      expect(h.day).toBeGreaterThan(1);
      expect(h.day).toBeLessThan(days);
    }
  });

  it('never puts two boat outings on one day, however different they are', () => {
    // One of the evening cruises becomes the beach-dinner STAPLE, i.e. it is
    // pre-placed before the slot loop runs. That also covers the pre-seed:
    // without seeding the day from its pre-placed cards, an evening staple is
    // invisible to that same day's morning and afternoon fill.
    // The cap only adds anything over the day-gap rule for a DAYTIME boat plus
    // an EVENING one: two daytime boats already collide on the gap rule
    // (day - day = 0 < 2), and two evening boats cannot share a day because a
    // day has one evening slot. So the fixture must mix the two.
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 400 });
    cat.items = cat.items.map((i, n) => {
      if (n < 3) return { ...i, id: `aaa-boatday-${n}`, title: `Catamaran Snorkel Sail ${n}`, tags: [11888, ...Array.from({ length: 9 }, (_, k) => 700 + n * 10 + k)], experience_cluster_id: `BD-${n}` };
      if (n < 6) return { ...i, id: `aaa-boateve-${n}`, title: `Sunset Dinner Catamaran Cruise ${n}`, tags: [11888, ...Array.from({ length: 9 }, (_, k) => 900 + n * 10 + k)], experience_cluster_id: `BE-${n}` };
      return i;
    });
    for (const d of generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, cat, { seed: 11 })) {
      const boats = [...d.morning, ...d.afternoon, ...d.evening]
        .filter((e) => e.kind === 'group' && /^aaa-boat(day|eve)-/.test((e as { bestSellerId: string }).bestSellerId));
      expect(boats.length).toBeLessThanOrEqual(1);
    }
  });

  it('lets a staple block a later near-twin (its tags reach usedTagSets)', () => {
    // The production report: the catamaran staple lands, then normal fill adds a
    // second catamaran. Staples recorded their cluster but not their tags, so
    // trip-wide Jaccard could not see what a staple had placed.
    //
    // Both twins are EVENING boats so gapFamilyOf ignores them — otherwise the
    // day-gap rule would separate them and the test would pass without the fix.
    // Identical tags, distinct clusters: trip-wide Jaccard is the only rule that
    // can stop the second, and it needs the staple to have registered its tags.
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 400 });
    const shared = [11888, 11912, 801, 802, 803, 804, 805, 806];
    cat.items = cat.items.map((i, n) => (n < 2
      ? {
          ...i, id: `aaa-twin-${n}`, title: `Sunset Dinner Catamaran Cruise ${n}`,
          tags: shared, experience_cluster_id: `TWIN-${n}`, price_usd: 0,
        }
      : i));
    const ids = generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, cat, { seed: 12 })
      .flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
      .filter((e) => e.kind === 'group')
      .map((e) => (e as { bestSellerId: string }).bestSellerId)
      .filter((id) => /^aaa-twin-/.test(id));
    expect(new Set(ids).size).toBeLessThanOrEqual(1);
  });

  it('leaves at least one whole day between two daytime boat outings', () => {
    // The reported pair read as two different activityKinds ('sail' and
    // 'snorkel'), so only a family-level gap rule can separate them.
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 400 });
    // All four share the sail tag 11888 so activityKind is 'sail' for each (a
    // different tag per item would put them outside the boat family and the rule
    // would never apply). The nine filler tags are distinct, so Jaccard between
    // any pair is 1/19 = 0.053 — under BOTH the same-day 0.08 and trip-wide 0.35
    // thresholds, leaving the day-gap rule as the only thing separating them.
    cat.items = cat.items.map((i, n) => (n < 4
      ? {
          ...i, id: `aaa-boat-${n}`, title: `Catamaran Snorkel Sail ${n}`,
          tags: [11888, ...Array.from({ length: 9 }, (_, k) => 600 + n * 10 + k)],
          experience_cluster_id: `BOAT-${n}`,
        }
      : i));
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, cat, { seed: 9 });
    const boatDays: number[] = [];
    plan.forEach((d, i) => (['morning', 'afternoon', 'evening'] as const).forEach((s) => {
      if (d[s].some((e) => e.kind === 'group' && /^aaa-boat-/.test((e as { bestSellerId: string }).bestSellerId))) {
        boatDays.push(i + 1);
      }
    }));
    const sorted = [...new Set(boatDays)].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k += 1) {
      expect(sorted[k] - sorted[k - 1]).toBeGreaterThanOrEqual(2);
    }
  });

  it('never auto-fills self-drive vehicle hire', () => {
    // Every other item is evening-only, so the Harley is the ONLY product that
    // can fill a daytime slot. If it reaches the pool it is placed; if the rule
    // works, daytime stays empty. That makes the rule the only variable.
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 400 });
    cat.items = cat.items.map((i, n) => (n === 0
      ? { ...i, id: 'aaa-harley', title: 'Harley-Davidson RENTALS ONLY 8 hrs', duration: '3 hrs' }
      : { ...i, title: `Sunset Nightlife Session ${n}` }));
    const placed = placedIds(cat, { ...DEFAULT_ANSWERS, days: 14 }, 4);
    expect(placed).not.toContain('aaa-harley');
  });

  it('keeps retail out even when the pool empties and the fallback fires', () => {
    // Nothing clears the 25-review gate, so championsByExperience returns [] and
    // flooredItems falls back. The fallback must be `eligible` (retail already
    // removed), not the raw catalog — otherwise a thin pool quietly re-admits a
    // jewellery showroom.
    // The retail item is the ONLY evening-eligible product in the fixture (its
    // title carries "Sunset"), so if it reaches the pool it necessarily fills
    // evenings. That makes the filter — not ranking luck — the only thing that
    // can keep it out of the plan.
    const cat = clusteredCatalog({ n: 64, clusters: 32, reviews: () => 3 });
    cat.items[0] = {
      ...cat.items[0], id: 'aaa-retail', rating: 5,
      title: 'Diamond Shopping at Sunset with Champagne',
    };
    const placed = placedIds(cat, { ...DEFAULT_ANSWERS, days: 14 }, 2);
    expect(placed.length).toBeGreaterThan(0);       // fallback fired at all
    expect(placed).not.toContain('aaa-retail');     // and kept the quality floor
  });

  it('still places a retail product when the traveller pins it', () => {
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 500 });
    cat.items[0] = { ...cat.items[0], id: 'retail-1', title: 'Diamond Shopping Experience with Champagne' };
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 7 }, cat, { pinned: ['item:retail-1'] });
    const landed = plan.some((d) => [...d.morning, ...d.afternoon, ...d.evening].some(
      (e) => e.kind === 'group' && e.bestSellerId === 'retail-1'));
    expect(landed).toBe(true);
  });

  it('caps the evening on its own budget', () => {
    // 8h fails EVENING_CAP_MIN (240) however empty the day is. Title must be
    // evening-eligible WITHOUT matching the beach-dinner staple (dinner + a
    // seaside word), or it is pre-placed as a staple and never sees `feasible`.
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 400 });
    cat.items[0] = { ...cat.items[0], id: 'aaa-eve-long', title: 'Late Night Party Marathon', duration: '8 hrs' };
    const placed = placedIds(cat, { ...DEFAULT_ANSWERS, days: 14 }, 5);
    expect(placed).not.toContain('aaa-eve-long');
  });

  it('charges the afternoon-to-evening crossover buffer', () => {
    // 210min fits the 240min cap on its own but NOT once the 60min crossover
    // buffer is charged against a day that already has picks. Deleting the
    // buffer term from `feasible` makes this pass, which is the point.
    const cat = clusteredCatalog({ clusters: 30, reviews: () => 400 });
    cat.items[0] = { ...cat.items[0], id: 'aaa-eve-210', title: 'Aruba Nightlife Session', duration: '3.5 hrs' };
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, cat, { seed: 5 });
    // Every day that placed it must have had an empty daytime, or the buffer
    // was not charged.
    for (const d of plan) {
      const inEvening = d.evening.some((e) => e.kind === 'group' && e.bestSellerId === 'aaa-eve-210');
      if (inEvening) expect(d.morning.length + d.afternoon.length).toBe(0);
    }
  });

  it('a pinned thin item still lands (explicit choice beats the pool rule)', () => {
    const cat = clusteredCatalog({ clusters: 30, reviews: (i) => (i === 0 ? 1 : 400) });
    const niche = cat.items[0];
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

describe('generatePlan — beach staples are placed for everyone', () => {
  const cat = getCatalog();
  const BEACH_SUNRISE = ['eagle-beach-morning', 'malmok-beach', 'tres-trapi'];
  const SUNSET = ['california-lighthouse-sunset', 'manchebo-beach'];

  const staples = (plan: Day[]): SlotEntry[] =>
    plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
        .filter((e) => e.staple);
  const stapleIds = (plan: Day[]): string[] =>
    staples(plan).map((e) => (e.kind === 'activity' ? e.id : e.bestSellerId));

  // The whole point of the feature: opposite personas still get the classics.
  it('gives a sunrise beach and a sunset to opposite personas alike', () => {
    for (const persona of [FOODIE, ADVENTURER]) {
      const ids = stapleIds(generatePlan(persona, cat, { seed: 1 }));
      expect(ids.some((id) => BEACH_SUNRISE.includes(id))).toBe(true);
      expect(ids.some((id) => SUNSET.includes(id))).toBe(true);
    }
  });

  it('places staples even for a 1-day cruise-call trip', () => {
    const ids = stapleIds(generatePlan({ ...DEFAULT_ANSWERS, days: 1 }, cat, { seed: 1 }));
    expect(ids.some((id) => BEACH_SUNRISE.includes(id))).toBe(true);
    expect(ids.some((id) => SUNSET.includes(id))).toBe(true);
  });

  it('marks staples with staple=true and never with pinned', () => {
    const found = staples(generatePlan({ ...DEFAULT_ANSWERS, days: 7 }, cat, { seed: 1 }));
    expect(found.length).toBeGreaterThan(0);
    for (const e of found) {
      expect(e.staple).toBe(true);
      expect(e.pinned).toBeFalsy();
    }
  });

  // Regression: the day loop runs day 1 → N, so a staple sitting on a later day
  // used to be invisible to the dedup while day 1 filled — the sunset beach was
  // placed twice. Staples must be retired trip-wide in the pre-pass.
  it('never lets normal fill duplicate a staple placed on a later day', () => {
    for (const seed of [1, 2, 3, 4]) {
      const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, cat, { seed }));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  // Day 1 is the free/chill settle-in day; only free staples may sit there.
  it('keeps paid staples off the arrival day', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 7 }, cat, { seed: 1 });
    const dayOne = [...plan[0].morning, ...plan[0].afternoon, ...plan[0].evening]
      .filter((e) => e.staple);
    for (const e of dayOne) {
      const price = e.kind === 'group'
        ? cat.items.find((i) => i.id === e.bestSellerId)!.price_usd
        : parseActivityCost(cat.activities.find((a) => a.id === e.id)!.cost);
      expect(price).toBe(0);
    }
  });

  // Safety flags outrank the default: a seasick traveller is never handed a sail.
  it('drops the water staples entirely for a seasick traveller', () => {
    const plan = generatePlan(
      { ...DEFAULT_ANSWERS, days: 7, specialNotes: 'I get seasick easily' }, cat, { seed: 1 },
    );
    const ids = stapleIds(plan);
    // The land-based classics survive...
    expect(ids.some((id) => BEACH_SUNRISE.includes(id))).toBe(true);
    // ...and nothing water-based was placed anywhere in the plan.
    const all = plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]);
    for (const e of all) {
      if (e.kind !== 'group') continue;
      expect(isWaterBased(cat.items.find((i) => i.id === e.bestSellerId)!)).toBe(false);
    }
  });

  // Staples are fixed by category but not by product, so "regenerate" still moves.
  it('varies which staple fills a category across reseeds', () => {
    const bySeed = [1, 2, 3, 4, 5, 6].map((seed) =>
      stapleIds(generatePlan({ ...DEFAULT_ANSWERS, days: 5 }, cat, { seed })).join(','));
    expect(new Set(bySeed).size).toBeGreaterThan(1);
  });
});

describe('generatePlan — contraindication caps apply per item, not per group', () => {
  // Regression: the live feed files most off-road products under a group whose
  // matched_by is beach-chill/couple/cruise-day, so the group-level exclude list
  // never touched them and a mobility-limited traveller got a 4x4 jeep tour.
  // A synthetic catalog reproduces exactly that shape.
  function misfiledCatalog(): Catalog {
    const groups: ViatorGroup[] = [{
      id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
      viator_group_url: '', display_order: 1,
      matched_by: ['beach-chill', 'couple'] as MatchTag[],
      region: 'palm-beach', allowed_slots: [],
    }];
    const items: ViatorItem[] = [
      // An off-road tour hiding in the sailing group (Viator tag 12035 = 4WD).
      { id: 'misfiled-jeep', group_id: 'sailing-cruises', title: 'Natural Pool 4x4 Jeep Safari',
        image_url: '', price_usd: 99, duration: '4 hrs', rating: 4.9, review_count: 5000,
        viator_item_url: '', is_best_seller: true, display_order: 0, tags: [12035] },
      // A gentle land option so the plan has something legal to place.
      { id: 'gentle-tour', group_id: 'sailing-cruises', title: 'Downtown Walking Tour',
        image_url: '', price_usd: 39, duration: '2 hrs', rating: 4.6, review_count: 400,
        viator_item_url: '', is_best_seller: false, display_order: 1, tags: [21910] },
    ];
    return { activities: [], groups, items };
  }

  // `with-baby` only applies to family-ish group types (see flagAppliesTo), so
  // each flag is tested with a group type that actually carries it.
  const CAPPED: [string, string][] = [
    ['mobility', 'Couple'], ['with-baby', 'Family with young kids'], ['intense-hikes', 'Couple'],
  ];

  it('keeps an off-road tour out of a mobility-limited plan even when mis-grouped', () => {
    const cat = misfiledCatalog();
    for (const [flag, groupType] of CAPPED) {
      const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 7, groupType, flags: [flag] }, cat, { seed: 1 });
      expect(entryIds(plan), `flag ${flag}`).not.toContain('misfiled-jeep');
    }
  });

  it('still places the mis-grouped off-road tour for an unflagged traveller', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 7, flags: [] }, misfiledCatalog(), { seed: 1 });
    expect(entryIds(plan)).toContain('misfiled-jeep');
  });
});

describe('generatePlan — a pin placed on a later day is not also auto-filled', () => {
  const cat = getCatalog();

  // Regression: the day loop runs day 1 → N and only registered a pin as "used"
  // when it reached that pin's day, so normal fill on an earlier day could place
  // the same shortlisted item again — it showed up twice in the plan.
  //
  // LOCAL picks are the ones this actually bites. A Viator pin is caught anyway
  // by notSimilar's tag-Jaccard (an item is 1.0 similar to itself), but a local
  // activity carries no Viator tags and no cluster id, so notSimilar returns
  // early for it and lastUsedDay was the only thing standing in the way.
  // Verified: with the pre-registration removed, eagle-beach-morning is placed
  // twice on every seed below.
  it('places each pinned local pick exactly once across a long trip', () => {
    const pins = ['california-lighthouse-sunset', 'manchebo-beach', 'eagle-beach-morning',
                  'malmok-beach', 'tres-trapi'];
    for (const seed of [1, 2, 3]) {
      const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, cat, { seed, pinned: pins });
      const ids = entryIds(plan);
      for (const id of pins) {
        const count = ids.filter((x) => x === id).length;
        expect(count, `${id} @ seed ${seed}`).toBeLessThanOrEqual(1);
      }
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('generatePlan — premium splurge never re-places a staple', () => {
  // Regression: the premium pre-pass derived its "already claimed" set from
  // pinnedSlots only, so a staple that was also the best premium-tier pick for
  // its group was placed twice — once badged "Island classic", once "Signature
  // splurge". Both pre-passes register in ctx.lastUsedDay, which is now the set.
  it('places no item twice for a money-no-object traveller on a long trip', () => {
    const cat = getCatalog();
    for (const days of [7, 9, 14]) {
      for (const seed of [1, 2, 3]) {
        const ids = entryIds(generatePlan(
          { ...DEFAULT_ANSWERS, days, budget: 'Money no object' }, cat, { seed },
        ));
        expect(new Set(ids).size, `days=${days} seed=${seed}`).toBe(ids.length);
      }
    }
  });
});
