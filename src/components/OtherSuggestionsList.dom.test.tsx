// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OtherSuggestionsList from './OtherSuggestionsList';
import type { ViatorItem } from '../types';

const item = (n: number): ViatorItem => ({
  id: `p${n}`, group_id: 'g', title: `Suggestion ${n}`,
  image_url: `https://cdn.example/${n}.jpg`, price_usd: 60 + n, duration: '2 hrs',
  rating: 4.6, review_count: 120, viator_item_url: 'https://viator.com/x',
  is_best_seller: false, display_order: n,
});

const items = [1, 2, 3, 4, 5].map(item);

describe('OtherSuggestionsList — the horizontal shelf', () => {
  it('shows a picture for every suggestion', () => {
    // The bug: the rewrite carried over the old vertical list's markup, which
    // had no images, while copying the shortlist card's shape, which does.
    render(<OtherSuggestionsList items={items} open onToggle={() => {}} />);
    const imgs = document.querySelectorAll('.other-suggestions-media img');
    expect(imgs.length).toBe(items.length);
    expect((imgs[0] as HTMLImageElement).src).toContain('cdn.example/1.jpg');
  });

  it('lays the cards out in one horizontal track', () => {
    render(<OtherSuggestionsList items={items} open onToggle={() => {}} />);
    expect(document.querySelector('.other-suggestions-track')).toBeTruthy();
    expect(document.querySelectorAll('.other-suggestions-item').length).toBe(items.length);
  });

  it('renders the drawer closed until asked', () => {
    render(<OtherSuggestionsList items={items} open={false} onToggle={() => {}} />);
    const body = document.querySelector('.other-suggestions-body');
    expect(body).toBeTruthy();
    expect(body?.classList.contains('open')).toBe(false);
  });

  it('keeps closed suggestions out of the tab order', () => {
    // They are still in the DOM (the drawer only hides them in CSS), so without
    // tabIndex=-1 a keyboard user tabs into invisible links.
    render(<OtherSuggestionsList items={items} open={false} onToggle={() => {}} />);
    const links = Array.from(document.querySelectorAll('.other-suggestions-item a'));
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a.getAttribute('tabindex')).toBe('-1');
  });

  it('offers an add button per suggestion when the itinerary passes one', () => {
    render(<OtherSuggestionsList items={items} open onToggle={() => {}} onAddItem={() => {}} />);
    expect(screen.getAllByRole('button', { name: /Add Suggestion/ }).length).toBe(items.length);
  });
});
