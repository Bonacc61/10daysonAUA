/**
 * Manual check of the Q8 `influencer` flag against the LIVE Viator catalog.
 * Skipped in CI (no VITE_SUPABASE_ANON_KEY); run with:
 *   npx vitest run src/data/influencer.manual.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { generatePlan } from './itineraryGenerator';
import { isPhotoService } from './itemFit';
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

  // Photo services placed across N seeded plans — by ID, and by title for the
  // failure message.
  //
  // Detects with `isPhotoService`, NOT `isContentProduct`, and that is the whole
  // point rather than a detail. `isPhotoService` is the predicate the ENGINE
  // gates auto-fill on (`bookableTier`), so it is the one that decides what the
  // influencer flag can reach. `isContentProduct` (`/photo|video/i`) only drives
  // the scoring boost, and it is a title-word test on strings Viator's operators
  // control.
  //
  // Measured 2026-09-10, and this is what broke the test: the champion of the
  // photo cluster is now "Clear Kayak Experience" (5593159P4), which contains
  // neither "photo" nor "video". The engine placed it in all 12 seeds and this
  // function counted zero. Four catalog products sit in that gap, including a
  // 299-review one. Detecting on the engine's own gate removes the class.
  function photoPlaced(answers: Answers, seeds = 12) {
    const titles: string[] = [];
    const ids: string[] = [];
    let tripsWithOne = 0;
    for (let seed = 0; seed < seeds; seed += 1) {
      let n = 0;
      for (const day of generatePlan(answers, catalog, { seed })) {
        for (const s of [...day.morning, ...day.afternoon, ...day.evening]) {
          if (s.kind !== 'group') continue;
          const item = byId.get(s.bestSellerId);
          if (item && isPhotoService(item)) { n += 1; titles.push(item.title); ids.push(item.id); }
        }
      }
      if (n > 0) tripsWithOne += 1;
    }
    return { tripsWithOne, seeds, titles, ids };
  }

  // PINS the measured behaviour, and it has now been rewritten twice.
  //
  // 2026-08-21, owner's ruling: the clear-kayak photoshoot is exactly what the
  // influencer flag is for, and must appear for them and for nobody else. So
  // the assertion is back to `on > off` — but for one NAMED product rather
  // than the broad `isContentProduct` net that ruling I4 removed, which is the
  // difference between this and the pre-I4 version.
  //
  // This also closed the gap the note below describes, and closed it without
  // touching champion selection. Read on: the clear kayak IS the champion of
  // the photo cluster, so the moment the whitelist stopped refusing it for an
  // influencer, the product the champion pass had already chosen became
  // reachable. The paragraph is kept because its analysis is still correct
  // about the other 16 photo services, which remain unreachable.
  //
  // The superseded version of this test read:
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
  // whitelist. Re-measured at the ship gate 2026-08-18: 13 of the catalog's 17
  // photo services share one experience cluster (`5493518P2`), and the other 4
  // ARE champions of their own clusters but fail `MIN_CHAMPION_REVIEWS` with 3,
  // 2 and 1 reviews — two independent gates, not one, which makes the
  // conclusion firmer than a single mechanism would.
  // `championsByExperience` (itineraryGenerator.ts)
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
  it('places the clear-kayak photoshoot for an influencer and for nobody else', () => {
    const off = photoPlaced(base);
    const on = photoPlaced({ ...base, flags: ['influencer'] });
    console.log(`OFF: ${off.tripsWithOne}/${off.seeds} trips, ${off.titles.length} placements`);
    console.log([...new Set(off.titles)].map((t) => `  - ${t}`).join('\n'));
    console.log(`ON : ${on.tripsWithOne}/${on.seeds} trips, ${on.titles.length} placements`);
    console.log([...new Set(on.titles)].map((t) => `  - ${t}`).join('\n'));
    // The flag has to CHANGE something or it is decorative — the same principle
    // that got `birthday` and `work-trip` deleted. Measured 2026-08-21 on the
    // live catalog with this persona and 12 seeds: OFF 0/12, ON 12/12.
    expect(off.titles.length).toBe(0);
    expect(on.tripsWithOne).toBe(on.seeds);
    // Both halves matter. Asserting only the count would pass if the flag
    // started handing out photo services the owner never asked for, so pin that
    // it is ONE product, not a spray.
    expect([...new Set(on.ids)], `titles: ${[...new Set(on.titles)].join(' | ')}`).toHaveLength(1);

    // Pinned by ID, not by title. The previous version of this line pinned
    // "50%OFF Aruba\u2018s #1Clear Kayak Experience@arubaphotoshootexperience" \u2014 a
    // string Viator's operator controls \u2014 and it broke when they renamed the
    // listing, with nothing wrong in the engine. Product codes do not change;
    // that is the same premise content/slugs.json relies on.
    //
    // A failure HERE is real signal rather than noise: it means the champion of
    // the photo cluster moved, and `championsByExperience` picks one item per
    // cluster, so a different champion changes what every influencer plan
    // contains. Re-measure before updating the id \u2014 do not just paste the new
    // one in.
    expect([...new Set(on.ids)], `titles: ${[...new Set(on.titles)].join(' | ')}`).toEqual(['5593159P4']);
  });

  it('still fills every plan (the boost does not starve other slots)', () => {
    for (let seed = 0; seed < 6; seed += 1) {
      const days = generatePlan({ ...base, flags: ['influencer'] }, catalog, { seed });
      const filled = days.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]).length;
      expect(filled).toBeGreaterThanOrEqual(days.length * 2);
    }
  });
});
