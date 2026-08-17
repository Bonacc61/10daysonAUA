import { describe, test, expect } from 'vitest';
import { seedPlan, unseedPlan } from './itineraryPlan';
import type { Day } from './activities';

/**
 * `unseedPlan` is the inverse of `seedPlan`, and the Map depends on that being
 * exactly true: it renders a SAVED trip (`PlannedDay[]`, cards with uids)
 * through the same code path that renders a GENERATED one (`Day[]`, bare slot
 * entries). If the two shapes stop round-tripping, the Map silently draws a
 * different itinerary from the one the traveller saved — which is the bug this
 * pair was added to fix.
 */

const day = (n: number): Day => ({
  day: n,
  title: `Day ${n}`,
  color: '#E63946',
  morning:   [{ kind: 'activity', id: `m-${n}` }],
  afternoon: [{ kind: 'group', groupId: `g-${n}`, bestSellerId: `b-${n}` }],
  evening:   [],
});

describe('seedPlan / unseedPlan', () => {
  test('a generated plan survives the round trip unchanged', () => {
    const plan: Day[] = [day(1), day(2)];
    expect(unseedPlan(seedPlan(plan))).toEqual(plan);
  });

  test('every slot is carried, including the empty one', () => {
    // The failure this guards: unwrapping only the slots that happen to be
    // populated in the fixture. An empty evening must stay an empty array, not
    // become undefined — the Map maps over all three unconditionally.
    const out = unseedPlan(seedPlan([day(1)]));
    expect(out[0].morning).toHaveLength(1);
    expect(out[0].afternoon).toHaveLength(1);
    expect(out[0].evening).toEqual([]);
  });

  test('day metadata is carried, not just the entries', () => {
    const out = unseedPlan(seedPlan([{ ...day(3), title: 'Arikok and the north', color: '#123456' }]));
    expect(out[0]).toMatchObject({ day: 3, title: 'Arikok and the north', color: '#123456' });
  });

  test('it drops the uid and keeps the entry itself', () => {
    // Guards the direction of the unwrap: returning the CARD rather than its
    // `entry` would leave `{uid, entry}` where the Map expects a SlotEntry, and
    // every title/image/pin lookup would quietly resolve to nothing.
    const [seeded] = seedPlan([day(1)]);
    expect(seeded.morning[0]).toHaveProperty('uid');
    const [plain] = unseedPlan(seedPlan([day(1)]));
    expect(plain.morning[0]).not.toHaveProperty('uid');
    expect(plain.morning[0]).toEqual({ kind: 'activity', id: 'm-1' });
  });

  test('an edited plan round-trips too — the entries need not match a generated one', () => {
    // The whole point: the saved plan has been reordered and had a card added,
    // so it is NOT what the generator would emit. unseedPlan must carry it as-is.
    const seeded = seedPlan([day(1)]);
    seeded[0].evening.push({ uid: 'x-1', entry: { kind: 'activity', id: 'zeerovers-fresh-catch' } });
    seeded[0].morning.reverse();
    const out = unseedPlan(seeded);
    expect(out[0].evening).toEqual([{ kind: 'activity', id: 'zeerovers-fresh-catch' }]);
    expect(out[0].morning).toEqual([{ kind: 'activity', id: 'm-1' }]);
  });
});
