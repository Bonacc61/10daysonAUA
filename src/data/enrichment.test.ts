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
