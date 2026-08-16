import type { ViatorItem } from '../types';
import { KIND_VOCABULARY } from './itemFit';

// === Catalog enrichment — the reviewed snapshot, merged at load =============
// Attributes an LLM derived from each product's own listing, offline, and a
// human accepted into src/data/enrichment.json. Nothing here resolves at
// runtime: this module reads a committed file and attaches fields to items.
//
// Why it exists: activityKind() drops 144 of 328 live items into four generic
// `sec:<section>` buckets, and itemAdventure() resolves all 328 into 11 values
// that restate the kind taxonomy. See
// docs/superpowers/specs/2026-08-11-catalog-enrichment-design.md.
//
// The load-bearing property is that an UNENRICHED item is not a broken item —
// it is today's item. Every field is optional, every consumer already has a
// fallback, and a product that appears between snapshot runs simply gets the
// existing heuristics. There is no error state here to handle.

export type EnrichmentRecord = {
  kind?: string;                    // must be in KIND_VOCABULARY
  adventure?: number;               // 0 chill … 100 adrenaline
  physical?: { demand: 'low' | 'moderate' | 'high'; mobility_ok: boolean };
  kids?: { min_age: number; baby_ok: boolean };
  /** Where the activity physically happens. Answers "beach", "indoors when it rains". */
  setting?: 'beach' | 'ocean' | 'land' | 'town' | 'mixed';
  /** What you are ON, if anything. `null` means explicitly not a vessel. */
  vessel?: 'boat' | 'catamaran' | 'submarine' | 'jetski' | null;
  confidence: 'high' | 'medium' | 'low';
  evidence?: string;                // VERBATIM span from the product description
  // Internal, filter-only. Excludes a product from a toddler pool; never
  // rendered, never quoted, and deliberately carries NO evidence requirement
  // because the judgement behind it (docs/map/judged-toddler-ok.json) produced
  // reasons in the model's own words rather than spans from the listing.
  toddler_ok?: boolean;
  /**
   * `toddler_ok`'s OWN confidence, because a row's facets are written by two
   * different passes and mean different things. The record-level `confidence`
   * belongs to the extraction pass (setting, kind, adventure); a `medium` there
   * says nothing about a judgement pass's verdict, and gating on it disabled 70
   * of 287 perfectly good toddler verdicts. Absent on rows written before the
   * split, which fall back to the record confidence.
   */
  toddler_ok_confidence?: 'high' | 'medium' | 'low';
  /**
   * Would a 1-3 year old ENJOY this, 0-3 — as opposed to `toddler_ok`, which
   * only asks whether they could safely be there. A private island tour is
   * toddler_ok and kid_appeal 0. That gap is why "good with toddler" returned a
   * correctly filtered list led by air-conditioned bus tours.
   */
  kid_appeal?: number;
  /** Would a bored 13-17 year old enjoy it, 0-3. Often the opposite of kid_appeal. */
  teen_appeal?: number;
  /** Must the traveller get INTO the water? A snorkel trip yes, a glass-bottom boat no. */
  swim_required?: boolean;
  /** What is over the traveller's head — a different question from `setting`. */
  indoor?: 'indoor' | 'outdoor' | 'mixed';
  /**
   * Confidence for `physical`, `kids`, `swim_required` and `indoor` — the four
   * fields the additive `--facets` pass writes. Separate from the record-level
   * `confidence` for the same reason `toddler_ok_confidence` is: the two passes
   * ask different questions, and a `medium` from the extraction pass says
   * nothing about a filter judgement made later.
   */
  facet_confidence?: 'high' | 'medium' | 'low';
};

export type EnrichmentSnapshot = Record<string, EnrichmentRecord>;

/**
 * The filter-only facets, for the 26 curated locals.
 *
 * A separate function because an Activity is not a ViatorItem: it has no price,
 * no group, no tags, and none of the tier-2 machinery applies. What it CAN carry
 * is the four judgements the --facets pass makes, which are the only ones the
 * search filter reads.
 *
 * Without this the records existed and reached nothing: `facetsOf`'s curated arm
 * hardcoded every facet to undefined, so Arashi Beach — judged kid_appeal 3, the
 * highest score in the entire catalog — was invisible to "good with toddler"
 * while eleven private island tours were not.
 */
export function mergeActivityEnrichment<T extends { id: string }>(
  activities: T[],
  snapshot: EnrichmentSnapshot,
): T[] {
  return activities.map((a) => {
    const rec = snapshot[a.id];
    if (!rec || rec.facet_confidence !== 'high') return a;
    const add: Partial<ActivityFacets> = {};
    if (rec.physical) add.physical = mobilityConsistent(rec);
    if (rec.kids) add.kids = rec.kids;
    if (typeof rec.swim_required === 'boolean') add.swim_required = rec.swim_required;
    if (rec.indoor) add.indoor = rec.indoor;
    if (typeof rec.kid_appeal === 'number') add.kid_appeal = rec.kid_appeal;
    if (typeof rec.teen_appeal === 'number') add.teen_appeal = rec.teen_appeal;
    return Object.keys(add).length ? { ...a, ...add } : a;
  });
}

export type ActivityFacets = {
  physical?: { demand: 'low' | 'moderate' | 'high'; mobility_ok: boolean };
  kids?: { min_age: number; baby_ok: boolean };
  swim_required?: boolean;
  indoor?: 'indoor' | 'outdoor' | 'mixed';
  kid_appeal?: number;
  teen_appeal?: number;
};

// Tier 1 — kind and adventure — are internal ranking signals. The worst case for
// a bad value is a mediocre pick, which the swap button already handles, so
// medium confidence is good enough.
const TIER1_OK = new Set(['high', 'medium']);

/**
 * Attach accepted enrichment fields to a catalog.
 *
 * Pure, and takes the snapshot as a parameter rather than importing it, so the
 * test suite passes its own fixture and can never be turned red — or green — by
 * a re-run of the enrichment tool.
 *
 * Two rules do the gating:
 *
 *  - **Tier 2 (physical, kids) requires HIGH confidence AND an evidence quote.**
 *    These are the fields that can reach a traveller as a claim about the real
 *    world, and the UI renders the quote verbatim rather than paraphrasing it —
 *    so a record with no quote has nothing showable and the fields are dropped
 *    with it. A wrong filter is invisible; a wrong promise strands someone.
 *
 *  - **A curated value always wins.** `adventure` set by hand on a local pick is
 *    editorial and outranks anything derived.
 */

/**
 * A judgement cannot outrank the facts beside it.
 *
 * `mobility_ok` is the field with the highest cost when it is wrong — a false
 * negative costs someone a suggestion, a false positive sends a wheelchair user
 * somewhere they cannot go — and the extraction prompt says so in as many words:
 * "Climbing a ladder onto a catamaran, walking over rock to a cove, snorkelling
 * from a boat — all false."
 *
 * The model agreed and then contradicted itself. Measured on the shipped
 * snapshot: 82 records claim `mobility_ok: true` at HIGH confidence, and 35 of
 * them also say `swim_required: true` or name a `vessel`. Confidence gates
 * cannot catch this, because the record is confident about both halves; only a
 * cross-facet check can. So the surrounding facts win, and the direction is
 * deliberately one-way — this can only ever turn a `true` into a `false`.
 */
function mobilityConsistent(rec: EnrichmentRecord): EnrichmentRecord['physical'] {
  const p = rec.physical;
  if (!p || !p.mobility_ok) return p;
  const contradicted = rec.swim_required === true || (rec.vessel !== undefined && rec.vessel !== null);
  return contradicted ? { ...p, mobility_ok: false } : p;
}

export function mergeEnrichment(items: ViatorItem[], snapshot: EnrichmentSnapshot): ViatorItem[] {
  return items.map((item) => {
    const rec = snapshot[item.id];
    if (!rec) return item;

    const add: Partial<ViatorItem> = {};

    if (TIER1_OK.has(rec.confidence)) {
      // A kind outside the vocabulary is a schema violation, not a new kind.
      if (rec.kind && KIND_VOCABULARY.has(rec.kind)) add.enriched_kind = rec.kind;
      if (typeof rec.adventure === 'number'
        && Number.isFinite(rec.adventure)
        && rec.adventure >= 0 && rec.adventure <= 100
        && item.adventure === undefined) {
        add.adventure = rec.adventure;
      }
    }

    // Exclusionary, so HIGH confidence only — the design doc's lesson from the
    // pilot is that the products which leaked through a looser prompt were all
    // low confidence and all hedged. No evidence needed: nothing renders it.
    if ((rec.toddler_ok_confidence ?? rec.confidence) === 'high'
      && typeof rec.toddler_ok === 'boolean') {
      add.toddler_ok = rec.toddler_ok;
    }

    // Exclusionary, like toddler_ok, so HIGH confidence only — the pilot's
    // lesson was that everything which leaked through a looser bar was low
    // confidence and hedged. No evidence requirement: neither is rendered.
    if (rec.confidence === 'high') {
      if (rec.setting) add.setting = rec.setting;
      if (rec.vessel !== undefined) add.vessel = rec.vessel;
    }

    // TWO PASSES SHARE ONE `physical` SLOT, so the confidence that gates it must
    // be the confidence of whichever pass last wrote it. The extraction pass's
    // record-level `confidence` says nothing about a judgement the --facets pass
    // made later and rated itself `medium` on — and 46 records were in exactly
    // that state, 12 of them asserting `mobility_ok: true`.
    //
    // That field is the one with the highest cost when it is wrong: its own
    // prompt says so, and `accessible` in searchPool.ts is the predicate that
    // reads it. A false negative costs someone a suggestion; a false positive
    // sends a wheelchair user to something they cannot do. So when the facets
    // pass has an opinion about its own reliability, that opinion binds.
    const facetOk = rec.facet_confidence === undefined || rec.facet_confidence === 'high';
    if (rec.confidence === 'high' && rec.evidence && facetOk) {
      if (rec.physical) add.physical = mobilityConsistent(rec);
      if (rec.kids) add.kids = rec.kids;
      if (add.physical || add.kids) add.evidence = rec.evidence;
    }

    // The additive --facets pass, on its OWN confidence and with no evidence
    // requirement. These four are filter-only — nothing renders them, and
    // `types.ts` describing a UI that quotes `evidence` describes an intention
    // rather than a screen that exists.
    //
    // The quote rule cost real coverage rather than buying safety: it blocked
    // exactly 0 records at this gate, while causing the extraction pass to OMIT
    // `physical` for 184 of 328 products upstream. Measured 2026-08-16, that
    // left "wheelchair accessible things to do" judgeable on 15 of 30 results.
    // Same reasoning `toddler_ok` already carries, applied to the fields the
    // conformance harness showed were least judgeable and most needed.
    //
    // Deliberately does NOT overwrite a tier-2 physical/kids that came with a
    // verbatim quote: an evidenced judgement is the better one, so this only
    // fills gaps.
    if (rec.facet_confidence === 'high') {
      if (rec.physical && !add.physical) add.physical = mobilityConsistent(rec);
      if (rec.kids && !add.kids) add.kids = rec.kids;
      if (typeof rec.swim_required === 'boolean') add.swim_required = rec.swim_required;
      if (rec.indoor) add.indoor = rec.indoor;
      if (typeof rec.kid_appeal === 'number') add.kid_appeal = rec.kid_appeal;
      if (typeof rec.teen_appeal === 'number') add.teen_appeal = rec.teen_appeal;
    }

    return Object.keys(add).length ? { ...item, ...add } : item;
  });
}
