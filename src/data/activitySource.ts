import { ACTIVITIES, type Activity } from './activities';
import { VIATOR_GROUPS, VIATOR_ITEMS } from './viator-stub';
import { LUNCHSPOTS } from './lunchspots';
import { fitItem, bestItemForAnswers, itemSlotOk, matchingSection, isRetailProduct } from './itemFit';
import { budgetTag } from './classify';
import type { ViatorGroup, ViatorItem, SlotEntry, CardEntry, MatchTag, Slot, Section } from '../types';

export type Catalog = {
  activities: Activity[];
  groups: ViatorGroup[];
  items: ViatorItem[];
};

// Transportation-only Viator products (airport transfers, shuttles, private
// car service) aren't experiences a traveller plans a day around, so they don't
// belong in Explore or in generated itineraries. Viator files them under the
// same broad Sightseeing/Adventure anchors viator-cards searches, so they leak
// into the live catalog. Drop them at ingest — one chokepoint covers both
// Explore and the generator, since both read catalog.items.
//
// A product is transport-only when its title names a transfer/shuttle AND names
// no actual experience. The experience guard keeps hybrids where the trip (not
// the ride) is the point — a sunset cruise "with hotel pickup", a "Jeep Safari
// (Natural Pool Transfer)". Jeep tours are always kept; party buses used to be
// too, and are now dropped by isPartyBus below instead.
const TRANSPORT_RE = /\b(airport|transfers?|shuttle|pick[\s-]?up|drop[\s-]?off|taxi|limo(?:usine)?|car service|transport(?:ation)?)\b/i;
const EXPERIENCE_RE = /\b(tour|cruise|sail|snorkel|div(?:e|ing)|safari|adventure|dinner|lunch|breakfast|brunch|tasting|class|ride|hik(?:e|ing)|kayak|paddle|zipline|atv|utv|quad|horseback|sightseeing|excursion|jeep|party bus|catamaran|fishing|spa|show|sunset)\b/i;

export function isTransportOnly(item: ViatorItem): boolean {
  return TRANSPORT_RE.test(item.title) && !EXPERIENCE_RE.test(item.title);
}

// Party buses and bar crawls: dropped from the catalog outright, so they never
// reach Explore, search, the swap pool or a plan. This is a stronger exclusion
// than `isAutoFillExcluded` (which only means "don't suggest this unasked") —
// it is a judgement about what this site recommends at all, not about how a
// product is surfaced.
//
// Nine live products match, including the 1,467-review "Aruba Nightlife Party
// Bus Tour", so this is a deliberate choice to leave bookings on the table.
//
// Narrow on purpose: "party bus" and the crawls, never the bare word "bus".
// Aruba's daytime sightseeing bus tours are ordinary products and stay —
// "Best of Aruba by Bus" (642 reviews), "Colorful Beach Bus Sightseeing Tour",
// "Half-Day Aruba Sightseeing Tour & Beach in an Air-condition Bus" among them.
const PARTY_BUS_RE = /\bparty bus\b|\b(?:pub|bar|club) crawl\b|\bbooze cruise\b/i;
export function isPartyBus(item: ViatorItem): boolean {
  return PARTY_BUS_RE.test(item.title);
}

// Everything the catalog refuses to carry at all: pure transfers, party buses and
// bar crawls, and retail errands (the diamond showroom, duty-free, timeshare
// pitches). One chokepoint, applied at ingest, so Explore, search, the swap pool
// and the generator all see the same catalog — there is no surface where a
// dropped product can still turn up.
export function isExcludedFromCatalog(item: ViatorItem): boolean {
  return isTransportOnly(item) || isPartyBus(item) || isRetailProduct(item);
}

// --- Group reassignment (the live feed's group_id is not trustworthy) -------
// viator-cards fetches products by searching a handful of broad Viator anchors
// and files each result under the anchor it came back from. Products surface
// under anchors they only loosely belong to, so on the live Aruba catalog:
// 68 of the island's 85 off-road tours sit in "Sailing & Cruises" (232 of 361
// items land in that one group), the submarine tour sits in "Watersports", and
// the nightlife party bus sits in "Food & Drink Experiences".
//
// That misfiling is not cosmetic. group_id drives:
//   • the generator's relevance gate (candidatesFor filters on group.matched_by,
//     and sailing-cruises is tagged beach-chill/couple/cruise-day — so an
//     adventure traveller never sees the island's most-booked UTV tours in the
//     matched pool);
//   • the day theme and card header (a catamaran day titled "Food & Drink");
//   • a card's "Other suggestions" (a sunset sail offering UTV tours);
//   • Explore's section buckets.
//
// A product's own Viator TAGS are reliable, so we re-file every item by the
// section its tags imply. One chokepoint at ingest fixes every consumer at once.
//
// Which section each group represents. Keyed on the group ID, which is OURS —
// viator-cards names the anchors — not Viator's. Deriving it from the group's
// viator_taxonomy tag looks tidier but is not safe: the offline stub carries
// placeholder taxonomy values (21911–21914) that collide with real Viator tag
// ids, which filed every stub dinner cruise under "Adventure Tours". An
// unrecognised group resolves to undefined and its items are left alone.
const GROUP_SECTION: Record<string, Section> = {
  'adventure-tours':        'adventures-outdoor',
  'watersports':            'cruises-water',
  'sailing-cruises':        'cruises-water',
  'food-drink-experiences': 'food-drink',
  'sightseeing-tours':      'tours-sightseeing',
  'art-culture-history':    'culture-history',
};
function groupSection(g: ViatorGroup): Section | undefined {
  return GROUP_SECTION[g.id];
}

export function regroupItems(groups: ViatorGroup[], items: ViatorItem[]): ViatorItem[] {
  // Canonical group per section; lowest display_order wins when two anchors
  // share one (Aruba ships both "Sailing & Cruises" and "Watersports" under
  // cruises-water).
  const canonical = new Map<Section, ViatorGroup>();
  for (const g of [...groups].sort((a, b) => a.display_order - b.display_order)) {
    const sec = groupSection(g);
    if (sec && !canonical.has(sec)) canonical.set(sec, g);
  }
  const sectionOfGroupId = new Map(groups.map((g) => [g.id, groupSection(g)]));

  return items.map((item) => {
    const sec = matchingSection(item);
    // Only CROSS-SECTION misfiling is corrected. If the item already sits in a
    // group belonging to its own section, leave it — the feed's choice between
    // two same-section anchors ("Sailing & Cruises" vs "Watersports" for a
    // snorkel trip) is a judgement call, not an error, and re-deciding it would
    // need per-item data the offline stub doesn't carry (its items have no
    // Viator tags, so every watersport would collapse into the sailing group).
    if (sectionOfGroupId.get(item.group_id) === sec) return item;
    const target = canonical.get(sec);
    return target && target.id !== item.group_id ? { ...item, group_id: target.id } : item;
  });
}

// Rank items by review_count within their budget tier and attach a
// popularity_score (0–1 percentile). Ranking within tier (not globally) fixes
// a systematic bias: expensive items always have fewer reviews than cheap ones
// because they target a smaller market, not because they're inferior. A private
// charter should compete against other luxury options; a party cruise against
// other mid-range ones. This keeps the budget-closeness signal in fitItem
// effective — a money-no-object user still gets the premium item.
function normalizePopularity(items: ViatorItem[]): ViatorItem[] {
  if (items.length === 0) return items;
  const byTier = new Map<string, ViatorItem[]>();
  for (const item of items) {
    const tier = budgetTag(item.price_usd);
    const bucket = byTier.get(tier) ?? [];
    bucket.push(item);
    byTier.set(tier, bucket);
  }
  const rankMap = new Map<string, number>();
  for (const tierItems of byTier.values()) {
    const sorted = [...tierItems].sort((a, b) => a.review_count - b.review_count);
    const n = sorted.length;
    sorted.forEach((item, i) => rankMap.set(item.id, n > 1 ? i / (n - 1) : 0.5));
  }
  return items.map((item) => ({ ...item, popularity_score: rankMap.get(item.id) ?? 0 }));
}

// Synchronous local stub — the instant first paint and the offline/failure
// fallback. Live Viator data (when configured) replaces groups+items via
// loadCatalog(); local activities always stay local. Memoised once: the stub is
// a compile-time constant, so re-normalising (sort + clone) on every call — and
// useCatalog reads it every render — is wasted work and hands back a fresh
// `items` array each time, defeating downstream useMemo keyed on catalog.items.
let stubCatalog: Catalog | null = null;
export function getCatalog(): Catalog {
  if (!stubCatalog) {
    stubCatalog = {
      activities: ACTIVITIES,
      groups: VIATOR_GROUPS,
      items: normalizePopularity(regroupItems(VIATOR_GROUPS, VIATOR_ITEMS.filter((i) => !isExcludedFromCatalog(i)))),
    };
  }
  return stubCatalog;
}

let liveCatalog: Catalog | null = null;
let inflight: Promise<Catalog> | null = null;

// Synchronous best-available catalog: the live one if already fetched, else the
// stub. Lets useCatalog() initialise without a flash on later navigations.
export function getCachedCatalog(): Catalog {
  return liveCatalog ?? getCatalog();
}

export type LocalMatch = {
  title?: string; rating?: number; review_count?: number;
  image_url?: string; viator_item_url?: string;
};

/**
 * Merges curated local-pick matches into the editorial activities: the matched
 * product's image, rating, reviews and affiliate link win; the editorial title
 * and blurb stay. Picks with no match pass through untouched.
 *
 * `ratingSource` is the honesty flag. A local pick's own `rating` is an
 * editorial ranking weight with no platform behind it, so the UI must not draw a
 * star for it; only a rating that genuinely arrived from Viator earns one. A
 * match can carry a link and no rating, so the link alone cannot stand in as
 * proof that a real number exists.
 */
export function mergeLocalMatches(
  activities: readonly Activity[],
  matches: Record<string, LocalMatch>,
): Activity[] {
  return activities.map((a) => {
    const m = matches[a.id];
    if (!m) return a;
    // Both numbers must be real, because the card prints them together. Keying
    // the flag on `rating` alone while `review_count` fell back independently
    // could pair a genuine 4.3 with the editorial count — "4.3 from 2,847
    // reviews" for a free public beach, which is the same fabrication wearing
    // one true number.
    const real = typeof m.rating === 'number' && m.rating > 0
      && typeof m.review_count === 'number';
    return {
      ...a,
      title: m.title || a.title,
      image: m.image_url || a.image,
      rating: real ? m.rating! : a.rating,
      reviewCount: real ? m.review_count! : a.reviewCount,
      ...(real ? { ratingSource: 'viator' as const } : {}),
      viator_item_url: m.viator_item_url,
    };
  });
}

// Fetch the live Viator catalog from the edge function once (memoised). Falls
// back to the stub if not configured or on any error. Never throws.
export function loadCatalog(): Promise<Catalog> {
  if (liveCatalog) return Promise.resolve(liveCatalog);
  if (inflight) return inflight;

  const fnUrl = import.meta.env.VITE_VIATOR_FN_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!fnUrl || !anon) return Promise.resolve(getCatalog());

  inflight = (async () => {
    try {
      const r = await fetch(fnUrl, {
        headers: { Authorization: `Bearer ${anon}`, apikey: anon },
      });
      if (!r.ok) throw new Error(`viator-cards ${r.status}`);
      const data = await r.json();
      const groups = data?.groups;
      const items = data?.items;
      if (data?.error || !Array.isArray(groups) || !Array.isArray(items) || items.length === 0) {
        throw new Error('viator-cards: empty/invalid payload');
      }
      const activities = mergeLocalMatches(ACTIVITIES, data?.localMatches ?? {});
      liveCatalog = {
        activities, groups,
        items: normalizePopularity(regroupItems(groups, items.filter((i) => !isExcludedFromCatalog(i)))),
      };
      return liveCatalog;
    } catch {
      return getCatalog(); // stub fallback
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function itemsInGroup(groupId: string, catalog: Catalog): ViatorItem[] {
  return catalog.items
    .filter((i) => i.group_id === groupId)
    .sort((a, b) => a.display_order - b.display_order);
}

export function otherItemsInGroup(groupId: string, bestSellerId: string, catalog: Catalog): ViatorItem[] {
  return itemsInGroup(groupId, catalog).filter((i) => i.id !== bestSellerId);
}

// Resolve a stored SlotEntry (id pointers) into a renderable CardEntry against
// the *current* catalog. The stored item id can go stale when the catalog swaps
// underneath the plan — the stub renders first, then the live Viator data swaps
// in with different product codes (and a daily refresh can change them again).
// When that happens we fall back to the group's current best-seller so the card
// still renders, instead of returning null and leaving the slot blank.
//
// This is also the single chokepoint that controls EVERY item a card shows —
// the plan stores only {groupId, bestSellerId}, so the face and the whole "Other
// suggestions" list (entry.others) are rebuilt here. When `tags` (the
// questionnaire answers) are passed, items that don't fit (e.g. an item far over
// budget) are dropped from both the face and the suggestions, and a stale or
// now-over-budget stored face self-heals to the best-fitting item — so no card
// can surface something the answers rule out, however the plan was produced.
export function resolveSlotEntry(
  slotEntry: SlotEntry, catalog: Catalog, tags?: Set<MatchTag>, slot?: Slot,
): CardEntry | null {
  if (slotEntry.kind === 'activity') {
    const a = catalog.activities.find((x) => x.id === slotEntry.id)
      ?? LUNCHSPOTS.find((x) => x.id === slotEntry.id);
    return a ? { kind: 'activity', activity: a } : null;
  }
  // Resolve by ITEM id first — the stored groupId is advisory, not authoritative.
  // What the traveller chose is the product (bestSellerId); which bucket it sat
  // in at the time is incidental, and it moves: regroupItems re-files mis-grouped
  // products at ingest, and the live feed's own grouping shifts between refreshes.
  // Trusting the stored groupId meant a regroup silently re-faced every saved trip
  // and every shared link to a DIFFERENT product — pinned "★ Your pick" included,
  // badge and all (measured: 195 of 333 stored entries). Falling back to the
  // stored groupId keeps a genuinely stale item id self-healing as before.
  const storedItem = catalog.items.find((x) => x.id === slotEntry.bestSellerId);
  const g = (storedItem && catalog.groups.find((x) => x.id === storedItem.group_id))
    ?? catalog.groups.find((x) => x.id === slotEntry.groupId);
  if (!g) return null;

  const all = itemsInGroup(g.id, catalog);
  if (all.length === 0) return null;

  // Pinned/staple short-circuit: return the stored item verbatim without any
  // fit/budget/slot re-facing — the user explicitly picked it (pinned), or it is
  // a curated island default chosen for being the most-booked option of its kind
  // (staple). Re-facing a staple would defeat the point, and on live data whose
  // group ids are unreliable it could swap the sunset sail for a UTV tour. If
  // the stored id has gone stale (live catalog refresh changed product codes),
  // fall through to normal self-healing so the card never blanks.
  if (slotEntry.pinned || slotEntry.staple) {
    const exact = all.find((x) => x.id === slotEntry.bestSellerId);
    if (exact) {
      return { kind: 'group', group: g, bestSeller: exact, others: all.filter((i) => i.id !== exact.id) };
    }
  }

  // Answer-aware + slot-aware filter, degrading gracefully so the card never
  // blanks: fit+slot → fit → slot → raw. The slot filter matters because the
  // plan stores only ids — without it this display chokepoint would happily
  // re-face an evening card to the best-FITTING item in the group even when
  // that item is a daytime tour, silently undoing the generator's evening
  // filter (a snorkel day-sail showing up in the evening slot).
  const fits = (i: ViatorItem) => !tags || !fitItem(i, tags).rejected;
  const slotOk = (i: ViatorItem) => slot === undefined || itemSlotOk(i, slot);
  const fitSlot = all.filter((i) => fits(i) && slotOk(i));
  const fitOnly = all.filter(fits);
  const slotOnly = all.filter(slotOk);
  const pool = fitSlot.length ? fitSlot : fitOnly.length ? fitOnly : slotOnly.length ? slotOnly : all;

  // Face: the stored pick if it's still in-budget, else the best-fitting item,
  // else the group best-seller / first.
  const bs = pool.find((x) => x.id === slotEntry.bestSellerId)
          ?? (tags ? bestItemForAnswers(pool, tags) : null)
          ?? pool.find((x) => x.is_best_seller)
          ?? pool[0];
  if (!bs) return null;
  return { kind: 'group', group: g, bestSeller: bs, others: pool.filter((i) => i.id !== bs.id) };
}
