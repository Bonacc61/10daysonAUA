// Cookieless traffic beacon — the client half.
// Spec: docs/superpowers/specs/2026-08-14-internal-analytics-dashboard-design.md
//
// READ THIS BEFORE ADDING A CALL. This module is deliberately NOT
// `src/lib/analytics.ts`, and the two must not be merged.
//
//   analytics.ts (PostHog)  writes an identifier to the device -> needs consent
//                           -> counts only the consented share of traffic.
//   beacon.ts    (here)     writes NOTHING to the device; identity is derived
//                           server-side from ip+ua+date and discarded
//                           -> runs on legitimate interest -> counts everyone.
//
// The second property is the whole point: it is what makes "we sent you N
// people" a number you can put in front of a partner. Sending an id from here,
// or reusing `aruba.session`, would collapse it into the first case.
//
// It also means NOTHING A TRAVELLER TYPES may pass through here. The server
// allowlists paths and reduces referrers to a host, but the cheapest guarantee
// is not sending it in the first place.

const FN_URL = import.meta.env.VITE_COLLECT_FN_URL as string | undefined;

// GDPR Art. 21 — the right to object to legitimate-interest processing.
// Writing this key IS device storage, and needs no consent: storing a person's
// own opt-out is strictly necessary, the same exemption every cookie banner
// leans on to remember "no".
export const NO_ANALYTICS_KEY = '10doa:no-analytics';

function optedOut(): boolean {
  try { return localStorage.getItem(NO_ANALYTICS_KEY) === 'true'; } catch { return true; }
}

type Payload =
  | { name: 'pageview'; path: string; ref?: string; campaign?: string }
  | { name: 'outbound'; path: string; product?: string; href?: string }
  | { name: 'milestone'; path: string; milestone: string };

function send(payload: Payload): void {
  // Absent URL is the off switch, and it is the DEFAULT: the feature ships dark
  // and turns on by adding one line to .env.production, the same shape as
  // VITE_ACCOUNT_DELETE_FN_URL.
  if (!FN_URL || optedOut()) return;
  try {
    const body = JSON.stringify(payload);
    // sendBeacon survives the page unloading, which is the whole reason an
    // outbound click is measurable at all — the browser is already navigating
    // away when it fires. It also cannot be awaited, so it can never delay a
    // navigation.
    if (navigator.sendBeacon) {
      // text/plain, NOT application/json, and this is load-bearing. Only
      // text/plain, form-urlencoded and multipart are CORS-safelisted; any other
      // content type turns this into a preflighted request, and a preflight that
      // fails means the POST never leaves the browser. The server parses the
      // body as JSON regardless of what this header says.
      navigator.sendBeacon(FN_URL, new Blob([body], { type: 'text/plain' }));
      return;
    }
    // keepalive is the fetch equivalent for the same reason. text/plain here
    // too: this path is rare, but sending application/json would re-create the
    // preflight the line above exists to avoid.
    void fetch(FN_URL, { method: 'POST', body, keepalive: true,
      headers: { 'content-type': 'text/plain' } }).catch(() => {});
  } catch { /* analytics must never affect the page */ }
}

/** The arriving pageview. Referrer and campaign are stamped here and nowhere else. */
export function trackPageview(path: string): void {
  let campaign: string | undefined;
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    // Allowlisted client-side too, so a junk value never leaves the browser.
    // The server re-checks; this is belt and braces, not trust.
    if (ref && /^[a-z0-9-]{1,32}$/.test(ref)) campaign = ref;
  } catch { /* ignore */ }
  send({ name: 'pageview', path, ref: document.referrer || undefined, campaign });
}

/**
 * A click out to a partner. `product` is the Viator product code — an id from
 * our own catalog, never anything a traveller wrote.
 */
export function trackOutbound(href: string, product?: string): void {
  send({ name: 'outbound', path: window.location.pathname, product, href });
}

/** A named point in the funnel. Closed vocabulary, defined at the call site. */
export function trackMilestone(milestone: string): void {
  send({ name: 'milestone', path: window.location.pathname, milestone });
}
