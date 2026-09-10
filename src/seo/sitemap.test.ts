import { describe, it, expect } from 'vitest';
import { renderSitemap, publicRouteEntries, renderLlmsTxt } from './sitemap';
import { PAGE_TO_PATH, PRIVATE_PAGES } from '../lib/pages';

describe('renderSitemap', () => {
  it('emits a valid urlset with absolute locs', () => {
    const xml = renderSitemap([{ loc: 'https://10daysonaruba.com/', lastmod: '2026-09-10' }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://10daysonaruba.com/</loc>');
    expect(xml).toContain('<lastmod>2026-09-10</lastmod>');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('escapes ampersands so the XML stays well formed', () => {
    const xml = renderSitemap([{ loc: 'https://10daysonaruba.com/a?x=1&y=2', lastmod: '2026-09-10' }]);
    expect(xml).toContain('&amp;');
    expect(xml).not.toMatch(/&(?!amp;)/);
  });

  it('refuses a relative loc rather than emitting an invalid sitemap', () => {
    expect(() => renderSitemap([{ loc: '/relative', lastmod: '2026-09-10' }])).toThrow(/absolute/i);
  });
});

describe('publicRouteEntries', () => {
  it('includes the landing page', () => {
    expect(publicRouteEntries('2026-09-10').map((e) => e.loc))
      .toContain('https://10daysonaruba.com/');
  });

  // A noindex page in a sitemap is a direct contradiction: the sitemap asks for
  // indexing, the tag forbids it. Search Console reports it as an error.
  it('excludes every private route', () => {
    const locs = publicRouteEntries('2026-09-10').map((e) => e.loc);
    for (const p of PRIVATE_PAGES) {
      expect(locs).not.toContain('https://10daysonaruba.com' + PAGE_TO_PATH[p]);
    }
  });
});

describe('renderLlmsTxt', () => {
  it('lists each section and its links as markdown', () => {
    const txt = renderLlmsTxt([
      { heading: 'Guides', links: [{ title: 'Boat tours', url: '/guides/boat-tours/' }] },
    ]);
    expect(txt).toContain('# 10 days on Aruba');
    expect(txt).toContain('## Guides');
    expect(txt).toContain('- [Boat tours](https://10daysonaruba.com/guides/boat-tours/)');
  });
});
