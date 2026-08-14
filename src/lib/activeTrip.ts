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
