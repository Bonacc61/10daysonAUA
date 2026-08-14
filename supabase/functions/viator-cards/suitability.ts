// What the search corpus says about WHO a product suits.
//
// Semantic search embeds a product's text and ranks queries against it. That
// text was title + marketing description, which describes what you DO and never
// who it is FOR — so a suitability query ("good with a toddler") landed in an
// empty region of the space and ranked whatever block of near-identical
// listings was largest. Measured 2026-08-14: only 94 of 328 products mentioned
// age, children or access at all; appending the lines below takes it to 326.
// See docs/superpowers/specs/2026-08-14-search-corpus-suitability-design.md.
//
// Everything here is Viator's own standardised string or a number rendered from
// its own age bands. Nothing is generated, inferred or paraphrased, so there is
// no hallucination surface — and because the result is EMBEDDED and never
// rendered, a mistake costs ranking quality rather than misleading a traveller.
//
// Pure and dependency-free on purpose: the ingest (Deno) and the snapshot
// builder (Node, via tools/) both import it, and vitest can test it directly.

export type AgeBand = { ageBand?: string; startAge?: number };

// A line is kept only if it speaks to suitability. `additionalInfo` mixes that
// with pure logistics — refund policy, pickup windows, cruise-line booking
// instructions — which would add ~200 products' worth of identical boilerplate
// to the corpus and blur exactly the distinctions this exists to sharpen.
const SUITABILITY = [
  /infants?|children|child\b|stroller|pram/i,
  /minimum age|age restriction|years old|\bheight\b/i,
  /wheelchair|mobility/i,
  /physical fitness|fitness level/i,
  /service animals?/i,
  /not recommended for|not suitable for|motion sickness|maximum weight/i,
];

/** Keep the `additionalInfo` lines that say who a product suits, in order, without duplicates. */
export function suitabilityLines(info: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of info) {
    const line = raw.trim();
    if (!line || seen.has(line)) continue;
    if (!SUITABILITY.some((re) => re.test(line))) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/**
 * An age floor, stated only when the bands actually carry one.
 *
 * The trap this guards is the catalog's most expensive false friend: 67 of 328
 * products price with a single `ADULT 0-99` band, reporting a minimum age of 0
 * while being adults-only in practice. Four of the five UTV rentals at the top
 * of the failing query do exactly that. A floor of 0 is a billing artifact, not
 * a welcome, so it is reported as nothing at all.
 */
export function ageSentence(bands: AgeBand[]): string {
  const age = (b: AgeBand) => (typeof b.startAge === 'number' ? b.startAge : null);

  const child = bands
    .filter((b) => b.ageBand === 'CHILD' || b.ageBand === 'INFANT')
    .map(age)
    .filter((n): n is number => n !== null);
  if (child.length) return `Children welcome from age ${Math.min(...child)}.`;

  const rest = bands.map(age).filter((n): n is number => n !== null);
  if (!rest.length) return '';
  const floor = Math.min(...rest);
  if (floor <= 0) return '';
  return `Adults only, from age ${floor}.`;
}

/** One product's suitability profile — what the committed snapshot stores. */
export function suitabilityProfile(info: string[], bands: AgeBand[]): string {
  const parts = [...suitabilityLines(info), ageSentence(bands)]
    .map((s) => s.trim().replace(/\.+$/, ''))
    .filter(Boolean);
  return parts.length ? `${parts.join('. ')}.` : '';
}

// Generous, because the cost of a longer text is rounding error (~$0.001 per
// full catalog refresh) and the cost of truncation is a silently worse corpus.
// Measured composed length: median 667, p90 1027, max 1067.
export const SEARCH_TEXT_MAX = 1400;

/**
 * The text the SEARCH corpus embeds.
 *
 * The description is what gets cut when the budget binds — never the profile.
 * Appending the profile last and slicing the result would remove precisely the
 * part that makes a suitability query answerable, silently, and only on the
 * longest listings. That is the failure mode the old shared `.slice(0, 500)`
 * had: harmless while descriptions were ~190 chars, it truncated 228 of 328
 * products the day they grew to ~610.
 */
export function searchText(
  title: string,
  description: string,
  profile: string,
  maxChars: number = SEARCH_TEXT_MAX,
): string {
  const head = `${title}. `;
  const tail = profile ? ` ${profile}` : '';
  const budget = maxChars - head.length - tail.length;
  if (budget <= 0) return `${title}.${tail}`.slice(0, maxChars);
  return `${head}${description.slice(0, budget)}${tail}`;
}
