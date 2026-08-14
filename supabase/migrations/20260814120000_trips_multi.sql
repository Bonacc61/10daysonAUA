-- Many itineraries per user, instead of exactly one.
--
-- `trips` was keyed `user_id uuid primary key`, so the database itself enforced
-- one saved trip per account and "save under a new name" could only ever
-- overwrite the trip already there. This moves the primary key to a surrogate
-- `id` and leaves `user_id` as an ordinary indexed column.
--
-- The itinerary's name is not a column: it lives in `answers->>'tripName'`,
-- where the client already writes it. Nothing here needs to know about it.
--
-- SAFE ON THE LIVE TABLE, but NOT independently deployable — read this before
-- applying it:
--   * The rewrite is atomic and no row is deleted. `gen_random_uuid()` is
--     volatile, so ADD COLUMN evaluates it per row and every existing trip gets
--     its own id rather than sharing one.
--   * `user_id references auth.users(id) on delete cascade` is part of the
--     column definition and is untouched, so account deletion still takes every
--     one of a user's trips with it (see supabase/functions/account-delete).
--   * The RLS policies key on `user_id`, not on the primary key, so all four
--     keep meaning exactly what they meant. RLS is never disabled here.
--   * THE OLD CLIENT BREAKS THE MOMENT THIS LANDS. It saves with
--     `upsert(..., { onConflict: 'user_id' })`, which requires the unique
--     constraint this migration drops. Apply the migration and deploy the
--     matching client together; a browser running the old bundle in between
--     will fail to save.

alter table public.trips
  add column if not exists id uuid not null default gen_random_uuid();

-- The PK move. Named explicitly because `drop constraint if exists` on a
-- generated name is the kind of thing that silently no-ops on a renamed
-- constraint and leaves the old key in place.
alter table public.trips drop constraint if exists trips_pkey;
alter table public.trips add primary key (id);

-- user_id is now the lookup key for "this account's itineraries", so it needs
-- its own index; it lost the one the primary key used to give it for free.
create index if not exists trips_user_id_idx on public.trips (user_id);
