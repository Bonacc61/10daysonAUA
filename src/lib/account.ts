import { supabase } from './supabase';

// GDPR Article 17 from the browser's side. The heavy lifting is server-side in
// the `account-delete` edge function, which needs the service role for two of
// its three steps; this only carries the caller's token and reports what came
// back. The uid is never sent — the function reads it from the token, so a
// caller can only ever delete themselves.
const FN_URL = import.meta.env.VITE_ACCOUNT_DELETE_FN_URL as string | undefined;

export function accountDeletionAvailable(): boolean {
  return Boolean(FN_URL && supabase);
}

export type DeleteResult =
  | { ok: true; sharesDeleted: number }
  /** `step` says how far it got — a partial erasure must never read as a clean one. */
  | { ok: false; error: string; step?: string };

export async function deleteAccount(): Promise<DeleteResult> {
  if (!FN_URL || !supabase) return { ok: false, error: 'unavailable' };

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: 'not_signed_in' };

  let res: Response;
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    // A network failure here is genuinely ambiguous: the request may or may not
    // have reached the server. Say so rather than guessing either way.
    return { ok: false, error: 'network' };
  }

  let body: { ok?: boolean; error?: string; step?: string; shares_deleted?: number } = {};
  try { body = await res.json(); } catch { /* fall through to status handling */ }

  if (!res.ok || !body.ok) {
    return { ok: false, error: body.error ?? `http_${res.status}`, step: body.step };
  }

  // Drop the local session immediately. The user row is gone, so the token is
  // already dead server-side; leaving it in localStorage would show a signed-in
  // shell that 401s on everything it touches.
  await supabase.auth.signOut();
  return { ok: true, sharesDeleted: body.shares_deleted ?? 0 };
}
