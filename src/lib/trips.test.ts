import { describe, it, expect } from 'vitest';
import { toRow, fromRow, shortDate, tripLabel, type TripState, type SavedTrip } from './trips';
import { DEFAULT_ANSWERS } from '../App';

const sample = (): TripState => ({
  answers: { ...DEFAULT_ANSWERS, days: 7, interests: ['Food & drink', 'Culture & history'], budget: 'Budget-conscious' },
  plan: [
    {
      day: 1, title: 'Day 1', color: '#FF6B47',
      morning: [{ uid: 'c1', entry: { kind: 'activity', id: 'eagle-beach-morning' } }],
      afternoon: [],
      evening: [{ uid: 'c2', entry: { kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-x' } }],
    },
  ],
  rejected: new Set(['r1', 'r2']),
  rejectedGroups: new Set(['g1']),
});

describe('trips serialization (carries answers + itinerary + its activities)', () => {
  it('toRow keeps answers and the plan (with its activity/group entries), Sets → arrays', () => {
    const row = toRow('user-123', sample());
    expect(row.user_id).toBe('user-123');
    expect(row.answers.days).toBe(7);
    expect(row.answers.interests).toEqual(['Food & drink', 'Culture & history']);
    // the activities that comprise the itinerary survive
    expect(row.plan[0].morning[0].entry).toEqual({ kind: 'activity', id: 'eagle-beach-morning' });
    expect(row.plan[0].evening[0].entry).toEqual({ kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-x' });
    expect(row.rejected).toEqual(['r1', 'r2']);
    expect(row.rejected_groups).toEqual(['g1']);
  });

  it('round-trips through fromRow (arrays → Sets)', () => {
    const s = sample();
    const back = fromRow({ id: 't1', ...toRow('u', s) });
    expect(back.answers).toEqual(s.answers);
    expect(back.plan).toEqual(s.plan);
    expect(back.id).toBe('t1');
    expect([...back.rejected]).toEqual(['r1', 'r2']);
    expect([...back.rejectedGroups]).toEqual(['g1']);
  });

  it('fromRow tolerates null arrays', () => {
    const back = fromRow({ id: 't1', user_id: 'u', answers: DEFAULT_ANSWERS, plan: [], rejected: null as unknown as string[], rejected_groups: null as unknown as string[] });
    expect([...back.rejected]).toEqual([]);
    expect([...back.rejectedGroups]).toEqual([]);
  });
});

describe('shortDate', () => {
  it('formats US style, MM/DD/YY', () => {
    // Midday UTC so the local-time conversion cannot move the date in any zone
    // this runs in, which would make the assertion machine-dependent.
    expect(shortDate('2026-08-18T12:00:00Z')).toBe('08/18/26');
    expect(shortDate('2026-12-01T12:00:00Z')).toBe('12/01/26');
  });

  it('zero-pads single-digit months and days', () => {
    expect(shortDate('2026-01-05T12:00:00Z')).toBe('01/05/26');
  });

  it('is US order, not European — the whole point of not using toLocaleDateString', () => {
    // 9 August, not 8 September.
    expect(shortDate('2026-08-09T12:00:00Z')).toBe('08/09/26');
  });

  it('returns empty for an unparseable timestamp rather than "NaN/NaN/NaN"', () => {
    expect(shortDate('not a date')).toBe('');
  });
});

describe('tripLabel', () => {
  const saved = (name: string | undefined, updatedAt?: string): SavedTrip => {
    const s = sample();
    return { ...s, answers: { ...s.answers, tripName: name }, id: 't1', updatedAt };
  };

  it('uses the traveller’s own name untouched when there is one', () => {
    expect(tripLabel(saved('Honeymoon week', '2026-08-18T12:00:00Z'))).toBe('Honeymoon week');
  });

  it('dates an unnamed itinerary so several of them can be told apart', () => {
    expect(tripLabel(saved(undefined, '2026-08-18T12:00:00Z'))).toBe('Untitled itinerary · 08/18/26');
    expect(tripLabel(saved('   ', '2026-08-17T12:00:00Z'))).toBe('Untitled itinerary · 08/17/26');
  });

  it('two unnamed itineraries saved on different days do not collide', () => {
    const a = tripLabel(saved(undefined, '2026-08-18T12:00:00Z'));
    const b = tripLabel(saved(undefined, '2026-08-17T12:00:00Z'));
    expect(a).not.toBe(b);
  });

  it('falls back to the bare label when the row carries no timestamp', () => {
    expect(tripLabel(saved(undefined, undefined))).toBe('Untitled itinerary');
  });
});
