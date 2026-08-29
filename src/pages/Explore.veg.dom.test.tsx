// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup } from '../types';
import { LUNCHSPOTS } from '../data/lunchspots';
import { DEFAULT_ANSWERS } from '../App';

/**
 * The vegetarian V on an Explore lunch tile.
 *
 * The itinerary card asserts the mark separately (ItineraryCard.dom.test.tsx);
 * this covers the OTHER render site, because a regression in either one is
 * invisible from the other. Real spots from LUNCHSPOTS, so a renamed id fails
 * here rather than quietly testing an invented restaurant: Bingo! has a
 * dedicated vegetarian menu section (bingoaruba.com, verified 2026-08-29);
 * Pika's Corner is exactly the case the mark must NOT overreach to — probably
 * fine for vegetarians, but the evidence is one review mention, and the list
 * only admits menus that can be read.
 */

const group = (): ViatorGroup => ({
  id: 'sailing-cruises', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'palm-beach', allowed_slots: [],
});

const spot = (id: string) => LUNCHSPOTS.find((l) => l.id === id)!;

const CATALOG: Catalog = {
  groups: [group()],
  items: [],
  activities: [],
  lunchspots: [spot('lunch-bingo'), spot('lunch-pikas-corner')],
};

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));
vi.mock('../lib/shortlist', () => ({ useShortlist: () => ({ shortlist: new Set<string>(), toggle: () => {} }) }));
vi.mock('../lib/semanticSearch', () => ({ semanticSearchEnabled: () => false, searchByMeaning: vi.fn() }));

const Explore = (await import('./Explore')).default;

const cardFor = (title: string) =>
  [...document.querySelectorAll('.a-card')].find((c) => c.querySelector('h3')?.textContent === title)!;

beforeEach(() => render(<Explore setPage={() => {}} answers={DEFAULT_ANSWERS} canSeeItinerary={false} />));
afterEach(() => { document.body.innerHTML = ''; });

describe('Explore — the vegetarian V on lunch tiles', () => {
  it('marks a spot with a verified vegetarian menu, in words too', () => {
    const card = cardFor('Bingo!');
    const mark = card.querySelector('[aria-label="Vegetarian options"]');
    expect(mark).toBeTruthy();
    expect(mark!.getAttribute('role')).toBe('img');
  });

  it('leaves a review-mention-only spot unmarked', () => {
    expect(cardFor("Pika's Corner").querySelector('[aria-label="Vegetarian options"]')).toBeNull();
  });
});
