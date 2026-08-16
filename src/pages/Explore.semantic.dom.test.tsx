// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import type { Activity } from '../data/activities';
import { DEFAULT_ANSWERS } from '../App';

/**
 * The one path Explore's other dom tests cannot reach.
 *
 * `Explore.dom.test.tsx` mocks `semanticSearchEnabled` to false, so
 * `useSearchBox` never arms, `searchEntries`' unsearched-pool thunk is never
 * invoked, and every assertion about that pool passes whether or not the facet
 * filter is applied to it. Verified by mutation: dropping `byKids` from the
 * thunk left all 64 tests in the two touched files green.
 *
 * That gap is load-bearing rather than theoretical. VITE_SEMANTIC_SEARCH is
 * true in `.env.production`, so this is the live path, and an unfiltered pool
 * would let search-by-meaning resurrect a 16+ product onto a page the traveller
 * has restricted to activities suitable for children.
 */
const group = (): ViatorGroup => ({
  id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'palm-beach', allowed_slots: [],
});
const item = (id: string, title: string, over: Partial<ViatorItem> = {}): ViatorItem => ({
  id, group_id: 'sailing-cruises', title, image_url: '', price_usd: 90, duration: '2 hrs',
  rating: 4.7, review_count: 100, viator_item_url: '', is_best_seller: false, display_order: 0,
  sections: ['cruises-water'], adventure: 40, description: '', ...over,
});
const CATALOG: Catalog = {
  groups: [group()],
  items: [
    // Matches the query by keyword AND suits a child.
    item('family-sail', 'Family Snorkel Sail', { kids: { min_age: 4, baby_ok: true } }),
    // Matches NEITHER keyword — it can only reach the page through the semantic
    // pool — and is 16+. If the pool is unfiltered it appears; if filtered it cannot.
    item('adults-only', 'Deep Water Solo Cliff Session', { kids: { min_age: 16, baby_ok: false } }),
  ],
  activities: [] as Activity[],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({
  semanticSearchEnabled: () => true,
  // Ranks the adults-only product for a query that does not match it by keyword.
  searchByMeaning: vi.fn(async () => ({ ok: true, ids: ['adults-only'], constraint: null })),
}));

const Explore = (await import('./Explore')).default;
const titles = () => [...document.querySelectorAll('.a-card h3')].map((n) => n.textContent);

afterEach(() => { document.body.innerHTML = ''; });

describe('Explore — search-by-meaning cannot bypass the kids filter', () => {
  const setUp = async () => {
    render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />);
    fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
    fireEvent.click(screen.getByLabelText('Good for kids'));
    // Two words arms the semantic layer; Enter runs it.
    const box = screen.getByPlaceholderText('Search beaches, activities, food…');
    fireEvent.change(box, { target: { value: 'family snorkel' } });
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
  };

  it('a meaning-matched 16+ product never reaches a page filtered to kids', async () => {
    await setUp();
    await waitFor(() => expect(titles()).toContain('Family Snorkel Sail'));
    expect(titles()).not.toContain('Deep Water Solo Cliff Session');
  });

  it('and the same product DOES arrive once the filter is off — so the test can fail', async () => {
    await setUp();
    fireEvent.click(screen.getByLabelText('Good for kids'));
    await waitFor(() => expect(titles()).toContain('Deep Water Solo Cliff Session'));
  });
});
