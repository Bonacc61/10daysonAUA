import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';

// A brief confirmation toast shown right after the user returns from a Google
// or magic-link sign-in. auth.tsx sets the `justSignedIn` flag immediately
// before redirecting; we consume it here once the session has been restored,
// so it fires exactly once per sign-in — not on ordinary page loads.
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
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, [user]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 22px',
        background: 'var(--ink)',
        color: 'var(--cream)',
        border: '2px solid var(--ink)',
        borderRadius: 999,
        boxShadow: '4px 4px 0 rgba(0,0,0,0.2)',
        fontWeight: 700,
        fontSize: 15,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 20, height: 20, borderRadius: '50%', background: '#1faa59',
          color: 'white', fontSize: 13, lineHeight: 1, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        ✓
      </span>
      Trip saved
    </div>
  );
}
