// Constraint filtering — the pool the ranker is allowed to draw from.
//
// This is the half of the fix that embeddings structurally cannot do. Cosine
// can lift a good match toward a query; it has no mechanism to push a bad one
// away, so a UTV that scores 0.31 for "good with toddler" stays at 0.31 and
// simply occupies result slots 10-30. Filtering before ranking is what ends
// that — not better ranking, fewer results.
//
// The pool is built client-side over ExploreEntry, which is why item_embeddings
// needs no metadata columns: the structure never has to exist in Postgres.

import { adventureIsGrounded, priceOf, type ExploreEntry, type Category } from '../data/exploreItems';
import type { Concept, Intent } from './searchConstraint';

export type Facets = {
  /** True for one of the island's own picks, false for a Viator product. */
  curated: boolean;
  category: Category;
  adventure: number;
  price: number;
  kids?: { min_age: number; baby_ok: boolean };
  physical?: { demand: 'low' | 'moderate' | 'high'; mobility_ok: boolean };
  /** Viator's own merchandising flags, verbatim. Absent means Viator said nothing. */
  flags?: string[];
  /** Internal judgement, filter-only — never rendered. See ViatorItem.toddler_ok. */
  toddlerOk?: boolean;
  /** Where the activity physically happens. */
  setting?: 'beach' | 'ocean' | 'land' | 'town' | 'mixed';
  /** What the traveller is aboard. `null` is "explicitly nothing"; absent is "unjudged". */
  vessel?: 'boat' | 'catamaran' | 'submarine' | 'jetski' | null;
  /** Must the traveller get INTO the water. Absent is unjudged, not "no". */
  swimRequired?: boolean;
  /** Whether there is a roof over the main part of it. A different question from `setting`. */
  indoor?: 'indoor' | 'outdoor' | 'mixed';
  /**
   * Whether `adventure` reflects the activity or is a guess. advValue() always
   * returns a number — every card needs a slider position — but two of its four
   * tiers are guesses, and a guess must not exclude anything.
   */
  adventureGrounded: boolean;
};

/**
 * A verdict a facet can return. `unknown` is the common case, not the edge.
 *
 * `rescued` is a fourth state on purpose. A heuristic that says "calm, not a
 * watersport, so a toddler is probably fine" is good enough to keep an entry in
 * the pool and NOT good enough to rank it alongside one a human-reviewed
 * judgement actually cleared. Collapsing it into `pass` is what let products
 * nobody had assessed outrank the ones the pilot did.
 */
export type Verdict = 'pass' | 'fail' | 'unknown' | 'rescued';

export type PoolEntry = { entry: ExploreEntry; unknowns: number };
export type UnknownPolicy = 'demote' | 'exclude';

/**
 * Normalise either arm of the union to one shape.
 *
 * Every key is assigned explicitly, including the absent ones, so a predicate
 * never has to know which arm it is looking at and `unknown` is a value rather
 * than a missing property.
 */
export function facetsOf(entry: ExploreEntry): Facets {
  // NOTE: `matched_by` is deliberately not threaded through for a Viator item —
  // it lives on the item's GROUP and facetsOf has no groups to hand. The effect
  // is that an item whose only signal is a group adventure tag reads as `proxy`
  // rather than `tag`, i.e. as unknown. That errs toward keeping an entry in the
  // pool, which is the safe direction for an exclusion.
  const grounded = entry.kind === 'activity'
    ? adventureIsGrounded({
        adventure: entry.activity.adventure, title: entry.activity.title,
        matched_by: entry.activity.matched_by, category: entry.category,
      })
    : adventureIsGrounded({
        adventure: entry.item.adventure, title: entry.item.title, category: entry.category,
      });
  const common = {
    curated: entry.kind === 'activity', adventureGrounded: grounded,
    category: entry.category, adventure: entry.adventure, price: priceOf(entry),
  };
  if (entry.kind === 'item') {
    return {
      ...common,
      kids: entry.item.kids,
      physical: entry.item.physical,
      flags: entry.item.flags,
      toddlerOk: entry.item.toddler_ok,
      setting: entry.item.setting,
      vessel: entry.item.vessel,
      swimRequired: entry.item.swim_required,
      indoor: entry.item.indoor,
    };
  }
  // The 26 curated locals carry no enrichment yet — see the toddler rescue below.
  return {
    ...common,
    kids: undefined, physical: undefined, flags: undefined,
    toddlerOk: undefined, setting: undefined, vessel: undefined,
    swimRequired: undefined, indoor: undefined,
  };
}

/**
 * Heuristic rescue for an unenriched entry.
 *
 * Only where the entry's OWN curated fields answer the question well enough to
 * be worth acting on. This is deliberately not a general fallback: guessing a
 * facet from a category is how "good with toddler" started returning UTVs.
 */
// CURATED ONLY. The docstring above always said "the entry's OWN curated
// fields" and "the 26 curated locals", but the predicate read `adventure` and
// `category`, which every entry has — so an unassessed Viator product scoring
// <= 30 was handed a clean verdict and then ranked above one the pilot had
// explicitly cleared. A product's adventure value is itself often derived
// (see adventureSource), so rescuing on it is a guess built on a guess.
const RESCUE: Partial<Record<Concept, (f: Facets) => boolean>> = {
  toddler: (f) => f.curated && f.adventure <= 30 && f.category !== 'Watersports',
};

const PREDICATES: Record<Concept, (f: Facets) => Verdict> = {
  // A real judgement outranks both the renderable `kids` pair and the rescue
  // heuristic below: the whole reason this facet exists is that the marketing
  // copy says "great for all ages" while the operator's minimum age says 3.
  toddler: (f) => {
    if (typeof f.toddlerOk === 'boolean') return f.toddlerOk ? 'pass' : 'fail';
    return f.kids ? (f.kids.baby_ok ? 'pass' : 'fail') : 'unknown';
  },
  // 8 is the band the enrichment prompt's `min_age` is written against — the
  // youngest age the activity sensibly suits — not a claim about any child.
  kids: (f) => (f.kids ? (f.kids.min_age <= 8 ? 'pass' : 'fail') : 'unknown'),
  accessible: (f) => (f.physical ? (f.physical.mobility_ok ? 'pass' : 'fail') : 'unknown'),
  // A number is always present, but it is only a VERDICT when it is grounded.
  // Ungrounded it came from the generic "tour"/"transfer" catch-all or from the
  // category proxy, and excluding on that is how "something relaxing" dropped
  // 128 products nobody had classified.
  easy: (f) => (!f.adventureGrounded ? 'unknown' : f.adventure <= 35 ? 'pass' : 'fail'),
  adventure: (f) => (!f.adventureGrounded ? 'unknown' : f.adventure >= 60 ? 'pass' : 'fail'),
  // `setting` decides this now. The old predicate asked whether the entry's TAB
  // said 'Beaches', which no Viator product can ever say — it was unsatisfiable
  // for all 328 and it failed curated picks that are literally at a beach.
  // `mixed` counts: it means the activity is genuinely both, like a beach day
  // that includes a boat trip out. A curated pick with no setting still falls
  // back to its own tab, which for the island's own picks is editorial fact.
  beach: (f) => {
    if (f.setting) return f.setting === 'beach' || f.setting === 'mixed' ? 'pass' : 'fail';
    return f.curated ? (f.category === 'Beaches' ? 'pass' : 'fail') : 'unknown';
  },
  // `vessel: null` is a real answer — a shore snorkel, explicitly aboard
  // nothing. Absent means unjudged. Collapsing the two would let "snorkeling
  // zonder boot" exclude things nobody has looked at.
  boat: (f) => (f.vessel === undefined ? 'unknown' : f.vessel === null ? 'fail' : 'pass'),
  // DORMANT. Same shape `beach` had: for a curated pick the category is
  // editorial fact, but for a product it is derived from one group id, so a
  // food product filed elsewhere would fail. Corrected here so it is right when
  // it returns — `setting` does not answer this one, so it waits for a facet
  // that does. (Deleted outright by a careless slice edit on 2026-08-16 and
  // caught by the reachability guard, which is the only thing that reads it.)
  food: (f) => (f.curated ? (f.category === 'Food' ? 'pass' : 'fail') : 'unknown'),
  cheap: (f) => (f.price <= 60 ? 'pass' : 'fail'),
  // Both stated positively; "not swim" and "not outdoors" arrive as mustNot.
  //
  // Absent is UNJUDGED, never "no". 214 of 328 products carry these at high
  // facet confidence, so on any query roughly a third of the catalog returns
  // `unknown` — and an unknown must never be excluded by a mustNot, or "see
  // fish but not swim" would drop everything nobody has assessed.
  swim: (f) => (f.swimRequired === undefined ? 'unknown' : f.swimRequired ? 'pass' : 'fail'),
  // `mixed` PASSES: part of it is under a roof, which is what someone sheltering
  // from rain is asking for. The conformance rule is written the same way, and
  // deliberately — the check and the filter must agree on what the word means.
  indoor: (f) => {
    if (f.indoor === undefined) return 'unknown';
    return f.indoor === 'indoor' || f.indoor === 'mixed' ? 'pass' : 'fail';
  },
  // DORMANT. The `unknown` arm is unreachable for live products:
  // viator-cards/normalize.ts coerces a missing `flags` to `[]`, so the
  // distinction this predicate rests on is destroyed one layer upstream. Either
  // absence is preserved there, or PRIVATE_TOUR coverage is measured against the
  // 88 product titles that begin with "Private", before this compiles again.
  private: (f) => (f.flags?.length ? (f.flags.includes('PRIVATE_TOUR') ? 'pass' : 'fail') : 'unknown'),
};

export function verdictFor(concept: Concept, facets: Facets): Verdict {
  const v = PREDICATES[concept](facets);
  if (v !== 'unknown') return v;
  const rescue = RESCUE[concept];
  return rescue && rescue(facets) ? 'rescued' : 'unknown';
}

/**
 * Filter the catalog to what the query's constraints allow.
 *
 * Two rules carry the design:
 *
 *  - **An unknown is never excluded by a `mustNot`.** We do not know the entry
 *    is the thing being ruled out, and a false exclusion is invisible — nobody
 *    can see the activity that silently was not offered.
 *  - **An unknown survives a `must` under the default `demote` policy.** The 26
 *    curated locals are unenriched, so excluding on absence would delete the
 *    island's own picks from every filtered search.
 *
 *    `unknowns` is what entrySearch sorts the eligible set on, so a demoted
 *    entry survives the filter and ranks below every entry that carries a real
 *    verdict. It counts rescues too — see `rescued`.
 */
export function buildPool(
  entries: ExploreEntry[],
  intent: Intent,
  policy: UnknownPolicy = 'demote',
): PoolEntry[] {
  if (intent.must.length === 0 && intent.mustNot.length === 0) {
    return entries.map((entry) => ({ entry, unknowns: 0 }));
  }

  const out: PoolEntry[] = [];
  for (const entry of entries) {
    const facets = facetsOf(entry);
    let unknowns = 0;
    let dropped = false;

    for (const concept of intent.must) {
      const v = verdictFor(concept, facets);
      if (v === 'fail') { dropped = true; break; }
      // A rescue survives the filter but is never counted as proven, so it
      // ranks below anything that carries a real verdict.
      if (v === 'rescued') { unknowns++; continue; }
      if (v === 'unknown') {
        if (policy === 'exclude') { dropped = true; break; }
        unknowns++;
      }
    }
    if (dropped) continue;

    for (const concept of intent.mustNot) {
      // Only a confident `pass` excludes. `unknown` AND `rescued` both keep the
      // entry — excluding on a guess is the failure this module keeps relearning.
      if (verdictFor(concept, facets) === 'pass') { dropped = true; break; }
    }
    if (dropped) continue;

    out.push({ entry, unknowns });
  }
  return out;
}
