import { MapPin } from './Icons';
import { departurePointFor } from '../data/itemFit';
import type { ViatorItem } from '../types';

/**
 * Where a water-based trip collects you, and — when the operator published one —
 * their own check-in sentence, quoted verbatim.
 *
 * Renders NOTHING unless a human-verified collection point is on record. That is
 * the normal case for most products and is deliberate: see `departurePointFor`,
 * which refuses destination pins and hedges approximate ones.
 *
 * Extracted to one file on 2026-08-13, when Explore's grid became the second
 * surface to show it. The rule this markup encodes is the kind that rots when
 * copied: the site never states a departure TIME in its own voice, the check-in
 * line is the operator talking and stays in quotes, and the "confirm on your
 * booking" hedge is unconditional because a place alone is not a meeting point.
 * One component means the two surfaces cannot drift apart on any of that.
 *
 * Callers that need the DATA rather than the markup — ItineraryCard, which has
 * to size a fixed-height flip card — import `departurePointFor` directly.
 */
export default function DepartureNote({ item }: { item: ViatorItem }) {
  const departure = departurePointFor(item);
  if (!departure) return null;
  return (
    <div className="card-departure">
      <MapPin size={12} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        <strong>Departs {departure.approx ? 'near' : 'from'} {departure.place}</strong>
        {departure.checkin && (
          <span className="checkin-quote">“{departure.checkin}”</span>
        )}
        <span className="checkin-quote">Confirm the meeting point on your booking.</span>
      </span>
    </div>
  );
}
