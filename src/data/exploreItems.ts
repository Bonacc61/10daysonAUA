import type { Activity } from './activities';
import type { ViatorGroup, ViatorItem, MatchTag, Section } from '../types';
import type { Catalog } from './activitySource';
import { parseActivityCost } from './matcher';
import { durationMinutes } from './itineraryGenerator';
import { isWaterBased, adventureCapForFlags, fitItem } from './itemFit';
import { activityTags } from './answerTags';

// Content bucket for a tile — CATEGORIES without the 'All' filter sentinel.
// Retained only as the last-resort input to the adventure (vibe) proxy.
export type Category = 'Beaches' | 'Activities' | 'Watersports' | 'Food' | 'Tours';

// === Explore sections (Viator-tag driven taxonomy) =========================
// Tab order also defines each entry's "primary" section (first match wins).
export const SECTIONS: { key: Section; label: string }[] = [
  { key: 'cruises-water', label: 'Cruises & Water' },
  { key: 'adventures-outdoor', label: 'Adventures & Outdoor' },
  { key: 'tours-sightseeing', label: 'Tours & Sightseeing' },
  { key: 'food-drink', label: 'Food & Drink' },
  { key: 'culture-history', label: 'Culture & History' },
  { key: 'beaches', label: 'Beaches' },
];
const SECTION_ORDER = SECTIONS.map((s) => s.key);

// Viator CATEGORY tag id → section. Only real category tags are listed; the many
// attribute/quality tags products also carry (Private & Luxury, Shore Excursions,
// Weather Dependent, …) are intentionally ignored. Tuned to Aruba's live tree.
const TAG_SECTION: Record<number, Section> = {
  // Cruises & Water (On the Water cluster + cruises/sailing + water tours)
  21442: 'cruises-water', 21701: 'cruises-water', 20255: 'cruises-water',
  11912: 'cruises-water', 11888: 'cruises-water', 12047: 'cruises-water',
  12021: 'cruises-water', 12062: 'cruises-water', 11974: 'cruises-water',
  11885: 'cruises-water', 11963: 'cruises-water',
  // Adventures & Outdoor (extreme + on-the-ground + nature/wildlife + adventure)
  11923: 'adventures-outdoor', 11903: 'adventures-outdoor', 21440: 'adventures-outdoor',
  22046: 'adventures-outdoor', 21704: 'adventures-outdoor', 12035: 'adventures-outdoor',
  21421: 'adventures-outdoor', 12038: 'adventures-outdoor', 11902: 'adventures-outdoor',
  11973: 'adventures-outdoor',
  // Food & Drink (incl. classes/workshops: cooking, sip & paint)
  21911: 'food-drink', 21915: 'food-drink', 11891: 'food-drink', 21567: 'food-drink',
  // Tours & Sightseeing (guided land/city/island tours)
  21725: 'tours-sightseeing', 21768: 'tours-sightseeing',
  // Culture & History (art & culture cluster)
  21910: 'culture-history', 21511: 'culture-history', 21516: 'culture-history',
};

// Sections from a product's Viator tags. Unmapped/attribute-only → catch-all
// (Tours & Sightseeing), so nothing is ever hidden.
export function sectionsForTags(tags?: number[]): Section[] {
  const out = new Set<Section>();
  for (const t of tags ?? []) { const s = TAG_SECTION[t]; if (s) out.add(s); }
  if (out.size === 0) out.add('tours-sightseeing');
  return [...out];
}

// Primary (first by tab order) section — used for the card header label.
export function primarySection(sections: Section[]): Section {
  for (const key of SECTION_ORDER) if (sections.includes(key)) return key;
  return 'tours-sightseeing';
}

export function sectionLabel(key: Section): string {
  return SECTIONS.find((s) => s.key === key)?.label ?? '';
}

const PID = 'P00302487';
const MCID = '42383';
const AFFILIATE = `pid=${PID}&mcid=${MCID}&medium=link`;

// Viator category page for each section — affiliate-tagged, opens in a new tab.
export const SECTION_VIATOR_URL: Partial<Record<Section, string>> = {
  'cruises-water':      `https://www.viator.com/Aruba-tours/Cruises-Sailing-and-Water-Tours/d28-g3?${AFFILIATE}`,
  'adventures-outdoor': `https://www.viator.com/Aruba-tours/Adventure-Tours/d28-tag22046/2?${AFFILIATE}`,
  'tours-sightseeing':  `https://www.viator.com/Aruba-tours/Full-day-Tours/d28-g12-c94?${AFFILIATE}`,
  'culture-history':    `https://www.viator.com/Aruba-tours/Cultural-and-Theme-Tours/d28-g4?${AFFILIATE}`,
  // food-drink: URL to be added
  // beaches: no Viator category page
};

// A single renderable Explore tile: a Viator item or a local pick, pre-tagged
// with its category and resolved adventure value so the view never recomputes.
export type ExploreEntry =
  | { kind: 'item'; item: ViatorItem; category: Category; adventure: number; sections: Section[] }
  | { kind: 'activity'; activity: Activity; category: Category; adventure: number; sections: Section[] };

// Every count in this section was measured on 2026-08-16 against the catalog
// EXPLORE ACTUALLY RENDERS — the 328 products left after `isExcludedFromCatalog`
// drops transfers, party buses and retail errands, plus 22 of the 26 local picks
// (the other 4 are deduped against the products they were matched to). Not
// the 366-product raw viator-cards payload, which contains classes of product
// (private airport transfers above all) that no traveller ever sees here and
// which would flatter some of these shares. Each number is the reason a control
// exists, or the reason one doesn't.

// How long an activity runs, in bands a traveller plans a day around.
export type DurationBand = 'any' | 'short' | 'half' | 'long' | 'full';

// Who wrote the tile: everything, our own hand-written picks, or Viator's
// bookable products. 22 local picks sit under 328 products, so without this
// there is no way to browse the free beaches and viewpoints at all.
//
// 'free' is the odd one out and deliberately so — it asks about price, not
// about who wrote the tile, and it shares this row because the row is the
// traveller's "show me only…" control rather than a taxonomy. The cost is that
// it cannot be combined with 'local': choosing one clears the other. Today that
// costs nothing, since every Viator product has a price and so every free entry
// is already a local pick — but a $0 product would make the two worth stacking,
// and that is the day to split this into two independent filters.
export type Provenance = 'all' | 'local' | 'bookable' | 'free';

export type SortKey = 'recommended' | 'price-asc' | 'price-desc' | 'rating' | 'reviews';

// The extra filters are all OPTIONAL, and omitting them all reproduces the
// pre-filter behaviour exactly — which is what lets the My Aruba dashboard keep
// calling this with the four original fields and get the list it always got.
export type ExploreFilters = {
  section: string;
  search: string;
  vibe: number;
  price: number;
  minStars?: number;        // 0 = any
  minReviews?: number;      // 0 = any
  duration?: DurationBand;
  privateOnly?: boolean;
  provenance?: Provenance;
};

// Map a Viator group id → existing UI category bucket. New groups: 1 line each.
const GROUP_TAXONOMY_TO_CATEGORY: Record<string, Category> = {
  'adventure-tours': 'Activities',
  'watersports': 'Watersports',
  'sailing-cruises': 'Tours',
  'food-drink-experiences': 'Food',
  'sightseeing-tours': 'Tours',
  'art-culture-history': 'Tours',
};

// Adventure value (0 chill … 100 adrenaline) for an explicit adventure tag.
const ADV_TAG_VALUE: Partial<Record<MatchTag, number>> = {
  'low-adventure': 15,
  'med-adventure': 55,
  'high-adventure': 88,
};

// Last-resort adventure value when an entry has neither a curated value nor an
// adventure tag (e.g. a freshly live-fetched Viator item). Phase 2 replaces it
// with a precise value derived from the product's own Viator tags.
const CATEGORY_ADVENTURE_PROXY: Record<Category, number> = {
  Beaches: 8,
  Food: 18,
  Tours: 40,
  Watersports: 72,
  Activities: 68,
};

export function itemCategory(item: ViatorItem): Category {
  return GROUP_TAXONOMY_TO_CATEGORY[item.group_id] ?? 'Tours';
}

// Keyword classifier for items with no curated value — chiefly LIVE Viator
// products, which arrive with only a title (no adventure field, no per-item
// tags). Prefix-at-word-start matching ("zip" → "ziplining", "sail" → "sailing")
// while avoiding mid-word false hits. Checked adrenaline → chill → moderate.
// Tiers are checked top-to-bottom; first hit wins. Order matters: adrenaline
// vehicles beat everything; specific chill (snorkel/sail) and moderate
// (jeep/kayak) beat the broad generic-chill catch-all, so a "Jeep Tour" stays
// balanced while a plain "Island Tour" / "Airport Transfer" lands chill.
const ADV_KEYWORDS: { value: number; words: string[]; generic?: boolean }[] = [
  { value: 85, words: ['utv', 'atv', 'quad', 'buggy', 'zip', 'kite', 'jet ski', 'jetski', 'jet-ski', 'jet boat', 'off-road', 'off road', 'offroad', 'cliff', 'dune', 'parasail', 'tubing', 'snuba', 'seabob', 'talon', 'raider', 'wakeboard', 'flyboard', 'e-foil', 'efoil', 'rappel', 'abseil', 'bungee', 'skydiv', 'paraglid'] },
  { value: 18, words: ['snorkel', 'sail', 'cruis', 'sunset', 'dinner', 'lunch', 'brunch', 'tasting', 'distiller', 'rum', 'wine', 'cocktail', 'cooking', 'culinary', 'massage', 'wellness', 'beach', 'picnic', 'photoshoot', 'romantic', 'glass bottom', 'glass-bottom', 'catamaran', 'boat', 'yacht', 'relax', 'scenic', 'sightseeing', 'walking', 'food tour', 'mangrove', 'turtle', 'flamingo', 'lounge', 'day pass', 'tapas', 'chocolate'] },
  { value: 50, words: ['hik', 'jeep', 'safari', '4x4', '4×4', '4wd', 'bike', 'biking', 'cycling', 'kayak', 'paddle', 'horseback', 'horse rid', 'cave', 'segway', 'scooter', 'harley', 'scuba', 'dive', 'diving', 'nature', 'eco'] },
  // Generic-chill catch-all (checked last): broad sightseeing / logistics words
  // so an otherwise-unmatched "Island Tour", "Transfer", "Bus" reads as chill.
  //
  // `generic: true` marks this tier as a GUESS rather than a signal. The tiers
  // above match a word that names what the activity IS ("utv", "snorkel",
  // "kayak"); this one matches words that say nothing about intensity, so an
  // "Island Tour" scores 18 for containing "tour". Fine as a slider default,
  // not fine as grounds for excluding something from a search — see
  // adventureSource() below.
  { value: 18, generic: true, words: ['tour', 'transfer', 'transport', 'pickup', 'pick up', 'pick-up', 'shuttle', 'bus', 'van', 'excursion', 'sightsee', 'highlight', 'landmark', 'daypass', 'day trip', 'submarine', 'sanctuary', 'waterpark', 'water park', 'pub crawl', 'happy hour', 'sip', 'paint', 'breakfast', 'mimosa', 'museum', 'historic', 'cultural', 'culture', 'photo shoot', 'sea glass', 'rental', 'animal', 'all-inclusive', 'all inclusive'] },
];
const ADV_KEYWORD_RE = ADV_KEYWORDS.map((k) => ({
  value: k.value,
  generic: k.generic === true,
  re: new RegExp('\\b(' + k.words.map((w) => w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|') + ')', 'i'),
}));

export function keywordAdventure(title: string): number | undefined {
  for (const { value, re } of ADV_KEYWORD_RE) {
    if (re.test(title)) return value;
  }
  return undefined;
}

/**
 * WHERE an adventure value came from — the provenance advValue() discards.
 *
 * advValue always returns a number, which is right for a slider: every card
 * needs a position. It is wrong as grounds for EXCLUSION, because two of its
 * four tiers are guesses. A search that drops 128 products from "something
 * relaxing" should be able to say which of them were actually classified.
 *
 *   curated  a hand-set or enrichment-derived number      — trust it
 *   keyword  the title names the activity ("utv", "kayak") — trust it; this is
 *            the operator's own word, the same text the embedding is built from
 *   tag      an explicit low/med/high-adventure MatchTag   — trust it
 *   generic  only the catch-all tier matched ("tour")      — a guess
 *   proxy    nothing matched; the category filled in       — a guess
 */
export type AdventureSource = 'curated' | 'keyword' | 'tag' | 'generic' | 'proxy';

export function adventureSource(
  entry: { adventure?: number; title?: string; matched_by?: MatchTag[]; category: Category },
): AdventureSource {
  if (typeof entry.adventure === 'number') return 'curated';
  if (entry.title) {
    for (const { re, generic } of ADV_KEYWORD_RE) {
      if (re.test(entry.title)) return generic ? 'generic' : 'keyword';
    }
  }
  if ((entry.matched_by ?? []).some((t) => ADV_TAG_VALUE[t] !== undefined)) return 'tag';
  return 'proxy';
}

/** True when the adventure value reflects the activity rather than a guess. */
export function adventureIsGrounded(
  entry: { adventure?: number; title?: string; matched_by?: MatchTag[]; category: Category },
): boolean {
  const src = adventureSource(entry);
  return src === 'curated' || src === 'keyword' || src === 'tag';
}

// Resolution order: curated value → title keyword → explicit adventure tags →
// category proxy. The keyword step is what keeps live items (e.g. a snorkel
// cruise sitting in the watersports group) from inheriting the wrong vibe.
export function advValue(entry: { adventure?: number; title?: string; matched_by?: MatchTag[]; category: Category }): number {
  if (typeof entry.adventure === 'number') return entry.adventure;
  if (entry.title) {
    const kw = keywordAdventure(entry.title);
    if (kw !== undefined) return kw;
  }
  const tagged = (entry.matched_by ?? [])
    .map((t) => ADV_TAG_VALUE[t])
    .filter((v): v is number => v !== undefined);
  if (tagged.length) return tagged.reduce((a, b) => a + b, 0) / tagged.length;
  return CATEGORY_ADVENTURE_PROXY[entry.category] ?? 50;
}

// Graded vibe filter. t = -1 (full chill) … 0 (centre) … +1 (full adrenaline).
// Centre admits everything; each side narrows toward that extreme (67 makes the
// ends resolve to exactly the high/low thirds).
export function vibePass(adventure: number, vibe: number): boolean {
  const t = (vibe - 50) / 50;
  if (t > 0) return adventure >= t * 67;
  if (t < 0) return adventure <= 100 - -t * 67;
  return true;
}

// Price → 0..100 expensiveness, banded to the old budget buckets so the slider
// ends land cleanly (and the $1450 charter just reads as "$100+").
export function priceValue(price: number): number {
  if (!price || price <= 0) return 0;
  if (price < 50) return 38;
  if (price <= 100) return 63;
  return 90;
}

// Same graded mechanic as vibePass, over a banded price value.
export function pricePass(pv: number, price: number): boolean {
  const t = (price - 50) / 50;
  if (t > 0) return pv >= t * 67;
  if (t < 0) return pv <= 100 - -t * 67;
  return true;
}

export function priceOf(entry: ExploreEntry): number {
  return entry.kind === 'item' ? entry.item.price_usd : parseActivityCost(entry.activity.cost);
}

// === Rating, and the two filters that read it ==============================

/**
 * What rating an entry has, and whether a real crowd supplied it.
 *
 * One accessor because the stars filter, the review filter and two sort orders
 * all need the same answer, and the interesting case is the one where they
 * could disagree: `Activity.rating` is an EDITORIAL ranking weight that no
 * platform ever published (see the comment on the field), so a local pick is
 * `real: false` unless `loadCatalog` matched it to a Viator product. The same
 * two conditions `RatingChip.hasRealRating` uses to decide whether to draw a
 * star at all — the filter must not admit something the card refuses to label.
 */
export type EntryRating = { stars: number; reviews: number; real: boolean };

export function ratingOf(entry: ExploreEntry): EntryRating {
  if (entry.kind === 'item') {
    const stars = entry.item.rating ?? 0;
    const reviews = entry.item.review_count ?? 0;
    return { stars, reviews, real: stars > 0 && reviews > 0 };
  }
  const { rating, reviewCount, ratingSource } = entry.activity;
  return {
    stars: rating ?? 0,
    reviews: reviewCount ?? 0,
    real: ratingSource === 'viator' && rating > 0 && reviewCount > 0,
  };
}

/**
 * The rating an entry is ORDERED by, which is not always the rating it has.
 *
 * A local pick carries no platform rating and never will. What it does carry is
 * the founders' word, and the ranking treats that word as worth five stars off
 * two reviews — enough to sit among the best of the catalog, not enough to beat
 * a product ninety-four other people also rated five. On the live catalog that
 * places a beach below the 94 products at 5.0 with two or more reviews and
 * above the 17 holding 5.0 on a single review.
 *
 * This is a RANKING rule and nothing else. `ratingOf` stays the truth: it is
 * what the filters read, what `RatingChip` reads, and the reason no invented
 * review count ever reaches a card. Writing 5.0/2 into `Activity` instead would
 * render "★ 5 (2)" on Eagle Beach — a platform-shaped claim that two people
 * reviewed a public beach, which is both what `ratingSource` exists to prevent
 * and what the EU Unfair Commercial Practices Directive (Annex I 23b-23c, as
 * amended by the Omnibus Directive) blacklists outright.
 */
const VOUCHED: EntryRating = { stars: 5, reviews: 2, real: true };

export function rankingRatingOf(entry: ExploreEntry): EntryRating {
  const r = ratingOf(entry);
  if (r.real) return r;
  return entry.kind === 'activity' ? VOUCHED : r;
}

/**
 * Minimum stars.
 *
 * A local pick clears every bar. Its star is the founders vouching for a beach,
 * not a number a crowd produced, and hiding Eagle Beach the moment a traveller
 * asks for quality would be the filter lying about what it removed. (The four
 * picks `loadCatalog` matched to a real Viator product are the exception: they
 * have a genuine rating, so they are judged on it like any other product.)
 *
 * An unrated Viator PRODUCT is the opposite case and does drop: 34 of the 328
 * carry no rating at all, and nobody has vouched for those either way.
 */
export function starsPass(entry: ExploreEntry, minStars?: number): boolean {
  if (!minStars) return true;
  const r = ratingOf(entry);
  if (!r.real) return entry.kind === 'activity';
  return r.stars >= minStars;
}

/**
 * Minimum number of reviews — the filter that actually discriminates.
 *
 * Stars barely do: 203 of the 294 rated products score 4.8+, 111 sit at exactly
 * 5.0, and 63 of those 111 hold it on fewer than ten reviews. Review counts run 8 / 44 / 233 across the quartiles, so this is
 * the control that separates a proven boat trip from one nine people have
 * been on.
 *
 * Unlike the stars bar, a local pick DOES drop here, and correctly: asking for
 * "50+ reviews" is asking about a crowd, and a hand-written pick has none.
 */
export function reviewsPass(entry: ExploreEntry, minReviews?: number): boolean {
  if (!minReviews) return true;
  const r = ratingOf(entry);
  return r.real && r.reviews >= minReviews;
}

// === Duration ==============================================================

/**
 * Which band a duration falls in. A total function over the minutes, so every
 * duration lands in exactly one band by construction — there is no arithmetic
 * here that could leave a value in none, which a table of ranges could.
 *
 * Where the cuts fall is load-bearing, not a detail. Boundaries sit exactly on
 * round numbers a great many products advertise: 67 of the 328 run "4 hrs" —
 * the single largest bucket in the catalog — and another cluster runs "6 hrs".
 * Each band therefore holds the durations its LABEL names: a 2-hour tour is
 * "2-4h" rather than "under 2h", a 4-hour tour is "2-4h" rather than "4-6h",
 * and a 6-hour tour is "4-6h" rather than "Full day". Read the boundaries the
 * other way and a traveller who picks "2-4h" silently loses all 67 four-hour
 * tours, which is a fifth of everything Explore has.
 *
 * Resulting spread: 56 / 194 / 48 / 30. Lopsided toward the half-day band on
 * purpose — that is what Aruba sells, and a filter's job is to reflect the
 * catalog rather than to quarter it.
 */
function bandFor(mins: number): Exclude<DurationBand, 'any'> {
  if (mins < 120) return 'short';   // under 2h
  if (mins <= 240) return 'half';   // 2-4h, inclusive of both ends
  if (mins <= 360) return 'long';   // 4-6h, inclusive of 6 hrs
  return 'full';                    // full day
}

function durationOf(entry: ExploreEntry): string {
  return entry.kind === 'item' ? entry.item.duration : entry.activity.duration;
}

// `durationMinutes` answers 180 for anything it cannot read — a sensible default
// for the generator's time maths, and a trap for a filter: 180 sits inside the
// 2-4h band, so an unreadable duration would be silently filed under one band
// and hidden from every other. Known-ness is therefore checked separately, and
// an unknown passes every band. Same rule the rest of the site follows — no
// tile is ever removed on the strength of data we do not have.
function durationKnown(raw?: string): boolean {
  return !!raw && (/\d/.test(raw) || /full[\s-]?day/i.test(raw));
}

export function durationPass(entry: ExploreEntry, band?: DurationBand): boolean {
  if (!band || band === 'any') return true;
  const raw = durationOf(entry);
  if (!durationKnown(raw)) return true;
  return bandFor(durationMinutes(raw)) === band;
}

// === Private tours + provenance ============================================

// Viator's own PRIVATE_TOUR flag, reported not computed — it is on 134 of the
// 328 products Explore renders, so it takes the catalog down by well over half.
// (Measured post-exclusion on purpose: the raw feed reads 164 of 366, but a good
// share of that gap is private AIRPORT TRANSFERS, exactly what isTransportOnly
// strips, so the feed figure would flatter the filter. Their FREE_CANCELLATION
// flag is on 313 of 328 and would filter nothing, which is why it isn't
// offered.) A local pick is not a tour anyone sells privately, so it drops here.
export function privatePass(entry: ExploreEntry, privateOnly?: boolean): boolean {
  if (!privateOnly) return true;
  return entry.kind === 'item' && (entry.item.flags ?? []).includes('PRIVATE_TOUR');
}

export function provenancePass(entry: ExploreEntry, provenance?: Provenance): boolean {
  if (!provenance || provenance === 'all') return true;
  // Same priceOf the Price slider reads, so the button and the slider cannot
  // disagree about what "free" means. That also inherits its one quirk: a cost
  // of "Free + $16 gear" parses to 0, so Baby Beach lands here.
  if (provenance === 'free') return priceOf(entry) === 0;
  return provenance === 'local' ? entry.kind === 'activity' : entry.kind === 'item';
}

// Ensure medium=link is present on a Viator product URL. The edge function
// already sets it, so this is a no-op for live data and a safety net for any
// URL that arrives without it (stub or manually set).
export function viatorLink(url: string): string {
  if (!url) return url;
  // Ensure medium=link is present. The edge function now serves Viator's own
  // canonical product URLs (correct slug + pid), so we must NOT rewrite the
  // path here — Viator's affiliate routing needs that exact slug to resolve.
  if (url.includes('medium=link')) return url;
  return url + (url.includes('?') ? '&' : '?') + 'medium=link';
}

// The "Book now" target for a card, or null when it isn't bookable: needs a
// Viator booking link AND a non-zero price (free activities aren't booked/paid).
export function bookingUrl(entry: ExploreEntry): string | null {
  const url = entry.kind === 'item' ? entry.item.viator_item_url : entry.activity.viator_item_url;
  return url && priceOf(entry) > 0 ? viatorLink(url) : null;
}

// An item inherits its group's matched_by as the adventure-tag fallback (used
// only when the item has no curated `adventure`).
function groupTagsFor(item: ViatorItem, groups: ViatorGroup[]): MatchTag[] {
  return groups.find((g) => g.id === item.group_id)?.matched_by ?? [];
}

function itemAdventure(item: ViatorItem, groups: ViatorGroup[]): number {
  return advValue({ adventure: item.adventure, title: item.title, matched_by: groupTagsFor(item, groups), category: itemCategory(item) });
}

function groupName(item: ViatorItem, groups: ViatorGroup[]): string {
  return groups.find((g) => g.id === item.group_id)?.name ?? '';
}

// Higher sorts first: best-sellers ahead of equal-rated picks, then by rating.
function sortScore(entry: ExploreEntry): number {
  if (entry.kind === 'item') return (entry.item.is_best_seller ? 2 : 0) + entry.item.rating;
  return entry.activity.rating;
}

// === "Recommended" — the default order ====================================
//
// WHAT REPLACED WHAT, AND WHY
// The old default was `sortScore`: `(is_best_seller ? 2 : 0) + rating`. Both
// terms turned out to claim something untrue.
//
// The bonus was not a tiebreak. Ratings here span roughly 4.0-5.0, so a 2-point
// bonus is wider than the whole rating scale and no unflagged product could ever
// outrank a flagged one — it pinned six items to the top of the busiest page on
// the site. And `is_best_seller` does not mean best seller: viator-cards sets it
// as `order === 0`, the first product Viator's search happened to return for
// each of the six group anchors. Two of the six pinned products had 9 and 17
// reviews. Unpinned they scatter to positions 73, 8, 98, 12, 59 and 39.
//
// Raw `rating` was the second untruth: 111 products score exactly 5.0, 62 of
// them off fewer than ten reviews, so the default page rewarded being too
// little-known to have been rated down yet.
//
// Three terms replace them, each a claim we can defend:
//   QUALITY  — rating, weighted by how many people actually gave it
//   TEMPLATE — how close this sits to the character of the curated 10 days
//   PERSONA  — what the traveller told the questionnaire (zero if they haven't)
//
// A note on what is NOT here. The template's SECTION mix (9 of its 14 entries
// are beaches) was measured and rejected as a term: `beaches` holds 14 Explore
// tiles and `culture-history` 3, all of them local picks and not one Viator
// product, so weighting by section share would have concentrated most of the
// template's weight on 14 local picks and put the beaches back on top of the
// page — the exact outcome the vouch rule above exists to avoid.

/** Mean adventure of BALANCED_TEMPLATE's 14 activities, measured 2026-08-16. */
const TEMPLATE_ADVENTURE = 22.5;
/** Distance in adventure points at which template fit reaches zero. */
const TEMPLATE_SPREAD = 60;
/**
 * Reviews' worth of catalog average mixed into every rating. At 50, a product
 * with 9 reviews keeps ~15% of its own score and a 9,985-review product keeps
 * ~99.5% — which is the whole point: a 5.0 nobody has tested is pulled toward
 * the middle, a 4.9 thousands have tested is not.
 */
const REVIEW_PRIOR = 50;

/**
 * How much each term is worth. Starting values, not measured optima — they were
 * chosen against a printed before/after of the top 20 and are the first thing to
 * turn if the page reads wrong.
 *
 * With no questionnaire answers the persona term is not merely small, it is
 * ZERO. That matters: fitItem's crowd-pleaser and popularity terms fire whether
 * or not a traveller has answered anything, so leaving persona switched on for a
 * default profile would rank by popularity while calling it personalisation.
 *
 * There is deliberately no second weight set for that case. Once persona
 * contributes nothing, the order depends only on the RATIO of the other two, so
 * redistributing its 0.30 across them proportionally is arithmetically a no-op —
 * a knob that reads as if it does something and does not. Measured: a separate
 * {0.55, 0.45} set changes the ratio from 1.33 to 1.22 and reorders nothing in
 * the live catalog.
 */
const RANK_WEIGHTS = { quality: 0.40, template: 0.30, persona: 0.30 } as const;

/** Rating pulled toward the catalog mean in proportion to how few reviews back it. */
export function shrunkRating(r: EntryRating, catalogMean: number): number {
  const v = Math.max(0, r.reviews);
  return (v / (v + REVIEW_PRIOR)) * r.stars + (REVIEW_PRIOR / (v + REVIEW_PRIOR)) * catalogMean;
}

/**
 * What intensity the template term aims at.
 *
 * The template alone would aim at 22.5 for everybody, and measuring that showed
 * why it cannot: with a fixed target, a traveller who answered "adventure &
 * adrenaline, treat yourself" got a CALMER top 20 (mean intensity 24) than one
 * who answered "beach & chill, budget" (27). A 30%-weighted term pulling toward
 * calm was cancelling the persona term pulling toward wild — the page was
 * arguing with the questionnaire.
 *
 * So the template sets the default character and the traveller moves it: with
 * no answers the target is the template's own 22.5, and once someone has
 * answered it is the midpoint between that and their adventure slider. Someone
 * at 90 gets a target of 56 — still moderated toward the house taste, no longer
 * contradicted by it.
 */
export function templateTarget(hasPersona: boolean, adventureLevel: number): number {
  return hasPersona ? (TEMPLATE_ADVENTURE + adventureLevel) / 2 : TEMPLATE_ADVENTURE;
}

/**
 * How close an entry sits to the target intensity: 1 at the target, falling to
 * 0 sixty points away.
 *
 * This is the term that carries the template where its section mix could not —
 * though coarsely, and the comment should say so: `ExploreEntry.adventure` takes
 * only 18 distinct values and the overwhelming majority of the 350 sit on three
 * of them (18, 50, 85), because every Viator item falls through advValue's
 * proxies and quantises. In practice this is a three-bucket preference, and
 * inside the 202-entry adv-18 block it is a constant that decides nothing. It is also what keeps the page varied now the pin is
 * gone: ranked on quality alone the top eight came back as six off-road tours,
 * all sitting at adventure 85, and an un-answered page scores every one of
 * them at 0.
 */
export function templateFit(adventure: number, target: number = TEMPLATE_ADVENTURE): number {
  return Math.max(0, 1 - Math.abs(adventure - target) / TEMPLATE_SPREAD);
}

/**
 * How well an entry matches the questionnaire.
 *
 * Products reuse `fitItem`, the generator's own scorer, so a traveller sees the
 * same judgement on both surfaces — with one deliberate difference. fitItem
 * hard-rejects anything over the budget tier's cap, which is right for a plan
 * and wrong for a browse page: a budget traveller must still be able to SEE the
 * $2,300 charter. Ranking may reorder; Explore never hides.
 *
 * Reading `rejected` and carrying on is NOT enough, and that is worth spelling
 * out because the first version of this did exactly that and was wrong: a
 * rejected item's `score` is -Infinity, which sinks it to the bottom of the
 * ranking just as surely as removing it would, and poisons any arithmetic it
 * touches. A rejection is therefore mapped to 0 — the floor of fitItem's normal
 * range — so it ties with legitimately zero-fit items rather than ranking below
 * them, and quality and the template still carry it up the page on their merits.
 */
export function personaScore(entry: ExploreEntry, tags: Set<MatchTag>): number {
  if (entry.kind === 'item') {
    const f = fitItem(entry.item, tags);
    return f.rejected ? 0 : f.score;
  }
  // Local picks have no fitItem equivalent. activityTags derives comparable tags
  // from a pick's sections and adventure band, and +3 per overlap is the same
  // weight fitItem gives an interest hit, so the two sides stay on one scale.
  return activityTags(entry.activity).filter((t) => tags.has(t)).length * 3;
}

/** Rank positions 0..1 (worst..best). Ties share the lower rank. */
function percentiles(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length).fill(0);
  const last = Math.max(1, values.length - 1);
  for (let rank = 0; rank < order.length; rank++) {
    const [v, i] = order[rank];
    // Tied values must not be separated by an arbitrary index, or two identical
    // products would be ordered by catalog position wearing a score.
    const firstOfTie = order.findIndex(([w]) => w === v);
    out[i] = firstOfTie / last;
  }
  return out;
}

/**
 * The default Explore order.
 *
 * Quality and persona are converted to rank positions rather than used raw,
 * because both cluster hard — 203 of 294 rated products sit at 4.8 or above, so
 * the raw spread would be swamped by any other term. (Shrunk values run 4.27 to
 * 4.999: the catalog's rating floor is 2.3, not the ~4.8 the clustering suggests.)
 * Percentile is the same normalisation `normalizePopularity` already applies to
 * review counts at catalog load.
 *
 * Normalising across the entries PASSED IN (not the whole catalog) is
 * deliberate: within a filtered section the question is which of these is best,
 * not how they compare to a catalog the traveller has filtered away.
 */
export type RankContext = {
  tags: Set<MatchTag>;
  /** Did the traveller actually answer anything? See Explore.tsx for the test. */
  hasPersona: boolean;
  /** The questionnaire's adventure slider, 0-100. Ignored unless hasPersona. */
  adventureLevel?: number;
  /**
   * How many entries at the END of the list were added by search-by-meaning
   * rather than matched by keyword. Those are left exactly where they are.
   *
   * This is a hard boundary, not a preference. `entrySearch` promises substring
   * hits "stay first, always" — cosine similarity blurs precisely the proper
   * nouns a name search depends on — and `.env.production` cites that ordering
   * as the reason VITE_SEMANTIC_SEARCH could ship at 65% recall: a bad match
   * costs a mediocre extra suggestion, not a wrong plan. Ranking the blended
   * list quietly voided that: measured on a "snorkel" query, a semantic-only
   * entry reached position 3 above 86 keyword matches. 0 (the default) means
   * there is no tail, which is every case where the search box is empty.
   */
  semanticTail?: number;
};

export function rankRecommended(
  entries: ExploreEntry[],
  { tags, hasPersona, adventureLevel = 50, semanticTail = 0 }: RankContext,
): ExploreEntry[] {
  if (semanticTail > 0) {
    const cut = Math.max(0, entries.length - semanticTail);
    return [
      ...rankRecommended(entries.slice(0, cut), { tags, hasPersona, adventureLevel }),
      ...entries.slice(cut),
    ];
  }
  if (entries.length < 2) return entries;

  const rated = entries.map(ratingOf).filter((r) => r.real);
  const catalogMean = rated.length
    ? rated.reduce((s, r) => s + r.stars, 0) / rated.length
    : 0;

  const w = RANK_WEIGHTS;
  const target = templateTarget(hasPersona, adventureLevel);
  // An unrated PRODUCT is floored rather than shrunk. shrunkRating with zero
  // reviews returns exactly the catalog mean, which would drop the 34 unrated
  // products into the 50th percentile — measured, from the last rank down to a
  // median of 197, mid-page and above 150+ genuinely rated products. That
  // contradicts both the policy stated on `starsPass` above and the explicit
  // bottom block in the 'rating' and 'reviews' sorts. Vouched local picks are
  // unaffected: `rankingRatingOf` reports them real at 5.0/2.
  const quality = percentiles(entries.map((e) => {
    const r = rankingRatingOf(e);
    return r.real ? shrunkRating(r, catalogMean) : -Infinity;
  }));
  const persona = hasPersona ? percentiles(entries.map((e) => personaScore(e, tags))) : null;

  const scored = entries.map((e, i) => ({
    e,
    score: w.quality * quality[i]
      + w.template * templateFit(e.adventure, target)
      + w.persona * (persona ? persona[i] : 0),
  }));
  // Ties keep the order they arrived in — house order, or search relevance when
  // a query is open. That falls out of Array.prototype.sort being stable (ES2019
  // onward), so an explicit index tiebreak here would be redundant: removing one
  // changed no test and no live ordering.
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.e);
}

/**
 * Reorder a finished result list.
 *
 * Deliberately NOT part of `filterExploreEntries`. Explore blends
 * search-by-meaning hits onto the end of the filtered list AFTER filtering, so a
 * sort applied inside the filter would leave the semantic tail in its own
 * separate order below everything else. Running here, on the list the page is
 * about to render, is the only place a sort can order the whole page.
 *
 * 'recommended' runs `rankRecommended` when it is given a traveller's tags, and
 * otherwise returns the array untouched. The no-context path is what the
 * Dashboard and the tests rely on, and it keeps this function callable without
 * dragging the questionnaire into every caller. Every other key sorts a copy.
 */
export function sortEntries(
  entries: ExploreEntry[],
  sort: SortKey,
  ctx?: RankContext,
): ExploreEntry[] {
  if (sort === 'recommended') return ctx ? rankRecommended(entries, ctx) : entries;
  const out = [...entries];
  switch (sort) {
    case 'price-asc':
      return out.sort((a, b) => priceOf(a) - priceOf(b));
    case 'price-desc':
      return out.sort((a, b) => priceOf(b) - priceOf(a));
    case 'rating':
      // Rated first, then stars, then the crowd size behind those stars. That
      // last term is the whole reason this isn't a one-line sort on `rating`:
      // 111 products score exactly 5.0, many off single-digit review counts, so
      // stars alone put the least-known product on top of the page. Both
      // branches read `rankingRatingOf`, so a local pick sorts on the founders'
      // 5.0/2 vouch; only genuinely unrated PRODUCTS fall to the bottom block,
      // where they keep house order.
      return out.sort((a, b) => {
        const ra = rankingRatingOf(a), rb = rankingRatingOf(b);
        if (ra.real !== rb.real) return ra.real ? -1 : 1;
        if (!ra.real) return sortScore(b) - sortScore(a);
        if (rb.stars !== ra.stars) return rb.stars - ra.stars;
        return rb.reviews - ra.reviews;
      });
    case 'reviews':
      // Same two-block shape as 'rating' above, and the same house-order
      // fallback inside the unrated block — without it those entries all compare
      // equal and settle in whatever order reached the sort, which after a
      // semantic blend is search relevance rather than anything about reviews.
      return out.sort((a, b) => {
        const ra = rankingRatingOf(a), rb = rankingRatingOf(b);
        if (ra.real !== rb.real) return ra.real ? -1 : 1;
        if (!ra.real) return sortScore(b) - sortScore(a);
        return rb.reviews - ra.reviews;
      });
  }
}

// Build every tile from the catalog, apply category/search + the vibe/price
// graded filters, and sort. Every item/activity is a candidate — only an
// explicit filter removes one.
export function filterExploreEntries(catalog: Catalog, opts: ExploreFilters): ExploreEntry[] {
  /**
   * Is this local pick still worth its own tile?
   *
   * `mergeLocalMatches` hands a matched pick its product's title, image, rating
   * and link, so the pick and the product become two tiles for one bookable
   * thing — same name, same stars, same Book now target, distinguishable only by
   * a "Local pick" badge. Four picks are matched on the live catalog and all
   * four duplicated, two of them high on the page once Recommended started
   * ranking on reviews.
   *
   * The PRODUCT wins because it is the canonical listing: same experience, same
   * booking, and one tile is the point. (The pick's stale `cost` used to be the
   * deciding argument — it advertised "$75 pp" for a tour selling at $99 — but
   * `mergeLocalMatches` now adopts the matched product's live price, so a pick
   * that DOES keep its tile, because its product is not in the catalog, is no
   * longer quoting a number that has drifted.)
   *
   * Deliberately BEFORE the filters and against the whole catalog: deduping
   * against the filtered list would bring the pick back whenever a filter
   * happened to remove its product, which is the duplicate returning under a
   * section tab.
   */
  const catalogItemIds = new Set(catalog.items.map((i) => i.id));
  const keepsOwnTile = (a: Activity): boolean => {
    const code = viatorProductCode(a.viator_item_url);
    return !code || !catalogItemIds.has(code);
  };

  const entries: ExploreEntry[] = [
    ...catalog.items.map((item): ExploreEntry => ({
      kind: 'item',
      item,
      category: itemCategory(item),
      adventure: itemAdventure(item, catalog.groups),
      // Editorial sections (stub) win; live items derive from their Viator tags.
      sections: item.sections ?? sectionsForTags(item.tags),
    })),
    ...catalog.activities.filter(keepsOwnTile).map((activity): ExploreEntry => ({
      kind: 'activity',
      activity,
      category: activity.category as Category,
      adventure: advValue({ adventure: activity.adventure, title: activity.title, matched_by: activity.matched_by, category: activity.category as Category }),
      sections: activity.sections ?? ['tours-sightseeing'],
    })),
  ];

  const s = opts.search.trim().toLowerCase();
  const matchSearch = (e: ExploreEntry): boolean => {
    if (s === '') return true;
    const title = e.kind === 'item' ? e.item.title : e.activity.title;
    const desc = e.kind === 'item' ? e.item.description ?? '' : e.activity.description;
    const loc = e.kind === 'item' ? groupName(e.item, catalog.groups) : e.activity.location;
    return [title, desc, loc].some((x) => x.toLowerCase().includes(s));
  };

  return entries
    .filter((e) =>
      (opts.section === 'All' || e.sections.includes(opts.section as Section)) &&
      pricePass(priceValue(priceOf(e)), opts.price) &&
      vibePass(e.adventure, opts.vibe) &&
      starsPass(e, opts.minStars) &&
      reviewsPass(e, opts.minReviews) &&
      durationPass(e, opts.duration) &&
      privatePass(e, opts.privateOnly) &&
      provenancePass(e, opts.provenance) &&
      matchSearch(e),
    )
    .sort((a, b) => sortScore(b) - sortScore(a));
}

// A group card shows iff any of its items clears both the vibe and price sliders.
export function groupPasses(group: ViatorGroup, catalog: Catalog, vibe: number, price: number): boolean {
  return catalog.items.some(
    (i) =>
      i.group_id === group.id &&
      vibePass(itemAdventure(i, catalog.groups), vibe) &&
      pricePass(priceValue(i.price_usd), price),
  );
}

// A guaranteed Viator *product-page* URL for an item, or null. Prefers the
// item's own product URL; if that's missing or is a browse/category page (e.g.
// the generic /Aruba/d28-ttd thumbnail page), it rebuilds a direct product link
// from the product code — Viator resolves a product by its d28-<code> token
// alone, so the slug is cosmetic. It NEVER returns a category/browse page.
export function productUrlFor(item: { id?: string; viator_item_url?: string }): string | null {
  const u = item.viator_item_url;
  if (u && u.includes("/d28-") && !u.includes("d28-ttd")) return viatorLink(u);
  // Live Viator product codes start with a digit (e.g. 444239P2); stub ids do not.
  if (item.id && /^[0-9]/.test(item.id)) {
    return `https://www.viator.com/tours/Aruba/-/d28-${item.id}?${AFFILIATE}`;
  }
  return null;
}

// --- Filter hint copy -------------------------------------------------------
// The caption under each slider. Lives here, beside the filter it describes,
// because Explore and the My Aruba dashboard both show these sliders and they
// must read identically — the dashboard had its own coarse copy ("Leaning
// adrenaline.") while Explore told you what the filter was actually doing at
// the extremes, so the same slider position explained itself two ways.
//
// Five states, not three: the ends of the range are a genuinely different
// filter (ONLY the calmest / ONLY the priciest), and a slider that says the
// same thing at 70 and at 100 gives no reason to keep sliding.
export function vibeHint(v: number): string {
  const t = (v - 50) / 50;
  if (Math.abs(t) < 0.06) return 'Showing every vibe — slide either way to narrow.';
  if (t > 0) return v >= 94 ? 'Adrenaline only — just the most intense activities.' : 'Leaning adrenaline — filtering out the chillest picks.';
  return v <= 6 ? 'Chill only — just the calmest activities.' : 'Leaning chill — filtering out the most intense picks.';
}
export function priceHint(p: number): string {
  const t = (p - 50) / 50;
  if (Math.abs(t) < 0.06) return 'Any price — slide for free-only or splurge-only.';
  if (t > 0) return p >= 94 ? 'Splurge only — the priciest experiences.' : 'Leaning splurge — filtering out cheaper picks.';
  return p <= 6 ? 'Free only — no-cost activities.' : 'Leaning cheap — filtering out pricier picks.';
}

// The stars and reviews bars each remove a whole class of tile, and which class
// is not guessable from the control. A traveller who sets 4.8★+ and never sees
// the 43 unrated products has no way to know they existed; one who sets "50+
// reviews" and loses every beach would read it as a bug. So each says so.
export function starsHint(minStars: number): string {
  if (!minStars) return 'Any rating — local picks and unrated tours included.';
  return `${minStars}★ and up — unrated tours are hidden. Local picks stay, unless Viator rates them too.`;
}
export function reviewsHint(minReviews: number): string {
  if (!minReviews) return 'Any number of reviews, including none.';
  return `${minReviews}+ reviews — hides local picks, which have no crowd behind them.`;
}

/** The catalog id behind an entry, whichever shape it is. */
export function entryId(e: ExploreEntry): string {
  return e.kind === 'item' ? e.item.id : e.activity.id;
}

/**
 * Contraindications a traveller typed into the SEARCH box, honoured as
 * exclusions rather than left to the ranker.
 *
 * "We get seasick" scores 0/3 on the golden set because an embedding of that
 * sentence sits next to the very boats it rules out — cosine similarity has no
 * representation of "not". The site already parses that exact phrase, though:
 * `flagsFromNotes` maps seasickness to `no-boats`, wheelchair/limited mobility
 * to `mobility`, and "no car" to `no-car`, and it is the tested code behind the
 * questionnaire's free-text box.
 *
 * So search consults it too. This mirrors the rules `applyCatalogFlags` applies
 * to a generated plan, per ENTRY rather than per catalog, for the three flags
 * that parser can produce. It is deliberately the same three: the file's own
 * comment says its patterns stay conservative because a false exclusion is worse
 * than a miss, and that judgement is right for a search box too.
 *
 * This is the tactical half of the design in
 * docs/superpowers/specs/2026-08-14-search-query-understanding-design.md. Three
 * regexes understand three phrasings; the next traveller writes "I can't be on
 * the water". The parser described there is the general answer, and this is the
 * floor it falls back to.
 */
export function entryExcludedByFlags(e: ExploreEntry, flags: ReadonlySet<string>): boolean {
  if (flags.size === 0) return false;

  if (flags.has('no-boats')) {
    if (e.kind === 'item' && isWaterBased(e.item)) return true;
    if (e.kind === 'activity' && (e.activity.sections ?? []).includes('cruises-water')) return true;
  }

  if (flags.has('no-car') && e.kind === 'activity' && e.activity.requires_car) return true;

  if (flags.has('mobility')) {
    // Same ceiling applyCatalogFlags uses, from the shared FLAG_ADVENTURE_CAP
    // table, so a mobility-limited traveller gets the same answer whether they
    // ticked the pill or typed the words.
    const cap = adventureCapForFlags(flags);
    if (cap !== null && e.adventure > cap) return true;
  }

  return false;
}

/**
 * Merge meaning-matched results into keyword-matched ones.
 *
 * Substring hits keep their order and come first; semantic-only ids follow in
 * the order the ranker returned them. An entry in both appears once, in the
 * substring block.
 *
 * The ordering is the whole point and it is not a hedge. Cosine similarity is
 * WORSE than substring matching on proper nouns — "Arikok", "De Palm Island",
 * an operator's name — because similarity blurs precisely the rare exact tokens
 * that make a name a name. So the keyword layer is permanently load-bearing,
 * and semantic results are an addition beneath it rather than a replacement.
 *
 * An empty `semanticIds` returns `substringHits` unchanged, which is what makes
 * this safe to call unconditionally: with the feature dark, or after a failed
 * lookup, behaviour is identical to before it existed.
 */
export function blendSearchResults(
  substringHits: ExploreEntry[],
  semanticIds: string[],
  all: ExploreEntry[],
): ExploreEntry[] {
  if (semanticIds.length === 0) return substringHits;
  const seen = new Set(substringHits.map(entryId));
  const byId = new Map(all.map((e) => [entryId(e), e]));
  const extra: ExploreEntry[] = [];
  for (const id of semanticIds) {
    if (seen.has(id)) continue;
    const entry = byId.get(id);
    if (!entry) continue;          // ranked an id the catalog no longer has
    seen.add(id);
    extra.push(entry);
  }
  return [...substringHits, ...extra];
}

/**
 * The Viator product code inside a product URL — `…/d28-8936P1?…` → `8936P1`.
 *
 * A curated local pick that `mergeLocalMatches` paired with a real product keeps
 * `kind: 'activity'` but adopts the product's title, rating and review count. It
 * therefore LOOKS like a Viator card to a traveller while carrying none of a
 * Viator item's fields — including the id every product-level snapshot is keyed
 * on. The URL is the only place that id survives, which is why it is parsed back
 * out here rather than threaded through as a new field on Activity.
 */
export function viatorProductCode(url?: string): string {
  if (!url) return '';
  return url.match(/\/d\d+-([A-Za-z0-9]+)(?:[?/]|$)/)?.[1] ?? '';
}
