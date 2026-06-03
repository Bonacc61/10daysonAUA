import { supabase } from './supabase';
import type { Answers } from '../App';
import type { PlannedDay } from '../data/itineraryPlan';

// The durable, per-user trip: the questionnaire answers, the itinerary (PlannedDay[]
// — which carries the activities/groups that comprise it), and the swap-matcher
// memory. Mirrors the `trips` table; rejected sets become text[] columns.
export type TripState = {
  answers: Answers;
  plan: PlannedDay[];
  rejected: Set<string>;
  rejectedGroups: Set<string>;
};

export type TripRow = {
  user_id: string;
  answers: Answers;
  plan: PlannedDay[];
  rejected: string[];
  rejected_groups: string[];
};

export function toRow(userId: string, s: TripState): TripRow {
  return {
    user_id: userId,
    answers: s.answers,
    plan: s.plan,
    rejected: [...s.rejected],
    rejected_groups: [...s.rejectedGroups],
  };
}

export function fromRow(row: TripRow): TripState {
  return {
    answers: row.answers,
    plan: row.plan,
    rejected: new Set(row.rejected ?? []),
    rejectedGroups: new Set(row.rejected_groups ?? []),
  };
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
