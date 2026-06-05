-- Single-row JSON cache for the full Viator catalog payload.
-- Written by the viator-cards edge function (service role) after a live fetch;
-- read back on subsequent requests to skip the ~3s Viator API round-trip.

create table if not exists public.catalog_cache (
  id         text primary key default 'main',
  payload    jsonb not null,
  cached_at  timestamptz not null default now()
);

-- Edge function reads/writes via service role (bypasses RLS).
-- No anon access needed — this table is internal to the edge function.
alter table public.catalog_cache enable row level security;
