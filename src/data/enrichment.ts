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

    return Object.keys(add).length ? { ...item, ...add } : item;
  });
}
