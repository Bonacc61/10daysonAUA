// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import { DEFAULT_ANSWERS } from '../App';

/**
 * The Sail filter and its two pill rows, rendered.
 *
 * `sailPass` is unit-tested in data/exploreItems.test.ts. What only a render can
 * answer is here: that the pills toggle rather than replace each other, that the
 * two rows combine the way the split promises — times widening, on-board
 * narrowing — and that nothing can be left pressed once sailing is switched off.
 *
 * The ids are real ones from src/data/startTimes.json, so the time pills are
 * exercised against the same snapshot production ships:
 *   245504 -> 09:00        245508 -> 17:30        102406P4 -> 09:00, 13:00
 * Tag 11888 is Viator's "sailing", one of the four activityKind reads as a sail.
 */

const group = (): ViatorGroup => ({
  id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'palm-beach', allowed_slots: [],
});

const item = (id: string, title: string, over: Partial<ViatorItem> = {}): ViatorItem => ({
  id, group_id: 'sailing-cruises', title, image_url: '', price_usd: 110, duration: '3 hrs',
  rating: 4.8, review_count: 300, viator_item_url: '', is_best_seller: false, display_order: 0,
  sections: ['cruises-water'], adventure: 40, description: '', tags: [11888], ...over,
});

const CATALOG: Catalog = {
  groups: [group()],
  items: [
    item('245504', 'Morning Snorkel Sail', { description: 'Snorkelling stops and a light brunch on board.' }),
    item('245508', 'Aruba Sunset Sail', { description: 'Open bar as the sun goes down.' }),
    item('102406P4', 'Half Day Private Sailing', { description: 'Two departures, cocktails included.' }),
    // Not a sail: carries no sailing tag, and says every on-board word anyway,
    // so a facet matching on text alone would wrongly keep it.
    item('offroad', 'Aruba Jeep Safari', { tags: [], sections: ['adventures-outdoor'], description: 'Lunch, open bar and snorkelling at the pool.' }),
  ],
  activities: [],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({ semanticSearchEnabled: () => false, searchByMeaning: vi.fn() }));

const Explore = (await import('./Explore')).default;

const openMore = () => fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
const titles = () => [...document.querySelectorAll('.a-card h3')].map((n) => n.textContent).sort();
const sailToggle = () => screen.getByLabelText('Sail') as HTMLInputElement;
const pill = (row: string, name: string) =>
  [...screen.getByRole('group', { name: row }).querySelectorAll('button')]
    .find((b) => b.textContent === name)!;
const when = (name: string) => pill('When', name);
const onboard = (name: string) => pill('On board', name);

beforeEach(() => render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('Explore — the sail filter', () => {
  it('keeps the checkbox and both rows behind "More filters"', () => {
    expect(screen.queryByLabelText('Sail')).not.toBeInTheDocument();
    openMore();
    expect(sailToggle()).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'When' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'On board' })).toBeInTheDocument();
  });

  it('the pills are dead until sailing is on', () => {
    openMore();
    for (const p of ['Morning', 'Afternoon', 'Sunset']) expect(when(p)).toBeDisabled();
    for (const p of ['Food', 'Cocktails', 'Snorkelling']) expect(onboard(p)).toBeDisabled();
  });

  it('narrows to sails, and the jeep does not sneak in on its words', () => {
    openMore();
    expect(titles()).toHaveLength(4);
    fireEvent.click(sailToggle());
    expect(titles()).toEqual(['Aruba Sunset Sail', 'Half Day Private Sailing', 'Morning Snorkel Sail']);
  });

  // The pills are toggles, not a radio group: a second click adds rather than
  // replaces, which is the whole difference from the vehicle row.
  it('holds more than one pill at once', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Morning'));
    fireEvent.click(when('Sunset'));
    expect(when('Morning')).toHaveAttribute('aria-pressed', 'true');
    expect(when('Sunset')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(when('Morning'));
    expect(when('Morning')).toHaveAttribute('aria-pressed', 'false');
  });

  // ANDing three times would ask for a sail that leaves at two of them and
  // return nothing; ORing returns both, which is what a traveller means.
  it('times widen each other', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Morning'));
    expect(titles()).toEqual(['Half Day Private Sailing', 'Morning Snorkel Sail']);
    fireEvent.click(when('Sunset'));
    expect(titles()).toEqual(['Aruba Sunset Sail', 'Half Day Private Sailing', 'Morning Snorkel Sail']);
  });

  it('what is on board narrows, across the rows and within them', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Morning'));
    fireEvent.click(when('Sunset'));
    fireEvent.click(onboard('Snorkelling'));
    expect(titles()).toEqual(['Morning Snorkel Sail']);
    fireEvent.click(onboard('Cocktails'));
    expect(titles()).toEqual([]);
  });

  it('switching sailing off drops the pills with it', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Sunset'));
    expect(titles()).toEqual(['Aruba Sunset Sail']);
    fireEvent.click(sailToggle());
    expect(titles()).toHaveLength(4);
    fireEvent.click(sailToggle());
    expect(when('Sunset')).toHaveAttribute('aria-pressed', 'false');
    expect(titles()).toHaveLength(3);
  });

  it('counts as one filter in the badge, however many pills are on', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Sunset'));
    fireEvent.click(onboard('Cocktails'));
    expect(screen.getByRole('button', { name: /Fewer filters/ })).toHaveTextContent('1 on');
  });

  it('"Clear all filters" switches sailing back off', () => {
    openMore();
    fireEvent.click(sailToggle());
    fireEvent.click(when('Sunset'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(titles()).toHaveLength(4);
    expect(when('Sunset')).toBeDisabled();
  });
});
