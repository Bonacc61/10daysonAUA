// account-delete — GDPR Article 17, the right to erasure.
//
// The traveller presses a button; this removes everything the site holds that is
// tied to their account, then the account itself. Service-role work, because two
// of the three steps are things the browser is correctly forbidden to do.
//
// WHAT GETS DELETED, and why each needs saying out loud:
//
//   shared_itineraries  — EXPLICITLY, and this is the one that was broken. The
//     table has no delete policy at all (snapshots are immutable by design) and
//     its FK is `on delete set null`, so removing the auth user would have left
//     the snapshot standing with a null owner — a public /i/<slug> URL, still
//     live, no longer attached to anyone who could ask for it to go. The Privacy
//     Policy promises these are kept only "until you delete it or your account".
//     Deleting the row is what makes that sentence true.
//
//   trips              — by CASCADE. `trips.user_id references auth.users(id)
//     on delete cascade`, so dropping the user takes the itinerary with it. Not
//     deleted here explicitly: two mechanisms for one row means one of them
//     eventually rots, and the cascade is the one the schema guarantees.
//
//   auth.users         — last, via the admin API. Last on purpose: if it went
//     first, the cascade would fire and a failure on the following step would
//     leave a half-erased account with no way to identify what remained.
//
// WHAT DOES NOT, and cannot:
//
//   feedback_events    — keyed by `session_id`, a random per-browser id with no
//     user column anywhere. There is no query that maps an account to its rows,
//     which is GDPR Article 11 territory: a controller who cannot identify the
//     data subject from the data is not obliged to erase it, and inventing a
//     link now would mean ATTACHING identity to pseudonymous telemetry in order
//     to delete it — strictly worse for the person asking. It is consent-gated
//     and purges at 24 months regardless.
//
// Failures are reported, never swallowed. A silent partial erasure is the one
// outcome worse than an error, because the traveller is told they are gone.
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !service) return json({ error: 'not configured' }, 500);

  // --- Who is asking -------------------------------------------------------
  // The uid comes from the token, never from the request body. A caller can only
  // ever delete themselves; there is no id parameter to tamper with.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: anon },
  });
  if (!userRes.ok) return json({ error: 'unauthorized' }, 401);
  const { id: uid } = (await userRes.json()) as { id?: string };
  if (!uid) return json({ error: 'unauthorized' }, 401);

  const admin = { apikey: service, Authorization: `Bearer ${service}` };

  // --- 1. Shared snapshots -------------------------------------------------
  const sharesRes = await fetch(
    `${url}/rest/v1/shared_itineraries?created_by=eq.${encodeURIComponent(uid)}`,
    { method: 'DELETE', headers: { ...admin, Prefer: 'return=representation' } },
  );
  if (!sharesRes.ok) {
    // Status only — an error body can echo row contents, and those rows are the
    // traveller's own itinerary.
    console.error(`[account-delete] shares failed: ${sharesRes.status}`);
    return json({ error: 'delete_failed', step: 'shares' }, 502);
  }
  const sharesDeleted = ((await sharesRes.json()) as unknown[]).length;

  // --- 2. The account, which cascades trips --------------------------------
  const delRes = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    headers: admin,
  });
  if (!delRes.ok) {
    console.error(`[account-delete] user failed: ${delRes.status}`);
    // The snapshots are already gone. Say so rather than implying nothing
    // happened — the traveller needs to know the erasure is partial.
    return json({ error: 'delete_failed', step: 'user', shares_deleted: sharesDeleted }, 502);
  }

  // Count only. Never an id, never an email.
  console.log(`[account-delete] ok, ${sharesDeleted} shares`);
  return json({ ok: true, shares_deleted: sharesDeleted });
});
