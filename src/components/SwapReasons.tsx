import type { SwapReason } from '../types';

// Open footprint of the chip strip (wrapper height + its margin-top), in px.
// ItineraryCard grows the fixed-height flip-card by exactly this amount so the
// action row above stays put while the strip animates in. Keep in sync with
// the `.swap-reasons-wrap.open` rule in index.css.
export const SWAP_REASONS_OPEN_PX = 52;

const REASONS: { id: SwapReason; label: string; danger?: boolean }[] = [
  { id: 'too-pricey',        label: 'Too pricey' },
  { id: 'done-it',           label: 'Done it before' },
  { id: 'too-far',           label: 'Too far' },
  { id: 'not-our-vibe',      label: 'Not our vibe', danger: true },
  { id: 'just-show-another', label: 'Just show me another' },
];

// "Why swap?" chip strip shown below the action row after "Swap this" is
// pressed. Always rendered (CSS animates the open/close via the wrapper's
// height); chips are taken out of the tab order while collapsed.
export default function SwapReasons({
  open, onPick,
}: {
  open: boolean;
  onPick: (reason: SwapReason) => void;
}) {
  return (
    <div className={`swap-reasons-wrap${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="swap-reasons-inner">
        <span className="swap-reason-label">Why swap?</span>
        {REASONS.map((r) => (
          <button
            key={r.id}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => onPick(r.id)}
            className={`swap-reason-chip${r.danger ? ' danger' : ''}`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
