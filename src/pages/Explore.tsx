import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Star, MapPin, Clock, Dollar } from '../components/Icons';
import { ChillEnd, AdrenalineEnd, FreeEnd, SplurgeEnd } from '../components/SliderEnds';
import AddButton from '../components/AddButton';
import SearchBar from '../components/SearchBar';
import DepartureNote from '../components/DepartureNote';
import RatingChip from '../components/RatingChip';
import Footer from '../components/Footer';
import { useShortlist } from '../lib/shortlist';
import type { Activity } from '../data/activities';
import { useCatalog } from '../data/useCatalog';
import { filterExploreEntries, sortEntries, bookingUrl, viatorLink, SECTIONS, sectionLabel, primarySection, SECTION_VIATOR_URL, vibeHint, priceHint, starsHint, reviewsHint } from '../data/exploreItems';
import type { DurationBand, ExploreEntry, Provenance, SortKey } from '../data/exploreItems';
import { searchEntries } from '../lib/entrySearch';
import { splitByFacet } from '../lib/searchPool';
import { answersToTags } from '../data/answerTags';
import { useSearchBox } from '../lib/useSearchBox';
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
  label: string; value: number; onChange: (v: number) => void; lo: ReactNode; hi: ReactNode; hint: string;
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

// A row of mutually exclusive filter pills. One selected value, always — every
// row carries its own "Any", so there is no state in which a row filters
// nothing yet looks unset.
function PillRow<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h4 style={{ fontWeight: 700, fontSize: 11, margin: '0 0 7px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-700)' }}>{label}</h4>
      <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {options.map((o) => (
          <button key={String(o.v)} type="button" aria-pressed={o.v === value}
            className={`filter-pill${o.v === value ? ' active' : ''}`}
            onClick={() => onChange(o.v)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

const STARS_OPTIONS = [
  { v: 0, label: 'Any' }, { v: 4.0, label: '4.0★+' }, { v: 4.5, label: '4.5★+' }, { v: 4.8, label: '4.8★+' },
];
const REVIEWS_OPTIONS = [
  { v: 0, label: 'Any' }, { v: 10, label: '10+' }, { v: 50, label: '50+' }, { v: 100, label: '100+' }, { v: 500, label: '500+' },
];
const DURATION_OPTIONS: { v: DurationBand; label: string }[] = [
  { v: 'any', label: 'Any' }, { v: 'short', label: 'Under 2h' }, { v: 'half', label: '2–4h' }, { v: 'long', label: '4–6h' }, { v: 'full', label: 'Full day' },
];
const PROVENANCE_OPTIONS: { v: Provenance; label: string }[] = [
  { v: 'all', label: 'All' }, { v: 'local', label: 'Local picks' }, { v: 'bookable', label: 'Bookable' },
  { v: 'free', label: 'Free' },
];
const SORT_OPTIONS: { v: SortKey; label: string }[] = [
  { v: 'recommended', label: 'Recommended' },
  { v: 'price-asc', label: 'Price: low to high' },
  { v: 'price-desc', label: 'Price: high to low' },
  { v: 'rating', label: 'Highest rated' },
  { v: 'reviews', label: 'Most reviewed' },
];

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
  // Query + search-by-meaning state. Shared with My Aruba > Personalized, which
  // draws the same box: see useSearchBox for why a space arms the semantic layer.
  const box = useSearchBox();
  const search = box.query;
  // Both filters open BALANCED (50), not seeded from the questionnaire. Seeding
  // vibe from answers.adventureLevel meant a traveller who answered "chill"
  // arrived at Explore with the catalog already narrowed to 🌴 Chill and no
  // indication that anything had been filtered out — Explore is the browse-
  // everything surface, and the plan is where answers are meant to bite.
  const [vibe, setVibe] = useState<number>(50);
  const [price, setPrice] = useState<number>(50);
  // The questionnaire reaches Explore for RANKING only — never for filtering.
  // That is the line the comment above draws: seeding the sliders from answers
  // HID activities and left no sign that anything had gone, which is wrong on a
  // browse-everything surface. Reordering hides nothing, so "Recommended" is
  // free to put the things you asked for first.
  //
  // `hasPersona` asks whether the traveller actually told us something, rather
  // than inspecting the derived tags: an untouched questionnaire still yields
  // `med-adventure` (the adventure slider's midpoint is 50), and ranking on a
  // default nobody chose is not personalisation.
  const tags = useMemo(() => answersToTags(answers), [answers]);
  const hasPersona = answers.interests.length > 0 || !!answers.budget
    || !!answers.groupType || !!answers.lodging || answers.flags.length > 0
    // specialNotes counts too: `effectiveFlags` turns "I get seasick" into
    // mobility/low-adventure tags, and without this those tags were derived and
    // then thrown away because the traveller had ticked nothing.
    || !!answers.specialNotes.trim();
  // Sort and the four extra filters. Every default is the neutral value, so a
  // traveller who touches none of them sees the same SET of activities the page
  // showed before these controls existed. The default ORDER is different —
  // 'recommended' is now a ranking rather than a passthrough (see rankRecommended)
  // — but the keyword-then-meaning boundary search relies on is preserved below.
  const [sort, setSort] = useState<SortKey>('recommended');
  const [minStars, setMinStars] = useState<number>(0);
  const [minReviews, setMinReviews] = useState<number>(0);
  const [duration, setDuration] = useState<DurationBand>('any');
  const [privateOnly, setPrivateOnly] = useState(false);
  // Runs on the same `verdictFor` the search box uses, so the two cannot come to
  // disagree about what "good for kids" MEANS. They still return different sets:
  // buildPool keeps unknowns and demotes them, this removes them — see the note
  // on splitByFacet for why a checkbox is the narrower promise.
  const [kidsOnly, setKidsOnly] = useState(false);
  const [provenance, setProvenance] = useState<Provenance>('all');
  const [moreOpen, setMoreOpen] = useState(false);
  // Only the filters hidden behind "More filters" are counted — the badge exists
  // to say what is narrowing the page out of sight, and stars is in plain view.
  const hiddenActive = [minReviews > 0, duration !== 'any', privateOnly, provenance !== 'all', kidsOnly].filter(Boolean).length;
  const anyActive = hiddenActive > 0 || minStars > 0 || sort !== 'recommended' || vibe !== 50 || price !== 50;
  const clearAll = () => {
    setVibe(50); setPrice(50); setSort('recommended'); setMinStars(0);
    setMinReviews(0); setDuration('any'); setPrivateOnly(false); setProvenance('all');
    setKidsOnly(false);
  };
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
  const extra = { minStars, minReviews, duration, privateOnly, provenance };
  // The facet filter sits OUTSIDE filterExploreEntries rather than inside it with
  // the others: searchPool imports values from exploreItems, so calling back the
  // other way would close a real import cycle. It wraps instead.
  //
  // `unjudged` is carried out so the sidebar can say how many activities were
  // removed for want of a judgement rather than for failing one — 128 of the 350
  // entries carry no kids verdict, and dropping a third of the page in silence
  // would read as the island having less for families than it does.
  const byKids = (list: ExploreEntry[]) => (kidsOnly ? splitByFacet(list, 'kids') : { kept: list, unjudged: 0 });
  const filtered = byKids(filterExploreEntries(catalog, { section, search, vibe, price, ...extra }));
  const substringHits = filtered.kept;
  const kidsUnjudged = filtered.unjudged;

  // Semantic blending + typed contraindications, shared with the Personalized
  // panel. The unsearched pool is a thunk so it is built ONLY when there is
  // something to blend into it — eagerly it allocated ~328 entries and
  // re-derived every section on every keystroke.
  const { entries: found, addedByMeaning } = searchEntries(
    search,
    substringHits,
    () => byKids(filterExploreEntries(catalog, { section, search: '', vibe, price, ...extra })).kept,
    box.semantic,
  );

  // Sorting happens HERE, not inside filterExploreEntries, because semantic hits
  // are appended to the filtered list above — sorting earlier would leave that
  // tail in its own order beneath everything else.
  //
  // 'recommended' ranks the KEYWORD BLOCK ONLY and leaves the semantic tail
  // appended beneath it. That boundary is load-bearing, not tidiness: entrySearch
  // promises substring hits "stay first, always" because cosine similarity blurs
  // exactly the proper nouns a name search depends on, and `.env.production`
  // gives that ordering as the reason VITE_SEMANTIC_SEARCH was allowed to ship at
  // 65% recall — "a bad match costs a mediocre extra suggestion, not a wrong
  // plan". Ranking the blended list broke that premise: measured on a "snorkel"
  // query, a semantic-only entry reached position 3 above 86 keyword matches.
  //
  // `addedByMeaning` IS the tail length (entrySearch appends and counts exactly
  // what it appended), and it is 0 whenever the box is empty — so with no query
  // this ranks the whole page, which is the common case.
  const entries = sortEntries(found, sort, {
    tags, hasPersona, adventureLevel: answers.adventureLevel, semanticTail: addedByMeaning,
  });

  const totalCount = entries.length;

  return (
    <>
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280 explore-head" style={{ padding: '36px 36px 24px' }}>
          <h1 className="font-display" style={{ fontSize: 44, margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1 }}>Explore Aruba.</h1>
          <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.75)', margin: 0 }}>
            {catalog.items.length} activities + {catalog.activities.length} local picks — filter by vibe, price, rating, reviews, and duration.
          </p>

          <SearchBar box={box} addedByMeaning={addedByMeaning} placeholder="Search beaches, activities, food…" style={{ marginTop: 22 }} />

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
              <Slider label="Vibe" value={vibe} onChange={setVibe} lo={<ChillEnd />} hi={<AdrenalineEnd />} hint={vibeHint(vibe)} />
              <Slider label="Price" value={price} onChange={setPrice} lo={<FreeEnd />} hi={<SplurgeEnd />} hint={priceHint(price)} />

              <div className="chunky" style={{ padding: 18, marginBottom: 16 }}>
                <h3 style={{ fontWeight: 700, fontSize: 13, margin: '0 0 8px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sort</h3>
                <select className="filter-select" aria-label="Sort results" value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)} style={{ marginBottom: 16 }}>
                  {SORT_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>

                <PillRow label="Rating" value={minStars} options={STARS_OPTIONS} onChange={setMinStars} />
                <div style={{ fontSize: 12, color: 'var(--sand-700)', marginTop: -6, marginBottom: 14, fontStyle: 'italic' }}>{starsHint(minStars)}</div>

                {/* The button comes BEFORE what it reveals. Put it after and
                    opening the panel inserts four control groups above the
                    focused element, so tabbing onward walks straight past
                    everything the traveller just asked to see. */}
                <button type="button" className="filter-more" aria-expanded={moreOpen}
                  aria-controls="explore-more-filters" onClick={() => setMoreOpen((v) => !v)}>
                  <span>{moreOpen ? 'Fewer filters' : 'More filters'}</span>
                  <span>{hiddenActive > 0 ? `${hiddenActive} on` : moreOpen ? '−' : '+'}</span>
                </button>

                {moreOpen && (
                  <div id="explore-more-filters" style={{ marginTop: 16 }}>
                    <PillRow label="Reviews" value={minReviews} options={REVIEWS_OPTIONS} onChange={setMinReviews} />
                    <div style={{ fontSize: 12, color: 'var(--sand-700)', marginTop: -6, marginBottom: 14, fontStyle: 'italic' }}>{reviewsHint(minReviews)}</div>
                    <PillRow label="Duration" value={duration} options={DURATION_OPTIONS} onChange={setDuration} />
                    <PillRow label="Show" value={provenance} options={PROVENANCE_OPTIONS} onChange={setProvenance} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      <input type="checkbox" checked={privateOnly} onChange={(e) => setPrivateOnly(e.target.checked)} />
                      Private tours only
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginTop: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={kidsOnly} aria-describedby={kidsOnly ? 'explore-kids-hint' : undefined}
                        onChange={(e) => setKidsOnly(e.target.checked)} />
                      Good for kids
                    </label>
                    {kidsOnly && (
                      // The copy states the MINIMUM AGE, not a promise about any
                      // child. `min_age` is the youngest age an activity sensibly
                      // takes, and 88 of the 141 that pass sit above 0 — 45 of
                      // them at 6 or 8. "Suits a child of 8 or under" would tell
                      // a parent of a 3-year-old the opposite of what the data
                      // says. A wrong filter is invisible; a wrong promise
                      // strands someone at a jetty.
                      <div id="explore-kids-hint" style={{ fontSize: 12, color: 'var(--sand-700)', marginTop: 6, fontStyle: 'italic' }}>
                        Minimum age 8 or under — check each listing for the youngest age it takes.
                        {kidsUnjudged > 0 && ` ${kidsUnjudged === 1 ? '1 activity we have' : `${kidsUnjudged} activities we have`}n’t checked ${kidsUnjudged === 1 ? 'is' : 'are'} hidden from these results.`}
                      </div>
                    )}
                  </div>
                )}

                {anyActive && (
                  <button type="button" onClick={clearAll}
                    style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--red)', textDecoration: 'underline', cursor: 'pointer' }}>
                    Clear all filters
                  </button>
                )}
              </div>

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
                    {box.answered && addedByMeaning === 0
                      ? 'We looked for what you meant as well as what you typed, and still found nothing here. Try recentering the Vibe / Price sliders.'
                      : 'Recenter the Vibe / Price sliders or clear search.'}
                  </p>
                  {/* A filter behind a COLLAPSED panel is the one that can empty
                      the page with nothing on screen to explain why. Once the
                      panel is open the controls speak for themselves, and saying
                      "hidden" about something visible is just wrong. */}
                  {!moreOpen && hiddenActive > 0 && (
                    <p style={{ fontSize: 14, marginTop: 6 }}>
                      {hiddenActive === 1 ? '1 filter is' : `${hiddenActive} filters are`} hidden under “More filters”.
                    </p>
                  )}
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
        <RatingChip rating={item.rating} reviewCount={item.review_count} size={12} />
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
        {/* Same box the itinerary card shows, and the reason it belongs here too:
            Explore is where a traveller decides, and a boat you cannot reach is
            not a real option. `.a-card` is auto-height, so unlike the flip card
            this needs no size term — it just makes the tile taller. Its WIDTH is
            capped separately: the shared 58% is tuned for the flip card and went
            nearly square in this narrower tile, so index.css overrides it to
            100% under `.a-card`. */}
        <DepartureNote item={item} />
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
        {a.ratingSource === 'viator' && <RatingChip rating={a.rating} reviewCount={a.reviewCount} size={12} />}
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
