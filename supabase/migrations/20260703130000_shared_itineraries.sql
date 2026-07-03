-- Immutable, publicly-readable snapshots of an itinerary, addressed by a short
-- slug in the URL (/i/<id>). Same shape as `trips` minus the per-user key: an
-- itinerary is fully reconstructible from { answers, plan, rejected,
-- rejected_groups } — plan stores only ids; cards are rebuilt from the catalog.
create table if not exists public.shared_itineraries (
  id              text        primary key,                       -- 8-char base62 slug (client-generated)
  answers         jsonb       not null default '{}'::jsonb,      -- questionnaire Answers
  plan            jsonb       not null default '[]'::jsonb,      -- PlannedDay[] (id-only entries)
  rejected        text[]      not null default '{}',             -- swap memory (card ids)
  rejected_groups text[]      not null default '{}',             -- swap memory (group ids)
  created_by      uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.shared_itineraries enable row level security;

-- Anyone with the link can read the snapshot (including anonymous visitors).
drop policy if exists "shared_itineraries_select_public" on public.shared_itineraries;
create policy "shared_itineraries_select_public" on public.shared_itineraries
  for select using (true);

-- Anyone can create a share (anonymous visitors already build itineraries).
-- created_by is filled from auth.uid() by the column default, so it can't be
-- spoofed by the client payload.
drop policy if exists "shared_itineraries_insert_any" on public.shared_itineraries;
create policy "shared_itineraries_insert_any" on public.shared_itineraries
  for insert with check (true);

-- No update/delete policies: snapshots are immutable, and RLS default-denies
-- any command without a matching policy.
