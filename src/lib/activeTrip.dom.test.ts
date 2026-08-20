// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readActiveTripId, writeActiveTripId, markTripOpened, takeTripOpened,
} from './activeTrip';

/**
 * The two ideas here are NOT the same, and conflating them is what shipped a
 * broken Edit button on 2026-08-20.
 *
 * `10doa:trip-id` is which itinerary the planner was last on. It survives a
 * refresh and a questionnaire retake, so on its own it cannot say whether the
 * traveller MEANT to be on that trip — which is why the Itinerary page also
 * checks `sameAnswers` before adopting it.
 *
 * `10doa:opened-trip` is the missing half: the traveller just pressed Edit on
 * this row. It is session-scoped and one-shot, so it speaks for the navigation
 * that set it and for nothing after.
 */

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('the active trip id', () => {
  it('round-trips', () => {
    writeActiveTripId('t1');
    expect(readActiveTripId()).toBe('t1');
  });

  it('clears on null, so a deleted trip leaves nothing pointing at it', () => {
    writeActiveTripId('t1');
    writeActiveTripId(null);
    expect(readActiveTripId()).toBeNull();
  });

  it('is null when nothing was ever written', () => {
    expect(readActiveTripId()).toBeNull();
  });
});

describe('marking a deliberate open', () => {
  it('reports the itinerary the traveller chose', () => {
    markTripOpened('t2');
    expect(takeTripOpened()).toBe('t2');
  });

  it('is ONE-SHOT — a later hydration falls back to the ordinary resume rule', () => {
    // Otherwise refreshing the page an hour later would keep force-adopting a
    // trip whose answers no longer match, which is the guard `sameAnswers`
    // exists to provide.
    markTripOpened('t2');
    expect(takeTripOpened()).toBe('t2');
    expect(takeTripOpened()).toBeNull();
  });

  it('is null when the traveller merely resumed rather than chose', () => {
    writeActiveTripId('t1');       // the planner was here last…
    expect(takeTripOpened()).toBeNull();  // …but nobody pressed Edit
  });

  it('the newest choice wins when Edit is pressed twice', () => {
    markTripOpened('t1');
    markTripOpened('t2');
    expect(takeTripOpened()).toBe('t2');
  });

  it('does not touch the active trip id, which the autosave owns', () => {
    writeActiveTripId('t1');
    markTripOpened('t2');
    takeTripOpened();
    expect(readActiveTripId()).toBe('t1');
  });

  it('lives in sessionStorage, so it cannot outlive the tab', () => {
    markTripOpened('t2');
    expect(sessionStorage.getItem('10doa:opened-trip')).toBe('t2');
    expect(localStorage.getItem('10doa:opened-trip')).toBeNull();
  });
});
