// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import { LOCAL_PICK_ITEM_IDS } from '../data/localPickItems';
import { DEFAULT_ANSWERS } from '../App';

/**
 * A Viator product the owner has vouched for, rendered.
 *
 * The pairing is the point: the "Local pick" mark on the card and the "Local
 * picks" filter read one list, so a card cannot wear the tag and then vanish
 * under the filter that claims it. Both halves are asserted here because
 * nothing else would catch them drifting apart.
 *
 * `37387P3` is the Jolly Pirate afternoon sail — a real id from
 * src/data/localPickItems.ts, so if that list is emptied these tests fail
 * rather than passing over an absence.
 */

const group = (): ViatorGroup => ({
  id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'palm-beach', allowed_slots: [],
});

const item = (id: string, title: string): ViatorItem => ({
  id, group_id: 'sailing-cruises', title, image_url: '', price_usd: 89, duration: '3 hrs',
  rating: 4.6, review_count: 531, viator_item_url: '', is_best_seller: false, display_order: 0,
  sections: ['cruises-water'], adventure: 40, description: '', tags: [11888],
});

const CATALOG: Catalog = {
  groups: [group()],
  items: [
    item('37387P3', 'Aruba Jolly Pirate Afternoon Sail with Snorkeling'),
    item('245504', 'Some Other Catamaran Sail'),
  ],
  activities: [],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({ semanticSearchEnabled: () => false, searchByMeaning: vi.fn() }));

const Explore = (await import('./Explore')).default;

const titles = () => [...document.querySelectorAll('.a-card h3')].map((n) => n.textContent).sort();
const cardFor = (title: string) =>
  [...document.querySelectorAll('.a-card')].find((c) => c.querySelector('h3')?.textContent === title)!;
const openMore = () => fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
const showPill = (name: string) =>
  [...screen.getByRole('group', { name: 'Show' }).querySelectorAll('button')]
    .find((b) => b.textContent === name)!;

beforeEach(() => render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('Explore — a vouched Viator product', () => {
  it('is a real id, not an invented one', () => {
    expect(LOCAL_PICK_ITEM_IDS.has('37387P3')).toBe(true);
    expect(LOCAL_PICK_ITEM_IDS.size).toBeGreaterThan(0);
  });

  it('wears the Local pick mark, and its neighbour does not', () => {
    expect(cardFor('Aruba Jolly Pirate Afternoon Sail with Snorkeling').textContent).toContain('Local pick');
    expect(cardFor('Some Other Catamaran Sail').textContent).not.toContain('Local pick');
  });

  it('is findable under "Local picks"', () => {
    openMore();
    fireEvent.click(showPill('Local picks'));
    expect(titles()).toEqual(['Aruba Jolly Pirate Afternoon Sail with Snorkeling']);
  });

  // The mark says who recommends it, not who sells it — it is still a Viator
  // product and still has to answer to the row that says so.
  it('is still bookable', () => {
    openMore();
    fireEvent.click(showPill('Bookable'));
    expect(titles()).toContain('Aruba Jolly Pirate Afternoon Sail with Snorkeling');
  });
});
