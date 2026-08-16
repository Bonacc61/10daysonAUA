// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RatingChip, { RatingChipInline } from './RatingChip';

/**
 * The count is the whole point of the chip, so assert on what a traveller reads
 * rather than on the branch that produces it.
 *
 * This component used to hide the count above 30 reviews, on the theory that a
 * well-reviewed average speaks for itself. On the live site that read as a bug:
 * most Viator cards cleared 30, so most cards showed a bare number and the few
 * thin ones showed brackets — which looked like missing data, not restraint.
 */

const text = () => document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('RatingChip', () => {
  it('shows the count on a heavily reviewed product', () => {
    render(<RatingChip rating={4.9} reviewCount={2847} />);
    expect(text()).toBe('4.9(2847)'); // the gap is CSS margin, not a space
  });

  it('shows the count on a thinly reviewed product', () => {
    render(<RatingChip rating={5} reviewCount={7} />);
    expect(text()).toBe('5(7)');
  });

  // Viator returns no rating for an unreviewed product and the catalog stores 0.
  // "(0)" would read as a verdict on it; nothing is the honest render.
  it('renders nothing when the product has no reviews', () => {
    const { container } = render(<RatingChip rating={0} reviewCount={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the count inline too', () => {
    render(<RatingChipInline rating={4.7} reviewCount={934} />);
    expect(text()).toBe('4.7(934)');
  });
});
