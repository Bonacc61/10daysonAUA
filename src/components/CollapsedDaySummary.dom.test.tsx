// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CollapsedDaySummary from './CollapsedDaySummary';

/**
 * A collapsed day has to say WHAT is planned, not just how much. These render
 * it, because the whole change is visual: a regression that dropped the photos
 * would leave every assertion about counts and labels passing.
 */

const ACTIVITIES = [
  { key: 'u1', title: 'Catamaran Sunset Sail', image: '/sail.webp' },
  { key: 'u2', title: 'Zeerover Lunch', image: '/zeerover.webp' },
  { key: 'u3', title: 'Eagle Beach Morning Session' },   // no photo on file
];

afterEach(() => { document.body.innerHTML = ''; });

describe('CollapsedDaySummary', () => {
  it('shows one thumbnail per planned activity', () => {
    const { container } = render(<CollapsedDaySummary activities={ACTIVITIES} dayNum={3} onExpand={() => {}} />);
    expect(container.querySelectorAll('.itin-day-thumb')).toHaveLength(3);
    expect(container.querySelectorAll('.itin-day-thumb img')).toHaveLength(2);
  });

  it('falls back to the initial when an activity has no photo', () => {
    render(<CollapsedDaySummary activities={ACTIVITIES} dayNum={3} onExpand={() => {}} />);
    expect(screen.getByText('E')).toBeInTheDocument();
  });

  it('hides a photo that fails to load rather than showing a broken glyph', () => {
    // Dead Viator image URLs are a known failure on this catalog.
    const { container } = render(<CollapsedDaySummary activities={ACTIVITIES} dayNum={3} onExpand={() => {}} />);
    const img = container.querySelector('.itin-day-thumb img') as HTMLImageElement;
    fireEvent.error(img);
    expect(img.style.display).toBe('none');
  });

  it('names the activities for a screen reader, so the row is not image-only', () => {
    render(<CollapsedDaySummary activities={ACTIVITIES} dayNum={3} onExpand={() => {}} />);
    expect(screen.getByLabelText('Expand day 3: Catamaran Sunset Sail, Zeerover Lunch, Eagle Beach Morning Session')).toBeInTheDocument();
  });

  it('drops both the instruction and the count — the circles are the count', () => {
    render(<CollapsedDaySummary activities={ACTIVITIES} dayNum={3} onExpand={() => {}} />);
    expect(screen.queryByText(/tap to expand/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ activit(y|ies)/)).not.toBeInTheDocument();
  });

  it('still counts the activities for a screen reader, which has nothing to look at', () => {
    render(<CollapsedDaySummary activities={ACTIVITIES} dayNum={3} onExpand={() => {}} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/Catamaran Sunset Sail, Zeerover Lunch/);
  });

  it('expands when the row is clicked, not only the chevron', () => {
    const onExpand = vi.fn();
    render(<CollapsedDaySummary activities={ACTIVITIES} dayNum={3} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it('bounds the row and says how many it did not draw', () => {
    // Day shape caps at three cards, but a shared or older plan need not.
    const many = Array.from({ length: 9 }, (_, i) => ({ key: `u${i}`, title: `Activity ${i}`, image: '/x.webp' }));
    const { container } = render(<CollapsedDaySummary activities={many} dayNum={1} onExpand={() => {}} />);
    expect(container.querySelectorAll('.itin-day-thumb:not(.more)')).toHaveLength(6);
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('says so when a day is empty', () => {
    render(<CollapsedDaySummary activities={[]} dayNum={5} onExpand={() => {}} />);
    expect(screen.getByText('Nothing planned yet')).toBeInTheDocument();
  });
});

describe('CollapsedDaySummary — the list variant', () => {
  it('draws the titles beside the circles', () => {
    render(<CollapsedDaySummary activities={ACTIVITIES} dayNum={3} onExpand={() => {}} variant="list" />);
    expect(screen.getByText('Catamaran Sunset Sail')).toBeInTheDocument();
    expect(screen.getByText('Zeerover Lunch')).toBeInTheDocument();
  });

  it('carries the same activities as the row variant, so the two cannot disagree', () => {
    // The titles live in the DOM either way and `row` hides them in CSS — a
    // variant that showed a DIFFERENT set of activities would be the real bug.
    const { container: rowEl } = render(<CollapsedDaySummary activities={ACTIVITIES} dayNum={3} onExpand={() => {}} />);
    const rowTitles = [...rowEl.querySelectorAll('.itin-day-line-title')].map((n) => n.textContent);
    document.body.innerHTML = '';
    const { container: listEl } = render(<CollapsedDaySummary activities={ACTIVITIES} dayNum={3} onExpand={() => {}} variant="list" />);
    const listTitles = [...listEl.querySelectorAll('.itin-day-line-title')].map((n) => n.textContent);
    expect(listTitles).toEqual(rowTitles);
  });
});
