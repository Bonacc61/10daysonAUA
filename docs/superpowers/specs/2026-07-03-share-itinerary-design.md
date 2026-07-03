# Share Itinerary — design

**Date:** 2026-07-03
**Status:** Approved, ready for planning

## Problem

The itinerary page has a "Share itinerary" button that does nothing (no `onClick`).
We want it to (1) match the visual language of the neighbouring "Save" button, and
(2) produce a short, shareable link that opens a **read-only** view of the plan for the
recipient, with a path to turn it into their own **editable** copy once they log in.

## Groundwork already done

- Added a Feather-style `Share` icon to `src/components/Icons.tsx` (three connected
  dots), matching the existing icon set.
- The "Share itinerary" button in `src/pages/Itinerary.tsx` now renders `<Share size={14} />`
  before its label, mirroring the `<Bookmark />` treatment on the Save button.

## Key facts that shape the design

- An itinerary is fully reconstructible from a small `TripState`: `{ answers, plan,
  rejected, rejectedGroups }`. The `plan` (`PlannedDay[]`) stores only **ids**
  (`SlotEntry`), not full card data — cards are rebuilt from the catalog on render.
- `src/lib/trips.ts` already persists this to a `trips` table keyed on `user_id` (RLS,
  one row per user) and hydrates via `setPlan(t.plan)`. `toRow`/`fromRow` do the
  serialization.
- `public/.htaccess` does a catch-all SPA fallback (`RewriteRule . /index.html [L]`),
  so any path (e.g. `/i/<id>`) serves the app with no hosting change.
- Auth uses a `justSignedIn` localStorage flag set immediately before the Google/OTP
  redirect (`src/lib/auth.tsx`), consumed once on return by `SignedInToast`. The
  redirect always lands on `POST_SIGNIN_PATH = '/itinerary'`.
- Anonymous visitors can already view and edit the itinerary; "Save" prompts sign-in.

## Decisions

- **DB-backed short link** (not URL-encoded blob): the user wants a short URL.
- **Link format:** `https://10daysonaruba.com/i/<id>`, `<id>` = 8-char base62 slug.
- **Recipient lands read-only**, with a "Save a copy" CTA that adopts the plan into an
  editable trip after login.
- **Adopt conflict:** if the recipient already has a saved trip, **ask before replacing**
  (Replace / Keep mine). No silent data loss.

## Architecture — three units

### 1. Data layer

**New table `shared_itineraries`** (immutable snapshot; same shape as `trips` minus the
user key):

| column          | type          | notes                                  |
|-----------------|---------------|----------------------------------------|
| `id`            | `text` PK     | 8-char base62 slug, client-generated   |
| `answers`       | `jsonb`       |                                        |
| `plan`          | `jsonb`       | id-only `PlannedDay[]`                  |
| `rejected`      | `text[]`      |                                        |
| `rejected_groups` | `text[]`    |                                        |
| `created_by`    | `uuid` null   | creator's user id if signed in, else null |
| `created_at`    | `timestamptz` | default `now()`                        |

**RLS:** `SELECT using (true)` (anyone with the link can read); `INSERT with check
(true)` (anon creators allowed — they can already build itineraries); no UPDATE/DELETE
(snapshots are immutable). Migration lives under `supabase/`.

**New `src/lib/shares.ts`:**
- `createShare(state: TripState, userId: string | null): Promise<{ id: string | null; error: string | null }>`
  — generate slug (crypto-random base62), insert, retry once on unique-violation, return id.
- `loadShare(id: string): Promise<TripState | null>` — fetch by id, map via the shared
  row shape.
- Reuse/extract the `toRow`/`fromRow` serialization from `lib/trips.ts` so trips and
  shares stay in sync (factor a `stateToColumns`/`columnsToState` helper the two libs share).

### 2. Creator UX — clicking "Share itinerary"

`handleShare` in `Itinerary.tsx`:
1. If a link was already created for the current plan (cached in state), reuse it.
   Otherwise show a brief "Creating link…" state on the button and call `createShare`.
2. Build `${window.location.origin}/i/${id}`.
3. **Mobile** (`navigator.share` present): call `navigator.share({ title, url })` — native
   OS share sheet.
4. **Desktop:** open a compact popover (`components/SharePopover.tsx`) anchored to the
   button: read-only link field + "Copy link" button that flips to "Copied ✓"
   (`navigator.clipboard.writeText`), plus WhatsApp (`https://wa.me/?text=`) and email
   (`mailto:?body=`) quick-links.

The cached link is invalidated whenever `plan`/`answers`/`rejected` change (a `useEffect`
resets it to `null`), so editing then re-sharing produces a fresh snapshot rather than an
outdated one, and repeat clicks on an unchanged plan don't create duplicate rows.

### 3. Recipient UX — opening `/i/<id>`

**Routing:** `pageFromUrl` in `App.tsx` recognizes a `/i/<id>` pathname → page
`'itinerary'` and surfaces the parsed `shareId` (via a `shareIdFromUrl()` helper). App
passes `shareId` down to `Itinerary`.

**Read-only load:** on mount with a `shareId`, `Itinerary` calls `loadShare(id)`, seeds
`answers`/`plan`/`rejected`/`rejectedGroups` from it, and sets `readOnly = true`. While a
share is active:
- The normal generate-from-answers path and the user-trip hydration are **suppressed** — a
  shared link always shows the shared snapshot, even for signed-in visitors.
- Autosave to `trips` is **gated off** (`!readOnly`), belt-and-suspenders with edits being
  disabled.

**Read-only rendering:** a `readOnly` prop threads into `ItineraryDay`, hiding/disabling
drag handles, swap, add, remove, rename, and suggest-lunch. "Flip to see why" stays (it's
informative and harmless). The `DndContext` is rendered without active sensors (or replaced
by a plain list) in read-only mode.

**Banner:** top-of-main notice — "You're viewing a shared Aruba itinerary — sign in to
save your own editable copy."

**Action bar:** in read-only mode the sticky bottom bar replaces Share/Save with a single
primary CTA **"Save a copy"**.

**Adopt-on-login handoff** (mirrors the `justSignedIn` pattern):
- "Save a copy" stashes `adoptShare=<id>` in localStorage (and `justSignedIn=1`), then runs
  the existing `signInWithGoogle()`.
- On return (authenticated, at `/itinerary`), an effect reads `adoptShare`:
  1. `loadShare(id)` to re-fetch the snapshot (URL/state were lost across the OAuth redirect).
  2. `loadTrip(user.id)` to check for an existing trip.
     - **Existing trip found →** show a confirm dialog: "Replace your saved itinerary with
       this one?" **[Replace]** upserts the snapshot as their trip; **[Keep mine]** discards
       the adoption and loads their own trip normally.
     - **No existing trip →** `upsertTrip(user.id, snapshot)` silently.
  3. Clear `adoptShare`, strip any share params, leave the user editing their own trip.
     Confirmation via the existing "Trip saved" toast.

## Error handling

- `createShare` failure (offline / Supabase paused): button returns to idle and surfaces a
  brief inline error toast ("Couldn't create link — try again"). No partial state.
- `loadShare` returns null (bad/expired id): show a small empty state — "This shared
  itinerary couldn't be found" with a link to build your own — rather than a broken page.
- `supabase` null (unconfigured): share button is disabled with a tooltip; `/i/<id>` shows
  the not-found state.

## Testing

- `lib/shares.ts`: slug generation shape/uniqueness-retry; `createShare`→`loadShare`
  round-trips a `TripState` faithfully (answers, id-only plan, rejected sets).
- Serialization: shared `stateToColumns`/`columnsToState` helper round-trips (covers both
  trips and shares).
- Routing: `shareIdFromUrl` parses `/i/<id>` and ignores other paths.
- Read-only mode: edit affordances absent; autosave not called; adopt CTA present.
- Adopt flow (logic-level): existing-trip → confirm path; no-trip → silent upsert; flag
  cleared exactly once.

## Out of scope (possible later)

- Share analytics / view counts (the `created_by`/`created_at` columns leave room).
- Expiring or revocable links.
- A dedicated visually-distinct read-only theme beyond the banner + disabled controls.
