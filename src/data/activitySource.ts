import { ACTIVITIES, type Activity } from './activities';
import { VIATOR_GROUPS, VIATOR_ITEMS } from './viator-stub';
import type { ViatorGroup, ViatorItem } from '../types';

export type Catalog = {
  activities: Activity[];
  groups: ViatorGroup[];
  items: ViatorItem[];
};

// v1.0: returns from the local stub. v1.1: swap body for a Supabase fetch
// with the same return shape; component code never knows the difference.
export function getCatalog(): Catalog {
  return {
    activities: ACTIVITIES,
    groups: VIATOR_GROUPS,
    items: VIATOR_ITEMS,
  };
}

export function itemsInGroup(groupId: string, catalog: Catalog): ViatorItem[] {
  return catalog.items
    .filter((i) => i.group_id === groupId)
    .sort((a, b) => a.display_order - b.display_order);
}

export function otherItemsInGroup(groupId: string, bestSellerId: string, catalog: Catalog): ViatorItem[] {
  return itemsInGroup(groupId, catalog).filter((i) => i.id !== bestSellerId);
}
