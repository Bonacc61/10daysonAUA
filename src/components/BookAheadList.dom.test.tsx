// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BookAheadList from './BookAheadList';
import type { Activity } from '../data/activities';
import type { CardEntry, SlotEntry, ViatorGroup, ViatorItem } from '../types';
import type { PlannedDay } from '../data/itineraryPlan';

// The panel must apply the SAME bookability rules as ItineraryCard, so the
// fixtures cover each branch: a Viator group (bookable), a paid activity with
// an affiliate url (bookable), a free activity (not), and a lunch spot with no
// link (not).

const group: ViatorGroup = {
  id: 'sailing', name: 'Sailing & Cruises', tagline: '', viator_taxonomy: '',
  viator_group_url: '', display_order: 0, matched_by: [], region: 'islandwide',
  allowed_slots: [],
};

const sellOutItem: ViatorItem = {
  id: '444239P2', group_id: 'sailing', title: 'Antilla Shipwreck Sail & Snorkel',
  image_url: '', price_usd: 79, duration: '3 hrs', rating: 4.8, review_count: 900,
  viator_item_url: 'https://www.viator.com/tours/Aruba/Antilla/d28-444239P2?pid=P00302487&mcid=42383&medium=link',
  is_best_seller: true, display_order: 0, sections: ['cruises-water'],
  flags: ['LIKELY_TO_SELL_OUT', 'FREE_CANCELLATION'],
};

const baseActivity = {
  localsSay: '', timeOfDay: 'Morning' as const, rating: 0, reviewCount: 0,
  matched_by: [], description: '', image: '', fitReason: '',
};

const paidActivity: Activity = {
  ...baseActivity,
  id: 'wreck-dive', title: 'Antilla Wreck Dive', category: 'Watersports',
  location: 'Malmok', duration: '2 hrs', cost: '$95 pp', sections: ['cruises-water'],
  viator_item_url: 'https://www.viator.com/tours/Aruba/Dive/d28-5913P4?pid=P00302487&mcid=42383&medium=link',
} as Activity;

const freeActivity: Activity = {
  ...baseActivity,
  id: 'baby-beach', title: 'Baby Beach', category: 'Beaches', location: 'Seroe Colorado',
  duration: 'Half day', cost: 'Free', sections: ['beaches'],
} as Activity;

const lunchSpot: Activity = {
  ...baseActivity,
  id: 'zeerovers', title: 'Zeerovers', category: 'Food', location: 'Savaneta',
  duration: '1 hr', cost: '$15 pp', sections: ['food-drink'],
} as Activity;

const ENTRIES: Record<string, CardEntry> = {
  'g:sail': { kind: 'group', group, bestSeller: sellOutItem, others: [] },
  'a:dive': { kind: 'activity', activity: paidActivity },
  'a:beach': { kind: 'activity', activity: freeActivity },
  'a:lunch': { kind: 'activity', activity: lunchSpot },
};

function resolveEntry(e: SlotEntry): CardEntry | null {
  const key = e.kind === 'group' ? `g:${e.groupId}` : `a:${e.id}`;
  return ENTRIES[key] ?? null;
}

function planWith(): PlannedDay[] {
  return [
    { day: 1, title: 'Beaches', color: '', morning: [{ uid: 'u1', entry: { kind: 'activity', id: 'beach' } }],
      afternoon: [{ uid: 'u2', entry: { kind: 'group', groupId: 'sail', bestSellerId: '444239P2' } }], evening: [] },
    { day: 3, title: 'Watersports', color: '', morning: [{ uid: 'u3', entry: { kind: 'activity', id: 'dive' } }],
      afternoon: [{ uid: 'u4', entry: { kind: 'activity', id: 'lunch' } }], evening: [] },
  ];
}

describe('BookAheadList', () => {
  it('lists exactly the bookable picks with day and price', () => {
    render(<BookAheadList plan={planWith()} resolveEntry={resolveEntry} bookedIds={new Set()} />);
    expect(screen.getByText('Antilla Shipwreck Sail & Snorkel')).toBeTruthy();
    expect(screen.getByText('Antilla Wreck Dive')).toBeTruthy();
    // Free beach and linkless lunch spot must not appear.
    expect(screen.queryByText('Baby Beach')).toBeNull();
    expect(screen.queryByText('Zeerovers')).toBeNull();
    // Day chips and prices.
    expect(screen.getByText('Day 1')).toBeTruthy();
    expect(screen.getByText('Day 3')).toBeTruthy();
    expect(screen.getByText('$79 pp')).toBeTruthy();
    expect(screen.getByText('$95 pp')).toBeTruthy();
  });

  it('links carry the affiliate params unchanged', () => {
    render(<BookAheadList plan={planWith()} resolveEntry={resolveEntry} bookedIds={new Set()} />);
    const links = screen.getAllByRole('link', { name: /book/i });
    expect(links.length).toBe(2);
    for (const l of links) {
      expect(l.getAttribute('href')).toContain('pid=P00302487');
      expect(l.getAttribute('href')).toContain('mcid=42383');
    }
  });

  it("shows Viator's sell-out flag only where they assert it", () => {
    render(<BookAheadList plan={planWith()} resolveEntry={resolveEntry} bookedIds={new Set()} />);
    expect(screen.getAllByText(/likely to sell out/i).length).toBe(1);
  });

  it('renders a booked row as done, without a Book link', () => {
    render(<BookAheadList plan={planWith()} resolveEntry={resolveEntry} bookedIds={new Set(['u2'])} />);
    expect(screen.getByText(/✓ booked/i)).toBeTruthy();
    // Only the dive still links out.
    expect(screen.getAllByRole('link', { name: /book/i }).length).toBe(1);
  });

  it('renders nothing when the plan holds no bookables', () => {
    const plan: PlannedDay[] = [{ day: 1, title: 'Beaches', color: '',
      morning: [{ uid: 'u1', entry: { kind: 'activity', id: 'beach' } }], afternoon: [], evening: [] }];
    const { container } = render(<BookAheadList plan={plan} resolveEntry={resolveEntry} bookedIds={new Set()} />);
    expect(container.innerHTML).toBe('');
  });
});
