import { useState, type CSSProperties, type MouseEvent } from 'react';
import { Search, Star, MapPin, Clock, Dollar, X } from '../components/Icons';
import AddButton from '../components/AddButton';
import Footer from '../components/Footer';
import { useShortlist } from '../lib/shortlist';
import type { Activity } from '../data/activities';
import { useCatalog } from '../data/useCatalog';
import { filterExploreEntries, blendSearchResults, bookingUrl, viatorLink, SECTIONS, sectionLabel, primarySection, SECTION_VIATOR_URL, vibeHint, priceHint } from '../data/exploreItems';
import { searchByMeaning, semanticSearchEnabled } from '../lib/semanticSearch';
import { parseActivityCost } from '../data/matcher';
import type { Section } from '../types';
import type { ViatorItem } from '../types';
import type { Answers } from '../App';
import type { PageId } from '../App';

type Props = { setPage: (p: PageId) => void; answers: Answers; canSeeItinerary: boolean; initialSection?: Section; };

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

export default function Explore({ setPage, answers, canSeeItinerary, initialSection }: Props) {
  const { shortlist, toggle: toggleAdd } = useShortlist();
  const { catalog, loading } = useCatalog();

  const [section, setSection] = useState<string>(initialSection ?? 'All');
  const [search, setSearch] = useState('');
  // Semantic search state (VITE_SEMANTIC_SEARCH only).
  //
  // The space bar ARMS it rather than switching to it. One word is nearly always
  // a name or a noun — "Zeerover", "snorkel" — and substring matching answers
  // those instantly, locally and for free. Two or more words is where people
  // start describing intent, and that is the only case worth a network round
  // trip. Substring results stay live throughout: arming never blanks or delays
  // what is already on screen, so a two-word KEYWORD search ("baby beach") keeps
  // working exactly as it does today and Enter merely adds to it.
  const [semanticIds, setSemanticIds] = useState<string[]>([]);
  const [semanticFor, setSemanticFor] = useState('');      // the query those ids answer
  const [semanticPending, setSemanticPending] = useState(false);
  const [semanticFailed, setSemanticFailed] = useState(false);
  // Both filters open BALANCED (50), not seeded from the questionnaire. Seeding
  // vibe from answers.adventureLevel meant a traveller who answered "chill"
  // arrived at Explore with the catalog already narrowed to 🌴 Chill and no
  // indication that anything had been filtered out — Explore is the browse-
  // everything surface, and the plan is where answers are meant to bite.
  const [vibe, setVibe] = useState<number>(50);
  const [price, setPrice] = useState<number>(50);
  // No ♥ on Explore's cards since 2026-08-05 — "+ Add" is the one way to keep an
  // activity here, so a card offers one action instead of two that read alike.
  // Since the same date it writes the single shortlist store (localStorage,
  // '10doa:starred'), so what you add here is what My Aruba > Shortlisted shows
  // and what survives a refresh.

  // Region per Viator item: its own override, else its group's region (coarse for
  // now; precise per-item locations are the planned backend follow-up).
  const regionOf = (item: ViatorItem) => {
    const slug = item.region ?? catalog.groups.find((g) => g.id === item.group_id)?.region;
    return slug ? REGION_LABEL[slug] ?? slug : '';
  };
  // Every individual Viator item URL + local pick, as its own filterable tile.
  const substringHits = filterExploreEntries(catalog, { section, search, vibe, price });

  // Only blend results that answer the query currently in the box. Without this
  // an edited query would keep showing matches for the previous one.
  //
  // The unsearched pool is built ONLY when there is something to blend into it —
  // otherwise this allocated ~328 entries and re-derived every section on every
  // keystroke, for a branch that is not taken while the feature is dark.
  const blendable = search.trim() === semanticFor && semanticIds.length > 0;
  const entries = blendable
    ? blendSearchResults(substringHits, semanticIds, filterExploreEntries(catalog, { section, search: '', vibe, price }))
    : substringHits;

  const totalCount = entries.length;

  const armed = semanticSearchEnabled() && search.trim().includes(' ');
  const semanticAnswered = search.trim() === semanticFor && semanticFor !== '';

  const runSemantic = async () => {
    const q = search.trim();
    if (!armed || semanticPending || !q) return;
    if (q === semanticFor) return;      // already answered; don't spend a quota row on it
    setSemanticPending(true);
    setSemanticFailed(false);
    const out = await searchByMeaning(q);
    setSemanticPending(false);
    if (!out.ok) { setSemanticFailed(true); return; }
    setSemanticIds(out.ids);
    setSemanticFor(q);
  };

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
              onChange={(e) => { setSearch(e.target.value); setSemanticFailed(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && armed) { e.preventDefault(); void runSemantic(); } }}
              placeholder="Search beaches, activities, food…"
              style={{ width: '100%', padding: '14px 14px 14px 44px', border: '2px solid var(--ink)', borderRadius: 12, fontSize: 14, fontFamily: 'inherit', background: 'var(--cream)', outline: 'none' }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <X />
              </button>
            )}
            {armed && (
              <div className="search-arm-hint">
                {semanticPending
                  ? 'Searching by meaning…'
                  : semanticFailed
                    ? "Couldn't search by meaning just now — keyword results still below."
                    : semanticAnswered
                      // Say so. Otherwise pressing Enter makes the hint vanish and
                      // changes nothing else, which reads as the feature ignoring you
                      // — and it is the guaranteed experience until the first catalog
                      // refresh populates the corpus.
                      ? (semanticIds.length === 0
                          ? 'Nothing else matched what you meant.'
                          : `Added ${semanticIds.length} match${semanticIds.length === 1 ? '' : 'es'} by meaning.`)
                      : <>press <kbd>Enter</kbd> to search by meaning</>}
              </div>
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
              {shortlist.size > 0 && (
                <div className="chunky" style={{ padding: 18, background: 'var(--green)', color: 'var(--cream)' }}>
                  <div className="font-display" style={{ fontSize: 18, marginBottom: 6 }}>{shortlist.size} added</div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 12 }}>Your hand-picked shortlist.</div>
                  <button className="btn-red" onClick={() => setPage(canSeeItinerary ? 'itinerary' : 'questionnaire')} style={{ width: '100%', padding: '10px 14px', fontSize: 14 }}>Build itinerary →</button>
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
                      ? <ItemTile key={`item:${e.item.id}`} item={e.item} section={sectionLabel(primarySection(e.sections))} sectionUrl={SECTION_VIATOR_URL[primarySection(e.sections) as Section] ?? null} region={regionOf(e.item)} adventure={e.adventure} bookNow={bookingUrl(e)} added={shortlist.has(`item:${e.item.id}`)} onAdd={() => toggleAdd(`item:${e.item.id}`)} />
                      : <ActivityTile key={e.activity.id} a={e.activity} section={sectionLabel(primarySection(e.sections))} sectionUrl={SECTION_VIATOR_URL[primarySection(e.sections) as Section] ?? null} adventure={e.adventure} bookNow={bookingUrl(e)} added={shortlist.has(e.activity.id)} onAdd={() => toggleAdd(e.activity.id)} />
                  ))}
              </div>
              {!loading && totalCount === 0 && (
                <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--sand-500)' }}>
                  <p className="font-display" style={{ fontSize: 24, margin: 0 }}>No results found</p>
                  <p style={{ fontSize: 14, marginTop: 6 }}>
                    {semanticAnswered && semanticIds.length === 0
                      ? 'We looked for what you meant as well as what you typed, and still found nothing here. Try recentering the Vibe / Price sliders.'
                      : 'Recenter the Vibe / Price sliders or clear search.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Footer setPage={setPage} />
    </>
  );
}

// Card action row: "Book now" (paid + Viator link), "✓ Free" (free entry), or
// just the Add button (no booking URL and not explicitly free).
function CardActions({ bookNow, free, added, onAdd }: { bookNow: string | null; free?: boolean; added: boolean; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {bookNow ? (
        <a href={bookNow} target="_blank" rel="noopener noreferrer"
           style={{ flex: 1, padding: '9px 12px', fontSize: 13, fontWeight: 700, textDecoration: 'none', textAlign: 'center', display: 'inline-block', borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '3px 3px 0 var(--ink)' }}>Book now</a>
      ) : free ? (
        <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '9px 12px', fontSize: 13, fontWeight: 700, borderRadius: 12, border: '2px solid var(--ink)', background: '#A8F5B8', color: 'var(--ink)', boxShadow: '3px 3px 0 var(--ink)' }}>✓ Free</span>
      ) : null}
      <AddButton added={added} onAdd={onAdd} fill={!bookNow && !free} />
    </div>
  );
}

function openItem(url: string, e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a, button')) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function ItemTile({ item, section, sectionUrl: _sectionUrl, region, adventure, bookNow, added, onAdd }: { item: ViatorItem; section: string; sectionUrl: string | null; region: string; adventure: number; bookNow: string | null; added: boolean; onAdd: () => void }) {
  const url = item.viator_item_url ? viatorLink(item.viator_item_url) : null;
  const headerInner = <><span className="chb-title" style={{ flex: 1 }}>{section}</span><HeaderVibePill adventure={adventure} /></>;
  return (
    <div className="a-card fade-in" style={{ cursor: url ? 'pointer' : 'default' }} onClick={url ? (e) => openItem(url, e) : undefined}>
      <div className="card-header-band">{headerInner}</div>
      <div className="a-img">
        <img src={item.image_url} alt={item.title} loading="lazy" />
        <span className="a-rating"><Star size={12} aria-hidden /> {item.rating}</span>
      </div>
      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)' }}>{item.title}</h3>
        {region && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sand-500)', fontSize: 12, marginBottom: 10 }}>
            <MapPin size={12} /><span>{region}</span>
          </div>
        )}
        {item.description && (
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--sand-700)', margin: '0 0 12px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.description}</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}><Clock size={11} /> {item.duration}</span>
          <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--sand-50)' }}><Dollar size={11} /> {item.price_usd}</span>
        </div>
        <div style={{ marginTop: 'auto' }}><CardActions bookNow={bookNow} free={item.price_usd === 0} added={added} onAdd={onAdd} /></div>
      </div>
    </div>
  );
}

function ActivityTile({ a, section, sectionUrl: _sectionUrl, adventure, bookNow, added, onAdd }: { a: Activity; section: string; sectionUrl: string | null; adventure: number; bookNow: string | null; added: boolean; onAdd: () => void }) {
  const url = a.viator_item_url ? viatorLink(a.viator_item_url) : null;
  const headerInner = <><span className="chb-title" style={{ flex: 1 }}>{section}</span><HeaderVibePill adventure={adventure} /><LocalMark /></>;
  return (
    <div className="a-card fade-in" style={{ cursor: url ? 'pointer' : 'default' }} onClick={url ? (e) => openItem(url, e) : undefined}>
      <div className="card-header-band">{headerInner}</div>
      <div className="a-img">
        <img src={a.image} alt={a.title} loading="lazy" />
        {a.ratingSource === 'viator' && <span className="a-rating"><Star size={12} aria-hidden /> {a.rating}</span>}
      </div>
      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
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
        <div style={{ marginTop: 'auto' }}><CardActions bookNow={bookNow} free={parseActivityCost(a.cost) === 0} added={added} onAdd={onAdd} /></div>
      </div>
    </div>
  );
}
