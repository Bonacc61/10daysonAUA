// The reporting window, which is the one piece of `stats` that can be wrong
// without anything looking wrong. Every number on the dashboard is "over the
// last N days", so a window that silently says 1 when the page asked for 30
// renders a plausible page describing the wrong period — and the tile labels
// would still read "30 days".
//
// Vitest, not Deno.test: a pure function with no Deno surface, same as
// collect/normalise.ts.
import { describe, it, expect } from 'vitest';
import { windowDays, parseWindow, DEFAULT_DAYS } from './window';

describe('stats — the reporting window', () => {
  it('defaults to 30 days when the caller does not ask', () => {
    // The trap in the obvious one-liner: Number(null) is 0, not NaN, so
    // `Math.max(Number(param), 1)` turns "no parameter" into ONE day rather
    // than the default. The page would look fine and cover the wrong period.
    expect(windowDays(null)).toBe(30);
    expect(DEFAULT_DAYS).toBe(30);
  });

  it('takes a number the caller does ask for', () => {
    expect(windowDays('7')).toBe(7);
    expect(windowDays('90')).toBe(90);
    expect(windowDays('1')).toBe(1);
  });

  it('clamps to a range the query can actually serve', () => {
    expect(windowDays('0')).toBe(1);
    expect(windowDays('-5')).toBe(1);
    expect(windowDays('100000')).toBe(365);
  });

  it('falls back to the default for anything that is not a number', () => {
    // This value arrives from a query string, so it is whatever someone typed.
    for (const junk of ['', ' ', 'abc', 'NaN', 'Infinity', '30; drop table web_events', '1e400']) {
      expect(windowDays(junk), JSON.stringify(junk)).toBe(30);
    }
  });

  it('truncates rather than passing a fraction to make_interval', () => {
    expect(windowDays('7.9')).toBe(7);
  });
});

describe('stats — "today" means the UTC calendar day', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 23, h, m, 0));

  it('reaches back to midnight UTC, not 24 hours', () => {
    // The trap: days=1 at 09:00 reaches 09:00 YESTERDAY and mixes two calendar
    // days. It would also disagree with the daily chart above it, because the
    // visitor hash is rebuilt at midnight — someone counted either side of it is
    // two visitors by construction, and a rolling window would count them once.
    const w = parseWindow('today', at(18));
    expect(w.kind).toBe('today');
    // The window is an INSTANT, not a day count — 0.75 of a day would round to 1
    // against stats_summary's `days int` and become the very 24 hours this
    // avoids. stats_summary_since takes the timestamp directly.
    expect(w.since).toBe('2026-08-23T00:00:00.000Z');
    expect(parseWindow('today', at(6)).since).toBe('2026-08-23T00:00:00.000Z');
    expect(parseWindow('today', at(0, 1)).since).toBe('2026-08-23T00:00:00.000Z');
  });

  it('starts at midnight even at 00:00, rather than an empty window', () => {
    expect(parseWindow('today', at(0, 0)).since).toBe('2026-08-23T00:00:00.000Z');
  });

  it('a days window counts back from now', () => {
    expect(parseWindow('7', at(12)).since).toBe('2026-08-16T12:00:00.000Z');
    expect(parseWindow(null, at(12)).since).toBe('2026-07-24T12:00:00.000Z');
  });

  it('accepts the word in any case, and is not confused by the day numbers', () => {
    expect(parseWindow('TODAY', at(12)).kind).toBe('today');
    expect(parseWindow(' Today ', at(12)).kind).toBe('today');
    expect(parseWindow('7', at(12)).days).toBe(7);
    expect(parseWindow(null, at(12)).days).toBe(30);
    // Not "today" — falls through to the number path and its default.
    expect(parseWindow('todayish', at(12))).toMatchObject({ kind: 'days', days: 30 });
  });
});

describe('stats — "best" is the busiest day, and the data picks it', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 7, 29, h, 0, 0));

  it('parses the keyword and carries NO since-instant', () => {
    // The window cannot be expressed from here: which day was busiest is
    // something only the data knows, so index.ts routes 'best' to
    // stats_summary_best_day rather than sending an instant at all.
    const w = parseWindow('best', at(12));
    expect(w.kind).toBe('best');
    expect(w.days).toBe(1);
    expect('since' in w).toBe(false);
  });

  it('accepts the word in any case, like today', () => {
    expect(parseWindow('BEST', at(12)).kind).toBe('best');
    expect(parseWindow(' Best ', at(12)).kind).toBe('best');
  });

  it('a near-miss falls through to the number path and its default', () => {
    expect(parseWindow('bestest', at(12))).toMatchObject({ kind: 'days', days: 30 });
  });
});
