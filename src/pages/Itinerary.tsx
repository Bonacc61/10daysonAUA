import { useMemo, useState } from 'react';
import {
  DndContext, closestCorners, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bookmark, Chev, X } from '../components/Icons';
import Footer from '../components/Footer';
import ItineraryCard from '../components/ItineraryCard';
import { SAMPLE_ITINERARY, INFO_TOPICS } from '../data/activities';
import { getCatalog, otherItemsInGroup } from '../data/activitySource';
import { matchPool, blendPools } from '../data/matcher';
import { answersToTags } from '../data/answerTags';
import {
  seedPlan, addCard, removeCard, replaceCardEntry, moveCard,
  newUid, type PlannedDay, type PlannedCard,
} from '../data/itineraryPlan';
import type { CardEntry, SlotEntry, Slot, SwapReason, ViatorItem } from '../types';
import type { PageId, Answers } from '../App';

type Props = { setPage: (p: PageId) => void; answers: Answers };

const SECTION_META: { id: Slot; label: string }[] = [
  { id: 'morning',   label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening',   label: 'Evening' },
];

export default function Itinerary({ setPage, answers }: Props) {
  const catalog = useMemo(() => getCatalog(), []);
  const tags    = useMemo(() => answersToTags(answers), [answers]);

  const tripDays = Math.max(1, Math.min(answers.days || 5, SAMPLE_ITINERARY.length));
  const [plan, setPlan] = useState<PlannedDay[]>(() => seedPlan(SAMPLE_ITINERARY.slice(0, tripDays)));

  // Per-card UI state, all keyed by card uid.
  const [approved,   setApproved]   = useState<Set<string>>(new Set());
  const [flipped,    setFlipped]    = useState<Set<string>>(new Set());
  const [swapping,   setSwapping]   = useState<Set<string>>(new Set());
  const [reasonOpen, setReasonOpen] = useState<Set<string>>(new Set());
  const [appearing,  setAppearing]  = useState<Set<string>>(new Set());
  const [removing,   setRemoving]   = useState<Set<string>>(new Set());
  // Rejection memory feeds the swap matcher so it won't re-offer dismissed picks.
  const [rejected,       setRejected]       = useState<Set<string>>(new Set());
  const [rejectedGroups, setRejectedGroups] = useState<Set<string>>(new Set());

  const resolveEntry = (slotEntry: SlotEntry): CardEntry | null => {
    if (slotEntry.kind === 'activity') {
      const a = catalog.activities.find((x) => x.id === slotEntry.id);
      return a ? { kind: 'activity', activity: a } : null;
    }
    const g = catalog.groups.find((x) => x.id === slotEntry.groupId);
    if (!g) return null;
    const bs = catalog.items.find((x) => x.id === slotEntry.bestSellerId);
    if (!bs) return null;
    const others = otherItemsInGroup(g.id, bs.id, catalog);
    return { kind: 'group', group: g, bestSeller: bs, others };
  };

  const toggle = (set: Set<string>, uid: string) => {
    const next = new Set(set);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  };
  const onApprove  = (uid: string) => setApproved((s) => toggle(s, uid));
  const onFlip     = (uid: string) => setFlipped((s) => toggle(s, uid));
  const onOpenSwap = (uid: string) => setReasonOpen((s) => toggle(s, uid));

  const onMove = (uid: string, toSection: Slot, toIndex: number) =>
    setPlan((p) => moveCard(p, uid, toSection, toIndex));

  // "+ Add to itinerary" from an Other-suggestion row — appends a group card
  // (that item as best-seller) to the same day + section, with a fade-in.
  const onAddItem = (dayNum: number, section: Slot, item: ViatorItem) => {
    const uid = newUid();
    setPlan((p) => addCard(p, dayNum, section, { kind: 'group', groupId: item.group_id, bestSellerId: item.id }, uid));
    setAppearing((s) => new Set(s).add(uid));
    window.setTimeout(() => setAppearing((s) => { const n = new Set(s); n.delete(uid); return n; }), 320);
  };

  // Remove with a brief fade/collapse before unmounting.
  const onRemove = (uid: string) => {
    setRemoving((s) => new Set(s).add(uid));
    window.setTimeout(() => {
      setPlan((p) => removeCard(p, uid));
      setRemoving((s) => { const n = new Set(s); n.delete(uid); return n; });
      setApproved((s) => { const n = new Set(s); n.delete(uid); return n; });
    }, 240);
  };

  const onSwap = (uid: string, slot: Slot, entry: CardEntry, reason: SwapReason) => {
    if (swapping.has(uid)) return;
    setReasonOpen((s) => { const n = new Set(s); n.delete(uid); return n; });

    const nextRejected = new Set(rejected);
    const nextRejectedGroups = new Set(rejectedGroups);
    let next: SlotEntry | null = null;

    if (entry.kind === 'group') {
      if (reason === 'not-our-vibe') {
        nextRejectedGroups.add(entry.group.id);
        const { activities, groups } = matchPool(catalog.activities, catalog.groups, tags, slot);
        const candidates = blendPools(activities, groups, catalog.items,
          { rejectedIds: nextRejected, rejectedGroupIds: nextRejectedGroups });
        const fresh = candidates.find((c) =>
          c.kind === 'activity' ? c.activity.id !== entry.bestSeller.id : c.group.id !== entry.group.id);
        if (fresh) next = fresh.kind === 'activity'
          ? { kind: 'activity', id: fresh.activity.id }
          : { kind: 'group', groupId: fresh.group.id, bestSellerId: fresh.bestSeller.id };
      } else {
        nextRejected.add(entry.bestSeller.id);
        const pool = catalog.items
          .filter((i) => i.group_id === entry.group.id && !nextRejected.has(i.id))
          .sort((a, b) => (b.is_best_seller ? 1 : 0) - (a.is_best_seller ? 1 : 0) || a.display_order - b.display_order);
        if (pool[0]) next = { kind: 'group', groupId: entry.group.id, bestSellerId: pool[0].id };
      }
    } else {
      nextRejected.add(entry.activity.id);
      const { activities, groups } = matchPool(catalog.activities, catalog.groups, tags, slot);
      const candidates = blendPools(activities, groups, catalog.items,
        { rejectedIds: nextRejected, rejectedGroupIds: nextRejectedGroups });
      const fresh = candidates.find((c) => c.kind === 'activity' ? c.activity.id !== entry.activity.id : true);
      if (fresh) next = fresh.kind === 'activity'
        ? { kind: 'activity', id: fresh.activity.id }
        : { kind: 'group', groupId: fresh.group.id, bestSellerId: fresh.bestSeller.id };
    }

    setRejected(nextRejected);
    setRejectedGroups(nextRejectedGroups);
    if (!next) return;
    const newEntry = next;

    setSwapping((s) => new Set(s).add(uid));
    window.setTimeout(() => setPlan((p) => replaceCardEntry(p, uid, newEntry)), 450);
    window.setTimeout(() => setSwapping((s) => { const n = new Set(s); n.delete(uid); return n; }), 920);
  };

  const allCards = plan.flatMap((d) => [...d.morning, ...d.afternoon, ...d.evening]);
  const totalSlots = allCards.length;
  const approvedCount = allCards.filter((c) => approved.has(c.uid)).length;

  return (
    <>
      <div className="bleed" style={{ background: 'var(--yellow-bg)', borderBottom: '2px solid var(--ink)' }}>
        <div className="container-1280 itin-header" style={{ padding: '36px 36px 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.7)', marginBottom: 8 }}>Your itinerary</div>
              <h1 className="font-display" style={{ fontSize: 44, margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1 }}>{tripDays} days, hand-picked.</h1>
              <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.75)', margin: 0, maxWidth: 640 }}>
                Approve what you like, swap what you don't, and drag cards between morning, afternoon and evening.
              </p>
            </div>
            <div className="chunky itin-header-counter" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--sand-500)' }}>Approved</div>
              <div className="font-display" style={{ fontSize: 30, color: 'var(--red)', lineHeight: 0.9 }}>
                {approvedCount}<span style={{ fontSize: 15, color: 'var(--ink)', marginLeft: 4 }}>/ {totalSlots}</span>
              </div>
              <button className="btn-red" onClick={() => setPage('explore')} style={{ padding: '10px 14px', fontSize: 13, borderWidth: 2, marginLeft: 10 }}>Add more →</button>
            </div>
          </div>
        </div>
      </div>

      <div className="bleed" style={{ background: 'var(--cream)', padding: '48px 0 80px' }}>
        <div className="container-1280">
          <div className="itinerary-layout">
            <aside className="itinerary-rail">
              <div className="font-display" style={{ fontSize: 16, letterSpacing: '-0.2px', color: 'var(--ink)', margin: '4px 0 14px' }}>
                Practical info
              </div>
              {INFO_TOPICS.map((topic) => (
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
              {plan.map((d, i) => (
                <ItineraryDay
                  key={d.day}
                  d={d}
                  dayIdx={i}
                  isLast={i === plan.length - 1}
                  approved={approved}
                  flipped={flipped}
                  swapping={swapping}
                  reasonOpen={reasonOpen}
                  appearing={appearing}
                  removing={removing}
                  resolveEntry={resolveEntry}
                  onApprove={onApprove}
                  onFlip={onFlip}
                  onOpenSwap={onOpenSwap}
                  onSwap={onSwap}
                  onAddItem={onAddItem}
                  onRemove={onRemove}
                  onMove={onMove}
                />
              ))}

              <div style={{ position: 'sticky', bottom: 16, marginTop: 32, display: 'flex', justifyContent: 'center', zIndex: 5 }}>
                <div className="chunky itin-action-bar" style={{ padding: '14px 22px', display: 'inline-flex', alignItems: 'center', gap: 16, background: 'var(--ink)', color: 'var(--cream)' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{approvedCount} approved</span>
                  <button className="btn-red" style={{ padding: '10px 18px', fontSize: 14 }}>Share itinerary</button>
                  <button className="btn-ghost" style={{ color: 'var(--cream)', borderColor: 'var(--cream)', fontSize: 14, padding: '9px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Bookmark size={14} /> Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SsoLogin />
      <Footer />
    </>
  );
}

type DayHandlers = {
  approved: Set<string>; flipped: Set<string>; swapping: Set<string>;
  reasonOpen: Set<string>; appearing: Set<string>; removing: Set<string>;
  resolveEntry: (e: SlotEntry) => CardEntry | null;
  onApprove: (uid: string) => void;
  onFlip: (uid: string) => void;
  onOpenSwap: (uid: string) => void;
  onSwap: (uid: string, slot: Slot, e: CardEntry, reason: SwapReason) => void;
  onAddItem: (dayNum: number, section: Slot, item: ViatorItem) => void;
  onRemove: (uid: string) => void;
};

function ItineraryDay({
  d, dayIdx, isLast, onMove, ...h
}: { d: PlannedDay; dayIdx: number; isLast: boolean; onMove: (uid: string, toSection: Slot, toIndex: number) => void } & DayHandlers) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sectionOf = (uid: string): Slot | null => {
    for (const { id } of SECTION_META) if (d[id].some((c) => c.uid === uid)) return id;
    return null;
  };

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const activeUid = String(e.active.id);
    const overId = String(e.over.id);
    let toSection: Slot;
    let toIndex: number;
    if (overId.startsWith('zone:')) {
      toSection = overId.split(':')[2] as Slot;
      toIndex = d[toSection].length;
    } else {
      const sec = sectionOf(overId);
      if (!sec) return;
      toSection = sec;
      const idx = d[sec].findIndex((c) => c.uid === overId);
      toIndex = idx < 0 ? d[sec].length : idx;
    }
    onMove(activeUid, toSection, toIndex);
  };

  return (
    <div className="itin-day-wrapper" style={{ position: 'relative', paddingLeft: 64, paddingBottom: isLast ? 0 : 40 }}>
      {!isLast && <div className="timeline-rail" />}
      <div className="day-badge" style={{ position: 'absolute', left: 0, top: 4, background: d.color, width: 44, height: 44, fontSize: 18 }}>{d.day}</div>
      <h2 className="font-display" style={{ fontSize: 30, lineHeight: 1, margin: '6px 0 20px', color: 'var(--ink)' }}>
        Day {d.day} <span style={{ color: 'var(--sand-500)', fontSize: 22, marginLeft: 6 }}>—</span> {d.title}
      </h2>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        {SECTION_META.map(({ id, label }) => (
          <Section
            key={id}
            dayIdx={dayIdx}
            dayNum={d.day}
            section={id}
            label={label}
            cards={d[id]}
            {...h}
          />
        ))}
      </DndContext>
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
      <SortableContext items={cards.map((c) => c.uid)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`itin-section-zone${isOver ? ' over' : ''}${cards.length === 0 ? ' empty' : ''}`}>
          {cards.length === 0 && <div className="itin-section-empty">Drop an activity here, or add one from a card's “Other suggestions”.</div>}
          {cards.map((card) => {
            const entry = h.resolveEntry(card.entry);
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
  card, entry, section, dayNum,
  approved, flipped, swapping, reasonOpen, appearing, removing,
  onApprove, onFlip, onOpenSwap, onSwap, onAddItem, onRemove,
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
      <div className="itin-card-controls">
        <button
          className="itin-card-grip"
          aria-label="Drag to move between morning, afternoon and evening"
          {...attributes}
          {...listeners}
        >⠿</button>
        <button
          className="itin-card-remove"
          aria-label="Remove from itinerary"
          onClick={() => onRemove(card.uid)}
        ><X size={13} aria-hidden /></button>
      </div>
      <ItineraryCard
        entry={entry}
        flipped={flipped.has(card.uid)}
        swapping={swapping.has(card.uid)}
        approved={approved.has(card.uid)}
        onFlip={() => onFlip(card.uid)}
        onApprove={() => onApprove(card.uid)}
        onSwap={() => onOpenSwap(card.uid)}
        showReasons={reasonOpen.has(card.uid)}
        onPickReason={(reason) => onSwap(card.uid, section, entry, reason)}
        onAddItem={(item) => onAddItem(dayNum, section, item)}
      />
    </div>
  );
}

/* ------------------------------------------------------------ *
 *  Sign-in panel — sits between the itinerary and the footer.  *
 *  Stub buttons; no auth yet. Provider chips use brand colours. *
 * ------------------------------------------------------------ */
function SsoLogin() {
  return (
    <div id="save" className="bleed" style={{ background: 'var(--sand-50)', borderTop: '2px solid var(--ink)' }}>
      <div className="container-1280 sso-section" style={{ padding: '48px 36px 56px', textAlign: 'center' }}>
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 8px', color: 'var(--ink)' }}>
          Save your trip.
        </h2>
        <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.65)', margin: '0 0 28px' }}>
          Log in to save, book and share your itinerary.
        </p>
        <div className="sso-grid">
          <button type="button" className="sso-btn" aria-label="Continue with Gmail">
            <GmailLogo />
            <span className="sso-label">Continue with Gmail</span>
          </button>
          <button type="button" className="sso-btn" aria-label="Continue with Apple Mail">
            <AppleLogo />
            <span className="sso-label">Continue with Mail</span>
          </button>
          <button type="button" className="sso-btn" aria-label="Continue with Protonmail">
            <ProtonLogo />
            <span className="sso-label">Continue with Protonmail</span>
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--sand-500)', marginTop: 18 }}>
          We only use your email to save your plan. No spam, ever.
        </p>
      </div>
    </div>
  );
}

/* Inline brand logos (simplified, recognisable). All sized to 22px square. */
function GmailLogo() {
  return (
    <svg className="sso-logo-svg" viewBox="0 0 256 256" aria-hidden="true">
      <path fill="#4285f4" d="M58.18 192.05V93.14L27.51 65.08C13.02 71.8 0 87.1 0 105.14v66.69c0 11.32 9.14 20.22 20.19 20.22z"/>
      <path fill="#34a853" d="M197.82 192.05V93.14l30.67-28.06c14.49 6.72 27.51 22.02 27.51 40.06v66.69c0 11.32-9.14 20.22-20.19 20.22z"/>
      <path fill="#fbbc04" d="M197.82 63.06V93.14l58.18-37.06V41.79c0-13.43-15.34-21.1-26.07-13.04z"/>
      <path fill="#ea4335" d="M58.18 93.14V63.06L128 110.85l69.82-47.79v30.08L128 140.92z"/>
      <path fill="#c5221f" d="M0 41.79v14.29l58.18 37.06V63.06l-32.11-24.31C15.34 30.69 0 28.36 0 41.79z"/>
    </svg>
  );
}
function AppleLogo() {
  return (
    <svg className="sso-logo-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#1A1A1A" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
  );
}
function ProtonLogo() {
  return (
    <svg className="sso-logo-svg" viewBox="0 0 36 36" aria-hidden="true">
      {/* Stylised Proton wordmark icon — purple circle with a stylised "P". */}
      <circle cx="18" cy="18" r="18" fill="#6D4AFF"/>
      <path fill="#FFFFFF" d="M11 9h7.6c3.5 0 5.9 2.1 5.9 5.4 0 3.4-2.6 5.5-6.1 5.5h-3.3V27H11V9zm7 8c1.9 0 3-1 3-2.5s-1.1-2.5-3-2.5h-2.8V17H18z"/>
    </svg>
  );
}
