import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Footer from '../components/Footer';
import ItineraryCard from '../components/ItineraryCard';
import { iconFor, Calendar, Check, Chev, Clock, Dice, Doc, Dollar, Download, Heart, Info, IOSShare, Mail, MapPin, Star } from '../components/Icons';
import { useCatalog } from '../data/useCatalog';
import { filterExploreEntries, bookingUrl } from '../data/exploreItems';
import { INFO_TOPICS, GTK_CARDS } from '../data/activities';
import { answersToTags } from '../data/answerTags';
import { resolveSlotEntry } from '../data/activitySource';
import { buildIcs, downloadIcs } from '../lib/icsExport';
import { useStarred } from '../lib/starred';
import { useBooked } from '../lib/booked';
import { useAuth } from '../lib/auth';
import { loadTrip } from '../lib/trips';
import { matchPool, parseActivityCost } from '../data/matcher';
import { viatorLink, productUrlFor, sectionLabel, primarySection } from '../data/exploreItems';
import type { PageId } from '../App';
import type { Activity } from '../data/activities';
import type { ViatorGroup, ViatorItem } from '../types';
import type { Catalog } from '../data/activitySource';
import type { TripState } from '../lib/trips';
import type { ExploreEntry } from '../data/exploreItems';
import type { PlannedDay, PlannedCard } from '../data/itineraryPlan';
import type { Slot, SlotEntry, CardEntry, MatchTag } from '../types';

// ─────────────────────────────────────────────────────────── types ──────── //

type DashSection = 'surprise' | 'starred' | 'itinerary' | 'bookings' | 'practical';

type IconFC = (p: { size?: number }) => JSX.Element;
const SECTIONS: { id: DashSection; label: string; NavIcon: IconFC }[] = [
  { id: 'starred',    label: 'Activities',             NavIcon: Heart    },
  { id: 'itinerary',  label: 'Itineraries',           NavIcon: Calendar },
  { id: 'bookings',   label: 'Bookings',              NavIcon: Check    },
  { id: 'surprise',   label: 'Surprise me',           NavIcon: Dice     },
  { id: 'practical',  label: 'Practical Info',        NavIcon: Info     },
];

type TripLoadState = TripState | null | 'loading';

type Props = {
  setPage:         (p: PageId) => void;
  initialSection?: DashSection;
  onLogin:         () => void;
};

// ─────────────────────────────────── shared Slider (mirrors Explore.tsx) ─── //

function Slider({ label, value, onChange, lo, hi, hint }: {
  label: string; value: number; onChange: (v: number) => void;
  lo: string; hi: string; hint: string;
}) {
  const sliderStyle = { ['--pct' as string]: value + '%' } as CSSProperties;
  return (
    <div className="chunky" style={{ padding: 16, marginBottom: 14 }}>
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

function vibeHint(v: number): string {
  const t = (v - 50) / 50;
  if (Math.abs(t) < 0.06) return 'All vibes — slide to narrow.';
  return t > 0 ? 'Leaning adrenaline.' : 'Leaning chill.';
}
function priceHint(p: number): string {
  const t = (p - 50) / 50;
  if (Math.abs(t) < 0.06) return 'Any price — slide to filter.';
  return t > 0 ? 'Leaning splurge.' : 'Leaning cheap.';
}

// ─────────────────────────────────────────── Surprise Me logic ───────────── //

type Suggestion =
  | { kind: 'activity'; id: string; activity: Activity; bookUrl: string | null }
  | { kind: 'item';     id: string; item: ViatorItem; group: ViatorGroup; bookUrl: string | null };

function currentSlot(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'evening';
}

const SLOT_GREETING = { morning: 'Rise and roll', afternoon: 'Midday roulette', evening: 'Night owl energy' };

function resolvePool(starred: Set<string>, catalog: Catalog, tags: Set<MatchTag>): Suggestion[] {
  // Build sets of activity/group ids that pass the answer filter.
  // When no answers are available (tags empty), everything passes.
  let matchActIds: Set<string> | null = null;
  let matchGroupIds: Set<string> | null = null;
  if (tags.size > 0) {
    // matchPool requires a Slot; union all three so every time-of-day is included.
    // drawFrom() handles the per-slot narrowing at roll time.
    const allActIds   = new Set<string>();
    const allGroupIds = new Set<string>();
    for (const slot of ['morning', 'afternoon', 'evening'] as const) {
      const { activities: ma, groups: mg } = matchPool(catalog.activities, catalog.groups, tags, slot);
      ma.forEach((a) => allActIds.add(a.id));
      mg.forEach((g) => allGroupIds.add(g.id));
    }
    matchActIds   = allActIds;
    matchGroupIds = allGroupIds;
  }

  const pool: Suggestion[] = [];
  for (const sid of starred) {
    if (sid.startsWith('item:')) {
      const itemId = sid.slice(5);
      const item   = catalog.items.find((i) => i.id === itemId);
      const group  = item && catalog.groups.find((g) => g.id === item.group_id);
      if (item && group && (!matchGroupIds || matchGroupIds.has(group.id))) {
        pool.push({ kind: 'item', id: sid, item, group, bookUrl: item.viator_item_url && item.price_usd > 0 ? productUrlFor(item) : null });
      }
    } else {
      const activity = catalog.activities.find((a) => a.id === sid);
      if (activity && (!matchActIds || matchActIds.has(activity.id))) {
        pool.push({ kind: 'activity', id: sid, activity, bookUrl: activity.viator_item_url && parseActivityCost(activity.cost) > 0 ? viatorLink(activity.viator_item_url) : null });
      }
    }
  }
  return pool;
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

function SurprisePanel({ setPage, trip }: { setPage: (p: PageId) => void; trip: TripLoadState }) {
  const { catalog, loading } = useCatalog();
  const { starred, toggle: toggleStar } = useStarred();
  const [pick, setPick]     = useState<Suggestion | null>(null);
  const [skipId, setSkipId] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);

  const slot    = currentSlot();
  const slotTod = slot === 'morning' ? 'Morning' : slot === 'afternoon' ? 'Afternoon' : 'Evening';

  const tags = useMemo(
    () => (trip && trip !== 'loading') ? answersToTags(trip.answers) : new Set<MatchTag>(),
    [trip],
  );

  const pool = useMemo(
    () => resolvePool(starred, catalog, tags),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [starred.size, catalog.activities.length, catalog.items.length, tags],
  );

  const spin = useCallback(() => {
    const next = drawFrom(pool, skipId, slotTod);
    if (!next) return;
    setSkipId(next.id); setPick(next); setAnimKey((k) => k + 1);
  }, [pool, skipId, slotTod]);

  useEffect(() => {
    if (!loading && pool.length && !pick) spin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pool.length]);

  useEffect(() => {
    if (pick && !starred.has(pick.id)) {
      const next = drawFrom(pool, null, slotTod);
      if (next) { setSkipId(next.id); setPick(next); setAnimKey((k) => k + 1); }
      else { setPick(null); setSkipId(null); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starred.size]);

  useEffect(() => {
    let last = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
      if (mag > 22 && Date.now() - last > 1200) { last = Date.now(); spin(); }
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [spin]);

  const slotEmoji = { morning: '🌅', afternoon: '☀️', evening: '🌙' };

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 className="font-display" style={{ fontSize: 36, margin: '0 0 4px', color: 'var(--ink)' }}>Feeling spontaneous?</h2>
        <p style={{ fontStyle: 'italic', fontSize: 14, color: 'var(--sand-700)', margin: 0 }}>
          {pool.length > 0
            ? 'Here\'s an activity for right now — tap to roll a different one.'
            : 'Heart things in Explore first — then let us do the deciding.'}
        </p>
      </div>

      {loading && <div style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading…</div>}

      {!loading && pool.length === 0 && (
        <div className="chunky" style={{ padding: '32px 28px', textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>🎲</div>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--ink)' }}>Nothing to roll yet.</p>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 20px' }}>
            Heart a few activities in Explore. Come back here when you can't decide. We'll pick for you — no agonising required.
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
              <span style={{ position: 'absolute', top: 12, right: 12, background: 'var(--ink)', color: 'var(--yellow)', padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Star size={11} /> {pick.kind === 'activity' ? pick.activity.rating : pick.item.rating}
              </span>
              <button className="a-star-btn active" style={{ top: 12, left: 12, right: 'unset' }}
                onClick={() => toggleStar(pick.id)} aria-label="Remove from favourites">
                <Heart size={15} fill="currentColor" />
              </button>
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
                {pick.bookUrl && (
                  <a href={pick.bookUrl} target="_blank" rel="noopener noreferrer"
                     style={{ flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '3px 3px 0 var(--ink)' }}>
                    Book now
                  </a>
                )}
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

// ─────────────────────────────────────────────── Starred cards ───────────── //

function StarredActivityCard({ entry, onStar }: { entry: ExploreEntry & { kind: 'activity' }; onStar: () => void }) {
  const a = entry.activity;
  const bUrl = bookingUrl(entry);
  return (
    <div className="a-card fade-in">
      <div className="a-img">
        <img src={a.image} alt={a.title} />
        <span className="a-rating"><Star size={10} /> {a.rating}</span>
        <button className="a-star-btn active" onClick={onStar} aria-label="Remove from favourites">
          <Heart size={14} fill="currentColor" />
        </button>
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: (bUrl || parseActivityCost(a.cost) === 0) ? 12 : 0 }}>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Clock size={10} /> {a.duration}</span>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Dollar size={10} /> {a.cost}</span>
        </div>
        {bUrl ? (
          <a href={bUrl} target="_blank" rel="noopener noreferrer"
             style={{ display: 'block', padding: '8px 12px', fontSize: 12, fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 10, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '2px 2px 0 var(--ink)' }}>
            Book now
          </a>
        ) : parseActivityCost(a.cost) === 0 ? (
          <span style={{ display: 'block', padding: '8px 12px', fontSize: 12, fontWeight: 700, textAlign: 'center', borderRadius: 10, border: '2px solid var(--ink)', background: '#A8F5B8', color: 'var(--ink)', boxShadow: '2px 2px 0 var(--ink)' }}>✓ Free</span>
        ) : null}
      </div>
    </div>
  );
}

function StarredItemCard({ entry, onStar }: { entry: ExploreEntry & { kind: 'item' }; onStar: () => void }) {
  const { item } = entry;
  const bUrl = bookingUrl(entry);
  const sec  = sectionLabel(primarySection(entry.sections));
  return (
    <div className="a-card fade-in">
      <div className="a-img">
        <img src={item.image_url} alt={item.title} />
        <span className="a-rating"><Star size={10} /> {item.rating}</span>
        <button className="a-star-btn active" onClick={onStar} aria-label="Remove from favourites">
          <Heart size={14} fill="currentColor" />
        </button>
      </div>
      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 4 }}>{sec}</div>
        <h3 className="font-display" style={{ fontSize: 18, lineHeight: 1.15, margin: '0 0 8px', color: 'var(--ink)' }}>{item.title}</h3>
        <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--sand-700)', margin: '0 0 12px', flex: 1 }}>
          {(item.description ?? '').length > 110 ? (item.description ?? '').slice(0, 107) + '…' : (item.description ?? '')}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: (bUrl || item.price_usd === 0) ? 12 : 0 }}>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Clock size={10} /> {item.duration}</span>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Dollar size={10} /> ${item.price_usd}</span>
        </div>
        {bUrl ? (
          <a href={bUrl} target="_blank" rel="noopener noreferrer"
             style={{ display: 'block', padding: '8px 12px', fontSize: 12, fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 10, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '2px 2px 0 var(--ink)' }}>
            Book now
          </a>
        ) : item.price_usd === 0 ? (
          <span style={{ display: 'block', padding: '8px 12px', fontSize: 12, fontWeight: 700, textAlign: 'center', borderRadius: 10, border: '2px solid var(--ink)', background: '#A8F5B8', color: 'var(--ink)', boxShadow: '2px 2px 0 var(--ink)' }}>✓ Free</span>
        ) : null}
      </div>
    </div>
  );
}

// ──���──────────────────────────────────────────── Starred panel ───────��───── //

function StarredPanel({ setPage }: { setPage: (p: PageId) => void }) {
  const { catalog, loading } = useCatalog();
  const { starred, toggle: toggleStar } = useStarred();
  const [vibe,  setVibe]  = useState(50);
  const [price, setPrice] = useState(50);

  const allEntries = useMemo(
    () => filterExploreEntries(catalog, { section: 'All', search: '', vibe, price }),
    [catalog, vibe, price],
  );

  const entries = useMemo(
    () => allEntries.filter((e) =>
      e.kind === 'item' ? starred.has(`item:${e.item.id}`) : starred.has(e.activity.id)
    ),
    [allEntries, starred],
  );

  if (!loading && starred.size === 0) {
    return (
      <div>
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Favourite Activities</h2>
        <div className="chunky" style={{ padding: '32px 28px', textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>♡</div>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--ink)' }}>Nothing starred yet.</p>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 20px' }}>
            Tap the heart on any activity in Explore to save it here.
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
      <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Favourite Activities</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 28 }}>
        <Slider label="Vibe" value={vibe} onChange={setVibe} lo="🌴 Chill" hi="Adrenaline 🪂" hint={vibeHint(vibe)} />
        <Slider label="Price" value={price} onChange={setPrice} lo="✨ Free" hi="Splurge 💸" hint={priceHint(price)} />
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
            <strong style={{ color: 'var(--ink)' }}>{entries.length}</strong> starred activit{entries.length === 1 ? 'y' : 'ies'}
          </p>
          <div className="explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}>
            {entries.map((e) =>
              e.kind === 'item'
                ? <StarredItemCard     key={`item:${e.item.id}`} entry={e} onStar={() => toggleStar(`item:${e.item.id}`)} />
                : <StarredActivityCard key={e.activity.id}       entry={e} onStar={() => toggleStar(e.activity.id)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────── Personalized activities panel ────────── //

function PersonalizedPanel({ setPage, trip }: { setPage: (p: PageId) => void; trip: TripLoadState }) {
  const { catalog, loading } = useCatalog();
  const { starred, toggle: toggleStar } = useStarred();
  const [vibe,  setVibe]  = useState(50);
  const [price, setPrice] = useState(50);

  const tags = useMemo(
    () => (trip && trip !== 'loading') ? answersToTags(trip.answers) : new Set<MatchTag>(),
    [trip],
  );

  // Build matched id sets across all slots, then post-filter all ExploreEntries.
  const entries = useMemo((): ExploreEntry[] => {
    if (loading || !tags.size) return [];
    const matchedActIds   = new Set<string>();
    const matchedGroupIds = new Set<string>();
    for (const slot of ['morning', 'afternoon', 'evening'] as const) {
      const { activities: ma, groups: mg } = matchPool(catalog.activities, catalog.groups, tags, slot);
      ma.forEach((a) => matchedActIds.add(a.id));
      mg.forEach((g) => matchedGroupIds.add(g.id));
    }
    return filterExploreEntries(catalog, { section: 'All', search: '', vibe, price })
      .filter((e) => e.kind === 'item'
        ? matchedGroupIds.has(e.item.group_id)
        : matchedActIds.has(e.activity.id));
  }, [catalog, tags, loading, vibe, price]);

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 0 24px', maxWidth: 500 }}>
        <Slider label="Vibe"  value={vibe}  onChange={setVibe}  lo="🌴 Chill" hi="Adrenaline 🪂" hint={vibeHint(vibe)} />
        <Slider label="Price" value={price} onChange={setPrice} lo="✨ Free"   hi="Splurge 💸"    hint={priceHint(price)} />
      </div>
      {loading ? (
        <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>No matches found — try adjusting the sliders or updating your questionnaire answers.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 16px' }}>
            <strong style={{ color: 'var(--ink)' }}>{entries.length}</strong> activit{entries.length === 1 ? 'y' : 'ies'} matched to your profile
          </p>
          <div className="explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}>
            {entries.map((e) =>
              e.kind === 'item'
                ? <StarredItemCard     key={`item:${e.item.id}`} entry={e} onStar={() => toggleStar(`item:${e.item.id}`)} />
                : <StarredActivityCard key={e.activity.id}       entry={e} onStar={() => toggleStar(e.activity.id)} />
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

function buildShareText(
  trip: TripState,
  resolveEntry: (e: SlotEntry, slot?: Slot) => CardEntry | null,
): string {
  const lines: string[] = [`Your ${trip.answers.days}-day Aruba itinerary`, ''];
  for (const day of trip.plan) {
    lines.push(`Day ${day.day}${day.title ? ` — ${day.title}` : ''}`);
    const slots: [string, Slot, typeof day.morning][] = [
      ['Morning',   'morning',   day.morning],
      ['Afternoon', 'afternoon', day.afternoon],
      ['Evening',   'evening',   day.evening],
    ];
    for (const [label, slot, cards] of slots) {
      for (const card of cards) {
        const entry = resolveEntry(card.entry, slot);
        if (!entry) continue;
        if (entry.kind === 'activity') {
          const cost = entry.activity.cost ?? '';
          lines.push(`  ${label}: ${entry.activity.title} (${entry.activity.duration}${cost ? ', ' + cost : ''})`);
        } else {
          const price = entry.bestSeller.price_usd === 0 ? 'Free' : `$${entry.bestSeller.price_usd}`;
          lines.push(`  ${label}: ${entry.bestSeller.title} (${entry.bestSeller.duration}, ${price})`);
        }
      }
    }
    lines.push('');
  }
  lines.push('Built with 10 Days on Aruba — https://10daysonaruba.com');
  return lines.join('\n');
}

const ITINERARY_VARIANTS: { id: string; label: string; description: string; available: boolean }[] = [
  { id: 'saved',     label: 'Your trip',         description: 'Your personalised itinerary',      available: true  },
  { id: 'adventure', label: 'Adventure-leaning',  description: 'Adrenaline-first, beaches second', available: false },
  { id: 'chill',     label: 'Chill-leaning',      description: 'Slow mornings, easy afternoons',   available: false },
];

function ItineraryPanel({
  setPage, trip, onLogin,
}: {
  setPage: (p: PageId) => void;
  trip: TripLoadState;
  onLogin: () => void;
}) {
  const { user, session, loading: authLoading } = useAuth();
  const { catalog } = useCatalog();
  const { booked, toggle: toggleBooked } = useBooked();
  const [expanded,     setExpanded]     = useState<string | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<number>>(new Set());
  const [exportOpen,   setExportOpen]   = useState<string | null>(null);
  const [shareOpen,    setShareOpen]    = useState<string | null>(null);
  const [emailOpen,    setEmailOpen]    = useState(false);
  const [emailTo,      setEmailTo]      = useState('');
  const [emailNote,    setEmailNote]    = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent,    setEmailSent]    = useState(false);
  const [emailError,   setEmailError]   = useState<string | null>(null);

  const tags = useMemo(
    () => trip && trip !== 'loading' ? answersToTags(trip.answers) : new Set<never>(),
    [trip],
  );

  const resolveEntry = useCallback(
    (slotEntry: SlotEntry, slot?: Slot): CardEntry | null =>
      resolveSlotEntry(slotEntry, catalog, tags as never, slot),
    [catalog, tags],
  );

  const toggleDay = (day: number) => setCollapsedDays((prev) => {
    const next = new Set(prev);
    next.has(day) ? next.delete(day) : next.add(day);
    return next;
  });

  const handleIcsExport = () => {
    if (!trip || trip === 'loading') return;
    const ics = buildIcs(trip.plan, trip.answers, resolveEntry, booked);
    downloadIcs(ics);
    setExportOpen(null);
  };

  const handlePdfExport = () => {
    window.print();
    setExportOpen(null);
  };

  const handleSendEmail = async () => {
    if (!trip || trip === 'loading' || !session) return;
    setEmailSending(true);
    setEmailError(null);
    try {
      const text = buildShareText(trip, resolveEntry);
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/itinerary-share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ to: emailTo.trim(), note: emailNote.trim(), itinerary_text: text }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || `Error ${res.status}`);
      }
      setEmailSent(true);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send. Please try again.');
    } finally {
      setEmailSending(false);
    }
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

  if (trip === 'loading') {
    return (
      <div>
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Itineraries</h2>
        <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading your trip…</p>
      </div>
    );
  }

  const totalActivities = trip
    ? trip.plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]).length
    : 0;
  const bookedCount = trip
    ? trip.plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]).filter((c) => booked.has(c.uid)).length
    : 0;

  return (
    <div>
      <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Itineraries</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ITINERARY_VARIANTS.map((variant) => {

          const isExpanded = expanded === variant.id;
          const hasTrip    = variant.id === 'saved' && !!trip;
          const isLocked   = !variant.available;

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
                      {variant.id === 'saved' && trip && (
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'var(--yellow)', border: '1.5px solid var(--ink)', borderRadius: 6, padding: '2px 7px', boxShadow: '1px 1px 0 var(--ink)' }}>Active</span>
                      )}
                      {isLocked && (
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-400)', border: '1.5px solid var(--sand-200)', borderRadius: 6, padding: '2px 7px' }}>Coming soon</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--sand-500)', marginTop: 2 }}>
                      {variant.id === 'saved' && trip
                        ? `${trip.answers.days} days · ${totalActivities} activities${bookedCount > 0 ? ` · ${bookedCount} confirmed` : ''}`
                        : variant.description}
                    </div>
                  </div>
                  {!isLocked && (
                    <span style={{ color: 'var(--sand-400)', flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      <Chev size={18} />
                    </span>
                  )}
                </button>

                {/* Export + Share icons — visible on the active row; handlers guard against missing trip */}
                {variant.id === 'saved' && !isLocked && (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
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
                          <button onClick={handleIcsExport}
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
                            onClick={() => { setShareOpen(null); setEmailOpen(true); setEmailSent(false); setEmailError(null); }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--ink)', textAlign: 'left' }}>
                            <Mail size={14} /><span>Share via email</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Expanded content — full Itinerary-page style, days collapsible */}
              {isExpanded && hasTrip && trip && (
                <div style={{ borderTop: '2px solid var(--sand-100)' }}>
                  {/* Day list */}
                  <div style={{ padding: '24px 28px 8px' }}>
                    {trip.plan.map((day, i) => {
                      const isLast      = i === trip.plan.length - 1;
                      const isDayCollapsed = collapsedDays.has(day.day);
                      const count       = day.morning.length + day.afternoon.length + day.evening.length;
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

                          {/* Collapsed summary */}
                          {isDayCollapsed ? (
                            <button type="button" className="itin-day-collapsed-note" onClick={() => toggleDay(day.day)}>
                              {count} {count === 1 ? 'activity' : 'activities'} · tap to expand
                            </button>
                          ) : (
                            /* Full card view per slot */
                            slots.map(({ slot, cards }) => (
                              <div key={slot} style={{ marginBottom: 16 }}>
                                <div className="itin-section-label">{SLOT_LABEL[slot]}</div>
                                {cards.map((card) => {
                                  const entry = resolveEntry(card.entry, slot);
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
                          <button onClick={handleIcsExport}
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
                    <button className="btn-red" onClick={() => setPage('itinerary')} style={{ padding: '9px 14px', fontSize: 13 }}>
                      Edit itinerary →
                    </button>
                  </div>
                </div>
              )}

              {/* No trip yet — prompt */}
              {isExpanded && variant.id === 'saved' && !trip && (
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

      {/* Email share modal */}
      {emailOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={(e) => { if (e.target === e.currentTarget) { setEmailOpen(false); setEmailTo(''); setEmailNote(''); setEmailSent(false); setEmailError(null); } }}
        >
          <div className="chunky" style={{ width: '100%', maxWidth: 440, padding: '28px 28px 24px', background: 'var(--cream)', position: 'relative' }}>
            {emailSent ? (
              <>
                <p style={{ fontSize: 28, margin: '0 0 10px' }}>✓</p>
                <h3 className="font-display" style={{ fontSize: 22, margin: '0 0 10px', color: 'var(--ink)' }}>Sent!</h3>
                <p style={{ fontSize: 14, color: 'var(--sand-700)', margin: '0 0 20px' }}>Your itinerary is on its way to <strong>{emailTo}</strong>.</p>
                <button className="btn-red" onClick={() => { setEmailOpen(false); setEmailTo(''); setEmailNote(''); setEmailSent(false); }} style={{ padding: '9px 18px', fontSize: 14 }}>Close</button>
              </>
            ) : (
              <>
                <h3 className="font-display" style={{ fontSize: 22, margin: '0 0 4px', color: 'var(--ink)' }}>Share via email</h3>
                <p style={{ fontSize: 13, color: 'var(--sand-500)', margin: '0 0 20px' }}>Send your itinerary as a branded 10 Days on Aruba email.</p>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6, color: 'var(--ink)' }}>
                  Recipient email
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="friend@example.com"
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', borderRadius: 10, border: '2px solid var(--sand-200)', outline: 'none', boxSizing: 'border-box', background: 'var(--cream)' }}
                  />
                </label>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 13, margin: '14px 0 6px', color: 'var(--ink)' }}>
                  Personal note <span style={{ fontWeight: 400, color: 'var(--sand-400)' }}>(optional)</span>
                  <textarea
                    value={emailNote}
                    onChange={(e) => setEmailNote(e.target.value)}
                    placeholder="Hey! Here's our Aruba plan…"
                    rows={3}
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', borderRadius: 10, border: '2px solid var(--sand-200)', outline: 'none', resize: 'vertical', boxSizing: 'border-box', background: 'var(--cream)' }}
                  />
                </label>
                {emailError && (
                  <p style={{ fontSize: 13, color: 'var(--red)', margin: '10px 0 0' }}>{emailError}</p>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                  <button
                    onClick={handleSendEmail}
                    disabled={emailSending || !emailTo.trim()}
                    className="btn-red"
                    style={{ flex: 1, padding: '10px 18px', fontSize: 14, opacity: (emailSending || !emailTo.trim()) ? 0.6 : 1, cursor: (emailSending || !emailTo.trim()) ? 'not-allowed' : 'pointer' }}
                  >
                    {emailSending ? 'Sending…' : 'Send itinerary'}
                  </button>
                  <button
                    onClick={() => { setEmailOpen(false); setEmailTo(''); setEmailNote(''); setEmailError(null); }}
                    style={{ padding: '10px 18px', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', borderRadius: 10, border: '2px solid var(--sand-200)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────��────────���───────────────────────────────── Bookings panel ────────── //

function BookingsPanel({
  trip, onLogin,
}: {
  trip: TripLoadState;
  onLogin: () => void;
}) {
  const { user, loading: authLoading } = useAuth();
  const { catalog } = useCatalog();
  const { booked, toggle: toggleBooked } = useBooked();

  const tags = useMemo(
    () => trip && trip !== 'loading' ? answersToTags(trip.answers) : new Set<never>(),
    [trip],
  );

  const resolveEntry = useCallback(
    (slotEntry: SlotEntry, slot?: Slot): CardEntry | null =>
      resolveSlotEntry(slotEntry, catalog, tags as never, slot),
    [catalog, tags],
  );

  const handleExportConfirmed = () => {
    if (!trip || trip === 'loading') return;
    const ics = buildIcs(trip.plan, trip.answers, resolveEntry, booked);
    downloadIcs(ics, 'aruba-confirmed.ics');
  };

  if (authLoading) return <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading…</p>;

  if (!user) {
    return (
      <div>
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Bookings</h2>
        <div className="chunky" style={{ padding: '32px 28px', textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>✓</div>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--ink)' }}>Sign in to track bookings.</p>
          <button className="btn-red" onClick={onLogin} style={{ padding: '11px 22px', fontSize: 14 }}>Log in</button>
        </div>
      </div>
    );
  }

  if (trip === 'loading') return <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading…</p>;

  // Collect all booked cards across the plan, preserving day + slot context.
  type BookedEntry = { card: PlannedCard; day: number; slot: Slot };
  const bookedCards: BookedEntry[] = trip
    ? trip.plan.flatMap((d) =>
        (['morning', 'afternoon', 'evening'] as Slot[]).flatMap((slot) =>
          d[slot]
            .filter((c) => booked.has(c.uid))
            .map((card) => ({ card, day: d.day, slot }))
        )
      )
    : [];

  if (bookedCards.length === 0) {
    return (
      <div>
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Bookings</h2>
        <div className="chunky" style={{ padding: '32px 28px', maxWidth: 440 }}>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--ink)' }}>Nothing confirmed yet.</p>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: 0 }}>
            Check the box next to any activity in Itineraries to mark it as booked.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 4px', color: 'var(--ink)' }}>Bookings</h2>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: 0 }}>
            {bookedCards.length} confirmed activit{bookedCards.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
        <button
          onClick={handleExportConfirmed}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', borderRadius: 10, border: '2px solid var(--ink)', background: 'var(--cream)', color: 'var(--ink)', boxShadow: '2px 2px 0 var(--ink)', cursor: 'pointer' }}
        >
          <Calendar size={13} /> Export confirmed .ics
        </button>
      </div>

      <div className="chunky" style={{ padding: '8px 20px' }}>
        {bookedCards.map(({ card, day, slot }) => {
          const entry = resolveEntry(card.entry, slot);
          if (!entry) return null;
          return (
            <div key={card.uid}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--sand-100)' }}>
              <button
                onClick={() => toggleBooked(card.uid)}
                style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: '2px solid var(--ink)', background: 'var(--green)', color: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                aria-label="Unmark as booked"
              >
                <Check size={12} sw={3} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {entryTitle(entry)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--sand-500)' }}>
                  Day {day} · {SLOT_LABEL[slot]}
                </div>
              </div>
              <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px', flexShrink: 0 }}>
                <Clock size={10} /> {entryDuration(entry)}
              </span>
              <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px', flexShrink: 0 }}>
                <Dollar size={10} /> {entryCost(entry)}
              </span>
            </div>
          );
        })}
      </div>
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
        The little things locals wish every visitor knew.
      </p>
      <div className="gtk-board">
        <div className="gtk-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {GTK_CARDS.map((c, i) => {
            const IconCmp = iconFor(c.icon as never);
            return (
              <article key={c.title} className="gtk-tag"
                style={{ '--accent': c.accent, '--tilt': i % 2 === 0 ? '-1.2deg' : '1.1deg' } as CSSProperties}>
                <span className="gtk-tag-num">{String(i + 1).padStart(2, '0')}</span>
                {c.note && <span className="gtk-tag-flag">{c.note}</span>}
                <span className="gtk-tag-stamp"><IconCmp size={20} /></span>
                <h4 className="font-display gtk-tag-title">{c.title}</h4>
                <p className="gtk-tag-body">{c.body}</p>
                {c.attribution && <span className="gtk-tag-sign">— {c.attribution}</span>}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────���────────────────────────────────────── Dashboard ──────────── //

export default function Dashboard({ setPage, initialSection = 'starred', onLogin }: Props) {
  const [section, setSection] = useState<DashSection>(initialSection);
  const [activitiesTab, setActivitiesTab] = useState<'favourite' | 'personalized'>('favourite');
  const [activitiesOpen, setActivitiesOpen] = useState(initialSection === 'starred');
  const { user, loading: authLoading } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 720,
  );

  // Trip state loaded once at the Dashboard level — shared by Itinerary + Bookings panels.
  const [trip, setTrip] = useState<TripLoadState>('loading');
  useEffect(() => {
    if (authLoading) return;
    if (!user) { setTrip(null); return; }
    loadTrip(user.id).then((t) => setTrip(t ?? null));
  }, [user, authLoading]);

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
                    {(['favourite', 'personalized'] as const).map((tab) => (
                      <button
                        key={tab}
                        className={`dashboard-nav-sub-btn${activitiesTab === tab ? ' active' : ''}`}
                        onClick={() => setActivitiesTab(tab)}
                      >
                        {tab === 'favourite' ? 'Favourite' : 'Personalized'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>

          <div className="dashboard-content">
            {section === 'surprise'  && <SurprisePanel      setPage={setPage} trip={trip} />}
            {section === 'starred'   && activitiesTab === 'favourite'    && <StarredPanel       setPage={setPage} />}
            {section === 'starred'   && activitiesTab === 'personalized' && <PersonalizedPanel  setPage={setPage} trip={trip} />}
            {section === 'itinerary' && <ItineraryPanel   setPage={setPage} trip={trip} onLogin={onLogin} />}
            {section === 'bookings'  && <BookingsPanel    trip={trip} onLogin={onLogin} />}
            {section === 'practical' && <PracticalPanel />}
          </div>
        </div>
      </div>

      <Footer setPage={setPage} />
    </>
  );
}
