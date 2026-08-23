// How many days of history a /stats request covers.
//
// Split out of index.ts so it can be tested: it is the one input to `stats` that
// the caller controls, and a wrong window produces a page that looks right and
// describes the wrong period.
export const DEFAULT_DAYS = 30;

const MIN_DAYS = 1;
// 365 because the raw rows purge at 12 months (`purge-old-web-events`), so a
// larger window cannot return more data — it would only cost a wider scan.
const MAX_DAYS = 365;

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
