import type { MatchTag } from '../types';
import type { Day } from './activities';

/**
 * Which itineraries the Map's switcher offers, and which one it opens on.
 *
 * Pure on purpose. The Map itself cannot be rendered in a node test — it pulls
 * in mapbox-gl — so the two rules that decide what a traveller sees live here
 * where they can be tested directly:
 *
 *   1. Saved itineraries REPLACE the generated ones, they do not join them.
 *      A traveller with saved trips is looking at their own plans; a traveller
 *      with none still gets the three generated explorations, which is what
 *      every visitor got before saved trips were listed here at all.
 *   2. Each saved trip carries its OWN tags. A trip planned before the
 *      questionnaire was retaken must not have its card faces resolved by
 *      answers it was never planned against.
 */

export type Variant = { label: string; description: string; plan: Day[]; tags: Set<MatchTag> };

/** The minimum a saved trip has to expose to become a tab. */
export type VariantTrip = { id: string; label: string; plan: Day[]; tags: Set<MatchTag> };

/** A generated fallback: a fixed label/description with the plan it describes. */
export type GeneratedVariant = { label: string; description: string; plan: Day[]; tags: Set<MatchTag> };

export function buildVariants(
  saved: VariantTrip[],
  generated: GeneratedVariant[],
  savedDescription: string,
): Variant[] {
  if (saved.length === 0) return generated.map((g) => ({ ...g }));
  return saved.map((t) => ({
    label: t.label,
    description: savedDescription,
    plan: t.plan,
    tags: t.tags,
  }));
}

/**
 * Which tab to open on: the itinerary the planner is currently editing, so the
 * Map and the Itinerary page agree about which trip you are looking at. Falls
 * back to 0 — the most recently touched, since `listTrips` orders by
 * `updated_at` — when nothing is selected or the selected trip is gone.
 */
export function initialPlanIdx(saved: { id: string }[], activeTripId: string | null): number {
  if (!activeTripId) return 0;
  const at = saved.findIndex((t) => t.id === activeTripId);
  return at >= 0 ? at : 0;
}

/**
 * Keep a selected tab index inside a list that can SHRINK under it.
 *
 * Signing out drops a traveller from N saved itineraries back to the three
 * generated ones. Without this, an index past the new end resolved to
 * `undefined` and the Map hid its whole bottom panel — switcher, day nav, cards
 * — along with the route and pins, with no way back but leaving the page.
 * Clamping to the last tab keeps something selected instead.
 */
export function clampPlanIdx(idx: number, count: number): number {
  return Math.min(Math.max(idx, 0), Math.max(count - 1, 0));
}
