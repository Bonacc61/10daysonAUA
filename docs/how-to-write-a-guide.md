# How to write a guide

For the editorial layer at `/guides/`. Not generic SEO advice — this is specific
to what this site owns and what it is trying to win.

**The premise:** the 58 pages under `/things-to-do/` are supporting pages,
median 154 words. They earn long-tail queries at best. Guides are what target
queries with real volume, and what the data pages link up to. A guide that reads
like a longer data page has failed.

---

## Step 1 — Pick the QUERY, not the topic

Write down the exact phrase someone types. Not "boat tours" — *"best boat tours
in Aruba"*, *"is the Antilla wreck worth it"*, *"Aruba with a toddler"*.

Then ask the question that decides whether to write at all:

> **What can we say that someone selling the thing cannot?**

If the answer is nothing, do not write the guide. A page that repeats the
consensus has no reason to outrank the ten pages already saying it.

The snorkeling guide passes because it says *the free beach is often better than
the boat*, which no tour operator will publish. That is not a stylistic choice —
it is the entire reason the page can rank and be cited.

## Step 2 — Audit what we own before drafting a sentence

Never write from memory. Pull the real numbers first:

- `src/data/reviewBreakdown.json` — combined Viator + Tripadvisor histograms.
  The **five-star share** is the interesting number, not the average: 4.6 made
  of consistent fours is a different product from 4.6 that is mostly fives with
  a handful of furious ones.
- `src/data/startTimes.json` — real departure times.
- `src/data/enrichment.json` — minimum age, `baby_ok`, physical demand,
  swim-required.
- `ACTIVITIES` in `src/data/activities.ts` — the hand-written `localsSay` lines.
  This is the only prose on the site that exists nowhere else on the internet.
- `content/slugs.json` — which pages exist to link to.

**Never publish the curated `rating`/`reviewCount` fields.** They are editorial
weights no platform backs (`activities.ts:26`). Publishing them is fabricated
review data.

## Step 3 — Find the corroboration

The strongest thing this site can do is **confirm local knowledge with
independent data**. It is rare, it is quotable, and no competitor can copy it
without the same two sources.

The snorkeling guide's best moment: Edsel's line *"get in before the catamarans
arrive around 10"* set against the operators' own published departure times of
09:00–09:30. A human tip verified by a schedule. Hunt for these deliberately —
one per guide is worth more than a thousand words of description.

## Step 4 — Structure: verdict first, always

    H1 — the query, phrased as a person would say it
    Verdict paragraph — the answer, in the first 100 words, unhedged
    The honest counter — when the verdict does NOT apply
    The comparison — a table built from real numbers
    Our pick — one recommendation, and why
    Common questions — 5-8, each a direct question with a direct answer
    Links down to the data pages, and one planner CTA

**The first 100 words carry the page.** They are what a reader skims, what
Google may lift as a snippet, and what an answer engine quotes. Burying the
conclusion under three paragraphs of scene-setting throws away the page's most
valuable real estate.

## Step 5 — Write for extraction (this is the GEO half)

Search engines rank pages. Answer engines lift **sentences**. Those need
different things, and the second is where the leverage is right now.

**Make claims self-contained.** An answer engine quotes one sentence without its
context. *"Tres Trapi has green turtles reachable from shore, free"* survives
being lifted. *"It's great for turtles"* does not.

**Attach numbers to claims.** *"99% five-star from 212 reviews"* gets cited;
*"very highly rated"* gets paraphrased from whoever said it first. Specific,
checkable figures are what make a page worth naming as a source.

**Take a position and do not hedge it.** *"You do not need to book anything"* is
quotable. *"Some visitors may find that shore snorkeling can be a good option"*
is not. Hedging is how a page becomes unciteable.

**The FAQ block is the highest-value part of the page.** Write it last, when you
know what the guide actually argued. Rules: a real question someone types, a
direct answer in the FIRST sentence, elaboration only after. It becomes
`FAQPage` JSON-LD automatically.

**Name things exactly.** "Tres Trapi", "the Antilla", "Mangel Halto" — consistent
naming is how an engine connects scattered mentions to one entity, and to us.

## Step 6 — Length and density

**1,200–2,000 words.** Below ~800 it competes with the data pages instead of
outranking the competition. Above ~2,500 it usually means two guides.

Every paragraph should carry a fact, a number, or a judgement. If a sentence
could appear on any Aruba blog, cut it. The test: *would a competitor's writer
be annoyed that we published this?* If not, it is filler.

## Step 7 — Wire the links

Guides sit at the **top** of the crawl path: hub → guide → data pages.

- Link down to every data page you discuss, by slug.
- Reference products in frontmatter by **registry ID**, not slug — ids never
  change, slugs can be regenerated. Every id is checked at build time, so a typo
  fails the build instead of shipping a dead link.
- Annotate the ids with a `#` comment. `472918P1` means nothing to a human.
- One planner CTA, tagged `?ref=seo-guide-<slug>`, so `/stats` can tell whether
  the guide fed the planner.

## Step 8 — The edit that only a human can do

Everything above can be drafted from data. This step cannot.

Check every **factual** claim that is not from a file: prices, distances, times,
seasonality, and above all **anything safety-related**. The Mangel Halto current
warning is a real hazard, not a stylistic note — softening it into prose is the
kind of edit that gets someone hurt.

Then read it aloud. The site's voice is plain and specific: short sentences,
no marketing register, no "nestled" or "gem" or "must-see".

## Step 9 — Publish and watch

Flip `status: draft` → `status: published`. That is the only gate; the build
emits nothing until it flips.

Then check in Search Console after 2–4 weeks: **impressions before clicks**. A
guide that gets impressions but no clicks has a title/description problem, which
is cheap to fix. A guide with no impressions is not ranking at all, which is a
content problem, and the fix is a better angle rather than more words.

---

## What never goes on a guide

- **Any figure described as a booking, conversion or revenue.** Viator returns
  no booking signal. Click-outs are all we can ever measure.
- **Curated `rating`/`reviewCount`** — editorial weights, not platform ratings.
- **`aggregateRating` in JSON-LD** — Google's review-snippet policy requires
  first-party ratings; ours are Viator's and Tripadvisor's.
- **Per-platform ratings as the headline number.** Always the combined figure —
  it is what the booking page shows, and a visitor who clicks through must not
  meet a different number than the one that sent them.

## The four still to write

1. **Best boat tours & sunset sails** — highest commission density, and the repo
   already holds real judgement (the day-sail/evening-cruise split, the vouched
   Jolly Pirates pick).
2. **Natural Pool: jeep tour or drive yourself?** — a decision-shaped query the
   engine already committed to an answer on.
3. **Aruba with kids** — powered by per-product minimum ages and `baby_ok`,
   which no competitor has.
4. **10 days in Aruba** — the domain-name query and the planner's front door.

Write them one at a time. If the voice is wrong, better to find out on one than
on four.
