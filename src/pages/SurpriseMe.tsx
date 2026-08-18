import { useCallback, useEffect, useMemo, useState } from 'react';
import { RatingChipInline, hasRealRating } from '../components/RatingChip';
import { Clock, Dice, Dollar, MapPin, Star } from '../components/Icons';
import Footer from '../components/Footer';
import { useCatalog } from '../data/useCatalog';
import { useShortlist } from '../lib/shortlist';
import AddButton from '../components/AddButton';
import { productUrlFor, sectionLabel, primarySection, bookUrlForActivity } from '../data/exploreItems';
import { matchPool, blendPools } from '../data/matcher';
import { answersToTags } from '../data/answerTags';
import type { PageId, Answers } from '../App';
import type { Activity } from '../data/activities';
import type { ViatorGroup, ViatorItem, Slot } from '../types';
import type { Catalog } from '../data/activitySource';

type Props = { setPage: (p: PageId) => void; answers: Answers };

type Suggestion =
  | { kind: 'activity'; id: string; activity: Activity; bookUrl: string | null }
  | { kind: 'item';     id: string; item: ViatorItem; group: ViatorGroup; bookUrl: string | null };

function currentSlot(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'evening';
}

const SLOT_LABEL = { morning: 'morning', afternoon: 'afternoon', evening: 'evening' };
const SLOT_GREETING = {
  morning:   'Good morning',
  afternoon: 'Good afternoon',
  evening:   'Good evening',
};

function resolvePool(shortlist: Set<string>, catalog: Catalog): Suggestion[] {
  const pool: Suggestion[] = [];
  for (const sid of shortlist) {
    if (sid.startsWith('item:')) {
      const itemId = sid.slice(5);
      const item = catalog.items.find((i) => i.id === itemId);
      const group = item && catalog.groups.find((g) => g.id === item.group_id);
      if (item && group) {
        pool.push({
          kind: 'item', id: sid, item, group,
          bookUrl: item.viator_item_url && item.price_usd > 0 ? productUrlFor(item) : null,
        });
      }
    } else {
      const activity = catalog.activities.find((a) => a.id === sid);
      if (activity) {
        pool.push({
          kind: 'activity', id: sid, activity,
          bookUrl: bookUrlForActivity(activity)?.url ?? null,
        });
      }
    }
  }
  return pool;
}

const NO_FILTER = { rejectedIds: new Set<string>(), rejectedGroupIds: new Set<string>() };

function resolveMatchedPool(answers: Answers, catalog: Catalog, exclude: Set<string>): Suggestion[] {
  const tags = answersToTags(answers);
  const seen = new Set<string>(exclude);
  const result: Suggestion[] = [];

  for (const slot of ['morning', 'afternoon', 'evening'] as Slot[]) {
    const { activities, groups } = matchPool(catalog.activities, catalog.groups, tags, slot);
    const entries = blendPools(activities, groups, catalog.items, NO_FILTER);
    for (const e of entries) {
      const id = e.kind === 'activity' ? e.activity.id : `item:${e.bestSeller.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (e.kind === 'activity') {
        result.push({ kind: 'activity', id, activity: e.activity,
          bookUrl: bookUrlForActivity(e.activity)?.url ?? null });
      } else {
        result.push({ kind: 'item', id, item: e.bestSeller, group: e.group,
          bookUrl: e.bestSeller.viator_item_url && e.bestSeller.price_usd > 0 ? productUrlFor(e.bestSeller) : null });
      }
    }
  }
  return result;
}

function drawFrom(pool: Suggestion[], skipId: string | null, slotTod: string): Suggestion | null {
  if (!pool.length) return null;
  // Prefer time-matching local activities; fall back to all.
  const matchSlot = pool.filter((e) => {
    if (e.id === skipId && pool.length > 1) return false;
    if (e.kind === 'activity') return e.activity.timeOfDay === slotTod;
    return true; // Viator items have no timeOfDay constraint
  });
  const eligible = matchSlot.length
    ? matchSlot
    : pool.filter((e) => e.id !== skipId || pool.length === 1);
  return eligible[Math.floor(Math.random() * eligible.length)] ?? null;
}

export default function SurpriseMe({ setPage, answers }: Props) {
  const { catalog, loading } = useCatalog();
  const { shortlist, toggle: toggleAdd } = useShortlist();
  const [pick, setPick]       = useState<Suggestion | null>(null);
  const [skipId, setSkipId]   = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const [shakeReady, setShakeReady] = useState<boolean>(() => {
    // Android + older iOS fire devicemotion without a permission gate.
    const DME = window.DeviceMotionEvent as (typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> }) | undefined;
    return typeof DME?.requestPermission !== 'function';
  });

  const slot = currentSlot();
  const slotTod = slot === 'morning' ? 'Morning' : slot === 'afternoon' ? 'Afternoon' : 'Evening';

  const starredPool = useMemo(
    () => resolvePool(shortlist, catalog),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shortlist.size, catalog.activities.length, catalog.items.length],
  );

  const matchedPool = useMemo(() => {
    if (answers.interests.length === 0) return [];
    return resolveMatchedPool(answers, catalog, shortlist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, shortlist.size, catalog.activities.length, catalog.items.length]);

  const pool = useMemo(() => [...starredPool, ...matchedPool], [starredPool, matchedPool]);

  const spin = useCallback(() => {
    const next = drawFrom(pool, skipId, slotTod);
    if (!next) return;
    setSkipId(next.id);
    setPick(next);
    setAnimKey((k) => k + 1);
  }, [pool, skipId, slotTod]);

  const requestShakePermission = useCallback(async () => {
    const DME = window.DeviceMotionEvent as (typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> }) | undefined;
    if (typeof DME?.requestPermission === 'function') {
      const result = await DME.requestPermission();
      if (result === 'granted') setShakeReady(true);
    }
  }, []);

  // Auto-pick once catalog is ready.
  useEffect(() => {
    if (!loading && pool.length && !pick) spin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pool.length]);

  // Re-pick when a shortlisted item is removed and isn't reachable via questionnaire matches either.
  useEffect(() => {
    if (pick && !pool.some((p) => p.id === pick.id)) {
      const next = drawFrom(pool, null, slotTod);
      if (next) { setSkipId(next.id); setPick(next); setAnimKey((k) => k + 1); }
      else { setPick(null); setSkipId(null); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortlist.size]);

  // Shake-to-spin (works on Android and pre-13 iOS without permissions).
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
    <>
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280" style={{ padding: '36px 36px 28px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.6)', marginBottom: 6 }}>
            {SLOT_GREETING[slot]}
          </div>
          <h1 className="font-display" style={{ fontSize: 44, margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1 }}>
            What should I do?
          </h1>
          <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.65)', margin: 0 }}>
            {pool.length > 0
              ? [
                  starredPool.length > 0 && `${starredPool.length} shortlisted`,
                  matchedPool.length > 0 && `${matchedPool.length} questionnaire match${matchedPool.length === 1 ? '' : 'es'}`,
                ].filter(Boolean).join(' + ') + '.'
              : answers.interests.length > 0
                ? 'No matches found. Try adding activities in Explore.'
                : 'Add activities or complete the questionnaire to get suggestions.'}
          </p>
        </div>
      </div>

      <div className="bleed" style={{ background: 'var(--cream)', padding: '48px 0 80px', minHeight: '60vh' }}>
        <div className="container-1280" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 24px' }}>

          {loading && (
            <div style={{ color: 'var(--sand-500)', fontStyle: 'italic', marginTop: 48 }}>Loading…</div>
          )}

          {!loading && pool.length === 0 && (
            <div className="chunky" style={{ padding: '36px 32px', textAlign: 'center', maxWidth: 480, marginTop: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>＋</div>
              <p className="font-display" style={{ fontSize: 22, margin: '0 0 10px', color: 'var(--ink)' }}>
                {answers.interests.length > 0 ? 'Nothing to show yet.' : 'Tell us what you like.'}
              </p>
              <p style={{ fontSize: 14, color: 'var(--sand-700)', margin: '0 0 24px' }}>
                {answers.interests.length > 0
                  ? 'Add activities in Explore to save them here.'
                  : 'Fill out the questionnaire so we can suggest activities, or add activities in Explore.'}
              </p>
              <button className="btn-red" onClick={() => setPage('explore')} style={{ padding: '12px 24px', fontSize: 15 }}>
                Browse Explore →
              </button>
            </div>
          )}

          {!loading && pick && (
            <div key={animKey} className="surprise-card fade-in" style={{ width: '100%', maxWidth: 520 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 10, textAlign: 'center' }}>
                {pick.kind === 'activity'
                  ? `Good for this ${SLOT_LABEL[pick.activity.timeOfDay.toLowerCase() as typeof slot] ?? SLOT_LABEL[slot]}`
                  : `A suggestion for this ${SLOT_LABEL[slot]}`}
              </div>

              <div className="chunky" style={{ overflow: 'hidden', padding: 0, border: '2px solid var(--ink)' }}>
                {/* Image */}
                <div style={{ position: 'relative', height: 240, overflow: 'hidden', background: 'var(--sand-100)' }}>
                  <img
                    src={pick.kind === 'activity' ? pick.activity.image : pick.item.image_url}
                    alt={pick.kind === 'activity' ? pick.activity.title : pick.item.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  {/* Rating badge — only where a real platform rating backs it */}
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

                {/* Body */}
                <div style={{ padding: '20px 22px 22px' }}>
                  {pick.kind === 'activity' && (
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 4 }}>
                      {pick.activity.category}
                    </div>
                  )}
                  {pick.kind === 'item' && (
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand-500)', marginBottom: 4 }}>
                      {sectionLabel(primarySection(pick.group.matched_by.map(() => 'tours-sightseeing') as never[]))}
                    </div>
                  )}
                  <h2 className="font-display" style={{ fontSize: 26, lineHeight: 1.1, margin: '0 0 8px', color: 'var(--ink)' }}>
                    {pick.kind === 'activity' ? pick.activity.title : pick.item.title}
                  </h2>
                  {pick.kind === 'activity' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sand-500)', fontSize: 12, marginBottom: 12 }}>
                      <MapPin size={12} /><span>{pick.activity.location}</span>
                    </div>
                  )}
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--sand-700)', margin: '0 0 16px' }}>
                    {pick.kind === 'activity' ? pick.activity.description : pick.item.description}
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                    <span className="chip-outline" style={{ fontSize: 12, padding: '4px 12px', background: 'var(--sand-50)' }}>
                      <Clock size={12} /> {pick.kind === 'activity' ? pick.activity.duration : pick.item.duration}
                    </span>
                    <span className="chip-outline" style={{ fontSize: 12, padding: '4px 12px', background: 'var(--sand-50)' }}>
                      <Dollar size={12} /> {pick.kind === 'activity' ? pick.activity.cost : `$${pick.item.price_usd}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {pick.bookUrl && (
                      <a href={pick.bookUrl} target="_blank" rel="noopener noreferrer"
                         style={{ flex: 1, padding: '11px 14px', fontSize: 14, fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--red)', color: 'var(--cream)', boxShadow: '3px 3px 0 var(--ink)' }}>
                        Book now
                      </a>
                    )}
                    <AddButton added={shortlist.has(pick.id)} onAdd={() => toggleAdd(pick.id)} />
                    <button
                      onClick={async () => {
                        if (!shakeReady) await requestShakePermission();
                        spin();
                      }}
                      disabled={pool.length <= 1}
                      style={{ flex: 1, padding: '11px 14px', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, border: '2px solid var(--ink)', background: 'var(--yellow-bg)', color: 'var(--ink)', boxShadow: '3px 3px 0 var(--ink)', cursor: pool.length > 1 ? 'pointer' : 'not-allowed', opacity: pool.length > 1 ? 1 : 0.4 }}
                    >
                      <Dice size={15} /> Try another
                    </button>
                  </div>
                </div>
              </div>

              <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--sand-400)', marginTop: 14 }}>
                {shakeReady ? 'Shake your phone for a new suggestion.' : 'Tap "Try another" to enable shake gestures.'}
              </p>
            </div>
          )}
        </div>
      </div>

      <Footer setPage={setPage} />
    </>
  );
}
