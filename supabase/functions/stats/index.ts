// stats — the read side of the cookieless analytics pipe. INTERNAL ONLY.
//
// Spec: docs/superpowers/specs/2026-08-14-internal-analytics-dashboard-design.md
//
// This endpoint returns the whole traffic summary in one object: visitor counts,
// where they came from, which campaign brought them, which products they clicked
// out to. That is commercially sensitive in a way the rest of the site is not —
// it is the number you would quote to a partner — so the access rules here are
// the point of the function, not scaffolding around it.
//
// THREE THINGS KEEP IT SHUT, and they are deliberately not the same mechanism:
//
//   1. The uid comes from the TOKEN, never from the body or a query parameter.
//      There is no id to tamper with. Same rule as account-delete.
//   2. That uid must appear in ADMIN_UIDS, a Supabase secret. An UNSET secret
//      means nobody, never everybody — an allowlist that fails open is worse
//      than no allowlist, because it looks like access control.
//   3. stats_summary itself is REVOKEd from public/anon/authenticated
//      (20260820092000, 20260820093000). Even holding a valid user token, a
//      caller cannot reach the data through PostgREST directly; only the service
//      role can execute it, and the service role never leaves this function.
//
// Deployed WITH jwt verification (no --no-verify-jwt), unlike `collect`. The
// beacon cannot send headers; a signed-in admin's browser can.
import { corsHeaders } from '../_shared/cors.ts';
import { parseWindow } from './window.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !service) return json({ error: 'not configured' }, 500);

  // --- Who is asking ---------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  // Resolved by Supabase, not by us: no local JWT parsing, so an expired or
  // revoked token fails here rather than being read as valid. Presenting the
  // ANON key as a bearer token lands here too — it is a valid JWT with no user
  // behind it, so this returns no id and the request 401s like any other.
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: anon },
  });
  if (!userRes.ok) return json({ error: 'unauthorized' }, 401);
  const { id: uid } = (await userRes.json()) as { id?: string };
  if (!uid) return json({ error: 'unauthorized' }, 401);

  // --- May they ask ----------------------------------------------------------
  // FAIL CLOSED. An unset or empty ADMIN_UIDS produces an empty allowlist, which
  // admits nobody — including the owner. That is the correct failure: a stats
  // page that stops working is a bad afternoon, and one that opens to every
  // signed-in traveller is a different kind of problem entirely.
  const allow = (Deno.env.get('ADMIN_UIDS') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!allow.includes(uid)) return json({ error: 'forbidden' }, 403);

  // --- The numbers -----------------------------------------------------------
  // The server's clock decides what "today" means, not the browser's — a client
  // four hours behind UTC would otherwise ask for a window starting at 20:00 the
  // previous evening and have it labelled Today.
  const win = parseWindow(new URL(req.url).searchParams.get('days'), new Date());

  const rpc = await fetch(`${url}/rest/v1/rpc/stats_summary_since`, {
    method: 'POST',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ since: win.since }),
  });

  if (!rpc.ok) {
    // Status only. An error body from PostgREST can quote the statement that
    // failed, and this one names analytics columns; there is nothing a caller
    // could do with it either way.
    console.error(`[stats] summary failed: ${rpc.status}`);
    return json({ error: 'unavailable' }, 503);
  }

  // The window goes back with the data so the page labels itself from what was
  // actually measured rather than from what it meant to ask for. The two differ
  // whenever the parameter was junk, and the risk with this figure is that a
  // wrong window still renders a perfectly plausible page.
  return json({ days: win.days, window: win.kind, ...(await rpc.json()) });
});
