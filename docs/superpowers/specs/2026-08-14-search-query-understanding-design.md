# Search query understanding — design

**Date:** 2026-08-14
**Status:** Design only. Nothing built, nothing behind a flag yet.
**Scope:** Turn a search phrase into a *constraint object* before it is embedded, so that
exclusions are executed rather than approximated. Adds `src/data/searchConstraint.ts`, a
parse step inside the existing `supabase/functions/search`, and a filter pass in
`blendSearchResults`. **No change to what ranks the survivors** — embeddings keep that job.
Would ship behind the existing `VITE_SEMANTIC_SEARCH` flag, off by default until its own
checklist is worked.

## Problem

Semantic search is live and scores **66% recall against the 80% target its own golden set
declares** (intent 9/15, names 8/10). The shortfall is not spread evenly. It is almost
entirely **negation**:

| Query | Recall |
|---|---|
| `we get seasick` | **0/3** |
| `no walking, we are tired` | **1/3** |

Those two sentences drag the whole set down, and they fail for a structural reason rather
than a tuning one. An embedding of "we get seasick" sits *next to* boat trips, because the
vector encodes the topic and the word doing the excluding is one token among many. Cosine
similarity has no representation of "not".

Two measurements rule out the obvious knobs:

- **The similarity floor is not the lever.** `node tools/search-threshold-sweep.cjs` keeps
  the per-result scores the golden runner discards and recomputes recall at every floor.
  Recall falls monotonically from the deployed 0.20 upward — 65.0% at 0.20, 61.3% at 0.26,
  58.7% at 0.30, 32.0% at 0.45. Raising it only ever costs recall.
- **`MATCH_COUNT = 30` is what binds.** 24 of 25 queries came back full at 30, and the
  median lowest-scoring result returned was **0.335** — comfortably clear of the floor. On a
  typical query the cap cuts long before the floor engages.

So the ranker is not badly calibrated. It is being asked a question it cannot answer.

## Goal

Everything a traveller types is *understood* — not approximated. "We get seasick" removes
boats. "No walking, we are tired" removes hikes. "Something for the kids under $100" is
three constraints, not one fuzzy vector. And the cost of that holds at 5,000 unique visitors
a day.

## Approach — parse to a constraint, then rank inside it

The language model's only job is **free text → a value in a closed vocabulary**. It never
sees the catalog, never ranks, never returns an activity. This is exactly the contract
`itinerary-edit` already runs under, and the shape mirrors `EditConstraint`:

```ts
export type SearchConstraint = {
  /** Q8 flag ids to apply as hard exclusions: 'no-boats', 'mobility', 'no-car'. */
  exclude?: string[];
  /** Questionnaire interest tags to require. */
  interests?: MatchTag[];
  /** An explicit ceiling — "under $100". */
  maxPriceUsd?: number;
  /** A named part of the island. */
  region?: Region;
  /** Time of day, where the phrase names one. */
  slot?: 'morning' | 'afternoon' | 'evening';
  /** What is left once the constraints are lifted out — the part worth embedding. */
  residual?: string;
};
```

`residual` is the important field. "No boats, something for the kids under $100" parses to
`{ exclude: ['no-boats'], interests: ['family-young-kids'], maxPriceUsd: 100, residual: '' }`
— and when the residual is empty there is **nothing to embed at all**. The query is answered
by filtering, for free, with no vector and no network call.

### Why not extend `notesFlags`

`src/data/notesFlags.ts` already maps "seasick" → `no-boats`, wheelchair → `mobility`, "no
car" → `no-car`. Wiring search into it would fix `we get seasick` today, cheaply, with
tested code. It is the right *tactical* patch and the wrong strategy: three regexes
understand three phrasings, and the next traveller writes "I can't be on the water" or "my
knees are bad". The file's own comment says its patterns are deliberately conservative
because a false exclusion is worse than a miss — which is correct, and is also why it will
never cover the long tail.

**Recommendation: do both.** Ship the `notesFlags` pass first — it is a few lines, it is
already tested, and it converts the worst golden-set case from 0/3 to something. Then build
the parser behind it, with `notesFlags` as the offline fallback when the parse fails or the
budget ceiling is hit. The regexes become the floor, not the ceiling.

## Cost at 5,000 visitors/day

The concern is real and the answer is caching, which the search function already does for
embeddings: `query_embeddings` stores a **hash** of the phrase and its vector for 30 days,
and the text is never written.

The same table pattern takes a `constraint` column. Then:

- Travellers converge hard on the same phrases — "snorkel", "with kids", "no boats". A few
  hundred distinct queries a day is a realistic ceiling; everything else is a cache hit
  costing nothing.
- A parse is a small structured call. Budget **a few hundred cheap LLM calls a day**, not
  5,000 — and each cached parse serves every later traveller who phrases it the same way.
- Queries with an empty residual get *cheaper* than today, because they skip the embedding
  call entirely.

**Measure before believing this.** The number to check is distinct-queries-per-day, and we
do not have it: there is no analytics on the search box today (roadmap item 2), and
`search` logs only a result count, never the words — correctly. So the honest sequence is:
ship the constraint parse behind a per-day ceiling, log **counts** of parse/cache-hit/skip,
and read the ratio before committing to it.

## What stays exactly as it is

- **Embeddings still rank.** Constraints decide who is eligible; cosine similarity orders
  the survivors. This is the half that works.
- **`itemSlotOk` is untouched.** Search constraints are a suggestion path, and tightening
  the display path re-faces cards inside already-shared itineraries.
- **Keyword results keep priority.** `blendSearchResults` appends semantic hits below
  substring ones, so a bad parse costs a mediocre suggestion, not a wrong page.

## The GDPR half, which gates all of it

This sends a traveller's own words to a US sub-processor. That makes shipping it a legal
decision, not a technical one — the same bar as `VITE_NL_EDIT` and `VITE_SEMANTIC_SEARCH`.
Before any flag flips:

1. **Anthropic is already a documented sub-processor** for `itinerary-edit`; confirm the
   Privacy Policy's wording covers a second feature sending the same class of text.
2. **Never log the words.** `search` logs a result count; the parser must log the parsed
   *constraint* and nothing else — the rule `itinerary-edit` already follows.
3. **The cache stores a hash, never the phrase**, exactly as `query_embeddings` does today.
4. **Retention** on any new column matches the 30 days already set for query embeddings.
5. **A row in the "Data we collect" table** if the shape of what is sent changes.

## Open questions

- **Does the parse beat the embedding on the name queries?** Names score 8/10 today. A
  parser that mangles "Zeerover" into a constraint would make things worse; the residual
  path has to be conservative about proper nouns.
- **What happens to a query that parses to nothing?** Probably unchanged behaviour — embed
  the whole phrase, as today. That should be the default, not a special case.
- **Is `MATCH_COUNT` worth raising alongside?** It is what binds recall. Raising it is one
  constant, but `blendSearchResults` caps nothing, so every extra result lands below the
  keyword hits and 60 doubles the scroll. That is a product call, and it should be made
  with a number: what recall does 45 or 60 buy on the golden set?

## What would make this not worth doing

If the distinct-query count turns out to be in the thousands per day rather than the
hundreds, the cache stops absorbing the cost and this becomes a per-search LLM call. At that
point the `notesFlags` pass plus a raised `MATCH_COUNT` is the whole of the sensible answer,
and the parser should be dropped rather than budgeted for.
