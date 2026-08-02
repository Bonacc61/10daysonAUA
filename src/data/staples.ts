import type { Catalog } from './activitySource';
import type { Activity } from './activities';
import { activityKind, isEveningItem, fitItem } from './itemFit';
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
  // A beach at sunset. Local and free by design: the paid sunset sail is
  // already covered by the water-dinner staple on longer trips.
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
  {
    key: 'catamaran-sail',
    preferred: ['morning', 'afternoon'], fallback: [],
    minDays: 2,
    localIds: ['boca-catalina-snorkel'],
    itemMatch: (i) => activityKind(i) === 'sail' && !isEveningItem(i),
  },
  // Dinner on the water, once the trip is long enough to justify a second
  // paid evening.
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
// regenerate — a different sunrise beach, a different catamaran operator —
// while the category itself stays guaranteed. Without it every plan for every
// traveller would name the same four products, and "regenerate" would visibly
// stop changing anything.
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
    let free = true;

    if (spec.itemMatch) {
      const candidates = catalog.items
        .filter(spec.itemMatch)
        .filter((i) => !fitItem(i, tags).rejected)
        .filter((i) => !taken.has(i.id))
        .filter((i) => !i.experience_cluster_id || !usedClusters.has(i.experience_cluster_id))
        .sort((a, b) => b.review_count - a.review_count || (a.id < b.id ? -1 : 1))
        .slice(0, STAPLE_CANDIDATE_POOL);
      const item = candidates[Math.floor(rand() * candidates.length)];
      const group = item && catalog.groups.find((g) => g.id === item.group_id);
      if (item && group) {
        entry = {
          kind: 'group',
          group,
          bestSeller: item,
          others: catalog.items.filter((i) => i.group_id === group.id && i.id !== item.id),
        };
        free = item.price_usd === 0;
        if (item.experience_cluster_id) usedClusters.add(item.experience_cluster_id);
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

    if (entry) out.push({ key: spec.key, entry, preferred: spec.preferred, fallback: spec.fallback, free });
  }

  return out;
}
