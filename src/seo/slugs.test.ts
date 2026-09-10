import { describe, it, expect } from 'vitest';
import { slugify, slugFor, proposeRegistry, urlFor } from './slugs';

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
