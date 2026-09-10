// The SQL contract the dashboard depends on, checked as TEXT.
//
// READ THIS BEFORE TRUSTING IT. There is no Postgres in this suite and none in
// CI, so nothing here executes a query. These assertions prove that the
// migration DECLARES the three summary functions and that the `seo` key is
// reachable from all three; they prove NOTHING about what the query returns.
// A wrong join, a wrong filter or a wrong count would pass every line below.
// The behaviour is verified by running the migration and reading /stats.
//
// It still earns its place, because the failure it guards against is a real one
// this dashboard has had twice: a key added to one summary function and not the
// others, so a metric exists on the 7-day window and vanishes on Best day. That
// is a text-level mistake and a text-level check catches it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SQL = readFileSync('supabase/migrations/20260910120000_stats_seo_surface.sql', 'utf8');

/** The body between `create or replace function public.<name>` and its `$$;` terminator. */
function fnBody(name: string): string {
  const head = `create or replace function public.${name}`;
  const start = SQL.indexOf(head);
  if (start === -1) throw new Error(`${name} is not declared in the migration`);
  const end = SQL.indexOf('\n$$;', start);
  if (end === -1) throw new Error(`${name} has no terminator`);
  return SQL.slice(start, end);
}

const THE_THREE = ['stats_summary_range', 'stats_summary_since', 'stats_summary_best_day'];

describe('the seo key reaches all three summary windows', () => {
  it('declares exactly the three functions the edge function can call', () => {
    const declared = [...SQL.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    // Set equality, not "contains": a fourth function appearing here, or one of
    // the three quietly dropped, both matter. Sorted so order is not asserted.
    expect([...new Set(declared)].sort()).toEqual([...THE_THREE].sort());
    // Non-vacuity floor: the regex above finding nothing would make an
    // "every declared function..." loop pass silently.
    expect(declared.length).toBeGreaterThanOrEqual(3);
  });

  it('names each of the three exactly as supabase/functions/stats/index.ts calls it', () => {
    // The RPC names are chosen in index.ts by string literal. A rename on either
    // side that the other did not follow is a 503 on the dashboard.
    //
    // The names are read out of the RPC-SELECTING EXPRESSION, not out of the
    // whole file: a first cut asserted `fn.includes(name)` and passed happily
    // against a renamed call, because a COMMENT sixteen lines above still spelled
    // the old name. Caught by mutation-checking this very test.
    const fn = readFileSync('supabase/functions/stats/index.ts', 'utf8');
    const selector = fn.slice(fn.indexOf('const [fn, args]'), fn.indexOf('const rpc'));
    expect(selector).toContain('win.kind'); // non-vacuity: the slice found the expression
    const called = [...selector.matchAll(/\['(\w+)',/g)].map((m) => m[1]);
    expect(called.sort()).toEqual([...THE_THREE].sort());
  });

  it('builds the seo key in the one function that has a body', () => {
    const range = fnBody('stats_summary_range');
    expect(range).toContain("'seo', jsonb_build_object(");
    // The three figures, by the exact key names src/pages/Stats.tsx reads.
    for (const key of ['clickOuts', 'answerEngines', 'toPlanner']) {
      expect(range).toContain(`'${key}'`);
    }
    for (const key of ['seoVisitors', 'seoClicks', 'plannerVisitors', 'plannerClicks']) {
      expect(range).toContain(`'${key}'`);
    }
  });

  it('groups clickOuts by entry page (distinct on, ordered), not by bool_or-anywhere', () => {
    // This is a TEXT check and cannot prove the query's behaviour — it cannot
    // run against Postgres in this suite. What it CAN prove is that the
    // first-touch shape is present in the SQL and the old any-touch shape
    // (`bool_or(name = 'pageview' and path like`) is gone. A regression back to
    // bool_or would still declare the three functions and the same jsonb keys,
    // so the earlier structural tests would keep passing even though the
    // metric's meaning changed — this test is what catches that.
    const range = fnBody('stats_summary_range');
    expect(range).toContain('distinct on (visitor_day_hash)');
    expect(range).toMatch(/order by visitor_day_hash,\s*created_at,\s*id/);
    expect(range).not.toMatch(/bool_or\(name = 'pageview' and path like/);
  });

  it('gives the other two the key by delegating, so no window can be missing it', () => {
    // These two hold no body of their own (20260829100000 made them wrappers),
    // so "contains 'seo'" would be the wrong assertion — the right one is that
    // they call the function that does.
    for (const name of ['stats_summary_since', 'stats_summary_best_day']) {
      const body = fnBody(name);
      expect(body).toContain('public.stats_summary_range');
      expect(body).not.toContain("'seo'");
    }
  });

  it('keeps the six answer-engine hosts the strategy names', () => {
    const range = fnBody('stats_summary_range');
    const hosts = ['chatgpt.com', 'openai.com', 'perplexity.ai', 'claude.ai',
      'gemini.google.com', 'copilot.microsoft.com'];
    const inList = hosts.filter((h) => range.includes(`'${h}'`));
    expect(inList).toEqual(hosts);
  });

  it('re-revokes and re-grants every function it redeclares', () => {
    // SECURITY DEFINER in `public` is EXECUTE-to-PUBLIC by default, and
    // create-or-replace does not carry the old grants forward reliably enough to
    // leave out. Every stats migration repeats these four lines; this asserts
    // the new one did too.
    for (const name of THE_THREE) {
      for (const who of ['public', 'anon', 'authenticated']) {
        expect(SQL).toMatch(new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from ${who};`));
      }
      expect(SQL).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`));
    }
  });
});

describe('what the SQL comments must keep saying', () => {
  it('states that the answer-engine list is the only GEO signal there is', () => {
    // Asked for by the strategy, and written into the migration so the next
    // person tidying up a 3-row list knows what they would be deleting.
    expect(SQL).toMatch(/only observable geo signal/i);
  });

  it('never labels a figure a booking, a conversion or revenue', () => {
    // The words may appear in a comment that RULES THEM OUT — that is the point
    // of the comment. What must not exist is a jsonb key named after one.
    const keys = [...SQL.matchAll(/'([A-Za-z][A-Za-z0-9]*)',\s*(?:jsonb|\()/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5); // non-vacuity: the regex found keys
    for (const k of keys) expect(k).not.toMatch(/booking|revenue|conversion/i);
  });
});
