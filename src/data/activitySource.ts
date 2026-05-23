import { ACTIVITIES, type Activity } from './activities';
import { VIATOR_GROUPS, VIATOR_ITEMS } from './viator-stub';
import type { ViatorGroup, ViatorItem } from '../types';

export type Catalog = {
  activities: Activity[];
  groups: ViatorGroup[];
  items: ViatorItem[];
};

// Synchronous local stub — the instant first paint and the offline/failure
// fallback. Live Viator data (when configured) replaces groups+items via
// loadCatalog(); local activities always stay local.
export function getCatalog(): Catalog {
  return {
    activities: ACTIVITIES,
    groups: VIATOR_GROUPS,
    items: VIATOR_ITEMS,
  };
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
      liveCatalog = { activities: ACTIVITIES, groups, items };
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
