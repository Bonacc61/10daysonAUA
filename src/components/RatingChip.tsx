import { Star } from './Icons';

/**
 * A star rating with the thing that makes it mean something: how many people
 * said it.
 *
 * WHY THIS EXISTS
 * Eleven places rendered a bare number next to a star. Two problems followed,
 * both visible on the live site and neither a data bug — the ratings are
 * Viator's own and match their API exactly (checked across a 31-product spread
 * of the catalog, zero mismatches).
 *
 * First, 124 of 366 products score exactly 5.0, and they score it off 7, 8, 9,
 * 17 reviews. Rendered as "5" beside a star, a product three people liked is
 * indistinguishable from Eagle Beach at 4.9 from 2,847 — so the catalog reads as
 * though everything is perfect, which is the same as no rating at all.
 *
 * Second, 44 products have no reviews. Viator returns no rating for those and
 * the catalog stores 0, which rendered as a literal "0" next to a star: not
 * "unrated" but "rated zero, badly". The worst thing we can say about a product
 * was being said about the ones we simply knew nothing about.
 *
 * So: below `MIN_REVIEWS` the count comes along to qualify the number, at zero
 * reviews nothing renders at all, and CardBack's fuller treatment is left alone
 * — it already got this right and shows the count in full.
 */

/** Under this many reviews, an average is an anecdote — say how thin it is. */
const MIN_REVIEWS = 30;

export function hasRealRating(rating?: number, reviewCount?: number): boolean {
  return typeof rating === 'number' && rating > 0
    && typeof reviewCount === 'number' && reviewCount > 0;
}

export default function RatingChip({
  rating, reviewCount, size = 12, className = 'a-rating', style,
}: {
  rating?: number;
  reviewCount?: number;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (!hasRealRating(rating, reviewCount)) return null;
  const thin = (reviewCount as number) < MIN_REVIEWS;
  return (
    <span className={className} style={style}>
      <Star size={size} aria-hidden /> {rating}
      {thin && (
        // Only on the thin ones. Putting the count on every chip would crowd the
        // card for no gain — at 2,847 reviews the average speaks for itself.
        <span style={{ opacity: 0.7, fontWeight: 400, marginLeft: 3 }}>
          ({reviewCount})
        </span>
      )}
    </span>
  );
}

/**
 * The star + number alone, for the sites that already have their own styled
 * wrapper (a badge over a hero image, a yellow chip in a card header).
 *
 * Assumes the CALLER has checked `hasRealRating` and skipped the wrapper
 * entirely when it fails — returning null from inside a chip would leave an
 * empty pill floating on the card, which looks more broken than a missing one.
 */
export function RatingChipInline({
  rating, reviewCount, size = 12,
}: { rating?: number; reviewCount?: number; size?: number }) {
  if (!hasRealRating(rating, reviewCount)) return null;
  return (
    <>
      <Star size={size} aria-hidden /> {rating}
      {(reviewCount as number) < MIN_REVIEWS && (
        <span style={{ opacity: 0.7, fontWeight: 400, marginLeft: 3 }}>({reviewCount})</span>
      )}
    </>
  );
}
