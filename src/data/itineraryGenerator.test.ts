import { describe, it, expect } from 'vitest';
import { generatePlan, durationMinutes, claimedRouteFamilies, withoutClaimedFamilies } from './itineraryGenerator';
import { getCatalog } from './activitySource';
import { DEFAULT_ANSWERS } from '../App';
import type { Answers } from '../App';
import type { Activity, Day } from './activities';
import type { Catalog } from './activitySource';
import type { MatchTag, ViatorGroup, ViatorItem, SlotEntry, CardEntry } from '../types';
import { type Coord } from './coords';
import { pinFor } from './itemCoords';
import { distanceKm } from './enRoute';
import { isWaterBased, isAutoFillExcluded, activityKind } from './itemFit';
import { isLunchspot } from './lunchspots';
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

// The no-repeat contract, post free-beach revisits: nothing repeats EXCEPT a
// free local beach, and those only with a clear day between visits.
function expectNoIllegalRepeats(plan: Day[], cat: Catalog) {
  const byId = new Map(cat.activities.map((a) => [a.id, a]));
  const seenOn = new Map<string, number[]>();
  plan.forEach((d, i) => {
    for (const e of [...d.morning, ...d.afternoon, ...d.evening]) {
      const id = e.kind === 'activity' ? e.id : e.bestSellerId;
      seenOn.set(id, [...(seenOn.get(id) ?? []), i + 1]);
    }
  });
  for (const [id, days] of seenOn) {
    if (days.length === 1) continue;
    const a = byId.get(id);
    const ok = !!a && a.category === 'Beaches' && parseActivityCost(a.cost) === 0;
    expect(ok, `${id} repeated but is not a free beach`).toBe(true);
    for (let k = 1; k < days.length; k += 1) {
      expect(days[k] - days[k - 1], `${id} revisited too soon`).toBeGreaterThanOrEqual(2);
    }
  }
}

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

  // The no-repeat guarantee is deliberately preferred over a full evening: once
  // the distinct pool is exhausted the slot stays open ("Drop an activity here")
  // rather than repeating. ONE exception: a free local beach may be revisited
  // after a clear day, because that is what people actually do — you go back to
  // Eagle Beach on Thursday, you do not do the submarine tour twice.
  it('repeats nothing except free beaches, and those only after a clear day', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, catalog);
    const byId = new Map(catalog.activities.map((a) => [a.id, a]));
    const seenOn = new Map<string, number[]>();
    plan.forEach((d, i) => {
      for (const e of [...d.morning, ...d.afternoon, ...d.evening]) {
        const id = e.kind === 'activity' ? e.id : e.bestSellerId;
        seenOn.set(id, [...(seenOn.get(id) ?? []), i + 1]);
      }
    });
    for (const [id, days] of seenOn) {
      if (days.length === 1) continue;
      const a = byId.get(id);
      const revisitable = !!a && a.category === 'Beaches' && parseActivityCost(a.cost) === 0;
      expect(revisitable, `${id} repeated but is not a free beach`).toBe(true);
      for (let k = 1; k < days.length; k += 1) {
        expect(days[k] - days[k - 1], `${id} revisited too soon`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('fills evening every day when the evening pool is deep enough (no forced gaps)', () => {
    // 10 distinct evening groups (one per night) + 20 distinct day groups (two per
    // day for morning & afternoon). Each group is retired after its first use, so
    // the pool must be as large as the plan to guarantee every slot fills.
    const eveGroups: ViatorGroup[] = Array.from({ length: 10 }, (_, n) => ({
      id: `nightlife-${n}`, name: `nightlife-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: ['evening' as const],
    }));
    // Ten DISTINCT evening experiences. These used to be ten "Sunset Dinner
    // Cruise N" items, which no longer proves anything: a trip now gets one
    // evening cruise however many operators sell it (see routeFamilyOf), so ten
    // copies of one boat is a pool of depth 1, not 10. The property under test —
    // a deep enough pool fills every evening — is unchanged.
    const eveItems: ViatorItem[] = eveGroups.map((g, n) => ({
      id: `eve-${n}`, group_id: g.id, title: `Evening Experience ${n}`,
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
    // Was "every evening is filled". Since 2026-08-05 a day carries at most two
    // activities, so a day that spends both on the morning and afternoon leaves
    // the evening open BY DESIGN — the "Drop an activity here" zone is the point,
    // not a gap to plug. What a deep pool must still guarantee is that no day is
    // left short of the shape it is allowed: two activities, every day.
    plan.forEach((d) => {
      const cards = [...d.morning, ...d.afternoon, ...d.evening];
      expect(cards.length).toBe(2);
    });
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
    // Both items sit in the "sailing" group but are different experiences. The old
    // per-group dedup (usedGroupIds) let only one land; item-level planning places both.
    //
    // The pair used to be a catamaran charter and a Jolly Pirates cruise. That no
    // longer holds and should not: those two ARE one experience sold by two
    // operators, and a trip now gets one (see routeFamilyOf's 'sail'). The
    // jeep tour below keeps the test honest AND realistic — the live feed files
    // 68 of Aruba's 85 off-road products under "Sailing & Cruises", so a group
    // holding a sail and a jeep safari is the normal case, not a contrived one.
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
      id: 'jolly', group_id: 'sailing', title: 'Rugged Jeep Safari to Indian Cave',
      image_url: '', price_usd: 65, duration: '', rating: 4.7, review_count: 900,
      viator_item_url: '', is_best_seller: false, display_order: 1,
      tags: [12035],                        // 12035 = 4WD -> 'offroad' kind
      experience_cluster_id: 'cluster-jolly',
    };
    // Different kinds + tag-Jaccard 0 (no shared tags) + different clusters =>
    // notSimilar allows BOTH. is_best_seller:false on the second proves a
    // non-face item still surfaces.
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
    // The Natural Pool items are the most-booked in the pool, as they are on the
    // live catalog (the Arikok/Conchi tours are among the island's top
    // products). Without that they are indistinguishable from 87 identical
    // filler items, and once a day carries two outings instead of three there
    // are too few slots for a coin-flip to reliably seat them — the test then
    // fails on its own non-vacuousness guard while the rule it exists to check
    // is perfectly intact. Verified on the live catalog at the same time: a
    // Natural Pool card appears in 72 of 72 adventure trips, always in a
    // morning, never on the first or last day.
    // 12035 = 4WD, so these classify as off-road and `isCrowdPleaser` scores
    // them like the real thing. Without a scoring edge they are 3 of 90
    // identical items competing by coin-flip for a shrinking number of slots.
    cat.items = cat.items.map((i, n) => (n < 3
      ? { ...i, id: `aaa-np-${n}`, title: `Aruba Natural Pool Safari ${n}`,
          review_count: 900, tags: [12035], experience_cluster_id: `NP-${n}` }
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

  it('a 9-day trip surfaces the private charter, and it is the ONLY cruise', () => {
    // This used to demand a SECOND sailing-cruises pick alongside the charter,
    // on the reasoning that a week-plus splurge trip has room for both. It does
    // not: every cruise in this group runs the same water — the stub's own
    // descriptions name "Antilla wreck, Boca Catalina" and "Catalina Bay and
    // Malmok reef" — so the second one sells the charter's route back to a
    // traveller who already booked it. The pre-pass still has to fire, which is
    // what the first assertion guards.
    const plan = generatePlan({ ...MNO, days: 9 }, cat, { seed: 1 });
    const sc = sailingEntries(plan);
    expect(sc.some((e) => e.bestSellerId === 'private-charter')).toBe(true);
    expect(sc).toHaveLength(1);
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

  // Asserts the BEHAVIOUR — a far-south drive picks up a food stop on the way —
  // rather than naming one stop. It named Zeerover until 2026-08-03, when
  // lunch-oniels moved 570m from a town-level guess to the real restaurant node
  // and became the shorter detour (1.18km against 1.45km). Which stop wins is a
  // consequence of accurate coordinates and may change again; that a stop is
  // offered at all is the contract worth holding.
  const EN_ROUTE_FOOD = ['zeerovers-fresh-catch', 'lunch-oniels', 'lunch-hadicurari',
    'lunch-pikas-corner', 'lunch-don-jacinto'];

  // Scoped down on 2026-08-05, when a day became "two activities and ONE meal".
  // This used to assert the pinned Boca Grandi day itself picks up a roadside
  // stop. It no longer does — on the stub that day reliably draws the Gasparito
  // dinner first, and a day may not carry both a lunch and a dinner — so the
  // assertion moved to the trip. The stop is still offered on days that have no
  // other meal (33 days across the five live personas × 6 seeds); what changed
  // is which meal wins when a day would have had two, and that is placement
  // order: the evening ladder runs before the en-route post-pass.
  it('offers the stop on a far-south day, and only on one with room for it', () => {
    // Asserted on the DAY the stop lands on, not on the trip: a trip-wide
    // assertion passes on almost any behaviour change. Two things must hold —
    // the stop appears at all, and it sits on a day that actually drives south
    // (Baby Beach, Boca Grandi, Rodger's Beach are all bottom-of-the-island),
    // which is the whole premise of an "en-route" suggestion.
    //
    // Since the one-meal rule the stop skips days that are full or already have
    // a dinner, so it now lands on the roomier far-south day rather than the
    // pinned Boca Grandi one. That is the day shape working, not a miss.
    const FAR_SOUTH = ['baby-beach-snorkel', 'boca-grandi', 'rodgers-beach', 'zeerovers-fresh-catch'];
    let daysWithStop = 0;
    for (const seed of [4, 5, 7]) {
      const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 6 }, cat, { seed, pinned: ['boca-grandi'] });
      for (const d of plan) {
        const ids = [...d.morning, ...d.afternoon, ...d.evening]
          .flatMap((e) => (e.kind === 'activity' ? [e.id] : []));
        if (!ids.some((id) => EN_ROUTE_FOOD.includes(id))) continue;
        daysWithStop += 1;
        expect(ids.some((id) => FAR_SOUTH.includes(id))).toBe(true);
      }
    }
    expect(daysWithStop).toBeGreaterThan(0);
  });

  it('puts the food stop FIRST in the afternoon, ahead of the activity', () => {
    // You eat, then you spend the afternoon somewhere. "Rodger's Beach, then
    // O'Neil's" reads as a meal tacked onto the end of the day. The manual
    // "Suggest lunch spot" button has always inserted at the start; the
    // generator's post-pass appended, so the same stop sat in a different
    // position depending on how it got there.
    for (let seed = 0; seed < 6; seed += 1) {
      const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 8 }, cat, { seed, pinned: ['boca-grandi'] });
      for (const d of plan) {
        const idx = d.afternoon.findIndex((e) => e.kind === 'activity' && EN_ROUTE_FOOD.includes(e.id));
        if (idx === -1) continue;
        expect(idx, `seed ${seed}: food card should lead the afternoon`).toBe(0);
      }
    }
  });

  it('never gives a day both a lunch stop and a dinner', () => {
    for (let seed = 0; seed < 6; seed += 1) {
      const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 8 }, cat, { seed, pinned: ['boca-grandi'] });
      for (const d of plan) {
        const foodCards = [...d.morning, ...d.afternoon, ...d.evening]
          .filter((e) => e.kind === 'activity'
            && (EN_ROUTE_FOOD.includes(e.id) || e.id === 'gasparito-restaurant'));
        expect(foodCards.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never offers an en-route food stop to a no-car traveller', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 8, flags: ['no-car'] }, cat, { seed: 1, pinned: ['boca-grandi'] });
    const ids = entryIds(plan);
    expect(EN_ROUTE_FOOD.filter((id) => ids.includes(id))).toEqual([]);
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

describe('generatePlan — one kayak outing per trip', () => {
  // Aruba's kayak tours all paddle the same south-coast mangrove/lagoon water
  // (Mangel Halto, Spanish Lagoon, Sea Glass Island), so a trip gets one at
  // most. Reported live: "Aruba Glass Bottom Kayak Tour" on day 3 and "Kayak
  // Tour at Mangel Halto and Spanish Lagoon" on day 5 of a 7-day plan.
  //
  // Tag sets here are deliberately near-disjoint (Jaccard 0.07) so they clear
  // BOTH the trip-wide 0.35 and same-day 0.08 similarity gates — exactly like
  // the live pair, whose Jaccard is 0.31. Nothing but the kayak family can
  // separate these, which is what makes this a regression test and not a
  // restatement of the Jaccard rule.
  const KAYAK = 12047;
  const mkGroup = (n: number): ViatorGroup => ({
    id: `kay-${n}`, name: `kay-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: n, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  const mkItem = (n: number, title: string, tags: number[]): ViatorItem => ({
    id: `kay-item-${n}`, group_id: `kay-${n}`, title,
    image_url: '', price_usd: 80, duration: '', rating: 4.6, review_count: 200,
    viator_item_url: '', is_best_seller: true, display_order: 0,
    tags, experience_cluster_id: `kay-cluster-${n}`,
  });
  const pad: { g: ViatorGroup[]; i: ViatorItem[] } = { g: [], i: [] };
  for (let n = 0; n < 20; n += 1) {
    pad.g.push({ id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 5, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const });
    pad.i.push({ id: `pad-item-${n}`, group_id: `pad-${n}`, title: `Beach ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 50,
      viator_item_url: '', is_best_seller: true, display_order: 0, tags: [90000 + n], experience_cluster_id: `pad-c-${n}` });
  }

  it('places at most one kayak tour on a long trip, across groups and clusters', () => {
    const cat: Catalog = {
      activities: [],
      groups: [mkGroup(1), mkGroup(2), mkGroup(3), ...pad.g],
      items: [
        mkItem(1, 'Aruba Glass Bottom Kayak Tour through the Mangrove Forest', [KAYAK, 1, 2, 3, 4, 5, 6]),
        mkItem(2, 'Kayak Tour at Mangel Halto and Spanish Lagoon', [KAYAK, 11, 12, 13, 14, 15, 16]),
        // Kind is 'snorkel' (11912 wins over 12047 in KIND_BY_TAG), so a
        // kind-only rule would let this one through — "Aruba Kayak Explorers"
        // is exactly this shape on live data.
        mkItem(3, 'Aruba Kayak Explorers', [11912, 21, 22, 23, 24, 25, 26]),
        ...pad.i,
      ],
    };
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 12, interests: ['watersports'] }, cat));
    expect(ids.filter((id) => /kay-item-/.test(id)).length).toBeLessThanOrEqual(1);
  });
});

describe('generatePlan — one sail per trip, daytime or evening', () => {
  // Catamaran sails, Jolly Pirates and snorkel sails are one experience sold by
  // different operators, so a trip gets one — and since 2026-08-12 a sunset or
  // dinner cruise counts as that one too. Measured on the live catalog
  // before this rule: a 14-day friends plan carried "Premium Catamaran
  // Afternoon Sail", "Aruba Sail and Snorkel with Turtles" and "Morning
  // Champagne and Lobster Sail" in one itinerary.
  //
  // Pairwise tag Jaccard of that real trio is 0.17-0.33, all UNDER the 0.35
  // trip-wide threshold, and all three sit in different embedding clusters —
  // which is why neither existing net caught them. The fixtures mirror that:
  // near-disjoint tags, distinct clusters.
  const SAIL = 11888, SNORKEL = 11912, DIVE = 12021;
  const mkGroup = (id: string): ViatorGroup => ({
    id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  const mkItem = (id: string, title: string, tags: number[]): ViatorItem => ({
    id, group_id: `g-${id}`, title,
    image_url: '', price_usd: 90, duration: '3 hrs', rating: 4.7, review_count: 300,
    viator_item_url: '', is_best_seller: true, display_order: 0,
    tags, experience_cluster_id: `c-${id}`,
  });
  const boats = [
    mkItem('sail-a', 'Premium Catamaran Afternoon Sail: Snorkeling and Lunch', [SAIL, 1, 2, 3, 4, 5]),
    mkItem('sail-b', 'Aruba Jolly Pirate Afternoon Sail with Snorkeling', [SAIL, 11, 12, 13, 14, 15]),
    mkItem('sail-c', 'Aruba Sail and Snorkel with Turtles at WW2 Shipwreck', [SNORKEL, 21, 22, 23, 24, 25]),
    mkItem('eve-a', 'Aruba Sunset Cruise plus Seaside Dinner', [SAIL, 31, 32, 33, 34, 35]),
    mkItem('eve-b', 'An Astronomical Moment: Aruba Celestial Sunset Cruise', [SAIL, 41, 42, 43, 44, 45]),
    // NOT a sail: a shore dive, entered from the beach at Mangel Halto on the
    // south coast. It is evening and it is in the water, which is all the old
    // membership test asked for. See the test below.
    mkItem('dive-night', 'Night Shore Diving at Mangel Halto for Certified Divers', [DIVE, 51, 52, 53, 54, 55]),
    // A land-side dinner. Matches the beach-dinner staple (DINNER_RE +
    // SEASIDE_RE) exactly as the sunset dinner cruises above do, but carries no
    // route family — it is a table on the sand, not a boat.
    mkItem('dinner-shore', 'Beachfront Dinner at Passions on the Beach', [61, 62, 63, 64, 65]),
  ];
  const pad: { g: ViatorGroup[]; i: ViatorItem[] } = { g: [], i: [] };
  for (let n = 0; n < 20; n += 1) {
    pad.g.push(mkGroup(`pad-${n}`));
    pad.i.push({ id: `pad-item-${n}`, group_id: `pad-${n}`, title: `Beach ${n}`,
      image_url: '', price_usd: 0, duration: '2 hrs', rating: 4.0, review_count: 50,
      viator_item_url: '', is_best_seller: true, display_order: 0, tags: [90000 + n], experience_cluster_id: `pad-c-${n}` });
  }
  const cat: Catalog = {
    activities: [],
    groups: [...boats.map((b) => mkGroup(b.group_id)), ...pad.g],
    items: [...boats, ...pad.i],
  };
  const countOf = (ids: string[], prefix: string) => ids.filter((id) => id.startsWith(prefix)).length;

  it('places at most one DAYTIME sail/snorkel trip, however long the stay', () => {
    for (const days of [7, 14]) {
      const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days, interests: ['watersports'] }, cat));
      expect(countOf(ids, 'sail-')).toBeLessThanOrEqual(1);
    }
  });

  it('places at most one EVENING cruise, however long the stay', () => {
    for (const days of [7, 14]) {
      const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days, interests: ['watersports'] }, cat));
      expect(countOf(ids, 'eve-')).toBeLessThanOrEqual(1);
    }
  });

  it('places at most one sail in TOTAL — a sunset cruise is the same route', () => {
    // This reverses an earlier decision. The daytime catamaran and the sunset
    // cruise used to be the curated staple PAIRING, on the reasoning that the
    // evening is a different experience. It is the same boat on the same route:
    // every operator runs Malmok, Boca Catalina and the Antilla, and the only
    // thing the traveller pays twice for is the light. Measured on the live
    // catalog before this rule: 6 of 30 plans carried both, always a "Premium
    // Catamaran Afternoon Sail" plus "Aruba Celestial Sunset Cruise".
    for (const days of [7, 14]) {
      const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days, interests: ['watersports'] }, cat));
      expect(countOf(ids, 'sail-') + countOf(ids, 'eve-')).toBe(1);
    }
  });

  it('a night SHORE dive is not a sail and still lands beside the catamaran', () => {
    // The one-sail rule is about the boat route every operator runs — Malmok,
    // Boca Catalina, the Antilla. A shore dive is entered from a beach on the
    // opposite coast and shares none of it.
    //
    // The merged family briefly claimed it anyway: the evening arm tested
    // `isWaterBased`, which is the seasick filter and is deliberately broad —
    // WATER_KINDS covers dive/jetski/sup/parasail/surf and a title net catches
    // "submarine" and "ferry" on top. That breadth is right for "never show
    // this to someone who gets seasick" and wrong for "which trips are the same
    // route". Because the catamaran claims the family first, the dive was the
    // one that vanished, from every plan.
    //
    // Checked against the live catalog: of the 30 evening water-based products,
    // this is the only one that is not a boat outing — and "Luxury Four-Course
    // Caribbean Dinner Cruise" (filed under tours-sightseeing, no sail tag) is
    // one that must stay IN, which is why the test is on the title, not the kind.
    for (const days of [7, 14]) {
      const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days, interests: ['watersports'] }, cat));
      expect(countOf(ids, 'sail-') + countOf(ids, 'eve-')).toBe(1);
      expect(ids).toContain('dive-night');
    }
  });

  it('the water-dinner staple falls back to a shore dinner, not nothing', () => {
    // The staple candidate loop used to `break` on the first candidate whose
    // route family was claimed, reasoning that "the whole category is spoken
    // for". That held while each staple's pool sat in one family. Merging the
    // sail families broke it: `catamaran-sail` claims 'sail' one spec BEFORE
    // `beach-dinner`, whose matcher admits BOTH sunset dinner cruises (family
    // 'sail', now claimed) and land-side shore dinners (no family at all). A
    // `break` on the first cruise threw the shore dinner away with it, and
    // beach-dinner has `localIds: []` — no fallback — so the staple silently
    // stopped existing on the seeds where the shuffle led with a cruise.
    const dinners = ['eve-a', 'eve-b', 'dinner-shore'];
    for (let seed = 0; seed < 6; seed += 1) {
      const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 7, interests: ['watersports'] }, cat, { seed });
      const staples = plan
        .flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
        .filter((e) => e.staple)
        .map((e) => (e.kind === 'activity' ? e.id : e.bestSellerId));
      expect(staples.some((id) => dinners.includes(id))).toBe(true);
    }
  });
});

describe('generatePlan — a bus tour is not a boat', () => {
  // `BOAT_KINDS` mixes three real activity kinds (sail/snorkel/dive) with one
  // SECTION BUCKET, 'sec:cruises-water'. An item lands in that bucket when none
  // of its Viator tags names an activity, so `activityKind` falls back to the
  // item's browse section — and Viator tag 20255 maps to `cruises-water` while
  // `primarySection` breaks ties by tab order, where water sorts first.
  //
  // On the live catalog that put four non-boats in the bucket, all eligible and
  // all well-reviewed: "Full-Day Aruba History and Must-See Landmarks Tour"
  // (1591 reviews), "Horseback Ride Tour to Natural Pool" (1252), "Best of
  // Aruba by Bus" (642) and "Kids Parasailing Experience" (1). Each one counted
  // as a boat — blocking a sail on the same day via `dayCapFamilyOf`, and
  // pushing the next sail two days out via `gapFamilyOf`.
  const mkGroup = (id: string): ViatorGroup => ({
    id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  const mkItem = (id: string, title: string, tags: number[]): ViatorItem => ({
    id, group_id: `g-${id}`, title,
    image_url: '', price_usd: 80, duration: '3 hrs', rating: 4.7, review_count: 600,
    viator_item_url: '', is_best_seller: true, display_order: 0,
    tags, experience_cluster_id: `c-${id}`,
  });
  const SAIL = 11888;
  // 20255 is the real tag that drags an item into `cruises-water` — using it
  // rather than setting `sections` directly keeps the fixture honest about HOW
  // the misclassification happens.
  const CRUISES_WATER_ATTR = 20255;
  const items = [
    mkItem('sail', 'Premium Catamaran Afternoon Sail: Snorkeling and Lunch', [SAIL, 1, 2, 3]),
    mkItem('bus', 'Best of Aruba by Bus', [CRUISES_WATER_ATTR, 11, 12, 13]),
  ];
  const cat: Catalog = { activities: [], groups: items.map((i) => mkGroup(i.group_id)), items };

  const placed = (plan: Day[]): string[] =>
    plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
        .flatMap((e) => (e.kind === 'group' ? [e.bestSellerId] : []));

  it('classifies the bus into the water bucket — the fixture reproduces the real cause', () => {
    // Guards the premise. If Viator retags 20255 or TAG_SECTION changes, this
    // fails loudly rather than letting the tests below pass for the wrong reason.
    expect(activityKind(items[1])).toBe('sec:cruises-water');
  });

  it('lets a bus tour and a sail share a day', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 1 }, cat, { seed: 1 });
    expect(placed(plan)).toEqual(expect.arrayContaining(['sail', 'bus']));
  });
});

describe('generatePlan — three cards a day, meal included', () => {
  // The ceiling used to exempt the meal: three NON-meal cards PLUS one meal, so
  // a day could legitimately show four. Measured before this rule — 20 of 300
  // days on the live catalog and 29 of 180 on the stub — always the same shape,
  // an outing plus the en-route lunch stop plus a free beach plus a sunset:
  //
  //   scuba-discovery | lunch-oniels | rodgers-beach | beach-dinner
  //
  // Four is too many. The meal now counts like everything else.
  //
  // The cost is real and was accepted deliberately: the exemption existed
  // because a three-card south-coast day could not pick up its food stop, and
  // "Zeerover and O'Neil's are close to the only decent options down there".
  // Those days now lose their third card instead.
  const SLOTS = ['morning', 'afternoon', 'evening'] as const;
  const PERSONAS: Partial<Answers>[] = [
    {},
    { interests: ['food-drink'], budget: 'Budget-conscious', adventureLevel: 10, groupType: 'Couple' },
    { adventureLevel: 50, budget: 'Mid-range', groupType: 'Family with young kids' },
    { interests: ['watersports'], budget: 'Money no object', adventureLevel: 60, groupType: 'Couple' },
  ];

  it('never places a fourth card, however the day was assembled', () => {
    const cat = getCatalog();
    for (const p of PERSONAS) {
      for (let seed = 0; seed < 6; seed += 1) {
        const plan = generatePlan({ ...DEFAULT_ANSWERS, ...p, days: 10 } as Answers, cat, { seed });
        for (const d of plan) {
          const cards = SLOTS.flatMap((s) => d[s]);
          expect(cards.length).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('still allows a meal as the third card', () => {
    // The ceiling must BOUND the en-route food pass, not delete it. Written
    // deliberately as the counterweight to the test above, and it earned its
    // place immediately: the first attempt at the ceiling blocked the lunch
    // stop outright and this caught it.
    //
    // Swept across personas on purpose. The default persona alone returns 0 on
    // the stub — the south-coast drive it needs is not in its themes — so a
    // single-persona version of this assertion would have failed for a reason
    // that has nothing to do with the rule. On the live catalog the stop lands
    // on 17 of 300 days (29 before the ceiling).
    const cat = getCatalog();
    let daysWithAMeal = 0;
    for (const p of PERSONAS) {
      for (let seed = 0; seed < 6; seed += 1) {
        const plan = generatePlan({ ...DEFAULT_ANSWERS, ...p, days: 10 } as Answers, cat, { seed });
        for (const d of plan) {
          const cards = SLOTS.flatMap((s) => d[s]);
          if (cards.some((e) => e.kind === 'activity' && isLunchspot(e.id))) daysWithAMeal += 1;
        }
      }
    }
    expect(daysWithAMeal).toBeGreaterThan(0);
  });
});

describe('generatePlan — day shape: two activities, one meal', () => {
  // A plan that leaves room is worth more than one that fills every slot — the
  // traveller still has favourites to drop in. Reported: a day carrying a
  // morning sail, Boca Grandi, Zeerover AND an evening card.
  const mkGroup = (id: string): ViatorGroup => ({
    id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  const mk = (id: string, title: string, tags: number[], evening = false): ViatorItem => ({
    id, group_id: `g-${id}`, title: evening ? `${title} at Sunset` : title,
    image_url: '', price_usd: 60, duration: '2 hrs', rating: 4.6, review_count: 200,
    viator_item_url: '', is_best_seller: true, display_order: 0, tags, experience_cluster_id: `c-${id}`,
  });
  const items: ViatorItem[] = [];
  for (let n = 0; n < 24; n += 1) items.push(mk(`day-${n}`, `Island Experience ${n}`, [80000 + n]));
  for (let n = 0; n < 12; n += 1) items.push(mk(`eve-${n}`, `Evening Outing ${n}`, [70000 + n], true));
  const cat: Catalog = { activities: [], groups: items.map((i) => mkGroup(i.group_id)), items };

  it('never puts more than two activities on one day', () => {
    for (const days of [7, 14]) {
      const plan = generatePlan({ ...DEFAULT_ANSWERS, days }, cat);
      for (const d of plan) {
        expect([...d.morning, ...d.afternoon, ...d.evening].length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('never puts more than three NON-MEAL cards on one day, on any catalog', () => {
    // The ceiling that makes the free-beach exemption safe: without it a day
    // could stack beach + beach + outing + outing.
    //
    // HISTORICAL NOTE, kept because the rationale used to live here and is now
    // wrong: this counted non-meal cards because the meal was "on the side", so
    // a day could legitimately show two outings, a free beach AND a lunch stop.
    // That exemption was removed on 2026-08-12 — the meal counts, three cards
    // total — and the cost the exemption existed to avoid is now paid: a full
    // south-coast day can no longer pick up Zeerover or O'Neil's. See the
    // 'three cards a day, meal included' block above, whose `<= 3` assertion
    // strictly subsumes this one. This test survives as the narrower statement
    // about the beach exemption specifically.
    const isMeal = (e: SlotEntry) => e.kind === 'activity'
      && (e.id.startsWith('lunch-') || e.id === 'zeerovers-fresh-catch' || e.id === 'gasparito-restaurant');
    for (const days of [1, 5, 7, 10, 14]) {
      for (let seed = 0; seed < 4; seed += 1) {
        for (const c of [cat, getCatalog()]) {
          const plan = generatePlan({ ...DEFAULT_ANSWERS, days }, c, { seed });
          for (const d of plan) {
            const cards = [...d.morning, ...d.afternoon, ...d.evening];
            expect(cards.filter((e) => !isMeal(e)).length).toBeLessThanOrEqual(3);
            expect(cards.filter(isMeal).length).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('leaves the evening open rather than making a third outing of it', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 7 }, cat);
    const full = plan.filter((d) => d.morning.length > 0 && d.afternoon.length > 0);
    expect(full.length).toBeGreaterThan(0);
    for (const d of full) expect(d.evening).toHaveLength(0);
  });
});

describe('generatePlan — a staple falls through to another product, and no day is blank', () => {
  const mkGroup = (id: string): ViatorGroup => ({
    id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  const mk = (id: string, title: string, tags: number[], reviews: number): ViatorItem => ({
    id, group_id: `g-${id}`, title, image_url: '', price_usd: 90, duration: '3 hrs',
    rating: 4.8, review_count: reviews, viator_item_url: '', is_best_seller: true,
    display_order: 0, tags, experience_cluster_id: `c-${id}`,
  });

  it('places the afternoon sail when the top-reviewed sail is morning-only and mornings are blocked', () => {
    // A morning-titled catamaran has NO valid day for a traveller who ticked
    // "no early mornings", and resolveStaples picks one product. Without a
    // fall-through the trip lost its only boat trip entirely rather than taking
    // the afternoon sailing sitting right behind it in the same pool.
    const items = [
      mk('am-sail', 'Premium Catamaran Morning Sail: Snorkeling and Brunch', [11888, 1], 714),
      mk('pm-sail', 'Premium Catamaran Afternoon Sail: Snorkeling and Lunch', [11888, 2], 621),
    ];
    for (let n = 0; n < 16; n += 1) items.push(mk(`pad-${n}`, `Beach Walk ${n}`, [90000 + n], 50));
    const cat: Catalog = { activities: [], groups: items.map((i) => mkGroup(i.group_id)), items };
    for (let seed = 0; seed < 4; seed += 1) {
      const ids = entryIds(generatePlan(
        { ...DEFAULT_ANSWERS, days: 5, flags: ['no-early-mornings'] }, cat, { seed },
      ));
      expect(ids.some((id) => id === 'pm-sail' || id === 'am-sail'), `seed ${seed}`).toBe(true);
    }
  });

  it('never renders a day with nothing on it at all', () => {
    // A day may be thin — that is the two-outing shape working — but three empty
    // drop zones and no content is a broken page. Reachable on a DEPARTURE day
    // for a no-early-mornings traveller: morning flag-blocked, afternoon held
    // open for pacing, evening pool exhausted.
    // Deep enough that an empty day means the RULE failed, not that the pool ran
    // dry — a 10-day trip can seat 20 outings, so a 10-item catalog would go
    // blank on merit and prove nothing.
    const items = [];
    for (let n = 0; n < 30; n += 1) items.push(mk(`day-${n}`, `Island Experience ${n}`, [80000 + n], 200));
    // Free content, because day 1 is the arrival day and takes no paid tours.
    // The live catalog always has free local beaches; a fixture without any
    // leaves day 1 legitimately empty and would be testing the wrong thing.
    for (let n = 0; n < 20; n += 1) {
      items.push({ ...mk(`free-${n}`, `Beach Stroll ${n}`, [70000 + n], 120), price_usd: 0 });
    }
    const cat: Catalog = { activities: [], groups: items.map((i) => mkGroup(i.group_id)), items };
    for (const days of [3, 5, 7, 10]) {
      for (const flags of [[], ['no-early-mornings']]) {
        for (let seed = 0; seed < 3; seed += 1) {
          const plan = generatePlan({ ...DEFAULT_ANSWERS, days, flags }, cat, { seed });
          plan.forEach((d, i) => {
            const n = d.morning.length + d.afternoon.length + d.evening.length;
            expect(n, `${days}d flags=${flags} seed ${seed} day ${i + 1}`).toBeGreaterThan(0);
          });
        }
      }
    }
  });
});

describe('generatePlan — a splurge traveller gets the premium experience, not the staple', () => {
  // Someone who put the budget slider on "money no object" wants the yacht. With
  // one daytime sail per trip, whichever pre-pass runs first owns that slot — so
  // the premium pass runs BEFORE the staples, and the catamaran staple stands
  // down rather than making it two sailing days. Run the other way round, every
  // splurge trip came back with the same fallback island tour and no yacht.
  const mkGroup = (id: string): ViatorGroup => ({
    id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  const mk = (id: string, title: string, price: number, tags: number[], reviews = 200): ViatorItem => ({
    id, group_id: `g-${id}`, title, image_url: '', price_usd: price, duration: '3 hrs',
    rating: 4.8, review_count: reviews, viator_item_url: '', is_best_seller: true,
    display_order: 0, tags, experience_cluster_id: `c-${id}`,
  });
  const items = [
    mk('yacht', 'Luxury Private Yacht Charter Aruba', 2300, [11888, 1, 2], 226),
    // Far more reviewed, so it wins the staple slot on merit — and must still
    // yield the sail to the yacht for this traveller.
    mk('catamaran', 'Premium Catamaran Sail: Snorkeling and Lunch', 120, [11888, 5, 6], 2600),
  ];
  for (let n = 0; n < 16; n += 1) items.push(mk(`pad-${n}`, `Beach Walk ${n}`, 0, [90000 + n], 50));
  const cat: Catalog = { activities: [], groups: items.map((i) => mkGroup(i.group_id)), items };

  it('places the yacht charter for a money-no-object traveller', () => {
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 7, budget: 'Money no object' }, cat));
    expect(ids).toContain('yacht');
  });

  it('does not also place the catamaran — a trip still gets one sail', () => {
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 7, budget: 'Money no object' }, cat));
    expect(ids.filter((id) => id === 'yacht' || id === 'catamaran')).toHaveLength(1);
  });

  it('leaves a mid-range traveller with the catamaran and no yacht (over budget)', () => {
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 7, budget: 'Mid-range' }, cat));
    expect(ids).toContain('catamaran');
    expect(ids).not.toContain('yacht');
  });
});

describe('generatePlan — a pinned time-of-day product always lands', () => {
  // Pinning a product to the slot its title names must never make it
  // unplaceable. On a 2-day trip BOTH afternoons are held open for
  // arrival/departure, so an "Afternoon" pin had no slot at all and was dropped
  // silently — no card, no badge, an explicit shortlist choice simply gone.
  const group: ViatorGroup = {
    id: 'sail-g', name: 'sail-g', tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  };
  const pm: ViatorItem = {
    id: 'pm-sail', group_id: 'sail-g', title: 'Aruba Jolly Pirate Afternoon Sail with Snorkeling',
    image_url: '', price_usd: 89, duration: '3 hrs', rating: 4.7, review_count: 528,
    viator_item_url: '', is_best_seller: true, display_order: 0, tags: [11888], experience_cluster_id: 'pm-c',
  };
  const am: ViatorItem = { ...pm, id: 'am-sail', title: 'Premium Catamaran Morning Sail: Snorkeling and Brunch', experience_cluster_id: 'am-c' };
  const cat: Catalog = { activities: [], groups: [group], items: [pm, am] };

  it('places an "Afternoon" pin on a 2-day trip, where both afternoons are held open', () => {
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 2 }, cat, { pinned: ['item:pm-sail'] }));
    expect(ids).toContain('pm-sail');
  });

  it('places a "Morning" pin for a traveller who asked for no early mornings', () => {
    const ids = entryIds(generatePlan(
      { ...DEFAULT_ANSWERS, days: 7, flags: ['no-early-mornings'] }, cat, { pinned: ['item:am-sail'] },
    ));
    expect(ids).toContain('am-sail');
  });

  it('still puts it in the slot its title names when that slot is available', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 7 }, cat, { pinned: ['item:pm-sail'] });
    const day = plan.find((d) => [...d.morning, ...d.afternoon].some((e) => e.kind === 'group' && e.bestSellerId === 'pm-sail'));
    expect(day).toBeDefined();
    expect(day!.afternoon.some((e) => e.kind === 'group' && e.bestSellerId === 'pm-sail')).toBe(true);
  });
});

describe('generatePlan — an Arikok day keeps its afternoon free', () => {
  // Driving across the island into the park is the day. The 8h Island Jeep
  // Safari already blocked the afternoon by overrunning its slot; the 4h
  // Natural Pool tours did not, and those produced the four-card days.
  const mkGroup = (id: string): ViatorGroup => ({
    id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  const mk = (id: string, title: string, duration: string, tags: number[]): ViatorItem => ({
    id, group_id: `g-${id}`, title, image_url: '', price_usd: 90, duration,
    rating: 4.8, review_count: 400, viator_item_url: '', is_best_seller: true,
    display_order: 0, tags, experience_cluster_id: `c-${id}`,
  });
  // 4 hrs — fits a morning with afternoon time to spare, so only the Arikok
  // rule can clear the afternoon here.
  const items = [mk('arikok', 'Aruba Natural Pool and Indian Cave Rugged Jeep Safari', '4 hrs', [12035])];
  for (let n = 0; n < 20; n += 1) items.push(mk(`filler-${n}`, `Beach Walk ${n}`, '1 hr', [90000 + n]));
  const cat: Catalog = { activities: [], groups: items.map((i) => mkGroup(i.group_id)), items };

  it('places nothing else in the daytime once the Natural Pool tour is in', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 8, interests: ['adventure'] }, cat);
    const day = plan.find((d) => d.morning.some((e) => e.kind === 'group' && e.bestSellerId === 'arikok'));
    expect(day).toBeDefined();
    expect(day!.afternoon).toHaveLength(0);
  });

  it('keeps the afternoon free for a balanced traveller, whose Arikok day is curated', () => {
    // The reported case came from the balanced template (med-adventure +
    // mid-range), which hand-places natural-pool-jeep on day 4. The template
    // paired it with arashi-beach, and the staple/splurge pre-passes would
    // happily refill the slot once that was removed — none of them go through
    // the fill ladder, so each needed the rule applied separately.
    const balanced: Answers = {
      ...DEFAULT_ANSWERS, days: 10, budget: 'Mid-range', adventureLevel: 50,
      interests: ['Beach & chill', 'Watersports'],
    };
    for (let seed = 0; seed < 4; seed += 1) {
      const plan = generatePlan(balanced, getCatalog(), { seed });
      for (const d of plan) {
        const arikokMorning = d.morning.some((e) => e.kind === 'activity'
          && (e.id === 'natural-pool-jeep' || e.id === 'arikok-hiking'));
        if (!arikokMorning) continue;
        // A food stop is still allowed — you drive past Zeerover on the way home.
        const nonFood = d.afternoon.filter((e) => !(e.kind === 'activity'
          && (e.id.startsWith('lunch-') || e.id === 'zeerovers-fresh-catch')));
        expect(nonFood).toHaveLength(0);
      }
    }
  });
});

describe('generatePlan — the premium splurge survives a claimed route family', () => {
  // The splurge pre-pass honours the trip-wide route families, so its top
  // candidate can be rejected (the catamaran staple always claims 'sail'
  // first). It must then fall through to the next-best premium experience
  // rather than placing nothing: `ranked` was briefly truncated to maxPremium
  // BEFORE that check, and because the live feed has only 6 Viator groups a
  // 7-day trip considered exactly one candidate — splurges went 90/90 trips to
  // 0/90 with no test noticing.
  const mkGroup = (id: string): ViatorGroup => ({
    id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  const mk = (id: string, title: string, price: number, tags: number[]): ViatorItem => ({
    id, group_id: `g-${id}`, title, image_url: '', price_usd: price, duration: '3 hrs',
    rating: 4.8, review_count: 200, viator_item_url: '', is_best_seller: true,
    display_order: 0, tags, experience_cluster_id: `c-${id}`,
  });
  // The yacht scores highest (a snorkel-kind crowd-pleaser, so it is in the
  // sail family) but is NOT eligible for the catamaran staple, whose
  // itemMatch requires kind 'sail' exactly. That leaves the catamaran as the
  // only staple candidate, so it deterministically claims 'sail' before the
  // premium pass runs — which is what makes this test discriminate.
  const items = [
    mk('yacht', 'Luxury Private Yacht Charter Aruba', 2300, [11912, 1, 2]),
    mk('bus', 'Aruba Private Island Tour by Air-Conditioned Bus', 900, [70, 71, 72]),
    mk('catamaran', 'Premium Catamaran Afternoon Sail: Snorkeling and Lunch', 120, [11888, 5, 6]),
  ];
  for (let n = 0; n < 16; n += 1) items.push(mk(`pad-${n}`, `Beach Walk ${n}`, 0, [90000 + n]));
  const cat: Catalog = { activities: [], groups: items.map((i) => mkGroup(i.group_id)), items };

  it('falls through to the next premium pick when the top one\'s family is claimed', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 7, budget: 'Money no object' }, cat);
    const splurges = plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening])
      .filter((e) => e.kind === 'group' && e.splurge);
    expect(splurges.length).toBeGreaterThanOrEqual(1);
  });
});

describe('generatePlan — a day pass consumes the whole daytime', () => {
  // "Aruba De Palm Island Day Pass" reports 6 hrs, which the slot maths reads as
  // a long morning that still leaves 120 minutes of the afternoon — so the
  // engine booked a second activity after it. You ferry to an island; the day is
  // gone. Treated as a full day (420 min), the existing overrun rule blocks the
  // afternoon on its own.
  const mk = (id: string, title: string, duration: string, tags: number[]): ViatorItem => ({
    id, group_id: `g-${id}`, title, image_url: '', price_usd: 100, duration,
    rating: 4.5, review_count: 300, viator_item_url: '', is_best_seller: true,
    display_order: 0, tags, experience_cluster_id: `c-${id}`,
  });
  const mkGroup = (id: string): ViatorGroup => ({
    id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  // 30-minute fillers, deliberately: at the reported 6 hrs the day pass leaves
  // 60 minutes of the 8h cap, so only a very short product can follow it — and
  // the live catalog has several (the 30-min clear-kayak listings). With 2-hour
  // fillers this test would pass without the rule and prove nothing.
  const items = [mk('daypass', 'Aruba De Palm Island Day Pass', '6 hrs', [11912, 12043])];
  for (let n = 0; n < 20; n += 1) items.push(mk(`filler-${n}`, `Beach Walk ${n}`, '30 min', [90000 + n]));
  // Evening-suitable fillers. Without these the day pass's evening could never
  // be tested at all — isEveningItem reads the TITLE, so a "Beach Walk" is
  // never an evening candidate and the assertion below would pass vacuously.
  for (let n = 0; n < 10; n += 1) items.push(mk(`eve-${n}`, `Sunset Stroll ${n}`, '90 min', [91000 + n]));
  const cat: Catalog = { activities: [], groups: items.map((i) => mkGroup(i.group_id)), items };

  it('leaves the rest of the daytime free on the day it is placed', () => {
    // Family group type: the day pass is kids-gated (see isKidsOriented).
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with young kids' }, cat);
    const day = plan.find((d) => [...d.morning, ...d.afternoon].some((e) => e.kind === 'group' && e.bestSellerId === 'daypass'));
    expect(day).toBeDefined();
    expect([...day!.morning, ...day!.afternoon]).toHaveLength(1);
  });

  it('leaves the EVENING free too — the pass is the only card on its day', () => {
    // Reported from production 2026-08-12: the day pass came back with two other
    // cards on the same day. The daytime rule above was doing its job; the
    // evening is a SEPARATE 240-minute budget that never consults dayMin, so
    // FULL_DAY_MIN could not reach it and an evening card slipped in every time.
    // Measured on the live catalog before the fix: 6 of 6 day-pass days carried
    // an evening card.
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with young kids' }, cat);
    const day = plan.find((d) => [...d.morning, ...d.afternoon, ...d.evening]
      .some((e) => e.kind === 'group' && e.bestSellerId === 'daypass'));
    expect(day).toBeDefined();
    expect([...day!.morning, ...day!.afternoon, ...day!.evening]).toHaveLength(1);
  });

  it('is not placed on a day whose EVENING is already reserved', () => {
    // The other direction, and it needs a specific setup to reach at all —
    // which is why the version of this test written on 2026-08-12 did not.
    // That one ran the same plain 10-day plan as the two tests above and
    // asserted the same thing, so it died to the same mutation and the reverse
    // gate stayed unverified.
    //
    // In the DAYTIME the reverse direction is already covered by arithmetic:
    // entryDurationMin inflates a pass to FULL_DAY_MIN (420), so on a day that
    // has any other card the 480-minute cap blocks it without needing a rule.
    // The gate only earns its place when the day's other card is in the
    // EVENING, because the evening has its own 240-minute budget that never
    // consults dayMin.
    //
    // `ahead` (reservedAhead) is what makes that visible from the morning: it
    // counts what the day has already promised to LATER slots. So pinning an
    // evening item on day 2 means the day-2 morning pick can see it. Verified
    // by mutation — deleting the gate puts the pass on day 2 beside eve-1:
    //   with     day 2: m[filler-0] e[eve-1]   day 3: m[daypass]
    //   without  day 2: m[daypass]  e[eve-1]   day 3: m[filler-1] e[eve-4]
    for (let seed = 0; seed < 6; seed += 1) {
      const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 3, groupType: 'Family with young kids' }, cat,
        { pinned: ['item:eve-0', 'item:eve-1'], seed });
      const day = plan.find((d) => [...d.morning, ...d.afternoon, ...d.evening]
        .some((e) => e.kind === 'group' && e.bestSellerId === 'daypass'));
      expect(day).toBeDefined();
      expect([...day!.morning, ...day!.afternoon, ...day!.evening]).toHaveLength(1);
    }
  });

  it('the balanced template does not add a card to a PINNED pass\'s day', () => {
    // The gap the day-pass fix left open. `fitsDayShape` guards the premium and
    // staple pre-passes, but the balanced-template pre-pass runs before it is
    // even declared and checks `templateAvail`, which asks only whether the
    // SLOT is claimed — never whether the DAY already holds a pass. So a pinned
    // pass takes day 1 morning and the template drops eagle-beach into day 1
    // afternoon beside it.
    //
    // Reachable only through `opts.pinned`, which nothing passes today — the
    // shortlist was unwired from it on 2026-08-05. This is therefore a test for
    // a path that is dormant, written now because the shortlist is expected to
    // be rewired and this bug reopens the moment it is.
    //
    // Needs the REAL local activities: resolveBalancedTemplate looks its entries
    // up in `catalog.activities`, and the fixture above has none, so the
    // template would silently resolve to nothing and the test would pass
    // vacuously. Balanced persona = mid slider AND Mid-range (isBalancedTraveller).
    const base = getCatalog();
    const pass = mk('zz-daypass', 'Aruba De Palm Island Day Pass', '6 hrs', [11912, 12043]);
    const cat2: Catalog = {
      ...base,
      groups: [...base.groups, mkGroup('g-zz-daypass')],
      items: [...base.items, pass],
    };
    const answers: Answers = {
      ...DEFAULT_ANSWERS, days: 10, adventureLevel: 50, budget: 'Mid-range',
      groupType: 'Family with young kids',
    };
    for (let seed = 0; seed < 8; seed += 1) {
      const plan = generatePlan(answers, cat2, { pinned: ['item:zz-daypass'], seed });
      const day = plan.find((d) => [...d.morning, ...d.afternoon, ...d.evening]
        .some((e) => e.kind === 'group' && e.bestSellerId === 'zz-daypass'));
      expect(day).toBeDefined();
      const cards = [...day!.morning, ...day!.afternoon, ...day!.evening];
      expect(cards).toHaveLength(1);
    }
  });
});

describe('generatePlan — kids-oriented products need a group with children', () => {
  // A water-park day pass is not a thing to hand a couple unasked. Auto-fill
  // only: it stays in Explore and a pinned one still places (see isKidsOriented).
  const mkPad = (n: number): { g: ViatorGroup; i: ViatorItem } => ({
    g: { id: `pad-${n}`, name: `pad-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n + 5, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const },
    i: { id: `pad-item-${n}`, group_id: `pad-${n}`, title: `Beach ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.0, review_count: 50,
      viator_item_url: '', is_best_seller: true, display_order: 0, tags: [90000 + n], experience_cluster_id: `pad-c-${n}` },
  });
  const pads = Array.from({ length: 12 }, (_, n) => mkPad(n));
  const cat: Catalog = {
    activities: [],
    groups: [
      { id: 'wp', name: 'wp', tagline: '', viator_taxonomy: '', viator_group_url: '',
        display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const },
      ...pads.map((p) => p.g),
    ],
    items: [
      { id: 'daypass', group_id: 'wp', title: 'Aruba De Palm Island Day Pass',
        image_url: '', price_usd: 135, duration: '6 hrs', rating: 4.2, review_count: 370,
        viator_item_url: '', is_best_seller: true, display_order: 0,
        tags: [11912, 12043], experience_cluster_id: 'wp-c' },
      ...pads.map((p) => p.i),
    ],
  };

  it('never auto-places the water-park day pass for a couple', () => {
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 10, groupType: 'Couple' }, cat));
    expect(ids).not.toContain('daypass');
  });

  it('never auto-places it when no group type was answered', () => {
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 10, groupType: '' }, cat));
    expect(ids).not.toContain('daypass');
  });

  it('does place it for a family with young kids', () => {
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with young kids' }, cat));
    expect(ids).toContain('daypass');
  });

  it('does place it for a family with teens', () => {
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with teens' }, cat));
    expect(ids).toContain('daypass');
  });

  it('still places it for a family whose trip already has a catamaran sail', () => {
    // The day pass carries Viator's snorkelling tag (11912), so activityKind
    // calls it 'snorkel' — which briefly put it in the one-per-trip sail
    // family, and the catamaran staple then retired it from every plan. An
    // island day pass is a destination, not a boat trip.
    const sailGroup: ViatorGroup = {
      id: 'sail-g', name: 'sail-g', tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    };
    const sailItem: ViatorItem = {
      id: 'catamaran', group_id: 'sail-g', title: 'Premium Catamaran Afternoon Sail: Snorkeling and Lunch',
      image_url: '', price_usd: 120, duration: '3 hrs', rating: 4.8, review_count: 600,
      viator_item_url: '', is_best_seller: true, display_order: 0,
      tags: [11888, 51, 52, 53], experience_cluster_id: 'cat-c',
    };
    const withSail: Catalog = {
      ...cat, groups: [...cat.groups, sailGroup], items: [...cat.items, sailItem],
    };
    const ids = entryIds(generatePlan({ ...DEFAULT_ANSWERS, days: 10, groupType: 'Family with young kids' }, withSail));
    expect(ids).toContain('catamaran');
    expect(ids).toContain('daypass');
  });
});

describe('generatePlan — day-level geographic clustering', () => {
  // Two Viator groups ~15 km apart (Palm Beach watersports vs Arikok adventure-tours),
  // each with many distinct-cluster, tag-less, single-section items. coordOf resolves
  // each item to its own researched coordinate now, so intra-day distance reflects
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
    pinFor(e.kind === 'activity' ? e.id : e.bestSellerId)?.coord;

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
      expectNoIllegalRepeats(generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, cat, { seed }), cat);
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
      expectNoIllegalRepeats(plan, cat);
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
        expectNoIllegalRepeats(generatePlan(
          { ...DEFAULT_ANSWERS, days, budget: 'Money no object' }, cat, { seed },
        ), cat);
      }
    }
  });
});

describe('route families outside the generator (swap / add paths)', () => {
  // The one-sail rule lived only inside generatePlan. Measured on the live
  // catalog: the engine produced two Viator sails in 0 of 1,728 plans, and the
  // card renderer in 0 of 1,728 — yet travellers saw two. Every path that edits
  // a plan AFTER generation ran in the UI with no way to ask which families
  // were spoken for, and "Swap this" excludes candidates by item id and GROUP
  // id while the sail family deliberately spans groups. That is the exact case
  // the family was invented for: two catamarans that activityKind classifies
  // differently.
  const mkGroup = (id: string): ViatorGroup => ({
    id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
  });
  const mkItem = (id: string, title: string, tags: number[]): ViatorItem => ({
    id, group_id: `g-${id}`, title, image_url: '', price_usd: 90, duration: '3 hrs',
    rating: 4.7, review_count: 300, viator_item_url: '', is_best_seller: true,
    display_order: 0, tags, experience_cluster_id: `c-${id}`,
  });
  const SAIL = 11888, OFFROAD = 12035;
  const sailA = mkItem('sail-a', 'Premium Catamaran Afternoon Sail', [SAIL, 1]);
  const sailB = mkItem('sail-b', 'Aruba Sunset Sail with Open Bar', [SAIL, 2]);
  const jeep = mkItem('jeep', 'Arikok Jeep Safari', [OFFROAD, 3]);
  const entry = (i: ViatorItem): CardEntry => ({ kind: 'group', group: mkGroup(i.group_id), bestSeller: i, others: [] });
  const slotEntryOf = (i: ViatorItem): SlotEntry => ({ kind: 'group', groupId: i.group_id, bestSellerId: i.id });
  const resolve = (e: SlotEntry): CardEntry | null => {
    if (e.kind !== 'group') return null;
    const i = [sailA, sailB, jeep].find((x) => x.id === e.bestSellerId);
    return i ? entry(i) : null;
  };

  it('reports the families a plan has already used', () => {
    const cards = [{ uid: 'u1', entry: slotEntryOf(sailA) }, { uid: 'u2', entry: slotEntryOf(jeep) }];
    expect(claimedRouteFamilies(cards, resolve)).toEqual(new Set(['sail', 'offroad']));
  });

  it('ignores the card being swapped, so a sail can be swapped for another sail', () => {
    // Without skipUid the card would claim its own family and every replacement
    // sail would be filtered out — the swap button would refuse to work on the
    // one card type this rule is about.
    const cards = [{ uid: 'u1', entry: slotEntryOf(sailA) }, { uid: 'u2', entry: slotEntryOf(jeep) }];
    const claimed = claimedRouteFamilies(cards, resolve, 'u1');
    expect(claimed).toEqual(new Set(['offroad']));
    expect(withoutClaimedFamilies([entry(sailB)], claimed)).toHaveLength(1);
  });

  it('drops a replacement whose family the trip already has, ACROSS groups', () => {
    // sail-a and sail-b sit in different groups, so every exclusion the swap
    // pool already does (item id, group id) waves sail-b through.
    const cards = [{ uid: 'u1', entry: slotEntryOf(sailA) }, { uid: 'u2', entry: slotEntryOf(jeep) }];
    const claimed = claimedRouteFamilies(cards, resolve, 'u2');   // swapping the JEEP
    const pool = withoutClaimedFamilies([entry(sailB), entry(jeep)], claimed);
    expect(pool.map((c) => (c.kind === 'group' ? c.bestSeller.id : ''))).toEqual(['jeep']);
  });

  it('a card with no family claims nothing', () => {
    // Most of the catalog has no route family at all — a museum, a food tour, a
    // beach. If those claimed some catch-all bucket, the first one placed would
    // block every other familyless card from every swap for the rest of the trip.
    const museum = mkItem('museum', 'Aruba Historical Museum', [999]);
    const resolve2 = (e: SlotEntry): CardEntry | null =>
      (e.kind === 'group' && e.bestSellerId === 'museum') ? entry(museum) : resolve(e);
    const claimed = claimedRouteFamilies([{ uid: 'u1', entry: slotEntryOf(museum) }], resolve2);
    expect(claimed.size).toBe(0);
  });

  it('leaves a familyless candidate alone', () => {
    const museum = mkItem('museum', 'Aruba Historical Museum', [999]);
    const claimed = new Set(['sail']);
    expect(withoutClaimedFamilies([entry(museum)], claimed)).toHaveLength(1);
  });

  it('does not let an unresolvable card unlock a duplicate', () => {
    // A card whose product left the catalog resolves to null. Treating that as
    // "no family" would quietly re-allow the sail it used to be.
    const cards = [{ uid: 'u1', entry: { kind: 'group', groupId: 'gone', bestSellerId: 'gone' } as SlotEntry }];
    expect(claimedRouteFamilies(cards, resolve)).toEqual(new Set());
  });
});
