import { useState } from 'react';
import type { Activity } from '../data/activities';
import type { CardEntry, SwapReason, ViatorItem, Section } from '../types';
import { Star, MapPin, Clock, Dollar, Swap } from './Icons';
import GroupCard from './GroupCard';
import CardBack from './CardBack';
import SwapReasons, { SWAP_REASONS_OPEN_PX } from './SwapReasons';
import { otherSuggestionsExpandedPx } from './OtherSuggestionsList';
import { productUrlFor, viatorLink, primarySection } from '../data/exploreItems';
import { parseActivityCost } from '../data/matcher';

type Props = {
  entry: CardEntry;
  flipped: boolean;
  swapping: boolean;
  pinned?: boolean;
  splurge?: boolean;
  onFlip: () => void;
  onSwap?: () => void;
  showReasons?: boolean;
  onPickReason?: (reason: SwapReason) => void;
  onAddItem?: (item: ViatorItem) => void;
  onNavigateToSection?: (section: Section) => void;
};

// Base height — accommodates the green header band (~44px) on top of both
// front faces. Itinerary cards grow vertically when the group "Other
// suggestions" list is expanded; see EXPANDED_PER_ITEM below.
const BASE_HEIGHT = 284;
// Card growth when the chip strip is open = strip height + its 8px margin-top.
// Must equal the strip's open footprint so the action row stays put.
const REASONS_EXTRA = SWAP_REASONS_OPEN_PX;

export default function ItineraryCard({
  entry, flipped, swapping, pinned, splurge, onFlip, onSwap,
  showReasons = false, onPickReason, onAddItem, onNavigateToSection,
}: Props) {
  // Per-card state for the group's "Other suggestions" expand/collapse.
  // Lives here (not in OtherSuggestionsList) so the card's fixed height —
  // required by the flip-animation CSS — can grow when the list opens.
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  // A "Book now" target for any bookable card (paid + has a Viator link). Lunch
  // spots and free editorial picks have no link, so they get no button.
  const bookUrl: string | null = entry.kind === 'group'
    ? (entry.bestSeller.viator_item_url && entry.bestSeller.price_usd > 0 ? productUrlFor(entry.bestSeller) : null)
    : (entry.activity.viator_item_url && parseActivityCost(entry.activity.cost) > 0 ? viatorLink(entry.activity.viator_item_url) : null);

  const otherCount = entry.kind === 'group' ? entry.others.length : 0;
  const height = BASE_HEIGHT
    + (suggestionsOpen ? otherSuggestionsExpandedPx(otherCount) : 0)
    + (showReasons ? REASONS_EXTRA : 0);

  const classes = ['flip-card', 'fade-in'];
  if (flipped)  classes.push('flipped');
  if (swapping) classes.push('swap-flipping');

  const back = entry.kind === 'activity'
    ? <CardBack kind="activity" activity={entry.activity} onFlip={onFlip} />
    : <CardBack kind="group"    bestSeller={entry.bestSeller}  onFlip={onFlip} />;

  const front = entry.kind === 'activity'
    ? <ActivityCardFront a={entry.activity} bookUrl={bookUrl} pinned={pinned}
                         onFlip={onFlip} onSwap={onSwap}
                         showReasons={showReasons} onPickReason={onPickReason}
                         onNavigateToSection={onNavigateToSection} />
    : <GroupCard group={entry.group} bestSeller={entry.bestSeller}
                 others={entry.others} bookUrl={bookUrl} pinned={pinned} splurge={splurge}
                 onSwap={onSwap} onFlip={onFlip}
                 showReasons={showReasons} onPickReason={onPickReason}
                 suggestionsOpen={suggestionsOpen}
                 onToggleSuggestions={() => setSuggestionsOpen((v) => !v)}
                 onAddItem={onAddItem}
                 onNavigateToSection={onNavigateToSection} />;

  return (
    <div className={classes.join(' ')} style={{ height }}>
      <div className="flip-inner" style={{ height: '100%' }}>
        {front}
        {back}
      </div>
    </div>
  );
}

// Local activity (non-Viator) card front face — preserved from the original
// inline CardFront in Itinerary.tsx, with the same look and behavior.
function ActivityCardFront({
  a, bookUrl, pinned, onFlip, onSwap, showReasons, onPickReason, onNavigateToSection,
}: {
  a: Activity;
  bookUrl: string | null;
  pinned?: boolean;
  onFlip: () => void;
  onSwap?: () => void;
  showReasons?: boolean;
  onPickReason?: (reason: SwapReason) => void;
  onNavigateToSection?: (section: Section) => void;
}) {
  const headerContent = (
    <>
      <div className="chb-title">{a.category}</div>
    </>
  );
  return (
    <div className="chunky flip-face itin-card-front"
         style={{ borderWidth: 2, height: '100%', overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
      {onNavigateToSection
        ? <button type="button" className="card-header-band" onClick={() => onNavigateToSection(primarySection(a.sections ?? []))} aria-label={`Explore ${a.category}`}>{headerContent}<span aria-hidden className="chb-chev">›</span></button>
        : <div className="card-header-band">{headerContent}</div>
      }
      <div className="itin-card-split" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <button
          className="itin-card-image-btn"
          onClick={onFlip}
          aria-label="See ratings"
          style={{
            flex: '0 0 200px', height: '100%',
            background: 'var(--sand-100)',
            border: 'none', padding: 0, cursor: 'pointer',
            position: 'relative', overflow: 'hidden',
          }}>
          <img src={a.image} alt={a.title}
               style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <span style={{
            position: 'absolute', bottom: 10, left: 10,
            background: 'rgba(26,26,26,0.85)', color: 'var(--cream)',
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999,
          }}>Tap for ratings ↻</span>
        </button>

        <div className="itin-card-body"
             style={{ flex: 1, padding: '14px 18px', minWidth: 0,
                      display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start',
                        justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              {a.viator_item_url ? (
                <a href={a.viator_item_url} target="_blank" rel="noopener noreferrer"
                   style={{ textDecoration: 'none', color: 'inherit' }}>
                  <h3 className="font-display" style={{
                    fontSize: 19, lineHeight: 1.15, margin: '0 0 6px', color: 'var(--ink)',
                  }}>{a.title}</h3>
                </a>
              ) : (
                <h3 className="font-display" style={{
                  fontSize: 19, lineHeight: 1.15, margin: '0 0 6px', color: 'var(--ink)',
                }}>{a.title}</h3>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4,
                            color: 'var(--sand-500)', fontSize: 12, marginBottom: 6 }}>
                <MapPin size={12} /><span>{a.location}</span>
              </div>
            </div>
            <span className="chip-outline" style={{
              fontSize: 11, background: 'var(--yellow)', flexShrink: 0,
            }}>
              <Star size={11} /> {a.rating}
            </span>
          </div>
          <p style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-700)',
                      margin: '0 0 10px', display: '-webkit-box',
                      WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {a.description}
          </p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="chip-outline" style={{ fontSize: 11, padding: '2px 9px' }}>
              <Clock size={11} /> {a.duration}
            </span>
            <span className="chip-outline" style={{ fontSize: 11, padding: '2px 9px' }}>
              <Dollar size={11} /> {a.cost}
            </span>
            <span className="chip-outline chip-coral" style={{ fontSize: 11, padding: '2px 9px' }}>
              {a.fitReason}
            </span>
            {pinned && <span className="itin-pinned-badge">★ Your pick</span>}
          </div>
          <div style={{ marginTop: 'auto' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {onSwap && (
                <button onClick={onSwap} className="btn-ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                           padding: '8px 13px', fontSize: 13 }}>
                  <Swap size={13} aria-hidden /> Swap this
                </button>
              )}
              {bookUrl ? (
                <a href={bookUrl} target="_blank" rel="noopener noreferrer" className="itin-book-btn">
                  Book now ↗
                </a>
              ) : parseActivityCost(a.cost) === 0 ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 13px', fontSize: 13, fontWeight: 700, borderRadius: 10, border: '2px solid var(--ink)', background: '#A8F5B8', color: 'var(--ink)', boxShadow: '2px 2px 0 var(--ink)' }}>✓ Free</span>
              ) : null}
            </div>
            <SwapReasons open={!!showReasons} onPick={(r) => onPickReason?.(r)} />
          </div>
        </div>
      </div>
    </div>
  );
}
