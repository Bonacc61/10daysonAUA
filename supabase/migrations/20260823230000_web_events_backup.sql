-- A nightly, append-only copy of web_events.
--
-- WHY: the traffic record cannot be rebuilt. There is no IP to re-derive a
-- visitor code from and no upstream to re-fetch from, so a row deleted by a
-- careless migration, a mistyped DELETE or a bad `supabase db push` is gone for
-- good. A site deploy cannot touch this data — the deploy workflow only copies
-- dist/ to TransIP and never speaks to Supabase — but the database-side actions
-- can, and those are the ones worth insuring against.
--
-- SHAPE: append-only and incremental, keyed on the source id. It copies rows it
-- has not seen and never deletes to match the source, so an accidental DELETE on
-- web_events leaves the backup intact — which is the entire point. Re-running it
-- is harmless; a missed night is caught up by the next run rather than lost.
--
-- NO FUNCTION, deliberately. The job body is inline SQL run by pg_cron as the
-- table owner. Wrapping it in a SECURITY DEFINER function in `public` would
-- publish it through PostgREST as an RPC and hand it EXECUTE by default — the
-- mistake 20260820092000 exists to record. Nothing to expose, nothing to revoke.
--
-- WHAT THIS IS NOT: an off-site backup. Both tables live in the same database,
-- so this protects against losing ROWS, not against losing the project. For that
-- the answer is Supabase's own backups or a scheduled pg_dump somewhere else.

create table if not exists public.web_events_backup (
  id                bigint primary key,   -- the SOURCE id, so copying is idempotent
  created_at        timestamptz not null,
  name              text not null,
  visitor_day_hash  text not null,
  path              text,
  referrer_host     text,
  campaign          text,
  country           char(2),
  device            text,
  product_code      text,
  destination_host  text,
  milestone         text,
  backed_up_at      timestamptz not null default now()
);

comment on table public.web_events_backup is
  'Nightly append-only copy of web_events. Same 12-month retention as the source — see the purge job below.';

create index if not exists web_events_backup_created_idx on public.web_events_backup (created_at desc);

-- Same posture as the source: RLS on, NO policies. Written by pg_cron as owner,
-- read by nobody but the service role.
alter table public.web_events_backup enable row level security;

-- 23:50 UTC: ten minutes before the visitor code rotates, so a whole UTC day is
-- captured in one run. Nothing else is scheduled near it — the purges run
-- between 03:20 and 03:50.
select cron.schedule(
  'backup-web-events',
  '50 23 * * *',
  $$
    insert into public.web_events_backup (
      id, created_at, name, visitor_day_hash, path, referrer_host, campaign,
      country, device, product_code, destination_host, milestone
    )
    select id, created_at, name, visitor_day_hash, path, referrer_host, campaign,
           country, device, product_code, destination_host, milestone
    from public.web_events
    on conflict (id) do nothing
  $$
);

-- THE SAME 12 MONTHS, and this is not optional.
--
-- The Privacy Policy tells travellers this data is kept for 12 months, and
-- web_events purges nightly to make that true. A backup holding the same
-- pseudonymous rows for longer would quietly turn that promise into a false
-- statement — a copy is still processing. Runs at 03:30, just after the source
-- purge at 03:25, and keys on the ORIGINAL created_at rather than backed_up_at
-- so both tables drop exactly the same rows.
select cron.schedule(
  'purge-old-web-events-backup',
  '30 3 * * *',
  $$ delete from public.web_events_backup where created_at < now() - interval '12 months' $$
);

-- RESTORING, for whoever needs it at a bad moment:
--
--   insert into public.web_events (
--     name, visitor_day_hash, path, referrer_host, campaign, country, device,
--     product_code, destination_host, milestone, created_at)
--   select name, visitor_day_hash, path, referrer_host, campaign, country,
--          device, product_code, destination_host, milestone, created_at
--   from public.web_events_backup b
--   where not exists (select 1 from public.web_events w where w.created_at = b.created_at
--                       and w.visitor_day_hash = b.visitor_day_hash and w.name = b.name);
--
-- `id` is deliberately NOT restored: web_events generates it always as identity,
-- and forcing old ids back would collide with rows written since. The dashboard
-- never reads id, so nothing depends on the numbering being preserved.
