// /stats — the internal traffic dashboard. NOT a traveller-facing page.
//
// Spec: docs/superpowers/specs/2026-08-14-internal-analytics-dashboard-design.md
//
// Everything here is read from the `stats` edge function, which is gated on an
// ADMIN_UIDS allowlist that fails closed. This page holds no secret and enforces
// nothing on its own: a signed-out visitor sees "Not available" because that is
// the courteous thing to render, NOT because that is what keeps the numbers
// private. The function is what keeps them private. If this component were
// bypassed entirely the endpoint would still answer 403.
//
// Two labels on this page are REQUIRED and must not be softened into tooltips or
// footnotes — see the tiles they sit on. Both exist to stop a number being
// quoted as something it is not.
//
// Chart colours ARE brand tokens — --blue, --red, --green from src/index.css —
// but only after the validator agreed to them:
//
//   node scripts/validate_palette.js "#3B82F6,#E63946,#22C55E" \
//     --mode light --surface "#FAF7F2"     -> ALL CHECKS PASS
//
// The surface argument matters and is the card background, not the page's cream:
// an earlier run used #FFFBF0, which the charts never sit on. Two brand pairings
// were tried and REJECTED for colourblindness before this one: coral+green is
// ΔE 3.4 under deuteranopia (the same colour to a red-green colourblind reader),
// and blue+red+yellow fails the same check. Green carries a contrast WARN at
// 2.13:1, discharged the way the skill requires — every categorical mark on this
// page is directly labelled in text.
//
// So: re-run that script before changing a hue, and keep the order fixed.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageId } from '../App';
import { useAuth } from '../lib/auth';

type Props = { setPage: (p: PageId) => void };

type Daily = { day: string; views: number; visitors: number };
type Hourly = { hour: string; views: number; visitors: number };
/** What the chart actually plots, whichever bucket it came from. */
type Point = { key: string; label: string; views: number; visitors: number };
type Counted = { n: number };
type Summary = {
  days: number;
  window?: 'today' | 'days';
  /** Oldest row in web_events, or null when nothing has been recorded. */
  firstEvent?: string | null;
  /** The same headline figures, unwindowed. visitorDays is NOT people. */
  allTime?: {
    views: number;
    visitorDays: number;
    outbound: number;
    busiestDay: { day: string; visitors: number } | null;
  };
  daily: Daily[];
  /** Present only for windows under three days; empty otherwise. */
  hourly?: Hourly[];
  topPaths: (Counted & { path: string; visitors?: number })[];
  referrers: (Counted & { host: string })[];
  campaigns: (Counted & { campaign: string })[];
  countries: (Counted & { country: string })[];
  devices: Record<string, number>;
  funnel: { visitors: number; questionnaire: number; generated: number; kept: number; clickedOut: number };
  /** Optional: absent until the 20260825150000 migration is applied, and the
   *  card hides itself rather than draw zeros that read as instant bounces. */
  questionnaireFunnel?: { viewed: number; started: number; reached: Record<string, number> };
  products: { product: string; clicks: number; visitors: number }[];
  partners: { host: string; clicks: number }[];
};

// Fixed order. A fifth category folds into "Other" rather than inventing a hue.
// Hex rather than var(--blue), but NOT because var() fails in SVG — it works
// fine in presentation attributes, and this file relies on that a few lines
// down where var(--ink) reaches fill= and var(--sand-50) reaches stroke=. The
// reason is the validator: it takes literal colours, so the values it checked
// have to be the values that render. Same as --blue / --red / --green in
// src/index.css; if those tokens move, move these and re-run the script.
const SERIES = ['#3B82F6', '#E63946', '#22C55E'] as const;
const INK = 'var(--ink)';
const GRID = 'rgba(26,26,26,0.10)';

// 'today' is a distinct window, not days=1: the server reads it as "since
// midnight UTC", which is the same boundary the visitor hash rotates on. A
// rolling 24 hours would disagree with the daily chart on the same page.
// Read by App.tsx after a magic link lands, to forward back here.
export const AFTER_LOGIN_KEY = '10doa:after-login-stats';

// 'all' asks the server for days=365, and that is not an approximation: rows
// purge at 12 months and the function clamps windows to 365, so the maximum
// window IS everything that exists, by construction, permanently. All-time
// needs no server change and no second dataset — it is a label over the
// retention window, and the header derives that label from firstEvent.
const WINDOWS = ['today', 7, 30, 90, 'all'] as const;
type WindowKey = (typeof WINDOWS)[number];
const ALL_TIME_DAYS = 365;
const windowLabel = (w: WindowKey) => (w === 'today' ? 'Today' : w === 'all' ? 'All time' : `${w} days`);

// A request that never settles must not become a page that never resolves. A
// blocker that black-holes *.supabase.co instead of refusing outright, a captive
// proxy, or a slow network all produce a pending promise rather than an error —
// and the page sat on "Loading…" indefinitely, which reads as broken and gives
// the reader nothing to act on. Measured: an aborted request showed the error
// state correctly; a hanging one showed "Loading" forever.
const TIMEOUT_MS = 30_000;

// The numbers are computed per request, so an open tab is the only thing that
// can go stale. Re-ask every minute, and again the moment the tab is looked at.
//
// NOT Supabase Realtime, which is the obvious answer and the wrong one here.
// Realtime enforces RLS, and web_events has RLS with NO policies — service role
// only. A browser subscription would mean adding a policy that hands raw visitor
// rows (day hashes, paths, countries) to the client, which is the exact
// invariant this design is built on. Polling an aggregate the database computes
// costs one small request a minute and exposes nothing.
const REFRESH_MS = 60 * 1000;

export default function Stats({ setPage }: Props) {
  const { session, loading } = useAuth();
  const [days, setDays] = useState<WindowKey>('today');
  const [data, setData] = useState<Summary | null>(null);
  // 'signedout' and 'denied' are deliberately different. Nobody signed in gets a
  // sign-in form; a signed-in traveller who is not on the allowlist gets nothing
  // at all, because offering them a form implies trying again would help.
  const [state, setState] = useState<'loading' | 'ok' | 'signedout' | 'denied' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  // Bumping this re-runs the fetch: the hourly tick and the retry button both
  // use it, so there is one path that asks again rather than two.
  const [attempt, setAttempt] = useState(0);
  const [lastAt, setLastAt] = useState<Date | null>(null);

  const token = session?.access_token;

  // Auth itself can hang for the same reason — getSession() may go to the
  // network to refresh a token. Without a ceiling the page waits on it forever.
  const [authStalled, setAuthStalled] = useState(false);
  useEffect(() => {
    if (!loading) { setAuthStalled(false); return; }
    const t = setTimeout(() => setAuthStalled(true), TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loading]);

  // Re-ask on a timer, but only while the tab is actually being looked at — a
  // background tab polling all night is invocations spent on nobody. Coming back
  // to the tab asks immediately, so what you see when you look is current.
  useEffect(() => {
    const tick = () => { if (!document.hidden) setAttempt((n) => n + 1); };
    const id = setInterval(tick, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) setAttempt((n) => n + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    // Still resolving the session: hold, or a signed-in admin sees "Not
    // available" flash before their own dashboard appears.
    if (loading) return;
    // No token means no request. A signed-out visitor should not cause a call to
    // an internal endpoint at all — the 403 would be correct and still pointless.
    if (!token) { setState('signedout'); return; }
    // Read inside the effect, not at module scope: both are optional in
    // ImportMetaEnv, and a build missing either should render the error state
    // rather than fetch an empty URL and report the failure as a denial.
    const url = import.meta.env.VITE_STATS_FN_URL ?? '';
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
    if (!url || !anon) { setState('error'); return; }

    let live = true;
    const ctl = new AbortController();
    // The timer sets the state ITSELF rather than relying on the abort to reject
    // the promise. Aborting is the tidy path, but the guarantee that matters is
    // "this page never sits on Loading past the timeout", and that must not
    // depend on a fetch implementation propagating the signal.
    const timer = setTimeout(() => {
      ctl.abort();
      if (!live) return;
      setBusy(false);
      setState((prev) => (prev === 'ok' ? 'ok' : 'error'));
    }, TIMEOUT_MS);
    // Only blank the page when there is nothing to show. Re-fetching for a new
    // window used to unmount the entire dashboard — scroll jumped to the top and
    // the window buttons disappeared mid-flight, so you could not change your
    // mind. Stale numbers stay up instead, dimmed, until the new ones land.
    setState((prev) => (prev === 'ok' ? 'ok' : 'loading'));
    setBusy(true);
    fetch(`${url}?days=${days === 'all' ? ALL_TIME_DAYS : days}`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
      signal: ctl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Summary) => { if (live) { setData(d); setState('ok'); setLastAt(new Date()); } })
      .catch((s) => { if (live) setState(s === 401 || s === 403 ? 'denied' : 'error'); })
      .finally(() => { clearTimeout(timer); if (live) setBusy(false); });
    return () => { live = false; clearTimeout(timer); ctl.abort(); };
  }, [token, loading, days, attempt]);

  if ((loading || state === 'loading') && !authStalled) {
    // Counts up, because a bare "Loading…" that sits there gives no way to tell
    // slow from stuck — which is exactly the complaint that led here.
    return <Shell><LoadingNote /></Shell>;
  }

  if (state === 'signedout') return <Shell><SignIn /></Shell>;

  // Signed in, but not on the allowlist. No form here: this account cannot be
  // made to work by trying again, and a form would only invite the attempt.
  if (state === 'denied') {
    return (
      <Shell>
        <h1 className="font-display" style={{ fontSize: 32, margin: '0 0 8px' }}>Not available</h1>
        <p style={muted}>This page isn't available.</p>
        <button onClick={() => setPage('landing')} style={linkBtn}>← Back to the site</button>
      </Shell>
    );
  }

  if (state === 'error' || authStalled || !data) {
    return (
      <Shell>
        <h1 className="font-display" style={{ fontSize: 32, margin: '0 0 8px' }}>Stats unavailable</h1>
        <p style={muted}>
          The stats service did not answer within {Math.round(TIMEOUT_MS / 1000)} seconds. The usual
          cause is something between this browser and our servers — an ad-blocker or privacy
          extension that blocks requests to <code>supabase.co</code>, a VPN, or an office network.
          Try again, or open this page in a private window with extensions off.
        </p>
        <p style={muted}>
          <strong>Nothing is wrong with the counting.</strong> Visits are recorded by a separate
          service that does not depend on this page, so nothing is being lost while this is broken.
        </p>
        <button
          className="filter-pill active"
          style={{ minHeight: 44, padding: '0 20px', fontSize: 13 }}
          onClick={() => { setState('loading'); setAttempt((n) => n + 1); }}
        >Try again</button>
        <div><button onClick={() => setPage('landing')} style={{ ...linkBtn, marginTop: 20 }}>← Back to the site</button></div>
      </Shell>
    );
  }

  // How much history there actually is, in days. Drives which windows are
  // offered — see the control below.
  const daysCollected = data.firstEvent
    ? (Date.now() - new Date(data.firstEvent).getTime()) / 86_400_000
    : 0;
  const totalViews = (data.daily ?? []).reduce((s, d) => s + d.views, 0);
  // One day is the only window over which "distinct visitor codes" and "unique
  // people" are the same thing.
  const isOneDay = data.window === 'today' || (data.daily ?? []).length <= 1;
  // The denominator for "what share of visitors reached this page". The funnel's
  // first step is the same distinct count over the same window, so the shares
  // add up against a figure already on the page rather than a second one.
  const allVisitors = data.funnel.visitors;
  // Hours when the window is short enough for them to exist, days otherwise. A
  // single day plotted as days is ONE point, and a path with one moveto and no
  // lineto strokes nothing — the chart rendered gridlines and no data at all.
  // How many UTC days the record spans. While that is one, "visitor-days" and
  // "unique visitors" are arithmetically the SAME number — the sum of one day is
  // that day — and showing them side by side under two names reads as a bug
  // rather than as a distinction. So the all-time tile is named for what it
  // currently is, and renames itself once a second day makes the two diverge.
  const daysSpanned = data.firstEvent
    ? Math.floor((Date.now() - Date.parse(`${data.firstEvent.slice(0, 10)}T00:00:00Z`)) / 86_400_000) + 1
    : 0;
  // EXACTLY one, not "one or fewer". With no firstEvent the span is unknown, and
  // unknown must not read as "one day" — the conservative label under-claims,
  // which is the right way to be wrong about this particular number.
  const oneDayOnly = daysSpanned === 1;
  const byHour = (data.hourly?.length ?? 0) > 0;
  const points: Point[] = byHour
    ? data.hourly!.map((h) => ({ key: h.hour, label: fmtHour(h.hour), views: h.views, visitors: h.visitors }))
    : (data.daily ?? []).map((d) => ({ key: d.day, label: fmtDay(d.day), views: d.views, visitors: d.visitors }));
  const avgPerDay = (data.daily ?? []).length
    ? Math.round((data.daily.reduce((s, d) => s + d.visitors, 0) / data.daily.length))
    : 0;
  const busiest = data.daily.reduce<Daily | null>((b, d) => (!b || d.visitors > b.visitors ? d : b), null);
  // The PARTNERS sum, not the products sum, and `||` between them was a bug
  // rather than a fallback. stats_summary builds `products` only from outbound
  // rows that carry a product_code; `partners` groups every outbound row by
  // destination host. A Viator URL whose shape does not match the /d<n>-<code>
  // pattern yields a null product_code, so the moment one product-attributed
  // click existed, `||` stopped counting the rest — and this tile could show
  // fewer clicks than the "visitors who clicked out" tile beside it, which is
  // impossible on its face.
  //
  // (Not, as an earlier comment here claimed, because of direct-operator links:
  // App.tsx filters outbound tracking to viator.com, so destination_host can
  // only be viator.com today. `partners` is capped at 20 hosts by the query,
  // which is a truncated list to build a total from — harmless while there is
  // one host, and worth remembering if that ever changes.)
  const outboundClicks = (data.partners ?? []).reduce((s, p) => s + p.clicks, 0);
  const empty = data.daily.length === 0 && totalViews === 0;

  return (
    <Shell hero={
      <div className="container-1280" style={{ padding: '36px 36px 32px', maxWidth: 1000 }}>
        <h1 className="font-display" style={{ fontSize: 46, margin: '0 0 6px', color: 'var(--ink)' }}>Traffic.</h1>
        {/* The window comes back from the FUNCTION, not from local state: if a
            request were ever clamped or defaulted server-side, this line has to
            say what was actually measured, not what was asked for. */}
        <p style={{ fontStyle: 'italic', fontSize: 15, margin: 0, color: 'var(--ink)', opacity: 0.85 }}>
          {/* days >= 365 is the retention window, i.e. all time — labelled by
              the span actually measured (firstEvent, sent by the server), never
              as "365 days", which over four days of data would be the exact
              fiction the greyed-out pills below exist to avoid. */}
          {data.window === 'today'
            ? 'Today, since midnight UTC'
            : data.days >= ALL_TIME_DAYS
              ? `All time${data.firstEvent ? ` — since ${new Date(data.firstEvent).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : ''}`
              : `Last ${Math.round(data.days)} days`} &mdash; bots excluded by user-agent, and visitors who objected are not counted.
        </p>
        {/* Says when these numbers were fetched, because the page refreshes
            itself hourly and a figure with no timestamp invites a wrong guess
            about how fresh it is. */}
        <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--ink)', opacity: 0.65 }}>
          {busy ? 'Updating…' : lastAt
            ? `Updated ${lastAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · refreshes every minute`
            : 'refreshes every minute'}
        </p>
        {/* A "90 days" tab over three days of data is the same quiet wrongness
            the rest of this page guards against: the number is real, the period
            is a fiction. Collection began 2026-08-23, so a window longer than
            the history is greyed out until it can be filled — measured from the
            OLDEST ROW rather than a hardcoded date, so it also follows the
            retention purge down. */}
        <div role="group" aria-label="Reporting window" style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          {WINDOWS.map((w) => {
            // 'all' is never greyed out: unlike "90 days" over three days of
            // history, "all time" claims no duration, so it cannot overstate one.
            const ready = typeof w !== 'number' || daysCollected >= w;
            return (
              <button
                key={w}
                onClick={() => ready && setDays(w)}
                disabled={!ready}
                aria-pressed={days === w}
                aria-label={w === 'today' ? 'Today' : w === 'all' ? 'All time' : `Last ${w} days`}
                title={ready ? undefined : `Available after ${w} days of collection — ${Math.floor(daysCollected)} so far.`}
                className={`filter-pill${days === w ? ' active' : ''}`}
                // The app's pills are 11px tall by design; this one keeps their look
                // but meets the 44px target the rest of the site uses for controls.
                style={{
                  minHeight: 44, minWidth: 60, justifyContent: 'center', fontSize: 13,
                  ...(ready ? {} : {
                    cursor: 'not-allowed', opacity: 0.45,
                    background: 'var(--sand-100)', color: 'var(--sand-500)',
                    borderColor: 'var(--sand-500)',
                  }),
                }}
              >{windowLabel(w)}</button>
            );
          })}
        </div>
      </div>
    }>
      <div aria-busy={busy} style={{ opacity: busy ? 0.55 : 1, transition: 'opacity 0.15s' }}>

      {empty ? (
        <Section title="Nothing recorded yet">
          <p style={{ ...muted, marginBottom: 0 }}>
            No events in this window. The beacon went live on 23 August 2026, so an empty
            page here means nothing has arrived yet — not that a query failed. If it is
            still empty after a day of real traffic, the likely cause is ad-blockers
            dropping requests to the analytics endpoint rather than a fault in collection.
          </p>
        </Section>
      ) : (
        <>
          {/* UNIQUE VISITORS, named honestly.
              Over ONE day, distinct visitor codes ARE unique visitors — that is
              exactly what the code is for. Over more than one day it is the sum
              of daily figures, because the code is rebuilt at midnight, so
              calling it "visitors" overstates reach to whoever reads it.
              It is called VISITS there instead: one per person per day. Not a
              precise word for a session, but it does not claim unique people,
              and it errs by under-stating sessions rather than over-stating
              reach — the safe direction for a number headed for a pitch.
              ("Visitor-days" was accurate and nobody could read it.) */}
          {/* Flippable like the cumulative row below. Four separate "what does
              this one mean" questions came from this row while it was plain
              tiles — the answer belongs on the tile, not in a conversation. */}
          <div style={tileRow}>
            <FlipTile
              scope="this window"
              label="Pageviews" value={totalViews}
              back="Every page opened in this window, repeat opens included. One person reading four pages counts four times."
            />
            {isOneDay
              ? <FlipTile
                  scope="this window"
                  label="Unique visitors" value={data.funnel.visitors} sub="so far today"
                  back="People, counted once each. Within a single day the count is exact — this is the figure to quote."
                />
              : <>
                  <FlipTile
                    scope="this window"
                    label="Visits" value={data.funnel.visitors} sub="one per person, per day"
                    back="One count per person per day, so three days is three. Larger than the number of people — for that, use Busiest day."
                  />
                  <FlipTile
                    scope="this window"
                    label="Busiest day" value={busiest?.visitors ?? 0} sub={busiest ? `${fmtDay(busiest.day)}, unique` : '—'}
                    back="The most people seen in one day of this window. Exact, because within a day nobody is counted twice."
                  />
                  <FlipTile
                    scope="this window"
                    label="Average day" value={avgPerDay} sub="unique visitors"
                    back="The daily unique counts, averaged across the days in this window. A typical day, not a total."
                  />
                </>}
            <FlipTile
              scope="this window"
              label="Clicks sent out" value={outboundClicks}
              back="Every click on a booking link. One person opening three activities counts three times. Clicks SENT — the partner tells us nothing about what happens next."
            />
            <FlipTile
              scope="this window"
              label="Visitors who clicked out" value={data.funnel.clickedOut} sub={isOneDay ? 'unique, today' : 'visits'}
              back="How many PEOPLE clicked at least one booking link. Someone who clicked three counts once here — the gap against Clicks sent out is how many activities a typical clicker opens."
            />
          </div>

          {/* Moved up, directly under the headline figures: it answers "who are
              these people on" before any of the deeper breakdowns. */}
          <Section title="Devices">
            <Devices d={data.devices} />
          </Section>

          <Section title={byHour ? 'Traffic through the day' : 'Traffic over time'}>
            <TimeChart points={points} byHour={byHour} />
            {byHour && (
              <p style={{ ...muted, fontSize: 12, margin: '10px 0 0' }}>
                Times shown in {localZone().replace('_', ' ')}. The day itself runs midnight to
                midnight UTC — that is the boundary the visitor count is built on, so it cannot
                follow a local clock without changing what &ldquo;unique&rdquo; means.
              </p>
            )}
          </Section>

          {data.allTime && (
            <>
              <p style={{ ...muted, margin: '26px 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                Since counting began{data.firstEvent
                  ? ` · ${fmtDay(data.firstEvent.slice(0, 10))} · ${elapsedSince(data.firstEvent)}`
                  : ''}
              </p>
              <div style={{ ...tileRow, marginTop: 0 }}>
                <FlipTile
                  scope="all time"
                  label="Pageviews" value={data.allTime.views} sub="all time"
                  back="Every page opened, repeat visits included. One person opening four pages counts four. Activity, not people."
                />
                {/* visitor-DAYS, and the back says so at length. This is the
                    largest number on the page and the one most likely to be
                    repeated to somebody as "visitors". */}
                {oneDayOnly
                  ? <FlipTile
                      scope="all time"
                      label="Unique visitors" value={data.allTime.visitorDays} sub="all time — one day so far"
                      back="Counting began today, so this is an exact count of people. From a second day on it becomes visitor-days: one count per person per DAY, which is always larger."
                    />
                  : <FlipTile
                      scope="all time"
                      label="Visits" value={data.allTime.visitorDays} sub="one per person, per day"
                      back="One count per person per day, so somebody who came on three days counts three times. Larger than the number of people — for that, use Best day."
                    />}
                <FlipTile
                  scope="all time"
                  label="Best day" value={data.allTime.busiestDay?.visitors ?? 0}
                  sub={data.allTime.busiestDay ? `${fmtDay(data.allTime.busiestDay.day)}, unique` : '—'}
                  back="The most visitors in a single day. Within one day the count is exact, so this is a true number of people."
                />
                <FlipTile
                  scope="all time"
                  label="Clicks sent out" value={data.allTime.outbound} sub="all time"
                  back="Every click on a booking link. Clicks SENT, never bookings — the partner tells us nothing about what follows."
                />
              </div>
            </>
          )}


          <Section title="Clicks sent to booking partners">
            {/* REQUIRED LABEL — spec. This one exists so a figure from this page
                is never repeated to a partner as a booking. */}
            <p style={warn}>
              <strong>Clicks sent, not bookings.</strong> Viator returns no signal about what converts,
              so this page cannot show bookings, revenue, or a conversion rate — and no number on
              it should ever be described as one. A partner who checks their own figures against
              an inflated claim costs more than the deal is worth.
            </p>
            {data.products.length > 0 && (
              <BarList
                rows={data.products.map((p) => ({ label: p.product, n: p.clicks, sub: `${p.visitors} visitor${p.visitors === 1 ? '' : 's'}` }))}
                color={SERIES[0]}
                unit="clicks"
              />
            )}
            {data.partners.length > 0 && (
              <>
                <h3 style={h3}>By destination</h3>
                <BarList rows={data.partners.map((p) => ({ label: p.host, n: p.clicks }))} color={SERIES[0]} unit="clicks" />
              </>
            )}
            {data.products.length === 0 && data.partners.length === 0 && <p style={muted}>No outbound clicks in this window.</p>}
          </Section>

          <Section title="What people did">
            <Funnel f={data.funnel} oneDay={isOneDay} since={data.firstEvent} />
          </Section>

          {data.questionnaireFunnel && (
            <Section title="Questionnaire drop-off">
              <QuestionnaireDropoff qf={data.questionnaireFunnel} oneDay={isOneDay} />
            </Section>
          )}

          <Section title="Where they came from">
            <div style={{ display: 'grid', gap: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <div>
                <h3 style={h3}>Referrers</h3>
                <Explain>
                  The site a visitor was on immediately before arriving here, as their browser
                  reported it. Anyone typing the address, opening a bookmark or following a link
                  from an app has no referrer at all and is not listed — so this is a partial
                  picture, not a full breakdown of where traffic comes from.
                </Explain>
                {/* Visitors, not pageviews: the browser keeps a referrer across
                    in-app navigation, so counting rows made one visit from
                    Reddit look like five. Our own domain is filtered out in the
                    query — a self-referral is a refresh, not a source. */}
                <BarList rows={data.referrers.map((r) => ({ label: r.host, n: r.n }))} color={SERIES[0]} unit={isOneDay ? 'unique' : 'visits'} />
              </div>
              <div>
                <h3 style={h3}>Campaigns</h3>
                <Explain>
                  Links you tag yourself. Post <code>10daysonaruba.com/?ref=reddit-aruba-aug</code> and
                  everyone arriving through it is counted under that name — so you can tell which post
                  or which channel actually sent people, even when the browser reports no referrer.
                  You choose the name; it must be lower-case letters, numbers and dashes.
                </Explain>
                <BarList rows={data.campaigns.map((c) => ({ label: c.campaign, n: c.n }))} color={SERIES[0]} unit={isOneDay ? 'unique' : 'visits'} />
                <p style={{ ...muted, fontSize: 12 }}>
                  A campaign's outbound clicks can only be joined to its visitors within a single UTC
                  day — across days that link does not exist.
                </p>
              </div>
              <div>
                <h3 style={h3}>Countries</h3>
                <Explain>
                  Worked out from the visitor's network address on our own servers, which is then
                  discarded. Right about 95–99% of the time; a VPN reports wherever it exits.
                </Explain>
                <BarList rows={data.countries.map((c) => ({ label: countryName(c.country), n: c.n }))} color={SERIES[0]} unit="visitors" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <h3 style={h3}>Pages</h3>
                <Explain>
                  How many {isOneDay ? 'people' : 'visits'} reached each page, and what share of all
                  of them that is — so &ldquo;a fifth of visitors got to Explore&rdquo; is readable
                  rather than something to work out. Opens are shown after it, which is a different
                  number: one person opening a page three times is three opens and one visitor.{' '}
                  <code>/i/:slug</code> is a shared itinerary — all of them pooled, so a page view can
                  never be tied to one traveller's plan.
                </Explain>
                <BarList
                  rows={data.topPaths.map((p) => ({
                    label: p.path,
                    n: p.visitors ?? p.n,
                    sub: `${p.n} open${p.n === 1 ? '' : 's'}`
                      + (allVisitors > 0 && p.visitors !== undefined
                        ? ` · ${Math.round((p.visitors / allVisitors) * 100)}% of all`
                        : ''),
                  }))}
                  color={SERIES[0]}
                  unit={isOneDay ? 'unique' : 'visits'}
                  // The bar is the share of ALL visitors, so its length matches
                  // the percentage printed beside it. Scaled to the biggest row
                  // instead, the home page would always draw a full bar however
                  // small its share and the picture would contradict the number.
                  scaleTo={allVisitors}
                  valueWidth="27ch"
                />
                <p style={{ ...muted, fontSize: 12, margin: '8px 0 0' }}>
                  Share of the {allVisitors} {isOneDay ? 'visitors' : 'visits'} counted in this
                  window. They do not add up to that: a visitor appears on every page they opened,
                  and not everyone starts on the home page — some arrive straight on a shared
                  itinerary.
                </p>
              </div>
            </div>
          </Section>

          <Section title="Unique visitors, by day — most recent 14">
            {/* REQUIRED LABEL — spec, and it is on the tile rather than in a
                tooltip on purpose. This is the figure someone quotes. */}
            {/* REQUIRED LABEL — spec. Kept to the one guarantee it has to make:
                each bar is exact, the bars do not add up. The reasoning behind
                that, and what to say instead, lives in the section note below
                rather than in the reader's way. */}
            <p style={warn}>
              <strong>Each bar is an exact count of people. The bars cannot be added up.</strong>{' '}
              The visitor code is rebuilt at midnight, so one person visiting on five days is five.
            </p>
            <BarList
              rows={data.daily.slice(-14).map((d) => ({ label: fmtDay(d.day), n: d.visitors }))}
              color={SERIES[1]}
              unit="unique"
            />
            <p style={{ ...muted, fontSize: 12, margin: '12px 0 0' }}>
              Asked &ldquo;how many people last month&rdquo;, the answerable figures are the best
              day, the average day and total visits. A monthly unique count does not exist here:
              recognising someone across days needs an identifier kept on their device, which is
              the thing this design avoids in order to count everyone rather than only those who
              accept cookies.
            </p>
          </Section>




        </>
      )}

      <p style={{ ...muted, fontSize: 12, marginTop: 40, paddingTop: 16, borderTop: `1px solid ${GRID}` }}>
        Counted without storing anything of ours on a visitor's device, so this is all traffic
        rather than the share who accept cookies. Visitors who have objected under the Privacy Policy are not
        counted at all.
        {' '}
        {/* CC BY 4.0 requires attribution wherever the data is shown. Not optional,
            and not a footnote we may drop when this page is redesigned. */}
        Country data from <a href="https://db-ip.com" target="_blank" rel="noreferrer noopener" style={{ color: 'inherit' }}>IP&nbsp;Geolocation by DB-IP</a>,
        licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer noopener" style={{ color: 'inherit' }}>CC&nbsp;BY&nbsp;4.0</a>.
      </p>
      <button onClick={() => setPage('landing')} style={{ ...linkBtn, marginTop: 24 }}>← Back to the site</button>
      </div>
    </Shell>
  );
}

/**
 * The dashboard's OWN sign-in, deliberately not the site's login modal.
 *
 * The modal is the traveller's control — it lives in the nav, it is styled for
 * them, and its copy is about saving trips. Reusing it here would mean one
 * component serving two audiences with different needs, and every future change
 * to the traveller flow would have to be checked against this page.
 *
 * The link comes back to /stats: signInWithEmail passes the current path as the
 * return URL. If Supabase's redirect allowlist rejects it the traveller lands on
 * the home page instead, which is why App.tsx keeps a one-shot marker and
 * forwards them here after the session resolves.
 */
function SignIn() {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || phase === 'sending') return;
    setPhase('sending');
    // Survives the round trip through the mail client, so whichever page the
    // link lands on, App.tsx can bring them back here.
    try { sessionStorage.setItem(AFTER_LOGIN_KEY, '1'); } catch { /* private mode */ }
    const { error } = await signInWithEmail(email.trim());
    if (error) { setPhase('error'); setMessage(error); return; }
    setPhase('sent');
  }

  return (
    <div style={{ ...card, maxWidth: 460 }}>
      <h1 className="font-display" style={{ fontSize: 28, margin: '0 0 6px' }}>Traffic</h1>
      <p style={{ ...muted, marginBottom: 18 }}>Sign in to continue.</p>

      {phase === 'sent' ? (
        <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          <strong>Check your inbox.</strong> The link signs you in and brings you back to this
          page. It expires in an hour and can only be used once.
        </p>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="stats-email" style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.6, marginBottom: 6 }}>
            Email
          </label>
          <input
            id="stats-email" type="email" required autoComplete="email" value={email}
            onChange={(e) => { setEmail(e.target.value); if (phase === 'error') setPhase('idle'); }}
            placeholder="you@10daysonaruba.com"
            style={{
              width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '0 12px',
              fontFamily: 'inherit', fontSize: 15, color: 'var(--ink)',
              background: 'var(--cream)', border: '2px solid var(--ink)', borderRadius: 12,
            }}
          />
          <button type="submit" className="btn-red" disabled={phase === 'sending'}
            style={{ marginTop: 14, minHeight: 44, width: '100%', opacity: phase === 'sending' ? 0.7 : 1 }}>
            {phase === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </button>
          {phase === 'error' && (
            <p style={{ ...warn, marginTop: 14, marginBottom: 0 }}>{message || 'That did not work. Try again.'}</p>
          )}
          <p style={{ ...muted, fontSize: 12, margin: '14px 0 0' }}>
            A link rather than a password: nothing to store, share or leak, and access is
            withdrawn by removing an address rather than changing a secret everyone knows.
          </p>
        </form>
      )}
    </div>
  );
}

/**
 * A short "what this is" under a sub-heading.
 *
 * These read as clutter until somebody asks what a column means — which is
 * exactly what happened with Referrers, where a row saying "10daysonaruba.com"
 * looked like an acquisition source and was a page refresh. The dashboard is
 * read by two people a few times a week, not memorised, so the definition
 * belongs beside the number rather than in a document nobody opens.
 */
function Explain({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 12, lineHeight: 1.55, margin: '0 0 10px', color: 'var(--ink)', opacity: 0.62 }}>
      {children}
    </p>
  );
}

/* ---------------------------------------------------------------- chrome --- */

/** "Loading…" with the seconds visible, so slow is distinguishable from frozen. */
function LoadingNote() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <p style={muted}>
      Loading…{secs >= 4 && ` ${secs}s`}
      {secs >= 10 && ' — this is slower than usual; it gives up at 30s.'}
    </p>
  );
}

function Shell({ hero, children }: { hero?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {/* The amber bleed band every section page on this site opens with — see
          Explore. Without it the dashboard reads as a different product. */}
      {hero && <div className="bleed" style={{ background: 'var(--yellow-bg)' }}>{hero}</div>}
      <div className="bleed" style={{ background: 'var(--cream)', minHeight: '80vh' }}>
        <div className="container-1280" style={{ padding: hero ? '28px 36px 80px' : '48px 36px 80px', maxWidth: 1000 }}>{children}</div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...card, padding: 0, marginTop: 22, overflow: 'hidden' }}>
      <h2 className="card-header-band" style={{ margin: 0 }}>
        {/* .chb-title is nowrap+ellipsis because activity titles are one line on
            a card; a section heading here would truncate on a phone, so it wraps. */}
        <span className="chb-title" style={{ fontSize: 14, whiteSpace: 'normal', overflow: 'visible' }}>{title}</span>
      </h2>
      <div style={{ padding: '18px 20px 20px' }}>{children}</div>
    </section>
  );
}

/**
 * A tile that turns over to explain itself.
 *
 * Uses the site's own flip — `.flip-card` / `.flip-inner` / `.flip-back` from
 * index.css, the same 0.55s rotateY the itinerary and explore cards use — rather
 * than a second animation that would be almost but not quite the same.
 *
 * The back matters more here than on an activity card: every figure in this row
 * is a count of something subtly different, and "visitor-days" in particular is
 * the number most likely to be repeated to somebody as "visitors".
 */
function FlipTile({ label, value, sub, back, scope }: { label: string; value: number; sub?: string; back: string; scope: string }) {
  const [flipped, setFlipped] = useState(false);
  const face: React.CSSProperties = { ...card, margin: 0, height: '100%', boxSizing: 'border-box' };
  return (
    <div className={`flip-card stat-flip${flipped ? ' flipped' : ''}`} // The back is position:absolute inset:0, so it can never grow the card — the
      // front sets the height and the copy has to fit it. Measured at this width:
      // about five lines. Longer text clips rather than expanding.
      style={{ flex: '1 1 210px', minHeight: 200 }}>
      <div className="flip-inner">
        <div className="flip-face" style={face}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700, opacity: 0.6, marginBottom: 8 }}>{label}</div>
            <button
              onClick={() => setFlipped(true)}
              // The scope is part of the ACCESSIBLE NAME, not decoration: the
              // same labels appear in the window row and the all-time row, and
              // "How to read: Pageviews" would name two different buttons.
              aria-label={`How to read: ${label} (${scope})`}
              title={`How to read: ${label}`}
              style={infoBtn}
            >i</button>
          </div>
          <div className="font-display" style={{ fontSize: 36, lineHeight: 1 }}>{value.toLocaleString('en-GB')}</div>
          {sub && <div style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>{sub}</div>}
        </div>
        <div className="flip-face flip-back" style={face}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700, opacity: 0.6 }}>{label}</div>
            <button onClick={() => setFlipped(false)} aria-label="Back" title="Back" style={infoBtn}>×</button>
          </div>
          <p style={{ fontSize: 12.5, lineHeight: 1.55, margin: '8px 0 0' }}>{back}</p>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div style={{ ...card, flex: '1 1 180px', margin: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700, opacity: 0.6, marginBottom: 8 }}>{label}</div>
      <div className="font-display" style={{ fontSize: 36, lineHeight: 1 }}>{value.toLocaleString('en-GB')}</div>
      {sub && <div style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- marks --- */

/**
 * Two series over time. One axis — never two scales on one chart, which is the
 * mistake that makes a small series look like a big one.
 *
 * Pageviews and visitors share a scale honestly: visitors are a subset of
 * pageviews, so the visitor line sitting under the pageview line is the true
 * relationship rather than an artefact of scaling.
 */
function TimeChart({ points: daily, byHour }: { points: Point[]; byHour: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  // MEASURED width, drawn 1:1. A fixed viewBox scaled with width:100% scales the
  // TEXT too: at a 390px viewport an 880-wide chart renders at 0.31, which put
  // the axis and date labels at 3.4px — a smear. Measuring means 11px is 11px on
  // a phone, and it is also what makes the hit area below usable.
  const [w, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    // Guarded because an exception here does not cost the chart, it costs the
    // PAGE — there is no error boundary above this, so a throw in the effect
    // unmounts the whole dashboard. jsdom has no ResizeObserver and demonstrated
    // exactly that. Without it the default width still renders a correct chart.
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220, PAD_L = 40, PAD_B = 26, PAD_T = 22, PAD_R = 10;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.views, d.visitors)));
  const plotW = w - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const x = (i: number) => PAD_L + (daily.length === 1 ? plotW / 2 : (i / (daily.length - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const path = (key: 'views' | 'visitors') =>
    daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  // Deduped: with max === 1 the three ticks collapse to [0, 1, 1], which draws a
  // doubled gridline and hands React two children with the same key.
  const ticks = useMemo(() => [...new Set([0, Math.round(max / 2), max])], [max]);
  // Above this the numbers collide into an unreadable band; the dataviz rule is
  // selective labels, never one on every point. 14 fits the widths this page
  // renders at, and covers a day of hours and a fortnight of days.
  const labelled = daily.length > 1 && daily.length <= 14;

  // ONE overlay rather than a hit rect per point. Per-point targets are 2.5px
  // wide at 390px with a 90-day window — untappable, and unhittable with a mouse
  // too. This finds the nearest day from the pointer's x, so the target is the
  // whole plot at any width, and it works for touch: a tap fires pointer/mouse
  // events, so the readout appears and stays until the next tap elsewhere.
  const pick = (clientX: number) => {
    const el = box.current;
    if (!el || daily.length === 0) return;
    const rect = el.getBoundingClientRect();
    const rel = clientX - rect.left - PAD_L;
    const step = daily.length === 1 ? plotW : plotW / (daily.length - 1);
    setHover(Math.max(0, Math.min(daily.length - 1, Math.round(rel / step))));
  };

  if (daily.length === 0) return <p style={muted}>Nothing recorded in this window yet.</p>;

  const shown = hover !== null && daily[hover] ? daily[hover] : daily[daily.length - 1];

  return (
    <figure style={{ margin: 0 }} ref={box}>
      {/* A legend is always present for two series, so identity is never carried
          by colour alone. */}
      <div style={{ display: 'flex', gap: 18, marginBottom: 8, fontSize: 12, flexWrap: 'wrap' }}>
        <Key color={SERIES[0]} label="Pageviews" />
        {/* Hourly uniques are distinct codes seen WITHIN that hour, and summing
            the hours over-counts the same way summing days does. Named so. */}
        <Key color={SERIES[1]} label={byHour ? 'Unique visitors (in that hour)' : 'Unique visitors (daily)'} />
      </div>
      <svg
        width={w} height={H} viewBox={`0 0 ${w} ${H}`}
        role="img" aria-label={byHour ? 'Pageviews and unique visitors by hour' : 'Pageviews and daily unique visitors over time'}
        style={{ display: 'block', touchAction: 'pan-y' }}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => pick(e.touches[0].clientX)}
        onTouchMove={(e) => pick(e.touches[0].clientX)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={w - PAD_R} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK} opacity={0.55}>{t}</text>
          </g>
        ))}
        <path d={path('views')} fill="none" stroke={SERIES[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={path('visitors')} fill="none" stroke={SERIES[1]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* Dots and their values, drawn only when the series is short enough to
            read. A number above every point across ninety days is a smear, so
            past the threshold the line speaks for itself and the hover readout
            gives the exact figure. A single bucket ALWAYS gets its dot — one
            moveto strokes nothing, and that is how this chart came to render
            completely empty. */}
        {(labelled || daily.length === 1) && daily.map((d, i) => (
          <g key={`pt-${d.key}`}>
            <circle cx={x(i)} cy={y(d.views)} r={4} fill={SERIES[0]} stroke="var(--sand-50)" strokeWidth={2} />
            <circle cx={x(i)} cy={y(d.visitors)} r={4} fill={SERIES[1]} stroke="var(--sand-50)" strokeWidth={2} />
            {labelled && (
              <>
                {/* Views above their dot, visitors below theirs, so the two
                    never land on each other when the lines converge. */}
                <text x={x(i)} y={y(d.views) - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>{d.views}</text>
                <text x={x(i)} y={y(d.visitors) + 18} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK} opacity={0.75}>{d.visitors}</text>
              </>
            )}
          </g>
        ))}
        {hover !== null && daily[hover] && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} stroke={INK} strokeWidth={1} opacity={0.25} />
            {/* A 2px surface ring keeps the two markers separable where they meet. */}
            <circle cx={x(hover)} cy={y(daily[hover].views)} r={4} fill={SERIES[0]} stroke="var(--sand-50)" strokeWidth={2} />
            <circle cx={x(hover)} cy={y(daily[hover].visitors)} r={4} fill={SERIES[1]} stroke="var(--sand-50)" strokeWidth={2} />
          </>
        )}
        <text x={PAD_L} y={H - 6} fontSize={11} fill={INK} opacity={0.55}>{daily[0].label}</text>
        {daily.length > 1 && (
          <text x={w - PAD_R} y={H - 6} textAnchor="end" fontSize={11} fill={INK} opacity={0.55}>{daily[daily.length - 1].label}</text>
        )}
      </svg>
      {/* Always rendered, never conditionally. Mounting this on hover grew the
          figure by ~24px and shunted every section below it up and down. */}
      <div style={{ fontSize: 12, marginTop: 6, minHeight: 18, opacity: hover === null ? 0.55 : 1 }}>
        <strong>{shown.label}</strong> — {shown.views} pageview{shown.views === 1 ? '' : 's'},{' '}
        {shown.visitors} visitor{shown.visitors === 1 ? '' : 's'}
        {hover === null && (
          <span style={{ opacity: 0.7 }}> (latest {byHour ? 'hour' : 'day'}; hover or tap the chart for another)</span>
        )}
      </div>
    </figure>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      {/* Text keeps ink colour; the swatch beside it carries identity. */}
      <span style={{ color: INK, opacity: 0.75 }}>{label}</span>
    </span>
  );
}

/**
 * Ranked magnitude. One hue: colour here encodes nothing that the label does not
 * already say, so varying it would imply a grouping that does not exist.
 * Every bar is directly labelled, which is also what discharges the validator's
 * contrast warning for the lighter series colours.
 */
function BarList({ rows, color, unit, scaleTo, valueWidth = '11.5ch' }: {
  rows: { label: string; n: number; sub?: string }[];
  color: string;
  unit: string;
  /**
   * Denominator for the bar length. Omitted, bars are relative to the biggest
   * row — right for a ranking, where the question is "which is largest".
   * Supplied, the bar is that share of the WHOLE, which is what a row claiming
   * "20% of all" has to look like: at row-relative scale the top row is always
   * a full bar however small its share, and the picture contradicts the number
   * printed beside it.
   */
  scaleTo?: number;
  /** Width of the value column. Fixed so every bar track is identical. */
  valueWidth?: string;
}) {
  if (rows.length === 0) return <p style={muted}>Nothing in this window.</p>;
  const denom = scaleTo && scaleTo > 0 ? scaleTo : Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul style={{ listStyle: 'none', margin: '0 0 4px', padding: 0, display: 'grid', gap: 6 }}>
      {rows.map((r) => (
        // FIXED value column, not `auto`. With `auto` the column took whatever
        // its text needed, so a long value ("24 unique · 47 opens · 80% of all")
        // squeezed the bar track while a short one ("1 unique · 3%") left it
        // wide — every row measured against a different track, and the bars came
        // out backwards: 24 visitors drew a sliver, 1 visitor drew a wider bar.
        // A fixed column makes every track identical, which is the only way the
        // lengths mean anything.
        <li key={r.label} className="stat-bar-row" style={{ display: 'grid', gridTemplateColumns: `minmax(76px, 26%) 1fr ${valueWidth}`, alignItems: 'center', gap: 10, fontSize: 13 }}>
          {/* Wraps rather than ellipsising. On a phone the label column is
              narrow, and "Started the questionnaire" truncated to "Started the …"
              loses the only thing that made the funnel row mean anything.
              overflowWrap handles the other case — a product code is one long
              token with nowhere to break. */}
          <span style={{ overflowWrap: 'anywhere' }} title={r.label}>{r.label}</span>
          <span style={{ background: 'var(--sand-100)', borderRadius: 4, height: 16, border: '1px solid var(--sand-200)' }}>
            <span style={{
              display: 'block', height: '100%',
              // Clamped: a share can exceed the denominator in edge cases, and a
              // bar wider than its track escapes the row.
              width: `${Math.min(Math.max((r.n / denom) * 100, 1.5), 100)}%`,
              background: color, borderRadius: 3,
            }} />
          </span>
          <span
            style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.75, textAlign: 'right', whiteSpace: 'nowrap' }}
            title={r.sub ? `${r.n} ${unit} — ${r.sub}` : `${r.n} ${unit}`}
          >
            {/* The unit is VISIBLE, not screen-reader-only. It was `sr-only`
                first, which this app has never defined as a class, so it
                rendered inline and produced "66 · 100% of visitors visitors". */}
            {r.n.toLocaleString('en-GB')} {r.n === 1 ? unit.replace(/s$/, '') : unit}{r.sub ? ` · ${r.sub}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The funnel, in FUNNEL ORDER rather than sorted by size — the order is the
 * meaning. Steps can legitimately widen: a visitor may click out without ever
 * generating an itinerary, so this is a set of counts, not a strict nesting.
 */
function Funnel({ f, oneDay, since }: { f: Summary['funnel']; oneDay: boolean; since?: string | null }) {
  // All five steps are instrumented as of 2026-08-23 (plan Task 9). The three
  // middle ones fire from Questionnaire.tsx and Itinerary.tsx via
  // trackMilestoneOnce, so they are counted per visitor rather than per action.
  const steps = [
    ['Visited', f.visitors],
    ['Started the questionnaire', f.questionnaire],
    ['Generated an itinerary', f.generated],
    ['Saved or shared it', f.kept],
    ['Clicked out to a partner', f.clickedOut],
  ] as const;
  // The milestones were wired at this instant; visits before it produced
  // pageviews and outbound clicks but no middle steps, so a window spanning the
  // change shows a dip that is instrumentation rather than behaviour. Said out
  // loud until the window no longer reaches back past it.
  const WIRED_AT = Date.parse('2026-08-23T19:00:00Z');
  const spansTheGap = !!since && Date.parse(since) < WIRED_AT;
  return (
    <>
      <BarList rows={steps.map(([label, n]) => ({
        label,
        n,
        sub: f.visitors > 0 ? `${Math.round((n / f.visitors) * 100)}%` : undefined,
      }))} color={SERIES[0]} unit={oneDay ? 'unique' : 'visits'} />
      {spansTheGap && (
        <p style={{ ...warn, marginTop: 14 }}>
          <strong>The middle three steps start on 23 August.</strong> They were wired up that
          evening, so anyone who visited before it is counted in the first and last rows only.
          Expect those three to look low until this window no longer reaches back that far.
        </p>
      )}
      <p style={{ ...muted, fontSize: 12, marginBottom: 0 }}>
        {oneDay
          ? 'Each step counts unique visitors.'
          : 'Each step counts distinct daily visitor codes, so a person planning across two days is two.'}{' '}
        <strong>These are counts, not a funnel, and a later step can be larger than an earlier
        one.</strong> Somebody returning with their answers already saved goes straight to the
        itinerary, so a plan is generated for them without a questionnaire being started; and a
        visitor can click out to a partner without generating anything at all.
      </p>
    </>
  );
}

/**
 * At which question travellers stop. Labels are duplicated from
 * Questionnaire.tsx by design — importing QUESTIONS would lazy-load the whole
 * questionnaire chunk into the dashboard for seven strings, and a renamed
 * question showing a stale label here misleads nobody: the counts are keyed by
 * step number, not by title.
 */
function QuestionnaireDropoff({ qf, oneDay }: {
  qf: NonNullable<Summary['questionnaireFunnel']>; oneDay: boolean;
}) {
  const TITLES: Record<number, string> = {
    2: "Who's with you?", 3: "What's your budget vibe?", 4: 'What energizes you on vacation?',
    5: 'Adventure level?', 6: 'When are you visiting?', 7: 'Anything we should know?',
  };
  const pctOf = (n: number) => (qf.viewed > 0 ? `${Math.round((n / qf.viewed) * 100)}%` : undefined);
  // Q2..Q7 arrivals, then the Build press as the terminal row. "Stopped here"
  // is this row minus the next — computed only between these rows, which share
  // one semantics (a q_reached milestone) and one clamped window, so the
  // difference really is people whose last question this was. Negative noise
  // (a midnight-UTC hash split) prints nothing rather than "-1 stopped".
  const qRows = Object.keys(TITLES).map((k) => ({
    label: `Q${k} · ${TITLES[Number(k)]}`,
    n: qf.reached[`q_reached_${k}`] ?? 0,
  }));
  const finished = qf.reached['q_reached_8'] ?? 0;
  const rows = [
    { label: 'Opened the questionnaire', n: qf.viewed, sub: pctOf(qf.viewed) },
    { label: 'Q1 · How long is your stay?', n: qf.started, sub: pctOf(qf.started) },
    ...qRows.map((r, i) => {
      const next = i + 1 < qRows.length ? qRows[i + 1].n : finished;
      const stopped = r.n - next;
      return { ...r, sub: [pctOf(r.n), stopped > 0 ? `${stopped} stopped here` : null].filter(Boolean).join(' · ') };
    }),
    { label: 'Pressed "Build my itinerary"', n: finished, sub: pctOf(finished) },
  ];
  return (
    <>
      <Explain>
        Every number is people who got at least as far as that row, counting from the evening
        of 25 August when this tracking went live — deliberately a shorter reach than the rest
        of the page, so these rows always compare like with like. Read top to bottom:
        &ldquo;stopped here&rdquo; on a question is that row minus the next — the people whose
        last question it was. Q1 plays by a different rule: it counts a first <em>answer</em>,
        and the landing button answers Q1 with its slider and drops people straight into Q2 —
        so Q2 sitting above Q1 means most visitors came via that button, not that people
        skipped a question.
      </Explain>
      <BarList rows={rows} color={SERIES[1]} unit={oneDay ? 'unique' : 'visits'} />
    </>
  );
}

function Devices({ d }: { d: Record<string, number> }) {
  const order = ['mobile', 'tablet', 'desktop'];
  const rows = order.filter((k) => d[k]).map((k) => ({ label: k, n: d[k], color: SERIES[order.indexOf(k)] }));
  if (rows.length === 0) return <p style={muted}>Nothing in this window.</p>;
  const total = rows.reduce((s, r) => s + r.n, 0);
  return (
    <>
      <div style={{ display: 'flex', gap: 2, height: 22, marginBottom: 12, border: '2px solid var(--ink)', borderRadius: 8, overflow: 'hidden', background: 'var(--sand-100)' }}>
        {rows.map((r) => (
          <span key={r.label} title={`${r.label}: ${r.n}`} style={{ width: `${(r.n / total) * 100}%`, background: r.color }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
        {rows.map((r) => (
          <Key key={r.label} color={r.color} label={`${r.label} — ${r.n.toLocaleString('en-GB')} (${Math.round((r.n / total) * 100)}%)`} />
        ))}
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- style --- */

// `.chunky` in src/index.css is the house card: cream on cream, held by a 2px
// ink border and a hard offset shadow rather than by a fill. Written out here
// rather than using the class because these need their own padding.
const card: React.CSSProperties = {
  background: 'var(--sand-50)', border: '2px solid var(--ink)',
  borderRadius: 16, boxShadow: '4px 4px 0 var(--ink)', padding: '20px 22px',
};
const tileRow: React.CSSProperties = { display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 };
const h2: React.CSSProperties = { fontSize: 20, margin: '0 0 16px' };
const h3: React.CSSProperties = { fontSize: 13, margin: '16px 0 8px', opacity: 0.7 };
const muted: React.CSSProperties = { fontSize: 13, color: 'var(--ink)', opacity: 0.55, margin: '0 0 12px' };
const warn: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.6, margin: '0 0 16px', padding: '12px 14px',
  background: 'rgba(230,57,70,0.07)', border: '2px solid var(--red)', borderRadius: 12,
};
const infoBtn: React.CSSProperties = {
  flexShrink: 0, width: 26, height: 26, borderRadius: 999, cursor: 'pointer',
  border: '2px solid var(--ink)', background: 'var(--cream)', color: 'var(--ink)',
  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, lineHeight: 1, padding: 0,
};

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
  color: 'var(--ink)', opacity: 0.5, padding: 0, fontFamily: 'inherit',
};

/**
 * How long the record covers, in the largest unit that is not a lie.
 *
 * Sits next to the date because the date alone does not say how much history
 * backs these figures — and that is the same fact the greyed-out window tabs
 * are expressing. "23 Aug" reads as a long time ago by next month; "5 hours of
 * data" cannot.
 */
function elapsedSince(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} of data`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} of data`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} days of data`;
  const weeks = Math.floor(days / 7);
  return weeks < 9 ? `${weeks} weeks of data` : `${Math.floor(days / 30)} months of data`;
}

/**
 * An hour bucket, in the READER'S timezone.
 *
 * The buckets are UTC — everything in this pipe is, because the visitor code is
 * rebuilt at midnight UTC and the daily counts are built on that boundary. But
 * "16:00" means nothing to somebody in Amsterdam looking at their own evening
 * traffic, and reading a graph against a clock two hours off your own is a way
 * to draw the wrong conclusion about when people visit.
 *
 * So the DAYS stay UTC and the HOURS are shown locally, with the page saying so
 * rather than leaving it to be discovered. Uses the viewer's own zone rather
 * than a hardcoded Europe/Amsterdam, so it stays right when read from Aruba.
 */
function fmtHour(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(11, 16)
    // en-GB for the 24-hour clock, matching the "Updated 18:24" line above and
    // the rest of the page's number formatting. The ZONE is still the reader's;
    // only the notation is pinned, so this does not become 04:00 PM for a
    // browser set to US English.
    : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** The reader's timezone, named, so the chart can say which clock it is using. */
function localZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local time'; }
  catch { return 'your local time'; }
}

/**
 * "AW" -> "Aruba".
 *
 * Intl.DisplayNames is built into the browser, so the whole ISO-3166 list costs
 * nothing to ship — a hand-kept map would be ~250 lines that slowly goes stale.
 * Falls back to the raw code if the runtime lacks it or the code is unknown,
 * because a two-letter code is a worse label than a name but a far better one
 * than nothing.
 */
const countryName: (code: string) => string = (() => {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    return (code) => { try { return dn.of(code) ?? code; } catch { return code; } };
  } catch { return (code) => code; }
})();

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
