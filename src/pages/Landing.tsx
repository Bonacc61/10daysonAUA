import { type CSSProperties } from 'react';
import {
  Clock, Users, Sparkle, Chev, iconFor,
} from '../components/Icons';
import Footer from '../components/Footer';
import {
  SAMPLE_ITINERARY,
  FAQ_ITEMS,
  GTK_CARDS,
  INFO_TOPICS,
  activityById,
  type Activity,
  type Day,
} from '../data/activities';
import type { SlotEntry } from '../types';
import type { PageId, Answers } from '../App';

type Props = {
  setPage: (p: PageId) => void;
  answers: Answers;
  setAnswers: (next: Answers) => void;
};

export default function Landing({ setPage, answers, setAnswers }: Props) {
  const days = answers.days;
  const pct = ((days - 1) / 13) * 100;
  const label = days === 14 ? '14+' : String(days);
  const sliderStyle = { ['--pct' as string]: pct + '%' } as CSSProperties;

  const setDays = (v: number) => setAnswers({ ...answers, days: v });
  const goPlan = () => setPage('questionnaire');

  return (
    <>
      {/* HERO */}
      <div className="bleed hero-bleed" style={{ background: 'var(--yellow-bg)', padding: '64px 0 84px', position: 'relative', overflow: 'hidden' }}>
        <div className="container-1280">
          <div className="hero-row" style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
            <div className="hero-text" style={{ flex: '1 1 60%', minWidth: 0 }}>
              <h1 className="font-display hero-title" style={{ fontSize: 60, lineHeight: 0.95, margin: '0 0 20px', color: 'var(--ink)' }}>
                Plan your Aruba trip the way{' '}
                <span style={{ color: 'var(--red)', position: 'relative', display: 'inline-block' }}>
                  locals
                  <svg style={{ position: 'absolute', left: -4, bottom: -10, width: 'calc(100% + 8px)', height: 14 }} viewBox="0 0 120 16" preserveAspectRatio="none">
                    <path d="M 4 11 Q 30 4, 60 9 T 116 8" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" fill="none" />
                  </svg>
                </span>{' '}
                would.
              </h1>
              <p className="hero-sub" style={{ fontSize: 17, lineHeight: 1.5, margin: '0 0 26px', fontWeight: 500 }}>50% local insights, 50% AI.</p>

              {/* Slider card */}
              <div className="chunky hero-slider-card" style={{ borderWidth: 3, padding: '18px 20px 16px', margin: '0 0 22px', maxWidth: 460, transform: 'rotate(-1.5deg)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>How long are you staying?</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, lineHeight: 1 }}>
                    <span className="font-display" style={{ fontSize: 40, color: 'var(--red)', lineHeight: 0.9 }}>{label}</span>
                    <span className="font-display" style={{ fontSize: 18, color: 'var(--ink)' }}>{days === 1 ? 'day' : 'days'}</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={1}
                  max={14}
                  value={days}
                  className="trip-slider"
                  style={sliderStyle}
                  onChange={(e) => setDays(Number(e.target.value))}
                  aria-label="Days staying on Aruba"
                />
                <div style={{ position: 'relative', height: 18, marginTop: 4, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                  <span style={{ position: 'absolute', left: '0%' }}>1</span>
                  <span style={{ position: 'absolute', left: '15.38%', transform: 'translateX(-50%)' }}>3</span>
                  <span style={{ position: 'absolute', left: '30.77%', transform: 'translateX(-50%)' }}>5</span>
                  <span style={{ position: 'absolute', left: '46.15%', transform: 'translateX(-50%)' }}>7</span>
                  <span style={{ position: 'absolute', left: '69.23%', transform: 'translateX(-50%)' }}>10</span>
                  <span style={{ position: 'absolute', right: '0%' }}>14+</span>
                </div>
                <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.4, color: '#555' }}>
                  Most visitors stay 5–7 days. On a cruise? Drop to 1.
                </div>
              </div>

              {/* CTA + browse */}
              <div className="hero-cta-row" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', position: 'relative', marginBottom: 22 }}>
                <button className="btn-red" onClick={goPlan} style={{ padding: '14px 22px', fontSize: 16, borderRadius: 14, borderWidth: 3 }}>
                  Plan my {label}-day trip →
                </button>
                <button
                  onClick={() => setPage('explore')}
                  style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textDecorationThickness: 2, textUnderlineOffset: 4, background: 'none', border: 'none', fontFamily: 'inherit', padding: 0 }}
                >
                  or just browse
                </button>
                <svg className="hero-arrow" width="46" height="56" viewBox="0 0 60 80" style={{ flexShrink: 0 }}>
                  <path d="M 6 6 Q 50 16, 40 56 Q 36 68, 28 74" stroke="var(--ink)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                  <path d="M 22 68 L 28 76 L 36 70" stroke="var(--ink)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              <a
                className="hero-reddit-pill"
                href="https://reddit.com/r/Aruba/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'var(--cream)', border: '2px solid var(--ink)', borderRadius: 999, transform: 'rotate(-2deg)', boxShadow: '3px 3px 0 var(--ink)', textDecoration: 'none', color: 'var(--ink)', cursor: 'pointer' }}
              >
                <span style={{ width: 18, height: 18, background: '#FF4500', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 11 }}>r</span>
                <span className="font-display" style={{ fontSize: 13 }}>built with the r/Aruba crew</span>
              </a>
            </div>
            <div className="hero-mascot" style={{ flex: '1 1 40%', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
              <img src="/parrot.png" alt="Aruba parrot mascot" style={{ width: '100%', maxWidth: 460, height: 'auto', display: 'block', transform: 'scaleX(-1) rotate(-4deg)' }} />
            </div>
          </div>
        </div>
      </div>

      <SampleSection days={label} goPlan={goPlan} />
      <GoodToKnowSection />
      <FAQSection />
      <Footer />
    </>
  );
}

/* ---------- Sample output section ---------- */

function ActivityMini({ a }: { a: Activity }) {
  return (
    <div style={{ display: 'flex', gap: 12, background: 'var(--cream)', border: '2px solid var(--ink)', borderRadius: 12, padding: 12, boxShadow: '4px 4px 0 var(--ink)' }}>
      <img src={a.image} alt="" loading="lazy" style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: 'var(--sand-100)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 16, lineHeight: 1.15, color: 'var(--ink)' }}>{a.title}</div>
        <div style={{ fontSize: 11.5, color: 'rgba(0,0,0,0.55)', margin: '4px 0 8px' }}>{a.duration} · {a.cost}</div>
        <span className="chip-outline chip-yellow" style={{ fontSize: 11 }}>{a.fitReason}</span>
      </div>
    </div>
  );
}

function EmptySlot() {
  return (
    <button
      type="button"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '2px dashed rgba(255,255,255,0.7)', borderRadius: 12, padding: 22, color: 'var(--cream)', fontStyle: 'italic', background: 'transparent', cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}
    >
      <Sparkle size={16} />
      <span style={{ fontSize: 13 }}>suggest lunchspot</span>
    </button>
  );
}

function Slot({ label, content }: { label: string; content: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)', marginBottom: 8 }}>{label}</div>
      {content}
    </div>
  );
}

function DayBlock({ d, isLast }: { d: Day; isLast: boolean }) {
  // Sections are now lists; the landing preview shows the first entry of each.
  const slot = (entries: SlotEntry[]) => {
    const s = entries[0];
    if (!s) return <EmptySlot />;
    if (s.kind === 'activity') {
      const a = activityById(s.id);
      return a ? <ActivityMini a={a} /> : <EmptySlot />;
    }
    // 'group' kind: the sample-itinerary preview on the landing page doesn't
    // currently include group entries, but be defensive.
    return <EmptySlot />;
  };
  return (
    <div style={{ position: 'relative', paddingLeft: 56, paddingBottom: 28 }}>
      {/* Vertical timeline rail — always rendered, even below the last day,
          so the timeline visually continues. For the final block we tag it
          with a fade-out so it doesn't look like a dangling stub. */}
      <div
        style={{
          position: 'absolute',
          left: 21,
          top: 46,
          bottom: isLast ? -8 : -4,
          borderLeft: '2px dashed rgba(255,255,255,0.55)',
          maskImage: isLast ? 'linear-gradient(to bottom, rgba(0,0,0,1) 60%, rgba(0,0,0,0))' : undefined,
          WebkitMaskImage: isLast ? 'linear-gradient(to bottom, rgba(0,0,0,1) 60%, rgba(0,0,0,0))' : undefined,
        }}
      />
      <div className="day-badge" style={{ position: 'absolute', left: 0, top: 0, background: d.color, width: 44, height: 44, fontSize: 18 }}>{d.day}</div>
      <h3 className="font-display" style={{ fontSize: 22, lineHeight: 1, margin: '10px 0 16px', color: 'white' }}>
        Day {d.day} <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 18, margin: '0 4px' }}>—</span> {d.title}
      </h3>
      <Slot label="Morning"   content={slot(d.morning)} />
      <Slot label="Afternoon" content={slot(d.afternoon)} />
      <Slot label="Evening"   content={slot(d.evening)} />
    </div>
  );
}

function SampleSection({ days, goPlan }: { days: string; goPlan: () => void }) {
  // "An" before day counts whose spoken form starts with a vowel sound: 8 (eight) and 11 (eleven).
  const article = days === '8' || days === '11' ? 'An' : 'A';
  return (
    <details className="aruba-section bleed" style={{ background: 'var(--green)', borderTop: '2px solid var(--ink)' }}>
      <summary style={{ padding: '24px 36px' }}>
        <div className="container-1280" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: 0 }}>
          <h2 className="font-display" style={{ fontSize: 32, margin: 0, color: 'var(--cream)' }}>Sample output.</h2>
          <span className="toggle" style={{ color: 'var(--cream)', flexShrink: 0, marginTop: 8 }} />
        </div>
      </summary>
      <div style={{ padding: '0 36px 56px' }}>
        <div className="container-1280" style={{ padding: 0 }}>
          <div className="sample-grid">
            <div className="sample-left">
              <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: 26, lineHeight: 1.2, fontWeight: 500, letterSpacing: '-0.3px', margin: '0 0 14px', color: 'var(--cream)' }}>{article} {days}-day plan that actually makes sense.</h3>
              <p style={{ fontStyle: 'italic', fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)', margin: '0 0 22px', maxWidth: 520 }}>
                Our AI sequences activities intelligently — beach in the morning before the crowds, nature at golden hour, dinner spots that aren't tourist traps.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '0 0 18px' }}>
                <span className="chip-outline" style={{ border: '2px solid rgba(255,255,255,0.9)', color: 'var(--cream)', background: 'transparent' }}><Clock size={13} /> Optimized by time of day</span>
                <span className="chip-outline" style={{ border: '2px solid rgba(255,255,255,0.9)', color: 'var(--cream)', background: 'transparent' }}><Users size={13} /> Personalized to your group</span>
              </div>
              <button className="btn-coral" onClick={goPlan}>build my plan →</button>
            </div>
            <div className="sample-right">
              {SAMPLE_ITINERARY.slice(0, 2).map((d, i) => (
                <DayBlock key={d.day} d={d} isLast={i === 1} />
              ))}
            </div>
          </div>

          {/* Practical-info preview — same six topics that live in the Itinerary
              left rail. Collapsed by default; click any to expand. */}
          <div style={{ marginTop: 36, paddingTop: 28, borderTop: '2px dashed rgba(255,255,255,0.35)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.9)', marginBottom: 6 }}>
              + practical info
            </div>
            <p style={{ fontStyle: 'italic', fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)', margin: '0 0 18px', maxWidth: 720 }}>
              Plus the on-the-ground stuff most planners forget.
            </p>
            <div className="sample-info-grid">
              {INFO_TOPICS.map((topic) => (
                <details key={topic.title} className="info-topic sample-info-topic">
                  <summary>
                    <span className="info-topic-title">{topic.title}</span>
                    <span className="info-topic-chev"><Chev size={14} sw={2.5} /></span>
                  </summary>
                  <div className="info-topic-body">
                    {topic.body.map((line, i) => <p key={i}>{line}</p>)}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

/* ---------- Good to know ---------- */

// Hand-placed tilts so the tags feel pinned to a board, not stamped on a grid.
const GTK_TILTS = ['-1.4deg', '1.1deg', '-0.8deg', '1.3deg', '-1.2deg', '0.9deg', '-1.3deg', '1.2deg'];

function TipTag({ card, index }: { card: typeof GTK_CARDS[number]; index: number }) {
  const IconCmp = iconFor(card.icon);
  return (
    <article
      className="gtk-tag"
      style={{ '--accent': card.accent, '--tilt': GTK_TILTS[index % GTK_TILTS.length] } as CSSProperties}
    >
      <span className="gtk-tag-num">{String(index + 1).padStart(2, '0')}</span>
      {card.note && <span className="gtk-tag-flag">{card.note}</span>}
      <span className="gtk-tag-stamp"><IconCmp size={20} /></span>
      <h3 className="font-display gtk-tag-title">{card.title}</h3>
      <p className="gtk-tag-body">{card.body}</p>
      {card.attribution && <span className="gtk-tag-sign">— {card.attribution}</span>}
    </article>
  );
}

function GoodToKnowSection() {
  return (
    <details className="aruba-section bleed" style={{ background: 'var(--yellow-bg)', borderTop: '2px solid var(--ink)' }}>
      <summary style={{ padding: '24px 36px' }}>
        <div className="container-1280" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: 0 }}>
          <h2 className="font-display" style={{ fontSize: 32, margin: 0, color: 'var(--ink)' }}>Good-to-knows.</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <span className="gtk-eyebrow">Island intel</span>
            <span className="toggle" style={{ color: 'var(--ink)' }} />
          </div>
        </div>
      </summary>
      <div style={{ padding: '0 36px 56px' }}>
        <div className="container-1280" style={{ padding: 0 }}>
          <p style={{ fontStyle: 'italic', fontSize: 15, lineHeight: 1.5, color: 'rgba(0,0,0,0.8)', margin: '0 0 20px', maxWidth: 720 }}>The little things locals wish every visitor knew.</p>
          <div className="gtk-board">
            <div className="gtk-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 22 }}>
              {GTK_CARDS.map((c, i) => <TipTag key={c.title} card={c} index={i} />)}
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

/* ---------- FAQ (collapsed by default now) ---------- */

function FAQSection() {
  return (
    <details id="faq" className="aruba-section bleed" style={{ background: 'var(--sand-50)', borderTop: '2px solid var(--ink)' }}>
      <summary style={{ padding: '24px 36px' }}>
        <div className="container-1280" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: 0 }}>
          <h2 className="font-display" style={{ fontSize: 32, margin: 0, color: 'var(--ink)' }}>Questions, answered.</h2>
          <span className="toggle" style={{ color: 'var(--ink)', flexShrink: 0, marginTop: 8 }} />
        </div>
      </summary>
      <div style={{ padding: '0 36px 56px' }}>
        <div className="container-1280" style={{ padding: 0 }}>
          <p style={{ fontStyle: 'italic', fontSize: 15, lineHeight: 1.5, color: 'rgba(0,0,0,0.65)', margin: '0 0 22px', maxWidth: 720 }}>The things people ask before they hit "Plan my trip."</p>
          {FAQ_ITEMS.map((item, i) => (
            <details key={i} className="faq-item" style={{ marginBottom: 12 }}>
              <summary>
                <div className="faq-card" style={{ background: 'var(--cream)', border: '1px solid #E0D9CC', borderRadius: 16, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: 15.5, lineHeight: 1.35, color: 'var(--ink)' }}>{item.q}</span>
                  <span className="faq-chev" style={{ display: 'inline-flex', color: 'rgba(26,26,26,0.65)' }}><Chev /></span>
                </div>
              </summary>
              <div style={{ padding: '8px 20px 18px', fontSize: 14, lineHeight: 1.55, color: 'rgba(26,26,26,0.78)' }}>{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </details>
  );
}
