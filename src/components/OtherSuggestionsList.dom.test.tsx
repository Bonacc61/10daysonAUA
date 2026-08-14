// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OtherSuggestionsList from './OtherSuggestionsList';
import type { ViatorItem } from '../types';

// jsdom has no layout: scrollWidth/clientWidth are always 0 and scrollLeft is a
// stub that swallows writes. Give the shelf a fake geometry so the wheel handler
// has something to scroll.
function giveShelfWidth(el: Element, { scrollWidth = 1200, clientWidth = 400, scrollLeft = 0 } = {}) {
  let left = scrollLeft;
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollLeft', {
    get: () => left, set: (v: number) => { left = v; }, configurable: true,
  });
  return el as HTMLElement;
}

function wheel(el: Element, init: WheelEventInit) {
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(ev);
  return ev;
}

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

describe('OtherSuggestionsList — reaching the cards off the right edge', () => {
  // The bug: the shelf only scrolls sideways, so a mouse wheel's deltaY went to
  // the nearest vertically scrollable ancestor — the page — and the shelf never
  // moved. Dragging the scrollbar was the only way across.
  it('scrolls the shelf sideways when the wheel turns over it', () => {
    render(<OtherSuggestionsList items={items} open onToggle={() => {}} />);
    const shelf = giveShelfWidth(document.querySelector('.other-suggestions-picker')!);

    const ev = wheel(shelf, { deltaY: 120 });

    expect(shelf.scrollLeft).toBe(120);
    expect(ev.defaultPrevented).toBe(true); // ...and the page stayed put
  });

  it('converts a line-mode wheel into a useful distance', () => {
    // Firefox reports deltaMode=1 with deltaY≈3 per notch. Taken literally that
    // is a 3px nudge, which reads as "still broken".
    render(<OtherSuggestionsList items={items} open onToggle={() => {}} />);
    const shelf = giveShelfWidth(document.querySelector('.other-suggestions-picker')!);

    wheel(shelf, { deltaY: 3, deltaMode: 1 });

    expect(shelf.scrollLeft).toBeGreaterThan(30);
  });

  it('hands the wheel back to the page once the shelf is at its end', () => {
    render(<OtherSuggestionsList items={items} open onToggle={() => {}} />);
    const shelf = giveShelfWidth(document.querySelector('.other-suggestions-picker')!, {
      scrollWidth: 1200, clientWidth: 400, scrollLeft: 800,
    });

    const ev = wheel(shelf, { deltaY: 120 });

    expect(shelf.scrollLeft).toBe(800);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('still scrolls after the shelf arrives on a later render', () => {
    // A card with one suggestion renders nothing at all, so there is no element
    // for the wheel listener to attach to. Swapping that card to a group with
    // several suggestions reuses the same uid, so React reconciles in place
    // rather than remounting — and a listener bound once on mount would never
    // get a second chance.
    const { rerender } = render(<OtherSuggestionsList items={[]} open onToggle={() => {}} />);
    expect(document.querySelector('.other-suggestions-picker')).toBeNull();

    rerender(<OtherSuggestionsList items={items} open onToggle={() => {}} />);
    const shelf = giveShelfWidth(document.querySelector('.other-suggestions-picker')!);

    wheel(shelf, { deltaY: 120 });

    expect(shelf.scrollLeft).toBe(120);
  });

  it('leaves a trackpad sideways swipe to the browser', () => {
    // deltaX already scrolls this element natively; stepping in would double it.
    render(<OtherSuggestionsList items={items} open onToggle={() => {}} />);
    const shelf = giveShelfWidth(document.querySelector('.other-suggestions-picker')!);

    const ev = wheel(shelf, { deltaX: 90, deltaY: 4 });

    expect(shelf.scrollLeft).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
  });
});
