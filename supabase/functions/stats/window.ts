// What period a /stats request covers.
//
// Split out of index.ts so it can be tested: it is the one input to `stats` that
// the caller controls, and a wrong window produces a page that looks right and
// describes the wrong period.
export const DEFAULT_DAYS = 30;

const MIN_DAYS = 1;
// 365 because the raw rows purge at 12 months (`purge-old-web-events`), so a
// larger window cannot return more data — it would only cost a wider scan.
const MAX_DAYS = 365;

export type Window = {
  kind: 'days' | 'today';
  /** Whole days for a days-window; the elapsed fraction for today. Labelling only. */
  days: number;
  /** The instant the window starts, which is what the query actually uses. */
  since: string;
};

/**
 * "Today" is the UTC CALENDAR DAY, not the last 24 hours, and the difference is
 * not pedantry here.
 *
 * stats_summary measures `now() - make_interval(days => N)`, which is a rolling
 * window. Asked for `days=1` at 09:00, that reaches back to 09:00 yesterday and
 * quietly mixes two calendar days together. It would also disagree with every
 * other number on the page: `visitor_day_hash` is rebuilt at midnight UTC, so a
 * visitor counted before midnight and again after is two people by construction.
 * A rolling 24h "today" would count them once and under-report against the daily
 * chart directly above it.
 *
 * So the window is expressed as an INSTANT rather than a count of days, and
 * stats_summary_since (20260823180000) takes it as a timestamptz. Expressing it
 * as a fraction of days was the first attempt and does not work: the original
 * stats_summary takes `days int`, so 0.75 rounds to 1 and silently becomes the
 * rolling 24 hours this exists to avoid.
 *
 * Computed from the SERVER's clock, deliberately. A browser in Aruba is four
 * hours behind UTC, so letting the client compute this would hand back a window
 * that starts at 20:00 the previous evening and label it "Today".
 */
function todayWindow(now: Date): Window {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    kind: 'today',
    days: (now.getTime() - midnight) / 86_400_000,
    since: new Date(midnight).toISOString(),
  };
}

export function parseWindow(raw: string | null, now: Date): Window {
  if (raw !== null && raw.trim().toLowerCase() === 'today') return todayWindow(now);
  const days = windowDays(raw);
  return { kind: 'days', days, since: new Date(now.getTime() - days * 86_400_000).toISOString() };
}

export function windowDays(raw: string | null): number {
  // Absent and blank are the same request: "you choose". `?days=` reaches here
  // as an empty string, and Number('') is 0 — not NaN — so without this line the
  // clamp below turns it into a ONE day window. The page would render happily,
  // every tile still labelled 30 days.
  if (raw === null || raw.trim() === '') return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  // Whole days: make_interval(days => 7.9) is not an error, it is 7 days and
  // some hours, and no tile label would ever say so.
  return Math.min(Math.max(Math.trunc(n), MIN_DAYS), MAX_DAYS);
}
