import { useState } from 'react';
import { RatingChipInline, hasRealRating } from './RatingChip';
import type { ViatorItem } from '../types';
import { Star } from './Icons';

// Per-item row height (incl. its gap) used to size the expandable drawer.
// ItineraryCard grows the fixed-height flip-card by exactly the same amount so
// the content above the drawer stays put while it opens. Single source here.
const OTHER_ITEM_PX = 52;
const OTHER_LIST_PAD = 16;

export function otherSuggestionsExpandedPx(n: number): number {
  return n === 0 ? 0 : n * OTHER_ITEM_PX + OTHER_LIST_PAD;
}

type Props = {
  items: ViatorItem[];
  // Optional controlled-mode props. When both `open` and `onToggle` are
  // provided, the parent owns the expanded state (used on Itinerary so the
  // ItineraryCard can resize to accommodate the expanded list).
  open?: boolean;
  onToggle?: () => void;
  // Optional "+ Add to itinerary" callback (Itinerary only). When provided,
  // each row shows an Add button that appends a new card for that item.
  onAddItem?: (item: ViatorItem) => void;
};

// "Other suggestions (N)" collapsed row at the bottom of a GroupCard.
// Click to expand inline; each row's title links to the affiliate URL, and
// (on Itinerary) an "+ Add" button appends it to the day.
export default function OtherSuggestionsList({
  items, open: openProp, onToggle, onAddItem,
}: Props) {
  const controlled = openProp !== undefined && onToggle !== undefined;
  const [openLocal, setOpenLocal] = useState(false);
  const open = controlled ? (openProp as boolean) : openLocal;
  const toggle = controlled ? (onToggle as () => void) : () => setOpenLocal((v) => !v);

  if (items.length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid #eee' }}>
      <button
        onClick={toggle}
        style={{
          width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '8px 14px',
          fontSize: 11, fontWeight: 700, color: '#555',
          fontFamily: 'inherit',
        }}
      >
        Other suggestions {open ? '−' : '+'}
      </button>
      {/* Drawer height animates in lockstep with the card height (see
          otherSuggestionsExpandedPx). CSS var lets the mobile media query
          override to height:auto where the card is already auto-sized. */}
      <div
        className={`other-suggestions-body${open ? ' open' : ''}`}
        style={{ ['--sug-h' as string]: `${open ? otherSuggestionsExpandedPx(items.length) : 0}px` }}
      >
        <div style={{ padding: '4px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px',
                border: '1px solid #ddd', borderRadius: 6,
              }}
            >
              <a
                href={item.viator_item_url}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={open ? 0 : -1}
                style={{ minWidth: 0, flex: 1, textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.2 }}>{item.title}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 2,
                              display: 'flex', alignItems: 'center', gap: 6 }}>
                  {hasRealRating(item.rating, item.review_count) && (
                    <>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <RatingChipInline rating={item.rating} reviewCount={item.review_count} size={10} />
                      </span>
                      <span>·</span>
                    </>
                  )}
                  <span>${item.price_usd}</span>
                  {item.duration && (<><span>·</span><span>{item.duration}</span></>)}
                </div>
              </a>
              {onAddItem && (
                <button
                  type="button"
                  tabIndex={open ? 0 : -1}
                  onClick={() => onAddItem(item)}
                  aria-label={`Add ${item.title} to itinerary`}
                  className="other-suggestion-add"
                >
                  + Add
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
