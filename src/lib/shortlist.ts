import { useState } from 'react';

// The traveller's shortlist — every activity they chose to keep, from anywhere in
// the app.
//
// The key stays '10doa:starred' deliberately. It is a stable contract per
// .claude/CLAUDE.md and the shape ('string[]' of 'item:<viatorId>' | activityId)
// is unchanged, so travellers who saved things under the old ♥ keep them without
// a migration. Only the name in code changed, when ♥ ("favourite") and "+ Add"
// ("shortlist") were merged into one store on 2026-08-05.
const KEY = '10doa:starred';

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function write(ids: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...ids])); } catch {}
}

// Read once on mount, so every consumer must be UNMOUNTED while another is writing.
// That holds today because App routes pages exclusively AND the Dashboard panels are
// conditionally rendered, not hidden. Switching a panel to `display: none` (keeping it
// mounted) would silently give two instances divergent copies — add a `storage`
// listener or lift the state before doing that.
export function useShortlist() {
  const [shortlist, setShortlist] = useState<Set<string>>(read);
  const toggle = (id: string) =>
    setShortlist((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      write(next);
      return next;
    });
  return { shortlist, toggle };
}
