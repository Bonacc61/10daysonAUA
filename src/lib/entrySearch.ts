import { blendSearchResults, entryExcludedByFlags, type ExploreEntry } from '../data/exploreItems';
import { flagsFromNotes } from '../data/notesFlags';

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
  const blendable = query.trim() === semantic.answers && semantic.ids.length > 0;
  // The pool is a thunk because building it allocates the whole catalog and
  // re-derives every section. Passing it eagerly cost that on every keystroke
  // for a branch that is not taken while the flag is dark.
  //
  // blendSearchResults appends its extras after the hits it was given, so the
  // tail IS the semantic contribution — which is what makes counting it honest
  // rather than inferred from a length difference.
  const extras = blendable
    ? blendSearchResults(substringHits, semantic.ids, unsearchedPool()).slice(substringHits.length)
    : [];

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
