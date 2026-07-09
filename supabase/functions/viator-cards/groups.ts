// Curated group → Viator anchor-tag mapping (approved + tuned against real Aruba
// inventory counts). Each group's Aruba products come from /products/search
// filtered by destination 28 + the anchor tag (tagIds[0]); filtering.tags is an
// AND and a parent tag also returns its children, so a single broad anchor is best.
//
// GROUPS are listed in CLAIM order (specific → broad) so cross-group de-dup gives
// each product to its most-relevant group: Sailing claims cruises before the broad
// "Adventure Tours" anchor would. UI order is set by `displayOrder`.
//
// matched_by / region / allowed_slots stay editorial — they drive the local
// questionnaire matcher, not Viator.

export const ARUBA_DESTINATION_ID = 28;
const PID = 'P00302487';

export type GroupConfig = {
  id: string;
  name: string;
  displayOrder: number;
  tagIds: number[]; // tagIds[0] is the anchor used for search
  matched_by: string[];
  region: string;
  allowed_slots: string[];
  viator_group_url: string;
};

export const GROUPS: GroupConfig[] = [
  {
    id: 'food-drink-experiences',
    name: 'Food & Drink Experiences',
    displayOrder: 4,
    tagIds: [21911], // Food & Drink (40 Aruba products)
    matched_by: ['food-drink', 'culture-history', 'couple', 'friends'],
    region: 'islandwide',
    allowed_slots: ['evening'],
    viator_group_url: `https://www.viator.com/Aruba/d28-ttd?pid=${PID}`,
  },
  {
    id: 'sailing-cruises',
    name: 'Sailing & Cruises',
    displayOrder: 3,
    tagIds: [21701], // Cruises & Sailing (233)
    matched_by: ['beach-chill', 'couple', 'cruise-day'],
    region: 'palm-beach',
    allowed_slots: ['afternoon', 'evening'], // afternoon day-sails + sunset/evening cruises
    viator_group_url: `https://www.viator.com/Aruba/d28-ttd?pid=${PID}`,
  },
  {
    id: 'watersports',
    name: 'Watersports',
    displayOrder: 2,
    tagIds: [20255], // Water Tours (67) — 13142 "Water Sports" returns 0 for Aruba
    matched_by: ['watersports', 'beach-chill', 'med-adventure', 'high-adventure'],
    region: 'palm-beach',
    allowed_slots: ['morning', 'afternoon'],
    viator_group_url: `https://www.viator.com/Aruba/d28-ttd?pid=${PID}`,
  },
  {
    id: 'adventure-tours',
    name: 'Adventure Tours',
    displayOrder: 1,
    tagIds: [22046], // Adventure Tours (105) — broad catch-all, claimed last
    matched_by: ['adventure', 'high-adventure', 'nature-hiking'],
    region: 'islandwide',
    allowed_slots: ['morning', 'afternoon'],
    viator_group_url: `https://www.viator.com/Aruba/d28-ttd?pid=${PID}`,
  },
  {
    id: 'sightseeing-tours',
    name: 'Sightseeing Tours',
    displayOrder: 5,
    tagIds: [21725], // Sightseeing Tours (158 Aruba) - land/city/island guided tours
    matched_by: ['culture-history', 'nature-hiking', 'couple', 'friends', 'multi-gen', 'low-adventure'],
    region: 'islandwide',
    allowed_slots: ['morning', 'afternoon', 'evening'], // sunset/evening tours exist
    viator_group_url: `https://www.viator.com/Aruba/d28-ttd?pid=${PID}`,
  },
  {
    id: 'art-culture-history',
    name: 'Culture & History',
    displayOrder: 6,
    tagIds: [21910], // Art & Culture (89 Aruba) - museums, historic & cultural tours
    matched_by: ['culture-history', 'couple', 'friends', 'multi-gen', 'low-adventure'],
    region: 'islandwide',
    allowed_slots: ['morning', 'afternoon', 'evening'],
    viator_group_url: `https://www.viator.com/Aruba/d28-ttd?pid=${PID}`,
  },
];
