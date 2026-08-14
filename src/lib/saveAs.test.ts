import { describe, it, expect } from 'vitest';
import { savingBranchesNew, tripTitle } from './trips';
import { DEFAULT_ANSWERS } from '../App';
import type { TripState } from './trips';

const state = (tripName?: string): TripState => ({
  answers: { ...DEFAULT_ANSWERS, tripName },
  plan: [], rejected: new Set(), rejectedGroups: new Set(),
});

describe('saving under a different name', () => {
  it('branches a NEW itinerary when the name changed', () => {
    // The ask: "if the user saves the itinerary under a different name, a second
    // itinerary under that name should be made."
    expect(savingBranchesNew('trip-1', 'Honeymoon week', 'First draft')).toBe(true);
  });

  it('overwrites the open itinerary when the name is unchanged', () => {
    expect(savingBranchesNew('trip-1', 'First draft', 'First draft')).toBe(false);
  });

  it('treats the very first save as a new itinerary', () => {
    expect(savingBranchesNew(null, 'Anything', undefined)).toBe(true);
    expect(savingBranchesNew(null, undefined, undefined)).toBe(true);
  });

  it('does not branch on whitespace alone', () => {
    // Otherwise a stray space in the name field silently duplicates the trip.
    expect(savingBranchesNew('trip-1', '  First draft  ', 'First draft')).toBe(false);
  });

  it('does not branch when an unnamed trip is saved again unnamed', () => {
    expect(savingBranchesNew('trip-1', undefined, undefined)).toBe(false);
    expect(savingBranchesNew('trip-1', '', undefined)).toBe(false);
  });

  it('RENAMES rather than branches when the stored trip has no name', () => {
    // The autosave creates a row within a second of a signed-in visit, and has
    // no name to give it. If naming that row branched, every user would get a
    // ghost "Untitled itinerary" beside their real trip the first time they
    // ever pressed Save.
    expect(savingBranchesNew('trip-1', 'Now it has a name', undefined)).toBe(false);
    expect(savingBranchesNew('trip-1', 'Now it has a name', '')).toBe(false);
    expect(savingBranchesNew('trip-1', 'Now it has a name', '   ')).toBe(false);
  });

  it('still branches once the trip HAS a name', () => {
    expect(savingBranchesNew('trip-1', 'Second version', 'First draft')).toBe(true);
  });
});

describe('tripTitle', () => {
  it('uses the traveller\'s name when there is one', () => {
    expect(tripTitle(state('Honeymoon week'))).toBe('Honeymoon week');
  });

  it('falls back rather than showing an empty row in the list', () => {
    expect(tripTitle(state(undefined))).toBe('Untitled itinerary');
    expect(tripTitle(state('   '))).toBe('Untitled itinerary');
  });
});
