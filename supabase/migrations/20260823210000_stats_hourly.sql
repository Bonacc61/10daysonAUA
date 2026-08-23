-- Adds `hourly` to the stats summary, for short windows only.
--
-- WHY: "Traffic over time" plots one point per DAY. Over a one-day window that
-- is a single point, and an SVG path with one moveto and no lineto draws
-- nothing — the box rendered gridlines, axis labels and no data whatsoever.
-- Since collection began today, that empty chart was the only version anyone
-- had seen.
--
-- A day is also just the wrong bucket for "today": the interesting shape is when
-- during the day people arrived. Hours give a real line.
--
-- ONLY FOR SHORT WINDOWS. 90 days of hours is 2,160 points, which is both a
-- pointless payload and an unreadable chart. Beyond three days the daily series
-- is the right resolution and this returns an empty array, which the page reads
-- as "plot days".
--
-- `visitors` here is distinct codes seen WITHIN THAT HOUR. Summing the hours
-- over-counts exactly the way summing days does — one person active at 14:00 and
-- 16:00 is two — so the page labels the series accordingly and the daily figure
-- above remains the one to quote.
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
  'firstEvent', (select min(created_at) from public.web_events),
  'allTime', jsonb_build_object(
    'views',       (select count(*) from public.web_events where name = 'pageview'),
    'visitorDays', (select count(distinct visitor_day_hash) from public.web_events where name = 'pageview'),
    'outbound',    (select count(*) from public.web_events where name = 'outbound'),
    'busiestDay', (
      select jsonb_build_object('day', created_at::date, 'visitors', count(distinct visitor_day_hash))
      from public.web_events where name = 'pageview'
      group by created_at::date order by count(distinct visitor_day_hash) desc limit 1
    )
  ),
  'hourly', case when since > now() - interval '3 days' then (
    select coalesce(jsonb_agg(r order by r->>'hour'), '[]'::jsonb) from (
      select jsonb_build_object(
        'hour', date_trunc('hour', created_at),
        'views', count(*) filter (where name = 'pageview'),
        'visitors', count(distinct visitor_day_hash) filter (where name = 'pageview')
      ) r
      from win group by date_trunc('hour', created_at)
    ) s
  ) else '[]'::jsonb end,
  'daily', (
    select coalesce(jsonb_agg(r order by r->>'day'), '[]'::jsonb) from (
      select jsonb_build_object(
        'day', created_at::date,
        'views', count(*) filter (where name = 'pageview'),
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

revoke execute on function public.stats_summary_since(timestamptz) from public;
revoke execute on function public.stats_summary_since(timestamptz) from anon;
revoke execute on function public.stats_summary_since(timestamptz) from authenticated;
grant execute on function public.stats_summary_since(timestamptz) to service_role;
