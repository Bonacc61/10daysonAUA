/**
 * DASHBOARD UX PREVIEW — dev-only, not committed
 *
 * Three layout/UX variations — all using the exact same brand:
 *   Caprasimo display · Inter body · cream/ink/red/yellow/sand tokens · chunky cards
 *
 * A — Top tab bar   (horizontal tabs, full-width content below)
 * B — Hub cards     (landing grid of section cards → drill-in)
 * C — Scroll stack  (all sections stacked vertically, sticky mini-nav)
 */

import { useRef, useState } from 'react';
import type { PageId } from '../App';

type Props = { setPage: (p: PageId) => void };

// ─── Shared mock data ─────────────────────────────────────────────────────────

const SECTIONS_META = [
  { id: 'surprise',   label: 'Surprise me',         short: 'Surprise',   emoji: '🎲' },
  { id: 'starred',    label: 'Shortlisted Activities', short: 'Shortlisted', emoji: '✓'  },
  { id: 'itinerary',  label: 'Itineraries',          short: 'Itinerary',  emoji: '🗓'  },
  { id: 'bookings',   label: 'Bookings',             short: 'Bookings',   emoji: '✓'  },
  { id: 'practical',  label: 'Practical Info',       short: 'Practical',  emoji: 'ℹ'  },
] as const;
type SectionId = typeof SECTIONS_META[number]['id'];

const MOCK_TRIP_DAYS = [
  { day: 1, title: 'Arrival & Eagle Beach',  morning: ['California Lighthouse'], afternoon: ['Eagle Beach'], evening: ['Screaming Eagle'] },
  { day: 2, title: 'Water Day',              morning: ['Kitesurfing lesson'],     afternoon: ['Antilla wreck dive'], evening: ['Zeerovers fish shack'] },
  { day: 3, title: 'Wild Side',              morning: ['Arikok hike'],            afternoon: ['Natural Pool jeep'], evening: ['Wilhelmina Park'] },
];

const MOCK_BOOKINGS = [
  { title: 'Kitesurfing lesson',   day: 2, slot: 'Morning',   cost: '$95' },
  { title: 'Antilla wreck dive',   day: 2, slot: 'Afternoon', cost: '$60' },
];

const MOCK_STARRED = [
  { title: 'Baby Beach snorkel',    category: 'Beaches',     cost: 'Free',  duration: '2 hrs',  img: 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?w=400&q=70' },
  { title: 'Kitesurfing lesson',    category: 'Watersports', cost: '$95',   duration: '3 hrs',  img: '/Kitesurfing Fishermans Huts.webp' },
  { title: 'Arikok National Park',  category: 'Nature',      cost: 'Free',  duration: 'Half day', img: 'https://images.unsplash.com/photo-1504701954957-2010ec3bcec1?w=400&q=70' },
];

const MOCK_INFO = [
  { title: 'Before arriving',   body: 'Passport, reef-safe sunscreen, tap water is safe.' },
  { title: 'Getting around',    body: 'Rental car recommended. Arubus for Palm ↔ Oranjestad.' },
  { title: 'Medical',           body: 'Dial 911. Horacio Oduber Hospital, Oranjestad.' },
];

// ─── Shared sub-panels ────────────────────────────────────────────────────────

function SurpriseContent() {
  return (
    <div style={{ maxWidth: 520 }}>
      <p style={{ fontStyle: 'italic', fontSize: 14, color: 'var(--sand-700)', margin: '0 0 20px' }}>
        One tap. Your favourites, shuffled. Go.
      </p>
      <div className="chunky" style={{ overflow: 'hidden', padding: 0 }}>
        <div style={{ height: 200, overflow: 'hidden', position: 'relative', background: 'var(--sand-100)' }}>
          <img src={MOCK_STARRED[1].img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <span style={{ position: 'absolute', top: 12, right: 12, background: 'var(--ink)', color: 'var(--yellow)', padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>★ 4.8</span>
        </div>
        <div style={{ padding: '18px 20px 20px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 4 }}>Watersports</div>
          <h3 className="font-display" style={{ fontSize: 24, margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1.1 }}>{MOCK_STARRED[1].title}</h3>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, marginTop: 10 }}>
            <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px' }}>3 hrs</span>
            <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px' }}>$95</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <a href="#" style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '3px 3px 0 var(--ink)' }}>Book now</a>
            <button style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--yellow-bg)', color: 'var(--ink)', boxShadow: '3px 3px 0 var(--ink)', cursor: 'pointer' }}>🎲 Nope, roll again</button>
          </div>
        </div>
      </div>
      <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--sand-400)', marginTop: 10 }}>🤙 Shake your phone to roll the dice.</p>
    </div>
  );
}

function StarredContent() {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 }}>
        {MOCK_STARRED.map((a) => (
          <div key={a.title} className="a-card fade-in">
            <div className="a-img">
              <img src={a.img} alt={a.title} />
              <span className="a-rating">★ 4.8</span>
            </div>
            <div style={{ padding: '12px 14px 14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 3 }}>{a.category}</div>
              <h4 className="font-display" style={{ fontSize: 17, margin: '0 0 8px', color: 'var(--ink)', lineHeight: 1.1 }}>{a.title}</h4>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}>{a.duration}</span>
                <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}>{a.cost}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItineraryContent() {
  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button className="btn-ghost" style={{ fontSize: 13, padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>📅 Export .ics</button>
        <button className="btn-red" style={{ fontSize: 13, padding: '8px 14px' }}>Edit itinerary →</button>
      </div>
      {MOCK_TRIP_DAYS.map((day) => (
        <div key={day.day} className="chunky" style={{ marginBottom: 10, padding: '14px 18px' }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ background: 'var(--yellow)', border: '2px solid var(--ink)', borderRadius: 8, padding: '2px 8px', fontSize: 12, boxShadow: '2px 2px 0 var(--ink)' }}>Day {day.day}</span>
            <span className="font-display" style={{ fontSize: 16 }}>{day.title}</span>
          </div>
          {(['morning','afternoon','evening'] as const).map((slot) => {
            const items = day[slot];
            if (!items?.length) return null;
            return items.map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--sand-100)' }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, border: '2px solid var(--sand-200)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--sand-700)', flex: 1 }}>{item}</span>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--sand-500)' }}>{slot}</span>
              </div>
            ));
          })}
        </div>
      ))}
    </div>
  );
}

function BookingsContent() {
  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: 18 }}>
        <button className="btn-ghost" style={{ fontSize: 13, padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>📅 Export confirmed .ics</button>
      </div>
      <div className="chunky" style={{ padding: '8px 0' }}>
        {MOCK_BOOKINGS.map((b) => (
          <div key={b.title} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--sand-100)' }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--green)', border: '2px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 800 }}>✓</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{b.title}</div>
              <div style={{ fontSize: 11, color: 'var(--sand-500)' }}>Day {b.day} · {b.slot}</div>
            </div>
            <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px' }}>{b.cost}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PracticalContent() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div style={{ maxWidth: 560 }}>
      {MOCK_INFO.map((t) => (
        <div key={t.title} className="chunky" style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
          <button onClick={() => setOpen(open === t.title ? null : t.title)}
            style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
            <span>{t.title}</span>
            <span style={{ fontSize: 18, color: 'var(--sand-500)', transform: open === t.title ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>›</span>
          </button>
          {open === t.title && (
            <p style={{ padding: '0 18px 14px', margin: 0, fontSize: 13, color: 'var(--sand-700)', lineHeight: 1.6 }}>{t.body}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function sectionContent(id: SectionId) {
  if (id === 'surprise')  return <SurpriseContent />;
  if (id === 'starred')   return <StarredContent />;
  if (id === 'itinerary') return <ItineraryContent />;
  if (id === 'bookings')  return <BookingsContent />;
  return <PracticalContent />;
}

function sectionHeading(id: SectionId) {
  if (id === 'surprise')  return 'Feeling spontaneous?';
  return SECTIONS_META.find((s) => s.id === id)!.label;
}

// ════════════════════════════════════════════════════════════════════════════
// DESIGN A — Horizontal top tabs
// Same as Explore's category tab strip; content fills the page below.
// Sidebar becomes a compact tab row. On narrow screens it scrolls horizontally.
// ════════════════════════════════════════════════════════════════════════════

function DesignA() {
  const [active, setActive] = useState<SectionId>('surprise');
  const meta = SECTIONS_META.find((s) => s.id === active)!;

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100vh' }}>
      {/* Yellow banner — same as existing page headers */}
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280" style={{ padding: '28px 36px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.55)', marginBottom: 6 }}>My Aruba · Jan</div>
          <h1 className="font-display" style={{ fontSize: 40, margin: '0 0 20px', color: 'var(--ink)', lineHeight: 1 }}>My Aruba</h1>

          {/* Tab strip — same .cat-tab pattern as Explore */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 0 }}>
            {SECTIONS_META.map((s) => (
              <button key={s.id}
                className={`cat-tab${active === s.id ? ' active' : ''}`}
                onClick={() => setActive(s.id)}
                style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span>{s.emoji}</span> {s.short}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content area — full width, generous padding */}
      <div className="bleed" style={{ background: 'var(--cream)', padding: '40px 0 80px' }}>
        <div className="container-1280" style={{ padding: '0 36px' }}>
          <h2 className="font-display" style={{ fontSize: 32, margin: '0 0 20px', color: 'var(--ink)' }}>
            {sectionHeading(active)}
          </h2>
          {sectionContent(active)}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DESIGN B — Hub launcher
// Landing view = grid of chunky section cards. Clicking one "drills in."
// Breadcrumb + back button to return to the hub. Feels like an app home screen.
// ════════════════════════════════════════════════════════════════════════════

const HUB_CARDS: { id: SectionId; label: string; tagline: string; bg: string; emoji: string }[] = [
  { id: 'surprise',  label: 'Surprise me',         tagline: 'One tap. A random favourite. Go.',              bg: 'var(--yellow-bg)', emoji: '🎲' },
  { id: 'starred',   label: 'Shortlisted Activities', tagline: '3 saved · 2 match your budget',              bg: 'var(--cream)',     emoji: '✓'  },
  { id: 'itinerary', label: 'Itineraries',          tagline: '9-day trip · 27 activities planned',           bg: 'var(--cream)',     emoji: '🗓'  },
  { id: 'bookings',  label: 'Bookings',             tagline: '2 confirmed · tap to export calendar',         bg: 'var(--cream)',     emoji: '✓'  },
  { id: 'practical', label: 'Practical Info',       tagline: 'Money, driving, sunscreen & 8 more',           bg: 'var(--cream)',     emoji: 'ℹ'  },
];

function DesignB() {
  const [active, setActive] = useState<SectionId | null>(null);

  if (active) {
    const meta = SECTIONS_META.find((s) => s.id === active)!;
    return (
      <div style={{ background: 'var(--cream)', minHeight: '100vh' }}>
        <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
          <div className="container-1280" style={{ padding: '20px 36px' }}>
            <button onClick={() => setActive(null)}
              style={{ fontFamily: 'inherit', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink)', padding: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
              ← My Aruba
            </button>
            <h1 className="font-display" style={{ fontSize: 38, margin: 0, color: 'var(--ink)', lineHeight: 1 }}>
              {meta.emoji} {sectionHeading(active)}
            </h1>
          </div>
        </div>
        <div className="container-1280" style={{ padding: '36px 36px 80px' }}>
          {sectionContent(active)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100vh' }}>
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280" style={{ padding: '28px 36px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.55)', marginBottom: 6 }}>My Aruba · Jan</div>
          <h1 className="font-display" style={{ fontSize: 40, margin: 0, color: 'var(--ink)', lineHeight: 1 }}>My Aruba</h1>
        </div>
      </div>

      <div className="container-1280" style={{ padding: '40px 36px 80px' }}>
        {/* Featured Surprise me — full-width hero card */}
        <button onClick={() => setActive('surprise')}
          className="chunky"
          style={{ width: '100%', textAlign: 'left', padding: '28px 32px', marginBottom: 20, cursor: 'pointer', background: 'var(--yellow-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, transition: 'transform 0.1s' }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'translate(-2px,-2px)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = '')}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>Feeling lucky?</div>
            <h2 className="font-display" style={{ fontSize: 32, margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1 }}>Surprise me 🎲</h2>
            <p style={{ fontSize: 14, color: 'var(--sand-700)', margin: 0, fontStyle: 'italic' }}>One tap. A random favourite. Go.</p>
          </div>
          <span className="font-display" style={{ fontSize: 52, lineHeight: 1, opacity: 0.3 }}>→</span>
        </button>

        {/* 2-column grid for remaining sections */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {HUB_CARDS.slice(1).map((card) => (
            <button key={card.id} onClick={() => setActive(card.id)}
              className="chunky"
              style={{ textAlign: 'left', padding: '22px 24px', cursor: 'pointer', background: card.bg, transition: 'transform 0.1s' }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'translate(-2px,-2px)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = '')}>
              <div style={{ fontSize: 28, marginBottom: 10, lineHeight: 1 }}>{card.emoji}</div>
              <h3 className="font-display" style={{ fontSize: 20, margin: '0 0 4px', color: 'var(--ink)', lineHeight: 1.1 }}>{card.label}</h3>
              <p style={{ fontSize: 12, color: 'var(--sand-700)', margin: 0, fontStyle: 'italic' }}>{card.tagline}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DESIGN C — Vertical scroll stack
// All five sections live on one long page. A slim sticky left rail shows your
// position; clicking a dot jumps to that section. No tab-switching — just scroll.
// ════════════════════════════════════════════════════════════════════════════

function DesignC() {
  const [activeDot, setActiveDot] = useState<SectionId>('surprise');
  const refs = useRef<Record<string, HTMLElement | null>>({});

  const jumpTo = (id: SectionId) => {
    refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveDot(id);
  };

  return (
    <div style={{ background: 'var(--cream)', minHeight: '100vh' }}>
      {/* Page header */}
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280" style={{ padding: '28px 36px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.55)', marginBottom: 6 }}>My Aruba · Jan</div>
          <h1 className="font-display" style={{ fontSize: 40, margin: 0, color: 'var(--ink)', lineHeight: 1 }}>My Aruba</h1>
        </div>
      </div>

      <div className="bleed" style={{ background: 'var(--cream)' }}>
        <div className="container-1280" style={{ padding: '0 36px' }}>
          <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>

            {/* Sticky dot-rail */}
            <div style={{ width: 48, flexShrink: 0, position: 'sticky', top: 24, paddingTop: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
              {SECTIONS_META.map((s, i) => (
                <div key={s.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <button
                    onClick={() => jumpTo(s.id)}
                    title={s.label}
                    style={{ width: 12, height: 12, borderRadius: '50%', background: activeDot === s.id ? 'var(--red)' : 'var(--sand-200)', border: `2px solid ${activeDot === s.id ? 'var(--ink)' : 'var(--sand-200)'}`, cursor: 'pointer', padding: 0, transition: 'all 0.15s', boxShadow: activeDot === s.id ? '2px 2px 0 var(--ink)' : 'none' }}
                    aria-label={s.label}
                  />
                  {i < SECTIONS_META.length - 1 && (
                    <div style={{ width: 2, height: 60, background: 'var(--sand-100)', margin: '4px 0' }} />
                  )}
                </div>
              ))}
            </div>

            {/* Scrollable sections */}
            <div style={{ flex: 1, padding: '40px 0 80px 32px' }}>
              {SECTIONS_META.map((s, i) => (
                <section
                  key={s.id}
                  ref={(el) => { refs.current[s.id] = el; }}
                  style={{ marginBottom: i < SECTIONS_META.length - 1 ? 64 : 0, scrollMarginTop: 24 }}
                  onMouseEnter={() => setActiveDot(s.id)}
                >
                  {/* Section divider with number */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                    <span style={{ background: 'var(--ink)', color: 'var(--cream)', borderRadius: 8, padding: '3px 10px', fontSize: 11, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.05em', boxShadow: '2px 2px 0 var(--sand-200)' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <h2 className="font-display" style={{ fontSize: 28, margin: 0, color: 'var(--ink)', lineHeight: 1 }}>
                      {sectionHeading(s.id)}
                    </h2>
                    <div style={{ flex: 1, height: 2, background: 'var(--sand-100)' }} />
                  </div>

                  {sectionContent(s.id)}
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PREVIEW WRAPPER
// ════════════════════════════════════════════════════════════════════════════

type DesignKey = 'A' | 'B' | 'C';

const DESIGNS: { id: DesignKey; label: string; tagline: string; Component: React.FC }[] = [
  { id: 'A', label: 'Top tabs',     tagline: 'Horizontal tab strip, full-width content',           Component: DesignA },
  { id: 'B', label: 'Hub cards',    tagline: 'Home grid of section cards → drill-in',              Component: DesignB },
  { id: 'C', label: 'Scroll stack', tagline: 'Single long page, sticky dot-rail navigation',      Component: DesignC },
];

export default function DashboardPreview({ setPage }: Props) {
  const [design, setDesign] = useState<DesignKey>('A');
  const { Component } = DESIGNS.find((d) => d.id === design)!;

  return (
    <div>
      {/* Picker bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: 'rgba(26,26,26,0.96)', backdropFilter: 'blur(10px)',
        borderBottom: '2px solid rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
        fontFamily: "'Inter', sans-serif",
      }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', marginRight: 6 }}>
          UX variants
        </span>
        {DESIGNS.map((d) => (
          <button key={d.id} onClick={() => setDesign(d.id)} style={{
            fontSize: 12, fontWeight: design === d.id ? 700 : 500,
            padding: '6px 14px', borderRadius: 7, cursor: 'pointer',
            background: design === d.id ? '#fff' : 'rgba(255,255,255,0.07)',
            color: design === d.id ? '#1A1A1A' : 'rgba(255,255,255,0.65)',
            border: design === d.id ? '2px solid #fff' : '2px solid rgba(255,255,255,0.12)',
            transition: 'all 0.12s', fontFamily: 'inherit',
          }}>
            <strong>{d.id}</strong> · {d.label}
            <span style={{ marginLeft: 6, opacity: 0.55, fontSize: 10 }}>— {d.tagline}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setPage('dashboard')} style={{
          fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
          cursor: 'pointer', background: 'rgba(255,255,255,0.07)',
          color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.12)',
          fontFamily: 'inherit',
        }}>
          ← Live dashboard
        </button>
      </div>

      {/* Offset for the fixed bar */}
      <div style={{ paddingTop: 50 }}>
        <Component />
      </div>
    </div>
  );
}
