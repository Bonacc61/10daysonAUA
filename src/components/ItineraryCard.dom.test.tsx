// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ItineraryCard from './ItineraryCard';
import { ACTIVITIES } from '../data/activities';
import type { CardEntry } from '../types';

const byId = (id: string) => ACTIVITIES.find((a) => a.id === id)!;

const noop = () => {};

/**
 * Renders the card rather than asserting on the source expression that
 * builds its book link — the "Book now" vs "Book direct" label is the
 * traveller-visible signal that this one isn't a commission-bearing link,
 * and only a render can show whether the right label landed on the right
 * href.
 */
describe('ItineraryCard — book link label', () => {
  it('gives Flamingo a direct link to the operator, labelled "Book direct"', () => {
    const entry: CardEntry = { kind: 'activity', activity: byId('flamingo-renaissance') };
    render(<ItineraryCard entry={entry} flipped={false} swapping={false} onFlip={noop} />);
    const link = screen.getByText('Book direct ↗').closest('a')!;
    expect(link).toHaveAttribute('href', 'https://renaissancearuba.idaypass.com/');
    expect(screen.queryByText('Book now ↗')).not.toBeInTheDocument();
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
    expect(screen.queryByText('Book direct ↗')).not.toBeInTheDocument();
  });
});
