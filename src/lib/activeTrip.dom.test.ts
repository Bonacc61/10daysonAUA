// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readActiveTripId, writeActiveTripId, markTripOpened, takeTripOpened, shouldAdoptTrip,
} from './activeTrip';
import { DEFAULT_ANSWERS, type Answers } from '../App';

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

describe('the adoption rule', () => {
  const answers = (over: Partial<Answers> = {}): Answers => ({ ...DEFAULT_ANSWERS, ...over });
  const saved = (id: string, over: Partial<Answers> = {}) => ({ id, answers: answers(over) });

  it('opens the itinerary the traveller pressed Edit on, even when their answers have moved on', () => {
    // THE REGRESSION, reported from production 2026-08-20. Before the fix this
    // was false, so Edit produced a fresh unattached plan under the generic
    // heading and the itinerary's name never appeared.
    const trip = saved('t2', { days: 4, tripName: 'Kids trip' });
    expect(shouldAdoptTrip(trip, 't2', answers({ days: 7 }))).toBe(true);
  });

  it('resumes a trip whose answers still match, with nothing chosen', () => {
    const trip = saved('t1', { days: 10 });
    expect(shouldAdoptTrip(trip, null, answers({ days: 10 }))).toBe(true);
  });

  it('starts unattached on a retaken questionnaire when nothing was chosen', () => {
    // The guard that stops a regenerated plan overwriting the saved row.
    const trip = saved('t1', { days: 10 });
    expect(shouldAdoptTrip(trip, null, answers({ days: 7 }))).toBe(false);
  });

  it('does not adopt a DIFFERENT trip just because something was chosen', () => {
    // The fallback loaded someone else's pick — e.g. the chosen trip was
    // deleted from another device — so the choice must not vouch for it.
    const trip = saved('t1', { days: 10 });
    expect(shouldAdoptTrip(trip, 't2', answers({ days: 7 }))).toBe(false);
  });

  it('still adopts a matching trip even when a different one was chosen', () => {
    const trip = saved('t1', { days: 10 });
    expect(shouldAdoptTrip(trip, 't2', answers({ days: 10 }))).toBe(true);
  });
});
