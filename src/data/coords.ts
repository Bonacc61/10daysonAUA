import type { SlotEntry } from '../types';
import { pinFor } from './itemCoords';

export type Coord = { lng: number; lat: number };

/**
 * Coordinate for a planned slot entry, from the pin registry.
 *
 * Returns undefined when the item has no researched coordinate. There is
 * deliberately NO fallback. This file used to hold three tables, the last of
 * which — GROUP_COORDS — gave ~340 catalog items one of six invented points, one
 * per Viator category. The map drew those as fact and the engine treated them as
 * geography, so a Palm Beach ATV and a Conchi jeep tour both sat at the Arikok
 * gate and scored zero distance from each other while being 15km apart.
 *
 * All 29 ACTIVITY_COORDS migrated into src/data/itemCoords.ts and were
 * machine-compared 29/29 identical at the time of the move. Three were
 * afterwards CORRECTED against OpenStreetMap on their own merits, and the
 * registry records each: tres-trapi was 4.94km out (near Palm Beach, where no
 * such spot exists), malmok-beach ~300m, lunch-oniels ~570m.
 *
 * Eight VIATOR_ITEM_COORDS entries were initially dropped by the migration and
 * restored once the ship gate caught it. Only the six invented GROUP_COORDS
 * centroids are gone by intent.
 *
 * Callers that get undefined must treat the entry as geographically neutral —
 * see geoPenalty in itineraryGenerator.ts, and docs/matching-engine/geography.md
 * for what that means for day clustering.
 */
export function coordForEntry(e: SlotEntry): Coord | undefined {
  return pinFor(e.kind === 'activity' ? e.id : e.bestSellerId)?.coord;
}
