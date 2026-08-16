import { describe, it, expect } from 'vitest';
import { buildPool, facetsOf, verdictFor, splitByFacet } from './searchPool';
import { EMITTABLE_CONCEPTS, NO_INTENT, type Concept, type Intent } from './searchConstraint';

// Intents are stated LITERALLY rather than parsed. This file tests the filter,
// and routing every case through a parser meant a parser bug read as a filter
// bug — which is exactly how the alias table's blind spots stayed invisible.
const intentOf = (must: Concept[], mustNot: Concept[] = []): Intent =>
  ({ must, mustNot, boosts: [], residual: '', matched: [] });
import { ACTIVITIES } from '../data/activities';
import { advValue, type ExploreEntry } from '../data/exploreItems';
import JUDGED from '../../docs/map/judged-toddler-ok.json';
import type { ViatorItem } from '../types';
import type { Activity } from '../data/activities';
import { mergeEnrichment } from '../data/enrichment';
import SNAPSHOT from '../data/enrichment.json';

// Fixtures. The union has two arms and the whole point of FacetView is that a
// predicate never has to know which one it is looking at.

function item(over: Partial<ViatorItem> = {}): ExploreEntry {
  return {
    kind: 'item',
    item: {
      id: 'p1', group_id: 'watersports', title: 'Thing', image_url: '',
      price_usd: 100, duration: '2 hours', rating: 4.5, review_count: 200,
      viator_item_url: 'https://x', is_best_seller: false, display_order: 0,
      ...over,
    },
    category: 'Tours', adventure: 50, sections: [],
  };
}

function activity(over: Partial<Activity> = {}): ExploreEntry {
  return {
    kind: 'activity',
    activity: {
      id: 'a1', title: 'Local pick', category: 'Beaches', image: '',
      description: '', localsSay: '', cost: 'Free', duration: '2h',
      timeOfDay: 'Morning', fitReason: '', location: 'Noord',
      rating: 4.6, reviewCount: 100, matched_by: [],
      ...over,
    },
    category: 'Beaches', adventure: 10, sections: [],
  };
}

describe('facetsOf', () => {
  it('reads enrichment off a Viator item', () => {
    const f = facetsOf(item({ kids: { min_age: 0, baby_ok: true } }));
    expect(f.kids?.baby_ok).toBe(true);
  });

  it('reports kids as absent on an unenriched entry', () => {
    expect(facetsOf(item()).kids).toBeUndefined();
    expect(facetsOf(activity()).kids).toBeUndefined();
  });

  it('normalises both arms to the same shape', () => {
    expect(Object.keys(facetsOf(item())).sort())
      .toEqual(Object.keys(facetsOf(activity())).sort());
  });
});

describe('buildPool — tri-state predicates', () => {
  const toddler = intentOf(['toddler']);

  it('keeps an entry whose facet passes, with no demotion', () => {
    const e = item({ kids: { min_age: 0, baby_ok: true } });
    const pool = buildPool([e], toddler);
    expect(pool).toHaveLength(1);
    expect(pool[0].unknowns).toBe(0);
  });

  it('drops an entry whose facet fails', () => {
    const e = item({ kids: { min_age: 6, baby_ok: false } });
    expect(buildPool([e], toddler)).toEqual([]);
  });

  it('keeps an unknown entry under the default demote policy, with a penalty', () => {
    // A high-adventure watersport: unknown, and not rescued by the heuristic.
    const e = item({ id: 'utv' });
    const pool = buildPool([{ ...e, adventure: 90, category: 'Watersports' }], toddler);
    expect(pool).toHaveLength(1);
    expect(pool[0].unknowns).toBe(1);
  });

  it('drops an unknown entry under the exclude policy', () => {
    const e = { ...item({ id: 'utv' }), adventure: 90, category: 'Watersports' as const };
    expect(buildPool([e], toddler, 'exclude')).toEqual([]);
  });

  it('rescues an unknown curated entry into the pool, but not into the top tier', () => {
    // The 26 curated locals are unenriched; a calm, non-watersport pick is a
    // plausible toddler answer even though no facet says so — plausible enough
    // to keep, not plausible enough to outrank a real verdict. It used to score
    // `unknowns: 0`, which ranked a guess as a judgement.
    const e = activity({ id: 'baby-beach-snorkel' });
    const pool = buildPool([e], toddler);
    expect(pool).toHaveLength(1);
    expect(pool[0].unknowns).toBe(1);
  });
});

describe('buildPool — toddler_ok excludes where nothing else can', () => {
  const toddler = intentOf(['toddler']);

  it('drops a product judged unsuitable, however calm its other facets look', () => {
    // This is the whole point: 15 off-road operators advertise "specialized
    // infant seats are available", so the marketing copy a vector is built from
    // says yes while the operator's own minimum age says 3.
    const e = item({ id: 'utv', toddler_ok: false });
    expect(buildPool([e], toddler)).toEqual([]);
  });

  it('keeps a product judged suitable, with no demotion', () => {
    const pool = buildPool([item({ id: 'calm', toddler_ok: true })], toddler);
    expect(pool).toHaveLength(1);
    expect(pool[0].unknowns).toBe(0);
  });

  it('outranks the heuristic rescue', () => {
    // Calm and not a watersport, so the rescue would have passed it — but a
    // real judgement beats a guess.
    const e = { ...item({ id: 'judged-no', toddler_ok: false }), adventure: 5,
                category: 'Beaches' as const };
    expect(buildPool([e], toddler)).toEqual([]);
  });
});

describe('private and food are dormant', () => {
  it('do not compile, so those queries behave as they did before', () => {
    // Both have predicates and neither may be EMITTED, which is now a property
    // of the vocabulary rather than of a parser's word list.
    expect(EMITTABLE_CONCEPTS).not.toContain('private');
    expect(EMITTABLE_CONCEPTS).not.toContain('food');
    expect(EMITTABLE_CONCEPTS).toContain('cheap');
  });

  it('leave every product in the pool', () => {
    const entries = [item({ id: 'a' }), item({ id: 'b', flags: [] })];
    expect(buildPool(entries, intentOf([]))).toHaveLength(2);
  });
});

describe('buildPool — mustNot', () => {
  it('drops an entry that matches a mustNot concept', () => {
    // Bare negation, so nothing else can drop the entry first.
    //
    // The title carries an adrenaline keyword on purpose: an adventure value
    // the catch-all or the category proxy invented is a guess, and a guess no
    // longer excludes anything. Without a grounded value this test would pass
    // for the wrong reason once that changed.
    const intent = intentOf([], ['adventure']);
    expect(intent.must).toEqual([]);
    const e = { ...item({ title: 'Off-Road UTV Safari' }), adventure: 90 };
    expect(buildPool([e], intent)).toEqual([]);
  });

  it('KEEPS an entry whose mustNot facet is unknown', () => {
    // An unknown must never be excluded by a negative constraint: we do not know
    // that it is the thing being ruled out, and a false exclusion is invisible.
    const intent = intentOf([], ['toddler']);
    expect(intent.must).toEqual([]);
    const e = item({ id: 'unknown-kids' });
    const pool = buildPool([e], intent);
    expect(pool).toHaveLength(1);
  });
});

describe('buildPool — no-op invariant', () => {
  it('returns every entry untouched when the intent is empty', () => {
    const intent = NO_INTENT('Arikok');
    const entries = [item({ id: 'a' }), activity({ id: 'b' }), item({ id: 'c' })];
    const pool = buildPool(entries, intent);
    expect(pool.map((p) => p.entry)).toEqual(entries);
    expect(pool.every((p) => p.unknowns === 0)).toBe(true);
  });
});

describe('acceptance — "good with toddler" against the real snapshot', () => {
  // Offline: enrichment.json is committed, so this needs no network and no key.
  it('excludes every product the pilot judged unsuitable at high confidence', () => {
    const judged = Object.entries(SNAPSHOT as Record<string, { toddler_ok?: boolean; kid_appeal?: number; facet_confidence?: string }>)
      .filter(([, r]) => typeof r.toddler_ok === 'boolean');
    expect(judged.length).toBeGreaterThan(200);   // 287 at time of writing

    const items = mergeEnrichment(
      judged.map(([id]) => ({
        id, group_id: 'g', title: id, image_url: '', price_usd: 100, duration: '',
        rating: 4.5, review_count: 100, viator_item_url: '', is_best_seller: false,
        display_order: 0,
      })),
      SNAPSHOT as never,
    );
    const entries: ExploreEntry[] = items.map((it) => ({
      kind: 'item', item: it, category: 'Tours', adventure: 50, sections: [],
    }));

    const pool = buildPool(entries, intentOf(['toddler']));
    const kept = new Set(pool.map((p) => p.entry.kind === 'item' && p.entry.item.id));

    const unsuitable = judged.filter(([, r]) => r.toddler_ok === false).map(([id]) => id);

    // SAFETY STILL LEADS: a `false` disqualifies however appealing the listing.
    expect(unsuitable.filter((id) => kept.has(id))).toEqual([]);

    // But `toddler_ok: true` is no longer sufficient, and asserting that it was
    // is what this test used to do. Safe and good are two questions: 32 of the
    // 39 products that pass the safety judgement score under 2 on `kid_appeal` —
    // private island tours, a romantic cabana picnic, a historic walking tour.
    // A toddler survives every one of them and enjoys none, which is how "good
    // with toddler" shipped a correctly filtered list led by bus tours.
    const appealing = judged
      .filter(([, r]) => r.toddler_ok === true && r.facet_confidence === 'high'
        && (r.kid_appeal ?? 0) >= 2)
      .map(([id]) => id);
    // Gated on facet_confidence the way mergeEnrichment gates it, because the
    // pool sees the MERGED item and the snapshot read here is the raw file. 11
    // products carry a low `kid_appeal` at medium confidence, which the merge
    // deliberately withholds — so they reach the pool with no appeal judgement
    // at all and pass on safety alone. Asserting against the raw file instead
    // would be testing data the code is designed not to act on.
    const dull = judged
      .filter(([, r]) => r.toddler_ok === true && r.facet_confidence === 'high'
        && r.kid_appeal !== undefined && r.kid_appeal < 2)
      .map(([id]) => id);

    expect(appealing.every((id) => kept.has(id))).toBe(true);
    expect(dull.filter((id) => kept.has(id))).toEqual([]);
    expect(pool.every((p) => p.unknowns === 0)).toBe(true);
  });

  it('excludes the off-road tours by name', () => {
    // The products that started this: 459169P1 is a UTV whose operator sets a
    // minimum age of 3 while the listing advertises infant seats.
    const utvs = ['459169P1', '459169P2'];
    const items = mergeEnrichment(
      utvs.map((id) => ({
        id, group_id: 'g', title: id, image_url: '', price_usd: 100, duration: '',
        rating: 4.5, review_count: 100, viator_item_url: '', is_best_seller: false,
        display_order: 0,
      })),
      SNAPSHOT as never,
    );
    expect(items.every((i) => i.toddler_ok === false)).toBe(true);
    const entries: ExploreEntry[] = items.map((it) => ({
      kind: 'item', item: it, category: 'Tours', adventure: 90, sections: [],
    }));
    expect(buildPool(entries, intentOf(['toddler']))).toEqual([]);
  });
});

describe('food and private remain dormant', () => {
  it('do not compile, so those queries behave as they did before', () => {
    // Both have predicates and neither may be EMITTED, which is now a property
    // of the vocabulary rather than of a parser's word list.
    expect(EMITTABLE_CONCEPTS).not.toContain('private');
    expect(EMITTABLE_CONCEPTS).not.toContain('food');
    expect(EMITTABLE_CONCEPTS).toContain('cheap');
  });
});

describe('every concept must be answerable by data that actually exists', () => {
  // THE GUARD FOR THE WHOLE CLASS. Four ship-gate passes each found the same
  // shape of bug: compiler correct, predicate correct, snapshot correct, and the
  // JOIN wrong — a concept whose word is consumed from the query while nothing
  // in the catalog can answer it. The query then embeds nothing, every verdict
  // is unknown, demote keeps everything, and search returns the whole catalog
  // under a heading claiming it matched.
  //
  // REAL TITLES, AND THE PRODUCT ARM. The first version of this guard built its
  // items with `title: id` and accepted a `fail` from ANY entry — so the 26
  // curated locals could satisfy it alone, and it would NOT have caught `beach`
  // (0 of 327 products, 13 of 26 locals). It now runs on the 327 real product
  // titles and demands the fail come from a PRODUCT: products are 92% of the
  // catalog, and a concept that can only decide the other 8% narrows nothing
  // while its word has already been eaten from the embedding.
  const products: ExploreEntry[] = mergeEnrichment(
    (JUDGED as { products: { id: string; title: string }[] }).products.map((p, i) => ({
      id: p.id, group_id: 'sightseeing-tours', title: p.title, image_url: '',
      // Prices VARY. A uniform fixture is what made this guard vacuous: with
      // every product at $100, `cheap` failed 100% of them and the guard was
      // satisfied by a predicate that could never pass anything.
      price_usd: 30 + (i % 5) * 40, duration: '', rating: 4.5, review_count: 100,
      viator_item_url: '', is_best_seller: false, display_order: 0, flags: [],
    })),
    SNAPSHOT as never,
  ).map((it) => ({
    kind: 'item' as const, item: it, category: 'Tours' as const,
    adventure: advValue({ title: it.title, category: 'Tours' }), sections: [],
  }));

  const verdicts = (c: Concept) => new Set(products.map((e) => verdictFor(c, facetsOf(e))));
  const decides = (c: Concept) => verdicts(c).has('pass') && verdicts(c).has('fail');

  it('can both keep and exclude a real product, for every concept it emits', () => {
    // SYMMETRIC, and that is the whole point. Requiring only a `fail` let a
    // predicate that rejects the ENTIRE catalog satisfy the guard — proven by
    // mutation: replacing a concept with `() => 'fail'` left the full suite
    // green. The beach bug ran in the other direction (never passes), so a rule
    // checking one direction cannot close the class.
    expect(EMITTABLE_CONCEPTS.filter((c) => !decides(c))).toEqual([]);
  });

  it('rejects every concept currently held dormant', () => {
    // Without this the guard is unfalsifiable — it would pass whatever the rule
    // was. Each of these was removed for being undecidable on the product arm,
    // and each must still fail the rule.
    // kids and accessible left this list on 2026-08-16 when the enrichment pass
    // gave them data. `beach` and `food` await a setting-based predicate;
    // `private` awaits absence being preserved in normalize.ts.
    const dormant: Concept[] = ['food', 'private'];
    expect(dormant.filter(decides)).toEqual([]);
  });
});

describe('easy/adventure must not exclude on a value nobody measured', () => {
  const named = (id: string, title: string): ExploreEntry => ({
    kind: 'item',
    item: {
      id, group_id: 'sightseeing-tours', title, image_url: '', price_usd: 100,
      duration: '', rating: 4.5, review_count: 100, viator_item_url: '',
      is_best_seller: false, display_order: 0,
    },
    category: 'Tours', adventure: advValue({ title, category: 'Tours' }), sections: [],
  });

  it('gives a verdict when the title names what the activity IS', () => {
    // 'utv' is in the adrenaline tier, checked first — the operator's own word,
    // the same text the embedding is built from.
    const f = facetsOf(named('utv', 'Off-Road UTV Adventure'));
    expect(verdictFor('adventure', f)).toBe('pass');
    expect(verdictFor('easy', f)).toBe('fail');
  });

  it('gives a verdict for a curated pick with a hand-set value', () => {
    const f = facetsOf(activity({ id: 'eagle', adventure: 10 }));
    expect(verdictFor('easy', f)).toBe('pass');
  });

  it('returns unknown when only the generic catch-all matched', () => {
    // ADV_KEYWORDS' last tier is commented "Generic-chill catch-all": `tour`,
    // `transfer`, `bus`, `excursion` all resolve to 18. "Island Tour" is not a
    // calm activity, it is an activity nobody has classified — and 18 would
    // have it PASS `easy` and be excluded from `adventure`, on the strength of
    // the word "tour".
    const f = facetsOf(named('island', 'Aruba Island Tour'));
    expect(verdictFor('easy', f)).toBe('unknown');
    expect(verdictFor('adventure', f)).toBe('unknown');
  });

  it('returns unknown when nothing matched and the category proxy filled in', () => {
    const f = facetsOf(named('mystery', 'Something Entirely Unclassifiable'));
    expect(verdictFor('easy', f)).toBe('unknown');
    expect(verdictFor('adventure', f)).toBe('unknown');
  });

  it('keeps an unmeasured entry in the pool rather than excluding it', () => {
    const pool = buildPool([named('island', 'Aruba Island Tour')], intentOf(['easy']));
    expect(pool).toHaveLength(1);
    expect(pool[0].unknowns).toBe(1);
  });
});

describe('a rescue is a guess, and must never rank as a judgement', () => {
  const toddler = intentOf(['toddler']);

  it('does not rescue a Viator product at all', () => {
    // RESCUE's own docstring says "the entry's OWN curated fields" and "the 26
    // curated locals". It was reading `adventure` and `category`, which every
    // entry has, so an unassessed PRODUCT scoring <= 30 was being handed a
    // clean verdict — and then ranked above one the pilot explicitly cleared.
    const e = { ...item({ id: 'unassessed' }), adventure: 10, category: 'Tours' as const };
    const pool = buildPool([e], toddler);
    expect(pool).toHaveLength(1);
    expect(pool[0].unknowns).toBe(1);
  });

  it('still lets a rescued curated pick through the filter', () => {
    const pool = buildPool([activity({ id: 'baby-beach-snorkel' })], toddler);
    expect(pool).toHaveLength(1);
  });

  it('but ranks that rescued pick as unproven', () => {
    const pool = buildPool([activity({ id: 'baby-beach-snorkel' })], toddler);
    expect(pool[0].unknowns).toBe(1);
  });

  it('ranks a real verdict above a rescue', () => {
    const judged = item({ id: 'judged', toddler_ok: true });
    const rescued = activity({ id: 'rescued-local' });
    const pool = buildPool([rescued, judged], toddler);
    expect(pool.map((p) => p.unknowns)).toEqual([1, 0]);
  });

  it('does not let a rescue exclude anything on a mustNot', () => {
    // Excluding on a guess is the failure this whole branch keeps re-learning.
    const pool = buildPool([activity({ id: 'calm-local' })], intentOf([], ['toddler']));
    expect(pool).toHaveLength(1);
  });
});

describe('setting and vessel answer what category could not', () => {
  it('reads beach from the setting facet, not from the tab an editor filed it under', () => {
    // The old predicate asked `category === 'Beaches'`, which no Viator product
    // can ever be. `setting` is a statement about where the activity physically
    // happens, so it decides a product.
    expect(verdictFor('beach', facetsOf(item({ id: 'a', setting: 'beach' })))).toBe('pass');
    expect(verdictFor('beach', facetsOf(item({ id: 'b', setting: 'mixed' })))).toBe('pass');
    expect(verdictFor('beach', facetsOf(item({ id: 'c', setting: 'town' })))).toBe('fail');
    expect(verdictFor('beach', facetsOf(item({ id: 'd' })))).toBe('unknown');
  });

  it('still trusts a curated pick own tab when it has no setting', () => {
    expect(verdictFor('beach', facetsOf(activity({ id: 'eagle' })))).toBe('pass');
  });

  it('decides boat from vessel, where null is a real answer', () => {
    // `vessel: null` is "explicitly not aboard anything" — a shore snorkel.
    // Absent is "could not tell". Collapsing the two would make "snorkeling
    // zonder boot" exclude things nobody has judged.
    expect(verdictFor('boat', facetsOf(item({ id: 'a', vessel: 'catamaran' })))).toBe('pass');
    expect(verdictFor('boat', facetsOf(item({ id: 'b', vessel: 'boat' })))).toBe('pass');
    expect(verdictFor('boat', facetsOf(item({ id: 'c', vessel: null })))).toBe('fail');
    expect(verdictFor('boat', facetsOf(item({ id: 'd' })))).toBe('unknown');
  });

  // The "does 'snorkelen zonder boot' compile to mustNot: ['boat']" test used to
  // live here and has been DELETED, not moved and not weakened. It asserted the
  // behaviour of a hand-written alias table, and translating text into concepts
  // is now the `search` edge function's job. Asserting it here would have meant
  // keeping a word list purely to have something to test — which is how the
  // alias table justified itself in the first place. What this file still owns
  // is the half that can be checked offline: given an intent, does the filter do
  // the right thing.

  it('keeps a shore snorkel and drops a catamaran for "without a boat"', () => {
    const shore = item({ id: 'shore', vessel: null, setting: 'beach' });
    const cat = item({ id: 'cat', vessel: 'catamaran', setting: 'ocean' });
    const pool = buildPool([shore, cat], intentOf(['beach'], ['boat']));
    expect(pool.map((p) => p.entry.kind === 'item' && p.entry.item.id)).toEqual(['shore']);
  });
});

// --- splitByFacet -----------------------------------------------------------
/**
 * Explore's "Good for kids" checkbox runs on this rather than on a predicate of
 * its own, so the pill and the search box cannot come to mean different things
 * by the same word.
 *
 * It reports `unjudged` separately from what it removed. 128 of the 350 Explore
 * entries carry no kids judgement at all, and a filter that quietly deleted a
 * third of the page would look like the catalog is smaller than it is — the
 * caption says how many were dropped for want of an answer rather than for
 * failing one.
 */
describe('splitByFacet', () => {
  const withKids = (id: string, kids?: { min_age: number; baby_ok: boolean }): ExploreEntry => ({
    kind: 'item',
    item: { id, title: id, kids, price_usd: 50 } as ViatorItem,
    category: 'Tours', adventure: 30, sections: [],
  });

  it('keeps only a confident pass', () => {
    const { kept } = splitByFacet([
      withKids('suits-a-child', { min_age: 5, baby_ok: true }),
      withKids('adults-only', { min_age: 18, baby_ok: false }),
    ], 'kids');
    expect(kept.map((e) => (e as { item: ViatorItem }).item.id)).toEqual(['suits-a-child']);
  });

  it('counts what nobody judged apart from what failed', () => {
    const { kept, unjudged } = splitByFacet([
      withKids('yes', { min_age: 2, baby_ok: true }),
      withKids('no', { min_age: 16, baby_ok: false }),
      withKids('unchecked', undefined),
      withKids('also-unchecked', undefined),
    ], 'kids');
    expect(kept).toHaveLength(1);
    expect(unjudged).toBe(2);
  });

  it('reports nothing unjudged when every entry carries an answer', () => {
    const { unjudged } = splitByFacet([withKids('a', { min_age: 4, baby_ok: true })], 'kids');
    expect(unjudged).toBe(0);
  });

  it('is a no-op shape on an empty list', () => {
    expect(splitByFacet([], 'kids')).toEqual({ kept: [], unjudged: 0 });
  });
});
