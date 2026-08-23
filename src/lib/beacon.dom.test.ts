// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The two properties of the beacon that fail SILENTLY and cost everything.
 *
 * 1. The content type. Only text/plain, form-urlencoded and multipart are
 *    CORS-safelisted; anything else makes this a preflighted request. This
 *    shipped as application/json, and because navigator.sendBeacon always sends
 *    with credentials mode 'include' — where the spec forbids a wildcard
 *    Access-Control-Allow-Origin — the preflight failed and the POST was never
 *    sent. The beacon ran for a day and recorded nothing, with no symptom
 *    anywhere except one console line.
 *
 * 2. The opt-out. Legitimate interest without a working Article 21 objection has
 *    no lawful basis, so a beacon that fires for someone who objected is not a
 *    bug, it is a compliance failure.
 *
 * Both are tested through the real sendBeacon call rather than by reading the
 * source, because both are about the value that actually reaches the browser API.
 */
describe('beacon — what actually reaches the browser', () => {
  const FN = 'https://example.test/functions/v1/collect';
  let sent: { url: string; blob: Blob }[];

  beforeEach(() => {
    sent = [];
    localStorage.clear();
    vi.resetModules();
    vi.stubEnv('VITE_COLLECT_FN_URL', FN);
    vi.stubGlobal('navigator', {
      ...navigator,
      sendBeacon: (url: string, blob: Blob) => { sent.push({ url, blob }); return true; },
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('sends a CORS-safelisted content type, so the request needs no preflight', async () => {
    const { trackPageview } = await import('./beacon');
    trackPageview('/explore');
    expect(sent).toHaveLength(1);
    // The exact failure that kept web_events empty: anything outside the
    // safelist triggers a preflight, and a credentialed preflight against a
    // wildcard Allow-Origin is rejected before the POST is made.
    expect(sent[0].blob.type).toBe('text/plain');
    expect(sent[0].blob.type).not.toBe('application/json');
  });

  it('still sends the payload as JSON text, whatever the header says', async () => {
    const { trackPageview } = await import('./beacon');
    trackPageview('/map');
    const body = JSON.parse(await sent[0].blob.text());
    expect(body).toMatchObject({ name: 'pageview', path: '/map' });
  });

  it('sends nothing at all once someone has objected', async () => {
    localStorage.setItem('10doa:no-analytics', 'true');
    const { trackPageview, trackOutbound } = await import('./beacon');
    trackPageview('/');
    trackOutbound('https://www.viator.com/tours/x?pid=P00302487&mcid=42383', '2785AFTSNORKEL');
    expect(sent).toHaveLength(0);
  });

  it('sends nothing when the endpoint is not configured, which is the off switch', async () => {
    vi.stubEnv('VITE_COLLECT_FN_URL', '');
    vi.resetModules();
    const { trackPageview } = await import('./beacon');
    trackPageview('/');
    expect(sent).toHaveLength(0);
  });
});

describe('beacon — milestones fire once per page session', () => {
  const FN = 'https://example.test/functions/v1/collect';
  let sent: string[];

  beforeEach(() => {
    sent = [];
    localStorage.clear();
    vi.resetModules();
    vi.stubEnv('VITE_COLLECT_FN_URL', FN);
    vi.stubGlobal('navigator', {
      ...navigator,
      sendBeacon: (_u: string, blob: Blob) => { void blob.text().then((t) => sent.push(t)); return true; },
    });
  });

  it('sends a milestone once however many times it is asked', async () => {
    // The guard is module-scoped rather than a ref per component, because this
    // app swaps pages without reloading: navigating away from the itinerary and
    // back would re-arm a per-component guard on every visit.
    const { trackMilestoneOnce } = await import('./beacon');
    trackMilestoneOnce('questionnaire_started');
    trackMilestoneOnce('questionnaire_started');
    trackMilestoneOnce('questionnaire_started');
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toMatchObject({ name: 'milestone', milestone: 'questionnaire_started' });
  });

  it('keeps the three milestones independent of one another', async () => {
    const { trackMilestoneOnce } = await import('./beacon');
    for (const m of ['questionnaire_started', 'itinerary_generated', 'itinerary_kept', 'itinerary_kept']) {
      trackMilestoneOnce(m);
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((b) => JSON.parse(b).milestone))
      .toEqual(['questionnaire_started', 'itinerary_generated', 'itinerary_kept']);
  });
});
