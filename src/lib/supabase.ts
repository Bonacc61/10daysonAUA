import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// True when the public Supabase URL + anon key are present. The app stays fully
// usable when false (anonymous, no persistence) — sign-in UI just no-ops.
export const isSupabaseConfigured = Boolean(url && anonKey);

// Single shared client. detectSessionInUrl parses the session that OAuth /
// magic-link redirects append to the URL when the user lands back on the app.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
