import { describe, it, expect } from 'vitest';
import { bookAheadBadge } from './BookAheadBadge';
import type { ViatorItem } from '../types';

const item = (flags?: string[]): ViatorItem => ({
  id: 'x', group_id: 'g', title: 't', image_url: '', price_usd: 100, duration: '',
  rating: 4.5, review_count: 10, viator_item_url: '', is_best_seller: false,
  display_order: 0, ...(flags ? { flags } : {}),
});

describe('bookAheadBadge', () => {
  it('surfaces Viator\'s sell-out warning', () => {
    expect(bookAheadBadge(item(['LIKELY_TO_SELL_OUT']))?.label).toMatch(/Likely to sell out/);
  });

  it('shows one badge at a time, sell-out winning', () => {
    // A corner badge that fires on almost every card is wallpaper. Only the flag
    // that changes a booking decision gets the space.
    expect(bookAheadBadge(item(['NEW_ON_VIATOR', 'LIKELY_TO_SELL_OUT']))?.label)
      .toMatch(/Likely to sell out/);
  });

  it('ignores the flags that are not decisions', () => {
    // FREE_CANCELLATION is on 351 of 366 products and PRIVATE_TOUR on 164 —
    // neither tells anyone when to book.
    expect(bookAheadBadge(item(['FREE_CANCELLATION', 'PRIVATE_TOUR']))).toBeNull();
    expect(bookAheadBadge(item(['SPECIAL_OFFER']))).toBeNull();
  });

  it('is silent for an item with no flags at all', () => {
    expect(bookAheadBadge(item())).toBeNull();
    expect(bookAheadBadge(item([]))).toBeNull();
  });

  it('never claims a number of days', () => {
    // Viator's page says "booked 30 days in advance on average". That figure is
    // in no API field and the page is unreachable, so nothing here may imply it.
    for (const f of ['LIKELY_TO_SELL_OUT', 'NEW_ON_VIATOR']) {
      expect(bookAheadBadge(item([f]))?.label).not.toMatch(/\d+\s*day/i);
    }
  });
});
