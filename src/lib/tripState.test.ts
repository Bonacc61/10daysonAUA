import { describe, it, expect } from 'vitest';
import { stateToColumns, columnsToState, type TripState } from './tripState';
import { DEFAULT_ANSWERS } from '../App';

const sample = (): TripState => ({
  answers: { ...DEFAULT_ANSWERS, days: 7, interests: ['Food & drink'] },
  plan: [{
    day: 1, title: 'Day 1', color: '#FF6B47',
    morning: [{ uid: 'c1', entry: { kind: 'activity', id: 'eagle-beach-morning' } }],
    afternoon: [],
    evening: [{ uid: 'c2', entry: { kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-x' } }],
  }],
  rejected: new Set(['r1', 'r2']),
  rejectedGroups: new Set(['g1']),
});

describe('tripState serialization', () => {
  it('stateToColumns turns Sets into arrays and keeps answers + plan', () => {
    const c = stateToColumns(sample());
    expect(c.answers.days).toBe(7);
    expect(c.plan[0].evening[0].entry).toEqual({ kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-x' });
    expect(c.rejected).toEqual(['r1', 'r2']);
    expect(c.rejected_groups).toEqual(['g1']);
  });

  it('round-trips through columnsToState (arrays back to Sets)', () => {
    const s = sample();
    const back = columnsToState(stateToColumns(s));
    expect(back.answers).toEqual(s.answers);
    expect(back.plan).toEqual(s.plan);
    expect([...back.rejected]).toEqual(['r1', 'r2']);
    expect([...back.rejectedGroups]).toEqual(['g1']);
  });

  it('columnsToState tolerates null arrays', () => {
    const back = columnsToState({ answers: DEFAULT_ANSWERS, plan: [], rejected: null as unknown as string[], rejected_groups: null as unknown as string[] });
    expect([...back.rejected]).toEqual([]);
    expect([...back.rejectedGroups]).toEqual([]);
  });
});
