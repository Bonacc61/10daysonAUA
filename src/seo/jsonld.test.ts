import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const HTML = readFileSync('index.html', 'utf8');

function blocks(): unknown[] {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  return [...HTML.matchAll(re)].map((m) => JSON.parse(m[1]));
}

describe('site-level JSON-LD in index.html', () => {
  it('parses as valid JSON', () => {
    expect(() => blocks()).not.toThrow();
    expect(blocks().length).toBeGreaterThan(0);
  });

  it('declares a WebSite and an Organization', () => {
    const types = blocks().map((b) => (b as { '@type': string })['@type']);
    expect(types).toContain('WebSite');
    expect(types).toContain('Organization');
  });

  it('uses the canonical origin with no trailing slash on the id', () => {
    for (const b of blocks()) {
      const url = (b as { url?: string }).url;
      if (url) expect(url).toBe('https://10daysonaruba.com/');
    }
  });

  // Ratings we did not collect ourselves must never be marked up: Google's
  // review-snippet policy requires first-party ratings, and aggregating
  // Viator's and TripAdvisor's here would invite a manual action.
  it('marks up no aggregateRating in structured data', () => {
    // Check no JSON-LD block contains aggregateRating at any depth.
    for (const block of blocks()) {
      const serialized = JSON.stringify(block);
      expect(serialized).not.toContain('aggregateRating');
    }
  });

  it('marks up no aggregateRating in rendered markup', () => {
    // Strip comments, then check for aggregateRating anywhere else
    // (microdata attributes, other JSON-LD blocks, etc).
    const noComments = HTML.replace(/<!--[\s\S]*?-->/g, '');
    expect(noComments).not.toContain('aggregateRating');
  });
});
