import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_ANSWERS } from '../App';
import type { TripState } from './tripState';

const insert = vi.fn();
const maybeSingle = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => insert(row),
      select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
    }),
  },
}));

import { createShare, loadShare, randomSlug } from './shares';

const sample = (): TripState => ({
  answers: { ...DEFAULT_ANSWERS, days: 7 },
  plan: [{
    day: 1, title: 'Day 1', color: '#FF6B47',
    morning: [], afternoon: [],
    evening: [{ uid: 'c2', entry: { kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-x' } }],
  }],
  rejected: new Set(['r1', 'r2']),
  rejectedGroups: new Set(),
});

beforeEach(() => { insert.mockReset(); maybeSingle.mockReset(); });

describe('randomSlug', () => {
  it('is 8 base62 chars', () => {
    expect(randomSlug()).toMatch(/^[A-Za-z0-9]{8}$/);
  });
});

describe('createShare', () => {
  it('inserts the state columns under a fresh slug and returns it', async () => {
    insert.mockResolvedValue({ error: null });
    const { id, error } = await createShare(sample());
    expect(error).toBeNull();
    expect(id).toMatch(/^[A-Za-z0-9]{8}$/);
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.id).toBe(id);
    expect(payload.rejected).toEqual(['r1', 'r2']);
    expect((payload.plan as { evening: { entry: unknown }[] }[])[0].evening[0].entry)
      .toEqual({ kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-x' });
    // created_by is never sent by the client (server default fills it).
    expect(payload.created_by).toBeUndefined();
  });

  it('retries once on a unique-violation (23505) then succeeds', async () => {
    insert
      .mockResolvedValueOnce({ error: { code: '23505', message: 'dup' } })
      .mockResolvedValueOnce({ error: null });
    const { id, error } = await createShare(sample());
    expect(error).toBeNull();
    expect(id).not.toBeNull();
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('returns the error for a non-collision failure without retrying', async () => {
    insert.mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    const { id, error } = await createShare(sample());
    expect(id).toBeNull();
    expect(error).toBe('denied');
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('loadShare', () => {
  it('maps columns back into a TripState with Sets', async () => {
    maybeSingle.mockResolvedValue({ data: { answers: DEFAULT_ANSWERS, plan: [], rejected: ['x'], rejected_groups: [] }, error: null });
    const st = await loadShare('abc12345');
    expect(st).not.toBeNull();
    expect([...st!.rejected]).toEqual(['x']);
  });

  it('returns null for a missing id', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await loadShare('nope')).toBeNull();
  });
});
