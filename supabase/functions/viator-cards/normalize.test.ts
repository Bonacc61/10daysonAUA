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

  it('keeps the PID-stamped affiliate URL', () => {
    expect(n.viator_item_url).toContain('pid=P00302487');
  });

  it('carries the tag ids for grouping', () => {
    expect(n.tags).toContain(11928);
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
