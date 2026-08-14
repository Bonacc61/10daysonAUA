import { describe, it, expect } from 'vitest';
import { toRow, fromRow, type TripState } from './trips';
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
