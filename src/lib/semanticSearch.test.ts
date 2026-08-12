import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseSearchBody, normaliseQuery, MAX_QUERY_CHARS } from './semanticSearch';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('normaliseQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(normaliseQuery('  good   with a  toddler ')).toBe('good with a toddler');
  });

  it('truncates to the same cap the edge function enforces', () => {
    expect(normaliseQuery('x'.repeat(MAX_QUERY_CHARS + 50)).length).toBe(MAX_QUERY_CHARS);
  });

  it('returns an empty string for whitespace only', () => {
    expect(normaliseQuery('   ')).toBe('');
  });
});

describe('parseSearchBody — the trust boundary', () => {
  it('extracts ids in the order given', () => {
    const body = { results: [{ id: 'a', score: 0.8 }, { id: 'b', score: 0.5 }] };
    expect(parseSearchBody(body)).toEqual(['a', 'b']);
  });

  it('returns an empty list for a genuinely empty result set', () => {
    expect(parseSearchBody({ results: [] })).toEqual([]);
  });

  it('returns null — not [] — for a malformed body, so the caller can tell failure from no-matches', () => {
    expect(parseSearchBody(null)).toBeNull();
    expect(parseSearchBody({})).toBeNull();
    expect(parseSearchBody({ results: 'nope' })).toBeNull();
    expect(parseSearchBody({ error: 'rate_limited' })).toBeNull();
  });

  it('skips entries with no usable id rather than emitting undefined', () => {
    const body = { results: [{ id: 'a' }, { score: 1 }, { id: '' }, { id: 'b' }] };
    expect(parseSearchBody(body)).toEqual(['a', 'b']);
  });

  it('never throws on a hostile body', () => {
    for (const bad of [undefined, 0, 'string', [], { results: [null, 1, 'x'] }]) {
      expect(() => parseSearchBody(bad)).not.toThrow();
    }
  });
});
