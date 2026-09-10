// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import { DEFAULT_ANSWERS } from '../App';

/**
 * The splurge end of the Price slider, rendered.
 *
 * `rankSplurge` is unit-tested in data/exploreItems.test.ts. What only a render
 * can answer is the seam between the slider and the sort: `Explore.tsx` passes
 * `price` into the sort context by shorthand, and `price: vibe` would compile
 * and pass every unit test in the repo. This file is the thing that fails.
 *
 * Its own fixture, because the shared one in Explore.dom.test.tsx carries a
 * single item over $100 — and at max splurge nothing under that survives
 * `pricePass`, so there would be one card and no order to check.
 *
 * Every item here is priced to clear the splurge filter (`priceValue` 90, i.e.
 * over $100), and carries `adventure: 20` so it also clears `vibePass` at max
 * chill — the combination the owner reported against. The pair at $400 is the
 * point of the fixture: half the entries on the real max-splurge page share a
 * price with another, so the tiebreak decides most of the page, and it must be
 * the recommended ranking rather than the incoming house order.
 */

const group = (): ViatorGroup => ({
  id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'palm-beach', allowed_slots: [],
});

const item = (id: string, title: string, over: Partial<ViatorItem> = {}): ViatorItem => ({
  id, group_id: 'sailing-cruises', title, image_url: '', price_usd: 400, duration: '3 hrs',
  rating: 4.6, review_count: 200, viator_item_url: '', is_best_seller: false, display_order: 0,
  sections: ['cruises-water'], adventure: 20, description: '', tags: [11888], ...over,
});

const CATALOG: Catalog = {
  groups: [group()],
  items: [
    // Deliberately NOT in price order.
    item('mid', 'Mid Charter', { price_usd: 900 }),
    item('cheap', 'Cheapest Charter', { price_usd: 150 }),
    item('top', 'Priciest Charter', { price_usd: 2400 }),
    // The tie, and the two orders must DISAGREE on it or the test cannot fail.
    // House order is `sortScore` = (is_best_seller ? 2 : 0) + rating, so the
    // flag puts `weak` first at 6.0 against `strong`'s 4.9. The recommended
    // ranking reads the flag as meaningless and the review count as real, so it
    // puts `strong` first. An earlier version of this fixture gave `weak` no
    // flag, which left both orders agreeing and the tie test unable to fail.
    item('weak', 'Tied Weak Charter', { rating: 4.0, review_count: 5, is_best_seller: true }),
    item('strong', 'Tied Strong Charter', { rating: 4.9, review_count: 900 }),
  ],
  activities: [],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({ semanticSearchEnabled: () => false, searchByMeaning: vi.fn() }));

const Explore = (await import('./Explore')).default;

// Order matters here, so NOT sorted — unlike the sibling files, which compare sets.
const titles = () => [...document.querySelectorAll('.a-card h3')].map((n) => n.textContent);
const slider = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const setSlider = (label: string, value: number) =>
  fireEvent.change(slider(label), { target: { value: String(value) } });

beforeEach(() => render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('Explore — the splurge end of the Price slider', () => {
  it('leads with the most expensive once the slider is at the top', () => {
    setSlider('Price', 100);
    expect(titles()).toEqual([
      'Priciest Charter', 'Mid Charter', 'Tied Strong Charter', 'Tied Weak Charter', 'Cheapest Charter',
    ]);
  });

  it('breaks a price tie on the recommended ranking, not the house order', () => {
    // Both at $400. The house order puts `weak` first; only ranking before
    // sorting flips it. Half the real max-splurge page rides on this.
    setSlider('Price', 100);
    const order = titles();
    expect(order.indexOf('Tied Strong Charter')).toBeLessThan(order.indexOf('Tied Weak Charter'));
  });

  it('reads the PRICE slider, not the Vibe slider', () => {
    // The seam this file exists for: `price: vibe` in Explore.tsx would compile,
    // pass every unit test, and fail exactly here.
    //
    // Vibe moves alone first, with Price left at its default 50. The length
    // assertions are load-bearing: every item is adventure 20, so a wrong vibe
    // would empty the grid and `titles()[0]` would be undefined, which passes
    // `not.toBe` for the wrong reason.
    setSlider('Vibe', 0);
    expect(titles()).toHaveLength(5);
    expect(titles()[0]).not.toBe('Priciest Charter');
    setSlider('Price', 100);
    expect(titles()).toHaveLength(5);
    expect(titles()[0]).toBe('Priciest Charter');
  });

  it('hands the order back to an explicit Sort choice', () => {
    setSlider('Price', 100);
    fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'price-asc' } });
    expect(titles()[0]).toBe('Cheapest Charter');
  });

  it('leaves the order alone one step below the top', () => {
    setSlider('Price', 99);
    expect(titles()).toHaveLength(5);
    expect(titles()[0]).not.toBe('Priciest Charter');
  });
});
