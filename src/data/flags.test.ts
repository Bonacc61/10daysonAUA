import { describe, it, expect } from 'vitest';
import { generatePlan } from './itineraryGenerator';
import { answersToTags } from './answerTags';
import { getCatalog } from './activitySource';
import { DEFAULT_ANSWERS } from '../App';
import type { Activity, Day } from './activities';
import type { Catalog } from './activitySource';
import type { MatchTag, ViatorGroup, ViatorItem, SlotEntry } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function act(id: string, override: Partial<Activity> = {}): Activity {
  return {
    id, title: id, category: 'Activities', image: '',
    description: '', localsSay: '', cost: 'Free', duration: '2 hrs',
    timeOfDay: 'Afternoon', fitReason: '', location: 'Palm Beach',
    rating: 4.5, reviewCount: 10, adventure: 20,
    sections: ['beaches'], matched_by: [],
    ...override,
  };
}

function grp(id: string, tags: MatchTag[], override: Partial<ViatorGroup> = {}): ViatorGroup {
  return {
    id, name: id, tagline: '', viator_taxonomy: '', viator_group_url: '',
    display_order: 0, matched_by: tags, region: 'islandwide', allowed_slots: [],
    ...override,
  };
}

function bestItem(groupId: string): ViatorItem {
  return {
    id: `${groupId}-best`, group_id: groupId, title: groupId,
    image_url: '', price_usd: 50, duration: '2 hrs',
    rating: 4.5, review_count: 100, viator_item_url: '',
    is_best_seller: true, display_order: 0,
  };
}

// Filler activities for each time slot so unrelated slots fill normally.
function fillerPool(): Activity[] {
  const slots: Array<[Activity['timeOfDay'], string]> = [
    ['Morning', 'morning'], ['Afternoon', 'afternoon'], ['Evening', 'evening'],
  ];
  return slots.flatMap(([tod, key]) =>
    Array.from({ length: 8 }, (_, i) =>
      act(`filler-${key}-${i}`, { timeOfDay: tod, adventure: 10, sections: ['beaches'] }),
    ),
  );
}

// Flat list of SlotEntry from the whole plan.
function allEntries(plan: Day[]): SlotEntry[] {
  return plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]);
}

function activityIds(plan: Day[]): string[] {
  return allEntries(plan).filter((e) => e.kind === 'activity').map((e) => (e as { kind: 'activity'; id: string }).id);
}

function groupIds(plan: Day[]): string[] {
  return allEntries(plan).filter((e) => e.kind === 'group').map((e) => (e as { kind: 'group'; groupId: string }).groupId);
}

// Run generatePlan across N seeds and collect all activity/group ids seen.
function sweepSeeds(answers: Parameters<typeof generatePlan>[0], catalog: Catalog, n = 8) {
  const seen = { actIds: new Set<string>(), grpIds: new Set<string>() };
  for (let s = 0; s < n; s += 1) {
    const plan = generatePlan(answers, catalog, { seed: s });
    activityIds(plan).forEach((id) => seen.actIds.add(id));
    groupIds(plan).forEach((id) => seen.grpIds.add(id));
  }
  return seen;
}

const BASE: Parameters<typeof generatePlan>[0] = { ...DEFAULT_ANSWERS, days: 5 };

// ---------------------------------------------------------------------------
// answersToTags — flag effects on the tag set
// ---------------------------------------------------------------------------

describe('answersToTags — flag effects', () => {
  it('honeymoon adds the couple tag for a couple', () => {
    const tags = answersToTags({ ...DEFAULT_ANSWERS, flags: ['honeymoon'], groupType: 'Couple' });
    expect(tags.has('couple')).toBe(true);
  });

  // honeymoon is offered to couples only, so the flag stored against any other group
  // is stale — effectiveFlags() drops it before tag derivation, and it must not
  // retag the trip as a couple's.
  it('a stale honeymoon flag does not retag a non-couple trip', () => {
    const solo = answersToTags({ ...DEFAULT_ANSWERS, flags: ['honeymoon'], groupType: 'Solo' });
    expect(solo.has('couple')).toBe(false);

    const friends = answersToTags({ ...DEFAULT_ANSWERS, flags: ['honeymoon'], groupType: 'Friends' });
    expect(friends.has('couple')).toBe(false);
    expect(friends.has('friends')).toBe(true);
  });

  it('mobility forces low-adventure even at the highest adventureLevel', () => {
    const tags = answersToTags({ ...DEFAULT_ANSWERS, adventureLevel: 100, flags: ['mobility'] });
    expect(tags.has('low-adventure')).toBe(true);
    expect(tags.has('med-adventure')).toBe(false);
    expect(tags.has('high-adventure')).toBe(false);
  });

  it('mobility at a low adventureLevel still produces low-adventure', () => {
    const tags = answersToTags({ ...DEFAULT_ANSWERS, adventureLevel: 10, flags: ['mobility'] });
    expect(tags.has('low-adventure')).toBe(true);
  });

  it('no flags — adventureLevel 80 → high-adventure', () => {
    const tags = answersToTags({ ...DEFAULT_ANSWERS, adventureLevel: 80, flags: [] });
    expect(tags.has('high-adventure')).toBe(true);
    expect(tags.has('low-adventure')).toBe(false);
  });

  it('unrelated flags leave adventure bands untouched', () => {
    const tags = answersToTags({ ...DEFAULT_ANSWERS, adventureLevel: 50, flags: ['birthday', 'no-car'] });
    expect(tags.has('med-adventure')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generatePlan — no-boats
// ---------------------------------------------------------------------------

describe('generatePlan — no-boats flag', () => {
  const boatActivity = act('snorkel-cruise', { sections: ['cruises-water'], adventure: 40, timeOfDay: 'Morning' });
  const watersportsGroup = grp('sailing-group', ['watersports']);
  const catalog: Catalog = {
    activities: [...fillerPool(), boatActivity],
    groups: [watersportsGroup],
    items: [bestItem('sailing-group')],
  };

  it('cruises-water local activity never appears in any plan with no-boats', () => {
    const { actIds } = sweepSeeds({ ...BASE, flags: ['no-boats'] }, catalog);
    expect(actIds.has('snorkel-cruise')).toBe(false);
  });

  it('watersports Viator group never appears in any plan with no-boats', () => {
    const { grpIds } = sweepSeeds({ ...BASE, flags: ['no-boats'] }, catalog);
    expect(grpIds.has('sailing-group')).toBe(false);
  });

  it('without the flag the boat activity can appear', () => {
    // Just needs ONE seed to pick it to prove the catalog works — confirms the
    // absence above is caused by the flag, not by the activity being unreachable.
    const { actIds } = sweepSeeds({ ...BASE, flags: [] }, catalog);
    expect(actIds.has('snorkel-cruise')).toBe(true);
  });

  it('without the flag the watersports group can appear', () => {
    const { grpIds } = sweepSeeds({ ...BASE, flags: [] }, catalog);
    expect(grpIds.has('sailing-group')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generatePlan — intense-hikes (adventure cap 52)
// ---------------------------------------------------------------------------

describe('generatePlan — intense-hikes flag', () => {
  // adventure: 55 should be excluded; 50 should survive.
  const hardHike = act('hard-hike', { adventure: 55, sections: ['adventures-outdoor'], timeOfDay: 'Morning' });
  const easyHike = act('easy-hike', { adventure: 50, sections: ['beaches'], timeOfDay: 'Morning' });
  const catalog: Catalog = { activities: [...fillerPool(), hardHike, easyHike], groups: [], items: [] };

  it('activities with adventure > 52 never appear with intense-hikes', () => {
    const { actIds } = sweepSeeds({ ...BASE, flags: ['intense-hikes'] }, catalog);
    expect(actIds.has('hard-hike')).toBe(false);
  });

  it('activities with adventure ≤ 52 still appear with intense-hikes', () => {
    const { actIds } = sweepSeeds({ ...BASE, flags: ['intense-hikes'] }, catalog);
    expect(actIds.has('easy-hike')).toBe(true);
  });

  it('without the flag the hard hike can appear', () => {
    const { actIds } = sweepSeeds({ ...BASE, flags: [] }, catalog);
    expect(actIds.has('hard-hike')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generatePlan — mobility (adventure cap 30)
// ---------------------------------------------------------------------------

describe('generatePlan — mobility flag', () => {
  const intense  = act('intense-activity', { adventure: 55, timeOfDay: 'Morning' });
  const moderate = act('moderate-activity', { adventure: 35, timeOfDay: 'Afternoon' });
  const gentle   = act('gentle-activity',   { adventure: 25, timeOfDay: 'Afternoon' });
  const catalog: Catalog = { activities: [...fillerPool(), intense, moderate, gentle], groups: [], items: [] };

  it('activities with adventure > 30 never appear with mobility', () => {
    const { actIds } = sweepSeeds({ ...BASE, flags: ['mobility'] }, catalog);
    expect(actIds.has('intense-activity')).toBe(false);
    expect(actIds.has('moderate-activity')).toBe(false);
  });

  it('activities with adventure ≤ 30 still appear with mobility', () => {
    // gentle-activity competes with 8 afternoon fillers, so its appearance is
    // seed-probabilistic — sweep enough seeds to reliably surface it (reachable).
    const { actIds } = sweepSeeds({ ...BASE, flags: ['mobility'] }, catalog, 16);
    expect(actIds.has('gentle-activity')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generatePlan — no-early-mornings
// ---------------------------------------------------------------------------

describe('generatePlan — no-early-mornings flag', () => {
  const catalog = getCatalog(); // real catalog — has morning activities

  it('morning slot is empty on every day when no-early-mornings is set', () => {
    const plan = generatePlan({ ...BASE, days: 7, flags: ['no-early-mornings'] }, catalog);
    plan.forEach((d, i) => {
      expect(d.morning.length).toBe(0);
    });
  });

  it('without the flag morning slots fill normally', () => {
    const plan = generatePlan({ ...BASE, days: 7, flags: [] }, catalog);
    const hasMorning = plan.some((d) => d.morning.length > 0);
    expect(hasMorning).toBe(true);
  });

  it('afternoon and evening still fill with no-early-mornings', () => {
    const plan = generatePlan({ ...BASE, days: 5, flags: ['no-early-mornings'] }, catalog);
    const hasAfternoon = plan.some((d) => d.afternoon.length > 0);
    expect(hasAfternoon).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Real catalog — spot-check high-adventure activities are filtered
// ---------------------------------------------------------------------------

describe('generatePlan — real catalog spot-checks', () => {
  const catalog = getCatalog();
  // Real activities with adventure scores that cross the thresholds.
  // arikok-hiking: adventure 55  (> 52 → excluded by intense-hikes; > 30 → excluded by mobility)
  // antilla-wreck-dive: adventure 60, sections cruises-water (excluded by no-boats, intense-hikes, mobility)
  // kitesurfing-lesson: adventure 85, sections cruises-water (excluded by all three)
  // natural-pool-jeep: adventure 70, sections adventures-outdoor (excluded by intense-hikes, mobility)

  it('arikok-hiking never appears with intense-hikes flag', () => {
    const { actIds } = sweepSeeds({ ...BASE, days: 9, flags: ['intense-hikes'] }, catalog, 12);
    expect(actIds.has('arikok-hiking')).toBe(false);
  });

  it('arikok-hiking never appears with mobility flag', () => {
    const { actIds } = sweepSeeds({ ...BASE, days: 9, flags: ['mobility'] }, catalog, 12);
    expect(actIds.has('arikok-hiking')).toBe(false);
  });

  it('natural-pool-jeep never appears with intense-hikes flag', () => {
    const { actIds } = sweepSeeds({ ...BASE, days: 9, flags: ['intense-hikes'] }, catalog, 12);
    expect(actIds.has('natural-pool-jeep')).toBe(false);
  });

  it('antilla-wreck-dive never appears with no-boats flag', () => {
    const { actIds } = sweepSeeds({ ...BASE, days: 9, flags: ['no-boats'] }, catalog, 12);
    expect(actIds.has('antilla-wreck-dive')).toBe(false);
  });

  it('kitesurfing-lesson never appears with no-boats flag', () => {
    const { actIds } = sweepSeeds({ ...BASE, days: 9, flags: ['no-boats'] }, catalog, 12);
    expect(actIds.has('kitesurfing-lesson')).toBe(false);
  });

  it('boca-catalina-snorkel never appears with no-boats flag', () => {
    const { actIds } = sweepSeeds({ ...BASE, days: 9, flags: ['no-boats'] }, catalog, 12);
    expect(actIds.has('boca-catalina-snorkel')).toBe(false);
  });

  it('the sunset-sail Viator item (sailing-cruises, a crowd-pleaser) never faces a group with no-boats', () => {
    // Regression: the sunset sail lives in sailing-cruises (not the watersports
    // group), so the group-level filter missed it and the crowd-pleaser boost
    // pushed it to the top even for seasick travellers. Item-level water filter
    // must drop it.
    const cat = getCatalog();
    for (let s = 0; s < 12; s += 1) {
      const plan = generatePlan({ ...BASE, days: 9, flags: ['no-boats'] }, cat, { seed: s });
      const faces = allEntries(plan)
        .filter((e) => e.kind === 'group')
        .map((e) => (e as { kind: 'group'; bestSellerId: string }).bestSellerId);
      expect(faces).not.toContain('sunset-sail');
    }
  });

  it('flags with no effect on a given activity leave it reachable (baby beach with birthday flag)', () => {
    // birthday has no generator effect — a plain local pick should still be
    // reachable. (Probe with baby-beach-snorkel, which has no Viator equivalent;
    // arikok-hiking is intentionally suppressed when the catalog sells a guided
    // Arikok tour — see the viatorDupe test below.)
    const { actIds } = sweepSeeds({ ...BASE, days: 9, flags: ['birthday'] }, catalog, 12);
    expect(actIds.has('baby-beach-snorkel')).toBe(true);
  });

  it('suppresses the self-guided arikok-hiking local when the catalog sells a guided Arikok tour', () => {
    // The real catalog includes a Viator "Arikok ... Jeep Safari", so the
    // non-bookable self-guided local should never be auto-placed (it stays in
    // Explore) — the bookable guided tour is preferred.
    const { actIds } = sweepSeeds({ ...BASE, days: 12 }, catalog, 12);
    expect(actIds.has('arikok-hiking')).toBe(false);
  });
});
