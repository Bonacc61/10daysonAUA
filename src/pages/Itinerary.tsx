import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, closestCorners, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bookmark, Chev, Share, X } from '../components/Icons';
import Footer from '../components/Footer';
import ItineraryCard from '../components/ItineraryCard';
import { INFO_TOPICS } from '../data/activities';
import { resolveSlotEntry } from '../data/activitySource';
import { useCatalog } from '../data/useCatalog';
import { matchPool, blendPools, constrainBySwapReason, entryPrice } from '../data/matcher';
import { fitItem, refaceForAnswers, itemSlotOk } from '../data/itemFit';
import { answersToTags } from '../data/answerTags';
import { generatePlan } from '../data/itineraryGenerator';
import { logEvent } from '../data/feedback';
import { useAuth } from '../lib/auth';
import { loadTrip, upsertTrip } from '../lib/trips';
import { createShare, loadShare } from '../lib/shares';
import { supabase } from '../lib/supabase';
import SignIn from '../components/SignIn';
import SharePopover from '../components/SharePopover';
import {
  seedPlan, addCard, removeCard, replaceCardEntry, moveCard, findCard,
  newUid, SECTIONS, type PlannedDay, type PlannedCard,
} from '../data/itineraryPlan';
import { suggestLunchspot, cardRegion, isLunchspot, LUNCHSPOTS } from '../data/lunchspots';
import type { CardEntry, SlotEntry, Slot, SwapReason, ViatorItem } from '../types';
import type { PageId, Answers } from '../App';

type Props = { setPage: (p: PageId) => void; answers: Answers; setAnswers: (a: Answers) => void; onLogin: () => void; shareId: string | null };

const SECTION_META: { id: Slot; label: string }[] = [
  { id: 'morning',   label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening',   label: 'Evening' },
];

export default function Itinerary({ setPage, answers, setAnswers, onLogin, shareId }: Props) {
  const { catalog } = useCatalog();
  const tags    = useMemo(() => answersToTags(answers), [answers]);

  // Build the initial itinerary from the answers + the live catalog (Viator
  // groups + local picks), honoring the requested day count (1–14). Generated
  // once on mount; user edits (approve/swap/drag) then own the plan.
  const [plan, setPlan] = useState<PlannedDay[]>(() => seedPlan(generatePlan(answers, catalog)));
  const tripDays = plan.length;

  // Per-card UI state, all keyed by card uid.
  const [flipped,    setFlipped]    = useState<Set<string>>(new Set());
  const [swapping,   setSwapping]   = useState<Set<string>>(new Set());
  const [reasonOpen, setReasonOpen] = useState<Set<string>>(new Set());
  const [appearing,  setAppearing]  = useState<Set<string>>(new Set());
  const [removing,   setRemoving]   = useState<Set<string>>(new Set());
  // Rejection memory feeds the swap matcher so it won't re-offer dismissed picks.
  const [rejected,       setRejected]       = useState<Set<string>>(new Set());
  const [rejectedGroups, setRejectedGroups] = useState<Set<string>>(new Set());
  const [practicalOpen, setPracticalOpen] = useState(false);

  // --- Per-user persistence (Supabase trips row) ---------------------------
  const { user } = useAuth();
  const [hydrated, setHydrated] = useState(false);
  const hydratedUser = useRef<string | null>(null);

  // --- Shared read-only view (/i/<id>) -------------------------------------
  const [readOnly, setReadOnly] = useState<boolean>(!!shareId);
  const [shareLoading, setShareLoading] = useState<boolean>(!!shareId);
  const [shareMissing, setShareMissing] = useState(false);

  // --- Creator share flow (Share button + popover) -------------------------
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareErr, setShareErr] = useState<string | null>(null);

  // A shared link always shows its snapshot — even for signed-in visitors — so
  // this seeds the plan/answers directly and never regenerates or hydrates.
  useEffect(() => {
    if (!shareId) { setReadOnly(false); setShareLoading(false); return; }
    setReadOnly(true);
    setShareLoading(true);
    setShareMissing(false);
    let alive = true;
    loadShare(shareId).then((s) => {
      if (!alive) return;
      if (s) {
        setPlan(s.plan);
        setRejected(s.rejected);
        setRejectedGroups(s.rejectedGroups);
        setAnswers(s.answers);
      } else {
        setShareMissing(true);
      }
      setShareLoading(false);
    });
    return () => { alive = false; };
  }, [shareId, setAnswers]);

  // Invalidate a cached link whenever the plan/answers/swap-memory change, so a
  // re-share after edits snapshots the new state and repeat clicks on an
  // unchanged plan don't create duplicate rows.
  useEffect(() => { setShareUrl(null); setSharePopoverOpen(false); }, [plan, answers, rejected, rejectedGroups]);

  const handleShare = async () => {
    if (shareBusy) return;
    let url = shareUrl;
    if (!url) {
      setShareBusy(true);
      setShareErr(null);
      const { id, error } = await createShare({ answers, plan, rejected, rejectedGroups });
      setShareBusy(false);
      if (!id) { setShareErr(error ?? 'Couldn’t create link — try again'); return; }
      url = `${window.location.origin}/i/${id}`;
      setShareUrl(url);
    }
    // Native OS share sheet on mobile; the desktop popover otherwise. If
    // navigator.share throws for a reason other than a user cancel — e.g. iOS
    // Safari dropping transient activation across the createShare await,
    // which surfaces as NotAllowedError — fall back to the popover so the
    // share is still reachable instead of silently no-op'ing.
    if (navigator.share) {
      try {
        await navigator.share({ title: 'My 10 days on Aruba', url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        /* else fall through to the popover */
      }
    }
    setSharePopoverOpen(true);
  };

  // On sign-in, load the saved trip and hydrate it (the saved trip wins).
  useEffect(() => {
    if (shareId) return;               // a shared view never loads the visitor's own trip
    if (!user) { setHydrated(false); hydratedUser.current = null; return; }
    if (hydratedUser.current === user.id) return;
    hydratedUser.current = user.id;
    setHydrated(false);
    loadTrip(user.id).then((t) => {
      if (t) {
        setPlan(t.plan);
        setRejected(t.rejected);
        setRejectedGroups(t.rejectedGroups);
        setAnswers(t.answers);
      }
      setHydrated(true);
    });
  }, [user, setAnswers, shareId]);

  // Debounced persist once hydrated — so we never overwrite the saved plan with
  // the freshly-generated one before it has loaded. Writes answers + plan (which
  // carries the activities) + swap memory.
  useEffect(() => {
    if (shareId || !user || !hydrated) return;   // never autosave a shared snapshot
    const id = window.setTimeout(() => {
      void upsertTrip(user.id, { answers, plan, rejected, rejectedGroups });
    }, 800);
    return () => window.clearTimeout(id);
  }, [user, hydrated, answers, plan, rejected, rejectedGroups, shareId]);

  // Pass the questionnaire answers so the card face + "Other suggestions" only
  // ever show items that fit (e.g. nothing far over budget). This is the display
  // chokepoint — the plan stores only ids, so the shown items are rebuilt here.
  const resolveEntry = (slotEntry: SlotEntry, slot?: Slot): CardEntry | null => resolveSlotEntry(slotEntry, catalog, tags, slot);

  const toggle = (set: Set<string>, uid: string) => {
    const next = new Set(set);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  };
  // Telemetry helper: resolve a card uid → { day, slot, id, kind } for logging.
  const cardCtx = (uid: string) => {
    const loc = findCard(plan, uid);
    if (!loc) return null;
    const e = loc.card.entry;
    return {
      day: plan[loc.dayIdx].day,
      slot: loc.section,
      id: e.kind === 'activity' ? e.id : e.bestSellerId,
      kind: e.kind,
    };
  };

  const onFlip     = (uid: string) => setFlipped((s) => toggle(s, uid));
  const onOpenSwap = (uid: string) => setReasonOpen((s) => toggle(s, uid));

  // "Save trip" / "Save" → scroll to the sign-in panel at the bottom. Saving the
  // trip means signing in (SSO), so the buttons take the user there.
  const scrollToSignIn = onLogin;

  // A single drag context spans the whole plan so cards can be dragged across
  // days, not just between the sections of one day.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onMove = (uid: string, toDayIdx: number, toSection: Slot, toIndex: number) => {
    const c = cardCtx(uid);
    const toDay = plan[toDayIdx]?.day;
    if (c && (c.slot !== toSection || c.day !== toDay)) {
      logEvent({ action: 'move', day: c.day, slot: c.slot, to_section: toSection, from_id: c.id, from_kind: c.kind });
    }
    setPlan((p) => moveCard(p, uid, toDayIdx, toSection, toIndex));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const activeUid = String(e.active.id);
    const overId = String(e.over.id);
    let toDayIdx: number;
    let toSection: Slot;
    let toIndex: number;
    if (overId.startsWith('zone:')) {
      // Empty/section drop target: "zone:<dayIdx>:<section>" → append to the end.
      const [, dayStr, sec] = overId.split(':');
      toDayIdx = Number(dayStr);
      toSection = sec as Slot;
      toIndex = plan[toDayIdx]?.[toSection].length ?? 0;
    } else {
      // Dropped over another card: take its day/section/index across the plan.
      const loc = findCard(plan, overId);
      if (!loc) return;
      toDayIdx = loc.dayIdx;
      toSection = loc.section;
      toIndex = loc.index;
    }
    onMove(activeUid, toDayIdx, toSection, toIndex);
  };

  // "+ Add to itinerary" from an Other-suggestion row — appends a group card
  // (that item as best-seller) to the same day + section, with a fade-in.
  const onAddItem = (dayNum: number, section: Slot, item: ViatorItem) => {
    const uid = newUid();
    setPlan((p) => addCard(p, dayNum, section, { kind: 'group', groupId: item.group_id, bestSellerId: item.id }, uid));
    setAppearing((s) => new Set(s).add(uid));
    window.setTimeout(() => setAppearing((s) => { const n = new Set(s); n.delete(uid); return n; }), 320);
    logEvent({ action: 'add', day: dayNum, slot: section, to_id: item.id, to_kind: 'group', from_price: item.price_usd });
  };

  // "Suggest lunch spot" (afternoon) — append a curated lunch spot near the
  // previous card's region (your morning / early-afternoon location).
  const onSuggestLunch = (dayNum: number) => {
    const day = plan.find((d) => d.day === dayNum);
    if (!day) return;
    const prevCard = day.morning[day.morning.length - 1] ?? day.afternoon[day.afternoon.length - 1] ?? null;
    let prevRegion;
    if (prevCard) {
      const e = resolveEntry(prevCard.entry);
      if (e) prevRegion = cardRegion(e);
    }
    const usedIds = new Set(
      day.afternoon
        .map((c) => c.entry)
        .filter((e): e is { kind: 'activity'; id: string } => e.kind === 'activity')
        .map((e) => e.id),
    );
    const pick = suggestLunchspot(prevRegion, usedIds);
    if (!pick) return;
    const uid = newUid();
    setPlan((p) => addCard(p, dayNum, 'afternoon', { kind: 'activity', id: pick.id }, uid, true));
    setAppearing((s) => new Set(s).add(uid));
    window.setTimeout(() => setAppearing((s) => { const n = new Set(s); n.delete(uid); return n; }), 320);
    logEvent({ action: 'add', day: dayNum, slot: 'afternoon', to_id: pick.id, to_kind: 'activity' });
  };

  // Remove with a brief fade/collapse before unmounting.
  const onRemove = (uid: string) => {
    const c = cardCtx(uid);
    if (c) logEvent({ action: 'remove', day: c.day, slot: c.slot, from_id: c.id, from_kind: c.kind });
    setRemoving((s) => new Set(s).add(uid));
    window.setTimeout(() => {
      setPlan((p) => removeCard(p, uid));
      setRemoving((s) => { const n = new Set(s); n.delete(uid); return n; });
    }, 240);
  };

  const onSwap = (uid: string, slot: Slot, entry: CardEntry, reason: SwapReason) => {
    if (swapping.has(uid)) return;
    setReasonOpen((s) => { const n = new Set(s); n.delete(uid); return n; });

    // Lunch spots only ever swap to other lunch spots — never a regular activity.
    if (entry.kind === 'activity' && isLunchspot(entry.activity.id)) {
      const curId = entry.activity.id;
      const nextRej = new Set(rejected);
      nextRej.add(curId);
      const pool = (rej: Set<string>): CardEntry[] =>
        LUNCHSPOTS
          .filter((l) => l.id !== curId && !rej.has(l.id))
          .map((l): CardEntry => ({ kind: 'activity', activity: l }));
      const freshLunch = constrainBySwapReason(pool(nextRej), reason, entry)[0]
        ?? constrainBySwapReason(pool(new Set<string>()), reason, entry)[0];
      setRejected(nextRej);
      if (!freshLunch || freshLunch.kind !== 'activity') return;
      const toId = freshLunch.activity.id;
      logEvent({ action: 'swap', reason, slot, from_id: curId, from_kind: 'activity',
                 from_price: entryPrice(entry), to_id: toId, to_kind: 'activity' });
      setSwapping((s) => new Set(s).add(uid));
      window.setTimeout(() => setPlan((p) => replaceCardEntry(p, uid, { kind: 'activity', id: toId })), 450);
      window.setTimeout(() => setSwapping((s) => { const n = new Set(s); n.delete(uid); return n; }), 920);
      return;
    }

    const nextRejected = new Set(rejected);
    const nextRejectedGroups = new Set(rejectedGroups);
    let next: SlotEntry | null = null;

    if (entry.kind === 'group' && reason !== 'not-our-vibe') {
      // Rotate within the same Viator group first. Skip over-budget items so
      // "show another" can't rotate to e.g. a $2300 yacht for a budget traveller.
      nextRejected.add(entry.bestSeller.id);
      let pool = catalog.items.filter(
        (i) => i.group_id === entry.group.id && !nextRejected.has(i.id)
          && !fitItem(i, tags).rejected && itemSlotOk(i, slot),
      );
      if (reason === 'too-pricey') {
        // Cheapest item that's strictly cheaper than the current one. If none,
        // leave `next` null so the cross-pool fallback finds a cheaper option
        // elsewhere — never rotate to a pricier item in the same group.
        pool = pool
          .filter((i) => i.price_usd < entry.bestSeller.price_usd)
          .sort((a, b) => a.price_usd - b.price_usd);
      } else {
        pool = pool.sort((a, b) => (b.is_best_seller ? 1 : 0) - (a.is_best_seller ? 1 : 0) || a.display_order - b.display_order);
      }
      if (pool[0]) next = { kind: 'group', groupId: entry.group.id, bestSellerId: pool[0].id };
    }

    if (!next) {
      // Cross-pool: a different activity/group. Runs for "not our vibe", and as
      // the fallback when the within-group rotation found nothing (e.g. "too
      // pricey" with no cheaper item in this group → find a cheaper option here).
      if (entry.kind === 'group') nextRejectedGroups.add(entry.group.id);
      else nextRejected.add(entry.activity.id);
      const { activities, groups } = matchPool(catalog.activities, catalog.groups, tags, slot);
      const curId = entry.kind === 'activity' ? entry.activity.id : entry.group.id;

      // Build exclusion sets: rejection history + everything already in the plan
      // (so we never suggest an activity the user already has on another day).
      const excludeIds = new Set(nextRejected);
      const excludeGroupIds = new Set(nextRejectedGroups);
      for (const day of plan) {
        for (const section of SECTIONS) {
          for (const card of day[section]) {
            if (card.uid === uid) continue;
            if (card.entry.kind === 'activity') excludeIds.add(card.entry.id);
            else excludeGroupIds.add(card.entry.groupId);
          }
        }
      }

      const pool = refaceForAnswers(blendPools(activities, groups, catalog.items,
        { rejectedIds: excludeIds, rejectedGroupIds: excludeGroupIds }), tags, slot)
        .filter((c) => (c.kind === 'activity' ? c.activity.id : c.group.id) !== curId);
      let fresh = constrainBySwapReason(pool, reason, entry)[0];
      // The slot/vibe-matched pool can come up empty (or with nothing satisfying
      // the reason) — a niche slot, an already-cheap card, or after excluding
      // everything already in the plan (which also drops whole groups). Broaden
      // so the swap button always does something for every reason.
      if (!fresh) {
        // 1) Whole catalog, any slot/vibe — still skipping rejects + planned items.
        const widePool = refaceForAnswers(blendPools(catalog.activities, catalog.groups, catalog.items,
          { rejectedIds: excludeIds, rejectedGroupIds: excludeGroupIds }), tags, slot)
          .filter((c) => (c.kind === 'activity' ? c.activity.id : c.group.id) !== curId);
        fresh = constrainBySwapReason(widePool, reason, entry)[0];
      }
      if (!fresh) {
        // 2) Last resort: drop the "not already in the plan" exclusion (keep only
        // the rejection history + the current card) so the click is never a dead
        // end — a repeat beats nothing. "too pricey" still only yields cheaper.
        const anyPool = refaceForAnswers(blendPools(catalog.activities, catalog.groups, catalog.items,
          { rejectedIds: nextRejected, rejectedGroupIds: nextRejectedGroups }), tags, slot)
          .filter((c) => (c.kind === 'activity' ? c.activity.id : c.group.id) !== curId);
        fresh = constrainBySwapReason(anyPool, reason, entry)[0];
      }
      if (fresh) next = fresh.kind === 'activity'
        ? { kind: 'activity', id: fresh.activity.id }
        : { kind: 'group', groupId: fresh.group.id, bestSellerId: fresh.bestSeller.id };
    }

    setRejected(nextRejected);
    setRejectedGroups(nextRejectedGroups);
    if (!next) return;
    const newEntry = next;

    logEvent({
      action: 'swap', reason, slot,
      from_id: entry.kind === 'activity' ? entry.activity.id : entry.bestSeller.id,
      from_kind: entry.kind, from_price: entryPrice(entry),
      to_id: newEntry.kind === 'activity' ? newEntry.id : newEntry.bestSellerId,
      to_kind: newEntry.kind,
    });

    setSwapping((s) => new Set(s).add(uid));
    window.setTimeout(() => setPlan((p) => replaceCardEntry(p, uid, newEntry)), 450);
    window.setTimeout(() => setSwapping((s) => { const n = new Set(s); n.delete(uid); return n; }), 920);
  };

  // Rename a day's theme title. The title lives on the plan, so the debounced
  // persist above saves it automatically for signed-in users.
  const onRenameDay = (dayIdx: number, title: string) => {
    setPlan((p) => p.map((d, i) => (i === dayIdx ? { ...d, title } : d)));
    logEvent({ action: 'rename', day: plan[dayIdx]?.day });
  };

  if (shareLoading) {
    return (
      <div className="bleed" style={{ background: 'var(--cream)', minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontStyle: 'italic', color: 'rgba(0,0,0,0.6)' }}>Loading shared itinerary…</p>
      </div>
    );
  }
  if (shareMissing) {
    return (
      <div className="bleed" style={{ background: 'var(--cream)', minHeight: '60vh', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
        <h1 className="font-display" style={{ fontSize: 32, margin: 0, color: 'var(--ink)' }}>This shared itinerary couldn’t be found.</h1>
        <p style={{ color: 'rgba(0,0,0,0.7)', margin: 0 }}>The link may be mistyped or removed.</p>
        <button className="btn-red" onClick={() => setPage('landing')} style={{ padding: '10px 18px' }}>Build your own →</button>
      </div>
    );
  }

  return (
    <>
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280 itin-header" style={{ padding: '36px 36px 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.7)', marginBottom: 8 }}>Your itinerary</div>
              <h1 className="font-display" style={{ fontSize: 44, margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1 }}>{tripDays} days, hand-picked.</h1>
              <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.75)', margin: 0, maxWidth: 640 }}>
                Swap what you don't love, and drag cards between days and between morning, afternoon and evening.
              </p>
            </div>
            {!readOnly && (
              <div className="chunky itin-header-counter" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn-ghost" onClick={() => setPage('explore')} style={{ padding: '10px 14px', fontSize: 13 }}>+ Add more →</button>
                <button className="btn-red" onClick={scrollToSignIn} style={{ padding: '10px 16px', fontSize: 14, borderWidth: 2 }}>Save trip</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bleed" style={{ background: 'var(--cream)', padding: '48px 0 80px' }}>
        <div className="container-1280">
          {readOnly && (
            <div className="chunky" style={{ background: 'var(--yellow-bg)', border: '2px solid var(--ink)', padding: '12px 18px', marginBottom: 24, fontWeight: 700, color: 'var(--ink)' }}>
              You’re viewing a shared Aruba itinerary — sign in to save your own editable copy.
            </div>
          )}
          <div className="itinerary-layout">
            <aside className="itinerary-rail">
              <button
                type="button"
                onClick={() => setPracticalOpen((o) => !o)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, margin: '4px 0 14px' }}
                aria-expanded={practicalOpen}
              >
                <span className="font-display" style={{ fontSize: 16, letterSpacing: '-0.2px', color: 'var(--ink)' }}>Practical info</span>
                <span style={{ fontFamily: 'Caprasimo, Georgia, serif', fontSize: 26, lineHeight: 1, color: 'var(--ink)', userSelect: 'none' }}>{practicalOpen ? '−' : '+'}</span>
              </button>
              {practicalOpen && INFO_TOPICS.map((topic) => (
                <details key={topic.title} className="info-topic">
                  <summary>
                    <span className="info-topic-title">{topic.title}</span>
                    <span className="info-topic-chev"><Chev size={14} sw={2.5} /></span>
                  </summary>
                  <div className="info-topic-body">
                    {topic.body.map((line, i) => <p key={i}>{line}</p>)}
                  </div>
                </details>
              ))}
            </aside>

            <div className="itinerary-main">
              <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
                {plan.map((d, i) => (
                  <ItineraryDay
                    key={d.day}
                    d={d}
                    dayIdx={i}
                    isLast={i === plan.length - 1}
                    onRenameDay={onRenameDay}
                    readOnly={readOnly}
                    flipped={flipped}
                    swapping={swapping}
                    reasonOpen={reasonOpen}
                    appearing={appearing}
                    removing={removing}
                    resolveEntry={resolveEntry}
                    onFlip={onFlip}
                    onOpenSwap={onOpenSwap}
                    onSwap={onSwap}
                    onAddItem={onAddItem}
                    onRemove={onRemove}
                    onSuggestLunch={onSuggestLunch}
                  />
                ))}
              </DndContext>

              {!readOnly && (
                <div style={{ position: 'sticky', bottom: 16, marginTop: 32, display: 'flex', justifyContent: 'center', zIndex: 5 }}>
                  <div style={{ position: 'relative' }}>
                    {sharePopoverOpen && shareUrl && (
                      <SharePopover url={shareUrl} onClose={() => setSharePopoverOpen(false)} />
                    )}
                    <div className="chunky itin-action-bar" style={{ padding: '14px 22px', display: 'inline-flex', alignItems: 'center', gap: 16, background: 'var(--ink)', color: 'var(--cream)' }}>
                      <button
                        className="btn-red"
                        onClick={handleShare}
                        disabled={!supabase || shareBusy}
                        title={!supabase ? 'Sharing is not configured yet' : undefined}
                        style={{ padding: '10px 18px', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: (!supabase || shareBusy) ? 0.6 : 1 }}
                      >
                        <Share size={14} /> {shareBusy ? 'Creating link…' : 'Share itinerary'}
                      </button>
                      <button onClick={scrollToSignIn} className="btn-ghost" style={{ color: 'var(--cream)', borderColor: 'var(--cream)', fontSize: 14, padding: '9px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Bookmark size={14} /> Save
                      </button>
                    </div>
                    {shareErr && (
                      <div role="alert" style={{ position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', background: 'var(--red)', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 13 }}>
                        {shareErr}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div id="sso-login"><SignIn /></div>
      <Footer setPage={setPage} />
    </>
  );
}

type DayHandlers = {
  readOnly: boolean;
  flipped: Set<string>; swapping: Set<string>;
  reasonOpen: Set<string>; appearing: Set<string>; removing: Set<string>;
  resolveEntry: (e: SlotEntry, slot?: Slot) => CardEntry | null;
  onFlip: (uid: string) => void;
  onOpenSwap: (uid: string) => void;
  onSwap: (uid: string, slot: Slot, e: CardEntry, reason: SwapReason) => void;
  onAddItem: (dayNum: number, section: Slot, item: ViatorItem) => void;
  onRemove: (uid: string) => void;
  onSuggestLunch: (dayNum: number) => void;
};

function ItineraryDay({
  d, dayIdx, isLast, onRenameDay, ...h
}: { d: PlannedDay; dayIdx: number; isLast: boolean;
     onRenameDay: (dayIdx: number, title: string) => void } & DayHandlers) {
  const readOnly = h.readOnly;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.title);
  const [collapsed, setCollapsed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select the title text the moment we enter edit mode.
  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  const startEdit = () => { setDraft(d.title); setEditing(true); };
  const commit = () => {
    const t = draft.trim();
    if (t && t !== d.title) onRenameDay(dayIdx, t);
    setEditing(false);
  };
  const cancel = () => { setEditing(false); setDraft(d.title); };

  const count = d.morning.length + d.afternoon.length + d.evening.length;

  return (
    <div className="itin-day-wrapper" style={{ position: 'relative', paddingLeft: 64, paddingBottom: isLast ? 0 : 40 }}>
      {!isLast && <div className="timeline-rail" />}
      <div className="day-badge" style={{ position: 'absolute', left: 0, top: 4, background: d.color, width: 44, height: 44, fontSize: 18 }}>{d.day}</div>
      <div className="itin-day-head">
        <h2 className="font-display" style={{ fontSize: 30, lineHeight: 1, margin: 0, color: 'var(--ink)' }}>
          Day {d.day} <span style={{ color: 'var(--sand-500)', fontSize: 22, margin: '0 6px' }}>—</span>
          {editing ? (
            <input
              ref={inputRef}
              className="itin-day-title-input"
              value={draft}
              size={Math.max(8, draft.length + 1)}
              maxLength={40}
              aria-label="Edit day title"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              }}
            />
          ) : (
            <span
              className="itin-day-title"
              onDoubleClick={readOnly ? undefined : startEdit}
              title={readOnly ? undefined : 'Double-click to rename this day'}
            >
              {d.title}
              {!readOnly && (
                <button type="button" className="itin-day-edit" onClick={startEdit} aria-label={`Rename day ${d.day}`}>✎</button>
              )}
            </span>
          )}
        </h2>
        <button
          type="button"
          className="itin-day-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand day ${d.day}` : `Collapse day ${d.day}`}
        >
          <span className={`itin-day-chev${collapsed ? ' collapsed' : ''}`}><Chev size={20} sw={2.5} /></span>
        </button>
      </div>
      {collapsed ? (
        <button type="button" className="itin-day-collapsed-note" onClick={() => setCollapsed(false)}>
          {count} {count === 1 ? 'activity' : 'activities'} · tap to expand
        </button>
      ) : (
        SECTION_META.map(({ id, label }) => (
          <Section
            key={id}
            dayIdx={dayIdx}
            dayNum={d.day}
            section={id}
            label={label}
            cards={d[id]}
            {...h}
          />
        ))
      )}
    </div>
  );
}

function Section({
  dayIdx, dayNum, section, label, cards, ...h
}: { dayIdx: number; dayNum: number; section: Slot; label: string; cards: PlannedCard[] } & DayHandlers) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${dayIdx}:${section}` });
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="itin-section-label">{label}</div>
      {section === 'afternoon' && !h.readOnly && (
        <button type="button" className="itin-lunch-btn" onClick={() => h.onSuggestLunch(dayNum)}>
          <span className="itin-lunch-spark" aria-hidden>✦</span>Suggest lunch spot
        </button>
      )}
      <SortableContext items={cards.map((c) => c.uid)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`itin-section-zone${isOver ? ' over' : ''}${cards.length === 0 ? ' empty' : ''}`}>
          {cards.length === 0 && (
            <div className="itin-section-empty">
              {h.readOnly ? 'Nothing planned.' : 'Drop an activity here, or add one from a card’s “Other suggestions”.'}
            </div>
          )}
          {cards.map((card) => {
            const entry = h.resolveEntry(card.entry, section);
            if (!entry) return null;
            return (
              <SortableCard key={card.uid} card={card} entry={entry} section={section} dayNum={dayNum} {...h} />
            );
          })}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({
  card, entry, section, dayNum, readOnly,
  flipped, swapping, reasonOpen, appearing, removing,
  onFlip, onOpenSwap, onSwap, onAddItem, onRemove,
}: { card: PlannedCard; entry: CardEntry; section: Slot; dayNum: number } & DayHandlers) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.uid });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 20 : undefined,
    position: 'relative' as const,
    marginBottom: 16,
  };
  const cls = ['itin-sortable'];
  if (appearing.has(card.uid)) cls.push('appearing');
  if (removing.has(card.uid))  cls.push('removing');

  return (
    <div ref={setNodeRef} style={style} className={cls.join(' ')}>
      {(!readOnly || flipped.has(card.uid)) && (
        <div className="itin-card-controls">
          {flipped.has(card.uid) && (
            <button
              type="button"
              className="itin-card-back-btn"
              aria-label="Back to card"
              onClick={() => onFlip(card.uid)}
            >← Back</button>
          )}
          {!readOnly && (
            <>
              <button
                className="itin-card-grip"
                aria-label="Drag to move between days and between morning, afternoon and evening"
                {...attributes}
                {...listeners}
              >⠿</button>
              <button
                className="itin-card-remove"
                aria-label="Remove from itinerary"
                onClick={() => onRemove(card.uid)}
              ><X size={13} aria-hidden /></button>
            </>
          )}
        </div>
      )}
      <ItineraryCard
        entry={entry}
        flipped={flipped.has(card.uid)}
        swapping={swapping.has(card.uid)}
        onFlip={() => onFlip(card.uid)}
        onSwap={readOnly ? undefined : () => onOpenSwap(card.uid)}
        showReasons={!readOnly && reasonOpen.has(card.uid)}
        onPickReason={readOnly ? undefined : (reason) => onSwap(card.uid, section, entry, reason)}
        onAddItem={readOnly ? undefined : (item) => onAddItem(dayNum, section, item)}
      />
    </div>
  );
}

/* ------------------------------------------------------------ *
 *  Sign-in panel — sits between the itinerary and the footer.  *
 *  Stub buttons; no auth yet. Provider chips use brand colours. *
 * ------------------------------------------------------------ */
