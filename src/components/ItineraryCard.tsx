import { useState } from 'react';
import { RatingChipInline, hasRealRating } from './RatingChip';
import type { Activity } from '../data/activities';
import type { CardEntry, SwapReason, ViatorItem, Section } from '../types';
import { Star, MapPin, Clock, Dollar, Swap } from './Icons';
import GroupCard from './GroupCard';
import CardBack from './CardBack';
import SwapReasons, { type SwapTextProps } from './SwapReasons';
import { productUrlFor, primarySection, bookUrlForActivity } from '../data/exploreItems';
import { parseActivityCost, showsFreeTag } from '../data/matcher';

type Props = {
  entry: CardEntry;
  flipped: boolean;
  swapping: boolean;
  pinned?: boolean;
  splurge?: boolean;
  staple?: boolean;
  /** Human label for a route family this trip already used, e.g. "sail". */
  dupeFamily?: string;
  onFlip: () => void;
  onSwap?: () => void;
  showReasons?: boolean;
  onPickReason?: (reason: SwapReason) => void;
} & SwapTextProps & {
  onAddItem?: (item: ViatorItem) => void;
  onNavigateToSection?: (section: Section) => void;
};

// Card height is CSS's job now, not arithmetic's — see `.flip-card` in
// src/index.css. Cards size to their content with a min-height floor, which is
// why nothing here computes pixels any more. Three clipping bugs in one week
// came out of the sum this replaced.

export default function ItineraryCard({
  entry, flipped, swapping, pinned, splurge, staple, dupeFamily, onFlip, onSwap,
  showReasons = false, onPickReason, onAddItem, onNavigateToSection,
  onSubmitReasonText, reasonPending, reasonFailed, echo,
}: Props) {
  // Per-card state for the group's "Other suggestions" expand/collapse.
  // Lives here (not in OtherSuggestionsList) so the card's fixed height —
  // required by the flip-animation CSS — can grow when the list opens.
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  // A "Book now" target for any bookable card (paid + has a link). Lunch spots
  // and free editorial picks have no link, so they get no button. Groups are
  // always Viator (a matched best-seller product); the activity branch can also
  // produce a direct operator link, which the button words identically.
  const activityBook = entry.kind === 'activity' ? bookUrlForActivity(entry.activity) : null;
  const bookUrl: string | null = entry.kind === 'group'
    ? (entry.bestSeller.viator_item_url && entry.bestSeller.price_usd > 0 ? productUrlFor(entry.bestSeller) : null)
    : (activityBook?.url ?? null);

  const otherCount = entry.kind === 'group' ? entry.others.length : 0;

  const classes = ['flip-card', 'fade-in'];
  if (flipped)  classes.push('flipped');
  if (swapping) classes.push('swap-flipping');

  const back = entry.kind === 'activity'
    ? <CardBack kind="activity" activity={entry.activity} onFlip={onFlip} />
    : <CardBack kind="group"    bestSeller={entry.bestSeller}  onFlip={onFlip} />;

  const front = entry.kind === 'activity'
    ? <ActivityCardFront a={entry.activity} bookUrl={bookUrl} pinned={pinned} staple={staple} dupeFamily={dupeFamily}
                         onFlip={onFlip} onSwap={onSwap}
                         showReasons={showReasons} onPickReason={onPickReason}
                         onSubmitReasonText={onSubmitReasonText} reasonPending={reasonPending}
                         reasonFailed={reasonFailed} echo={echo}
                         onNavigateToSection={onNavigateToSection} />
    : <GroupCard group={entry.group} bestSeller={entry.bestSeller}
                 others={entry.others} bookUrl={bookUrl} pinned={pinned} splurge={splurge} staple={staple} dupeFamily={dupeFamily}
                 onSwap={onSwap} onFlip={onFlip}
                 showReasons={showReasons} onPickReason={onPickReason}
                 suggestionsOpen={suggestionsOpen}
                 onToggleSuggestions={() => setSuggestionsOpen((v) => !v)}
                 onAddItem={onAddItem}
                 onNavigateToSection={onNavigateToSection} />;

  return (
    <div className={classes.join(' ')}>
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
  a, bookUrl, pinned, staple, dupeFamily, onFlip, onSwap, showReasons, onPickReason, onNavigateToSection,
  onSubmitReasonText, reasonPending, reasonFailed, echo,
}: {
  a: Activity;
  bookUrl: string | null;
  pinned?: boolean;
  staple?: boolean;
  dupeFamily?: string;
  onFlip: () => void;
  onSwap?: () => void;
  showReasons?: boolean;
  onPickReason?: (reason: SwapReason) => void;
  onNavigateToSection?: (section: Section) => void;
} & SwapTextProps) {
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
          aria-label="See more about this"
          style={{
            /* A PROPORTION, not a fixed 200px, since that is what was asked for:
               "the proportion of the picture to the width of the card, 70% more
               than it is now". Measured on the built app before the change — a
               1140px card with a 200px image, i.e. 17.5% — so 17.5 x 1.7 =
               29.75%.
               Percentage rather than the equivalent 340px on purpose: a fixed
               width would hold at 340 as the card narrows and reach 51% of a
               660px card at 768px, squeezing the text pane. As a share it stays
               29.75% everywhere. That is NOT "narrow cards stay where they
               were", which an earlier version of this comment claimed off a
               single 768px measurement: the photo matches 200px only around
               768, and below that it SHRINKS — 171px at 700 and 154px at 641,
               about a fifth smaller than before. The brief was more photo, and
               in the 641-750 band this delivers less. Revisit with a second
               breakpoint if that band matters; it is above the 640 stack point,
               so it is tablets in portrait rather than phones.
               Below 640px the image stacks full-width and none of this applies
               — see .itin-card-image-btn in index.css. */
            flex: '0 0 29.75%', height: '100%',
            background: 'var(--sand-100)',
            border: 'none', padding: 0, cursor: 'pointer',
            position: 'relative', overflow: 'hidden',
          }}>
          <img src={a.image} alt={a.title}
               style={{
                 /* ABSOLUTE, so the photo fills the column without SIZING it.
                    The button is `height: auto !important` (index.css
                    .itin-card-image-btn), so a statically-positioned img's
                    `height: 100%` has no definite height to resolve against and
                    falls back to the intrinsic aspect ratio — which means
                    `object-fit: cover` never crops and the image sets the card's
                    height instead. Harmless at a fixed 200px column; at 29.75%
                    it multiplied card height by the same 1.7. Measured at 1440:
                    the O'Niels card went 337px -> 540px, ~370px of it empty
                    space above Swap this, because that photo is portrait (0.67).
                    Five of the six sub-1.4 aspect images in public/ are food
                    photos, i.e. the lunch or dinner slot of most days.
                    Positioning it out of flow gives the button a definite box to
                    stretch into and lets cover do the cropping it was there for. */
                 position: 'absolute', inset: 0,
                 width: '100%', height: '100%', objectFit: 'cover', display: 'block',
               }} />
          <span style={{
            position: 'absolute', bottom: 10, left: 10,
            background: 'rgba(26,26,26,0.85)', color: 'var(--cream)',
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999,
            // Not "Tap for ratings": only 12 of 26 picks have a sourced quote and
            // only a matched pick can have a rating, so the back is often a local
            // tip instead. The label must not promise a rating that isn't there.
          }}>Tap to flip ↻</span>
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
            {a.ratingSource === 'viator' && hasRealRating(a.rating, a.reviewCount) && (
              <span className="chip-outline" style={{
                fontSize: 11, background: 'var(--yellow)', flexShrink: 0,
              }}>
                <RatingChipInline rating={a.rating} reviewCount={a.reviewCount} size={11} />
              </span>
            )}
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
            {staple && !pinned && <span className="itin-staple-badge">◑ Island classic</span>}
            {dupeFamily && <span className="itin-dupe-badge">⚠ 2nd {dupeFamily} this trip</span>}
          </div>
          <div style={{ marginTop: 'auto' }}>
            {/* "Book now" leads, "Swap this" follows: the primary action sits
                where the eye lands first. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {bookUrl ? (
                <a href={bookUrl} target="_blank" rel="noopener noreferrer" className="itin-book-btn">
                  Book now ↗
                </a>
              ) : showsFreeTag(a) ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 13px', fontSize: 13, fontWeight: 700, borderRadius: 10, border: '2px solid var(--ink)', background: '#A8F5B8', color: 'var(--ink)', boxShadow: '2px 2px 0 var(--ink)' }}>✓ Free</span>
              ) : null}
              {onSwap && (
                <button onClick={onSwap} className="btn-ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                           padding: '8px 13px', fontSize: 13 }}>
                  <Swap size={13} aria-hidden /> Swap this
                </button>
              )}
            </div>
            <SwapReasons open={!!showReasons} onPick={(r) => onPickReason?.(r)}
              onSubmitText={onSubmitReasonText} pending={reasonPending} failed={reasonFailed} />
            {!!echo?.length && <div className="swap-echo">Swapped for: {echo.join(', ')}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
