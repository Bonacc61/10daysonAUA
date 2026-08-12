// Search by meaning — the client half.
//
// Gated on VITE_SEMANTIC_SEARCH. With the flag unset nothing here reaches the
// network, which is how the feature ships merged but dark while the Privacy
// Policy entry and the sub-processor question are settled. A search box is free
// text, and free text is where personal data turns up.
//
// This never replaces substring search. Explore runs that locally on every
// keystroke and puts its hits first; these results are appended below. Cosine
// similarity blurs exactly the distinctions proper nouns depend on, so someone
// typing "Arikok" or "De Palm Island" is better served by the substring layer —
// which makes it permanently load-bearing, not a transitional fallback.

const FN_URL = import.meta.env.VITE_SEARCH_FN_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const MAX_QUERY_CHARS = 200;   // mirrors the edge function's cap

/** Read at call time rather than module load, so a test can vary the flag. */
export function semanticSearchEnabled(): boolean {
  return import.meta.env.VITE_SEMANTIC_SEARCH === 'true' && Boolean(FN_URL) && Boolean(ANON);
}

export function normaliseQuery(q: string): string {
  return q.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
}

/**
 * Pull item ids out of a response body.
 *
 * Returns `null` for anything that is not a well-formed result set, and `[]`
 * only for a genuine empty one. The caller needs that distinction: "we searched
 * and found nothing" and "the search did not happen" are different things to
 * tell a traveller, and collapsing them into `[]` makes the second one a lie.
 */
export function parseSearchBody(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null;
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  return results
    .map((r) => (r && typeof r === 'object' ? (r as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export type SearchOutcome =
  | { ok: true; ids: string[] }    // searched; ids may legitimately be empty
  | { ok: false };                 // did not search — disabled, offline, refused, malformed

export async function searchByMeaning(query: string): Promise<SearchOutcome> {
  if (!semanticSearchEnabled()) return { ok: false };
  const q = normaliseQuery(query);
  if (!q) return { ok: false };

  try {
    const r = await fetch(FN_URL!, {
      method: 'POST',
      headers: {
        apikey: ANON!,
        Authorization: `Bearer ${ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: q }),
    });
    if (!r.ok) return { ok: false };
    const ids = parseSearchBody(await r.json());
    return ids === null ? { ok: false } : { ok: true, ids };
  } catch {
    return { ok: false };
  }
}
