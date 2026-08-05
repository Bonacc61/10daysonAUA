/**
 * End-to-end engine test against the live Viator catalog.
 * Skipped in CI (no VITE_SUPABASE_ANON_KEY); run manually with:
 *   npx vitest run src/data/e2e-engine.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { generatePlan } from './itineraryGenerator';
import { ACTIVITIES } from './activities';
import type { Day } from './activities';
import type { Catalog } from './activitySource';
import type { Answers } from '../App';
import type { ViatorGroup, ViatorItem, SlotEntry } from '../types';
import { type Coord } from './coords';
import { pinFor } from './itemCoords';
import { distanceKm } from './enRoute';

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

  it('keeps days geographically coherent (avg intra-day spread stays tight)', () => {
    const coordOf = (e: SlotEntry): Coord | undefined =>
      pinFor(e.kind === 'activity' ? e.id : e.bestSellerId)?.coord;
    const answers: Answers = { days: 7, groupType: 'Couple', budget: 'mid-range', interests: ['Beach & chill', 'Watersports'], adventureLevel: 40, startOffset: 7, lodging: 'Palm Beach', flags: [], specialNotes: '' };
    const spreads = (slots: (d: Day) => SlotEntry[]) => {
      let sum = 0;
      let cnt = 0;
      for (let seed = 0; seed < 6; seed += 1) {
        for (const d of generatePlan(answers, catalog, { seed })) {
          const cs = slots(d).map(coordOf).filter((c): c is Coord => !!c);
          let spread = 0;
          for (let i = 0; i < cs.length; i += 1)
            for (let j = i + 1; j < cs.length; j += 1) spread = Math.max(spread, distanceKm(cs[i], cs[j]));
          sum += spread;
          cnt += 1;
        }
      }
      return sum / cnt;
    };

    // DAYTIME is where the geo penalty is supposed to do its work, and it is the
    // tight guard. Measured 2026-08-05, after the day-shape rules: avg 1.96 km,
    // max 18.2 km, 1 day of 42 past 15 km. (An earlier note here said "2.5 km and
    // not one day past 15" — accurate the hour it was written, stale by the end
    // of the same session. Re-measure before trusting these, or read the printed
    // value rather than the pass.)
    expect(spreads((d) => [...d.morning, ...d.afternoon])).toBeLessThan(6);

    // The whole-day number, evenings included, is much looser and always was —
    // it mostly measures Aruba, not the engine. Every sunset spot and dinner
    // cruise on the island is on the WEST coast, so any day spent on the south
    // coast (Mangel Halto, Savaneta, Baby Beach) ends 15-24 km from where it
    // was, and no amount of clustering can change that.
    //
    // Measured 10.29 km on 2026-08-05 (max 25.5, 14 of 42 days past 15 km). It
    // went 10.1 -> 11.9 when repeat kayak outings were retired, then back down
    // as the day-shape rules removed the second and third outings that were
    // stretching days. The rise was never the daytime leg — that stayed under
    // 2.5 km throughout.
    //
    // 12, not 14: a guard set 36% above the current measurement gives up the
    // headroom it exists to protect. This comment claimed ~7.9 while the live
    // catalog had quietly drifted to 10.1, so watch the printed value rather
    // than trusting the pass.
    expect(spreads((d) => [...d.morning, ...d.afternoon, ...d.evening])).toBeLessThan(12);
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
      const entries = allEntries(plan);
      // Never the same item twice (a group entry is identified by its shown item).
      // A free local beach may be revisited after a clear day; nothing else may.
      const revisitable = new Set(catalog.activities
        .filter(a => a.category === 'Beaches' && /^free/i.test(a.cost.trim()))
        .map(a => a.id));
      const itemIds = entries
        .map(e => e.kind === 'group' ? e.bestSellerId : e.id)
        .filter(id => !revisitable.has(id));
      const seen = new Set<string>();
      const dupeItems: string[] = [];
      for (const id of itemIds) { if (seen.has(id)) dupeItems.push(id); seen.add(id); }
      expect(dupeItems, `duplicate items: ${[...new Set(dupeItems)].join(', ')}`).toEqual([]);
      // Never the same real-world experience twice (by cluster id, when present).
      const clusters = entries
        .filter((e): e is Extract<typeof e, { kind: 'group' }> => e.kind === 'group')
        .map(e => catalog.items.find(i => i.id === e.bestSellerId)?.experience_cluster_id)
        .filter((c): c is string => !!c);
      const seenC = new Set<string>();
      const dupeC: string[] = [];
      for (const c of clusters) { if (seenC.has(c)) dupeC.push(c); seenC.add(c); }
      expect(dupeC, `duplicate clusters: ${[...new Set(dupeC)].join(', ')}`).toEqual([]);
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
