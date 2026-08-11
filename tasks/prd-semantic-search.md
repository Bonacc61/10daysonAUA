# PRD: Semantic search in Explore

**Date:** 2026-08-11
**Status:** Ready for implementation
**Related:** `docs/superpowers/specs/2026-08-11-natural-language-edit-design.md` (same closed-vocabulary/flag/privacy pattern), `docs/superpowers/specs/2026-08-11-catalog-enrichment-design.md` (same tool-proposes-human-accepts pattern)

## Introduction

Explore's search box does substring matching — `.includes()` over each entry's title,
description and location (`filterExploreEntries`, `src/data/exploreItems.ts:253`). It is exact
and unforgiving: it answers "Zeerover" and "turtles", and returns an empty page for "good with
a toddler", "something when it rains" or "not too touristy".

The catalog already has what it needs to answer those. `viator-cards` computes an embedding for
every product at ingest (`supabase/functions/viator-cards/embeddings.ts`), uses it to cluster
duplicate experiences, and **throws it away** — no migration stores one. This feature keeps
them, and adds a query-side embedding so a traveller's phrasing can be matched against product
meaning rather than product spelling.

Substring search is not replaced. It is instant, offline and correct for names; semantic
results are appended below it.

## Goals

- A multi-word intent query ("good with a toddler") returns relevant activities instead of an empty page.
- Single-word queries stay instant and make **zero** network requests.
- Exact substring matches always rank above semantic matches.
- Semantic search failing (network, rate limit, no provider) is invisible: search still works.
- No embedding vector ever reaches the browser.
- Ships dark behind `VITE_SEMANTIC_SEARCH`, like the natural-language swap box.

## User Stories

### US-001: Store product embeddings in Postgres
**Description:** As a developer, I need the embeddings that ingest already computes to be persisted, so search can rank against them.

**Acceptance Criteria:**
- [ ] Migration enables the `vector` extension and creates `public.item_embeddings` (`item_id text primary key`, `embedding vector(256)`, `model text not null`, `updated_at timestamptz not null default now()`)
- [ ] An HNSW index on `embedding` using `vector_cosine_ops`
- [ ] RLS enabled with **no** anon policy — service role only, matching `catalog_cache`
- [ ] `model` column records which embedding model produced the row (see US-002 — a vector is only comparable to another from the same model)
- [ ] Migration is idempotent (`create ... if not exists`) and applies cleanly to a fresh database
- [ ] Typecheck passes

### US-002: Write embeddings at ingest instead of discarding them
**Description:** As a developer, I need `viator-cards` to persist the vectors it already computes, so the table stays in step with the catalog.

**Acceptance Criteria:**
- [ ] After clustering, `viator-cards` upserts one row per item into `item_embeddings` with the vector and the active model id
- [ ] Upsert is keyed on `item_id`; a re-ingest updates rather than duplicating
- [ ] **Only writes when the active provider is the 256-dimension one** (`text-embedding-3-small`). If `activeProvider()` returns `voyage` (512 dims), skip the write and log a warning — a 512-vector cannot go in a 256 column, and mixing models in one table makes cosine meaningless
- [ ] A write failure is non-fatal: the catalog response is unaffected, matching how `writeCache` already behaves
- [ ] Rows for products no longer in the catalog are deleted in the same pass, so the table cannot grow without bound
- [ ] Typecheck passes

### US-003: `search` edge function — embed the query, rank the catalog
**Description:** As a traveller, I want my typed phrase matched against what activities actually are, so I get results when my words don't appear in any listing.

**Acceptance Criteria:**
- [ ] New `supabase/functions/search/index.ts`, JWT verification ON (anon key required), matching `viator-cards`
- [ ] Accepts `POST { query: string }`, rejects empty and anything over 200 characters with 400
- [ ] Embeds the query with **the same model recorded in `item_embeddings.model`**; if they disagree, return 503 rather than nonsense
- [ ] Returns `{ results: [{ id, score }] }`, at most 30, ordered by cosine similarity descending
- [ ] Results below a similarity floor are dropped rather than padded — an irrelevant answer is worse than none
- [ ] **Never logs the query text.** The result count may be logged; the words may not
- [ ] Rate limited per caller and globally, reusing the `edit_requests` pattern from `itinerary-edit` (hashed IP + salt, fail closed without the salt)
- [ ] Returns 502 on provider failure; no partial or invented results

### US-004: Client search library behind a flag
**Description:** As a developer, I need a single place that decides whether semantic search is available and calls it, so the UI has no knowledge of the transport.

**Acceptance Criteria:**
- [ ] New `src/lib/semanticSearch.ts` exporting `semanticSearchEnabled: boolean` and `searchByMeaning(query): Promise<string[]>` (item ids, best first)
- [ ] `semanticSearchEnabled` is true only when `VITE_SEMANTIC_SEARCH === 'true'` **and** the function URL **and** the anon key are all present
- [ ] Every failure path returns an empty array rather than throwing — never surfaces an error to the traveller
- [ ] `.env.example` documents `VITE_SEMANTIC_SEARCH` (default `false`) and `VITE_SEARCH_FN_URL`
- [ ] Unit tests cover: flag off returns empty without fetching; malformed response returns empty; non-2xx returns empty
- [ ] Typecheck passes

### US-005: Blend semantic results below substring results
**Description:** As a traveller, I want a name search to still put that exact thing first, so meaning-matching never gets in the way of knowing what I want.

**Acceptance Criteria:**
- [ ] New pure function `blendSearchResults(substringHits, semanticIds, catalog)` in `src/data/exploreItems.ts`
- [ ] Substring hits keep their current relative order and appear first
- [ ] Semantic-only ids follow, in the order the function returned them
- [ ] An id appearing in both appears **once**, in the substring block
- [ ] Empty semantic list returns the substring hits unchanged — byte-identical to today's behaviour
- [ ] Unit tests for each rule above, including the dedup case
- [ ] Typecheck passes

### US-006: Arm semantic search on the space bar
**Description:** As a traveller, I want single-word searches to stay instant and free, and multi-word phrases to search by meaning when I ask them to.

**Acceptance Criteria:**
- [ ] While the query contains no space: substring only, live on every keystroke, no network request
- [ ] Once the query contains a space: a hint appears — "press Enter to search by meaning" — and semantic search becomes available but does **not** fire
- [ ] Enter (or an explicit button) fires exactly one `searchByMeaning` call
- [ ] Substring results remain live throughout — arming never blanks or delays what is already on screen
- [ ] A pending semantic search shows a subtle in-progress state and cannot be double-fired
- [ ] With `VITE_SEMANTIC_SEARCH` off, the hint never renders and no code path calls the function
- [ ] Verify in browser using the dev-browser skill: type `Zeerover` (no request), type `good with a toddler` (hint appears, no request until Enter)

### US-007: Golden query set
**Description:** As a developer, I need evidence that the ranking is actually good before this is enabled.

**Acceptance Criteria:**
- [ ] `tools/search-golden.json` with ~25 queries and, for each, the ids or titles a good result set must contain
- [ ] Covers the three failing cases from the PRD intro plus name queries that must not regress
- [ ] Includes adversarial entries: an empty query, a 200-character query, and a prompt-injection attempt
- [ ] `tools/run-search-golden.cjs` runs it against the deployed function and prints recall per query
- [ ] **Not** part of `npm test` — it needs a deployed function and an API key; CI stays offline and free

### US-008: Enable checklist in the spec
**Description:** As the person flipping the flag, I need the non-code prerequisites written down where I'll look.

**Acceptance Criteria:**
- [ ] Privacy Policy already names the embedding provider and the query-text flow (**done 2026-08-11**) — verify it still matches what shipped
- [ ] `.claude/CLAUDE.md` data-flow block lists the `search` edge function
- [ ] Server secrets documented: embedding provider key, `RATE_LIMIT_SALT`
- [ ] Migration applied and the HNSW index confirmed present
- [ ] Golden set run and recall recorded

## Functional Requirements

- **FR-1:** The system must persist one embedding per catalog item, written at ingest, never returned to the browser.
- **FR-2:** The system must record which embedding model produced each stored vector.
- **FR-3:** The system must refuse to rank when the query model and the stored model differ.
- **FR-4:** The system must rank items by cosine similarity to the query embedding, returning at most 30 above a similarity floor.
- **FR-5:** The system must place exact substring matches above all semantic matches.
- **FR-6:** The system must not issue a network request for a query containing no space character.
- **FR-7:** The system must require an explicit submit (Enter or button) before issuing a semantic query.
- **FR-8:** The system must never log, store, or echo back the text of a search query.
- **FR-9:** The system must rate-limit search per caller and globally, failing closed when the hashing salt is absent.
- **FR-10:** With `VITE_SEMANTIC_SEARCH` unset, the system must behave exactly as it does today, with no reachable code path to the search function.

## Non-Goals

- Replacing substring search.
- Search-as-you-type semantic queries.
- Semantic search over the **itinerary** — this is Explore only.
- Personalising results by questionnaire answers. Ranking is by meaning alone; the query is the only input.
- Spelling correction, stemming, or synonym expansion — the embedding subsumes these.
- Multilingual queries. Untested; not a goal.
- Storing per-user search history.

## Design Considerations

- The search box, its filters and its empty state already exist in `src/pages/Explore.tsx`. Reuse them — this feature adds a hint line and a submit affordance, nothing more.
- The empty state is where this feature is most visible. When semantic search returned nothing *and* was armed, say so plainly rather than showing the generic no-results copy.
- Match `SwapReasons.tsx` for the in-progress and failure treatment, so both AI features fail the same way.

## Technical Considerations

- **Model pinning is a correctness constraint, not a preference.** Cosine similarity between vectors from different models is meaningless. The `model` column exists so a provider swap is detected rather than silently producing garbage ranking; changing providers means rebuilding the table.
- `activeProvider()` prefers OpenAI (256 dims) and falls back to Voyage (512). Only the 256-dim path is supported here; see US-002.
- Supabase ships pgvector, so US-001 is a migration, not an infrastructure change.
- HNSW is chosen over IVFFlat: it needs no training step and no row-count tuning, which matters at 328 rows where IVFFlat's list count would be guesswork.
- At 328 items an index is not needed for speed. It is there because `docs/ROADMAP.md` states broader Viator taxonomy ingestion is the plan, and adding it later means a second migration.
- The `edit_requests` table and its 24h purge cron already exist from `itinerary-edit`; reuse rather than duplicate.

## Success Metrics

- All three intent queries from the introduction return at least three relevant results where they return zero today.
- Name queries (`Zeerover`, `Arikok`, `Baby Beach`) return the same first result as today — no regression.
- Zero network requests for single-word queries, verified in the browser.
- Golden-set recall ≥ 80% before the flag is flipped.
- No measurable change to Explore's initial render time.

## Open Questions

- What similarity floor? Needs measuring against the golden set — too low pads results with noise, too high recreates the empty page.
- Should the arming hint appear on the first space, or the first space **followed by another character**? "baby " with a trailing space is not yet a phrase.
- Should semantic results be visually distinguished from substring results, or silently merged? Distinguishing is honest; merging is calmer.
- Voyage users get no semantic search at all under US-002. Acceptable, or should the column be widened to 512 and OpenAI vectors padded?
