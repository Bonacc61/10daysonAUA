import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { identifyUser, resetUser } from './analytics';

type AuthValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  // One-click Google OAuth (Gmail). Redirects out and back.
  signInWithGoogle: () => Promise<void>;
  // Email magic link — works for any provider (Proton, iCloud, work email, …).
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | undefined>(undefined);

// Return the user to whichever page they were on when they clicked "Log in".
function returnUrl() {
  return window.location.origin + window.location.pathname;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' && s?.user) {
        // Account is "new" if created within the last 30 seconds.
        const ageMs = Date.now() - new Date(s.user.created_at).getTime();
        identifyUser(s.user.id, ageMs < 30_000);
      }
      if (event === 'SIGNED_OUT') resetUser();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value: AuthValue = {
    session,
    user: session?.user ?? null,
    loading,
    signInWithGoogle: async () => {
      // Flag the return trip so <SignedInToast> can confirm with a brief toast.
      try { localStorage.setItem('justSignedIn', '1'); } catch { /* ignore */ }
      await supabase?.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: returnUrl() },
      });
    },
    signInWithEmail: async (email: string) => {
      if (!supabase) return { error: 'Sign-in is not configured yet.' };
      try { localStorage.setItem('justSignedIn', '1'); } catch { /* ignore */ }
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: returnUrl() },
      });
      return { error: error?.message ?? null };
    },
    signOut: async () => { await supabase?.auth.signOut(); },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
