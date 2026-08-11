/**
 * Manual check of the Q8 `influencer` flag against the LIVE Viator catalog.
 * Skipped in CI (no VITE_SUPABASE_ANON_KEY); run with:
 *   npx vitest run src/data/influencer.manual.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { generatePlan } from './itineraryGenerator';
import { isContentProduct } from './itemFit';
import { ACTIVITIES } from './activities';
import type { Catalog } from './activitySource';
import type { Answers } from '../App';
import type { ViatorGroup, ViatorItem } from '../types';

function loadEnv(key: string): string | undefined {
  try {
    const raw = readFileSync('/root/10daysonaruba.com/.env.production', 'utf8');
    return raw.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim();
  } catch { return undefined; }
}
const ANON_KEY = loadEnv('VITE_SUPABASE_ANON_KEY');
const FN_URL = loadEnv('VITE_VIATOR_FN_URL') ?? 'https://mrfblzsihpecockhsnqe.supabase.co/functions/v1/viator-cards';

describe.skipIf(!ANON_KEY)('influencer flag — live catalog', () => {
  let catalog: Catalog = { activities: ACTIVITIES, groups: [], items: [] };
  let byId = new Map<string, ViatorItem>();

  beforeAll(async () => {
    const res = await fetch(FN_URL, { headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY! } });
    const data = await res.json() as { groups: ViatorGroup[]; items: ViatorItem[] };
    catalog = { activities: ACTIVITIES, groups: data.groups, items: data.items };
    byId = new Map(data.items.map((i) => [i.id, i]));
  });

  const base: Answers = {
    days: 7, groupType: 'Couple', budget: 'Treat yourself',
    interests: ['Beach & chill', 'Watersports'], adventureLevel: 40,
    startOffset: 7, lodging: 'Palm Beach', flags: [], specialNotes: '',
  };

  // Content products placed across N seeded plans, and their titles.
  function contentPlaced(answers: Answers, seeds = 12) {
    const titles: string[] = [];
    let tripsWithOne = 0;
    for (let seed = 0; seed < seeds; seed += 1) {
      let n = 0;
      for (const day of generatePlan(answers, catalog, { seed })) {
        for (const s of [...day.morning, ...day.afternoon, ...day.evening]) {
          if (s.kind !== 'group') continue;
          const item = byId.get(s.bestSellerId);
          if (item && isContentProduct(item)) { n += 1; titles.push(item.title); }
        }
      }
      if (n > 0) tripsWithOne += 1;
    }
    return { tripsWithOne, seeds, titles };
  }

  it('surfaces content products for an influencer, and more than without the flag', () => {
    const off = contentPlaced(base);
    const on = contentPlaced({ ...base, flags: ['influencer'] });
    console.log(`OFF: ${off.tripsWithOne}/${off.seeds} trips, ${off.titles.length} placements`);
    console.log([...new Set(off.titles)].map((t) => `  - ${t}`).join('\n'));
    console.log(`ON : ${on.tripsWithOne}/${on.seeds} trips, ${on.titles.length} placements`);
    console.log([...new Set(on.titles)].map((t) => `  - ${t}`).join('\n'));
    expect(on.titles.length).toBeGreaterThan(off.titles.length);
    expect(on.tripsWithOne).toBe(on.seeds);
  });

  it('still fills every plan (the boost does not starve other slots)', () => {
    for (let seed = 0; seed < 6; seed += 1) {
      const days = generatePlan({ ...base, flags: ['influencer'] }, catalog, { seed });
      const filled = days.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]).length;
      expect(filled).toBeGreaterThanOrEqual(days.length * 2);
    }
  });
});
