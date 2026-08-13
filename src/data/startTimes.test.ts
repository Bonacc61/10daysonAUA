import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { startTimesFor, formatStartTime, startTimeLabel } from './startTimes';
import SNAPSHOT from './startTimes.json';
import { departureHeadline, departureHedge } from '../components/DepartureNote';

describe('formatStartTime', () => {
  it('renders in the voice the rest of the site uses', () => {
    expect(formatStartTime('09:00')).toBe('9:00am');
    expect(formatStartTime('15:30')).toBe('3:30pm');
    expect(formatStartTime('18:30')).toBe('6:30pm');
  });

  it('says noon and midnight the way a traveller does', () => {
    // 12 % 12 is 0, which would print "0:00pm" without the guard.
    expect(formatStartTime('12:00')).toBe('12:00pm');
    expect(formatStartTime('00:30')).toBe('12:30am');
  });

  it('passes anything unparseable through rather than inventing a time', () => {
    expect(formatStartTime('')).toBe('');
    expect(formatStartTime('flexible')).toBe('flexible');
  });
});

describe('startTimeLabel', () => {
  it('names the single time when there is only one', () => {
    // 62666P1 — the 09:00 walking tour the engine was placing in afternoons.
    expect(startTimeLabel('62666P1')).toBe('Departs 9:00am');
  });

  it('never collapses a set of departures to one time', () => {
    // Picking one of these would invent a fact the schedule does not support.
    expect(startTimeLabel('5595462P1')).toBe('Departures 3:30pm, 5:00pm');
  });

  it('shows the span, not the first three, once a set gets large', () => {
    // 137607P22 runs 14 times between 10:00 and 16:30. Listing the earliest
    // three named nothing after lunch; a bare span claimed a continuum. The
    // count states discreteness and the window without inventing either.
    expect(startTimeLabel('137607P22')).toBe('14 departures between 10:00am and 4:30pm');
    expect(startTimeLabel('137607P23')).toBe('19 departures between 7:00am and 4:00pm');
  });

  it('still lists in full at the boundary', () => {
    // 3 is the largest set shown as a list; 4 flips to the counted window.
    // Guards the off-by-one directly rather than trusting the <= .
    const three = Object.entries(SNAPSHOT as Record<string, string[]>)
      .find(([, t]) => t.length === 3);
    const four = Object.entries(SNAPSHOT as Record<string, string[]>)
      .find(([, t]) => t.length === 4);
    expect(three, 'snapshot has no 3-time product to test with').toBeTruthy();
    expect(four, 'snapshot has no 4-time product to test with').toBeTruthy();
    expect(startTimeLabel(three![0])).toMatch(/, /);
    expect(startTimeLabel(three![0])).not.toMatch(/-/);
    expect(startTimeLabel(four![0])).toMatch(/^4 departures between /);
    expect(startTimeLabel(four![0])).not.toMatch(/, /);
  });

  it('is silent for a product with nothing on record', () => {
    expect(startTimeLabel('no-such-product')).toBeNull();
    expect(startTimesFor('no-such-product')).toEqual([]);
  });
});

describe('the committed snapshot', () => {
  const entries = Object.entries(SNAPSHOT as Record<string, string[]>);

  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(200);
  });

  it('holds only well-formed 24-hour times', () => {
    // The API returns "HH:MM". Anything else means the probe's parser drifted
    // or a hand edit went in, and formatStartTime would pass it through to the
    // card verbatim rather than fail.
    const bad = entries.flatMap(([id, times]) =>
      times.filter((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)).map((t) => `${id}: ${t}`));
    expect(bad).toEqual([]);
  });

  it('never stores an empty or duplicated set', () => {
    // An empty array would render "Departures " with nothing after it.
    const empty = entries.filter(([, t]) => t.length === 0).map(([id]) => id);
    expect(empty).toEqual([]);
    const dupes = entries.filter(([, t]) => new Set(t).size !== t.length).map(([id]) => id);
    expect(dupes).toEqual([]);
  });

  it('keeps every set in ascending order', () => {
    // startTimeLabel shows the first N and counts the rest, so an unsorted set
    // would name late departures and hide the early one — the opposite of what
    // a traveller needs.
    const unsorted = entries
      .filter(([, t]) => [...t].sort().join() !== t.join())
      .map(([id]) => id);
    expect(unsorted).toEqual([]);
  });
});

describe('the line a traveller actually reads', () => {
  it('joins a time and a place into one sentence', () => {
    expect(departureHeadline('Departs 9:00am', 'from Pelican Pier'))
      .toBe('Departs 9:00am from Pelican Pier');
    expect(departureHeadline('Departures 3:30pm, 5:00pm', 'near Holiday Inn Resort'))
      .toBe('Departures 3:30pm, 5:00pm near Holiday Inn Resort');
  });

  it('stands alone when only one half is on record', () => {
    // The word "Departs" has to come from somewhere when there is no time.
    expect(departureHeadline(null, 'from Pelican Pier')).toBe('Departs from Pelican Pier');
    expect(departureHeadline('Departs 9:00am', '')).toBe('Departs 9:00am');
  });

  it('hedges exactly what is on screen and nothing else', () => {
    // Promising "times vary" on a card showing no time reads as a bug; claiming
    // a meeting point we never printed is worse.
    expect(departureHedge(true, true)).toMatch(/Confirm both/);
    expect(departureHedge(true, false)).toMatch(/Times vary/);
    expect(departureHedge(true, false)).not.toMatch(/meeting point/);
    expect(departureHedge(false, true)).toBe('Confirm the meeting point on your booking.');
    expect(departureHedge(false, true)).not.toMatch(/Times vary/);
  });
});

describe('the snapshot agrees with the evidence it came from', () => {
  // src/data/startTimes.json is derived BY HAND from the probe's output. Nothing
  // regenerates it, so nothing but this test would notice the two drifting —
  // and the card would then print a departure time the probe never saw.
  it('matches docs/map/viator-start-times.json exactly', () => {
    const evidence = JSON.parse(
      readFileSync('docs/map/viator-start-times.json', 'utf8'),
    ) as { products: Array<{ id: string; status: number; startTimes: string[] }> };

    const expected = new Map(
      evidence.products
        .filter((p) => p.status === 200 && p.startTimes.length > 0)
        .map((p) => [p.id, p.startTimes.join(',')]),
    );
    const actual = new Map(
      Object.entries(SNAPSHOT as Record<string, string[]>).map(([id, t]) => [id, t.join(',')]),
    );

    const missing = [...expected.keys()].filter((id) => !actual.has(id));
    const extra = [...actual.keys()].filter((id) => !expected.has(id));
    const differing = [...expected.entries()]
      .filter(([id, v]) => actual.has(id) && actual.get(id) !== v)
      .map(([id]) => id);

    expect({ missing, extra, differing }).toEqual({ missing: [], extra: [], differing: [] });
  });
});
