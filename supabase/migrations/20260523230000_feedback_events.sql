-- Itinerary telemetry: one row per swap (with "why swap?" reason) / approve /
-- add / remove / move. Anonymous session_id (no PII). Write-only for the public
-- client: anon may INSERT but has no SELECT policy, so it can't read events back.
-- Analytics/learning jobs read with the service role (bypasses RLS).

create table if not exists public.feedback_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  session_id  text not null,
  action      text not null,   -- swap | approve | add | remove | move
  reason      text,            -- the "why swap?" chip
  day         int,
  slot        text,
  from_id     text,
  from_kind   text,
  from_price  numeric,
  to_id       text,
  to_kind     text,
  to_section  text
);

create index if not exists feedback_events_session_idx on public.feedback_events (session_id);
create index if not exists feedback_events_action_idx  on public.feedback_events (action);
create index if not exists feedback_events_created_idx  on public.feedback_events (created_at);

alter table public.feedback_events enable row level security;

drop policy if exists "feedback insert" on public.feedback_events;
create policy "feedback insert" on public.feedback_events
  for insert to anon, authenticated with check (true);
