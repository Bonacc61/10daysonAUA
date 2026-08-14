import { describe, it, expect } from 'vitest';
import { sameAnswers } from './sameAnswers';
import { DEFAULT_ANSWERS } from '../App';
import type { Answers } from '../App';

// Exactly what Postgres hands back: jsonb sorts keys by length, then bytewise.
// Reproduced against Postgres 15 — the same values the client sent, re-keyed.
const asStoredByPostgres = (a: Answers): Answers => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(a).sort((x, y) => x.length - y.length || (x < y ? -1 : 1))) {
    out[k] = (a as unknown as Record<string, unknown>)[k];
  }
  return out as unknown as Answers;
};

describe('sameAnswers — surviving the jsonb round trip', () => {
  it('matches answers that came back from Postgres with reordered keys', () => {
    // The bug this replaced: JSON.stringify said these differed, so the saved
    // plan was thrown away and regenerated on every load.
    const sent = { ...DEFAULT_ANSWERS, groupType: 'Couple', budget: 'Mid-range', tripName: 'Beach week' };
    const stored = asStoredByPostgres(sent);

    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(sent)); // the old test, and why it failed
    expect(sameAnswers(stored, sent)).toBe(true);
  });

  it('still reports a genuinely retaken questionnaire as different', () => {
    const a = { ...DEFAULT_ANSWERS, days: 10 };
    expect(sameAnswers(a, { ...a, days: 7 })).toBe(false);
    expect(sameAnswers(a, { ...a, budget: 'Money no object' })).toBe(false);
    expect(sameAnswers(a, { ...a, adventureLevel: 90 })).toBe(false);
  });

  it('compares array answers by contents', () => {
    const a = { ...DEFAULT_ANSWERS, interests: ['Beach & chill', 'Food & drink'] };
    expect(sameAnswers(a, { ...a, interests: ['Beach & chill', 'Food & drink'] })).toBe(true);
    expect(sameAnswers(a, { ...a, interests: ['Beach & chill'] })).toBe(false);
    expect(sameAnswers(a, { ...a, interests: ['Food & drink', 'Beach & chill'] })).toBe(false);
  });

  it('treats a missing key and an undefined one as the same answer', () => {
    // JSON drops undefined, so the stored row simply has no `tripName` key.
    const withUndef = { ...DEFAULT_ANSWERS, tripName: undefined };
    const withoutKey = { ...DEFAULT_ANSWERS };
    expect(sameAnswers(withUndef, withoutKey)).toBe(true);
  });

  it('notices a name change', () => {
    const a = { ...DEFAULT_ANSWERS, tripName: 'First draft' };
    expect(sameAnswers(a, { ...a, tripName: 'Honeymoon week' })).toBe(false);
  });
});
