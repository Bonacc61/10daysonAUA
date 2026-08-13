import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The consent gate on itinerary telemetry.
 *
 * Worth a test rather than a comment because both halves are silent when they
 * break: nothing throws if the network call goes out unconsented, and nothing
 * throws if an identifier is written to a device that never agreed to one. The
 * only way to notice is to assert it.
 */

const CONSENT = '10doa:analytics-consent';
const SESSION = 'aruba.session';

/** A localStorage double that records every write, seeded with a consent value. */
function installStorage(consent: string | null) {
  const store = new Map<string, string>();
  if (consent !== null) store.set(CONSENT, consent);
  const setItem = vi.fn((k: string, v: string) => { store.set(k, v); });
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem,
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return { setItem, store };
}

async function loadLogEvent() {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  return (await import('./feedback')).logEvent;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('logEvent consent gate', () => {
  it('sends nothing when consent was never answered', async () => {
    const { setItem } = installStorage(null);
    const logEvent = await loadLogEvent();
    logEvent({ action: 'swap', reason: 'too-expensive' });
    expect(fetchMock).not.toHaveBeenCalled();
    // And no identifier is created — the gate runs BEFORE sessionId(), which
    // would otherwise mint and store one on its first call.
    expect(setItem).not.toHaveBeenCalled();
  });

  it('sends nothing when consent was declined', async () => {
    const { setItem } = installStorage('false');
    const logEvent = await loadLogEvent();
    logEvent({ action: 'add', to_id: '6593P7' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('sends once when consent was given', async () => {
    const { store } = installStorage('true');
    const logEvent = await loadLogEvent();
    logEvent({ action: 'swap', reason: 'nl', day: 2, slot: 'morning' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The id is minted only on this path.
    expect(store.get(SESSION)).toBeTruthy();
  });

  it('never puts the traveller\'s own words in the body', async () => {
    // Itinerary.tsx passes a chip id or the literal 'nl', never the typed text,
    // and the Privacy Policy now promises exactly that. This asserts the shape
    // the promise depends on: `reason` is whatever the caller passed, so the
    // guarantee lives at the CALL SITE — this test pins the payload contract so
    // a future caller cannot quietly widen it without the diff showing here.
    installStorage('true');
    const logEvent = await loadLogEvent();
    logEvent({ action: 'swap', reason: 'nl' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['action', 'reason', 'session_id']);
    expect(body.reason).toBe('nl');
  });

  it('is silent rather than throwing when localStorage is unavailable', async () => {
    // Safari private mode and friends. No storage means no consent on record,
    // and silence is not agreement.
    (globalThis as { localStorage?: Storage }).localStorage = {
      get getItem(): never { throw new Error('denied'); },
    } as unknown as Storage;
    const logEvent = await loadLogEvent();
    expect(() => logEvent({ action: 'approve' })).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
