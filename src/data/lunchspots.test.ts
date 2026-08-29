import { describe, it, expect } from 'vitest';
import { LUNCHSPOTS, VEGETARIAN_LUNCHSPOTS, hasVegetarianOptions } from './lunchspots';

/**
 * The vegetarian list is hand-maintained ids, so the failure mode is a typo:
 * a misspelled id would silently mark nothing, and the card the evidence was
 * gathered for would simply never wear its V.
 */
describe('lunchspots — the vegetarian V list', () => {
  it('names only lunch spots that exist', () => {
    for (const id of VEGETARIAN_LUNCHSPOTS) {
      expect(LUNCHSPOTS.some((l) => l.id === id), id).toBe(true);
    }
  });

  it('never marks Zeerover, whose meatless items are sides', () => {
    // The one HIGH-confidence NO of the 2026-08-29 menu research: fried fish
    // and shrimp by the pound, meatless only in the fries and funchi. A V on
    // this card would mislead a traveller ordering by it.
    expect(hasVegetarianOptions('lunch-zeerover')).toBe(false);
  });

  it('marks only the high-confidence five, not everything plausibly veg', () => {
    // O'Niels (specials only) and the review-mention spots stay out until a
    // readable menu confirms them — see the evidence notes in lunchspots.ts.
    expect([...VEGETARIAN_LUNCHSPOTS].sort()).toEqual([
      'lunch-bingo',
      'lunch-hadicurari',
      'lunch-lindas-pancakes',
      'lunch-pastechi-house',
      'lunch-willems-pancakes',
    ]);
  });
});
