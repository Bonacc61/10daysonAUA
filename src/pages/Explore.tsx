import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Star, MapPin, Clock, Dollar } from '../components/Icons';
import { ChillEnd, AdrenalineEnd, FreeEnd, SplurgeEnd } from '../components/SliderEnds';
import AddButton from '../components/AddButton';
import SearchBar from '../components/SearchBar';
import DepartureNote from '../components/DepartureNote';
import CardBack from '../components/CardBack';
import RatingChip from '../components/RatingChip';
import Footer from '../components/Footer';
import { useShortlist } from '../lib/shortlist';
import type { Activity } from '../data/activities';
import { useCatalog } from '../data/useCatalog';
import { isLocalPickItem } from '../data/localPickItems';
import { filterExploreEntries, sortEntries, bookUrlForEntry, SECTIONS, sectionLabel, primarySection, SECTION_VIATOR_URL, vibeHint, priceHint, poolPass, sailPass, type ExploreEntry } from '../data/exploreItems';
import { matchingSection } from '../data/itemFit';
import type { DurationBand, Provenance, SortKey, PoolMode, SailFacet } from '../data/exploreItems';
import { searchEntries } from '../lib/entrySearch';
import { answersToTags } from '../data/answerTags';
import { useSearchBox } from '../lib/useSearchBox';
import { parseActivityCost } from '../data/matcher';
import type { Section } from '../types';
import type { ViatorItem } from '../types';
import type { Answers } from '../App';
import type { PageId } from '../App';

type Props = { setPage: (p: PageId) => void; answers: Answers; canSeeItinerary: boolean; initialSection?: Section; };

// Header tags (sit inline in the card-header-band flex row): a "Local pick" tag
// for editorial picks — curated entries, and the Viator products the owner has
// vouched for by hand (src/data/localPickItems.ts). The mark and the "Local
// picks" filter read the same list, so a card cannot wear the tag and then
// disappear under the filter that claims it.
//
// The Adrenaline/Balanced/Chill pill that used to sit here was REMOVED
// 2026-08-19, owner's call: the band it showed came from `entry.adventure`,
// which is a coarse per-entry guess, and it was wrong often enough on real
// cards to be worth nothing. The Vibe SLIDER is unaffected — it filters, and
// filtering wrong is recoverable in a way a wrong label on a card is not.
function LocalMark() {
  return (
    <span style={{ flexShrink: 0, background: 'var(--yellow)', color: 'var(--ink)', border: '2px solid var(--ink)', borderRadius: 999, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 7px', whiteSpace: 'nowrap' }}>Local pick</span>
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
function PillRow<T extends string | number>({ label, value, options, onChange, showLabel = true }: {
  label: string; value: T; options: { v: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void;
  showLabel?: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      {showLabel && <h4 style={{ fontWeight: 700, fontSize: 11, margin: '0 0 7px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-700)' }}>{label}</h4>}
      <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {options.map((o) => (
          <button key={String(o.v)} type="button" aria-pressed={o.v === value} disabled={o.disabled}
            className={`filter-pill${o.v === value ? ' active' : ''}`}
            onClick={() => onChange(o.v)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

const DURATION_OPTIONS: { v: DurationBand; label: string }[] = [
  { v: 'any', label: 'Any' }, { v: 'short', label: 'Under 2h' }, { v: 'half', label: '2–4h' }, { v: 'long', label: '4–6h' }, { v: 'full', label: 'Full day' },
];
const PROVENANCE_OPTIONS: { v: Provenance; label: string }[] = [
  { v: 'all', label: 'All' }, { v: 'local', label: 'Local picks' }, { v: 'bookable', label: 'Bookable' },
  { v: 'free', label: 'Free' },
];
/* Same pill, many at once. Kept separate from PillRow rather than folded into
   it with a flag: one takes a value and returns a value, this takes a set and
   toggles membership, and the two aria contracts differ with them. */
function PillToggles<T extends string>({ label, values, options, onToggle, showLabel = true }: {
  label: string; values: T[]; options: { v: T; label: string; disabled?: boolean }[]; onToggle: (v: T) => void;
  showLabel?: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      {showLabel && <h4 style={{ fontWeight: 700, fontSize: 11, margin: '0 0 7px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-700)' }}>{label}</h4>}
      <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {options.map((o) => (
          <button key={o.v} type="button" aria-pressed={values.includes(o.v)} disabled={o.disabled}
            className={`filter-pill${values.includes(o.v) ? ' active' : ''}`}
            onClick={() => onToggle(o.v)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

// One row, in the order they were asked for. The three times still widen each
// other while the rest narrow — that asymmetry lives in sailPass, and it did not
// need two headings above the pills to be true.
const SAIL_OPTIONS: { v: SailFacet; label: string }[] = [
  { v: 'morning', label: 'Morning' }, { v: 'afternoon', label: 'Afternoon' }, { v: 'sunset', label: 'Sunset' },
  { v: 'food', label: 'Food' }, { v: 'cocktails', label: 'Cocktails' }, { v: 'snorkeling', label: 'Snorkeling' },
];
const POOL_MODE_OPTIONS: { v: PoolMode; label: string }[] = [
  { v: 'any', label: 'Any' }, { v: 'jeep', label: 'Jeep' }, { v: 'utv', label: 'UTV' },
  { v: 'atv', label: 'ATV' }, { v: 'horseback', label: 'Horseback' }, { v: 'hike', label: 'Hike' },
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
  // Sort and the five extra filters (the pool and its vehicle row count as one
  // narrowing). Every default is the neutral value, so a
  // traveller who touches none of them sees the same SET of activities the page
  // showed before these controls existed. The default ORDER is different —
  // 'recommended' is now a ranking rather than a passthrough (see rankRecommended)
  // — but the keyword-then-meaning boundary search relies on is preserved below.
  const [sort, setSort] = useState<SortKey>('recommended');
  const [duration, setDuration] = useState<DurationBand>('any');
  const [privateOnly, setPrivateOnly] = useState(false);
  const [provenance, setProvenance] = useState<Provenance>('all');
  const [pool, setPool] = useState(false);
  const [poolMode, setPoolMode] = useState<PoolMode>('any');
  const [sail, setSail] = useState(false);
  const [sailFacets, setSailFacets] = useState<SailFacet[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  // Only the filters hidden behind "More filters" are counted — the badge exists
  // to say what is narrowing the page out of sight. The pool and its vehicle row
  // are one entry here, not two; see the comment on hiddenActive below.
  // The pool and its vehicle row count as ONE narrowing, because that is what
  // they are: the vehicle cannot narrow anything on its own.
  const hiddenActive = [duration !== 'any', privateOnly, provenance !== 'all', pool, sail].filter(Boolean).length;
  const anyActive = hiddenActive > 0 || sort !== 'recommended' || vibe !== 50 || price !== 50;
  const clearAll = () => {
    setVibe(50); setPrice(50); setSort('recommended');
    setDuration('any'); setPrivateOnly(false); setProvenance('all');
    setPool(false); setPoolMode('any');
    setSail(false); setSailFacets([]);
  };
  // No ♥ on Explore's cards since 2026-08-05 — "+ Add" is the one way to keep an
  // activity here, so a card offers one action instead of two that read alike.
  // Since the same date it writes the single shortlist store (localStorage,
  // '10doa:starred'), so what you add here is what My Aruba > Shortlisted shows
  // and what survives a refresh.

  // Region per Viator item: its own override, else its group's region (coarse for
  // now; precise per-item locations are the planned backend follow-up).
  /**
   * The name on a card's dark header strip.
   *
   * Two rules, and the first is why "homogeneity" was the right word for the
   * complaint. Inside a section tab, the badge simply NAMES THAT TAB. A card
   * only ever appears in a tab it genuinely belongs to, so this cannot lie, and
   * it stops one card in a row of UTVs wearing a different word from its
   * neighbours. The same card can badge differently in two tabs; both readings
   * are true, because 193 of 365 products really do belong to more than one.
   *
   * On All there is no tab to take the name from, so a single one has to be
   * chosen. `primarySection` chooses it by TAB ORDER — first match down the row
   * — and Cruises & Water is the leftmost tab, so a lone water tag beat four
   * adventure tags and filed a UTV tour as a boat trip. That is not a data
   * error: Viator's water tag 20255 sits on 73 products, 53 of them genuinely
   * water, and 10 land tours it also happens to mark.
   *
   * `matchingSection` already solves this for the ENGINE — `KIND_SECTION[kind]`
   * first, tab order only as a fallback — with a test pinning the exact case
   * ("a jeep safari that also carries a boat tag"). The badge had never been
   * told. Reading it here changes no kind and re-files nothing; it is the label
   * catching up with how the product was already filed.
   *
   * `enriched_kind` is BLANKED before asking, and that is the load-bearing line
   * here. `activityKind` reads Viator's tags first and falls back to the
   * enrichment snapshot when they say nothing — a model's guess, carrying its
   * own confidence field. Trusting it for a badge put "Half-Day Aruba
   * Sightseeing Tour & Beach in an Air-conditioned Bus" (enriched_kind
   * "snorkel", confidence medium) under Cruises & Water: the reported bug
   * inverted, a bus reading as a boat. With enrichment blanked, a product whose
   * tags name no activity falls through to tab order exactly as before, so this
   * only ever overrides a tie the TAGS themselves settle. The engine keeps
   * using the enriched kind — it needs a kind for every product and a guess
   * beats nothing there. A badge is a claim to a traveller's face, and it does
   * not.
   *
   * Local picks keep `primarySection`: a `kind: 'activity'` entry carries a
   * hand-written section rather than Viator tags — all 26 have exactly one, so
   * there is no tie to break. (A Viator ITEM can also be a local pick; those
   * take the branch above.)
   */
  const badgeFor = (e: ExploreEntry): string => {
    if (section !== 'All') return sectionLabel(section as Section);
    if (e.kind !== 'item') return sectionLabel(primarySection(e.sections));
    return sectionLabel(matchingSection({ ...e.item, enriched_kind: undefined }));
  };

  const regionOf = (item: ViatorItem) => {
    const slug = item.region ?? catalog.groups.find((g) => g.id === item.group_id)?.region;
    return slug ? REGION_LABEL[slug] ?? slug : '';
  };
  // Every individual Viator item URL + local pick, as its own filterable tile.
  // `minStars`/`minReviews` are deliberately not passed: their controls were
  // removed 2026-08-19 (owner's call — the bars hid local picks in ways that
  // read as the island being emptier than it is). `starsPass`/`reviewsPass`
  // stay in exploreItems and pass everything when the option is absent, so the
  // filter is dormant rather than deleted. Sorting by rating or reviews is
  // untouched — a sort cannot hide anything.
  const extra = useMemo(() => ({ duration, privateOnly, provenance, pool, poolMode, sail, sailFacets }),
    [duration, privateOnly, provenance, pool, poolMode, sail, sailFacets]);
  // Which vehicles can actually reach a pool, counted against the page as it is
  // currently filtered so the row cannot disagree with the grid. Greyed rather
  // than hidden: a dead button reads as a fact about supply, where a missing one
  // reads as an oversight. Nothing is grey on the live catalog today — covering
  // both swimming holes is what keeps ATV answerable — so this only shows itself
  // when supply moves.
  const poolModeCounts = useMemo(() => {
    if (!pool) return null;
    const atPool = filterExploreEntries(catalog, { section, search, vibe, price, ...extra, poolMode: 'any' });
    // Nothing to say when the page is already empty for another reason: with
    // Sail also on, the intersection is empty, every count is 0, and greying the
    // whole row would blame Arikok for a page the other filter emptied.
    if (atPool.length === 0) return null;
    return Object.fromEntries(POOL_MODE_OPTIONS.map((o) => [o.v, atPool.filter((e) => poolPass(e, pool, o.v)).length])) as Record<PoolMode, number>;
  }, [catalog, section, search, vibe, price, extra, pool]);
  // Named so the row can say why a button is dead. `disabled` drops a button
  // out of the tab order and announces nothing, so the reason has to be text
  // somebody can actually read.
  const deadVehicles = POOL_MODE_OPTIONS
    .filter((o) => o.v !== 'any' && o.v !== poolMode && poolModeCounts?.[o.v] === 0)
    .map((o) => o.label);
  // "Any" is the filter's on/off. Pressing it while it is already the state
  // switches the filter off; pressing a vehicle turns the filter on around it.
  const choosePool = (v: PoolMode | 'off') => {
    if (v === 'any') { if (pool && poolMode === 'any') { setPool(false); } else { setPool(true); } setPoolMode('any'); return; }
    if (v === 'off') return;
    setPool(true);
    setPoolMode(pool && poolMode === v ? 'any' : v);
  };
  // Same contract on the multi-select side, and switching sailing off drops the
  // facets with it so a stale one cannot come back with the filter.
  const chooseSail = (f: SailFacet | 'any') => {
    if (f === 'any') {
      if (sail && sailFacets.length === 0) setSail(false); else { setSail(true); setSailFacets([]); }
      return;
    }
    setSail(true);
    setSailFacets((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  };
  // A facet nothing answers to, counted against the page as it stands — the same
  // guard the vehicle row has, and it never disables one already chosen.
  const sailFacetCounts = useMemo(() => {
    if (!sail) return null;
    const sails = filterExploreEntries(catalog, { section, search, vibe, price, ...extra, sailFacets: [] });
    // Same guard as the pool row: an empty set is not evidence about any one
    // facet's supply, so nothing greys.
    if (sails.length === 0) return null;
    return Object.fromEntries(SAIL_OPTIONS.map((o) => [o.v, sails.filter((e) => sailPass(e, true, [o.v])).length])) as Record<SailFacet, number>;
  }, [catalog, section, search, vibe, price, extra, sail]);
  const sailOptions = [{ v: 'any' as const, label: 'Any' }, ...SAIL_OPTIONS].map((o) =>
    ({ ...o, disabled: o.v !== 'any' && sail && !sailFacets.includes(o.v) && sailFacetCounts?.[o.v] === 0 }));
  // The "Good for kids" checkbox that wrapped this in `splitByFacet` was removed
  // 2026-08-19 and deferred to v2, owner's call: the underlying kids verdict is
  // not good enough to filter on. The VERDICT stays live — the search box reads
  // it through `buildPool` to DEMOTE unknowns rather than drop them, which is
  // the softer promise a checkbox could not make. `splitByFacet` itself now has
  // no caller outside its own test; left in place for the v2 wiring.
  const substringHits = filterExploreEntries(catalog, { section, search, vibe, price, ...extra });

  // Semantic blending + typed contraindications, shared with the Personalized
  // panel. The unsearched pool is a thunk so it is built ONLY when there is
  // something to blend into it — eagerly it allocated ~328 entries and
  // re-derived every section on every keystroke.
  const { entries: found, addedByMeaning } = searchEntries(
    search,
    substringHits,
    () => filterExploreEntries(catalog, { section, search: '', vibe, price, ...extra }),
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
            {catalog.items.length} activities + {catalog.activities.length} local picks — filter by vibe, price, and duration.
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

                {/* The button comes BEFORE what it reveals. Put it after and
                    opening the panel inserts three control groups above the
                    focused element, so tabbing onward walks straight past
                    everything the traveller just asked to see. */}
                <button type="button" className="filter-more" aria-expanded={moreOpen}
                  aria-controls="explore-more-filters" onClick={() => setMoreOpen((v) => !v)}>
                  <span>{moreOpen ? 'Fewer filters' : 'More filters'}</span>
                  <span>{hiddenActive > 0 ? `${hiddenActive} on` : moreOpen ? '−' : '+'}</span>
                </button>

                {moreOpen && (
                  <div id="explore-more-filters" style={{ marginTop: 16 }}>
                    <PillRow label="Duration" value={duration} options={DURATION_OPTIONS} onChange={setDuration} />
                    <PillRow label="Show" value={provenance} options={PROVENANCE_OPTIONS} onChange={setProvenance} />
                    {/* A heading like Duration and Show, not a control. "Any"
                        is what carries the filter's on/off: pressed, it means
                        every pool trip; pressed again it switches the filter
                        back off, so nothing here needs a checkbox and no state
                        is unreachable. */}
                    <PillRow label="Natural Pool" value={pool ? poolMode : 'off'}
                      options={POOL_MODE_OPTIONS.map((o) => ({ ...o, disabled: pool && o.v !== 'any' && o.v !== poolMode && poolModeCounts?.[o.v] === 0 }))}
                      onChange={choosePool} />
                    {deadVehicles.length > 0 && (
                      <p style={{ fontSize: 11, color: 'var(--sand-700)', margin: '-8px 0 14px' }}>
                        {`${deadVehicles.join(', ').replace(/, ([^,]*)$/, ' and $1')} tours do not reach this pool.`}
                      </p>
                    )}
                    <PillToggles label="Sail" values={sail && sailFacets.length === 0 ? ['any'] : sailFacets}
                      options={sailOptions} onToggle={chooseSail} />

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      <input type="checkbox" checked={privateOnly} onChange={(e) => setPrivateOnly(e.target.checked)} />
                      Private tours only
                    </label>
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
                      ? <ItemTile key={`item:${e.item.id}`} item={e.item} section={badgeFor(e)} sectionUrl={SECTION_VIATOR_URL[primarySection(e.sections) as Section] ?? null} region={regionOf(e.item)} bookNow={bookUrlForEntry(e)} added={shortlist.has(`item:${e.item.id}`)} onAdd={() => toggleAdd(`item:${e.item.id}`)} />
                      : <ActivityTile key={e.activity.id} a={e.activity} section={badgeFor(e)} sectionUrl={SECTION_VIATOR_URL[primarySection(e.sections) as Section] ?? null} bookNow={bookUrlForEntry(e)} added={shortlist.has(e.activity.id)} onAdd={() => toggleAdd(e.activity.id)} />
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

// Card action row: "Book now" (paid + a link, affiliate or direct alike),
// "✓ Free" (free entry), or just the Add button (no booking URL and not
// explicitly free).
function CardActions({ bookNow, free, added, onAdd }: { bookNow: { url: string; affiliate: boolean } | null; free?: boolean; added: boolean; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {bookNow ? (
        <a href={bookNow.url} target="_blank" rel="noopener noreferrer"
           style={{ flex: 1, padding: '9px 12px', fontSize: 13, fontWeight: 700, textDecoration: 'none', textAlign: 'center', display: 'inline-block', borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '3px 3px 0 var(--ink)' }}>Book now</a>
      ) : free ? (
        <span data-noflip style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '9px 12px', fontSize: 13, fontWeight: 700, borderRadius: 12, border: '2px solid var(--ink)', background: '#A8F5B8', color: 'var(--ink)', boxShadow: '3px 3px 0 var(--ink)' }}>✓ Free</span>
      ) : null}
      <AddButton added={added} onAdd={onAdd} fill={!bookNow && !free} />
    </div>
  );
}


/**
 * A click inside the card's TEXT means "tell me more", not "take me to Viator".
 *
 * The whole tile used to be one affiliate link, so reading the description and
 * leaving the site were the same gesture — a traveller who wanted to know what
 * a thing actually was got thrown to a booking page to find out. Worse, the
 * description is clipped at three lines, so the card where the text runs out is
 * exactly the card someone wants to finish reading.
 *
 * The text flips to the same back the Itinerary page shows. The photo does
 * nothing at all: it carried the redirect for a while, and a picture that
 * navigates away mid-read is the same defect in a smaller box. Leaving is Book
 * now's job, and only Book now's.
 *
 * Interactive children are exempt: Book now is an `<a>`, Add is a `<button>`,
 * and the ✓ Free badge is marked `data-noflip`. None of them should flip a card
 * out from under the thing you just pressed.
 */
function flipOnText(e: MouseEvent, toggle: () => void) {
  // `[data-noflip]` is the ✓ Free badge: the one thing in the control row that
  // is neither a link nor a button, and so the one thing there that used to
  // flip the card when pressed.
  if ((e.target as HTMLElement).closest('a, button, [data-noflip]')) return;
  toggle();
}

function ItemTile({ item, section, sectionUrl: _sectionUrl, region, bookNow, added, onAdd }: { item: ViatorItem; section: string; sectionUrl: string | null; region: string; bookNow: { url: string; affiliate: boolean } | null; added: boolean; onAdd: () => void }) {
  const [flipped, setFlipped] = useState(false);
  // Mounted on the FIRST flip, then kept. Explore renders ~350 tiles; giving
  // every one of them a card back up front means 350 rating histograms and 350
  // "What to expect" lookups built for cards nobody has asked about — and it put
  // each activity's title in the document twice, which is a real ambiguity for
  // anything reading the page, tests included. Kept rather than unmounted on the
  // way back, because the return rotation still has to have something to turn.
  const [everFlipped, setEverFlipped] = useState(false);
  const flip = (to: boolean) => { if (to) setEverFlipped(true); setFlipped(to); };
  const headerInner = <><span className="chb-title" style={{ flex: 1 }}>{section}</span>{isLocalPickItem(item.id) && <LocalMark />}</>;
  return (
    <div className={`flip-card explore-flip fade-in${flipped ? ' flipped' : ''}`}
         onClick={flipped ? (e) => flipOnText(e, () => flip(false)) : undefined}>
      <div className="flip-inner" style={{ height: '100%' }}>
    <div className="a-card flip-face">
      <div className="card-header-band">{headerInner}</div>
      <div className="a-img">
        <img src={item.image_url} alt={item.title} loading="lazy" />
        <RatingChip rating={item.rating} reviewCount={item.review_count} size={12} />
      </div>
      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
           onClick={(e) => flipOnText(e, () => flip(true))}>
        <h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)' }}>
          {/* The keyboard's way in. The surrounding text block cannot be the
              button — it contains Book now and Add, and interactive elements do
              not nest — but the title has no such children, so it can be a real
              one. `flipOnText` exempts buttons, so a click here fires this
              handler only and does not toggle twice. */}
          <button type="button" className="explore-flip-btn" aria-expanded={flipped}
                  onClick={() => flip(!flipped)}>{item.title}</button>
        </h3>
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
        {everFlipped && <CardBack kind="group" bestSeller={item} onFlip={() => flip(false)} />}
      </div>
    </div>
  );
}

function ActivityTile({ a, section, sectionUrl: _sectionUrl, bookNow, added, onAdd }: { a: Activity; section: string; sectionUrl: string | null; bookNow: { url: string; affiliate: boolean } | null; added: boolean; onAdd: () => void }) {
  const [flipped, setFlipped] = useState(false);
  // See ItemTile: the back is built on first flip, not for all ~350 tiles.
  const [everFlipped, setEverFlipped] = useState(false);
  const flip = (to: boolean) => { if (to) setEverFlipped(true); setFlipped(to); };
  const headerInner = <><span className="chb-title" style={{ flex: 1 }}>{section}</span><LocalMark /></>;
  return (
    <div className={`flip-card explore-flip fade-in${flipped ? ' flipped' : ''}`}
         onClick={flipped ? (e) => flipOnText(e, () => flip(false)) : undefined}>
      <div className="flip-inner" style={{ height: '100%' }}>
    <div className="a-card flip-face">
      <div className="card-header-band">{headerInner}</div>
      <div className="a-img">
        <img src={a.image} alt={a.title} loading="lazy" />
        {a.ratingSource === 'viator' && <RatingChip rating={a.rating} reviewCount={a.reviewCount} size={12} />}
      </div>
      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
           onClick={(e) => flipOnText(e, () => flip(true))}>
        <h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)' }}>
          {/* See ItemTile: the title is the focusable flip trigger. */}
          <button type="button" className="explore-flip-btn" aria-expanded={flipped}
                  onClick={() => flip(!flipped)}>{a.title}</button>
        </h3>
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
        {everFlipped && <CardBack kind="activity" activity={a} onFlip={() => flip(false)} />}
      </div>
    </div>
  );
}
