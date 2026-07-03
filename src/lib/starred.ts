import { useState } from 'react';

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

export function useStarred() {
  const [starred, setStarred] = useState<Set<string>>(read);
  const toggle = (id: string) =>
    setStarred((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      write(next);
      return next;
    });
  return { starred, toggle };
}
