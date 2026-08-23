-- IP → country, resolved at WRITE TIME and never stored as an IP.
--
-- This exists because Supabase edge functions expose no country header —
-- verified 2026-08-14 against the Edge Functions architecture docs and
-- supabase/discussions/7884, which mention only x-forwarded-for. The obvious
-- alternative, a third-party geo API, would send every visitor's IP to a US
-- sub-processor and defeat the point of a cookieless design. So the lookup
-- happens inside our own EU Postgres and only the two-letter code survives.
--
-- Country CANNOT be backfilled: web_events never holds an IP by design. If
-- this table is empty when collect goes live, that traffic has no geography
-- forever.
--
-- SHAPE: start/end ranges, not CIDR blocks. The design doc assumed CIDR with a
-- GiST index and `>>=`, which is the better read if the dataset ships CIDR.
-- DB-IP IP-to-Country Lite (CC-BY-4.0, verified on the download page
-- 2026-08-20) ships start/end pairs and offers no CIDR variant, so that path
-- would mean expanding 706,484 ranges into roughly two million CIDR rows via a
-- range→CIDR library. A btree on start_ip answers the same question from a
-- single index entry with the rows exactly as published, so the expansion buys
-- nothing. `country_for_ip(inet) -> char(2)` is unchanged either way, which is
-- the only part anything else depends on.

create table if not exists public.ip_country (
  start_ip inet    not null,
  end_ip   inet    not null,
  country  char(2) not null,
  primary key (start_ip)
);

alter table public.ip_country enable row level security;

-- No policies: read by the service role only, same as web_events.

-- The published ranges are non-overlapping and cover the WHOLE address space,
-- including the ZZ ("unknown") blocks — which is why those are loaded rather
-- than skipped. Complete coverage is what keeps this to one index touch: the
-- greatest start_ip <= ip IS the containing range, so the scan stops on its
-- first row instead of walking backwards through a gap. ZZ is turned into null
-- here rather than at load time, so the table stays a faithful copy of the
-- dataset and "unknown" reads as "no country" to the caller.
--
-- Mixed families need no special handling: Postgres orders every IPv4 address
-- below every IPv6 one, so a v4 lookup can never select a v6 row and vice
-- versa.
create or replace function public.country_for_ip(ip inet)
returns char(2)
language sql
stable
security definer
set search_path = public
as $$
  select case when t.country = 'ZZ' then null else t.country end
    from (
      select country, end_ip
        from public.ip_country
       where start_ip <= ip
       order by start_ip desc
       limit 1
    ) t
   where t.end_ip >= ip
$$;
