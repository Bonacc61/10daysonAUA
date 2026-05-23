import type { SlotEntry, Slot } from '../types';
import type { Day } from './activities';

// A single planned card instance. `uid` is a stable per-instance id used as the
// React key, the @dnd-kit sortable id, and the key for per-card UI state
// (flipped / swapping / reason-open / approved). The same activity can appear
// in multiple cards, so we can't key on the entry's content.
export type PlannedCard = { uid: string; entry: SlotEntry };

export type PlannedDay = {
  day: number;
  title: string;
  color: string;
  morning: PlannedCard[];
  afternoon: PlannedCard[];
  evening: PlannedCard[];
};

export const SECTIONS: Slot[] = ['morning', 'afternoon', 'evening'];

let counter = 0;
export function newUid(): string {
  counter += 1;
  return `card-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

// Build the editable plan from the static seed, assigning a uid to each entry.
export function seedPlan(days: Day[]): PlannedDay[] {
  const wrap = (entries: SlotEntry[]): PlannedCard[] =>
    entries.map((entry) => ({ uid: newUid(), entry }));
  return days.map((d) => ({
    day: d.day, title: d.title, color: d.color,
    morning: wrap(d.morning), afternoon: wrap(d.afternoon), evening: wrap(d.evening),
  }));
}

export type CardLocation = { dayIdx: number; section: Slot; index: number; card: PlannedCard };

export function findCard(plan: PlannedDay[], uid: string): CardLocation | null {
  for (let dayIdx = 0; dayIdx < plan.length; dayIdx += 1) {
    for (const section of SECTIONS) {
      const index = plan[dayIdx][section].findIndex((c) => c.uid === uid);
      if (index !== -1) return { dayIdx, section, index, card: plan[dayIdx][section][index] };
    }
  }
  return null;
}

export function addCard(plan: PlannedDay[], dayNum: number, section: Slot, entry: SlotEntry, uid: string): PlannedDay[] {
  return plan.map((d) =>
    d.day === dayNum ? { ...d, [section]: [...d[section], { uid, entry }] } : d);
}

export function removeCard(plan: PlannedDay[], uid: string): PlannedDay[] {
  return plan.map((d) => ({
    ...d,
    morning: d.morning.filter((c) => c.uid !== uid),
    afternoon: d.afternoon.filter((c) => c.uid !== uid),
    evening: d.evening.filter((c) => c.uid !== uid),
  }));
}

export function replaceCardEntry(plan: PlannedDay[], uid: string, entry: SlotEntry): PlannedDay[] {
  const swap = (cards: PlannedCard[]) => cards.map((c) => (c.uid === uid ? { ...c, entry } : c));
  return plan.map((d) => ({
    ...d,
    morning: swap(d.morning), afternoon: swap(d.afternoon), evening: swap(d.evening),
  }));
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// Move a card within its own day — either reorder inside a section or move it
// to a different section at `toIndex`. Cross-day moves are not supported.
export function moveCard(plan: PlannedDay[], uid: string, toSection: Slot, toIndex: number): PlannedDay[] {
  const loc = findCard(plan, uid);
  if (!loc) return plan;
  const { dayIdx, section: fromSection, index: fromIndex, card } = loc;

  return plan.map((d, i) => {
    if (i !== dayIdx) return d;
    const next: PlannedDay = {
      ...d,
      morning: [...d.morning], afternoon: [...d.afternoon], evening: [...d.evening],
    };
    if (fromSection === toSection) {
      const clamped = Math.max(0, Math.min(toIndex, next[toSection].length - 1));
      next[toSection] = arrayMove(next[toSection], fromIndex, clamped);
    } else {
      next[fromSection] = next[fromSection].filter((c) => c.uid !== uid);
      const target = [...next[toSection]];
      target.splice(Math.max(0, Math.min(toIndex, target.length)), 0, card);
      next[toSection] = target;
    }
    return next;
  });
}
