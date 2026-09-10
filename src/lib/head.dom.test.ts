// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyHead, pageMeta, sharedItineraryMeta } from './head';

const tag = (sel: string) => document.head.querySelector(sel);
const all = (sel: string) => document.head.querySelectorAll(sel);

describe('applyHead', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.title = ''; });

  it('writes the title, description and canonical', () => {
    applyHead(pageMeta('explore'));
    expect(document.title).toBe('Things to do in Aruba — beaches, boat trips and tours');
    expect(tag('meta[name="description"]')!.getAttribute('content'))
      .toBe('Browse hundreds of Aruba activities: beaches, snorkel trips, sunset sails, 4x4 tours and the local spots most guides leave out.');
    expect(tag('link[rel="canonical"]')!.getAttribute('href'))
      .toBe('https://10daysonaruba.com/explore');
  });

  it('does not duplicate tags when applied repeatedly', () => {
    applyHead(pageMeta('explore'));
    applyHead(pageMeta('privacy'));
    applyHead(pageMeta('landing'));
    expect(all('meta[name="description"]')).toHaveLength(1);
    expect(all('link[rel="canonical"]')).toHaveLength(1);
    expect(tag('link[rel="canonical"]')!.getAttribute('href'))
      .toBe('https://10daysonaruba.com/');
  });

  it('emits noindex for a private page', () => {
    applyHead(pageMeta('itinerary'));
    expect(tag('meta[name="robots"]')!.getAttribute('content')).toBe('noindex, follow');
  });

  it('emits noindex for a shared itinerary', () => {
    applyHead(sharedItineraryMeta('abc123'));
    expect(tag('meta[name="robots"]')!.getAttribute('content')).toBe('noindex, follow');
  });

  // The dangerous direction: navigating from a private page to a public one
  // must REMOVE the noindex, or the whole site inherits it for that session.
  it('removes noindex when navigating back to an indexable page', () => {
    applyHead(pageMeta('itinerary'));
    applyHead(pageMeta('landing'));
    expect(tag('meta[name="robots"]')).toBeNull();
  });

  it('reuses a description tag that index.html already shipped', () => {
    document.head.innerHTML = '<meta name="description" content="from index.html">';
    applyHead(pageMeta('explore'));
    expect(all('meta[name="description"]')).toHaveLength(1);
    expect(tag('meta[name="description"]')!.getAttribute('content'))
      .toBe('Browse hundreds of Aruba activities: beaches, snorkel trips, sunset sails, 4x4 tours and the local spots most guides leave out.');
  });
});
