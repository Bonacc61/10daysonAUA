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

/** Above this many departures a card shows the span instead of a list. */
const MAX_LISTED = 3;

/** Midday, in minutes. The line between a morning product and an afternoon one. */
const NOON_MIN = 12 * 60;

const toMinutes = (hhmm: string): number => {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/**
 * The slot a product's SCHEDULE rules out the alternative to, or undefined when
 * it rules out nothing.
 *
 * A statement about what would be WRONG, not a preference — the same shape as
 * the Arikok gate, and the reason it is safe for the fill ladder to read. A
 * product that only ever departs at 09:00 cannot happen in an afternoon.
 *
 * Undefined for the 119 products whose departures straddle noon: they constrain
 * nothing, and guessing a side for them would be a preference wearing a
 * correctness costume.
 */
export function scheduleTimeOfDay(id: string): 'morning' | 'afternoon' | undefined {
  const mins = startTimesFor(id).map(toMinutes).filter((n) => !Number.isNaN(n));
  if (mins.length === 0) return undefined;
  if (mins.every((m) => m < NOON_MIN)) return 'morning';
  if (mins.every((m) => m >= NOON_MIN)) return 'afternoon';
  return undefined;
}

/**
 * The line a card shows, or null when nothing is on record.
 *
 * Never names one time out of a set — that would invent a fact the schedule
 * does not support. Three shapes, by how many departures there are:
 *
 *   1        "Departs 9:00am"
 *   2-3      "Departures 3:30pm, 5:00pm"
 *   4+       "Departures 7:00am-6:00pm"
 *
 * The span, rather than the first three plus a count. Listing the earliest
 * three made an all-day product read as a morning one: 137607P22 runs 14 times
 * from 10:00 to 17:30, and "10:00am, 10:30am, 11:00am +11 more" names nothing
 * after lunch. The span is the honest summary of a set that large, and the card
 * links to the booking page for the exact list.
 */
export function startTimeLabel(id: string): string | null {
  const times = startTimesFor(id);
  if (times.length === 0) return null;
  if (times.length === 1) return `Departs ${formatStartTime(times[0])}`;
  if (times.length <= MAX_LISTED) {
    return `Departures ${times.map(formatStartTime).join(', ')}`;
  }
  // Sorted ascending — guarded by a test on the snapshot — so ends are the span.
  return `Departures ${formatStartTime(times[0])}-${formatStartTime(times[times.length - 1])}`;
}
