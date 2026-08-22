-- Cookieless traffic and outbound-click measurement.
-- Spec: docs/superpowers/specs/2026-08-14-internal-analytics-dashboard-design.md
--
-- WHY THIS IS NOT feedback_events OR PostHog. Both of those write an identifier
-- to the traveller's device (`aruba.session`, PostHog's own), which the
-- 2026-08-13 ruling found is non-essential storage and therefore needs consent —
-- so both count only the consented share of traffic. This table is written from
-- a beacon that stores NOTHING on the device: identity is derived server-side
-- from ip+ua+date and discarded. That runs on legitimate interest and counts
-- 100% of visitors, which is the entire reason the design exists. Do not fold
-- the consent-gated pipes into this one, and do not relax their gate.

create table if not exists public.web_events (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),

  -- 'pageview' | 'outbound' | 'milestone'. A check constraint rather than an
  -- enum so adding a name later is a migration, not a type change.
  name              text not null check (name in ('pageview', 'outbound', 'milestone')),

  -- sha256("v:" || date || ":" || ip || ":" || ua || ":" || ANALYTICS_SALT).
  -- The DATE IS INSIDE THE DIGEST, so the key rotates itself at midnight UTC and
  -- there is no old-salt store and no way to link a visitor across days.
  -- Consequence, and it is a real one: "unique visitors" is a DAILY figure only.
  -- Summing 30 days is NOT a monthly unique count — someone who visits five days
  -- is five. Whatever reads this table must label that on the tile.
  visitor_day_hash  text not null,

  -- Normalised against an allowlist of known routes; anything else is 'other'.
  -- Query strings are dropped before this is computed (a search query in a URL
  -- is a traveller's typed words) and dynamic segments collapse (/i/:slug), so a
  -- pageview can never be tied to one shared itinerary.
  path              text,
  referrer_host     text,          -- host only, never the full referring URL
  campaign          text,          -- from ?ref=, allowlisted [a-z0-9-]{1,32}
  country           text,          -- 2 chars, resolved at WRITE time; see below
  device            text check (device is null or device in ('mobile','tablet','desktop')),

  product_code      text,          -- outbound only
  destination_host  text,          -- outbound only
  milestone         text           -- milestone only
);

-- COUNTRY IS NULL FOR NOW, AND THAT IS A DATED DECISION, not an oversight.
-- The spec is explicit that country cannot be backfilled: the IP is never
-- stored, so a row written without it never gets one. Resolving it needs an
-- `ip_country` CIDR table in this database (sending IPs to a US geo API would
-- reintroduce the sub-processor problem this design exists to avoid), and
-- choosing the dataset is a LICENCE decision — DB-IP Lite, IP2Location LITE and
-- GeoLite2 differ materially on attribution and redistribution. That decision
-- was not worth blocking launch-day collection on, but every day it waits is a
-- day of permanently geography-less rows.

-- Explicit columns, no jsonb, matching feedback_events. A loose bag invites
-- exactly the free text the project rules forbid.

comment on table public.web_events is
  'Cookieless traffic + outbound clicks. No device storage; visitor_day_hash is unlinkable across UTC days. Service role only.';

-- The read patterns are "recent rows, grouped by a dimension" and "distinct
-- visitors in a day", so date leads both indexes.
create index if not exists web_events_created_idx on public.web_events (created_at desc);
create index if not exists web_events_name_created_idx on public.web_events (name, created_at desc);
create index if not exists web_events_visitor_day_idx on public.web_events (visitor_day_hash, created_at desc);

-- RLS ON WITH NO POLICIES AT ALL — not even insert. Written only by `collect`
-- with the service role, read only by a stats endpoint. Same pattern as
-- item_embeddings, query_embeddings, edit_requests and catalog_cache. The anon
-- key is public by design, so anything it could reach, anyone could reach.
alter table public.web_events enable row level security;

-- Retention: 12 months, matching contact_submissions. Raw rows carry a visitor
-- hash, so they are pseudonymous rather than anonymous and must not be kept
-- indefinitely.
--
-- DEADLINE, and it is a real one: a nightly rollup into an anonymous `web_daily`
-- (date x dims x counts, no visitor hash) must exist BEFORE 2027-08 or the first
-- year of pitch history deletes itself. Nothing is lost in the first 12 months,
-- which is exactly why it will be forgotten.
select cron.schedule(
  'purge-old-web-events',
  '25 3 * * *',
  $$ delete from public.web_events where created_at < now() - interval '12 months' $$
);
