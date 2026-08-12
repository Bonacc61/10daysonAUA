-- One durable trip row per user, protected by row-level security.
-- Persisted fields: answers, plan, rejected, rejected_groups. (Per-card approval
-- was removed — signing in and saving the trip is the implicit approval, so the
-- saved `plan` IS the approved itinerary.)

create table if not exists public.trips (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  answers         jsonb       not null default '{}'::jsonb,   -- questionnaire Answers
  plan            jsonb       not null default '[]'::jsonb,   -- PlannedDay[]
  rejected        text[]      not null default '{}',          -- rejected card uids (swap memory)
  rejected_groups text[]      not null default '{}',          -- rejected group ids (swap memory)
  updated_at      timestamptz not null default now()
);

alter table public.trips enable row level security;

-- A user can read/write only their own row, enforced at the database layer.
--
-- Made REPLAYABLE on 2026-08-12. This migration was applied by hand and the CLI
-- history never learned it, so `supabase db push` had to re-run it before it
-- would apply any later migration. `create policy` has no IF NOT EXISTS, so the
-- drops below are what let this file run a second time.
--
-- Safe on a live table (3 rows at the time of writing): RLS stays enabled
-- throughout, and a table with RLS on and no matching policy DENIES access
-- rather than allowing it — so the window inside this transaction is strictly
-- MORE restrictive, never less. Nothing is exposed, and the migration is atomic.
drop policy if exists "trips_select_own" on public.trips;
drop policy if exists "trips_insert_own" on public.trips;
drop policy if exists "trips_update_own" on public.trips;
drop policy if exists "trips_delete_own" on public.trips;

create policy "trips_select_own" on public.trips
  for select using (auth.uid() = user_id);
create policy "trips_insert_own" on public.trips
  for insert with check (auth.uid() = user_id);
create policy "trips_update_own" on public.trips
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trips_delete_own" on public.trips
  for delete using (auth.uid() = user_id);

-- Bump updated_at on every update.
create or replace function public.trips_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trips_updated_at on public.trips;
create trigger trips_updated_at
  before update on public.trips
  for each row execute function public.trips_set_updated_at();
