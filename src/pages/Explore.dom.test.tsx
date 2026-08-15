// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import type { Activity } from '../data/activities';
import { DEFAULT_ANSWERS } from '../App';

/**
 * Explore's search box moved into a shared component on 2026-08-14 so My Aruba >
 * Personalized could draw the same one. Nothing rendered this page before that
 * refactor, which meant `tsc` was the only thing standing between a rewire and
 * a broken search on the busiest surface on the site. These tests close that.
 */

const group = (over: Partial<ViatorGroup> = {}): ViatorGroup => ({
  id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'palm-beach',
  allowed_slots: [], ...over,
});

const item = (id: string, title: string, over: Partial<ViatorItem> = {}): ViatorItem => ({
  id, group_id: 'sailing-cruises', title, image_url: '', price_usd: 90, duration: '2 hrs',
  rating: 4.7, review_count: 100, viator_item_url: '', is_best_seller: false, display_order: 0,
  sections: ['cruises-water'], adventure: 40, description: '', ...over,
});

const activity = (id: string, title: string, over: Partial<Activity> = {}): Activity => ({
  id, title, category: 'Beaches', image: '', description: '', localsSay: '', cost: 'Free',
  duration: '2 hrs', timeOfDay: 'Morning', fitReason: '', location: 'Eagle Beach',
  rating: 4.9, reviewCount: 10, adventure: 10, sections: ['beaches'], matched_by: [], ...over,
});

const CATALOG: Catalog = {
  groups: [group()],
  items: [
    // The boat's description mentions seasickness ON PURPOSE, so the query
    // below is a substring HIT on it. Without that the contraindication test
    // below cannot fail: "we get seasick" matches no fixture, so the boat
    // vanishes whether or not anything honours the flag.
    item('boat', 'Catamaran Sunset Sail', { description: 'Open water — bring a remedy if you get seasick.' }),
    item('sub', 'Submarine Dive'),
  ],
  activities: [activity('eagle', 'Eagle Beach Morning Session')],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({ semanticSearchEnabled: () => false, searchByMeaning: vi.fn() }));

const Explore = (await import('./Explore')).default;

const search = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('Search beaches, activities, food…'), { target: { value } });

beforeEach(() => render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('Explore — search after the shared-component refactor', () => {
  it('lists the catalog with the box empty', () => {
    expect(screen.getByText('Catamaran Sunset Sail')).toBeInTheDocument();
    expect(screen.getByText('Eagle Beach Morning Session')).toBeInTheDocument();
  });

  it('filters on what was typed', () => {
    search('submarine');
    expect(screen.getByText('Submarine Dive')).toBeInTheDocument();
    expect(screen.queryByText('Catamaran Sunset Sail')).not.toBeInTheDocument();
  });

  it('still honours a typed contraindication', () => {
    // 'seasick' is BOTH a substring hit on the catamaran's description and a
    // no-boats contraindication. So the boat is in the results and then taken
    // out again — which is the only arrangement where this test can fail if the
    // contraindication layer is removed.
    search('seasick');
    expect(screen.queryByText('Catamaran Sunset Sail')).not.toBeInTheDocument();
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('clears back to the full catalog', () => {
    search('submarine');
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.getByText('Catamaran Sunset Sail')).toBeInTheDocument();
  });
});
