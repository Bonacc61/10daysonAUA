import { describe, it, expect } from 'vitest';
import { sanitise, EMITTABLE } from './parse';
import { EMITTABLE_CONCEPTS } from '../../../src/lib/searchConstraint';

// Only `sanitise` is tested, and deliberately: it is the pure half, and it is
// the half that has to hold when the model misbehaves. `parseConstraint` is a
// network call whose every failure path returns null, which is the behaviour
// asserted by the caller rather than here — npm test must stay offline.

describe('the two vocabularies cannot drift apart', () => {
  it('the parser emits exactly what the filter can act on', () => {
    // A concept the server may emit but the client cannot filter on is a claim
    // nothing acts on. A concept the client can filter on but the server never
    // emits is dead code. Two files, one list — checked, not remembered.
    expect([...EMITTABLE].sort()).toEqual([...EMITTABLE_CONCEPTS].sort());
  });
});

describe('sanitise', () => {
  it('drops a concept outside the vocabulary', () => {
    // `strict: true` on the schema should make this impossible. The filter's
    // safety story rests on it being true rather than assumed — one bad value is
    // an exclusion nobody can see, because nobody sees what they were not shown.
    const out = sanitise({ must: ['beach', 'helicopter'], mustNot: [], residual: 'x' }, 'q');
    expect(out).toEqual({ must: ['beach'], mustNot: [], residual: 'x' });
  });

  it('drops a concept asserted in BOTH directions, from both', () => {
    // A contradiction. Guessing which half was meant is how a filter removes
    // things nobody asked it to remove, so it keeps neither.
    const out = sanitise({ must: ['boat', 'cheap'], mustNot: ['boat'], residual: 'sail' }, 'q');
    expect(out).toEqual({ must: ['cheap'], mustNot: [], residual: 'sail' });
  });

  it('hands the whole query back when nothing was recognised', () => {
    // The no-op fallthrough: this is today's behaviour exactly, not an empty
    // pool. "Arikok" must reach the embedder as "Arikok".
    expect(sanitise({ must: [], mustNot: [], residual: '' }, 'Arikok'))
      .toEqual({ must: [], mustNot: [], residual: 'Arikok' });
  });

  it('de-duplicates', () => {
    const out = sanitise({ must: ['beach', 'beach'], mustNot: [], residual: 'r' }, 'q');
    expect(out!.must).toEqual(['beach']);
  });

  it('returns null on a malformed response rather than a permissive default', () => {
    expect(sanitise({ must: 'beach', mustNot: [] }, 'q')).toBeNull();
    expect(sanitise(null, 'q')).toBeNull();
    expect(sanitise({}, 'q')).toBeNull();
  });

  it('falls back to the original text when residual is missing', () => {
    const out = sanitise({ must: ['cheap'], mustNot: [] }, 'cheap dinner');
    expect(out).toEqual({ must: ['cheap'], mustNot: [], residual: 'cheap dinner' });
  });

  it('keeps a mustNot-only parse, which is the whole point of the layer', () => {
    // "We get seasick" scores 0/3 on the golden set and was a no-op under the
    // alias table. A parse with an empty `must` is not an empty parse.
    const out = sanitise({ must: [], mustNot: ['boat'], residual: '' }, 'we get seasick');
    expect(out).toEqual({ must: [], mustNot: ['boat'], residual: '' });
  });
});
