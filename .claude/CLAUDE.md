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
- localStorage keys are stable contracts: `10doa:answers`, `10doa:starred`, `10doa:booked`, `10doa:analytics-consent`, `aruba.session`, `qDone`. Shape changes need migration.
- `specialNotes` (free-text PII) is stripped from all shared itinerary snapshots in `src/lib/shares.ts`.
- Viator affiliate params (`pid`, `mcid`, `medium`) must survive any URL rewrite.

## GDPR rules

- PostHog must not fire before explicit consent. Enforced by `src/lib/analytics.ts` — the app never imports `posthog-js` directly, and `initAnalytics()` runs only after `10doa:analytics-consent === 'true'`. `CookieBanner` (`src/components/CookieBanner.tsx`, rendered from `App.tsx`) is the only thing that sets it; `src/main.tsx` reads it at boot. Never call `posthog.*` outside this module.
- Any new data collection (PostHog events, Supabase inserts, edge function logging) needs a legal basis documented in the Privacy Policy (`src/pages/Privacy.tsx`).
- **Never log text a traveller typed** — not to console, not into an error body, not into a
  database column. Log the derived result instead. `itinerary-edit` logs the parsed
  constraint; `search` logs the result count. Neither logs the words.
- **Two feature flags gate the AI features and both default OFF:** `VITE_NL_EDIT` and
  `VITE_SEMANTIC_SEARCH`. They send a traveller's own words to a US sub-processor, so the
  switch is a legal decision, not a technical one. Neither appears in `.env.production`.
  Enable checklists live in `docs/superpowers/specs/2026-08-11-natural-language-edit-design.md`
  and `docs/superpowers/specs/2026-08-12-semantic-search-design.md`.
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

AI features (both dark by default — see the flags below):
  itinerary-edit → Anthropic (US)   free text → an EditConstraint. Nothing stored.
  search         → OpenAI (US)      query → a vector. Hash + vector cached 30 days.
  viator-cards   → OpenAI (US)      product text → vectors, at ingest. Always on.
```

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

**Pushing to `main` deploys to production.** `.github/workflows/deploy.yml` runs
`npm run build` and mirrors `dist/` to TransIP over SFTP on every push to `main`
(also available via `workflow_dispatch`). There is no staging step and no manual
gate — this is why `/code-review` before a push to main is mandatory.

`dist/` is gitignored — CI builds it fresh on every deploy. The footer shows
`build <sha>` — CI stamps the real commit via `GITHUB_SHA`, local builds stamp
`dev` — so that id is the ground truth for what a browser is actually running.
