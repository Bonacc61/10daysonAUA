# Internal Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure all site traffic and every outbound click to a partner, without writing anything to a traveller's device, and surface it on an internal-only `/stats` page.

**Architecture:** A `collect` edge function receives small beacons from the browser, derives visitor identity server-side from `sha256(date + ip + ua + salt)` and throws the raw values away, resolves country against a CIDR table in our own EU Postgres, and writes to `web_events` — a table with RLS on and no policies at all, reachable only by the service role. A single `<OutboundLink>` component is the one place affiliate clicks are counted. A `stats` edge function gated on a uid allowlist feeds the page.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres + Deno edge functions), vitest (+ jsdom per file), pg_cron.

**Spec:** `docs/superpowers/specs/2026-08-14-internal-analytics-dashboard-design.md`

## Global Constraints

- **Nothing is written to the traveller's device** except the opt-out key `10doa:no-analytics`. No cookie, no session id. The client sends no identifier.
- **The client never transmits a query string.** Strip it before sending; the server re-validates. Query strings can contain typed words.
- **Never log text a traveller typed** — not to console, not into an error body, not into a column.
- **Affiliate params `pid=P00302487`, `mcid=42383` and `medium=link` must survive** every URL that passes through `<OutboundLink>`.
- **RLS stays on.** `web_events` gets no policies whatsoever. `SERVICE_ROLE_KEY` never appears in client code.
- **JWT verification stays ON** for both new functions — do not add a `[functions]` block to `supabase/config.toml`. Calls carry the public anon key.
- Beacons use `fetch(..., { keepalive: true })`, never `navigator.sendBeacon` (cannot set the `apikey` header).
- **Every test gets a mutation check**: break the code, confirm the test fails, restore. Several tests in this repo once passed against deliberately broken code.
- `npm run build` typechecks `src` only (`tsconfig.app.json` includes `["src"]`), so files under `supabase/functions/` are not typechecked by the build — same as every existing edge function.
- Don't push. The ship gate (`/code-review ultra`) and deploy are Task 13, after a human decision.

---

### Task 1: `web_events` schema and retention

**Files:**
- Create: `supabase/migrations/20260815090000_web_events.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.web_events` with columns `id, created_at, name, visitor_day_hash, path, referrer_host, campaign, country, device, product_code, destination_host, milestone`.

- [ ] **Step 1: Write the migration**

```sql
-- Cookieless web analytics. One row per pageview / outbound click / milestone.
--
-- No device storage is involved anywhere in this pipe: the browser sends no
-- identifier at all, and `visitor_day_hash` is derived server-side from
-- ip + user-agent + THE DATE + a server salt, then the raw values are dropped.
-- Because the date is inside the digest the salt rotates itself, so a visitor
-- cannot be linked across midnight UTC. That is deliberate and load-bearing:
-- "unique visitors" is a DAILY figure and monthly uniques are not computable.
-- Summing daily numbers is not a monthly count.
--
-- RLS is on and there are NO POLICIES. Not even insert. Only `collect` (service
-- role) writes and only `stats` (service role) reads — the same shape as
-- item_embeddings, query_embeddings, edit_requests and catalog_cache.

create table if not exists public.web_events (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  name             text not null,      -- pageview | outbound | milestone
  visitor_day_hash text not null,
  path             text,               -- normalised + allowlisted, never a raw URL
  referrer_host    text,               -- host only, never a full third-party URL
  campaign         text,               -- from our own ?ref=, allowlisted [a-z0-9-]{1,32}
  country          char(2),
  device           text,               -- mobile | tablet | desktop
  product_code     text,               -- outbound only
  destination_host text,               -- outbound only
  milestone        text                -- milestone only
);

create index if not exists web_events_created_idx  on public.web_events (created_at);
create index if not exists web_events_name_idx     on public.web_events (name, created_at);
create index if not exists web_events_visitor_idx  on public.web_events (visitor_day_hash);
create index if not exists web_events_product_idx  on public.web_events (product_code)
  where product_code is not null;

alter table public.web_events enable row level security;
-- Intentionally no policies. RLS with zero policies denies anon and
-- authenticated entirely while leaving the service role unaffected.

-- Retention: 12 months, matching contact_submissions.
select cron.schedule(
  'purge-old-web-events',
  '25 3 * * *',
  $$ delete from public.web_events where created_at < now() - interval '12 months' $$
);
```

- [ ] **Step 2: Apply it**

Run: `supabase db push`

Note: `db push` refuses to run while hand-applied migrations sit unrecorded in CLI history — this bit the semantic-search launch. If it complains, reconcile history first; do not hand-apply.

- [ ] **Step 3: Verify the table denies the anon key**

Run:
```bash
source .env.production
curl -s -o /dev/null -w '%{http_code}\n' \
  "$VITE_SUPABASE_URL/rest/v1/web_events?select=id&limit=1" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
```
Expected: `200` with body `[]` is **a failure** — check the body is an RLS error or the row set is empty *because no policy grants select*. The decisive check is the insert:
```bash
curl -s -w '\n%{http_code}\n' -X POST "$VITE_SUPABASE_URL/rest/v1/web_events" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"pageview","visitor_day_hash":"x"}'
```
Expected: `401` or `403` with a row-level-security message. If this returns `201`, stop — a policy leaked in.

- [ ] **Step 4: Verify the cron job registered**

Run: `supabase db push` already applied it; confirm with a query against `cron.job` for `purge-old-web-events`.
Expected: exactly one row.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260815090000_web_events.sql
git commit -m "feat(analytics): web_events, closed to everything but the service role"
```

---

### Task 2: `ip_country` — country resolution that never stores an IP

**Files:**
- Create: `supabase/migrations/20260815091000_ip_country.sql`
- Create: `tools/load-ip-country.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces: SQL function `public.country_for_ip(ip inet) returns char(2)`, called by `collect` in Task 4.

**Dataset decision — make this before writing code.** Recommended: **DB-IP IP-to-Country Lite**, which is CC-BY-4.0 (attribution only, no share-alike). IP2Location LITE is CC-BY-SA-4.0 and its share-alike term is a worse fit; GeoLite2 needs a MaxMind account and EULA acceptance. **Verify the licence on the download page at the time you fetch it** — these terms change, and the plan is not authority on them. Whichever you pick, its attribution line goes in the Privacy Policy in Task 11.

- [ ] **Step 1: Verify GiST-on-`inet` exists before designing around it**

Run this against the live database:
```sql
create temp table _gist_probe (net inet);
create index on _gist_probe using gist (net inet_ops);
```
Expected: succeeds. If it fails with "no operator class", fall back to the btree range form in Step 2's alternative and note it in the migration comment.

- [ ] **Step 2: Write the migration**

```sql
-- IP → country, resolved at WRITE TIME and never stored as an IP.
--
-- This exists because Supabase edge functions expose no country header —
-- verified 2026-08-14 against the Edge Functions architecture docs and
-- supabase/discussions/7884, which mention only x-forwarded-for. The obvious
-- alternative, a third-party geo API, would send every visitor's IP to a US
-- sub-processor and defeat the point of a cookieless design. So the lookup
-- happens inside our own EU Postgres and only the two-letter code survives.
--
-- Country CANNOT be backfilled: web_events never holds an IP by design. If
-- this table is empty when collect goes live, that traffic has no geography
-- forever.

create table if not exists public.ip_country (
  net     inet primary key,
  country char(2) not null
);

create index if not exists ip_country_net_idx on public.ip_country using gist (net inet_ops);

alter table public.ip_country enable row level security;
-- No policies: read by the service role only, same as web_events.

-- `>>=` is "contains or equals". order by masklen desc picks the most specific
-- matching network when ranges nest.
create or replace function public.country_for_ip(ip inet)
returns char(2)
language sql
stable
security definer
set search_path = public
as $$
  select country from public.ip_country
   where net >>= ip
   order by masklen(net) desc
   limit 1
$$;
```

- [ ] **Step 3: Write the loader**

```js
// tools/load-ip-country.cjs
// Loads a CIDR→country CSV into public.ip_country. Run by hand; nothing checks
// that it has been re-run, so record the refresh date in docs/ROADMAP.md the
// way the start-times snapshot is recorded, or it will rot silently.
//
// Usage: SUPABASE_DB_URL=... node tools/load-ip-country.cjs path/to/dbip-country-lite.csv
const fs = require('fs');
const { Client } = require('pg');

async function main() {
  const [, , csvPath] = process.argv;
  if (!csvPath) { console.error('usage: load-ip-country.cjs <csv>'); process.exit(1); }
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await client.connect();
  await client.query('begin');
  await client.query('delete from public.ip_country');

  const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
  let n = 0;
  for (const line of lines) {
    const [start, end, country] = line.trim().split(',');
    if (!start || !country || country.length !== 2) continue;
    // DB-IP Lite ships start/end ranges, not CIDR. Postgres has no range→cidr
    // builtin, so expand with the well-known algorithm in SQL via inet arithmetic.
    await client.query(
      'insert into public.ip_country (net, country) select n, $3 from unnest($1::inet[]) n on conflict (net) do nothing',
      [rangeToCidrs(start, end), null, country],
    );
    n++;
  }
  await client.query('commit');
  console.log(`loaded ${n} ranges`);
  await client.end();
}
```

**Note for the implementer:** `rangeToCidrs(start, end)` is the one genuinely fiddly piece — converting a start/end IP range into a minimal set of CIDR blocks. Do not hand-roll it. Use the `cidr-tools` npm package (`cidrFromRange`) or download the CIDR-formatted variant of the dataset if the provider offers one, which removes the problem entirely. **Prefer the CIDR variant.** If you use a library, add it to `devDependencies` only — this is a `tools/` script, never bundled into the app.

- [ ] **Step 4: Load the data and verify a known IP**

Run: `SUPABASE_DB_URL=... node tools/load-ip-country.cjs <csv>`

Then verify against IPs whose country you can confirm independently:
```sql
select public.country_for_ip('8.8.8.8'::inet);      -- expect US
select public.country_for_ip('145.100.0.1'::inet);  -- expect NL (SURFnet)
select count(*) from public.ip_country;
```
Expected: correct codes, and a row count in the hundreds of thousands. Record the actual count and the load date — Task 12 puts it in the roadmap.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260815091000_ip_country.sql tools/load-ip-country.cjs package.json
git commit -m "feat(analytics): resolve country in our own Postgres, never at a US geo API"
```

---

### Task 3: Normalisation helpers — the layer that keeps typed words out

**Files:**
- Create: `supabase/functions/collect/normalise.ts`
- Test: `supabase/functions/collect/normalise.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalisePath(raw: string | undefined): string`
  - `referrerHost(raw: string | undefined, selfHost: string): string | null`
  - `campaignFrom(raw: string | undefined): string | null`
  - `isBot(ua: string | null): boolean`
  - `deviceClass(ua: string): 'mobile' | 'tablet' | 'desktop'`
  - `visitorDayHash(ip: string, ua: string, salt: string, date: string): Promise<string>`

This module is **pure and dependency-free on purpose**: no `Deno.*`, no `esm.sh` imports. That is what lets vitest import it from `supabase/functions/` even though the function itself is Deno. Vitest's default include pattern already reaches this path and `tsc -p tsconfig.app.json` ignores it, so nothing else needs configuring. Keep it that way — the moment this file imports Deno globals, its tests stop running.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  normalisePath, referrerHost, campaignFrom, isBot, deviceClass, visitorDayHash,
} from './normalise.ts';

describe('normalisePath', () => {
  it('drops the query string entirely', () => {
    // Load-bearing: a query string can hold words a traveller typed.
    expect(normalisePath('/explore?q=snorkel%20with%20turtles')).toBe('/explore');
  });

  it('collapses a share slug so a pageview cannot name an itinerary', () => {
    expect(normalisePath('/i/aB3xQ')).toBe('/i/:slug');
  });

  it('sends anything off the allowlist to "other" rather than storing it', () => {
    expect(normalisePath('/wp-admin/../../etc/passwd')).toBe('other');
    expect(normalisePath(undefined)).toBe('other');
  });

  it('keeps the known routes', () => {
    expect(normalisePath('/')).toBe('/');
    expect(normalisePath('/itinerary')).toBe('/itinerary');
    expect(normalisePath('/explore/')).toBe('/explore');
  });
});

describe('referrerHost', () => {
  it('reduces a full URL to its host', () => {
    expect(referrerHost('https://www.reddit.com/r/aruba/comments/abc/xyz/', '10daysonaruba.com'))
      .toBe('reddit.com');
  });

  it('returns null for our own pages, so internal navigation is not a referral', () => {
    expect(referrerHost('https://10daysonaruba.com/explore', '10daysonaruba.com')).toBeNull();
  });

  it('returns null for junk rather than throwing', () => {
    expect(referrerHost('not a url', '10daysonaruba.com')).toBeNull();
    expect(referrerHost(undefined, '10daysonaruba.com')).toBeNull();
  });
});

describe('campaignFrom', () => {
  it('accepts our own slug format', () => {
    expect(campaignFrom('reddit-aruba-aug')).toBe('reddit-aruba-aug');
  });

  it('rejects anything else, so ?ref= cannot become free text', () => {
    expect(campaignFrom('Reddit Aruba')).toBeNull();
    expect(campaignFrom('a'.repeat(33))).toBeNull();
    expect(campaignFrom('<script>')).toBeNull();
  });
});

describe('isBot', () => {
  it('rejects crawlers', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBot('curl/8.4.0')).toBe(true);
  });

  it('rejects an empty or absurdly short user agent', () => {
    expect(isBot(null)).toBe(true);
    expect(isBot('')).toBe(true);
  });

  it('accepts a real browser', () => {
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe(false);
  });
});

describe('deviceClass', () => {
  it('calls an iPad a tablet even though its UA says Mobile', () => {
    // iPad Safari sends "Mobile/15E148". Checking mobile first would misclassify
    // every iPad on the site, so the tablet test has to run first.
    expect(deviceClass('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('tablet');
  });

  it('classifies a phone and a laptop', () => {
    expect(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(deviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126')).toBe('desktop');
  });
});

describe('visitorDayHash', () => {
  it('gives the same visitor the same hash within a day', async () => {
    const a = await visitorDayHash('1.2.3.4', 'UA', 'salt', '2026-08-15');
    const b = await visitorDayHash('1.2.3.4', 'UA', 'salt', '2026-08-15');
    expect(a).toBe(b);
  });

  it('gives the same visitor a DIFFERENT hash the next day', async () => {
    // This is the privacy property, not an implementation detail: it is what
    // makes cross-day tracking impossible and monthly uniques uncomputable.
    const d1 = await visitorDayHash('1.2.3.4', 'UA', 'salt', '2026-08-15');
    const d2 = await visitorDayHash('1.2.3.4', 'UA', 'salt', '2026-08-16');
    expect(d1).not.toBe(d2);
  });

  it('does not contain the ip', async () => {
    const h = await visitorDayHash('1.2.3.4', 'UA', 'salt', '2026-08-15');
    expect(h).not.toContain('1.2.3.4');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/collect/normalise.test.ts`
Expected: FAIL — cannot resolve `./normalise.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// Pure normalisation for the collect beacon. NO Deno globals and no remote
// imports — that is what keeps this file importable by vitest, which is the
// only reason any of it is tested. See the test file before adding an import.

// The allowlist is PATH_TO_PAGE in src/App.tsx plus '/' and '/stats'. Keep the
// two in step: a new route that is missing here silently records as 'other'.
const KNOWN_PATHS = [
  '/', '/explore', '/itinerary', '/map', '/questionnaire',
  '/privacy', '/terms', '/surprise', '/dashboard', '/preview', '/stats',
];

export function normalisePath(raw: string | undefined): string {
  if (!raw) return 'other';
  // Query and fragment go FIRST and unconditionally. Everything after this
  // point is an allowlist, but this line is what guarantees a typed search
  // query can never reach the database even if the allowlist is wrong.
  const bare = raw.split('?')[0].split('#')[0];
  const path = bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
  if (KNOWN_PATHS.includes(path)) return path;
  if (/^\/i\/[A-Za-z0-9]{1,32}$/.test(path)) return '/i/:slug';
  return 'other';
}

export function referrerHost(raw: string | undefined, selfHost: string): string | null {
  if (!raw) return null;
  const bare = (h: string) => h.replace(/^www\./, '').toLowerCase();
  try {
    const host = bare(new URL(raw).hostname);
    if (!host || host === bare(selfHost)) return null;
    return host.slice(0, 100);
  } catch {
    return null;
  }
}

export function campaignFrom(raw: string | undefined): string | null {
  if (!raw) return null;
  return /^[a-z0-9-]{1,32}$/.test(raw) ? raw : null;
}

const BOT = /bot|crawl|spider|slurp|headless|python-requests|curl|wget|httpclient|java\/|go-http|scrapy|phantomjs|lighthouse|uptime|pingdom|semrush|ahrefs|petalbot|facebookexternalhit|embedly|preview|monitoring/i;

export function isBot(ua: string | null): boolean {
  // No UA at all is a bot for our purposes. A real browser always sends one,
  // and a pitch number that counts crawlers is worse than no pitch number.
  if (!ua || ua.trim().length < 10) return true;
  return BOT.test(ua);
}

export function deviceClass(ua: string): 'mobile' | 'tablet' | 'desktop' {
  // Tablet BEFORE mobile, deliberately: iPad Safari's UA contains "Mobile",
  // so the obvious ordering classifies every iPad as a phone.
  if (/ipad|tablet|playbook|silk|android(?!.*mobi)/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

export async function visitorDayHash(
  ip: string, ua: string, salt: string, date: string,
): Promise<string> {
  // The DATE is inside the digest, so the salt rotates itself: no rotation job,
  // no old-salt storage, and no way to link a visitor across midnight UTC.
  // 'v:' is a domain separator so this can never collide with the ip: hashes
  // itinerary-edit and search write into edit_requests.
  const bytes = new TextEncoder().encode(`v:${date}:${ip}:${ua}:${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/collect/normalise.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Mutation-check the two that matter most**

Change `normalisePath` to return `bare` without splitting on `?`. Run the tests.
Expected: the "drops the query string entirely" test FAILS. Restore it.

Change `visitorDayHash` to drop `${date}` from the digest input. Run the tests.
Expected: the "different hash the next day" test FAILS. Restore it.

If either still passes, the test is not testing what it claims and must be fixed before moving on.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pre-existing tests still pass, plus 15 new.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/collect/normalise.ts supabase/functions/collect/normalise.test.ts
git commit -m "feat(analytics): normalisation that cannot let a typed query reach the database"
```

---

### Task 4: The `collect` edge function

**Files:**
- Create: `supabase/functions/collect/index.ts`

**Interfaces:**
- Consumes: `normalise.ts` (Task 3), `country_for_ip` (Task 2), `web_events` (Task 1), `../_shared/cors.ts`.
- Produces: `POST <VITE_COLLECT_FN_URL>` accepting `{ name, path?, ref?, campaign?, product?, destination?, milestone? }`, always answering `204`.

- [ ] **Step 1: Write the function**

```ts
// collect — cookieless traffic and outbound-click measurement.
//
// The browser sends NO identifier: no cookie, no session id, no localStorage.
// Identity is derived here from ip + user-agent + the date + a server salt and
// the raw values are discarded. Because nothing is stored on the device, this
// sits outside the cookie-banner rule and therefore counts ALL traffic rather
// than the consented fraction — which is the entire point. PostHog and
// feedback_events keep their consent gate; do not fold them into this pipe.
//
// It always answers 204, including for bots, junk and its own failures. A
// measurement endpoint must never tell a caller what it did with the request,
// and must never affect the page it is measuring.
//
// JWT verification stays ON (anon key required), so this is not an open relay.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  normalisePath, referrerHost, campaignFrom, isBot, deviceClass, visitorDayHash,
} from './normalise.ts';

const SELF_HOST = '10daysonaruba.com';
const NAMES = ['pageview', 'outbound', 'milestone'];
const MILESTONES = ['questionnaire_started', 'itinerary_generated', 'itinerary_kept'];

const noContent = () => new Response(null, { status: 204, headers: corsHeaders });

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

// The LAST X-Forwarded-For entry, not the first: the leftmost value is whatever
// the client sent, so keying on it hands out a fresh identity per spoofed IP.
// Same rule and same reason as itinerary-edit and search.
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')?.split(',') ?? [];
  return xff[xff.length - 1]?.trim() || 'unknown';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });

  try {
    const ua = req.headers.get('user-agent');
    // Bot filter FIRST — before parsing, before hashing, before any query.
    if (isBot(ua)) return noContent();

    const body = await req.json().catch(() => null);
    if (!body || !NAMES.includes(body.name)) return noContent();

    const salt = Deno.env.get('ANALYTICS_SALT');
    if (!salt) {
      // Fail CLOSED and loudly in the log, but silently to the caller. Hashing
      // with an empty salt would write a rainbow-tableable digest of every
      // visitor's IP, which is worse than losing the data.
      console.error('[collect] ANALYTICS_SALT is not set — dropping event');
      return noContent();
    }

    const ip = clientIp(req);
    const today = new Date().toISOString().slice(0, 10);  // UTC
    const db = admin();

    // Country is resolved NOW or never: the IP is not stored, so no row can be
    // backfilled later. A lookup failure costs this row its geography and
    // nothing else.
    const { data: cc } = await db.rpc('country_for_ip', { ip }).maybeSingle?.() ?? { data: null };

    const row: Record<string, unknown> = {
      name: body.name,
      visitor_day_hash: await visitorDayHash(ip, ua!, salt, today),
      path: normalisePath(body.path),
      referrer_host: referrerHost(body.ref, SELF_HOST),
      campaign: campaignFrom(body.campaign),
      country: typeof cc === 'string' ? cc : null,
      device: deviceClass(ua!),
    };

    if (body.name === 'outbound') {
      // Product codes are Viator's own tokens (e.g. 8936P1) — allowlisted to
      // that shape so this column cannot become a free-text field.
      row.product_code = /^[A-Za-z0-9]{1,24}$/.test(body.product ?? '') ? body.product : null;
      row.destination_host = referrerHost(body.destination, SELF_HOST);
    }
    if (body.name === 'milestone') {
      row.milestone = MILESTONES.includes(body.milestone) ? body.milestone : null;
      if (!row.milestone) return noContent();
    }

    const { error } = await db.from('web_events').insert(row);
    // Log the failure REASON only, never the payload — the payload is the
    // request body and this function must not echo a caller's input into a log.
    if (error) console.warn(`[collect] insert failed: ${String(error.message ?? '').slice(0, 120)}`);
  } catch (e) {
    console.warn(`[collect] ${String((e as Error)?.message ?? '').slice(0, 120)}`);
  }

  return noContent();
});
```

**Note for the implementer:** the `db.rpc(...).maybeSingle?.()` line is defensive shorthand that will not typecheck cleanly. Replace it with the plain form and confirm the return shape against supabase-js v2 when you write it:

```ts
const { data: cc } = await db.rpc('country_for_ip', { ip });
```
`rpc` on a scalar-returning SQL function returns the scalar directly in `data`. Verify this with one real call before trusting it — if it comes back as an array or an object, unwrap accordingly and leave a comment saying which.

- [ ] **Step 2: Set the secret**

Run: `supabase secrets set ANALYTICS_SALT="$(openssl rand -hex 32)"`

- [ ] **Step 3: Deploy and verify each guard against the deployed function**

Run: `supabase functions deploy collect`

Then check every guard, the way `account-delete` was verified:
```bash
source .env.production
URL="$VITE_SUPABASE_URL/functions/v1/collect"
H=(-H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" -H 'Content-Type: application/json')

curl -s -o /dev/null -w 'GET       %{http_code}\n' "${H[@]}" "$URL"
curl -s -o /dev/null -w 'no-auth   %{http_code}\n' -X POST "$URL" -d '{"name":"pageview"}'
curl -s -o /dev/null -w 'bot UA    %{http_code}\n' -X POST "${H[@]}" -A 'Googlebot/2.1' "$URL" -d '{"name":"pageview","path":"/"}'
curl -s -o /dev/null -w 'good      %{http_code}\n' -X POST "${H[@]}" -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126' "$URL" -d '{"name":"pageview","path":"/explore?q=secret"}'
```
Expected: `405`, `401`, `204`, `204`.

- [ ] **Step 4: Verify what actually landed**

Query `web_events` with the service role. Expected: **exactly one row** — the bot request wrote nothing. On that row confirm:
- `path` is `/explore`, **not** `/explore?q=secret`;
- `visitor_day_hash` is 64 hex characters and contains no dotted quad;
- `country` is populated (if null, `ip_country` did not load — go back to Task 2);
- `device` is `desktop`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/collect/index.ts
git commit -m "feat(analytics): collect — counts everyone, identifies no one"
```

---

### Task 5: The client beacon

**Files:**
- Create: `src/lib/beacon.ts`
- Test: `src/lib/beacon.test.ts`
- Modify: `.env.production` (add `VITE_COLLECT_FN_URL`)

**Interfaces:**
- Consumes: `collect` (Task 4).
- Produces:
  - `OPT_OUT_KEY = '10doa:no-analytics'`
  - `analyticsOptedOut(): boolean`
  - `beacon(body: BeaconBody): void`
  - `type BeaconBody = { name: 'pageview' | 'outbound' | 'milestone'; path?: string; ref?: string; campaign?: string; product?: string; destination?: string; milestone?: string }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV = { VITE_COLLECT_FN_URL: 'https://fn.test/collect', VITE_SUPABASE_ANON_KEY: 'anon-key' };

describe('beacon', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubGlobal('localStorage', {
      store: {} as Record<string, string>,
      getItem(k: string) { return this.store[k] ?? null; },
      setItem(k: string, v: string) { this.store[k] = v; },
    });
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    vi.resetModules();
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('sends the event with keepalive, not sendBeacon', async () => {
    // sendBeacon cannot set the apikey header Supabase's JWT gate requires.
    const { beacon } = await import('./beacon');
    beacon({ name: 'pageview', path: '/explore' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENV.VITE_COLLECT_FN_URL);
    expect(init.keepalive).toBe(true);
    expect(init.headers.apikey).toBe('anon-key');
  });

  it('never transmits a query string', async () => {
    // Defence in depth: collect strips it too, but a typed query should not
    // leave the browser in the first place.
    const { beacon } = await import('./beacon');
    beacon({ name: 'pageview', path: '/explore?q=snorkel%20with%20turtles' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.path).toBe('/explore');
    expect(JSON.stringify(body)).not.toContain('snorkel');
  });

  it('sends nothing at all when the traveller has opted out', async () => {
    localStorage.setItem('10doa:no-analytics', 'true');
    const { beacon } = await import('./beacon');
    beacon({ name: 'pageview', path: '/' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when the endpoint is not configured', async () => {
    vi.stubEnv('VITE_COLLECT_FN_URL', '');
    vi.resetModules();
    const { beacon } = await import('./beacon');
    beacon({ name: 'pageview', path: '/' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a network failure without throwing', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    const { beacon } = await import('./beacon');
    expect(() => beacon({ name: 'pageview', path: '/' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/beacon.test.ts`
Expected: FAIL — cannot resolve `./beacon`.

- [ ] **Step 3: Write the implementation**

```ts
// Cookieless measurement beacon. The counterpart to supabase/functions/collect.
//
// This writes NOTHING to the device and sends NO identifier — no session id, no
// cookie. That is what puts it outside the cookie-banner rule and lets it count
// all traffic rather than the consented fraction. It is therefore deliberately
// NOT gated on 10doa:analytics-consent, unlike src/lib/analytics.ts and
// src/data/feedback.ts, both of which write aruba.session to the device and
// must stay gated. Do not "fix" this by adding the consent check.
//
// The one thing it does read is the opt-out key, which exists because
// legitimate interest carries a right to object (GDPR Art. 21). Storing a
// user's own opt-out is strictly necessary storage and needs no consent — the
// same exemption a cookie banner uses to remember "no".
const FN_URL = import.meta.env.VITE_COLLECT_FN_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const OPT_OUT_KEY = '10doa:no-analytics';

export type BeaconBody = {
  name: 'pageview' | 'outbound' | 'milestone';
  path?: string;
  ref?: string;
  campaign?: string;
  product?: string;
  destination?: string;
  milestone?: string;
};

export function analyticsOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function beacon(body: BeaconBody): void {
  if (!FN_URL || !ANON) return;
  if (analyticsOptedOut()) return;
  try {
    // Strip query and fragment BEFORE they leave the browser. collect strips
    // them again server-side; this is the belt to that pair of braces.
    const path = (body.path ?? window.location.pathname).split('?')[0].split('#')[0];
    fetch(FN_URL, {
      method: 'POST',
      // keepalive, not navigator.sendBeacon: sendBeacon cannot set headers and
      // Supabase requires the anon key. keepalive survives unload and takes them.
      keepalive: true,
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, path }),
    }).catch(() => { /* fire-and-forget */ });
  } catch { /* never let measurement break a page */ }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/beacon.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation-check the opt-out**

Delete the `if (analyticsOptedOut()) return;` line. Run the tests.
Expected: the opt-out test FAILS. Restore it.

- [ ] **Step 6: Add the endpoint to `.env.production`**

Append, with the comment — `.env.production` is tracked in git and is the source of truth for what is on:

```
# Cookieless analytics endpoint. beacon() is inert without it, which is how this
# stays off until the Privacy Policy entry ships. NOT a secret — the anon key is
# already public and this is just a function URL.
VITE_COLLECT_FN_URL=https://<project-ref>.supabase.co/functions/v1/collect
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/beacon.ts src/lib/beacon.test.ts .env.production
git commit -m "feat(analytics): client beacon that stores nothing on the device"
```

---

### Task 6: Fire a pageview on every route change

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `beacon` from `src/lib/beacon.ts` (Task 5).
- Produces: one `pageview` event per route change, `?ref=` captured on entry.

- [ ] **Step 1: Capture the campaign once, at boot**

In `src/App.tsx`, above the component:

```ts
// The campaign is only on the URL of the FIRST page a visitor lands on, so it
// is read once at module load and held for the session's pageviews. It is not
// persisted — there is no session storage in this pipe by design, so it lasts
// exactly as long as the tab.
const ENTRY_CAMPAIGN = new URLSearchParams(window.location.search).get('ref') ?? undefined;
const ENTRY_REFERRER = document.referrer || undefined;
```

- [ ] **Step 2: Fire on every page change**

Inside the `App` component, alongside the existing `page` state:

```ts
useEffect(() => {
  beacon({
    name: 'pageview',
    path: window.location.pathname,
    ref: ENTRY_REFERRER,
    campaign: ENTRY_CAMPAIGN,
  });
}, [page]);
```

Add the import: `import { beacon } from './lib/beacon';`

- [ ] **Step 3: Verify in a real build**

Run: `npm run build && npm run preview`

Never `npm run dev` for this — Vite's dev server carries path-traversal advisories and must not be exposed.

Open the preview, click through Landing → Explore → Itinerary with the network tab open.
Expected: exactly one `collect` request per navigation, each `204`, each body carrying a bare path with no query string.

- [ ] **Step 4: Verify the rows**

Query `web_events` for today. Expected: one row per navigation, `country` populated, `referrer_host` null (you arrived directly).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(analytics): count a pageview on every route change"
```

---

### Task 7: `<OutboundLink>` — the one place a click is counted

**Files:**
- Create: `src/components/OutboundLink.tsx`
- Test: `src/components/OutboundLink.dom.test.tsx`

**Interfaces:**
- Consumes: `beacon` (Task 5), `viatorProductCode` from `src/data/exploreItems.ts:416`.
- Produces: `<OutboundLink href className children aria-label? />` — a drop-in replacement for `<a href target="_blank" rel="noopener noreferrer">`.

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OutboundLink from './OutboundLink';

const beaconMock = vi.fn();
vi.mock('../lib/beacon', () => ({ beacon: (...a: unknown[]) => beaconMock(...a) }));

const URL_WITH_AFFILIATE =
  'https://www.viator.com/tours/Aruba/Arusun-Catamaran/d28-8936P1?pid=P00302487&mcid=42383&medium=link';

describe('OutboundLink', () => {
  beforeEach(() => beaconMock.mockClear());

  it('leaves the affiliate params on the href untouched', () => {
    // The project invariant: pid, mcid and medium must survive any rewrite.
    // This component is now the single chokepoint every affiliate link passes
    // through, so it is the right place to guard it.
    render(<OutboundLink href={URL_WITH_AFFILIATE}>Book now</OutboundLink>);
    const href = screen.getByRole('link').getAttribute('href')!;
    expect(href).toContain('pid=P00302487');
    expect(href).toContain('mcid=42383');
    expect(href).toContain('medium=link');
  });

  it('opens in a new tab without leaking the opener', () => {
    render(<OutboundLink href={URL_WITH_AFFILIATE}>Book now</OutboundLink>);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('counts exactly one click, with the product code derived from the href', async () => {
    render(<OutboundLink href={URL_WITH_AFFILIATE}>Book now</OutboundLink>);
    await userEvent.click(screen.getByRole('link'));
    expect(beaconMock).toHaveBeenCalledTimes(1);
    expect(beaconMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'outbound',
      product: '8936P1',
      destination: 'https://www.viator.com',
    }));
  });

  it('does not cancel the navigation', async () => {
    // Regression guard: preventDefault + a timed re-navigate would trip popup
    // blockers and lose the click whenever the beacon is slow.
    const onClick = vi.fn();
    render(<OutboundLink href={URL_WITH_AFFILIATE} onClick={onClick}>Book now</OutboundLink>);
    const a = screen.getByRole('link');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
```

**Note for the implementer:** confirm `@testing-library/user-event` and `@testing-library/jest-dom` are already devDependencies — the existing `*.dom.test.tsx` files use them. If `userEvent` is absent, use `fireEvent.click` and adjust the test rather than adding a dependency.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/OutboundLink.dom.test.tsx`
Expected: FAIL — cannot resolve `./OutboundLink`.

- [ ] **Step 3: Write the implementation**

```tsx
import type { ReactNode, MouseEvent } from 'react';
import { beacon } from '../lib/beacon';
import { viatorProductCode } from '../data/exploreItems';

/**
 * Every outbound affiliate link on the site goes through here.
 *
 * Eight files rendered these as bare anchors before this existed
 * (Explore, SurpriseMe, Dashboard, Map, GroupCard, ItineraryCard,
 * OtherSuggestionsList, CardBack). Patching each of them would have worked
 * exactly until someone added a ninth — and a missed one does not fail loudly,
 * it silently undercounts a partner's number, which is worse than not
 * measuring at all. So this is a chokepoint, not a helper.
 *
 * It owns two invariants: the affiliate params survive, and the click is
 * counted. Both are guarded by tests.
 */
type Props = {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
  'aria-label'?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
};

function originOf(url: string): string | undefined {
  try { return new URL(url).origin; } catch { return undefined; }
}

export default function OutboundLink({ href, children, onClick, ...rest }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
      onClick={(e) => {
        // Fire-and-forget, and NO preventDefault. The link navigates normally;
        // because target is _blank the page does not even unload, so there is
        // nothing to race.
        beacon({
          name: 'outbound',
          product: viatorProductCode(href) || undefined,
          destination: originOf(href),
        });
        onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/OutboundLink.dom.test.tsx`
Expected: PASS, 4 tests.

**If the product-code test fails**, read `viatorProductCode` at `src/data/exploreItems.ts:416` and match the test to what it actually returns for this URL shape rather than changing the function — it is used elsewhere.

- [ ] **Step 5: Mutation-check the chokepoint**

Delete the `beacon({...})` call. Run the tests.
Expected: the "counts exactly one click" test FAILS. Restore it.

- [ ] **Step 6: Commit**

```bash
git add src/components/OutboundLink.tsx src/components/OutboundLink.dom.test.tsx
git commit -m "feat(analytics): OutboundLink, the single place an affiliate click is counted"
```

---

### Task 8: Route all eight files through `<OutboundLink>`

**Files:**
- Modify: `src/components/GroupCard.tsx:353`, `:136`, `:166`
- Modify: `src/components/ItineraryCard.tsx:146`, `:194`
- Modify: `src/components/OtherSuggestionsList.tsx:98`
- Modify: `src/components/CardBack.tsx` (its outbound anchor)
- Modify: `src/pages/Explore.tsx:309`, `:344`
- Modify: `src/pages/SurpriseMe.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Map.tsx` (their rendered anchors)

**Interfaces:**
- Consumes: `<OutboundLink>` (Task 7).
- Produces: zero remaining bare `<a>` elements pointing at a Viator URL.

This is mechanical, and the substitution is identical everywhere:

```tsx
// before
<a href={bookUrl} target="_blank" rel="noopener noreferrer" className="itin-book-btn">Book now ↗</a>

// after
<OutboundLink href={bookUrl} className="itin-book-btn">Book now ↗</OutboundLink>
```

Add `import OutboundLink from './OutboundLink';` (components) or `'../components/OutboundLink'` (pages) to each file.

- [ ] **Step 1: Find every one of them**

Run:
```bash
grep -rn "target=\"_blank\"" src --include=*.tsx | grep -v OutboundLink
```
Work the list. Convert **only** anchors whose href is a Viator/affiliate URL. Leave the WhatsApp link in `SharePopover.tsx:46` and any external link in `Privacy.tsx` / `Terms.tsx` alone — those are not partner traffic and counting them would pollute the number.

- [ ] **Step 2: Convert each anchor**

Do them one file at a time, running `npm run typecheck` after each. Do not batch all eight and hope.

- [ ] **Step 3: Verify none were missed**

Run:
```bash
grep -rn "target=\"_blank\"" src --include=*.tsx | grep -iv "outboundlink\|sharepopover\|Privacy.tsx\|Terms.tsx\|Footer.tsx"
```
Expected: **no output.** Any line here is an uncounted affiliate click.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. The existing `honestRatings.test.ts` asserts `pid=P00302487` survives — it must still pass.

- [ ] **Step 5: Verify in a real build**

Run: `npm run build && npm run preview`

Click a real "Book now" on an itinerary card.
Expected: the Viator page opens in a new tab with the affiliate params intact, **and** one `collect` request fires with `name: "outbound"` and the right `product_code`.

- [ ] **Step 6: Commit**

```bash
git add src/components src/pages
git commit -m "feat(analytics): every affiliate link now goes through the chokepoint"
```

---

### Task 9: Milestone beacons

**Files:**
- Modify: `src/pages/Questionnaire.tsx` (on first answer)
- Modify: `src/pages/Itinerary.tsx` (on plan generated, and beside the existing `capture('itinerary_saved')` at `:209`)

**Interfaces:**
- Consumes: `beacon` (Task 5).
- Produces: `milestone` events named `questionnaire_started`, `itinerary_generated`, `itinerary_kept` — the exact three in `MILESTONES` in `collect/index.ts`; any other name is dropped server-side.

The funnel's first step reads `pageview` rows and its last step reads `outbound` rows, so only these three need a beacon.

- [ ] **Step 1: `questionnaire_started`**

In `src/pages/Questionnaire.tsx`, where the first answer is recorded, fire once per session:

```ts
const started = useRef(false);
// ...at the point an answer is first set:
if (!started.current) {
  started.current = true;
  beacon({ name: 'milestone', milestone: 'questionnaire_started' });
}
```

- [ ] **Step 2: `itinerary_generated`**

In `src/pages/Itinerary.tsx`, where a plan is first produced for a set of answers:

```ts
beacon({ name: 'milestone', milestone: 'itinerary_generated' });
```

Guard it so a re-render or a swap does not re-fire it — the same `useRef` shape as Step 1.

- [ ] **Step 3: `itinerary_kept`**

In `src/pages/Itinerary.tsx:209`, beside the existing `capture('itinerary_saved', { trigger: 'auto' })`:

```ts
beacon({ name: 'milestone', milestone: 'itinerary_kept' });
```

Leave the `capture()` call in place. PostHog keeps its consent-gated event; this is the ungated count of the same moment, and the two will legitimately disagree. That difference is itself the measure of how much the consent gate costs.

- [ ] **Step 4: Verify the funnel end to end**

Run: `npm run build && npm run preview`

Walk the whole path: land → answer the questionnaire → generate → click a Book now.
Expected in `web_events` for your visitor hash: pageviews, then the three milestones in order, then one outbound. Each milestone exactly once.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Questionnaire.tsx src/pages/Itinerary.tsx
git commit -m "feat(analytics): three milestones, so the funnel is more than pageviews"
```

---

### Task 10: The `stats` edge function

**Files:**
- Create: `supabase/functions/stats/index.ts`
- Create: `supabase/migrations/20260815092000_stats_rollups.sql`

**Interfaces:**
- Consumes: `web_events` (Task 1).
- Produces: `GET <VITE_STATS_FN_URL>?days=30` returning `{ daily, uniquesDaily, topPaths, referrers, campaigns, countries, devices, funnel, products }`.

- [ ] **Step 1: Write the aggregation SQL**

```sql
-- Aggregates for the internal /stats page. SECURITY DEFINER so the function can
-- read a table with no policies; callers still cannot reach it, because only
-- the service role can execute an RPC on a table it has no grant for and the
-- stats edge function is the only thing holding that key.

create or replace function public.stats_summary(days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with win as (
  select * from public.web_events
   where created_at >= now() - make_interval(days => days)
)
select jsonb_build_object(
  'daily', (
    select coalesce(jsonb_agg(r order by r->>'day'), '[]'::jsonb) from (
      select jsonb_build_object(
        'day', created_at::date,
        'views', count(*) filter (where name = 'pageview'),
        -- DAILY uniques. These must never be summed across days: the visitor
        -- hash rotates at midnight UTC, so a visitor on five days is five.
        'visitors', count(distinct visitor_day_hash) filter (where name = 'pageview')
      ) r
      from win group by created_at::date
    ) s
  ),
  'topPaths', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('path', path, 'n', count(*)) r
      from win where name = 'pageview' group by path order by count(*) desc limit 20
    ) s
  ),
  'referrers', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('host', referrer_host, 'n', count(*)) r
      from win where referrer_host is not null group by referrer_host order by count(*) desc limit 20
    ) s
  ),
  'campaigns', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('campaign', campaign, 'n', count(*)) r
      from win where campaign is not null group by campaign order by count(*) desc limit 20
    ) s
  ),
  'countries', (
    select coalesce(jsonb_agg(r order by (r->>'n')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('country', country, 'n', count(distinct visitor_day_hash)) r
      from win where country is not null group by country order by count(distinct visitor_day_hash) desc limit 30
    ) s
  ),
  'devices', (
    select coalesce(jsonb_object_agg(device, n), '{}'::jsonb) from (
      select device, count(distinct visitor_day_hash) n from win where device is not null group by device
    ) s
  ),
  'funnel', jsonb_build_object(
    'visitors',   (select count(distinct visitor_day_hash) from win where name = 'pageview'),
    'questionnaire', (select count(distinct visitor_day_hash) from win where milestone = 'questionnaire_started'),
    'generated',  (select count(distinct visitor_day_hash) from win where milestone = 'itinerary_generated'),
    'kept',       (select count(distinct visitor_day_hash) from win where milestone = 'itinerary_kept'),
    'clickedOut', (select count(distinct visitor_day_hash) from win where name = 'outbound')
  ),
  'products', (
    select coalesce(jsonb_agg(r order by (r->>'clicks')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('product', product_code, 'clicks', count(*),
                                'visitors', count(distinct visitor_day_hash)) r
      from win where name = 'outbound' and product_code is not null
      group by product_code order by count(*) desc limit 50
    ) s
  )
);
$$;
```

- [ ] **Step 2: Write the function**

```ts
// stats — the read side of the analytics pipe. INTERNAL ONLY.
//
// The uid comes from the TOKEN, never from the body, so a caller can only ever
// ask as themselves. Same rule as account-delete, and for the same reason.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Resolve the uid from the token itself. Passing the anon key as a bearer
  // token yields no user, so that path 401s like any other bad token.
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const uid = userData?.user?.id;
  if (userErr || !uid) return json({ error: 'unauthorized' }, 401);

  const allow = (Deno.env.get('ADMIN_UIDS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // Fail CLOSED: an unset ADMIN_UIDS must mean "nobody", never "everybody".
  if (!allow.includes(uid)) return json({ error: 'forbidden' }, 403);

  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days') ?? 30), 1), 365);
  const { data, error } = await admin.rpc('stats_summary', { days });
  if (error) {
    console.warn(`[stats] ${String(error.message ?? '').slice(0, 120)}`);
    return json({ error: 'unavailable' }, 503);
  }
  return json(data);
});
```

- [ ] **Step 3: Deploy and set the allowlist**

Run:
```bash
supabase db push
supabase functions deploy stats
supabase secrets set ADMIN_UIDS="<your supabase auth uid>"
```

Find your uid in the Supabase dashboard under Authentication → Users.

- [ ] **Step 4: Verify every guard**

```bash
source .env.production
URL="$VITE_SUPABASE_URL/functions/v1/stats"
curl -s -o /dev/null -w 'no-auth  %{http_code}\n' "$URL"
curl -s -o /dev/null -w 'anon-key %{http_code}\n' "$URL" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" -H "apikey: $VITE_SUPABASE_ANON_KEY"
curl -s -o /dev/null -w 'garbage  %{http_code}\n' "$URL" -H "Authorization: Bearer nonsense" -H "apikey: $VITE_SUPABASE_ANON_KEY"
curl -s -o /dev/null -w 'POST     %{http_code}\n' -X POST "$URL" -H "apikey: $VITE_SUPABASE_ANON_KEY"
```
Expected: `401`, `401`, `401`, `405`.

Then sign in as yourself, grab the session access token from the browser, and call it.
Expected: `200` and a JSON body with all nine keys.

**Also verify a signed-in non-admin gets 403** — sign in with any second account and confirm. If you have no second account, temporarily set `ADMIN_UIDS` to a different uid and confirm your own call 403s, then set it back. Do not skip this; it is the whole access control.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stats/index.ts supabase/migrations/20260815092000_stats_rollups.sql
git commit -m "feat(analytics): stats, gated on a uid allowlist that fails closed"
```

---

### Task 11: The `/stats` page

**Files:**
- Create: `src/pages/Stats.tsx`
- Modify: `src/App.tsx` (add `'stats'` to `PageId`, `PATH_TO_PAGE`, `PAGE_TO_PATH`, and the page switch)
- Modify: `.env.production` (add `VITE_STATS_FN_URL`)

**Interfaces:**
- Consumes: `stats` (Task 10), `useAuth` from `src/lib/auth`.
- Produces: the page at `/stats`.

**Before writing any chart code, load the `dataviz` skill.** It sets the palette, the form heuristic and the light/dark rules this page must follow. Do not pick chart colours by hand.

- [ ] **Step 1: Add the route**

In `src/App.tsx`:
- `export type PageId = ... | 'stats';`
- `PATH_TO_PAGE['/stats'] = 'stats';`
- `PAGE_TO_PATH.stats = '/stats';`
- render `<Stats />` in the page switch.

`/dashboard` is the traveller's saved-trips page. Do not overload it.

- [ ] **Step 2: Write the page**

Signed-out or non-admin renders nothing but a plain "Not available" — no hint that the page exists, no login prompt inviting a stranger to try. Signed-in admin fetches with the session access token:

```tsx
const { session } = useAuth();
const [data, setData] = useState<StatsSummary | null>(null);
const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading');

useEffect(() => {
  const token = session?.access_token;
  if (!token) { setState('denied'); return; }
  fetch(`${import.meta.env.VITE_STATS_FN_URL}?days=${days}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d) => { setData(d); setState('ok'); })
    .catch((s) => setState(s === 403 || s === 401 ? 'denied' : 'error'));
}, [session, days]);
```

Check the real `useAuth` shape in `src/lib/auth.tsx` before writing this — match what it actually exposes.

- [ ] **Step 3: Render the tiles**

Sections, in this order: traffic over time, daily uniques, funnel, outbound clicks by product, referrers and campaigns, countries, devices. A day-range selector (7 / 30 / 90).

Two labels are **required, on the page, not in a tooltip**:

- On the uniques tile: *"Daily uniques — these cannot be added up. A visitor on five days counts five times; monthly uniques are not measurable by design."*
- Above the outbound section: *"Clicks sent, not bookings. Viator returns no signal on what converts — this page cannot show bookings, revenue or conversion rate."*

The second one exists so a number from this page never gets quoted to a partner as a booking. A partner who checks their own figures and finds the claim inflated costs more than the deal is worth.

- [ ] **Step 4: Add the endpoint to `.env.production`**

```
# Internal stats endpoint. The function is gated on ADMIN_UIDS and fails closed,
# so this URL being public costs nothing.
VITE_STATS_FN_URL=https://<project-ref>.supabase.co/functions/v1/stats
```

- [ ] **Step 5: Verify in a real build, both ways**

Run: `npm run build && npm run preview`

- Signed out, open `/stats` → "Not available", and **no** network request to the stats function.
- Signed in as admin → the page renders with real numbers.

- [ ] **Step 6: Verify the numbers against the source**

Pick one figure — total pageviews for yesterday — and check it against a direct `select count(*)` on `web_events`.
Expected: identical. If the page and the table disagree, the page is wrong; fix it before anyone quotes it.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Stats.tsx src/App.tsx .env.production
git commit -m "feat(analytics): /stats, and two labels that stop a number being misquoted"
```

---

### Task 12: Privacy Policy, opt-out control, and the roadmap

**Files:**
- Modify: `src/pages/Privacy.tsx`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `OPT_OUT_KEY`, `analyticsOptedOut` (Task 5).
- Produces: the documented legal basis this collection cannot ship without.

- [ ] **Step 1: Add the Privacy Policy entry**

It must state, in the page's existing voice:
- what is collected (pages viewed, outbound clicks, referrer, country, device type);
- that **nothing is stored on the device** and no cookie or identifier is set;
- that visitors are counted with a daily hash of IP and browser that **cannot be linked across days**, and that the IP itself is never stored;
- the legal basis: **legitimate interest**, not consent — and why that differs from the cookie banner (which covers PostHog and itinerary telemetry, both of which do write to the device);
- retention: 12 months;
- the right to object, and the opt-out control below;
- the attribution line required by the IP-to-country dataset's licence (Task 2).

- [ ] **Step 2: Add the opt-out control**

A checkbox in the Privacy page that writes `10doa:no-analytics`:

```tsx
<label>
  <input
    type="checkbox"
    checked={optedOut}
    onChange={(e) => {
      localStorage.setItem(OPT_OUT_KEY, e.target.checked ? 'true' : 'false');
      setOptedOut(e.target.checked);
    }}
  />
  Don't count my visits in site statistics
</label>
```

- [ ] **Step 3: Verify the opt-out actually stops the beacon**

Run: `npm run build && npm run preview`

Tick the box, then navigate between pages with the network tab open.
Expected: **zero** `collect` requests. Untick it, navigate again, and they resume.

This is the control that makes legitimate interest hold. If it does not work, the legal basis does not either.

- [ ] **Step 4: Update the roadmap**

In `docs/ROADMAP.md`:
- close item 3 (vendor dashboard), noting it shipped as **internal-only** and that partner logins were explicitly dropped;
- close item 2 (shortlist/explore tracking), noting it is superseded by the cookieless pipe;
- add: **`web_daily` rollup — must exist before 2027-08.** Raw rows purge at 12 months, so without it the first year of pitch history deletes itself;
- add: **`ip_country` refresh** — the dataset, its licence, the load date, the row count, and the fact that nothing checks whether it is stale.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Privacy.tsx docs/ROADMAP.md
git commit -m "feat(analytics): the legal basis, the opt-out that makes it hold, and the roadmap"
```

---

### Task 13: Ship gate

- [ ] **Step 1: Full verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass. Paste the actual counts; do not assert from memory.

- [ ] **Step 2: Confirm no service-role key reached the client**

Run: `grep -rn "SERVICE_ROLE" src/ .env.production`
Expected: no output.

- [ ] **Step 3: Confirm no typed text can reach `web_events`**

Re-read `normalisePath` and the `collect` insert. Confirm every column is either an allowlisted enum, a hash, a host, or a validated slug. There must be no path by which a traveller's words become a row.

- [ ] **Step 4: Run the ship gate**

Run `/code-review ultra`, not the standard pass. This touches data collection, which is what the ultra gate exists for.

- [ ] **Step 5: Do not push on a HOLD verdict.** Resolve findings first.

- [ ] **Step 6: Push, then confirm what is actually live**

Pushing to `main` deploys. Afterwards, check the `build <sha>` in the footer of the live site against the branch SHA — committed is not deployed, and that id is the ground truth for what a browser is running.

---

## Self-Review

**Spec coverage.** Every section maps to a task: cookieless design → 3, 4, 5; visitor identity → 3; right to object → 5, 12; `collect` → 4; normalisation → 3; country → 2; data model → 1; retention → 1; deferred rollup → 12 (roadmap, with its 2027-08 deadline); outbound chokepoint → 7, 8; funnel → 9; `/stats` → 10, 11; "what this cannot tell a partner" → 11 Step 3; testing → in each task; legal checklist → 12, 13.

**Known gaps, stated rather than hidden:**
- The spec's risk list includes verifying `keepalive` fetch on a real iOS device. No task forces it, because it needs hardware the plan cannot assume. Do it during Task 8 Step 5 if an iPhone is to hand; if not, treat the outbound number as unverified on iOS until someone checks.
- Ad-blocker undercount is unmeasured and stays unmeasured in v1, exactly as the spec says. The nginx first-party proxy is not planned here.

**Type consistency.** `beacon(BeaconBody)` is the single client entry point, used identically in Tasks 6, 7 and 9. The three milestone strings in Task 9 match `MILESTONES` in Task 4 exactly. `visitorDayHash(ip, ua, salt, date)` has one signature, defined in Task 3 and called once in Task 4. `country_for_ip(ip inet)` is defined in Task 2 and called in Task 4. `stats_summary(days int)` is defined in Task 10 and consumed in Task 11.
