/**
 * Snapshot the live catalog for the SEO generator.
 *
 * WHY A SNAPSHOT. `npm run build` runs on every push to main and deploys the
 * whole site. Fetching the catalog there would make every deploy depend on an
 * edge function responding — a new failure mode for a site that has none. So
 * this script is run BY HAND, its output is committed, and the build is offline
 * and deterministic. Same contract as the coordinate registry, the start-time
 * snapshot and reviewBreakdown.json.
 *
 * A side benefit: catalog drift arrives as a reviewable git diff instead of
 * silently changing what deploys.
 *
 *   npm run seo:refresh
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { loadCatalog } from '../src/data/activitySource';
import { mergeSnapshotItems } from '../src/seo/catalog';
import type { SeoCatalogItem, SeoCatalogSnapshot } from '../src/seo/catalog';

const OUT = 'src/data/seoCatalog.json';

async function main(): Promise<void> {
  const catalog = await loadCatalog();
  const items: SeoCatalogItem[] = catalog.items.map((i) => ({
    id: i.id,
    title: i.title,
    image_url: i.image_url,
    viator_item_url: i.viator_item_url,
    duration: i.duration,
    price_usd: i.price_usd,
    review_count: i.review_count,
    experience_cluster_id: i.experience_cluster_id,
    tags: i.tags,
    sections: i.sections,
  }));

  // `id` is the snapshot's key — src/seo/catalog.ts documents it as "the key
  // into every committed snapshot" — and later tasks key generated pages off
  // it 1:1. Viator has been observed to emit the same product code twice in a
  // single catalog response; if a duplicate reached the generator it would
  // build the same page twice and emit a duplicate <loc> in sitemap.xml. Drop
  // repeats here (first occurrence wins) rather than downstream, and warn
  // loudly rather than paper over it — a duplicate this far upstream is a bug
  // worth someone noticing, in loadCatalog() or the edge function itself.
  const seen = new Set<string>();
  const deduped: SeoCatalogItem[] = [];
  const duplicateIds: string[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      duplicateIds.push(item.id);
      continue;
    }
    seen.add(item.id);
    deduped.push(item);
  }
  if (duplicateIds.length) {
    console.error(`\nwarning: dropped ${duplicateIds.length} duplicate item(s) from the catalog: ${duplicateIds.join(', ')}\n`);
  }

  const missingAffiliate = deduped.filter(
    (i) => i.viator_item_url && !(i.viator_item_url.includes('pid=') && i.viator_item_url.includes('mcid=')),
  );
  if (missingAffiliate.length) {
    console.error(`\nWARNING: ${missingAffiliate.length} products have a URL without pid/mcid:`);
    for (const i of missingAffiliate.slice(0, 5)) console.error(`  ${i.id}  ${i.viator_item_url}`);
    console.error('These will be REFUSED a page by the generator (tools/build-seo.ts).\n');
  }

  // MERGE, never overwrite. A product Viator stops returning must not simply
  // vanish from the snapshot: the generator would stop emitting its page, the
  // next deploy would mirror dist/ with --delete, and an indexed URL would
  // become a hard 404 — discarding every link and ranking signal pointing at
  // it. mergeSnapshotItems keeps it, flagged `gone`; tools/build-seo.ts then
  // keeps its URL alive, without a booking link and out of the sitemap.
  const previous: SeoCatalogItem[] = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, 'utf8')) as SeoCatalogSnapshot).items
    : [];
  const merged = mergeSnapshotItems(deduped, previous);   // sorted by id — stable diffs

  const retained = merged.filter((i) => i.gone);
  if (retained.length) {
    console.log(`retaining ${retained.length} product(s) no longer in the catalog:`);
    for (const i of retained) console.log(`  ${i.id}  ${i.title}`);
  }
  const returned = previous.filter((p) => p.gone && !merged.find((m) => m.id === p.id)?.gone);
  if (returned.length) {
    console.log(`${returned.length} previously-gone product(s) are back in the catalog: ${returned.map((i) => i.id).join(', ')}`);
  }

  writeFileSync(OUT, JSON.stringify({ measured: new Date().toISOString().slice(0, 10), items: merged }, null, 1) + '\n');
  console.log(`wrote ${OUT}: ${merged.length} items (${deduped.length} live, ${retained.length} gone)`);
}

void main();
