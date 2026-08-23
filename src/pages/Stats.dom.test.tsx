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
  allTime: { views: 900, visitorDays: 402, outbound: 55, busiestDay: { day: '2026-08-22', visitors: 81 } },
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
    expect(document.body.textContent).toMatch(/monthly unique count does not exist/i);
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

describe('Stats — the cumulative row', () => {
  it('shows all-time totals alongside the window, and never calls them people', async () => {
    vi.stubGlobal('fetch', okFetch());
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Since counting began/i);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/900/);                      // pageviews, all time
    expect(text).toMatch(/55/);                       // clicks, all time
    // Label, value and caption ADJACENT, so this pins the all-time tile rather
    // than matching the windowed one that happens to share a phrase — a looser
    // assertion here passed while the label said "Visitors", which is the exact
    // mistake it exists to catch.
    // The `i` is the info button that sits between label and value on these
    // tiles; everything else must stay adjacent, or this stops pinning the
    // all-time tile and starts matching the windowed one.
    expect(text).toMatch(/Visits\s*i?\s*402\s*one per person, per day/i);
  });

  it('omits the row entirely when the endpoint does not send it', async () => {
    // An older function version, or a deploy skew: better to show nothing than
    // a row of zeros that reads as "no traffic ever".
    const { allTime, ...withoutAllTime } = SUMMARY;
    vi.stubGlobal('fetch', okFetch(withoutAllTime));
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Traffic over time/i);
    expect(screen.queryByText(/Since counting began/i)).toBeNull();
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

describe('Stats — unique visitors are named for what they are', () => {
  const withWindow = (extra: Record<string, unknown>) => okFetch({ ...SUMMARY, ...extra });

  it('calls them UNIQUE VISITORS over a single day, because that is what they are', async () => {
    vi.stubGlobal('fetch', withWindow({
      window: 'today',
      daily: [{ day: '2026-08-23', views: 21, visitors: 10 }],
      funnel: { ...SUMMARY.funnel, visitors: 10 },
    }));
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Traffic over time/i);
    expect(document.body.textContent).toMatch(/Unique visitors\s*10\s*so far today/i);
    // The all-time row legitimately says visitor-days whatever the window; what
    // must NOT appear is the WINDOWED variant, which carries "see below".
    expect(document.body.textContent).not.toMatch(/Visits\s*i?\s*163/i);
  });

  it('calls them VISITS over more than one day, because they are not people', async () => {
    // The code is rebuilt at midnight, so across days this is the sum of daily
    // uniques. Labelling that "visitors" overstates reach to whoever reads it —
    // and this is the number someone would quote to a partner.
    vi.stubGlobal('fetch', withWindow({ window: 'days' }));
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Traffic over time/i);
    expect(document.body.textContent).toMatch(/Visits/);
    expect(document.body.textContent).toMatch(/one per person, per day/i);
    // And offers the two figures that ARE honest over a long window.
    expect(document.body.textContent).toMatch(/Busiest day/i);
    expect(document.body.textContent).toMatch(/Average day/i);
  });

  it('greys out a window it cannot fill, and says why', async () => {
    // Collection began hours ago; a "90 days" tab returning three days of data
    // and labelling it ninety is the quiet wrongness this page exists to avoid.
    vi.stubGlobal('fetch', withWindow({ firstEvent: new Date(Date.now() - 3 * 86_400_000).toISOString() }));
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Traffic over time/i);
    expect((screen.getByRole('button', { name: 'Today' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /Last 7 days/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Last 90 days/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables a window once enough has been collected', async () => {
    vi.stubGlobal('fetch', withWindow({ firstEvent: new Date(Date.now() - 40 * 86_400_000).toISOString() }));
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Traffic over time/i);
    expect((screen.getByRole('button', { name: /Last 7 days/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /Last 30 days/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /Last 90 days/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Stats — the chart plots something', () => {
  it('draws hours when the window is short enough to have them', async () => {
    vi.stubGlobal('fetch', okFetch({
      ...SUMMARY, window: 'today',
      daily: [{ day: '2026-08-23', views: 22, visitors: 11 }],
      hourly: [
        { hour: '2026-08-23T16:00:00+00:00', views: 6, visitors: 4 },
        { hour: '2026-08-23T17:00:00+00:00', views: 15, visitors: 6 },
        { hour: '2026-08-23T18:00:00+00:00', views: 1, visitors: 1 },
      ],
    }));
    render(<Stats setPage={() => {}} />);
    expect(await screen.findByLabelText(/by hour/i)).toBeTruthy();
    expect(document.body.textContent).toMatch(/Traffic through the day/i);
    // Hourly uniques are per-hour, and summing them over-counts. Say so.
    expect(document.body.textContent).toMatch(/in that hour/i);
    expect(document.body.textContent).toMatch(/16:00/);
  });

  it('draws SOMETHING for a single bucket rather than an empty box', async () => {
    // The reported fault: one day of data plotted as days is one point, and an
    // SVG path with a single moveto and no lineto strokes nothing at all. The
    // box rendered gridlines, axis labels and no data — the only version of
    // this chart that had ever been seen, since collection began that morning.
    vi.stubGlobal('fetch', okFetch({
      ...SUMMARY, hourly: [], daily: [{ day: '2026-08-23', views: 22, visitors: 11 }],
    }));
    const { container } = render(<Stats setPage={() => {}} />);
    await screen.findByText(/Traffic over time/i);
    const svg = container.querySelector('svg[role="img"]')!;
    expect(svg.querySelectorAll('circle').length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to days when the window is too long for hours', async () => {
    vi.stubGlobal('fetch', okFetch({ ...SUMMARY, hourly: [] }));
    render(<Stats setPage={() => {}} />);
    expect(await screen.findByLabelText(/daily unique visitors over time/i)).toBeTruthy();
    expect(document.body.textContent).toMatch(/Unique visitors \(daily\)/i);
  });
});

describe('Stats — the cumulative tiles explain themselves', () => {
  it('turns over to say how to read the figure, and back again', async () => {
    vi.stubGlobal('fetch', okFetch());
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Since counting began/i);

    // The explanation is in the DOM either way — a CSS 3D flip renders both
    // faces — so what is asserted is the control, not visibility.
    const info = screen.getByRole('button', { name: /How to read: Visits/i });
    expect(info).toBeTruthy();

    const cardOf = (el: HTMLElement) => el.closest('.flip-card')!;
    expect(cardOf(info).className).not.toMatch(/flipped/);
    fireEvent.click(info);
    expect(cardOf(info).className).toMatch(/flipped/);

    // And the back carries the warning that matters most about this figure.
    expect(document.body.textContent).toMatch(/somebody who came on three days counts three times/i);

    fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[1]);
    expect(cardOf(info).className).not.toMatch(/flipped/);
  });

  it('gives every cumulative tile its own explanation', async () => {
    vi.stubGlobal('fetch', okFetch());
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Since counting began/i);
    for (const label of ['Pageviews', 'Visits', 'Best day', 'Clicks sent out']) {
      expect(screen.getByRole('button', { name: new RegExp(`How to read: ${label}`, 'i') })).toBeTruthy();
    }
  });
});

describe('Stats — the chart shows its numbers', () => {
  const hourly = [
    { hour: '2026-08-23T16:00:00+00:00', views: 6, visitors: 4 },
    { hour: '2026-08-23T17:00:00+00:00', views: 15, visitors: 6 },
    { hour: '2026-08-23T18:00:00+00:00', views: 1, visitors: 1 },
  ];

  it('floats each value above its dot on a short series', async () => {
    vi.stubGlobal('fetch', okFetch({ ...SUMMARY, window: 'today', hourly }));
    const { container } = render(<Stats setPage={() => {}} />);
    await screen.findByLabelText(/by hour/i);
    const svg = container.querySelector('svg[role="img"]')!;
    const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    // Both series labelled at every point, plus a dot each.
    for (const v of ['6', '15', '1', '4']) expect(texts).toContain(v);
    expect(svg.querySelectorAll('circle').length).toBe(hourly.length * 2);
  });

  it('drops the labels once the series is too long to read them', async () => {
    // A number above every point across ninety days is a smear. Past the
    // threshold the line speaks for itself and the hover readout gives exact
    // figures — the dataviz rule is selective labels, never one per point.
    const many = Array.from({ length: 40 }, (_, i) => ({
      day: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`, views: 100 + i, visitors: 50 + i,
    }));
    vi.stubGlobal('fetch', okFetch({ ...SUMMARY, hourly: [], daily: many }));
    const { container } = render(<Stats setPage={() => {}} />);
    await screen.findByText(/Traffic over time/i);
    const svg = container.querySelector('svg[role="img"]')!;
    expect(svg.querySelectorAll('circle').length).toBe(0);
    // Only the axis furniture remains: three gridline values and two date ends.
    // (Not asserted by value — the series maximum doubles as the top tick, and
    // picking a number that collides with it is how this test first failed.)
    expect(svg.querySelectorAll('text').length).toBeLessThanOrEqual(6);
  });
});

describe('Stats — the all-time tile is named for what it currently is', () => {
  const today = new Date().toISOString();

  it('says UNIQUE VISITORS while only one day has been collected', async () => {
    // With one day on record, "visitor-days" and "unique visitors" are the SAME
    // number — the sum of one day is that day. Two tiles showing one figure
    // under two names reads as a bug, not as a distinction.
    vi.stubGlobal('fetch', okFetch({ ...SUMMARY, firstEvent: today }));
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Since counting began/i);
    expect(document.body.textContent).toMatch(/one day so far/i);
    expect(screen.getByRole('button', { name: /How to read: Unique visitors/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /How to read: Visits/i })).toBeNull();
  });

  it('renames itself to VISITS once a second day makes them diverge', async () => {
    vi.stubGlobal('fetch', okFetch({
      ...SUMMARY, firstEvent: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    }));
    render(<Stats setPage={() => {}} />);
    await screen.findByText(/Since counting began/i);
    expect(screen.getByRole('button', { name: /How to read: Visits/i })).toBeTruthy();
    expect(document.body.textContent).toMatch(/one per person, per day/i);
  });
});
