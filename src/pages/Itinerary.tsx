import { useState } from 'react';
import { Star, MapPin, Clock, Dollar, Check, Swap, Sparkle, Bookmark, Chev } from '../components/Icons';
import Footer from '../components/Footer';
import {
  ACTIVITIES,
  SAMPLE_ITINERARY,
  INFO_TOPICS,
  activityById,
  type Activity,
  type Day,
} from '../data/activities';
import type { PageId, Answers } from '../App';

type Props = { setPage: (p: PageId) => void; answers: Answers };
type SlotKey = 'morning' | 'afternoon' | 'evening';

/* ------------------------------------------------------------ *
 * Mocked review data — keyed off activity id. Mirrors the bolt  *
 * Itinerary card-flip pattern (r/Aruba mentions + TripAdvisor). *
 * Falls back to a generic blurb when an id isn't covered.       *
 * ------------------------------------------------------------ */
const REDDIT_QUOTES: Record<string, { rating: number; mentions: number; quote: string }> = {
  'eagle-beach-morning': { rating: 4.6, mentions: 312, quote: "Get there at 6:30am if you want a divi-divi for yourself. By 10 it's gone." },
  'california-lighthouse-sunset': { rating: 4.3, mentions: 184, quote: 'Park up top and walk down the cliff path — way less crowded than the lighthouse itself.' },
  'boca-catalina-snorkel': { rating: 4.5, mentions: 226, quote: "Turtles for sure. Don't kick the reef — locals will yell at you and they're right." },
  'oranjestad-walking': { rating: 4.0, mentions: 91,  quote: "Skip the cruise-ship hours (9–1). Late afternoon is way nicer." },
  'antilla-wreck-dive':  { rating: 4.7, mentions: 173, quote: 'World-class. The shallow sections work fine for AOW. Bring a torch.' },
  'arikok-hiking':       { rating: 4.4, mentions: 152, quote: 'Guided is worth it — half the cave paintings are unmarked.' },
  'natural-pool-jeep':   { rating: 4.6, mentions: 138, quote: "Bouncy as hell on the way in. Bring something secure for sunglasses." },
  'flamingo-renaissance':{ rating: 4.1, mentions: 467, quote: 'Worth it once if you have the photo on the bucket list. Otherwise overhyped.' },
  'zeerovers-fresh-catch': { rating: 4.8, mentions: 244, quote: "Wahoo, plantains, cold Balashi. That's the entire move." },
  'gasparito-restaurant':  { rating: 4.5, mentions: 109, quote: 'Book ahead, especially Friday. The keshi yena is legit.' },
  'kitesurfing-lesson':    { rating: 4.6, mentions: 78,  quote: '15+ knots almost every afternoon. Vela is the school most locals send people to.' },
  'baby-beach-snorkel':    { rating: 4.4, mentions: 198, quote: 'Hidden gem if you make the drive. Bring water — no shops nearby.' },
};

const TA_QUOTES: Record<string, string> = {
  'eagle-beach-morning': 'A must-do in Aruba. Book the early morning slot for the best experience.',
  'california-lighthouse-sunset': "Beautiful sunset view. Arrive 30 minutes early for the best photo spot.",
  'boca-catalina-snorkel': "We saw 4 sea turtles in an hour. Guide was patient with beginners.",
  'oranjestad-walking': "Loved the architecture and the history. Our guide was a local who told us great stories.",
  'antilla-wreck-dive': "Top dive of our trip. Visibility was incredible.",
};

function reviewFor(id: string) {
  return {
    reddit: REDDIT_QUOTES[id] ?? { rating: 4.2, mentions: 60, quote: 'Solid pick. Goes on most r/Aruba shortlists.' },
    ta:     TA_QUOTES[id]    ?? 'Highly recommended by recent visitors.',
  };
}

export default function Itinerary({ setPage, answers }: Props) {
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [swapForSlot, setSwapForSlot] = useState<Record<string, string>>({});
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  // Slots currently mid swap-flip animation. Used to add a CSS class.
  const [swapping, setSwapping] = useState<Set<string>>(new Set());

  const onApprove = (id: string) => {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSwap = (day: number, slot: SlotKey, currentId: string) => {
    const slotKey = `${day}-${slot}`;
    // Don't fire a second swap animation if one is already in flight for this slot.
    if (swapping.has(slotKey)) return;

    const cur = activityById(currentId);
    if (!cur) return;
    const candidates = ACTIVITIES.filter((a) => a.category === cur.category && a.id !== currentId && !approved.has(a.id));
    const pool = candidates.length ? candidates : ACTIVITIES.filter((a) => a.id !== currentId && !approved.has(a.id));
    if (pool.length === 0) return;
    const next = pool[Math.floor(Math.random() * pool.length)];

    // Start the top↕bottom flip; swap the activity at the half-way point
    // (edge-on) so the second half of the flip reveals the new card content.
    // Timings track the 0.9s swap-flip keyframe in index.css.
    setSwapping((prev) => new Set(prev).add(slotKey));
    window.setTimeout(() => {
      setSwapForSlot((prev) => ({ ...prev, [slotKey]: next.id }));
    }, 450);
    window.setTimeout(() => {
      setSwapping((prev) => {
        const n = new Set(prev);
        n.delete(slotKey);
        return n;
      });
    }, 920);
  };

  const onFlip = (slotKey: string) => {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(slotKey)) next.delete(slotKey);
      else next.add(slotKey);
      return next;
    });
  };

  // Show only as many days as the user picked, capped to the sample length.
  const tripDays = Math.max(1, Math.min(answers.days || 5, SAMPLE_ITINERARY.length));
  const days = SAMPLE_ITINERARY.slice(0, tripDays);

  // Total slots counted for the approved counter.
  const totalSlots = days.reduce((acc, d) => acc + Number(!!d.morning) + Number(!!d.afternoon) + Number(!!d.evening), 0);
  const approvedCount = approved.size;

  return (
    <>
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280 itin-header" style={{ padding: '36px 36px 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.7)', marginBottom: 8 }}>Your itinerary</div>
              <h1 className="font-display" style={{ fontSize: 44, margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1 }}>{tripDays} days, hand-picked.</h1>
              <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.75)', margin: 0, maxWidth: 640 }}>
                Approve what you like, swap what you don't. Tap any card to flip it and see what locals on r/Aruba say.
              </p>
            </div>
            <div className="chunky itin-header-counter" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--sand-500)' }}>Approved</div>
              <div className="font-display" style={{ fontSize: 30, color: 'var(--red)', lineHeight: 0.9 }}>
                {approvedCount}<span style={{ fontSize: 15, color: 'var(--ink)', marginLeft: 4 }}>/ {totalSlots}</span>
              </div>
              <button className="btn-red" onClick={() => setPage('explore')} style={{ padding: '10px 14px', fontSize: 13, borderWidth: 2, marginLeft: 10 }}>Add more →</button>
            </div>
          </div>
        </div>
      </div>

      <div className="bleed" style={{ background: 'var(--cream)', padding: '48px 0 80px' }}>
        <div className="container-1280">
          <div className="itinerary-layout">
            {/* LEFT — practical-info rail. Sticky so it stays in view as you scroll. */}
            <aside className="itinerary-rail">
              <div className="font-display" style={{ fontSize: 16, letterSpacing: '-0.2px', color: 'var(--ink)', margin: '4px 0 14px' }}>
                Practical info
              </div>
              {INFO_TOPICS.map((topic) => (
                <details key={topic.title} className="info-topic">
                  <summary>
                    <span className="info-topic-title">{topic.title}</span>
                    <span className="info-topic-chev"><Chev size={14} sw={2.5} /></span>
                  </summary>
                  <div className="info-topic-body">
                    {topic.body.map((line, i) => <p key={i}>{line}</p>)}
                  </div>
                </details>
              ))}
            </aside>

            {/* RIGHT — day-by-day timeline. */}
            <div className="itinerary-main">
              {days.map((d, i) => (
                <ItineraryDay
                  key={d.day}
                  d={d}
                  isLast={i === days.length - 1}
                  swapForSlot={swapForSlot}
                  flippedSet={flipped}
                  approvedSet={approved}
                  swappingSet={swapping}
                  onApprove={onApprove}
                  onSwap={onSwap}
                  onFlip={onFlip}
                />
              ))}

              <div style={{ position: 'sticky', bottom: 16, marginTop: 32, display: 'flex', justifyContent: 'center', zIndex: 5 }}>
                <div className="chunky itin-action-bar" style={{ padding: '14px 22px', display: 'inline-flex', alignItems: 'center', gap: 16, background: 'var(--ink)', color: 'var(--cream)' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{approvedCount} approved</span>
                  <button className="btn-red" style={{ padding: '10px 18px', fontSize: 14 }}>Share itinerary</button>
                  <button className="btn-ghost" style={{ color: 'var(--cream)', borderColor: 'var(--cream)', fontSize: 14, padding: '9px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Bookmark size={14} /> Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SsoLogin />
      <Footer />
    </>
  );
}

/* ------------------------------------------------------------ *
 *  Sign-in panel — sits between the itinerary and the footer.  *
 *  Stub buttons; no auth yet. Provider chips use brand colours. *
 * ------------------------------------------------------------ */
function SsoLogin() {
  return (
    <div className="bleed" style={{ background: 'var(--sand-50)', borderTop: '2px solid var(--ink)' }}>
      <div className="container-1280 sso-section" style={{ padding: '48px 36px 56px', textAlign: 'center' }}>
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 8px', color: 'var(--ink)' }}>
          Save your trip.
        </h2>
        <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.65)', margin: '0 0 28px' }}>
          Log in to save, book and share your itinerary.
        </p>
        <div className="sso-grid">
          <button type="button" className="sso-btn" aria-label="Continue with Gmail">
            <GmailLogo />
            <span className="sso-label">Continue with Gmail</span>
          </button>
          <button type="button" className="sso-btn" aria-label="Continue with Apple Mail">
            <AppleLogo />
            <span className="sso-label">Continue with Mail</span>
          </button>
          <button type="button" className="sso-btn" aria-label="Continue with Protonmail">
            <ProtonLogo />
            <span className="sso-label">Continue with Protonmail</span>
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--sand-500)', marginTop: 18 }}>
          We only use your email to save your plan. No spam, ever.
        </p>
      </div>
    </div>
  );
}

/* Inline brand logos (simplified, recognisable). All sized to 22px square. */
function GmailLogo() {
  return (
    <svg className="sso-logo-svg" viewBox="0 0 256 256" aria-hidden="true">
      <path fill="#4285f4" d="M58.18 192.05V93.14L27.51 65.08C13.02 71.8 0 87.1 0 105.14v66.69c0 11.32 9.14 20.22 20.19 20.22z"/>
      <path fill="#34a853" d="M197.82 192.05V93.14l30.67-28.06c14.49 6.72 27.51 22.02 27.51 40.06v66.69c0 11.32-9.14 20.22-20.19 20.22z"/>
      <path fill="#fbbc04" d="M197.82 63.06V93.14l58.18-37.06V41.79c0-13.43-15.34-21.1-26.07-13.04z"/>
      <path fill="#ea4335" d="M58.18 93.14V63.06L128 110.85l69.82-47.79v30.08L128 140.92z"/>
      <path fill="#c5221f" d="M0 41.79v14.29l58.18 37.06V63.06l-32.11-24.31C15.34 30.69 0 28.36 0 41.79z"/>
    </svg>
  );
}
function AppleLogo() {
  return (
    <svg className="sso-logo-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#1A1A1A" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
  );
}
function ProtonLogo() {
  return (
    <svg className="sso-logo-svg" viewBox="0 0 36 36" aria-hidden="true">
      {/* Stylised Proton wordmark icon — purple circle with a stylised "P". */}
      <circle cx="18" cy="18" r="18" fill="#6D4AFF"/>
      <path fill="#FFFFFF" d="M11 9h7.6c3.5 0 5.9 2.1 5.9 5.4 0 3.4-2.6 5.5-6.1 5.5h-3.3V27H11V9zm7 8c1.9 0 3-1 3-2.5s-1.1-2.5-3-2.5h-2.8V17H18z"/>
    </svg>
  );
}

function ItineraryDay({
  d, isLast, swapForSlot, flippedSet, approvedSet, swappingSet, onApprove, onSwap, onFlip,
}: {
  d: Day;
  isLast: boolean;
  swapForSlot: Record<string, string>;
  flippedSet: Set<string>;
  approvedSet: Set<string>;
  swappingSet: Set<string>;
  onApprove: (id: string) => void;
  onSwap: (day: number, slot: SlotKey, currentId: string) => void;
  onFlip: (slotKey: string) => void;
}) {
  const renderSlot = (slotKey: SlotKey, slotLabel: string) => {
    const slotId = `${d.day}-${slotKey}`;
    const overrideId = swapForSlot[slotId];
    const id = overrideId ?? d[slotKey];
    if (!id) {
      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 8 }}>{slotLabel}</div>
          <button className="btn-ghost" style={{ width: '100%', padding: 22, fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--coral)', borderColor: 'var(--coral)' }}>
            <Sparkle size={16} /> suggest lunchspot
          </button>
        </div>
      );
    }
    const a = activityById(id);
    if (!a) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 8 }}>{slotLabel}</div>
        <ItineraryCard
          a={a}
          flipped={flippedSet.has(slotId)}
          swapping={swappingSet.has(slotId)}
          onFlip={() => onFlip(slotId)}
          onApprove={() => onApprove(id)}
          onSwap={() => onSwap(d.day, slotKey, id)}
          approved={approvedSet.has(id)}
        />
      </div>
    );
  };

  return (
    <div className="itin-day-wrapper" style={{ position: 'relative', paddingLeft: 64, paddingBottom: isLast ? 0 : 40 }}>
      {!isLast && <div className="timeline-rail" />}
      <div className="day-badge" style={{ position: 'absolute', left: 0, top: 4, background: d.color, width: 44, height: 44, fontSize: 18 }}>{d.day}</div>
      <h2 className="font-display" style={{ fontSize: 30, lineHeight: 1, margin: '6px 0 20px', color: 'var(--ink)' }}>
        Day {d.day} <span style={{ color: 'var(--sand-500)', fontSize: 22, marginLeft: 6 }}>—</span> {d.title}
      </h2>
      {renderSlot('morning',   'Morning')}
      {renderSlot('afternoon', 'Afternoon')}
      {renderSlot('evening',   'Evening')}
    </div>
  );
}

function ItineraryCard({
  a, flipped, swapping, onFlip, onApprove, onSwap, approved,
}: {
  a: Activity;
  flipped: boolean;
  swapping: boolean;
  onFlip: () => void;
  onApprove: () => void;
  onSwap: () => void;
  approved: boolean;
}) {
  // Fixed height so the absolute-positioned back face matches the front.
  const HEIGHT = 200;
  const classes = ['flip-card', 'fade-in'];
  if (flipped)  classes.push('flipped');
  if (swapping) classes.push('swap-flipping');
  return (
    <div className={classes.join(' ')} style={{ height: HEIGHT }}>
      <div className="flip-inner" style={{ height: '100%' }}>
        <CardFront a={a} approved={approved} onFlip={onFlip} onApprove={onApprove} onSwap={onSwap} />
        <CardBack  a={a} onFlip={onFlip} />
      </div>
    </div>
  );
}

function CardFront({
  a, approved, onFlip, onApprove, onSwap,
}: {
  a: Activity;
  approved: boolean;
  onFlip: () => void;
  onApprove: () => void;
  onSwap: () => void;
}) {
  return (
    <div className="chunky flip-face itin-card-front" style={{ borderWidth: 2, height: '100%', overflow: 'hidden', padding: 0 }}>
      <div style={{ display: 'flex', height: '100%' }}>
        {/* Image — clicking flips */}
        <button
          className="itin-card-image-btn"
          onClick={onFlip}
          aria-label="See ratings"
          style={{ flex: '0 0 200px', height: '100%', background: 'var(--sand-100)', border: 'none', padding: 0, cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
        >
          <img src={a.image} alt={a.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <span style={{ position: 'absolute', bottom: 10, left: 10, background: 'rgba(26,26,26,0.85)', color: 'var(--cream)', fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999 }}>Tap for ratings ↻</span>
        </button>

        {/* Body */}
        <div className="itin-card-body" style={{ flex: 1, padding: '14px 18px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h3 className="font-display" style={{ fontSize: 19, lineHeight: 1.15, margin: '0 0 6px', color: 'var(--ink)' }}>{a.title}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sand-500)', fontSize: 12, marginBottom: 6 }}>
                <MapPin size={12} /><span>{a.location}</span>
              </div>
            </div>
            <span className="chip-outline" style={{ fontSize: 11, background: 'var(--yellow)', flexShrink: 0 }}>
              <Star size={11} /> {a.rating}
            </span>
          </div>
          <p style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-700)', margin: '0 0 10px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.description}</p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="chip-outline" style={{ fontSize: 11, padding: '2px 9px' }}><Clock size={11} /> {a.duration}</span>
            <span className="chip-outline" style={{ fontSize: 11, padding: '2px 9px' }}><Dollar size={11} /> {a.cost}</span>
            <span className="chip-outline chip-coral" style={{ fontSize: 11, padding: '2px 9px' }}>{a.fitReason}</span>
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={onApprove}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 12, border: '2px solid var(--ink)', fontWeight: 700, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', background: approved ? 'var(--green)' : 'var(--cream)', color: approved ? 'var(--cream)' : 'var(--ink)', boxShadow: '3px 3px 0 var(--ink)' }}
            >
              <Check size={13} /> {approved ? 'Approved' : 'Sounds good'}
            </button>
            <button onClick={onSwap} className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', fontSize: 13 }}>
              <Swap size={13} /> Swap
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardBack({ a, onFlip }: { a: Activity; onFlip: () => void }) {
  const { reddit, ta } = reviewFor(a.id);
  return (
    <div className="chunky flip-face flip-back itin-card-back" style={{ borderWidth: 2, height: '100%', padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <h3 className="font-display" style={{ fontSize: 18, margin: 0, color: 'var(--ink)' }}>{a.title}</h3>
        <button onClick={onFlip} className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}>← Back</button>
      </div>
      <div className="itin-card-back-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: 1, minHeight: 0 }}>
        {/* r/Aruba */}
        <div style={{ background: '#FFF4E6', border: '2px solid #FF4500', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#FF4500', color: 'white', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>r</span>
            <span style={{ fontWeight: 700, fontSize: 12, color: '#7A2A00' }}>r/Aruba</span>
            <span style={{ fontSize: 10, color: '#B05500', marginLeft: 'auto' }}>{reddit.mentions} mentions</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', gap: 1 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} size={12} fill={s <= Math.round(reddit.rating) ? '#FF4500' : 'transparent'} color="#FF4500" />
              ))}
            </div>
            <span style={{ fontWeight: 700, fontSize: 12, color: '#7A2A00' }}>{reddit.rating}</span>
          </div>
          <p style={{ fontSize: 11.5, lineHeight: 1.4, color: '#7A2A00', margin: 0, fontStyle: 'italic', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
            "{reddit.quote}"
          </p>
        </div>
        {/* TripAdvisor */}
        <div style={{ background: '#E9F7EF', border: '2px solid #22C55E', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#22C55E', color: 'white', fontWeight: 700, fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>TA</span>
            <span style={{ fontWeight: 700, fontSize: 12, color: '#155724' }}>TripAdvisor</span>
            <span style={{ fontSize: 10, color: '#3A7D44', marginLeft: 'auto' }}>{a.reviewCount.toLocaleString()} reviews</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', gap: 1 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} size={12} fill={s <= Math.round(a.rating) ? '#22C55E' : 'transparent'} color="#22C55E" />
              ))}
            </div>
            <span style={{ fontWeight: 700, fontSize: 12, color: '#155724' }}>{a.rating}</span>
          </div>
          <p style={{ fontSize: 11.5, lineHeight: 1.4, color: '#155724', margin: 0, fontStyle: 'italic', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
            "{ta}"
          </p>
        </div>
      </div>
    </div>
  );
}
