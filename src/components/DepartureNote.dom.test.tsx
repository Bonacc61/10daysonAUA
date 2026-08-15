// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import DepartureNote from './DepartureNote';
import type { Section, ViatorItem } from '../types';

/**
 * Renders the note rather than testing only the copy helpers behind it.
 *
 * `departureHeadline` and `departureHedge` were the only tested part of this
 * component, and they cannot see the two things that actually go wrong: WHICH
 * verb the component picks for an item, and WHETHER it renders at all. Both
 * broke in production — every land product read "Departs 3:30pm" until
 * 2026-08-15 — and a pure-function test could not have caught it, because the
 * functions were given the wrong arguments, not the wrong logic.
 *
 * Product ids are live catalog codes; the pins and start times come from the
 * committed registries, so these assert against the real data a traveller sees.
 */

function item(over: Partial<ViatorItem>): ViatorItem {
  return {
    id: 'x', group_id: 'sailing-cruises', title: '', image_url: '',
    price_usd: 100, duration: '', rating: 4.7, review_count: 100,
    viator_item_url: '', is_best_seller: false, display_order: 0,
    sections: ['cruises-water'] as Section[], ...over,
  };
}

const line = () => document.querySelector('.card-departure')?.textContent ?? '';

describe('DepartureNote', () => {
  it('says a boat DEPARTS FROM its pier', () => {
    // 6593P7 — sunset sail pinned at Pelican Pier, with the operator's own
    // check-in sentence on record.
    render(<DepartureNote item={item({ id: '6593P7', title: 'Sunset Sail' })} />);
    expect(line()).toMatch(/Departs .*from Pelican Pier/);
    // The check-in line is the OPERATOR talking, and the quote marks are what
    // say so. Without this assertion the whole suite passes with them stripped —
    // which would silently turn their sentence into ours.
    expect(line()).toMatch(/\u201cCheck-in time is at 9:30 A.M\u201d/);
  });

  it('says a land tour STARTS AT its meeting point', () => {
    // 392509P1 — an off-road bike tour. "Departs 9:30am from Ayo Rock Formation"
    // described a rock formation as a terminal. It reads "near" because the
    // operator meets 400 m further up the road than the pin sits.
    render(<DepartureNote item={item({
      id: '392509P1', title: 'Off-Road Surron Bike Tour', sections: ['adventures-outdoor'],
    })} />);
    expect(line()).toMatch(/Start times 9:30am, 2:30pm near Ayo Rock Formation/);
    expect(line()).not.toMatch(/[Dd]epart/);
  });

  it('says NEAR, not AT, when the pin is only street-level', () => {
    // 62666P3 — the food tour's meeting text names a street address the pin does
    // not cover. Right block, wrong doorway: it must not be stated as the door.
    render(<DepartureNote item={item({
      id: '62666P3', title: 'Food Fusion Tour', sections: ['food-drink'],
    })} />);
    expect(line()).toMatch(/Starts 5:45pm near Yemanja Woodfired Grill, Oranjestad/);
  });

  it('gives a timed land product with no meeting point a time and no place', () => {
    // 5595462P1 — a distillery tasting. This is the 100-product case: the word
    // was all that was wrong, and there is no location to invent in its place.
    render(<DepartureNote item={item({
      id: '5595462P1', title: 'Discovery Papiamento Distillery', sections: ['food-drink'],
    })} />);
    expect(line()).toMatch(/Start times 3:30pm, 5:00pm/);
    expect(line()).not.toMatch(/[Dd]epart/);
    expect(line()).not.toMatch(/ at | near | from /);
  });

  it('never offers a DESTINATION pin as the place to turn up', () => {
    // 445910P2 is pinned on the SS Antilla wreck — where the boat goes. The land
    // equivalent is a jeep tour pinned on Conchi. Time only, place withheld.
    render(<DepartureNote item={item({ id: '445910P2', title: 'Antilla Wreck Snorkel' })} />);
    expect(line()).not.toMatch(/Antilla/);
  });

  it('renders nothing at all when neither half is on record', () => {
    const { container } = render(<DepartureNote item={item({ id: 'no-such-product' })} />);
    expect(container.querySelector('.card-departure')).toBeNull();
  });

  it('hedges whatever it just printed', () => {
    // The hedge is unconditional — a card that states a time without "confirm on
    // your booking" is claiming a schedule the snapshot cannot promise for a date.
    render(<DepartureNote item={item({ id: '5595462P1', title: 'Distillery', sections: ['food-drink'] })} />);
    expect(line()).toMatch(/Confirm on your booking/);
  });
});
