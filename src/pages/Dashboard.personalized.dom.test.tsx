// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import type { Activity } from '../data/activities';
import { DEFAULT_ANSWERS } from '../App';

/**
 * My Aruba > Personalized draws the SAME search box as Explore. These render it
 * against a small catalog and check the two things that make it the same box
 * rather than a lookalike: it filters, and it honours a contraindication the
 * traveller types.
 *
 * The panel's own promise is the third thing under test — its heading says
 * everything below matches your profile, so an unmatched activity must not
 * arrive through the search either.
 */

const group = (over: Partial<ViatorGroup> = {}): ViatorGroup => ({
  id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: ['couple'], region: 'palm-beach',
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
    // Both mention seasickness so the query below is a substring HIT on each,
    // and the contraindication is what removes them. Without that the test
    // passes even with the whole flag layer deleted, because "we get seasick"
    // matches no fixture and everything disappears anyway.
    item('boat', 'Catamaran Sunset Sail', { description: 'Open water — bring a remedy if you get seasick.' }),
    item('sub', 'Submarine Dive', { description: 'Descends gently; rarely leaves anyone seasick.' }),
  ],
  activities: [activity('eagle', 'Eagle Beach Morning Session')],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({
  semanticSearchEnabled: () => false,
  searchByMeaning: vi.fn(),
}));

const { PersonalizedPanel } = await import('./Dashboard');

const TRIP = {
  answers: { ...DEFAULT_ANSWERS, groupType: 'Couple', budget: 'Mid-range', interests: ['Beach & chill'] },
  plan: [], rejected: new Set<string>(), rejectedGroups: new Set<string>(),
};

const search = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('Search your matches…'), { target: { value } });

beforeEach(() => render(<PersonalizedPanel setPage={() => {}} trip={TRIP} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('My Aruba > Personalized — the search box', () => {
  it('is drawn on the panel', () => {
    expect(screen.getByPlaceholderText('Search your matches…')).toBeInTheDocument();
  });

  it('narrows the matches to what was typed', () => {
    expect(screen.getByText('Catamaran Sunset Sail')).toBeInTheDocument();
    expect(screen.getByText('Submarine Dive')).toBeInTheDocument();
    search('submarine');
    expect(screen.queryByText('Catamaran Sunset Sail')).not.toBeInTheDocument();
    expect(screen.getByText('Submarine Dive')).toBeInTheDocument();
  });

  it('honours a contraindication the traveller types, exactly as Explore does', () => {
    // "we get seasick" is the golden set's worst case for similarity alone —
    // the sentence embeds next to the very boats it rules out — so the same
    // parser the questionnaire uses excludes them here instead.
    search('seasick');
    expect(screen.queryByText('Catamaran Sunset Sail')).not.toBeInTheDocument();
    expect(screen.queryByText('Submarine Dive')).not.toBeInTheDocument();
  });

  it('says the count covers the search as well as the profile', () => {
    search('submarine');
    expect(screen.getByText(/matched to your profile and your search/)).toBeInTheDocument();
  });

  it('explains an empty result caused by the search, not by the sliders', () => {
    search('helicopter');
    expect(screen.getByText(/Nothing among your matches for that search/)).toBeInTheDocument();
  });
});
