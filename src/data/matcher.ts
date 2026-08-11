import type { Activity } from './activities';
import type { ViatorGroup, ViatorItem, MatchTag, CardEntry, Slot } from '../types';

type PoolFilters = {
  rejectedIds: Set<string>;
  rejectedGroupIds: Set<string>;
};

const SLOT_TO_TOD: Record<Slot, Activity['timeOfDay']> = {
  morning:   'Morning',
  afternoon: 'Afternoon',
  evening:   'Evening',
};

function hasOverlap(tags: MatchTag[], answerTags: Set<MatchTag>): boolean {
  if (tags.length === 0) return true;          // wildcard rule
  return tags.some((t) => answerTags.has(t));
}

export function matchPool(
  activities: Activity[],
  groups: ViatorGroup[],
  answerTags: Set<MatchTag>,
  slot: Slot,
): { activities: Activity[]; groups: ViatorGroup[] } {
  const tod = SLOT_TO_TOD[slot];

  const matchedActivities = activities.filter((a) =>
    a.timeOfDay === tod && hasOverlap(a.matched_by, answerTags),
  );

  const matchedGroups = groups.filter((g) => {
    const slotOk = g.allowed_slots.length === 0 || g.allowed_slots.includes(slot);
    return slotOk && hasOverlap(g.matched_by, answerTags);
  });

  return { activities: matchedActivities, groups: matchedGroups };
}

export function blendPools(
  activities: Activity[],
  groups: ViatorGroup[],
  items: ViatorItem[],
  filters: PoolFilters,
): CardEntry[] {
  const out: CardEntry[] = [];

  // Groups first (commercial tie-breaker on equal fit).
  for (const g of groups) {
    if (filters.rejectedGroupIds.has(g.id)) continue;
    const bestSeller = items.find((i) => i.group_id === g.id && i.is_best_seller);
    if (!bestSeller) continue;                  // data integrity guard
    const others = items
      .filter((i) => i.group_id === g.id && i.id !== bestSeller.id)
      .sort((a, b) => a.display_order - b.display_order);
    out.push({ kind: 'group', group: g, bestSeller, others });
  }

  // Then local picks.
  for (const a of activities) {
    if (filters.rejectedIds.has(a.id)) continue;
    out.push({ kind: 'activity', activity: a });
  }

  return out;
}

// --- Price ------------------------------------------------------------------
// Narrowing a swap pool by a "Why swap?" chip used to live here as
// constrainBySwapReason. It moved to editConstraint.ts, where the chips and a
// traveller's own words resolve to the same EditConstraint and run the same
// code. These two readers stay because half the app prices a card with them.

// Parse a "from" price out of a local activity cost string.
// "Free" / "Free + $10 rental" → 0; "$65 guided" → 65; "$8–15 pp" → 8.
export function parseActivityCost(cost: string): number {
  if (/free/i.test(cost)) return 0;
  const m = cost.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

export function entryPrice(e: CardEntry): number {
  return e.kind === 'group' ? e.bestSeller.price_usd : parseActivityCost(e.activity.cost);
}
