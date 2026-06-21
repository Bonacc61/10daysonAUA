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

export function addCard(plan: PlannedDay[], dayNum: number, section: Slot, entry: SlotEntry, uid: string, atStart = false): PlannedDay[] {
  return plan.map((d) =>
    d.day === dayNum
      ? { ...d, [section]: atStart ? [{ uid, entry }, ...d[section]] : [...d[section], { uid, entry }] }
      : d);
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

// Move a card to a (possibly different) day + section, landing at `toIndex`.
// Handles all three cases: reorder within a section, move between sections of
// the same day, and move across days.
export function moveCard(
  plan: PlannedDay[], uid: string, toDayIdx: number, toSection: Slot, toIndex: number,
): PlannedDay[] {
  const loc = findCard(plan, uid);
  if (!loc) return plan;
  const { dayIdx: fromDayIdx, section: fromSection, index: fromIndex, card } = loc;

  // Pure reorder inside a single section.
  if (fromDayIdx === toDayIdx && fromSection === toSection) {
    return plan.map((d, i) => {
      if (i !== toDayIdx) return d;
      const clamped = Math.max(0, Math.min(toIndex, d[toSection].length - 1));
      return { ...d, [toSection]: arrayMove(d[toSection], fromIndex, clamped) };
    });
  }

  // Cross-section and/or cross-day: pull from the source list and splice into
  // the target list. When the move is same-day-different-section, both edits
  // land on the same day object, so apply them cumulatively.
  return plan.map((d, i) => {
    let next = d;
    if (i === fromDayIdx) {
      next = { ...next, [fromSection]: next[fromSection].filter((c) => c.uid !== uid) };
    }
    if (i === toDayIdx) {
      const target = [...next[toSection]];
      target.splice(Math.max(0, Math.min(toIndex, target.length)), 0, card);
      next = { ...next, [toSection]: target };
    }
    return next;
  });
}
