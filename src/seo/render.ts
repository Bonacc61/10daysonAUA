// One activity page, as a complete static HTML document.
//
// No React here on purpose: these pages are documents, not app. They link the
// app's own fingerprinted stylesheet so the two surfaces cannot drift visually,
// and they ship no JavaScript beyond the small analytics beacon.

import { combinedBreakdown, reviewSourcesFor } from '../data/reviewBreakdown';
import { whatToExpectFor } from '../data/whatToExpect';
import { startTimesFor, formatStartTime } from '../data/startTimes';
import { viatorLink, bookUrlForActivity } from '../data/exploreItems';
import type { Activity } from '../data/activities';
import { ORIGIN } from '../lib/head';
import { urlFor } from './slugs';
import type { SeoCatalogItem } from './catalog';

export type DataPageInput = {
  item: SeoCatalogItem;
  slug: string;
  cssHref: string;
  buildDate: string;
  related: { title: string; url: string }[];
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Whether the per-platform split says anything.
 *
 * The headline rating is ALWAYS the combined figure — that is the number on the
 * Viator page the visitor lands on, and a page showing a different one reads as
 * stale even when both are right (src/data/reviewBreakdown.ts:50). The split is
 * provenance, not the rating, and it is only interesting when the platforms
 * actually disagree.
 */
const DISAGREEMENT = 0.3;

export function platformSplitWorthShowing(id: string): boolean {
  const rows = reviewSourcesFor(id).filter((r) => r.a !== null);
  if (rows.length < 2) return false;
  const averages = rows.map((r) => r.a as number);
  return Math.max(...averages) - Math.min(...averages) >= DISAGREEMENT;
}

/**
 * A Viator product page.
 *
 * `item.gone` — the product has left the catalog — renders the same document
 * with two differences: the booking CTA is replaced by a "no longer listed"
 * note (linking a de-listed product wastes the click), and `noindex, follow`
 * asks crawlers to stop indexing it while still following its links. Not a
 * removal: the URL stays reachable and keeps passing equity to the live
 * alternatives in "Similar things to do". See src/seo/catalog.ts.
 */
export function renderDataPage(input: DataPageInput): string {
  const { item, slug, cssHref, buildDate, related } = input;
  const title = escapeHtml(item.title);
  const canonical = ORIGIN + urlFor(slug, 'things-to-do');
  const breakdown = combinedBreakdown(item.id);
  const prose = whatToExpectFor(item.id);
  const times = startTimesFor(item.id);
  const book = viatorLink(item.viator_item_url);

  const description = escapeHtml(
    `${item.title} in Aruba — real reviews, what the trip involves${
      times.length ? `, departs ${formatStartTime(times[0])}` : ''
    }.`,
  ).slice(0, 160);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — 10 days on Aruba</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
${item.gone ? '<meta name="robots" content="noindex, follow">\n' : ''}<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="stylesheet" href="${cssHref}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${escapeHtml(item.image_url)}">
${jsonLd(item, canonical)}
</head>
<body>
<main class="seo-page">
<nav class="seo-crumbs"><a href="/">10 days on Aruba</a> › <a href="/things-to-do/">Things to do</a> › <span>${title}</span></nav>

<h1>${title}</h1>
${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${title}" width="800" height="533" loading="lazy">` : ''}

${breakdown ? ratingBlock(item.id, breakdown) : ''}
${factsTable(item, times)}
${prose ? `<section><h2>What this involves</h2><p>${escapeHtml(summarise(prose))}</p><p class="seo-source">In the operator's own words.</p></section>` : ''}
${faqBlock(item, times)}

${item.gone
  ? `<p class="seo-gone">This trip is <strong>no longer listed</strong> by its operator. The reviews below are kept for reference; the activities underneath are live alternatives.</p>`
  : `<p class="seo-cta"><a class="btn" href="${escapeHtml(book)}" target="_blank" rel="noopener sponsored">Check dates and prices on Viator</a></p>`}
<p class="seo-plan"><a href="/questionnaire?ref=seo-${escapeHtml(slug)}">Build a full Aruba itinerary around this</a></p>

${related.length ? `<section><h2>Similar things to do</h2><ul>${
  related.map((r) => `<li><a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a></li>`).join('')
}</ul></section>` : ''}

<p class="seo-freshness">Data updated ${buildDate}</p>
</main>
<script>${BEACON}</script>
</body>
</html>
`;
}

function ratingBlock(id: string, b: { total: number; counts: number[]; average: number }): string {
  const max = Math.max(...b.counts, 1);
  const bars = b.counts
    .map((c, i) => {
      const star = i + 1;
      const pct = Math.round((c / max) * 100);
      return `<li data-star="${star}"><span class="seo-star">${star}★</span><span class="seo-bar" style="width:${pct}%"></span><span class="seo-count">${c}</span></li>`;
    })
    .reverse()
    .join('');

  // The headline is the COMBINED figure — the number the Viator page prints.
  let split = '';
  if (platformSplitWorthShowing(id)) {
    const rows = reviewSourcesFor(id)
      .filter((r) => r.a !== null)
      .map((r) => `<li>${r.p === 'V' ? 'Viator' : 'Tripadvisor'}: ${r.a}★ from ${r.n} reviews</li>`)
      .join('');
    split = `<details class="seo-split"><summary>Where these reviews come from</summary><ul>${rows}</ul><p>Both figures are real; the headline above is the combined total, which is what the booking page shows.</p></details>`;
  }

  return `<section data-seo-rating><h2>What ${b.total} reviewers actually said</h2>
<p class="seo-average"><strong>${b.average}</strong> out of 5, from ${b.total} reviews</p>
<ul data-seo-histogram>${bars}</ul>
${split}
</section>`;
}

function factsTable(item: SeoCatalogItem, times: string[]): string {
  const rows: string[] = [];
  if (item.duration) rows.push(row('duration', 'Duration', item.duration));
  if (times.length) rows.push(row('times', 'Starts', times.map(formatStartTime).join(', ')));
  // price_usd has historically arrived as 0 from viator-cards
  // (src/data/activitySource.ts:262) — check, never trust.
  if (item.price_usd > 0) rows.push(row('price', 'From', `$${item.price_usd}`));
  if (!rows.length) return '';
  return `<section><h2>The practical details</h2><table class="seo-facts"><tbody>${rows.join('')}</tbody></table></section>`;
}

function row(key: string, label: string, value: string): string {
  return `<tr data-row="${key}"><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function faqBlock(item: SeoCatalogItem, times: string[]): string {
  const qs: { q: string; a: string }[] = [];
  if (times.length) {
    qs.push({ q: `What time does ${item.title} start?`, a: `It departs at ${times.map(formatStartTime).join(' or ')}.` });
  }
  if (item.duration) {
    qs.push({ q: 'How long does it take?', a: `About ${item.duration}.` });
  }
  if (!qs.length) return '';
  return `<section><h2>Common questions</h2>${
    qs.map((x) => `<h3>${escapeHtml(x.q)}</h3><p>${escapeHtml(x.a)}</p>`).join('')
  }</section>`;
}

/** First two sentences of the operator's own text — a summary, not a reprint. */
function summarise(prose: string): string {
  const sentences = prose.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return sentences.length > 320 ? sentences.slice(0, 317) + '…' : sentences;
}

/**
 * `title` and `slug` were dropped from the original signature: everything this
 * needs comes from `item` and `canonical`, and an unused parameter here is a
 * dangling seam a future edit could accidentally wire up to something that
 * should never enter structured data — see renderCuratedPage below.
 */
function jsonLd(item: SeoCatalogItem, canonical: string): string {
  // No aggregateRating: Google's review-snippet policy wants first-party
  // ratings, and these are Viator's and Tripadvisor's. The histogram lives in
  // the visible HTML, which is what answer engines read anyway.
  const attraction = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: item.title,
    url: canonical,
    image: item.image_url || undefined,
    touristType: 'Leisure',
    address: { '@type': 'PostalAddress', addressCountry: 'AW' },
  };
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '10 days on Aruba', item: ORIGIN + '/' },
      { '@type': 'ListItem', position: 2, name: 'Things to do', item: ORIGIN + '/things-to-do/' },
      { '@type': 'ListItem', position: 3, name: item.title, item: canonical },
    ],
  };
  return [attraction, crumbs]
    .map((o) => `<script type="application/ld+json">\n${jsonForScript(o)}\n</script>`)
    .join('\n');
}

/**
 * JSON.stringify, safe to embed inside a <script> tag.
 *
 * A title containing "</script>" (hostile or just an operator's odd copy)
 * would otherwise close the JSON-LD block early — the HTML parser terminates
 * a <script> element on that literal substring regardless of what's inside a
 * JSON string. Escaping "<" as < keeps the JSON valid (it decodes back
 * to "<" on parse) while making that impossible.
 */
function jsonForScript(o: unknown): string {
  return JSON.stringify(o, null, 2).replace(/</g, '\\u003c');
}

/**
 * A curated local pick.
 *
 * Deliberately NOT renderDataPage with different arguments: these pages have no
 * review histogram, and their `rating`/`reviewCount` are EDITORIAL ranking
 * weights that no platform backs (src/data/activities.ts:26). Sharing a
 * renderer with the Viator pages would be one refactor away from printing them
 * as if they were reviews. Two renderers, one of which structurally cannot.
 *
 * No JSON-LD here either: jsonLd() takes a SeoCatalogItem, and casting an
 * Activity into that shape to reuse it is exactly the kind of shortcut that
 * later leaks an editorial rating into structured data. If curated pages want
 * TouristAttraction markup, give them their own builder in a later change.
 */
export function renderCuratedPage(input: {
  activity: Activity;
  slug: string;
  cssHref: string;
  buildDate: string;
  related: { title: string; url: string }[];
}): string {
  const { activity: a, slug, cssHref, buildDate, related } = input;
  const title = escapeHtml(a.title);
  const canonical = ORIGIN + urlFor(slug, 'things-to-do');
  const book = bookUrlForActivity(a);

  const facts: string[] = [];
  if (a.cost) facts.push(row('cost', 'Cost', a.cost));
  if (a.duration) facts.push(row('duration', 'How long', a.duration));
  if (a.timeOfDay) facts.push(row('when', 'Best time', a.timeOfDay));
  if (a.location) facts.push(row('location', 'Where', a.location));
  if (a.requires_car) facts.push(row('car', 'Getting there', 'You will want a car'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — 10 days on Aruba</title>
<meta name="description" content="${escapeHtml(a.description).slice(0, 160)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="stylesheet" href="${cssHref}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:url" content="${canonical}">
</head>
<body>
<main class="seo-page">
<nav class="seo-crumbs"><a href="/">10 days on Aruba</a> › <a href="/things-to-do/">Things to do</a> › <span>${title}</span></nav>

<h1>${title}</h1>
${a.image ? `<img src="${escapeHtml(a.image)}" alt="${title}" width="800" height="533" loading="lazy">` : ''}
<p>${escapeHtml(a.description)}</p>

${a.localsSay ? `<blockquote class="seo-locals">${escapeHtml(a.localsSay)}</blockquote>` : ''}

${facts.length ? `<section><h2>The practical details</h2><table class="seo-facts"><tbody>${facts.join('')}</tbody></table></section>` : ''}

${book ? `<p class="seo-cta"><a class="btn" href="${escapeHtml(book.url)}" target="_blank" rel="${book.affiliate ? 'noopener sponsored' : 'noopener'}">Book this</a></p>` : ''}
<p class="seo-plan"><a href="/questionnaire?ref=seo-${escapeHtml(slug)}">Build a full Aruba itinerary around this</a></p>

${related.length ? `<section><h2>Nearby and similar</h2><ul>${
  related.map((r) => `<li><a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a></li>`).join('')
}</ul></section>` : ''}

<p class="seo-freshness">Updated ${buildDate}</p>
</main>
<script>${BEACON}</script>
</body>
</html>
`;
}

/**
 * The beacon, inlined.
 *
 * src/lib/beacon.ts lives in the app bundle, which these pages deliberately do
 * not load — so without this they would be invisible to /stats and the whole
 * "did SEO send anyone" question would be unanswerable. Writes nothing to the
 * device, so it needs no consent banner, exactly like its app counterpart.
 * VITE_COLLECT_FN_URL is substituted at generate time by tools/build-seo.ts.
 *
 * `ref` is document.referrer, and it is the point of these pages. The server
 * reduces it to a HOST (`referrerHost` in supabase/functions/collect) — never
 * the full URL — and a referring host is the only observable GEO signal there
 * is: Viator sends no return signal and ChatGPT sends no click id, so
 * `chatgpt.com` or `perplexity.ai` arriving in that column is the entire
 * evidence that an answer engine cited us. Sent only when non-empty, matching
 * `send()`'s `document.referrer || undefined` in src/lib/beacon.ts — a direct
 * visit has an empty referrer and would otherwise store a meaningless ''.
 */
const BEACON = `(function(){try{if(localStorage.getItem('10doa:no-analytics')==='true')return}catch(e){return}
var u='__COLLECT_URL__';if(!u)return;var b=JSON.stringify({name:'pageview',path:location.pathname,ref:document.referrer||undefined});
try{navigator.sendBeacon?navigator.sendBeacon(u,new Blob([b],{type:'text/plain'})):fetch(u,{method:'POST',body:b,keepalive:true,headers:{'content-type':'text/plain'}})}catch(e){}})();`;

/**
 * The hub-shaped index at /things-to-do/.
 *
 * This is the entry point into the generated surface: the footer links here,
 * and this links to every data page. Phase 2's five editorial guides will sit
 * between the two, but the crawl path must not wait for them.
 */
export function renderIndexPage(input: {
  entries: { title: string; url: string }[];
  cssHref: string;
  buildDate: string;
}): string {
  const { entries, cssHref, buildDate } = input;
  const canonical = ORIGIN + '/things-to-do/';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Things to do in Aruba — reviews and practical detail</title>
<meta name="description" content="Aruba activities with combined Viator and Tripadvisor review data, start times and what each trip actually involves.">
<link rel="canonical" href="${canonical}">
<link rel="stylesheet" href="${cssHref}">
</head>
<body>
<main class="seo-page">
<nav class="seo-crumbs"><a href="/">10 days on Aruba</a> › <span>Things to do</span></nav>
<h1>Things to do in Aruba</h1>
<p>${entries.length} activities, each with its combined review distribution, real start times, and what the trip involves. Ratings are summed across Viator and Tripadvisor — the same figure the booking page shows.</p>
<ul class="seo-index">${
  entries.map((e) => `<li><a href="${escapeHtml(e.url)}">${escapeHtml(e.title)}</a></li>`).join('')
}</ul>
<p class="seo-plan"><a href="/questionnaire?ref=seo-index">Build a full Aruba itinerary</a></p>
<p class="seo-freshness">Data updated ${buildDate}</p>
</main>
<script>${BEACON}</script>
</body>
</html>
`;
}
