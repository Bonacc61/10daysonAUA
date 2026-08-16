# 10daysonaruba.com — Project Context

Live production app. Dutch law (GDPR) applies. Reddit launch imminent.

## Stack

- **Frontend:** React + TypeScript + Vite, deployed to TransIP via static build
- **Backend:** Supabase (EU region) — auth, Postgres, edge functions (Deno)
- **Analytics:** PostHog (EU host, `eu.i.posthog.com`)
- **Affiliate:** Viator Partner API v2 (preserve `pid=P00302487&mcid=42383` in all links)
- **Email:** TransIP SMTP via `contact-notify` edge function

## Key invariants — never break these

- Supabase RLS is enabled on ALL tables. Never disable it, never bypass it.
- `VITE_SUPABASE_ANON_KEY` is intentionally public (anon key only). `SERVICE_ROLE_KEY` must never appear in client code.
- localStorage keys are stable contracts: `10doa:answers`, `10doa:starred`, `10doa:booked`, `10doa:analytics-consent`, `10doa:trip-id`, `aruba.session`, `qDone`. Shape changes need migration.
- An account holds MANY saved itineraries (`trips` is keyed on its own `id`, not
  on `user_id`). `10doa:trip-id` is which one the planner is editing; saving under
  a different name branches a new row rather than overwriting.
- `specialNotes` (free-text PII) is stripped from all shared itinerary snapshots in `src/lib/shares.ts`.
- Viator affiliate params (`pid`, `mcid`, `medium`) must survive any URL rewrite.

## GDPR rules

- PostHog must not fire before explicit consent. Enforced by `src/lib/analytics.ts` — the app never imports `posthog-js` directly, and `initAnalytics()` runs only after `10doa:analytics-consent === 'true'`. `CookieBanner` (`src/components/CookieBanner.tsx`, rendered from `App.tsx`) is the only thing that sets it; `src/main.tsx` reads it at boot. Never call `posthog.*` outside this module.
- Any new data collection (PostHog events, Supabase inserts, edge function logging) needs a legal basis documented in the Privacy Policy (`src/pages/Privacy.tsx`).
- **Never log text a traveller typed** — not to console, not into an error body, not into a
  database column. Log the derived result instead. `itinerary-edit` logs the parsed
  constraint; `search` logs the result count. Neither logs the words.
- **Two feature flags gate the AI features:** `VITE_NL_EDIT` and `VITE_SEMANTIC_SEARCH`.
  They send a traveller's own words to a US sub-processor, so flipping one is a legal
  decision, not a technical one — never enable either without working its checklist first
  (`docs/superpowers/specs/2026-08-11-natural-language-edit-design.md`,
  `docs/superpowers/specs/2026-08-12-semantic-search-design.md`). Both default off in code;
  `.env.production` is the source of truth for which are actually on. A flag that is ON
  carries its rationale and its rollback there; a flag that is off is simply absent.
- Contact submissions auto-purge after 12 months (cron job exists). New tables need matching retention.

## Data flow

```
User → React app (localStorage) → Supabase (trips, feedback_events, shared_itineraries)
                                → Edge functions (viator-cards, contact-notify, itinerary-share,
                                                  itinerary-edit, search)
                                    └─ service role only: item_embeddings,
                                       query_embeddings, edit_requests, catalog_cache
                                → PostHog (analytics, EU hosted)
                                → Viator (affiliate clicks, no return signal)

AI features (each gated by a flag — see "Two feature flags" above;
`.env.production` says which are on):
  itinerary-edit → Anthropic (US)   free text → an EditConstraint. Nothing stored.
  search         → OpenAI (US)      query → a vector. Hash + vector cached 30 days.
  viator-cards   → OpenAI (US)      product text → vectors, at ingest. Always on.
```

## Local secrets and keys

- `.env.local` (gitignored) holds the **Viator production key**. Every probe in
  `tools/` reads it. `.env.production` is TRACKED IN GIT — never put a secret there.
- The Supabase CLI is authenticated and linked. `supabase projects api-keys` can
  fetch the **service-role key**, which is how account deletion was verified end
  to end. Use it transiently, in one process, and never write it to disk.

## What Viator will and will not give us

Our key is **Basic access**. Verified, not assumed:

- `/products/search` builds the catalog. It does NOT return `itinerary`, so
  "What to expect" text can only come from per-product detail calls.
- `/products/{code}` gives the star histogram, the full Overview, and
  `itinerary.activityInfo.description`. One call per product — too slow for the
  ingest, which is why those live in committed snapshots.
- `/availability/schedules/{code}` **is** in Basic (start times). The `bulk`
  variant is not.
- `/reviews/product` returns **403** — review TEXT needs a Full Access
  application, which also unlocks bulk availability.
- **The product pages cannot be scraped.** DataDome returns 403 to curl and a bot
  wall to headless Chromium. The "booked N days in advance" figure exists only
  there, appears in no API field, and is therefore unobtainable.

## Tests

- ~825 tests. `npm test` is offline and free; anything needing a network or an
  API key is a `tools/` script run by hand, never a vitest file.
- **Component tests render.** jsdom + testing-library, opted in PER FILE with a
  `// @vitest-environment jsdom` docblock so the pure-logic tests stay in node.
  Prefer a render test over asserting on component source text.
- Guard against tests that cannot fail: change the code, confirm the test breaks,
  change it back. Several tests here passed against deliberately broken code
  before that habit.

## Ship gate

- Run `/code-review` before every push to main
- Run `/code-review ultra` before any marketing push (Reddit, Product Hunt, etc.)

## Roadmap

Open work lives in `docs/ROADMAP.md`, not here. This file is for things that stay
true across sprints — if a line here would be wrong once a task ships, it belongs
in the roadmap instead.

## Dev workflow

```bash
cd /root/10daysonaruba.com
npm run dev          # local dev server
npm run build        # production build to dist/
npm test             # vitest
```

Never expose `npm run dev` publicly (a tunnel, a bound host). Vite's dev server
carries known path-traversal advisories until the v8 upgrade — use
`npm run build && npm run preview` to demo a change.

**Pushing to `main` deploys to production.** `.github/workflows/deploy.yml` runs
`npm run build` and mirrors `dist/` to TransIP over SFTP on every push to `main`
(also available via `workflow_dispatch`). There is no staging step and no manual
gate — this is why `/code-review` before a push to main is mandatory.

`dist/` is gitignored — CI builds it fresh on every deploy. The footer shows
`build <sha>` — CI stamps the real commit via `GITHUB_SHA`, local builds stamp
`dev` — so that id is the ground truth for what a browser is actually running.
