import { describe, it, expect } from 'vitest';
import { generatePlan } from './itineraryGenerator';
import { getCatalog } from './activitySource';
import { DEFAULT_ANSWERS } from '../App';
import type { Answers } from '../App';
import type { Activity, Day } from './activities';
import type { Catalog } from './activitySource';
import type { MatchTag, ViatorGroup, ViatorItem } from '../types';

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
  it('fills morning + evening every day (no pool-exhaustion gaps), with open afternoons on arrival/departure', () => {
    const plan = generatePlan({ ...DEFAULT_ANSWERS, days: 14 }, catalog);
    plan.forEach((d, i) => {
      expect(d.morning.length).toBeGreaterThanOrEqual(1);
      expect(d.evening.length).toBeGreaterThanOrEqual(1);
      const isArrivalOrDeparture = i === 0 || i === plan.length - 1;
      if (isArrivalOrDeparture) {
        // Intentionally open — restores the "Drop an activity here" zone.
        expect(d.afternoon.length).toBe(0);
      } else {
        expect(d.afternoon.length).toBeGreaterThanOrEqual(1);
      }
    });
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
