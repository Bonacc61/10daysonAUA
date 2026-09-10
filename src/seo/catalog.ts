// The shape of src/data/seoCatalog.json, and the rule for carrying it forward.
//
// Only the fields a generated page actually needs. Deliberately not the whole
// ViatorItem: the snapshot is committed, so every unused field is diff noise on
// every refresh.

export type SeoCatalogItem = {
  /** Viator product code. Also the key into every committed snapshot. */
  id: string;
  title: string;
  image_url: string;
  viator_item_url: string;
  duration: string;
  price_usd: number;
  review_count: number;
  experience_cluster_id?: string;
  tags?: number[];
  sections?: string[];
  /**
   * Set by `seo:refresh` when a previously-snapshotted product is absent from
   * the live catalog. The item is RETAINED rather than deleted: its page keeps
   * its URL, loses its booking link, and leaves the sitemap. Deleting the row
   * would 404 an indexed page and discard every signal pointing at it.
   */
  gone?: true;
};

export type SeoCatalogSnapshot = {
  /** ISO date the snapshot was taken, for the page's freshness line. */
  measured: string;
  items: SeoCatalogItem[];
};

/**
 * The next snapshot's items: everything the catalog still returns, plus
 * everything a previous snapshot held that it no longer does, flagged `gone`.
 *
 * Retention rather than deletion, because `dist/` is gitignored, rebuilt from
 * scratch on every deploy and mirrored with `--delete`: dropping the row here
 * is what turns an indexed URL into a hard 404 two steps later. An item's
 * last-known title and image are exactly what its page needs in order to keep
 * existing at the URL Google already knows.
 *
 * A product that comes BACK loses the flag, because `live` is rebuilt from the
 * catalog response rather than patched over the row it replaces.
 */
export function mergeSnapshotItems(
  live: SeoCatalogItem[],
  previous: SeoCatalogItem[],
): SeoCatalogItem[] {
  const liveIds = new Set(live.map((i) => i.id));
  const retained = previous
    .filter((i) => !liveIds.has(i.id))
    .map((i) => ({ ...i, gone: true as const }));
  return [...live, ...retained].sort((a, b) => a.id.localeCompare(b.id));
}
