import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIVITIES } from './activities';
import { LUNCHSPOTS } from './lunchspots';
import { VIATOR_ITEMS } from './viator-stub';

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
const AWAITING_UPLOAD: string[] = [];

const cards = [...ACTIVITIES, ...LUNCHSPOTS];

/**
 * The stub catalog counts too. `activitySource.ts` calls it "the instant first
 * paint and the offline/failure fallback", so its images render to every
 * visitor before the live Viator catalog arrives — and stay if that fetch
 * fails. Two of its photos had been deleted upstream and rendered broken.
 */
const imageSrcs = [...cards.map((c) => c.image), ...VIATOR_ITEMS.map((i) => i.image_url)];

describe('card images resolve on a case-sensitive host', () => {
  const onDisk = new Set(readdirSync(PUBLIC));

  it('reads the public directory (guards against a vacuous pass)', () => {
    expect(onDisk.size).toBeGreaterThan(5);
    expect(cards.length).toBeGreaterThan(20);
    expect(imageSrcs.length).toBeGreaterThan(cards.length);
  });

  it('has no missing image beyond the ones known to be awaiting upload', () => {
    const missing = imageSrcs
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
    const wrongCase = imageSrcs
      .filter((src) => src?.startsWith('/'))
      .map((src) => decodeURIComponent(src.slice(1)))
      .filter((f) => !onDisk.has(f) && lower.has(f.toLowerCase()))
      .map((f) => `${f} -> on disk as ${lower.get(f.toLowerCase())}`);
    expect(wrongCase).toEqual([]);
  });
});

/**
 * A card image that is a remote stock URL is invisible to every check above —
 * those only validate `/`-prefixed paths against `public/`. That is how
 * Pastechi House shipped to production wearing a generic Pexels pastry photo
 * that is not the restaurant: commit 969ce83 replaced 19 stock images with real
 * ones, named the six it could not source in its commit message, and nothing
 * carried that list forward.
 *
 * So the remaining stock images are pinned here by card id. Exact-set, not a
 * subset: sourcing a real photo fails this test too, which forces the id out of
 * the list rather than letting it outlive the problem.
 */
describe('stock photography is tracked, not forgotten', () => {
  /** Cards still on a stock URL because no real photo has been sourced yet. */
  const AWAITING_REAL_PHOTO = [
    'antilla-wreck-dive',
    'boca-catalina-snorkel',
    'lunch-bingo',
    'oranjestad-walking',
    'tres-trapi',
  ];


  /**
   * Stock photography we now serve ourselves. Being generic was only half the
   * problem: a URL on someone else's host can also vanish. Pexels deleted photo
   * 1125883 and the Natural Pool card rendered broken in production until
   * 2026-08-23, which nothing here caught because the checks above skip remote
   * URLs and the check below only reads the ones that remain.
   *
   * Self-hosting removes the 404. It does NOT make the photo authentic, so the
   * id stays tracked here rather than disappearing from both lists at once.
   */
  const SELF_HOSTED_STOCK = ['natural-pool-jeep'];

  it('serves the self-hosted stock photos from public/, not a remote host', () => {
    const tracked = cards.filter((c) => SELF_HOSTED_STOCK.includes(c.id));
    expect(tracked.map((c) => c.id).sort()).toEqual([...SELF_HOSTED_STOCK].sort());
    expect(tracked.filter((c) => !c.image?.startsWith('/')).map((c) => c.id)).toEqual([]);
  });

  it('has no stock image beyond the cards awaiting a real photo', () => {
    const stock = cards
      .filter((c) => /images\.(pexels|unsplash)\.com/.test(c.image ?? ''))
      .map((c) => c.id)
      .sort();
    expect(stock).toEqual([...AWAITING_REAL_PHOTO].sort());
  });
});
