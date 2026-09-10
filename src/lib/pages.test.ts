import { describe, it, expect } from 'vitest';
import { PAGE_TO_PATH, PATH_TO_PAGE, PRIVATE_PAGES, type PageId } from './pages';

describe('page identity tables', () => {
  it('round-trips every page through its path', () => {
    for (const page of Object.keys(PAGE_TO_PATH) as PageId[]) {
      const path = PAGE_TO_PATH[page];
      if (page === 'landing') { expect(path).toBe('/'); continue; }
      expect(PATH_TO_PAGE[path]).toBe(page);
    }
  });

  it('maps every non-landing path back to a page that claims it', () => {
    for (const [path, page] of Object.entries(PATH_TO_PAGE)) {
      expect(PAGE_TO_PATH[page]).toBe(path);
    }
  });

  it('lists exactly the per-traveller pages as private', () => {
    expect([...PRIVATE_PAGES].sort()).toEqual(
      ['dashboard', 'itinerary', 'map', 'preview', 'stats'].sort(),
    );
  });

  it('gives every private page a real path', () => {
    for (const page of PRIVATE_PAGES) expect(PAGE_TO_PATH[page]).toMatch(/^\//);
  });
});
