// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import { DEFAULT_ANSWERS } from '../App';

/**
 * The Natural Pool / Cave Pool rows, rendered.
 *
 * Its own file rather than another block in Explore.dom.test.tsx because this
 * needs a catalog of pool products, and that file's tests count the whole
 * fixture ("the whole catalog is 3 tiles"). A second catalog there would have
 * meant editing assertions that are about something else.
 *
 * `poolPass` itself is unit-tested in data/exploreItems.test.ts. What is pinned
 * here is the part only a render can answer: that the two rows exist, that the
 * vehicle row cannot be used before a pool is chosen, and that a vehicle which
 * cannot reach the chosen pool is visibly dead rather than silently empty.
 */

const group = (over: Partial<ViatorGroup> = {}): ViatorGroup => ({
  id: 'offroad-tours', name: 'Off-Road Tours', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'islandwide',
  allowed_slots: [], ...over,
});

const item = (id: string, title: string, over: Partial<ViatorItem> = {}): ViatorItem => ({
  id, group_id: 'offroad-tours', title, image_url: '', price_usd: 120, duration: '4 hrs',
  rating: 4.6, review_count: 200, viator_item_url: '', is_best_seller: false, display_order: 0,
  sections: ['adventures-outdoor'], adventure: 70, description: '', ...over,
});

const CATALOG: Catalog = {
  groups: [group()],
  items: [
    item('jeep', 'Aruba Jeep Safari: Natural Pool and Baby Beach'),
    // Says Conchi only in its DESCRIPTION — 6 of the 28 live ones are like this,
    // and matching titles alone would drop every one of them.
    item('hike', 'Arikok Sunrise Walk', { description: 'A guided hiking route through Arikok, ending with a swim at the Natural Pool.' }),
    // The cave is the other place, and the only one a quad can reach: Arikok
    // bars ATVs, which is why the ATV button must go dead under Natural Pool.
    item('atv', 'Aruba North Coast ATV Desert Adventure', { description: 'End the trip with a dip at the Cave Pool.' }),
    item('sail', 'Catamaran Sunset Sail', { group_id: 'offroad-tours', sections: ['cruises-water'], adventure: 30 }),
  ],
  activities: [],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({ semanticSearchEnabled: () => false, searchByMeaning: vi.fn() }));

const Explore = (await import('./Explore')).default;

const openMore = () => fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
const titles = () => [...document.querySelectorAll('.a-card h3')].map((n) => n.textContent);
const vehicle = (name: string) =>
  [...screen.getByRole('group', { name: 'Getting there' }).querySelectorAll('button')]
    .find((b) => b.textContent === name)!;
const place = (name: string) =>
  [...screen.getByRole('group', { name: 'Natural pool' }).querySelectorAll('button')]
    .find((b) => b.textContent === name)!;

beforeEach(() => render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('Explore — the pool filter', () => {
  it('keeps both rows behind "More filters"', () => {
    expect(screen.queryByRole('group', { name: 'Natural pool' })).not.toBeInTheDocument();
    openMore();
    expect(screen.getByRole('group', { name: 'Natural pool' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Getting there' })).toBeInTheDocument();
  });

  it('the vehicle row is dead until a pool is chosen', () => {
    openMore();
    for (const v of ['Jeep', 'UTV', 'ATV', 'Horseback', 'Hike']) {
      expect(vehicle(v)).toBeDisabled();
    }
  });

  it('a pool narrows the page to what actually goes there', () => {
    openMore();
    expect(titles()).toHaveLength(4);
    fireEvent.click(place('Natural Pool'));
    expect(titles().sort()).toEqual(['Arikok Sunrise Walk', 'Aruba Jeep Safari: Natural Pool and Baby Beach']);
    fireEvent.click(place('Cave Pool'));
    expect(titles()).toEqual(['Aruba North Coast ATV Desert Adventure']);
  });

  // The whole reason the two pools are separate chips: Arikok bars the quads,
  // so under Natural Pool the ATV button is not empty by accident.
  it('greys the vehicles that cannot reach the chosen pool', () => {
    openMore();
    fireEvent.click(place('Natural Pool'));
    expect(vehicle('Jeep')).toBeEnabled();
    expect(vehicle('Hike')).toBeEnabled();
    expect(vehicle('ATV')).toBeDisabled();

    fireEvent.click(place('Cave Pool'));
    expect(vehicle('ATV')).toBeEnabled();
    expect(vehicle('Hike')).toBeDisabled();
  });

  it('a vehicle narrows within the pool', () => {
    openMore();
    fireEvent.click(place('Natural Pool'));
    fireEvent.click(vehicle('Hike'));
    expect(titles()).toEqual(['Arikok Sunrise Walk']);
  });

  // Otherwise switching pool keeps a vehicle that cannot reach the new one, and
  // the page empties for a reason nothing on screen explains.
  it('switching pool resets the vehicle', () => {
    openMore();
    fireEvent.click(place('Natural Pool'));
    fireEvent.click(vehicle('Jeep'));
    expect(vehicle('Jeep')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(place('Cave Pool'));
    expect(vehicle('Any')).toHaveAttribute('aria-pressed', 'true');
    expect(titles()).toEqual(['Aruba North Coast ATV Desert Adventure']);
  });

  // The pool and its vehicle are one narrowing, not two — the vehicle cannot
  // narrow anything on its own.
  it('counts as one filter in the "More filters" badge', () => {
    openMore();
    fireEvent.click(place('Natural Pool'));
    // The button reads "Fewer filters" once the panel is open.
    expect(screen.getByRole('button', { name: /Fewer filters/ })).toHaveTextContent('1 on');
    fireEvent.click(vehicle('Jeep'));
    expect(screen.getByRole('button', { name: /Fewer filters/ })).toHaveTextContent('1 on');
  });

  it('"Clear all filters" puts the pool back to Any', () => {
    openMore();
    fireEvent.click(place('Natural Pool'));
    expect(titles()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(titles()).toHaveLength(4);
    expect(vehicle('Jeep')).toBeDisabled();
  });
});
