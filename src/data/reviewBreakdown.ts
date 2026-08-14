import SNAPSHOT from './reviewBreakdown.json';

/**
 * How a product's reviews are DISTRIBUTED, per platform — the thing an average
 * hides.
 *
 * Captured from Viator's `/products/{product-code}` on 2026-08-14 by
 * `node tools/probe-reviews.cjs`, and committed: the same contract as the
 * coordinate registry and the start-time snapshot. 322 of 366 products have one;
 * the rest have no reviews at all on either platform.
 *
 * WHY A SNAPSHOT AND NOT A LIVE CALL. The histogram is absent from
 * /products/search, which is what builds the catalog, so it needs one request
 * per product. At 366 products that is a minute of API calls — fine offline,
 * impossible on a cache miss with a traveller waiting. Committing it makes the
 * per-visitor cost zero at any traffic level, which is the whole point.
 *
 * The shape is terse because it ships in the client bundle. Readable keys and
 * indentation cost 40%; this is 28KB.
 */
export type ReviewSource = {
  /** 'V' = Viator, 'T' = TripAdvisor. */
  p: string;
  /** Total reviews on that platform. */
  n: number;
  /** Average on that platform, or null if it published none. */
  a: number | null;
  /** Counts for 1★…5★, in that order. */
  c: number[];
};

const DATA: Record<string, ReviewSource[]> = SNAPSHOT as Record<string, ReviewSource[]>;

/** Every platform that published reviews for this product, busiest first. */
export function reviewSourcesFor(id: string): ReviewSource[] {
  const rows = DATA[id];
  if (!rows?.length) return [];
  return [...rows].filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
}

export type Breakdown = {
  /** Reviews across every platform — the figure the Viator page prints. */
  total: number;
  /** Counts for 1★…5★, summed across platforms. */
  counts: number[];
  /** Weighted mean of the summed counts, to one decimal. */
  average: number;
};

/**
 * One rating for the product, summed across platforms.
 *
 * SUMMED, not per-platform, because the number a traveller can check is the one
 * on the Viator page — and that is the combined figure. Showing Viator's 154
 * beside TripAdvisor's 52 was accurate and still wrong: the page says 206, so a
 * card saying 154 reads as stale data even though both numbers are right.
 *
 * The sum reproduces Viator's own `combinedAverageRating` exactly — 472918P1
 * gives (2x1 + 1x4 + 203x5) / 206 = 4.956, against the 4.9563 the API returns —
 * so this is their arithmetic, not ours.
 *
 * It also retires the need to name platforms on the card at all, which restores
 * the older and stricter rule that the site never attributes a rating to a
 * platform: there is now one number, and it is the one being linked to.
 */
export function combinedBreakdown(id: string): Breakdown | null {
  const rows = reviewSourcesFor(id);
  if (!rows.length) return null;
  const counts = [0, 0, 0, 0, 0];
  for (const r of rows) for (let i = 0; i < 5; i++) counts[i] += r.c[i] ?? 0;
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const weighted = counts.reduce((sum, c, i) => sum + c * (i + 1), 0);
  return { total, counts, average: Math.round((weighted / total) * 10) / 10 };
}

/**
 * True when there is a histogram worth drawing — at least one platform whose
 * per-star counts actually add up. A source can report a total and an average
 * with no breakdown behind it, and five empty bars say less than no bars.
 */
export function hasBreakdown(id: string): boolean {
  return combinedBreakdown(id) !== null;
}
