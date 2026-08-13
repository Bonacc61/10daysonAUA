import { MapPin } from './Icons';
import { departurePointFor } from '../data/itemFit';
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
 * Callers that need the DATA rather than the markup — ItineraryCard, sizing a
 * fixed-height flip card — import the underlying functions directly and must
 * mirror this component's render condition exactly, or the card clips.
 */
/**
 * The one-line summary, composed from whichever halves exist. Exported as a pure
 * function because this repo has no component-test setup — this is the only way
 * the traveller-facing copy gets a test at all.
 *
 * "Departs 9:00am from Pelican Pier" reads as one fact, which is how a traveller
 * holds it. Either half stands alone when the other is missing.
 */
export function departureHeadline(time: string | null, place: string): string {
  return [time ?? 'Departs', place].filter(Boolean).join(' ');
}

/** The hedge names only what is actually on screen — see the note above. */
export function departureHedge(hasTime: boolean, hasPlace: boolean): string {
  if (hasTime && hasPlace) return 'Times vary by season. Confirm both on your booking.';
  if (hasTime) return 'Times vary by season. Confirm on your booking.';
  return 'Confirm the meeting point on your booking.';
}

export default function DepartureNote({ item }: { item: ViatorItem }) {
  const departure = departurePointFor(item);
  const time = startTimeLabel(item.id);
  if (!departure && !time) return null;

  const place = departure ? `${departure.approx ? 'near' : 'from'} ${departure.place}` : '';
  const headline = departureHeadline(time, place);
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
