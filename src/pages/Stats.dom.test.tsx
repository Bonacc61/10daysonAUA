// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Stats from './Stats';

/**
 * The internal dashboard, rendered.
 *
 * Three things here are not cosmetic:
 *
 *   - a signed-out visitor must cause NO request to the internal endpoint. The
 *     function would answer 403 correctly, but a page that calls it anyway is a
 *     page that tells a stranger the endpoint exists;
 *   - the two warning labels are required by the spec and must be ON the page.
 *     Both exist to stop a number being repeated as something it is not, and
 *     both are the kind of text a later redesign quietly drops;
 *   - an empty dataset must read as "nothing arrived yet", not as zeros that
 *     look like a broken query. It is the first thing this page will ever show.
 */

const SUMMARY = {
  days: 30,
  daily: [
    { day: '2026-08-21', views: 40, visitors: 22 },
    { day: '2026-08-22', views: 120, visitors: 81 },
    { day: '2026-08-23', views: 95, visitors: 60 },
  ],
  topPaths: [{ path: '/', n: 130 }, { path: '/explore', n: 74 }],
  referrers: [{ host: 'reddit.com', n: 96 }],
  campaigns: [{ campaign: 'reddit-aruba-aug', n: 96 }],
  countries: [{ country: 'US', n: 71 }, { country: 'NL', n: 48 }],
  devices: { mobile: 96, desktop: 55, tablet: 12 },
  funnel: { visitors: 163, questionnaire: 74, generated: 51, kept: 18, clickedOut: 12 },
  products: [{ product: '2785AFTSNORKEL', clicks: 9, visitors: 7 }],
  partners: [{ host: 'viator.com', clicks: 12 }],
};

let authState: { session: { access_token: string } | null; loading: boolean; signInWithEmail: (e: string) => Promise<{ error: string | null }> };
const sentTo: string[] = [];
vi.mock('../lib/auth', () => ({ useAuth: () => authState }));

const okFetch = (body: unknown = SUMMARY) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => body });

beforeEach(() => {
  sentTo.length = 0;
  authState = {
    session: { access_token: 'a-real-token' }, loading: false,
    signInWithEmail: async (e: string) => { sentTo.push(e); return { error: null }; },
  };
  sessionStorage.clear();
  vi.stubEnv('VITE_STATS_FN_URL', 'https://example.test/functions/v1/stats');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Stats — who may see it', () => {
  it('offers its OWN sign-in when signed out, and makes no request until then', async () => {
    authState = { ...authState, session: null };
    const f = okFetch();
    vi.stubGlobal('fetch', f);

    render(<Stats setPage={() => {}} />);

    expect(await screen.findByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign-in link/i })).toBeTruthy();
    // Nothing is asked of the internal endpoint before there is a token.
    expect(f).not.toHaveBeenCalled();
  });

  it('sends the link itself rather than opening the traveller login modal', async () => {
    authState = { ...authState, session: null };
    vi.stubGlobal('fetch', okFetch());
    render(<Stats setPage={() => {}} />);

    fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: 'jan@10daysonaruba.com' } });
    fireEvent.click(screen.getByRole('button', { name: /sign-in link/i }));

    await waitFor(() => expect(sentTo).toEqual(['jan@10daysonaruba.com']));
    expect(await screen.findByText(/Check your inbox/i)).toBeTruthy();
    // The marker App.tsx uses to bring them back here after the link lands.
    expect(sessionStorage.getItem('10doa:after-login-stats')).toBe('1');
  });

  it('does NOT offer a form to a signed-in traveller who is refused', async () => {
    // A form would imply trying again could help. It cannot: this account is not
    // on the allowlist, and only a secret change fixes that.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    render(<Stats setPage={() => {}} />);
    expect(await screen.findByText(/Not available/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign-in link/i })).toBeNull();
  });
});

describe('Stats — the labels that stop a number being misquoted', () => {
  it('says daily uniques cannot be summed, on the page', async () => {
    vi.stubGlobal('fetch', okFetch());
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Traffic over time/i);
    expect(document.body.textContent).toMatch(/cannot be added up/i);
    expect(document.body.textContent).toMatch(/not measurable/i);
  });

  it('says outbound clicks are not bookings, on the page', async () => {
    vi.stubGlobal('fetch', okFetch());
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Traffic over time/i);
    expect(document.body.textContent).toMatch(/Clicks sent, not bookings/i);
    expect(document.body.textContent).toMatch(/cannot show bookings, revenue, or a conversion rate/i);
  });

  it('carries the DB-IP attribution the licence requires', async () => {
    vi.stubGlobal('fetch', okFetch());
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Traffic over time/i);
    expect(document.body.textContent).toMatch(/DB-IP/);
    expect(document.body.textContent).toMatch(/CC\s*BY\s*4\.0/i);
  });
});

describe('Stats — the numbers', () => {
  it('totals pageviews across the window rather than showing the last day', async () => {
    vi.stubGlobal('fetch', okFetch());
    render(<Stats setPage={() => {}} />);
    // 40 + 120 + 95
    expect(await screen.findByText('255')).toBeTruthy();
  });

  it('labels the window from the response, not from the button that was pressed', async () => {
    // The function clamps and defaults; if it measured 7 days the page must say
    // 7 even though the control still shows 30.
    vi.stubGlobal('fetch', okFetch({ ...SUMMARY, days: 7 }));
    render(<Stats setPage={() => {}} />);
    expect(await screen.findByText(/Last 7 days/i)).toBeTruthy();
  });

  it('renders both series of the time chart with an always-present legend', async () => {
    vi.stubGlobal('fetch', okFetch());
    render(<Stats setPage={() => {}} />);
    expect(await screen.findByLabelText(/Pageviews and daily unique visitors over time/i)).toBeTruthy();
    expect(document.body.textContent).toMatch(/Unique visitors \(daily\)/i);
  });

  it('names the three uninstrumented funnel steps instead of drawing them as zero', async () => {
    // trackMilestone() has no call sites, so questionnaire/generated/kept are
    // structurally always 0. Rendering "0 visitors · 0%" would read as nobody
    // doing it rather than as nothing measuring it.
    vi.stubGlobal('fetch', okFetch());
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/What people did/i);
    expect(document.body.textContent).toMatch(/Three steps are not measured yet/i);
    // The two that ARE measured still render as bars.
    expect(document.body.textContent).toMatch(/Clicked out to a partner/);
    // And the unmeasured ones carry no percentage of their own.
    expect(document.body.textContent).not.toMatch(/Generated an itinerary\s*·/);
  });

  it('counts outbound clicks from the partner totals, not the product subset', async () => {
    // `products` only holds rows WITH a product_code and truncates at 50;
    // `partners` groups every outbound row. The old `||` discarded every
    // click without a product code as soon as one product click existed.
    vi.stubGlobal('fetch', okFetch({
      ...SUMMARY,
      products: [{ product: 'X', clicks: 9, visitors: 7 }],
      partners: [{ host: 'viator.com', clicks: 21 }, { host: 'operator.aw', clicks: 9 }],
    }));
    render(<Stats setPage={() => {}} />);
    expect(await screen.findByText('30')).toBeTruthy();
  });

  it('reads an empty dataset as "nothing arrived yet", not as a broken query', async () => {
    vi.stubGlobal('fetch', okFetch({
      days: 30, daily: [], topPaths: [], referrers: [], campaigns: [], countries: [],
      devices: {}, funnel: { visitors: 0, questionnaire: 0, generated: 0, kept: 0, clickedOut: 0 },
      products: [], partners: [],
    }));
    render(<Stats setPage={() => {}} />);
    expect(await screen.findByText(/Nothing recorded yet/i)).toBeTruthy();
    await waitFor(() => expect(document.body.textContent).toMatch(/ad-blockers/i));
  });
});

describe('Stats — staying current', () => {
  it('re-asks on a timer, and again as soon as the tab is looked at', async () => {
    vi.useFakeTimers();
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    render(<Stats setPage={() => {}} />);
    await vi.advanceTimersByTimeAsync(10);
    expect(f).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(61_000);
    expect(f).toHaveBeenCalledTimes(2);

    // A hidden tab must not poll — those are invocations spent on nobody.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(f).toHaveBeenCalledTimes(2);

    // Looking at it again asks straight away rather than waiting out the timer.
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
    expect(f).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

describe('Stats — when the network does not answer', () => {
  it('gives up and explains itself instead of saying "Loading" forever', async () => {
    // The reported bug, reproduced: a blocker that black-holes *.supabase.co
    // leaves the request PENDING rather than rejecting it. An aborted request
    // already showed the error state; a hanging one showed "Loading" until the
    // tab was closed, which reads as broken and offers nothing to act on.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})));
    render(<Stats setPage={() => {}} />);
    expect(document.body.textContent).toMatch(/Loading/i);
    // Slow must be distinguishable from stuck while it waits.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(document.body.textContent).toMatch(/slower than usual/i);

    await vi.advanceTimersByTimeAsync(31_000);

    expect(document.body.textContent).toMatch(/Stats unavailable/i);
    // Names the likely cause rather than shrugging.
    expect(document.body.textContent).toMatch(/ad-blocker|supabase\.co/i);
    // And says the counting is unaffected, which is the thing worth knowing.
    expect(document.body.textContent).toMatch(/Nothing is wrong with the counting/i);
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
    vi.useRealTimers();
  });
});
