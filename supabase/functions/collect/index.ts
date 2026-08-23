// Cookieless traffic beacon.
// Spec: docs/superpowers/specs/2026-08-14-internal-analytics-dashboard-design.md
//
// Accepts a tiny fixed body, derives identity from headers, writes one row.
// The client sends NO identifier — no cookie, no localStorage, no session id.
// That is what lets this run on legitimate interest and count 100% of traffic
// instead of the consented share (see the note in the web_events migration).
//
// FAILURES ARE SILENT AND ALWAYS 204. A traveller's page must never be affected
// by analytics, so there is no error surface a caller could act on anyway — and
// a beacon that returns 500 to a browser is a beacon that shows up in someone's
// console on launch day.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BOT_RE, normalisePath, referrerHost, campaign, deviceClass, lookupIp } from './normalise.ts';

// ECHOES THE ORIGIN. It must not be a wildcard, and that is not a preference —
// navigator.sendBeacon always sends with credentials mode 'include', and the
// CORS spec rejects `Access-Control-Allow-Origin: *` for any credentialed
// request. With a wildcard the PREFLIGHT fails, so the POST is never sent at
// all: the beacon was live from 2026-08-23 and recorded nothing, while the
// browser reported only "net::ERR_FAILED" in a console nobody was watching.
//
// The other functions in this project keep the wildcard on purpose. They are
// called with fetch(), whose credentials mode is 'same-origin' by default, so
// the wildcard is legal there and echoing would be pointless churn.
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Caches key on the origin, or one visitor's allowed origin is served to
    // the next from a shared cache.
    Vary: 'Origin',
  };
}

const noContent = (req: Request) => new Response(null, { status: 204, headers: cors(req) });

// --- visitor identity -------------------------------------------------------
// The DATE IS INSIDE THE DIGEST, so the key rotates itself at midnight UTC:
// there is no rotation job, no old-salt store, and no way to link a visitor
// across days. Unique visitors is therefore a DAILY figure and nothing else.
async function visitorDayHash(ip: string, ua: string, salt: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const bytes = new TextEncoder().encode(`v:${day}:${ip}:${ua}:${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// x-real-ip, and this is a correction — measured against the deployed function
// on 2026-08-23, not reasoned about.
//
// This read the LAST entry, on the usual and normally correct rule that the
// leftmost value is whatever the client sent and keying on it hands out a fresh
// identity per spoofed IP. That rule assumes the platform appends nothing after
// the client's chain. Supabase does. Six beacons from one machine, one browser
// string, one day produced SIX different visitor hashes and all six rows came
// back FR, while the machine's real address (46.225.208.161, stable across six
// checks) is DE in our own ip_country. The last entry is a Supabase edge hop in
// their EU region, drawn from a pool.
//
// Unfixed that is not a small error. Every visitor is France, and every event is
// a brand-new visitor — so "unique visitors" becomes an event count and the
// funnel can never join a pageview to the outbound click that followed it. Both
// numbers stay plausible-looking while being wrong, which is the worst way for a
// metric to fail when the point of it is to quote it to a partner.
//
// THE HEAD OF THE CHAIN IS THE LIVE PATH, and that is measured, not assumed.
//
// A ship-gate review argued that trusting xff[0] is unsafe because the head of
// the chain is client-supplied, and that Supabase "always sets x-real-ip" so the
// fallback was dead code. Removing it was deployed and measured on 2026-08-23:
// every row came back with country NULL and a hash driven only by the
// user-agent, because Supabase does NOT set x-real-ip on edge functions. The
// value being hashed was the literal string 'unknown' for every visitor — one
// identity for the whole internet, and no geography at all. Reasoning lost to
// measurement; the fallback is restored and is what actually runs.
//
// The spoofing worry it was meant to address was tested rather than argued, and
// does not reproduce: a request sending its own x-forwarded-for AND x-real-ip
// claiming a Dutch address was still recorded as DE, with the same hash as the
// honest requests. Cloudflare sits in front of the edge runtime and rewrites
// the chain, so a client cannot put itself at the head of it.
//
// x-real-ip stays first anyway: it costs one header read, and if the platform
// ever starts sending it, it is the more direct answer.
function clientIp(req: Request): string {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const xff = req.headers.get('x-forwarded-for')?.split(',') ?? [];
  return xff[0]?.trim() || 'unknown';
}

const trim = (v: unknown, n: number): string | null =>
  typeof v === 'string' && v ? v.slice(0, n) : null;

// The three the funnel is built from, and nothing else.
const MILESTONES = ['questionnaire_started', 'itinerary_generated', 'itinerary_kept'];
const milestoneName = (v: unknown): string | null =>
  typeof v === 'string' && MILESTONES.includes(v) ? v : null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors(req) });

  try {
    const ua = req.headers.get('user-agent') ?? '';
    // Empty UA is dropped too — a real browser always sends one.
    if (!ua || BOT_RE.test(ua)) return noContent(req);

    const salt = Deno.env.get('ANALYTICS_SALT');
    // No salt means no unlinkable identity, and writing a raw-ish key would be
    // worse than writing nothing. Fail closed.
    if (!salt) return noContent(req);

    const body = await req.json().catch(() => null);
    const name = body?.name;
    if (name !== 'pageview' && name !== 'outbound' && name !== 'milestone') return noContent(req);

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    // One read of the header, used twice. The HASH takes the raw value,
    // 'unknown' fallback and all, because identity must stay stable for a
    // caller the lookup cannot place; only the country lookup insists on a real
    // address.
    const ip = clientIp(req);

    // --- country ---------------------------------------------------------
    // Resolved at WRITE TIME, from a CIDR table in this same EU database, and
    // then thrown away. The IP reaches no column of web_events — which is why a
    // row written today can never be given a country tomorrow, and why
    // ip_country had to be loaded before this function was ever deployed.
    //
    // A geo API would have been less work and is the thing not to do: it would
    // send every visitor's IP to a US sub-processor and undo the point of a
    // cookieless beacon.
    //
    // A failed lookup costs the country, never the row: .rpc() resolves with an
    // { error } rather than throwing, so nothing here can reach the catch below
    // and lose the insert.
    let country: string | null = null;
    const addr = lookupIp(ip);
    if (addr) {
      const { data, error } = await db.rpc('country_for_ip', { ip: addr });
      if (!error && typeof data === 'string') country = data;
    }

    await db.from('web_events').insert({
      name,
      visitor_day_hash: await visitorDayHash(ip, ua, salt),
      path: normalisePath(body?.path),
      // Stamped on the ARRIVING pageview only. Later events in the visit carry
      // neither, and they are still reachable: within one UTC day the visitor
      // hash joins a visit's pageview to its outbound clicks. Across days it is
      // not — any cross-day campaign claim is unsupported by this schema.
      referrer_host: name === 'pageview' ? referrerHost(body?.ref) : null,
      campaign: name === 'pageview' ? campaign(body?.campaign) : null,
      country,
      device: deviceClass(ua),
      product_code: name === 'outbound' ? trim(body?.product, 32) : null,
      destination_host: name === 'outbound' ? referrerHost(body?.href) : null,
      // Allowlisted, not trimmed. collect is deployed --no-verify-jwt, so this
      // column is writable by anyone who finds the URL; an open 32-character text
      // field on a public endpoint is exactly what the "never store words" rule
      // exists to prevent, even though nothing renders it.
      milestone: name === 'milestone' ? milestoneName(body?.milestone) : null,
    });

    return noContent(req);
  } catch {
    // Silent by design — see the header note.
    return noContent(req);
  }
});
