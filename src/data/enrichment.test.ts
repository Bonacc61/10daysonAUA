import { describe, it, expect } from 'vitest';
import { mergeEnrichment } from './enrichment';
import type { EnrichmentSnapshot } from './enrichment';
import type { ViatorItem } from '../types';

const item = (id: string, opts: Partial<ViatorItem> = {}): ViatorItem => ({
  id, group_id: 'g', title: id, image_url: '',
  price_usd: 50, duration: '', rating: 4.5, review_count: 100,
  viator_item_url: '', is_best_seller: false, display_order: 0, ...opts,
});

const HIGH: EnrichmentSnapshot = {
  a1: {
    kind: 'kayak', adventure: 35,
    physical: { demand: 'moderate', mobility_ok: false },
    kids: { min_age: 8, baby_ok: false },
    confidence: 'high',
    evidence: 'paddle out through the mangroves; you board from a low dock',
  },
};

describe('mergeEnrichment — tier 1 (kind, adventure)', () => {
  it('attaches kind as enriched_kind and adventure as adventure', () => {
    const [out] = mergeEnrichment([item('a1')], HIGH);
    expect(out.enriched_kind).toBe('kayak');
    expect(out.adventure).toBe(35);
  });

  it('accepts tier 1 at medium confidence — a mediocre pick is the worst case', () => {
    const snap: EnrichmentSnapshot = { a1: { kind: 'sail', adventure: 20, confidence: 'medium' } };
    const [out] = mergeEnrichment([item('a1')], snap);
    expect(out.enriched_kind).toBe('sail');
    expect(out.adventure).toBe(20);
  });

  it('drops tier 1 at low confidence', () => {
    const snap: EnrichmentSnapshot = { a1: { kind: 'sail', adventure: 20, confidence: 'low' } };
    const [out] = mergeEnrichment([item('a1')], snap);
    expect(out.enriched_kind).toBeUndefined();
    expect(out.adventure).toBeUndefined();
  });

  it('never overwrites a curated adventure value', () => {
    const [out] = mergeEnrichment([item('a1', { adventure: 90 })], HIGH);
    expect(out.adventure).toBe(90);
  });

  it('rejects a kind outside the KIND_BY_TAG vocabulary', () => {
    const snap: EnrichmentSnapshot = { a1: { kind: 'helicopter', confidence: 'high' } };
    const [out] = mergeEnrichment([item('a1')], snap);
    expect(out.enriched_kind).toBeUndefined();
  });

  it('rejects an adventure value outside 0-100', () => {
    for (const bad of [-1, 101, Number.NaN]) {
      const [out] = mergeEnrichment([item('a1')], { a1: { adventure: bad, confidence: 'high' } });
      expect(out.adventure).toBeUndefined();
    }
  });
});

describe('mergeEnrichment — tier 2 (physical, kids)', () => {
  it('attaches physical and kids at high confidence', () => {
    const [out] = mergeEnrichment([item('a1')], HIGH);
    expect(out.physical).toEqual({ demand: 'moderate', mobility_ok: false });
    expect(out.kids).toEqual({ min_age: 8, baby_ok: false });
  });

  it('drops tier 2 at medium confidence — a promise is not a ranking signal', () => {
    const snap: EnrichmentSnapshot = {
      a1: {
        kind: 'kayak', adventure: 35, confidence: 'medium',
        physical: { demand: 'low', mobility_ok: true },
        kids: { min_age: 0, baby_ok: true },
      },
    };
    const [out] = mergeEnrichment([item('a1')], snap);
    expect(out.physical).toBeUndefined();
    expect(out.kids).toBeUndefined();
    // ...while tier 1 from the same record still lands.
    expect(out.enriched_kind).toBe('kayak');
  });
});

describe('mergeEnrichment — evidence', () => {
  it('attaches evidence only when a tier-2 field was attached', () => {
    const [withTier2] = mergeEnrichment([item('a1')], HIGH);
    expect(withTier2.evidence).toContain('mangroves');

    const tier1Only: EnrichmentSnapshot = { a1: { kind: 'kayak', confidence: 'high', evidence: 'a quote' } };
    const [out] = mergeEnrichment([item('a1')], tier1Only);
    expect(out.evidence).toBeUndefined();
  });

  it('drops tier 2 entirely when there is no evidence to show for it', () => {
    const noQuote: EnrichmentSnapshot = {
      a1: { confidence: 'high', physical: { demand: 'low', mobility_ok: true } },
    };
    const [out] = mergeEnrichment([item('a1')], noQuote);
    expect(out.physical).toBeUndefined();
    expect(out.evidence).toBeUndefined();
  });
});

describe('mergeEnrichment — absence', () => {
  it('leaves an unenriched item exactly as it was', () => {
    const original = item('unknown');
    const [out] = mergeEnrichment([original], HIGH);
    expect(out).toEqual(original);
  });

  it('is a no-op for an empty snapshot', () => {
    const items = [item('a1'), item('a2')];
    expect(mergeEnrichment(items, {})).toEqual(items);
  });

  it('does not mutate the input items', () => {
    const original = item('a1');
    mergeEnrichment([original], HIGH);
    expect(original.enriched_kind).toBeUndefined();
    expect(original.adventure).toBeUndefined();
  });
});

describe('mergeEnrichment — toddler_ok is a filter, not a promise', () => {
  // The 2026-08-15 pilot (docs/map/judged-toddler-ok.json) judged 327 products
  // with a verdict, a confidence and the model's own prose reason — but NO
  // verbatim span from the listing. `evidence` is rendered to travellers word
  // for word, so filling it with model prose would have the site present
  // generated text as the operator's own. This facet is therefore internal:
  // buildPool may exclude on it, nothing may quote it.
  it('attaches toddler_ok at high confidence without needing evidence', () => {
    const snap: EnrichmentSnapshot = { a1: { toddler_ok: false, confidence: 'high' } };
    const [out] = mergeEnrichment([item('a1')], snap);
    expect(out.toddler_ok).toBe(false);
  });

  it('attaches a positive verdict too', () => {
    const snap: EnrichmentSnapshot = { a1: { toddler_ok: true, confidence: 'high' } };
    expect(mergeEnrichment([item('a1')], snap)[0].toddler_ok).toBe(true);
  });

  it('drops a low-confidence verdict', () => {
    // The design doc is explicit: low confidence is not eligible for an
    // exclusionary facet. The four Jeeps that leaked through a looser prompt
    // were all low confidence and all hedged.
    const snap: EnrichmentSnapshot = { a1: { toddler_ok: false, confidence: 'low' } };
    expect(mergeEnrichment([item('a1')], snap)[0].toddler_ok).toBeUndefined();
  });

  it('never sets evidence from a toddler_ok record', () => {
    const snap: EnrichmentSnapshot = { a1: { toddler_ok: false, confidence: 'high' } };
    expect(mergeEnrichment([item('a1')], snap)[0].evidence).toBeUndefined();
  });
});

describe('confidence belongs to a facet, not to a record', () => {
  // The toddler verdicts are written by tools/map-toddler-pilot.cjs from a
  // judgement pass; `setting`, `kind` and `adventure` are written by
  // tools/enrich-catalog.ts from a later extraction pass. They share one row,
  // and they shared one `confidence` field — so when the extraction pass wrote
  // `medium` about where an activity happens, it silently disabled a high
  // confidence verdict about whether a toddler belongs there. 70 of 287.
  it('keeps a high-confidence toddler verdict when the record is medium', () => {
    const snap: EnrichmentSnapshot = {
      a1: { toddler_ok: false, toddler_ok_confidence: 'high', confidence: 'medium' },
    };
    expect(mergeEnrichment([item('a1')], snap)[0].toddler_ok).toBe(false);
  });

  it('still drops a low-confidence toddler verdict', () => {
    const snap: EnrichmentSnapshot = {
      a1: { toddler_ok: false, toddler_ok_confidence: 'low', confidence: 'high' },
    };
    expect(mergeEnrichment([item('a1')], snap)[0].toddler_ok).toBeUndefined();
  });

  it('falls back to the record confidence for rows written before the split', () => {
    const snap: EnrichmentSnapshot = { a1: { toddler_ok: true, confidence: 'high' } };
    expect(mergeEnrichment([item('a1')], snap)[0].toddler_ok).toBe(true);
  });

  it('does not let a medium record confidence gate setting or vessel', () => {
    // Those ARE the extraction pass's own facets, so the record confidence is
    // theirs and still governs them.
    const snap: EnrichmentSnapshot = { a1: { setting: 'beach', confidence: 'medium' } };
    expect(mergeEnrichment([item('a1')], snap)[0].setting).toBeUndefined();
  });
});

describe('mobility_ok cannot outrank the facts beside it', () => {
  // A REGRESSION TEST for a live defect. 82 records claimed mobility_ok at high
  // confidence and 35 contradicted themselves — 14 requiring a swim, 21 aboard a
  // vessel — including an "Antilla Shipwreck Seabob Tour" offered as a
  // wheelchair-accessible answer. Confidence gates cannot catch it: the record
  // is confident about both halves.
  const item = (over: Record<string, unknown>) => ({
    id: 'x', group_id: 'g', title: 'T', image_url: '', price_usd: 10, duration: '',
    rating: 4, review_count: 1, viator_item_url: '', is_best_seller: false,
    display_order: 0, ...over,
  }) as never;

  it('drops mobility_ok when the same record requires swimming', () => {
    const out = mergeEnrichment([item({})], {
      x: { confidence: 'high', facet_confidence: 'high', swim_required: true,
           physical: { demand: 'low', mobility_ok: true } },
    } as never);
    expect(out[0].physical?.mobility_ok).toBe(false);
  });

  it('drops mobility_ok when the same record names a vessel', () => {
    const out = mergeEnrichment([item({})], {
      x: { confidence: 'high', facet_confidence: 'high', vessel: 'catamaran',
           physical: { demand: 'low', mobility_ok: true } },
    } as never);
    expect(out[0].physical?.mobility_ok).toBe(false);
  });

  it('leaves an uncontradicted claim alone, and never flips false to true', () => {
    // One-way by design: this can only ever remove an accessibility claim.
    const ok = mergeEnrichment([item({})], {
      x: { confidence: 'high', facet_confidence: 'high', vessel: null, swim_required: false,
           physical: { demand: 'low', mobility_ok: true } },
    } as never);
    expect(ok[0].physical?.mobility_ok).toBe(true);

    const no = mergeEnrichment([item({})], {
      x: { confidence: 'high', facet_confidence: 'high', vessel: null,
           physical: { demand: 'low', mobility_ok: false } },
    } as never);
    expect(no[0].physical?.mobility_ok).toBe(false);
  });
});
