import { blendSearchResults, entryExcludedByFlags, entryId, type ExploreEntry } from '../data/exploreItems';
import { flagsFromNotes } from '../data/notesFlags';
import { buildPool } from './searchPool';
import type { QueryConstraint } from './semanticSearch';

/**
 * What a search box does to a list of entries, in one place.
 *
 * Explore and My Aruba > Personalized both run this. Two hand-maintained copies
 * would drift, and the drift would be invisible: both boxes look identical, so
 * the only way to notice one had stopped honouring "we get seasick" is to type
 * it into both and compare. The layers, in order:
 *
 *  1. SUBSTRING hits, computed by the caller — they stay first, always. Cosine
 *     similarity blurs the distinctions proper nouns depend on, so "Arikok" is
 *     better served locally.
 *  2. SEMANTIC ids appended below, and only when they answer the query CURRENTLY
 *     in the box — otherwise an edited query keeps showing the old one's matches.
 *  3. CONTRAINDICATIONS the traveller typed, as exclusions. Applied to keyword
 *     hits too: a substring match on a boat is no more wanted than a semantic
 *     one. Same parser the questionnaire's free-text box uses, so the two paths
 *     cannot disagree about what "seasick" means.
 *
 * `unsearchedPool` is what semantic ids are resolved against, and it is the
 * caller's choice of pool that keeps a surface honest — Explore passes the
 * section/vibe/price-filtered catalog; the Personalized panel passes only
 * profile-matched entries, so "search by meaning" cannot surface an activity
 * under a heading that claims everything below it matches your profile.
 */
export type SemanticState = {
  /** Ids the search function ranked, best first. */
  ids: string[];
  /** The query those ids answer. Blending is skipped unless it matches. */
  answers: string;
  /**
   * What the server understood the query to MEAN, or null when it parsed
   * nothing. Null leaves the pool untouched — today's behaviour exactly.
   */
  constraint?: QueryConstraint | null;
};

export type SearchResult = {
  entries: ExploreEntry[];
  /**
   * How many entries search-by-meaning actually ADDED — after the pool bounded
   * them and after exclusions removed some.
   *
   * Not `semantic.ids.length`, which is what the search function ranked over the
   * whole catalog and is routinely larger. Measured on the live catalog, the
   * Personalized panel's profile pool holds 36–61% of the 354 entries for four
   * of five sample personas, so reporting the raw id count would tell a
   * traveller "Added 24 matches by meaning" above a list that gained nine — or,
   * in the worst case, directly above "Nothing among your matches".
   */
  addedByMeaning: number;
};

export function searchEntries(
  query: string,
  substringHits: ExploreEntry[],
  unsearchedPool: () => ExploreEntry[],
  semantic: SemanticState,
): SearchResult {
  // ANSWERED and BLENDABLE are different questions, and they only looked like
  // one question while ids were the whole of a search result. A query the parse
  // compiled completely comes back with a constraint and NO ids — searched
  // successfully, nothing left to rank — so requiring an id here silently threw
  // the entire parse away. Caught by a test, not by reading.
  const answered = query.trim() === semantic.answers;
  const blendable = answered && semantic.ids.length > 0;
  // The pool is a thunk because building it allocates the whole catalog and
  // re-derives every section. Passing it eagerly cost that on every keystroke
  // for a branch that is not taken while the flag is dark.
  //
  // blendSearchResults appends its extras after the hits it was given, so the
  // tail IS the semantic contribution — which is what makes counting it honest
  // rather than inferred from a length difference.
  // THE CONSTRAINT FILTERS; THE EMBEDDING ONLY ORDERS WHAT SURVIVES.
  //
  // Two things are appended below the substring hits, in this order:
  //
  //  1. the ranked ids, kept only where they satisfy the constraint — this is
  //     what stops "half day trip that isn't a boat" returning boats, and no
  //     amount of better ranking could have done it;
  //  2. everything ELSE that satisfies the constraint. If 45 activities conform,
  //     45 is the right answer, and the ranker's 30 was only ever a bound on how
  //     many could be ORDERED, never on how many qualify. A query the parse
  //     compiled whole returns no ids at all, and this is the entire result.
  //
  // Unranked entries are ordered by how much the data actually KNOWS about them
  // (`unknowns` ascending), so an activity a facet cleared outranks one nothing
  // has judged. It is not a relevance score and does not pretend to be.
  const intent = answered && semantic.constraint
    && (semantic.constraint.must.length > 0 || semantic.constraint.mustNot.length > 0)
    ? semantic.constraint : null;

  let extras: ExploreEntry[] = [];
  if (intent) {
    const eligible = buildPool(unsearchedPool(), { ...intent, boosts: [], matched: [], residual: '' });
    const byId = new Map(eligible.map((p) => [entryId(p.entry), p]));
    const seen = new Set(substringHits.map(entryId));
    // ONE ordered list, not "ranked things then the rest". The old shape put
    // every embedding hit above every unranked entry, which is why a bus tour
    // whose copy says "fun for all ages" outranked the beach the data scored
    // highest. Order is now: what the data confidently knows, then how strongly
    // it says yes, then the embedding as the tiebreaker it should always have
    // been. On queries where no concept has a magnitude, strength is uniform and
    // this reduces to the embedding order exactly as before.
    const rank = new Map(semantic.ids.map((id, i) => [id, i]));
    const ordered = eligible
      // Two ways to earn a place: the DATA vouches for you (nothing unknown), or
      // the EMBEDDING did (it ranked you). Keeping only the first would drop a
      // ranked id the facets happen not to cover — a false exclusion, and those
      // are invisible because nobody sees what they were not shown. Keeping only
      // the second is what buried Arashi Beach. Unknown-but-ranked entries sort
      // below everything confident, via the `unknowns` key below.
      .filter((p) => !seen.has(entryId(p.entry)) && (p.unknowns === 0 || rank.has(entryId(p.entry))))
      .sort((a, b) =>
        a.unknowns - b.unknowns
        || b.strength - a.strength
        || (rank.get(entryId(a.entry)) ?? Infinity) - (rank.get(entryId(b.entry)) ?? Infinity))
      .map((p) => p.entry);
    // ONLY WHAT THE DATA AFFIRMATIVELY CLEARED. `unknowns === 0` means every
    // concept in the constraint was actually decided for this entry.
    //
    // The distinction the first version missed: `unknown` is kept in the POOL so
    // that a ranked result is never dropped on a guess — that is a protection
    // against false exclusion. It is not a licence to promote every unjudged
    // catalog entry into the results. Measured 2026-08-16, conflating the two
    // returned 280 entries for "half day trip that isn't a boat" and 276 for
    // "we want to see fish but not swim" out of a 328-item catalog: nothing
    // contradicted the query, and nothing was an answer to it either.
    //
    // A ranked id that is merely unknown still survives above, because the
    // embedding put it there on its own evidence. This tail has no such
    // evidence, so it needs the data's.
    extras = ordered;
  } else if (blendable) {
    extras = blendSearchResults(substringHits, semantic.ids, unsearchedPool()).slice(substringHits.length);
  }

  const flags = new Set(flagsFromNotes(query));
  if (flags.size === 0) {
    return { entries: extras.length ? [...substringHits, ...extras] : substringHits, addedByMeaning: extras.length };
  }
  const keep = (e: ExploreEntry) => !entryExcludedByFlags(e, flags);
  const keptExtras = extras.filter(keep);
  return {
    entries: [...substringHits.filter(keep), ...keptExtras],
    addedByMeaning: keptExtras.length,
  };
}
