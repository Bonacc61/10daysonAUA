import { supabase } from './supabase';
import { stateToColumns, columnsToState, type TripState, type StateColumns } from './tripState';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// A short, URL-safe slug from a CSPRNG. 8 base62 chars ≈ 47 bits — ample
// entropy for unguessable share links; collisions are handled by a retry.
export function randomSlug(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// Insert an immutable snapshot of the trip state and return its slug (the id in
// /i/<id>). created_by is filled by the table's auth.uid() default, so it is
// never part of the client payload. Retries once on the (astronomically
// unlikely) slug collision — Postgres unique_violation is code 23505.
export async function createShare(state: TripState): Promise<{ id: string | null; error: string | null }> {
  if (!supabase) return { id: null, error: 'not configured' };
  const cols: StateColumns = stateToColumns(state);
  // Shared snapshots are publicly readable (select using (true) + anon key),
  // so strip free-text specialNotes — it's never used to render or match a
  // shared itinerary and may hold personal info. Trips keep it; this is
  // shares-only, so stateToColumns itself is untouched.
  const publicCols: StateColumns = { ...cols, answers: { ...cols.answers, specialNotes: '' } };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const id = randomSlug();
    const { error } = await supabase.from('shared_itineraries').insert({ id, ...publicCols });
    if (!error) return { id, error: null };
    if (error.code !== '23505') return { id: null, error: error.message };
  }
  return { id: null, error: 'Could not generate a unique link — try again.' };
}

// Fetch a shared snapshot by slug; null for a missing/bad id or any error.
export async function loadShare(id: string): Promise<TripState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('shared_itineraries')
    .select('answers, plan, rejected, rejected_groups')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return columnsToState(data as StateColumns);
}
