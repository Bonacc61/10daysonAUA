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

create trigger trips_updated_at
  before update on public.trips
  for each row execute function public.trips_set_updated_at();
