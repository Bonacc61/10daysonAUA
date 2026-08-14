import { supabase } from './supabase';
import { stateToColumns, columnsToState, type TripState, type StateColumns } from './tripState';

// Re-exported so existing importers (`import { ..., type TripState } from './trips'`) keep working.
export type { TripState };

export type TripRow = { id: string; user_id: string; updated_at?: string } & StateColumns;

/** A saved itinerary: the state, plus the row id that says WHICH saved trip it is. */
export type SavedTrip = TripState & { id: string; updatedAt?: string };

export function toRow(userId: string, s: TripState): Omit<TripRow, 'id'> {
  return { user_id: userId, ...stateToColumns(s) };
}

export function fromRow(row: TripRow): SavedTrip {
  return { id: row.id, updatedAt: row.updated_at, ...columnsToState(row) };
}

/** The name a saved trip shows in a list. Lives in `answers`, not its own column. */
export function tripTitle(t: TripState): string {
  return t.answers.tripName?.trim() || 'Untitled itinerary';
}

// Every itinerary this user has saved, newest first (RLS returns only their own).
export async function listTrips(userId: string): Promise<SavedTrip[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('trips').select('*').eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return (data as TripRow[]).map(fromRow);
}

// The itinerary to open when none is explicitly chosen: the one most recently
// touched. Kept as its own function because that "which one" rule is a product
// decision, not something each caller should re-derive.
export async function loadTrip(userId: string): Promise<SavedTrip | null> {
  const all = await listTrips(userId);
  return all[0] ?? null;
}

export async function loadTripById(userId: string, id: string): Promise<SavedTrip | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('trips').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
  if (error || !data) return null;
  return fromRow(data as TripRow);
}

/** Start a NEW saved itinerary. Returns the id it was given. */
export async function createTrip(
  userId: string, s: TripState,
): Promise<{ id: string | null; error: string | null }> {
  if (!supabase) return { id: null, error: 'not configured' };
  const { data, error } = await supabase
    .from('trips').insert(toRow(userId, s)).select('id').single();
  return { id: (data as { id: string } | null)?.id ?? null, error: error?.message ?? null };
}

/** Overwrite one existing itinerary. Scoped by user_id as well as id so a
 *  mistaken id can never reach across accounts — RLS enforces this too, but the
 *  query should not depend on the policy to be correct. */
export async function updateTrip(
  userId: string, id: string, s: TripState,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'not configured' };
  const { error } = await supabase
    .from('trips').update(stateToColumns(s)).eq('id', id).eq('user_id', userId);
  return { error: error?.message ?? null };
}

/**
 * Does this save start a SECOND itinerary, or overwrite the open one?
 *
 * Pure, and separate from the write, because it is the whole behaviour: get it
 * wrong one way and "save as" silently destroys the original; wrong the other
 * way and every ordinary save litters the account with copies.
 *
 * Names are compared trimmed, so trailing whitespace is not a rename. An empty
 * name is a real value — clearing the name of a named trip branches, the same
 * as any other change, because the traveller asked for something different from
 * what is stored.
 */
export function savingBranchesNew(
  openId: string | null, newName: string | undefined, storedName: string | undefined,
): boolean {
  if (!openId) return true;                    // nothing open — this is the first save
  return (newName ?? '').trim() !== (storedName ?? '').trim();
}

/**
 * Save the working itinerary.
 *
 * `id` is the itinerary currently open, or null if none has been saved yet.
 * A save creates a NEW row when there is nothing open yet, or when the
 * traveller has renamed what they are saving — that rename is the whole point:
 * "save under a different name" has to leave the original standing. Otherwise
 * it overwrites the row that is open.
 */
export async function saveTrip(
  userId: string, id: string | null, s: TripState, previousName?: string,
): Promise<{ id: string | null; error: string | null; created: boolean }> {
  // `id === null` always branches, so by here it is non-null — but say so in
  // code rather than assert it, so the two functions can never drift apart into
  // an update with no row to update.
  if (!id || savingBranchesNew(id, s.answers.tripName, previousName)) {
    const { id: newId, error } = await createTrip(userId, s);
    return { id: newId, error, created: true };
  }
  const { error } = await updateTrip(userId, id, s);
  return { id, error, created: false };
}

export async function deleteTrip(userId: string, id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'not configured' };
  const { error } = await supabase.from('trips').delete().eq('id', id).eq('user_id', userId);
  return { error: error?.message ?? null };
}
