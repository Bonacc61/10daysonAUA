import type { Activity } from '../data/activities';
import type { ViatorItem } from '../types';
import { Star } from './Icons';

type Props =
  | { kind: 'activity'; activity: Activity; onFlip: () => void }
  | { kind: 'group'; bestSeller: ViatorItem; onFlip: () => void };

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

/* Each panel attributes what it shows to a named third party, so each renders
   only where there is an entry above to attribute it to. There is deliberately
   no fallback: cards without an entry show our own note instead. */

export default function CardBack(props: Props) {
  const isActivity = props.kind === 'activity';
  const id = isActivity ? props.activity.id : props.bestSeller.id;
  const title = isActivity ? props.activity.title : props.bestSeller.title;

  const reddit = isActivity ? ACTIVITY_REDDIT[id] : props.bestSeller.reddit_quote;
  const ta     = isActivity ? ACTIVITY_TA[id]     : props.bestSeller.ta_quote;

  const taCount = isActivity ? props.activity.reviewCount : props.bestSeller.review_count;
  const taRating = isActivity ? props.activity.rating : props.bestSeller.rating;

  // Our own words, for the cards with nothing sourced to show. Guarded on being
  // non-empty: most of the curated picks ship `localsSay: ''`, and a Viator
  // description is optional, so an unguarded block renders an empty box.
  const ownNote = (isActivity ? props.activity.localsSay : props.bestSeller.description)?.trim();
  const panels = (reddit ? 1 : 0) + (ta ? 1 : 0);

  return (
    <div className="chunky flip-face flip-back itin-card-back"
         style={{ borderWidth: 2, height: '100%', padding: '16px 18px',
                  display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 10, paddingRight: 112 }}>
        <h3 className="font-display" style={{ fontSize: 18, margin: 0, color: 'var(--ink)',
                                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </h3>
      </div>
      <div className="itin-card-back-grid" style={{
        display: 'grid', gridTemplateColumns: panels === 2 ? '1fr 1fr' : '1fr',
        gap: 10, flex: 1, minHeight: 0,
      }}>
        {panels === 0 && ownNote && (
          <div style={{ background: 'var(--sand-50)', border: '2px solid var(--sand-200)',
                        borderRadius: 12, padding: 12,
                        display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--sand-700)' }}>Why we picked it</span>
            <p style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--sand-700)',
                        margin: 0, overflow: 'hidden', display: '-webkit-box',
                        WebkitLineClamp: 5, WebkitBoxOrient: 'vertical' }}>
              {ownNote}
            </p>
          </div>
        )}

        {/* r/Aruba */}
        {reddit && (
        <div style={{ background: '#FFF4E6', border: '2px solid #FF4500',
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
        </div>
        )}

        {/* TripAdvisor */}
        {ta && (
        <div style={{ background: '#E9F7EF', border: '2px solid #22C55E',
                      borderRadius: 12, padding: 12,
                      display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%',
              background: '#22C55E', color: 'white',
              fontWeight: 700, fontSize: 10,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>TA</span>
            <span style={{ fontWeight: 700, fontSize: 12, color: '#155724' }}>TripAdvisor</span>
            <span style={{ fontSize: 10, color: '#3A7D44', marginLeft: 'auto' }}>
              {taCount.toLocaleString()} reviews
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', gap: 1 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} size={12}
                      fill={s <= Math.round(taRating) ? '#22C55E' : 'transparent'}
                      color="#22C55E" />
              ))}
            </div>
            <span style={{ fontWeight: 700, fontSize: 12, color: '#155724' }}>{taRating}</span>
          </div>
          <p style={{ fontSize: 11.5, lineHeight: 1.4, color: '#155724',
                      margin: 0, fontStyle: 'italic', overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
            "{ta}"
          </p>
        </div>
        )}
      </div>
    </div>
  );
}
