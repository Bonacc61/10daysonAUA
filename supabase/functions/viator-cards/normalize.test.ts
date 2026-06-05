import { describe, it, expect } from 'vitest';
import { normalizeProduct, type ViatorProduct } from './normalize';
import sample from './_fixtures/sample-product.json';

describe('normalizeProduct — against a real Aruba product payload', () => {
  const n = normalizeProduct(sample as ViatorProduct);

  it('maps the product code to id', () => {
    expect(n.id).toBe('103020P7');
  });

  it('rounds fromPrice and keeps currency', () => {
    expect(n.price_usd).toBe(2132);
    expect(n.currency).toBe('USD');
  });

  it('uses the combined (TripAdvisor/Viator) rating + total reviews', () => {
    expect(n.rating).toBe(5);
    expect(n.review_count).toBe(190);
  });

  it('formats a variable duration as an hour range', () => {
    expect(n.duration).toBe('3–4 hrs');
  });

  it('picks the largest cover-image variant', () => {
    expect(n.image_url).toContain('720x480');
  });

  it('uses the direct /tours/ product page URL (not the TTD category URL)', () => {
    expect(n.viator_item_url).toContain('/tours/Aruba/');
    expect(n.viator_item_url).toContain('d28-103020P7');
    expect(n.viator_item_url).toContain('pid=P00302487');
    expect(n.viator_item_url).toContain('medium=link');
    expect(n.viator_item_url).not.toContain('d28-ttd');
  });

  it('carries the tag ids for grouping', () => {
    expect(n.tags).toContain(11928);
  });
});

describe('normalizeProduct — TTD URL → direct product URL conversion', () => {
  it('converts a TTD category URL to a direct /tours/ product page URL', () => {
    const n = normalizeProduct({
      productCode: '5595462P1',
      title: 'Discovery Papiamento Distillery',
      productUrl: 'https://www.viator.com/Aruba/d28-ttd/p-5595462P1?pid=P00302487&mcid=42383',
    });
    expect(n.viator_item_url).toBe(
      'https://www.viator.com/tours/Aruba/Discovery-Papiamento-Distillery/d28-5595462P1?pid=P00302487&mcid=42383&medium=link'
    );
  });

  it('does not double-add medium=link when raw URL already has it', () => {
    const n = normalizeProduct({
      productCode: 'X1',
      title: 'Test Tour',
      productUrl: 'https://www.viator.com/tours/Aruba/Test-Tour/d28-X1?pid=P00302487&medium=link',
    });
    const count = (n.viator_item_url.match(/medium=link/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('normalizeProduct — duration formatting + resilience', () => {
  const base: ViatorProduct = { productCode: 'X', title: 'X' };

  it('fixed duration → single label', () => {
    expect(normalizeProduct({ ...base, duration: { fixedDurationInMinutes: 180 } }).duration).toBe('3 hrs');
  });
  it('sub-hour fixed duration → minutes', () => {
    expect(normalizeProduct({ ...base, duration: { fixedDurationInMinutes: 45 } }).duration).toBe('45 min');
  });
  it('half-hour fixed duration → decimal hours', () => {
    expect(normalizeProduct({ ...base, duration: { fixedDurationInMinutes: 90 } }).duration).toBe('1.5 hrs');
  });
  it('missing fields default safely', () => {
    const n = normalizeProduct(base);
    expect(n.price_usd).toBe(0);
    expect(n.rating).toBe(0);
    expect(n.review_count).toBe(0);
    expect(n.image_url).toBe('');
    expect(n.duration).toBe('');
    expect(n.tags).toEqual([]);
  });
});
