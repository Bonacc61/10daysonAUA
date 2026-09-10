import { describe, it, expect } from 'vitest';
import { renderDataPage, renderCuratedPage, escapeHtml, platformSplitWorthShowing } from './render';
import type { SeoCatalogItem } from './catalog';
import { combinedBreakdown } from '../data/reviewBreakdown';
import SNAPSHOT from '../data/seoCatalog.json';
import { selectPages } from './floor';
import { ACTIVITIES } from '../data/activities';

const ITEMS = (SNAPSHOT as { items: SeoCatalogItem[] }).items;

// Correction (b) from the task brief: nothing guarantees the first selected
// product carries affiliate parameters, even though today (2026-09-10) all 327
// catalog items do. Select defensively, and fail loudly if the catalog ever
// stops carrying one.
const SAMPLE = selectPages(ITEMS).products.find((p) => p.viator_item_url.includes('pid='));
if (!SAMPLE) {
  throw new Error(
    'Test fixture setup: no selected product carries pid= — the affiliate-parameter test below would be meaningless against this catalog.',
  );
}

const page = (over: Partial<Parameters<typeof renderDataPage>[0]> = {}) =>
  renderDataPage({
    item: SAMPLE,
    slug: 'sample-activity',
    cssHref: '/assets/index-abc.css',
    buildDate: '2026-09-10',
    related: [{ title: 'Another Thing', url: '/things-to-do/another-thing/' }],
    ...over,
  });

describe('escapeHtml', () => {
  it('escapes the characters that would break out of markup', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('renderDataPage', () => {
  it('emits a complete document with the canonical and the app stylesheet', () => {
    const html = page();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(`<link rel="canonical" href="https://10daysonaruba.com/things-to-do/sample-activity/">`);
    expect(html).toContain('<link rel="stylesheet" href="/assets/index-abc.css">');
  });

  it('carries the affiliate parameters on the booking link', () => {
    const html = page();
    expect(html).toContain('pid=P00302487');
    expect(html).toContain('mcid=42383');
    expect(html).toContain('medium=link');
  });

  it('adds medium=link even when the catalog url does not already carry it', () => {
    // The committed snapshot's viator_item_url already includes medium=link,
    // so the assertion above passes even if the renderer stopped calling
    // viatorLink() and just echoed item.viator_item_url — it would still
    // "contain" medium=link because the raw catalog value already has it.
    // This test strips it from the input so only an actual call to
    // viatorLink() can put it back in the output.
    const rawUrl = SAMPLE.viator_item_url.replace(/[&?]medium=link/, '');
    expect(rawUrl).not.toContain('medium=link');
    const html = page({ item: { ...SAMPLE, viator_item_url: rawUrl } });
    expect(html).toContain('medium=link');
  });

  it('shows the COMBINED rating, matching the app and the Viator page', () => {
    const b = combinedBreakdown(SAMPLE.id)!;
    expect(page()).toContain(`${b.average}`);
    expect(page()).toContain(`${b.total}`);
  });

  it('renders a five-bar histogram with accessible labels', () => {
    const html = page();
    expect(html).toContain('data-seo-histogram');
    expect((html.match(/data-star=/g) ?? [])).toHaveLength(5);
  });

  it('links back to the planner with a ref the beacon can attribute', () => {
    expect(page()).toContain('?ref=seo-sample-activity');
  });

  it('stamps the build date', () => {
    expect(page()).toContain('2026-09-10');
  });

  it('emits TouristAttraction and BreadcrumbList JSON-LD and no aggregateRating', () => {
    const html = page();
    expect(html).toContain('"@type": "TouristAttraction"');
    expect(html).toContain('"@type": "BreadcrumbList"');
    expect(html).not.toContain('aggregateRating');
  });

  it('escapes a hostile title rather than injecting it', () => {
    const html = page({ item: { ...SAMPLE, title: '<script>alert(1)</script>' } });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('omits the price row when the catalog reports zero', () => {
    const html = page({ item: { ...SAMPLE, price_usd: 0 } });
    expect(html).not.toContain('data-row="price"');
  });

  it('shows the price row when the catalog reports one', () => {
    const html = page({ item: { ...SAMPLE, price_usd: 89 } });
    expect(html).toContain('data-row="price"');
    expect(html).toContain('89');
  });

  it('links every related activity', () => {
    expect(page()).toContain('/things-to-do/another-thing/');
  });
});

describe('platformSplitWorthShowing', () => {
  it('is false when the platforms agree', () => {
    // Agreement is the common case; showing "4.7 here, 4.7 there" is noise.
    const agreeing = ITEMS.filter((i) => !platformSplitWorthShowing(i.id));
    expect(agreeing.length).toBeGreaterThan(0);
  });

  it('never contradicts the combined headline when it does show', () => {
    // The rule from reviewBreakdown.ts:50 — the headline must stay the number
    // the traveller will see on the Viator page they land on.
    for (const i of ITEMS.slice(0, 50)) {
      if (!platformSplitWorthShowing(i.id)) continue;
      const html = renderDataPage({
        item: i, slug: 's', cssHref: '/a.css', buildDate: '2026-09-10', related: [],
      });
      const b = combinedBreakdown(i.id)!;
      const headline = html.slice(html.indexOf('data-seo-rating'), html.indexOf('data-seo-rating') + 400);
      expect(headline).toContain(`${b.average}`);
    }
  });

  it('is actually exercised by at least one item in the catalog', () => {
    // Guards against a vacuous pass: if nothing in the catalog ever disagrees
    // by >= 0.3, the "never contradicts" test above never runs its assertion.
    const disagreeing = ITEMS.filter((i) => platformSplitWorthShowing(i.id));
    expect(disagreeing.length).toBeGreaterThan(0);
  });
});

const EAGLE = ACTIVITIES.find((a) => a.id === 'eagle-beach-morning')!;

const curated = (over: Partial<Parameters<typeof renderCuratedPage>[0]> = {}) =>
  renderCuratedPage({
    activity: EAGLE,
    slug: 'eagle-beach-morning-session',
    cssHref: '/assets/index-abc.css',
    buildDate: '2026-09-10',
    related: [{ title: 'Another Thing', url: '/things-to-do/another-thing/' }],
    ...over,
  });

describe('renderCuratedPage', () => {
  it('emits a complete document with a canonical', () => {
    expect(curated().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(curated()).toContain('https://10daysonaruba.com/things-to-do/eagle-beach-morning-session/');
  });

  it('renders the hand-written localsSay — the reason the page exists', () => {
    expect(curated()).toContain('Skip the hotel beach');
  });

  // THE invariant. activities.ts:26 — these are curation weights, not ratings.
  it('never publishes the editorial rating or review count', () => {
    const html = curated();
    expect(html).not.toContain('4.9');
    expect(html).not.toContain('2847');
    expect(html).not.toContain('reviews');
  });

  it('shows the practical facts it does have', () => {
    const html = curated();
    expect(html).toContain('Free');                  // cost
    expect(html).toContain('Eagle Beach, Noord');    // location
  });

  it('offers no booking CTA for a free activity', () => {
    expect(curated()).not.toContain('rel="noopener sponsored"');
  });

  it('still sends the reader to the planner', () => {
    expect(curated()).toContain('?ref=seo-eagle-beach-morning-session');
  });

  it('escapes a hostile localsSay rather than injecting it', () => {
    const html = curated({ activity: { ...EAGLE, localsSay: '<img onerror=x>' } });
    expect(html).not.toContain('<img onerror=x>');
    expect(html).toContain('&lt;img');
  });
});
