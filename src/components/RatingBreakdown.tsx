import { Star } from './Icons';
import { reviewSourcesFor, providerLabel } from '../data/reviewBreakdown';

/**
 * The star distribution behind a product's average, per platform.
 *
 * This is the half of the card back that answers "is 4.8 actually good?". An
 * average cannot: 4.8 from a hundred 5s and a handful of 1s is a different
 * product from 4.8 where everyone agreed. The bars show which one it is.
 *
 * Both platforms are named rather than merged into one number. Viator and
 * TripAdvisor genuinely disagree on some products — different audiences, and
 * TripAdvisor usually carries far more reviews — and averaging two crowds into a
 * single figure invents a consensus that does not exist.
 */
export default function RatingBreakdown({ id }: { id: string }) {
  const sources = reviewSourcesFor(id).filter((s) => s.c.reduce((a, b) => a + b, 0) > 0);
  if (!sources.length) return null;

  return (
    <div key="breakdown" style={{
      background: '#E9F7EF', border: '2px solid #22C55E', borderRadius: 12,
      padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
      overflow: 'hidden', minHeight: 0,
    }}>
      <span style={{ fontWeight: 700, fontSize: 12, color: '#155724' }}>How travellers rated it</span>

      {sources.map((s) => {
        const total = s.c.reduce((a, b) => a + b, 0);
        return (
          <div key={s.p} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#3A7D44' }}>
              <span style={{ fontWeight: 700 }}>{providerLabel(s.p)}</span>
              {s.a !== null && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: '#155724', fontWeight: 700 }}>
                  <Star size={9} aria-hidden /> {s.a}
                </span>
              )}
              <span style={{ marginLeft: 'auto' }}>{s.n.toLocaleString()} reviews</span>
            </div>

            {/* 5★ at the top, the way every review site draws it. */}
            {[5, 4, 3, 2, 1].map((star) => {
              const count = s.c[star - 1] ?? 0;
              // Share of THIS platform's reviews, so the bars of a 12-review
              // product are as readable as a 2,000-review one.
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 9, color: '#3A7D44', width: 10, textAlign: 'right' }}>{star}</span>
                  <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#22C55E' }} />
                  </div>
                  <span style={{ fontSize: 9, color: '#3A7D44', width: 26, textAlign: 'right' }}>{count}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
