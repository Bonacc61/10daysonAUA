import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import RatingChip, { RatingChipInline, hasRealRating } from '../components/RatingChip';
import Footer from '../components/Footer';
import ItineraryCard from '../components/ItineraryCard';
import { Calendar, Check, Chev, Clock, Dice, Doc, Dollar, Download, Info, IOSShare, Mail, MapPin, Pencil, Star, Trash } from '../components/Icons';
import GoodToKnowTimeline from '../components/GoodToKnowTimeline';
import { ChillEnd, AdrenalineEnd, FreeEnd, SplurgeEnd } from '../components/SliderEnds';
import { useCatalog } from '../data/useCatalog';
import { filterExploreEntries, bookUrlForEntry, vibeHint, priceHint } from '../data/exploreItems';
import { INFO_TOPICS } from '../data/activities';
import { answersToTags, activityTags } from '../data/answerTags';
import { resolveSlotEntry } from '../data/activitySource';
import CollapsedDaySummary from '../components/CollapsedDaySummary';
import { buildIcs, downloadIcs } from '../lib/icsExport';
import { useShortlist } from '../lib/shortlist';
import AddButton from '../components/AddButton';
import SearchBar from '../components/SearchBar';
import { searchEntries } from '../lib/entrySearch';
import { useSearchBox } from '../lib/useSearchBox';
import { useBooked } from '../lib/booked';
import { useAuth } from '../lib/auth';
import { listTrips, deleteTrip, tripLabel, type SavedTrip } from '../lib/trips';
import { readActiveTripId, writeActiveTripId } from '../lib/activeTrip';
import ShareEmailModal from '../components/ShareEmailModal';
import { matchPool, blendPools, parseActivityCost } from '../data/matcher';
import { productUrlFor, sectionLabel, primarySection, bookUrlForActivity } from '../data/exploreItems';
import type { PageId, Answers } from '../App';
import type { Activity } from '../data/activities';
import type { ViatorGroup, ViatorItem } from '../types';
import type { Catalog } from '../data/activitySource';
import type { TripState } from '../lib/trips';
import type { ExploreEntry } from '../data/exploreItems';
import type { PlannedDay, PlannedCard } from '../data/itineraryPlan';
import type { Slot, SlotEntry, CardEntry, MatchTag } from '../types';

// ─────────────────────────────────────────────────────────── types ──────── //

// No 'bookings' section. A Viator booking is completed on viator.com and
// attributed to us by Viator's own 30-day affiliate cookie — the sale is
// reported to the partner account, never back to this browser. Nothing in the
// affiliate programme (Basic or Full Access) hands us a per-visitor "they
// booked" signal; only a merchant/booking partnership, where the traveller pays
// us directly, would know. So a Bookings panel could only ever have listed what
// the traveller re-typed by hand, which is bookkeeping we asked them to do
// twice. The per-card "mark as booked" flag stays: it drives the calendar
// export and the "N confirmed" line under Itineraries.
type DashSection = 'surprise' | 'starred' | 'itinerary' | 'practical';

type IconFC = (p: { size?: number }) => JSX.Element;
const SECTIONS: { id: DashSection; label: string; NavIcon: IconFC }[] = [
  { id: 'starred',    label: 'Activities',             NavIcon: Check    },
  { id: 'itinerary',  label: 'Itineraries',           NavIcon: Calendar },
  { id: 'surprise',   label: 'Surprise me',           NavIcon: Dice     },
  { id: 'practical',  label: 'Practical Info',        NavIcon: Info     },
];

type TripLoadState = TripState | null | 'loading';

type Props = {
  setPage:         (p: PageId) => void;
  initialSection?: DashSection;
  onLogin:         () => void;
  answers:         Answers;
};

// ─────────────────────────────────── shared Slider (mirrors Explore.tsx) ─── //

function Slider({ label, value, onChange, lo, hi, hint }: {
  label: string; value: number; onChange: (v: number) => void;
  lo: ReactNode; hi: ReactNode; hint: string;
}) {
  const sliderStyle = { ['--pct' as string]: value + '%' } as CSSProperties;
  return (
    <div className="chunky" style={{ padding: 16 }}>
      <h3 style={{ fontWeight: 700, fontSize: 12, margin: '0 0 8px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</h3>
      <input type="range" min={0} max={100} value={value} className="trip-slider" style={sliderStyle}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--sand-700)', marginTop: 8 }}>
        <span>{lo}</span><span>{hi}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--sand-700)', marginTop: 5, fontStyle: 'italic' }}>{hint}</div>
    </div>
  );
}

// ─────────────────────────────────────────── Surprise Me logic ───────────── //

// `book` carries the affiliate flag, not just the URL (M7, 2026-08-18) — see
// the identical note in SurpriseMe.tsx. The flag no longer picks the wording:
// every bookable card reads "Book now" whether the link earns a commission or
// goes straight to the operator (2026-08-19). It is kept because it is the
// tested shape `bookUrlForActivity` returns and it still says which kind of link
// this is; the affiliate disclosure lives in the footer and Terms.
type Book = { url: string; affiliate: boolean } | null;
// A Viator product's own link is always the affiliate one; only a curated
// activity can carry a direct operator link, which is why this is a constant
// here and a lookup for the activity branch.
const itemBook = (i: ViatorItem): Book => {
  const url = i.viator_item_url && i.price_usd > 0 ? productUrlFor(i) : null;
  return url ? { url, affiliate: true } : null;
};

type Suggestion =
  | { kind: 'activity'; id: string; activity: Activity; book: Book }
  | { kind: 'item';     id: string; item: ViatorItem; group: ViatorGroup; book: Book };

function currentSlot(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'evening';
}

const SLOT_GREETING = { morning: 'Rise and roll', afternoon: 'Midday roulette', evening: 'Night owl energy' };

const NO_FILTER = { rejectedIds: new Set<string>(), rejectedGroupIds: new Set<string>() };

function resolveStarredPool(starred: Set<string>, catalog: Catalog): Suggestion[] {
  const pool: Suggestion[] = [];
  for (const sid of starred) {
    if (sid.startsWith('item:')) {
      const itemId = sid.slice(5);
      const item   = catalog.items.find((i) => i.id === itemId);
      const group  = item && catalog.groups.find((g) => g.id === item.group_id);
      if (item && group) {
        pool.push({ kind: 'item', id: sid, item, group, book: itemBook(item) });
      }
    } else {
      const activity = catalog.activities.find((a) => a.id === sid);
      if (activity) {
        pool.push({ kind: 'activity', id: sid, activity, book: bookUrlForActivity(activity) });
      }
    }
  }
  return pool;
}

function resolveMatchedPool(tags: Set<MatchTag>, catalog: Catalog, exclude: Set<string>): Suggestion[] {
  if (tags.size === 0) return [];
  const seen = new Set<string>(exclude);
  const result: Suggestion[] = [];
  for (const slot of ['morning', 'afternoon', 'evening'] as const) {
    const { activities, groups } = matchPool(catalog.activities, catalog.groups, tags, slot);
    const entries = blendPools(activities, groups, catalog.items, NO_FILTER);
    for (const e of entries) {
      const id = e.kind === 'activity' ? e.activity.id : `item:${e.bestSeller.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (e.kind === 'activity') {
        result.push({ kind: 'activity', id, activity: e.activity,
          book: bookUrlForActivity(e.activity) });
      } else {
        result.push({ kind: 'item', id, item: e.bestSeller, group: e.group,
          book: itemBook(e.bestSeller) });
      }
    }
  }
  return result;
}

function drawFrom(pool: Suggestion[], skipId: string | null, slotTod: string): Suggestion | null {
  if (!pool.length) return null;
  const matchSlot = pool.filter((e) => {
    if (e.id === skipId && pool.length > 1) return false;
    if (e.kind === 'activity') return e.activity.timeOfDay === slotTod;
    return true;
  });
  const eligible = matchSlot.length ? matchSlot : pool.filter((e) => e.id !== skipId || pool.length === 1);
  return eligible[Math.floor(Math.random() * eligible.length)] ?? null;
}

// ─────────────────────────────────────────────── Surprise panel ──────────── //

function SurprisePanel({ setPage, trip, answers }: { setPage: (p: PageId) => void; trip: TripLoadState; answers: Answers }) {
  const { catalog, loading } = useCatalog();
  const { shortlist, toggle: toggleAdd } = useShortlist();
  const [pick, setPick]     = useState<Suggestion | null>(null);
  const [skipId, setSkipId] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);

  const slot    = currentSlot();
  const slotTod = slot === 'morning' ? 'Morning' : slot === 'afternoon' ? 'Afternoon' : 'Evening';

  const tags = useMemo(() => {
    const src = (trip && trip !== 'loading') ? trip.answers : answers;
    return src.interests.length > 0 ? answersToTags(src) : new Set<MatchTag>();
  }, [trip, answers]);

  const starredPool = useMemo(
    () => resolveStarredPool(shortlist, catalog),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shortlist.size, catalog.activities.length, catalog.items.length],
  );

  const matchedPool = useMemo(
    () => resolveMatchedPool(tags, catalog, shortlist),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tags, shortlist.size, catalog.activities.length, catalog.items.length],
  );

  const pool = useMemo(() => [...starredPool, ...matchedPool], [starredPool, matchedPool]);

  const spin = useCallback(() => {
    const next = drawFrom(pool, skipId, slotTod);
    if (!next) return;
    setSkipId(next.id); setPick(next); setAnimKey((k) => k + 1);
  }, [pool, skipId, slotTod]);

  useEffect(() => {
    if (!loading && pool.length && !pick) spin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pool.length]);

  // Only auto-advance when a shortlisted item is removed AND it's not in the questionnaire pool.
  useEffect(() => {
    if (pick && !pool.some((p) => p.id === pick.id)) {
      const next = drawFrom(pool, null, slotTod);
      if (next) { setSkipId(next.id); setPick(next); setAnimKey((k) => k + 1); }
      else { setPick(null); setSkipId(null); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortlist.size]);

  // iOS 13+ requires DeviceMotionEvent.requestPermission() from a user gesture
  // before accelerometer values are non-null. We detect the need, ask on tap,
  // then re-register the listener once permission is granted.
  const needsMotionPermission =
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof (DeviceMotionEvent as { requestPermission?: unknown }).requestPermission === 'function';
  const [motionGranted, setMotionGranted] = useState(!needsMotionPermission);

  const requestMotionPermission = async () => {
    try {
      const result = await (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
      if (result === 'granted') setMotionGranted(true);
    } catch { /* user dismissed or browser blocked */ }
  };

  useEffect(() => {
    if (!motionGranted) return;
    let last = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
      if (mag > 20 && Date.now() - last > 1200) { last = Date.now(); spin(); }
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [spin, motionGranted]);

  const slotEmoji = { morning: '🌅', afternoon: '☀️', evening: '🌙' };

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 className="font-display" style={{ fontSize: 36, margin: '0 0 4px', color: 'var(--ink)' }}>Feeling spontaneous?</h2>
        <p style={{ fontStyle: 'italic', fontSize: 14, color: 'var(--sand-700)', margin: 0 }}>
          {pool.length > 0
            ? [
                starredPool.length > 0 && `${starredPool.length} shortlisted`,
                matchedPool.length > 0 && `${matchedPool.length} questionnaire match${matchedPool.length === 1 ? '' : 'es'}`,
              ].filter(Boolean).join(' + ') + ' — shake or tap to roll.'
            : tags.size > 0
              ? 'No matches found yet — try adding activities in Explore.'
              : 'Complete the questionnaire or add activities in Explore.'}
        </p>
        {needsMotionPermission && !motionGranted && (
          <button
            type="button"
            onClick={() => void requestMotionPermission()}
            style={{ marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--sand-500)', textDecoration: 'underline', padding: 0, fontFamily: 'inherit' }}
          >
            📱 Enable shake to roll
          </button>
        )}
        {motionGranted && (
          <p style={{ marginTop: 6, fontSize: 12, color: 'var(--sand-400)', fontStyle: 'italic' }}>
            📱 Shake your phone to roll a new pick
          </p>
        )}
      </div>

      {loading && <div style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading…</div>}

      {!loading && pool.length === 0 && (
        <div className="chunky" style={{ padding: '32px 28px', textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>🎲</div>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--ink)' }}>
            {tags.size > 0 ? 'Nothing matched yet.' : 'Nothing to roll yet.'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 20px' }}>
            {tags.size > 0
              ? 'Add activities in Explore to save them here, or they\'ll appear automatically once we load your matches.'
              : 'Complete the questionnaire and we\'ll suggest activities. You can also add things in Explore — we\'ll pick for you when you can\'t decide.'}
          </p>
          <button className="btn-red" onClick={() => setPage('explore')} style={{ padding: '11px 22px', fontSize: 14 }}>
            Browse Explore →
          </button>
        </div>
      )}

      {!loading && pick && (
        <div key={animKey} className="surprise-card fade-in" style={{ width: '100%', maxWidth: 500 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 8, textAlign: 'center' }}>
            {slotEmoji[slot]}{' '}
            {pick.kind === 'activity'
              ? `🎲 Fate says: ${(pick.activity.timeOfDay ?? slot).toLowerCase()} pick`
              : `🎲 Fate says: go do this`}
          </div>
          <div className="chunky" style={{ overflow: 'hidden', padding: 0, border: '2px solid var(--ink)' }}>
            <div style={{ position: 'relative', height: 220, overflow: 'hidden', background: 'var(--sand-100)' }}>
              <img
                src={pick.kind === 'activity' ? pick.activity.image : pick.item.image_url}
                alt={pick.kind === 'activity' ? pick.activity.title : pick.item.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {(pick.kind === 'activity' ? pick.activity.ratingSource === 'viator' : true)
                && hasRealRating(pick.kind === 'activity' ? pick.activity.rating : pick.item.rating,
                                 pick.kind === 'activity' ? pick.activity.reviewCount : pick.item.review_count) && (
                <span style={{ position: 'absolute', top: 12, right: 12, background: 'var(--ink)', color: 'var(--yellow)', padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <RatingChipInline size={11}
                    rating={pick.kind === 'activity' ? pick.activity.rating : pick.item.rating}
                    reviewCount={pick.kind === 'activity' ? pick.activity.reviewCount : pick.item.review_count} />
                </span>
              )}
            </div>
            <div style={{ padding: '18px 20px 20px' }}>
              {pick.kind === 'activity' && (
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 4 }}>{pick.activity.category}</div>
              )}
              <h3 className="font-display" style={{ fontSize: 24, lineHeight: 1.1, margin: '0 0 6px', color: 'var(--ink)' }}>
                {pick.kind === 'activity' ? pick.activity.title : pick.item.title}
              </h3>
              {pick.kind === 'activity' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sand-500)', fontSize: 12, marginBottom: 10 }}>
                  <MapPin size={12} /><span>{pick.activity.location}</span>
                </div>
              )}
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--sand-700)', margin: '0 0 14px' }}>
                {pick.kind === 'activity' ? pick.activity.description : pick.item.description}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px' }}>
                  <Clock size={11} /> {pick.kind === 'activity' ? pick.activity.duration : pick.item.duration}
                </span>
                <span className="chip-outline" style={{ fontSize: 11, padding: '3px 10px' }}>
                  <Dollar size={11} /> {pick.kind === 'activity' ? pick.activity.cost : `$${pick.item.price_usd}`}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {pick.book && (
                  <a href={pick.book.url} target="_blank" rel="noopener noreferrer"
                     style={{ flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '3px 3px 0 var(--ink)' }}>
                    Book now
                  </a>
                )}
                <AddButton added={shortlist.has(pick.id)} onAdd={() => toggleAdd(pick.id)} />
                <button onClick={spin} disabled={pool.length <= 1}
                  style={{ flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--yellow-bg)', color: 'var(--ink)', boxShadow: '3px 3px 0 var(--ink)', cursor: pool.length > 1 ? 'pointer' : 'not-allowed', opacity: pool.length > 1 ? 1 : 0.4 }}>
                  <Dice size={14} /> Nope, roll again
                </button>
              </div>
            </div>
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--sand-400)', marginTop: 12 }}>
            🤙 Shake your phone to roll the dice.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Shortlist cards ───────────── //

// No ♥ on these cards since 2026-08-05, when the heart was retired everywhere in
// favour of one control: "+ Add" / "Added", the same button Explore and Surprise
// use, writing the same shortlist store. On a card that is already shortlisted it
// reads "Added" and clicking it is how you take it back out.

function StarredActivityCard({ entry, added, onAdd }: { entry: ExploreEntry & { kind: 'activity' }; added: boolean; onAdd: () => void }) {
  const a = entry.activity;
  const book = bookUrlForEntry(entry);
  return (
    <div className="a-card fade-in">
      <div className="a-img">
        <img src={a.image} alt={a.title} />
        {a.ratingSource === 'viator' && <RatingChip rating={a.rating} reviewCount={a.reviewCount} size={10} />}
      </div>
      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 4 }}>{a.category}</div>
        <h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 4px', color: 'var(--ink)' }}>{a.title}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sand-500)', fontSize: 11, marginBottom: 8 }}>
          <MapPin size={11} /><span>{a.location}</span>
        </div>
        <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--sand-700)', margin: '0 0 12px', flex: 1 }}>
          {a.description.length > 110 ? a.description.slice(0, 107) + '…' : a.description}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Clock size={10} /> {a.duration}</span>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Dollar size={10} /> {a.cost}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {book ? (
            <a href={book.url} target="_blank" rel="noopener noreferrer"
               style={{ flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 10, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '2px 2px 0 var(--ink)' }}>
              Book now
            </a>
          ) : parseActivityCost(a.cost) === 0 ? (
            <span style={{ flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 700, textAlign: 'center', borderRadius: 10, border: '2px solid var(--ink)', background: '#A8F5B8', color: 'var(--ink)', boxShadow: '2px 2px 0 var(--ink)' }}>✓ Free</span>
          ) : null}
          <AddButton added={added} onAdd={onAdd} fill={!book && parseActivityCost(a.cost) !== 0} />
        </div>
      </div>
    </div>
  );
}

function StarredItemCard({ entry, added, onAdd }: { entry: ExploreEntry & { kind: 'item' }; added: boolean; onAdd: () => void }) {
  const { item } = entry;
  const book = bookUrlForEntry(entry);
  const sec  = sectionLabel(primarySection(entry.sections));
  return (
    <div className="a-card fade-in">
      <div className="a-img">
        <img src={item.image_url} alt={item.title} />
        <RatingChip rating={item.rating} reviewCount={item.review_count} size={10} />
      </div>
      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 4 }}>{sec}</div>
        <h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 8px', color: 'var(--ink)' }}>{item.title}</h3>
        <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--sand-700)', margin: '0 0 12px', flex: 1 }}>
          {(item.description ?? '').length > 110 ? (item.description ?? '').slice(0, 107) + '…' : (item.description ?? '')}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Clock size={10} /> {item.duration}</span>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Dollar size={10} /> ${item.price_usd}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {book ? (
            <a href={book.url} target="_blank" rel="noopener noreferrer"
               style={{ flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 10, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '2px 2px 0 var(--ink)' }}>
              Book now
            </a>
          ) : item.price_usd === 0 ? (
            <span style={{ flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 700, textAlign: 'center', borderRadius: 10, border: '2px solid var(--ink)', background: '#A8F5B8', color: 'var(--ink)', boxShadow: '2px 2px 0 var(--ink)' }}>✓ Free</span>
          ) : null}
          <AddButton added={added} onAdd={onAdd} fill={!book && item.price_usd !== 0} />
        </div>
      </div>
    </div>
  );
}

// ──���──────────────────────────────────────────── Starred panel ───────��───── //

function StarredPanel({ setPage }: { setPage: (p: PageId) => void }) {
  const { catalog, loading } = useCatalog();
  const { shortlist, toggle: toggleAdd } = useShortlist();
  const [vibe,  setVibe]  = useState(50);
  const [price, setPrice] = useState(50);

  const allEntries = useMemo(
    () => filterExploreEntries(catalog, { section: 'All', search: '', vibe, price }),
    [catalog, vibe, price],
  );

  const entries = useMemo(
    () => allEntries.filter((e) =>
      e.kind === 'item' ? shortlist.has(`item:${e.item.id}`) : shortlist.has(e.activity.id)
    ),
    [allEntries, shortlist],
  );

  if (!loading && shortlist.size === 0) {
    return (
      <div>
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Shortlisted Activities</h2>
        <div className="chunky" style={{ padding: '32px 28px', textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>＋</div>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--ink)' }}>Nothing shortlisted yet.</p>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 20px' }}>
            Tap “+ Add” on any activity in Explore to save it here.
          </p>
          <button className="btn-red" onClick={() => setPage('explore')} style={{ padding: '11px 22px', fontSize: 14 }}>
            Browse Explore →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Shortlisted Activities</h2>
      <div className="dash-filter-row">
        <Slider label="Vibe" value={vibe} onChange={setVibe} lo={<ChillEnd />} hi={<AdrenalineEnd />} hint={vibeHint(vibe)} />
        <Slider label="Price" value={price} onChange={setPrice} lo={<FreeEnd />} hi={<SplurgeEnd />} hint={priceHint(price)} />
      </div>
      {loading ? (
        <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading…</p>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--sand-500)' }}>
          <p className="font-display" style={{ fontSize: 20, margin: 0 }}>No matches</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>Try recentring the filters.</p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 16px' }}>
            <strong style={{ color: 'var(--ink)' }}>{entries.length}</strong> shortlisted activit{entries.length === 1 ? 'y' : 'ies'}
          </p>
          <div className="explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}>
            {entries.map((e) =>
              e.kind === 'item'
                ? <StarredItemCard     key={`item:${e.item.id}`} entry={e} added onAdd={() => toggleAdd(`item:${e.item.id}`)} />
                : <StarredActivityCard key={e.activity.id}       entry={e} added onAdd={() => toggleAdd(e.activity.id)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────── Personalized activities panel ────────── //

// Exported for Dashboard.personalized.dom.test.tsx — the search box it draws is
// shared with Explore, and a render is the only thing that can tell you it is
// actually filtering rather than merely present.
export function PersonalizedPanel({ setPage, trip }: { setPage: (p: PageId) => void; trip: TripLoadState }) {
  const { catalog, loading } = useCatalog();
  const { shortlist, toggle: toggleAdd } = useShortlist();
  const [vibe,  setVibe]  = useState(50);
  const [price, setPrice] = useState(50);
  // The same box Explore draws — substring hits, search-by-meaning and the
  // contraindications a traveller types — from one implementation, so the two
  // surfaces cannot drift apart.
  const box = useSearchBox();
  const search = box.query;

  const tags = useMemo(
    () => (trip && trip !== 'loading') ? answersToTags(trip.answers) : new Set<MatchTag>(),
    [trip],
  );

  // Build matched id sets across all slots, then post-filter all ExploreEntries.
  const result = useMemo(() => {
    if (loading || !tags.size) return { entries: [] as ExploreEntry[], addedByMeaning: 0 };
    const matchedGroupIds = new Set<string>();
    for (const slot of ['morning', 'afternoon', 'evening'] as const) {
      // Groups only — the local picks are matched below. matchPool still wants
      // an activities argument, so it gets an empty one.
      const { groups: mg } = matchPool([], catalog.groups, tags, slot);
      mg.forEach((g) => matchedGroupIds.add(g.id));
    }
    // Local picks are matched here rather than through matchPool. Every pick
    // ships `matched_by: []`, which the matcher treats as a wildcard, so
    // matchPool handed back all 26 of them to every profile — the panel said
    // "matched to your profile" over a list that ignored the profile entirely.
    // activityTags derives real tags from each pick's section and adventure
    // score, leaving the generator's wildcard alone. Slot is not a filter here:
    // this panel is for browsing, not for filling a morning.
    const matchedActIds = new Set(
      catalog.activities
        .filter((a) => activityTags(a).some((t) => tags.has(t)))
        .map((a) => a.id),
    );
    const inProfile = (e: ExploreEntry) => e.kind === 'item'
      ? matchedGroupIds.has(e.item.group_id)
      : matchedActIds.has(e.activity.id);

    const hits = filterExploreEntries(catalog, { section: 'All', search, vibe, price }).filter(inProfile);
    // The pool semantic ids resolve against is the PROFILE-MATCHED one, not the
    // whole catalog: this panel's own heading says everything below it matches
    // your profile, and search-by-meaning must not make that false. Explore,
    // which promises nothing of the kind, passes its full filtered catalog.
    return searchEntries(
      search,
      hits,
      () => filterExploreEntries(catalog, { section: 'All', search: '', vibe, price }).filter(inProfile),
      box.semantic,
    );
  }, [catalog, tags, loading, vibe, price, search, box.semantic]);
  const { entries, addedByMeaning } = result;

  if (!trip || trip === 'loading') {
    return (
      <div>
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Personalized for you</h2>
        <div className="chunky" style={{ padding: '32px 28px', textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>🎯</div>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--ink)' }}>Complete the questionnaire first.</p>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 20px' }}>
            We'll match activities to your vibe, budget, and group — no scrolling required.
          </p>
          <button className="btn-red" onClick={() => setPage('questionnaire')} style={{ padding: '11px 22px', fontSize: 14 }}>
            Take the questionnaire →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 6px', color: 'var(--ink)' }}>Personalized for you</h2>
      <p style={{ fontSize: 13, color: 'var(--sand-700)', fontStyle: 'italic', margin: '0 0 24px' }}>
        Based on your questionnaire — {trip.answers.days} days, {trip.answers.groupType || 'your group'}, {trip.answers.budget || 'any budget'}.
      </p>
      <SearchBar box={box} addedByMeaning={addedByMeaning} placeholder="Search your matches…" style={{ margin: '0 0 18px' }} />
      <div className="dash-filter-row">
        <Slider label="Vibe"  value={vibe}  onChange={setVibe}  lo={<ChillEnd />} hi={<AdrenalineEnd />} hint={vibeHint(vibe)} />
        <Slider label="Price" value={price} onChange={setPrice} lo={<FreeEnd />}  hi={<SplurgeEnd />}    hint={priceHint(price)} />
      </div>
      {loading ? (
        <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>
          {search.trim()
            ? (box.answered && addedByMeaning === 0
              ? 'We looked for what you meant as well as what you typed, and found nothing among your matches. Try clearing the search or recentering the sliders.'
              : 'Nothing among your matches for that search — try clearing it or recentering the sliders.')
            : 'No matches found — try adjusting the sliders or updating your questionnaire answers.'}
        </p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 16px' }}>
            <strong style={{ color: 'var(--ink)' }}>{entries.length}</strong> activit{entries.length === 1 ? 'y' : 'ies'} matched to your profile{search.trim() ? ' and your search' : ''}
          </p>
          <div className="explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}>
            {entries.map((e) =>
              e.kind === 'item'
                ? <StarredItemCard     key={`item:${e.item.id}`} entry={e} added={shortlist.has(`item:${e.item.id}`)} onAdd={() => toggleAdd(`item:${e.item.id}`)} />
                : <StarredActivityCard key={e.activity.id}       entry={e} added={shortlist.has(e.activity.id)}       onAdd={() => toggleAdd(e.activity.id)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─────��───────────────────────────────── Itinerary panel helpers ─────────── //

const SLOT_LABEL: Record<Slot, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

function entryTitle(e: CardEntry): string {
  return e.kind === 'activity' ? e.activity.title : e.bestSeller.title;
}
function entryDuration(e: CardEntry): string {
  return e.kind === 'activity' ? e.activity.duration : e.bestSeller.duration;
}
function entryCost(e: CardEntry): string {
  return e.kind === 'activity' ? e.activity.cost : `$${e.bestSeller.price_usd}`;
}

function BookedRow({
  card, slot, resolveEntry, booked, onToggle,
}: {
  card: PlannedCard;
  slot: Slot;
  resolveEntry: (e: SlotEntry, slot?: Slot) => CardEntry | null;
  booked: Set<string>;
  onToggle: (uid: string) => void;
}) {
  const entry = useMemo(() => resolveEntry(card.entry, slot), [card.entry, slot, resolveEntry]);
  if (!entry) return null;
  const isBooked = booked.has(card.uid);
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--sand-100)' }}
    >
      <button
        onClick={() => onToggle(card.uid)}
        aria-label={isBooked ? 'Mark as unbooked' : 'Mark as booked'}
        style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: '2px solid var(--ink)', background: isBooked ? 'var(--green)' : 'transparent', color: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        {isBooked && <Check size={12} sw={3} />}
      </button>
      <span style={{ flex: 1, fontSize: 14, fontWeight: isBooked ? 700 : 400, color: isBooked ? 'var(--ink)' : 'var(--sand-700)', textDecoration: isBooked ? 'none' : 'none' }}>
        {entryTitle(entry)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--sand-500)', flexShrink: 0 }}>{entryDuration(entry)}</span>
      <span style={{ fontSize: 11, color: 'var(--sand-500)', flexShrink: 0 }}>{entryCost(entry)}</span>
    </div>
  );
}

// ────────────────────────────────────────────── Itinerary panel ──────────── //

// The two unbuilt variants. The traveller's real itineraries are no longer a
// row in here — an account can hold any number of them now, so they are listed
// from the database and these are appended after.
const ITINERARY_VARIANTS: { id: string; label: string; description: string; available: boolean }[] = [
  { id: 'adventure', label: 'Adventure-leaning',  description: 'Adrenaline-first, beaches second', available: false },
  { id: 'chill',     label: 'Chill-leaning',      description: 'Slow mornings, easy afternoons',   available: false },
];

export function ItineraryPanel({
  setPage, trips, onLogin, onOpenTrip, onDeleteTrip, activeTripId,
}: {
  setPage: (p: PageId) => void;
  trips: SavedTrip[] | 'loading';
  onLogin: () => void;
  onOpenTrip: (id: string) => void;
  onDeleteTrip: (id: string) => void;
  activeTripId: string | null;
}) {
  const { user, loading: authLoading } = useAuth();
  const { catalog } = useCatalog();
  const { booked, toggle: toggleBooked } = useBooked();
  const [expanded,     setExpanded]     = useState<string | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<number>>(new Set());
  const [exportOpen,   setExportOpen]   = useState<string | null>(null);
  const [shareOpen,    setShareOpen]    = useState<string | null>(null);
  const [emailOpen,    setEmailOpen]    = useState(false);
  // Which itinerary a delete is being confirmed for. Same single-modal-many-rows
  // shape as the email dialog: the row travels with the state, so the card can
  // name the trip it is about to destroy and can never act on a different one.
  const [confirmDelete, setConfirmDelete] = useState<SavedTrip | null>(null);
  // Which itinerary the email dialog is about. The dialog is a single modal
  // shared by every row, so it has to carry the row it was opened from.
  const [emailTrip,    setEmailTrip]    = useState<SavedTrip | null>(null);

  // A resolver per itinerary, not one for the panel: each saved trip carries its
  // own answers, and the answers are what decide which items a card may show.
  // Sharing one resolver across rows would render trip B's cards through trip
  // A's budget and interests.
  const resolverFor = useCallback(
    (t: TripState) => {
      const tags = answersToTags(t.answers);
      return (slotEntry: SlotEntry, slot?: Slot): CardEntry | null =>
        resolveSlotEntry(slotEntry, catalog, tags as never, slot);
    },
    [catalog],
  );

  const toggleDay = (day: number) => setCollapsedDays((prev) => {
    const next = new Set(prev);
    next.has(day) ? next.delete(day) : next.add(day);
    return next;
  });

  const handleIcsExport = (t: SavedTrip) => {
    const ics = buildIcs(t.plan, t.answers, resolverFor(t), booked);
    downloadIcs(ics);
    setExportOpen(null);
  };

  const handlePdfExport = () => {
    window.print();
    setExportOpen(null);
  };


  if (authLoading) return <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading…</p>;

  if (!user) {
    return (
      <div>
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Itineraries</h2>
        <div className="chunky" style={{ padding: '32px 28px', textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>🗓</div>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--ink)' }}>Sign in to save your trips.</p>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 20px' }}>
            Log in to save, revisit, and export your personalised Aruba itinerary.
          </p>
          <button className="btn-red" onClick={onLogin} style={{ padding: '11px 22px', fontSize: 14 }}>Log in</button>
        </div>
      </div>
    );
  }

  if (trips === 'loading') {
    return (
      <div>
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Itineraries</h2>
        <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading your trips…</p>
      </div>
    );
  }

  // One row per saved itinerary, newest first, then the two unbuilt variants.
  // When nothing is saved yet a single placeholder row stands in, so the panel
  // still offers the way in to the questionnaire.
  type Row = { id: string; label: string; description: string; available: boolean; trip: SavedTrip | null };
  const savedRows: Row[] = trips.map((t) => ({
    id: t.id,
    label: tripLabel(t),
    description: '',
    available: true,
    trip: t,
  }));
  const rows: Row[] = [
    ...(savedRows.length ? savedRows : [{ id: 'saved', label: 'Your trip', description: 'Your personalised itinerary', available: true, trip: null }]),
    ...ITINERARY_VARIANTS.map((v) => ({ ...v, trip: null })),
  ];

  return (
    <div>
      <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Itineraries</h2>
      {savedRows.length > 1 && (
        <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '-10px 0 16px' }}>
          {savedRows.length} saved itineraries — “Open” loads one into the planner.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((variant) => {
          const rowTrip = variant.trip;
          const isExpanded = expanded === variant.id;
          const hasTrip    = !!rowTrip;
          const isLocked   = !variant.available;
          const totalActivities = rowTrip
            ? rowTrip.plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]).length
            : 0;
          const bookedCount = rowTrip
            ? rowTrip.plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]).filter((c) => booked.has(c.uid)).length
            : 0;

          return (
            <div key={variant.id} className="chunky" style={{ padding: 0, opacity: isLocked ? 0.55 : 1 }}>
              {/* Collapsed header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px' }}>
                {/* Expand/collapse button — fills remaining space */}
                <button
                  onClick={() => {
                    if (isLocked) return;
                    if (!hasTrip) { setPage('questionnaire'); return; }
                    setExpanded(isExpanded ? null : variant.id);
                    setExportOpen(null);
                    setShareOpen(null);
                  }}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', cursor: isLocked ? 'default' : 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0, padding: 0 }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {variant.label}
                      {rowTrip && rowTrip.id === activeTripId && (
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'var(--yellow)', border: '1.5px solid var(--ink)', borderRadius: 6, padding: '2px 7px', boxShadow: '1px 1px 0 var(--ink)' }}>Active</span>
                      )}
                      {isLocked && (
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-400)', border: '1.5px solid var(--sand-200)', borderRadius: 6, padding: '2px 7px' }}>Coming soon</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--sand-500)', marginTop: 2 }}>
                      {rowTrip
                        ? `${rowTrip.answers.days} days · ${totalActivities} activities${bookedCount > 0 ? ` · ${bookedCount} confirmed` : ''}`
                        : variant.description}
                    </div>
                  </div>
                  {!isLocked && (
                    <span style={{ color: 'var(--sand-400)', flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      <Chev size={18} />
                    </span>
                  )}
                </button>

                {/* Export + Share icons — one set per saved itinerary; the row
                    carries its own trip, so a menu can never act on another row. */}
                {!isLocked && (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {/* Edit — sits immediately after the arrow that expands the
                        row, so the order reads: look inside, or go work on it.
                        Opens THIS itinerary, never whichever was last touched. */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!hasTrip) { setPage('questionnaire'); return; }
                        onOpenTrip(rowTrip.id);
                        setPage('itinerary');
                      }}
                      title={hasTrip ? 'Edit itinerary' : 'Build your itinerary first'}
                      aria-label="Edit itinerary"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, border: '1.5px solid var(--sand-200)', background: 'transparent', color: hasTrip ? 'var(--sand-600)' : 'var(--sand-300)', cursor: 'pointer' }}
                    >
                      <Pencil size={15} />
                    </button>

                    {/* Export dropdown */}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!hasTrip) { setPage('questionnaire'); return; }
                          setExportOpen(exportOpen === variant.id ? null : variant.id);
                          setShareOpen(null);
                        }}
                        title={hasTrip ? 'Export itinerary' : 'Build your itinerary first'}
                        aria-label="Export itinerary"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, border: '1.5px solid var(--sand-200)', background: exportOpen === variant.id ? 'var(--sand-100)' : 'transparent', color: hasTrip ? 'var(--sand-600)' : 'var(--sand-300)', cursor: 'pointer' }}
                      >
                        <Download size={15} />
                      </button>
                      {exportOpen === variant.id && (
                        <div className="chunky" style={{ position: 'absolute', ...(isExpanded ? { top: 'calc(100% + 6px)' } : { bottom: 'calc(100% + 6px)' }), right: 0, padding: '6px 0', minWidth: 190, zIndex: 20, background: 'var(--cream)' }}>
                          <button onClick={() => rowTrip && handleIcsExport(rowTrip)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--ink)', textAlign: 'left' }}>
                            <Calendar size={14} /><span>.ics — Calendar</span>
                          </button>
                          <button onClick={handlePdfExport}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--ink)', textAlign: 'left' }}>
                            <Doc size={14} /><span>.pdf — Email / Print</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Share dropdown */}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!hasTrip) { setPage('questionnaire'); return; }
                          setShareOpen(shareOpen === variant.id ? null : variant.id);
                          setExportOpen(null);
                        }}
                        title={hasTrip ? 'Share itinerary' : 'Build your itinerary first'}
                        aria-label="Share itinerary"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, border: '1.5px solid var(--sand-200)', background: shareOpen === variant.id ? 'var(--sand-100)' : 'transparent', color: hasTrip ? 'var(--sand-600)' : 'var(--sand-300)', cursor: 'pointer' }}
                      >
                        <IOSShare size={15} />
                      </button>
                      {shareOpen === variant.id && (
                        <div className="chunky" style={{ position: 'absolute', ...(isExpanded ? { top: 'calc(100% + 6px)' } : { bottom: 'calc(100% + 6px)' }), right: 0, padding: '6px 0', minWidth: 190, zIndex: 20, background: 'var(--cream)' }}>
                          <button
                            onClick={() => { setShareOpen(null); setEmailTrip(rowTrip); setEmailOpen(true); }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--ink)', textAlign: 'left' }}>
                            <Mail size={14} /><span>Share via email</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Delete — last, furthest from the arrow, because it is the
                        one action here that cannot be undone. Confirms in a
                        branded card rather than `window.confirm`, which the
                        browser renders as a system dialog with our itinerary's
                        name in it and no way to style the warning. */}
                    <button
                      onClick={(e) => { e.stopPropagation(); if (rowTrip) setConfirmDelete(rowTrip); }}
                      disabled={!hasTrip}
                      title={hasTrip ? 'Delete itinerary' : 'Nothing saved to delete'}
                      aria-label="Delete itinerary"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, border: '1.5px solid var(--sand-200)', background: 'transparent', color: hasTrip ? 'var(--sand-600)' : 'var(--sand-300)', cursor: hasTrip ? 'pointer' : 'not-allowed' }}
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                )}
              </div>

              {/* Expanded content — full Itinerary-page style, days collapsible */}
              {isExpanded && rowTrip && (
                <div style={{ borderTop: '2px solid var(--sand-100)' }}>
                  {/* Day list */}
                  <div style={{ padding: '24px 28px 8px' }}>
                    {rowTrip.plan.map((day, i) => {
                      const isLast      = i === rowTrip.plan.length - 1;
                      const isDayCollapsed = collapsedDays.has(day.day);
                      const slots: { slot: Slot; cards: PlannedCard[] }[] = (
                        [
                          { slot: 'morning'   as Slot, cards: day.morning },
                          { slot: 'afternoon' as Slot, cards: day.afternoon },
                          { slot: 'evening'   as Slot, cards: day.evening },
                        ] as { slot: Slot; cards: PlannedCard[] }[]
                      ).filter((s) => s.cards.length > 0);

                      return (
                        <div key={day.day} className="itin-day-wrapper" style={{ position: 'relative', paddingLeft: 64, paddingBottom: isLast ? 16 : 40 }}>
                          {!isLast && <div className="timeline-rail" />}
                          <div className="day-badge" style={{ position: 'absolute', left: 0, top: 4, background: day.color, width: 44, height: 44, fontSize: 18 }}>{day.day}</div>

                          {/* Day header with collapse toggle */}
                          <div className="itin-day-head">
                            <h2 className="font-display" style={{ fontSize: 26, lineHeight: 1, margin: 0, color: 'var(--ink)' }}>
                              Day {day.day}
                              {day.title && <><span style={{ color: 'var(--sand-500)', fontSize: 20, margin: '0 6px' }}>—</span><span className="itin-day-title">{day.title}</span></>}
                            </h2>
                            <button
                              type="button"
                              className="itin-day-collapse"
                              onClick={() => toggleDay(day.day)}
                              aria-expanded={!isDayCollapsed}
                              aria-label={isDayCollapsed ? `Expand day ${day.day}` : `Collapse day ${day.day}`}
                            >
                              <span className={`itin-day-chev${isDayCollapsed ? ' collapsed' : ''}`}><Chev size={20} sw={2.5} /></span>
                            </button>
                          </div>

                          {/* Collapsed summary — the same component the Itinerary
                              page folds a day into, so the two surfaces agree. It
                              used to be a hand-rolled "N activities · tap to
                              expand" button whose CSS class was deleted when that
                              component landed, leaving it unstyled here. */}
                          {isDayCollapsed ? (
                            <CollapsedDaySummary
                              dayNum={day.day}
                              onExpand={() => toggleDay(day.day)}
                              activities={slots.flatMap(({ slot, cards }) => cards.flatMap((card) => {
                                const entry = resolverFor(rowTrip)(card.entry, slot);
                                if (!entry) return [];
                                return [{
                                  key: card.uid,
                                  title: entry.kind === 'activity' ? entry.activity.title : entry.bestSeller.title,
                                  image: entry.kind === 'activity' ? entry.activity.image : entry.bestSeller.image_url,
                                }];
                              }))}
                            />
                          ) : (
                            /* Full card view per slot */
                            slots.map(({ slot, cards }) => (
                              <div key={slot} style={{ marginBottom: 16 }}>
                                <div className="itin-section-label">{SLOT_LABEL[slot]}</div>
                                {cards.map((card) => {
                                  const entry = resolverFor(rowTrip)(card.entry, slot);
                                  if (!entry) return null;
                                  return (
                                    <div key={card.uid} style={{ marginBottom: 16 }}>
                                      <ItineraryCard
                                        entry={entry}
                                        flipped={false}
                                        swapping={false}
                                        onFlip={() => {}}
                                      />
                                      <button
                                        type="button"
                                        className={`itin-booked-btn${booked.has(card.uid) ? ' booked' : ''}`}
                                        onClick={() => toggleBooked(card.uid)}
                                      >
                                        {booked.has(card.uid) ? '✓ Booked' : '○ Mark as booked'}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Action row */}
                  <div style={{ display: 'flex', gap: 10, padding: '16px 28px 20px', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--sand-100)' }}>
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setExportOpen(exportOpen === variant.id ? null : variant.id)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', borderRadius: 10, border: '2px solid var(--ink)', background: 'var(--cream)', color: 'var(--ink)', boxShadow: '2px 2px 0 var(--ink)', cursor: 'pointer' }}
                      >
                        <Calendar size={13} /> Export
                        <span style={{ marginLeft: 2, transform: exportOpen === variant.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', display: 'inline-flex' }}>
                          <Chev size={12} />
                        </span>
                      </button>
                      {exportOpen === variant.id && (
                        <div className="chunky" style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, padding: '6px 0', minWidth: 190, zIndex: 10, background: 'var(--cream)' }}>
                          <button onClick={() => rowTrip && handleIcsExport(rowTrip)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--ink)', textAlign: 'left' }}>
                            <Calendar size={14} /><span>.ics — Calendar</span>
                          </button>
                          <button onClick={handlePdfExport}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--ink)', textAlign: 'left' }}>
                            <Doc size={14} /><span>.pdf — Email / Print</span>
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Opens THIS itinerary, not whichever was last touched —
                        the whole point of holding more than one. */}
                    <button
                      className="btn-red"
                      onClick={() => { onOpenTrip(rowTrip.id); setPage('itinerary'); }}
                      style={{ padding: '9px 14px', fontSize: 13 }}
                    >
                      {rowTrip.id === activeTripId ? 'Edit itinerary →' : 'Open in planner →'}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(rowTrip)}
                      style={{ padding: '9px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', borderRadius: 10, border: '2px solid var(--sand-200)', background: 'transparent', color: 'var(--sand-600)', cursor: 'pointer' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}

              {/* No trip yet — prompt */}
              {isExpanded && variant.id === 'saved' && !rowTrip && (
                <div style={{ borderTop: '2px solid var(--sand-100)', padding: '20px' }}>
                  <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 14px' }}>Complete the questionnaire to generate your personalised itinerary.</p>
                  <button className="btn-red" onClick={() => setPage('questionnaire')} style={{ padding: '9px 14px', fontSize: 13 }}>
                    Build my itinerary →
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Delete confirmation — the same centred card as the sign-in and
          "Logged in ✓" windows, so a destructive prompt looks like it belongs to
          this app rather than to the browser. Backdrop clicks, ✕ and Cancel all
          back out — matching LoginModal, which has no Escape handler either —
          and only the red button deletes. */}
      {confirmDelete && (
        <div
          className="login-modal-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}
        >
          <div className="login-modal-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="login-modal-close" onClick={() => setConfirmDelete(null)} aria-label="Close">✕</button>
            <h2 id="confirm-delete-title" className="font-display" style={{ fontSize: 26, margin: '0 0 6px', color: 'var(--ink)' }}>Are you sure you want to delete?</h2>
            <p style={{ fontStyle: 'italic', fontSize: 14, color: 'rgba(0,0,0,0.65)', margin: '0 0 20px' }}>
              “{tripLabel(confirmDelete)}” will be permanently deleted. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn-red"
                onClick={() => { onDeleteTrip(confirmDelete.id); setConfirmDelete(null); }}
                style={{ flex: 1, padding: '12px 16px', fontSize: 15 }}
              >
                Delete itinerary
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                style={{ padding: '12px 18px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', borderRadius: 10, border: '2px solid var(--sand-200)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share via email — the same dialog the Itinerary page opens, so the
          two surfaces cannot drift apart. It carries the row it was opened
          from; `emailTrip` is that row, not whichever trip is active. */}
      {emailOpen && emailTrip && (
        <ShareEmailModal trip={emailTrip} onClose={() => { setEmailOpen(false); setEmailTrip(null); }} />
      )}
    </div>
  );
}

// ──────────��─────────────────────────────────── Practical panel ──────────── //

function PracticalPanel() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 6px', color: 'var(--ink)' }}>Practical Info</h2>
      <p style={{ fontStyle: 'italic', fontSize: 14, color: 'var(--sand-700)', margin: '0 0 28px' }}>
        Everything you need to know before and during your trip.
      </p>

      <div style={{ marginBottom: 48 }}>
        {INFO_TOPICS.map((topic) => (
          <div key={topic.title} className="chunky" style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
            <button
              onClick={() => setOpen(open === topic.title ? null : topic.title)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 700, fontSize: 15, textAlign: 'left', color: 'var(--ink)' }}>
              <span>{topic.title}</span>
              <span style={{ fontSize: 18, lineHeight: 1, color: 'var(--sand-500)', transform: open === topic.title ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>›</span>
            </button>
            {open === topic.title && (
              <ul style={{ margin: 0, padding: '0 20px 18px 36px', listStyle: 'disc' }}>
                {topic.body.map((line, i) => (
                  <li key={i} style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--sand-700)', marginBottom: 4 }}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <h3 className="font-display" style={{ fontSize: 24, margin: '0 0 8px', color: 'var(--ink)' }}>Good-to-knows</h3>
      <p style={{ fontStyle: 'italic', fontSize: 13, color: 'var(--sand-700)', margin: '0 0 20px' }}>
        The little things locals wish every visitor knew — scroll to move through the trip.
      </p>
      {/* Same timeline the landing page shows, on this panel's cream instead of
          the landing section's yellow — the sticky phase headers pin against
          whatever surface they're told. */}
      <GoodToKnowTimeline surface="var(--cream)" />
    </div>
  );
}

// ─────────────���────────────────────────────────────── Dashboard ──────────── //

export default function Dashboard({ setPage, initialSection = 'starred', onLogin, answers }: Props) {
  const [section, setSection] = useState<DashSection>(initialSection);
  const [activitiesTab, setActivitiesTab] = useState<'shortlisted' | 'personalized'>('shortlisted');
  const [activitiesOpen, setActivitiesOpen] = useState(initialSection === 'starred');
  const { user, loading: authLoading } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 720,
  );

  // Every saved itinerary, loaded once at the Dashboard level. The Personalized
  // panel only needs one — it reads the answers to match on — so it gets the
  // most recently touched, which is the first of the list.
  const [trips, setTrips] = useState<SavedTrip[] | 'loading'>('loading');
  const [activeTripId, setActiveTripId] = useState<string | null>(() => readActiveTripId());
  useEffect(() => {
    if (authLoading) return;
    if (!user) { setTrips([]); return; }
    listTrips(user.id).then(setTrips);
  }, [user, authLoading]);

  const openTrip = (id: string) => {
    setActiveTripId(id);
    writeActiveTripId(id);
  };

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const removeTrip = async (id: string) => {
    if (!user) return;
    setDeleteError(null);
    const { error } = await deleteTrip(user.id, id);
    // The traveller confirmed a destructive prompt; if the row is still there
    // they need to be told, not left watching it not disappear.
    if (error) { setDeleteError('Could not delete that itinerary. Please try again.'); return; }
    const left = await listTrips(user.id);
    setTrips(left);
    // The planner must not be left pointing at a row that no longer exists.
    if (activeTripId === id) {
      const next = left[0]?.id ?? null;
      setActiveTripId(next);
      writeActiveTripId(next);
    }
  };

  // The trip the OTHER panels read (Personalized matches on its answers). It has
  // to be the one the planner has open, or the Itineraries list badges one trip
  // "Active" while Personalized quietly matches against a different one.
  const trip: TripLoadState = trips === 'loading'
    ? 'loading'
    : (trips.find((t) => t.id === activeTripId) ?? trips[0] ?? null);

  return (
    <>
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280" style={{ padding: '28px 36px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>
            {user ? `Hi, ${user.email?.split('@')[0]}` : 'My Aruba'}
          </div>
          <h1 className="font-display" style={{ fontSize: 40, margin: 0, color: 'var(--ink)', lineHeight: 1 }}>My Aruba</h1>
        </div>
      </div>

      <div className="bleed" style={{ background: 'var(--cream)' }}>
        <div className="container-1280 dashboard-layout">

          <nav
            className={`dashboard-sidebar${sidebarCollapsed ? ' dashboard-sidebar--collapsed' : ''}`}
            aria-label="Dashboard sections"
          >
            {/* Collapse / expand toggle on the right border */}
            <button
              className="dashboard-collapse-btn"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Chev size={14} sw={2.5} style={{ transform: sidebarCollapsed ? 'rotate(-90deg)' : 'rotate(90deg)', display: 'block' }} />
            </button>

            {SECTIONS.map((s) => (
              <div key={s.id}>
                <button
                  className={`dashboard-nav-btn${section === s.id ? ' active' : ''}`}
                  title={sidebarCollapsed ? s.label : undefined}
                  onClick={() => {
                    if (s.id === 'starred') {
                      setSection('starred');
                      setActivitiesOpen((o) => section === 'starred' ? !o : true);
                    } else {
                      setSection(s.id);
                    }
                  }}
                >
                  <span className="dashboard-nav-emoji"><s.NavIcon size={16} /></span>
                  <span className="dashboard-nav-label">{s.label}</span>
                  {s.id === 'starred' && !sidebarCollapsed && (
                    <span style={{ marginLeft: 'auto', color: 'var(--sand-400)', display: 'inline-flex', transform: activitiesOpen && section === 'starred' ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      <Chev size={13} sw={2.5} />
                    </span>
                  )}
                </button>

                {/* Activities sub-nav */}
                {s.id === 'starred' && activitiesOpen && section === 'starred' && !sidebarCollapsed && (
                  <div className="dashboard-nav-sub">
                    {(['shortlisted', 'personalized'] as const).map((tab) => (
                      <button
                        key={tab}
                        className={`dashboard-nav-sub-btn${activitiesTab === tab ? ' active' : ''}`}
                        onClick={() => setActivitiesTab(tab)}
                      >
                        {tab === 'shortlisted' ? 'Shortlisted' : 'Personalized'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>

          <div className="dashboard-content">
            {section === 'surprise'  && <SurprisePanel      setPage={setPage} trip={trip} answers={answers} />}
            {section === 'starred'   && activitiesTab === 'shortlisted'  && <StarredPanel       setPage={setPage} />}
            {section === 'starred'   && activitiesTab === 'personalized' && <PersonalizedPanel  setPage={setPage} trip={trip} />}
            {section === 'itinerary' && (
              <>
                {deleteError && (
                  <div role="alert" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, border: '2px solid var(--ink)', background: 'var(--red)', color: '#fff', fontSize: 13, fontWeight: 600 }}>
                    {deleteError}
                  </div>
                )}
                <ItineraryPanel setPage={setPage} trips={trips} onLogin={onLogin} onOpenTrip={openTrip} onDeleteTrip={removeTrip} activeTripId={activeTripId} />
              </>
            )}
            {section === 'practical' && <PracticalPanel />}
          </div>
        </div>
      </div>

      <Footer setPage={setPage} />
    </>
  );
}
