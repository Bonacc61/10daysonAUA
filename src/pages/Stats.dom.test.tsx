// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

let authState: { session: { access_token: string } | null; loading: boolean };
vi.mock('../lib/auth', () => ({ useAuth: () => authState }));

const okFetch = (body: unknown = SUMMARY) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => body });

beforeEach(() => {
  authState = { session: { access_token: 'a-real-token' }, loading: false };
  vi.stubEnv('VITE_STATS_FN_URL', 'https://example.test/functions/v1/stats');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Stats — who may see it', () => {
  it('renders nothing useful when signed out, and makes NO request', async () => {
    authState = { session: null, loading: false };
    const f = okFetch();
    vi.stubGlobal('fetch', f);

    render(<Stats setPage={() => {}} />);

    expect(await screen.findByText(/Not available/i)).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
    // No invitation to sign in: an invitation is a hint that there is something
    // behind the door.
    expect(document.body.textContent).not.toMatch(/sign in|log in/i);
  });

  it('shows the same page when the endpoint refuses a signed-in traveller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    render(<Stats setPage={() => {}} />);
    expect(await screen.findByText(/Not available/i)).toBeTruthy();
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
