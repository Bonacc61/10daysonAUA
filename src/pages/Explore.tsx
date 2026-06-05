import { useState, type CSSProperties } from 'react';
import { Search, Star, MapPin, Clock, Dollar, Plus, Check, X } from '../components/Icons';
import Footer from '../components/Footer';
import type { Activity } from '../data/activities';
import { useCatalog } from '../data/useCatalog';
import { filterExploreEntries, bookingUrl, SECTIONS, sectionLabel, primarySection, SECTION_VIATOR_URL } from '../data/exploreItems';
import type { Section } from '../types';
import type { ViatorItem } from '../types';
import type { Answers } from '../App';
import type { PageId } from '../App';

type Props = { setPage: (p: PageId) => void; answers: Answers };

// Vibe pill copy/colour from an adventure value (mirrors vibePass thresholds).
function vibePill(adventure: number): { label: string; bg: string } {
  if (adventure >= 67) return { label: '🪂 Adrenaline', bg: 'var(--coral, #ff7a5c)' };
  if (adventure <= 33) return { label: '🌴 Chill', bg: 'var(--sand-50)' };
  return { label: '⚖ Balanced', bg: 'var(--sand-50)' };
}

// Header tags (sit inline in the card-header-band flex row): a "Local pick" tag
// for editorial picks and the vibe pill. Viator items carry no provenance mark.
function LocalMark() {
  return (
    <span style={{ flexShrink: 0, background: 'var(--yellow)', color: 'var(--ink)', border: '2px solid var(--ink)', borderRadius: 999, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 7px', whiteSpace: 'nowrap' }}>Local pick</span>
  );
}
function HeaderVibePill({ adventure }: { adventure: number }) {
  const p = vibePill(adventure);
  return (
    <span style={{ flexShrink: 0, background: p.bg, color: 'var(--ink)', border: '2px solid var(--ink)', borderRadius: 999, fontSize: 10, fontWeight: 800, padding: '2px 8px', whiteSpace: 'nowrap' }}>{p.label}</span>
  );
}

// Region slug → human label (Region type in types.ts).
const REGION_LABEL: Record<string, string> = {
  'palm-beach': 'Palm Beach', 'eagle-beach': 'Eagle Beach', 'noord': 'Noord',
  'oranjestad': 'Oranjestad', 'san-nicolas': 'San Nicolas', 'arikok': 'Arikok',
  'savaneta': 'Savaneta', 'islandwide': 'Island-wide',
};

function Slider({ label, value, onChange, lo, hi, hint }: {
  label: string; value: number; onChange: (v: number) => void; lo: string; hi: string; hint: string;
}) {
  const sliderStyle = { ['--pct' as string]: value + '%' } as CSSProperties;
  return (
    <div className="chunky" style={{ padding: 18, marginBottom: 16 }}>
      <h3 style={{ fontWeight: 700, fontSize: 13, margin: '0 0 8px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </h3>
      <input type="range" min={0} max={100} value={value} className="trip-slider" style={sliderStyle}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--sand-700)', marginTop: 10 }}>
        <span>{lo}</span><span>{hi}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--sand-700)', marginTop: 6, fontStyle: 'italic', minHeight: 32 }}>{hint}</div>
    </div>
  );
}

function vibeHint(v: number): string {
  const t = (v - 50) / 50;
  if (Math.abs(t) < 0.06) return 'Showing every vibe — slide either way to narrow.';
  if (t > 0) return v >= 94 ? 'Adrenaline only — just the most intense activities.' : 'Leaning adrenaline — filtering out the chillest picks.';
  return v <= 6 ? 'Chill only — just the calmest activities.' : 'Leaning chill — filtering out the most intense picks.';
}
function priceHint(p: number): string {
  const t = (p - 50) / 50;
  if (Math.abs(t) < 0.06) return 'Any price — slide for free-only or splurge-only.';
  if (t > 0) return p >= 94 ? 'Splurge only — the priciest experiences.' : 'Leaning splurge — filtering out cheaper picks.';
  return p <= 6 ? 'Free only — no-cost activities.' : 'Leaning cheap — filtering out pricier picks.';
}

function SkeletonCard() {
  return (
    <div className="a-card" style={{ overflow: 'hidden' }}>
      <div style={{ height: 38, background: 'var(--sand-100)', borderBottom: '2px solid var(--ink)' }} />
      <div style={{ height: 180, background: 'var(--sand-100)' }} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ height: 18, width: '75%', background: 'var(--sand-100)', borderRadius: 4 }} />
        <div style={{ height: 13, width: '45%', background: 'var(--sand-100)', borderRadius: 4 }} />
        <div style={{ height: 13, width: '90%', background: 'var(--sand-100)', borderRadius: 4 }} />
        <div style={{ height: 13, width: '70%', background: 'var(--sand-100)', borderRadius: 4 }} />
        <div style={{ height: 36, background: 'var(--sand-100)', borderRadius: 6, marginTop: 6 }} />
      </div>
    </div>
  );
}

export default function Explore({ setPage, answers }: Props) {
  const { catalog, loading } = useCatalog();

  const [section, setSection] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [vibe, setVibe] = useState<number>(answers.adventureLevel ?? 50);
  const [price, setPrice] = useState<number>(50);
  const [added, setAdded] = useState<Set<string>>(new Set());

  // Region per Viator item: its own override, else its group's region (coarse for
  // now; precise per-item locations are the planned backend follow-up).
  const regionOf = (item: ViatorItem) => {
    const slug = item.region ?? catalog.groups.find((g) => g.id === item.group_id)?.region;
    return slug ? REGION_LABEL[slug] ?? slug : '';
  };
  // Every individual Viator item URL + local pick, as its own filterable tile.
  const entries = filterExploreEntries(catalog, { section, search, vibe, price });

  const toggleAdd = (id: string) => {
    setAdded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalCount = entries.length;

  return (
    <>
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280 explore-head" style={{ padding: '36px 36px 24px' }}>
          <h1 className="font-display" style={{ fontSize: 44, margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1 }}>Explore Aruba.</h1>
          <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.75)', margin: 0 }}>
            {catalog.items.length} activities + {catalog.activities.length} local picks — filter by vibe, price, and category.
          </p>

          <div style={{ position: 'relative', maxWidth: 520, marginTop: 22 }}>
            <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--sand-500)' }}>
              <Search />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search beaches, activities, food…"
              style={{ width: '100%', padding: '14px 14px 14px 44px', border: '2px solid var(--ink)', borderRadius: 12, fontSize: 14, fontFamily: 'inherit', background: 'var(--cream)', outline: 'none' }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <X />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 18, overflowX: 'auto' }}>
            {[{ key: 'All', label: 'All' }, ...SECTIONS].map((tab) => (
              <button key={tab.key} className={`cat-tab${tab.key === section ? ' active' : ''}`} onClick={() => setSection(tab.key)}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bleed" style={{ background: 'var(--cream)', padding: '36px 0 64px' }}>
        <div className="container-1280">
          <div className="explore-row" style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
            <aside className="explore-sidebar" style={{ flex: '0 0 240px' }}>
              <Slider label="Vibe" value={vibe} onChange={setVibe} lo="🌴 Chill" hi="Adrenaline 🪂" hint={vibeHint(vibe)} />
              <Slider label="Price" value={price} onChange={setPrice} lo="✨ Free" hi="Splurge 💸" hint={priceHint(price)} />
              {added.size > 0 && (
                <div className="chunky" style={{ padding: 18, background: 'var(--green)', color: 'var(--cream)' }}>
                  <div className="font-display" style={{ fontSize: 18, marginBottom: 6 }}>{added.size} added</div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 12 }}>Your hand-picked shortlist.</div>
                  <button className="btn-red" onClick={() => setPage('itinerary')} style={{ width: '100%', padding: '10px 14px', fontSize: 14 }}>Build itinerary →</button>
                </div>
              )}
            </aside>

            <div style={{ flex: 1, minWidth: 0 }}>
              {!loading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                  <p style={{ fontSize: 14, color: 'var(--sand-700)', margin: 0 }}>
                    <strong style={{ color: 'var(--ink)' }}>{totalCount}</strong> results
                    {section !== 'All' && ` in ${sectionLabel(section as never)}`}
                  </p>
                </div>
              )}
              <div className="explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 }}>
                {loading
                  ? Array.from({ length: 12 }, (_, i) => <SkeletonCard key={i} />)
                  : entries.map((e) => (
                    e.kind === 'item'
                      ? <ItemTile key={`item:${e.item.id}`} item={e.item} section={sectionLabel(primarySection(e.sections))} sectionUrl={SECTION_VIATOR_URL[primarySection(e.sections) as Section] ?? null} region={regionOf(e.item)} adventure={e.adventure} bookNow={bookingUrl(e)} added={added.has(`item:${e.item.id}`)} onAdd={() => toggleAdd(`item:${e.item.id}`)} />
                      : <ActivityTile key={e.activity.id} a={e.activity} section={sectionLabel(primarySection(e.sections))} sectionUrl={SECTION_VIATOR_URL[primarySection(e.sections) as Section] ?? null} adventure={e.adventure} bookNow={bookingUrl(e)} added={added.has(e.activity.id)} onAdd={() => toggleAdd(e.activity.id)} />
                  ))}
              </div>
              {!loading && totalCount === 0 && (
                <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--sand-500)' }}>
                  <p className="font-display" style={{ fontSize: 24, margin: 0 }}>No results found</p>
                  <p style={{ fontSize: 14, marginTop: 6 }}>Recenter the Vibe / Price sliders or clear search.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

function AddButton({ added, onAdd, fill }: { added: boolean; onAdd: () => void; fill?: boolean }) {
  return (
    <button
      onClick={onAdd}
      style={{ ...(fill ? { flex: 1 } : null), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px', borderRadius: 12, border: '2px solid var(--ink)', fontWeight: 700, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', background: added ? 'var(--green)' : 'var(--yellow-bg)', color: added ? 'var(--cream)' : 'var(--ink)', boxShadow: '3px 3px 0 var(--ink)' }}
    >
      {added ? <><Check size={13} /> Added</> : <><Plus size={13} /> Add</>}
    </button>
  );
}

// Card action row: "Book now" (only when bookable — paid + has a Viator link)
// plus the shortlist Add button. Free / unbookable cards show just Add.
function CardActions({ bookNow, added, onAdd }: { bookNow: string | null; added: boolean; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {bookNow && (
        <a href={bookNow} target="_blank" rel="noopener noreferrer"
           style={{ flex: 1, padding: '9px 12px', fontSize: 13, fontWeight: 700, textDecoration: 'none', textAlign: 'center', display: 'inline-block', borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '3px 3px 0 var(--ink)' }}>Book now</a>
      )}
      <AddButton added={added} onAdd={onAdd} fill={!bookNow} />
    </div>
  );
}

function ItemTile({ item, section, sectionUrl, region, adventure, bookNow, added, onAdd }: { item: ViatorItem; section: string; sectionUrl: string | null; region: string; adventure: number; bookNow: string | null; added: boolean; onAdd: () => void }) {
  const url = item.viator_item_url;
  const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;
  const headerInner = <><span className="chb-title" style={{ flex: 1 }}>{section}</span><HeaderVibePill adventure={adventure} /></>;
  return (
    <div className="a-card fade-in">
      {sectionUrl
        ? <a className="card-header-band" href={sectionUrl} {...ext}>{headerInner}</a>
        : <div className="card-header-band">{headerInner}</div>}
      {url
        ? <a className="a-img" href={url} {...ext} style={{ display: 'block' }}><img src={item.image_url} alt={item.title} loading="lazy" /><span className="a-rating"><Star size={12} aria-hidden /> {item.rating}</span></a>
        : <div className="a-img"><img src={item.image_url} alt={item.title} loading="lazy" /><span className="a-rating"><Star size={12} aria-hidden /> {item.rating}</span></div>}
      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
        {url
          ? <a href={url} {...ext} className="card-title-link" style={{ textDecoration: 'none', color: 'inherit' }}><h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)' }}>{item.title}</h3></a>
          : <h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)' }}>{item.title}</h3>}
        {region && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sand-500)', fontSize: 12, marginBottom: 10 }}>
            <MapPin size={12} /><span>{region}</span>
          </div>
        )}
        {item.description && (
          url
            ? <a href={url} {...ext} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}><p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--sand-700)', margin: '0 0 12px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.description}</p></a>
            : <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--sand-700)', margin: '0 0 12px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.description}</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}><Clock size={11} /> {item.duration}</span>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}><Dollar size={11} /> {item.price_usd}</span>
        </div>
        <div style={{ marginTop: 'auto' }}><CardActions bookNow={bookNow} added={added} onAdd={onAdd} /></div>
      </div>
    </div>
  );
}

function ActivityTile({ a, section, sectionUrl, adventure, bookNow, added, onAdd }: { a: Activity; section: string; sectionUrl: string | null; adventure: number; bookNow: string | null; added: boolean; onAdd: () => void }) {
  const url = a.viator_item_url; // present only on matched local picks
  const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;
  const imgInner = <><img src={a.image} alt={a.title} loading="lazy" /><span className="a-rating"><Star size={12} aria-hidden /> {a.rating}</span></>;
  const headerInner = <><span className="chb-title" style={{ flex: 1 }}>{section}</span><HeaderVibePill adventure={adventure} /><LocalMark /></>;
  return (
    <div className="a-card fade-in">
      {sectionUrl
        ? <a className="card-header-band" href={sectionUrl} {...ext}>{headerInner}</a>
        : <div className="card-header-band">{headerInner}</div>}
      {url
        ? <a className="a-img" href={url} {...ext} style={{ display: 'block' }}>{imgInner}</a>
        : <div className="a-img">{imgInner}</div>}
      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
        {url
          ? <a href={url} {...ext} className="card-title-link" style={{ textDecoration: 'none', color: 'inherit' }}><h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)' }}>{a.title}</h3></a>
          : <h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)' }}>{a.title}</h3>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sand-500)', fontSize: 12, marginBottom: 10 }}>
          <MapPin size={12} /><span>{a.location}</span>
        </div>
        {(() => {
          const desc = (
            <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--sand-700)', margin: '0 0 12px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {a.description}
            </p>
          );
          return url
            ? <a href={url} {...ext} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>{desc}</a>
            : desc;
        })()}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}><Clock size={11} /> {a.duration}</span>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}><Dollar size={11} /> {a.cost}</span>
        </div>
        <div style={{ marginTop: 'auto' }}><CardActions bookNow={bookNow} added={added} onAdd={onAdd} /></div>
      </div>
    </div>
  );
}
