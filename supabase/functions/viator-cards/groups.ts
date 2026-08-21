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
    // Added 2026-08-21 on the owner's curation request. The immediate cause was
    // one product — "Guided Padi Discover Scuba Diving for Non-Certified
    // Divers" (250774P5, $120, rating 5.0, 50 reviews), the best-rated
    // non-certified dive on the island, which was absent from the site while
    // being live on Viator. It carries none of the six anchors above, so no
    // amount of matcher work could reach it: the ingest searches BY TAG, and
    // nothing was asking for diving.
    //
    // It is not alone. Tag 12021 returns 14 Aruba products; we already hold 8
    // of them through other anchors, so this adds SIX, and the five with real
    // review counts are all well reviewed: 8936P3 "Aruba Certified Scuba
    // Diving" (320), 2785DIVE (220), 106422P1 "Small-Group Aruba Scuba Diving
    // for Non-Certified Divers" (208), 2785RESORT (103) and 250774P5 (50).
    //
    // CLAIM ORDER, stated accurately: this sits after `sailing-cruises` (21701)
    // and `watersports` (20255), and all 13 dives already in the catalog are
    // claimed by `sailing-cruises`. So this group adds the six it alone reaches
    // and does NOT gather the island's established dives — "Diving" will hold 6
    // while 13 more sit under Sailing & Cruises. That is a curation decision,
    // and the alternative (moving this above `sailing-cruises`, which would
    // pull all 19 together and take 13 cards out of Sailing & Cruises) is a
    // visible Explore change that should be made on purpose rather than as a
    // side effect of reaching one product.
    //
    // An earlier draft of this comment claimed the opposite. It was written
    // from intent rather than from the array order, and the group was in fact
    // placed after both broad anchors.
    //
    // Note for whoever measures the effect: `bookableTier` still returns null
    // for every dive, by the "Diving is deliberately out" ruling in
    // docs/superpowers/specs/2026-08-18-bookable-density-design.md. Ingesting
    // them puts them in Explore and on the Swap shelf; it does NOT auto-place
    // them. Auto-placement is a separate, narrower rule the owner scoped to
    // adventure travellers on trips longer than 10 days.
    id: 'diving',
    name: 'Diving',
    // 7, not 3: `sailing-cruises` already holds 3. `regroupItems` breaks ties
    // for a shared section on LOWEST display_order, so a collision decides
    // which group is canonical for cruises-water by accident.
    displayOrder: 7,
    tagIds: [12021], // Scuba Diving (14 Aruba products)
    matched_by: ['adventure', 'high-adventure', 'watersports'],
    region: 'islandwide',
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
