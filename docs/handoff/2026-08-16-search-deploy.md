# Semantic search — finished 2026-08-16

Live. `SEARCH_PARSE=on`, migration applied, client deployed. This file is the
record of what it is and what is still weak, not a to-do list.

---

## What it does

Any string in, a closed vocabulary of twelve concepts out, filtering before
ranking. The parse runs in the `search` edge function (gpt-5-mini); the filter
runs client-side over facets bundled with the app; the embedding only orders the
survivors.

```
query ─▶ parse (edge fn, cached 30d) ─▶ constraint ─▶ client filters catalog
                     └─▶ embed residual (or whole query) ─▶ ranks survivors
```

## The number, and how to re-run it

```bash
node tools/run-conformance.cjs --selftest   # offline, free — run this FIRST
node tools/run-conformance.cjs              # ~12 calls of the 60/hour budget
```

**0 violations across 1047 judgeable results of 1165 returned, 90% judgeable.
Twelve queries, all zero, nothing deferred. It began at 112.**

It measures results that CONTRADICT a query. `tools/run-search-golden.cjs`
measures recall — did the expected things come back — and is structurally blind
to what arrived alongside them. Keep both: the golden score read 77% while
"good with toddler" was returning a wall of UTVs.

`--selftest` refuses a rule that is unsatisfiable or vacuous. It caught three
real bugs, every one of which would otherwise have printed a clean zero.

## Things that are true and cost something to learn

- **`unknown` is kept but never promoted.** An entry nothing has judged survives
  a `mustNot` (a false exclusion is invisible — nobody sees what they were not
  shown) and does not enter the results on its own. Conflating those returned
  280 entries of 328 for "isn't a boat".
- **Safe is not the same question as good.** `toddler_ok` asks whether a 1-3
  year old could be there; `kid_appeal` asks whether they would enjoy it. 32 of
  the 39 that pass the first score under 2 on the second. Same again for
  `teen_appeal`: 151 products score well for teenagers and badly for toddlers.
  Do not derive one age band, or one question, from another.
- **A prompt is code and its cache needs a version.** Bump `PARSE_VERSION` in
  `supabase/functions/search/parse.ts` whenever the vocabulary or the prompt's
  meaning changes, or cached parses stay stale for 30 days. This was found the
  hard way.
- **`residual` is the traveller's words.** It is a subset of what they typed, and
  the whole query verbatim when nothing parsed. In-memory for one request only.
  `forStorage()` is the single way a constraint leaves the function; never widen
  `StoredConstraint`.
- **The parse takes 4-8s.** `TIMEOUT_MS` is 9000, measured. It does not block the
  page — substring hits render locally and the semantic tail is appended.
- **A secret change needs a redeploy.** `SEARCH_PARSE` is read at module load, so
  a warm isolate keeps the old value. `supabase functions deploy search` will say
  "No change found" if the code is identical; it still recycles the isolate.
- **`npm run build`, never `npx tsc --noEmit`.** Different programs — only the
  project config includes tests. Three pushes failed CI and never deployed while
  the edge function was live and correct. After pushing, check `gh run list`.

## Known weak points, all data rather than architecture

- **~10% of results are `unknown`** and deliberately kept. That is a coverage
  number, not a bug: facets reach 201-215 of 354 entries.
- **The catalog is adult-heavy.** 2 of 328 Viator products score `kid_appeal` 3.
  The best toddler answers are the 26 curated locals (Arashi scores 3), which are
  judged by the same pass since 2026-08-16.
- **`evidence` is stored and rendered nowhere.** 126 quotes were dropped because
  they no longer backed the values beside them; 65 remain. `types.ts` still
  describes a UI that quotes them, which does not exist.
- **Nobody has audited what the filter rules OUT** for things a traveller wanted.
  Only false positives have been checked, in both the toddler pilot and here.

## If it needs turning off

`supabase secrets unset SEARCH_PARSE && supabase functions deploy search`. Every
failure path already degrades to pure embedding rank, so the flag off is the
known-good state rather than an error state.
