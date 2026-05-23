-- Viator catalog tables — the v1.1 data layer behind getCatalog().
-- Mirrors src/types.ts ViatorGroup / ViatorItem. Rows are written by the
-- sync-viator edge function (service role); the client reads them with the
-- anon key via public read-only RLS policies.

create table if not exists public.viator_groups (
  id               text primary key,
  name             text not null,
  tagline          text not null default '',
  viator_taxonomy  text not null default '',
  viator_group_url text not null,
  display_order    int  not null default 0,
  matched_by       text[] not null default '{}',
  region           text not null default 'islandwide',
  allowed_slots    text[] not null default '{}',
  updated_at       timestamptz not null default now()
);

create table if not exists public.viator_items (
  id              text primary key,
  group_id        text not null references public.viator_groups(id) on delete cascade,
  title           text not null,
  image_url       text not null default '',
  price_usd       numeric not null default 0,
  duration        text not null default '',
  rating          numeric not null default 0,
  review_count    int  not null default 0,
  viator_item_url text not null,
  is_best_seller  boolean not null default false,
  display_order   int  not null default 0,
  region          text,
  description     text,
  fit_reason      text,
  reddit_quote    jsonb,
  ta_quote        text,
  updated_at      timestamptz not null default now()
);

create index if not exists viator_items_group_id_idx on public.viator_items (group_id);

alter table public.viator_groups enable row level security;
alter table public.viator_items  enable row level security;

-- Public, read-only access for the client catalog (anon + authenticated).
drop policy if exists "viator_groups public read" on public.viator_groups;
create policy "viator_groups public read" on public.viator_groups for select using (true);

drop policy if exists "viator_items public read" on public.viator_items;
create policy "viator_items public read" on public.viator_items for select using (true);
