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
import { writeFileSync } from 'node:fs';
import { loadCatalog } from '../src/data/activitySource';
import type { SeoCatalogItem } from '../src/seo/catalog';

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

  items.sort((a, b) => a.id.localeCompare(b.id));   // stable diffs

  const missingAffiliate = items.filter(
    (i) => i.viator_item_url && !(i.viator_item_url.includes('pid=') && i.viator_item_url.includes('mcid=')),
  );
  if (missingAffiliate.length) {
    console.error(`\nWARNING: ${missingAffiliate.length} products have a URL without pid/mcid:`);
    for (const i of missingAffiliate.slice(0, 5)) console.error(`  ${i.id}  ${i.viator_item_url}`);
    console.error('These will be REFUSED a page by the generator (tools/build-seo.ts).\n');
  }

  writeFileSync(OUT, JSON.stringify({ measured: new Date().toISOString().slice(0, 10), items }, null, 1) + '\n');
  console.log(`wrote ${OUT}: ${items.length} items`);
}

void main();
