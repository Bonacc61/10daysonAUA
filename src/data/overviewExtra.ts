import SNAPSHOT from './overviewExtra.json';

/**
 * A second block of the operator's own Overview text, for the 89 of 366 products
 * that have one.
 *
 * WHY IT EXISTS. The catalog carries `description`, which Viator's own docs call
 * the overview — and for most products that is exactly what their page shows.
 * For a minority it is not: on 472918P1 ("Award-Winning Private Turtle
 * Snorkeling") the rendered page shows `itinerary.activityInfo.description`
 * instead, so a card faithfully reproducing `description` still did not match
 * the page a traveller had open in the next tab. That is how this was found.
 *
 * `/products/search` — which builds the catalog — does not return `itinerary` at
 * all, so the catalog structurally cannot carry this. Only the per-product
 * detail call has it, which is why it arrives as a committed snapshot from
 * `node tools/probe-reviews.cjs`.
 *
 * Where both exist they DIFFER rather than duplicate (2 of 2 sampled), so the
 * card shows both: whichever one the page happens to render, the traveller finds
 * it. Neither is paraphrased — both are the operator's words.
 */
const DATA: Record<string, string> = SNAPSHOT as Record<string, string>;

export function overviewExtraFor(id: string): string {
  return DATA[id] ?? '';
}
