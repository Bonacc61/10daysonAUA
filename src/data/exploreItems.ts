import type { Activity } from './activities';
import type { ViatorGroup, ViatorItem, MatchTag, Section } from '../types';
import type { Catalog } from './activitySource';
import { parseActivityCost } from './matcher';

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

export type ExploreFilters = { section: string; search: string; vibe: number; price: number };

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
      // Editorial sections (stub) win; live items derive from their Viator tags.
      sections: item.sections ?? sectionsForTags(item.tags),
    })),
    ...catalog.activities.map((activity): ExploreEntry => ({
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
