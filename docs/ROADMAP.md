# Roadmap

Open work for 10daysonaruba.com. Durable facts and invariants live in
`.claude/CLAUDE.md` — keep mutable state here so that file can stay trustworthy.

## Open

| # | Item | Notes |
|---|---|---|
| 1 | ~~`feedback_events` retention + consent~~ — **closed 2026-08-13** | Retention: `20260813140000_feedback_retention_cron.sql` purges nightly at 24 months, applied to production. Nothing is deleted yet (oldest row 2026-05-23); reverse with `cron.unschedule('purge-old-feedback-events')`. Disclosure: the collection had NO row in the Privacy Policy at all despite running since May — it has one now. Basis: **consent, not legitimate interest.** The payload argues for legitimate interest (pseudonymous, no typed words), but `aruba.session` is written to the device for no other purpose — verified, it is read nowhere else in `src/` — which makes it non-essential storage, and ePrivacy wants consent for that whatever the payload looks like. `logEvent` now reads the same `CONSENT_KEY` PostHog uses, gated BEFORE `sessionId()` so a traveller who declines or never answers gets no identifier written either. Five tests in `src/data/feedback.test.ts`, mutation-checked in both directions. Expect telemetry volume to drop to the consented share of traffic — that is the point, not a regression. |
| 2 | Shortlist + explore event tracking (PostHog) — **blocked, and would be dead code today** | No `track()` calls on star/shortlist/explore paths. Two things to know before starting. (1) `VITE_POSTHOG_KEY` is EMPTY in `.env.production`, so `initAnalytics()` returns immediately and every `capture()` is a no-op — adding events now ships the same "control that does nothing" problem as item 7. (2) Since 2026-08-13 telemetry is consent-gated, so any new event inherits that and reaches only the consented share of traffic. Must still go through `src/lib/analytics.ts`, and a new event class needs a Privacy Policy row. **The thing this was wanted for — distinct search queries per day, to decide item 4 — does not need PostHog:** `query_embeddings` already upserts on `query_hash`, so counting rows per day gives it for free, with no words stored. Measured 2026-08-14: 31 lifetime rows, ~30 of them the golden set being run by hand. |
| 3 | Vendor dashboard | Read-only Supabase query page. RLS stays on — scope access with a policy, never a service-role key in the client. |
| 4 | **Semantic search: negation now filtered, the general parser is specced** | Live since 2026-08-12, scoring **66% recall against its own 80% target** — the shortfall almost entirely NEGATION ("we get seasick" 0/3, "no walking, we are tired" 1/3), because those sentences embed next to the very thing they exclude. Two knobs ruled out by measurement (item 4b): the similarity floor only ever costs recall above 0.20, and `MATCH_COUNT = 30` is what binds — 24 of 25 queries came back full, median lowest score 0.335. **Shipped 2026-08-14:** search now runs the query through `flagsFromNotes`, the same tested parser behind the questionnaire's free-text box, and applies `no-boats` / `no-car` / `mobility` as exclusions via `entryExcludedByFlags`. Three regexes, three phrasings — deliberately conservative, because a false exclusion is worse than a miss. **The general answer is specced, not built:** `docs/superpowers/specs/2026-08-14-search-query-understanding-design.md` — parse to a `SearchConstraint` in a closed vocabulary, cache on the query hash the way `query_embeddings` already does, let embeddings rank only the survivors. It sends traveller words to a US sub-processor, so it needs its own checklist before any flag moves. Re-run `node tools/run-search-golden.cjs` to see what the regex pass alone bought. |
| 4b | ~~`MIN_SIMILARITY` is an unmeasured guess~~ — **measured 2026-08-13; it is not the lever** | Swept with `node tools/search-threshold-sweep.cjs`, which keeps the SCORES the golden runner discards and recomputes recall at every floor. Recall falls **monotonically** from the deployed 0.20 upward — 65.0% at 0.20, 61.3% at 0.26, 58.7% at 0.30, 32.0% at 0.45 — so 0.20 is at or below the knee and raising it only costs recall. **`MATCH_COUNT = 30` is what actually binds:** 24 of 25 queries came back FULL at 30, and the median lowest-scoring result returned was **0.335**, comfortably clear of the 0.20 floor — i.e. on a typical query the cap cuts long before the floor ever engages. Of 56 expected fragments, 33 were found and 21 were missing from a response that was already full. The client caps nothing (`blendSearchResults` appends every id), so the API's 30 is exactly what a traveller sees. **Next experiment:** raise `MATCH_COUNT` and re-measure — but that is an edge-function deploy AND a product call, because every extra result is appended below the keyword hits and 60 would double the scroll. Floors BELOW 0.20 remain unmeasurable without a redeploy, since the function filters server-side. |
| 5 | Enable natural-language swaps | Dark behind `VITE_NL_EDIT`. Two of its four prerequisites cleared on 2026-08-12 as a side effect of the search launch: `20260812090000_item_embeddings.sql` **is applied** (it carries the `feature` column both functions' rate limits filter on — until then the limiter failed open) and **`RATE_LIMIT_SALT` is set**. Still needed: the `itinerary-edit` deploy, `ANTHROPIC_API_KEY` as a Supabase secret, and its own golden run. Checklist: `docs/superpowers/specs/2026-08-11-natural-language-edit-design.md`. |
| 6 | Run the catalog enrichment tool | `npm run enrich` needs `ANTHROPIC_API_KEY` locally. Pipeline shipped with an EMPTY snapshot — 144 of 328 items fall into generic `sec:` buckets. Running it clears only what enrichment can *speak to*: `KIND_VOCABULARY` derives from `KIND_BY_TAG` (12 physical activity kinds), and there is no kind for a bus tour, a submarine or a sightseeing tour — so the ~74 in `sec:tours-sightseeing` stay generic until the vocabulary is widened. That is a separate decision, because `KIND_ADVENTURE` scores every kind and each new entry needs a value chosen against the flag caps that read it. |
| 7 | **`avoid-crowds` now works; three controls still do nothing** | `avoid-crowds` wired 2026-08-14 as a TAG read by `fitItem` — the `influencer` precedent — not as a filter in `applyCatalogFlags`. It suppresses the crowd-pleaser boost and INVERTS the popularity term, so a quiet item scores where a headline catamaran did. Measured on the live catalog (Couple/Mid-range/50, 4 seeds): mean popularity percentile of placed Viator cards **0.665 → 0.551**, 4 of 16 card positions changed, the 0.93 "Half-Day Aruba Island Tour" giving way to a 0.48 trikes tour. Reorders, never excludes: popularity is a good proxy for crowds on this catalog but only a proxy, and hard-excluding on a proxy would strip out things that are merely well-loved. **Its reach is half the plan.** Only ~16 of ~50 cards per plan are Viator products; the rest are curated locals, which carry no `popularity_score` and no crowd signal at all — so a traveller avoiding crowds is still sent to Palm Beach. Closing that needs an editorial `crowded` marker per curated activity, which is data entry and a product call, not a scoring change. **Still inert: `birthday` and `work-trip`** (0 reads outside `Questionnaire.tsx`; only `honeymoon`→`couple` and `influencer` of that group are wired) and **`lodging`**, which matches no live item because `itemTags` derives from price, sections and adventure only — never location — so it changes the seed and nothing else, except `Cruise`→`cruise-day` hitting `sailing-cruises.matched_by` for +2. Wire them or remove them; a pill that reseeds is worse than one that does nothing, because it fakes a response. |
| 8 | ~~Account deletion~~ — **closed 2026-08-14, button LIVE** | `supabase/functions/account-delete` reads the uid from the TOKEN (never the body, so a caller can only delete themselves), deletes `shared_itineraries` explicitly, then the auth user — which cascades `trips`. **Verified end to end** against a real confirmed account: created, signed in, given a trip row and a public share, then the function returned 200 `{"ok":true,"shares_deleted":1}` and the user 404'd with 0 trips and 0 shares remaining. Guards verified separately: GET→405, no-auth→401, anon key as bearer→401, garbage token→401, OPTIONS→200. Enabled by `VITE_ACCOUNT_DELETE_FN_URL` in `.env.production`; rollback is deleting that line and pushing. **Not covered, and cannot be:** `feedback_events` is keyed by a random browser `session_id` with no user column — GDPR Art. 11. Linking identity to pseudonymous telemetry purely to enable erasure would be worse for the person asking. It is consent-gated and purges at 24 months. Two schema facts worth keeping: `shared_itineraries` has no delete policy at all (immutable by design) and its FK is `on delete set null`, so without the explicit delete an erased account would leave a live public `/i/<slug>` behind. |
| 9 | **Boat check-in times are 9 cards deep; departure TIMES are catalog-wide** | Two halves with different reach. The PIN/QUOTE half is water-only and unchanged: 35 of 135 water items have a departure place (11 `approx`, saying "near"), 9 quote the operator's check-in sentence. The TIME half covers **281 of 328 products** of every kind — walking tours, distillery tours, bus tours — from `src/data/startTimes.json`. Both render through `src/components/DepartureNote.tsx` on itinerary cards AND Explore tiles since 2026-08-13. The invariant it protects is narrower than it used to be, and deliberately: check-in lines stay in the OPERATOR's words and in quotes (a test enforces it), while start times are Viator's structured schedule rendered in our own voice — always hedged, never for a specific date. There is no component-test setup in this repo (no testing-library, no jsdom), so the markup is unguarded; the copy is tested through the exported `departureHeadline`/`departureHedge`. Widening the pin half still means hand research per product into `CHECKIN_QUOTES`. |
| 10 | ~~The engine slots by title~~ — **mostly closed 2026-08-13** | `itemSlotOkForFill` now falls back to `scheduleTimeOfDay` where the title is silent (`b6ea559`). Measured on the live catalog, 5 personas x 4 seeds x 10 days: cards in a slot their schedule contradicts fell **13 → 3**, open slots held at **143**, violations stayed at **0**. It is consulted at THREE suggestion sites — `itineraryGenerator.ts:820` (fill ladder), `refaceForAnswers` in `itemFit.ts` (the swap pool) and `Itinerary.tsx:503` (rotate within group) — and at NONE of the display paths, so no stored or shared card can re-face; it does narrow the Swap menu on existing plans. **The residual 3 are structural:** `2785MORSNORKEL` (09:15 only) seated in a day-2 afternoon for the `no-early-mornings` persona by the BEACH-STAPLE pre-pass (`src/data/staples.ts`, key `catamaran-sail`, whose spec offers `[morning, afternoon]`; the slot is chosen at `itineraryGenerator.ts:1773` from `titleTimeOfDay` alone and morning is closed for that persona). The staple spec had a second option — it is the PRODUCT that has no honest slot, not the pass. Premium (`:1681`) and staple (`:1766`) at least go through `fitsDayShape`; the template pass never calls it (declared at `:1563`, after the template pass at `:1407-1523`) and the pin pre-pass (`:1347`) bypasses both. None of them sees the schedule rule. |
| 11 | ~~Ingest Viator start times~~ — **done 2026-08-13** | Probe: `npm run probe:start-times`. Evidence: `docs/map/viator-start-times.json`. All 328 CATALOG products (post-`regroupItems`; the raw edge-function payload is 366) returned 200, so single-product availability IS in Basic access and no Full Access application is needed; `/availability/schedules/bulk` (500 per call) would still be nicer and needs certification. 281 of 328 carry a start time; 47 are untimed open tickets. **Refreshing is a hand step and nothing checks it:** the probe writes only the evidence file, and `src/data/startTimes.json` was derived from it by hand. Re-run the probe, regenerate the snapshot, and confirm the two agree. It is a union across seasons and days of week, so it drifts as operators change schedules rather than going stale at once. |

| 12 | **Vite 5 → 8 upgrade, for three dev-server advisories** | `npm audit fix` on 2026-08-14 cleared 4 of 6 findings. The remaining two need semver-major bumps — `vite@5.4 → 8.2`, `esbuild → 0.28` — which is a toolchain migration, not a patch. All three underlying advisories are DEV-SERVER issues: path traversal in optimized-deps `.map` handling (GHSA-4w7w-66w2-5vf9), `server.fs.deny` bypass on Windows alternate paths, esbuild allowing any site to request from the dev server. None of them touch the production bundle, and two are Windows-only. **The reason it is not zero-risk anyway:** a Vite dev server was exposed publicly through a Cloudflare tunnel on 2026-08-13 to demo card changes, which is exactly the scenario these advisories describe. The tunnel is closed. If that is done again before the upgrade, bind it to a preview build (`npm run build && npm run preview`) rather than `npm run dev`. |

| 13 | **A title layer for activity KIND — primitive built and tested, wiring deliberately not shipped** | `activityKind` resolves 184 of 328 products from Viator tags and falls back to `sec:<section>` for the other 144 — i.e. to the Explore CATEGORY, which is far too coarse to dedupe on: 74 products share `sec:tours-sightseeing`, so the engine treats a submarine, a bus tour and a walking tour as the same kind of thing. The titles carry the answer: `sec:cruises-water` held "2-Tank guided Dive", "Night Shore Diving", "Kids Parasailing" and a horseback tour mis-filed into the water section. `titleKind()` in `src/data/itemFit.ts` reads them, in the SAME twelve kinds (no new vocabulary, so `KIND_ADVENTURE` and the contraindication caps stay valid). Measured: it resolves **35 of the 144**, all 35 individually audited and correct. **It is not wired into `activityKind`, and the reason is the interesting part.** Kind is not only a dedup key: `regroupItems()` calls `matchingSection()`, which reads `KIND_SECTION`, so changing an item's kind RE-FILES IT INTO A DIFFERENT GROUP — changing which cards exist and what sits in their "Other suggestions". Wiring it in put a **$2,300 yacht into a group a Budget-conscious traveller sees**, failing two `engineCoverage` budget tests and one `flags` control test. Fill was unchanged (137 open slots with, 136 without — noise). **To ship it, kind has to be split in two:** a variety/dedup key that the title may inform, and a section key that only tags and enrichment may touch. That is a real refactor of a load-bearing function, not a one-line fallback. |

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
- Semantic search enabled in production (migration applied, `search` deployed,
  `RATE_LIMIT_SALT` set, corpus populated via a new `op=refresh` on `viator-cards`)
  → `d5e2d95`. Quality is item 4 above, not here.
