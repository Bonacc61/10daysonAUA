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

describe('a parsed constraint filters the pool the ranker draws from', () => {
  // Vessel is what the "isn't a boat" family of queries turns on, and it is the
  // clearest case: a catamaran is aboard something, a shore snorkel explicitly
  // is not, and an unjudged product is neither.
  const catamaran = itemEntry('cat', { vessel: 'catamaran', title: 'Catamaran Sail' });
  const shore = itemEntry('shore', { vessel: null, title: 'Shore Snorkel' });
  const unjudged = itemEntry('unjudged', { title: 'Island Tour' });
  const pool = () => [catamaran, shore, unjudged];

  it('drops a ranked result that contradicts the constraint', () => {
    // The failure this whole layer exists for: measured 2026-08-16, "half day
    // trip that isn't a boat" returned three boats in its top five. Better
    // ranking could never have fixed it — cosine has no way to push a match
    // away, only to lift others past it.
    const out = entriesOf('half day trip that is not a boat', [], pool, {
      ids: ['cat', 'shore'], answers: 'half day trip that is not a boat',
      constraint: { must: [], mustNot: ['boat'] },
    });
    expect(ids(out)).not.toContain('cat');
    expect(ids(out)).toContain('shore');
  });

  it('KEEPS a RANKED entry the data has not judged — never a false exclusion', () => {
    // The protection that matters: the embedding put this id forward on its own
    // evidence, and an unknown facet must not take it away. A false exclusion is
    // invisible, because nobody sees what they were not shown. 113 of 328
    // products carry no vessel judgement at all.
    const out = entriesOf('not a boat', [], pool, {
      ids: ['unjudged'], answers: 'not a boat',
      constraint: { must: [], mustNot: ['boat'] },
    });
    expect(ids(out)).toContain('unjudged');
  });

  it('does NOT promote an unjudged entry into the tail on its own', () => {
    // The other half of the same distinction, and the half that was missing.
    // Keeping an unknown in the POOL stops a wrong exclusion; it is not a
    // licence to answer with the catalog. Measured 2026-08-16: conflating the
    // two returned 280 entries for "half day trip that isn't a boat" out of a
    // 328-item catalog — nothing contradicted the query, and nothing answered it.
    const out = entriesOf('not a boat', [], pool, {
      ids: [], answers: 'not a boat',
      constraint: { must: [], mustNot: ['boat'] },
    });
    expect(ids(out)).toEqual(['shore']);          // vessel: null — the data SAYS not a boat
    expect(ids(out)).not.toContain('unjudged');   // nobody looked
    expect(ids(out)).not.toContain('cat');        // and the catamaran is still gone
  });

  it('returns everything that conforms, not only what the ranker ordered', () => {
    // A cap on ranked ids is a bound on how many can be ORDERED, never on how
    // many qualify. Here the ranker named one id and two entries conform.
    const out = entriesOf('not a boat', [], pool, {
      ids: ['shore'], answers: 'not a boat',
      constraint: { must: [], mustNot: ['boat'] },
    });
    expect(ids(out)).toEqual(['shore']);
  });

  it('answers a fully compiled query with no ranked ids at all', () => {
    // The parse consumed the whole query, so the server made no embedding call
    // and returned nothing to rank. The constraint alone is the answer.
    const out = entriesOf('not a boat', [], pool, {
      ids: [], answers: 'not a boat',
      constraint: { must: [], mustNot: ['boat'] },
    });
    expect(ids(out).sort()).toEqual(['shore']);
  });

  it('changes nothing when the parse did not happen', () => {
    // The no-op fallthrough, which is the promise that search never gets WORSE
    // than it is now. A null constraint must behave exactly as before it existed.
    const withNull = entriesOf('catamaran', [], pool, {
      ids: ['cat'], answers: 'catamaran', constraint: null,
    });
    const withAbsent = entriesOf('catamaran', [], pool, {
      ids: ['cat'], answers: 'catamaran',
    });
    expect(ids(withNull)).toEqual(['cat']);
    expect(ids(withAbsent)).toEqual(['cat']);
  });

  it('leaves substring hits first and unfiltered', () => {
    // The substring layer is permanently load-bearing: it serves proper nouns,
    // which cosine blurs. A constraint bounds what MEANING may add, never what
    // the traveller's own literal words already matched.
    const out = entriesOf('catamaran', [catamaran], pool, {
      ids: ['shore'], answers: 'catamaran',
      constraint: { must: [], mustNot: ['boat'] },
    });
    expect(ids(out)[0]).toBe('cat');
  });
});
