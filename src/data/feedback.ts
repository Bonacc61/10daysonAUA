// Fire-and-forget itinerary telemetry → Supabase `feedback_events`. Captures
// swap (with the "why swap?" reason), approve, add, remove, move — the signal
// that feeds the recommendation tuning / future swap brain. Anonymous: a random
// per-browser session id, no PII. Never blocks the UI; failures are swallowed.
//
// CONSENT-GATED since 2026-08-13, the same gate PostHog sits behind.
//
// The payload argues for legitimate interest — pseudonymous, no typed words,
// service improvement. The IDENTIFIER does not. `aruba.session` is written to
// the traveller's device for no purpose but this one (it is read nowhere else
// in the app, checked), which makes it non-essential storage, and ePrivacy asks
// for consent on that regardless of how harmless the payload is. Legitimate
// interest can justify processing data; it cannot justify putting the id there.
//
// So this reads the SAME key as analytics.ts rather than inventing a second
// notion of consent — one banner, one answer, both telemetry paths.
import { CONSENT_KEY } from '../lib/analytics';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'true';
  } catch {
    // No localStorage means no consent on record. Silence is not agreement.
    return false;
  }
}

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
  // BEFORE sessionId(), deliberately: that function CREATES and stores the id
  // on first call. Checking consent after it would mean a traveller who never
  // answered the banner — or answered no — still gets an identifier written to
  // their device, which is the exact thing the gate exists to prevent. The
  // ordering is the feature, not an optimisation.
  if (!hasConsent()) return;
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
