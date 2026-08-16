# Versioned Browser Stores (V1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a version stamp and a migration ladder under the three localStorage keys that hold a traveller's own work, so no future feature can silently reset them.

**Architecture:** One small module, `src/lib/persist.ts`, stores values as `{ v: <n>, d: <payload> }` and runs a migration ladder on read. A value with no envelope is version 0 — the shape the app stored before this module existed — and that detection is structural and permanent, not a one-time adoption flag. Three consumers (`shortlist.ts`, `booked.ts`, `App.tsx`) route their reads and writes through it.

**Tech Stack:** TypeScript, React, Vitest. The test file needs `// @vitest-environment jsdom` because `localStorage` does not exist in the node environment this repo defaults to.

**Spec:** `docs/superpowers/specs/2026-08-16-data-durability-design.md` (V1 section only — V2, the database backups, gets its own plan)

## One deliberate deviation from the spec

The spec says `readStore` "writes the result back so the upgrade happens once per browser."
This plan does **not** write back, for two reasons found while writing it out: the read
happens inside a React `useState` initialiser, where a write is a side effect during render;
and leaving the legacy value on disk keeps v0 support permanently exercised rather than
letting it rot into untested code. The value is re-stamped at the current version by the next
ordinary `writeStore`. Nothing else in the spec changes.

## Global Constraints

- **Never wrap `10doa:analytics-consent`.** `src/main.tsx:10` reads it as a bare `=== 'true'` at boot, before any migration could run. An envelope would break the GDPR consent check. It is not a consumer of `persist.ts` and must never become one.
- **Do not touch `qDone`, `10doa:trip-id`, or `aruba.session`.** Pointers and flags, not the traveller's information. Out of scope by explicit decision.
- **No runtime imports from `src/App.tsx`.** Every module in the codebase imports from it with `import type` only. `DEFAULT_ANSWERS` is a value, so answers persistence stays inline in `App.tsx` rather than moving to a `src/lib/` module — extracting it would create the codebase's first runtime import cycle.
- **`readStore` must never throw.** All three current readers swallow exceptions so a private-mode browser still loads the app. That behaviour is preserved, not reimplemented at each call site.
- **Every test must be checked for the ability to fail.** Per `.claude/CLAUDE.md`: change the code, confirm the test breaks, change it back. Several tests in this repo passed against deliberately broken code before that habit.
- Run the full suite with `npm test` (vitest, offline, no API keys).

---

### Task 1: The `persist` module

**Files:**
- Create: `src/lib/persist.ts`
- Test: `src/lib/persist.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type Migration = (payload: unknown) => unknown`
  - `export function readStore<T>(key: string, version: number, migrations: Migration[], fallback: T): T`
  - `export function writeStore<T>(key: string, version: number, value: T): void`

**Design notes the implementer needs:**

`migrations[i]` upgrades the v`i` payload to the v`i+1` payload, so `migrations.length` must equal `version`.

`readStore` deliberately **does not write the migrated value back**. Two reasons: a write during a React `useState` initialiser is a side effect during render, and leaving the old value on disk keeps v0 support permanently exercised — which is the whole contract. The value is re-stamped at the current version on the next ordinary `writeStore`.

A value stamped at a version **higher** than this bundle knows returns the fallback and is left on disk untouched. That happens when two tabs straddle a deploy. Returning the fallback loses a session's view of the data; writing a downgrade over it would lose the data itself.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/persist.test.ts`:

```ts
// @vitest-environment jsdom
//
// jsdom, not node: this module is pure logic over `localStorage`, and node has
// no localStorage at all. Opted in per file, per the convention in
// src/test/setup.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readStore, writeStore, type Migration } from './persist';

/** A migration that changes nothing — what "v1 is the same shape as v0" means. */
const KEEP: Migration = (p) => p;

// Captured from a browser that has used the planner since before persist.ts
// existed: a bare JSON object under '10doa:answers', with no envelope around
// it. Every field of `Answers` is populated, including the optional one.
// (The note text is invented for the fixture; no real traveller's words are
// committed to this repo.)
const LEGACY_ANSWERS = {
  days: 8,
  groupType: 'Couple',
  budget: 'Mid-range',
  interests: ['Beach & chill', 'Food & drink'],
  adventureLevel: 65,
  startOffset: 14,
  lodging: 'Palm Beach',
  flags: ['no-boats', 'honeymoon'],
  specialNotes: 'One of us gets seasick.',
  tripName: 'Beach week',
};

beforeEach(() => { localStorage.clear(); });

describe('persist — reading what is already on disk', () => {
  it('reads a legacy un-enveloped object with every field intact', () => {
    // THE dangerous step. If this is wrong, the change meant to protect
    // travellers' data is the change that destroys it.
    localStorage.setItem('10doa:answers', JSON.stringify(LEGACY_ANSWERS));
    expect(readStore('10doa:answers', 1, [KEEP], {})).toEqual(LEGACY_ANSWERS);
  });

  it('reads a legacy un-enveloped array', () => {
    localStorage.setItem('10doa:starred', JSON.stringify(['item:12345', 'sunset-sail']));
    expect(readStore<string[]>('10doa:starred', 1, [KEEP], [])).toEqual(['item:12345', 'sunset-sail']);
  });

  it('returns the fallback when the key was never written', () => {
    expect(readStore('10doa:booked', 1, [KEEP], [])).toEqual([]);
  });

  it('returns the fallback rather than throwing on unparseable JSON', () => {
    localStorage.setItem('10doa:answers', '{not json');
    expect(readStore('10doa:answers', 1, [KEEP], { days: 10 })).toEqual({ days: 10 });
  });

  it('preserves a field it does not know about instead of stripping it', () => {
    // Forward compatibility. A traveller who ran a NEWER build in another
    // browser profile, or a field added and then reverted, must not have that
    // data quietly dropped by an older reader.
    localStorage.setItem('10doa:answers', JSON.stringify({ ...LEGACY_ANSWERS, futureField: 42 }));
    expect(readStore<Record<string, unknown>>('10doa:answers', 1, [KEEP], {}).futureField).toBe(42);
  });

  it('returns the fallback rather than throwing when localStorage itself throws', () => {
    // Safari private mode, and any browser with storage disabled.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readStore('10doa:answers', 1, [KEEP], { days: 10 })).toEqual({ days: 10 });
    spy.mockRestore();
  });
});

describe('persist — the migration ladder', () => {
  it('runs every step in order from the stored version to the current one', () => {
    localStorage.setItem('k', JSON.stringify({ v: 0, d: { n: 1 } }));
    const add = (by: number): Migration => (p) => ({ n: (p as { n: number }).n + by });
    // v0 -> v1 adds 10, v1 -> v2 adds 100. Order-sensitive on purpose: a ladder
    // run backwards or twice gives a different number.
    expect(readStore('k', 2, [add(10), add(100)], { n: 0 })).toEqual({ n: 111 });
  });

  it('starts a legacy un-enveloped value at v0, so it climbs the whole ladder', () => {
    localStorage.setItem('k', JSON.stringify({ n: 1 }));
    const add = (by: number): Migration => (p) => ({ n: (p as { n: number }).n + by });
    expect(readStore('k', 2, [add(10), add(100)], { n: 0 })).toEqual({ n: 111 });
  });

  it('runs no migration when the stored version is already current', () => {
    localStorage.setItem('k', JSON.stringify({ v: 1, d: { n: 5 } }));
    const explode: Migration = () => { throw new Error('should not run'); };
    expect(readStore('k', 1, [explode], { n: 0 })).toEqual({ n: 5 });
  });

  it('falls back rather than downgrading a value written by a newer bundle', () => {
    // Two tabs across a deploy. Losing this session's view of the data is
    // recoverable; writing a downgrade over it is not.
    localStorage.setItem('k', JSON.stringify({ v: 9, d: { n: 5 } }));
    expect(readStore('k', 1, [KEEP], { n: 0 })).toEqual({ n: 0 });
    expect(localStorage.getItem('k')).toBe(JSON.stringify({ v: 9, d: { n: 5 } }));
  });

  it('does not rewrite the stored value when it migrates', () => {
    localStorage.setItem('k', JSON.stringify({ n: 1 }));
    readStore('k', 1, [KEEP], { n: 0 });
    expect(localStorage.getItem('k')).toBe(JSON.stringify({ n: 1 }));
  });
});

describe('persist — writing', () => {
  it('stamps the current version and round-trips', () => {
    writeStore('k', 1, { n: 7 });
    expect(localStorage.getItem('k')).toBe(JSON.stringify({ v: 1, d: { n: 7 } }));
    expect(readStore('k', 1, [KEEP], { n: 0 })).toEqual({ n: 7 });
  });

  it('does not throw when localStorage refuses the write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeStore('k', 1, { n: 7 })).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/persist.test.ts`
Expected: FAIL — `Failed to resolve import "./persist"`.

- [ ] **Step 3: Write the module**

Create `src/lib/persist.ts`:

```ts
// Versioned localStorage, so a future shape change cannot silently reset a
// traveller who has been using the app since before that change.
//
// On disk: { v: <n>, d: <payload> }. A value with NO envelope is version 0 —
// the shape the app stored before this module existed. That detection is
// structural and permanent, not a one-time adoption flag, and that is the
// property the whole scheme rests on: a tab left open across a deploy runs the
// old bundle, writes the bare legacy shape back over an envelope, and the next
// read still recognises it and migrates it. The scheme degrades symmetrically
// in both directions instead of having a one-way cliff.
//
// Only stores holding the traveller's OWN WORK belong here. Deliberately not
// covered, and not to be added later:
//   '10doa:analytics-consent' — src/main.tsx reads it as a bare === 'true' at
//     boot, before any migration could run. An envelope would break the GDPR
//     consent check.
//   'qDone', '10doa:trip-id', 'aruba.session' — pointers and flags. Losing one
//     costs a re-click, not a traveller's work, and versioning them would cost
//     a migration each, forever, to protect nothing.

/** Upgrades the v(n) payload to the v(n+1) payload. */
export type Migration = (payload: unknown) => unknown;

type Envelope = { v: number; d: unknown };

function isEnvelope(x: unknown): x is Envelope {
  return typeof x === 'object' && x !== null
    && typeof (x as Envelope).v === 'number' && 'd' in x;
}

/**
 * Read `key`, migrating whatever version is on disk up to `version`.
 *
 * `migrations[i]` upgrades v(i) to v(i+1), so `migrations.length` must equal
 * `version`. Returns `fallback` when the key is absent, unreadable, or stamped
 * at a version this bundle does not know.
 *
 * Deliberately does NOT write the migrated value back: that would be a side
 * effect during a React state initialiser, and leaving the old value in place
 * keeps v0 support permanently exercised, which is the contract. The next
 * ordinary writeStore re-stamps it. Never throws.
 */
export function readStore<T>(
  key: string, version: number, migrations: Migration[], fallback: T,
): T {
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return fallback; }
  if (raw === null) return fallback;

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fallback; }

  const enveloped = isEnvelope(parsed);
  const from = enveloped ? parsed.v : 0;
  // Written by a NEWER bundle (two tabs across a deploy). Losing this session's
  // view of the data is recoverable; writing a downgrade over it is not.
  if (from > version) return fallback;

  let payload = enveloped ? parsed.d : parsed;
  for (let n = from; n < version; n += 1) payload = migrations[n](payload);
  return payload as T;
}

/** Write `value` stamped at `version`. Silent in private mode, as before. */
export function writeStore<T>(key: string, version: number, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: version, d: value }));
  } catch { /* private mode — the page still works, it just does not persist */ }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/persist.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Confirm the tests can fail**

Make each of these three changes one at a time, run the file, confirm RED, then revert:

1. In `readStore`, change `const from = enveloped ? parsed.v : 0;` to `const from = version;` — the legacy-read and ladder tests must go red.
2. Change `if (from > version) return fallback;` to `if (false) return fallback;` — the newer-bundle test must go red.
3. In `writeStore`, drop the `{ v: version, d: value }` wrapper and store `value` directly — the round-trip test must go red.

If any of those stays green, the test is not testing what it claims.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; the whole suite passes with 12 more tests than before.

- [ ] **Step 7: Commit**

```bash
git add src/lib/persist.ts src/lib/persist.test.ts
git commit -m "feat(persist): versioned localStorage with a migration ladder

An un-enveloped value is version 0 — detected structurally and
permanently, so a tab straddling a deploy cannot strand a traveller's
data. Reads never write back; the next ordinary write re-stamps."
```

---

### Task 2: Route the shortlist and booked stores through `persist`

**Files:**
- Modify: `src/lib/shortlist.ts:13-22` (the `read`/`write` pair)
- Modify: `src/lib/booked.ts:5-14` (the `read`/`write` pair)
- Test: `src/lib/stores.test.ts` (create)

**Interfaces:**
- Consumes: `readStore`, `writeStore`, `Migration` from `./persist`.
- Produces: no API change. `useShortlist()` still returns `{ shortlist: Set<string>, toggle: (id: string) => void }` and `useBooked()` still returns `{ booked: Set<string>, toggle: (uid: string) => void }`.

These two files are the same change twice — a reviewer would accept or reject both together, so they share a task.

- [ ] **Step 1: Write the failing test**

Create `src/lib/stores.test.ts`:

```ts
// @vitest-environment jsdom
//
// These stores are React hooks, but what is under test is their persistence, so
// the test drives the module-level read/write through the localStorage the
// hooks share rather than rendering anything.
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShortlist } from './shortlist';
import { useBooked } from './booked';

beforeEach(() => { localStorage.clear(); });

describe('shortlist — a traveller who saved things before versioning existed', () => {
  it('still sees them', () => {
    // The exact bytes the old build wrote: a bare JSON array, no envelope.
    localStorage.setItem('10doa:starred', JSON.stringify(['item:12345', 'sunset-sail']));
    const { result } = renderHook(() => useShortlist());
    expect([...result.current.shortlist]).toEqual(['item:12345', 'sunset-sail']);
  });

  it('re-stamps the store at the current version on the next change', () => {
    localStorage.setItem('10doa:starred', JSON.stringify(['item:12345']));
    const { result } = renderHook(() => useShortlist());
    act(() => { result.current.toggle('item:67890'); });
    expect(JSON.parse(localStorage.getItem('10doa:starred')!))
      .toEqual({ v: 1, d: ['item:12345', 'item:67890'] });
  });

  it('reads back what it wrote', () => {
    const { result } = renderHook(() => useShortlist());
    act(() => { result.current.toggle('item:12345'); });
    const { result: fresh } = renderHook(() => useShortlist());
    expect([...fresh.current.shortlist]).toEqual(['item:12345']);
  });
});

describe('booked — a traveller who marked things booked before versioning existed', () => {
  it('still sees them', () => {
    localStorage.setItem('10doa:booked', JSON.stringify(['card-3-a1b2']));
    const { result } = renderHook(() => useBooked());
    expect([...result.current.booked]).toEqual(['card-3-a1b2']);
  });

  it('re-stamps the store at the current version on the next change', () => {
    localStorage.setItem('10doa:booked', JSON.stringify(['card-3-a1b2']));
    const { result } = renderHook(() => useBooked());
    act(() => { result.current.toggle('card-4-c3d4'); });
    expect(JSON.parse(localStorage.getItem('10doa:booked')!))
      .toEqual({ v: 1, d: ['card-3-a1b2', 'card-4-c3d4'] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/stores.test.ts`
Expected: FAIL — the re-stamp tests get a bare array where they expect `{ v: 1, d: [...] }`.

- [ ] **Step 3: Change `shortlist.ts`**

Replace the import block and the `read`/`write` pair. The `KEY` constant and its comment stay exactly as they are; so does `useShortlist` below.

```ts
import { useState } from 'react';
import { readStore, writeStore, type Migration } from './persist';
```

```ts
const KEY = '10doa:starred';

// v1 is the same shape v0 always had: a JSON array of 'item:<viatorId>' or
// activityId strings. The identity step is the adoption — it declares that
// nothing needs converting — and every future shape change appends here.
const VERSION = 1;
const MIGRATIONS: Migration[] = [(p) => p];

function read(): Set<string> {
  return new Set(readStore<string[]>(KEY, VERSION, MIGRATIONS, []));
}

function write(ids: Set<string>): void {
  writeStore(KEY, VERSION, [...ids]);
}
```

- [ ] **Step 4: Change `booked.ts`**

Same shape. `KEY` and `useBooked` are untouched.

```ts
import { useState } from 'react';
import { readStore, writeStore, type Migration } from './persist';

const KEY = '10doa:booked';

// v1 is the same shape v0 always had: a JSON array of card uids.
const VERSION = 1;
const MIGRATIONS: Migration[] = [(p) => p];

function read(): Set<string> {
  return new Set(readStore<string[]>(KEY, VERSION, MIGRATIONS, []));
}

function write(ids: Set<string>): void {
  writeStore(KEY, VERSION, [...ids]);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/stores.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Confirm the tests can fail**

In `shortlist.ts`, change `MIGRATIONS` to `[]` and `VERSION` to `0`, run the file, confirm the re-stamp test goes red, then revert. If it stays green the test is not reading the envelope it claims to.

- [ ] **Step 7: Run the full suite**

Run: `npm run typecheck && npm test`
Expected: clean. Nothing else in the app reads these two keys directly — `Explore.tsx` and `Itinerary.tsx` go through the hooks — so no other test should move.

- [ ] **Step 8: Commit**

```bash
git add src/lib/shortlist.ts src/lib/booked.ts src/lib/stores.test.ts
git commit -m "feat(persist): version the shortlist and booked stores

Both are v1-identical-to-v0: the arrays on disk need no conversion, so
the adoption step is the identity. Existing travellers keep everything."
```

---

### Task 3: Route the questionnaire answers through `persist`

**Files:**
- Modify: `src/App.tsx:96-102` (the `useState` initialiser) and `src/App.tsx:123-129` (`saveAndSetAnswers`)
- Test: `src/App.answers.test.ts` (create)

**Interfaces:**
- Consumes: `readStore`, `writeStore`, `Migration` from `./lib/persist`.
- Produces, all from `src/App.tsx`, so the test can exercise persistence without rendering the whole app: `export const ANSWERS_KEY: string`, `export const ANSWERS_VERSION: number`, `export const ANSWERS_MIGRATIONS: Migration[]`, `export function readAnswers(): Answers`, `export function writeAnswers(a: Answers): void`.

**The one thing that must not be lost.** The current initialiser is `{ ...DEFAULT_ANSWERS, ...JSON.parse(raw) }`. That spread is load-bearing for a different reason than versioning: it fills in keys a traveller's stored object never had, because they last saved before the field existed. Dropping it would hand `undefined` to code that calls `.map` on `interests` and `flags`. **The spread stays.** What changes is that a *renamed or retyped* field now gets a migration instead of silently falling through to a default.

- [ ] **Step 1: Write the failing test**

Create `src/App.answers.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readAnswers, ANSWERS_KEY, ANSWERS_VERSION, DEFAULT_ANSWERS } from './App';

beforeEach(() => { localStorage.clear(); });

// A browser that has used the planner since before persist.ts existed.
const LEGACY_ANSWERS = {
  days: 8,
  groupType: 'Couple',
  budget: 'Mid-range',
  interests: ['Beach & chill', 'Food & drink'],
  adventureLevel: 65,
  startOffset: 14,
  lodging: 'Palm Beach',
  flags: ['no-boats', 'honeymoon'],
  specialNotes: 'One of us gets seasick.',
  tripName: 'Beach week',
};

describe('answers persistence', () => {
  it('reads a legacy un-enveloped object with every field intact', () => {
    localStorage.setItem(ANSWERS_KEY, JSON.stringify(LEGACY_ANSWERS));
    expect(readAnswers()).toEqual(LEGACY_ANSWERS);
  });

  it('reads an enveloped object at the current version', () => {
    localStorage.setItem(ANSWERS_KEY, JSON.stringify({ v: ANSWERS_VERSION, d: LEGACY_ANSWERS }));
    expect(readAnswers()).toEqual(LEGACY_ANSWERS);
  });

  it('fills in fields a stored object predates, rather than returning undefined', () => {
    // Saved before `flags` and `tripName` existed. Code downstream calls
    // .map on flags; undefined would throw and blank the page.
    localStorage.setItem(ANSWERS_KEY, JSON.stringify({ days: 8, groupType: 'Couple' }));
    const a = readAnswers();
    expect(a.days).toBe(8);
    expect(a.groupType).toBe('Couple');
    expect(a.flags).toEqual([]);
    expect(a.interests).toEqual([]);
    expect(a.specialNotes).toBe('');
  });

  it('returns the defaults when nothing is stored', () => {
    expect(readAnswers()).toEqual(DEFAULT_ANSWERS);
  });

  it('returns the defaults rather than throwing on unparseable storage', () => {
    localStorage.setItem(ANSWERS_KEY, '{not json');
    expect(readAnswers()).toEqual(DEFAULT_ANSWERS);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/App.answers.test.ts`
Expected: FAIL — `readAnswers`, `ANSWERS_KEY`, and `ANSWERS_VERSION` are not exported from `./App`.

- [ ] **Step 3: Add the store definition to `App.tsx`**

Add the import alongside the existing ones near the top:

```ts
import { readStore, writeStore, type Migration } from './lib/persist';
```

Then, immediately after the existing `DEFAULT_ANSWERS` declaration (currently ending at line 44), add:

```ts
export const ANSWERS_KEY = '10doa:answers';

// v1 is the same shape v0 always had. The identity step is the adoption — it
// declares that nothing on disk needs converting. Renaming or retyping any
// field of `Answers` means appending a real migration here and bumping
// ANSWERS_VERSION; see .claude/CLAUDE.md.
export const ANSWERS_VERSION = 1;
export const ANSWERS_MIGRATIONS: Migration[] = [(p) => p];

/**
 * The stored answers, or the defaults.
 *
 * The spread over DEFAULT_ANSWERS is load-bearing and separate from versioning:
 * it fills in keys a traveller's stored object never had because they last
 * saved before the field existed. Without it, `interests` or `flags` arrives as
 * undefined and the first `.map` downstream blanks the page. Versioning handles
 * the other case — a field that changed meaning — which no spread can detect.
 */
export function readAnswers(): Answers {
  return {
    ...DEFAULT_ANSWERS,
    ...readStore<Partial<Answers>>(ANSWERS_KEY, ANSWERS_VERSION, ANSWERS_MIGRATIONS, {}),
  };
}

export function writeAnswers(a: Answers): void {
  writeStore(ANSWERS_KEY, ANSWERS_VERSION, a);
}
```

- [ ] **Step 4: Use them in the component**

Replace the initialiser at lines 96-102 with:

```ts
  const [answers, setAnswers] = useState<Answers>(readAnswers);
```

and the body of `saveAndSetAnswers` at lines 123-129 with:

```ts
  const saveAndSetAnswers = (a: Answers | ((prev: Answers) => Answers)) => {
    setAnswers((prev) => {
      const next = typeof a === 'function' ? a(prev) : a;
      writeAnswers(next);
      return next;
    });
  };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/App.answers.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Confirm the tests can fail**

Two checks, each reverted after:

1. Remove `...DEFAULT_ANSWERS` from `readAnswers` — the "fills in fields a stored object predates" test must go red.
2. Change `ANSWERS_MIGRATIONS` to `[() => ({})]` — the legacy-read test must go red.

- [ ] **Step 7: Run the full suite**

Run: `npm run typecheck && npm test`
Expected: clean. Watch specifically for `src/pages/Questionnaire.dom.test.tsx` and `src/pages/Explore.dom.test.tsx`, which render against answers — if either moves, the behaviour changed and the cause must be understood before committing, not after.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/App.answers.test.ts
git commit -m "feat(persist): version the questionnaire answers

The spread over DEFAULT_ANSWERS stays — it fills keys a stored object
predates, which is a different job from versioning. What is new is that
a renamed or retyped field now needs a migration instead of silently
becoming a default."
```

---

### Task 4: Write down the rule

**Files:**
- Modify: `.claude/CLAUDE.md:17` (the localStorage line under "Key invariants")
- Modify: `docs/superpowers/specs/2026-08-16-data-durability-design.md` (the `**Status:**` line)

Without this the mechanism exists and nobody uses it. The line currently reads "Shape changes need migration" — true but unactionable, since until now there was nothing to migrate with.

- [ ] **Step 1: Replace the invariant line**

Replace line 17 of `.claude/CLAUDE.md` with:

```markdown
- localStorage keys are stable contracts: `10doa:answers`, `10doa:starred`, `10doa:booked`,
  `10doa:analytics-consent`, `10doa:trip-id`, `aruba.session`, `qDone`.
  The first three are **versioned** through `src/lib/persist.ts` and hold the traveller's own
  work. Renaming, retyping, or removing any field in one of them means: append a real
  migration to that key's `MIGRATIONS`, bump its `VERSION`, and add a fixture test built from
  the OLD shape asserting the information survives. A default is not a migration — the spread
  over `DEFAULT_ANSWERS` fills absent keys, it cannot detect a changed one.
  `10doa:analytics-consent` must NEVER be versioned: `src/main.tsx` reads it as a bare
  `=== 'true'` at boot, before any migration could run.
```

- [ ] **Step 2: Update the spec's status line**

In `docs/superpowers/specs/2026-08-16-data-durability-design.md`, replace:

```markdown
**Status:** Design approved, not yet implemented.
```

with:

```markdown
**Status:** V1 implemented 2026-08-16 (`src/lib/persist.ts`). V2 not started — no database
backup exists yet.
```

- [ ] **Step 3: Verify the referenced names exist**

Run: `grep -n "MIGRATIONS\|VERSION" src/lib/persist.ts src/lib/shortlist.ts src/lib/booked.ts src/App.tsx`
Expected: `ANSWERS_VERSION`/`ANSWERS_MIGRATIONS` in `App.tsx` and `VERSION`/`MIGRATIONS` in both lib files. A rule that names symbols which do not exist is worse than no rule.

- [ ] **Step 4: Commit**

```bash
git add .claude/CLAUDE.md docs/superpowers/specs/2026-08-16-data-durability-design.md
git commit -m "docs: the rule that makes versioned stores actually get used

A mechanism nobody is told to use protects nothing."
```

---

## Not in this plan

- **V2, the database backups.** Independent subsystem, its own plan. Until it exists the Supabase Free-tier database still has no backup and no point-in-time recovery.
- **V3 and V4**, deferred in the spec by explicit decision.
- **Deploying.** Pushing `main` deploys to production. Run `/code-review` before any push, per the ship gate.
