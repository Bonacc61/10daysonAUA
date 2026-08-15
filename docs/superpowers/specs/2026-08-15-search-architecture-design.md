# Search: fixing the cause, not the symptoms

**Status:** design, not built. Supersedes the framing in
`2026-08-14-search-query-understanding-design.md` (which specced Layer 2 alone)
and closes out `2026-08-14-search-corpus-suitability-design.md` (Layer 1 done
the hard way, and measured not to work).

**Date:** 2026-08-15

---

## The root cause, in one sentence

The system's only representation of an activity is a **vector of its marketing
copy**, and its only operation is **nearest-neighbour** — so it cannot express
negation, cannot apply judgment, has no structure to filter on, and always
returns thirty things whether or not thirty things qualify.

Every failure on record is that one cause wearing a different hat:

| symptom | measured | why the cause produces it |
|---|---|---|
| Negation inverts | "we get seasick" 0/3, "no walking, we are tired" 1/3 | "seasick" embeds *next to* boats. Cosine has no `NOT`. |
| Judgment absent | "good with toddler" returns a wall of UTVs | Whether a 2-year-old belongs in a buggy is not a property of the text. 15 UTVs advertise "Specialized infant seats are available". |
| No structure | can't ask for "indoor", "under 2 hours", "no swimming" | Duration, terrain, water and age are dissolved into 256 numbers and cannot be recovered. |
| Wall of near-duplicates | 30 results, 9 distinct experience clusters | `MATCH_COUNT = 30` over 328 items returns 9% of the catalog on *every* query. The 0.20 floor never binds: median lowest returned score 0.335. |
| Ceiling of 85% | 7 of 56 golden fragments unreachable | `viator-cards` embeds `c.items` and never `c.activities`. The 26 curated locals — Zeerover, the aloe museum, Savaneta — are not in the index at any dimension count. |

**Why more of the same does not help.** Adding suitability text (measured), and
adding dimensions (proposed), both act on the *representation* while leaving the
*operation* untouched. Embeddings can only lift good matches toward a query;
they have no mechanism to push bad ones away, so a UTV that scores 0.31 stays at
0.31 and simply gets outranked — still occupying result slots 10-30. And more
description was already tried: descriptions grew 191 → 611 chars and the same
query returned 25 of the same 30 ids.

---

## The architecture

Three layers, each doing the job it is actually good at.

```
                       build time (offline, product copy only)
  catalog ──▶ [1] FACET EXTRACTION ──▶ committed facet table
                                              │
  query ──▶ [2] CONSTRAINT PARSE ──────▶ eligible set ──▶ [3] EMBEDDING RANK ──▶ results
             (request time, cached)      (filter)          (rank survivors)
```

The load-bearing change is that **filtering happens before ranking**, and
embeddings are demoted from arbiter to tiebreaker.

### Layer 1 — Facets: what an activity *is*

One offline pass over all **354** activities (328 Viator + the 26 curated
locals) producing a structured profile per item. Not a boolean per question —
a **vocabulary** that answers whole classes of question:

| group | facets |
|---|---|
| who it suits | `min_age_real`, `kid_appeal` (0-3), `adults_only`, `mobility_ok`, `motion_risk`, `pregnancy_ok` |
| what it is | `setting` (indoor/outdoor/mixed), `pace` (active/gentle/passive), `duration_band`, `walking_band`, `water` (none/near/in/deep), `swim_required` |
| conditions | `heat_exposure`, `noise`, `weather_dependent` |
| practical | `leave_early_possible`, `book_ahead`, `own_transport_needed` |

**This is the difference between a patch and a solution.** `toddler-ok` answers
one question. `min_age_real` + `kid_appeal` + `water` + `duration_band` answers
"good with a toddler", "somewhere the kids can run around", "will a 6-year-old
be bored", "nothing where they could fall in" — without a second pass.

Each facet carries the model's one-line reason, so a wrong call is visible in a
diff rather than buried in a vector.

**Proven on 2026-08-15.** A pilot of exactly this shape, on the single
`toddler-ok` facet, ruled out **68 of 68** off-road products — including the 15
whose operators advertise infant seats — by reading minimum ages of 3 and 4 that
*contradict the operator's own child-friendly checkbox*. At high confidence it
returned 39 sensible results and zero UTVs. Tool: `tools/run-judge-suitability.cjs`.

**Two lessons from that pilot, both encoded here.**

1. *Safe is not the same question as good.* Asked "is this suitable", the model
   answered on safety and returned couples photoshoots — harmless to a toddler,
   useless to the parent. `kid_appeal` is a separate facet from `min_age_real`
   for this reason.
2. *Self-reported confidence is load-bearing.* The four Jeeps that leaked through
   a looser prompt were all `low` confidence and all hedged ("if a proper child
   seat is provided"). Every facet stores a confidence, and the eligibility rule
   treats low confidence as **not eligible** for exclusionary facets. This is a
   soft guarantee, not a hard one, and it is the weakest joint in the design.

### Layer 2 — Constraint parse: what the traveller *means*

At request time, the query is parsed into a `SearchConstraint` over the **same
closed vocabulary** as Layer 1. A closed vocabulary is what makes this
verifiable: the parser cannot invent a facet that no activity carries.

```
"we get seasick"            → { exclude: { motion_risk: ["high"], water: ["in","deep"] } }
"good with a toddler"       → { require: { min_age_real: "<=2", kid_appeal: ">=2" } }
"no walking, we are tired"  → { exclude: { walking_band: ["long"] }, prefer: { pace: "passive" } }
"something when it rains"   → { require: { setting: ["indoor","mixed"] } }
"not too touristy"          → { prefer: { crowd: "low" } }
```

Cached on the query hash for 30 days, in the table that already caches vectors.
Measured 2026-08-14: 31 distinct queries lifetime, so the hit rate is very high
and the marginal cost approaches zero.

**Failure is graceful by construction.** A parse that fails, times out, or
returns an empty constraint falls through to today's behaviour — pure embedding
rank. Search never gets *worse* than it is now; it declines to a known state.

### Layer 3 — Embedding rank, demoted

Cosine similarity ranks the *survivors* of Layer 2. This is the job embeddings
are genuinely good at and no rule replaces: "somewhere to swim with fish" → a
snorkel trip, without the word "snorkel" appearing.

Two changes come with the demotion:

- **`MATCH_COUNT = 30` becomes a ceiling, not a quota.** Return what qualifies.
  Five good answers beat thirty of which twenty-one are filler. This is what
  structurally ends the "wall of UTVs" — not better ranking, fewer results.
- **Embed the curated locals.** `viator-cards` must walk `activities` as well as
  `items`, or the 85% ceiling stands and "food that locals actually eat" keeps
  failing for a reason no amount of tuning touches.

---

## To what extent the OpenAI key is used

Three distinct uses, with three different risk profiles. Worth keeping separate
in the head, because only one of them touches traveller data.

| # | where | what is sent | when | GDPR |
|---|---|---|---|---|
| 1 | Facet extraction (Layer 1) | Viator **product copy** | Build time, on catalog churn | **No change.** OpenAI already receives product text at ingest, always on. |
| 2 | Constraint parse (Layer 2) | the traveller's **typed query** | Request time, cached 30 days | **No new sub-processor** — see below |
| 3 | Query embedding (Layer 3) | the traveller's **typed query** | Request time, cached 30 days | Unchanged from today |

**Why #2 is not the legal project it looks like.** The traveller's raw words
already go to OpenAI on every semantic search — `search/index.ts` calls
`embedBatch([normalised])` with the actual string, not a hash. `Privacy.tsx:40`
already discloses this, and states the purpose as turning what you typed "into a
change to your plan, **or into search results**", on a **Contract** basis. Line
71 already names OpenAI as the US sub-processor for search-by-meaning. Line 79
already frames search-by-meaning as deliberate opt-in.

So #2 changes *what OpenAI does with a string it already receives*, not whether
it receives it, nor under what basis.

**Three things that genuinely do change, and must not be waved through:**

1. **The cached artifact becomes legible.** Today the cache row is a 256-number
   vector — opaque. A cached *constraint* (`{with_children:{age:2}}`) is
   human-readable, and readable inference about a traveller is a different thing
   from an opaque one, even hashed. Either keep storing only the vector and
   re-parse on miss, or accept a legibility change and say so.
2. **`Privacy.tsx:42` becomes inaccurate.** It describes what is kept as "a
   scrambled fingerprint of a search phrase, and its numeric form". If a parse is
   cached, that sentence needs to name it. Small edit, non-optional.
3. **Completions have different retention and training characteristics from
   embeddings.** Confirm the account's data-processing settings cover it.

**None of this is a flag decision in the `VITE_NL_EDIT` sense.**
`VITE_SEMANTIC_SEARCH` is already `true` in `.env.production`, and the flow it
gates already sends these words to this processor.

---

## Cost

| | tokens | note |
|---|---|---|
| Layer 1, full catalog, all facets | ~350k in / ~200k out, one-off | measured shape: the 328-product `toddler-ok` pilot ran 108k in / 58k out |
| Layer 2, per **distinct** query | ~300 in / ~100 out | 30-day cache; 31 distinct queries measured lifetime |
| Layer 3 | unchanged | ~$0.03/month at 1000 searches/day |

Layer 1 re-runs on catalog churn, not on a schedule. Per-token prices are on the
OpenAI billing page and are deliberately not quoted here — a stale price in a
spec is worse than no price.

---

## What could still go wrong

- **A closed vocabulary cannot anticipate everything.** "Somewhere my
  mother-in-law won't complain" parses to nothing. The fallback keeps that query
  exactly as good as it is today — no better, no worse.
- **Confidence is self-reported.** The no-UTVs result rests on the model's own
  calibration. It held across 328 products; it is not a guarantee.
- **Only false positives have been audited.** Nobody has checked the 256 products
  the pilot ruled *out* for things a parent would have wanted. That audit gates
  shipping, not designing.
- **The facet table is a snapshot.** It stales as Viator's inventory churns, with
  nothing to detect it — the same hand-step problem as `startTimes.json`
  (roadmap item 11). A coverage check belongs in the drift tool.
- **A new request-time failure mode.** Parse latency and parse errors did not
  exist before. Hence the fallback, and hence the cache.

---

## Build order

Each step is independently useful and independently revertible.

1. **Embed the curated locals.** `viator-cards` walks `activities` too. Lifts the
   golden-set ceiling from 85% toward 100% and needs no new concepts.
2. **Layer 1 over the full facet vocabulary**, committed as a data file with
   reasons. Offline, no traveller data, no deploy.
3. **False-negative audit** of the facet table against the golden set.
4. **Layer 3 filtering, using Layer 1 only**, driven by the existing
   `flagsFromNotes` regexes. Ships real exclusion with **no request-time LLM call
   at all** — and on its own would have fixed "good with toddler".
5. **Layer 2**, behind the fallback, with the `Privacy.tsx:42` edit.
6. **`MATCH_COUNT` becomes a ceiling.** Last, because it changes result counts on
   every surface and wants its own measurement.

Step 4 is the honest minimum: it is the point at which the treadmill stops,
because from there a new query shape needs a new *regex*, not a new labelling
pass. Step 5 is what removes the regex too.
