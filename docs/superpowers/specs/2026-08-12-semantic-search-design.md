# Semantic search — enable checklist and what shipped

**Date:** 2026-08-12
**Status:** Implemented behind `VITE_SEMANTIC_SEARCH` (default off)
**PRD:** `tasks/prd-semantic-search.md`

## What shipped

| Piece | Where |
|---|---|
| `item_embeddings` + `query_embeddings` + `search_items()` | `supabase/migrations/20260812090000_item_embeddings.sql` |
| Vectors written at ingest instead of discarded | `supabase/functions/viator-cards/index.ts` |
| Query embedding, cache, ranking | `supabase/functions/search/index.ts` |
| Client library behind the flag | `src/lib/semanticSearch.ts` (+ tests) |
| Keyword-first blending | `blendSearchResults` in `src/data/exploreItems.ts` (+ tests) |
| Armed-on-space UI | `src/pages/Explore.tsx`, `.search-arm-hint` in `src/index.css` |
| Golden set + runner | `tools/search-golden.json`, `tools/run-search-golden.cjs` |

Verified in the browser, flag on and flag off:

- `Zeerover` (one word) → **zero** network requests, 1 result.
- `good with a toddler` → hint appears, **still zero** requests.
- Enter → **exactly one** request; on failure the hint becomes *"Couldn't search by meaning just now — keyword results still below."* and keyword results are untouched.
- Flag off → hint never renders, Enter issues no request, substring search unchanged.

## Enable checklist

Nothing below is optional, and the order matters.

1. **Apply the migration.** `supabase db push`, then confirm the `vector` extension is
   enabled, `item_embeddings_hnsw_idx` exists, and both `purge-old-query-embeddings` and
   `purge-old-edit-requests` are scheduled in `cron.job`.
2. **Deploy the functions.** `search` is new; `viator-cards` has changed and must be
   redeployed or it will keep discarding the vectors.
3. **Set the function secrets:** the embedding provider key (`OPENAI_API_KEY`) and
   `RATE_LIMIT_SALT`. Both fail closed — `search` returns 500 without either.
4. **Force a catalog refresh** so `item_embeddings` is populated. The cache has a 6h TTL;
   until it expires and rebuilds, the table is empty and every search returns nothing.
   Confirm `select count(*) from item_embeddings` matches the item count in the live
   `viator-cards` payload — do not hardcode a number here; the catalog moves (the project
   memory records 361 items on 2026-08-02, a drift check measured 328 on 2026-08-11).
5. **Run the golden set.** `node tools/run-search-golden.cjs`. Target ≥80% recall. This is
   also how `MIN_SIMILARITY` gets tuned — the shipped value of `0.20` is a **starting
   point, not a measurement**.
6. **Re-read the Privacy Policy** against what actually shipped. It already names the
   embedding provider and the query-text flow (added 2026-08-11) — check it still matches.
7. ~~Add `search` to the data-flow block in `.claude/CLAUDE.md`~~ — **done 2026-08-12**,
   in the same commit as the feature. Re-read it rather than redo it.
8. Only then: `VITE_SEMANTIC_SEARCH=true` in `.env.production`.

## Known gaps, recorded rather than hidden

- **`MIN_SIMILARITY = 0.20` is unmeasured.** Too low pads results with noise; too high
  recreates the empty page the feature exists to fix. Step 5 is how it gets a real value.
- **Voyage is unsupported.** It produces 512 dimensions against a `vector(256)` column, so
  `viator-cards` skips the write and `search` returns 503 rather than ranking on a
  mismatch — which would be confident nonsense, not an error.
- **Semantic search is worse than substring on proper nouns.** Similarity blurs exactly the
  rare exact tokens that make a name a name. This is why `blendSearchResults` puts keyword
  hits first, and why the keyword layer is permanently load-bearing rather than a
  transitional fallback. The golden set's `mustNotRankFirst` guards it.
- **The embedded text may be too long.** `viator-cards` embeds
  `${title}. ${description}` truncated to 500 characters. Long prose tends to embed to a
  bland, generic position — fine for spotting duplicates, mediocre for search. If golden-set
  recall is poor, a trimmed description is the first thing to try, and it means re-embedding
  the catalog.
- **Nobody has checked whether the search box is used.** Worth a glance at PostHog before
  investing further.
- **Latency is unmeasured.** The armed-Enter interaction was designed around an assumption
  that an embedding round trip is too slow for as-you-type. That assumption is almost
  certainly right and is still an assumption.

## Why the space bar arms rather than switches

One word is nearly always a name or a noun; substring matching answers those instantly,
locally, and for free. Two or more words is where people describe intent, and that is the
only case worth a network round trip.

Arming rather than switching matters because `baby beach` and `san nicolas` are two-word
*keyword* searches. Under a hard switch they would go blank until Enter. Under arming they
keep working live and Enter merely adds to them.

Net effect: one request per deliberate multi-word search, and none at all for what is
probably the majority of searches.
