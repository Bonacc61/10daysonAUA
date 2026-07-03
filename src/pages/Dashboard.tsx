import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Footer from '../components/Footer';
import { iconFor, Clock, Dice, Dollar, Heart, MapPin, Star } from '../components/Icons';
import { useCatalog } from '../data/useCatalog';
import { filterExploreEntries, bookingUrl } from '../data/exploreItems';
import { INFO_TOPICS, GTK_CARDS } from '../data/activities';
import { useStarred } from '../lib/starred';
import { useAuth } from '../lib/auth';
import { loadTrip } from '../lib/trips';
import { parseActivityCost } from '../data/matcher';
import { viatorLink, productUrlFor, sectionLabel, primarySection } from '../data/exploreItems';
import type { PageId } from '../App';
import type { Activity } from '../data/activities';
import type { ViatorGroup, ViatorItem } from '../types';
import type { Catalog } from '../data/activitySource';
import type { TripState } from '../lib/trips';
import type { ExploreEntry } from '../data/exploreItems';

// ─────────────────────────────────────────────────────────── types ──────── //

type DashSection = 'surprise' | 'starred' | 'itinerary' | 'practical';

const SECTIONS: { id: DashSection; label: string; emoji: string }[] = [
  { id: 'surprise',   label: 'Surprise me',          emoji: '🎲' },
  { id: 'starred',    label: 'Favourite Activities',  emoji: '♡' },
  { id: 'itinerary',  label: 'Itineraries',           emoji: '🗓' },
  { id: 'practical',  label: 'Practical Info',        emoji: 'ℹ' },
];

type Props = {
  setPage:        (p: PageId) => void;
  initialSection?: DashSection;
  onLogin:        () => void;
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

const SLOT_GREETING = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' };

function resolvePool(starred: Set<string>, catalog: Catalog): Suggestion[] {
  const pool: Suggestion[] = [];
  for (const sid of starred) {
    if (sid.startsWith('item:')) {
      const itemId = sid.slice(5);
      const item  = catalog.items.find((i) => i.id === itemId);
      const group = item && catalog.groups.find((g) => g.id === item.group_id);
      if (item && group) pool.push({ kind: 'item', id: sid, item, group, bookUrl: item.viator_item_url && item.price_usd > 0 ? productUrlFor(item) : null });
    } else {
      const activity = catalog.activities.find((a) => a.id === sid);
      if (activity) pool.push({ kind: 'activity', id: sid, activity, bookUrl: activity.viator_item_url && parseActivityCost(activity.cost) > 0 ? viatorLink(activity.viator_item_url) : null });
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

function SurprisePanel({ setPage }: { setPage: (p: PageId) => void }) {
  const { catalog, loading } = useCatalog();
  const { starred, toggle: toggleStar } = useStarred();
  const [pick, setPick]     = useState<Suggestion | null>(null);
  const [skipId, setSkipId] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);

  const slot    = currentSlot();
  const slotTod = slot === 'morning' ? 'Morning' : slot === 'afternoon' ? 'Afternoon' : 'Evening';

  const pool = useMemo(
    () => resolvePool(starred, catalog),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [starred.size, catalog.activities.length, catalog.items.length],
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

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>
          {SLOT_GREETING[slot]}
        </div>
        <h2 className="font-display" style={{ fontSize: 36, margin: '0 0 4px', color: 'var(--ink)' }}>What should I do?</h2>
        <p style={{ fontStyle: 'italic', fontSize: 14, color: 'var(--sand-700)', margin: 0 }}>
          {pool.length > 0
            ? `Drawing from ${pool.length} starred activit${pool.length === 1 ? 'y' : 'ies'}.`
            : 'Heart activities in Explore to get personalised suggestions.'}
        </p>
      </div>

      {loading && <div style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading…</div>}

      {!loading && pool.length === 0 && (
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
      )}

      {!loading && pick && (
        <div key={animKey} className="surprise-card fade-in" style={{ width: '100%', maxWidth: 500 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 8, textAlign: 'center' }}>
            {pick.kind === 'activity'
              ? `Good for ${(pick.activity.timeOfDay ?? slot).toLowerCase()}`
              : `A suggestion for this ${slot}`}
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
                  <Dice size={14} /> Try another
                </button>
              </div>
            </div>
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--sand-400)', marginTop: 12 }}>
            Shake your phone for a new suggestion.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Starred card ────────────── //

function StarredActivityCard({ entry, onStar }: { entry: ExploreEntry & { kind: 'activity' }; onStar: () => void }) {
  const a = entry.activity;
  const bookUrl = bookingUrl(entry);
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Clock size={10} /> {a.duration}</span>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Dollar size={10} /> {a.cost}</span>
        </div>
        {bookUrl && (
          <a href={bookUrl} target="_blank" rel="noopener noreferrer"
             style={{ display: 'block', padding: '8px 12px', fontSize: 12, fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 10, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '2px 2px 0 var(--ink)' }}>
            Book now
          </a>
        )}
      </div>
    </div>
  );
}

function StarredItemCard({ entry, onStar }: { entry: ExploreEntry & { kind: 'item' }; onStar: () => void }) {
  const { item } = entry;
  const bookUrl  = bookingUrl(entry);
  const sec      = sectionLabel(primarySection(entry.sections));
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Clock size={10} /> {item.duration}</span>
          <span className="chip-outline" style={{ fontSize: 10, padding: '2px 8px' }}><Dollar size={10} /> ${item.price_usd}</span>
        </div>
        {bookUrl && (
          <a href={bookUrl} target="_blank" rel="noopener noreferrer"
             style={{ display: 'block', padding: '8px 12px', fontSize: 12, fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 10, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '2px 2px 0 var(--ink)' }}>
            Book now
          </a>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Starred panel ───────────── //

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

// ────────────────────────────────────────────── Itinerary panel ──────────── //

function ItineraryPanel({ setPage, onLogin }: { setPage: (p: PageId) => void; onLogin: () => void }) {
  const { user, loading: authLoading } = useAuth();
  const [trip,  setTrip]  = useState<TripState | null | 'loading'>('loading');

  useEffect(() => {
    if (!user) { setTrip(null); return; }
    setTrip('loading');
    loadTrip(user.id).then((t) => setTrip(t));
  }, [user]);

  const activityCount = useMemo(() => {
    if (!trip || trip === 'loading') return 0;
    return trip.plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]).length;
  }, [trip]);

  return (
    <div>
      <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 20px', color: 'var(--ink)' }}>Itineraries</h2>

      {authLoading && (
        <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading…</p>
      )}

      {!authLoading && !user && (
        <div className="chunky" style={{ padding: '32px 28px', textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>🗓</div>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--ink)' }}>Sign in to save your trips.</p>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 20px' }}>
            Log in to save, revisit, and export your personalised Aruba itinerary.
          </p>
          <button className="btn-red" onClick={onLogin} style={{ padding: '11px 22px', fontSize: 14 }}>
            Log in
          </button>
        </div>
      )}

      {!authLoading && user && trip === 'loading' && (
        <p style={{ color: 'var(--sand-500)', fontStyle: 'italic' }}>Loading your trips…</p>
      )}

      {!authLoading && user && trip === null && (
        <div className="chunky" style={{ padding: '32px 28px', maxWidth: 440 }}>
          <p className="font-display" style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--ink)' }}>No trip saved yet.</p>
          <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 20px' }}>
            Complete the questionnaire to generate your personalised itinerary — it'll be saved automatically.
          </p>
          <button className="btn-red" onClick={() => setPage('questionnaire')} style={{ padding: '11px 22px', fontSize: 14 }}>
            Build my itinerary →
          </button>
        </div>
      )}

      {!authLoading && user && trip && trip !== 'loading' && (
        <div style={{ maxWidth: 480 }}>
          <div className="chunky" style={{ padding: '24px 26px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-500)', margin: '0 0 4px' }}>Saved trip</p>
                <h3 className="font-display" style={{ fontSize: 24, margin: '0 0 8px', color: 'var(--ink)' }}>
                  {trip.answers.days}-day Aruba trip
                </h3>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--sand-700)' }}>
                  {trip.answers.groupType && (
                    <span>👥 {trip.answers.groupType}</span>
                  )}
                  {activityCount > 0 && (
                    <span>🏄 {activityCount} activit{activityCount === 1 ? 'y' : 'ies'}</span>
                  )}
                  {trip.answers.budget && (
                    <span>💰 {trip.answers.budget}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-red" onClick={() => setPage('itinerary')} style={{ flex: 1, padding: '12px 20px', fontSize: 14 }}>
              View itinerary →
            </button>
            <button onClick={() => setPage('questionnaire')}
              style={{ flex: 1, padding: '12px 20px', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--cream)', color: 'var(--ink)', boxShadow: '3px 3px 0 var(--ink)', cursor: 'pointer' }}>
              Edit questionnaire
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────── Practical panel ──────────── //

function PracticalPanel() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 6px', color: 'var(--ink)' }}>Practical Info</h2>
      <p style={{ fontStyle: 'italic', fontSize: 14, color: 'var(--sand-700)', margin: '0 0 28px' }}>
        Everything you need to know before and during your trip.
      </p>

      {/* INFO_TOPICS accordions */}
      <div style={{ marginBottom: 48 }}>
        {INFO_TOPICS.map((topic) => (
          <div key={topic.title}
            className="chunky"
            style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
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

      {/* GTK_CARDS grid */}
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

// ──────────────────────────────────────────────────── Dashboard ──────────── //

export default function Dashboard({ setPage, initialSection = 'surprise', onLogin }: Props) {
  const [section, setSection] = useState<DashSection>(initialSection);
  const { user } = useAuth();

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

          {/* Sidebar */}
          <nav className="dashboard-sidebar" aria-label="Dashboard sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`dashboard-nav-btn${section === s.id ? ' active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                <span className="dashboard-nav-emoji">{s.emoji}</span>
                {s.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="dashboard-content">
            {section === 'surprise'  && <SurprisePanel   setPage={setPage} />}
            {section === 'starred'   && <StarredPanel     setPage={setPage} />}
            {section === 'itinerary' && <ItineraryPanel   setPage={setPage} onLogin={onLogin} />}
            {section === 'practical' && <PracticalPanel />}
          </div>
        </div>
      </div>

      <Footer setPage={setPage} />
    </>
  );
}
