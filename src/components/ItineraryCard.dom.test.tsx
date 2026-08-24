// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ItineraryCard from './ItineraryCard';
import { ACTIVITIES } from '../data/activities';
import type { CardEntry } from '../types';

vi.mock('../lib/analytics', () => ({ capture: vi.fn() }));
import { capture } from '../lib/analytics';

const byId = (id: string) => ACTIVITIES.find((a) => a.id === id)!;

const noop = () => {};

/**
 * Renders the card rather than asserting on the source expression that builds
 * its book link. Every bookable card now reads "Book now" whether the link is
 * affiliate or direct (2026-08-19) — the label stopped carrying that
 * distinction, so the href is the only thing left that can be wrong, and only a
 * render shows which href the one button actually got.
 */
describe('ItineraryCard — book link', () => {
  it('sends Flamingo straight to the operator, under the same "Book now"', () => {
    const entry: CardEntry = { kind: 'activity', activity: byId('flamingo-renaissance') };
    render(<ItineraryCard entry={entry} flipped={false} swapping={false} onFlip={noop} />);
    const link = screen.getByText('Book now ↗').closest('a')!;
    expect(link).toHaveAttribute('href', 'https://renaissancearuba.idaypass.com/');
    // The old wording must not come back on either kind of link.
    expect(screen.queryByText(/Book direct/)).not.toBeInTheDocument();
  });

  it('gives a Viator-linked activity "Book now", with the affiliate parameter intact', () => {
    const activity = {
      ...byId('antilla-wreck-dive'),
      viator_item_url: 'https://viator.com/tours/x?pid=P00302487&mcid=42383',
    };
    const entry: CardEntry = { kind: 'activity', activity };
    render(<ItineraryCard entry={entry} flipped={false} swapping={false} onFlip={noop} />);
    const link = screen.getByText('Book now ↗').closest('a')!;
    expect(link.getAttribute('href')).toContain('medium=link');
    expect(link.getAttribute('href')).toContain('pid=P00302487');
    expect(screen.queryByText(/Book direct/)).not.toBeInTheDocument();
  });
});

/**
 * Stage 0 of the restaurant-monetization plan
 * (docs/strategy/2026-08-24-restaurant-monetization/): every outbound
 * reservation click must be countable, because the click counts are the sales
 * collateral for the direct restaurant deals in stage 1. The event carries only
 * the activity id and the link kind — no traveller text, per the house rule.
 */
describe('ItineraryCard — reserve a table', () => {
  beforeEach(() => vi.mocked(capture).mockClear());

  it('renders a web reservation link and counts the click', () => {
    const activity = {
      ...byId('gasparito-restaurant'),
      reserve: { url: 'https://example.com/reserve', kind: 'web' as const },
    };
    const entry: CardEntry = { kind: 'activity', activity };
    render(<ItineraryCard entry={entry} flipped={false} swapping={false} onFlip={noop} />);
    const link = screen.getByText('Reserve a table ↗').closest('a')!;
    expect(link).toHaveAttribute('href', 'https://example.com/reserve');
    expect(link).toHaveAttribute('target', '_blank');
    fireEvent.click(link);
    expect(capture).toHaveBeenCalledWith('restaurant_reserve_click',
      { id: 'gasparito-restaurant', kind: 'web' });
  });

  it('renders a phone-only restaurant as "Call to reserve" with a tel: link', () => {
    const entry: CardEntry = { kind: 'activity', activity: byId('gasparito-restaurant') };
    render(<ItineraryCard entry={entry} flipped={false} swapping={false} onFlip={noop} />);
    const link = screen.getByText('Call to reserve').closest('a')!;
    // Gasparito takes no online bookings (verified 2026-08-24) — phone only.
    expect(link).toHaveAttribute('href', 'tel:+2975867044');
    expect(link).not.toHaveAttribute('target');
    fireEvent.click(link);
    expect(capture).toHaveBeenCalledWith('restaurant_reserve_click',
      { id: 'gasparito-restaurant', kind: 'phone' });
  });

  it('shows no reserve action on a card without one', () => {
    const entry: CardEntry = { kind: 'activity', activity: byId('manchebo-beach') };
    render(<ItineraryCard entry={entry} flipped={false} swapping={false} onFlip={noop} />);
    expect(screen.queryByText(/Reserve a table|Call to reserve/)).not.toBeInTheDocument();
  });
});
