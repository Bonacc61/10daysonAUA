import { LUNCHSPOTS } from './lunchspots';
import { viatorLink, bookUrlForActivity } from './exploreItems';
import { resolveSlotEntry, type Catalog } from './activitySource';
import type { Activity } from './activities';
import type { SlotEntry, MatchTag, Slot, ViatorItem } from '../types';

/**
 * What a stored slot entry actually IS, and where it books.
 *
 * Extracted from `Map.tsx` on 2026-08-19 so the link rule could be tested at
 * all — the bug below lived inside a React component that nothing renders in
 * the suite, and `tsc` was the only thing looking at it.
 */

/**
 * Local ('activity'-kind) entries are usually catalog activities, but curated
 * lunch spots (added by the "Suggest lunch spot" button or the en-route
 * suggestion) live outside the catalog in LUNCHSPOTS — check both so their
 * cards resolve instead of falling back to the raw id.
 */
export function localActivity(id: string, catalog: Catalog): Activity | undefined {
  return catalog.activities.find((a) => a.id === id) ?? LUNCHSPOTS.find((l) => l.id === id);
}

/**
 * The item a stored card ACTUALLY renders as. The plan stores only ids and the
 * live catalog moves under them, so this goes through `resolveSlotEntry` — the
 * display chokepoint — rather than looking the id up directly.
 */
export function faceOf(entry: SlotEntry, catalog: Catalog, tags: Set<MatchTag>, slot?: Slot): ViatorItem | null {
  if (entry.kind === 'activity') return null;
  const resolved = resolveSlotEntry(entry, catalog, tags, slot);
  return resolved?.kind === 'group' ? resolved.bestSeller : null;
}

/**
 * The book link behind an entry, and whether it earns a commission.
 *
 * The activity branch goes through `bookUrlForActivity`, and that is the fix
 * this module was extracted for (reported 2026-08-19 against the Flamingo pin
 * on the Map). The map used to read `viator_item_url` off the activity
 * directly, and that field reaches a curated pick from exactly one place:
 * `mergeLocalMatches` (activitySource.ts), which stamps it onto the FOUR ids in
 * the edge function's `LOCAL_MATCHES` — boca-catalina-snorkel,
 * antilla-wreck-dive, natural-pool-jeep, oranjestad-walking. Those four had a
 * working link and still do. Every other curated pick had none, because no
 * record in `activities.ts` or `lunchspots.ts` carries the field statically.
 *
 * `flamingo-renaissance` is the one that mattered: it is paid, it is the only
 * curated pick in the repo with a `bookingUrl`, and it is not in LOCAL_MATCHES
 * — so it is the single activity whose behaviour this change alters. The rest
 * of the unlinked ones are free, and stay unlinked.
 *
 * A free activity still yields null: `bookUrlForActivity` refuses anything
 * costing nothing, and a "book" link to a public beach is worse than no link.
 */
export function bookLinkFor(
  entry: SlotEntry, catalog: Catalog, tags: Set<MatchTag>, slot?: Slot,
): { url: string; affiliate: boolean } | null {
  if (entry.kind === 'activity') {
    const a = localActivity(entry.id, catalog);
    return a ? bookUrlForActivity(a) : null;
  }
  const raw = faceOf(entry, catalog, tags, slot)?.viator_item_url;
  return raw ? { url: viatorLink(raw), affiliate: true } : null;
}
