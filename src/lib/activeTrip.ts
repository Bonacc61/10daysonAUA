import type { Answers } from '../App';
import { sameAnswers } from './sameAnswers';

// Which saved itinerary the Itinerary page is editing.
//
// Needed the moment an account can hold more than one: the autosave has to know
// which row to write to, and it has to survive a refresh, or reloading the page
// would quietly start editing whichever trip happened to be newest.
//
// A new key, not a shape change to an existing one — the keys listed in
// .claude/CLAUDE.md are stable contracts and none of them means this.
const KEY = '10doa:trip-id';

export function readActiveTripId(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function writeActiveTripId(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch { /* private mode — the page still works, it just reopens the newest */ }
}

// "The traveller just CHOSE this itinerary" — pressed Edit on its row — as
// opposed to "this is the id the planner happened to be on last time".
//
// The two need telling apart because the Itinerary page adopts a saved trip only
// when `sameAnswers` holds, and that guard is right for exactly one of them.
// Resuming: the questionnaire has been retaken, the stored id points at a trip
// built from different answers, and starting unattached is what stops the new
// plan overwriting the old row. Choosing: the traveller is looking at a list of
// their itineraries and pressed Edit on one — refusing to open it because their
// answers have moved on since is not a safeguard, it is the page ignoring them.
//
// SESSION storage, not local: choosing is about this navigation, not a
// preference that should outlive the tab. And it is read ONCE — a deliberate
// open applies to the hydration it caused and no later one, so a refresh an hour
// later goes back through the ordinary resume rule.
const OPENED_KEY = '10doa:opened-trip';

export function markTripOpened(id: string): void {
  try { sessionStorage.setItem(OPENED_KEY, id); } catch { /* private mode — falls back to the resume rule */ }
}

/** Read and clear. Returns the id only to the first caller after a deliberate open. */
export function takeTripOpened(): string | null {
  try {
    const id = sessionStorage.getItem(OPENED_KEY);
    if (id) sessionStorage.removeItem(OPENED_KEY);
    return id;
  } catch { return null; }
}

/**
 * Does the planner open this saved trip as it stands, or start a fresh plan?
 *
 * A rule with a name, rather than a condition inline in a `useEffect`, because
 * it got this wrong in production: it used to be `sameAnswers` alone, which
 * meant an itinerary saved before the questionnaire was last touched could not
 * be opened by ANY route — pressing Edit on it handed back a new unattached plan
 * under the generic heading, with nothing to say the choice had been ignored.
 *
 * Both halves are load-bearing:
 *  - `chosenId` — the traveller pressed Edit on this row. They have said which
 *    itinerary they mean, and their answers having moved on since is not a
 *    reason to overrule them.
 *  - `sameAnswers` — nobody chose anything; this is a page load resuming
 *    whatever `10doa:trip-id` points at. If the questionnaire has been retaken,
 *    starting unattached is what stops the new plan overwriting the old row.
 */
export function shouldAdoptTrip(
  trip: { id: string; answers: Answers },
  chosenId: string | null,
  currentAnswers: Answers,
): boolean {
  return chosenId === trip.id || sameAnswers(trip.answers, currentAnswers);
}

/**
 * The answers to adopt from a saved trip — never the stored object raw.
 *
 * `trips.answers` is a jsonb snapshot of whatever `Answers` looked like the day
 * it was written, and the type has grown since: `flags` arrived 2026-07-03, a
 * month after the table. A row from that window has no `flags` key, callers
 * read `answers.flags.length` without checking, and this app has no
 * ErrorBoundary — so adopting one raw is a white page, not a broken panel.
 *
 * Fills ABSENT keys only, so a value the traveller deliberately cleared — no
 * interests, an empty note, adventure 0 — survives untouched. A jsonb `null`
 * counts as absent too: a spread would happily carry it through, and `null`
 * fails `.length` exactly like `undefined` does.
 *
 * `defaults` is a parameter rather than an import because this module is loaded
 * by Map, Dashboard and Itinerary, and `DEFAULT_ANSWERS` lives in `App.tsx` —
 * importing it as a VALUE here would put a real cycle (App → page → here → App)
 * under all three.
 */
export function adoptedAnswers(stored: Answers, defaults: Answers): Answers {
  const merged = { ...defaults, ...stored } as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(defaults as Record<string, unknown>)) {
    if (merged[key] === null || merged[key] === undefined) merged[key] = fallback;
  }
  return merged as unknown as Answers;
}
