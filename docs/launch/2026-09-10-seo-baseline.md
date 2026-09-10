# SEO baseline — day zero

Recorded **2026-09-10, ~17:15 UTC**, a few hours after the SEO surface went live
at `7935a55`. Measured from `stats_summary_since` against the real production
database, not estimated.

**Why this file exists.** The strategy
(`docs/superpowers/specs/2026-09-10-seo-geo-strategy-design.md`) commits to a
decision at roughly six weeks: expand the content surface or cut it, *"from
numbers, not vibes"*. A decision like that needs a before. Everything SEO below
is zero by construction — that is the point. Compare against this file, not
against memory.

**Review this around 2026-10-22** (six weeks out).

---

## What was live at the moment of measurement

- 58 generated pages + `/things-to-do/` hub, deployed
- `sitemap.xml` — 65 URLs, `application/xml`
- `robots.txt` — `text/plain`, AI crawlers explicitly allowed
- Google Search Console — verified, sitemap submitted
- Bing Webmaster — imported from GSC, sitemap submitted
- IndexNow — 65 URLs submitted, HTTP 202 accepted
- `collect` edge function — deployed with `--no-verify-jwt`, recording
  `/things-to-do` under its own path
- Live bundle: `index-BwmUZ9NH.js`

## The SEO figures — all zero, as expected

| figure | value |
|---|---|
| `seo.clickOuts.seoVisitors` | **0** |
| `seo.clickOuts.seoClicks` | **0** |
| `seo.toPlanner.visitors` | **0** |
| `seo.toPlanner.questionnaire` | **0** |
| `seo.answerEngines` | **[]** (empty) |
| `campaigns` | **0 entries** — no `seo-*` refs yet |

Zero is correct: the pages had existed for hours and no crawler had yet sent
anyone. Any non-zero value here at review time is net new.

## The comparison denominator — the planner as it stands today

These are what the SEO numbers get measured *against*. If content pages are
working, `seoVisitors` grows without these collapsing.

| figure | value |
|---|---|
| `seo.clickOuts.plannerVisitors` | 475 |
| `seo.clickOuts.plannerClicks` | 32 |
| click-outs per planner visitor | **0.067** |

Note `plannerClicks` 32 vs `allTime.outbound` 33: one outbound event belongs to a
visitor-day with no pageview, which the segmentation deliberately excludes from
both groups.

## Whole-site totals (all time, first event 2026-08-23)

| figure | value |
|---|---|
| views | 1,446 |
| visitor-days | 475 |
| outbound clicks | 33 |
| busiest day | 2026-08-28, 66 visitors |

**`visitor-days` is a DAILY identity and must never be summed into a "monthly
unique".** See `src/lib/beacon.ts`.

## Funnel and traffic mix at baseline

- Funnel: 475 visitors → 209 questionnaire → 277 generated → 32 kept → 28 clicked out
- Questionnaire: 186 viewed → 172 started → 168 reached Q8
- Top paths: `/` (369 visitors), `/itinerary` (296), `/questionnaire` (234), `/explore` (79)
- Referrers: google.com 28, com.reddit.frontpage 23, l.instagram.com 9
- Countries: US 302, CA 54, NL 41, AW 34
- Partners: viator.com, 33 clicks
- Top product: `6841POOL`, 11 clicks from 8 visitors

**No `/things-to-do` in top paths, and no answer-engine referrers** — the two
absences this file exists to make measurable.

---

## What to compare at review, and what a result would mean

1. **`seoVisitors` and `seoClicks`.** Still 0 means nothing is being crawled or
   nothing is ranking — check Search Console coverage before concluding the pages
   are bad.
2. **Click-outs per visitor, SEO vs planner** (planner baseline 0.067). This is
   the figure tied to the goal. Segmentation is by ENTRY page, so a content
   reader who later plans a trip does NOT inflate the SEO side.
3. **`answerEngines`.** Any non-zero value is the first evidence the GEO half
   works at all. Expect small numbers; they are still signal.
4. **`toPlanner`.** Whether content pages feed the planner or dead-end.

**Expect little before 8–12 weeks.** A flat reading at week three is the normal
shape of SEO, not evidence of failure. The honest failure signal is Search
Console showing pages crawled and indexed while impressions stay at zero — that
would mean they rank for nothing, which is a content problem rather than a
plumbing one.

## What this can never show

**Revenue.** Viator returns no booking signal, so click-outs are the ceiling.
Tying these to money is a manual monthly join against the Viator partner
dashboard, and no figure in `/stats` should ever be described as a booking.
