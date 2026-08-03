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
- Contact submissions auto-purge after 12 months (cron job exists). New tables need matching retention.

## Data flow

```
User → React app (localStorage) → Supabase (trips, feedback_events, shared_itineraries)
                                → Edge functions (viator-cards, contact-notify, itinerary-share)
                                → PostHog (analytics, EU hosted)
                                → Viator (affiliate clicks, no return signal)
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
