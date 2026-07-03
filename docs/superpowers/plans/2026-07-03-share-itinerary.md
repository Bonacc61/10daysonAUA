# Share Itinerary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inert "Share itinerary" button produce a short link (`/i/<id>`) that opens a read-only view of the plan, which a recipient can adopt into their own editable trip after signing in.

**Architecture:** A new immutable `shared_itineraries` table stores an id-only snapshot of the trip state (`{answers, plan, rejected, rejected_groups}`), addressed by an 8-char base62 slug. `src/lib/shares.ts` creates/loads snapshots, reusing serialization shared with `trips.ts`. `App.tsx` routes `/i/<id>` to the itinerary page with a `shareId` prop; `Itinerary.tsx` loads the snapshot read-only (edit affordances + autosave gated off) and offers "Save a copy", which adopts the snapshot into the visitor's own `trips` row after auth — asking before replacing an existing trip.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Supabase (`@supabase/supabase-js`), Vitest (node env, pure-logic tests). No router library — routing is manual `history` API. No new dependencies.

## Global Constraints

- **No new npm dependencies.** Use web platform APIs only: `crypto.getRandomValues`, `navigator.share`, `navigator.clipboard`.
- **TypeScript strict** — `npm run build` runs `tsc --noEmit -p tsconfig.app.json` before `vite build`; the build must stay green.
- **Follow existing UI idiom** — inline styles + existing CSS classes (`btn-red`, `btn-ghost`, `chunky`, `bleed`, `container-1280`), Feather-style icons from `src/components/Icons.tsx`, CSS vars (`--ink`, `--cream`, `--red`, `--yellow-bg`).
- **Link format:** `https://10daysonaruba.com/i/<id>`, `<id>` = 8-char base62 (`[A-Za-z0-9]{8}`).
- **Anonymous users can both create and view shares** — never require sign-in to share or to view a shared link.
- **`supabase` may be `null`** (unconfigured) — every DB call guards on it, and the Share button disables when it's null.
- **Deploy ordering:** apply the DB migration (Task 1, via Supabase Management API — token at `/root/.supabase_token`, project ref `mrfblzsihpecockhsnqe`) **before** the frontend that reads the table ships. Frontend ships via the existing GitHub Actions workflow on push to `main`. Do **not** use `supabase db push` — remote migration history is drifted (3 local migrations unrecorded); a push would replay them.

---

## Phase 1 — Shareable read-only links (independently shippable)

### Task 1: Create the `shared_itineraries` table

**Files:**
- Create: `supabase/migrations/20260703130000_shared_itineraries.sql`

**Interfaces:**
- Produces: table `public.shared_itineraries(id text pk, answers jsonb, plan jsonb, rejected text[], rejected_groups text[], created_by uuid, created_at timestamptz)` with RLS allowing public SELECT and any INSERT, no UPDATE/DELETE.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260703130000_shared_itineraries.sql`:

```sql
-- Immutable, publicly-readable snapshots of an itinerary, addressed by a short
-- slug in the URL (/i/<id>). Same shape as `trips` minus the per-user key: an
-- itinerary is fully reconstructible from { answers, plan, rejected,
-- rejected_groups } — plan stores only ids; cards are rebuilt from the catalog.
create table if not exists public.shared_itineraries (
  id              text        primary key,                       -- 8-char base62 slug (client-generated)
  answers         jsonb       not null default '{}'::jsonb,      -- questionnaire Answers
  plan            jsonb       not null default '[]'::jsonb,      -- PlannedDay[] (id-only entries)
  rejected        text[]      not null default '{}',             -- swap memory (card ids)
  rejected_groups text[]      not null default '{}',             -- swap memory (group ids)
  created_by      uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.shared_itineraries enable row level security;

-- Anyone with the link can read the snapshot (including anonymous visitors).
drop policy if exists "shared_itineraries_select_public" on public.shared_itineraries;
create policy "shared_itineraries_select_public" on public.shared_itineraries
  for select using (true);

-- Anyone can create a share (anonymous visitors already build itineraries).
-- created_by is filled from auth.uid() by the column default, so it can't be
-- spoofed by the client payload.
drop policy if exists "shared_itineraries_insert_any" on public.shared_itineraries;
create policy "shared_itineraries_insert_any" on public.shared_itineraries
  for insert with check (true);

-- No update/delete policies: snapshots are immutable, and RLS default-denies
-- any command without a matching policy.
```

- [ ] **Step 2: Apply the migration to the remote DB via the Management API**

The SQL file's content must be sent as a JSON string. Generate the request body from the file, then POST it (avoids shell quote-escaping bugs):

```bash
cd /root/10daysonaruba.com
TOKEN="$(tr -d '[:space:]' < /root/.supabase_token)"
REF=mrfblzsihpecockhsnqe
python3 -c 'import json,sys; print(json.dumps({"query": open("supabase/migrations/20260703130000_shared_itineraries.sql").read()}))' > /tmp/share_migration.json
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data @/tmp/share_migration.json --max-time 60
```

Expected: `[]` (DDL returns no rows) and no `"message":"Failed..."` error.

- [ ] **Step 3: Verify the table + policies exist**

```bash
TOKEN="$(tr -d '[:space:]' < /root/.supabase_token)"
REF=mrfblzsihpecockhsnqe
printf '%s' '{"query":"select to_regclass('"'"'public.shared_itineraries'"'"') is not null as tbl, (select count(*) from pg_policies where tablename='"'"'shared_itineraries'"'"') as policies;"}' > /tmp/share_check.json
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data @/tmp/share_check.json --max-time 30
```

Expected: `[{"tbl":true,"policies":2}]`

- [ ] **Step 4: Record the migration in remote history (bookkeeping, so a future `db push` skips it)**

```bash
cd /root/10daysonaruba.com
export SUPABASE_ACCESS_TOKEN="$(tr -d '[:space:]' < /root/.supabase_token)"
supabase migration repair --status applied 20260703130000 --linked
```

Expected: "Repaired migration history: [20260703130000] => applied". (If it prompts for a DB password or errors on the pre-existing drift, skip this step — it is bookkeeping only and does not affect the running app; note the skip.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260703130000_shared_itineraries.sql
git commit -m "feat(db): add shared_itineraries table for share links"
```

---

### Task 2: Extract shared trip-state serialization

**Files:**
- Create: `src/lib/tripState.ts`
- Create: `src/lib/tripState.test.ts`
- Modify: `src/lib/trips.ts`

**Interfaces:**
- Produces: `type TripState = { answers: Answers; plan: PlannedDay[]; rejected: Set<string>; rejectedGroups: Set<string> }`; `type StateColumns = { answers: Answers; plan: PlannedDay[]; rejected: string[]; rejected_groups: string[] }`; `stateToColumns(s: TripState): StateColumns`; `columnsToState(c: StateColumns): TripState`.
- Consumes: `Answers` from `../App`, `PlannedDay` from `../data/itineraryPlan`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tripState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stateToColumns, columnsToState, type TripState } from './tripState';
import { DEFAULT_ANSWERS } from '../App';

const sample = (): TripState => ({
  answers: { ...DEFAULT_ANSWERS, days: 7, interests: ['Food & drink'] },
  plan: [{
    day: 1, title: 'Day 1', color: '#FF6B47',
    morning: [{ uid: 'c1', entry: { kind: 'activity', id: 'eagle-beach-morning' } }],
    afternoon: [],
    evening: [{ uid: 'c2', entry: { kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-x' } }],
  }],
  rejected: new Set(['r1', 'r2']),
  rejectedGroups: new Set(['g1']),
});

describe('tripState serialization', () => {
  it('stateToColumns turns Sets into arrays and keeps answers + plan', () => {
    const c = stateToColumns(sample());
    expect(c.answers.days).toBe(7);
    expect(c.plan[0].evening[0].entry).toEqual({ kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-x' });
    expect(c.rejected).toEqual(['r1', 'r2']);
    expect(c.rejected_groups).toEqual(['g1']);
  });

  it('round-trips through columnsToState (arrays back to Sets)', () => {
    const s = sample();
    const back = columnsToState(stateToColumns(s));
    expect(back.answers).toEqual(s.answers);
    expect(back.plan).toEqual(s.plan);
    expect([...back.rejected]).toEqual(['r1', 'r2']);
    expect([...back.rejectedGroups]).toEqual(['g1']);
  });

  it('columnsToState tolerates null arrays', () => {
    const back = columnsToState({ answers: DEFAULT_ANSWERS, plan: [], rejected: null as unknown as string[], rejected_groups: null as unknown as string[] });
    expect([...back.rejected]).toEqual([]);
    expect([...back.rejectedGroups]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tripState.test.ts`
Expected: FAIL — cannot find module `./tripState`.

- [ ] **Step 3: Create the module**

Create `src/lib/tripState.ts`:

```ts
import type { Answers } from '../App';
import type { PlannedDay } from '../data/itineraryPlan';

// The itinerary state shared by a saved trip and a shared snapshot: the
// questionnaire answers, the id-only plan (cards rebuilt from the catalog on
// render), and the swap-rejection memory.
export type TripState = {
  answers: Answers;
  plan: PlannedDay[];
  rejected: Set<string>;
  rejectedGroups: Set<string>;
};

// The four columns common to both the `trips` and `shared_itineraries` tables.
// (trips adds user_id; shared_itineraries adds id/created_by/created_at.)
export type StateColumns = {
  answers: Answers;
  plan: PlannedDay[];
  rejected: string[];
  rejected_groups: string[];
};

export function stateToColumns(s: TripState): StateColumns {
  return {
    answers: s.answers,
    plan: s.plan,
    rejected: [...s.rejected],
    rejected_groups: [...s.rejectedGroups],
  };
}

export function columnsToState(c: StateColumns): TripState {
  return {
    answers: c.answers,
    plan: c.plan,
    rejected: new Set(c.rejected ?? []),
    rejectedGroups: new Set(c.rejected_groups ?? []),
  };
}
```

- [ ] **Step 4: Refactor `trips.ts` to reuse the helper**

Replace the top of `src/lib/trips.ts` (lines 1–40, through `fromRow`) with:

```ts
import { supabase } from './supabase';
import { stateToColumns, columnsToState, type TripState, type StateColumns } from './tripState';

// Re-exported so existing importers (`import { ..., type TripState } from './trips'`) keep working.
export type { TripState };

export type TripRow = { user_id: string } & StateColumns;

export function toRow(userId: string, s: TripState): TripRow {
  return { user_id: userId, ...stateToColumns(s) };
}

export function fromRow(row: TripRow): TripState {
  return columnsToState(row);
}
```

Leave `loadTrip` and `upsertTrip` (below `fromRow`) unchanged.

- [ ] **Step 5: Run all lib tests to verify nothing regressed**

Run: `npx vitest run src/lib/`
Expected: PASS — both `tripState.test.ts` and the existing `trips.test.ts` green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tripState.ts src/lib/tripState.test.ts src/lib/trips.ts
git commit -m "refactor(trips): extract shared tripState serialization"
```

---

### Task 3: `shares.ts` — create/load shared snapshots

**Files:**
- Create: `src/lib/shares.ts`
- Create: `src/lib/shares.test.ts`

**Interfaces:**
- Consumes: `stateToColumns`, `columnsToState`, `TripState` from `./tripState`; `supabase` from `./supabase`.
- Produces: `randomSlug(len?: number): string`; `createShare(state: TripState): Promise<{ id: string | null; error: string | null }>`; `loadShare(id: string): Promise<TripState | null>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/shares.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_ANSWERS } from '../App';
import type { TripState } from './tripState';

const insert = vi.fn();
const maybeSingle = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => insert(row),
      select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
    }),
  },
}));

import { createShare, loadShare, randomSlug } from './shares';

const sample = (): TripState => ({
  answers: { ...DEFAULT_ANSWERS, days: 7 },
  plan: [{
    day: 1, title: 'Day 1', color: '#FF6B47',
    morning: [], afternoon: [],
    evening: [{ uid: 'c2', entry: { kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-x' } }],
  }],
  rejected: new Set(['r1', 'r2']),
  rejectedGroups: new Set(),
});

beforeEach(() => { insert.mockReset(); maybeSingle.mockReset(); });

describe('randomSlug', () => {
  it('is 8 base62 chars', () => {
    expect(randomSlug()).toMatch(/^[A-Za-z0-9]{8}$/);
  });
});

describe('createShare', () => {
  it('inserts the state columns under a fresh slug and returns it', async () => {
    insert.mockResolvedValue({ error: null });
    const { id, error } = await createShare(sample());
    expect(error).toBeNull();
    expect(id).toMatch(/^[A-Za-z0-9]{8}$/);
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.id).toBe(id);
    expect(payload.rejected).toEqual(['r1', 'r2']);
    expect((payload.plan as { evening: { entry: unknown }[] }[])[0].evening[0].entry)
      .toEqual({ kind: 'group', groupId: 'watersports', bestSellerId: 'snorkel-x' });
    // created_by is never sent by the client (server default fills it).
    expect(payload.created_by).toBeUndefined();
  });

  it('retries once on a unique-violation (23505) then succeeds', async () => {
    insert
      .mockResolvedValueOnce({ error: { code: '23505', message: 'dup' } })
      .mockResolvedValueOnce({ error: null });
    const { id, error } = await createShare(sample());
    expect(error).toBeNull();
    expect(id).not.toBeNull();
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('returns the error for a non-collision failure without retrying', async () => {
    insert.mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    const { id, error } = await createShare(sample());
    expect(id).toBeNull();
    expect(error).toBe('denied');
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('loadShare', () => {
  it('maps columns back into a TripState with Sets', async () => {
    maybeSingle.mockResolvedValue({ data: { answers: DEFAULT_ANSWERS, plan: [], rejected: ['x'], rejected_groups: [] }, error: null });
    const st = await loadShare('abc12345');
    expect(st).not.toBeNull();
    expect([...st!.rejected]).toEqual(['x']);
  });

  it('returns null for a missing id', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await loadShare('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/shares.test.ts`
Expected: FAIL — cannot find module `./shares`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/shares.ts`:

```ts
import { supabase } from './supabase';
import { stateToColumns, columnsToState, type TripState, type StateColumns } from './tripState';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// A short, URL-safe slug from a CSPRNG. 8 base62 chars ≈ 47 bits — ample
// entropy for unguessable share links; collisions are handled by a retry.
export function randomSlug(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// Insert an immutable snapshot of the trip state and return its slug (the id in
// /i/<id>). created_by is filled by the table's auth.uid() default, so it is
// never part of the client payload. Retries once on the (astronomically
// unlikely) slug collision — Postgres unique_violation is code 23505.
export async function createShare(state: TripState): Promise<{ id: string | null; error: string | null }> {
  if (!supabase) return { id: null, error: 'not configured' };
  const cols: StateColumns = stateToColumns(state);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const id = randomSlug();
    const { error } = await supabase.from('shared_itineraries').insert({ id, ...cols });
    if (!error) return { id, error: null };
    if (error.code !== '23505') return { id: null, error: error.message };
  }
  return { id: null, error: 'Could not generate a unique link — try again.' };
}

// Fetch a shared snapshot by slug; null for a missing/bad id or any error.
export async function loadShare(id: string): Promise<TripState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('shared_itineraries')
    .select('answers, plan, rejected, rejected_groups')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return columnsToState(data as StateColumns);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/shares.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shares.ts src/lib/shares.test.ts
git commit -m "feat(shares): create/load shared itinerary snapshots"
```

---

### Task 4: Route `/i/<id>` to the itinerary page

**Files:**
- Modify: `src/App.tsx`
- Create: `src/App.routing.test.ts`

**Interfaces:**
- Produces: `shareIdFromPath(pathname: string): string | null` and `shareIdFromUrl(): string | null` exported from `../App`; `Itinerary` receives a new prop `shareId: string | null`.

- [ ] **Step 1: Write the failing test**

Create `src/App.routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shareIdFromPath } from './App';

describe('shareIdFromPath', () => {
  it('extracts the slug from /i/<id>', () => {
    expect(shareIdFromPath('/i/Ab3xZ9qK')).toBe('Ab3xZ9qK');
  });
  it('tolerates a trailing slash', () => {
    expect(shareIdFromPath('/i/Ab3xZ9qK/')).toBe('Ab3xZ9qK');
  });
  it('returns null for non-share paths', () => {
    expect(shareIdFromPath('/itinerary')).toBeNull();
    expect(shareIdFromPath('/')).toBeNull();
  });
  it('returns null for a malformed share path', () => {
    expect(shareIdFromPath('/i/')).toBeNull();
    expect(shareIdFromPath('/i/ab/cd')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/App.routing.test.ts`
Expected: FAIL — `shareIdFromPath` is not exported.

- [ ] **Step 3: Add the parser and route wiring**

In `src/App.tsx`, add after `pageFromUrl` (after line 49):

```ts
// A shared itinerary lives at /i/<id>. Pure so it can be unit-tested; the
// window-reading wrapper below is what the app calls.
export function shareIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/i\/([A-Za-z0-9]{1,32})\/?$/);
  return m ? m[1] : null;
}
export function shareIdFromUrl(): string | null {
  return shareIdFromPath(window.location.pathname);
}
```

Change `pageFromUrl` (line 47–49) to treat a share path as the itinerary page:

```ts
function pageFromUrl(): PageId {
  if (shareIdFromUrl()) return 'itinerary';
  return PATH_TO_PAGE[window.location.pathname] ?? 'landing';
}
```

In the `App` component, add share-id state (after line 54, `const [loginOpen...`):

```ts
  const [shareId, setShareId] = useState<string | null>(shareIdFromUrl);
```

In `setPage` (line 56–60), clear the share when navigating away:

```ts
  function setPage(p: PageId) {
    const path = PAGE_TO_PATH[p];
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setShareId(null);
    setPageState(p);
  }
```

In the `popstate` effect (line 63), keep the share id in sync:

```ts
    const onPop = () => { setPageState(pageFromUrl()); setShareId(shareIdFromUrl()); };
```

Pass the prop to `Itinerary` (line 80):

```tsx
      {page === 'itinerary'     && <Itinerary     setPage={setPage} answers={answers} setAnswers={setAnswers} onLogin={() => setLoginOpen(true)} shareId={shareId} />}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/App.routing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the `shareId` prop to Itinerary's type (compile fix)**

In `src/pages/Itinerary.tsx`, extend `Props` (line 32):

```ts
type Props = { setPage: (p: PageId) => void; answers: Answers; setAnswers: (a: Answers) => void; onLogin: () => void; shareId: string | null };
```

And destructure it (line 40):

```ts
export default function Itinerary({ setPage, answers, setAnswers, onLogin, shareId }: Props) {
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: PASS (tsc + vite build, no type errors — `shareId` is now consumed by the prop even if unused yet; if tsc flags it unused, that is resolved in Task 5).

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.routing.test.ts src/pages/Itinerary.tsx
git commit -m "feat(routing): map /i/<id> to a shareId prop on the itinerary page"
```

---

### Task 5: Load a shared snapshot read-only

**Files:**
- Modify: `src/pages/Itinerary.tsx`

**Interfaces:**
- Consumes: `loadShare` from `../lib/shares`; `shareId` prop from Task 4.
- Produces: a `readOnly` boolean (component-local) that Task 6 reads; suppresses trip hydration + autosave whenever `shareId` is set.

- [ ] **Step 1: Import `loadShare` and add read-only state**

In `src/pages/Itinerary.tsx`, add to the imports near line 22:

```ts
import { loadShare } from '../lib/shares';
```

Add state after the persistence block (after line 64, `const hydratedUser = useRef...`):

```ts
  // --- Shared read-only view (/i/<id>) -------------------------------------
  const [readOnly, setReadOnly] = useState<boolean>(!!shareId);
  const [shareLoading, setShareLoading] = useState<boolean>(!!shareId);
  const [shareMissing, setShareMissing] = useState(false);
```

- [ ] **Step 2: Load the snapshot on mount / when `shareId` changes**

Add this effect immediately after the state above:

```ts
  // A shared link always shows its snapshot — even for signed-in visitors — so
  // this seeds the plan/answers directly and never regenerates or hydrates.
  useEffect(() => {
    if (!shareId) { setReadOnly(false); setShareLoading(false); return; }
    setReadOnly(true);
    setShareLoading(true);
    setShareMissing(false);
    let alive = true;
    loadShare(shareId).then((s) => {
      if (!alive) return;
      if (s) {
        setPlan(s.plan);
        setRejected(s.rejected);
        setRejectedGroups(s.rejectedGroups);
        setAnswers(s.answers);
      } else {
        setShareMissing(true);
      }
      setShareLoading(false);
    });
    return () => { alive = false; };
  }, [shareId, setAnswers]);
```

- [ ] **Step 3: Gate trip hydration + autosave off for shared views**

In the hydrate effect (line 67), add a guard as the first line inside the effect:

```ts
  useEffect(() => {
    if (shareId) return;               // a shared view never loads the visitor's own trip
    if (!user) { setHydrated(false); hydratedUser.current = null; return; }
    // ...unchanged...
  }, [user, setAnswers, shareId]);
```

In the autosave effect (line 86), extend the guard and deps:

```ts
  useEffect(() => {
    if (shareId || !user || !hydrated) return;   // never autosave a shared snapshot
    const id = window.setTimeout(() => {
      void upsertTrip(user.id, { answers, plan, rejected, rejectedGroups });
    }, 800);
    return () => window.clearTimeout(id);
  }, [user, hydrated, answers, plan, rejected, rejectedGroups, shareId]);
```

- [ ] **Step 4: Add loading + not-found early returns**

Immediately before the main `return (` (line 341), add:

```tsx
  if (shareLoading) {
    return (
      <div className="bleed" style={{ background: 'var(--cream)', minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontStyle: 'italic', color: 'rgba(0,0,0,0.6)' }}>Loading shared itinerary…</p>
      </div>
    );
  }
  if (shareMissing) {
    return (
      <div className="bleed" style={{ background: 'var(--cream)', minHeight: '60vh', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
        <h1 className="font-display" style={{ fontSize: 32, margin: 0, color: 'var(--ink)' }}>This shared itinerary couldn’t be found.</h1>
        <p style={{ color: 'rgba(0,0,0,0.7)', margin: 0 }}>The link may be mistyped or removed.</p>
        <button className="btn-red" onClick={() => setPage('landing')} style={{ padding: '10px 18px' }}>Build your own →</button>
      </div>
    );
  }
```

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Manual verification — seed a share row and open it**

Insert a throwaway snapshot, then load the app at its path:

```bash
TOKEN="$(tr -d '[:space:]' < /root/.supabase_token)"
REF=mrfblzsihpecockhsnqe
printf '%s' '{"query":"insert into public.shared_itineraries (id, answers, plan) values ('"'"'testseed1'"'"', '"'"'{\"days\":3}'"'"'::jsonb, '"'"'[]'"'"'::jsonb) on conflict (id) do nothing;"}' > /tmp/seed.json
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data @/tmp/seed.json
```

Run `npm run dev`, open `http://localhost:5173/i/testseed1`. Expected: brief "Loading shared itinerary…", then the itinerary renders (empty plan is fine here). Open `http://localhost:5173/i/doesnotexist` → the not-found panel. Clean up: `delete from public.shared_itineraries where id='testseed1';` via the same API.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Itinerary.tsx
git commit -m "feat(itinerary): load shared snapshot read-only, gate hydrate/autosave"
```

---

### Task 6: Render read-only (hide edit affordances + banner)

**Files:**
- Modify: `src/pages/Itinerary.tsx`

**Interfaces:**
- Consumes: `readOnly` from Task 5.
- Produces: `readOnly` threaded through `DayHandlers` → `ItineraryDay` → `Section` → `SortableCard`; a top-of-main banner; editor buttons hidden in read-only.

- [ ] **Step 1: Thread `readOnly` into the day components**

In `src/pages/Itinerary.tsx`, add `readOnly` to the `DayHandlers` type (line 431):

```ts
type DayHandlers = {
  readOnly: boolean;
  flipped: Set<string>; swapping: Set<string>;
  // ...rest unchanged...
};
```

Pass it into each `<ItineraryDay>` (inside the `plan.map`, near line 390) by adding the prop:

```tsx
                  <ItineraryDay
                    key={d.day}
                    d={d}
                    dayIdx={i}
                    isLast={i === plan.length - 1}
                    onRenameDay={onRenameDay}
                    readOnly={readOnly}
                    flipped={flipped}
                    // ...rest unchanged...
                  />
```

`ItineraryDay` and `Section` already spread `...h` (which now carries `readOnly`) down to their children, so no change is needed there beyond consuming it.

- [ ] **Step 2: Disable rename in read-only (`ItineraryDay`)**

In `ItineraryDay`, `readOnly` arrives via `...h`. Destructure it (line 443–444):

```ts
function ItineraryDay({
  d, dayIdx, isLast, onRenameDay, ...h
}: { d: PlannedDay; dayIdx: number; isLast: boolean;
     onRenameDay: (dayIdx: number, title: string) => void } & DayHandlers) {
  const readOnly = h.readOnly;
```

Guard the rename affordances: change the title `<span>` (line 490–498) so the edit button and double-click only work when editable:

```tsx
          ) : (
            <span
              className="itin-day-title"
              onDoubleClick={readOnly ? undefined : startEdit}
              title={readOnly ? undefined : 'Double-click to rename this day'}
            >
              {d.title}
              {!readOnly && (
                <button type="button" className="itin-day-edit" onClick={startEdit} aria-label={`Rename day ${d.day}`}>✎</button>
              )}
            </span>
          )}
```

- [ ] **Step 3: Hide the lunch suggestion in read-only (`Section`)**

In `Section` (line 538), guard the "Suggest lunch spot" button:

```tsx
      {section === 'afternoon' && !h.readOnly && (
        <button type="button" className="itin-lunch-btn" onClick={() => h.onSuggestLunch(dayNum)}>
          <span className="itin-lunch-spark" aria-hidden>✦</span>Suggest lunch spot
        </button>
      )}
```

Also soften the empty-zone copy so a read-only day with an empty section doesn't invite drops (line 545):

```tsx
          {cards.length === 0 && (
            <div className="itin-section-empty">
              {h.readOnly ? 'Nothing planned.' : 'Drop an activity here, or add one from a card’s “Other suggestions”.'}
            </div>
          )}
```

- [ ] **Step 4: Hide grip/remove/swap/add on cards in read-only (`SortableCard`)**

In `SortableCard` (line 559), destructure `readOnly` and gate the controls + the card's editor callbacks. Update the signature to pull `readOnly`:

```tsx
function SortableCard({
  card, entry, section, dayNum, readOnly,
  flipped, swapping, reasonOpen, appearing, removing,
  onFlip, onOpenSwap, onSwap, onAddItem, onRemove,
}: { card: PlannedCard; entry: CardEntry; section: Slot; dayNum: number } & DayHandlers) {
```

Replace the controls block (line 579–599) so grip + remove only render when editable:

```tsx
      {!readOnly && (
        <div className="itin-card-controls">
          {flipped.has(card.uid) && (
            <button
              type="button"
              className="itin-card-back-btn"
              aria-label="Back to card"
              onClick={() => onFlip(card.uid)}
            >← Back</button>
          )}
          <button
            className="itin-card-grip"
            aria-label="Drag to move between days and between morning, afternoon and evening"
            {...attributes}
            {...listeners}
          >⠿</button>
          <button
            className="itin-card-remove"
            aria-label="Remove from itinerary"
            onClick={() => onRemove(card.uid)}
          ><X size={13} aria-hidden /></button>
        </div>
      )}
```

And neutralise the swap/add actions on the card itself (line 600–609) so a read-only card can still flip to read "why", but can't swap or add:

```tsx
      <ItineraryCard
        entry={entry}
        flipped={flipped.has(card.uid)}
        swapping={swapping.has(card.uid)}
        onFlip={() => onFlip(card.uid)}
        onSwap={readOnly ? undefined : () => onOpenSwap(card.uid)}
        showReasons={!readOnly && reasonOpen.has(card.uid)}
        onPickReason={readOnly ? undefined : (reason) => onSwap(card.uid, section, entry, reason)}
        onAddItem={readOnly ? undefined : (item) => onAddItem(dayNum, section, item)}
      />
```

Required change in `src/components/ItineraryCard.tsx`: `onPickReason` and `onAddItem` are already optional, but `onSwap` is required (line 17) and its button renders unconditionally (line ~172). Widen it to optional and hide the button when it is absent, so read-only cards show no Swap action:

- Line 17 `onSwap: () => void;` → `onSwap?: () => void;`
- Line ~94 (the inner card component's `onSwap: () => void;`) → `onSwap?: () => void;`
- Line ~172, wrap the Swap `<button onClick={onSwap} …>…</button>` in `{onSwap && ( … )}`.

Include this edit in this task's commit (the `git add` in Step 8 already lists `ItineraryCard.tsx`).

- [ ] **Step 5: Add the shared-view banner + hide header editor actions**

In the yellow header block, gate the editor buttons (line 353–356) behind `!readOnly`:

```tsx
            {!readOnly && (
              <div className="chunky itin-header-counter" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn-ghost" onClick={() => setPage('explore')} style={{ padding: '10px 14px', fontSize: 13 }}>+ Add more →</button>
                <button className="btn-red" onClick={scrollToSignIn} style={{ padding: '10px 16px', fontSize: 14, borderWidth: 2 }}>Save trip</button>
              </div>
            )}
```

Add the banner as the first child inside the cream content wrapper — immediately after `<div className="container-1280">` (line 362):

```tsx
          {readOnly && (
            <div className="chunky" style={{ background: 'var(--yellow-bg)', border: '2px solid var(--ink)', padding: '12px 18px', marginBottom: 24, fontWeight: 700, color: 'var(--ink)' }}>
              You’re viewing a shared Aruba itinerary — sign in to save your own editable copy.
            </div>
          )}
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Manual verification**

Re-seed `testseed1` (Task 5 Step 6) but with a non-empty plan copied from a real trip if available; else reuse the empty one. Run `npm run dev`, open `/i/testseed1`. Expected: yellow banner at top; no "+ Add more"/"Save trip" in the header; cards show no grip/remove/swap; days can't be renamed. Then open `/itinerary` (no share) and confirm the normal editable view still has all controls. Clean up the seed row.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Itinerary.tsx src/components/ItineraryCard.tsx
git commit -m "feat(itinerary): read-only rendering for shared views"
```

---

### Task 7: Creator UX — Share button, link creation, share popover

**Files:**
- Create: `src/components/SharePopover.tsx`
- Modify: `src/pages/Itinerary.tsx`

**Interfaces:**
- Consumes: `createShare` from `../lib/shares`; `supabase` from `../lib/supabase` (to disable when unconfigured).
- Produces: a working "Share itinerary" button that creates (and caches) a `/i/<id>` link, uses the native share sheet on mobile, and a `SharePopover` on desktop.

- [ ] **Step 1: Build the SharePopover component**

Create `src/components/SharePopover.tsx`:

```tsx
import { useState } from 'react';

// Desktop share affordance: a read-only link field with Copy, plus WhatsApp and
// email quick-links. Rendered anchored above the itinerary action bar.
export default function SharePopover({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the field is selectable as a fallback */ }
  };

  const wa = `https://wa.me/?text=${encodeURIComponent(`My 10 days on Aruba — ${url}`)}`;
  const mail = `mailto:?subject=${encodeURIComponent('My Aruba itinerary')}&body=${encodeURIComponent(url)}`;

  return (
    <div
      role="dialog"
      aria-label="Share link"
      className="chunky"
      style={{
        position: 'absolute', bottom: 'calc(100% + 12px)', left: '50%', transform: 'translateX(-50%)',
        width: 320, maxWidth: '90vw', background: 'var(--cream)', color: 'var(--ink)',
        border: '2px solid var(--ink)', padding: 16, zIndex: 30, textAlign: 'left',
      }}
    >
      <button
        type="button" aria-label="Close" onClick={onClose}
        style={{ position: 'absolute', top: 6, right: 10, background: 'transparent', border: 'none', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: 'var(--ink)' }}
      >×</button>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Share this itinerary</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          readOnly value={url}
          onFocus={(e) => e.currentTarget.select()}
          style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: '2px solid var(--ink)', borderRadius: 6, fontSize: 13, background: '#fff' }}
        />
        <button type="button" className="btn-red" onClick={copy} style={{ padding: '8px 12px', fontSize: 13, whiteSpace: 'nowrap' }}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 14, fontWeight: 700 }}>
        <a href={wa} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>WhatsApp</a>
        <a href={mail} style={{ color: 'var(--ink)' }}>Email</a>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire share state + handler into Itinerary**

In `src/pages/Itinerary.tsx`, add imports:

```ts
import { createShare, loadShare } from '../lib/shares';
import { supabase } from '../lib/supabase';
import SharePopover from '../components/SharePopover';
```

(Merge the `loadShare` import from Task 5 into this single line.)

Add state near the other share state (after the read-only state from Task 5):

```ts
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareErr, setShareErr] = useState<string | null>(null);
```

Add the cache-invalidation effect + handler (after the read-only load effect):

```ts
  // Invalidate a cached link whenever the plan/answers/swap-memory change, so a
  // re-share after edits snapshots the new state and repeat clicks on an
  // unchanged plan don't create duplicate rows.
  useEffect(() => { setShareUrl(null); setSharePopoverOpen(false); }, [plan, answers, rejected, rejectedGroups]);

  const handleShare = async () => {
    if (shareBusy) return;
    let url = shareUrl;
    if (!url) {
      setShareBusy(true);
      setShareErr(null);
      const { id, error } = await createShare({ answers, plan, rejected, rejectedGroups });
      setShareBusy(false);
      if (!id) { setShareErr(error ?? 'Couldn’t create link — try again'); return; }
      url = `${window.location.origin}/i/${id}`;
      setShareUrl(url);
    }
    // Native OS share sheet on mobile; the desktop popover otherwise.
    if (navigator.share) {
      try { await navigator.share({ title: 'My 10 days on Aruba', url }); } catch { /* cancelled */ }
      return;
    }
    setSharePopoverOpen(true);
  };
```

- [ ] **Step 3: Wire the Share button in the action bar**

Replace the action-bar block (line 412–419) so the Share button calls `handleShare`, shows progress, disables when unconfigured, and hosts the popover + error. Wrap the bar in a relatively-positioned container so the popover anchors to it:

```tsx
              <div style={{ position: 'sticky', bottom: 16, marginTop: 32, display: 'flex', justifyContent: 'center', zIndex: 5 }}>
                <div style={{ position: 'relative' }}>
                  {sharePopoverOpen && shareUrl && (
                    <SharePopover url={shareUrl} onClose={() => setSharePopoverOpen(false)} />
                  )}
                  <div className="chunky itin-action-bar" style={{ padding: '14px 22px', display: 'inline-flex', alignItems: 'center', gap: 16, background: 'var(--ink)', color: 'var(--cream)' }}>
                    <button
                      className="btn-red"
                      onClick={handleShare}
                      disabled={!supabase || shareBusy}
                      title={!supabase ? 'Sharing is not configured yet' : undefined}
                      style={{ padding: '10px 18px', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: (!supabase || shareBusy) ? 0.6 : 1 }}
                    >
                      <Share size={14} /> {shareBusy ? 'Creating link…' : 'Share itinerary'}
                    </button>
                    <button onClick={scrollToSignIn} className="btn-ghost" style={{ color: 'var(--cream)', borderColor: 'var(--cream)', fontSize: 14, padding: '9px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Bookmark size={14} /> Save
                    </button>
                  </div>
                  {shareErr && (
                    <div role="alert" style={{ position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', background: 'var(--red)', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 13 }}>
                      {shareErr}
                    </div>
                  )}
                </div>
              </div>
```

This whole action bar already only renders in the editable view once Task 8 wraps it in `!readOnly`; until then it renders in both, which is acceptable between commits.

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Manual verification (desktop + round-trip)**

Run `npm run dev`, open `/itinerary`, click **Share itinerary**. Expected: brief "Creating link…", then the popover appears with a `/i/<id>` URL; **Copy link** flips to "Copied ✓". Copy the URL, open it in a new tab → the read-only shared view (Task 6) loads that plan. Edit the plan (swap a card), click Share again → a *new* id (cache invalidated). Confirm a fresh row each time only when the plan changed:

```bash
TOKEN="$(tr -d '[:space:]' < /root/.supabase_token)"; REF=mrfblzsihpecockhsnqe
printf '%s' '{"query":"select count(*) from public.shared_itineraries;"}' > /tmp/c.json
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data @/tmp/c.json
```

- [ ] **Step 6: Commit**

```bash
git add src/components/SharePopover.tsx src/pages/Itinerary.tsx
git commit -m "feat(share): wire Share button to create links + share popover"
```

**End of Phase 1 — shippable.** Push `main` to deploy (the migration from Task 1 is already applied). Verify live: create a link on 10daysonaruba.com, open it in a private window, confirm the read-only view.

---

## Phase 2 — Adopt a shared itinerary as your own

### Task 8: "Save a copy" CTA in read-only mode

**Files:**
- Modify: `src/pages/Itinerary.tsx`

**Interfaces:**
- Consumes: `signInWithGoogle`, `user` from `useAuth()`; `shareId`, `readOnly`.
- Produces: a `runAdopt(id: string)` function (defined in Task 9) and a read-only action bar with a single **Save a copy** button that either adopts immediately (already signed in) or stashes `adoptShare` + `justSignedIn` and starts Google sign-in.

- [ ] **Step 1: Pull `signInWithGoogle` from auth**

In `src/pages/Itinerary.tsx`, update the auth hook usage (line 62):

```ts
  const { user, signInWithGoogle } = useAuth();
```

- [ ] **Step 2: Add the adopt-start handler**

Add near the share handlers (this references `runAdopt`, added in Task 9):

```ts
  // "Save a copy": if already signed in, adopt now; otherwise stash the share id
  // (survives the OAuth redirect) and sign in — the return effect finishes it.
  const startAdopt = () => {
    if (!shareId) return;
    if (user) { void runAdopt(shareId); return; }
    try {
      localStorage.setItem('adoptShare', shareId);
      localStorage.setItem('justSignedIn', '1');
    } catch { /* ignore */ }
    void signInWithGoogle();
  };
```

- [ ] **Step 3: Render the read-only action bar**

Wrap the editable action bar (the whole sticky block from Task 7 Step 3) in `!readOnly`, and add a read-only variant alongside it. Change the opening of that sticky block to branch:

```tsx
              <div style={{ position: 'sticky', bottom: 16, marginTop: 32, display: 'flex', justifyContent: 'center', zIndex: 5 }}>
                {readOnly ? (
                  <div className="chunky itin-action-bar" style={{ padding: '14px 22px', display: 'inline-flex', alignItems: 'center', gap: 16, background: 'var(--ink)', color: 'var(--cream)' }}>
                    <span style={{ fontSize: 14 }}>Like this plan?</span>
                    <button className="btn-red" onClick={startAdopt} style={{ padding: '10px 18px', fontSize: 14 }}>Save a copy</button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    {/* ...the editable action bar from Task 7 Step 3... */}
                  </div>
                )}
              </div>
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: PASS (there will be a temporary type error only if `runAdopt` is not yet defined — implement Task 9 in the same working session before running the build, or stub `const runAdopt = async (_id: string) => {};` and replace it in Task 9).

- [ ] **Step 5: Commit** (after Task 9 completes, so `runAdopt` is real)

Deferred — commit at the end of Task 9.

---

### Task 9: Adopt-on-login handoff + conflict resolution

**Files:**
- Modify: `src/pages/Itinerary.tsx`
- Create: `src/components/AdoptConflictDialog.tsx`

**Interfaces:**
- Consumes: `loadShare`, `loadTrip`, `upsertTrip`, `user`, `TripState`.
- Produces: `runAdopt(id)` (adopts a snapshot, asking before replacing an existing trip); a return-from-login effect that consumes `localStorage.adoptShare`; an `AdoptConflictDialog` with Replace / Keep mine.

- [ ] **Step 1: Build the conflict dialog**

Create `src/components/AdoptConflictDialog.tsx`:

```tsx
// Shown when a visitor adopts a shared itinerary but already has a saved trip.
// No silent overwrite — they choose Replace or Keep mine.
export default function AdoptConflictDialog({ onReplace, onKeepMine }: { onReplace: () => void; onKeepMine: () => void }) {
  return (
    <div
      role="dialog" aria-modal="true" aria-label="Replace saved itinerary?"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div className="chunky" style={{ background: 'var(--cream)', color: 'var(--ink)', border: '2px solid var(--ink)', padding: 24, maxWidth: 420, width: '100%' }}>
        <h2 className="font-display" style={{ fontSize: 24, margin: '0 0 8px' }}>Replace your saved itinerary?</h2>
        <p style={{ margin: '0 0 20px', color: 'rgba(0,0,0,0.75)' }}>
          You already have a saved trip. Saving this shared itinerary will replace it.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onKeepMine} style={{ padding: '9px 16px', fontSize: 14 }}>Keep mine</button>
          <button className="btn-red" onClick={onReplace} style={{ padding: '9px 16px', fontSize: 14 }}>Replace</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add adopt state, `runAdopt`, and the return effect**

In `src/pages/Itinerary.tsx`, add imports:

```ts
import { loadTrip, upsertTrip } from '../lib/trips';   // (already imported — leave as-is)
import type { TripState } from '../lib/tripState';
import AdoptConflictDialog from '../components/AdoptConflictDialog';
```

Add state near the other share state:

```ts
  // When set, the snapshot is waiting on the user's Replace/Keep-mine decision.
  const [adoptConflict, setAdoptConflict] = useState<TripState | null>(null);
```

Add the adopt logic (replace the Task 8 stub `runAdopt` with this real version):

```ts
  // Load their own trip into the editable view (used by Keep-mine and no-op paths).
  const showOwnTrip = async (uid: string) => {
    const t = await loadTrip(uid);
    if (t) { setPlan(t.plan); setRejected(t.rejected); setRejectedGroups(t.rejectedGroups); setAnswers(t.answers); }
    setReadOnly(false);
    if (window.location.pathname !== '/itinerary') window.history.replaceState({}, '', '/itinerary');
  };

  // Move a shared snapshot into the editable view and land on /itinerary.
  const finishAdopt = (snap: TripState) => {
    setPlan(snap.plan); setRejected(snap.rejected); setRejectedGroups(snap.rejectedGroups); setAnswers(snap.answers);
    setReadOnly(false);
    if (window.location.pathname !== '/itinerary') window.history.replaceState({}, '', '/itinerary');
  };

  const runAdopt = async (id: string) => {
    if (!user) return;
    const snap = await loadShare(id);
    if (!snap) return;
    const existing = await loadTrip(user.id);
    if (existing) { setAdoptConflict(snap); return; }   // ask before replacing
    await upsertTrip(user.id, snap);
    finishAdopt(snap);
  };

  // On return from sign-in (session restored), consume the stashed share id once
  // — mirrors the justSignedIn pattern in SignedInToast.
  useEffect(() => {
    if (!user) return;
    let id: string | null = null;
    try { id = localStorage.getItem('adoptShare'); } catch { /* ignore */ }
    if (!id) return;
    try { localStorage.removeItem('adoptShare'); } catch { /* ignore */ }
    void runAdopt(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
```

- [ ] **Step 3: Render the conflict dialog + wire its actions**

Add just before the loading/not-found early returns (before `if (shareLoading)`), so it can appear over any state:

```tsx
  const adoptDialog = adoptConflict && user ? (
    <AdoptConflictDialog
      onReplace={async () => { const snap = adoptConflict; setAdoptConflict(null); await upsertTrip(user.id, snap); finishAdopt(snap); }}
      onKeepMine={() => { setAdoptConflict(null); void showOwnTrip(user.id); }}
    />
  ) : null;
```

Render `{adoptDialog}` at the top of each returned fragment — add it as the first element inside the main `return (<> … )` (line 342, right after `<>`), and also inside the `shareLoading` / `shareMissing` early returns is unnecessary (those never carry a conflict). Simplest: include it in the main return only, since a conflict is set after the snapshot has loaded (past `shareLoading`).

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS — all existing + new tests green.

- [ ] **Step 6: Manual verification (both branches)**

Run `npm run dev`.
- **Signed-in, no existing trip:** sign in first, ensure no saved trip (`delete from public.trips where user_id='<your id>';` if needed), open a share link, click **Save a copy** → lands on `/itinerary` editable, plan matches the share. Confirm a `trips` row now exists.
- **Signed-in, existing trip:** save a trip, then open a share link, **Save a copy** → the conflict dialog. **Keep mine** → your own trip shows, unchanged. Re-open the share, **Save a copy** → **Replace** → your trip is now the shared plan.
- **Signed-out:** open a share link, **Save a copy** → Google sign-in → on return you land on `/itinerary` with the adopted plan (dialog appears first only if you already had a trip).

- [ ] **Step 7: Commit**

```bash
git add src/pages/Itinerary.tsx src/components/AdoptConflictDialog.tsx
git commit -m "feat(share): adopt a shared itinerary as your own trip"
```

**End of Phase 2.** Push `main` to deploy.

---

## Self-Review Notes (traceability to spec)

- **DB-backed short link `/i/<id>`, 8-char base62** → Task 1 (table), Task 3 (`randomSlug`, `createShare`).
- **Shared serialization reused with trips** → Task 2 (`tripState.ts`).
- **Routing recognizes `/i/<id>` and surfaces `shareId`** → Task 4.
- **Read-only load; generate + hydrate suppressed; autosave gated** → Task 5.
- **Read-only rendering (no drag/swap/add/remove/rename), banner** → Task 6.
- **Creator UX: create/reuse link, mobile native share, desktop popover, cache-invalidate on edit** → Task 7.
- **Recipient action bar "Save a copy"** → Task 8.
- **Adopt-on-login handoff via localStorage; conflict = ask before replacing** → Task 9.
- **Error handling:** `createShare` failure → inline error (Task 7); `loadShare` null → not-found panel (Task 5); `supabase` null → Share disabled (Task 7).
- **Out of scope (not built):** view counts, expiring/revocable links, distinct read-only theme.
