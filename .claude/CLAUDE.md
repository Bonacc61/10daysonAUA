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
- localStorage keys are stable contracts: `10doa:answers`, `10doa:starred`, `10doa:booked`, `aruba.session`, `qDone`. Shape changes need migration.
- `specialNotes` (free-text PII) is stripped from all shared itinerary snapshots in `src/lib/shares.ts`.
- Viator affiliate params (`pid`, `mcid`, `medium`) must survive any URL rewrite.

## GDPR rules

- PostHog must not fire before explicit consent (cookie banner — not yet implemented, blocked task).
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

## Upcoming work (post-launch checklist)

1. OG meta tags + og-image (1200×630) → `index.html`
2. Cookie consent banner → defer PostHog init behind user opt-in
3. Terms of Service page
4. `feedback_events` retention cron job (24 months)
5. Shortlist + explore event tracking (PostHog)
6. Vendor dashboard (read-only Supabase query page)
7. In-app account deletion button

## Dev workflow

```bash
cd /root/10daysonaruba.com
npm run dev          # local dev server
npm run build        # production build to dist/
npm test             # vitest
```

Deploy = push `dist/` to TransIP (handled externally). No CI/CD yet.
