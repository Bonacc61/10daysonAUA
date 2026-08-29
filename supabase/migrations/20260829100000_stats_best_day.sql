-- The "Best day" window: the whole dashboard, scoped to the single busiest day.
--
-- WHY: the all-time row already names the best day and its visitor count, and
-- the next question is always "and what happened on it — where did they come
-- from, what did they click?". Answering that needs every breakdown the summary
-- computes, over a window bounded on BOTH sides — which stats_summary_since
-- cannot express: its window always runs to now().
--
-- So the body moves to stats_summary_range(since, until) and the old signature
-- becomes a wrapper with until = infinity, the same move stats_summary itself
-- made in 20260823180000. One body; every existing caller keeps working.
--
-- WHICH day is best is decided HERE, at request time, not by the client: the
-- page's rule is that the window comes back from the function so the header
-- describes what was measured, and a client echoing back a day from an earlier
-- response could name yesterday's best day after today overtook it. Ties break
-- to the most recent day — deliberate and deterministic, where the allTime
-- busiestDay tile leaves its tie to the planner; with real traffic two days
-- with identical distinct-visitor counts are rare enough not to chase.
--
-- Body copied unchanged from 20260825160000 except:
--   * `win` gains `and created_at < until`;
--   * the hourly gate becomes "the window is at most 3 days WIDE" —
--     least(until, now()) - since — which is the old `since > now() - 3 days`
--     when until is infinity, and for a bounded single day means the best day
--     keeps its hour-by-hour chart however long ago it was.

create or replace function public.stats_summary_range(since timestamptz, until timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with win as (
  select * from public.web_events where created_at >= since and created_at < until
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
  'hourly', case when least(until, now()) - since <= interval '3 days' then (
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
  'referrers', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('host', referrer_host, 'n', count(distinct visitor_day_hash)) r
      from win
      where referrer_host is not null
        and referrer_host not in ('10daysonaruba.com', 'www.10daysonaruba.com')
      group by referrer_host order by count(distinct visitor_day_hash) desc limit 20
    ) s
  ),
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
  'questionnaireFunnel', (
    with qwin as (
      select * from win where created_at >= greatest(since, '2026-08-25 22:40+00'::timestamptz)
    )
    select jsonb_build_object(
      'viewed',  (select count(distinct visitor_day_hash) from qwin where name = 'pageview' and path = '/questionnaire'),
      'started', (select count(distinct visitor_day_hash) from qwin where milestone = 'questionnaire_started'),
      'reached', (
        select coalesce(jsonb_object_agg(milestone, n), '{}'::jsonb) from (
          select milestone, count(distinct visitor_day_hash) n
          from qwin where milestone like 'q\_reached\_%' escape '\'
          group by milestone
        ) s
      )
    )
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

-- The old signature delegates rather than duplicating, same as stats_summary
-- before it. 'infinity' compares greater than any created_at, so the window is
-- exactly what it was: since to now.
create or replace function public.stats_summary_since(since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.stats_summary_range(since, 'infinity')
$$;

-- Picks the day, then delegates. The casts go through `at time zone 'utc'`
-- explicitly: created_at::date buckets on the session timezone (UTC on this
-- database, and everything upstream — the visitor hash rotation, the daily
-- chart — assumes it), and the bounds must land on that same midnight rather
-- than whatever timezone a future session happens to run in.
--
-- With no pageviews at all there is no best day; the coalesce arm returns an
-- empty-window summary rather than SQL null, so the edge function still has an
-- object to serve and the page reads it as "nothing recorded yet".
create or replace function public.stats_summary_best_day()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select public.stats_summary_range(
               (best.d::timestamp at time zone 'utc'),
               ((best.d + 1)::timestamp at time zone 'utc')
             ) || jsonb_build_object('bestDay', to_char(best.d, 'YYYY-MM-DD'))
      from (
        select created_at::date as d
        from public.web_events
        where name = 'pageview'
        group by created_at::date
        order by count(distinct visitor_day_hash) desc, created_at::date desc
        limit 1
      ) best
    ),
    public.stats_summary_range(now(), now())
  );
$$;

-- THE HALF THAT KEEPS CALLERS OUT — same four lines as every stats function,
-- and not optional: SECURITY DEFINER in `public` is published by PostgREST with
-- EXECUTE granted to PUBLIC by default.
revoke execute on function public.stats_summary_range(timestamptz, timestamptz) from public;
revoke execute on function public.stats_summary_range(timestamptz, timestamptz) from anon;
revoke execute on function public.stats_summary_range(timestamptz, timestamptz) from authenticated;
grant execute on function public.stats_summary_range(timestamptz, timestamptz) to service_role;

revoke execute on function public.stats_summary_since(timestamptz) from public;
revoke execute on function public.stats_summary_since(timestamptz) from anon;
revoke execute on function public.stats_summary_since(timestamptz) from authenticated;
grant execute on function public.stats_summary_since(timestamptz) to service_role;

revoke execute on function public.stats_summary_best_day() from public;
revoke execute on function public.stats_summary_best_day() from anon;
revoke execute on function public.stats_summary_best_day() from authenticated;
grant execute on function public.stats_summary_best_day() to service_role;
