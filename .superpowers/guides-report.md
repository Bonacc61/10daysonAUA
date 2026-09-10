# The guides pipeline

Branch `feat/seo-guides`, off `main` at `ea358d4`.

## What was built

**`src/seo/guides.ts`** — `content/guides/<slug>.md` in, a parsed `Guide` out.
Frontmatter (a small, strict subset of YAML: scalars and `- ` lists), body
rendered by **`marked` v18**, added as a **devDependency**. `marked` is imported
only from `src/seo/guides.ts`, which nothing in the app's import graph reaches —
verified in `dist/`: the two occurrences of the string "marked" in the app
bundle are content ("Stay on marked trails in Arikok", "half the cave paintings
are unmarked"), not the library. App bundle size is unchanged at 975.55 kB
(269.93 kB gzipped); the only difference against a build without this branch's
CSS edit is the fingerprinted stylesheet name inside the preload map.

Not hand-rolled, deliberately. The first guide has an 8-row table, four
blockquotes, six rules and `**bold**` inside table cells. A bespoke parser does
not *fail* on those — it silently emits wrong HTML on a page nobody re-reads.

**The status gate.** Only `status: published` is emitted. Anything else is
skipped and named on stdout:

    seo: guide "snorkeling-free-vs-paid" NOT published — status: draft.
    seo: 0 guide(s) published, 1 skipped as unpublished.

A status the parser does not recognise is an **error**, not a skip — the parser
refuses to guess whether `ready-ish` means publishable. Missing required
frontmatter (`title`, `description`, `date`, `status`) throws and names the
field; so does an unknown key, because `product:` for `products:` would
otherwise silently drop the list that referential integrity is checked against.

**`renderGuidePage`** in `src/seo/render.ts`, beside the other three: the app's
fingerprinted stylesheet, breadcrumbs (`/` › `/things-to-do/` › title),
canonical at `/guides/<slug>/`, the inlined beacon, a freshness line. JSON-LD is
`Article` + `BreadcrumbList` + `FAQPage`; **no `aggregateRating` anywhere**, and
no `author` either — whether these carry a byline is still open in the spec, and
a fabricated one is worse than none.

The ref is `seo-g-<slug>`, not `seo-guide-<slug>`: the latter is 33 characters
for the first guide and the collect allowlist
(`supabase/functions/collect/normalise.ts`) caps at 32. `assertSafeRef` now
checks **every** ref on a page rather than the first, because a guide body is
hand-written markdown that can carry its own.

**Referential integrity, two layers.** The frontmatter ids must all have earned
a page in this run; and every `/things-to-do/` link in the *rendered* guide must
resolve to a slug this build actually wrote. Both fail the build, naming the
guide and the offending id.

**Wiring** (`tools/build-seo.ts`): published guides are written to
`dist/guides/<slug>/index.html`, added to `sitemap.xml` and to `llms.txt` under
a `## Guides` heading *above* Things to do, and listed on the `/things-to-do/`
hub under "Start here", above the activity list. Guides are the top of the crawl
path.

**`.github/workflows/deploy.yml`** — `find things-to-do guides -name index.html`
(was `things-to-do` alone). Guide pages carry exactly the hazard the comment
there describes: fixed-width CSS hash and build date mean an updated page can be
byte-identical in size, so lftp's mirror skips it while `--delete` removes the
stylesheet it referenced. `2>/dev/null` because `dist/guides` legitimately does
not exist while every guide is a draft.

## The draft stayed a draft

`content/guides/snorkeling-free-vs-paid.md` is committed **verbatim, unedited,
`status: draft`**. `dist/guides` does not exist after `npm run build`. A test
asserts the file's status is still `draft`, so flipping it is a deliberate act
that turns the suite red first.

## What the temporarily-published guide rendered like

Flipped to `published` in the working tree, built, inspected, reverted (the file
now diffs clean against the pre-flip copy).

First build **failed**, correctly:

    Error: seo: guide "snorkeling-free-vs-paid" references 12 id(s) with no
    generated page: dolphin-catamaran-snorkel-and-sail-with-open-bar, ...

**A real finding for the owner:** the draft's `products:` and `curated:` lists
hold *slugs*, not registry ids — twelve of the thirteen entries. And
`boca-catalina-shore` is a genuine curated id that has **no page**: its
`localsSay` is empty, so the quality floor holds it out. That is precisely the
dead-link case, caught at build time. The one correct entry, `5593159P4`,
resolves to `clear-kayak-experience` — which is not a snorkeling product, so it
looks like a stray too.

With the ids temporarily mapped to registry keys (and `boca-catalina-shore`
dropped), the build printed `39 product + 19 curated pages + index, 1 guides, 66
sitemap urls` and produced a 14 KB document:

- H1 from the frontmatter, one only, matching `<title>`, breadcrumb and JSON-LD.
- 1 `<table>` inside `<div class="seo-scroll">`, with `<td><strong>99%</strong></td>`
  — nested inline formatting in a cell, intact.
- 4 `<blockquote>` (Glennis, Edsel, Orlando, Miguel), 6 `<hr>`.
- 4 internal links, all resolving: `tres-trapi-turtle-cove`,
  `malmok-beach-snorkel`, `mangel-halto-lagoon`, `baby-beach-snorkel-lagoon`.
- Two planner refs, `seo-g-snorkeling-free-vs-paid` and the author's own
  `seo-guide-snorkeling` from the body — both inside the allowlist.
- FAQPage with all **6** questions from "Common questions", each answer reduced
  to plain prose. No `aggregateRating`.
- Hub: `Start here` section above the 58-item list. `llms.txt`: `## Guides`
  first. Sitemap: 66 urls, up exactly one.

Reverted, rebuilt: 65 sitemap urls, `dist/guides` absent.

## The 360px check

Chromium via Playwright against `vite preview --port 4325`, the temporarily
published guide:

| viewport | documentElement.scrollWidth | clientWidth |
|---|---|---|
| 360 | **360** | 360 |
| 390 | **390** | 390 |

The table is 471px inside a 328px `.seo-scroll` box with `overflow-x: auto`. With
that one property forced back to `visible` in the same session, the same page
measured **scrollWidth 487** — the classic mobile overflow, confirmed present
and confirmed fixed. `/things-to-do/` and a data page were measured alongside
and were unaffected (360 = 360).

The wrapper is emitted in the *markup* by a `marked` renderer override, because
a `<table>` cannot scroll itself. Screenshot check: the comparison table scrolls
inside its own box, first column wrapping, numeric columns on one line.

## Mutation checks

Every one: break it, confirm red, revert, confirm green.

| mutation | result |
|---|---|
| draft guide flipped to `published` | 3 tests fail |
| status gate removed from the generator (probe guide with valid ids) | draft reaches `dist/guides/`, 2 integration tests fail |
| required-frontmatter check made a no-op | 4 tests fail |
| status-value validation removed | 1 test fails |
| unknown product id in a published guide | build exits 1, naming guide and id |
| ...same input, `assertKnownRefs` neutered | build succeeds — the guard, not something else, was the cause |
| body link to a slug never built | build exits 1, naming the URL |
| table scroll wrapper removed | 2 tests fail |
| FAQ `?` filter dropped (a bold non-question becomes an FAQ) | 1 test fails |
| hub lists guides below the activities | 1 test fails |
| `FAQPage` emitted with zero questions | 1 test fails |

## Verification

- `npx vitest run` — **1696 passed, 97 files**, 0 failed.
- `npm run typecheck` — clean.
- `npm run build` — exit 0, `39 product + 19 curated pages + index, 0 guides, 65
  sitemap urls`.
- `CI=true npm run build` — exit 0.
- `src/data/seoCatalog.json` and `content/slugs.json` — unchanged.
- `src/data/influencer-e2e.test.ts` — 2 passed.
- Build stayed offline; no `seo:refresh`, no `npm run dev`.

## Concerns

1. **The draft's frontmatter is wrong** (slugs where ids belong, one id that has
   no page, one unrelated product). Not fixed here — the file is the owner's
   unedited writing. It will fail the build the moment it is published, with a
   message that says exactly which lines to change.
2. **A guide referencing a product that later leaves the catalog fails the
   build.** Deliberate — the alternative is a hub advertising a trip nobody can
   book — but it means a `seo:refresh` can break `main`'s build until the guide
   is edited. Loud and recoverable, which is the trade this repo makes elsewhere
   too.
3. **The FAQ renders as run-in bold**, because that is how the draft is written
   (`**Question?**` then the answer). The extraction handles both that and
   `### Question` + paragraph, and the JSON-LD is correct either way — but if
   semantic `<h3>` questions are wanted in the visible HTML, the guides should
   be written with headings rather than the renderer rewriting them.
4. `content/guides/` was untracked; it is committed on this branch, draft intact.

---

# Follow-up: comments in frontmatter, and tolerating a broken draft

Both changes came from the owner actually using the pipeline; the build guard
named the exact line in each case.

## Change 1 — comments

- **Full-line comments** (first non-whitespace character `#`) are skipped
  anywhere in the block, including between list items, where they must not
  close the open list.
- **Trailing comments on list items only**: stripped from the first ` #`, then
  trimmed. `- 472918P1      # Award-Winning Private Turtle Snorkeling` yields
  `472918P1`.
- **Scalars are left alone, deliberately.** `title:` and `description:` are free
  text; `title: "Aruba on a budget: the #1 question"` is a legitimate title, and
  truncating it at the hash would be a quiet bug surfacing weeks later as a
  mysteriously short `<title>`. The reasoning is commented at the scalar branch
  and at `stripTrailingComment`, and a test proves a `#` survives in both
  `title` and `description`.

## Change 2 — a malformed draft must not block a deploy

`loadGuide()` in `src/seo/guides.ts` wraps `parseGuide`. On failure it consults
`looksLikeDraft()` over the RAW frontmatter — crude by necessity, because
`status` lives inside the frontmatter and a file that will not parse cannot be
asked whether it is a draft. If it looks like a draft: warn on stderr naming the
file and the problem, skip it, build succeeds. Otherwise: rethrow, build fails.

The marker regex is deliberately lenient (`status: draft   # still editing`
counts) but is scoped to the fenced block, so the word cannot be picked up out
of the prose. Every direction it errs in is the safe one: a false positive skips
a page that was never going to publish; a false negative fails the build, which
is the behaviour that already existed.

Recorded at the code: an invalid draft costs a warning nobody has to act on
today; a blocked build costs every deploy until someone finds it. Same asymmetry
as the pid/mcid skip in `tools/build-seo.ts`.

`src/seo/integration.test.ts` now reads guides through `loadGuide` too, so the
test's expectation of `dist/` matches what the generator actually does.
`guides.test.ts` stays stricter — it still requires every COMMITTED guide to
parse, because a broken guide in the repo is worth a test failure even though it
is not worth a blocked deploy. That difference is commented.

## Verification

- **(a)** The draft as it now stands, with `#` comments: `npm run build` exit 0,
  `39 product + 19 curated pages + index, 0 guides, 65 sitemap urls`,
  `dist/guides` absent.
- **(b)** Flipped to `published`: builds, emits
  `dist/guides/snorkeling-free-vs-paid/index.html` (14,087 bytes), sitemap 66,
  all four `/things-to-do/` links resolve to files on disk, FAQPage with 6
  questions, no `aggregateRating`. Reverted; `git diff` shows `status: draft` as
  an unchanged context line.
- **(c)** A draft with `title:` deleted: build **succeeds**, warning names the
  file and the problem. Mutation — draft-skip removed — build exits 2. Second
  mutation, `looksLikeDraft` forced true (a broken PUBLISHED guide would be
  silently skipped): 4 tests fail.
- **(d)** A published guide with an unknown product id: build exits 1, naming
  guide and id. Still holds.
- **(e)** `title: "Ref probe: the #1 check"` rendered as `<title>Ref probe: the
  #1 check — 10 days on Aruba</title>`, the same in `<h1>` and in the Article
  `headline`.

Comment-support mutations, each caught: full-line skip removed (4 fail),
trailing strip removed (1), trailing strip wrongly applied to scalars (1),
draft marker unscoped from the fence (1). All reverted, 31 green.

`npx vitest run` 1705 passed / 97 files. `npm run typecheck` clean.
`CI=true npm run build` exit 0. `seoCatalog.json` and `slugs.json` untouched.
