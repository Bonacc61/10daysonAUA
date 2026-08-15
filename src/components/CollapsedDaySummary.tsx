/**
 * What a collapsed day shows instead of its cards.
 *
 * Collapsing used to replace the day with the words "3 activities · tap to
 * expand", which told a traveller how MANY things they had planned but nothing
 * about WHAT. With every day folded — the state you want when you are checking
 * the shape of a fortnight — the plan became a list of numbers.
 *
 * So the day keeps its title (the sticky head is untouched) and gains one line
 * per planned activity, in day order: a cropped circular thumbnail with the
 * activity's title beside it. A folded fortnight then reads as what is actually
 * planned, not as a column of pictures to be recognised.
 *
 * Presentational on purpose: the caller resolves each slot entry to a face,
 * because that resolution needs the catalog and the swap memory the page holds.
 */

export type CollapsedActivity = {
  /** Stable per card — the card uid, not the item id: one item can appear twice. */
  key: string;
  title: string;
  image?: string;
};

/**
 * `list` — a circle per line with its title beside it. THE SHIPPED LAYOUT: a
 *   folded day should say what is planned, and a title does that where a
 *   thumbnail only hints at it. Costs roughly three times the height of `row`,
 *   which is the trade that was accepted.
 * `row` — circles side by side, one line, no titles. Cheapest in height. Kept
 *   because the two layouts are tested against each other: both render the same
 *   titles into the DOM and `row` hides them in CSS, so a variant that showed a
 *   DIFFERENT set of activities would be caught.
 */
export type CollapsedVariant = 'row' | 'list';

/** Days cap at three cards, but a shared or older plan need not, so the row is bounded. */
const MAX_THUMBS = 6;

export default function CollapsedDaySummary({
  activities, dayNum, onExpand, variant = 'list',
}: {
  activities: CollapsedActivity[];
  dayNum: number;
  onExpand: () => void;
  variant?: CollapsedVariant;
}) {
  const shown = activities.slice(0, MAX_THUMBS);
  const overflow = activities.length - shown.length;
  const count = activities.length;

  return (
    <button
      type="button"
      className={`itin-day-collapsed ${variant}`}
      onClick={onExpand}
      // Named, not image-only: a collapsed day has to be as readable to a screen
      // reader as it is at a glance.
      aria-label={count === 0
        ? `Expand day ${dayNum}, nothing planned`
        : `Expand day ${dayNum}: ${activities.map((a) => a.title).join(', ')}`}
    >
      {count === 0 ? (
        <span className="itin-day-collapsed-count">Nothing planned yet</span>
      ) : (
        <>
          <span className="itin-day-thumbs" aria-hidden>
            {shown.map((a) => (
              <span className="itin-day-line" key={a.key}>
                <span className="itin-day-thumb" title={a.title}>
                  {/* The initial sits UNDER the photo, so a dead Viator URL — a
                      known failure on this catalog — degrades to a lettered circle
                      rather than a broken-image glyph. Same onError handling as the
                      shortlist strip. */}
                  <span className="itin-day-thumb-initial">{a.title.trim().charAt(0).toUpperCase()}</span>
                  {a.image && (
                    <img
                      src={a.image}
                      alt=""
                      loading="lazy"
                      onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                </span>
                {/* Rendered in both variants and hidden by CSS in `row`, so the
                    two layouts cannot disagree about WHICH activities they show. */}
                <span className="itin-day-line-title">{a.title}</span>
              </span>
            ))}
            {overflow > 0 && (
              <span className="itin-day-line">
                <span className="itin-day-thumb more">+{overflow}</span>
                <span className="itin-day-line-title">{overflow} more</span>
              </span>
            )}
          </span>
          {/* No "3 activities" line. The circles are the count, and in `list`
              the titles say more than a number could — the same reasoning that
              retired "tap to expand". It survives only in the aria-label, where
              there is nothing to look at. */}
        </>
      )}
    </button>
  );
}
