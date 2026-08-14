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
): Promise<{ error: string | null; missing: boolean }> {
  if (!supabase) return { error: 'not configured', missing: false };
  // `.select()` so a write that matched NOTHING is distinguishable from one that
  // succeeded. Without it PostgREST answers 204 with no error for both, and an
  // update against a row that is gone — deleted elsewhere, or belonging to the
  // account that was signed in on this browser before — looks exactly like a
  // save. That is the difference between "saved" and "silently discarded every
  // edit from here on".
  //
  // Note this makes `missing` depend on the SELECT policy as well as the UPDATE
  // one. Both are `auth.uid() = user_id` today, so a row this user may update is
  // always a row they may read back. Narrow trips_select_own without narrowing
  // trips_update_own to match and every successful save would read as missing —
  // and the caller's response to missing is to CREATE, so it would duplicate the
  // itinerary on every autosave rather than fail loudly.
  const { data, error } = await supabase
    .from('trips').update(stateToColumns(s)).eq('id', id).eq('user_id', userId).select('id');
  return { error: error?.message ?? null, missing: !error && (data?.length ?? 0) === 0 };
}

/**
 * Does this save start a SECOND itinerary, or overwrite the open one?
 *
 * Pure, and separate from the write, because it is the whole behaviour: get it
 * wrong one way and "save as" silently destroys the original; wrong the other
 * way and every ordinary save litters the account with copies.
 *
 * Names are compared trimmed, so trailing whitespace is not a rename.
 *
 * Naming a trip that is stored WITHOUT a name is a rename, not a branch. The
 * autosave creates a row within a second of a signed-in visit to the planner,
 * and it has no name to give it — so the traveller's first trip is always
 * sitting there unnamed. Branching on "" → "Beach week" would hand every single
 * user a ghost "Untitled itinerary" beside their real one, the first time they
 * ever pressed Save. Branch only when a name that EXISTS changes.
 */
export function savingBranchesNew(
  openId: string | null, newName: string | undefined, storedName: string | undefined,
): boolean {
  if (!openId) return true;                    // nothing open — this is the first save
  const stored = (storedName ?? '').trim();
  if (!stored) return false;                   // naming the unnamed — a rename
  return (newName ?? '').trim() !== stored;
}

/**
 * Save the working itinerary.
 *
 * `id` is the itinerary currently open, or null if none has been saved yet.
 * A save creates a NEW row when there is nothing open yet, or when the
 * traveller has renamed what they are saving — that rename is the whole point:
 * "save under a different name" leaves the original ROW standing, so the
 * traveller ends up with two itineraries rather than one overwritten.
 *
 * It forks at the CURRENT state, though, not at the state the original had when
 * it was named: the autosave writes every edit into the open row as it happens,
 * so the two rows differ by name and not by content. Making the original a true
 * point-in-time snapshot would mean snapshotting on open, or suspending the
 * autosave once a trip is named — both bigger decisions than this function.
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
  const { error, missing } = await updateTrip(userId, id, s);
  // The row we meant to overwrite is gone. Create rather than report a save
  // that wrote nothing — the traveller pressed Save and must end up with their
  // itinerary stored somewhere.
  if (missing) {
    const { id: newId, error: createErr } = await createTrip(userId, s);
    return { id: newId, error: createErr, created: true };
  }
  return { id, error, created: false };
}

export async function deleteTrip(userId: string, id: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'not configured' };
  const { error } = await supabase.from('trips').delete().eq('id', id).eq('user_id', userId);
  return { error: error?.message ?? null };
}
