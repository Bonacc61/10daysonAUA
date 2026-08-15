import { MapPin } from './Icons';
import { departurePointFor, isWaterBased } from '../data/itemFit';
import { startTimeLabel } from '../data/startTimes';
import type { ViatorItem } from '../types';

/**
 * When a trip leaves and where it collects you — the two things you cannot
 * recover from getting wrong.
 *
 * Renders NOTHING unless at least one is on record. A departure point requires a
 * human-verified `departure` pin (see `departurePointFor`, which refuses
 * destination pins and hedges approximate ones); a time requires the product to
 * appear in the committed start-time snapshot, which 281 of 328 do.
 *
 * Extracted to one file on 2026-08-13, when Explore's grid became the second
 * surface to show it. The rules here are the kind that rot when copied:
 *
 *  - The check-in line is the OPERATOR talking and stays in quotes. A start time
 *    is structured data from their booking system, so it is rendered plainly —
 *    but never for a specific date, because the snapshot is a union across
 *    seasons and 109 products vary by season or day of week.
 *  - The hedge is unconditional and names whichever facts are on screen. A place
 *    alone is not a meeting point, and a schedule is not an availability.
 *  - Multiple departures are never collapsed to one. Picking a single time out
 *    of a set would invent a fact the schedule does not support.
 *
 * This is the ONLY renderer of that data — verified 2026-08-15. It used to say
 * ItineraryCard imported the underlying functions to size a fixed-height flip
 * card; that stopped being true when card height became CSS's job (see
 * `.flip-card`), and the note outlived the coupling it described.
 */
/**
 * The one-line summary, composed from whichever halves exist. Exported as a pure
 * function because this repo has no component-test setup — this is the only way
 * the traveller-facing copy gets a test at all.
 *
 * "Departs 9:00am from Pelican Pier" reads as one fact, which is how a traveller
 * holds it. Either half stands alone when the other is missing.
 */
export function departureHeadline(
  time: string | null,
  place: string,
  verb: 'Departs' | 'Starts',
): string {
  return [time ?? verb, place].filter(Boolean).join(' ');
}

/**
 * The hedge names only what is actually on screen — see the note above.
 *
 * "by season AND day" is not padding. The snapshot is a union across seasons
 * *and* days of week, and 109 of 281 products vary on one or the other. Saying
 * only "by season" would tell a traveller the times are fixed within a season,
 * so someone reading "Departures 9:00am, 3:00pm" on a product that runs 9:00
 * Mon/Wed and 15:00 Tue/Thu could turn up Tuesday morning for a boat that is
 * not there.
 */
export function departureHedge(hasTime: boolean, hasPlace: boolean): string {
  if (hasTime && hasPlace) return 'Times vary by season and day. Confirm both on your booking.';
  if (hasTime) return 'Times vary by season and day. Confirm on your booking.';
  return 'Confirm the meeting point on your booking.';
}

export default function DepartureNote({ item }: { item: ViatorItem }) {
  // A boat leaves without you; a cooking class waits at an address. That is the
  // whole difference, and it decides both the verb and the preposition.
  const departs = isWaterBased(item);
  const departure = departurePointFor(item);
  const time = startTimeLabel(item.id, departs ? 'departs' : 'starts');
  if (!departure && !time) return null;

  // "near" outranks both: an approximate pin is the right hotel and the wrong
  // doorway, and neither "from" nor "at" may state it as the doorway.
  const preposition = departure?.approx ? 'near' : departs ? 'from' : 'at';
  const place = departure ? `${preposition} ${departure.place}` : '';
  const headline = departureHeadline(time, place, departs ? 'Departs' : 'Starts');
  const hedge = departureHedge(Boolean(time), Boolean(departure));

  return (
    <div className="card-departure">
      <MapPin size={12} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        <strong>{headline}</strong>
        {departure?.checkin && (
          <span className="checkin-quote">“{departure.checkin}”</span>
        )}
        <span className="checkin-quote">{hedge}</span>
      </span>
    </div>
  );
}
