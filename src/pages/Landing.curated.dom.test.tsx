// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Catalog } from '../data/activitySource';
import type { ViatorGroup, ViatorItem } from '../types';
import Landing from './Landing';
import { DEFAULT_ANSWERS } from '../App';

/**
 * The curated-picks band on the landing page.
 *
 * What only a render can answer: that the three hand-vouched products get a
 * card between the hero and the sample section, that each card's Book now is a
 * real affiliate link, and that an id missing from the catalog drops its card
 * silently instead of breaking the band — the contract localPickItems.ts
 * promises for the whole vouched set.
 */

const group = (over: Partial<ViatorGroup> = {}): ViatorGroup => ({
  id: 'g', name: 'Group', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'islandwide',
  allowed_slots: [], ...over,
});

const item = (id: string, title: string, over: Partial<ViatorItem> = {}): ViatorItem => ({
  id, group_id: 'g', title, image_url: '', price_usd: 89, duration: '3 hrs',
  rating: 4.6, review_count: 531, viator_item_url: `https://www.viator.com/x/${id}`,
  is_best_seller: false, display_order: 0, ...over,
});

// Read at render time by the mocked hook, so each test can swap the catalog.
let CATALOG: Catalog = { groups: [group()], items: [], activities: [] };

vi.mock('../data/useCatalog', () => ({ useCatalog: () => ({ catalog: CATALOG, loading: false }) }));

const renderLanding = () =>
  render(<Landing setPage={() => {}} answers={DEFAULT_ANSWERS} setAnswers={() => {}} />);

describe('curated picks band', () => {
  it('renders a card with an affiliate Book now link per curated product', () => {
    CATALOG = {
      groups: [group()],
      items: [
        item('37387P3', 'Aruba Jolly Pirate Afternoon Sail with Snorkeling'),
        item('245508', 'Aruba Sunset Sail with Open Bar'),
        item('6841POOL', 'Aruba Natural Pool and Indian Cave Rugged Jeep Safari'),
        item('OTHER', 'Some Other Tour'), // in the catalog, not in the band
      ],
      activities: [],
    };
    renderLanding();

    expect(screen.getByText('The 3 we never skip.')).toBeInTheDocument();
    expect(screen.getByText('Aruba Jolly Pirate Afternoon Sail with Snorkeling')).toBeInTheDocument();
    expect(screen.getByText('Aruba Sunset Sail with Open Bar')).toBeInTheDocument();
    expect(screen.getByText('Aruba Natural Pool and Indian Cave Rugged Jeep Safari')).toBeInTheDocument();
    expect(screen.queryByText('Some Other Tour')).not.toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: 'Book now' });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.viator.com/x/37387P3?medium=link',
      'https://www.viator.com/x/245508?medium=link',
      'https://www.viator.com/x/6841POOL?medium=link',
    ]);
    for (const a of links) expect(a).toHaveAttribute('target', '_blank');
  });

  it('drops the card of an id that left the catalog, keeps the rest', () => {
    CATALOG = {
      groups: [group()],
      items: [
        item('37387P3', 'Aruba Jolly Pirate Afternoon Sail with Snorkeling'),
        item('6841POOL', 'Aruba Natural Pool and Indian Cave Rugged Jeep Safari'),
      ],
      activities: [],
    };
    renderLanding();
    expect(screen.getAllByRole('link', { name: 'Book now' })).toHaveLength(2);
    expect(screen.queryByText('Aruba Sunset Sail with Open Bar')).not.toBeInTheDocument();
  });

  it('renders no band at all when none of the ids are in the catalog', () => {
    CATALOG = { groups: [group()], items: [item('OTHER', 'Some Other Tour')], activities: [] };
    renderLanding();
    expect(screen.queryByText('The 3 we never skip.')).not.toBeInTheDocument();
  });
});
