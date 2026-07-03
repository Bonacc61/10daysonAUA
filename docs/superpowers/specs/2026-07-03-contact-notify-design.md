# Contact-notify — design

**Date:** 2026-07-03
**Status:** Approved, ready for planning

## Problem

The homepage "Contact us." form now stores submissions in the `contact_submissions`
table (fixed 2026-07-03 — the table was missing in prod, so every submission had been
erroring out and lost). But nobody is notified: submissions are write-only rows that
someone would have to query manually with the service role. We want an **email to
`hello@10daysonaruba.com`** on each new submission, and a short **auto-reply** to the
visitor acknowledging their message.

## Key facts that shape the design

- **Submissions are already durably stored** (fix A). The DB row is the source of truth;
  email is a best-effort notification layer on top. An email failure must never lose a
  message.
- The site is a **static SPA** (built with Vite, SFTP-deployed to TransIP). The only
  server-side compute is **Supabase** — so email must be sent from a Supabase Edge
  Function (Deno), not from the hosting.
- An edge-function pattern already exists: `supabase/functions/viator-cards` (Deno,
  `serve`, reads secrets via `Deno.env.get(...)`, deploys via the `supabase` CLI).
- `contact_submissions` columns: `id bigint`, `created_at timestamptz`, `name text`,
  `email text`, `phone text`, `comment text`. RLS: anon/authenticated may INSERT
  (write-only; no SELECT for the public client).
- **`pg_net` is not currently enabled** in the project (checked). A Supabase Database
  Webhook needs it.
- TransIP provides **SMTP only** (no HTTP email API). Assumed settings (to be confirmed
  by the first test-send): host `smtp.transip.email`, port `465` (implicit TLS), auth
  with the full mailbox address + password.

## Decisions

- **Scope:** notify us **and** auto-reply to the visitor (two emails per submission).
- **One mailbox does everything:** `hello@10daysonaruba.com` is the SMTP login, the
  `From` on both emails, and the notification recipient. Auto-reply `To` = the visitor's
  submitted email.
- **Trigger: Supabase Database Webhook** on `INSERT` to `contact_submissions` → the
  `contact-notify` edge function. Chosen over a client-side call because it fires on the
  real DB insert (survives the visitor closing the tab) and isn't a public endpoint the
  client can spam. Requires enabling `pg_net`.
- **Transport: TransIP SMTP** from the edge function via a Deno SMTP library
  (`denomailer`), port 465 (implicit TLS), with 587/STARTTLS as the fallback if 465 is
  blocked.
- **De-risk SMTP first:** the very first implementation step is a minimal test-send from
  the edge runtime to TransIP. If SMTP can't be reached from Supabase's runtime at all,
  stop and escalate before building the rest.

## Architecture

```
visitor submits form
   → Landing.tsx inserts row into contact_submissions   (already durable — fix A)
       → DB webhook (pg_net) fires on INSERT
           → POST to contact-notify edge function (with a shared-secret header)
               → validates the secret
               → sends 2 emails via TransIP SMTP (denomailer):
                   1. notification  → hello@10daysonaruba.com
                   2. auto-reply    → visitor's email
```

The frontend does **not change** — it already inserts the row.

## Components

### 1. Edge function `supabase/functions/contact-notify/index.ts`
- `Deno.serve`/`serve` handler. Rejects any request whose `X-Webhook-Secret` header
  doesn't match the `WEBHOOK_SECRET` env (403), so only the webhook can trigger sends.
- Parses the Supabase webhook payload (`{ type: 'INSERT', record: { name, email, phone,
  comment, created_at, ... } }`).
- Sends the two emails via a single SMTP connection (`denomailer` `SMTPClient`).
- Returns 200 on success; **non-200 on send failure** so the webhook's retry can re-fire
  (the row is safe regardless).

### 2. Pure body builders (own module, e.g. `messages.ts`) — unit-tested
- `notificationEmail(record) → { subject, text }`
- `autoReplyEmail(record) → { subject, text }`
- No I/O — deterministic, so `deno test` covers content without touching SMTP.

### 3. Secrets (set via `supabase secrets set`, never in the repo)
- `SMTP_HOST` (`smtp.transip.email`), `SMTP_PORT` (`465`), `SMTP_USER`
  (`hello@10daysonaruba.com`), `SMTP_PASS`, `WEBHOOK_SECRET`.
- `CONTACT_TO` defaults to `hello@10daysonaruba.com` (env-overridable).

### 4. Database webhook
- Enable `pg_net` (`create extension if not exists pg_net`).
- An `AFTER INSERT` trigger on `contact_submissions` calling `net.http_post` to the
  function URL with the `X-Webhook-Secret` header — captured as a migration
  `supabase/migrations/<ts>_contact_notify_webhook.sql` so it's version-controlled.
  (The function URL + secret are injected via a DB setting or hard-referenced in the
  migration; exact mechanism decided in the plan.)

## Data flow / email content

- **Notification → `hello@`:** subject `New contact message from {name}`; body lists
  name, email, phone (or "—"), comment, and the submission timestamp. Reply-To set to the
  visitor's email so you can reply directly.
- **Auto-reply → visitor:** subject `Thanks for reaching out — 10 days on Aruba`; short
  friendly body confirming receipt and that a human will reply. `From:
  hello@10daysonaruba.com`.

## Error handling

- **SMTP failure:** log the error, return non-200 → webhook retries. The submission row
  is already persisted, so no data is lost.
- **Malformed/absent payload:** 400, no send.
- **Bad/missing secret header:** 403, no send.
- **Partial send** (notification ok, auto-reply fails, or vice-versa): attempt both;
  if either fails, return non-200 so the webhook retries. A retry may re-send the email
  that already succeeded, producing a rare duplicate — that is acceptable and keeps the
  handler simple (no per-email send-state tracking).

## Security

- Function gated by `WEBHOOK_SECRET` header (and `verify_jwt` may stay on with the
  service-role key passed by the webhook — decided in the plan). Not a public trigger.
- **Auto-reply abuse:** the auto-reply goes to an unverified, visitor-supplied address,
  so a bad actor could use the form to send a single acknowledgement email to someone
  else. Impact is low (one fixed, non-customizable message; no open relay). Accept for
  now; note as a known limitation. A future rate-limit on inserts (already a deferred
  minor from the share work) would also cap this.

## Testing

- **Unit (`deno test`):** the two body builders — correct subject/body, phone "—"
  fallback, comment included, no crashes on missing optional fields.
- **SMTP de-risk:** a one-off test-send confirming TransIP SMTP works from the edge
  runtime (port 465, else 587) — the first step, before wiring the webhook.
- **End-to-end:** one real submission on the live site → confirm both emails arrive and
  the row is stored.

## Out of scope (possible later)

- Rich HTML email templates (start with plain text).
- Rate-limiting / spam protection on the form (tracked separately).
- Storing send status / retries beyond the webhook's built-in retry.
- A dashboard to browse submissions (they're queryable via the service role today).

## Open items (resolved at build/deploy time)

- Confirm SMTP host/port (assumed `smtp.transip.email:465`; the test-send verifies).
- `SMTP_PASS` set by the site owner via `supabase secrets set` — never in chat or repo.
