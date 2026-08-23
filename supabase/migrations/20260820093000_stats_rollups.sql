-- Aggregates for the internal /stats page.
--
-- SECURITY DEFINER so the function can read web_events, which has RLS on and no
-- policies at all. That is NOT on its own enough to keep callers out — see
-- 20260820092000, where exactly this shape left country_for_ip answering the
-- public anon key. The revoke at the bottom is what closes it, and it is the
-- load-bearing half: without it this endpoint hands the whole analytics summary
-- to anyone with the anon key, which ships in the browser bundle.

create or replace function public.stats_summary(days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with win as (
  -- `stats_summary.days` qualified deliberately: the argument name and the
  -- make_interval parameter name are both `days`, and the qualification is what
  -- says which one is meant.
  select * from public.web_events
   where created_at >= now() - make_interval(days => stats_summary.days)
)
select jsonb_build_object(
  'daily', (
    select coalesce(jsonb_agg(r order by r->>'day'), '[]'::jsonb) from (
      select jsonb_build_object(
        'day', created_at::date,
        'views', count(*) filter (where name = 'pageview'),
        -- DAILY uniques. These must never be summed across days: the visitor
        -- hash rotates at midnight UTC, so a visitor on five days is five.
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
    -- Grouped by destination host so a direct-operator booking link is never
    -- counted as Viator traffic. Map's popup sends both kinds.
    select coalesce(jsonb_agg(r order by (r->>'clicks')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('host', destination_host, 'clicks', count(*)) r
      from win where name = 'outbound' and destination_host is not null
      group by destination_host order by count(*) desc limit 20
    ) s
  )
);
$$;

-- The half that actually keeps callers out. Without this, one anon-key POST to
-- /rest/v1/rpc/stats_summary returns everything below.
revoke execute on function public.stats_summary(int) from public;

revoke execute on function public.stats_summary(int) from anon;

revoke execute on function public.stats_summary(int) from authenticated;

grant execute on function public.stats_summary(int) to service_role;
