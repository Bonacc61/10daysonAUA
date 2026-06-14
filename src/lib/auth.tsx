import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

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

// Where the user lands after a Google / magic-link sign-in. The save section
// lives on the itinerary page, so return them there — not the landing page.
const POST_SIGNIN_PATH = '/itinerary';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
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
        options: { redirectTo: window.location.origin + POST_SIGNIN_PATH },
      });
    },
    signInWithEmail: async (email: string) => {
      if (!supabase) return { error: 'Sign-in is not configured yet.' };
      try { localStorage.setItem('justSignedIn', '1'); } catch { /* ignore */ }
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + POST_SIGNIN_PATH },
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
