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
  /** 0-3: would a small child ENJOY it. Distinct from toddlerOk, which is safety. */
  kidAppeal?: number;
  /** 0-3: would a bored teenager enjoy it. Frequently the opposite of kidAppeal. */
  teenAppeal?: number;
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

export type PoolEntry = { entry: ExploreEntry; unknowns: number; strength: number };
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
      kidAppeal: entry.item.kid_appeal,
      teenAppeal: entry.item.teen_appeal,
      setting: entry.item.setting,
      vessel: entry.item.vessel,
      swimRequired: entry.item.swim_required,
      indoor: entry.item.indoor,
    };
  }
  // The curated locals ARE judged now, by the same --facets pass as the products
  // (2026-08-16). `flags`, `toddlerOk`, `setting` and `vessel` stay absent
  // because no pass writes them for an Activity — absent means unjudged, which
  // is the truth rather than a default.
  return {
    ...common,
    kids: entry.activity.kids,
    physical: entry.activity.physical,
    swimRequired: entry.activity.swim_required,
    indoor: entry.activity.indoor,
    kidAppeal: entry.activity.kid_appeal,
    teenAppeal: entry.activity.teen_appeal,
    flags: undefined, toddlerOk: undefined, setting: undefined, vessel: undefined,
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
  // SAFE AND GOOD ARE TWO QUESTIONS, and answering only the first is what made
  // "good with toddler" return a correctly filtered list led by air-conditioned
  // bus tours, with photoshoots at 14-16. `toddler_ok` asks whether a 1-3 year
  // old could be there; `kid_appeal` asks whether they would enjoy it. Measured
  // 2026-08-16: 32 of the 39 products that pass the first score under 2 on the
  // second. The design doc predicted this exact failure and said the two must be
  // separate facets; only one of them had been built.
  //
  // Safety still leads: a `false` disqualifies however appealing the listing is.
  toddler: (f) => {
    if (f.toddlerOk === false) return 'fail';
    if (f.kidAppeal !== undefined) return f.kidAppeal >= 2 ? 'pass' : 'fail';
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
  // EFFORT, not vibe. Deliberately a separate concept from `easy`, which reads
  // the adventure axis — the two agree often enough to look redundant and come
  // apart exactly where it matters: a horseback ride is gentle to look at and
  // hard to do. `moderate` PASSES, matching the conformance rule character for
  // character, because the check and the filter must agree on what the word
  // means or the harness grades a filter it disagrees with.
  low_effort: (f) => (f.physical ? (f.physical.demand === 'high' ? 'fail' : 'pass') : 'unknown'),
  // The last concept, and the one that closes the harness's `deferred` list. A
  // teenager is not a small adult and not a big child: 151 products score >= 2
  // here and <= 1 on kidAppeal.
  teens: (f) => (f.teenAppeal === undefined ? 'unknown' : f.teenAppeal >= 2 ? 'pass' : 'fail'),
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

/**
 * HOW STRONGLY the data says yes, 0..1, for a concept that already passed.
 *
 * A verdict is binary and the ranking that follows it was not: for a query the
 * constraint consumes whole, cosine is left ordering the survivors by their
 * marketing copy, and "fun for all ages" is on every island tour in the
 * catalogue. That is how "good with toddler" put an air-conditioned bus above
 * Arashi Beach — judged kid_appeal 3, the highest score anywhere.
 *
 * Only concepts with a MAGNITUDE can answer this. The rest return 0.5, a
 * deliberate neutral: on those queries strength is uniform and the embedding
 * order decides, exactly as before. This changes ranking only where the data has
 * something to say about degree.
 */
export function strengthFor(concept: Concept, facets: Facets): number {
  switch (concept) {
    case 'toddler':
      return facets.kidAppeal === undefined ? 0.5 : Math.min(1, facets.kidAppeal / 3);
    case 'teens':
      return facets.teenAppeal === undefined ? 0.5 : Math.min(1, facets.teenAppeal / 3);
    case 'kids':
      return facets.kids ? Math.max(0, 1 - facets.kids.min_age / 12) : 0.5;
    // Both directions of the vibe axis, so neither is ranked by accident.
    case 'easy':      return facets.adventureGrounded ? 1 - facets.adventure / 100 : 0.5;
    case 'adventure': return facets.adventureGrounded ? facets.adventure / 100 : 0.5;
    case 'low_effort':
      return facets.physical ? (facets.physical.demand === 'low' ? 1 : 0.5) : 0.5;
    case 'cheap':
      return facets.price > 0 ? Math.max(0, 1 - facets.price / 120) : 1;
    default: return 0.5;
  }
}

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
    return entries.map((entry) => ({ entry, unknowns: 0, strength: 0.5 }));
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
      const v = verdictFor(concept, facets);
      if (v === 'pass') { dropped = true; break; }
      // ...but keeping is not the same as ANSWERING, and conflating the two is
      // how "half day trip that isn't a boat" came back with 280 entries: a
      // mustNot counted no unknowns at all, so the 113 products nobody has
      // judged for `vessel` read as confidently clear. Counting them here keeps
      // them in the pool (nothing is excluded on a guess) while letting the
      // caller tell "the data says this is not a boat" apart from "nobody
      // looked".
      if (v !== 'fail') unknowns++;
    }
    if (dropped) continue;

    // Mean strength over the `must` concepts. A mustNot contributes nothing:
    // "not a boat" has no degrees — either the data rules it out or it does not.
    const strength = intent.must.length
      ? intent.must.reduce((sum, c) => sum + strengthFor(c, facets), 0) / intent.must.length
      : 0.5;
    out.push({ entry, unknowns, strength });
  }
  return out;
}

/**
 * Split a list by one facet: what the data confidently says yes to, and how much
 * of it nobody has judged.
 *
 * Explore's facet checkboxes run on this, so a pill labelled "Good for kids"
 * and the query "good for kids" cannot come to mean different things — the
 * whole reason `verdictFor` exists in one place.
 *
 * `unjudged` is returned rather than folded into the removals because the two
 * are different facts about the catalog and only one of them is about the
 * activity. 137 of Explore's 350 entries carry no kids judgement at all, so a
 * filter that silently dropped them would read as "the island has less for
 * families than it does" instead of "we have not checked these yet". The caller
 * shows the number.
 *
 * Note the policy difference from `buildPool`, which defaults to `demote` and
 * KEEPS unknowns. That is right for a typed query, where a false exclusion is
 * invisible and the ranker can sort proven above unproven. A checkbox is a
 * narrower promise: it names a claim, and an entry nobody has checked cannot
 * back it. So here an unknown is removed — and counted, so it is never silent.
 */
export function splitByFacet(
  entries: ExploreEntry[],
  concept: Concept,
): { kept: ExploreEntry[]; unjudged: number } {
  const kept: ExploreEntry[] = [];
  let unjudged = 0;
  for (const entry of entries) {
    const v = verdictFor(concept, facetsOf(entry));
    if (v === 'pass') kept.push(entry);
    else if (v !== 'fail') unjudged++;   // 'unknown' and 'rescued'
  }
  return { kept, unjudged };
}
