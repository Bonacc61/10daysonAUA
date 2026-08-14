# Search corpus suitability — design

**Date:** 2026-08-14
**Status:** Built, not deployed. The ingest composes and stores the new search vector; the
snapshot is committed. **Nothing has changed in production** — edge functions do not deploy
on push to `main`, so this is inert until `viator-cards` is deployed and the catalog cache
refreshes. Cluster collapse (the last section) was explicitly deferred by the owner.
**Scope:** Change **what gets embedded** at ingest so the corpus can represent *who a
product suits*, not only what it is. Adds a committed suitability snapshot derived from
`/products/{code}`, a composition change in `supabase/functions/viator-cards/index.ts`, and
a cluster-collapse pass in `blendSearchResults`. **No change to the ranker, no new
sub-processor, no LLM.**
**Evidence:** `docs/map/viator-suitability.json` — `npm run probe:suitability`.

## Problem

`docs/superpowers/specs/2026-08-14-search-query-understanding-design.md` fixes queries whose
failure is *negation* — "we get seasick" ranking boats. This spec is about the other half of
the same 66% recall figure, which that spec names but does not address:

> Of 56 expected fragments, 33 were found and **21 were missing from a response that was
> already full.**

A constraint parser can only remove candidates. It cannot make the right product rank when
the corpus has no vocabulary for what was asked. `good with toddler` is that case: it has
nothing to exclude, so query understanding leaves it exactly where it is.

Measured against the live function on 2026-08-14, `good with toddler` returns 30 results
scoring **0.294–0.374**, of which **only 9 are distinct experience clusters** — a wall of
near-identical UTV rentals. Two controls calibrate that band:

| Query | Top score | What it means |
|---|---|---|
| `Baby Beach` — a real referent | **0.621** | the ranker works |
| `good with toddler` | **0.374** | nearer the noise floor than a match |
| `quarterly tax filing software` — deliberate nonsense | **0.250** | the floor |

The query lands in an empty region of the space. Nothing in the corpus is *about* suiting a
toddler, so the ranking is decided by whichever block of near-identical listings is largest.

### More prose is not the lever — measured, not assumed

Between two runs on 2026-08-14 the ingest began shipping full descriptions instead of the
`/products/search` teaser: **191 chars → 611 chars**, zero truncated. Tripling the text moved
almost nothing. The same query re-run afterwards returned **25 of the same 30 ids**, the same
score band (0.294–0.374), and *fewer* distinct clusters than before (9, down from 13).

That is the finding this spec rests on. The problem was never that the text is short. It is
that marketing prose describes **what you do**, and a suitability query asks **who it is
for** — a question the copy never answers at any length.

## What Viator already publishes, and what it is worth

`/products/{code}` is in Basic access (CLAUDE.md, verified) but is one call per product, so
it cannot live in the ingest. It goes in a committed snapshot, the same contract as start
times, coordinates and enrichment. All **328** catalog products returned 200.

| Field | Coverage |
|---|---|
| `additionalInfo[]` | 327 / 328 |
| `pricingInfo.ageBands` | 328 / 328 |
| `itinerary.duration` | 276 / 328 (84%) |

`additionalInfo` is a **standardised vocabulary**: 317 distinct strings, of which 24 are used
by 5 or more products. Those 24 are the facet-shaped ones, and they read like traveller
intent rather than marketing:

```
 234  Suitable for all physical fitness levels
 180  Not recommended for travelers with poor cardiovascular health
 163  Not recommended for pregnant travelers
 116  Infants and small children can ride in a pram or stroller
 106  Service animals allowed
  86  Travelers should have at least a moderate level of physical fitness
  71  Infants are required to sit on an adult's lap
  50  Specialized infant seats are available
  37  Wheelchair accessible
  16  Children must be accompanied by an adult
```

### The signal lift

The probe asks one question of each product both ways: *does the embedded text say anything
at all about age, children, or access?*

| | Products | Share |
|---|---|---|
| Embedded text today (full descriptions) | 94 / 328 | **29%** |
| With `additionalInfo` + an age sentence appended | 326 / 328 | **99%** |

That is the whole proposal. Today, seven of every ten products are invisible to any
suitability question; afterwards, essentially all of them can be ranked on one.

## Approach — embed the suitability profile, keep the ranker

At ingest, compose the embedded text from the snapshot rather than from the description
alone:

```
<title>. <full description>
Infants and small children can ride in a pram or stroller. Suitable for all
physical fitness levels. Service animals allowed. Children welcome from age 3.
2 hours 30 minutes.
```

Three properties make this cheap and safe:

- **Retrieval only.** This text is embedded, never rendered. A mis-parse costs ranking
  quality; it can never become a false promise to a traveller. That is why it does not need
  the evidence-quote gate `enrichment.ts` imposes on displayed claims — a different bar for a
  different risk.
- **No LLM, no new sub-processor.** Every sentence is Viator's own string or a number
  rendered from its own age bands. There is no generation step and therefore no
  hallucination surface. This is the whole reason to prefer it over widening roadmap item 6.
- **Ranking is untouched.** Same model, same 256 dims, same `search_items`. Embedding cost
  rises with text length and is rounding error: ~150 tokens × 328 products at
  $0.02/M ≈ **$0.001 per refresh**.

### Use a second vector — do not reuse the clustering one

`viator-cards/index.ts` computes **one** embedding and uses it for both dedup and search.
Those are different questions: clustering asks *is this the same product*, search asks *does
this suit me*. Adding shared boilerplate — 234 products carrying the same fitness sentence —
makes every listing more alike and would destabilise `EMBEDDING_CLUSTER_THRESHOLD = 0.82`,
which was measured against the old text and is load-bearing for plan variety.

Keep clustering on `title + description` exactly as it is. Add a **separate** search vector
built from the rich text. Two embeddings per item, one threshold left undisturbed.

### The 500-char cap is already a live bug

`viator-cards/index.ts:204` slices the embedded text at 500 chars. That was inert while
descriptions were 191 chars. Since they grew to 611 it truncates **228 of 328** products
(median composed length 667, p90 1027). Whatever else is decided here, that constant needs
raising or the richer text is discarded before it reaches the model.

## Do NOT build an age-band filter

The obvious next step is a hard predicate — *toddler → minimum age ≤ 3*. **Measured, it does
not work**, and the snapshot records why so nobody tries it twice.

| Candidate predicate | Whole catalog | The 30 bad results | The 69-product UTV/jeep block |
|---|---|---|---|
| A — child band **and** stroller/infant seating stated | 25% | **7%** | **6%** |
| B — trusted age band ≤ 3 | 52% | 71% | 64% |
| C — trusted age band ≤ 2 | 49% | 71% | 62% |

Age bands fail twice over:

1. **67 products (20%) price with a single `ADULT 0–99` band**, reporting a minimum age of 0
   while being adults-only in practice. Four of the five UTV rentals at the top of the
   failing query do exactly this.
2. **Excluding those does not help.** Predicate B still passes 71% of the bad results —
   UTV operators genuinely declare CHILD bands, because a child may ride as a passenger.
   "A child may legally be present" is not "this suits a toddler", and the age band cannot
   tell the two apart.

Only predicate **A** — the `additionalInfo` strings — separates: 6% of the UTV block against
25% catalog-wide, a ~4× enrichment. But it is a *positive-only* signal at 35% coverage, so
absence proves nothing and it must not become a hard exclusion either. **Embed it, do not
filter on it.** It lifts the right products without stranding the unstated ones.

### A golden-set expectation is wrong

`tools/search-golden.json` expects `good with a toddler` to return the **Atlantis
Submarine**. Its own listing says *"Children must be a minimum of 36″ in height (90 cm) or 4
years old"*. A four-year-old floor is not a toddler, so excluding it is correct and the
golden entry is the thing that is loose. The nearby **Semi-Submarine** (age 3, infant seats)
is the right answer and does survive. Fix the fixture when this ships, or it will score a
correct result as a miss.

## Collapse by experience cluster

Independent of everything above, and the largest single change to what a traveller sees: the
current result set is **9 distinct experiences presented as 30 cards**. `blendSearchResults`
(`src/data/exploreItems.ts:387`) appends every returned id and ignores
`experience_cluster_id`, which is already computed at ingest, already shipped in the payload,
and already trusted by the generator. Search is its only consumer that ignores it.

One result per cluster, keeping the highest-scoring member (ids arrive score-descending).

It belongs *inside* `blendSearchResults` rather than at a call site, because
`src/lib/entrySearch.ts:66` takes the semantic contribution as the tail after `substringHits`
and reports it as `addedByMeaning`. Collapsing inside the blend therefore keeps that count
honest by construction — the traveller is told the number of cards that actually appeared,
with no second place to keep in sync.

## What stays exactly as it is

- **`MIN_SIMILARITY` and `MATCH_COUNT`.** Item 4b measured the floor: recall falls
  monotonically from 0.20 upward, so raising it only costs recall. Untouched here.
- **Keyword results keep priority.** Semantic hits stay appended below substring ones.
- **`itemSlotOk` and every display path.** This is a suggestion-path change only; no stored
  or shared itinerary can re-face.
- **The query side.** Nothing a traveller types is treated differently. This spec changes
  only what the catalog says about itself.

## GDPR

Nothing here sends anything new anywhere. The snapshot is built by a hand-run tool against
Viator's own product data, contains no traveller input, and the ingest embedding call to
OpenAI already happens on every refresh and is already documented. **No flag decision, no
Privacy Policy change, no new sub-processor.** That is the main argument for doing this
before the query-understanding parser, which needs all three.

## Sequence

1. `npm run probe:suitability` — **done**. Evidence: `docs/map/viator-suitability.json`.
   328 probed, 327 returned 200.
2. `npm run build:suitability` — **done**. Derives
   `supabase/functions/viator-cards/suitabilityData.ts` (327 profiles, median 222 chars).
   Unlike `startTimes.json`, which roadmap item 11 notes was derived *by hand*, this
   transform is code: re-run it and the diff is the drift.
3. Compose and store the search vector — **done**, `supabase/functions/viator-cards/`:
   `suitability.ts` (pure, 13 tests) and the ingest change in `index.ts`.
4. **Deploy `viator-cards`, force `?op=refresh`, then re-run
   `node tools/run-search-golden.cjs`** against the 66% baseline. *Not done — needs a
   deploy, which is a deliberate decision, not a side effect of a push.*
5. Cluster collapse — **deferred by the owner**, and independent of everything above.

### On the 500-char cap

The cap is *not* raised. Clustering keeps `title + description` sliced at 500 exactly as it
was, so `EMBEDDING_CLUSTER_THRESHOLD = 0.82` sees the input it was measured against. The
search text is a separate string with its own `SEARCH_TEXT_MAX = 1400`, and it truncates the
description rather than the profile. That achieves what raising the shared cap was meant to
achieve while introducing no new drift into plan variety.

Worth recording: the clustering input *already* drifted when descriptions grew from ~191 to
~611 chars, because the 500-char slice went from inert to binding on 228 of 328 products.
That happened before this change and is unaddressed by it. If clustering quality is ever
questioned, that is the first thing to re-measure.

## Open questions

- **Does it actually move recall?** The lift number (29% → 99%) says the corpus *can* answer
  the question; it does not prove the ranker will. The golden run at step 4 is the only real
  verdict, and this spec should be judged on it.
- **Does the shared boilerplate hurt?** 234 products carry the same fitness sentence. If it
  drowns the distinctive text, the fix is to include only the *discriminative* lines —
  those on fewer than ~60% of the catalog — rather than all of them. Worth measuring both
  ways at step 4.
- **How often does the snapshot go stale?** Age bands and access notes drift slower than
  schedules, but nothing checks either. Same open problem as start times, not made worse.

## What would make this not worth doing

If the golden run at step 4 shows no recall improvement, the conclusion is that suitability
is not expressible in a 256-dim bi-encoder at this catalog size, and the answer is a
structured facet filter in the UI — "travelling with young children" as a checkbox reading
`suitability.json` directly — rather than anything embedded. That would be a smaller,
duller, and entirely defensible outcome, and the snapshot built here is exactly what it
would need.
