# SEO and GEO: publishing what we already know

**Status:** design, not built.

**Date:** 2026-09-10

**Goal, chosen by Jan:** organic traffic that produces **Viator bookings**.
Not planner signups, not audience. Every decision below is judged against
click-outs to Viator.

---

## The situation, measured

Probed live on 2026-09-10 against production (`index-DmUJTFYN.js`):

| fact | evidence |
|---|---|
| The served HTML is an empty shell | `curl https://10daysonaruba.com/` returns `<div id="root"></div>` and a module script. Nothing else. |
| No `robots.txt` | `GET /robots.txt` → **200 `text/html`**. The `.htaccess` SPA fallback is serving `index.html`. |
| No `sitemap.xml` | `GET /sitemap.xml` → **200 `text/html`**. Same cause. Worse than a 404: it is an invalid sitemap, not an absent one. |
| All 11 routes share one `<title>` | `PAGE_TO_PATH` in `App.tsx:66` maps 11 paths; nothing ever writes to `document.head`. To a crawler the site is one page repeated. |
| The homepage *is* indexed | It surfaces for "10 days on aruba itinerary planner" alongside Tripadvisor, Shades of Summr and Wonderplan. One URL of surface. |
| Traffic is measurable | `VITE_COLLECT_FN_URL` is set — the cookieless beacon is live and `/stats` holds a real baseline. PostHog remains empty by choice. |

**The one-sentence root cause:** every page worth ranking either does not exist
or is not reachable without executing JavaScript.

### Why that matters twice

Google renders JavaScript, eventually, on a deferred second pass. **Most AI
crawlers do not** — GPTBot, ClaudeBot, PerplexityBot and the retrieval fetchers
behind answer engines largely read the first response and stop. Today they see
an empty div. Static HTML therefore fixes SEO and GEO in the same stroke, and is
the more decisive of the two for GEO.

---

## The asset nobody else has

The wedge is not writing. It is data already committed to this repo:

| file | rows | what it holds |
|---|---|---|
| `src/data/reviewBreakdown.json` | **322** | Per product, **both** Viator and Tripadvisor: review count, average, and the 5-bucket star histogram. |
| `src/data/enrichment.json` | 354 | Facets: minimum age, `baby_ok`, physical demand, swim required, indoor/outdoor, adventure score. |
| `src/data/startTimes.json` | 281 | Real departure times. |
| `src/data/whatToExpect.json` | 89 | Viator's per-product itinerary text. **Input, not output** — see invariants. Also the **binding constraint on page count**. |
| `src/data/activities.ts` → `ACTIVITIES` | **26** curated locals, **19** with hand-written `localsSay` | Original editorial. Exists nowhere else on the internet. |
| `src/data/itemCoords.ts` | — | Verified coordinates, pin-reviewed. |

Nobody publishes this distribution in one comparable place across 322 products.
The value is the aggregation and the shape, not the datum: an average of 4.6
hides whether that is everyone agreeing or a bimodal split between delighted and
furious, and the histogram answers **is this worth my money** with something
citable rather than paraphrasable. That is simultaneously the SEO differentiator
and the GEO one.

**One constraint on how it is shown**, carried over from the app and binding
here: the headline rating is the *combined* figure, because that is the number
on the Viator page the visitor lands on. See the data-page spec below.

---

## Chosen shape

**Static content pages generated beside the SPA.** A post-build generator emits
plain HTML into `dist/`. No React on those pages. They link the app's own
fingerprinted stylesheet (resolved from the Vite manifest) and CTA into the
planner.

Rejected, and why:

- **Prerender the React app** (headless Chromium over every route). 300+ renders
  per CI build; ships the full bundle (418 KB gzipped, already a measured
  problem — `App.tsx:8`) to exactly the pages where bounce punishes it;
  hydration-mismatch bugs; and `PATH_TO_PAGE` is a flat string map, so dynamic
  segments mean rewriting the router of a live product. It degrades the thing
  we are trying to make fast.
- **Technical SEO only.** Not a rival — it is Phase 0 of any version of this.

**Rationale:** the content surface is read-only. It is documents, not app.
Putting documents inside the SPA buys component reuse and pays in load time, CI
fragility and router surgery.

**Accepted trade-off:** this optimises depth over volume. It will lose on raw
keyword surface to 300-page programmatic competitors for some months. Taken
deliberately — the deindex risk on the volume play is existential, and this one
compounds.

---

## Invariants

Violating any of these is a bug, and each has a test.

1. **Every outbound Viator link carries `pid=P00302487&mcid=42383`**, via
   `viatorLink()`. Same invariant as the app (`.claude/CLAUDE.md`).
2. **Editorial ratings are never published as platform ratings.** `rating` and
   `reviewCount` on `ACTIVITIES` are curation weights — `activities.ts:26` says
   so: *"NOT a platform rating… no TripAdvisor or Viator listing backs them."*
   They may order pages. They may **never** be rendered, and never appear in
   JSON-LD. A star renders only where `ratingSource === 'viator'` or the
   histogram supplies it.
3. **A URL, once published, is never reused for different content.** Slugs come
   from a committed registry, not from titles.
4. **No build-time network access.** The build must stay offline and
   deterministic (repo rule: network and API keys live in hand-run `tools/`
   scripts).
5. **`specialNotes` and traveller-typed text never reach a generated page.**
   Nothing here reads user data; the invariant is stated so it stays true.

---

## URL architecture

Two prefixes, deliberately only two:

- `/things-to-do/<slug>/` — one page per activity that clears the quality floor.
  Catamaran sail, Baby Beach and Zeerovers all share the pattern. No category
  subtrees: taxonomy debates and redirect churn, zero ranking benefit.
- `/guides/<slug>/` — the hubs.

The prefix split keeps sitemap segmentation, robots rules and beacon reporting
trivial: `/guides/*` is editorial, `/things-to-do/*` is data.

**Mechanics**

- Directory-style URLs (`<slug>/index.html`) so Apache serves real files. The
  existing `RewriteCond %{REQUEST_FILENAME} !-f` passes them through untouched —
  the SPA fallback never sees them. No `.htaccess` change needed for routing.
- `content/slugs.json` is the slug registry, keyed by Viator product code or
  curated `id`. Viator retitles products; a retitle must not move a URL.
- Canonical on every page, with trailing slash.
- **A vanished product keeps its URL.** It drops out of the sitemap and its CTA
  swaps to the nearest live alternative, chosen by the cluster data the engine
  already computes. Deleting URLs discards equity for tidiness.

### Quality floor

No page per product for all 327. A page whose only unique content is a histogram
is thin, and 300 of those is precisely the pattern Google's scaled-content
policy demotes.

**A Viator product earns a URL when all three hold:**

1. `reviewBreakdown` carries **both** platforms (Viator *and* Tripadvisor), and
2. `whatToExpect` carries prose for it — real text to summarise, and
3. total reviews across both platforms **>= 25**, reusing `MIN_CHAMPION_REVIEWS`
   (`itineraryGenerator.ts:133`, mirrored in `catalog-drift.ts:43`) rather than
   inventing a second threshold. Below it a histogram is noise.

**A curated local earns a URL when `localsSay` is non-empty** — 19 of 26. The
other 7 carry only a description and would be thin.

**Measured against the committed snapshots on 2026-09-10: 39 + 19 = 58 pages.**
The generator recomputes this and prints it at build, so the number is watched
rather than assumed.

#### Floors considered and rejected

| floor | pages | why not |
|---|---|---|
| both platforms + (`whatToExpect` **or** `startTimes`) | **246** | What this spec said in its first draft. `startTimes` covers 281 products, so the "or" waves nearly everything through — and a departure time is not unique content. The floor did not bind. |
| add high-volume products without prose (>=200 reviews) | **135** | Adds 77 pages that are a facts table plus a histogram, with no prose. Defensible individually, samey in bulk. **Held as the Phase 3 expansion**, taken only if the 58 are measurably earning. |

Starting tight and loosening from measurement is the whole point: a page removed
after indexation costs equity, a page never published costs nothing.

#### The right way to grow past 58

`whatToExpect.json` covers **89 of 327** products, and it is the binding
constraint — not the review floor. The lever is therefore **more prose, not a
lower bar**: `/products/{code}` returns `itinerary.activityInfo.description`
and is in our Basic access tier (`.claude/CLAUDE.md`). One call per product is
too slow for the ingest, which is exactly why these live in committed snapshots
— but a `tools/` script run by hand can extend the snapshot at leisure.

Every product moved into `whatToExpect` that already clears the other two
conditions becomes a page that deserves to exist. That is a better expansion
path than admitting thinner pages, and it is bounded by Viator's rate limits
rather than by editorial risk.

### Crawl path

Homepage footer → hubs → data pages → back to hub, plus a planner CTA tagged
`?ref=seo-<slug>` so the beacon can attribute organic → planner → Viator. No
orphans: the sitemap is a promise, the internal links are the proof, and a test
asserts every sitemap URL is linked from at least one other page.

---

## The data page

Every block traces to data we own.

1. **Title + one-line framing**, generated from facets ("Catamaran sunset sail,
   2.5h, departs 17:30, easygoing"). Not Viator's marketing copy.
2. **The honest-ratings block — the centrepiece.** Headline is
   `combinedBreakdown(id)` — the summed figure, matching both the app's cards
   and what the traveller will see on the Viator page they land on. Below it,
   the 5-star histogram as accessible HTML bars.

   **The per-platform split is secondary and conditional.** It renders only
   when the platforms disagree by **>= 0.3**, under an explicit heading
   ("where these reviews come from"), never as the headline number.
   `reviewBreakdown.ts:50` explains why: *"Showing Viator's 157 beside
   TripAdvisor's 55 was accurate and still wrong: the page says 212, so a card
   saying 157 reads as stale data even though both numbers are right."* That
   reasoning holds here too — a visitor clicking through must not find a
   different number than the one that sent them. Framing the split as
   provenance rather than as the rating keeps the existing rule intact while
   still saying the thing no competitor says.
3. **Practical facts table:** duration, start times, minimum age, `baby_ok`,
   physical demand, swim required, indoor/outdoor, location. **Price only if the
   catalog value proves non-zero at build** — `viator-cards` has been sending
   `price_usd: 0` (`activitySource.ts:262`), so the generator checks rather than
   trusts and omits the row otherwise.
4. **"What this involves"** — derived summary from `whatToExpect`. Anything
   verbatim is short and attributed. Republishing wholesale would be duplicate
   content, so honesty and ranking agree here.
5. **`localsSay`** verbatim where a curated entry exists. Pure editorial.
6. **FAQ block, 2–4 items, strictly data-derived.** *"Suitable for toddlers? —
   No; minimum age 3, no baby seating."* Only questions the data can answer. No
   padding.
7. **CTA and links:** affiliate link through `viatorLink()`; parent hub; 2–3
   similar activities from existing cluster data; planner CTA with `?ref=`.
8. **"Data updated \<build date\>"** — a freshness claim the deploy makes true.

Images: the same Viator CDN sources the app uses; curated locals use the
committed `.webp` files in `public/`. Explicit `width`/`height`, `loading="lazy"`
below the fold.

---

## The hubs

Five to start, each sitting where booking intent crosses catalog strength — a
question asked just before money is spent.

| hub | why this one |
|---|---|
| **Best boat tours & sunset sails in Aruba** | Highest commission density on the island, and the repo already holds real judgement here: the day-sail/evening-cruise split (`7471719`) and the vouched Jolly Pirates pick (`7bc97b3`). The hub is that judgement, published. |
| **Snorkeling in Aruba: free shore spots vs. paid trips** | The unfair advantage. Hand-written entries for Malmok, Tres Trapi and Mangel Halto *and* histograms for the paid snorkel products. Nobody selling tours tells people when the free beach is the better answer — which is why the recommendation converts when it *is* the paid trip. |
| **Natural Pool: jeep tour or drive yourself?** | A decision-shaped query whose answer the engine already committed to (`aa4b80a`). |
| **Aruba with kids** | Powered by per-product minimum ages, `baby_ok`, physical demand and swim-required. No competitor holds this. |
| **10 days in Aruba: the full itinerary** | The domain-name query and the planner's front door. Weakest booking intent, strongest brand fit. |

**Shape of every hub:** verdict in the first paragraph; comparison table built
from histograms; "our pick and why"; a short FAQ with one-sentence answers
(the extraction block); links down to data pages; planner CTA.

**Workflow:** drafted as `content/guides/<slug>.md` with frontmatter (title,
description, date, referenced product codes); Jan edits for voice and factual
truth; the generator **fails the build** if a hub references a product code it
does not know.

**Open, for Jan, later:** whether hubs carry a byline. A named author is an
E-E-A-T and GEO signal, but it is his name.

---

## Structured data and the GEO specifics

**JSON-LD**

- **Homepage:** `WebSite` + `Organization` (name, logo, `sameAs` → socials and
  Reddit once they exist). Entity consistency is what lets a model connect
  scattered "10 Days on Aruba" mentions to this domain.
- **Data pages:** `TouristAttraction` / `Product` basics + `BreadcrumbList`.
  **Deliberately no `aggregateRating`.** Google's review-snippet rules require
  ratings collected by the site itself; marking up ratings aggregated from
  Viator and Tripadvisor invites a manual action. The histogram stays visible
  HTML — which is what answer engines read anyway. Schema says what the page
  *is*; the HTML carries the citable numbers.
- **Hubs:** `Article` + `ItemList` + `FAQPage`. Google restricted FAQ *rich
  results* to government and health sites in 2023, so expect no dropdown
  decoration; the markup earns its place with Bing and answer engines.

**robots.txt — a named decision, not a default.** Allow-all, with `GPTBot`,
`OAI-SearchBot`, `ClaudeBot`, `PerplexityBot` and `Google-Extended` **explicitly
allowed**, so the policy reads as chosen. The trade is content for distribution;
for an affiliate site wanting citations, that trade is worth making — but it is
Jan's to make, and it is reversible.

**Private routes are not disallowed in robots.txt.** A robots-blocked URL can
still be indexed by reference. `/itinerary`, `/dashboard`, `/preview`, `/map`
and `/stats` get `noindex` meta from the Phase-0 head helper instead — which
*requires* crawlability to work.

**Also:** `llms.txt` emitted by the same generator (guides and top pages, one
line each — an emerging convention, uncertain adoption, near-zero cost); sitemap
with real `lastmod`; **Bing Webmaster Tools** alongside Search Console, because
Bing's index feeds ChatGPT search and it is the cheapest GEO action available.

---

## Build integration

`npm run build` currently runs `tsc --noEmit && vite build`, and
`.github/workflows/deploy.yml` runs it on **every push to main**. Adding a
network fetch there would make every deploy of the whole site depend on an edge
function responding — a new failure mode for a site that has none.

Instead, two commands:

    npm run seo:refresh    # tools/, by hand, hits viator-cards, writes the snapshot
    npm run build          # offline, deterministic, generates pages from it

- `tools/build-seo-catalog.ts` fetches the catalog and writes
  `src/data/seoCatalog.json` (title, image, code, cluster, tags — the fields
  pages need). Run deliberately, like every other `tools/` probe.
- `tools/build-seo.ts` runs after `vite build`, joins the snapshot with the
  committed data, and emits pages, `sitemap.xml`, `robots.txt` and `llms.txt`.
- Generator failure **fails the build loudly**. Silently skipping would 404
  every content URL on the next deploy.

**Catalog drift becomes a reviewable git diff** instead of silently changing what
deploys — the same reasoning behind `npm run drift`.

---

## Testing

The generator is pure: data in, HTML strings out. Tests run in node, no jsdom.

| test | asserts |
|---|---|
| Affiliate invariant | every outbound Viator href carries `pid` and `mcid` |
| Editorial ratings | no curated `rating`/`reviewCount` appears in any emitted page or JSON-LD |
| Quality floor | given fixtures, exactly the intended products earn URLs |
| Slug stability | a retitled product keeps its URL; the registry is authority |
| No orphans | every sitemap URL is linked from another page |
| Unknown code in a hub | build fails |
| Price row | omitted when the catalog value is 0 |

Each mutation-checked in both directions, per the house habit: change the code,
confirm the test breaks, change it back.

---

## Measurement

**The beacon lives in the app bundle** (`src/lib/beacon.ts`), so static pages are
invisible to it unless they carry their own snippet. They will — a few lines
posting to `collect`. It writes nothing to the device, so those pages need **no
cookie banner** and stay fast. Legal basis is unchanged from the existing
beacon: legitimate interest, no device storage.

- **Baseline first.** Pull `/stats` before Phase 0 ships. Everything is judged
  against that number.
- Search Console and Bing: impressions and clicks, split `/guides/*` vs
  `/things-to-do/*`.
- **The number that matters: Viator click-outs per organic session**, compared
  against planner traffic.

**Success criteria, stated before starting**

- ~6 weeks after Phase 1: majority of submitted URLs indexed; first non-brand
  impressions in Search Console.
- ~12 weeks: a click-out rate for organic traffic that is measurable and
  comparable to planner traffic.
- If it is not, Phase 3 is where this gets cut — not doubled down on.

**What cannot be measured, and must not be claimed:** Viator returns no booking
signal (`.claude/CLAUDE.md` data flow). Bookings live in the partner dashboard;
tying them to SEO is a manual monthly join on product code, never a funnel we
can see. GEO is worse: the beacon will show `chatgpt.com` and `perplexity.ai`
referrals, but citations that are read and not clicked are invisible. **We will
see the tide, not the waves.**

---

## Phases

| phase | contents | gated on |
|---|---|---|
| **0. Foundation** (1–2 days) | Real `robots.txt` + generated `sitemap.xml`; head helper giving each existing route its own title/description/canonical; `noindex` on `/itinerary`, `/dashboard`, `/preview`, `/map`, `/stats`; homepage JSON-LD. | Nothing. |
| **1. Generator + data pages** | `tools/build-seo*.ts`, page template, first tranche past the quality floor. Sitemap grows automatically. | Phase 0. |
| **2. Hubs** | Five hubs drafted, edited by Jan, linked into the graph. | Jan's editing time only. |
| **3. Measure, then expand or cut** | Search Console + beacon review at 4–6 weeks. Expand via the prose lever below, or stop. From numbers, not vibes. | ~6 weeks of indexation. |

Phases 0 and 1 ship independently. Nothing waits on writing time until Phase 2.

---

## Risks, accepted

- **SEO is slow.** Expect little before 8–12 weeks. Anyone reading a flat graph
  at week 3 should read this line instead.
- **GEO is only partly observable.** See above.
- **Two rendering paths.** Nav and footer markup will exist in the generator and
  in React, and they will drift. Bounded, and the price of not putting documents
  in the SPA. If the surface outgrows what template literals keep honest, Astro
  for the content tree is the escape hatch — a second toolchain in CI, not worth
  it at 58 pages.
- **For Jan:** confirm the Viator partner agreement permits affiliate links on
  content pages. Standard practice, but it is his account.

---

## Out of scope

Off-site marketing — Reddit, Pinterest, partnerships, email — is a separate
track and mostly not code. It is where GEO gets its strongest push (Reddit is
licensed training data and heavily weighted in retrieval), and it deserves its
own brainstorm rather than a paragraph here.
