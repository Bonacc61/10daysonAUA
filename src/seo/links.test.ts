import { describe, it, expect } from 'vitest';
import { advertised, pickRelated, type Link } from './links';
import { renderIndexPage } from './render';
import { renderSitemap, renderLlmsTxt } from './sitemap';
import type { SeoCatalogItem } from './catalog';

// Synthetic fixtures throughout. The whole subject is a product that has LEFT
// the catalog, and the committed snapshot by definition contains none — so
// driving the pure functions directly is the only way to assert on the state
// offline and deterministically, and the only way these tests fail against the
// REAL snapshot when the guarantees are mutated away.
const item = (id: string, over: Partial<SeoCatalogItem> = {}): SeoCatalogItem => ({
  id,
  title: `Product ${id}`,
  image_url: '',
  viator_item_url: '',
  duration: '',
  price_usd: 0,
  review_count: 0,
  ...over,
});

const mustSlug = (id: string) => id.toLowerCase();
const urls = (links: Link[]) => links.map((l) => l.url);

describe('pickRelated', () => {
  // The i+1/i+2 neighbour walk plus up to two cluster-mates. Nothing gone here,
  // so this is the baseline the gone cases below are measured against — without
  // it, a pickRelated that returned [] always would satisfy every "never offers
  // a dead product" assertion in this file.
  it('offers three alternatives when nothing has left the catalog', () => {
    const all = [item('A'), item('B'), item('C'), item('D'), item('E')];
    expect(urls(pickRelated(all[0], all, mustSlug, 0))).toEqual([
      '/things-to-do/b/',
      '/things-to-do/c/',
    ]);
    // Two, not three: A has no cluster, so only the two neighbours qualify.
    // With a cluster it reaches three.
    const clustered = [
      item('A', { experience_cluster_id: 'X' }),
      item('B'),
      item('C'),
      item('D', { experience_cluster_id: 'X' }),
    ];
    expect(urls(pickRelated(clustered[0], clustered, mustSlug, 0))).toEqual([
      '/things-to-do/d/',
      '/things-to-do/b/',
      '/things-to-do/c/',
    ]);
  });

  it('never offers a cluster-mate that has left the catalog', () => {
    // B and D are both in cluster X; B is gone. Without the `!o.gone` filter B
    // is picked twice over — once as a cluster-mate, once as the i+1 neighbour.
    const all = [
      item('A', { experience_cluster_id: 'X' }),
      item('B', { experience_cluster_id: 'X', gone: true }),
      item('D', { experience_cluster_id: 'X' }),
      item('E'),
    ];
    const got = urls(pickRelated(all[0], all, mustSlug, 0));
    expect(got).not.toContain('/things-to-do/b/');
    // D twice over (cluster-mate and i+2 neighbour), deduped to one. E is
    // never reached: the neighbour walk stops at i+2 whether or not B was
    // usable — dropping a gone item does not pull the next one forward.
    expect(got).toEqual(['/things-to-do/d/']);
  });

  it('never offers a neighbour that has left the catalog', () => {
    // No cluster at all, so the neighbour walk is the only source of links —
    // this isolates the second `!o.gone` filter from the first.
    const all = [item('A'), item('B', { gone: true }), item('C'), item('D')];
    const got = urls(pickRelated(all[0], all, mustSlug, 0));
    expect(got).not.toContain('/things-to-do/b/');
    expect(got).toEqual(['/things-to-do/c/']);
  });

  it('offers nothing rather than offering a dead product', () => {
    // Every candidate is gone. Returning [] is correct; returning them is the
    // user-visible harm — a live page sending a reader to a page that cannot
    // be booked, and the falsification of the slugs.ts "live alternative" clause.
    const all = [item('A'), item('B', { gone: true }), item('C', { gone: true })];
    expect(pickRelated(all[0], all, mustSlug, 0)).toEqual([]);
  });

  it('never offers the page itself', () => {
    const all = [item('A'), item('B')];
    expect(urls(pickRelated(all[0], all, mustSlug, 0))).toEqual(['/things-to-do/b/']);
  });
});

describe('advertised', () => {
  it('drops the pages that have left the catalog and keeps the rest', () => {
    const links: Link[] = [
      { title: 'Live one', url: '/things-to-do/live-one/' },
      { title: 'Departed', url: '/things-to-do/departed/', gone: true },
      { title: 'Live two', url: '/things-to-do/live-two/' },
    ];
    // Exact equality, not "does not contain": a filter that dropped everything
    // would satisfy the absence check on its own.
    expect(urls(advertised(links))).toEqual(['/things-to-do/live-one/', '/things-to-do/live-two/']);
  });

  it('is a no-op when nothing has left the catalog', () => {
    const links: Link[] = [
      { title: 'One', url: '/things-to-do/one/' },
      { title: 'Two', url: '/things-to-do/two/' },
    ];
    expect(advertised(links)).toEqual(links);
  });
});

// Findings 2 and 3: sitemap.xml, llms.txt and /things-to-do/ each have to omit
// a retained page, and each is named here rather than left to the fact that
// tools/build-seo.ts happens to build them from one list.
describe('the three listings a retained page must stay out of', () => {
  const LIVE = { title: 'Sunset Sail', url: '/things-to-do/sunset-sail/' };
  const GONE = { title: 'Catalina Snorkel', url: '/things-to-do/catalina-snorkel/', gone: true };
  const listed = advertised([LIVE, GONE]);

  // Non-vacuity, once, for all three below: the input really did contain both
  // kinds, and the filter really did remove exactly one.
  it('is exercised by an input holding both a live and a departed page', () => {
    expect(listed).toHaveLength(1);
    expect(listed[0].url).toBe(LIVE.url);
  });

  it('keeps a departed page out of sitemap.xml', () => {
    const xml = renderSitemap(listed.map((l) => ({ loc: 'https://10daysonaruba.com' + l.url, lastmod: '2026-09-10' })));
    expect(xml).toContain(LIVE.url);
    expect(xml, 'a noindex URL in a sitemap is an error Search Console reports').not.toContain(GONE.url);
  });

  it('keeps a departed page out of llms.txt', () => {
    const txt = renderLlmsTxt([{ heading: 'Things to do in Aruba', links: listed }]);
    expect(txt).toContain(LIVE.url);
    expect(txt, 'an answer engine must not be handed a product that cannot be booked').not.toContain(GONE.url);
  });

  it('keeps a departed page out of the /things-to-do/ index', () => {
    const html = renderIndexPage({ entries: listed, cssHref: '/a.css', buildDate: '2026-09-10' });
    expect(html).toContain(LIVE.url);
    expect(html, 'the hub must not advertise a de-listed product').not.toContain(GONE.url);
    // The count the hub prints is the advertised count, not the written count.
    expect(html).toContain('1 activities');
  });
});
