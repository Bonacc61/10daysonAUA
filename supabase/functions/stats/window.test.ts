// The reporting window, which is the one piece of `stats` that can be wrong
// without anything looking wrong. Every number on the dashboard is "over the
// last N days", so a window that silently says 1 when the page asked for 30
// renders a plausible page describing the wrong period — and the tile labels
// would still read "30 days".
//
// Vitest, not Deno.test: a pure function with no Deno surface, same as
// collect/normalise.ts.
import { describe, it, expect } from 'vitest';
import { windowDays, DEFAULT_DAYS } from './window';

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
