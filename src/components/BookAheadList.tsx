import type { CardEntry, SlotEntry, Slot } from '../types';
import type { PlannedDay } from '../data/itineraryPlan';
import { productUrlFor, bookUrlForActivity } from '../data/exploreItems';

// The plan's bookable picks, gathered into one panel at the top of the page.
//
// WHY THIS EXISTS. Measured on the live app (2026-08-26): a 7-day mid-range
// plan is ~14 phone screens tall and holds TWO Book buttons among 17 cards —
// the first of them three screens down. The generator's paid cap is deliberate
// (see bookableDensity.test.ts), so scarcity stays; what was missing is a place
// where the few picks that DO need a reservation are visible without scrolling
// the whole plan. Every page-level action (Save, Share, Export) framed the
// itinerary as a planning artifact; this is the booking counterpart.
//
// Bookability MUST mirror ItineraryCard exactly — a row here that has no
// Book button on its card below (or vice versa) reads as a bug. Same rules:
// group -> best seller with a url and a price; activity -> bookUrlForActivity
// (paid + linked). Lunch spots and free picks never appear.
//
// Rows marked booked (the card's own "Mark as booked" state) collapse to a
// quiet ✓ — the panel is a checklist for the traveller who saved the plan and
// came back to book, which the funnel says is the common shape: planning and
// booking rarely happen in the same visit.

type Bookable = {
  uid: string;
  day: number;
  title: string;
  price: string;
  url: string;
  sellOut: boolean;
};

type Props = {
  plan: PlannedDay[];
  resolveEntry: (e: SlotEntry, slot?: Slot) => CardEntry | null;
  bookedIds: Set<string>;
};

const SLOTS: Slot[] = ['morning', 'afternoon', 'evening'];

function collectBookables(plan: PlannedDay[], resolveEntry: Props['resolveEntry']): Bookable[] {
  const out: Bookable[] = [];
  for (const d of plan) {
    for (const slot of SLOTS) {
      for (const card of d[slot]) {
        const entry = resolveEntry(card.entry, slot);
        if (!entry) continue;
        if (entry.kind === 'group') {
          if (!entry.bestSeller.viator_item_url || entry.bestSeller.price_usd <= 0) continue;
          const url = productUrlFor(entry.bestSeller);
          if (!url) continue;
          out.push({
            uid: card.uid, day: d.day, title: entry.bestSeller.title,
            price: `$${entry.bestSeller.price_usd} pp`, url,
            sellOut: (entry.bestSeller.flags ?? []).includes('LIKELY_TO_SELL_OUT'),
          });
        } else {
          const book = bookUrlForActivity(entry.activity);
          if (!book) continue;
          out.push({
            uid: card.uid, day: d.day, title: entry.activity.title,
            price: entry.activity.cost, url: book.url, sellOut: false,
          });
        }
      }
    }
  }
  return out;
}

export default function BookAheadList({ plan, resolveEntry, bookedIds }: Props) {
  const bookables = collectBookables(plan, resolveEntry);
  if (bookables.length === 0) return null;
  const open = bookables.filter((b) => !bookedIds.has(b.uid)).length;

  return (
    <div className="chunky book-ahead" style={{ background: 'var(--cream)', padding: '18px 20px', marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 className="font-display" style={{ fontSize: 22, margin: 0, color: 'var(--ink)' }}>
          Worth booking ahead.
        </h2>
        {open === 0 && (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>All booked ✓</span>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--sand-700)', margin: '0 0 12px' }}>
        {bookables.length === 1 ? 'The one pick in this plan' : `The ${bookables.length} picks in this plan`} with
        fixed spots — everything else is walk-up, no reservation needed.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bookables.map((b) => {
          const booked = bookedIds.has(b.uid);
          return (
            <li key={b.uid} className="book-ahead-row"
                style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                         padding: '8px 0', borderTop: '1px solid var(--sand-200, #e8e0d0)',
                         opacity: booked ? 0.65 : 1 }}>
              <span className="chip-outline" style={{ fontSize: 11, padding: '2px 9px', flexShrink: 0 }}>
                Day {b.day}
              </span>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', minWidth: 0, flex: '1 1 160px' }}>
                {b.title}
              </span>
              {b.sellOut && (
                <span className="chip-outline" style={{ fontSize: 11, padding: '2px 9px', background: '#FFE2D6', flexShrink: 0 }}>
                  🔥 Likely to sell out
                </span>
              )}
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sand-700)', flexShrink: 0 }}>{b.price}</span>
              {booked ? (
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', flexShrink: 0 }}>✓ Booked</span>
              ) : (
                <a href={b.url} target="_blank" rel="noopener noreferrer" className="itin-book-btn"
                   style={{ padding: '6px 12px', fontSize: 12.5, flexShrink: 0 }}>
                  Book ↗
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
