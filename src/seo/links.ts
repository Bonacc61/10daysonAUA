// The two link decisions the generator makes: which pages the site advertises,
// and which alternatives a page offers its reader.
//
// Both used to live inside tools/build-seo.ts as control flow — a filter in a
// loop, and an array a departed page was simply never pushed into — and both
// were verified by nothing. A mutation offering a de-listed product as a "live
// alternative", and one advertising a retained page in sitemap.xml, each passed
// the entire suite. tools/ is not importable by a test (build-seo.ts runs
// main() on import), so the guarantees live here as pure functions that can be
// asserted on directly rather than inferred from the shape of a loop.

import { urlFor } from './slugs';
import type { SeoCatalogItem } from './catalog';

export type Link = {
  title: string;
  url: string;
  /**
   * The page is written but never advertised. A product that has left the
   * catalog keeps its URL as noindex — see src/seo/catalog.ts.
   */
  gone?: boolean;
};

/**
 * The links the site advertises: sitemap.xml, llms.txt and /things-to-do/.
 *
 * A retained page is deliberately in none of the three. A noindex URL inside a
 * sitemap is a contradiction Search Console reports as an error; listing a
 * de-listed product in the hub, or handing one to an answer engine, sends a
 * reader somewhere they cannot book. The page itself still exists at its URL,
 * which is the whole point of retaining it.
 */
export function advertised(links: Link[]): Link[] {
  return links.filter((l) => !l.gone);
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
 *
 * `!o.gone` is the clause src/seo/slugs.ts promises — "its page points at a
 * live alternative". These links are the only thing a departed page still has
 * to offer, so "here is somewhere else to go" must never resolve to another
 * dead product. main() happens to pass a live-only list today; this does not
 * rely on that.
 */
export function pickRelated(
  item: SeoCatalogItem,
  all: SeoCatalogItem[],
  mustSlug: (id: string) => string,
  index: number,
): Link[] {
  const sameCluster = item.experience_cluster_id
    ? all.filter((o) => o.id !== item.id && !o.gone && o.experience_cluster_id === item.experience_cluster_id)
    : [];
  const neighbours = [all[(index + 1) % all.length], all[(index + 2) % all.length]]
    .filter((o) => o && !o.gone && o.id !== item.id);
  const picked = [...sameCluster.slice(0, 2), ...neighbours]
    .filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i)
    .slice(0, 3);
  return picked.map((o) => ({ title: o.title, url: urlFor(mustSlug(o.id), 'things-to-do') }));
}
