import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';

// Centered login card that hovers over a blurred page. Opened from the nav
// "Log in" / "My trip" button and the itinerary "Save trip" / "Save" buttons,
// instead of scrolling to the sign-in section at the bottom.
export default function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, loading, signInWithGoogle, signInWithEmail, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const onEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setError(null);
    const res = await signInWithEmail(email.trim());
    if (res.error) { setStatus('error'); setError(res.error); }
    else setStatus('sent');
  };

  return (
    <div className="login-modal-backdrop" onClick={onClose}>
      <div className="login-modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="login-modal-close" onClick={onClose} aria-label="Close">✕</button>

        {loading ? null : user ? (
          <>
            {/* "Logged in", not "Trip saved". Signing in is the thing that just
                happened; saving a trip is a separate deliberate act with its own
                confirmation (the Save trip modal in Itinerary.tsx). Announcing a
                save here claimed credit for something the traveller had not done
                and made the real "Trip saved ✓" mean nothing when it arrived. */}
            <h2 className="font-display" style={{ fontSize: 24, margin: '0 0 6px', color: 'var(--ink)' }}>Logged in ✓</h2>
            <p style={{ fontStyle: 'italic', fontSize: 14, color: 'rgba(0,0,0,0.65)', margin: '0 0 20px' }}>
              Signed in as {user.email}. Edits to your itinerary now save automatically and follow you across devices.
            </p>
            <button type="button" className="btn-ghost" onClick={() => signOut()} style={{ padding: '10px 18px', fontSize: 14 }}>Sign out</button>
          </>
        ) : status === 'sent' ? (
          <>
            <h2 className="font-display" style={{ fontSize: 24, margin: '0 0 8px', color: 'var(--ink)' }}>Check your inbox ✉️</h2>
            <p style={{ fontSize: 14, color: 'var(--sand-700)', margin: 0 }}>
              We sent a magic link to <b>{email}</b>. Click it to finish signing in.
            </p>
          </>
        ) : (
          <>
            <h2 className="font-display" style={{ fontSize: 26, margin: '0 0 6px', color: 'var(--ink)' }}>Save your trip.</h2>
            <p style={{ fontStyle: 'italic', fontSize: 14, color: 'rgba(0,0,0,0.65)', margin: '0 0 22px' }}>
              Sign in to save your itinerary and pick up where you left off on any device.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
              <button type="button" className="sso-btn" onClick={() => signInWithGoogle()} disabled={!isSupabaseConfigured} style={{ justifyContent: 'center' }}>
                <GoogleLogo />
                <span className="sso-label">Continue with Google</span>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--sand-500)', fontSize: 12 }}>
                <span style={{ flex: 1, height: 1, background: 'var(--sand-300)' }} /> or <span style={{ flex: 1, height: 1, background: 'var(--sand-300)' }} />
              </div>
              <form onSubmit={onEmail} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com" aria-label="Email address"
                  style={{ padding: '11px 14px', borderRadius: 12, border: '2px solid var(--ink)', fontSize: 14, fontFamily: 'inherit' }}
                />
                <button type="submit" className="btn-red" disabled={status === 'sending' || !isSupabaseConfigured} style={{ padding: '11px 16px', fontSize: 14 }}>
                  {status === 'sending' ? 'Sending…' : 'Email me a magic link'}
                </button>
              </form>
              {status === 'error' && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg className="sso-logo-svg" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 7.9-21l5.7-5.7A20 20 0 1 0 24 44c11 0 20-8 20-20 0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C39 36 44 30.7 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}
