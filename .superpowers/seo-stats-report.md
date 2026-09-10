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
