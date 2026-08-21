import { Star } from './Icons';
import { combinedBreakdown } from '../data/reviewBreakdown';

/**
 * The star distribution behind a product's rating.
 *
 * This is the half of the card back that answers "is 4.9 actually good?". An
 * average cannot: 4.9 from two hundred 5s and a couple of 1s is a different
 * product from 4.9 where everyone mildly agreed. The bars show which.
 *
 * ONE figure, summed across platforms, deliberately. Viator's own page prints
 * the combined count — 212 for the turtle tour, not the 157 it holds under its
 * own name — so a card showing a single platform reads as stale even when every
 * number on it is correct. The traveller checks the card against the page, and
 * the page is what the card has to agree with.
 */
export default function RatingBreakdown({ id }: { id: string }) {
  const b = combinedBreakdown(id);
  if (!b) return null;

  return (
    <div style={{
      background: '#E9F7EF', border: '2px solid #22C55E', borderRadius: 12,
      padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
      overflow: 'hidden', minHeight: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: '#155724' }}>How travellers rated it</span>
        <span style={{ fontSize: 10, color: '#3A7D44', marginLeft: 'auto' }}>
          {b.total.toLocaleString()} reviews
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', gap: 1 }}>
          {[1, 2, 3, 4, 5].map((s) => (
            <Star key={s} size={13}
                  fill={s <= Math.round(b.average) ? '#22C55E' : 'transparent'}
                  color="#22C55E" aria-hidden />
          ))}
        </div>
        <span style={{ fontWeight: 700, fontSize: 12, color: '#155724' }}>{b.average}</span>
      </div>

      {/* 5★ at the top, the way every review site draws it. */}
      {[5, 4, 3, 2, 1].map((star) => {
        const count = b.counts[star - 1] ?? 0;
        const pct = b.total > 0 ? (count / b.total) * 100 : 0;
        return (
          <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 9, color: '#3A7D44', width: 10, textAlign: 'right' }}>{star}</span>
            <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#22C55E' }} />
            </div>
            <span style={{ fontSize: 9, color: '#3A7D44', width: 30, textAlign: 'right' }}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}
