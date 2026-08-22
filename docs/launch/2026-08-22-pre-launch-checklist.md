# Pre-launch checklist — Reddit launch, 2026-08-23

Written 2026-08-22 against production `26487b4`. Grounded in what is measurably
true of this repo today, not a generic launch template.

Live smoke test passed: landing renders, cookie banner shows, questionnaire
routes, itinerary renders, Explore renders. One console 404 (the `natural-pool-jeep`
Pexels stub image) — pre-existing, invisible on live data because
`mergeLocalMatches` replaces it.

---

## BLOCKING — do not launch without these

### 1. You have no traffic measurement at all
The single biggest gap, and it is the reason this list exists.

- `VITE_POSTHOG_KEY` is **empty** in `.env.production`, so `initAnalytics()`
  returns at line 16 and every `capture()` is a no-op. Confirmed live: the page
  loads with `window.posthog === false`.
- Outbound "Book now" clicks are **not measured anywhere**. Every one is a plain
  `<a target="_blank">` with no handler. The site has run since May with no
  record of a single click out to Viator.
- So on launch day: you will not know how many people came, where from, or how
  many you sent to Viator. If Reddit works, you cannot prove it.

**Two independent fixes. Do at least one.**

| | Effort | Counts | Needs from you |
|---|---|---|---|
| (a) Set `VITE_POSTHOG_KEY` | minutes | consented share only | the key |
| (b) Build the cookieless beacon | hours | 100% of traffic | a deploy + `ANALYTICS_SALT` |

(b) is `docs/superpowers/specs/2026-08-14-internal-analytics-dashboard-design.md`
— "Design approved, not built". It writes nothing to the device, so it runs on
legitimate interest and counts everyone. That is what makes the number quotable
to a partner.

### 2. `/code-review ultra` has not been run
`.claude/CLAUDE.md`: *"Run `/code-review ultra` before any marketing push
(Reddit, Product Hunt, etc.)"*. It is user-triggered and billed — I cannot start
it. Run it yourself before you post.

### 3. Decide the three AI switches
`.env.production` currently has `VITE_SEMANTIC_SEARCH=true` and
`SEARCH_PARSE=on`. Both send traveller words to a US sub-processor. They are
already live and disclosed, so this is a confirmation rather than a change —
but confirm it deliberately before traffic arrives, not after.

---

## HIGH VALUE, CHEAP

### 4. The scuba dive is still not in the catalog
`supabase/functions/viator-cards/groups.ts` has the `diving` anchor (tag 12021)
committed and the client-side half is in place, but the function is not
deployed. Until you run it, the best-rated non-certified dive on the island
(`250774P5`, 5.0★) plus five more are absent from the site.

    supabase functions deploy viator-cards

then hit `?op=refresh`.

### 5. Kitesurfing lands at the wrong end of the trip
Asked for "somewhere in the beginning"; it lands on days 9-13 of a fortnight
(mean 10.2), because `bookingDays` fills latest-first and the pre-passes claim
the early days. Needs a placement pass, not a whitelist row. Cosmetic for
launch — a traveller will not know it was meant to be earlier.

---

## KNOWN RISKS — accepted, listed so they are not surprises

- **ROADMAP item 19: one embedding cluster holds 116 of 327 items (35%).** It
  collapses the champion pool to 64 and blocks 115 products once any one is
  placed. Deliberately not fixed before launch: the lever is a redeploy that
  moves what every plan contains, and nothing currently detects that class of
  change.
- **ROADMAP item 12: three Vite dev-server advisories.** Production bundle is
  unaffected. Never tunnel `npm run dev` — use `npm run build && npm run preview`.
- **Photo width in the 641-750px band** is ~20% smaller than before yesterday's
  change. Tablets in portrait. Documented in `ItineraryCard.tsx`.
- **`avoid-crowds` reaches only ~16 of ~50 cards** in a plan; curated locals
  carry no crowd signal.

---

## Status

- [ ] 1. Traffic measurement
- [ ] 2. `/code-review ultra` — YOURS
- [ ] 3. AI switches confirmed — YOURS
- [ ] 4. `viator-cards` deploy — YOURS
- [ ] 5. Kitesurfing placement — optional
