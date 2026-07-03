import { useState } from 'react';

const KEY = '10doa:booked';

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function write(ids: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...ids])); } catch {}
}

export function useBooked() {
  const [booked, setBooked] = useState<Set<string>>(read);
  const toggle = (uid: string) =>
    setBooked((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      write(next);
      return next;
    });
  return { booked, toggle };
}
