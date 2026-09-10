// The shape of src/data/seoCatalog.json.
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
};

export type SeoCatalogSnapshot = {
  /** ISO date the snapshot was taken, for the page's freshness line. */
  measured: string;
  items: SeoCatalogItem[];
};
