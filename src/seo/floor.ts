// Which activities earn a public URL.
//
// The point of a floor is to bind. An earlier draft of the spec asked for both
// review platforms AND (prose OR a start time) — and startTimes.json covers 281
// of 327 products, so the "or" waved 246 pages through. A departure time is not
// unique content, and 246 near-identical pages is the pattern Google's
// scaled-content policy demotes. Measured on 2026-09-10, this floor selects 58.
//
// Growth comes from extending whatToExpect.json (89 of 327 — the binding
// constraint), never from lowering the bar. See the spec.

import { reviewSourcesFor } from '../data/reviewBreakdown';
import { whatToExpectFor } from '../data/whatToExpect';
import { ACTIVITIES, type Activity } from '../data/activities';
import type { SeoCatalogItem } from './catalog';

export type { SeoCatalogItem };

/**
 * Mirrors MIN_CHAMPION_REVIEWS in src/data/itineraryGenerator.ts:133 (and
 * tools/catalog-drift.ts:43). Reused rather than re-chosen: two thresholds
 * meaning "enough reviews to trust" would drift apart.
 */
export const MIN_SEO_REVIEWS = 25;

/** A Viator product earns a URL when all three hold. */
export function productEarnsPage(id: string): boolean {
  const rows = reviewSourcesFor(id);
  const platforms = new Set(rows.map((r) => r.p));
  // Measured 2026-09-10: 0 of the 39 selected products are excluded by this
  // check alone — every product clearing prose + MIN_SEO_REVIEWS already has
  // both platforms. Not dead code: 28 single-platform products carry prose
  // and are held out only by the review floor, closest at 12 reviews — one
  // of them crossing 25 makes this bind. Keep it regardless: without it we'd
  // publish a page whose rating centrepiece is single-platform, undercutting
  // the cross-platform review data this project is built to differentiate on.
  if (!(platforms.has('V') && platforms.has('T'))) return false;   // 1. both platforms
  if (!whatToExpectFor(id)) return false;                          // 2. prose to summarise
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  return total >= MIN_SEO_REVIEWS;                                 // 3. a histogram worth drawing
}

/**
 * A curated pick earns a URL when it carries hand-written localsSay — the only
 * genuinely original text on the page. Seven of the 26 have it deliberately
 * empty (activities.ts explains why: inventing quotes attributed to named
 * locals is not on), and those would be thin.
 */
export function curatedEarnsPage(a: Activity): boolean {
  return a.localsSay.trim().length > 0;
}

export function selectPages(items: SeoCatalogItem[]): {
  products: SeoCatalogItem[];
  curated: Activity[];
} {
  return {
    products: items.filter((i) => productEarnsPage(i.id)),
    curated: ACTIVITIES.filter(curatedEarnsPage),
  };
}

/**
 * The products that have left the catalog but already own a published URL.
 *
 * The floor above answers "does this earn a NEW url". This answers the other
 * question, and it deliberately does not consult the floor: a page Google has
 * already indexed keeps its URL whether or not the product would still clear
 * the bar today. productEarnsPage() reads committed per-id data files
 * (reviewBreakdown.json, whatToExpect.json), so a gone product scores exactly
 * as it did while it was live — right up until one of those files is
 * regenerated without it, at which point a floor-driven loop would silently
 * stop emitting the page and the next deploy would 404 it.
 *
 * A slug in the registry is the proof that the URL was published. An id absent
 * from it never had one, so there is nothing to preserve — and minting a fresh
 * URL for a dead product is the opposite of the point.
 */
export function departedPages(
  items: SeoCatalogItem[],
  registry: Record<string, string>,
): SeoCatalogItem[] {
  return items.filter((i) => i.gone && registry[i.id]);
}
