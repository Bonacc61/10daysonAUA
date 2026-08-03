import React, { type CSSProperties, useState } from 'react';
import { supabase } from '../lib/supabase';
import { capture } from '../lib/analytics';
import {
  Clock, Users, Sparkle, Chev, iconFor, Share, Calendar, Mail, Heart,
} from '../components/Icons';
import Footer from '../components/Footer';
import {
  SAMPLE_ITINERARY,
  FAQ_ITEMS,
  GTK_CARDS,
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
  onPlanClick?: () => void;
};

export default function Landing({ setPage, answers, setAnswers, onPlanClick }: Props) {
  const days = answers.days;
  const pct = ((days - 1) / 13) * 100;
  const label = days === 14 ? '14+' : String(days);
  const sliderStyle = { ['--pct' as string]: pct + '%' } as CSSProperties;

  const setDays = (v: number) => setAnswers({ ...answers, days: v });
  const goPlan = () => onPlanClick ? onPlanClick() : setPage('questionnaire');

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

            </div>
            <div className="hero-mascot" style={{ flex: '1 1 40%', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
              <img src="/parrot-HD.svg" alt="Aruba parrot mascot" style={{ width: '100%', maxWidth: 460, height: 'auto', display: 'block', transform: 'scaleX(-1) rotate(-4deg)' }} />
            </div>
          </div>
        </div>
      </div>

      <SampleSection days={label} goPlan={goPlan} goExplore={() => setPage('explore')} />
      <GoodToKnowSection />
      <FAQSection />
      <ContactSection setPage={setPage} />
      <Footer setPage={setPage} />
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

/* Placement mirrors Section in Itinerary.tsx, which is the whole point of a
   sample: the lunch button belongs to the AFTERNOON only and sits above that
   section's cards, while the favourites picker sits below the cards of EVERY
   section, filled or not. Stacking the two inside an empty slot showed a
   pairing the real page only produces when an afternoon happens to be empty. */
function SuggestLunchSlot() {
  // Illustrative — there is nothing to suggest into on the landing page.
  return (
    <div
      aria-hidden
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '2px dashed rgba(255,255,255,0.7)', borderRadius: 12, padding: 22, color: 'var(--cream)', fontStyle: 'italic', background: 'transparent', width: '100%', marginBottom: 10 }}
    >
      <Sparkle size={16} />
      <span style={{ fontSize: 13 }}>suggest lunchspot</span>
    </div>
  );
}

function ShortlistSlot() {
  // Reuses the production classes rather than restyling inline, but stays a
  // picture of the control, not the control: the ▼ promises an expansion this
  // page has nothing to expand, and six live buttons sharing one accessible
  // name would be six ways to get thrown off the page you're reading. The
  // live route to favourites is the coral button below the preview.
  return (
    <div className="itin-section-empty has-shortlist" style={{ marginTop: 10 }} aria-hidden>
      <div className="itin-shortlist-toggle" style={{ cursor: 'default' }}>
        <span className="itin-shortlist-toggle-spacer" />
        <span className="itin-shortlist-toggle-label">
          <span className="itin-shortlist-heart">♥</span>
          Add from favourites
        </span>
        <span className="itin-shortlist-toggle-icon end">▼</span>
      </div>
    </div>
  );
}

function Slot({ label, isAfternoon, content }: { label: string; isAfternoon?: boolean; content: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)', marginBottom: 8 }}>{label}</div>
      {isAfternoon && <SuggestLunchSlot />}
      {content}
      <ShortlistSlot />
    </div>
  );
}

function DayBlock({ d, isLast }: { d: Day; isLast: boolean }) {
  // Sections are now lists; the landing preview shows the first entry of each.
  // An empty section contributes nothing of its own, same as the real
  // itinerary, which drops its placeholder text once you have favourites and
  // leaves just the picker.
  const slot = (entries: SlotEntry[]) => {
    const s = entries[0];
    if (!s) return null;
    // 'group' kind: the sample-itinerary preview on the landing page doesn't
    // currently include group entries, but be defensive.
    if (s.kind !== 'activity') return null;
    const a = activityById(s.id);
    return a ? <ActivityMini a={a} /> : null;
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
      <Slot label="Afternoon" content={slot(d.afternoon)} isAfternoon />
      <Slot label="Evening"   content={slot(d.evening)} />
    </div>
  );
}

function SampleSection({ days, goPlan, goExplore }: { days: string; goPlan: () => void; goExplore: () => void }) {
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
              <p style={{ fontStyle: 'italic', fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)', margin: '0 0 16px', maxWidth: 520 }}>
                Our AI sequences activities intelligently — beach in the morning before the crowds, nature at golden hour, dinner spots that aren't tourist traps.
              </p>
              <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'rgba(255,255,255,0.9)', margin: '0 0 20px', maxWidth: 520 }}>
                Every plan starts with the island classics a local would put in front of anyone — a beach at sunrise, a catamaran sail, a beach at sunset, dinner by the water. Whatever you answered. From there it's yours: <strong style={{ fontWeight: 700 }}>heart anything in Explore and drop it straight into a day</strong>, swap what doesn't fit, drag days around, delete the rest.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '0 0 18px' }}>
                <span className="chip-outline" style={{ border: '2px solid rgba(255,255,255,0.9)', color: 'var(--cream)', background: 'transparent' }}><Clock size={13} /> Optimized by time of day</span>
                <span className="chip-outline" style={{ border: '2px solid rgba(255,255,255,0.9)', color: 'var(--cream)', background: 'transparent' }}><Users size={13} /> Personalized to your group</span>
                <span className="chip-outline" style={{ border: '2px solid rgba(255,255,255,0.9)', color: 'var(--cream)', background: 'transparent' }}><Heart size={13} /> Yours to customize</span>
              </div>
              <button className="btn-coral" onClick={goPlan}>build my plan →</button>
              <img
                src="/sample-map.png"
                alt="Sample Aruba trip map — three activity stops shown as photo pins connected by a route, with an activity card open"
                loading="lazy"
                width={980}
                height={760}
                style={{
                  display: 'block', width: '100%', maxWidth: 520, height: 'auto',
                  marginTop: 22, border: '2px solid var(--ink)', borderRadius: 12,
                  boxShadow: '4px 4px 0 var(--ink)',
                }}
              />
            </div>
            <div className="sample-right">
              {SAMPLE_ITINERARY.slice(0, 2).map((d, i) => (
                <DayBlock key={d.day} d={d} isLast={i === 1} />
              ))}
              <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {/* Live control, unlike the three illustrative buttons beside it
                    and unlike the pickers drawn inside the days: this is the one
                    action that explains the page's point — the plan is a starting
                    draft you edit. Sends you to Explore to heart things, which is
                    where the real picker draws from. */}
                <button type="button" className="btn-coral" onClick={goExplore} style={{ fontSize: 13, padding: '9px 16px', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <Heart size={14} /> Add from favourites
                </button>
                <button type="button" disabled className="btn-ghost" style={{ color: 'var(--cream)', borderColor: 'rgba(255,255,255,0.7)', fontSize: 13, padding: '9px 16px', display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'default', opacity: 0.85 }}>
                  <Calendar size={14} /> Export calendar
                </button>
                <button type="button" disabled className="btn-ghost" style={{ color: 'var(--cream)', borderColor: 'rgba(255,255,255,0.7)', fontSize: 13, padding: '9px 16px', display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'default', opacity: 0.85 }}>
                  <Share size={14} /> Share itinerary
                </button>
                <button type="button" disabled className="btn-ghost" style={{ color: 'var(--cream)', borderColor: 'rgba(255,255,255,0.7)', fontSize: 13, padding: '9px 16px', display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'default', opacity: 0.85 }}>
                  <Mail size={14} /> Email to me
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

/* ---------- Good to know ---------- */

const GTK_SECTION_META = [
  { key: 'before',     label: 'Before you get here' },
  { key: 'first-day',  label: 'Your first day' },
  { key: 'throughout', label: 'Throughout your stay' },
] as const;

function GtkTimelineCard({ card, index }: { card: typeof GTK_CARDS[number]; index: number }) {
  const IconCmp = iconFor(card.icon);
  return (
    <div className="tlc" style={{ '--accent': card.accent, '--i': index } as CSSProperties}>
      <div className="tlc-head">
        <span className="tlc-stamp"><IconCmp size={17} /></span>
        <h4 className="tlc-title font-display">{card.title}</h4>
        {card.note && <span className="tlc-flag">{card.note}</span>}
      </div>
      <p className="tlc-body">{card.body}</p>
      {card.attribution && <span className="tlc-sign">— {card.attribution}</span>}
    </div>
  );
}

function GoodToKnowSection() {
  const phases = GTK_SECTION_META.map((s) => ({
    ...s,
    cards: GTK_CARDS.filter((c) => c.section === s.key),
  }));

  // All three subsections stay expanded; the sticky phase headers + sticky-stacking
  // cards do the sequencing — you scroll through one subsection's cards (they stack
  // up) before the next subsection's header takes over and its cards start stacking.
  // This replaces the old scroll-spy one-at-a-time collapse, which switched
  // subsections before their cards could finish stacking (so the stacking only ever
  // showed on the last of the three). Clicking a header jumps to that subsection.
  const jumpTo = (el: Element | null) =>
    (el as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const tl = (
    <div className="gtk-tl">
      {phases.map((p) => (
        <div className="gtk-phase" data-active="" data-open="" key={p.key}>
          <button
            type="button"
            className="gtk-phase-head"
            onClick={(e) => jumpTo(e.currentTarget.closest('.gtk-phase'))}
          >
            <span className="gtk-node" aria-hidden />
            <span className="gtk-phase-label font-display">{p.label}</span>
          </button>
          <div className="gtk-phase-wrap">
            <div className="gtk-phase-inner">
              <div className="gtk-phase-cards">
                {p.cards.map((c, ci) => <GtkTimelineCard key={c.title} card={c} index={ci} />)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <details
      className="aruba-section bleed"
      style={{ background: 'var(--yellow-bg)', borderTop: '2px solid var(--ink)' }}
    >
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
          <p className="gtk-lede">The little things locals wish every visitor knew — scroll to move through the trip.</p>
          {tl}
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

/* ---------- Contact ---------- */

function ContactSection({ setPage }: { setPage: (p: PageId) => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', comment: '' });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email) return;
    setSubmitting(true);
    setError(null);
    try {
      if (supabase) {
        const { error: err } = await supabase.from('contact_submissions').insert({
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          comment: form.comment || null,
        });
        if (err) throw err;
      }
      capture('contact_message_sent');
      setSent(true);
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: CSSProperties = {
    width: '100%', padding: '12px 16px', border: '2px solid rgba(255,255,255,0.35)', borderRadius: 12,
    fontSize: 15, fontFamily: 'inherit', background: 'rgba(255,255,255,0.08)', outline: 'none',
    boxSizing: 'border-box', color: '#fff',
  };
  const labelStyle: CSSProperties = {
    fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)',
  };

  return (
    <details className="aruba-section bleed" style={{ background: 'var(--ink)', borderTop: '2px solid var(--ink)' }}>
      <summary style={{ padding: '24px 36px' }}>
        <div className="container-1280" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: 0 }}>
          <h2 className="font-display" style={{ fontSize: 32, margin: 0, color: '#fff' }}>Contact us.</h2>
          <span className="toggle" style={{ color: '#fff', flexShrink: 0, marginTop: 8 }} />
        </div>
      </summary>
      <div style={{ padding: '0 36px 56px' }}>
      <div className="container-1280" style={{ padding: 0, maxWidth: 640 }}>
        <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(255,255,255,0.6)', margin: '0 0 32px' }}>Questions, feedback, or just want to say hello — we'd love to hear from you.</p>

        {sent ? (
          <div className="chunky" style={{ padding: 28, background: 'var(--green)', color: 'var(--cream)', textAlign: 'center' }}>
            <p className="font-display" style={{ fontSize: 22, margin: '0 0 6px' }}>Message sent!</p>
            <p style={{ fontSize: 14, opacity: 0.9, margin: 0 }}>We'll get back to you soon.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Name *</label>
                <input style={inputStyle} type="text" placeholder="Your name" value={form.name} onChange={set('name')} required />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Email *</label>
                <input style={inputStyle} type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} required />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>Phone number</label>
              <input style={inputStyle} type="tel" placeholder="+1 (555) 000-0000" value={form.phone} onChange={set('phone')} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>Comment</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 120 }} placeholder="Tell us what's on your mind…" value={form.comment} onChange={set('comment')} />
            </div>
            {error && <p style={{ fontSize: 13, color: 'var(--coral)', margin: 0 }}>{error}</p>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <button type="submit" className="btn-red" disabled={submitting} style={{ padding: '13px 28px', fontSize: 15, opacity: submitting ? 0.6 : 1 }}>
                {submitting ? 'Sending…' : 'Send message →'}
              </button>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                By sending, you agree to our{' '}
                <button type="button" onClick={() => setPage('privacy')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'inherit', padding: 0, textDecoration: 'underline' }}>
                  Privacy Policy
                </button>
              </span>
            </div>
          </form>
        )}
      </div>
      </div>
    </details>
  );
}
