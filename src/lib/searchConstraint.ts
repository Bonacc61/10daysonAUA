// The closed vocabulary a search query is compiled INTO.
//
// Types only, deliberately. There is no parser here and there must not be one:
// the previous attempt at this file was a hand-written alias table mapping ~60
// English and Dutch words onto these concepts, and it was measured on
// 2026-08-16 against the 25-query golden set — 6 compiled, 19 were no-ops, and
// BOTH of the negation cases the whole architecture exists to fix ("we get
// seasick", "no walking, we are tired") produced nothing at all. A closed
// vocabulary on the OUTPUT side is required; a closed vocabulary on the INPUT
// side is the bug. Translation from arbitrary text into these values is the
// `search` edge function's job, where a model does it.
//
// A concept belongs here ONLY if some real catalog entry can both PASS and FAIL
// it — the guard in searchPool.test.ts enforces exactly that, symmetrically. A
// word with no data behind it must fall through to the embedder as ordinary
// text rather than become a category guess, because a filter that excludes on a
// facet nobody has judged is worse than no filter: its mistakes are invisible.

export type Concept =
  | 'toddler' | 'kids' | 'accessible' | 'easy'
  | 'adventure' | 'beach' | 'boat' | 'food' | 'cheap' | 'private'
  // Added 2026-08-16 with the facets that back them. `swim` and `indoor` are
  // stated POSITIVELY even though the queries that need them are negative —
  // "see fish but not swim" is mustNot: ['swim'], not must: ['no_swim'].
  // Negation lives in the constraint's shape, so every concept stays a plain
  // property of an activity and each has exactly one predicate.
  | 'swim' | 'indoor'
  // Added 2026-08-16. `easy` is the VIBE axis (adventure <= 35) and says nothing
  // about effort: a sunrise horseback ride and the Hooiberg Hill hike are both
  // low-adventure and physically demanding, and both survived "no walking, we
  // are tired" — 32 of the 32 remaining conformance violations, in two queries,
  // one cause. `physical.demand` was in the data the whole time and no concept
  // reached it.
  | 'low_effort';

/**
 * What a query means, in the closed vocabulary.
 *
 * `must` and `mustNot` filter. `residual` is what is left for the embedder to
 * rank the survivors with — and when it is empty the constraints already say
 * everything the query said, so nothing needs to be embedded at all.
 */
export type Intent = {
  must: Concept[];
  mustNot: Concept[];
  boosts: Concept[];
  /** What is left for the embedder. Empty means: make no semantic call at all. */
  residual: string;
  matched: ConceptMatch[];
};

export type ConceptMatch = { concept: Concept; phrase: string; negated: boolean };

/**
 * The concepts a parse is permitted to emit, and the exact list the reachability
 * guard checks. Kept separate from `Concept` because the type is the vocabulary
 * a predicate may be WRITTEN for, while this is the subset currently backed by
 * enough data to act on — `food` and `private` have predicates and are absent
 * here, dormant until their data exists.
 */
export const EMITTABLE_CONCEPTS: Concept[] = [
  'toddler', 'kids', 'accessible', 'easy', 'adventure', 'beach', 'boat', 'cheap',
  'swim', 'indoor', 'low_effort',
];

/** The no-op every failure path returns: today's behaviour, exactly. */
export const NO_INTENT = (query: string): Intent =>
  ({ must: [], mustNot: [], boosts: [], residual: query, matched: [] });
