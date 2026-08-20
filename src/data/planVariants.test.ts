import { describe, it, expect } from 'vitest';
import { buildVariants, initialPlanIdx, clampPlanIdx, type VariantTrip, type GeneratedVariant } from './planVariants';
import type { MatchTag } from '../types';
import type { Day } from './activities';

const day = (n: number): Day =>
  ({ day: n, morning: [], afternoon: [], evening: [] } as unknown as Day);

const tags = (...t: string[]) => new Set(t as MatchTag[]);

const trip = (id: string, label: string, days: number, ...t: string[]): VariantTrip =>
  ({ id, label, plan: Array.from({ length: days }, (_, i) => day(i + 1)), tags: tags(...t) });

const GENERATED: GeneratedVariant[] = [
  { label: 'Balanced',  description: 'Your personalised itinerary',      plan: [day(1)], tags: tags('gen') },
  { label: 'Adventure', description: 'Adrenaline-first, beaches second', plan: [day(1)], tags: tags('gen') },
  { label: 'Chill',     description: 'Slow mornings, easy afternoons',   plan: [day(1)], tags: tags('gen') },
];

const SAVED_DESC = 'The plan you saved, including your edits';

describe('buildVariants', () => {
  it('falls back to the three generated explorations when nothing is saved', () => {
    const v = buildVariants([], GENERATED, SAVED_DESC);
    expect(v.map((x) => x.label)).toEqual(['Balanced', 'Adventure', 'Chill']);
    // The fallback must keep its OWN descriptions — calling a generated plan
    // something the traveller saved is the exact lie the labels guard against.
    expect(v.every((x) => x.description !== SAVED_DESC)).toBe(true);
  });

  it('names each tab after the saved itinerary it draws', () => {
    const v = buildVariants(
      [trip('a', 'Honeymoon week', 7), trip('b', 'Kids trip', 5)],
      GENERATED, SAVED_DESC,
    );
    expect(v.map((x) => x.label)).toEqual(['Honeymoon week', 'Kids trip']);
  });

  it('REPLACES the generated variants rather than appending to them', () => {
    const v = buildVariants([trip('a', 'Only trip', 3)], GENERATED, SAVED_DESC);
    expect(v).toHaveLength(1);
    expect(v.map((x) => x.label)).not.toContain('Adventure');
    expect(v.map((x) => x.label)).not.toContain('Chill');
  });

  it('is not capped at three — an account can hold any number', () => {
    const many = Array.from({ length: 7 }, (_, i) => trip(`t${i}`, `Trip ${i}`, 3));
    expect(buildVariants(many, GENERATED, SAVED_DESC)).toHaveLength(7);
  });

  it('gives each tab its OWN plan, so the days below follow the selection', () => {
    const v = buildVariants(
      [trip('a', 'Long trip', 10), trip('b', 'Weekend', 2)],
      GENERATED, SAVED_DESC,
    );
    expect(v[0].plan).toHaveLength(10);
    expect(v[1].plan).toHaveLength(2);
  });

  it('carries each trip’s own tags, not one shared set', () => {
    // A trip planned before the questionnaire was retaken must resolve its card
    // faces with the answers it was planned against.
    const v = buildVariants(
      [trip('a', 'Adventurous', 3, 'adventure'), trip('b', 'Restful', 3, 'chill')],
      GENERATED, SAVED_DESC,
    );
    expect([...v[0].tags]).toEqual(['adventure']);
    expect([...v[1].tags]).toEqual(['chill']);
  });

  it('describes every saved tab as saved', () => {
    const v = buildVariants([trip('a', 'One', 3), trip('b', 'Two', 3)], GENERATED, SAVED_DESC);
    expect(v.map((x) => x.description)).toEqual([SAVED_DESC, SAVED_DESC]);
  });
});

describe('initialPlanIdx', () => {
  const saved = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('opens on the itinerary the planner is editing', () => {
    expect(initialPlanIdx(saved, 'b')).toBe(1);
    expect(initialPlanIdx(saved, 'c')).toBe(2);
  });

  it('opens on the most recent when nothing is selected', () => {
    expect(initialPlanIdx(saved, null)).toBe(0);
  });

  it('opens on the most recent when the selected trip is gone', () => {
    // A deleted trip must not leave the switcher pointing at nothing.
    expect(initialPlanIdx(saved, 'deleted-id')).toBe(0);
  });

  it('is 0 for an empty list, so the generated fallback starts on Balanced', () => {
    expect(initialPlanIdx([], 'anything')).toBe(0);
  });
});

describe('clampPlanIdx', () => {
  it('leaves an in-range index alone', () => {
    expect(clampPlanIdx(0, 3)).toBe(0);
    expect(clampPlanIdx(2, 3)).toBe(2);
  });

  it('pulls an index back when the list shrinks under it', () => {
    // Five saved itineraries, traveller on the fifth, then they sign out: the
    // list becomes the three generated ones. Unclamped this was `undefined`,
    // which hid the Map's entire bottom panel with no way back.
    expect(clampPlanIdx(4, 3)).toBe(2);
  });

  it('never returns a negative index for an empty list', () => {
    expect(clampPlanIdx(4, 0)).toBe(0);
    expect(clampPlanIdx(0, 0)).toBe(0);
  });

  it('floors a negative index at 0', () => {
    expect(clampPlanIdx(-1, 3)).toBe(0);
  });
});
