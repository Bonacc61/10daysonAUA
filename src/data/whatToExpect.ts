import SNAPSHOT from './whatToExpect.json';

/**
 * The operator's "What to expect" narrative — the walk-through of the day.
 *
 * This is `itinerary.activityInfo.description`, and it is NOT a second version
 * of the Overview. That mistake shipped for one commit: the two texts were
 * merged into one "Overview" block, which put "After check in at our desk, our
 * crew will shuttle you with a zodiac…" above the pitch it was meant to
 * introduce. Two different sections of the Viator page, two different jobs:
 *
 *   description                        → the Overview, the pitch
 *   itinerary.activityInfo.description → What to expect, the running order
 *
 * Suppliers fill both inconsistently — on some products the pitch is in the
 * second field and the running order in the first — which is exactly why the
 * card labels each rather than concatenating them and hoping.
 *
 * `/products/search` builds the catalog and does not return `itinerary` at all,
 * so this cannot ride the catalog and arrives as a committed snapshot from
 * `node tools/probe-reviews.cjs`. 89 of 366 products have one.
 */
const DATA: Record<string, string> = SNAPSHOT as Record<string, string>;

export function whatToExpectFor(id: string): string {
  return DATA[id] ?? '';
}
