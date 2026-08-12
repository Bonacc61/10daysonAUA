# Roadmap

Open work for 10daysonaruba.com. Durable facts and invariants live in
`.claude/CLAUDE.md` — keep mutable state here so that file can stay trustworthy.

## Open

| # | Item | Notes |
|---|---|---|
| 1 | `feedback_events` retention cron (24 months) | Table exists (`supabase/migrations/20260523230000_feedback_events.sql`); no purge job yet. Contact submissions already purge at 12 months — mirror that pattern. GDPR: retention needs to match what the Privacy Policy claims. |
| 2 | Shortlist + explore event tracking (PostHog) | No `track()` calls on star/shortlist/explore paths today. Must go through `src/lib/analytics.ts`; new events need a legal basis documented in `src/pages/Privacy.tsx`. |
| 3 | Vendor dashboard | Read-only Supabase query page. RLS stays on — scope access with a policy, never a service-role key in the client. |
| 4 | Enable semantic search | Built and merged 2026-08-12, dark behind `VITE_SEMANTIC_SEARCH`. Five prerequisites before the flag flips — migration, function deploys, secrets, a catalog refresh to populate `item_embeddings`, and a golden-set run to give `MIN_SIMILARITY` a measured value instead of the shipped guess. Checklist: `docs/superpowers/specs/2026-08-12-semantic-search-design.md`. |
| 4b | **Semantic search needs TWO env vars, not one** | `semanticSearchEnabled()` requires `VITE_SEMANTIC_SEARCH === 'true'` **and** `VITE_SEARCH_FN_URL` **and** `VITE_SUPABASE_ANON_KEY`. `VITE_SEARCH_FN_URL` was in `.env.example` only; **added to `.env.production` on 2026-08-12** so it is no longer a trap. Also confirmed: `OPENAI_API_KEY` IS already set as a Supabase secret (2026-07-21, used by viator-cards at ingest), but **`RATE_LIMIT_SALT` is NOT** — and `search/index.ts:102` returns 500 "not configured" on every request without it, so a successful deploy would still have failed on every search. Setting the flag alone leaves the feature silently dark, with no error anywhere. Verified 2026-08-12 by driving the dev server: with both set, one word makes 0 network calls, the space bar shows "press Enter to search by meaning" and still makes 0 calls, and Enter fires exactly one POST. The client half is done; only infrastructure is missing. |
| 5 | Enable natural-language swaps | Same shape, dark behind `VITE_NL_EDIT`. Needs the `itinerary-edit` deploy, `ANTHROPIC_API_KEY` + `RATE_LIMIT_SALT`, its own golden run — **and `20260812090000_item_embeddings.sql` applied first.** That migration adds the `feature` column both functions' rate limits filter on; deploying `itinerary-edit` without it made the limiter fail open until 2026-08-12, and the column living in a file named after embeddings is how that gets missed. |
| 6 | Run the catalog enrichment tool | `npm run enrich` needs `ANTHROPIC_API_KEY` locally. Pipeline shipped with an EMPTY snapshot — 144 of 328 items fall into generic `sec:` buckets. Running it clears only what enrichment can *speak to*: `KIND_VOCABULARY` derives from `KIND_BY_TAG` (12 physical activity kinds), and there is no kind for a bus tour, a submarine or a sightseeing tour — so the ~74 in `sec:tours-sightseeing` stay generic until the vocabulary is widened. That is a separate decision, because `KIND_ADVENTURE` scores every kind and each new entry needs a value chosen against the flag caps that read it. |
| 7 | `avoid-crowds` flag is inert | The Q8 pill exists and can be ticked, but no filter anywhere reads it — `applyCatalogFlags` handles `no-boats`, `no-car` and the adventure caps only. Ticking it changes nothing. Either give it a filter or take the pill away; a control that does nothing is worse than no control. Found 2026-08-12 while scoping Q8 extraction. |
| 8 | In-app account deletion button | GDPR right to erasure. Needs to cover `trips`, `feedback_events`, `shared_itineraries`, and the auth user. |

## Matching engine — open items

Tracked in detail in `docs/matching-engine/development-log.md`; how geography
feeds the engine is in `docs/matching-engine/geography.md`:

- Embedding clustering **is live** (verified 2026-08-02: all live items carry an
  `experience_cluster_id`). Over-clustering was investigated and ranks third
  behind the pool rule and catalog size — see "What actually limits plan variety"
  in the dev log.
- **Catalog size still bounds distinct Viator variety, and 14-day plans no
  longer fill every slot — deliberately.** 72 of 155 eligible experiences (after
  retail, photo-service and vehicle-hire exclusion) have a member with 25+
  reviews (champion pool ~81), which is why long trips used to run out of picks.
  Free local beaches becoming revisitable after a clear day
  (`REVISITABLE_MIN_DAY_GAP = 2`) got a 14-day trip to 0 open slots on all five
  trace personas, measured 2026-08-03. The 2026-08-05 curation rules (one kayak per trip;
  one sail per trip under 8 days, or one daytime + one evening at 8+; two outings
  and one meal per day) traded that back deliberately: **roughly 300-350 of 1,260 slots open** —
  the five personas from `tools/itinerary-trace.ts` at 14 days, seeds 0-5,
  measured 2026-08-05 (301 before these rules; 304 after, and it moved between
  343 and 349 within an hour as the catalog and rules churned, so treat the
  precision as noise and the order of magnitude as the point). Most of those open slots are the CAP, not a shortage: a day that
  has had its two outings is finished by design. Fill is therefore no longer the
  health metric it was — a plan of highly bookable picks with room to
  personalise beats a full one padded with near-duplicates. Broader Viator taxonomy ingestion is still the fix for
  *distinct-experience* variety; no constant will do it.
- **The en-route food post-pass still has no TIME accounting.** It appends a
  second afternoon card (`day.afternoon.push`) after the day loop, outside
  `feasible`, so a day can exceed the 8h daytime cap: measured on the live
  catalog, 52 of 558 days ran past 12h, worst 14.6h. Since 2026-08-05 it enforces
  the one-meal rule by displacing any curated restaurant on the day, and since
  2026-08-12 the three-card ceiling too — bailing before it displaces a dinner,
  so a full day does not lose its dinner for a stop that then cannot land. It
  still does not check DAY_CAP_MIN, which is the open half of this item.
- **Pre-pass ORDER is load-bearing and undocumented in the code's structure.**
  Pins → balanced template (mid-slider personas only) → premium splurge →
  staples → fill ladder. Whichever pass runs first claims a route family, and
  the later ones stand down. That ordering is the
  only reason a money-no-object traveller gets the yacht instead of the
  catamaran staple (2026-08-05). Reordering these passes changes which products
  reach the itinerary, so treat the sequence as an interface.
- **Day shape is enforced in four separate places.** Three cards a day (the
  meal included, since 2026-08-12) + two outings + one meal + a full-day pass
  alone on its day is applied by the fill ladder (`withinDayShape`) and
  re-applied by the staple pre-pass, the premium pre-pass (both via
  `fitsDayShape`); the en-route post-pass enforces the one-meal half and the
  card ceiling; and the balanced template satisfies the shape by construction
  EXCEPT for the day-pass rule, which it has had to check explicitly since
  2026-08-12. None of the three AUTO-PLACEMENT paths goes through the
  ladder, so a new one has to opt in by hand or it will silently break the shape
  — that is exactly how a staple was landing a third outing on a template-filled
  day until 2026-08-05.
- **South-coast food coverage is capped at ~6 in 10 days by the no-repeat rule.**
  Zeerover and O'Neil's are close to the only decent stops down there, and each
  is offered once per trip, so a fortnight with four south-coast days cannot
  cover them all. Letting a restaurant repeat after a gap reaches ~73% but
  breaks the "nothing repeats except a free beach" guarantee (4 tests guard it).
  Needs a product decision, not a constant.
- Same-day cross-slot (largely addressed): `SAME_DAY_SIMILARITY_THRESHOLD = 0.08`
  plus a hard one-boat-per-day cap now govern within a day. What remains: two items
  from one Viator group can still land on the same day when neither rule fires.
  `similarReason` consults `usedGroupIds` only for items with neither tags nor a
  cluster id, so two *tagged* items from one group are caught only if tag Jaccard
  clears the threshold.
- Tag sparsity (**no longer live**): the `usedGroupIds` + `lastUsedDay` fallback
  for group entries with neither tags nor a cluster id still exists in
  `similarReason`, but **every live item carries both** — measured 2026-08-11
  across all 328 catalog items, and the code's own comment on that branch says
  "Unreachable on live data". It applies only to the offline stub catalog, so it
  is not an open item against plan quality.
- `TAG_SIMILARITY_THRESHOLD = 0.35` set conservatively, never tuned against the
  live catalog.
- **Display-time refacing has no cross-card dedup — two cards can show one
  experience cluster.** The generator's cluster rule governs what it *places*;
  `resolveSlotEntry` then re-picks every group card's face independently via
  `refaceForAnswers`/`bestItemForAnswers`, which knows nothing about what the
  other cards are showing. Measured 2026-08-11 on the live catalog: with no
  flags at all, `food-drink-experiences` and `watersports` both face cluster
  `444239P2`; with the Q8 `influencer` flag, `sailing-cruises` and `watersports`
  both face `472918P1` (the two "private turtle snorkel + video" products,
  observed in a real plan on day 2 and day 4). **Pre-existing and not caused by
  the influencer flag** — the content bonus is simply a new input to the same
  re-pick, so it changes which cluster collides, not whether one can. Fixing it
  means giving the reface chokepoint a plan-wide view, which it does not
  currently have.

## Shipped

- OG meta tags + og-image → `f0f3500`
- Cookie consent banner, GDPR-gated analytics → `f0f3500`
- Terms of Service page → `8e0ab08`
