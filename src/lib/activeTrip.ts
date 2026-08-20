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
