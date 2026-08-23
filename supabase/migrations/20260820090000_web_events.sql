-- Cookieless web analytics. One row per pageview / outbound click / milestone.
--
-- No device storage is involved anywhere in this pipe: the browser sends no
-- identifier at all, and `visitor_day_hash` is derived server-side from
-- ip + user-agent + THE DATE + a server salt, then the raw values are dropped.
-- Because the date is inside the digest the salt rotates itself, so a visitor
-- cannot be linked across midnight UTC. That is deliberate and load-bearing:
-- "unique visitors" is a DAILY figure and monthly uniques are not computable.
-- Summing daily numbers is not a monthly count.
--
-- RLS is on and there are NO POLICIES. Not even insert. Only `collect` (service
-- role) writes and only `stats` (service role) reads — the same shape as
-- item_embeddings, query_embeddings, edit_requests and catalog_cache.

create table if not exists public.web_events (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  name             text not null,      -- pageview | outbound | milestone
  visitor_day_hash text not null,
  path             text,               -- normalised + allowlisted, never a raw URL
  referrer_host    text,               -- host only, never a full third-party URL
  campaign         text,               -- from our own ?ref=, allowlisted [a-z0-9-]{1,32}
  country          char(2),
  device           text,               -- mobile | tablet | desktop
  product_code     text,               -- outbound only
  destination_host text,               -- outbound only
  milestone        text                -- milestone only
);

create index if not exists web_events_created_idx  on public.web_events (created_at);

create index if not exists web_events_name_idx     on public.web_events (name, created_at);

create index if not exists web_events_visitor_idx  on public.web_events (visitor_day_hash);

create index if not exists web_events_product_idx  on public.web_events (product_code)
  where product_code is not null;

alter table public.web_events enable row level security;

-- Intentionally no policies. RLS with zero policies denies anon and
-- authenticated entirely while leaving the service role unaffected.

-- Retention: 12 months, matching contact_submissions. cron.schedule upserts by
-- job name, so re-running this is safe. 03:25 sits between the contact purge
-- (03:20) and the feedback purge (03:40) so the three never contend.
create extension if not exists pg_cron;

select cron.schedule(
  'purge-old-web-events',
  '25 3 * * *',
  $$delete from public.web_events where created_at < now() - interval '12 months'$$
);
