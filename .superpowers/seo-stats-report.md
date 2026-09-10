# /stats — the SEO surface section

Branch `feat/seo-stats`, stacked on `feat/seo-foundation`.

The sibling branch published 58 static pages and its spec commits to expanding or
cutting them at ~6 weeks, "from numbers, not vibes". `/stats` could not answer
that. This adds one `seo` key and one dashboard section holding the three figures
that decision needs.

## What was added

**`supabase/migrations/20260910120000_stats_seo_surface.sql`** (new)

Follows the house pattern: `create or replace` for all three summary functions,
body copied forward from `20260829100000` (stated in the header comment, as the
convention requires), one key added.

Since `20260829100000`, only `stats_summary_range` holds a body — `stats_summary_since`
and `stats_summary_best_day` are wrappers that delegate to it. So the `seo` key is
built once and all three windows inherit it. All three are still re-declared in
this file, verbatim for the two wrappers, so the file shows the state it leaves
them in and the "did every window get it" question is answerable by reading one
file. The four `revoke`/`grant` lines are repeated per function, as every stats
migration does.

The key:

- `seo.clickOuts` — `{seoVisitors, seoClicks, plannerVisitors, plannerClicks}`.
  `visitor_day_hash` is bucketed by whether any pageview it made in the window was
  a `/things-to-do` path (`'/things-to-do'` and `'/things-to-do/:slug'` are the only
  two shapes `collect/normalise.ts` allowlists). Restricted to hashes with at
  least one pageview, which is the same population `funnel.visitors` counts, so
  the two rows are comparable to the rest of the page. Both the numerator and the
  base go back so the dashboard can refuse to print a rate on a tiny base.
- `seo.answerEngines` — distinct visitors per `referrer_host`, over an explicit
  six-host allowlist. The SQL comment says outright that this is the only
  observable GEO signal the strategy has and must not be deleted as clutter.
- `seo.toPlanner` — `{visitors, questionnaire}`. Visitors are `campaign like 'seo-%'`
  (`src/seo/render.ts` CTAs into `/questionnaire?ref=seo-<id>`, plus `seo-index`
  from the hub); "reached the questionnaire" reuses the existing `q_reached_N`
  milestones rather than inventing one.

**`src/pages/Stats.tsx`** — `Summary.seo` (optional, so the section hides itself
until the migration is applied — same rule as `questionnaireFunnel`) and a
`SeoSurface` component rendered in a new `Section`. `MIN_RATE_BASE = 30`: below
that no rate is printed at all, only the base and "not enough to rate".

**No change to `supabase/functions/stats/index.ts`.** It spreads whatever the RPC
returns, so the key flows through untouched. Its access rules were not touched.

## SQL I could not verify, and why

**Nothing in the SQL was executed.** There is no local Postgres in this
environment. I attempted a throwaway `postgres:16-alpine` container to run the
DDL against seeded fixture rows — that would have made the three figures
behaviourally verified — and the sandbox classifier refused the `docker run`.
So the migration has been verified by reading only. Specifically unverified:

1. **Syntax.** A scalar subquery containing a CTE (`'clickOuts', (with seen as (…) select …)`)
   and `bool_or`/`filter`/`having` are all standard, but nothing parsed this file.
2. **The bucketing.** `bool_or(name = 'pageview' and path like '/things-to-do%')`
   is asserted to split visitors correctly; no row was ever put through it.
3. **The `like` escapes.** `'q\_reached\_%' escape '\'` is copied verbatim from
   the migration that already runs in production, so it is the least risky line
   here; `'seo-%'` and `'/things-to-do%'` need no escape (`-` and `/` are literal).
4. **Empty-window behaviour.** `coalesce(...)` on each aggregate is intended to
   return `0` rather than SQL null when `seen` is empty. `count(*)` cannot be
   null; `sum(...) filter (...)` can, and that is the case relying on the
   `coalesce`. Reasoned, not observed.

**How to check it after `supabase db push`:** open `/stats`, and confirm the new
section appears on *all* window pills including "Best day" — that is the
partial-change failure this dashboard has had before.

## Tests

**17 new tests, all mutation-checked** (break the subject, confirm the failure,
revert). Full suite: **1623 passing**, 1 failing — `src/data/influencer-e2e.test.ts`,
the known pre-existing live-Viator-catalog failure, untouched by this branch.

### `supabase/functions/stats/summary-sql.test.ts` (new, 8 tests)

**These are TEXT CHECKS on the migration file and they cannot prove the query's
behaviour.** A wrong join, a wrong filter or an off-by-one count passes every
line in that file. The header comment says so at the top, in those words, so
nobody reads a green run as coverage of the query. What they do guard is the
text-level mistake this dashboard has actually been bitten by: a key added to one
summary function and not the others, so a metric exists on one window and
vanishes on another.

| test | mutation | result |
|---|---|---|
| declares exactly the three functions | renamed `stats_summary_best_day` | fail (2 tests) |
| names each as `index.ts` calls it | renamed the RPC string in `index.ts` | **see below** |
| builds the `seo` key | renamed the key `seoDISABLED` | fail |
| the two wrappers delegate | replaced the wrapper body with `'{}'::jsonb` | fail |
| keeps the six hosts | dropped `claude.ai` | fail |
| re-revokes and re-grants all three | deleted one `revoke … from anon` | fail |
| the GEO comment still says it | softened the wording | fail |
| no jsonb key named for a booking | renamed `toPlanner` → `conversions` | fail (2 tests) |

**The mutation check caught a defect in my own test.** The first version of
"names each as `index.ts` calls it" asserted `fn.includes(name)` over the whole
file. I renamed the RPC call in `index.ts` — and it still passed, because a
comment sixteen lines above the call still spelled the old name. That is exactly
the class of test this project keeps finding (grep a file, pass against a rule
that never fired). Rewritten to read the names out of the RPC-selecting
expression only, with a non-vacuity assertion that the slice found that
expression; it then failed under the same mutation and passes on revert.

### `src/pages/Stats.dom.test.tsx` (9 added, jsdom, existing file's pattern)

Every expected value is computed in the test, never read back from the page:
24/200 = 0.12 and 35/500 = 0.07 are written out as literals.

| test | mutation | result |
|---|---|---|
| hides itself until the migration is applied | rendered with a zeroed fallback | fail |
| rate AND base per group | `toFixed(2)` → `toFixed(3)` | fail (2 tests) |
| " (base half) | "clicks from" → "clicks of" | fail (2 tests) |
| withholds the rate on a small base | `MIN_RATE_BASE` 30 → 1 | fail |
| no small-base note when both clear | condition → always true | fail |
| never says booking / conversion / revenue | heading → "Conversion rate per visitor" | fail |
| answer engines listed per host | label → constant `'referrer'` | fail |
| " (the "not the size of it" caveat) | deleted the clause | fail |
| empty answer engines reads as nothing arrived | replaced the copy with `—` | fail |
| SEO → planner rows | relabelled the row and the percentage | fail |
| multi-day window is not people | replaced the caveat sentence | fail |

The forbidden-word test is scoped rather than blanket: the caution paragraph is
the one place "booking" may appear, because its job is to rule the claim out. The
test removes the caution's own text from the section and asserts the remainder is
clean, with a `rest.length > 400` floor so it cannot pass by checking an empty
string. A blanket page-wide check would have been vacuous anyway — the partners
section's required label already contains all three words.

## Concerns about how these figures could be misread

1. **The comparison is not surface-vs-surface, it is "touched a content page" vs
   "did not".** A visitor who read `/things-to-do/x` and then used the planner
   counts in the SEO group. That is the right attribution — the content page is
   what brought them — but it means the SEO group contains the most engaged
   visitors by construction, and its rate will read high for reasons partly
   independent of the pages. The second row is labelled "Never opened one", not
   "planner", so the page does not overclaim; the risk is somebody quoting the
   ratio as "content pages convert 2× better".
2. **Neither row is a count of people over a multi-day window.** Both are
   visitor-days, and the section's own note says the two rows can never be added
   into a monthly total. This is the standing hazard of the whole dashboard and
   this section adds two more numbers that invite the addition.
3. **It will look empty for weeks, and empty is the answer.** SEO takes 8–12
   weeks; the spec says so. Until the SEO group passes 30 visitor-days the rate
   is withheld, so the section will show "not enough to rate" for a while. That
   is working correctly, and it is the sentence most likely to be mistaken for a
   bug.
4. **`toPlanner.questionnaire` counts people who ANSWERED, not people who arrived.**
   `q_reached_2` is the first milestone that fires and it fires on answering Q1.
   A visitor who lands on the questionnaire from a content page and reads it
   without answering is in the first row and not the second. The Explain says so.
   The alternative (a `/questionnaire` pageview) would have read as a flat 100%,
   because the CTA lands them there.
5. **The answer-engine list is a judgement that will go stale.** A new assistant
   is silently absent, not zero — it falls into the general `referrers` long tail,
   which is the exact problem the allowlist exists to solve. The SQL comment says
   to add hosts as they appear.
6. **Cross-day joins do not exist in this schema.** `campaign` and `referrer_host`
   are stamped on pageviews only, so tying an arrival to a later click or
   milestone is a join on `visitor_day_hash` — which holds within a UTC day and
   not across one. Same limitation the campaigns card already carries; noted in
   the migration header.

## SEO surface: entry-page attribution (2026-09-10)

**Change.** `clickOuts` in `supabase/migrations/20260910120000_stats_seo_surface.sql`
now groups visitor-days by their EARLIEST pageview in the window (`distinct on
(visitor_day_hash) ... order by visitor_day_hash, created_at, id`, tiebroken by
the identity `id` column), not by "touched a `/things-to-do` page anywhere".
The old `bool_or` shape mechanically enriched the content group with clickers
because engagement drives both "wandered into content" and "clicked out". A
`clicks` CTE (group by visitor_day_hash, count outbound) is left-joined onto
`entry`, matching the cost profile of the file's other visitor-distinct
aggregates rather than a per-row correlated subquery.

**Exclusion preserved.** Restricting `entry` to `name = 'pageview'` before the
`distinct on` reproduces the old `having bool_or(name = 'pageview')` floor: a
hash with only outbound events never gets an `entry` row, so it's excluded
from both groups exactly as before. Empty-window `coalesce(...,0)` behaviour
is untouched — the query shape after `seen` is unchanged.

**Migration mechanics.** Amended `20260910120000_stats_seo_surface.sql` in
place rather than adding a new migration. Confirmed via `supabase db push`
history / git log that this migration has never been applied — no `db push`
has run against it, so there is no deployed state to leave stale, and shipping
a since-superseded definition under an already-applied timestamp would be the
real risk here (there isn't one).

**Dashboard copy** (`src/pages/Stats.tsx`): group labels changed to "Started
on a content page" / "Started elsewhere"; footnote now says the grouping is by
"the page their day started on ... not every page they happened to open
afterward"; added a new paragraph stating the single-touch residual limit — a
content page that only *assists* a visitor who arrived elsewhere gets no
credit, framed as an honest limit of the method, not a defect.

**Tests added.**
- `supabase/functions/stats/summary-sql.test.ts`: new test asserts
  `distinct on (visitor_day_hash)` and the `order by visitor_day_hash,
  created_at, id` tiebreak are present, and that the old
  `bool_or(name = 'pageview' and path like` shape is gone. Explicitly
  commented that this is a TEXT check — it cannot execute the query, only
  catch a structural regression back to the old shape.
- `src/pages/Stats.dom.test.tsx`: two new tests — (1) copy matches
  `/page (their|the visitor's?) day started on/i` and does NOT contain
  "touched" or "visited at any point" or "any page they opened"; (2) copy
  mentions "assist" and "no credit" (the residual-limit sentence).

**Mutation-check results (all passed as expected, then reverted):**
- Reverted SQL to `bool_or` -> `summary-sql.test.ts` new test failed (1 of 9
  failed) exactly as expected; reverted back, 9/9 pass.
- Reverted `Stats.tsx` copy to "touched"/"visited at any point" wording (no
  residual-limit paragraph) -> both new DOM tests failed (2 of 67 in that
  file) exactly as expected; reverted back, 76/76 pass across both files.

**Test count.** Full suite (excluding `.claude/worktrees/**` double-count and
the pre-existing-broken `src/data/influencer-e2e.test.ts`): 91 files, 1625
tests, all passing. `npm run build` succeeds.

**What stays unverified.** No Postgres available in this sandbox (no local
instance, `docker run` blocked) and `supabase db push` was not run — the
`distinct on` / join / coalesce SQL has NOT been executed against a real
`web_events` table. In particular unverified: that Postgres accepts
`distinct on (visitor_day_hash) ... order by visitor_day_hash, created_at, id`
inside a CTE the way written (syntax looks standard but is untested), that the
left join against the `clicks` CTE performs comparably to the other
visitor-distinct aggregates at real data volumes, and that the empty-window
case actually returns 0s end-to-end through the edge function. Verify by
running the migration and reading `/stats`.

**Concerns.** None blocking. The only judgment call worth flagging: group
labels ("Started on a content page" / "Started elsewhere") were changed from
"Read a content page" / "Never opened one" to make the entry-page semantics
honest at the label level too, not just in the footnote — no test depended on
the old label text.

---

## Executable verification against a real PostgreSQL 16 — 2026-09-10

The "What stays unverified" section above is now closed. The SQL was executed.

**Cluster.** PostgreSQL 16.15 (`/usr/lib/postgresql/16/bin`), a throwaway
cluster on a unix socket with no TCP listener. Production was never touched and
`supabase db push` was never run.

**Step 1 — schema and migration lineage.** `web_events` created from
`20260820090000_web_events.sql` unmodified except that
`create extension if not exists pg_cron` is stubbed (pg_cron is Supabase-managed
and absent from a stock apt install; a no-op `cron.schedule` stand-in lets the
retention DDL run). Roles `anon`, `authenticated`, `service_role` created as
bare NOLOGIN roles because the revoke/grant lines name them. Then all eleven
migrations touching the stats functions applied oldest-first:

```
ok 20260820093000_stats_rollups          ok 20260823240000_stats_page_visitors
ok 20260823180000_stats_summary_since    ok 20260825150000_stats_questionnaire_funnel
ok 20260823190000_stats_first_event      ok 20260825160000_stats_qfunnel_clamped
ok 20260823200000_stats_all_time         ok 20260829100000_stats_best_day
ok 20260823210000_stats_hourly           ok 20260910120000_stats_seo_surface
ok 20260823220000_stats_referrer_visitors
```

**None failed.** Twelve of twelve files, including `web_events`, applied clean.

**Step 2 — verdict: the SQL is CORRECT.** 28 assertions over hand-counted
fixtures, all PASS, zero failures. The load-bearing ones, with actual values:

| # | assertion | expected | actual |
|---|---|---|---|
| A1 | `seoVisitors` — content-page entry (`h_seo1`, `h_tie_a`, `h_tie_c`) | 3 | 3 |
| A2 | `seoClicks` | 1 | 1 |
| A3 | `plannerVisitors` | 11 | 11 |
| A4 | `plannerClicks` — `h_nonseo1`'s two clicks | 2 | 2 |
| A5 | **retired `bool_or` logic on the same rows** | 5 | 5 |
| A6 | classified visitors, `h_clickonly` excluded | 14 | 14 |
| A7 | counted clicks, `h_clickonly`'s 3 excluded | 3 | 3 |
| A9 | `answerEngines` | `[{chatgpt.com,2},{perplexity.ai,1}]` | same |
| A10 | `google.com` absent from `answerEngines` | false | false |
| A11 | `toPlanner.visitors` (four `seo-*` campaigns) | 4 | 4 |
| A12 | `toPlanner.questionnaire` | 1 | 1 |
| A13-A19 | empty window: every figure 0, `[]`, `{visitors:0,questionnaire:0}`, no JSON nulls, no error | — | as expected |
| A20-A22 | `range` / `since` / `best_day` all carry the `seo` key | true | true |
| A23 | `best_day` picked the right day | 2026-09-01 | 2026-09-01 |
| A24-A25 | `best_day` and `since` `seo` blocks equal `range`'s | — | byte-identical |
| A26 | tie determinism, 8 runs x 7 planner configs | never flips | never flips |
| A27-A28 | no stats function executable by public/anon/authenticated; all executable by service_role | 0 / 0 | 0 / 0 |

**A5 is the point of the change.** `h_nonseo1` enters on `/`, opens
`/things-to-do/:slug` afterwards, and clicks out twice. The shipped first-touch
SQL puts them in the planner group. On the identical rows, the retired
`bool_or(path like '/things-to-do%')` logic returns **5** SEO visitors where the
new logic returns **3** — the two extra are exactly `h_nonseo1` and `h_tie_b`,
the visitors who merely wandered into a content page. The old query would have
credited content with `h_nonseo1`'s 2 click-outs; the new one does not.

**Mutation-checked, twelve mutants, twelve killed.** Every assertion above was
walked through by deliberately breaking the migration and confirming the suite
goes red: last-touch ordering (3 red), dropping the `id` tiebreak (3 red),
dropping the `name = 'pageview'` filter from `entry` (5 red), widening `on_seo`
(5 red), counting visitors instead of clicks (3 red), inner-joining the clicks
CTE (4 red), removing and adding an answer-engine host (1 and 2 red), loosening
the `seo-%` campaign pattern (2 red), matching any milestone instead of
`q_reached_%` (1 red), dropping the underscore `escape` (1 red), and counting
non-distinct milestone rows (1 red). Three of those survived the first fixture
set and are the reason the fixtures now include a 2000-row `created_at` tie, a
second milestone for one visitor, and a `qareachedb3` milestone. The migration
file was restored byte-for-byte after each mutation (`git status` clean).

**Two things measured that the assertions do not assert.**

1. `path` is never null for a pageview — `collect/normalise.ts::normalisePath`
   returns `'other'` rather than null, so the three-valued-logic hole in
   `count(*) filter (where on_seo)` / `filter (where not on_seo)` cannot be
   reached in production. Worth knowing because a null `path` would drop a
   visitor from BOTH groups silently.
2. `like '/things-to-do%'` cannot over-match: `KNOWN_PATHS` holds exactly
   `/things-to-do`, and the only other shape is the collapsed
   `/things-to-do/:slug`.

**One PRE-EXISTING observation, not a bug in this migration, not fixed.**
`stats_summary_best_day()` picks the day with session-timezone
`created_at::date` but builds the window bounds with `at time zone 'utc'`. Under
a non-UTC session those disagree. Measured: with 30 pageviews at
`2026-09-03 02:00Z` and the session at `America/New_York`, the function returned
`bestDay = 2026-09-02` with every figure inside it zero — it named a day whose
events the window then excluded. The `best_day` body is byte-identical to
`20260829100000_stats_best_day.sql` (diffed), so this arrived there, not here,
and the migration under test copies it verbatim as its header says. It is inert
on Supabase, where the session timezone is UTC. Left alone deliberately: fixing
it is out of scope for the `seo` key and belongs in its own change.

**Step 4 — the capability is committed.** `tools/run-verify-stats.cjs` plus
`tools/verify-stats-sql.sql`. Self-contained: it finds a local postgres, runs
`initdb` into a temp directory, applies `*web_events*.sql` and every
`*stats*.sql` in filename order, runs the assertions, prints a PASS/FAIL table,
tears the cluster down and exits 1 on any failure. No docker, no network, no
credentials. Its header states plainly that it needs a local PostgreSQL SERVER
install (`postgresql`, not `postgresql-client` — the latter has no `initdb`) and
exits 2 saying so if one is absent; it never falls back to a remote database,
because the fixtures begin by truncating `web_events`. Verified end to end: exit
0 clean, exit 1 on a seeded failure, no leftover cluster directories.

    node tools/run-verify-stats.cjs          # from the repo root
    node tools/run-verify-stats.cjs --keep   # leave the cluster up to poke at

**Cluster disposition.** The harness tears down its own cluster every run. The
pre-existing scratch cluster at `/tmp/pgseo/data` (port 5433) was LEFT RUNNING,
with a `seostats` database in it holding the fixtures.
