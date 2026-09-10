import { describe, it, expect } from 'vitest';
import { slugify, slugFor, proposeRegistry, urlFor, mintedIds } from './slugs';

describe('slugify', () => {
  it('lowercases, strips punctuation and joins on hyphens', () => {
    expect(slugify('Jolly Pirates Sail & Snorkel')).toBe('jolly-pirates-sail-snorkel');
  });

  it('folds accents rather than dropping the letters', () => {
    expect(slugify('Café Presto — Aruba')).toBe('cafe-presto-aruba');
  });

  it('collapses runs of separators and trims the ends', () => {
    expect(slugify('  --A  //  B--  ')).toBe('a-b');
  });

  it('never emits an empty slug', () => {
    expect(slugify('!!!')).toBe('activity');
  });
});

describe('slugFor', () => {
  it('returns the registered slug', () => {
    expect(slugFor('245508', { '245508': 'sunset-catamaran-sail' })).toBe('sunset-catamaran-sail');
  });

  it('returns null for an unregistered id rather than inventing one', () => {
    expect(slugFor('999', {})).toBeNull();
  });
});

describe('proposeRegistry', () => {
  it('adds a slug for a new id', () => {
    const r = proposeRegistry([{ id: 'a1', title: 'Sunset Sail' }], {});
    expect(r.a1).toBe('sunset-sail');
  });

  // The invariant: Viator retitles products, and a retitle must never move a URL.
  it('keeps an existing slug even when the title changes completely', () => {
    const r = proposeRegistry(
      [{ id: 'a1', title: 'Completely Different Name Now' }],
      { a1: 'sunset-sail' },
    );
    expect(r.a1).toBe('sunset-sail');
  });

  it('keeps ids that have vanished from the catalog', () => {
    const r = proposeRegistry([{ id: 'a1', title: 'Sunset Sail' }], { gone: 'old-tour' });
    expect(r.gone).toBe('old-tour');
  });

  it('disambiguates two products that slugify identically', () => {
    const r = proposeRegistry(
      [{ id: 'a1', title: 'Sunset Sail' }, { id: 'a2', title: 'Sunset Sail' }],
      {},
    );
    expect(new Set(Object.values(r)).size).toBe(2);
    expect(r.a2).toMatch(/^sunset-sail-/);
  });
});

describe('urlFor', () => {
  it('builds a directory-style path so Apache serves a real file', () => {
    expect(urlFor('sunset-sail', 'things-to-do')).toBe('/things-to-do/sunset-sail/');
  });
});

// The build refuses to mint a URL in CI, because CI cannot commit
// content/slugs.json and a minted-then-discarded slug can be re-minted
// differently after a Viator retitle — a hard 404 on an indexed page. That
// refusal is only as good as this detection, so both directions are asserted.
describe('mintedIds', () => {
  it('reports an id the committed registry has never seen', () => {
    const existing = { a1: 'sunset-sail' };
    const proposed = proposeRegistry(
      [{ id: 'a1', title: 'Sunset Sail' }, { id: 'a2', title: 'Snorkel Trip' }],
      existing,
    );
    expect(mintedIds(existing, proposed)).toEqual(['a2']);
  });

  it('reports nothing when every id was already committed', () => {
    const existing = { a1: 'sunset-sail', a2: 'snorkel-trip' };
    const proposed = proposeRegistry(
      [{ id: 'a1', title: 'Sunset Sail' }, { id: 'a2', title: 'Snorkel Trip' }],
      existing,
    );
    expect(mintedIds(existing, proposed)).toEqual([]);
  });

  // The retitle case: same id, new title, no mint. This is the scenario the
  // whole registry exists for, and calling it a mint would block every deploy
  // that follows a Viator retitle — the most likely false positive there is.
  it('does not call a retitled product a mint', () => {
    const existing = { a1: 'sunset-sail' };
    const proposed = proposeRegistry([{ id: 'a1', title: 'Completely New Name' }], existing);
    expect(proposed.a1).toBe('sunset-sail');
    expect(mintedIds(existing, proposed)).toEqual([]);
  });

  it('treats an empty registry as minting everything', () => {
    const proposed = proposeRegistry([{ id: 'a1', title: 'Sunset Sail' }], {});
    expect(mintedIds({}, proposed)).toEqual(['a1']);
  });
});
