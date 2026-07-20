/**
 * End-to-end engine test against the live Viator catalog.
 * Skipped in CI (no VITE_SUPABASE_ANON_KEY); run manually with:
 *   npx vitest run src/data/e2e-engine.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { generatePlan } from './itineraryGenerator';
import { ACTIVITIES } from './activities';
import type { Catalog } from './activitySource';
import type { Answers } from '../App';
import type { ViatorGroup, ViatorItem } from '../types';

// Load from .env.production since vitest doesn't pick up VITE_ vars at runtime.
function loadEnv(key: string): string | undefined {
  try {
    const raw = readFileSync('/root/10daysonaruba.com/.env.production', 'utf8');
    const m = raw.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return m?.[1]?.trim();
  } catch { return undefined; }
}
const ANON_KEY = loadEnv('VITE_SUPABASE_ANON_KEY');
const FN_URL   = loadEnv('VITE_VIATOR_FN_URL') ?? 'https://mrfblzsihpecockhsnqe.supabase.co/functions/v1/viator-cards';

const skip = !ANON_KEY;

describe.skipIf(skip)('matching engine — live catalog', () => {
  let catalog: Catalog = { activities: ACTIVITIES, groups: [], items: [] };

  beforeAll(async () => {
    const res  = await fetch(FN_URL!, { headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY! } });
    const data = await res.json() as { groups: ViatorGroup[]; items: ViatorItem[]; localMatches?: Record<string, unknown> };
    // Replicate loadCatalog() enrichment so local activities get Viator ratings/images.
    const matches = (data.localMatches ?? {}) as Record<string, { title?: string; rating?: number; review_count?: number; image_url?: string; viator_item_url?: string }>;
    const activities = ACTIVITIES.map(a => {
      const m = matches[a.id];
      if (!m) return a;
      return { ...a, title: m.title || a.title, image: m.image_url || a.image, rating: typeof m.rating === 'number' && m.rating > 0 ? m.rating : a.rating, reviewCount: typeof m.review_count === 'number' ? m.review_count : a.reviewCount, viator_item_url: m.viator_item_url };
    });
    catalog = { activities, groups: data.groups, items: data.items };
  });

  it('catalog is healthy (6+ groups, 300+ items)', () => {
    expect(catalog.groups.length).toBeGreaterThanOrEqual(6);
    expect(catalog.items.length).toBeGreaterThanOrEqual(300);
  });

  const personas: Array<{ name: string; answers: Answers }> = [
    {
      name: 'budget couple, beach+food, 7 days',
      answers: { days: 7, groupType: 'Couple', budget: 'budget-conscious', interests: ['Beach & chill', 'Food & drink'], adventureLevel: 30, startOffset: 7, lodging: 'Eagle Beach', flags: [], specialNotes: '' },
    },
    {
      name: 'family with kids, mid-range, 5 days, no boats',
      answers: { days: 5, groupType: 'Family with young kids', budget: 'mid-range', interests: ['Beach & chill', 'Watersports'], adventureLevel: 40, startOffset: 14, lodging: 'Palm Beach', flags: ['no-boats'], specialNotes: '' },
    },
    {
      name: 'solo splurge, adventure+culture, 10 days',
      answers: { days: 10, groupType: 'Solo', budget: 'treat-yourself', interests: ['Adventure & adrenaline', 'Culture & history', 'Watersports'], adventureLevel: 80, startOffset: 3, lodging: 'Noord (Airbnb)', flags: [], specialNotes: '' },
    },
    {
      name: 'honeymoon, money-no-object, 9 days',
      answers: { days: 9, groupType: 'Couple', budget: 'money-no-object', interests: ['Wellness & spa', 'Food & drink', 'Beach & chill'], adventureLevel: 20, startOffset: 30, lodging: 'Palm Beach', flags: ['honeymoon'], specialNotes: '' },
    },
    {
      name: 'solo budget, hiking+culture, 3 days',
      answers: { days: 3, groupType: 'Solo', budget: 'budget-conscious', interests: ['Nature & hiking', 'Culture & history'], adventureLevel: 65, startOffset: 7, lodging: 'Downtown', flags: ['no-early-mornings'], specialNotes: '' },
    },
  ];

  for (const { name, answers } of personas) {
    // Helper: flatten all SlotEntry[] arrays from a day into individual entries.
    function allEntries(plan: ReturnType<typeof generatePlan>) {
      return plan.flatMap(day => [
        ...day.morning, ...day.afternoon, ...day.evening,
      ]);
    }

    it(`no duplicates — ${name}`, () => {
      const plan = generatePlan(answers, catalog, { seed: 42 });
      const ids = allEntries(plan).map(e => e.kind === 'group' ? e.groupId : e.id);
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const id of ids) { if (seen.has(id)) dupes.push(id); seen.add(id); }
      expect(dupes, `duplicate IDs: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
    });

    it(`day 1 has no paid viator activities — ${name}`, () => {
      if (answers.days < 2) return;
      const plan = generatePlan(answers, catalog, { seed: 42 });
      const day1entries = [...plan[0].morning, ...plan[0].afternoon, ...plan[0].evening];
      for (const entry of day1entries) {
        if (entry.kind !== 'group') continue;
        const bestSeller = catalog.items.find(i => i.group_id === entry.groupId && i.is_best_seller);
        if (bestSeller?.price_usd) {
          expect(bestSeller.price_usd, `day 1 has paid viator group ${entry.groupId}`).toBe(0);
        }
      }
    });

    it(`fills at least 70% of meaningful slots — ${name}`, () => {
      const plan = generatePlan(answers, catalog, { seed: 42 });
      const noMornings = answers.flags.includes('no-early-mornings');
      // Arrival day 1 + departure day N keep an open afternoon (when days >= 2).
      const openAfternoons = answers.days >= 2 ? 2 : 0;
      const meaningfulSlots = plan.length * 3
        - (noMornings ? plan.length : 0)
        - openAfternoons;
      const filled = allEntries(plan).length;
      expect(filled).toBeGreaterThanOrEqual(Math.floor(meaningfulSlots * 0.7));
    });
  }
});
