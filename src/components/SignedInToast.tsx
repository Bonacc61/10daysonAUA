import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';

// The confirmation shown right after the traveller returns from a Google or
// magic-link sign-in. auth.tsx sets the `justSignedIn` flag immediately before
// redirecting; we consume it here once the session has been restored, so it
// fires exactly once per sign-in — not on ordinary page loads.
//
// It used to be a pill pinned to the top of the screen reading "Trip saved",
// which was wrong twice over. Wrong words: signing in is not saving a trip, and
// claiming the save here made the REAL "Trip saved ✓" — the one the Save trip
// modal shows after a deliberate save — mean nothing when it finally arrived.
// Wrong place: a redirect drops you back on the page with no modal open, so the
// only acknowledgement of the thing you just did was a strip above the content.
//
// It is now the same centred card as the sign-in window it follows, so the
// sequence reads as one flow: you press Continue with Google, you leave, you
// come back, and the card that sent you away is the card that greets you.
export default function SignedInToast() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user) return;
    let pending = false;
    try { pending = localStorage.getItem('justSignedIn') === '1'; } catch { /* ignore */ }
    if (!pending) return;
    try { localStorage.removeItem('justSignedIn'); } catch { /* ignore */ }
    setVisible(true);
    // Still auto-dismisses. A backdrop that only closes on click can trap
    // someone who does not realise it is dismissable; a timeout cannot.
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, [user]);

  if (!visible) return null;

  return (
    <div
      className="login-modal-backdrop"
      role="status"
      aria-live="polite"
      onClick={() => setVisible(false)}
    >
      <div className="login-modal-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="login-modal-close" onClick={() => setVisible(false)} aria-label="Close">✕</button>
        <h2 className="font-display" style={{ fontSize: 26, margin: '0 0 6px', color: 'var(--ink)' }}>Logged in ✓</h2>
        <p style={{ fontStyle: 'italic', fontSize: 14, color: 'rgba(0,0,0,0.65)', margin: '0 0 20px' }}>
          {user?.email
            ? <>Signed in as {user.email}. Edits to your itinerary now save automatically and follow you across devices.</>
            : <>Edits to your itinerary now save automatically and follow you across devices.</>}
        </p>
        <button
          type="button"
          className="btn-red"
          onClick={() => setVisible(false)}
          style={{ width: '100%', padding: '12px 16px', fontSize: 15 }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
