-- Fixtures and assertions for the /stats reporting functions.
--
-- Run by tools/run-verify-stats.cjs against a throwaway cluster it builds
-- itself. Never point this at production: the first statement truncates
-- web_events.
--
-- Every fixture below is a whole visitor-day written by hand, and every
-- expected number is derived from those rows by counting them on paper. The
-- point is that a wrong figure on /stats drives an expand-or-cut decision on
-- the 58 generated content pages, so "the SQL looked right" is not enough.
--
-- WHEN A STATS MIGRATION CHANGES: add fixtures for the new shape and add
-- assertions with hand-counted expectations. Then MUTATE the migration (flip a
-- comparison, drop a filter) and confirm the new assertion goes red — an
-- assertion that cannot fail is worse than no assertion, and several checks
-- below only became real after a mutation walked through them untouched.

set timezone = 'UTC';
truncate public.web_events restart identity;

-- === fixtures ==============================================================
-- All on one UTC day, because visitor_day_hash is one identity per person per
-- day and a join across midnight does not exist.

-- V1 enters on a content page, wanders to the planner, clicks out -> SEO, 1 click
insert into public.web_events (created_at, name, visitor_day_hash, path) values
  ('2026-09-01 10:00+00','pageview','h_seo1','/things-to-do/:slug'),
  ('2026-09-01 10:05+00','pageview','h_seo1','/questionnaire');
insert into public.web_events (created_at, name, visitor_day_hash, path, product_code, destination_host) values
  ('2026-09-01 10:10+00','outbound','h_seo1','/questionnaire','P1','viator.com');

-- V2 enters on '/', reaches a content page LATER, clicks out twice.
-- Must be NON-SEO. This is the visitor the first-touch change exists for:
-- under the old `bool_or(path like '/things-to-do%')` they counted as SEO.
insert into public.web_events (created_at, name, visitor_day_hash, path) values
  ('2026-09-01 11:00+00','pageview','h_nonseo1','/'),
  ('2026-09-01 11:05+00','pageview','h_nonseo1','/things-to-do/:slug');
insert into public.web_events (created_at, name, visitor_day_hash, path, product_code, destination_host) values
  ('2026-09-01 11:10+00','outbound','h_nonseo1','/things-to-do/:slug','P2','viator.com'),
  ('2026-09-01 11:11+00','outbound','h_nonseo1','/things-to-do/:slug','P3','viator.com');

-- V3/V4 share a created_at within the visitor. The entry page must come from
-- the id tiebreak, so h_tie_a is SEO and h_tie_b is not.
insert into public.web_events (created_at, name, visitor_day_hash, path) values
  ('2026-09-01 12:00+00','pageview','h_tie_a','/things-to-do'),
  ('2026-09-01 12:00+00','pageview','h_tie_a','/');
insert into public.web_events (created_at, name, visitor_day_hash, path) values
  ('2026-09-01 12:00+00','pageview','h_tie_b','/'),
  ('2026-09-01 12:00+00','pageview','h_tie_b','/things-to-do/:slug');

-- V5 has outbound events and no pageview at all: excluded from both groups,
-- and these three clicks must not surface anywhere in clickOuts.
insert into public.web_events (created_at, name, visitor_day_hash, path, product_code, destination_host) values
  ('2026-09-01 13:00+00','outbound','h_clickonly','other','P4','viator.com'),
  ('2026-09-01 13:01+00','outbound','h_clickonly','other','P5','viator.com'),
  ('2026-09-01 13:02+00','outbound','h_clickonly','other','P6','viator.com');

-- Answer engines, plus one ordinary search referrer that must NOT be counted.
insert into public.web_events (created_at, name, visitor_day_hash, path, referrer_host) values
  ('2026-09-01 14:00+00','pageview','h_ae1','/','chatgpt.com'),
  ('2026-09-01 14:01+00','pageview','h_ae2','/','perplexity.ai'),
  ('2026-09-01 14:02+00','pageview','h_ae3','/','chatgpt.com'),
  ('2026-09-01 14:03+00','pageview','h_notai','/','google.com');

-- seo-* campaigns arriving at the planner. Only h_seocamp1 answers a question.
insert into public.web_events (created_at, name, visitor_day_hash, path, campaign) values
  ('2026-09-01 15:00+00','pageview','h_seocamp1','/questionnaire','seo-arikok'),
  ('2026-09-01 15:10+00','pageview','h_seocamp2','/questionnaire','seo-index'),
  ('2026-09-01 15:20+00','pageview','h_nonseocamp','/questionnaire','reddit'),
  ('2026-09-01 16:00+00','pageview','h_seocamp3','/questionnaire','seo-eagle'),
  ('2026-09-01 16:10+00','pageview','h_seocamp4','/questionnaire','seo-esc');
insert into public.web_events (created_at, name, visitor_day_hash, milestone) values
  ('2026-09-01 15:05+00','milestone','h_seocamp1','q_reached_3'),
  -- a SECOND milestone for the same visitor: toPlanner must still count them once
  ('2026-09-01 15:06+00','milestone','h_seocamp1','q_reached_4'),
  ('2026-09-01 15:25+00','milestone','h_nonseocamp','q_reached_3'),
  ('2026-09-01 16:05+00','milestone','h_seocamp3','itinerary_generated'),
  -- 'qareachedb3' matches 'q_reached_%' unless the underscores are escaped
  ('2026-09-01 16:15+00','milestone','h_seocamp4','qareachedb3');

-- Push the tie rows that must LOSE to the end of the heap, so a plain seqscan
-- meets the wrong candidate first.
update public.web_events set path = path
 where visitor_day_hash = 'h_tie_a' and path = '/';
update public.web_events set path = path
 where visitor_day_hash = 'h_tie_b' and path like '/things-to-do%';

-- A 2000-row tie where only the FIRST row (lowest id) is a content page. Two
-- tied rows are not enough to make a sort reorder anything; two thousand are.
-- Without the `id` tiebreak in the distinct-on ordering this visitor flips.
insert into public.web_events (created_at, name, visitor_day_hash, path)
  values ('2026-09-01 17:00+00','pageview','h_tie_c','/things-to-do');
insert into public.web_events (created_at, name, visitor_day_hash, path)
  select '2026-09-01 17:00+00','pageview','h_tie_c','/' from generate_series(1,1999);

-- === assertions ============================================================

create temp table result (n int generated always as identity, check_name text, expected text, actual text);

create or replace function pg_temp.chk(nm text, expected text, actual text) returns void
language sql as $fn$ insert into result (check_name, expected, actual) values (nm, expected, actual) $fn$;

do $harness$
declare
  w jsonb := public.stats_summary_range('2026-09-01 00:00+00','2026-09-02 00:00+00');
  e jsonb := public.stats_summary_range('2027-01-01 00:00+00','2027-01-02 00:00+00');
  s jsonb := public.stats_summary_since('2026-09-01 00:00+00');
  b jsonb := public.stats_summary_best_day();
  a jsonb;
  i int;
  seen text;
begin
  -- first-touch attribution
  perform pg_temp.chk('A1 seoVisitors (h_seo1 + h_tie_a + h_tie_c)', '3', w#>>'{seo,clickOuts,seoVisitors}');
  perform pg_temp.chk('A2 seoClicks (h_seo1 only)',                  '1', w#>>'{seo,clickOuts,seoClicks}');
  perform pg_temp.chk('A3 plannerVisitors (incl. h_nonseo1, h_tie_b)','11', w#>>'{seo,clickOuts,plannerVisitors}');
  perform pg_temp.chk('A4 plannerClicks (h_nonseo1 x2)',             '2', w#>>'{seo,clickOuts,plannerClicks}');
  -- the witness that the change is not a no-op: the retired bool_or logic
  -- gives a different, larger number on exactly this data
  perform pg_temp.chk('A5 retired bool_or logic would say (must differ from A1)', '5', (
    select count(*)::text from (
      select visitor_day_hash from public.web_events
      where created_at >= '2026-09-01 00:00+00' and created_at < '2026-09-02 00:00+00'
      group by visitor_day_hash
      having bool_or(name = 'pageview')
         and bool_or(name = 'pageview' and path like '/things-to-do%')
    ) q));
  -- pageview floor
  perform pg_temp.chk('A6 classified visitors exclude h_clickonly', '14',
    ((w#>>'{seo,clickOuts,seoVisitors}')::int + (w#>>'{seo,clickOuts,plannerVisitors}')::int)::text);
  perform pg_temp.chk('A7 counted clicks exclude h_clickonly''s 3', '3',
    ((w#>>'{seo,clickOuts,seoClicks}')::int + (w#>>'{seo,clickOuts,plannerClicks}')::int)::text);
  perform pg_temp.chk('A8 sanity: 6 outbound rows exist, 3 are counted', '6',
    (select count(*)::text from public.web_events where name='outbound'
      and created_at >= '2026-09-01 00:00+00' and created_at < '2026-09-02 00:00+00'));
  -- answer engines
  perform pg_temp.chk('A9 answerEngines', '[{"n": 2, "host": "chatgpt.com"}, {"n": 1, "host": "perplexity.ai"}]',
    (w#>'{seo,answerEngines}')::text);
  perform pg_temp.chk('A10 google.com NOT in answerEngines', 'false',
    ((w#>>'{seo,answerEngines}') like '%google%')::text);
  -- seo -> planner
  perform pg_temp.chk('A11 toPlanner.visitors (4 seo-* campaigns)', '4', w#>>'{seo,toPlanner,visitors}');
  perform pg_temp.chk('A12 toPlanner.questionnaire (h_seocamp1 once; itinerary_generated and qareachedb3 excluded)',
    '1', w#>>'{seo,toPlanner,questionnaire}');
  -- empty window: zeros, never null, never an error
  perform pg_temp.chk('A13 empty seoVisitors',     '0',  e#>>'{seo,clickOuts,seoVisitors}');
  perform pg_temp.chk('A14 empty seoClicks',       '0',  e#>>'{seo,clickOuts,seoClicks}');
  perform pg_temp.chk('A15 empty plannerVisitors', '0',  e#>>'{seo,clickOuts,plannerVisitors}');
  perform pg_temp.chk('A16 empty plannerClicks',   '0',  e#>>'{seo,clickOuts,plannerClicks}');
  perform pg_temp.chk('A17 empty answerEngines',   '[]', (e#>'{seo,answerEngines}')::text);
  perform pg_temp.chk('A18 empty toPlanner', '{"visitors": 0, "questionnaire": 0}', (e#>'{seo,toPlanner}')::text);
  perform pg_temp.chk('A19 empty clickOuts carries no json nulls', 'false',
    ((e#>'{seo,clickOuts}')::text like '%null%')::text);
  -- all three entry points carry the key, and agree
  perform pg_temp.chk('A20 stats_summary_range has seo key',    'true', (w ? 'seo')::text);
  perform pg_temp.chk('A21 stats_summary_since has seo key',    'true', (s ? 'seo')::text);
  perform pg_temp.chk('A22 stats_summary_best_day has seo key', 'true', (b ? 'seo')::text);
  perform pg_temp.chk('A23 best_day picked 2026-09-01', '2026-09-01', b#>>'{bestDay}');
  perform pg_temp.chk('A24 best_day seo block == range seo block', (w#>'{seo}')::text, (b#>'{seo}')::text);
  perform pg_temp.chk('A25 since seo block == range seo block',    (w#>'{seo}')::text, (s#>'{seo}')::text);
  -- determinism of the created_at ties, forced through several plan shapes
  seen := null;
  for i in 1..8 loop
    if    i = 2 then set local enable_seqscan = off;
    elsif i = 3 then set local enable_indexscan = off;
    elsif i = 4 then set local enable_sort = off;
    elsif i = 5 then set local enable_hashagg = off;
    elsif i = 6 then set local enable_material = off;
    elsif i = 7 then set local enable_bitmapscan = off;
    else reset all; set local timezone = 'UTC';
    end if;
    a := public.stats_summary_range('2026-09-01 00:00+00','2026-09-02 00:00+00') #> '{seo,clickOuts}';
    if seen is null then seen := a::text;
    elsif seen <> a::text then seen := 'FLIPPED on run ' || i || ': ' || a::text;
    end if;
  end loop;
  reset all;
  perform pg_temp.chk('A26 tie determinism over 8 runs x 7 planner configs',
    '{"seoClicks": 1, "seoVisitors": 3, "plannerClicks": 2, "plannerVisitors": 11}', seen);
  -- the revokes are the load-bearing half of every SECURITY DEFINER function here
  perform pg_temp.chk('A27 no stats function is executable by public/anon/authenticated', '0', (
    select count(*)::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'stats_summary%'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))));
  perform pg_temp.chk('A28 every stats function is executable by service_role', '0', (
    select count(*)::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'stats_summary%'
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')));
end $harness$;

\pset format aligned
select n, check_name,
       case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict,
       expected, actual
from result order by n;

\pset format unaligned
\pset tuples_only on
select 'FAILURES=' || count(*) filter (where expected is distinct from actual) from result;
