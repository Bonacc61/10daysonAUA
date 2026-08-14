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

const PROVIDER_LABEL: Record<string, string> = { V: 'Viator', T: 'TripAdvisor' };

export function providerLabel(p: string): string {
  return PROVIDER_LABEL[p] ?? p;
}

/** Every platform that published reviews for this product, busiest first. */
export function reviewSourcesFor(id: string): ReviewSource[] {
  const rows = DATA[id];
  if (!rows?.length) return [];
  return [...rows].filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
}

/**
 * True when there is a histogram worth drawing — at least one platform whose
 * per-star counts actually add up. A source can report a total and an average
 * with no breakdown behind it, and five empty bars say less than no bars.
 */
export function hasBreakdown(id: string): boolean {
  return reviewSourcesFor(id).some((s) => s.c.reduce((a, b) => a + b, 0) > 0);
}
