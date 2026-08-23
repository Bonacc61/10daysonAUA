-- stats_summary, but windowed by an explicit instant rather than a whole number
-- of days.
--
-- WHY: the /stats page gained a "Today" tab, and today is the UTC CALENDAR day,
-- not the last 24 hours. The distinction is load-bearing rather than pedantic —
-- `visitor_day_hash` is rebuilt at midnight UTC, so a visitor seen either side
-- of midnight is two visitors by construction. A rolling 24-hour window would
-- count them once and disagree with the daily chart on the same page.
--
-- `stats_summary(days int)` cannot express that: a partial day is fractional and
-- the parameter is an integer, so 0.75 would round to 1 and quietly become 24
-- hours — the exact bug this exists to avoid. Rather than overload the name
-- (PostgREST cannot disambiguate two functions of the same name), the body moves
-- here behind a timestamptz and the old signature becomes a thin wrapper, so
-- every existing caller keeps working unchanged.
create or replace function public.stats_summary_since(since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with win as (
  select * from public.web_events where created_at >= since
)
select jsonb_build_object(
  'daily', (
    select coalesce(jsonb_agg(r order by r->>'day'), '[]'::jsonb) from (
      select jsonb_build_object(
        'day', created_at::date,
        'views', count(*) filter (where name = 'pageview'),
        -- DAILY uniques. Never sum these: the hash rotates at midnight UTC, so
        -- a visitor on five days is five.
        'visitors', count(distinct visitor_day_hash) filter (where name = 'pageview')
      ) r
      from win group by created_at::date
    ) s
  ),
  'topPaths', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('path', path, 'n', count(*)) r
      from win where name = 'pageview' group by path order by count(*) desc limit 20
    ) s
  ),
  'referrers', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('host', referrer_host, 'n', count(*)) r
      from win where referrer_host is not null group by referrer_host order by count(*) desc limit 20
    ) s
  ),
  'campaigns', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('campaign', campaign, 'n', count(*)) r
      from win where campaign is not null group by campaign order by count(*) desc limit 20
    ) s
  ),
  'countries', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('country', country, 'n', count(distinct visitor_day_hash)) r
      from win where country is not null group by country order by count(distinct visitor_day_hash) desc limit 30
    ) s
  ),
  'devices', (
    select coalesce(jsonb_object_agg(device, n), '{}'::jsonb) from (
      select device, count(distinct visitor_day_hash) n from win where device is not null group by device
    ) s
  ),
  'funnel', jsonb_build_object(
    'visitors',      (select count(distinct visitor_day_hash) from win where name = 'pageview'),
    'questionnaire', (select count(distinct visitor_day_hash) from win where milestone = 'questionnaire_started'),
    'generated',     (select count(distinct visitor_day_hash) from win where milestone = 'itinerary_generated'),
    'kept',          (select count(distinct visitor_day_hash) from win where milestone = 'itinerary_kept'),
    'clickedOut',    (select count(distinct visitor_day_hash) from win where name = 'outbound')
  ),
  'products', (
    select coalesce(jsonb_agg(r order by (r->>'clicks')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('product', product_code, 'clicks', count(*),
                                'visitors', count(distinct visitor_day_hash)) r
      from win where name = 'outbound' and product_code is not null
      group by product_code order by count(*) desc limit 50
    ) s
  ),
  'partners', (
    select coalesce(jsonb_agg(r order by (r->>'clicks')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('host', destination_host, 'clicks', count(*)) r
      from win where name = 'outbound' and destination_host is not null
      group by destination_host order by count(*) desc limit 20
    ) s
  )
);
$$;

-- THE HALF THAT KEEPS CALLERS OUT, and it is not optional. A SECURITY DEFINER
-- function in `public` is published by PostgREST as an RPC and Postgres grants
-- EXECUTE to PUBLIC by default — 20260820092000 exists because exactly this
-- shape left country_for_ip answering the public anon key. Without these four
-- lines this endpoint hands the whole analytics summary to anyone holding the
-- key that ships in the browser bundle.
revoke execute on function public.stats_summary_since(timestamptz) from public;
revoke execute on function public.stats_summary_since(timestamptz) from anon;
revoke execute on function public.stats_summary_since(timestamptz) from authenticated;
grant execute on function public.stats_summary_since(timestamptz) to service_role;

-- The original signature keeps working, delegating rather than duplicating.
create or replace function public.stats_summary(days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.stats_summary_since(now() - make_interval(days => stats_summary.days))
$$;
