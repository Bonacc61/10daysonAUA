import type { Activity } from './activities';
import type { Catalog } from './activitySource';
import type { MatchTag, Slot } from '../types';

/* ------------------------------------------------------------------ *
 * The curated "Balanced" template.                                    *
 * ------------------------------------------------------------------ *
 * A hand-built 10-day shape for the middle of both sliders, used as the
 * STARTING POINT for those travellers rather than as the whole plan.
 * The generator places these first, then fills whatever is left with
 * its normal machinery — so trip lengths other than 10 days, the
 * evening slots the template does not address, and every other persona
 * all keep working exactly as before.
 *
 * Why a table of (day, slot, id) rather than pins: a pin lands in the
 * slot its CARD declares (`getPinSlotPrefs` reads `timeOfDay`), and the
 * template deliberately disagrees with several cards — Eagle Beach is a
 * morning card placed here in an afternoon, Palm Beach an afternoon card
 * placed in a morning. The curated distribution is the point, so the
 * template names the slot itself.
 *
 * Repeats are intentional and legal: Eagle Beach on 1/6/9, Palm Beach on
 * 5/10, Mangel Halto on 3/8. Free local beaches may be revisited after a
 * clear day (see REVISITABLE_MIN_DAY_GAP) — you do go back to a beach.
 *
 * Gaps are intentional too. Day 5 afternoon (a sunset sail) and day 8
 * morning are left to the engine: the sail has no curated card, and the
 * template itself marks day 8 morning and day 10 afternoon as free.
 */

export type TemplateEntry = { day: number; slot: Slot; id: string };

export const BALANCED_TEMPLATE: TemplateEntry[] = [
  { day: 1,  slot: 'morning',   id: 'tres-trapi' },
  { day: 1,  slot: 'afternoon', id: 'eagle-beach-morning' },
  { day: 2,  slot: 'morning',   id: 'antilla-wreck-dive' },
  { day: 2,  slot: 'afternoon', id: 'alto-vista-chapel' },
  { day: 3,  slot: 'morning',   id: 'mangel-halto' },
  { day: 3,  slot: 'afternoon', id: 'baby-beach-snorkel' },
  { day: 4,  slot: 'morning',   id: 'natural-pool-jeep' },
  { day: 4,  slot: 'afternoon', id: 'arashi-beach' },
  { day: 5,  slot: 'morning',   id: 'palm-beach-strip' },
  // day 5 afternoon — sunset sail, no curated card; engine fills
  { day: 6,  slot: 'morning',   id: 'eagle-beach-morning' },
  { day: 6,  slot: 'afternoon', id: 'california-dunes-sunset' },
  { day: 7,  slot: 'morning',   id: 'san-nicolas-murals' },
  { day: 7,  slot: 'afternoon', id: 'rodgers-beach' },
  // day 8 morning — free in the template
  { day: 8,  slot: 'afternoon', id: 'mangel-halto' },
  { day: 9,  slot: 'morning',   id: 'boca-catalina-shore' },
  { day: 9,  slot: 'afternoon', id: 'eagle-beach-morning' },
  { day: 10, slot: 'morning',   id: 'palm-beach-strip' },
  // day 10 afternoon — free in the template
];

/**
 * Whether this traveller gets the template: the middle of BOTH sliders.
 * `med-adventure` is adventureLevel 34–66 and `mid-range` is the Mid-range
 * budget answer — the product's own definitions, not a second opinion.
 */
export function isBalancedTraveller(tags: Set<MatchTag>): boolean {
  return tags.has('med-adventure') && tags.has('mid-range');
}

export type ResolvedTemplateEntry = { day: number; slot: Slot; activity: Activity };

/**
 * Template entries that can actually be placed on this trip: within the trip
 * length, and still present in the (already flag-filtered) catalog — so a
 * `no-car` traveller silently loses the entries that need one rather than
 * having them forced in.
 */
export function resolveBalancedTemplate(catalog: Catalog, nDays: number): ResolvedTemplateEntry[] {
  const byId = new Map(catalog.activities.map((a) => [a.id, a]));
  const out: ResolvedTemplateEntry[] = [];
  for (const e of BALANCED_TEMPLATE) {
    if (e.day > nDays) continue;
    const activity = byId.get(e.id);
    if (activity) out.push({ day: e.day, slot: e.slot, activity });
  }
  return out;
}
