import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIVITIES } from './activities';
import { LUNCHSPOTS } from './lunchspots';

/**
 * Every card image must exist in `public/`, matched case-sensitively.
 *
 * Three photos were uploaded as `Alto Vista Chapel.png`, `Bushiribana ruins.jpg`
 * and `San Nicolaas Mural.png` while the cards asked for `Alto Vista Chapel.jpg`,
 * `Bushiribana Ruins.jpg` and `San Nicolas Murals.jpg` — a wrong extension, a
 * lowercase `r`, and a different spelling. All three deployed and all three
 * rendered broken, invisibly: TransIP serves an SPA fallback, so a missing image
 * returns `200 text/html` rather than a 404, and nothing in the build, the type
 * system or the browser console flags it.
 *
 * Case matters. The dev server and a macOS checkout resolve `ruins.jpg` for
 * `Ruins.jpg`; the Linux host does not.
 */

const PUBLIC = join(__dirname, '../../public');

/** Files genuinely absent from `public/`, awaiting an upload. */
const AWAITING_UPLOAD = [
  '/California Dunes.jpg',   // card `california-dunes-sunset` — no photo supplied yet
];

const cards = [...ACTIVITIES, ...LUNCHSPOTS];

describe('card images resolve on a case-sensitive host', () => {
  const onDisk = new Set(readdirSync(PUBLIC));

  it('reads the public directory (guards against a vacuous pass)', () => {
    expect(onDisk.size).toBeGreaterThan(5);
    expect(cards.length).toBeGreaterThan(20);
  });

  it('has no missing image beyond the ones known to be awaiting upload', () => {
    const missing = cards
      .map((c) => c.image)
      .filter((src) => src?.startsWith('/'))
      .filter((src) => !onDisk.has(decodeURIComponent(src.slice(1))));
    // Exact-set rather than a subset check: when a pending photo lands this
    // fails too, prompting its removal from AWAITING_UPLOAD instead of letting
    // the allowlist quietly outlive the problem.
    expect([...new Set(missing)].sort()).toEqual([...AWAITING_UPLOAD].sort());
  });

  it('matches case exactly, not just case-insensitively', () => {
    // The `Bushiribana Ruins.jpg` / `Bushiribana ruins.jpg` failure mode: a
    // case-insensitive match would have passed locally and broken in production.
    const lower = new Map([...onDisk].map((f) => [f.toLowerCase(), f]));
    const wrongCase = cards
      .map((c) => c.image)
      .filter((src) => src?.startsWith('/'))
      .map((src) => decodeURIComponent(src.slice(1)))
      .filter((f) => !onDisk.has(f) && lower.has(f.toLowerCase()))
      .map((f) => `${f} -> on disk as ${lower.get(f.toLowerCase())}`);
    expect(wrongCase).toEqual([]);
  });
});
