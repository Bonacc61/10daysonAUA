import { describe, it, expect } from 'vitest';
import { searchEntries } from './entrySearch';
import type { ExploreEntry } from '../data/exploreItems';
import type { Section, ViatorItem } from '../types';
import type { Activity } from '../data/activities';

/**
 * These guard the behaviour BOTH search boxes share. Explore's bar and My
 * Aruba > Personalized run the same function, so a regression here breaks two
 * surfaces at once — which is the trade made for them not being able to drift.
 */

const itemEntry = (id: string, over: Partial<ViatorItem> = {}, adventure = 45): ExploreEntry => ({
  kind: 'item', category: 'Watersports', adventure, sections: ['cruises-water'],
  item: {
    id, group_id: 'sailing-cruises', title: 'Catamaran Sunset Sail',
    image_url: '', price_usd: 90, duration: '', rating: 4.7, review_count: 100,
    viator_item_url: '', is_best_seller: false, display_order: 0,
    sections: ['cruises-water'] as Section[], ...over,
  },
});

const activityEntry = (id: string, over: Partial<Activity> = {}, adventure = 10): ExploreEntry => ({
  kind: 'activity', category: 'Beaches', adventure, sections: ['beaches'],
  activity: {
    id, title: 'Eagle Beach', category: 'Beaches', image: '', description: '',
    localsSay: '', cost: 'Free', duration: '', timeOfDay: 'Morning', fitReason: '',
    location: '', rating: 4.9, reviewCount: 10, sections: ['beaches'], matched_by: [], ...over,
  },
});

const ids = (entries: ExploreEntry[]) =>
  entries.map((e) => (e.kind === 'item' ? e.item.id : e.activity.id));

// Most cases care only about what came back, not how much of it the semantic
// layer contributed; `addedByMeaning` has its own tests below.
const entriesOf = (...args: Parameters<typeof searchEntries>) => searchEntries(...args).entries;

const NO_SEMANTIC = { ids: [], answers: '' };

describe('searchEntries', () => {
  it('leaves substring hits exactly as they came when nothing else applies', () => {
    const hits = [activityEntry('a1'), activityEntry('a2')];
    const out = entriesOf('turtles', hits, () => [], NO_SEMANTIC);
    expect(ids(out)).toEqual(['a1', 'a2']);
  });

  it('appends semantic matches BELOW the keyword hits, never above', () => {
    // Substring first is the contract: cosine similarity blurs proper nouns, so
    // someone typing a name must see the name match first.
    const hits = [activityEntry('a1')];
    const pool = [activityEntry('a1'), activityEntry('a2'), activityEntry('a3')];
    const out = entriesOf('quiet snorkel spot', hits, () => pool, { ids: ['a3', 'a2'], answers: 'quiet snorkel spot' });
    expect(ids(out)).toEqual(['a1', 'a3', 'a2']);
  });

  it('ignores semantic ids that answer a DIFFERENT query', () => {
    // Without this an edited query keeps showing the previous query's matches.
    const hits = [activityEntry('a1')];
    const pool = [activityEntry('a1'), activityEntry('a2')];
    const out = entriesOf('quiet snorkel spo', hits, () => pool, { ids: ['a2'], answers: 'quiet snorkel spot' });
    expect(ids(out)).toEqual(['a1']);
  });

  it('resolves semantic ids against the pool it is GIVEN, so a surface can bound them', () => {
    // The Personalized panel passes only profile-matched entries. An id outside
    // that pool must not appear, or the panel's "matched to your profile"
    // heading becomes false.
    const hits = [activityEntry('a1')];
    const out = entriesOf('quiet spot', hits, () => [activityEntry('a1')], { ids: ['a9'], answers: 'quiet spot' });
    expect(ids(out)).toEqual(['a1']);
  });

  it('drops boats when the traveller types that they get seasick', () => {
    const hits = [itemEntry('boat'), activityEntry('beach')];
    const out = entriesOf('we get seasick', hits, () => [], NO_SEMANTIC);
    expect(ids(out)).toEqual(['beach']);
  });

  it('applies contraindications to SEMANTIC matches too', () => {
    // The blend runs first, so an excluded item must not survive by arriving
    // through the semantic layer instead of the keyword one.
    const hits = [activityEntry('beach')];
    const pool = [activityEntry('beach'), itemEntry('boat')];
    const out = entriesOf('we get seasick', hits, () => pool, { ids: ['boat'], answers: 'we get seasick' });
    expect(ids(out)).toEqual(['beach']);
  });

  it('does not build the unsearched pool when there is nothing to blend', () => {
    // The pool allocates the whole catalog and re-derives every section. It was
    // being built on every keystroke for a branch that is not taken while the
    // flag is dark.
    let built = 0;
    entriesOf('turtles', [activityEntry('a1')], () => { built += 1; return []; }, NO_SEMANTIC);
    expect(built).toBe(0);
  });
});

describe('searchEntries — what it reports as added by meaning', () => {
  it('counts what the blend actually added, not what the search function ranked', () => {
    // The bug this replaces: the box said "Added 3 matches by meaning" while the
    // pool it was resolved against held only one of the three. Measured on the
    // live catalog, a Personalized panel's profile pool holds 36–61% of the 354
    // entries for four of five sample personas, so this is the ordinary case.
    const hits = [activityEntry('a1')];
    const pool = [activityEntry('a1'), activityEntry('a2')];
    const out = searchEntries('quiet snorkel spot', hits, () => pool, { ids: ['a2', 'a8', 'a9'], answers: 'quiet snorkel spot' });
    expect(out.addedByMeaning).toBe(1);
  });

  it('does not count a semantic match that a contraindication then removed', () => {
    const hits = [activityEntry('beach')];
    const pool = [activityEntry('beach'), itemEntry('boat')];
    const out = searchEntries('we get seasick', hits, () => pool, { ids: ['boat'], answers: 'we get seasick' });
    expect(out.addedByMeaning).toBe(0);
  });

  it('reports zero when the ids answer a different query', () => {
    const out = searchEntries('quiet spo', [activityEntry('a1')], () => [activityEntry('a2')], { ids: ['a2'], answers: 'quiet spot' });
    expect(out.addedByMeaning).toBe(0);
  });

  it('reports zero for an ordinary keyword search', () => {
    const out = searchEntries('turtles', [activityEntry('a1')], () => [], NO_SEMANTIC);
    expect(out.addedByMeaning).toBe(0);
  });
});
