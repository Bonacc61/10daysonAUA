# Data durability — keeping existing users' information across post-launch feature work

**Date:** 2026-08-16
**Status:** Design approved, not yet implemented.
**Scope:** V1 (browser stores) and V2 (database backups). V3 and V4 deliberately deferred —
see "Known risks not addressed here".

## The problem

After launch, every feature that touches stored state is a chance to silently destroy a
traveller's work. Two stores hold that work and neither has a net under it.

| # | Vector | State today | Blast radius |
|---|---|---|---|
| V1 | localStorage shape drift | No version stamp on any key. `App.tsx:99` reads answers as `{ ...DEFAULT_ANSWERS, ...JSON.parse(raw) }`, so a renamed or retyped field is not migrated and not detected — it becomes the default. | Silent reset, unrecoverable, fires on **every** feature that touches `Answers`. Hits anonymous travellers, who are the majority: `canSeeItinerary = qDone \|\| !!user`, so the whole planner works without an account. |
| V2 | Postgres has no backups | Supabase **Free tier**: no automatic backups, no point-in-time recovery. | One bad migration or one mistyped `delete` is permanent, across all accounts. |

Both are in scope. The decision to include V1 was explicit: anonymous travellers'
localStorage *is* their itinerary, and no backup anywhere can bring it back.

## Two things already work, and are not part of this

Recorded so a future reader does not "fix" them:

- **Group entries self-heal across catalog drift.** `resolveSlotEntry`
  (`src/data/activitySource.ts:323`) resolves by item id first, falls back to the stored
  group, and picks another item if the product is gone. The comment there records a measured
  incident — a regroup re-faced 195 of 333 stored entries — which is why the stored
  `groupId` is advisory rather than authoritative.
- **`trips` migrations already reason about client coupling.**
  `20260814120000_trips_multi.sql` states plainly that the old client breaks the moment it
  lands. That reasoning is correct and this design promotes it from a one-off comment into a
  required section (below).

---

## V1 — Versioned browser stores

### Keys in scope

Three: `10doa:answers`, `10doa:starred`, `10doa:booked`.

### Keys deliberately excluded

- **`10doa:analytics-consent` — must never be wrapped.** `src/main.tsx:10` reads it as a
  bare `=== 'true'` at boot, before any module could run a migration. An envelope would
  break the consent check. Excluded on GDPR grounds, permanently, not as a scoping shortcut.
- **`qDone`, `10doa:trip-id`, `aruba.session`** — pointers and flags, not the traveller's
  information. Losing `10doa:trip-id` reopens the newest trip; losing `qDone` re-locks the
  questionnaire behind a form the traveller already filled in. Annoying, not data loss.
  Versioning them would cost a migration each, forever, to protect nothing.

### Mechanism

One module, `src/lib/persist.ts`, roughly 40 lines:

```ts
// on disk: { v: 2, d: <payload> }
readStore<T>(key: string, currentVersion: number, migrations: Migration[], fallback: T): T
writeStore<T>(key: string, currentVersion: number, value: T): void
```

`migrations[n]` takes the v`n` shape and returns the v`n+1` shape. `readStore` runs the
ladder from whatever version it finds up to `currentVersion`, then writes the result back so
the upgrade happens once per browser.

**v0 is detected structurally, not by a one-time flag.** A stored value with no `v`/`d`
envelope is read as the legacy shape — always, forever, not just during an adoption window.
This is the property that makes the whole thing safe, and it is worth being explicit about
why:

> A tab left open across a deploy runs the old bundle, which writes the bare legacy shape
> back over a v1 envelope. The next read from the new bundle sees no envelope, treats the
> value as v0, migrates it, and the traveller loses nothing. The scheme degrades
> symmetrically in both directions instead of having a one-way cliff.

### The v0 → v1 step is the dangerous one

It is the identity migration — it only wraps what is already on disk. If it is wrong, the
change intended to protect travellers' data is the change that destroys it. It therefore
gets the heaviest test: a fixture captured from a real, fully filled-in `10doa:answers`,
asserting every field survives the wrap.

### Tests

Node environment, no jsdom — this is pure logic. Following the existing convention in
`src/lib/*.test.ts`.

1. **Golden fixture per key** holding today's real production shape, with a test asserting a
   read returns the same information.
2. **One test per migration step**, built from a real v(n−1) fixture, asserting the
   *information* survives — not merely that the call does not throw.
3. **Garbage input** returns the fallback rather than crashing the app at boot. All three
   current readers already swallow exceptions; `persist.ts` must keep that behaviour.
4. **Forward compatibility**: an unknown extra field in a stored value is preserved, not
   stripped.

Per the CLAUDE.md rule about tests that cannot fail, each migration test is checked by
deleting its migration and confirming the test goes red.

### The ongoing rule

Added to `.claude/CLAUDE.md`, about three lines: changing the shape of a versioned key means
bumping its version and adding a migration plus a fixture test. That is the entire ongoing
ceremony, and it is what makes this survive being forgotten about in four months.

### Files touched

| File | Change |
|---|---|
| `src/lib/persist.ts` | New. The reader, writer, and migration runner. |
| `src/lib/persist.test.ts` + fixtures | New. |
| `src/App.tsx` | The answers read/write at lines 96–129 go through `persist`. |
| `src/lib/shortlist.ts` | `read`/`write` go through `persist`. |
| `src/lib/booked.ts` | `read`/`write` go through `persist`. |
| `.claude/CLAUDE.md` | The rule. |

---

## V2 — Database backups

### The job

New `.github/workflows/db-backup.yml`. Daily cron plus `workflow_dispatch`, built on the
same pattern as `catalog-drift.yml`: silent on success, **fails loudly on error**, and
GitHub's email on a failed scheduled run is the notification. No bot to build.

Steps: `supabase db dump` → `gpg --symmetric --cipher-algo AES256` → `lftp` upload to
TransIP → prune anything older than 14 days.

Runs on GitHub Actions rather than an EU machine. The runner is US-based, so the dump
transits a US processor before landing on EU storage — a documented transfer (GitHub's DPA,
EU-US Data Privacy Framework) accepted in exchange for a backup that cannot silently stop
running. Moving it to an EU-only host is a reasonable later change; it belongs in
`docs/ROADMAP.md`, not here.

### Three things that must not be got wrong

1. **The dump must not land under the web root.** `SFTP_PATH` is the directory `dist/`
   mirrors into and it is served publicly. A database dump written there is every user's
   data on a guessable URL. It needs a separate `SFTP_BACKUP_PATH` outside the document
   root, and **this must be verified with an actual HTTP request to the guessed URL before
   the first real dump is uploaded** — with a harmless placeholder file, not with a dump.
2. **Encryption is not optional.** The passphrase lives only in GitHub secrets and in a
   password manager. Losing it makes every backup landfill, which is a second reason the
   restore drill matters.
3. **A backup that has not been restored is not a backup.**

### Acceptance criterion: the restore drill

Restore a dump into a scratch Supabase project and compare row counts against production.
This is also how we learn what `supabase db dump` actually includes — in particular whether
`auth.users` comes along, which decides whether a restore returns working accounts or
orphaned `trips` rows referencing users who no longer exist. This design deliberately does
not assert what the tool includes; the drill settles it, and the answer gets written back
into this file.

Run once as the acceptance criterion for this work, then quarterly. A recurring calendar
reminder, not automation — automating it needs a permanent second Supabase project and is
not worth it at this size.

### GDPR consequences

The dump is personal data, so:

- **14-day backup retention must be stated in `src/pages/Privacy.tsx`**, in the same way
  `contact_submissions`' 12-month purge already is.
- **Account deletion needs a sentence.** `account-delete` removes an account from the live
  database immediately and from backups within 14 days. That is lawful and standard practice
  — but it must be written down rather than discovered by someone exercising erasure rights.
- The US transfer for the runner joins the existing Anthropic/OpenAI sub-processor
  disclosures.

### Secrets required (must be added by hand)

`SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, `SFTP_BACKUP_PATH`.

---

## Known risks not addressed here

Deferred by explicit decision, recorded so they are not mistaken for oversights:

- **V3 — an unresolvable `kind: 'activity'` entry blanks its card.**
  `resolveSlotEntry` returns `null` for an activity id that has left the catalog, and
  `Itinerary.tsx:1126` renders `null`. The card silently disappears from the day. The data
  is *not* destroyed — the entry stays in the saved `plan` and reappears if the id returns —
  but the traveller sees an unexplained gap. A fix would render "no longer available" with a
  swap offer.
- **V4 — no gate between push and production.** `deploy.yml` builds and mirrors to TransIP
  on every push to `main`. A bad shape change reaches every browser at once. A fix would run
  the contract tests in `deploy.yml` and refuse to publish when a storage shape changed
  without a matching migration.

## Sequencing

V1 first: it fires on every feature. V2 second: it fires rarely and catastrophically.
