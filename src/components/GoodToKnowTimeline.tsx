import { type CSSProperties } from 'react';
import { iconFor } from './Icons';
import { GTK_CARDS } from '../data/activities';

/* The Good-to-knows timeline, shared by the landing page's "Good-to-knows"
   section and My Aruba → Practical Info. Lives here so the two surfaces cannot
   drift: the cards, the phase grouping, and the stacking behaviour are one
   implementation with one set of CSS classes.

   Callers own the heading, the lede, and the wrapper. The only thing a caller
   must supply is `surface` — the page background the sticky phase headers pin
   against. They have to be opaque or scrolled cards show through, so a caller
   on a different background than the landing page's yellow has to say so. */

const GTK_SECTION_META = [
  { key: 'before',     label: 'Before you get here' },
  { key: 'first-day',  label: 'Your first day' },
  { key: 'throughout', label: 'Throughout your stay' },
] as const;

function GtkTimelineCard({ card, index }: { card: typeof GTK_CARDS[number]; index: number }) {
  const IconCmp = iconFor(card.icon);
  return (
    <div className="tlc" style={{ '--accent': card.accent, '--i': index } as CSSProperties}>
      <div className="tlc-head">
        <span className="tlc-stamp"><IconCmp size={17} /></span>
        <h4 className="tlc-title font-display">{card.title}</h4>
        {card.note && <span className="tlc-flag">{card.note}</span>}
      </div>
      <p className="tlc-body">{card.body}</p>
      {card.attribution && <span className="tlc-sign">— {card.attribution}</span>}
    </div>
  );
}

export default function GoodToKnowTimeline({ surface }: { surface?: string }) {
  const phases = GTK_SECTION_META.map((s) => ({
    ...s,
    cards: GTK_CARDS.filter((c) => c.section === s.key),
  }));

  // All three subsections stay expanded; the sticky phase headers + sticky-stacking
  // cards do the sequencing — you scroll through one subsection's cards (they stack
  // up) before the next subsection's header takes over and its cards start stacking.
  // This replaces the old scroll-spy one-at-a-time collapse, which switched
  // subsections before their cards could finish stacking (so the stacking only ever
  // showed on the last of the three). Clicking a header jumps to that subsection.
  const jumpTo = (el: Element | null) =>
    (el as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="gtk-tl" style={surface ? ({ '--gtk-surface': surface } as CSSProperties) : undefined}>
      {phases.map((p) => (
        <div className="gtk-phase" data-active="" data-open="" key={p.key}>
          <button
            type="button"
            className="gtk-phase-head"
            onClick={(e) => jumpTo(e.currentTarget.closest('.gtk-phase'))}
          >
            <span className="gtk-node" aria-hidden />
            <span className="gtk-phase-label font-display">{p.label}</span>
          </button>
          <div className="gtk-phase-wrap">
            <div className="gtk-phase-inner">
              <div className="gtk-phase-cards">
                {p.cards.map((c, ci) => <GtkTimelineCard key={c.title} card={c} index={ci} />)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
