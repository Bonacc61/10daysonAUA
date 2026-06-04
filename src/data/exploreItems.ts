import type { Activity } from './activities';
import type { ViatorGroup, ViatorItem, MatchTag } from '../types';
import type { Catalog } from './activitySource';
import { parseActivityCost } from './matcher';

// Content bucket for a tile — CATEGORIES without the 'All' filter sentinel.
export type Category = 'Beaches' | 'Activities' | 'Watersports' | 'Food' | 'Tours';

// A single renderable Explore tile: a Viator item or a local pick, pre-tagged
// with its category and resolved adventure value so the view never recomputes.
export type ExploreEntry =
  | { kind: 'item'; item: ViatorItem; category: Category; adventure: number }
  | { kind: 'activity'; activity: Activity; category: Category; adventure: number };

export type ExploreFilters = { category: string; search: string; vibe: number; price: number };

// Map a Viator group id → existing UI category bucket. New groups: 1 line each.
const GROUP_TAXONOMY_TO_CATEGORY: Record<string, Category> = {
  'adventure-tours': 'Activities',
  'watersports': 'Watersports',
  'sailing-cruises': 'Tours',
  'food-drink-experiences': 'Food',
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
const ADV_KEYWORDS: { value: number; words: string[] }[] = [
  { value: 85, words: ['utv', 'atv', 'quad', 'buggy', 'zip', 'kite', 'jet ski', 'jetski', 'jet-ski', 'jet boat', 'off-road', 'off road', 'offroad', 'cliff', 'dune', 'parasail', 'tubing', 'snuba', 'seabob', 'talon', 'raider', 'wakeboard', 'flyboard', 'e-foil', 'efoil', 'rappel', 'abseil', 'bungee', 'skydiv', 'paraglid'] },
  { value: 18, words: ['snorkel', 'sail', 'cruis', 'sunset', 'dinner', 'lunch', 'brunch', 'tasting', 'distiller', 'rum', 'wine', 'cocktail', 'cooking', 'culinary', 'massage', 'wellness', 'beach', 'picnic', 'photoshoot', 'romantic', 'glass bottom', 'glass-bottom', 'catamaran', 'boat', 'yacht', 'relax', 'scenic', 'sightseeing', 'walking', 'food tour', 'mangrove', 'turtle', 'flamingo', 'lounge', 'day pass', 'tapas', 'chocolate'] },
  { value: 50, words: ['hik', 'jeep', 'safari', '4x4', '4×4', '4wd', 'bike', 'biking', 'cycling', 'kayak', 'paddle', 'horseback', 'horse rid', 'cave', 'segway', 'scooter', 'harley', 'scuba', 'dive', 'diving', 'nature', 'eco'] },
  // Generic-chill catch-all (checked last): broad sightseeing / logistics words
  // so an otherwise-unmatched "Island Tour", "Transfer", "Bus" reads as chill.
  { value: 18, words: ['tour', 'transfer', 'transport', 'pickup', 'pick up', 'pick-up', 'shuttle', 'bus', 'van', 'excursion', 'sightsee', 'highlight', 'landmark', 'daypass', 'day trip', 'submarine', 'sanctuary', 'waterpark', 'water park', 'pub crawl', 'happy hour', 'sip', 'paint', 'breakfast', 'mimosa', 'museum', 'historic', 'cultural', 'culture', 'photo shoot', 'sea glass', 'rental', 'animal', 'all-inclusive', 'all inclusive'] },
];
const ADV_KEYWORD_RE = ADV_KEYWORDS.map((k) => ({
  value: k.value,
  re: new RegExp('\\b(' + k.words.map((w) => w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|') + ')', 'i'),
}));

export function keywordAdventure(title: string): number | undefined {
  for (const { value, re } of ADV_KEYWORD_RE) {
    if (re.test(title)) return value;
  }
  return undefined;
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

// Build every tile from the catalog, apply category/search + the vibe/price
// graded filters, and sort. Every item/activity is a candidate — only an
// explicit filter removes one.
export function filterExploreEntries(catalog: Catalog, opts: ExploreFilters): ExploreEntry[] {
  const entries: ExploreEntry[] = [
    ...catalog.items.map((item): ExploreEntry => ({
      kind: 'item',
      item,
      category: itemCategory(item),
      adventure: itemAdventure(item, catalog.groups),
    })),
    ...catalog.activities.map((activity): ExploreEntry => ({
      kind: 'activity',
      activity,
      category: activity.category as Category,
      adventure: advValue({ adventure: activity.adventure, title: activity.title, matched_by: activity.matched_by, category: activity.category as Category }),
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
      (opts.category === 'All' || e.category === opts.category) &&
      pricePass(priceValue(priceOf(e)), opts.price) &&
      vibePass(e.adventure, opts.vibe) &&
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
