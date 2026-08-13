import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import { accountDeletionAvailable, deleteAccount } from '../lib/account';

// The save / sign-in section at the bottom of the itinerary. Google one-click
// (Gmail) plus an email magic link that works for any provider (Proton, iCloud,
// work email…). Signing in saves the trip; changes then persist automatically.
export default function SignIn() {
  const { user, loading, signInWithGoogle, signInWithEmail, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<'idle' | 'confirm' | 'deleting' | 'error' | 'done'>('idle');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const runDelete = async () => {
    setDeleteState('deleting');
    setDeleteError(null);
    const res = await deleteAccount();
    if (res.ok) {
      // deleteAccount() has already signed out, so `user` goes null and this
      // whole branch unmounts. The 'done' state is what a traveller sees in the
      // frame before that happens, and if the sign-out is ever removed it is
      // still the correct thing to show.
      setDeleteState('done');
    } else {
      setDeleteError(res.error);
      setDeleteState('error');
    }
  };

  if (loading) return null;

  const Section = ({ children }: { children: React.ReactNode }) => (
    <div id="save" className="bleed" style={{ background: 'var(--sand-50)', borderTop: '2px solid var(--ink)' }}>
      <div className="container-1280 sso-section" style={{ padding: '48px 36px 56px', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );

  if (user) {
    return (
      <Section>
        {/* Same correction as LoginModal: logging in is not saving a trip. */}
        <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 8px', color: 'var(--ink)' }}>Logged in ✓</h2>
        <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.65)', margin: '0 0 24px' }}>
          Signed in as {user.email}. Edits to your itinerary now save automatically and follow you across devices.
        </p>
        <button type="button" className="btn-ghost" onClick={() => signOut()} style={{ padding: '10px 18px', fontSize: 14 }}>
          Sign out
        </button>

        {/* GDPR Article 17. Hidden entirely until the edge function is deployed
            and its URL configured — a delete button that cannot delete is worse
            than none, because the person who presses it believes they are gone. */}
        {accountDeletionAvailable() && (
          <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid rgba(0,0,0,0.12)' }}>
            {deleteState === 'done' ? (
              <p style={{ fontSize: 14, color: 'var(--ink)', margin: 0 }}>
                Your account and everything in it have been deleted. Thanks for travelling with us.
              </p>
            ) : deleteState === 'confirm' || deleteState === 'deleting' || deleteState === 'error' ? (
              <div style={{ maxWidth: 460, margin: '0 auto', textAlign: 'left' }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px' }}>
                  Delete your account permanently?
                </p>
                {/* Naming each thing, because "all your data" is not informed
                    consent — and because one of these is public. */}
                <ul style={{ fontSize: 13, color: 'rgba(0,0,0,0.7)', margin: '0 0 12px', paddingLeft: 20, lineHeight: 1.7 }}>
                  <li>Your saved itinerary and questionnaire answers</li>
                  <li>Any share links you created — those pages stop working for everyone</li>
                  <li>Your sign-in details</li>
                </ul>
                <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', margin: '0 0 16px' }}>
                  This cannot be undone.
                </p>
                {deleteState === 'error' && (
                  <p role="alert" style={{ color: 'var(--red)', fontSize: 13, margin: '0 0 12px' }}>
                    {deleteError === 'network'
                      ? 'We could not reach the server, so we do not know whether anything was deleted. Please try again, and contact us if this keeps happening.'
                      : 'Something went wrong and your account was not fully deleted. Please try again, or email hello@10daysonaruba.com.'}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-red"
                    disabled={deleteState === 'deleting'}
                    onClick={() => { void runDelete(); }}
                    style={{ padding: '10px 18px', fontSize: 14 }}
                  >
                    {deleteState === 'deleting' ? 'Deleting…' : 'Yes, delete everything'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={deleteState === 'deleting'}
                    onClick={() => { setDeleteState('idle'); setDeleteError(null); }}
                    style={{ padding: '10px 18px', fontSize: 14 }}
                  >
                    Keep my account
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setDeleteState('confirm')}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13, color: 'rgba(0,0,0,0.55)',
                  textDecoration: 'underline',
                }}
              >
                Delete my account
              </button>
            )}
          </div>
        )}
      </Section>
    );
  }

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
    <Section>
      <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 8px', color: 'var(--ink)' }}>Save your trip.</h2>
      <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(0,0,0,0.65)', margin: '0 0 28px' }}>
        Sign in to save your itinerary and pick up where you left off on any device.
      </p>

      {status === 'sent' ? (
        <div className="chunky" style={{ display: 'inline-block', padding: '18px 24px', background: 'var(--cream)', textAlign: 'left' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Check your inbox ✉️</div>
          <div style={{ fontSize: 14, color: 'var(--sand-700)' }}>
            We sent a magic link to <b>{email}</b>. Click it to finish signing in.
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 380, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button type="button" className="sso-btn" onClick={() => signInWithGoogle()} disabled={!isSupabaseConfigured}
            style={{ justifyContent: 'center' }}>
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
      )}

      <p style={{ fontSize: 12, color: 'var(--sand-500)', marginTop: 18 }}>
        Works with Gmail, Proton, iCloud, or any email. We only use it to save your plan — no spam, ever.
      </p>
    </Section>
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
