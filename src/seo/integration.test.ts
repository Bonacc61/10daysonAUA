import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { ACTIVITIES } from '../data/activities';

// These assert on the OUTPUT of `npm run build`. They skip when dist/ has not
// been built, so `npm test` stays fast and offline for everyone else.
const BUILT = existsSync('dist/sitemap.xml');
const d = BUILT ? describe : describe.skip;

d('generated output in dist/', () => {
  const sitemap = () => readFileSync('dist/sitemap.xml', 'utf8');
  const pages = () =>
    readdirSync('dist/things-to-do', { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ slug: e.name, html: readFileSync(`dist/things-to-do/${e.name}/index.html`, 'utf8') }));

  // A product that has left the catalog keeps its URL but is deliberately not
  // advertised: no sitemap entry, no index listing, no inbound links. Every
  // assertion below that is about the PUBLISHED surface has to read this list
  // rather than every directory in dist/, or the retention feature would show
  // up as an orphan and a missing sitemap URL. The gone pages' own guarantees
  // are covered by src/seo/render.test.ts, which can build the state on demand.
  const indexable = () => pages().filter((p) => !p.html.includes('name="robots" content="noindex'));

  it('served robots.txt is a real file, not the SPA fallback', () => {
    expect(readFileSync('dist/robots.txt', 'utf8')).toContain('User-agent:');
  });

  it('generated both kinds of page — products and curated picks', () => {
    // 58 at the 2026-09-10 measurement; the range absorbs catalog churn without
    // absorbing a renderer silently dropping a whole category.
    expect(pages().length).toBeGreaterThanOrEqual(50);
    expect(pages().length).toBeLessThanOrEqual(70);
  });

  it('published the curated picks, not only the Viator products', () => {
    const all = pages().map((p) => p.html).join('');
    // localsSay text appears on no Viator page and cannot come from anywhere else.
    expect(all).toContain('Skip the hotel beach');
  });

  it('emits an index page that links every data page', () => {
    const idx = readFileSync('dist/things-to-do/index.html', 'utf8');
    expect(indexable().length, 'no indexable pages to check').toBeGreaterThan(30);
    for (const p of indexable()) expect(idx).toContain(`/things-to-do/${p.slug}/`);
  });

  it('links the generated surface from the app footer', () => {
    expect(readFileSync('src/components/Footer.tsx', 'utf8')).toContain('href="/things-to-do/"');
  });

  it('lists every generated page in the sitemap', () => {
    const xml = sitemap();
    expect(indexable().length, 'no indexable pages to check').toBeGreaterThan(30);
    for (const p of indexable()) expect(xml).toContain(`/things-to-do/${p.slug}/`);
    // The other direction: nothing carrying noindex may appear in the sitemap.
    // A noindex URL inside a sitemap is a contradiction Search Console flags.
    for (const p of pages()) {
      if (indexable().some((q) => q.slug === p.slug)) continue;
      expect(xml, `${p.slug} is noindex and must not be submitted`).not.toContain(`/things-to-do/${p.slug}/`);
    }
  });

  // A noindex URL inside a sitemap is a contradiction Search Console reports as
  // an error. Paths are spelled out rather than imported from src/lib/pages so
  // this cannot agree with the generator by sharing its mistake.
  it('keeps the private routes out of the sitemap', () => {
    const xml = sitemap();
    for (const path of ['/itinerary', '/map', '/dashboard', '/preview', '/stats']) {
      expect(xml, `${path} is private and must not be submitted`).not.toContain(
        `<loc>https://10daysonaruba.com${path}</loc>`,
      );
    }
    // Non-vacuous: the public routes ARE there, so the assertions above are
    // reading a real sitemap rather than an empty one.
    expect(xml).toContain('<loc>https://10daysonaruba.com/</loc>');
    expect(xml).toContain('<loc>https://10daysonaruba.com/explore</loc>');
  });

  // No orphans: a sitemap is a promise, internal links are the proof. The
  // index page above is the entry point; this checks the pages cross-link too.
  it('links every generated page from at least one other page', () => {
    const all = indexable();
    const linked = new Set<string>();
    for (const p of all) {
      for (const other of all) {
        if (other.slug !== p.slug && p.html.includes(`/things-to-do/${other.slug}/`)) {
          linked.add(other.slug);
        }
      }
    }
    const orphans = all.filter((p) => !linked.has(p.slug)).map((p) => p.slug);
    expect(orphans, `orphaned pages: ${orphans.join(', ')}`).toHaveLength(0);
  });

  // Every link we send to Viator has to earn: an outbound booking link without
  // pid/mcid is traffic given away. Not every page HAS one — most curated picks
  // are free beaches with nothing to book — so this checks the links that exist
  // and separately proves there are plenty of them.
  it('carries the affiliate parameters on every Viator link', () => {
    const links = pages().flatMap((p) =>
      [...p.html.matchAll(/href="([^"]*viator\.com[^"]*)"/g)].map((m) => ({ slug: p.slug, url: m[1] })),
    );
    expect(links.length, 'no Viator links at all — the surface earns nothing').toBeGreaterThan(30);
    for (const l of links) {
      expect(l.url, `${l.slug} lost pid`).toContain('pid=P00302487');
      expect(l.url, `${l.slug} lost mcid`).toContain('mcid=42383');
    }
  });

  // Curated picks carry `rating` and `reviewCount` that are EDITORIAL ranking
  // weights no platform backs (src/data/activities.ts). Publishing one as if it
  // were a review count would be a fabricated review signal. Checked in both
  // the raw and the thousands-separated spelling — a guard that only knew
  // "2847" would wave "2,847" straight through.
  it('never publishes an editorial rating as a platform rating', () => {
    const registry = JSON.parse(readFileSync('content/slugs.json', 'utf8')) as Record<string, string>;
    const published = ACTIVITIES.filter(
      (a) => registry[a.id] && existsSync(`dist/things-to-do/${registry[a.id]}/index.html`),
    );
    expect(published.length, 'no curated pages found to check').toBeGreaterThan(10);

    for (const a of published) {
      const html = readFileSync(`dist/things-to-do/${registry[a.id]}/index.html`, 'utf8');
      // Proof this is really that activity's page, so the assertions below are
      // not passing because we read some unrelated file.
      // The longest run of plain letters/digits/spaces — long enough to be
      // unique, and untouched by HTML escaping, unlike the quotes and
      // apostrophes localsSay is full of.
      const anchor = (a.localsSay.match(/[A-Za-z0-9 ]+/g) ?? []).sort((x, y) => y.length - x.length)[0] ?? '';
      expect(anchor.length, `${a.id} has no localsSay prose to anchor on`).toBeGreaterThan(8);
      expect(html, `${a.id}: wrong page`).toContain(anchor);

      for (const spelling of [String(a.reviewCount), a.reviewCount.toLocaleString('en-US')]) {
        expect(html, `${a.id} leaked its editorial reviewCount as "${spelling}"`).not.toContain(spelling);
      }
      expect(html, `${a.id} leaked its editorial rating`).not.toContain(`${a.rating} out of 5`);
    }
  });

  it('has a real collect URL substituted into the beacon', () => {
    for (const p of pages()) expect(p.html).not.toContain('__COLLECT_URL__');
    expect(readFileSync('dist/things-to-do/index.html', 'utf8')).not.toContain('__COLLECT_URL__');
  });
});
