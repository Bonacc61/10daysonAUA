import { describe, it, expect } from 'vitest';
import { renderDataPage, renderCuratedPage, renderIndexPage, renderGuidePage, escapeHtml, platformSplitWorthShowing } from './render';
import { parseGuide } from './guides';
import type { SeoCatalogItem } from './catalog';
import { combinedBreakdown } from '../data/reviewBreakdown';
import { whatToExpectFor } from '../data/whatToExpect';
import SNAPSHOT from '../data/seoCatalog.json';
import { selectPages } from './floor';
import { ACTIVITIES } from '../data/activities';
import { ORIGIN } from '../lib/head';

const ITEMS = (SNAPSHOT as { items: SeoCatalogItem[] }).items;

// Correction (b) from the task brief: nothing guarantees the first selected
// product carries affiliate parameters, even though today (2026-09-10) all 327
// catalog items do. Select defensively, and fail loudly if the catalog ever
// stops carrying one.
//
// `!p.gone` matters as much as the pid check: the gone block at the bottom of
// this file spreads `{ ...SAMPLE, gone: true }` to build its fixture, so SAMPLE
// itself has to be a LIVE product. The day seo:refresh flags whichever product
// happens to sort first here, a SAMPLE that carried gone through would take the
// booking-link tests down with it and read as a renderer regression.
const SAMPLE = selectPages(ITEMS).products.find((p) => !p.gone && p.viator_item_url.includes('pid='));
if (!SAMPLE) {
  throw new Error(
    'Test fixture setup: no live selected product carries pid= — the affiliate-parameter test below would be meaningless against this catalog.',
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

  it('links back to the planner with a ref derived from the id, not the slug', () => {
    // The id, not `slug`, is what makes it into the ref — see refFor() in
    // render.ts. SAMPLE.id comes from src/data/seoCatalog.json (the catalog
    // module), not from render.ts, so this is not deriving an expected value
    // from the module under test.
    expect(page()).toContain(`?ref=seo-${SAMPLE.id.toLowerCase()}`);
  });

  it('uses the id even when the slug is long enough that the old slug-based ref would have blown the 32-char allowlist', () => {
    // Real slugs run long — 40 of the 58 generated pages exceed 28 characters,
    // which combined with the "seo-" prefix passes the collect function's
    // 32-char campaign() allowlist (supabase/functions/collect/normalise.ts)
    // right by. This fixture's slug alone is already past that limit, so the
    // old `?ref=seo-${slug}` behaviour would fail the assertion below — this
    // test would have caught the original bug.
    const longSlug = 'a-slug-so-long-it-alone-exceeds-the-collect-allowlist-limit';
    expect(`seo-${longSlug}`.length).toBeGreaterThan(32);
    const html = page({ slug: longSlug });
    expect(html).not.toContain(`?ref=seo-${longSlug}`);
    expect(html).toContain(`?ref=seo-${SAMPLE.id.toLowerCase()}`);
  });

  it('emits a ref matching the collect allowlist the server enforces', () => {
    // The literal pattern from supabase/functions/collect/normalise.ts's
    // campaign() — kept in sync by tools/build-seo.refContract.test.ts, not
    // by hoping nobody edits one side.
    const m = page().match(/\?ref=([^"]*)"/);
    expect(m, 'no ?ref= link found').not.toBeNull();
    expect(m![1]).toMatch(/^[a-z0-9-]{1,32}$/);
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

  it('escapes a hostile related title rather than injecting it', () => {
    const html = page({ related: [{ title: '<img src=x onerror=alert(1)>', url: '/things-to-do/x/' }] });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('emits no robots meta for a product that is still listed', () => {
    // The counterpart to the noindex case below. Without this, a renderer that
    // stamped `noindex, follow` on EVERY page would pass the whole gone block
    // while quietly de-indexing all 39 product pages.
    expect(page()).not.toContain('name="robots"');
  });
});

// Fix 5 — the operator's own "What to expect" copy is republished (shortened,
// via summarise()) under our own "What this involves" heading. The spec ("The
// data page", item 4) requires anything verbatim be short and attributed, so a
// reader can tell the passage is the operator's description, not ours.
describe('the "What this involves" attribution', () => {
  const WITH_PROSE = ITEMS.filter((i) => whatToExpectFor(i.id));
  const WITHOUT_PROSE = ITEMS.filter((i) => !whatToExpectFor(i.id));

  // Non-vacuity floor: if the catalog ever stopped carrying whatToExpect data,
  // the assertion below would run zero times and pass for the wrong reason.
  it('is actually exercised by at least one item in the catalog', () => {
    expect(WITH_PROSE.length).toBeGreaterThan(0);
    expect(WITHOUT_PROSE.length).toBeGreaterThan(0);
  });

  it('names the operator as the source whenever the section renders', () => {
    for (const item of WITH_PROSE.slice(0, 20)) {
      const html = renderDataPage({ item, slug: 's', cssHref: '/a.css', buildDate: '2026-09-10', related: [] });
      expect(html).toContain('<h2>What this involves</h2>');
      expect(html).toContain('seo-source');
      expect(html).toContain("In the operator's own words.");
    }
  });

  it('renders neither the section nor the attribution when there is no prose', () => {
    for (const item of WITHOUT_PROSE.slice(0, 20)) {
      const html = renderDataPage({ item, slug: 's', cssHref: '/a.css', buildDate: '2026-09-10', related: [] });
      expect(html).not.toContain('What this involves');
      expect(html).not.toContain('seo-source');
    }
  });
});

// Fix 6 — product pages crumbed "Things to do" to /explore (an app route),
// curated pages crumbed to /things-to-do/ (the generated hub). The JSON-LD
// BreadcrumbList agreed with the /explore version, so the two page types
// disagreed with each other and the 39 product pages never linked the hub the
// footer advertises. Both crumb types now point at the same hub URL.
describe('breadcrumb seam', () => {
  it('the visible crumb and the JSON-LD breadcrumb name the same hub URL', () => {
    const html = page();
    const crumbMatch = html.match(/<a href="([^"]+)">Things to do<\/a>/);
    const jsonMatch = html.match(/"name": "Things to do",\s*"item": "([^"]+)"/);
    expect(crumbMatch?.[1]).toBe('/things-to-do/');
    expect(jsonMatch?.[1]).toBe(`${ORIGIN}/things-to-do/`);
    // Not just independently correct — they must name the SAME url.
    expect(new URL(jsonMatch![1]).pathname).toBe(crumbMatch![1]);
  });

  it('never points the crumb or the JSON-LD at the /explore app route', () => {
    const html = page();
    expect(html).not.toContain('>/explore<');
    expect(html).not.toContain('"item": "https://10daysonaruba.com/explore"');
  });

  it('the curated page crumb names the same hub as the product page crumb', () => {
    const productCrumb = page().match(/<a href="([^"]+)">Things to do<\/a>/)?.[1];
    const curatedCrumb = curated().match(/<a href="([^"]+)">Things to do<\/a>/)?.[1];
    expect(curatedCrumb).toBe('/things-to-do/');
    expect(curatedCrumb).toBe(productCrumb);
  });
});

// A product Viator stops returning. Not a deletion: dist/ is rebuilt from
// scratch and mirrored with --delete on every deploy, so dropping the page
// would turn an indexed URL into a hard 404 and discard every link into it.
describe('a product that has left the catalog', () => {
  const gone = () => page({ item: { ...SAMPLE, gone: true } });

  it('still renders a page rather than disappearing', () => {
    const html = gone();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    // Escaped, because 44 of the 327 catalog titles carry & or ' and the
    // renderer is required to escape them — a raw-title assertion here would
    // fail on the data rather than on the behaviour under test.
    expect(html).toContain(escapeHtml(SAMPLE.title));
  });

  it('drops the booking CTA instead of linking a dead product', () => {
    const html = gone();
    expect(html).not.toContain('Check dates and prices on Viator');
    expect(html).toContain('no longer listed');
  });

  it('sends no traffic at all to the de-listed product', () => {
    // Stronger than the CTA-copy check above: a renderer that kept the <a> and
    // only reworded the button would still be paying a click into a dead page.
    const html = gone();
    expect(html).not.toContain('rel="noopener sponsored"');
    expect(html).not.toContain(SAMPLE.viator_item_url.split('?')[0]);
    expect(html).not.toContain('pid=P00302487');
  });

  it('still offers the related activities as somewhere to go', () => {
    expect(gone()).toContain('/things-to-do/another-thing/');
  });

  it('still sends the reader to the planner', () => {
    expect(gone()).toContain(`?ref=seo-${SAMPLE.id.toLowerCase()}`);
  });

  it('tells crawlers not to index it, without removing it', () => {
    const html = gone();
    expect(html).toContain('name="robots" content="noindex, follow"');
    // follow, not nofollow: the links out are the whole point of keeping it.
    expect(html).not.toContain('nofollow');
    // The canonical still names its own URL — a gone page that canonicalised
    // to something else would be asking Google to merge it away.
    expect(html).toContain('<link rel="canonical" href="https://10daysonaruba.com/things-to-do/sample-activity/">');
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
  //
  // Forbidden strings are DERIVED FROM `EAGLE.rating` / `EAGLE.reviewCount`
  // (activities.ts, the DATA module) rather than hardcoded — this does not
  // violate "never derive expected values from the module under test", because
  // the module under test here is render.ts, not activities.ts. Deriving from
  // the data is what makes the guard keep working when someone retunes Eagle
  // Beach's curation weight; a hardcoded '4.9'/'2847' would silently stop
  // guarding anything the day that number changes, while still passing green.
  //
  // Checks both the raw value AND the locale-formatted value (2,847, not just
  // 2847): a renderer that runs reviewCount through .toLocaleString() before
  // printing it evades a literal-substring check on the unformatted digits.
  it('never publishes the editorial rating or review count', () => {
    const html = curated();
    for (const forbidden of [
      String(EAGLE.rating),
      String(EAGLE.reviewCount),
      EAGLE.reviewCount.toLocaleString('en-US'),
    ]) {
      expect(html, `curated page must never publish ${forbidden}`).not.toContain(forbidden);
    }
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

  it('still sends the reader to the planner, with a ref derived from the id, not the slug', () => {
    // EAGLE.id is 'eagle-beach-morning' (from src/data/activities.ts), not
    // the 'eagle-beach-morning-session' slug fixture below — proves the ref
    // tracks refFor(activity.id), not the slug.
    expect(curated()).toContain(`?ref=seo-${EAGLE.id.toLowerCase()}`);
  });

  it('uses the id even when the slug is long enough that the old slug-based ref would have blown the 32-char allowlist', () => {
    const longSlug = 'a-slug-so-long-it-alone-exceeds-the-collect-allowlist-limit';
    expect(`seo-${longSlug}`.length).toBeGreaterThan(32);
    const html = curated({ slug: longSlug });
    expect(html).not.toContain(`?ref=seo-${longSlug}`);
    expect(html).toContain(`?ref=seo-${EAGLE.id.toLowerCase()}`);
  });

  it('emits a ref matching the collect allowlist the server enforces', () => {
    const m = curated().match(/\?ref=([^"]*)"/);
    expect(m, 'no ?ref= link found').not.toBeNull();
    expect(m![1]).toMatch(/^[a-z0-9-]{1,32}$/);
  });

  it('escapes a hostile localsSay rather than injecting it', () => {
    const html = curated({ activity: { ...EAGLE, localsSay: '<img onerror=x>' } });
    expect(html).not.toContain('<img onerror=x>');
    expect(html).toContain('&lt;img');
  });

  it('escapes a hostile related title rather than injecting it', () => {
    const html = curated({ related: [{ title: '<img src=x onerror=alert(1)>', url: '/things-to-do/x/' }] });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('escapes a hostile description rather than injecting it', () => {
    const html = curated({ activity: { ...EAGLE, description: '<img src=x onerror=alert(1)>' } });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  // The global constraint — "every outbound Viator link carries pid= and
  // mcid=" — applies to curated picks too, but EAGLE is free and so never
  // exercises the affiliate branch of bookUrlForActivity. Build a paid fixture
  // by spreading a real activity rather than inventing one from scratch.
  it('carries the affiliate parameters when a curated pick is paid and bookable', () => {
    const PAID = {
      ...EAGLE,
      cost: '$75 pp',
      viator_item_url: 'https://www.viator.com/tours/Aruba/Some-Tour/d28-999999P1?mcid=42383&pid=P00302487',
    };
    const html = curated({ activity: PAID });
    expect(html).toContain('pid=P00302487');
    expect(html).toContain('mcid=42383');
    expect(html).toContain('medium=link');
    expect(html).toContain('rel="noopener sponsored"');
  });
});

const GUIDE_MD = `---
title: "Snorkeling: free vs paid"
description: "When the free beach beats the boat trip."
date: 2026-09-02
status: published
products:
  - 119085P1
curated:
  - tres-trapi
---

# Snorkeling: free vs paid

**Go at eight.** The catamarans arrive at ten.

| Trip | Five-star |
|---|---|
| Arusun | 90% |

> "Get in before the catamarans arrive." — Edsel

## Common questions

**Do I need a boat to see turtles?**
No. [Tres Trapi](/things-to-do/tres-trapi-turtle-cove/) has them from shore.
`;

const guidePage = () =>
  renderGuidePage({
    guide: parseGuide('snorkeling-free-vs-paid', GUIDE_MD),
    cssHref: '/assets/index-abc.css',
    buildDate: '2026-09-10',
  });

describe('renderGuidePage', () => {
  it('emits a complete document with the /guides/ canonical and the app stylesheet', () => {
    const html = guidePage();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<link rel="canonical" href="https://10daysonaruba.com/guides/snorkeling-free-vs-paid/">');
    expect(html).toContain('<link rel="stylesheet" href="/assets/index-abc.css">');
    expect(html).toContain('<title>Snorkeling: free vs paid — 10 days on Aruba</title>');
  });

  it('carries the same furniture as the data pages', () => {
    const html = guidePage();
    // Breadcrumbs: home › the hub › this guide.
    expect(html).toContain('<a href="/">10 days on Aruba</a> › <a href="/things-to-do/">Things to do</a> › <span>Snorkeling: free vs paid</span>');
    expect(html).toContain('class="seo-freshness"');
    expect(html).toContain('data updated 2026-09-10');
    expect(html).toContain('__COLLECT_URL__');
  });

  it('renders the markdown body into the page rather than printing it', () => {
    const html = guidePage();
    expect(html).toContain('<div class="seo-scroll"><table>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<strong>Go at eight.</strong>');
    expect(html, 'the body must not arrive HTML-escaped').not.toContain('&lt;table&gt;');
    expect(html, 'raw markdown pipes would mean the table never parsed').not.toContain('| Trip |');
  });

  it('has exactly one h1, and it is the frontmatter title', () => {
    const h1s = [...guidePage().matchAll(/<h1>([\s\S]*?)<\/h1>/g)].map((m) => m[1]);
    expect(h1s).toEqual(['Snorkeling: free vs paid']);
  });

  it('links the planner with a ref inside the collect allowlist', () => {
    const refs = [...guidePage().matchAll(/\/questionnaire\?ref=([^"]*)"/g)].map((m) => m[1]);
    expect(refs).toEqual(['seo-g-snorkeling-free-vs-paid']);
    // The allowlist in supabase/functions/collect/normalise.ts, written out
    // here rather than imported so a change to it fails this too.
    for (const ref of refs) expect(ref).toMatch(/^[a-z0-9-]{1,32}$/);
  });

  describe('JSON-LD', () => {
    const blocks = () =>
      [...guidePage().matchAll(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/g)].map((m) =>
        JSON.parse(m[1].replace(/\\u003c/g, '<')),
      );

    it('marks the page up as an Article', () => {
      const article = blocks().find((b) => b['@type'] === 'Article');
      expect(article).toBeDefined();
      expect(article.headline).toBe('Snorkeling: free vs paid');
      expect(article.datePublished).toBe('2026-09-02');
      expect(article.dateModified).toBe('2026-09-10');
      expect(article.mainEntityOfPage['@id']).toBe('https://10daysonaruba.com/guides/snorkeling-free-vs-paid/');
    });

    it('publishes the Common questions as a FAQPage', () => {
      const faq = blocks().find((b) => b['@type'] === 'FAQPage');
      expect(faq).toBeDefined();
      expect(faq.mainEntity).toEqual([
        {
          '@type': 'Question',
          name: 'Do I need a boat to see turtles?',
          acceptedAnswer: { '@type': 'Answer', text: 'No. Tres Trapi has them from shore.' },
        },
      ]);
    });

    it('omits FAQPage entirely when the guide asks no questions', () => {
      const html = renderGuidePage({
        guide: parseGuide('no-faq', GUIDE_MD.split('## Common questions')[0]),
        cssHref: '/a.css',
        buildDate: '2026-09-10',
      });
      expect(html, 'markup claiming a FAQ section the page does not have').not.toContain('FAQPage');
      expect(html, 'the rest of the structured data must survive').toContain('"@type": "Article"');
    });

    it('breadcrumbs put the guide under the things-to-do hub', () => {
      const crumbs = blocks().find((b) => b['@type'] === 'BreadcrumbList');
      expect(crumbs.itemListElement.map((i: { item: string }) => i.item)).toEqual([
        'https://10daysonaruba.com/',
        'https://10daysonaruba.com/things-to-do/',
        'https://10daysonaruba.com/guides/snorkeling-free-vs-paid/',
      ]);
    });

    // Google's review-snippet policy wants first-party ratings; every number in
    // these guides is Viator's or Tripadvisor's. Marking them up invites a
    // manual action.
    it('carries no aggregateRating anywhere on the page', () => {
      expect(guidePage()).not.toContain('aggregateRating');
    });
  });
});

describe('the /things-to-do/ hub with guides', () => {
  const hub = (guides: { title: string; url: string }[]) =>
    renderIndexPage({
      entries: [{ title: 'Another Thing', url: '/things-to-do/another-thing/' }],
      guides,
      cssHref: '/a.css',
      buildDate: '2026-09-10',
    });

  it('lists a guide ABOVE the activity list — guides are the top of the crawl path', () => {
    const html = hub([{ title: 'Snorkeling free vs paid', url: '/guides/snorkeling-free-vs-paid/' }]);
    const guideAt = html.indexOf('/guides/snorkeling-free-vs-paid/');
    const activityAt = html.indexOf('/things-to-do/another-thing/');
    expect(guideAt).toBeGreaterThan(-1);
    expect(activityAt).toBeGreaterThan(-1);
    expect(guideAt).toBeLessThan(activityAt);
    expect(html).toContain('Snorkeling free vs paid');
  });

  it('says nothing about guides when there are none', () => {
    const html = hub([]);
    expect(html).not.toContain('/guides/');
    expect(html).not.toContain('Start here');
    // and still lists the activities
    expect(html).toContain('/things-to-do/another-thing/');
  });
});

// The generated surface loads no app bundle, so src/lib/beacon.ts never runs on
// it. Whatever these four renderers inline IS the analytics for every page.
// The index page shipped without any beacon at all until 2026-09-10 — the hub
// the footer points at was the one page nobody could count.
describe('the inlined beacon', () => {
  const SURFACES: Record<string, () => string> = {
    'product page': () => page(),
    'curated page': () => curated(),
    'index page': () =>
      renderIndexPage({
        entries: [{ title: 'Another Thing', url: '/things-to-do/another-thing/' }],
        guides: [],
        cssHref: '/assets/index-abc.css',
        buildDate: '2026-09-10',
      }),
    'guide page': () => guidePage(),
  };
  const NAMES = Object.keys(SURFACES);

  // Non-vacuity floor: if a renderer is ever dropped from the table above, the
  // it.each below would silently stop testing it.
  it('covers every renderer this module exports', () => {
    expect(new Set(NAMES)).toEqual(new Set(['product page', 'curated page', 'index page', 'guide page']));
  });

  it.each(NAMES)('%s carries the beacon at all', (name) => {
    // The placeholder tools/build-seo.ts substitutes. Its presence is the only
    // proof the <script> in the output is the beacon and not something else.
    expect(SURFACES[name]()).toContain('__COLLECT_URL__');
  });

  it.each(NAMES)('%s sends the referrer, the only GEO signal there is', (name) => {
    // chatgpt.com / perplexity.ai in the referrer column is the entire evidence
    // that an answer engine cited us — there is no click id and no return
    // signal from Viator. The server reduces it to a host before storing.
    expect(SURFACES[name]()).toContain('ref:document.referrer||undefined');
  });

  it.each(NAMES)('%s honours the opt-out and writes nothing to the device', (name) => {
    const html = SURFACES[name]();
    expect(html).toContain("localStorage.getItem('10doa:no-analytics')==='true'");
    // Reading the opt-out is the ONLY storage call the beacon may make. A
    // setItem here would turn a cookieless beacon into one that needs consent.
    expect(html).not.toContain('setItem');
    expect(html).not.toContain('document.cookie');
  });

  it.each(NAMES)('%s posts as text/plain so the request is never preflighted', (name) => {
    // beacon.ts:"only text/plain, form-urlencoded and multipart are
    // CORS-safelisted" — application/json would add a preflight, and a failed
    // preflight means the POST never leaves the browser.
    const html = SURFACES[name]();
    expect(html).toContain("type:'text/plain'");
    expect(html).not.toContain('application/json');
  });
});
