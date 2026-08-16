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

    if (rec.confidence === 'high' && rec.evidence) {
      if (rec.physical) add.physical = rec.physical;
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
      if (rec.physical && !add.physical) add.physical = rec.physical;
      if (rec.kids && !add.kids) add.kids = rec.kids;
      if (typeof rec.swim_required === 'boolean') add.swim_required = rec.swim_required;
      if (rec.indoor) add.indoor = rec.indoor;
    }

    return Object.keys(add).length ? { ...item, ...add } : item;
  });
}
