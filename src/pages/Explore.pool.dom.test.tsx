// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import { DEFAULT_ANSWERS } from '../App';

/**
 * The Natural Pool filter and its vehicle row, rendered.
 *
 * Its own file rather than another block in Explore.dom.test.tsx because this
 * needs a catalog of pool products, and that file's tests count the whole
 * fixture ("the whole catalog is 3 tiles"). A second catalog there would have
 * meant editing assertions that are about something else.
 *
 * `poolPass` itself is unit-tested in data/exploreItems.test.ts. What is pinned
 * here is the part only a render can answer: that the checkbox and its pill row
 * exist, that the pills cannot be used before the pool is on, and that a vehicle
 * which cannot reach it is visibly dead rather than silently empty.
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
    // Names the POOL only in its description — 6 of the 28 live ones are like
    // this — while naming its VEHICLE in the title, which is the split poolPass
    // relies on.
    item('hike', 'Arikok Sunrise Hike', { description: 'A guided route through Arikok, ending with a swim at the Natural Pool.' }),
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
// The row carries no visible heading — the checkbox above names the filter —
// so its accessible name is the one the group tag supplies.
const vehicle = (name: string) =>
  [...screen.getByRole('group', { name: 'Natural Pool' }).querySelectorAll('button')]
    .find((b) => b.textContent === name)!;
// "Any" carries the filter's on/off: pressed it means every pool trip, pressed
// again while it is the state it switches the filter off.
const poolToggle = () => vehicle('Any');

beforeEach(() => render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('Explore — the pool filter', () => {
  it('keeps the row behind "More filters", under a heading like the others', () => {
    expect(screen.queryByRole('group', { name: 'Natural Pool' })).not.toBeInTheDocument();
    openMore();
    expect(screen.getByRole('group', { name: 'Natural Pool' })).toBeInTheDocument();
    const headings = [...document.getElementById('explore-more-filters')!.querySelectorAll('h4')]
      .map((h) => h.textContent);
    expect(headings).toContain('Natural Pool');
  });

  // No checkbox to press first: with the filter off every vehicle is live, and
  // pressing one turns the filter on around it.
  it('a vehicle can be pressed straight from off', () => {
    openMore();
    for (const v of ['Any', 'Jeep', 'UTV', 'ATV', 'Horseback', 'Hike']) {
      expect(vehicle(v)).toBeEnabled();
      expect(vehicle(v)).toHaveAttribute('aria-pressed', 'false');
    }
    fireEvent.click(vehicle('Jeep'));
    expect(vehicle('Jeep')).toHaveAttribute('aria-pressed', 'true');
    expect(titles()).toEqual(['Aruba Jeep Safari: Natural Pool and Baby Beach']);
  });

  it('the pool narrows the page to what actually goes to one', () => {
    openMore();
    expect(titles()).toHaveLength(4);
    fireEvent.click(poolToggle());
    // The catamaran is the only tile that reaches no pool; the ATV run reaches
    // the Cave Pool, which this one filter covers.
    expect(titles().sort()).toEqual([
      'Arikok Sunrise Hike',
      'Aruba Jeep Safari: Natural Pool and Baby Beach',
      'Aruba North Coast ATV Desert Adventure',
    ]);
  });

  // Every vehicle in the fixture reaches a pool, so none is greyed — the row
  // only greys what nothing answers to.
  it('greys only the vehicles nothing answers to', () => {
    openMore();
    fireEvent.click(poolToggle());
    expect(vehicle('Jeep')).toBeEnabled();
    expect(vehicle('Hike')).toBeEnabled();
    expect(vehicle('ATV')).toBeEnabled();
    expect(vehicle('UTV')).toBeDisabled();
    expect(vehicle('Horseback')).toBeDisabled();
  });

  it('a vehicle narrows within the pool', () => {
    openMore();
    fireEvent.click(poolToggle());
    fireEvent.click(vehicle('Hike'));
    expect(titles()).toEqual(['Arikok Sunrise Hike']);
  });

  // Pressing the active vehicle widens back to every pool trip; pressing Any
  // while it is the state switches the filter off entirely. Both directions
  // matter, because "Any" is the only way off.
  it('walks off -> any -> vehicle -> any -> off', () => {
    openMore();
    fireEvent.click(vehicle('Any'));
    expect(titles()).toHaveLength(3);
    fireEvent.click(vehicle('Jeep'));
    expect(titles()).toEqual(['Aruba Jeep Safari: Natural Pool and Baby Beach']);
    fireEvent.click(vehicle('Jeep'));
    expect(vehicle('Any')).toHaveAttribute('aria-pressed', 'true');
    expect(titles()).toHaveLength(3);
    fireEvent.click(vehicle('Any'));
    expect(vehicle('Any')).toHaveAttribute('aria-pressed', 'false');
    expect(titles()).toHaveLength(4);
  });

  // The pool and its vehicle are one narrowing, not two — the vehicle cannot
  // narrow anything on its own.
  it('counts as one filter in the "More filters" badge', () => {
    openMore();
    fireEvent.click(poolToggle());
    // The button reads "Fewer filters" once the panel is open.
    expect(screen.getByRole('button', { name: /Fewer filters/ })).toHaveTextContent('1 on');
    fireEvent.click(vehicle('Jeep'));
    expect(screen.getByRole('button', { name: /Fewer filters/ })).toHaveTextContent('1 on');
  });

  // A vehicle the traveller CHOSE must never go dead: another filter can drive
  // its count to zero, and a pressed-and-disabled pill narrows a page with no
  // way left to widen it.
  it('never disables the vehicle currently chosen', () => {
    openMore();
    fireEvent.click(poolToggle());
    fireEvent.click(vehicle('Hike'));
    expect(titles()).toEqual(['Arikok Sunrise Hike']);

    // Nothing in the fixture runs under 2 hours, so the pool set empties.
    fireEvent.click(screen.getByRole('button', { name: 'Under 2h' }));
    expect(titles()).toHaveLength(0);
    expect(vehicle('Hike')).toBeEnabled();
    expect(vehicle('Hike')).toHaveAttribute('aria-pressed', 'true');
    expect(vehicle('Any')).toBeEnabled();
    // And nothing else greys either: an empty set is not evidence about any one
    // vehicle's supply, so the row stops claiming things about the park.
    expect(vehicle('Jeep')).toBeEnabled();
    expect(screen.queryByText(/do not reach this pool/)).not.toBeInTheDocument();
  });

  // `disabled` takes a button out of the tab order and announces nothing, so
  // the reason a vehicle is dead has to be readable text.
  it('says which vehicles reach no pool in the catalog', () => {
    openMore();
    fireEvent.click(poolToggle());
    expect(screen.getByText('UTV and Horseback tours do not reach this pool.')).toBeInTheDocument();
  });

  // With sailing also on the intersection is empty, and greying every vehicle
  // would blame Arikok for a page the other filter emptied.
  it('does not grey the row when another filter has already emptied the page', () => {
    openMore();
    fireEvent.click(poolToggle());
    fireEvent.click([...screen.getByRole('group', { name: 'Sail' }).querySelectorAll('button')]
      .find((b) => b.textContent === 'Any')!);
    expect(titles()).toHaveLength(0);
    expect(vehicle('Jeep')).toBeEnabled();
    expect(screen.queryByText(/do not reach this pool/)).not.toBeInTheDocument();
  });

  it('"Clear all filters" switches the pool back off', () => {
    openMore();
    fireEvent.click(poolToggle());
    expect(titles()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(titles()).toHaveLength(4);
    expect(vehicle('Any')).toHaveAttribute('aria-pressed', 'false');
  });
});
