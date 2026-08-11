import { useState } from 'react';
import type { SwapReason } from '../types';
import { MAX_EDIT_TEXT } from '../lib/edits';

// Open footprint of the chip strip (wrapper height + its margin-top), in px.
// ItineraryCard grows the fixed-height flip-card by exactly this amount so the
// action row above stays put while the strip animates in. Keep in sync with
// the `.swap-reasons-wrap.open` rule in index.css.
export const SWAP_REASONS_OPEN_PX = 52;

// The same, for the taller strip that carries the free-text row. Only used when
// `onSubmitText` is supplied, i.e. when VITE_NL_EDIT is on — with the flag off
// nothing about this component's size changes.
// Keep in sync with `.swap-reasons-wrap.open.with-text` in index.css.
export const SWAP_REASONS_TEXT_OPEN_PX = 92;

// The free-text half of the strip, threaded from Itinerary through the card
// components. Grouped so the drill-down is one prop bag rather than four.
export type SwapTextProps = {
  onSubmitReasonText?: (text: string) => void;
  reasonPending?: boolean;
  reasonFailed?: boolean;
  echo?: string[];
};

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
//
// When `onSubmitText` is supplied, a free-text row appears under the chips. The
// chips stay: they are one tap, always work, and are the fallback whenever the
// parse fails. The text row is an addition, never a replacement.
export default function SwapReasons({
  open, onPick, onSubmitText, pending, failed,
}: {
  open: boolean;
  onPick: (reason: SwapReason) => void;
  onSubmitText?: (text: string) => void;
  pending?: boolean;
  failed?: boolean;
}) {
  const [text, setText] = useState('');
  const tab = open ? 0 : -1;

  const submit = () => {
    const t = text.trim();
    if (!t || pending) return;
    setText('');
    onSubmitText?.(t);
  };

  return (
    <div className={`swap-reasons-wrap${open ? ' open' : ''}${onSubmitText ? ' with-text' : ''}`} aria-hidden={!open}>
      <div className="swap-reasons-inner">
        <span className="swap-reason-label">Why swap?</span>
        {REASONS.map((r) => (
          <button
            key={r.id}
            type="button"
            tabIndex={tab}
            // Inert while a free-text parse is in flight: applySwap's guard
            // reads a stale `swapping` set across the await, so a chip pressed
            // mid-parse would swap the card twice.
            disabled={pending}
            onClick={() => onPick(r.id)}
            className={`swap-reason-chip${r.danger ? ' danger' : ''}`}
          >
            {r.label}
          </button>
        ))}

        {onSubmitText && (
          <div className="swap-text-row">
            <input
              type="text"
              className="swap-text-input"
              tabIndex={tab}
              value={text}
              maxLength={MAX_EDIT_TEXT}
              disabled={pending}
              placeholder={failed ? "Couldn't read that — try a chip above" : '…or tell us what you\'d rather do'}
              aria-label="Describe what you would rather do"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
            <button
              type="button"
              tabIndex={tab}
              className="swap-text-go"
              disabled={pending || !text.trim()}
              onClick={submit}
            >
              {pending ? '…' : 'Go'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
