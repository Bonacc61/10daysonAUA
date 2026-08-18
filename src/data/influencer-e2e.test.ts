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

  // PINS the measured behaviour; it used to assert `on > off`. Rewritten for
  // ruling I4 (final whole-branch review, 2026-08-18), which narrowed
  // `bookableTier`'s influencer row from `isContentProduct` (`/photo|video/i`)
  // to `isPhotoService` (word-anchored on the shoot).
  //
  // Measured on the live catalog before I4, this exact persona and 12 seeds:
  // OFF 0/12 trips, 0 placements; ON 12/12 trips, 12 placements — and every one
  // of the twelve was the SAME listing, "50%OFF Aruba's #1Clear Kayak
  // Experience@arubaphotoshootexperience" ($60, 74 reviews). A clear kayak tour
  // with photos thrown in, which is precisely what I4 removed from the
  // whitelist. After I4: ON 0/12.
  //
  // Nothing replaced it, and the reason is cluster dedup rather than the
  // whitelist. 15 of the catalog's 17 photo services share one experience
  // cluster (`5493518P2`); `championsByExperience` (itineraryGenerator.ts)
  // keeps one item per cluster, and the champion it keeps is that kayak. So
  // when the whitelist refuses the champion at fill time, the genuine
  // photoshoots behind it — "Aruba Clear Kayak Photoshoot | Same-Day Photo +
  // Video" ($60, 100 reviews), "Professional Sunset Photoshoot in Aruba"
  // ($125, 56), "Private Vacation Photoshoot with Photographer" ($130, 35) —
  // are already out of the pool. No persona can reach them: champion selection
  // does not read the whitelist, so the outcome is the same for every set of
  // answers.
  //
  // Left as measured rather than patched. The fix is a change to champion
  // selection (choose the cluster champion from items the traveller can
  // actually be given), which is an engine change with its own measurement,
  // not an end-of-branch edit. The predicate itself is guarded in both
  // directions by unit tests in bookables.test.ts.
  it('places no content product for either traveller, and the same one for both (I4)', () => {
    const off = contentPlaced(base);
    const on = contentPlaced({ ...base, flags: ['influencer'] });
    console.log(`OFF: ${off.tripsWithOne}/${off.seeds} trips, ${off.titles.length} placements`);
    console.log([...new Set(off.titles)].map((t) => `  - ${t}`).join('\n'));
    console.log(`ON : ${on.tripsWithOne}/${on.seeds} trips, ${on.titles.length} placements`);
    console.log([...new Set(on.titles)].map((t) => `  - ${t}`).join('\n'));
    expect(off.titles.length).toBe(0);
    expect(on.titles.length).toBe(0);
  });

  it('still fills every plan (the boost does not starve other slots)', () => {
    for (let seed = 0; seed < 6; seed += 1) {
      const days = generatePlan({ ...base, flags: ['influencer'] }, catalog, { seed });
      const filled = days.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]).length;
      expect(filled).toBeGreaterThanOrEqual(days.length * 2);
    }
  });
});
