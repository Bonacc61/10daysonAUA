import type { ViatorItem } from '../types';

/**
 * Viator's own note about how a product is selling, in the corner of the card.
 *
 * WHAT THIS IS NOT. Viator's product page shows a demand statistic — "on
 * average, this is booked 30 days in advance" — and that figure is NOT available
 * to us. It appears in no field of /products/search or /products/{code}: I
 * enumerated every numeric leaf of a full product payload and the only
 * booking-timing values are `bookingCutoffInMinutes` (how LATE you may book) and
 * the refund day-ranges. The rendered page is unreachable too — 403 to a plain
 * request, and a bot wall to a real browser engine. So the number cannot be
 * fetched, and inventing one is not on the table.
 *
 * What Viator DOES publish per product is a small set of merchandising flags,
 * and one of them says the same thing qualitatively. Across the 366-item
 * catalogue: FREE_CANCELLATION 351, PRIVATE_TOUR 164, NEW_ON_VIATOR 55,
 * SPECIAL_OFFER 13, LIKELY_TO_SELL_OUT 6, SKIP_THE_LINE 1.
 *
 * Only the two that change a booking DECISION are shown, and only one at a time
 * — a corner badge that fires on 96% of cards is wallpaper. "Likely to sell out"
 * is the one worth acting on, so it wins; "New on Viator" is the useful caveat
 * for a product with no reviews behind it.
 *
 * Every one of these is Viator asserting something about their own inventory.
 * The site reports it and attributes nothing to itself.
 */
const BADGES: ReadonlyArray<readonly [flag: string, label: string, bg: string]> = [
  ['LIKELY_TO_SELL_OUT', '🔥 Likely to sell out', '#FFE2D6'],
  ['NEW_ON_VIATOR', '✦ New on Viator', 'var(--sand-50)'],
];

export function bookAheadBadge(item: ViatorItem): { label: string; bg: string } | null {
  const flags = item.flags ?? [];
  for (const [flag, label, bg] of BADGES) {
    if (flags.includes(flag)) return { label, bg };
  }
  return null;
}

export default function BookAheadBadge({ item }: { item: ViatorItem }) {
  const badge = bookAheadBadge(item);
  if (!badge) return null;
  return (
    <span
      style={{
        marginLeft: 'auto', alignSelf: 'center', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center',
        padding: '4px 9px', borderRadius: 999,
        border: '2px solid var(--ink)', background: badge.bg, color: 'var(--ink)',
        fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
      }}
    >
      {badge.label}
    </span>
  );
}
