import type { MatchTag, Section } from '../types';

// === Granular product/activity classification ==============================
// Derives the questionnaire MatchTags a product satisfies, so the matcher can
// score every answer combination against real signal instead of the old
// wildcard (empty matched_by) behaviour. Pure + unit-tested. Wiring this into
// a weighted scoring matcher is the next phase.

// Budget band from a USD price — mirrors the questionnaire budget options.
export function budgetTag(priceUsd: number): MatchTag {
  if (priceUsd < 40) return 'budget';
  if (priceUsd < 120) return 'mid-range';
  if (priceUsd < 300) return 'treat-yourself';
  return 'money-no-object';
}

// Interests implied by a product's Explore sections.
const SECTION_INTERESTS: Record<Section, MatchTag[]> = {
  'cruises-water':      ['watersports', 'beach-chill'],
  'adventures-outdoor': ['adventure', 'nature-hiking'],
  'tours-sightseeing':  ['culture-history'],
  'food-drink':         ['food-drink'],
  'culture-history':    ['culture-history'],
  'beaches':            ['beach-chill'],
};

export function interestTags(sections: Section[]): MatchTag[] {
  const out = new Set<MatchTag>();
  for (const s of sections) for (const t of SECTION_INTERESTS[s] ?? []) out.add(t);
  return [...out];
}

// Adventure band (0 chill … 100 adrenaline).
export function adventureBandTag(adventure: number): MatchTag {
  if (adventure >= 67) return 'high-adventure';
  if (adventure <= 33) return 'low-adventure';
  return 'med-adventure';
}

// Full classification: every MatchTag this product satisfies across the price
// (budget), sections (interests) and adventure dimensions.
export function classifyTags(opts: { priceUsd: number; sections: Section[]; adventure: number }): MatchTag[] {
  return [
    budgetTag(opts.priceUsd),
    adventureBandTag(opts.adventure),
    ...interestTags(opts.sections),
  ];
}
