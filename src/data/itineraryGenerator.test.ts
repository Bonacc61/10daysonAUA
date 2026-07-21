import { describe, it, expect } from 'vitest';
import { generatePlan } from './itineraryGenerator';
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
        price_usd: 100, duration: '', rating: 4.5, review_count: 1,
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
      image_url: '', price_usd: 0, duration: '', rating: 4.6, review_count: 100,
      viator_item_url: '', is_best_seller: true, display_order: 0, sections: ['food-drink' as const],
    }));
    const dayGroups: ViatorGroup[] = Array.from({ length: 20 }, (_, n) => ({
      id: `day-${n}`, name: `day-${n}`, tagline: '', viator_taxonomy: '', viator_group_url: '',
      display_order: n, matched_by: [] as MatchTag[], region: 'islandwide' as const, allowed_slots: [] as const,
    }));
    const dayItems: ViatorItem[] = dayGroups.map((g, n) => ({
      id: `dayitem-${n}`, group_id: g.id, title: `Beach Day ${n}`,
      image_url: '', price_usd: 0, duration: '', rating: 4.6, review_count: 100,
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

  it('keeps a single-day trip full (no arrival/departure split)', () => {
    const [d] = generatePlan({ ...DEFAULT_ANSWERS, days: 1 }, catalog);
    expect(d.morning.length).toBeGreaterThanOrEqual(1);
    expect(d.afternoon.length).toBeGreaterThanOrEqual(1);
    expect(d.evening.length).toBeGreaterThanOrEqual(1);
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

describe('generatePlan — day-level geographic clustering', () => {
  const cat = getCatalog();
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
    // With the geo penalty the average intra-day spread is ~9.6km; without it
    // ~12.3km. 11km is a stable guard that fails if clustering is removed/broken.
    expect(sum / cnt).toBeLessThan(11);
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
