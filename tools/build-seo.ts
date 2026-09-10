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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { cssHrefFromManifest } from '../src/seo/assets';
import { selectPages } from '../src/seo/floor';
import type { SeoCatalogItem, SeoCatalogSnapshot } from '../src/seo/catalog';
import { mintedIds, proposeRegistry, slugFor, urlFor } from '../src/seo/slugs';
import { renderDataPage, renderCuratedPage, renderIndexPage } from '../src/seo/render';
import { renderSitemap, publicRouteEntries, renderLlmsTxt } from '../src/seo/sitemap';
import { ORIGIN } from '../src/lib/head';

const DIST = 'dist';
const REGISTRY = 'content/slugs.json';
const MANIFEST_CANDIDATES = [`${DIST}/.vite/manifest.json`, `${DIST}/manifest.json`];

type Link = { title: string; url: string };

function main(): void {
  const buildDate = new Date().toISOString().slice(0, 10);

  const manifestPath = MANIFEST_CANDIDATES.find(existsSync);
  if (!manifestPath) {
    throw new Error(`seo: no Vite manifest at ${MANIFEST_CANDIDATES.join(' or ')} — run vite build first.`);
  }
  const cssHref = cssHrefFromManifest(readFileSync(manifestPath, 'utf8'));

  const snapshot = JSON.parse(readFileSync('src/data/seoCatalog.json', 'utf8')) as SeoCatalogSnapshot;
  const { products, curated } = selectPages(snapshot.items);

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

  const emitted = [...productLinks, ...curatedLinks];

  mkdirSync(`${DIST}/things-to-do`, { recursive: true });
  writeFileSync(
    `${DIST}/things-to-do/index.html`,
    renderIndexPage({ entries: emitted, cssHref, buildDate }),
  );

  const entries = [
    ...publicRouteEntries(buildDate),
    { loc: `${ORIGIN}/things-to-do/`, lastmod: buildDate },
    ...emitted.map((e) => ({ loc: ORIGIN + e.url, lastmod: buildDate })),
  ];
  writeFileSync(`${DIST}/sitemap.xml`, renderSitemap(entries));
  writeFileSync(`${DIST}/llms.txt`, renderLlmsTxt([{ heading: 'Things to do in Aruba', links: emitted }]));

  console.log(`seo: ${productLinks.length} product + ${curatedLinks.length} curated pages + index, ${entries.length} sitemap urls, css ${cssHref}`);
}

function writePage(slug: string, html: string): void {
  const dir = `${DIST}/things-to-do/${slug}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/index.html`, html);
}

/**
 * Substitute the beacon's placeholder. The replacement goes through a function
 * so a URL containing `$&` or `$1` is inserted literally rather than being read
 * as a String.replace pattern.
 */
function withCollectUrl(html: string, collectUrl: string | null): string {
  return html.replaceAll('__COLLECT_URL__', () => collectUrl ?? '');
}

/**
 * Three related links per page, from the cluster data the engine already
 * computes: items sharing an experience_cluster_id are the same real-world
 * experience.
 *
 * The i+1 neighbour is always among them, and that is load-bearing rather than
 * filler: it makes the pages a cycle, so every page has an inbound link. Taking
 * three cluster-mates instead would leave the fifth member of a large cluster
 * linked from nowhere, since every member links the same first three.
 */
function pickRelated(
  item: SeoCatalogItem,
  all: SeoCatalogItem[],
  mustSlug: (id: string) => string,
  index: number,
): Link[] {
  const sameCluster = item.experience_cluster_id
    ? all.filter((o) => o.id !== item.id && o.experience_cluster_id === item.experience_cluster_id)
    : [];
  const neighbours = [all[(index + 1) % all.length], all[(index + 2) % all.length]]
    .filter((o) => o && o.id !== item.id);
  const picked = [...sameCluster.slice(0, 2), ...neighbours]
    .filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i)
    .slice(0, 3);
  return picked.map((o) => ({ title: o.title, url: urlFor(mustSlug(o.id), 'things-to-do') }));
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
