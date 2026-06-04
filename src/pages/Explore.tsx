import { useState, type CSSProperties } from 'react';
import { Search, Star, MapPin, Clock, Dollar, Plus, Check, X } from '../components/Icons';
import Footer from '../components/Footer';
import GroupCard from '../components/GroupCard';
import { CATEGORIES } from '../data/activities';
import type { Activity } from '../data/activities';
import { useCatalog } from '../data/useCatalog';
import {
  filterExploreEntries,
  groupPasses,
  itemCategory,
  type ExploreEntry,
} from '../data/exploreItems';
import type { ViatorGroup, ViatorItem } from '../types';
import type { Answers } from '../App';
import type { PageId } from '../App';

type Props = { setPage: (p: PageId) => void; answers: Answers };

// Map Viator taxonomy ids → existing UI category buckets (group cards only).
const GROUP_TAXONOMY_TO_CATEGORY: Record<string, typeof CATEGORIES[number]> = {
  'adventure-tours':         'Activities',
  'watersports':             'Watersports',
  'sailing-cruises':         'Tours',
  'food-drink-experiences':  'Food',
};

// Vibe pill copy/colour from an adventure value (mirrors vibePass thresholds).
function vibePill(adventure: number): { label: string; bg: string } {
  if (adventure >= 67) return { label: '🪂 Adrenaline', bg: 'var(--coral, #ff7a5c)' };
  if (adventure <= 33) return { label: '🌴 Chill', bg: 'var(--sand-50)' };
  return { label: '⚖ Balanced', bg: 'var(--sand-50)' };
}

const provStyle: CSSProperties = {
  position: 'absolute', top: 10, left: 10, border: '2px solid var(--ink)', borderRadius: 999,
  fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 9px', zIndex: 2,
};
const pillStyle: CSSProperties = {
  position: 'absolute', top: 10, right: 10, border: '2px solid var(--ink)', borderRadius: 999,
  fontSize: 10, fontWeight: 800, padding: '2px 9px', zIndex: 2,
};

function Slider({ label, badge, value, onChange, lo, hi, hint }: {
  label: string; badge?: string; value: number; onChange: (v: number) => void; lo: string; hi: string; hint: string;
}) {
  const sliderStyle = { ['--pct' as string]: value + '%' } as CSSProperties;
  return (
    <div className="chunky" style={{ padding: 18, marginBottom: 16 }}>
      <h3 style={{ fontWeight: 700, fontSize: 13, margin: '0 0 8px', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
        {label}{badge && <span style={{ background: 'var(--red)', color: 'var(--cream)', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, border: '2px solid var(--ink)' }}>{badge}</span>}
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

export default function Explore({ setPage, answers }: Props) {
  const catalog = useCatalog();

  const [category, setCategory] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [vibe, setVibe] = useState<number>(answers.adventureLevel ?? 50);
  const [price, setPrice] = useState<number>(50);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const groupName = (item: ViatorItem) => catalog.groups.find((g) => g.id === item.group_id)?.name ?? '';

  // Merged, filtered, ranked list of individual item + local-pick tiles.
  const entries = filterExploreEntries(catalog, { category, search, vibe, price });

  // Group tiles: pinned on top. Shown when category/search match AND any item
  // in the group clears both sliders (groupPasses).
  const groupTiles: { g: ViatorGroup; bs: ViatorItem }[] = catalog.groups
    .map((g) => {
      const bs = catalog.items.find((i) => i.group_id === g.id && i.is_best_seller);
      return bs ? { g, bs } : null;
    })
    .filter((x): x is { g: ViatorGroup; bs: ViatorItem } => x !== null)
    .filter(({ g, bs }) => {
      const grpCat = GROUP_TAXONOMY_TO_CATEGORY[g.id] ?? 'Tours';
      const catOk = category === 'All' || grpCat === category;
      const s = search.toLowerCase();
      const searchOk = search === '' ||
        g.name.toLowerCase().includes(s) || g.tagline.toLowerCase().includes(s) || bs.title.toLowerCase().includes(s);
      return catOk && searchOk && groupPasses(g, catalog, vibe, price);
    })
    .sort((a, b) => a.g.display_order - b.g.display_order);

  const toggleAdd = (id: string) => {
    setAdded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalCount = groupTiles.length + entries.length;

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
            {CATEGORIES.map((cat) => (
              <button key={cat} className={`cat-tab${cat === category ? ' active' : ''}`} onClick={() => setCategory(cat)}>
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bleed" style={{ background: 'var(--cream)', padding: '36px 0 64px' }}>
        <div className="container-1280">
          <div className="explore-row" style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
            <aside className="explore-sidebar" style={{ flex: '0 0 240px' }}>
              <Slider label="Vibe" badge="New" value={vibe} onChange={setVibe} lo="🌴 Chill" hi="Adrenaline 🪂" hint={vibeHint(vibe)} />
              <Slider label="Price" badge="New" value={price} onChange={setPrice} lo="🆓 Free" hi="Splurge 💸" hint={priceHint(price)} />
              {added.size > 0 && (
                <div className="chunky" style={{ padding: 18, background: 'var(--green)', color: 'var(--cream)' }}>
                  <div className="font-display" style={{ fontSize: 18, marginBottom: 6 }}>{added.size} added</div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 12 }}>Your hand-picked shortlist.</div>
                  <button className="btn-red" onClick={() => setPage('itinerary')} style={{ width: '100%', padding: '10px 14px', fontSize: 14 }}>Build itinerary →</button>
                </div>
              )}
            </aside>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <p style={{ fontSize: 14, color: 'var(--sand-700)', margin: 0 }}>
                  <strong style={{ color: 'var(--ink)' }}>{totalCount}</strong> results
                  {category !== 'All' && ` in ${category}`}
                </p>
              </div>
              <div className="explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 }}>
                {/* Group tiles first (pinned) */}
                {groupTiles.map(({ g, bs }) => {
                  const others = catalog.items
                    .filter((i) => i.group_id === g.id && i.id !== bs.id)
                    .sort((a, b) => a.display_order - b.display_order);
                  const id = `group:${g.id}`;
                  return (
                    <div key={id} style={{ minHeight: 0 }}>
                      <GroupCard
                        group={g} bestSeller={bs} others={others}
                        approved={added.has(id)}
                        onApprove={() => toggleAdd(id)}
                        onSwap={() => {/* not rendered in explore variant */}}
                        onFlip={() => {/* not rendered in explore variant */}}
                        variant="explore"
                      />
                    </div>
                  );
                })}
                {/* Merged individual tiles: Viator items + local picks, ranked */}
                {entries.map((e) => (
                  e.kind === 'item'
                    ? <ItemTile key={`item:${e.item.id}`} item={e.item} groupName={groupName(e.item)} adventure={e.adventure} added={added.has(`item:${e.item.id}`)} onAdd={() => toggleAdd(`item:${e.item.id}`)} />
                    : <ActivityTile key={e.activity.id} a={e.activity} adventure={e.adventure} added={added.has(e.activity.id)} onAdd={() => toggleAdd(e.activity.id)} />
                ))}
              </div>
              {totalCount === 0 && (
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

function AddButton({ added, onAdd }: { added: boolean; onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 12, border: '2px solid var(--ink)', fontWeight: 700, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', background: added ? 'var(--green)' : 'var(--red)', color: 'var(--cream)', boxShadow: '3px 3px 0 var(--ink)' }}
    >
      {added ? <><Check size={13} /> Added</> : <><Plus size={13} /> Add</>}
    </button>
  );
}

function ItemTile({ item, groupName, adventure, added, onAdd }: { item: ViatorItem; groupName: string; adventure: number; added: boolean; onAdd: () => void }) {
  const pill = vibePill(adventure);
  return (
    <div className="a-card fade-in" style={{ position: 'relative' }}>
      <span style={{ ...provStyle, background: 'var(--cream)' }}>Viator</span>
      <span style={{ ...pillStyle, background: pill.bg }}>{pill.label}</span>
      <div className="card-header-band"><div className="chb-title">{itemCategory(item)}</div></div>
      <div className="a-img">
        <img src={item.image_url} alt={item.title} loading="lazy" />
        <span className="a-rating"><Star size={12} aria-hidden /> {item.rating}</span>
      </div>
      <div style={{ padding: 16 }}>
        <h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)' }}>{item.title}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sand-500)', fontSize: 12, marginBottom: 10 }}>
          <MapPin size={12} /><span>{groupName}</span>
        </div>
        {item.description && (
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--sand-700)', margin: '0 0 12px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {item.description}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}><Clock size={11} /> {item.duration}</span>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}><Dollar size={11} /> {item.price_usd}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn-ghost" href={item.viator_item_url} target="_blank" rel="noopener noreferrer"
             style={{ flex: 1, padding: '9px 12px', fontSize: 13, textDecoration: 'none', textAlign: 'center', display: 'inline-block' }}>View details</a>
          <AddButton added={added} onAdd={onAdd} />
        </div>
      </div>
    </div>
  );
}

function ActivityTile({ a, adventure, added, onAdd }: { a: Activity; adventure: number; added: boolean; onAdd: () => void }) {
  const pill = vibePill(adventure);
  return (
    <div className="a-card fade-in" style={{ position: 'relative' }}>
      <span style={{ ...provStyle, background: 'var(--yellow)' }}>Local pick</span>
      <span style={{ ...pillStyle, background: pill.bg }}>{pill.label}</span>
      <div className="card-header-band"><div className="chb-title">{a.category}</div></div>
      <div className="a-img">
        <img src={a.image} alt={a.title} loading="lazy" />
        <span className="a-rating"><Star size={12} aria-hidden /> {a.rating}</span>
      </div>
      <div style={{ padding: 16 }}>
        <h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)' }}>{a.title}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sand-500)', fontSize: 12, marginBottom: 10 }}>
          <MapPin size={12} /><span>{a.location}</span>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--sand-700)', margin: '0 0 12px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {a.description}
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}><Clock size={11} /> {a.duration}</span>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}><Dollar size={11} /> {a.cost}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {a.viator_item_url ? (
            <a className="btn-ghost" href={a.viator_item_url} target="_blank" rel="noopener noreferrer"
               style={{ flex: 1, padding: '9px 12px', fontSize: 13, textDecoration: 'none', textAlign: 'center', display: 'inline-block' }}>View details</a>
          ) : (
            <button className="btn-ghost" style={{ flex: 1, padding: '9px 12px', fontSize: 13 }}>View details</button>
          )}
          <AddButton added={added} onAdd={onAdd} />
        </div>
      </div>
    </div>
  );
}
