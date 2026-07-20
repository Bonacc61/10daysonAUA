import { ACTIVITIES, type Activity } from './activities';
import { VIATOR_GROUPS, VIATOR_ITEMS } from './viator-stub';
import { LUNCHSPOTS } from './lunchspots';
import { fitItem, bestItemForAnswers, itemSlotOk } from './itemFit';
import { budgetTag } from './classify';
import type { ViatorGroup, ViatorItem, SlotEntry, CardEntry, MatchTag, Slot } from '../types';

export type Catalog = {
  activities: Activity[];
  groups: ViatorGroup[];
  items: ViatorItem[];
};

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
    stubCatalog = { activities: ACTIVITIES, groups: VIATOR_GROUPS, items: normalizePopularity(VIATOR_ITEMS) };
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
      // Merge curated local-pick matches: override image/rating/reviews + attach
      // the affiliate link, keeping the editorial title/blurb. Editorial picks
      // (no match) pass through unchanged.
      const matches: Record<string, {
        title?: string; rating?: number; review_count?: number; image_url?: string; viator_item_url?: string;
      }> = data?.localMatches ?? {};
      const activities = ACTIVITIES.map((a) => {
        const m = matches[a.id];
        if (!m) return a;
        return {
          ...a,
          title: m.title || a.title,
          image: m.image_url || a.image,
          rating: typeof m.rating === 'number' && m.rating > 0 ? m.rating : a.rating,
          reviewCount: typeof m.review_count === 'number' ? m.review_count : a.reviewCount,
          viator_item_url: m.viator_item_url,
        };
      });
      liveCatalog = { activities, groups, items: normalizePopularity(items) };
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
  const g = catalog.groups.find((x) => x.id === slotEntry.groupId);
  if (!g) return null;

  const all = itemsInGroup(g.id, catalog);
  if (all.length === 0) return null;

  // Pinned short-circuit: the user explicitly picked this item, so return it
  // verbatim without any fit/budget/slot re-facing. If the stored id has gone
  // stale (live catalog refresh changed product codes), fall through to normal
  // self-healing so the card never blanks.
  if (slotEntry.pinned) {
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
