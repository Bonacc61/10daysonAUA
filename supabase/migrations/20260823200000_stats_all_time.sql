-- Adds `allTime` to the stats summary: the same headline figures, unwindowed.
--
-- WHY: every number on /stats is scoped to the selected window, so there was no
-- way to answer "how much have we had in total". That is the figure that grows,
-- and the one worth watching early on when a single day says very little.
--
-- NAMING, deliberately: `visitorDays`, not `visitors`. Across days the visitor
-- code is rebuilt at midnight, so this is the sum of daily uniques and NOT a
-- count of people — the same trap the windowed figures were relabelled to avoid.
-- An all-time "unique visitors" number cannot be produced from this table by
-- construction, and calling this one that would be the worst place to slip,
-- since it is the largest number on the page.
--
-- COST: three aggregates over the whole table per request, where the windowed
-- half touches only the window. web_events is small today and both counts ride
-- the same sequential scan. When it is not small, the `web_daily` rollup
-- (docs/ROADMAP.md item 22, needed before 2027-08 for retention anyway) is what
-- this should read from instead.
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
    -- Sum of daily uniques. NOT people. See the note above.
    'visitorDays', (select count(distinct visitor_day_hash) from public.web_events where name = 'pageview'),
    'outbound',    (select count(*) from public.web_events where name = 'outbound'),
    'busiestDay', (
      select jsonb_build_object('day', created_at::date, 'visitors', count(distinct visitor_day_hash))
      from public.web_events where name = 'pageview'
      group by created_at::date order by count(distinct visitor_day_hash) desc limit 1
    )
  ),
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
