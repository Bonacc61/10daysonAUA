// sitemap.xml and llms.txt.
//
// Until this existed, /sitemap.xml fell through the SPA rewrite and returned
// index.html as text/html — an invalid sitemap rather than an absent one.

import { ORIGIN } from '../lib/head';
import { PAGE_TO_PATH, PRIVATE_PAGES, type PageId } from '../lib/pages';

export type SitemapEntry = { loc: string; lastmod: string };

export function renderSitemap(urls: SitemapEntry[]): string {
  const body = urls
    .map(({ loc, lastmod }) => {
      if (!loc.startsWith('http')) {
        throw new Error(`seo: sitemap loc must be absolute, got "${loc}"`);
      }
      return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The SPA routes worth submitting. Private routes are excluded: they carry
 * noindex, and a noindex URL inside a sitemap is a contradiction Search Console
 * reports as an error.
 */
export function publicRouteEntries(lastmod: string): SitemapEntry[] {
  const priv = new Set<PageId>(PRIVATE_PAGES);
  return (Object.keys(PAGE_TO_PATH) as PageId[])
    .filter((p) => !priv.has(p))
    .map((p) => ({ loc: ORIGIN + PAGE_TO_PATH[p], lastmod }));
}

/**
 * llms.txt — an emerging convention for telling answer engines what a site
 * holds. Adoption is uncertain and the cost is one file, which is the whole
 * argument for shipping it.
 */
export function renderLlmsTxt(
  sections: { heading: string; links: { title: string; url: string }[] }[],
): string {
  const head = `# 10 days on Aruba\n\n> A free Aruba trip planner, plus review data and practical detail for the island's activities. Ratings shown are combined across Viator and Tripadvisor.\n`;
  const body = sections
    .map((s) => `\n## ${s.heading}\n\n${s.links.map((l) => `- [${l.title}](${ORIGIN}${l.url})`).join('\n')}\n`)
    .join('');
  return head + body;
}
