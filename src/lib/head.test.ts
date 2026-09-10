import { describe, it, expect } from 'vitest';
import { pageMeta, sharedItineraryMeta, ORIGIN } from './head';
import { PAGE_TO_PATH, PRIVATE_PAGES, type PageId } from './pages';

const ALL = Object.keys(PAGE_TO_PATH) as PageId[];

describe('pageMeta', () => {
  it('gives every page a distinct, non-empty title', () => {
    const titles = ALL.map((p) => pageMeta(p).title);
    for (const t of titles) expect(t.length).toBeGreaterThan(10);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('gives every page a description within the length search engines show', () => {
    for (const p of ALL) {
      const d = pageMeta(p).description;
      expect(d.length).toBeGreaterThan(50);
      expect(d.length).toBeLessThanOrEqual(160);
    }
  });

  it('builds the canonical from the origin and the route path', () => {
    expect(pageMeta('landing').canonical).toBe(`${ORIGIN}/`);
    expect(pageMeta('explore').canonical).toBe(`${ORIGIN}/explore`);
  });

  it('marks every private page noindex', () => {
    for (const p of PRIVATE_PAGES) expect(pageMeta(p).index).toBe(false);
  });

  it('marks the public pages indexable', () => {
    for (const p of ['landing', 'explore', 'questionnaire', 'privacy', 'terms', 'surprise'] as PageId[]) {
      expect(pageMeta(p).index).toBe(true);
    }
  });
});

describe('sharedItineraryMeta', () => {
  // A shared itinerary is one traveller's trip at a guessable public URL. It
  // must never enter a search index, however widely the link gets posted.
  it('is never indexable', () => {
    expect(sharedItineraryMeta('abc123').index).toBe(false);
  });

  it('canonicalises to its own share URL', () => {
    expect(sharedItineraryMeta('abc123').canonical).toBe(`${ORIGIN}/i/abc123`);
  });

  it('never puts the share id in the title or description', () => {
    const m = sharedItineraryMeta('abc123');
    expect(m.title).not.toContain('abc123');
    expect(m.description).not.toContain('abc123');
  });
});
