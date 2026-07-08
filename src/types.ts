// === Match tag vocabulary ===
// Stable string keys derived from questionnaire answers. Used by both pool A
// (Activity.matched_by) and pool B (ViatorGroup.matched_by). Drift between
// the two breaks the matcher silently — keep this list as the single source.
export type MatchTag =
  // From `interests` (multi-select)
  | 'beach-chill'
  | 'nature-hiking'
  | 'watersports'
  | 'food-drink'
  | 'adventure'
  | 'culture-history'
  | 'nightlife'
  | 'wellness-spa'
  // From `groupType` (single-select)
  | 'solo' | 'couple' | 'friends'
  | 'family-young-kids' | 'family-teens' | 'multi-gen'
  // From `budget` (single-select)
  | 'budget' | 'mid-range' | 'treat-yourself' | 'money-no-object'
  // From `adventureLevel` (banded 0-100)
  | 'low-adventure' | 'med-adventure' | 'high-adventure'
  // From `lodging` (single-select) — maps to region
  | 'palm-beach' | 'eagle-beach' | 'downtown' | 'noord' | 'cruise-day';

export type Region =
  | 'palm-beach' | 'eagle-beach' | 'noord' | 'oranjestad'
  | 'san-nicolas' | 'arikok' | 'savaneta' | 'islandwide';

export type Slot = 'morning' | 'afternoon' | 'evening';

// Explore taxonomy — Viator-tag-driven sections (see exploreItems.ts for the
// tag→section map). Beaches & culture-history are local-only (no Viator tags).
export type Section =
  | 'cruises-water' | 'adventures-outdoor' | 'tours-sightseeing'
  | 'food-drink' | 'culture-history' | 'beaches';

// === Viator group + item ===
export type ViatorGroup = {
  id: string;
  name: string;
  tagline: string;
  viator_taxonomy: string;
  viator_group_url: string;
  display_order: number;
  matched_by: MatchTag[];
  region: Region;
  allowed_slots: Slot[];   // empty = any
};

export type ViatorItem = {
  id: string;
  group_id: string;
  title: string;
  image_url: string;
  price_usd: number;
  duration: string;
  rating: number;
  review_count: number;
  viator_item_url: string;
  is_best_seller: boolean;
  display_order: number;
  region?: Region;         // overrides group region if set
  adventure?: number;      // curated 0 (chill) … 100 (adrenaline); drives the Explore Vibe slider
  tags?: number[];         // Viator taxonomy tag ids → mapped to Explore sections
  sections?: Section[];    // editorial override (stub items); live items derive sections from tags
  description?: string;    // 2-3 sentence summary; rendered in the Explore variant body
  fitReason?: string;      // short coral chip — why this matches (mirrors Activity.fitReason)
  reddit_quote?: { rating: number; mentions: number; quote: string };
  ta_quote?: string;
  // Assigned at ingest by embedding-based clustering (viator-cards edge fn).
  // Items sharing a cluster id represent the same real-world experience across
  // different operators/product codes. The generator deduplicates by this id.
  experience_cluster_id?: string;
};

// === Slot pointers + card entries ===
export type SlotEntry =
  | { kind: 'activity'; id: string; pinned?: boolean }
  | { kind: 'group'; groupId: string; bestSellerId: string; pinned?: boolean };

export type CardEntry =
  | { kind: 'activity'; activity: import('./data/activities').Activity }
  | { kind: 'group';
      group: ViatorGroup;
      bestSeller: ViatorItem;
      others: ViatorItem[] };

// === Swap reasons (already shipped as inline literals) ===
export type SwapReason =
  | 'too-pricey'
  | 'done-it'
  | 'too-far'
  | 'just-show-another'
  | 'not-our-vibe';
