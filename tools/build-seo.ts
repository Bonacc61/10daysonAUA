/**
 * Generate the static content surface into dist/, after `vite build`.
 *
 * Offline and deterministic by construction: every input is a committed file.
 * Refresh the catalog input with `npm run seo:refresh` — deliberately a
 * separate, hand-run step, because this one runs on every push to main.
 *
 * Fails loudly rather than skipping: silently emitting nothing would 404 every
 * content URL on the next deploy.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { cssHrefFromManifest } from '../src/seo/assets';
import { selectPages, departedPages } from '../src/seo/floor';
import type { SeoCatalogItem, SeoCatalogSnapshot } from '../src/seo/catalog';
import { mintedIds, proposeRegistry, slugFor, urlFor } from '../src/seo/slugs';
import { renderDataPage, renderCuratedPage, renderIndexPage, renderGuidePage } from '../src/seo/render';
import { loadGuide, type Guide } from '../src/seo/guides';
import { advertised, pickRelated, type Link } from '../src/seo/links';
import { renderSitemap, publicRouteEntries, renderLlmsTxt } from '../src/seo/sitemap';
import { ORIGIN } from '../src/lib/head';

const DIST = 'dist';
const REGISTRY = 'content/slugs.json';
const GUIDES = 'content/guides';
const MANIFEST_CANDIDATES = [`${DIST}/.vite/manifest.json`, `${DIST}/manifest.json`];

function main(): void {
  const buildDate = new Date().toISOString().slice(0, 10);

  const manifestPath = MANIFEST_CANDIDATES.find(existsSync);
  if (!manifestPath) {
    throw new Error(`seo: no Vite manifest at ${MANIFEST_CANDIDATES.join(' or ')} — run vite build first.`);
  }
  const cssHref = cssHrefFromManifest(readFileSync(manifestPath, 'utf8'));

  const snapshot = JSON.parse(readFileSync('src/data/seoCatalog.json', 'utf8')) as SeoCatalogSnapshot;
  // The quality floor decides which LIVE products earn a URL. A product that
  // has left the catalog is deliberately not put to it again: it already owns a
  // published URL, and whether it would still clear the bar today is beside the
  // point. `departed`, below, is what keeps those URLs alive.
  const { products, curated } = selectPages(snapshot.items.filter((i) => !i.gone));

  // Refuse a product whose URL lost its affiliate parameters. A page that sends
  // traffic to Viator without pid/mcid is a page that earns nothing, and the
  // whole point of the surface is bookings.
  const publishable = products.filter((p) => {
    const ok = p.viator_item_url.includes('pid=') && p.viator_item_url.includes('mcid=');
    if (!ok) console.error(`seo: skipping ${p.id} — booking URL has no pid/mcid`);
    return ok;
  });
  if (!publishable.length) {
    throw new Error('seo: the quality floor selected no publishable products — refusing to emit an empty surface.');
  }

  const existing = existsSync(REGISTRY)
    ? (JSON.parse(readFileSync(REGISTRY, 'utf8')) as Record<string, string>)
    : {};
  // One registry for both kinds: they share the /things-to-do/ namespace, so a
  // curated pick and a Viator product must never collide on a slug.
  const registry = proposeRegistry(
    [
      ...publishable.map((p) => ({ id: p.id, title: p.title })),
      ...curated.map((a) => ({ id: a.id, title: a.title })),
    ],
    existing,
  );
  // A published slug must never move — that is the whole reason the registry
  // exists (src/seo/slugs.ts). But proposeRegistry can only protect ids it
  // ALREADY holds, so a run that mints a URL and then discards the registry is
  // the one path that can silently rename an indexed page:
  //
  //   seo:refresh adds a product, nobody builds locally, so slugs.json gains
  //   nothing → CI mints "foo" and deploys → Google indexes /things-to-do/foo/
  //   → months later Viator RETITLES that product → CI mints "bar" for the same
  //   id, because "foo" was never committed → deploy.yml mirrors with --delete
  //   → /things-to-do/foo/ is a hard 404 on an indexed URL, no redirect, and
  //   every link pointing at it is lost.
  //
  // No collision is needed for that; the snapshot changing is enough. Locally
  // the fix is cheap — mint, then commit slugs.json. In CI nothing can commit,
  // so minting is refused outright and the deploy fails while it is still
  // recoverable. Do NOT "simplify" this back into an unconditional write: the
  // failure it guards is an unrecoverable 404, not a warning.
  const minted = mintedIds(existing, registry);
  if (minted.length) {
    console.error(
      `seo: ${minted.length} new URL(s) minted:\n` +
        minted.map((id) => `  ${id} \u2192 /things-to-do/${registry[id]}/`).join('\n'),
    );
    if (process.env.CI) {
      throw new Error(
        'seo: refusing to mint a URL in CI, which cannot commit content/slugs.json. ' +
          'A slug this build invents and throws away can be invented differently on a ' +
          'later run once Viator retitles the product, 404ing an already-indexed page. ' +
          'Run `npm run build` locally and commit content/slugs.json first.',
      );
    }
    console.error('seo: commit content/slugs.json so those URLs become permanent.');
  }
  writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + '\n');

  /** A missing slug would emit dist/things-to-do/undefined/ — fail instead. */
  const mustSlug = (id: string): string => {
    const slug = slugFor(id, registry);
    if (!slug) throw new Error(`seo: no slug for "${id}" — the registry is out of step with the selection.`);
    return slug;
  };

  // The clause src/seo/slugs.ts promises — "a vanished product keeps its URL".
  // Read from the snapshot and the pre-existing registry, NOT from the
  // selection: the loop over `publishable` only ever walks what the floor
  // picked today, which is exactly how that promise came to be false.
  const departed = departedPages(snapshot.items, existing);

  const collectUrl = readEnv('VITE_COLLECT_FN_URL');
  if (!collectUrl) {
    console.error('seo: WARNING — no VITE_COLLECT_FN_URL in .env.production; generated pages will not be counted in /stats.');
  }

  const productLinks: Link[] = [];

  for (let i = 0; i < publishable.length; i++) {
    const item = publishable[i];
    const slug = mustSlug(item.id);
    const related = pickRelated(item, publishable, mustSlug, i);
    const html = withCollectUrl(renderDataPage({ item, slug, cssHref, buildDate, related }), collectUrl);
    writePage(slug, html);
    productLinks.push({ title: item.title, url: urlFor(slug, 'things-to-do') });
  }

  // The 19 curated picks — the pages carrying hand-written localsSay, which is
  // the only text on this site that exists nowhere else.
  const curatedLinks: Link[] = [];
  for (let i = 0; i < curated.length; i++) {
    const activity = curated[i];
    const slug = mustSlug(activity.id);
    // Two curated neighbours, wrapping — a cycle, so every curated page is
    // linked from another one. Related links on the product side never reach
    // this half of the surface, so without the cycle all 19 would be orphans.
    // Plus one product, rotated so the inbound links spread rather than piling
    // onto the first three.
    const related: Link[] = [
      ...[curated[(i + 1) % curated.length], curated[(i + 2) % curated.length]]
        .filter((o, j, arr) => o.id !== activity.id && arr.findIndex((x) => x.id === o.id) === j)
        .map((o) => ({ title: o.title, url: urlFor(mustSlug(o.id), 'things-to-do') })),
      productLinks[i % productLinks.length],
    ];
    const html = withCollectUrl(renderCuratedPage({ activity, slug, cssHref, buildDate, related }), collectUrl);
    writePage(slug, html);
    curatedLinks.push({ title: activity.title, url: urlFor(slug, 'things-to-do') });
  }

  // The departed. Their pages are written like any other, then marked `gone`
  // so advertised() drops them from all three listings at once. Reachable at
  // the URL the outside world already points at, still passing equity onward
  // through their related links, but not advertised and not in the index.
  // `publishable` is live-only, so the alternatives they offer are all real.
  const departedLinks: Link[] = [];
  for (let i = 0; i < departed.length; i++) {
    const item = departed[i];
    const slug = mustSlug(item.id);
    const related = pickRelated(item, publishable, mustSlug, i);
    writePage(slug, withCollectUrl(renderDataPage({ item, slug, cssHref, buildDate, related }), collectUrl));
    departedLinks.push({ title: item.title, url: urlFor(slug, 'things-to-do'), gone: true });
  }
  if (departed.length) {
    console.error(
      `seo: ${departed.length} product(s) have left the catalog; their URLs stay alive as noindex, out of the sitemap:\n` +
        departed.map((i) => `  ${i.id} → /things-to-do/${mustSlug(i.id)}/`).join('\n'),
    );
  }

  // The editorial guides. Deliberately last among the page loops: their
  // internal links are checked against the slugs actually written above, so
  // everything they could point at has to exist by now.
  const guideLinks = emitGuides({
    knownIds: new Set([...publishable.map((p) => p.id), ...curated.map((c) => c.id)]),
    cssHref,
    buildDate,
    collectUrl,
  });

  // ONE filter, feeding sitemap.xml, llms.txt and the /things-to-do/ index —
  // so "a retained page is never advertised" is a single assertable step
  // rather than three places that each have to remember.
  const emitted = advertised([...productLinks, ...curatedLinks, ...departedLinks]);

  mkdirSync(`${DIST}/things-to-do`, { recursive: true });
  const indexHtml = withCollectUrl(renderIndexPage({ entries: emitted, guides: guideLinks, cssHref, buildDate }), collectUrl);
  // renderIndexPage's ref is the static "seo-index" (9 chars), not id-derived,
  // but it still flows through the same allowlist the collect function
  // enforces — checked here rather than assumed safe.
  assertSafeRef(indexHtml, 'the things-to-do index');
  writeFileSync(
    `${DIST}/things-to-do/index.html`,
    // withCollectUrl here too: the hub carries the same beacon as every page
    // under it, and without the substitution it would ship the literal
    // __COLLECT_URL__ and count nothing.
    indexHtml,
  );

  const entries = [
    ...publicRouteEntries(buildDate),
    { loc: `${ORIGIN}/things-to-do/`, lastmod: buildDate },
    ...guideLinks.map((g) => ({ loc: ORIGIN + g.url, lastmod: buildDate })),
    ...emitted.map((e) => ({ loc: ORIGIN + e.url, lastmod: buildDate })),
  ];
  writeFileSync(`${DIST}/sitemap.xml`, renderSitemap(entries));
  writeFileSync(
    `${DIST}/llms.txt`,
    renderLlmsTxt([
      // Guides first: they are the pages that answer a question rather than
      // describe a product, and an answer engine reading top-down should meet
      // the judgement before the catalog.
      ...(guideLinks.length ? [{ heading: 'Guides', links: guideLinks }] : []),
      { heading: 'Things to do in Aruba', links: emitted },
    ]),
  );

  dropManifest(manifestPath);

  console.log(`seo: ${productLinks.length} product + ${curatedLinks.length} curated pages + index, ${guideLinks.length} guides, ${entries.length} sitemap urls, css ${cssHref}`);
}

/**
 * The editorial guides, from content/guides/*.md.
 *
 * `status` is the gate and it is the most consequential line in this file.
 * Only `published` is emitted; anything else is skipped and named on stdout,
 * because the alternative — a pipeline that publishes whatever markdown it
 * finds — puts unreviewed writing on a live site the moment someone drafts a
 * file. Publication is an editorial decision, not a side effect of a build.
 */
function emitGuides(ctx: {
  knownIds: Set<string>;
  cssHref: string;
  buildDate: string;
  collectUrl: string | null;
}): Link[] {
  const files = existsSync(GUIDES) ? readdirSync(GUIDES).filter((f) => f.endsWith('.md')).sort() : [];

  // A draft that does not parse is warned about and dropped here; a file that
  // does not say it is a draft still throws out of loadGuide and fails the
  // build. See src/seo/guides.ts for why the two are treated differently.
  const guides: Guide[] = [];
  let unreadable = 0;
  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const loaded = loadGuide(slug, readFileSync(`${GUIDES}/${file}`, 'utf8'));
    if ('skipped' in loaded) {
      unreadable++;
      console.error(`seo: WARNING — draft guide "${GUIDES}/${file}" SKIPPED, it does not parse: ${loaded.skipped}`);
      continue;
    }
    guides.push(loaded.guide);
  }

  const links: Link[] = [];
  for (const guide of guides) {
    if (guide.status !== 'published') {
      console.error(`seo: guide "${guide.slug}" NOT published — status: ${guide.status}.`);
      continue;
    }
    assertKnownRefs(guide, ctx.knownIds);
    const html = withCollectUrl(
      renderGuidePage({ guide, cssHref: ctx.cssHref, buildDate: ctx.buildDate }),
      ctx.collectUrl,
    );
    assertLinksResolve(guide, html);
    assertSafeRef(html, `guide "${guide.slug}"`);
    const dir = `${DIST}/guides/${guide.slug}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/index.html`, html);
    links.push({ title: guide.title, url: urlFor(guide.slug, 'guides') });
  }
  console.error(
    `seo: ${links.length} guide(s) published, ${guides.length - links.length} skipped as unpublished` +
      (unreadable ? `, ${unreadable} skipped as unreadable drafts` : '') + '.',
  );
  return links;
}

/**
 * The spec's rule: "the generator fails the build if a hub references a
 * product code it does not know."
 *
 * Checked against the ids that earned a page THIS run, not against the whole
 * catalog — an id that exists but has no page is exactly the case that
 * produces a 404 from an editorial page, and the first draft contains one
 * (`boca-catalina-shore`, a real curated activity with empty localsSay, which
 * the quality floor holds out). Failing here names the guide and the id while
 * it is still a five-second fix; failing silently ships a broken link on the
 * page with the most inbound equity.
 */
function assertKnownRefs(guide: Guide, knownIds: Set<string>): void {
  const bad = [...guide.products, ...guide.curated].filter((id) => !knownIds.has(id));
  if (bad.length) {
    throw new Error(
      `seo: guide "${guide.slug}" references ${bad.length} id(s) with no generated page: ${bad.join(', ')}. ` +
        'Frontmatter takes registry ids (content/slugs.json keys), not slugs. Fix the guide or the floor.',
    );
  }
}

/**
 * Every /things-to-do/ link in the rendered guide has to point at a page this
 * build wrote. The frontmatter check above covers what the guide DECLARES; this
 * covers what it actually links, which is what a reader clicks.
 */
function assertLinksResolve(guide: Guide, html: string): void {
  const slugs = [...html.matchAll(/href="\/things-to-do\/([^/"]+)\//g)].map((m) => m[1]);
  const dead = [...new Set(slugs)].filter((s) => !writtenSlugs.has(s));
  if (dead.length) {
    throw new Error(
      `seo: guide "${guide.slug}" links to ${dead.length} /things-to-do/ URL(s) that this build did not write: ` +
        `${dead.join(', ')}. A dead internal link on a hub is worse than a missing hub.`,
    );
  }
}

/**
 * The Vite manifest is a build INPUT, not a deliverable.
 *
 * vite.config.ts turns it on solely so this generator can find the fingerprinted
 * stylesheet — but deploy.yml mirrors dist/ wholesale, dot-directories included,
 * so it would be published at /.vite/manifest.json: a map of every chunk to its
 * source path, handed to anyone who guesses the URL.
 *
 * Deleted HERE, where it is consumed, rather than excluded in deploy.yml. The
 * exclusion would fix the deploy and leave `npm run build` still producing a
 * dist/ that is not what gets served — so `vite preview`, a local inspection and
 * CI would each be looking at a different tree, and the next thing that reads
 * dist/ would have to remember the exclusion too. One place, one rule: after
 * this line dist/ is exactly the deliverable.
 *
 * Only the file that was read, and the directory only when nothing else is left
 * in it — a future Vite may put something else there, and this is not the code
 * that should decide its fate.
 */
function dropManifest(manifestPath: string): void {
  rmSync(manifestPath, { force: true });
  const dir = manifestPath.replace(/\/[^/]+$/, '');
  if (dir !== DIST && existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}

/**
 * Every slug this build emits flows into deploy.yml's lftp heredoc: `find
 * things-to-do -name index.html | sed ...` turns each
 * `things-to-do/<slug>/index.html` into a `put -O <remote>/<path> ...` line
 * that lftp reads back inside the same heredoc. slugify() (src/seo/slugs.ts)
 * can only emit [a-z0-9-], but content/slugs.json is hand-editable — a
 * committed registry entry never goes through slugify() again — so a stray
 * `;` or `|` there would reach lftp as a command separator or pipe rather
 * than a path segment. Enforced here, at the one place every slug (product,
 * curated, and departed) passes through before touching disk.
 */
function assertSafeSlug(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(
      `seo: slug "${slug}" contains characters outside [a-z0-9-] — it would reach deploy.yml's ` +
        'lftp heredoc unescaped. Fix content/slugs.json.',
    );
  }
}

/**
 * Contract with `campaign()` in `supabase/functions/collect/normalise.ts` —
 * KEEP THESE TWO IDENTICAL. That function allowlists the `ref` query param on
 * every "Build a full Aruba itinerary" link; anything that doesn't match is
 * silently turned to `null` and the pageview is stored with no attribution.
 * There is no error anywhere when the two drift: the beacon sends whatever
 * this file was willing to emit, the edge function nulls whatever normalise.ts
 * doesn't allow, and both sides look fine in isolation. This is exactly how
 * the original bug shipped — 40 of 58 generated refs were one character short
 * of the limit and nobody noticed until someone looked at raw ingest rows.
 * `tools/build-seo.refContract.test.ts` fails the build (via `npx vitest run`)
 * if the two patterns' literal source text ever stops matching.
 */
const REF_PATTERN = /^[a-z0-9-]{1,32}$/;

/**
 * Every `?ref=` link this build is about to publish, checked against the
 * exact allowlist the collect function enforces server-side. Failing here —
 * loudly, before anything is written — is the only way a mismatch is not
 * silent: see REF_PATTERN above.
 */
function assertSafeRef(html: string, context: string): void {
  // EVERY ref on the page, not just the first. The generated pages carry
  // exactly one, but a guide's body is hand-written markdown that can carry its
  // own — and a ref an author typed is the one most likely to run long.
  const refs = [...html.matchAll(/\/questionnaire\?ref=([^"]*)"/g)].map((m) => m[1]);
  if (!refs.length) {
    throw new Error(`seo: ${context} has no ?ref= link to the planner — attribution would be unmeasurable.`);
  }
  for (const ref of refs) {
    if (!REF_PATTERN.test(ref)) {
      throw new Error(
        `seo: ref "${ref}" (${ref.length} chars) for ${context} fails the collect allowlist ` +
          `${REF_PATTERN.source} enforced in supabase/functions/collect/normalise.ts — the beacon ` +
          'would send it, the server would silently null it, and this page would vanish from ' +
          '/stats with no error anywhere. Fix the id or the renderer, not this check.',
      );
    }
  }
}

/**
 * Every /things-to-do/ slug this run actually wrote to disk. Read by
 * assertLinksResolve() so a guide's internal links are checked against what
 * exists rather than against what the registry once promised.
 */
const writtenSlugs = new Set<string>();

function writePage(slug: string, html: string): void {
  assertSafeSlug(slug);
  assertSafeRef(html, `slug "${slug}"`);
  const dir = `${DIST}/things-to-do/${slug}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/index.html`, html);
  writtenSlugs.add(slug);
}

/**
 * Substitute the beacon's placeholder. The replacement goes through a function
 * so a URL containing `$&` or `$1` is inserted literally rather than being read
 * as a String.replace pattern.
 */
function withCollectUrl(html: string, collectUrl: string | null): string {
  return html.replaceAll('__COLLECT_URL__', () => collectUrl ?? '');
}

function readEnv(key: string): string | null {
  try {
    const raw = readFileSync('.env.production', 'utf8');
    return (raw.match(new RegExp(`^${key}=(.+)$`, 'm')) || [])[1]?.trim() || null;
  } catch {
    return null;
  }
}

main();
