import type { ReactNode } from 'react';
import { viatorProductCode } from '../data/exploreItems';
import { whatToExpectFor } from '../data/whatToExpect';
import RatingBreakdown from './RatingBreakdown';
import { hasBreakdown } from '../data/reviewBreakdown';
import type { Activity } from '../data/activities';
import { gearRentalFor } from '../data/gearRental';
import type { ViatorItem } from '../types';
import { Star } from './Icons';

type Props =
  | { kind: 'activity'; activity: Activity; onFlip: () => void }
  | { kind: 'group'; bestSeller: ViatorItem; onFlip: () => void };

/**
 * The card back shows social proof — and therefore shows NOTHING it cannot
 * source.
 *
 * It used to fall back to `{ rating: 4.2, mentions: 60, quote: 'Solid pick.
 * Goes on most r/Aruba shortlists.' }` under an r/Aruba-branded badge whenever a
 * card had no real quote, which was 14 of the 26 local picks. An invented rating
 * presented as a community rating is a fabricated review: wrong on the facts,
 * and a named prohibited practice under EU unfair-commercial-practices rules on
 * a site that earns affiliate revenue.
 *
 * The rule now: each block renders only when real data backs it, and a card with
 * neither shows the editorial local tip instead of a manufactured consensus.
 */

const ACTIVITY_REDDIT: Record<string, { rating: number; mentions: number; quote: string }> = {
  'eagle-beach-morning':       { rating: 4.6, mentions: 312, quote: "Get there at 6:30am if you want a divi-divi for yourself. By 10 it's gone." },
  'california-lighthouse-sunset': { rating: 4.3, mentions: 184, quote: 'Park up top and walk down the cliff path — way less crowded than the lighthouse itself.' },
  'boca-catalina-snorkel':     { rating: 4.5, mentions: 226, quote: "Turtles for sure. Don't kick the reef — locals will yell at you and they're right." },
  'oranjestad-walking':        { rating: 4.0, mentions: 91,  quote: 'Skip the cruise-ship hours (9–1). Late afternoon is way nicer.' },
  'antilla-wreck-dive':        { rating: 4.7, mentions: 173, quote: 'World-class. The shallow sections work fine for AOW. Bring a torch.' },
  'arikok-hiking':             { rating: 4.4, mentions: 152, quote: 'Guided is worth it — half the cave paintings are unmarked.' },
  'natural-pool-jeep':         { rating: 4.6, mentions: 138, quote: 'Bouncy as hell on the way in. Bring something secure for sunglasses.' },
  'flamingo-renaissance':      { rating: 4.1, mentions: 467, quote: 'Worth it once if you have the photo on the bucket list. Otherwise overhyped.' },
  'zeerovers-fresh-catch':     { rating: 4.8, mentions: 244, quote: "Wahoo, plantains, cold Balashi. That's the entire move." },
  'gasparito-restaurant':      { rating: 4.5, mentions: 109, quote: 'Book ahead, especially Friday. The keshi yena is legit.' },
  'kitesurfing-lesson':        { rating: 4.6, mentions: 78,  quote: '15+ knots almost every afternoon. Vela is the school most locals send people to.' },
  'baby-beach-snorkel':        { rating: 4.4, mentions: 198, quote: 'Hidden gem if you make the drive. Bring water — no shops nearby.' },
};

const ACTIVITY_TA: Record<string, string> = {
  'eagle-beach-morning':       'A must-do in Aruba. Book the early morning slot for the best experience.',
  'california-lighthouse-sunset': 'Beautiful sunset view. Arrive 30 minutes early for the best photo spot.',
  'boca-catalina-snorkel':     'We saw 4 sea turtles in an hour. Guide was patient with beginners.',
  'oranjestad-walking':        'Loved the architecture and the history. Our guide was a local who told us great stories.',
  'antilla-wreck-dive':        'Top dive of our trip. Visibility was incredible.',
};

/**
 * Cut text at a SENTENCE boundary within a budget, never mid-sentence.
 *
 * The card back is height-constrained by the front — `.flip-back` is
 * `position: absolute; inset: 0` — so a long Overview ran past the fold and left
 * a sentence hanging with no full stop. Scrolling reached the rest, but a
 * half-sentence at the bottom edge reads as broken text rather than as more
 * text, and nobody scrolls a card back to find out.
 *
 * Cuts at the last `.`, `!` or `?` at or before the budget. If the very first
 * sentence is already longer than the budget, that sentence is kept whole rather
 * than chopped: an over-long paragraph is a worse look than an over-full card,
 * and the container still scrolls.
 */
function trimToSentence(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const head = t.slice(0, maxChars);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '),
                       head.lastIndexOf('.\n'), head.lastIndexOf('!\n'), head.lastIndexOf('?\n'));
  if (cut > 0) return t.slice(0, cut + 1);
  // No sentence ended inside the budget — keep the first whole one.
  const first = t.search(/[.!?](\s|$)/);
  return first > 0 ? t.slice(0, first + 1) : t;
}

export default function CardBack(props: Props) {
  const isActivity = props.kind === 'activity';
  // Only the free shore-snorkel picks. A guided trip includes equipment in the
  // fare, and telling that traveller to go and rent a mask is worse than saying
  // nothing — see GEAR_RENTAL_IDS.
  const gear = isActivity ? gearRentalFor(props.activity.id) : null;
  const title = isActivity ? props.activity.title : props.bestSeller.title;

  // A curated pick that mergeLocalMatches paired with a real product adopts that
  // product's TITLE, rating and review count while staying kind:'activity'. So
  // "Catamaran Sail & Snorkel at Boca Catalina" renders as "Arusun Catamaran
  // Sail with Snorkeling in Aruba" — and used to bring its editorial r/Aruba
  // quote along, a line written about a free snorkel spot, displayed under a
  // commercial operator's name. That is misattribution of exactly the kind the
  // honest-ratings rules exist to prevent, and it also meant the card missed the
  // Overview, the running order and the rating histogram the product does have.
  //
  // So: once a pick has taken a product's identity, it is shown as that product.
  const matchedCode = isActivity && props.activity.ratingSource === 'viator'
    ? viatorProductCode(props.activity.viator_item_url)
    : '';
  const isMatchedLocal = matchedCode.length > 0;

  const reddit = isActivity
    ? (isMatchedLocal ? undefined : ACTIVITY_REDDIT[props.activity.id])
    : props.bestSeller.reddit_quote;

  const travellerQuote = isActivity
    ? (isMatchedLocal ? undefined : ACTIVITY_TA[props.activity.id])
    : props.bestSeller.ta_quote;

  // Viator supplies rating + review count for every catalog item. A local pick
  // only has them when loadCatalog merged a matched product in — otherwise
  // `rating` is the editorial ranking weight and must not be shown as a star.
  const rating = isActivity ? props.activity.rating : props.bestSeller.rating;
  const reviewCount = isActivity ? props.activity.reviewCount : props.bestSeller.review_count;
  const ratingIsReal = isActivity ? props.activity.ratingSource === 'viator' : true;
  const showTravellers =
    ratingIsReal && typeof rating === 'number' && rating > 0 && typeof reviewCount === 'number';

  // A Viator card's back is two halves, by design: how people rated it, and what
  // the operator says it is. Both come from the product's own listing.
  //
  // The Reddit quote is skipped on those cards — not because it is worthless,
  // but because the grid below lays out two columns and three blocks would make
  // each unreadably narrow. Local picks keep it: they have no Viator listing to
  // show instead, which is exactly when a traveller's own words are worth most.
  const productId = isActivity ? (matchedCode || null) : props.bestSeller.id;
  // Two DIFFERENT sections of the product's page, labelled as such rather than
  // merged. `description` is the Overview; `activityInfo.description` is What to
  // expect. Concatenating them put "After check in at our desk, our crew will
  // shuttle you with a zodiac…" at the top of a block headed Overview.
  const overviewRaw = isActivity
    ? (isMatchedLocal ? (props.activity.description ?? '').trim() : '')
    : (props.bestSeller.description ?? '').trim();
  const whatToExpectRaw = productId ? whatToExpectFor(productId) : '';
  // Budgets, not a single cap: with both sections present they share the space,
  // and with only an Overview it can have the lot. Numbers chosen against the
  // narrowest card that still has a fixed height, at 11.5px/1.45.
  const whatToExpect = trimToSentence(whatToExpectRaw, 320);
  const overview = trimToSentence(overviewRaw, whatToExpect ? 420 : 700);
  const showBreakdown = Boolean(productId && hasBreakdown(productId));
  // A product card gets two halves whenever it has words to show. The ratings
  // half no longer depends on there BEING ratings: 45 of 368 products have none
  // yet, and dropping the half for those left a card that looked half-built
  // rather than one whose product is simply new. It says so instead.
  const twoHalves = Boolean(productId)
    && (overview.length > 0 || whatToExpect.length > 0);

  const blocks: ReactNode[] = [];

  if (reddit && !twoHalves) {
    blocks.push(
      <div key="reddit" style={{ background: '#FFF4E6', border: '2px solid #FF4500',
                    borderRadius: 12, padding: 12,
                    display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 22, height: 22, borderRadius: '50%',
            background: '#FF4500', color: 'white',
            fontWeight: 700, fontSize: 12,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>r</span>
          <span style={{ fontWeight: 700, fontSize: 12, color: '#7A2A00' }}>r/Aruba</span>
          <span style={{ fontSize: 10, color: '#B05500', marginLeft: 'auto' }}>
            {reddit.mentions} mentions
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', gap: 1 }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Star key={s} size={12}
                    fill={s <= Math.round(reddit.rating) ? '#FF4500' : 'transparent'}
                    color="#FF4500" />
            ))}
          </div>
          <span style={{ fontWeight: 700, fontSize: 12, color: '#7A2A00' }}>{reddit.rating}</span>
        </div>
        <p style={{ fontSize: 11.5, lineHeight: 1.4, color: '#7A2A00',
                    margin: 0, fontStyle: 'italic', overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
          "{reddit.quote}"
        </p>
      </div>,
    );
  }

  if (twoHalves && !showBreakdown && !showTravellers) {
    // No reviews on any platform. Saying nothing reads as a broken card; a zero
    // reads as a bad product. Neither is true — nobody has been yet.
    blocks.push(
      <div key="noreviews" style={{ background: 'var(--sand-50)', border: '2px dashed var(--ink)',
                    borderRadius: 12, padding: 12, minHeight: 0,
                    display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>No reviews yet</span>
        <p style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--sand-700)', margin: 0 }}>
          This one is new to the catalogue, so nobody has rated it yet. Check the booking page for
          the latest.
        </p>
      </div>,
    );
  } else if (showBreakdown && productId) {
    // The distribution, when we captured one. Strictly better than the average
    // alone — see RatingBreakdown for why five bars beat one number.
    blocks.push(<RatingBreakdown key="breakdown" id={productId} />);
  } else if (showTravellers) {
    // Fallback for the 44 products with no captured histogram. Deliberately
    // unbranded: these numbers come from the booking API, not from TripAdvisor,
    // and the cards carry no Viator branding by design — so the block says what
    // the number is rather than borrowing a logo for it.
    blocks.push(
      <div key="travellers" style={{ background: '#E9F7EF', border: '2px solid #22C55E',
                    borderRadius: 12, padding: 12,
                    display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: '#155724' }}>Traveller reviews</span>
          <span style={{ fontSize: 10, color: '#3A7D44', marginLeft: 'auto' }}>
            {reviewCount.toLocaleString()} reviews
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', gap: 1 }}>
            {[1, 2, 3, 4, 5].map((sIdx) => (
              <Star key={sIdx} size={13}
                    fill={sIdx <= Math.round(rating as number) ? '#22C55E' : 'transparent'}
                    color="#22C55E" aria-hidden />
            ))}
          </div>
          <span style={{ fontWeight: 700, fontSize: 12, color: '#155724' }}>{rating}</span>
        </div>
      </div>,
    );
  }

  // The other half: the operator's own words, under the same headings the Viator
  // page uses. Overview arrived truncated at 200 characters until 2026-08-14 —
  // the median is 601 — so this block was an ellipsis with a sentence in front.
  if (twoHalves && (overview || whatToExpect)) {
    const para = (text: string, key: string) =>
      text.split('\n\n').filter(Boolean).map((p, i) => (
        <p key={`${key}-${i}`} style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--sand-700)', margin: 0 }}>
          {p}
        </p>
      ));
    blocks.push(
      <div key="overview" style={{ background: 'var(--sand-50)', border: '2px solid var(--ink)',
                    borderRadius: 12, padding: 12, minHeight: 0,
                    display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex',
                      flexDirection: 'column', gap: 6 }}>
          {overview && (
            <>
              <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>Overview</span>
              {para(overview, 'ov')}
            </>
          )}
          {whatToExpect && (
            <>
              <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)',
                             marginTop: overview ? 4 : 0 }}>What to expect</span>
              {para(whatToExpect, 'wte')}
            </>
          )}
        </div>
      </div>,
    );
  }

  const tip = isActivity
    ? (props.activity.localsSay?.trim() || props.activity.description?.trim())
    : props.bestSeller.description?.trim();
  // Group cards fall back to Viator's marketing copy, which is not a local tip.
  const tipHeading = isActivity && props.activity.localsSay?.trim()
    ? 'What locals say'
    : 'About this';

  return (
    <div className="chunky flip-face flip-back itin-card-back"
         style={{ borderWidth: 2, height: '100%', padding: '16px 18px',
                  display: 'flex', flexDirection: 'column' }}>
      {/* The padding clears the Itinerary card's control cluster, which sits over
          this corner. Explore has no cluster, so it takes the space back — hence
          a class to hang that override on rather than a second component. */}
      <div className="card-back-head" style={{ marginBottom: 10, paddingRight: 112 }}>
        <h3 className="font-display card-back-title" style={{ fontSize: 18, margin: 0, color: 'var(--ink)',
                                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </h3>
      </div>
      {blocks.length > 0 ? (
        <div className="itin-card-back-grid" style={{
          display: 'grid',
          gridTemplateColumns: blocks.length === 2 ? '1fr 1fr' : '1fr',
          gap: 10, flex: 1, minHeight: 0,
        }}>
          {blocks}
        </div>
      ) : tip ? (
        <div style={{ background: 'var(--sand-100)', border: '2px solid var(--ink)',
                      borderRadius: 12, padding: 14, flex: 1, minHeight: 0,
                      display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>{tipHeading}</span>
          <p style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-700)',
                      margin: 0, fontStyle: 'italic', overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 6, WebkitBoxOrient: 'vertical' }}>
            {tip}
          </p>
        </div>
      ) : null}
      {gear && (
        /* A STRIP, not a block in the grid above. That grid renders
           `blocks.length > 0 ? grid : tip`, so pushing a third thing into it
           would have silently replaced "What locals say" — the most valuable
           line on a local pick's card — and its own comment already says three
           columns are unreadably narrow. This sits underneath both. */
        <div style={{ marginTop: 10, flex: '0 0 auto',
                      background: 'var(--sand-100)', border: '2px solid var(--ink)',
                      borderRadius: 10, padding: '8px 10px' }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--ink)' }}>
            Bring your own, or rent from {gear.shop}
          </div>
          <div style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--sand-700)', marginTop: 3 }}>
            Set ${gear.fullSetHalfDayUsd} half-day, ${gear.fullSetDayUsd} for 24h;
            vest ${gear.vestUsd}. {gear.town}, {gear.hours}, closed {gear.closed}.
            They{' '}
            <a href={gear.assortmentSource} target="_blank" rel="noopener noreferrer"
               style={{ color: 'var(--ink)', textDecoration: 'underline' }}>
              sell {gear.sellsItems.join(', ')}
            </a>{' '}too, at prices they don&rsquo;t list.{' '}
            <a href={gear.source} target="_blank" rel="noopener noreferrer"
               style={{ color: 'var(--ink)', textDecoration: 'underline' }}>
              Their rates
            </a>, read {gear.checkedOn}.
          </div>
        </div>
      )}
    </div>
  );
}
