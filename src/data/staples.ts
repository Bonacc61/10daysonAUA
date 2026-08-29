import type { Catalog } from './activitySource';
import type { Activity } from './activities';
import { activityKind, isEveningItem, fitItem, isAutoFillExcluded, isCouplesOriented, isKidsOriented } from './itemFit';
import type { CardEntry, MatchTag, Slot, ViatorItem } from '../types';

/* ------------------------------------------------------------------ *
 * Beach staples — the things every visitor does, answers or not.      *
 * ------------------------------------------------------------------ *
 * Four experiences a local would put in front of anyone who lands on   *
 * Aruba: a beach at sunrise, a catamaran sail, a beach at sunset, and  *
 * — on a long enough trip — dinner by the water. The generator reserves *
 * a slot for each BEFORE persona fill, so a plan never comes back      *
 * without them just because the questionnaire skewed hard toward       *
 * off-road or culture.                                                 *
 *
 * Why this is needed at all: on the live catalog the seven most-booked
 * Aruba products are ALL jeep/UTV off-road tours (9.9k–3.7k reviews),
 * so popularity scoring alone hands every plan to the same circuit.
 * Staples are the counterweight.
 *
 * Two hard rules keep this from overriding the traveller:
 *   1. A staple is resolved against the ALREADY-FLAG-FILTERED catalog,
 *      so a seasick (`no-boats`) traveller simply finds no sail left to
 *      place and the staple is skipped — never forced.
 *   2. A staple is not budget-exempt (pins are). Each resolves to the
 *      most-booked option the traveller's budget actually allows, and
 *      is skipped when nothing fits.
 */

export type StapleSpec = {
  key: string;
  // Preferred slots, then fallbacks — same shape getPinSlotPrefs returns.
  preferred: Slot[];
  fallback: Slot[];
  // Trip length at which this staple starts applying. A 1-day cruise call
  // gets a beach and a sunset; dinner-by-the-water waits for a real trip.
  minDays: number;
  // Local picks to use, best first. These are the free, editorial ones —
  // preferred for sunrise/sunset so we never charge for a sunset.
  localIds: string[];
  // By default a local pick is chosen at random from whatever is still
  // available, so regenerating rotates the sunrise beach. Set this when the
  // FIRST entry is a promise rather than a preference — the later ids then
  // serve only as fallbacks for when it is already pinned or shortlisted.
  preferInOrder?: boolean;
  // Bookable Viator match. When present it wins over localIds: the sail and
  // the water dinner ARE the bookable experiences, and the local entry is
  // only a fallback for when the live catalog is unavailable.
  itemMatch?: (i: ViatorItem) => boolean;
  // The itemMatch counterpart of preferInOrder: products to reach for FIRST
  // when this staple has a slot, ahead of the most-booked ranking.
  //
  // The landing band names three products ("The 3 we never skip", owner
  // 2026-08-29) and this is how one comes to be in the plan rather than a
  // stranger's boat. PREFER, not force: it changes WHICH product fills a slot
  // the trip was always going to have, never how many slots exist. Every
  // filter below still runs first, so a vouched product ruled out by a
  // traveller's flags, budget, group or an already-claimed experience falls
  // through to the ranking exactly as any other product would.
  preferItemIds?: string[];
};

// Dinner *by the water* — a beach/sunset/cruise dinner, not any restaurant
// with "dinner" in the title. Both halves must match so a landlocked
// steakhouse never fills the beach-dinner staple.
const DINNER_RE = /\bdinner\b/i;
const SEASIDE_RE = /sunset|cruise|sail|catamaran|beach|seaside|shore/i;

export const STAPLE_SPECS: StapleSpec[] = [
  // A beach before the crowds. Purely local — the only "sunrise" products on
  // the live catalog are niche hikes (9–24 reviews), not a beach morning.
  {
    key: 'sunrise-beach',
    preferred: ['morning'], fallback: [],
    minDays: 1,
    localIds: ['eagle-beach-morning', 'malmok-beach', 'tres-trapi'],
  },
  // A beach at sunset. Local and free by design. The water-dinner staple below
  // no longer reliably covers the paid sunset sail — since 2026-08-12 one sail
  // per trip means the catamaran staple usually claims it first — which makes
  // this free local sunset the dependable one, not the redundant one.
  //
  // Manchebo leads deliberately, and preferInOrder makes that binding: the
  // landing page promises "a beach at sunset", and Manchebo IS a beach, where
  // the California Lighthouse is a cliffside lookout. Left to the default
  // random pick the lighthouse would fill this staple about half the time and
  // quietly break that promise. The lighthouse stays as the fallback for when
  // Manchebo is already pinned or shortlisted.
  {
    key: 'sunset',
    preferred: ['evening'], fallback: [],
    minDays: 1,
    localIds: ['manchebo-beach', 'california-lighthouse-sunset'],
    preferInOrder: true,
  },
  // The catamaran sail. Daytime only — an evening title belongs to the
  // dinner staple below, not here.
  //
  // The trip's daytime boat is the vouched Jolly Pirate afternoon sail wherever
  // it is eligible: it is one of the three the landing band names, and on
  // review_count alone it never won — the big operators outrank it 4:1.
  //
  // This costs day geography and the owner priced it: preferring it moves the
  // average daytime intra-day spread 4.79 → 6.39 km, because the product's
  // title pins it to the AFTERNOON and the rest of the day arranges around it.
  // Ruling 2026-08-29: every traveller is assumed to have a hire car, so a
  // couple of kilometres inside a day is not a cost worth trading our own
  // vouched operator for. `e2e-engine.test.ts` carries the re-baselined guard
  // and the same reasoning.
  {
    key: 'catamaran-sail',
    preferred: ['morning', 'afternoon'], fallback: [],
    minDays: 2,
    localIds: ['boca-catalina-snorkel'],
    preferItemIds: ['37387P3'],
    itemMatch: (i) => activityKind(i) === 'sail' && !isEveningItem(i),
  },
  // Dinner on the water, once the trip is long enough to justify a second paid
  // evening — or on the sand, when the catamaran staple has already taken the
  // trip's one sail. The matcher admits both, and since 2026-08-12 that is load
  // bearing rather than incidental: `localIds` is empty, so a shore dinner is
  // the only fallback this staple has.
  {
    key: 'beach-dinner',
    preferred: ['evening'], fallback: [],
    minDays: 4,
    localIds: [],
    itemMatch: (i) => DINNER_RE.test(i.title) && SEASIDE_RE.test(i.title),
  },
];

// How many of the most-booked matches a Viator staple picks from. Regenerating
// should feel alive without ever dropping out of "things everyone books", so the
// choice is a shuffle of the top few, not of the whole matching set.
const STAPLE_CANDIDATE_POOL = 3;

export type ResolvedStaple = {
  key: string;
  entry: CardEntry;
  // The runners-up from the same candidate pool, best first. The caller places
  // `entry` if it can and works down this list if it cannot — a staple whose
  // chosen product happens to be unplaceable must not take the whole category
  // with it. That is not hypothetical: once a product's own title pins it to a
  // slot ("Premium Catamaran MORNING Sail"), a traveller who ticked "no early
  // mornings" has no valid day for it, and the trip lost its only boat trip
  // entirely rather than falling through to the afternoon sailing.
  alternatives: CardEntry[];
  preferred: Slot[];
  fallback: Slot[];
  // Free staples may sit on the arrival day; paid ones must not (day 1 is the
  // free/chill settle-in day the generator reserves).
  free: boolean;
};

// Resolve each applicable staple to a concrete, bookable, in-budget entry.
// Viator candidates are ranked by review_count — for a staple we explicitly
// want a most-booked option, not the best persona fit, because the whole point
// is that it lands the same way for everyone.
//
// `rand` (seeded by the caller) varies WHICH staple fills each category on a
// regenerate — a different sunrise beach, and a different catamaran operator
// too unless `preferItemIds` has claimed that staple — while the category
// itself stays guaranteed. Without it every plan for every traveller would name
// the same four products, and "regenerate" would visibly stop changing
// anything.
// `taken` holds the ids of entries already claimed by the pin pre-pass. A
// traveller who shortlisted the sunset dinner cruise must not then have it
// placed a second time as the beach-dinner staple.
export function resolveStaples(
  catalog: Catalog, tags: Set<MatchTag>, nDays: number, rand: () => number,
  taken: ReadonlySet<string> = new Set(),
): ResolvedStaple[] {
  const out: ResolvedStaple[] = [];
  const usedClusters = new Set<string>();
  const usedActivityIds = new Set<string>(taken);

  for (const spec of STAPLE_SPECS) {
    if (nDays < spec.minDays) continue;

    let entry: CardEntry | null = null;
    let alternatives: CardEntry[] = [];
    let free = true;

    if (spec.itemMatch) {
      const eligible = catalog.items
        .filter(spec.itemMatch)
        // A staple is the most prominent auto-suggestion there is — it lands in
        // every plan — so the "never suggest this unasked" rule has to apply here
        // too. Latent today, but "Sunset Dinner Photoshoot" would satisfy the
        // beach-dinner matcher exactly.
        .filter((i) => !isAutoFillExcluded(i))
        // ...and the same for the group-fit exclusions. A staple bypasses the
        // fill ladder entirely, so `autoFillOk` never sees it: without these two
        // lines the couples and kids rules are guarantees about the LADDER, not
        // about the plan. Measured as latent today (0 of 120 Solo plans place a
        // couples product either way) — this makes it structural rather than
        // lucky. `couple`/`withChildren` mirror the generator's own gates.
        .filter((i) => tags.has('couple') || !isCouplesOriented(i))
        .filter((i) => (tags.has('family-young-kids') || tags.has('family-teens')) || !isKidsOriented(i))
        .filter((i) => !fitItem(i, tags).rejected)
        .filter((i) => !taken.has(i.id))
        .filter((i) => !i.experience_cluster_id || !usedClusters.has(i.experience_cluster_id))
        .sort((a, b) => b.review_count - a.review_count || (a.id < b.id ? -1 : 1));
      // Looked up across the WHOLE eligible list rather than the most-booked
      // few, because a vouched product's modest review count is precisely why
      // the ranking never reached it. The `rand()` draw still runs either way,
      // so a resolved preference does not shift the sequence the staples below
      // this one see.
      const promised = spec.preferItemIds
        ?.map((id) => eligible.find((i) => i.id === id))
        .find((i): i is ViatorItem => !!i);
      const candidates = promised
        ? [promised, ...eligible.filter((i) => i.id !== promised.id).slice(0, STAPLE_CANDIDATE_POOL - 1)]
        : eligible.slice(0, STAPLE_CANDIDATE_POOL);
      const drawn = candidates[Math.floor(rand() * candidates.length)];
      const item = promised ?? drawn;
      const asEntry = (i: ViatorItem): CardEntry | null => {
        const g = catalog.groups.find((x) => x.id === i.group_id);
        if (!g) return null;
        return {
          kind: 'group',
          group: g,
          bestSeller: i,
          others: catalog.items.filter((x) => x.group_id === g.id && x.id !== i.id),
        };
      };
      if (item) {
        entry = asEntry(item);
        if (entry) {
          // Runners-up in review order, so a fall-through still lands on
          // something people actually book.
          alternatives = candidates
            .filter((c) => c.id !== item.id)
            .map(asEntry)
            .filter((e): e is CardEntry => !!e);
          // `free` and the cluster claim cover the WHOLE candidate set, not just
          // the first choice, because the caller may place any of them. Reading
          // them off `item` alone left `free` describing a product that was not
          // placed — and `free` decides whether a staple may sit on the arrival
          // day. Latent today (no $0 Viator items) and cheap to close.
          free = [item, ...candidates.filter((c) => c.id !== item.id)]
            .every((c) => c.price_usd === 0);
          for (const c of candidates) {
            if (c.experience_cluster_id) usedClusters.add(c.experience_cluster_id);
          }
        }
      }
    }

    if (!entry) {
      // Editorial order in localIds is the preference order, but any of them is
      // a good answer — rotate so the sunrise beach isn't Eagle Beach forever.
      const available = spec.localIds
        .filter((id) => !usedActivityIds.has(id))
        .map((id) => catalog.activities.find((a) => a.id === id))
        .filter((a): a is Activity => !!a);
      // preferInOrder specs take the first available (the id IS the promise);
      // everything else rotates so a regenerate visibly changes.
      const activity = spec.preferInOrder
        ? available[0]
        : available[Math.floor(rand() * available.length)];
      if (activity) {
        entry = { kind: 'activity', activity };
        free = /^free/i.test(activity.cost.trim());
        usedActivityIds.add(activity.id);
      }
    }

    if (entry) out.push({ key: spec.key, entry, alternatives, preferred: spec.preferred, fallback: spec.fallback, free });
  }

  return out;
}
