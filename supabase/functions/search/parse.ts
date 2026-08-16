// Layer 2 — turning arbitrary text into the closed vocabulary the filter uses.
//
// This replaces a hand-written alias table of ~60 words, which was measured on
// 2026-08-16 against the 25-query golden set: 6 compiled, 19 were no-ops, and
// both negation cases the architecture exists to fix produced nothing. A closed
// vocabulary on the OUTPUT side is required — the filter can only act on facets
// the catalog actually carries. A closed vocabulary on the INPUT side was the
// bug, and this is the fix: any string in, a fixed set of concepts out.
//
// PRIVACY. The traveller's words are already sent to this same provider on every
// semantic search — `embedBatch` receives the string, not a hash, and
// Privacy.tsx names OpenAI as the US sub-processor for search-by-meaning on a
// Contract basis. So this changes what the provider DOES with a string it
// already receives, not whether it receives it. What genuinely changes is that
// the cached artifact becomes legible: a vector is 256 opaque numbers, a
// constraint reads `{"mustNot":["boat"]}`. That is a real difference and
// Privacy.tsx says so explicitly rather than letting it ride on the old wording.
//
// The text is never logged. The parsed constraint may be — the same rule
// itinerary-edit follows, and the reason `[search]` has only ever printed a
// count.

/** The concepts a parse may emit. MUST stay identical to EMITTABLE_CONCEPTS in
 *  src/lib/searchConstraint.ts — a value the client cannot filter on is a claim
 *  nothing acts on, and every one of these is covered by the symmetric
 *  reachability guard in searchPool.test.ts. */
export const EMITTABLE = [
  'toddler', 'kids', 'accessible', 'easy', 'adventure', 'beach', 'boat', 'cheap',
  'swim', 'indoor', 'low_effort', 'teens',
] as const;

/**
 * What may be PERSISTED and what may be SENT: the closed vocabulary, nothing
 * else. Deliberately a separate type from ParsedConstraint so that storing the
 * traveller's words takes a deliberate act rather than an absent-minded spread.
 */
export type StoredConstraint = { must: string[]; mustNot: string[]; v?: number };

/**
 * Bump whenever the VOCABULARY or the prompt changes meaning.
 *
 * Not decoration. `low_effort` was added on 2026-08-16 and the conformance run
 * still showed the old parse for "parents who walk slowly", because the query
 * hash had not changed and a cached constraint is a cache HIT — a 30-day one.
 * A prompt is code; a cache of its output needs a version the way any other
 * derived artifact does. A stored row whose `v` differs is treated as a miss.
 */
export const PARSE_VERSION = 4;

export type ParsedConstraint = StoredConstraint & {
  /**
   * What is left for the embedder. Empty means: make no semantic call at all.
   *
   * IN-MEMORY ONLY, FOR THE LIFETIME OF ONE REQUEST. This is a subset of the
   * traveller's own words — and the whole query verbatim when nothing was
   * recognised, see sanitise() — so it must never be written to a column,
   * returned to the client, or logged. Never widen StoredConstraint to include
   * it.
   */
  residual: string;
};

/**
 * The ONLY way a constraint may leave this function — to the database or to the
 * browser. One named place, because the alternative is remembering, and
 * remembering already failed once: the constraint was persisted whole, which put
 * the traveller's own words in a column for 30 days under a comment that said
 * "the text is never written". A test asserts this drops the residual.
 */
export const forStorage = (c: ParsedConstraint): StoredConstraint =>
  ({ must: c.must, mustNot: c.mustNot, v: PARSE_VERSION });

const MODEL = 'gpt-5-mini';
// MEASURED, not guessed. The first value here was 2500 and it was a guess, which
// showed up as the feature barely working: on 2026-08-16 eight of eleven
// conformance queries reported "(no parse)" while the same queries parsed fine
// by hand. Timed against the real endpoint: 4.1s, 5.1s, 8.2s for three ordinary
// queries. Every one of those was silently falling back to today's behaviour.
//
// 9s is chosen to clear that band rather than to feel fast. It is affordable
// because the parse does NOT block the page: the substring layer renders
// locally on every keystroke and the semantic tail is appended when it arrives,
// which is what `pending` in useSearchBox already exists to show. And it is paid
// per NEW PHRASING, not per search — the constraint caches for 30 days beside
// the vector, against 31 distinct queries measured lifetime.
//
// The fallback remains the point: past this the search is better served by
// ranking with no constraint than by waiting, and that is today's behaviour
// rather than an error state.
const TIMEOUT_MS = 9000;

const SYSTEM = `You turn a traveller's search query for an Aruba trip planner into a structured constraint.

You may only use these concepts, and nothing else:
  toddler     suitable for a 1-3 year old
  kids        suitable for children generally
  accessible  someone with limited mobility could do it
  easy        gentle, low effort, relaxed
  adventure   high intensity, adrenaline
  beach       happens on or at a beach
  boat        the traveller is aboard a vessel
  cheap       inexpensive
  swim        the traveller must get INTO the water
  indoor      there is a roof over the main part of it
  low_effort  physically undemanding — little walking, little stamina, no climbing
  teens       a bored 13-17 year old would actually enjoy it

must    = concepts the results MUST have.
mustNot = concepts the results must NOT have.

Negation is expressed by putting a concept in mustNot, never by inventing an opposite. "We get seasick" is mustNot: ["boat"]. "No walking, we are tired" is must: ["low_effort"], NOT "easy". The concept "easy" is about how calm or thrilling something FEELS; "low_effort" is about what the body has to DO. A gentle sunrise horseback ride is easy and is not low_effort. When someone describes a BODY — tired, walks slowly, bad knees, elderly parents — they mean low_effort. And when the description is about MOBILITY rather than stamina — walks slowly, uses a stick, bad knees, a wheelchair, elderly parents — emit BOTH low_effort AND accessible. Those are different facts about an activity: a short boat trip can be low_effort and still require climbing a ladder to board. Someone who told you how their parents walk needs both to be true. "See fish but not swim" is mustNot: ["swim"]. "Something indoors for a rainy afternoon" is must: ["indoor"].

residual is the part of the query NOT captured by the concepts, which will be matched by meaning against the catalog. Strip the words the concepts already cover, and strip filler. "Cheap dinner with live music" leaves residual "dinner live music" with must: ["cheap"]. If the concepts capture the whole query, residual is an empty string.

BE CONSERVATIVE. A wrong constraint removes activities a traveller wanted and they never learn what they missed, while a missing one only leaves the search as good as it is today. If a concept is not clearly asked for, leave it out. A place name — "Arikok", "Baby Beach", "De Palm Island" — is NOT a concept: emit nothing and return it as the residual, because a proper noun is served better by exact matching than by any filter.`;

const SCHEMA = {
  type: 'object',
  properties: {
    must:     { type: 'array', items: { type: 'string', enum: [...EMITTABLE] } },
    mustNot:  { type: 'array', items: { type: 'string', enum: [...EMITTABLE] } },
    residual: { type: 'string' },
  },
  required: ['must', 'mustNot', 'residual'],
  additionalProperties: false,
};

/**
 * Parse, or return null and let the caller behave exactly as it does today.
 *
 * EVERY failure path returns null: no key, a timeout, a non-200, malformed JSON,
 * a concept outside the vocabulary. The spec's promise is that search never gets
 * WORSE than it is now — it declines to a known state — and that promise is only
 * as good as this function's refusal to throw.
 */
export async function parseConstraint(text: string): Promise<ParsedConstraint | null> {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return null;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }],
        response_format: { type: 'json_schema', json_schema: { name: 'constraint', strict: true, schema: SCHEMA } },
      }),
    });
    if (!r.ok) {
      // Status only. An error body from a provider can quote the input back, and
      // the input is the one thing that must never reach a log.
      console.warn(`[search] parse failed: ${r.status}`);
      return null;
    }
    const body = await r.json();
    const raw = body?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') return null;
    return sanitise(JSON.parse(raw), text);
  } catch (e) {
    console.warn(`[search] parse failed: ${e instanceof Error ? e.name : 'error'}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Trust the schema, verify anyway.
 *
 * `strict: true` should make an out-of-vocabulary concept impossible, and the
 * filter's whole safety story rests on that being true rather than assumed —
 * one bad value is an exclusion nobody can see. A concept in BOTH lists is
 * dropped from both: it is a contradiction, and guessing which half was meant is
 * how a filter removes things nobody asked to remove.
 */
export function sanitise(raw: unknown, original: string): ParsedConstraint | null {
  const o = raw as Partial<ParsedConstraint>;
  if (!o || !Array.isArray(o.must) || !Array.isArray(o.mustNot)) return null;
  const ok = (c: unknown): c is string => typeof c === 'string' && (EMITTABLE as readonly string[]).includes(c);
  let must = [...new Set(o.must.filter(ok))];
  let mustNot = [...new Set(o.mustNot.filter(ok))];
  const both = must.filter((c) => mustNot.includes(c));
  if (both.length) {
    must = must.filter((c) => !both.includes(c));
    mustNot = mustNot.filter((c) => !both.includes(c));
  }
  const residual = typeof o.residual === 'string' ? o.residual.trim() : original;
  // Nothing recognised means nothing claimed: hand the whole query back, which
  // is precisely today's behaviour rather than an empty pool.
  if (!must.length && !mustNot.length) return { must: [], mustNot: [], residual: original };
  return { must, mustNot, residual };
}
