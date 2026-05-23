import { useState, useMemo } from 'react';
import { Search, Star, MapPin, Clock, Dollar, Plus, Check, X } from '../components/Icons';
import Footer from '../components/Footer';
import GroupCard from '../components/GroupCard';
import { CATEGORIES, BUDGET_FILTERS } from '../data/activities';
import { getCatalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import type { PageId } from '../App';

type Props = { setPage: (p: PageId) => void };

// Map Viator taxonomy ids → existing UI category buckets.
// Add new groups here as the catalog grows; new mappings are 1 line each.
const GROUP_TAXONOMY_TO_CATEGORY: Record<string, typeof CATEGORIES[number]> = {
  'adventure-tours':         'Activities',
  'watersports':             'Watersports',
  'sailing-cruises':         'Tours',
  'food-drink-experiences':  'Food',
};

export default function Explore({ setPage }: Props) {
  const catalog = useMemo(() => getCatalog(), []);

  const [category, setCategory] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [budget, setBudget] = useState<string>('Any');
  const [added, setAdded] = useState<Set<string>>(new Set());

  const matchBudget = (cost: string | number) => {
    const num = typeof cost === 'number' ? cost : parseInt(String(cost).replace(/[^0-9]/g, ''), 10);
    if (budget === 'Any') return true;
    if (budget === 'Free') return cost === 'Free' || (typeof cost === 'string' && /^Free/.test(cost));
    if (isNaN(num)) return false;
    if (budget === 'Under $50') return num < 50;
    if (budget === '$50–$100')  return num >= 50 && num <= 100;
    if (budget === '$100+')     return num > 100;
    return true;
  };

  // Local-pick (Activity) tiles: existing filter logic.
  const activityTiles = catalog.activities.filter((a) =>
    (category === 'All' || a.category === category) &&
    (search === '' ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase()) ||
      a.location.toLowerCase().includes(search.toLowerCase())) &&
    matchBudget(a.cost),
  );

  // Group tiles: carry the best-seller through so render doesn't re-scan items.
  // Filter on best-seller's price (budget) and group name/tagline + best-seller title (search).
  const groupTiles: { g: ViatorGroup; bs: ViatorItem }[] = catalog.groups
    .map((g) => {
      const bs = catalog.items.find((i) => i.group_id === g.id && i.is_best_seller);
      return bs ? { g, bs } : null;
    })
    .filter((x): x is { g: ViatorGroup; bs: ViatorItem } => x !== null)
    .filter(({ g, bs }) => {
      const grpCat = GROUP_TAXONOMY_TO_CATEGORY[g.id] ?? 'Tours';
      const catOk    = category === 'All' || grpCat === category;
      const searchOk = search === '' ||
        g.name.toLowerCase().includes(search.toLowerCase()) ||
        g.tagline.toLowerCase().includes(search.toLowerCase()) ||
        bs.title.toLowerCase().includes(search.toLowerCase());
      const budgetOk = matchBudget(bs.price_usd);
      return catOk && searchOk && budgetOk;
    })
    .sort((a, b) => a.g.display_order - b.g.display_order);

  const toggleAdd = (id: string) => {
    setAdded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalCount = activityTiles.length + groupTiles.length;

  return (
    <>
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280 explore-head" style={{ padding: '36px 36px 24px' }}>
          <h1 className="font-display" style={{ fontSize: 44, margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1 }}>Explore Aruba.</h1>
          <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.75)', margin: 0 }}>
            {catalog.activities.length + catalog.groups.length} curated picks — beaches, adventure, food, and everything in between.
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
            <aside className="explore-sidebar" style={{ flex: '0 0 220px' }}>
              <div className="chunky" style={{ padding: 18, marginBottom: 16 }}>
                <h3 style={{ fontWeight: 700, fontSize: 13, margin: '0 0 12px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Budget</h3>
                {BUDGET_FILTERS.map((b) => (
                  <button
                    key={b}
                    onClick={() => setBudget(b)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 10, background: budget === b ? 'var(--yellow)' : 'transparent', color: 'var(--ink)', fontWeight: budget === b ? 700 : 500, border: budget === b ? '2px solid var(--ink)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, marginBottom: 4 }}
                  >
                    {b}
                  </button>
                ))}
              </div>
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
                {/* Group tiles first */}
                {groupTiles.map(({ g, bs }) => {
                  const others = catalog.items
                    .filter((i) => i.group_id === g.id && i.id !== bs.id)
                    .sort((a, b) => a.display_order - b.display_order);
                  const id = `group:${g.id}`;
                  // minHeight: 0 — CSS Grid subitem fix; prevents the GroupCard's
                  // intrinsic min-content from blowing out the row track.
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
                {/* Local activity tiles after */}
                {activityTiles.map((a) => {
                  const isAdded = added.has(a.id);
                  return (
                    <div key={a.id} className="a-card fade-in">
                      <div className="card-header-band">
                        <div className="chb-title">{a.category}</div>
                      </div>
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
                          <button className="btn-ghost" style={{ flex: 1, padding: '9px 12px', fontSize: 13 }}>View details</button>
                          <button
                            onClick={() => toggleAdd(a.id)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 12, border: '2px solid var(--ink)', fontWeight: 700, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', background: isAdded ? 'var(--green)' : 'var(--red)', color: 'var(--cream)', boxShadow: '3px 3px 0 var(--ink)' }}
                          >
                            {isAdded ? <><Check size={13} /> Added</> : <><Plus size={13} /> Add</>}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {totalCount === 0 && (
                <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--sand-500)' }}>
                  <p className="font-display" style={{ fontSize: 24, margin: 0 }}>No results found</p>
                  <p style={{ fontSize: 14, marginTop: 6 }}>Try a different category or search term.</p>
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
