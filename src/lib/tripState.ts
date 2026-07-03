import type { Answers } from '../App';
import type { PlannedDay } from '../data/itineraryPlan';

// The itinerary state shared by a saved trip and a shared snapshot: the
// questionnaire answers, the id-only plan (cards rebuilt from the catalog on
// render), and the swap-rejection memory.
export type TripState = {
  answers: Answers;
  plan: PlannedDay[];
  rejected: Set<string>;
  rejectedGroups: Set<string>;
};

// The four columns common to both the `trips` and `shared_itineraries` tables.
// (trips adds user_id; shared_itineraries adds id/created_by/created_at.)
export type StateColumns = {
  answers: Answers;
  plan: PlannedDay[];
  rejected: string[];
  rejected_groups: string[];
};

export function stateToColumns(s: TripState): StateColumns {
  return {
    answers: s.answers,
    plan: s.plan,
    rejected: [...s.rejected],
    rejected_groups: [...s.rejectedGroups],
  };
}

export function columnsToState(c: StateColumns): TripState {
  return {
    answers: c.answers,
    plan: c.plan,
    rejected: new Set(c.rejected ?? []),
    rejectedGroups: new Set(c.rejected_groups ?? []),
  };
}
