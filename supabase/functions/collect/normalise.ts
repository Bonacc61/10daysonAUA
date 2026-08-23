// The pure half of the beacon: everything that decides what text reaches the
// database. Separated from index.ts so it can be unit-tested by `npm test` —
// index.ts imports `Deno.serve` and a remote esm.sh URL, neither of which Node's
// ESM loader can resolve. Same split as viator-cards/normalize.ts.
//
// These functions ARE the project's "never store a traveller's words" rule in
// executable form, so they are the part that most needs a test.

// --- bot filter -------------------------------------------------------------
// FIRST, before anything else is derived. A pitch number that counts crawlers is
// worse than no pitch number, because it is quotable and wrong. Deliberately a
// pattern list rather than a UA-parsing dependency: it is imperfect, whatever
// reads this table says "bots excluded by user-agent", and that honesty is
// cheaper than a library that is also imperfect but looks authoritative.
export const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|discord|preview|scrape|curl|wget|python-requests|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baidu|duckduck/i;

// --- path allowlist ---------------------------------------------------------
// An ALLOWLIST, not a sanitiser. Anything unrecognised becomes 'other' rather
// than being cleaned up and stored, because "clean it up" is how free text ends
// up in a database one unusual URL at a time.
// Taken from PATH_TO_PAGE / PAGE_TO_PATH in src/App.tsx. Keep in step: a route
// added there and not here silently becomes 'other', which looks like traffic
// going nowhere rather than like a missing line.
const KNOWN_PATHS = new Set([
  '/', '/questionnaire', '/itinerary', '/explore', '/map',
  '/privacy', '/terms', '/surprise', '/dashboard', '/preview',
]);

export function normalisePath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return 'other';
  // Query string dropped BEFORE anything else — a search query in a URL is a
  // traveller's typed words, and the project rule forbids storing those.
  const path = raw.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (KNOWN_PATHS.has(path)) return path;
  // Collapse the one dynamic route. Storing the raw slug would tie a pageview to
  // a specific shared itinerary, which is a person's plan.
  if (/^\/i\/[A-Za-z0-9_-]+$/.test(path)) return '/i/:slug';
  return 'other';
}

// Host only, never the full referring URL — `reddit.com`, not the thread.
export function referrerHost(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const h = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
    return h.length <= 100 ? h : null;
  } catch { return null; }
}

// Post-level attribution you control, so it can be allowlisted tightly. This is
// what makes "this Reddit post sent 400 people" answerable without storing
// arbitrary third-party URLs.
export function campaign(raw: unknown): string | null {
  return typeof raw === 'string' && /^[a-z0-9-]{1,32}$/.test(raw) ? raw : null;
}

// Three coarse buckets, not a UA-parsing library. Nothing downstream needs more.
export function deviceClass(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

// The only header value ever handed to the database, so it is checked here
// rather than trusted. Postgres would reject malformed `inet` input anyway, but
// the round trip is spent per beacon to learn nothing — and clientIp's own
// fallback is the literal string 'unknown', which arrives on every request
// without an x-forwarded-for header.
//
// Hand-written rather than `new URL('http://[' + ip + ']')`, which validates
// IPv6 for free: that would put a Node URL parser in the test and a Deno one in
// production, and a check that disagrees between the two runtimes is worse than
// no check. Postgres remains the real validator; this only decides whether to
// ask it.
const V4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
// Hex groups joined by colons, with at most one '::' elision.
const V6 = /^(?=.*:)(?!.*::.*::)(?:[0-9a-f]{1,4})?(?::(?:[0-9a-f]{1,4})?){1,7}$/i;

export function lookupIp(raw: string): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 45) return null;
  // An IPv4-mapped address (::ffff:145.100.0.1) is returned UNMAPPED. Some
  // proxies emit that form, and inet would accept it happily — but it sorts into
  // IPv6 space, where the dataset's first range is the ZZ block covering ::/3,
  // so every mapped address would resolve to no country at all. Silently, and
  // for every visitor behind such a proxy.
  const unmapped = raw.replace(/^::ffff:/i, '');
  if (V4.test(unmapped)) return unmapped;
  if (V6.test(raw)) return raw;
  return null;
}
