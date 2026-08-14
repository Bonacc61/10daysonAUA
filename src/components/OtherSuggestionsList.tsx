import { useState } from 'react';
import { RatingChipInline, hasRealRating } from './RatingChip';
import type { ViatorItem } from '../types';

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
      {/* A horizontal shelf, not a growing list: the card keeps its height and
          you push the suggestions sideways, same gesture as "Add from
          shortlist". */}
      <div className={`other-suggestions-body${open ? ' open' : ''}`}>
        <div className="other-suggestions-picker">
          <div className="other-suggestions-track">
            {items.map((item) => (
              <div key={item.id} className="other-suggestions-item">
                <a
                  href={item.viator_item_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  tabIndex={open ? 0 : -1}
                  style={{ minWidth: 0, textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.25 }}>{item.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--sand-700)', marginTop: 4,
                                display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
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
                    style={{ marginTop: 'auto', alignSelf: 'flex-start' }}
                  >
                    + Add
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
