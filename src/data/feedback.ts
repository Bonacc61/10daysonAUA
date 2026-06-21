// Fire-and-forget itinerary telemetry → Supabase `feedback_events`. Captures
// swap (with the "why swap?" reason), approve, add, remove, move — the signal
// that feeds the recommendation tuning / future swap brain. Anonymous: a random
// per-browser session id, no PII. Never blocks the UI; failures are swallowed.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function sessionId(): string {
  try {
    let s = localStorage.getItem('aruba.session');
    if (!s) {
      s = (crypto.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('aruba.session', s);
    }
    return s;
  } catch {
    return 'anon';
  }
}

export type FeedbackEvent = {
  action: 'swap' | 'approve' | 'add' | 'remove' | 'move' | 'rename';
  reason?: string;
  day?: number;
  slot?: string;
  from_id?: string;
  from_kind?: string;
  from_price?: number;
  to_id?: string;
  to_kind?: string;
  to_section?: string;
};

export function logEvent(e: FeedbackEvent): void {
  if (!SUPABASE_URL || !ANON) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/feedback_events`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ ...e, session_id: sessionId() }),
      keepalive: true,
    }).catch(() => { /* fire-and-forget */ });
  } catch { /* ignore */ }
}
