// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CardBack from './CardBack';
import type { ViatorItem } from '../types';
import type { Activity } from '../data/activities';

/**
 * The first tests in this repo that actually RENDER a card.
 *
 * Every card defect found so far — a per-platform review count where the page
 * shows a combined one, the Overview merged with the running order, an r/Aruba
 * quote under a commercial product's name, a half that vanished when a product
 * had no reviews — got through because the checks ran on data and on source
 * text. Regexes over a component file cannot tell you what it draws. These can.
 */

const viator = (over: Partial<ViatorItem> = {}): ViatorItem => ({
  id: '8936P1', group_id: 'sailing-cruises',
  title: 'Arusun Catamaran Sail with Snorkeling in Aruba',
  image_url: '', price_usd: 89, duration: '2.5 hrs',
  rating: 4.8, review_count: 2645, viator_item_url: 'https://viator.com/x',
  is_best_seller: true, display_order: 0,
  description: 'Have a warm Aruban welcome on board of a beautiful 65-foot catamaran.',
  ...over,
});

const noop = () => {};

describe('CardBack — a Viator product', () => {
  it('shows the combined review total, not one platform', () => {
    // The bug: the card said 154 (Viator alone) while the page said 206.
    // 8936P1 is 1179 + 1466 = 2645 across the two platforms.
    render(<CardBack kind="group" bestSeller={viator()} onFlip={noop} />);
    expect(screen.getByText(/2,645 reviews/)).toBeInTheDocument();
    expect(screen.queryByText(/1,179 reviews/)).not.toBeInTheDocument();
  });

  it('labels Overview and What to expect as separate sections', () => {
    // The bug: both texts were concatenated under one "Overview" heading, so the
    // card opened with "After check in at our desk…" instead of the pitch.
    render(<CardBack kind="group" bestSeller={viator()} onFlip={noop} />);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('What to expect')).toBeInTheDocument();
  });

  it('never ends a section mid-sentence', () => {
    render(<CardBack kind="group" bestSeller={viator()} onFlip={noop} />);
    const paras = Array.from(document.querySelectorAll('p'))
      .map((p) => (p.textContent ?? '').trim())
      .filter((t) => t.length > 40 && !/Confirm|booking/.test(t));
    expect(paras.length).toBeGreaterThan(0);
    for (const t of paras) expect(t).toMatch(/[.!?"')\]]$/);
  });

  it('says so when a product has no reviews, instead of dropping the half', () => {
    // 45382P429: rating 0, 0 reviews. The half used to vanish entirely.
    render(<CardBack kind="group" bestSeller={viator({ id: '45382P429', rating: 0, review_count: 0 })} onFlip={noop} />);
    expect(screen.getByText(/No reviews yet/)).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });
});

describe('CardBack — a local pick that borrowed a product identity', () => {
  const matched = (over: Partial<Activity> = {}): Activity => ({
    id: 'boca-catalina-snorkel',
    title: 'Arusun Catamaran Sail with Snorkeling in Aruba',   // the product's title
    category: 'Watersports', image: '/x.jpg',
    description: 'Have a warm Aruban welcome on board of a beautiful 65-foot catamaran.',
    localsSay: '', cost: '$89', duration: '2.5 hrs', timeOfDay: 'Morning',
    fitReason: '', location: 'Boca Catalina', rating: 4.8, reviewCount: 2645,
    ratingSource: 'viator', viator_item_url: 'https://www.viator.com/tours/Aruba/x/d28-8936P1?pid=P00302487',
    matched_by: [], ...over,
  });

  it('does not show an r/Aruba quote written about a different place', () => {
    // The bug you found: a line about a free snorkel spot, under the name of a
    // commercial catamaran tour.
    render(<CardBack kind="activity" activity={matched()} onFlip={noop} />);
    expect(screen.queryByText(/r\/Aruba/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Turtles for sure/i)).not.toBeInTheDocument();
  });

  it('shows the product\'s ratings and Overview instead', () => {
    render(<CardBack kind="activity" activity={matched()} onFlip={noop} />);
    expect(screen.getByText(/2,645 reviews/)).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it('suppresses the quote even when there is no Overview to replace it', () => {
    // Pins the isMatchedLocal gate SPECIFICALLY. With an Overview present the
    // two-halves layout also happens to hide the quote, so a test that only
    // covers that case passes even if the identity check is deleted — which is
    // exactly what a mutation run showed. Strip the description and the
    // two-halves gate falls away, leaving isMatchedLocal as the only thing
    // standing between a Boca Catalina quote and an Arusun card.
    // Point it at a product code carrying NEITHER an Overview nor a
    // What-to-expect, so the two-halves layout genuinely cannot engage.
    render(<CardBack kind="activity" activity={matched({
      description: '',
      viator_item_url: 'https://www.viator.com/tours/Aruba/x/d28-NOSUCHCODE?pid=P00302487',
    })} onFlip={noop} />);
    expect(screen.queryByText(/r\/Aruba/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Turtles for sure/i)).not.toBeInTheDocument();
  });

  it('keeps the r/Aruba quote for an UNMATCHED local pick', () => {
    // The suppression must be about borrowed identity, not about locals. A pick
    // with no Viator match is still editorially ours and keeps its own words.
    render(<CardBack kind="activity" activity={matched({
      title: 'Catamaran Sail & Snorkel at Boca Catalina',
      ratingSource: undefined, viator_item_url: undefined,
    })} onFlip={noop} />);
    expect(screen.getByText(/r\/Aruba/i)).toBeInTheDocument();
  });
});

describe('CardBack — where to get gear for a free snorkel', () => {
  const shore = (over: Partial<Activity> = {}): Activity => ({
    id: 'tres-trapi', title: 'Tres Trapi Turtle Cove', category: 'Beaches',
    image: '/x.jpg',
    description: '"Three steps" — concrete stairs drop you into a sheltered cove.',
    localsSay: '"Walk down the steps slowly, float, and wait." — Glennis',
    cost: 'Free + $16 gear', duration: '2–3 hrs', timeOfDay: 'Morning',
    fitReason: 'Free turtle snorkelling', location: 'Tres Trapi, Noord',
    rating: 4.8, reviewCount: 1452, matched_by: [], ...over,
  });

  it('names the shop and quotes its half-day set price', () => {
    render(<CardBack kind="activity" activity={shore()} onFlip={noop} />);
    expect(screen.getByText(/Aqua Windie's/)).toBeInTheDocument();
    expect(screen.getByText(/\$16/)).toBeInTheDocument();
  });

  it('says it is shut on Sunday', () => {
    // The planning fact: a Sunday snorkel needs gear picked up on Saturday.
    render(<CardBack kind="activity" activity={shore()} onFlip={noop} />);
    expect(screen.getByText(/closed Sunday/i)).toBeInTheDocument();
  });

  it('does NOT displace what locals say', () => {
    // The card back renders `blocks.length > 0 ? grid : tip`, so adding a block
    // to the grid would have silently replaced the local's quote — the single
    // most valuable thing on a local pick's card.
    render(<CardBack kind="activity" activity={shore()} onFlip={noop} />);
    expect(screen.getByText(/Walk down the steps slowly/)).toBeInTheDocument();
  });

  it('shows nothing for a guided trip that includes gear', () => {
    render(<CardBack kind="activity" activity={shore({ id: 'boca-catalina-snorkel' })} onFlip={noop} />);
    expect(screen.queryByText(/Aqua Windie's/)).not.toBeInTheDocument();
  });

  it('shows nothing on a Viator product card', () => {
    render(<CardBack kind="group" bestSeller={viator()} onFlip={noop} />);
    expect(screen.queryByText(/Aqua Windie's/)).not.toBeInTheDocument();
  });
});

describe('CardBack — the gear strip on a card that also has a Reddit quote', () => {
  // baby-beach-snorkel has an ACTIVITY_REDDIT entry, so it takes the GRID path
  // rather than the tip fallback — the layout where space is actually tight.
  // The first version of the strip squeezed that grid from the 104px it needs
  // down to 57px at a 280px card, cutting 47px off the quote. Measured in
  // headless Chromium against the real stylesheet; after trimming the strip
  // from 369 characters to 202 the clipping is 0px at 320px and 1px at 280px.
  const babyBeach = (): Activity => ({
    id: 'baby-beach-snorkel', title: 'Baby Beach & Snorkel Lagoon',
    category: 'Beaches', image: '/x.webp',
    description: "Aruba's best-kept secret on the southern tip.",
    localsSay: '"Drive past the refinery and keep going." — Miguel',
    cost: 'Free + $16 gear', duration: '3–4 hrs', timeOfDay: 'Morning',
    fitReason: 'Calm water', location: 'Seroe Colorado, San Nicolas',
    rating: 4.8, reviewCount: 1623, matched_by: [],
  });

  it('shows the Reddit quote AND the gear strip together', () => {
    render(<CardBack kind="activity" activity={babyBeach()} onFlip={noop} />);
    expect(screen.getByText(/Hidden gem if you make the drive/)).toBeInTheDocument();
    expect(screen.getByText(/Aqua Windie's/)).toBeInTheDocument();
  });
})
