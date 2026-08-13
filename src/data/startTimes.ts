import SNAPSHOT from './startTimes.json';

/**
 * When a product's departures are SCHEDULED to leave — captured from Viator's
 * own `/availability/schedules/{product-code}` on 2026-08-13 and committed, the
 * same contract as the coordinate registry and the enrichment snapshot: a tool
 * proposes, a human accepts, production reads only committed data.
 *
 * Regenerate with `npm run probe:start-times`, which writes the full evidence to
 * docs/map/viator-start-times.json; this file is the display-facing subset.
 * Coverage at capture: 281 of 328 products. The other 47 are untimed —
 * open-ended admission tickets that genuinely have no departure.
 *
 * A SET, NOT A VALUE — and this is the thing to get right. 165 of the 281 have
 * more than one start time and 109 vary by season or day of week, so what is
 * stored here is the UNION across the whole year. A product listing 09:00 and
 * 15:00 may run only one of them in low season. That makes this safe to show as
 * "when this generally departs" and unsafe to show as "when it departs on your
 * date" — which is why every render of it carries the booking hedge, and why
 * nothing here is ever presented as a confirmed time for a given day.
 */
const TIMES: Record<string, string[]> = SNAPSHOT;

/** Scheduled start times for a product, "HH:MM", ascending. Empty when untimed. */
export function startTimesFor(id: string): string[] {
  return TIMES[id] ?? [];
}

/**
 * "09:00" → "9:00am". Matches the voice the rest of the site already uses
 * ("arrive 30 min early", "6:42pm") rather than the 24-hour form the API
 * returns. Midnight and noon are spelled the way a traveller says them.
 */
export function formatStartTime(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return hhmm;
  const h24 = Number(m[1]);
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]}${suffix}`;
}

/** How many times to name before collapsing the rest into a count. */
const MAX_SHOWN = 3;

/**
 * The line a card shows, or null when nothing is on record.
 *
 * Deliberately says "Departures" for the plural case rather than naming a
 * single time: picking one of a set would be inventing a fact the schedule does
 * not support, and the set spans seasons. Beyond MAX_SHOWN the tail becomes
 * "+N more" so a product with eleven departures does not eat the card.
 */
export function startTimeLabel(id: string): string | null {
  const times = startTimesFor(id);
  if (times.length === 0) return null;
  if (times.length === 1) return `Departs ${formatStartTime(times[0])}`;
  const shown = times.slice(0, MAX_SHOWN).map(formatStartTime).join(', ');
  const rest = times.length - MAX_SHOWN;
  return `Departures ${shown}${rest > 0 ? ` +${rest} more` : ''}`;
}
