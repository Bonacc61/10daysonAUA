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
  | 'palm-beach' | 'eagle-beach' | 'downtown' | 'noord' | 'cruise-day'
  // From the Q8 `influencer` flag. Unlike every tag above it, nothing in
  // classifyTags() ever emits this for a product — no group or activity carries
  // it in matched_by, so it never scores through the normal overlap loop. It is
  // read explicitly by contentCreatorBonus() and by the auto-fill gate.
  | 'influencer'
  // From the Q8 `avoid-crowds` flag. Same shape as `influencer` above: no
  // product carries it, so it never scores through the overlap loop — fitItem
  // reads it explicitly to invert the popularity preference.
  | 'avoid-crowds';

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
  // --- Enrichment (src/data/enrichment.json, merged at catalog load) --------
  // Derived offline from the product's own listing and accepted by a human.
  // All optional by design: an item without them behaves exactly as it did
  // before enrichment existed.
  enriched_kind?: string;   // read by activityKind() ONLY where tags say nothing
  physical?: { demand: 'low' | 'moderate' | 'high'; mobility_ok: boolean };
  kids?: { min_age: number; baby_ok: boolean };
  // Verbatim span from the description backing `physical`/`kids`. The UI renders
  // THIS, never a paraphrase — quoting the operator is not the site making a
  // claim. No evidence, no copy.
  evidence?: string;
  // Catalog-relative popularity percentile (0–1), computed at catalog load time
  // from review_count rank across all items. The most-reviewed item in the catalog
  // scores 1.0; the least scores 0.0. Self-normalising: rescales automatically
  // as the catalog grows or review counts compound.
  popularity_score?: number;
  /**
   * Whether this product suits a 1-3 year old. INTERNAL AND FILTER-ONLY — read
   * by the search pool, never rendered and never quoted, because the judgement
   * behind it produced the model's own prose rather than a span from the
   * listing. `kids` is the renderable pair; this is not.
   *
   * Absent means unjudged or judged at low confidence, which is not the same as
   * `false`: an unknown is never excluded by a negative constraint.
   */
  toddler_ok?: boolean;
  /**
   * Where the activity physically happens, and what the traveller is aboard.
   * Both derived offline and accepted by a human, like every other enrichment
   * field. Filter-only: read by the search pool, never rendered, so neither
   * carries an evidence quote. `vessel: null` means explicitly not a vessel;
   * absent means unjudged.
   */
  setting?: 'beach' | 'ocean' | 'land' | 'town' | 'mixed';
  vessel?: 'boat' | 'catamaran' | 'submarine' | 'jetski' | null;
  /**
   * Viator's own merchandising flags, verbatim: LIKELY_TO_SELL_OUT,
   * FREE_CANCELLATION, PRIVATE_TOUR, NEW_ON_VIATOR, SPECIAL_OFFER.
   *
   * Reported, never computed. Viator's product page also shows a demand stat
   * ("booked 30 days in advance on average") and that figure is NOT in the API —
   * not in /products/search, not in /products/{code}. LIKELY_TO_SELL_OUT is the
   * nearest thing they actually publish, and it is theirs to assert.
   */
  flags?: string[];
};

// === Slot pointers + card entries ===
// `staple`: an island default the generator places for every traveller (sunrise
// beach, catamaran sail, beach at sunset, dinner by the water) rather than something the
// answers produced. Like `pinned` it fixes the card's face; unlike `pinned` it
// is ours, not the user's, so it carries its own badge. Additive and optional —
// older stored plans and shared snapshots deserialise unchanged.
export type SlotEntry =
  | { kind: 'activity'; id: string; pinned?: boolean; splurge?: boolean; staple?: boolean }
  | { kind: 'group'; groupId: string; bestSellerId: string; pinned?: boolean; splurge?: boolean; staple?: boolean };

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
