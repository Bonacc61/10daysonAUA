-- Rate-limit ledger for the itinerary-edit edge function.
--
-- Every other endpoint in this project is either cached or free to serve;
-- itinerary-edit calls a paid model on every request behind a deliberately
-- public anon key, so it needs a ceiling that does not depend on the client
-- behaving. One row per accepted request; the function counts rows in a window.
--
-- `caller_hash` is SHA-256 of the client IP plus a server-side salt
-- (RATE_LIMIT_SALT). The raw IP is never stored and the hash is not linkable
-- back to a person without the salt — this is a throttle, not analytics.
-- Nothing the traveller typed is stored here, or anywhere.

create table if not exists public.edit_requests (
  id          bigserial primary key,
  caller_hash text not null,
  created_at  timestamptz not null default now()
);

-- The two queries the function runs: per-caller in the last hour, and global
-- in the last day.
create index if not exists edit_requests_caller_time_idx
  on public.edit_requests (caller_hash, created_at desc);
create index if not exists edit_requests_time_idx
  on public.edit_requests (created_at desc);

-- Written and read by the edge function's service role only (bypasses RLS).
-- No anon access: a client that could read this could map the throttle, and a
-- client that could write it could exhaust someone else's budget.
alter table public.edit_requests enable row level security;

-- 24h retention. The rows have no purpose past the longest rate-limit window,
-- so they do not outlive it — same pattern as purge-old-contact-submissions.
create extension if not exists pg_cron;

select cron.schedule(
  'purge-old-edit-requests',
  '35 3 * * *',
  $$delete from public.edit_requests where created_at < now() - interval '24 hours'$$
);
