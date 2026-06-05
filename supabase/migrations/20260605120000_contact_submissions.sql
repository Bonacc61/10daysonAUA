-- Contact form submissions. Anon may INSERT (no SELECT policy so submissions
-- are write-only from the public client). Read with the service role.

create table if not exists public.contact_submissions (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null,
  email       text not null,
  phone       text,
  comment     text
);

create index if not exists contact_submissions_created_idx on public.contact_submissions (created_at);

alter table public.contact_submissions enable row level security;

drop policy if exists "contact insert" on public.contact_submissions;
create policy "contact insert" on public.contact_submissions
  for insert to anon, authenticated with check (true);
