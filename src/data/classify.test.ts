import { describe, it, expect } from 'vitest';
import { budgetTag, adventureBandTag, interestTags, classifyTags } from './classify';

describe('budgetTag', () => {
  it('bands USD price into the questionnaire budget options', () => {
    expect(budgetTag(0)).toBe('budget');
    expect(budgetTag(35)).toBe('budget');
    expect(budgetTag(80)).toBe('mid-range');
    expect(budgetTag(200)).toBe('treat-yourself');
    expect(budgetTag(500)).toBe('money-no-object');
  });
});

describe('adventureBandTag', () => {
  it('bands the 0..100 adventure value', () => {
    expect(adventureBandTag(10)).toBe('low-adventure');
    expect(adventureBandTag(50)).toBe('med-adventure');
    expect(adventureBandTag(90)).toBe('high-adventure');
  });
});

describe('interestTags', () => {
  it('maps sections to interests (deduped)', () => {
    expect(interestTags(['food-drink'])).toEqual(['food-drink']);
    expect(interestTags(['cruises-water'])).toContain('watersports');
    expect(interestTags(['adventures-outdoor'])).toContain('adventure');
    expect(interestTags([])).toEqual([]);
  });
});

describe('classifyTags', () => {
  it('combines budget + adventure band + interests', () => {
    const t = classifyTags({ priceUsd: 80, sections: ['food-drink'], adventure: 15 });
    expect(t).toContain('mid-range');
    expect(t).toContain('low-adventure');
    expect(t).toContain('food-drink');
  });
});
