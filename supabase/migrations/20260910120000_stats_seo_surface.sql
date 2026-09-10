-- The SEO surface: are the generated content pages earning their keep?
--
-- WHY: the SEO/GEO strategy (docs/superpowers/specs/2026-09-10-seo-geo-strategy-design.md)
-- commits to a decision at ~6 weeks — expand the 58 pages or cut them, "from
-- numbers, not vibes". /stats could not answer that. This key is those numbers,
-- and it is deliberately three of them and no more.
--
-- WHAT IT CAN NEVER BE. Viator returns no booking signal at all, so nothing
-- here is a conversion rate and nothing here is revenue. The only outcome this
-- pipe observes is a CLICK SENT OUT. The dashboard says so beside the figure;
-- this comment says so beside the query, because the temptation to relabel a
-- clicks-per-visitor number as a conversion rate is exactly what would make a
-- partner conversation go wrong.
--
-- THE DAILY-HASH CAVEAT applies to all three, as everywhere else on this page:
-- visitor_day_hash is one identity PER PERSON PER DAY (20260820090000), so over
-- a multi-day window these are visitor-days, not people, and they must never be
-- summed into a monthly unique. It is also what makes the joins below legal:
-- campaign and referrer_host are stamped on PAGEVIEWS only (collect/index.ts),
-- so tying a visitor's arrival to their later click or milestone is a join on
-- the hash — which holds WITHIN a UTC day and does not exist across days.
--
-- Body copied unchanged from 20260829100000 except for the 'seo' key, which is
-- added to stats_summary_range only. stats_summary_since and
-- stats_summary_best_day are re-declared verbatim below because they delegate
-- to the range function: they inherit the key, and they are restated here so
-- this file shows all three in the state it leaves them.

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
  -- 1/3 — CLICK-OUTS PER VISITOR, content pages vs the rest of the site.
  --
  -- The one figure tied to the goal: do the generated pages send people to a
  -- partner more or less often than the tool does? A visitor-day is put in the
  -- SEO group when its EARLIEST pageview in this window was a /things-to-do
  -- path ('/things-to-do' and '/things-to-do/:slug' are the only two shapes
  -- collect allowlists) — first-touch attribution, not "touched at any point".
  -- Engagement (curiosity, page count) drives both "opened a content page at
  -- some point" AND "clicked out", so grouping on ANY touch mechanically
  -- enriches the content group with clickers regardless of how they arrived.
  -- Grouping on the ENTRY page ties the outcome to arrival channel, which is
  -- what "did SEO traffic convert" actually asks. A visitor who lands on the
  -- planner directly and wanders into a content page later counts as planner
  -- here — a content page that only ASSISTS someone who arrived elsewhere gets
  -- no credit in this figure. That is the honest residual of any single-touch
  -- model, not a defect, and it is why a low number here does not mean content
  -- does nothing.
  --
  -- `entry` picks each visitor-day's first pageview with `distinct on`, tied
  -- deterministically by `id` (the identity primary key) after `created_at` so
  -- two pageviews sharing a timestamp cannot flip the entry page between runs.
  -- Restricting to name = 'pageview' before the distinct is what reproduces
  -- the old `having bool_or(name = 'pageview')` floor: a hash with outbound
  -- events but no pageview never gets an `entry` row, so it is excluded from
  -- both groups exactly as before.
  --
  -- BOTH the visitor count and the click count go back, per group, on purpose.
  -- The dashboard needs the base to decide whether the rate is worth reading at
  -- all: 2 clicks from 3 visitors is 0.67 per visitor and means nothing.
  --
  -- Restricted to hashes with at least one pageview in the window, which is the
  -- same population 'funnel'.visitors counts, so the two rows are comparable. A
  -- visitor whose pageview fell before `since` and whose click fell inside it is
  -- therefore not counted either way; at window edges that is a rounding error,
  -- and the alternative counts a click-only hash as a whole visitor.
  'seo', jsonb_build_object(
    'clickOuts', (
      with entry as (
        select distinct on (visitor_day_hash)
               visitor_day_hash,
               path like '/things-to-do%' as on_seo
        from win
        where name = 'pageview'
        order by visitor_day_hash, created_at, id
      ),
      clicks as (
        select visitor_day_hash, count(*) as clicks
        from win
        where name = 'outbound'
        group by visitor_day_hash
      ),
      seen as (
        select e.visitor_day_hash,
               e.on_seo,
               coalesce(c.clicks, 0) as clicks
        from entry e
        left join clicks c using (visitor_day_hash)
      )
      select jsonb_build_object(
        'seoVisitors',     coalesce(count(*) filter (where on_seo), 0),
        'seoClicks',       coalesce(sum(clicks) filter (where on_seo), 0),
        'plannerVisitors', coalesce(count(*) filter (where not on_seo), 0),
        'plannerClicks',   coalesce(sum(clicks) filter (where not on_seo), 0)
      ) from seen
    ),
    -- 2/3 — ANSWER-ENGINE REFERRALS.
    --
    -- DO NOT DELETE THIS AS CLUTTER, however small the numbers are. It is the
    -- ONLY observable GEO signal this project has: an answer engine that reads
    -- a page and cites it without the reader clicking through leaves no trace
    -- anywhere, so a handful of referrals is the visible edge of something
    -- unmeasurable. The strategy states this outright — "we will see the tide,
    -- not the waves".
    --
    -- An explicit allowlist rather than a pattern, because that is the whole
    -- point: five or six visits scattered across six hosts never reach the top
    -- of the 20-row `referrers` list and vanish into the long tail. Naming the
    -- hosts is what makes them countable. referrer_host is already lowercased
    -- and stripped of a leading 'www.' by collect/normalise.ts, so these are
    -- compared as stored. Add a host here when a new assistant appears; the
    -- list is a judgement, not a fact.
    'answerEngines', (
      select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('host', referrer_host, 'n', count(distinct visitor_day_hash)) r
        from win
        where referrer_host in (
          'chatgpt.com', 'openai.com', 'perplexity.ai',
          'claude.ai', 'gemini.google.com', 'copilot.microsoft.com'
        )
        group by referrer_host
      ) s
    ),
    -- 3/3 — SEO -> PLANNER.
    --
    -- The generated pages CTA into /questionnaire?ref=seo-<id> (src/seo/render.ts),
    -- and collect stamps that on the arriving pageview as campaign 'seo-<id>'
    -- (or 'seo-index' from the hub). So `campaign like 'seo-%'` is exactly the
    -- set of visitors a content page handed to the tool.
    --
    -- "Reached the questionnaire" is measured with the EXISTING q_reached_N
    -- milestones rather than a new one, and the choice of those over a
    -- /questionnaire pageview is deliberate: the CTA lands ON the questionnaire,
    -- so the pageview is true by construction and would read as a flat 100%.
    -- q_reached_2 is the first that fires (collect allowlists q_reached_2..8),
    -- and it fires on ANSWERING question 1 — so this counts visitors who
    -- actually started answering, which is the thing worth knowing.
    'toPlanner', (
      with seo_visitors as (
        select distinct visitor_day_hash from win where campaign like 'seo-%'
      )
      select jsonb_build_object(
        'visitors', (select count(*) from seo_visitors),
        'questionnaire', (
          select count(distinct w.visitor_day_hash)
          from win w join seo_visitors v on v.visitor_day_hash = w.visitor_day_hash
          where w.milestone like 'q\_reached\_%' escape '\'
        )
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
