// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ItineraryCard from './ItineraryCard';
import { ACTIVITIES } from '../data/activities';
import type { CardEntry } from '../types';

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
