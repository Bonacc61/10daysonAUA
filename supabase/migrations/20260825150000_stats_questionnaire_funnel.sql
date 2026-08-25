-- Questionnaire drop-off: at which question do travellers stop?
--
-- WHY: the funnel's "Started the questionnaire" is one bar for seven
-- questions, so a drop between opening the questionnaire and generating an
-- itinerary could not be located. The client now fires a q_reached_N
-- milestone on arriving at question N (collect allowlists exactly
-- q_reached_2..q_reached_7); this adds one distinct-visitor count per step,
-- keyed by milestone name so the SQL needs no edit when a question is added —
-- only the allowlist and the dashboard labels do.
--
-- Everything below this key is copied unchanged from 20260823240000.

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
  -- Pageviews AND unique visitors per page. The list answered "how many times
  -- was this opened", and the question actually being asked of it is "what share
  -- of visitors got here" — which needs the distinct count and the trip total to
  -- divide by. Both are returned so the page can show the share without a second
  -- request or a client-side guess.
  'topPaths', (
    select coalesce(jsonb_agg(r order by (r->>'visitors')::int desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'path', path,
        'n', count(*),
        'visitors', count(distinct visitor_day_hash)
      ) r
      from win where name = 'pageview'
      group by path order by count(distinct visitor_day_hash) desc limit 20
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
  -- Where the questionnaire loses people. One count of distinct visitors per
  -- question REACHED (q_reached_N fires on arriving at question N, wired
  -- 2026-08-25), bracketed by the page open and the generate milestone. Same
  -- daily-hash caveat as everywhere else: across a multi-day window these are
  -- visitor-days, and a traveller finishing after midnight UTC is two of them.
  'questionnaireFunnel', jsonb_build_object(
    'viewed',  (select count(distinct visitor_day_hash) from win where name = 'pageview' and path = '/questionnaire'),
    'started', (select count(distinct visitor_day_hash) from win where milestone = 'questionnaire_started'),
    'reached', (
      select coalesce(jsonb_object_agg(milestone, n), '{}'::jsonb) from (
        select milestone, count(distinct visitor_day_hash) n
        from win where milestone like 'q\_reached\_%' escape '\'
        group by milestone
      ) s
    ),
    'generated', (select count(distinct visitor_day_hash) from win where milestone = 'itinerary_generated')
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
