import { supabase } from './supabase';
import { stateToColumns, columnsToState, type TripState, type StateColumns } from './tripState';

// Re-exported so existing importers (`import { ..., type TripState } from './trips'`) keep working.
export type { TripState };

export type TripRow = { user_id: string } & StateColumns;

export function toRow(userId: string, s: TripState): TripRow {
  return { user_id: userId, ...stateToColumns(s) };
}

export function fromRow(row: TripRow): TripState {
  return columnsToState(row);
}

// Load the signed-in user's saved trip (RLS returns only their own row).
export async function loadTrip(userId: string): Promise<TripState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('trips').select('*').eq('user_id', userId).maybeSingle();
  if (error || !data) return null;
  return fromRow(data as TripRow);
}

// Upsert the user's single trip row.
export async function upsertTrip(userId: string, s: TripState): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'not configured' };
  const { error } = await supabase.from('trips').upsert(toRow(userId, s), { onConflict: 'user_id' });
  return { error: error?.message ?? null };
}
