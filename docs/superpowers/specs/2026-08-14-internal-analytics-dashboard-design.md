# Internal analytics — cookieless traffic and outbound-click measurement

**Date:** 2026-08-14
**Status:** Design approved, not built.
**Closes:** `docs/ROADMAP.md` item 3 ("Vendor dashboard"), reinterpreted — see "Scope".
**Related:** roadmap item 2 (shortlist/explore tracking) is superseded by the milestone beacon here.

## Why

To sign a partner you have to answer one question: *how many people did you send
us?* Today that number does not exist. Every "Book now" is a plain
`<a href target="_blank">` with no handler, and Viator returns no signal on what
converts. The site has been running since May with no record of a single
outbound click.

The dashboard is the small half of this project. The instrumentation is the
large half.

## Scope

**In:** a cookieless measurement pipe, a `web_events` table, and one internal
page at `/stats` that only you can open.

**Out, deliberately:**

- **Partner logins.** Roadmap item 3 said "vendor dashboard". Decided
  2026-08-14: internal only. No partner accounts, no per-partner RLS, no invite
  flow. You read the numbers and quote them.
- **Bookings and revenue.** Viator gives no return signal — this is recorded in
  `.claude/CLAUDE.md` and has not changed. The dashboard measures clicks *out*,
  never bookings. See "What this cannot tell a partner".
- **Real-time.** Nightly-fresh is fine for a pitch.

## What exists today, and why none of it is enough

| Source | What it holds | Why it can't carry a pitch |
|---|---|---|
| PostHog | 5 events: `contact_message_sent`, `itinerary_shared` ×2, `itinerary_saved` ×2 | Consent-gated. Counts only travellers who accepted cookies. |
| `feedback_events` | swap / add / remove / move / rename | Consent-gated since 2026-08-13, and it measures itinerary *editing* — no commercial signal. |
| Outbound clicks | — | Nothing. Not collected anywhere. |
| nginx logs on TransIP | Raw requests | Deploy is SFTP-only; no access path, no parsing, and every static asset is a "hit". |
| Cloudflare | — | Not applicable. DNS is at TransIP (`ns1.transip.nl`), origin is bare nginx at `85.10.159.81`. There is no edge to borrow counting from. |

## The central design decision: no device storage

Everything follows from this. The beacon writes **nothing** to the traveller's
device — no cookie, no localStorage, no session id. The client sends no
identifier at all; identity is derived server-side and discarded.

Two consequences, both intended:

1. **The cookie-banner rule does not apply.** ePrivacy governs storing or
   reading data on a device. Nothing is stored, so the beacon runs on
   legitimate interest and counts **100% of traffic** — not the consented
   fraction. This is what makes the numbers defensible to a partner, and it is
   the entire reason for the design.
2. **`feedback_events` and PostHog stay exactly as they are.** They keep their
   consent gate. Do not fold them into this pipe and do not relax their gate;
   they write `aruba.session` to the device, which is precisely what the
   2026-08-13 decision found needs consent.

### Visitor identity

```
visitor_day_hash = sha256("v:" + YYYY-MM-DD + ":" + ip + ":" + ua + ":" + ANALYTICS_SALT)
```

The IP comes from the **last** `x-forwarded-for` entry, not the first — the
leftmost value is whatever the client sent, so keying on it hands out a fresh
identity per spoofed IP. This is not a new insight; it is already the rule in
`supabase/functions/itinerary-edit/index.ts:94-107`, comment and all. Reuse that
function's shape rather than writing a second one.

The date is *inside* the digest, so the salt rotates itself. There is no
rotation job, no old-salt storage, and no way to link a visitor across midnight
UTC. `ANALYTICS_SALT` is a Supabase secret, set the same way `RATE_LIMIT_SALT`
was.

**This means "unique visitors" is a DAILY figure and nothing else.** Monthly
uniques are not computable, by construction. Summing 30 daily numbers is not a
monthly unique count and must never be presented as one — a traveller who
visits five days is five. The dashboard labels this on the tile itself, not in a
footnote, because this is the exact figure someone will quote in a pitch.

### The right to object

Legitimate interest carries GDPR Art. 21. The opt-out is a `10doa:no-analytics`
key set from the Privacy Policy page, which the beacon checks before firing.
Writing that key *is* device storage, but storing a user's own opt-out
preference is strictly necessary storage and needs no consent — the same
exemption every cookie banner relies on to remember "no".

## Architecture

```
Browser ── sendBeacon ──► collect (edge fn) ──► web_events   (service role only)
                             │                      │
                             ├─ bot UA filter        └─ purge at 12 months (pg_cron)
                             ├─ hash ip+ua+date
                             ├─ ip → country via ip_country (never stored)
                             └─ normalise path, referrer host

Browser (signed in) ──► stats (edge fn) ──► aggregates ──► /stats page
                          └─ JWT uid ∈ ADMIN_UIDS, else 403
```

### `collect`

Accepts `POST` only; everything else 405. Body is small and fixed:

```ts
{ name: 'pageview' | 'outbound' | 'milestone',
  path?: string, ref?: string, product?: string, milestone?: string }
```

The client sends no IP, no UA, no id — those are read from headers server-side.
Order of operations matters:

1. **Bot filter first.** User-Agent matched against a crawler pattern list;
   empty UA is also dropped. Rejected requests return 204 and write no row. A
   pitch number that counts crawlers is worse than no pitch number. The filter
   is imperfect and the dashboard says so: "bots excluded by user-agent".
2. **Opt-out** — the client omits the beacon entirely if the key is set; the
   function needs no knowledge of it.
3. Derive hash, country, device class.
4. Insert.

Failures are silent. This must never affect a traveller's page.

### Path and referrer normalisation

Both are places where free text could sneak into a database, which the project
rule forbids outright.

- **Query strings are dropped entirely**, before anything else. A search query
  in a URL is a traveller's typed words.
- **Dynamic segments collapse**: `/i/aB3xQ` → `/i/:slug`. Storing the raw share
  slug would tie a pageview to a specific itinerary.
- Paths not matching the known route set (`PATH_TO_PAGE` in `src/App.tsx`, plus
  `/i/:slug`) are stored as `other`. An allowlist, not a sanitiser.
- **Referrer is reduced to its host.** `reddit.com`, not the thread URL.
- Post-level attribution comes from a `?ref=` param *you* control, allowlisted
  to `[a-z0-9-]{1,32}` and stored as `campaign`. That gives you "this Reddit
  post sent 400 people" without storing arbitrary third-party URLs.

`referrer_host` and `campaign` are stamped on the arriving **pageview** only —
later events in the visit carry neither. They are still reachable: within a
single UTC day, `visitor_day_hash` joins a visit's pageview to its outbound
clicks, so "visitors who arrived from Reddit clicked out N times **that day**" is
computable. Across days it is not, by construction. Any cross-day claim about a
campaign's clicks is unsupported by this schema and must not be made.

### Country

There is no country header. Verified 2026-08-14 against two sources: the Edge
Functions architecture docs document none, and the Supabase maintainers' thread
on client IP (`supabase/discussions/7884`) mentions only `x-forwarded-for` and
directs people to a third-party geo API. Supabase does use the IP for regional
routing, but does not surface it.

Sending every visitor's IP to a US geo API would reintroduce the exact
sub-processor problem this design exists to avoid. So: an `ip_country` table of
CIDR ranges in your own EU Postgres, queried with the native `inet` containment
operator, returning a two-letter code. **Only the code is stored; the IP is
never persisted.**

**Country must be resolved at write time or it is lost forever.** Because the IP
is deliberately never stored, rows cannot be backfilled. Shipping v1 without
geography means the pre-launch months have no geography, permanently. This is
the one metric that cannot be deferred.

Two things to verify before writing the migration, not to assume:

- that GiST-on-`inet` is available on the live Postgres version;
- the row count and **licence** of the chosen free dataset (DB-IP Lite,
  IP2Location LITE and GeoLite2 have materially different attribution and
  redistribution terms — pick on the licence, not the row count).

Refresh is a hand step every month or two, and nothing will check it. Record it
in the roadmap the same way the start-times snapshot is recorded, or it will
rot silently.

## Data model

`web_events` — RLS enabled, **no policies at all**. Not even insert. Written
only by `collect` with the service role, read only by `stats`. This is the
established pattern for `item_embeddings`, `query_embeddings`, `edit_requests`
and `catalog_cache`.

| Column | Notes |
|---|---|
| `id`, `created_at` | |
| `name` | `pageview` / `outbound` / `milestone` |
| `visitor_day_hash` | daily, unlinkable across days |
| `path` | normalised, allowlisted |
| `referrer_host` | host only |
| `campaign` | from `?ref=`, allowlisted |
| `country` | 2 chars |
| `device` | mobile / tablet / desktop, coarse UA classification — three buckets, not a UA-parsing library |
| `product_code` | outbound only — Viator product code |
| `destination_host` | outbound only |
| `milestone` | milestone only |

Explicit columns, no `jsonb` — matching `feedback_events`. A loose bag invites
exactly the free text the rules forbid.

**Retention:** raw rows purge at 12 months via `pg_cron`, matching
`contact_submissions`.

**Deferred, with a deadline:** a nightly rollup into `web_daily` (date × dims ×
counts, no visitor hash, therefore anonymous and keepable indefinitely). Not in
v1 — nothing is lost in the first 12 months. **It must exist before 2027-08** or
the first year of pitch history purges itself. Put this in the roadmap when v1
ships, not later.

## The outbound-click chokepoint

Eight files render affiliate links today: `Explore.tsx`, `SurpriseMe.tsx`,
`Dashboard.tsx`, `Map.tsx`, `GroupCard.tsx`, `ItineraryCard.tsx`,
`OtherSuggestionsList.tsx`, `CardBack.tsx`. Adding a handler to each guarantees
the ninth gets forgotten, and a forgotten one does not fail loudly — it silently
undercounts a partner's number, which is worse than not measuring at all.

So: **one `<OutboundLink>` component**, and every affiliate link routes through
it. It owns two invariants that are currently held only by convention:

- the `pid`/`mcid` params survive (project invariant, currently spread across
  `viatorLink` and `productUrlFor`);
- the click is counted.

It fires via `navigator.sendBeacon`, which is built to survive the navigation.
It must **not** `preventDefault` and re-navigate on a timer — that breaks popup
blocking, delays the traveller, and loses the click when the beacon is slow.
The link proceeds normally; the beacon is fire-and-forget.

This is a targeted improvement to existing code in service of the current goal,
not a refactor. Nothing outside affiliate-link rendering changes.

## The funnel

Milestone beacons at three points: questionnaire started → itinerary generated →
itinerary saved or shared. The funnel's first step reads `pageview` rows and its
last step reads `outbound` rows; neither needs a milestone of its own. Enough for
"our visitors don't browse, they plan a trip", and no more. This supersedes roadmap item 2, which proposed the same
signal through the consent-gated PostHog pipe — the cookieless pipe measures all
of it instead.

## `/stats`

A new `PageId` in `src/App.tsx`. Sign-in required, and the `stats` edge function
returns data only when the caller's JWT uid is in an `ADMIN_UIDS` secret —
**uid read from the token, never from the body**, exactly as `account-delete`
does it. No service-role key ever reaches the browser. A 403 for everyone else,
including signed-in travellers.

`/dashboard` is already the traveller's saved-trips page. `/stats` is a separate
route; do not overload it.

Content: traffic over time, daily uniques (labelled), top paths, referrer and
campaign mix, country mix, the four-step funnel, and outbound clicks grouped by
product and by partner. Charts go through the `dataviz` skill when built.

### What this cannot tell a partner

Write this on the page, not just in this document. The dashboard shows clicks
*sent*. It cannot show bookings, revenue, or conversion rate, because Viator
returns nothing. A dashboard that implies otherwise will be caught by the first
partner who checks their own numbers, and that costs more than the deal.

## Testing

Unit (`vitest`, offline):

- path normalisation — query strings dropped, `/i/:slug` collapsed, unknown
  paths become `other`;
- referrer reduced to host; `campaign` allowlist rejects junk;
- bot UA filter, both directions;
- visitor hash differs across a date boundary with the same IP and UA;
- opt-out key suppresses the beacon.

Component (jsdom, opted in per file with the `// @vitest-environment jsdom`
docblock):

- `OutboundLink` renders an `href` with `pid` and `mcid` intact;
- it fires exactly one beacon per click and does not cancel the navigation.

Every test gets the mutation check the project requires: break the code, confirm
the test fails, put it back. Several tests here have passed against deliberately
broken code.

## Risks

- **Ad blockers block `*.supabase.co`.** Some share of traffic will not report,
  so this undercounts — less than a consent gate would, but not zero. Measurable
  after launch by comparing beacon pageviews against a known-good sample. The
  fix, if it matters, is proxying `/collect` through nginx on TransIP as a
  first-party path. Not in v1.
- **`sendBeacon` on iOS Safari** during cross-origin navigation — verify on a
  real device before trusting the outbound number.
- **Country dataset drift** — see above; a hand refresh nothing checks.
- **GiST-on-`inet`** — verify before writing the migration.

## Legal checklist before this goes live

1. Privacy Policy (`src/pages/Privacy.tsx`) gains an entry: what is collected,
   legitimate interest as the basis, no device storage, 12-month retention, and
   the opt-out. Required by the project rule that any new collection carries a
   documented basis.
2. `ANALYTICS_SALT` set as a Supabase secret.
3. Confirm no typed traveller text can reach `web_events` — the query-string
   drop is the load-bearing part.
4. `/code-review` before the push, per the ship gate. This touches data
   collection, so `/code-review ultra` is the right call rather than the
   standard pass.

## Build order

1. Migration: `web_events`, `ip_country`, retention cron.
2. `collect` + its unit tests.
3. `<OutboundLink>` + component tests; route all eight files through it.
4. Milestone beacons.
5. `stats` edge function + `/stats` page.
6. Privacy Policy entry, secret, `/code-review ultra`, push.

Steps 1–4 are the ones that matter. If the dashboard slips, the data is still
accumulating and nothing is lost — which is the argument for doing them in this
order.
