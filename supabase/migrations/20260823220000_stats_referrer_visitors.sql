-- Referrers and campaigns: count VISITORS, and drop self-referrals.
--
-- Two faults in the same list, both found by reading a single odd row on the
-- dashboard — "10daysonaruba.com, 1 pageview" as an acquisition source.
--
-- 1. It counted ROWS. The client sends document.referrer on every pageview, and
--    the browser keeps that value across in-app navigation, so one visit from
--    Reddit that opened five pages recorded five reddit.com rows. The list read
--    as traffic sources but measured page opens.
--
-- 2. Our own host appeared in it. That is a full page load from one of our own
--    pages — a refresh, or a link opening in a new tab. It is noise, and every
--    analytics tool filters it for the same reason.
--
-- Filtered and counted HERE rather than in `collect` on purpose: the raw column
-- goes on recording what the browser actually said, and rows written before
-- this change are corrected in the report without editing anybody's data.

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
  -- DISTINCT VISITORS, not pageviews, and never our own domain.
  --
  -- Counting rows answered "how many page opens carried this referrer", which
  -- is not the question anyone asks of this list: a visit arriving from Reddit
  -- and opening five pages recorded five rows, all of them saying reddit.com,
  -- because the browser keeps the referrer across in-app navigation. "Reddit
  -- sent us N" now means N visitors.
  --
  -- Own-host rows are a SELF-REFERRAL: a full page load from one of our own
  -- pages, which happens on a refresh or a link opening in a new tab. It says
  -- nothing about where traffic comes from and sat in the list looking like an
  -- acquisition source. Filtered here rather than at write time so the raw
  -- column keeps the truth and rows already recorded disappear from the report
  -- too.
  'referrers', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('host', referrer_host, 'n', count(distinct visitor_day_hash)) r
      from win
      where referrer_host is not null
        and referrer_host not in ('10daysonaruba.com', 'www.10daysonaruba.com')
      group by referrer_host order by count(distinct visitor_day_hash) desc limit 20
    ) s
  ),
  -- Same change, same reason: "this post sent N" should mean people, not page
  -- opens. Over a window longer than a day these are visitor-days, exactly as
  -- everywhere else on this page, and the page labels them accordingly.
  'campaigns', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('campaign', campaign, 'n', count(distinct visitor_day_hash)) r
      from win where campaign is not null
      group by campaign order by count(distinct visitor_day_hash) desc limit 20
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
