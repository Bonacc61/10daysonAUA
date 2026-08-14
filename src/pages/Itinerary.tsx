import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, closestCorners, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bookmark, Calendar, Chev, Share, X } from '../components/Icons';
import { buildIcs, downloadIcs } from '../lib/icsExport';
import Footer from '../components/Footer';
import ItineraryCard from '../components/ItineraryCard';
import { resolveSlotEntry } from '../data/activitySource';
import { claimedRouteFamilies, withoutClaimedFamilies, tripRouteFamily } from '../data/itineraryGenerator';
import { useCatalog } from '../data/useCatalog';
import { matchPool, blendPools, entryPrice, parseActivityCost } from '../data/matcher';
import { constrainByEdit, CHIP_CONSTRAINTS, describeConstraint, satisfiableByRotation } from '../data/editConstraint';
import type { EditConstraint } from '../data/editConstraint';
import { parseEdit, nlEditEnabled } from '../lib/edits';
import { fitItem, refaceForAnswers, itemSlotOkForFill } from '../data/itemFit';
import { answersToTags } from '../data/answerTags';
import { generatePlan, resolvePinId } from '../data/itineraryGenerator';
import { useShortlist } from '../lib/shortlist';
import { logEvent } from '../data/feedback';
import { useAuth } from '../lib/auth';
import { useBooked } from '../lib/booked';
import { loadTrip, loadTripById, saveTrip, updateTrip, createTrip } from '../lib/trips';
import { readActiveTripId, writeActiveTripId } from '../lib/activeTrip';
import { createShare, loadShare } from '../lib/shares';
import { capture } from '../lib/analytics';
import { supabase } from '../lib/supabase';
import SignIn from '../components/SignIn';
import SharePopover from '../components/SharePopover';
import {
  seedPlan, addCard, removeCard, replaceCardEntry, moveCard, findCard,
  newUid, SECTIONS, type PlannedDay, type PlannedCard,
} from '../data/itineraryPlan';
import { suggestLunchspot, cardRegion, isLunchspot, LUNCHSPOTS } from '../data/lunchspots';
import type { CardEntry, SlotEntry, Slot, SwapReason, ViatorItem, Section } from '../types';
import type { PageId, Answers } from '../App';

type Props = { setPage: (p: PageId) => void; answers: Answers; setAnswers: (a: Answers) => void; onLogin: () => void; shareId: string | null; onNavigateToExplore?: (section: Section) => void };

const SECTION_META: { id: Slot; label: string }[] = [
  { id: 'morning',   label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening',   label: 'Evening' },
];

export default function Itinerary({ setPage, answers, setAnswers, onLogin, shareId, onNavigateToExplore }: Props) {
  const { catalog } = useCatalog();
  const tags    = useMemo(() => answersToTags(answers), [answers]);

  // Human words for the route families, for the duplicate note below. A family
  // id is an internal token ('natural-pool'); the badge has to read like English.
  // Every value tripRouteFamily can return must appear here — the badge renders
  // `⚠ 2nd {label} this trip`, so a miss puts a raw internal token in front of a
  // traveller. 'day-sail'/'evening-cruise' were missed when the sail family
  // became trip-length aware, which showed "2nd day-sail this trip" on the
  // DEFAULT 10-day plan.
  const FAMILY_LABEL: Record<string, string> = {
    sail: 'sail', 'day-sail': 'daytime sail', 'evening-cruise': 'evening cruise',
    offroad: 'off-road tour', kayak: 'kayak trip', 'natural-pool': 'Natural Pool visit',
  };

  // Build the initial itinerary from the answers + the live catalog (Viator
  // groups + local picks), honoring the requested day count (1–14). Generated
  // once on mount; user edits (approve/swap/drag) then own the plan.
  //
  // The shortlist is NOT auto-pinned. Saving something is "keep this in mind",
  // not "put it in my trip" — the traveller drops it into a slot themselves via
  // the empty-slot picker below. (The generator still supports `opts.pinned`;
  // nothing feeds it from the shortlist since 2026-08-05.)
  const [plan, setPlan] = useState<PlannedDay[]>(() => seedPlan(generatePlan(answers, catalog)));

  const tripDays = plan.length;

  // Per-card UI state, all keyed by card uid.
  const [flipped,    setFlipped]    = useState<Set<string>>(new Set());
  const [swapping,   setSwapping]   = useState<Set<string>>(new Set());
  const [reasonOpen, setReasonOpen] = useState<Set<string>>(new Set());
  const [appearing,  setAppearing]  = useState<Set<string>>(new Set());
  const [removing,   setRemoving]   = useState<Set<string>>(new Set());
  // Natural-language edit state (VITE_NL_EDIT only). `echo` is what the swap
  // actually applied, rendered on the new card — built from the constraint, not
  // from the model's prose, so it describes the code's behaviour rather than an
  // interpretation of the sentence.
  const [nlPending, setNlPending] = useState<Set<string>>(new Set());
  const [nlFailed,  setNlFailed]  = useState<Set<string>>(new Set());
  const [echo,      setEcho]      = useState<Record<string, string[]>>({});
  // Rejection memory feeds the swap matcher so it won't re-offer dismissed picks.
  const [rejected,       setRejected]       = useState<Set<string>>(new Set());
  const [rejectedGroups, setRejectedGroups] = useState<Set<string>>(new Set());

  // Which cards the user has manually marked as booked (uid-keyed, persisted to localStorage).
  const { booked: bookedIds, toggle: toggleBooked } = useBooked();

  const handleExportCalendar = () => {
    const ics = buildIcs(plan, answers, resolveEntry, bookedIds);
    downloadIcs(ics);
  };

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
      if (!id) { setShareErr(error ?? "Couldn't create link — try again"); return; }
      url = `${window.location.origin}/i/${id}`;
      setShareUrl(url);
      capture('itinerary_shared');
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

  // On sign-in, load the saved trip and hydrate it — unless the user just filled
  // out a new questionnaire (detected by answers differing from the saved ones),
  // in which case the freshly generated plan takes precedence.
  // Which saved itinerary is open. null until the first save, or while signed
  // out. `savedName` is the name that itinerary was last STORED under — the
  // autosave compares against it to tell a rename apart from any other edit.
  const [tripId, setTripId] = useState<string | null>(() => readActiveTripId());
  const savedName = useRef<string>('');
  const creating = useRef(false);

  const answersAtMount = useRef(answers);
  useEffect(() => {
    if (shareId) return;               // a shared view never loads the visitor's own trip
    if (!user) { setHydrated(false); hydratedUser.current = null; return; }
    if (hydratedUser.current === user.id) return;
    hydratedUser.current = user.id;
    setHydrated(false);
    const currentAnswers = answersAtMount.current;
    // Reopen whatever was last being edited. Falling back to loadTrip (the most
    // recently touched) covers a first visit on this browser, and a stored id
    // that no longer resolves — a trip deleted from another device.
    const wanted = readActiveTripId();
    const fetch = wanted
      ? loadTripById(user.id, wanted).then((t) => t ?? loadTrip(user.id))
      : loadTrip(user.id);
    fetch.then((t) => {
      if (t) {
        const freshQuestionnaire = JSON.stringify(t.answers) !== JSON.stringify(currentAnswers);
        if (!freshQuestionnaire) {
          setPlan(t.plan);
          setRejected(t.rejected);
          setRejectedGroups(t.rejectedGroups);
          setAnswers(t.answers);
          setTripId(t.id);
          writeActiveTripId(t.id);
          savedName.current = t.answers.tripName ?? '';
        }
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
      void (async () => {
        const state = { answers, plan, rejected, rejectedGroups };
        // An autosave always writes to the itinerary that is OPEN. It must never
        // branch a new one — only the Save dialog does that, deliberately, when
        // the traveller renames. Otherwise every keystroke that reached
        // `answers` would litter the account with copies.
        if (tripId) {
          await updateTrip(user.id, tripId, state);
        } else {
          // Nothing saved yet. Create exactly one row and hold it: without the
          // in-flight guard, two edits 800ms apart would each insert, because
          // neither would have seen the other's id yet.
          if (creating.current) return;
          creating.current = true;
          const { id: newId } = await createTrip(user.id, state);
          creating.current = false;
          if (newId) {
            setTripId(newId);
            writeActiveTripId(newId);
            savedName.current = answers.tripName ?? '';
          }
        }
        capture('itinerary_saved', { trigger: 'auto' });
      })();
    }, 800);
    return () => window.clearTimeout(id);
  }, [user, hydrated, answers, plan, rejected, rejectedGroups, shareId, tripId]);

  // Pass the questionnaire answers so the card face + "Other suggestions" only
  // ever show items that fit (e.g. nothing far over budget). This is the display
  // chokepoint — the plan stores only ids, so the shown items are rebuilt here.
  const resolveEntry = (slotEntry: SlotEntry, slot?: Slot): CardEntry | null => resolveSlotEntry(slotEntry, catalog, tags, slot);

  // Count placed pinned picks: pinned=true AND resolved face matches the stored id.
  const pinnedCount = useMemo(() => {
    let n = 0;
    for (const day of plan) {
      for (const sec of SECTION_META) {
        for (const card of day[sec.id]) {
          const e = card.entry;
          if (!e.pinned) continue;
          if (e.kind === 'activity') { n++; continue; }
          const resolved = resolveEntry(e, sec.id);
          if (resolved?.kind === 'group' && resolved.bestSeller.id === e.bestSellerId) n++;
        }
      }
    }
    return n;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, catalog]);

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

  // --- Save Trip modal (name-your-trip before persisting) ------------------
  const [saveTripOpen, setSaveTripOpen] = useState(false);
  const [tripNameDraft, setTripNameDraft] = useState('');
  const [saveTripStatus, setSaveTripStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Whether the last save branched a new itinerary, so the confirmation can say
  // so — "saved" reading the same for an overwrite and for a new copy is how a
  // traveller ends up unsure which one they just changed.
  const [savedAsNew, setSavedAsNew] = useState(false);

  const openSaveTrip = () => {
    setTripNameDraft(answers.tripName ?? '');
    setSaveTripStatus('idle');
    setSaveTripOpen(true);
  };

  const confirmSaveTrip = async () => {
    if (saveTripStatus === 'saving') return;
    const name = tripNameDraft.trim();
    const newAnswers = { ...answers, tripName: name || undefined };
    setAnswers(newAnswers);

    if (user) {
      setSaveTripStatus('saving');
      // A different name means a second itinerary, not a rename of the first.
      // saveTrip decides that from `savedName` — the name this trip was last
      // stored under — so the original stays exactly where the traveller left it.
      const { id: savedId, error, created } = await saveTrip(
        user.id, tripId, { answers: newAnswers, plan, rejected, rejectedGroups }, savedName.current,
      );
      if (error) {
        setSaveTripStatus('error');
        return;
      }
      if (savedId) {
        setTripId(savedId);
        writeActiveTripId(savedId);
      }
      savedName.current = name;
      setSavedAsNew(created);
      capture('itinerary_saved', { trigger: 'manual', created_copy: created });
      setSaveTripStatus('saved');
      window.setTimeout(() => setSaveTripOpen(false), 1600);
    } else {
      setSaveTripOpen(false);
      onLogin();
    }
  };

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

  // Resolved entries for the empty-slot picker: everything the traveller saved
  // via "+ Add", in id format 'item:<viatorId>' | activityId so each resolves
  // through resolvePinId. Saved items wait here until the traveller drops one
  // into a slot — nothing is placed for them.
  const { shortlist } = useShortlist();
  const shortlistEntries = useMemo((): { rawId: string; entry: CardEntry }[] => {
    return [...shortlist]
      .map((rawId) => {
        const entry = resolvePinId(rawId, catalog);
        return entry ? { rawId, entry } : null;
      })
      .filter((x): x is { rawId: string; entry: CardEntry } => x !== null);
  }, [shortlist, catalog]);

  // Add a shortlist entry to a specific day+section (used from the empty-slot picker).
  const onAddSlotEntry = (dayNum: number, section: Slot, entry: CardEntry) => {
    const uid = newUid();
    const slotEntry: SlotEntry = entry.kind === 'activity'
      ? { kind: 'activity', id: entry.activity.id, pinned: true }
      : { kind: 'group', groupId: entry.group.id, bestSellerId: entry.bestSeller.id, pinned: true };
    setPlan((p) => addCard(p, dayNum, section, slotEntry, uid));
    setAppearing((s) => new Set(s).add(uid));
    window.setTimeout(() => setAppearing((s) => { const n = new Set(s); n.delete(uid); return n; }), 320);
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

  // Cards that repeat a route family already used EARLIER in the trip.
  //
  // Derived from the plan rather than recorded when a card is added, so it holds
  // however the duplicate got there — the shortlist picker, a drag between days,
  // a restored trip saved before the rule existed. The generator cannot produce
  // one and swap will not return one, so anything flagged here was a deliberate
  // choice; the badge says so rather than blocking it.
  const duplicateFamilyUids = useMemo(() => {
    const firstSeen = new Set<string>();
    const dupes = new Map<string, string>();
    for (const d of plan) {
      for (const s of ['morning', 'afternoon', 'evening'] as const) {
        for (const c of d[s]) {
          const resolved = resolveSlotEntry(c.entry, catalog, tags, s);
          if (!resolved) continue;
          const fam = tripRouteFamily(resolved, answers.days);
          if (!fam) continue;
          if (firstSeen.has(fam)) dupes.set(c.uid, FAMILY_LABEL[fam] ?? fam);
          else firstSeen.add(fam);
        }
      }
    }
    return dupes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, catalog, tags, answers.days]);

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

  // Chips and free text both arrive here as an EditConstraint — one path.
  // `logReason` is what the telemetry records: a chip id, or 'nl'.
  const applySwap = (
    uid: string, slot: Slot, entry: CardEntry,
    constraint: EditConstraint, logReason: string,
  ) => {
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
      const freshLunch = constrainByEdit(pool(nextRej), constraint, entry)[0]
        ?? constrainByEdit(pool(new Set<string>()), constraint, entry)[0];
      setRejected(nextRej);
      if (!freshLunch || freshLunch.kind !== 'activity') return;
      const toId = freshLunch.activity.id;
      logEvent({ action: 'swap', reason: logReason, slot, from_id: curId, from_kind: 'activity',
                 from_price: entryPrice(entry), to_id: toId, to_kind: 'activity' });
      setSwapping((s) => new Set(s).add(uid));
      window.setTimeout(() => setPlan((p) => replaceCardEntry(p, uid, { kind: 'activity', id: toId })), 450);
      window.setTimeout(() => setSwapping((s) => { const n = new Set(s); n.delete(uid); return n; }), 920);
      return;
    }

    const nextRejected = new Set(rejected);
    const nextRejectedGroups = new Set(rejectedGroups);
    let next: SlotEntry | null = null;

    // Route families the REST of the trip has already used. generatePlan retires
    // a family after one placement, but a swap edits a finished plan and had no
    // way to ask — so "Swap this" could hand back a second catamaran, which is
    // the exact thing the family exists to prevent. The pool exclusions below
    // work on item id and GROUP id, and the sail family spans groups on purpose.
    //
    // `uid` is skipped: the card being replaced must not claim its own family,
    // or swapping a sail could never return another sail.
    const slotOfCard = new Map<string, Slot>();
    const allCards = plan.flatMap((d) => (['morning', 'afternoon', 'evening'] as const)
      .flatMap((sl) => d[sl].map((c) => { slotOfCard.set(c.uid, sl); return c; })));
    const claimedFamilies = claimedRouteFamilies(
      allCards,
      // Slot-aware, matching the badge memo and the render path. resolveSlotEntry
      // re-faces a group entry per slot, so resolving without it can face a
      // different item than the card actually shows.
      (c) => resolveEntry(c.entry, slotOfCard.get(c.uid)),
      answers.days,
      uid,
    );
    // Note the asymmetry, which is the intended behaviour: tapping "Swap this"
    // ON a sail still offers sails (that card's own family is skipped), but
    // tapping it on a jeep never returns a sail while one is already planned.
    const isFamilyClaimed = (c: CardEntry): boolean => {
      const fam = tripRouteFamily(c, answers.days);
      return !!fam && claimedFamilies.has(fam);
    };

    // Rotating within the group is a shortcut that bypasses constrainByEdit, so
    // it is only safe for constraints another item in the same group could
    // actually satisfy. Without this, "we get seasick" on a catamaran card
    // rotates to a different boat while the caption claims otherwise.
    if (entry.kind === 'group' && !constraint.differentKind && satisfiableByRotation(constraint)) {
      // Rotate within the same Viator group first. Skip over-budget items so
      // "show another" can't rotate to e.g. a $2300 yacht for a budget traveller.
      nextRejected.add(entry.bestSeller.id);
      let pool = catalog.items.filter(
        (i) => i.group_id === entry.group.id && !nextRejected.has(i.id)
          && !fitItem(i, tags).rejected && itemSlotOkForFill(i, slot)
          // Rotation stays inside one group, but a group is not one family:
          // 'sailing-cruises' holds sails, dives and a submarine, so rotating a
          // non-sail card can still surface a sail the trip already has.
          && !isFamilyClaimed({ kind: 'group', group: entry.group, bestSeller: i, others: [] }),
      );
      if (constraint.cheaper || typeof constraint.maxPriceUsd === 'number') {
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

      const pool = withoutClaimedFamilies(refaceForAnswers(blendPools(activities, groups, catalog.items,
        { rejectedIds: excludeIds, rejectedGroupIds: excludeGroupIds }), tags, slot)
        .filter((c) => (c.kind === 'activity' ? c.activity.id : c.group.id) !== curId), claimedFamilies, answers.days);
      let fresh = constrainByEdit(pool, constraint, entry)[0];
      // The slot/vibe-matched pool can come up empty (or with nothing satisfying
      // the reason) — a niche slot, an already-cheap card, or after excluding
      // everything already in the plan (which also drops whole groups). Broaden
      // so the swap button always does something for every reason.
      if (!fresh) {
        // 1) Whole catalog, any slot/vibe — still skipping rejects + planned items.
        const widePool = withoutClaimedFamilies(refaceForAnswers(blendPools(catalog.activities, catalog.groups, catalog.items,
          { rejectedIds: excludeIds, rejectedGroupIds: excludeGroupIds }), tags, slot)
          .filter((c) => (c.kind === 'activity' ? c.activity.id : c.group.id) !== curId), claimedFamilies, answers.days);
        fresh = constrainByEdit(widePool, constraint, entry)[0];
      }
      if (!fresh) {
        // 2) Last resort: drop the "not already in the plan" exclusion (keep only
        // the rejection history + the current card) so the click is never a dead
        // end — a repeat beats nothing. "too pricey" still only yields cheaper.
        const anyPool = withoutClaimedFamilies(refaceForAnswers(blendPools(catalog.activities, catalog.groups, catalog.items,
          { rejectedIds: nextRejected, rejectedGroupIds: nextRejectedGroups }), tags, slot)
          .filter((c) => (c.kind === 'activity' ? c.activity.id : c.group.id) !== curId), claimedFamilies, answers.days);
        fresh = constrainByEdit(anyPool, constraint, entry)[0];
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
      action: 'swap', reason: logReason, slot,
      from_id: entry.kind === 'activity' ? entry.activity.id : entry.bestSeller.id,
      from_kind: entry.kind, from_price: entryPrice(entry),
      to_id: newEntry.kind === 'activity' ? newEntry.id : newEntry.bestSellerId,
      to_kind: newEntry.kind,
    });

    setSwapping((s) => new Set(s).add(uid));
    window.setTimeout(() => setPlan((p) => replaceCardEntry(p, uid, newEntry)), 450);
    window.setTimeout(() => setSwapping((s) => { const n = new Set(s); n.delete(uid); return n; }), 920);
  };

  // A chip is just a constant constraint.
  const onSwap = (uid: string, slot: Slot, entry: CardEntry, reason: SwapReason) => {
    setEcho((e) => { const n = { ...e }; delete n[uid]; return n; });
    applySwap(uid, slot, entry, CHIP_CONSTRAINTS[reason], reason);
  };

  // Free text: parse remotely, then run the identical local path. Any failure
  // leaves the chips working and says so — the traveller is never worse off
  // than before they typed.
  const onSwapFromText = async (uid: string, slot: Slot, entry: CardEntry, text: string) => {
    if (nlPending.has(uid)) return;
    setNlFailed((s) => { const n = new Set(s); n.delete(uid); return n; });
    setNlPending((s) => new Set(s).add(uid));

    const result = await parseEdit({
      text,
      current: {
        title: entry.kind === 'group' ? entry.bestSeller.title : entry.activity.title,
        priceUsd: entryPrice(entry),
        region: entry.kind === 'group' ? (entry.bestSeller.region ?? entry.group.region) : entry.activity.region,
        kind: entry.kind === 'group' ? entry.group.id : entry.activity.category,
      },
      tags: [...tags],
    });

    setNlPending((s) => { const n = new Set(s); n.delete(uid); return n; });
    if (!result.ok) { setNlFailed((s) => new Set(s).add(uid)); return; }

    const described = describeConstraint(result.constraint);
    setEcho((e) => ({ ...e, [uid]: described }));
    applySwap(uid, slot, entry, result.constraint, 'nl');
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
        <h1 className="font-display" style={{ fontSize: 32, margin: 0, color: 'var(--ink)' }}>This shared itinerary couldn't be found.</h1>
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
              {answers.tripName && (
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 4px', letterSpacing: '-0.2px' }}>
                  {answers.tripName}
                </div>
              )}
              <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.75)', margin: 0, maxWidth: 640 }}>
                Swap what you don't love, and drag cards between days and between morning, afternoon and evening.
              </p>
              {pinnedCount > 0 && (
                <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)', margin: '8px 0 0' }}>
                  ★ {pinnedCount} of your {pinnedCount === 1 ? 'pick' : 'picks'} placed
                </p>
              )}
            </div>
            {!readOnly && (
              <div className="chunky itin-header-counter" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn-ghost" onClick={() => setPage('explore')} style={{ padding: '10px 14px', fontSize: 13 }}>+ Add more →</button>
                <button className="btn-red" onClick={openSaveTrip} style={{ padding: '10px 16px', fontSize: 14, borderWidth: 2 }}>Save trip</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bleed" style={{ background: 'var(--cream)', padding: '48px 0 80px' }}>
        <div className="container-1280">
          {readOnly && (
            <div className="chunky" style={{ background: 'var(--yellow-bg)', border: '2px solid var(--ink)', padding: '12px 18px', marginBottom: 24, fontWeight: 700, color: 'var(--ink)' }}>
              You're viewing a shared Aruba itinerary — sign in to save your own editable copy.
            </div>
          )}
          <div>
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
                    onSwapFromText={onSwapFromText}
                    nlPending={nlPending}
                    nlFailed={nlFailed}
                    echo={echo}
                    onAddItem={onAddItem}
                    onAddSlotEntry={onAddSlotEntry}
                    onRemove={onRemove}
                    onSuggestLunch={onSuggestLunch}
                    bookedIds={bookedIds}
                    onToggleBooked={toggleBooked}
                    onNavigateToSection={(section) => onNavigateToExplore?.(section)}
                    duplicateFamilyUids={duplicateFamilyUids}
                    shortlistEntries={shortlistEntries}
                  />
                ))}
              </DndContext>

              {!readOnly && (
                <div style={{ position: 'sticky', bottom: 16, marginTop: 32, display: 'flex', justifyContent: 'center', zIndex: 12 }}>
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
                      <button onClick={openSaveTrip} className="btn-ghost" style={{ color: 'var(--cream)', borderColor: 'var(--cream)', fontSize: 14, padding: '9px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Bookmark size={14} /> Save
                      </button>
                      <button onClick={handleExportCalendar} className="btn-ghost" style={{ color: 'var(--cream)', borderColor: 'var(--cream)', fontSize: 14, padding: '9px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Download .ics for Google Calendar, Apple Calendar or Outlook">
                        <Calendar size={14} /> Export calendar
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

      {saveTripOpen && (
        <div className="login-modal-backdrop" onClick={() => saveTripStatus !== 'saving' && setSaveTripOpen(false)}>
          <div className="login-modal-card" role="dialog" aria-modal="true" aria-labelledby="save-trip-title" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="login-modal-close" onClick={() => setSaveTripOpen(false)} aria-label="Close" disabled={saveTripStatus === 'saving'}>✕</button>

            {saveTripStatus === 'saved' ? (
              <>
                <h2 className="font-display" style={{ fontSize: 26, margin: '0 0 8px', color: 'var(--ink)' }}>
                  {savedAsNew ? 'Saved as a new itinerary ✓' : 'Trip saved ✓'}
                </h2>
                <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.65)', margin: 0 }}>
                  {tripNameDraft.trim() ? <><b>{tripNameDraft.trim()}</b> — saved to your account.</> : 'Saved to your account.'}
                </p>
                {savedAsNew && (
                  <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', margin: '8px 0 0' }}>
                    Your earlier itinerary is untouched — both are under Itineraries in My Aruba.
                  </p>
                )}
              </>
            ) : (
              <>
                <h2 id="save-trip-title" className="font-display" style={{ fontSize: 26, margin: '0 0 6px', color: 'var(--ink)' }}>
                  {user ? 'Save your trip' : 'Save your trip'}
                </h2>
                <p style={{ fontStyle: 'italic', fontSize: 14, color: 'rgba(0,0,0,0.65)', margin: '0 0 20px' }}>
                  {user
                    ? 'Give it a name, then save.'
                    : 'Name it, then sign in to save across devices.'}
                </p>
                <input
                  type="text"
                  value={tripNameDraft}
                  onChange={(e) => { setTripNameDraft(e.target.value); setSaveTripStatus('idle'); }}
                  onKeyDown={(e) => e.key === 'Enter' && void confirmSaveTrip()}
                  placeholder="e.g. Honeymoon in Aruba"
                  maxLength={80}
                  autoFocus
                  disabled={saveTripStatus === 'saving'}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '11px 14px', borderRadius: 12,
                    border: '2px solid var(--ink)', fontSize: 15,
                    fontFamily: 'inherit', marginBottom: 14,
                    background: 'var(--cream)', color: 'var(--ink)',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  className="btn-red"
                  onClick={() => void confirmSaveTrip()}
                  disabled={saveTripStatus === 'saving'}
                  style={{ width: '100%', padding: '12px 16px', fontSize: 15, opacity: saveTripStatus === 'saving' ? 0.7 : 1 }}
                >
                  {saveTripStatus === 'saving' ? 'Saving…' : user ? 'Save trip' : 'Continue to sign in →'}
                </button>
                {saveTripStatus === 'error' && (
                  <p role="alert" style={{ color: 'var(--red)', fontSize: 13, margin: '10px 0 0' }}>
                    Something went wrong — please try again.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

type DayHandlers = {
  readOnly: boolean;
  /** card uid -> human label of a route family the trip already used earlier. */
  duplicateFamilyUids?: Map<string, string>;
  flipped: Set<string>; swapping: Set<string>;
  reasonOpen: Set<string>; appearing: Set<string>; removing: Set<string>;
  resolveEntry: (e: SlotEntry, slot?: Slot) => CardEntry | null;
  onFlip: (uid: string) => void;
  onOpenSwap: (uid: string) => void;
  onSwap: (uid: string, slot: Slot, e: CardEntry, reason: SwapReason) => void;
  onSwapFromText: (uid: string, slot: Slot, e: CardEntry, text: string) => void;
  nlPending: Set<string>; nlFailed: Set<string>; echo: Record<string, string[]>;
  onAddItem: (dayNum: number, section: Slot, item: ViatorItem) => void;
  onAddSlotEntry: (dayNum: number, section: Slot, entry: CardEntry) => void;
  onRemove: (uid: string) => void;
  onSuggestLunch: (dayNum: number) => void;
  bookedIds: Set<string>;
  onToggleBooked: (uid: string) => void;
  onNavigateToSection: (section: Section) => void;
  shortlistEntries: { rawId: string; entry: CardEntry }[];
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
      <div className="itin-day-head">
        <div className="day-badge" style={{ background: d.color }}>{d.day}</div>
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
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const hasShortlist = !h.readOnly && h.shortlistEntries.length > 0;
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
          {cards.length === 0 && !hasShortlist && (
            <div className="itin-section-empty">
              {h.readOnly ? 'Nothing planned.' : `Drop an activity here, add one from a card's "Other suggestions", or "+ Add" a few in Explore and pick from your shortlist.`}
            </div>
          )}
          {cards.map((card) => {
            const entry = h.resolveEntry(card.entry, section);
            if (!entry) return null;
            return (
              <SortableCard key={card.uid} card={card} entry={entry} section={section} dayNum={dayNum} {...h} />
            );
          })}
          {/* Sits AFTER the cards and is gated only on having favourites — never
              on the section being empty. Gating it on empty meant "Suggest lunch
              spot" filled the slot and took the picker with it, removing the only
              way to add a second activity to that section. */}
          {hasShortlist && (
            <div className="itin-section-empty has-shortlist">
              <button
                type="button"
                className="itin-shortlist-toggle"
                onClick={() => setShortlistOpen((v) => !v)}
                aria-expanded={shortlistOpen}
              >
                <span className="itin-shortlist-toggle-spacer" aria-hidden />
                <span className="itin-shortlist-toggle-label">
                  <span className="itin-shortlist-heart" aria-hidden>✓</span>
                  Add from shortlist
                </span>
                <span className="itin-shortlist-toggle-icon end" aria-hidden>{shortlistOpen ? '▲' : '▼'}</span>
              </button>
              {shortlistOpen && (
                <div className="itin-shortlist-picker">
                  <div className="itin-shortlist-track">
                    {h.shortlistEntries.map(({ rawId, entry }) => {
                      const name     = entry.kind === 'activity' ? entry.activity.title        : entry.bestSeller.title;
                      const duration = entry.kind === 'activity' ? entry.activity.duration     : entry.bestSeller.duration;
                      const isFree   = entry.kind === 'activity' ? parseActivityCost(entry.activity.cost) === 0 : entry.bestSeller.price_usd === 0;
                      const price    = entry.kind === 'activity' ? entry.activity.cost         : `$${entry.bestSeller.price_usd}`;
                      const image    = entry.kind === 'activity' ? entry.activity.image        : entry.bestSeller.image_url;
                      return (
                        <button
                          key={rawId}
                          type="button"
                          className="itin-shortlist-item"
                          onClick={() => { h.onAddSlotEntry(dayNum, section, entry); setShortlistOpen(false); }}
                        >
                          <span className="itin-shortlist-item-media">
                            {image && (
                              /* Same failure handling as the map strip: a dead
                                 Viator image collapses to the sand placeholder
                                 rather than showing a broken-image glyph. */
                              <img
                                src={image}
                                alt=""
                                onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            )}
                          </span>
                          <span className="itin-shortlist-item-title">{name}</span>
                          <span className="itin-shortlist-item-meta">
                            {duration && <span>⏱ {duration}</span>}
                            {isFree
                              ? <span className="itin-shortlist-free">Free</span>
                              : <span>{price}</span>}
                          </span>
                          {/* Matches the "+ Add" on the Other-suggestions shelf, so
                              both shelves read the same way. A span, not a button:
                              the whole card is already the button, and nesting one
                              inside another is invalid and unreachable by keyboard.
                              Clicking the pill hits the card, which is the add. */}
                          <span className="itin-shortlist-item-add" aria-hidden>+ Add</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({
  card, entry, section, dayNum, readOnly,
  flipped, swapping, reasonOpen, appearing, removing,
  onFlip, onOpenSwap, onSwap, onSwapFromText, nlPending, nlFailed, echo, onAddItem, onRemove,
  bookedIds, onToggleBooked, onNavigateToSection, duplicateFamilyUids,
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
  if (isDragging)              cls.push('dragging');

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
        pinned={card.entry.pinned
          ? (card.entry.kind === 'activity'
              || (entry.kind === 'group' && entry.bestSeller.id === card.entry.bestSellerId))
          : false}
        splurge={card.entry.kind === 'group' && !!card.entry.splurge
          && entry.kind === 'group' && entry.bestSeller.id === card.entry.bestSellerId}
        staple={!!card.entry.staple
          && (card.entry.kind === 'activity'
              || (entry.kind === 'group' && entry.bestSeller.id === card.entry.bestSellerId))}
        dupeFamily={duplicateFamilyUids?.get(card.uid)}
        onFlip={() => onFlip(card.uid)}
        onSwap={readOnly ? undefined : () => onOpenSwap(card.uid)}
        showReasons={!readOnly && reasonOpen.has(card.uid)}
        onPickReason={readOnly ? undefined : (reason) => onSwap(card.uid, section, entry, reason)}
        onSubmitReasonText={!readOnly && nlEditEnabled
          ? (text) => onSwapFromText(card.uid, section, entry, text) : undefined}
        reasonPending={nlPending.has(card.uid)}
        reasonFailed={nlFailed.has(card.uid)}
        echo={echo[card.uid]}
        onAddItem={readOnly ? undefined : (item) => onAddItem(dayNum, section, item)}
        onNavigateToSection={onNavigateToSection}
      />
      {!readOnly && (
        <button
          type="button"
          className={`itin-booked-btn${bookedIds.has(card.uid) ? ' booked' : ''}`}
          onClick={() => onToggleBooked(card.uid)}
        >
          {bookedIds.has(card.uid) ? '✓ Booked' : '○ Mark as booked'}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ *
 *  Sign-in panel — sits between the itinerary and the footer.  *
 *  Stub buttons; no auth yet. Provider chips use brand colours. *
 * ------------------------------------------------------------ */
