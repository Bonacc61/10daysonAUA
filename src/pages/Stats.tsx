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
type Counted = { n: number };
type Summary = {
  days: number;
  daily: Daily[];
  topPaths: (Counted & { path: string })[];
  referrers: (Counted & { host: string })[];
  campaigns: (Counted & { campaign: string })[];
  countries: (Counted & { country: string })[];
  devices: Record<string, number>;
  funnel: { visitors: number; questionnaire: number; generated: number; kept: number; clickedOut: number };
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

const WINDOWS = [7, 30, 90] as const;

export default function Stats({ setPage }: Props) {
  const { session, loading } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Summary | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading');
  const [busy, setBusy] = useState(false);

  const token = session?.access_token;

  useEffect(() => {
    // Still resolving the session: hold, or a signed-in admin sees "Not
    // available" flash before their own dashboard appears.
    if (loading) return;
    // No token means no request. A signed-out visitor should not cause a call to
    // an internal endpoint at all — the 403 would be correct and still pointless.
    if (!token) { setState('denied'); return; }
    // Read inside the effect, not at module scope: both are optional in
    // ImportMetaEnv, and a build missing either should render the error state
    // rather than fetch an empty URL and report the failure as a denial.
    const url = import.meta.env.VITE_STATS_FN_URL ?? '';
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
    if (!url || !anon) { setState('error'); return; }

    let live = true;
    // Only blank the page when there is nothing to show. Re-fetching for a new
    // window used to unmount the entire dashboard — scroll jumped to the top and
    // the window buttons disappeared mid-flight, so you could not change your
    // mind. Stale numbers stay up instead, dimmed, until the new ones land.
    setState((prev) => (prev === 'ok' ? 'ok' : 'loading'));
    setBusy(true);
    fetch(`${url}?days=${days}`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Summary) => { if (live) { setData(d); setState('ok'); } })
      .catch((s) => { if (live) setState(s === 401 || s === 403 ? 'denied' : 'error'); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [token, loading, days]);

  if (loading || state === 'loading') return <Shell><p style={muted}>Loading…</p></Shell>;

  // Signed out, signed in as a traveller, or the endpoint said no — all the same
  // page. No login prompt: an invitation to try is an invitation to try.
  if (state === 'denied') {
    return (
      <Shell>
        <h1 className="font-display" style={{ fontSize: 32, margin: '0 0 8px' }}>Not available</h1>
        <p style={muted}>This page isn't available.</p>
        <button onClick={() => setPage('landing')} style={linkBtn}>← Back to the site</button>
      </Shell>
    );
  }

  if (state === 'error' || !data) {
    return (
      <Shell>
        <h1 className="font-display" style={{ fontSize: 32, margin: '0 0 8px' }}>Stats unavailable</h1>
        <p style={muted}>The stats service did not answer. Nothing is wrong with collection — the beacon writes independently of this page.</p>
        <button onClick={() => setPage('landing')} style={linkBtn}>← Back to the site</button>
      </Shell>
    );
  }

  const totalViews = (data.daily ?? []).reduce((s, d) => s + d.views, 0);
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
          Last {data.days} days &mdash; bots excluded by user-agent, and visitors who objected are not counted.
        </p>
        <div role="group" aria-label="Reporting window" style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              aria-label={`Last ${w} days`}
              className={`filter-pill${days === w ? ' active' : ''}`}
              // The app's pills are 11px tall by design; this one keeps their look
              // but meets the 44px target the rest of the site uses for controls.
              style={{ minHeight: 44, minWidth: 60, justifyContent: 'center', fontSize: 13 }}
            >{w} days</button>
          ))}
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
          <div style={tileRow}>
            <Tile label="Pageviews" value={totalViews} />
            <Tile label="Busiest day" value={busiest?.visitors ?? 0} sub={busiest ? fmtDay(busiest.day) : '—'} />
            <Tile label="Clicks sent out" value={outboundClicks} />
            <Tile label="Visitors who clicked out" value={data.funnel.clickedOut} sub={`of ${data.funnel.visitors} counted`} />
          </div>

          <Section title="Traffic over time">
            <TimeChart daily={data.daily} />
          </Section>

          <Section title="Daily unique visitors — most recent 14 days">
            {/* REQUIRED LABEL — spec, and it is on the tile rather than in a
                tooltip on purpose. This is the figure someone quotes. */}
            <p style={warn}>
              <strong>These cannot be added up.</strong> The visitor code is rebuilt from scratch every
              midnight UTC, so somebody who visits on five days counts as five. Monthly unique
              visitors are not measurable here, by design — summing the days below gives a
              number that means nothing.
            </p>
            <BarList
              rows={data.daily.slice(-14).map((d) => ({ label: fmtDay(d.day), n: d.visitors }))}
              color={SERIES[1]}
              unit="visitors"
            />
          </Section>

          <Section title="What people did">
            <Funnel f={data.funnel} />
          </Section>

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

          <Section title="Where they came from">
            <div style={{ display: 'grid', gap: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <div>
                <h3 style={h3}>Referrers</h3>
                <BarList rows={data.referrers.map((r) => ({ label: r.host, n: r.n }))} color={SERIES[0]} unit="pageviews" />
              </div>
              <div>
                <h3 style={h3}>Campaigns</h3>
                <BarList rows={data.campaigns.map((c) => ({ label: c.campaign, n: c.n }))} color={SERIES[0]} unit="pageviews" />
                <p style={{ ...muted, fontSize: 12 }}>
                  From <code>?ref=</code> links you control. A campaign's clicks can only be joined to its
                  visitors within a single UTC day — across days the link does not exist.
                </p>
              </div>
              <div>
                <h3 style={h3}>Countries</h3>
                <BarList rows={data.countries.map((c) => ({ label: c.country, n: c.n }))} color={SERIES[0]} unit="visitors" />
              </div>
              <div>
                <h3 style={h3}>Pages</h3>
                <BarList rows={data.topPaths.map((p) => ({ label: p.path, n: p.n }))} color={SERIES[0]} unit="pageviews" />
              </div>
            </div>
          </Section>

          <Section title="Devices">
            <Devices d={data.devices} />
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

/* ---------------------------------------------------------------- chrome --- */

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
function TimeChart({ daily }: { daily: Daily[] }) {
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

  const H = 220, PAD_L = 40, PAD_B = 26, PAD_T = 12, PAD_R = 10;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.views, d.visitors)));
  const plotW = w - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const x = (i: number) => PAD_L + (daily.length === 1 ? plotW / 2 : (i / (daily.length - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const path = (key: 'views' | 'visitors') =>
    daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  // Deduped: with max === 1 the three ticks collapse to [0, 1, 1], which draws a
  // doubled gridline and hands React two children with the same key.
  const ticks = useMemo(() => [...new Set([0, Math.round(max / 2), max])], [max]);

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

  if (daily.length === 0) return <p style={muted}>No days with traffic in this window.</p>;

  const shown = hover !== null && daily[hover] ? daily[hover] : daily[daily.length - 1];

  return (
    <figure style={{ margin: 0 }} ref={box}>
      {/* A legend is always present for two series, so identity is never carried
          by colour alone. */}
      <div style={{ display: 'flex', gap: 18, marginBottom: 8, fontSize: 12, flexWrap: 'wrap' }}>
        <Key color={SERIES[0]} label="Pageviews" />
        <Key color={SERIES[1]} label="Unique visitors (daily)" />
      </div>
      <svg
        width={w} height={H} viewBox={`0 0 ${w} ${H}`}
        role="img" aria-label="Pageviews and daily unique visitors over time"
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
        {hover !== null && daily[hover] && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} stroke={INK} strokeWidth={1} opacity={0.25} />
            {/* A 2px surface ring keeps the two markers separable where they meet. */}
            <circle cx={x(hover)} cy={y(daily[hover].views)} r={4} fill={SERIES[0]} stroke="var(--sand-50)" strokeWidth={2} />
            <circle cx={x(hover)} cy={y(daily[hover].visitors)} r={4} fill={SERIES[1]} stroke="var(--sand-50)" strokeWidth={2} />
          </>
        )}
        <text x={PAD_L} y={H - 6} fontSize={11} fill={INK} opacity={0.55}>{fmtDay(daily[0].day)}</text>
        {daily.length > 1 && (
          <text x={w - PAD_R} y={H - 6} textAnchor="end" fontSize={11} fill={INK} opacity={0.55}>{fmtDay(daily[daily.length - 1].day)}</text>
        )}
      </svg>
      {/* Always rendered, never conditionally. Mounting this on hover grew the
          figure by ~24px and shunted every section below it up and down. */}
      <div style={{ fontSize: 12, marginTop: 6, minHeight: 18, opacity: hover === null ? 0.55 : 1 }}>
        <strong>{fmtDay(shown.day)}</strong> — {shown.views} pageviews, {shown.visitors} visitors
        {hover === null && <span style={{ opacity: 0.7 }}> (latest day; hover or tap the chart for another)</span>}
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
function BarList({ rows, color, unit }: { rows: { label: string; n: number; sub?: string }[]; color: string; unit: string }) {
  if (rows.length === 0) return <p style={muted}>Nothing in this window.</p>;
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul style={{ listStyle: 'none', margin: '0 0 4px', padding: 0, display: 'grid', gap: 6 }}>
      {rows.map((r) => (
        <li key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 30%) 1fr auto', alignItems: 'center', gap: 10, fontSize: 13 }}>
          {/* Wraps rather than ellipsising. On a phone the label column is about
              90px, and "Started the questionnaire" truncated to "Started the …"
              loses the only thing that made the funnel row mean anything.
              overflowWrap handles the other case — a product code is one long
              token with nowhere to break. */}
          <span style={{ overflowWrap: 'anywhere' }} title={r.label}>{r.label}</span>
          <span style={{ background: 'var(--sand-100)', borderRadius: 4, height: 16, border: '1px solid var(--sand-200)' }}>
            <span style={{
              display: 'block', height: '100%', width: `${Math.max((r.n / max) * 100, 1.5)}%`,
              background: color, borderRadius: 3,
            }} />
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.75, whiteSpace: 'nowrap' }}>
            {/* The unit is VISIBLE, not screen-reader-only. It was `sr-only`
                first, which this app has never defined as a class, so it
                rendered inline and produced "66 · 100% of visitors visitors".
                Reading the rendered page is what caught it. */}
            {r.n.toLocaleString('en-GB')} {unit}{r.sub ? ` · ${r.sub}` : ''}
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
function Funnel({ f }: { f: Summary['funnel'] }) {
  // MEASURED steps only. The three middle steps of the designed funnel —
  // questionnaire_started, itinerary_generated, itinerary_kept — have NO
  // instrumentation behind them: trackMilestone() exists in src/lib/beacon.ts
  // and is called from nowhere, so stats_summary counts zero of each, forever.
  //
  // Rendering them as "0 visitors · 0%" would not read as "not measured", it
  // would read as nobody starting the questionnaire — a catastrophic-looking
  // product instead of a missing beacon. So they are named as unmeasured
  // instead. Wiring the three calls is plan Task 9 (docs/superpowers/plans/
  // 2026-08-14-internal-analytics.md) and ROADMAP item 25; when they land, move
  // them out of NOT_YET and delete this note.
  const steps = [
    ['Visited', f.visitors],
    ['Clicked out to a partner', f.clickedOut],
  ] as const;
  const NOT_YET = ['Started the questionnaire', 'Generated an itinerary', 'Saved or shared it'];
  return (
    <>
      <BarList rows={steps.map(([label, n]) => ({
        label,
        n,
        sub: f.visitors > 0 ? `${Math.round((n / f.visitors) * 100)}%` : undefined,
      }))} color={SERIES[0]} unit="visitors" />
      <p style={{ ...warn, marginTop: 14 }}>
        <strong>Three steps are not measured yet.</strong> {NOT_YET.join(', ')} — the beacon
        for these was never wired up, so there is no data behind them. They are left out
        rather than drawn as zero, because a zero here would look like nobody doing it.
      </p>
      <p style={{ ...muted, fontSize: 12, marginBottom: 0 }}>
        Each step counts distinct daily visitor codes, so a person planning across two days
        is two. Steps are counts, not a strict funnel — a visitor can click out without
        generating anything.
      </p>
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
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
  color: 'var(--ink)', opacity: 0.5, padding: 0, fontFamily: 'inherit',
};

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
