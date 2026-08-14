import type { ViatorGroup, ViatorItem, SwapReason, Region, Section } from '../types';
import BookAheadBadge from './BookAheadBadge';
import { RatingChipInline, hasRealRating } from './RatingChip';
import { Star, MapPin, Clock, Dollar, Check, Swap, Plus } from './Icons';
import GroupHeader from './GroupHeader';
import OtherSuggestionsList from './OtherSuggestionsList';
import SwapReasons, { type SwapTextProps } from './SwapReasons';
import DepartureNote from './DepartureNote';
import { productUrlFor, primarySection } from '../data/exploreItems';
import { itemSections } from '../data/itemFit';

// Region code → display label, shown with a MapPin in the itinerary card body.
const REGION_LABELS: Record<Region, string> = {
  'palm-beach':  'Palm Beach',
  'eagle-beach': 'Eagle Beach',
  'noord':       'Noord',
  'oranjestad':  'Oranjestad',
  'san-nicolas': 'San Nicolas',
  'arikok':      'Arikok National Park',
  'savaneta':    'Savaneta',
  'islandwide':  'Across Aruba',
};

type Props = {
  group: ViatorGroup;
  bestSeller: ViatorItem;
  others: ViatorItem[];
  bookUrl?: string | null;
  approved?: boolean;     // Explore-only ("Add"/"Added" state); itinerary no longer approves
  onApprove?: () => void; // Explore-only ("Add to plan")
  onSwap?: () => void;
  onFlip: () => void;
  variant?: 'itinerary' | 'explore';
  // Itinerary-only: true after "Swap this" is pressed — reveals the
  // "Why swap?" chip strip below the (still-visible) action row.
  showReasons?: boolean;
  onPickReason?: (reason: SwapReason) => void;
} & SwapTextProps & {
  // Itinerary-only: controlled state for the "Other suggestions" expandable
  // list, so the parent can resize the fixed-height flip-card to fit it.
  suggestionsOpen?: boolean;
  onToggleSuggestions?: () => void;
  // Itinerary-only: "+ Add" on an "other suggestion" — appends a new card to
  // the day. The row's title link still opens the affiliate URL.
  onAddItem?: (item: ViatorItem) => void;
  onNavigateToSection?: (section: Section) => void;
  pinned?: boolean;
  splurge?: boolean;
  staple?: boolean;
  /** Human label for a route family the trip already used, e.g. "sail". */
  dupeFamily?: string;
};

export default function GroupCard({
  group, bestSeller, others, approved, onApprove, onSwap, onFlip,
  variant = 'itinerary', showReasons, onPickReason,
  onSubmitReasonText, reasonPending, reasonFailed, echo,
  suggestionsOpen, onToggleSuggestions, onAddItem, bookUrl, onNavigateToSection, pinned, splurge, staple, dupeFamily,
}: Props) {
  const tourUrl = productUrlFor(bestSeller);
  const headerSection = primarySection(itemSections(bestSeller));

  return (
    <div className="chunky" style={{
      borderWidth: 2, padding: 0, overflow: 'hidden',
      background: 'var(--cream)',
      ...(variant === 'itinerary'
        ? { height: '100%', display: 'flex', flexDirection: 'column' as const }
        : {}),
    }}>
      <GroupHeader
        group={group}
        href={onNavigateToSection ? undefined : (tourUrl ?? undefined)}
        onNavigate={onNavigateToSection ? () => onNavigateToSection(headerSection) : undefined}
      />

      {variant === 'explore'
        ? <ExploreBody
            bestSeller={bestSeller}
            tourUrl={tourUrl}
            others={others}
            approved={!!approved}
            onApprove={onApprove ?? (() => {})}
          />
        : <ItineraryBody
            bestSeller={bestSeller}
            tourUrl={tourUrl}
            bookUrl={bookUrl ?? null}
            pinned={pinned}
            splurge={splurge}
            staple={staple}
            dupeFamily={dupeFamily}
            location={REGION_LABELS[bestSeller.region ?? group.region]}
            onSwap={onSwap}
            onFlip={onFlip}
            showReasons={showReasons}
            onPickReason={onPickReason}
            onSubmitReasonText={onSubmitReasonText}
            reasonPending={reasonPending}
            reasonFailed={reasonFailed}
            echo={echo}
          />
      }

      <OtherSuggestionsList
        items={others}
        open={suggestionsOpen}
        onToggle={onToggleSuggestions}
        onAddItem={onAddItem}
      />
    </div>
  );
}

// Explore variant — stacked: hero image, then body that mirrors the .a-card layout.
// No "Sounds good"/"Swap this" buttons here; left action button matches the
// community-card "View details" affordance (no-op for now, like community cards).
function ExploreBody({
  bestSeller, tourUrl, others, approved, onApprove,
}: {
  bestSeller: ViatorItem;
  tourUrl: string | null;
  others: ViatorItem[];
  approved: boolean;
  onApprove: () => void;
}) {
  // Price range across all items in the group (the best-seller + others).
  // Falls back to a single-price label if every item is priced the same.
  const prices = [bestSeller.price_usd, ...others.map((o) => o.price_usd)];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceLabel = minPrice === maxPrice ? `$${minPrice}` : `$${minPrice}-$${maxPrice}`;

  return (
    <>
      {/* Full-width hero — same 180px height as .a-card .a-img. The whole
          hero is an outbound affiliate link (carries the PID via the URL). */}
      <a
        href={tourUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`View ${bestSeller.title}`}
        style={{ display: 'block', height: 180, overflow: 'hidden', position: 'relative', background: 'var(--sand-100)', cursor: tourUrl ? 'pointer' : 'default' }}
      >
        <img src={bestSeller.image_url} alt={bestSeller.title}
             style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
             loading="lazy" />
        {hasRealRating(bestSeller.rating, bestSeller.review_count) && (
          <span style={{
            position: 'absolute', top: 12, right: 12,
            background: 'var(--ink)', color: 'var(--yellow)',
            padding: '4px 10px', borderRadius: 999,
            fontSize: 12, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <RatingChipInline rating={bestSeller.rating} reviewCount={bestSeller.review_count} size={12} />
          </span>
        )}
      </a>

      <div style={{ padding: 16 }}>
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.15em',
          color: '#888', marginBottom: 6,
        }}>SUGGESTED</div>

        {/* Best-seller title — outbound affiliate link */}
        <a
          href={tourUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <h3 className="font-display" style={{
            fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)',
          }}>{bestSeller.title}</h3>
        </a>

        {bestSeller.description && (
          <p style={{
            fontSize: 13, lineHeight: 1.5, color: 'var(--sand-700)',
            margin: '0 0 12px',
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {bestSeller.description}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}>
            <Clock size={11} aria-hidden /> {bestSeller.duration}
          </span>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}>
            <Dollar size={11} aria-hidden /> {priceLabel}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {/* "View details" — opens the suggested tour */}
          <a
            href={tourUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
            style={{
              flex: 1, padding: '9px 12px', fontSize: 13,
              textDecoration: 'none', textAlign: 'center', display: 'inline-block',
            }}
          >
            View details
          </a>
          <button
            onClick={onApprove}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 14px', borderRadius: 12,
              border: '2px solid var(--ink)', fontWeight: 700,
              fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
              background: approved ? 'var(--green)' : 'var(--red)',
              color: 'var(--cream)',
              boxShadow: '3px 3px 0 var(--ink)',
            }}
          >
            {approved
              ? <><Check size={13} aria-hidden /> Added</>
              : <><Plus  size={13} aria-hidden /> Add</>}
          </button>
        </div>
      </div>
    </>
  );
}

// Itinerary variant — bleeding-edge image + body layout matching the local
// activity card (ActivityCardFront), with the group-specific SUGGESTED label.
// The flip-to-back face is wired by the parent (ItineraryCard).
function ItineraryBody({
  bestSeller, tourUrl, bookUrl, location, onSwap, onFlip, showReasons, onPickReason, pinned, splurge, staple, dupeFamily,
  onSubmitReasonText, reasonPending, reasonFailed, echo,
}: {
  bestSeller: ViatorItem;
  tourUrl: string | null;
  bookUrl: string | null;
  location: string;
  onSwap?: () => void;
  onFlip: () => void;
  showReasons?: boolean;
  onPickReason?: (reason: SwapReason) => void;
  pinned?: boolean;
  splurge?: boolean;
  staple?: boolean;
  dupeFamily?: string;
} & SwapTextProps) {
  return (
    <div className="itin-card-split" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Bleeding-edge image — full card height; clicking flips to ratings */}
      <button
        className="itin-card-image-btn"
        onClick={onFlip}
        aria-label="See more about this"
        style={{
          flex: '0 0 200px', height: '100%',
          background: 'var(--sand-100)',
          border: 'none', padding: 0, cursor: 'pointer',
          position: 'relative', overflow: 'hidden',
        }}
      >
        <img src={bestSeller.image_url} alt={bestSeller.title}
             style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <span style={{
          position: 'absolute', bottom: 10, left: 10,
          background: 'rgba(26,26,26,0.85)', color: 'var(--cream)',
          fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999,
        }}>Tap to flip ↻</span>
      </button>

      <div className="itin-card-body"
           style={{ flex: 1, padding: '14px 18px', minWidth: 0,
                    display: 'flex', flexDirection: 'column' }}>
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.15em',
          color: '#888', marginBottom: 4,
        }}>SUGGESTED</div>

        <div style={{ display: 'flex', alignItems: 'flex-start',
                      justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            {tourUrl ? (
              <a
                href={tourUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <h3 className="font-display" style={{
                  fontSize: 19, lineHeight: 1.15, margin: '0 0 6px', color: 'var(--ink)',
                }}>{bestSeller.title}</h3>
              </a>
            ) : (
              <h3 className="font-display" style={{
                fontSize: 19, lineHeight: 1.15, margin: '0 0 6px', color: 'var(--ink)',
              }}>{bestSeller.title}</h3>
            )}
            {location && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4,
                            color: 'var(--sand-500)', fontSize: 12, marginBottom: 6 }}>
                <MapPin size={12} aria-hidden /><span>{location}</span>
              </div>
            )}
          </div>
          {hasRealRating(bestSeller.rating, bestSeller.review_count) && (
            <span className="chip-outline" style={{
              fontSize: 11, background: 'var(--yellow)', flexShrink: 0,
            }}>
              <RatingChipInline rating={bestSeller.rating} reviewCount={bestSeller.review_count} size={11} />
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <span className="chip-outline" style={{ fontSize: 11, padding: '2px 9px' }}>
            <Clock size={11} aria-hidden /> {bestSeller.duration}
          </span>
          <span className="chip-outline" style={{ fontSize: 11, padding: '2px 9px' }}>
            <Dollar size={11} aria-hidden /> ${bestSeller.price_usd}
          </span>
          {bestSeller.fitReason && (
            <span className="chip-outline chip-coral" style={{ fontSize: 11, padding: '2px 9px' }}>
              {bestSeller.fitReason}
            </span>
          )}
          {pinned && <span className="itin-pinned-badge">★ Your pick</span>}
          {splurge && !pinned && <span className="itin-splurge-badge">✨ Signature splurge</span>}
          {staple && !pinned && !splurge && <span className="itin-staple-badge">◑ Island classic</span>}
          {dupeFamily && <span className="itin-dupe-badge">⚠ 2nd {dupeFamily} this trip</span>}
        </div>

        {/* A departure PLACE is boats-only and rare (35 of 135 water items); a
            start TIME is neither — 281 of 328 products carry one, so this box is
            the common case, not the exception. It matters more here than on
            Explore: by the itinerary the traveller has committed to the day, and
            "where do I actually turn up, and when?" is the next question.
            ItineraryCard sizes the flip card for this box, so the two must agree
            on exactly when it renders — hence both go through DepartureNote. */}
        <DepartureNote item={bestSeller} />

        <div style={{ marginTop: 'auto' }}>
          {/* "Book now" leads, "Swap this" follows — same order as
              ItineraryCard, so the primary action never moves between a local
              pick and a Viator card in the same day. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {bookUrl ? (
              <a href={bookUrl} target="_blank" rel="noopener noreferrer" className="itin-book-btn">Book now ↗</a>
            ) : bestSeller.price_usd === 0 ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 13px', fontSize: 13, fontWeight: 700, borderRadius: 10, border: '2px solid var(--ink)', background: '#A8F5B8', color: 'var(--ink)', boxShadow: '2px 2px 0 var(--ink)' }}>✓ Free</span>
            ) : null}
            {onSwap && (
              <button onClick={onSwap} className="btn-ghost"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 13px', fontSize: 13,
                }}>
                <Swap size={13} aria-hidden /> Swap this
              </button>
            )}
            {/* Bottom-right of the card, beside the actions — Viator's own note
                on how the product is selling. marginLeft:auto pushes it to the
                corner without a second row. */}
            <BookAheadBadge item={bestSeller} />
          </div>
          <SwapReasons open={!!showReasons} onPick={(r) => onPickReason?.(r)}
            onSubmitText={onSubmitReasonText} pending={reasonPending} failed={reasonFailed} />
          {!!echo?.length && <div className="swap-echo">Swapped for: {echo.join(', ')}</div>}
        </div>
      </div>
    </div>
  );
}
