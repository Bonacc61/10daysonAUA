import { useEffect, useRef, useState } from 'react';
import { Link } from './Icons';
import { createShare } from '../lib/shares';
import { capture } from '../lib/analytics';
import type { TripState } from '../lib/tripState';

/**
 * "Copy link" — a row in the share menu, on both surfaces that have one.
 *
 * It exists because the email dialog quietly took link-sharing away from the
 * people most likely to want it. Sending by email creates a public `/i/<slug>`
 * internally, but only ever puts it in the message body — the sender never sees
 * it. So a signed-in traveller had no way to get a link to paste into a group
 * chat, while a signed-out one still did.
 *
 * One component rather than a copy in each menu, for the reason `ShareEmailModal`
 * is one component: two menus that are supposed to offer the same thing will not
 * stay the same if they are written twice.
 *
 * The clipboard can refuse — permissions policy, a non-secure context, a browser
 * that wants a fresher user gesture than the `await` above it leaves. When it
 * does, the row hands over a selectable field instead of claiming success;
 * `SharePopover` takes the same position, and a link you can select is worth
 * more than a "Copied ✓" that lied.
 */

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'copied' }
  | { kind: 'manual'; url: string }   // clipboard refused — select it yourself
  | { kind: 'error' };

/**
 * Shared by every row in a share menu, including the "Share via email" siblings
 * in Dashboard and Itinerary. Exported because writing it out per menu is
 * exactly the drift this component exists to avoid.
 */
export const SHARE_MENU_ROW: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
  background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit',
  fontSize: 13, fontWeight: 600, color: 'var(--ink)', textAlign: 'left',
};

type Props = {
  trip: TripState;
  onDone?: () => void;
  /**
   * A link already minted for this exact itinerary, if the caller holds one.
   * Every insert into `shared_itineraries` is PERMANENT — the table has no
   * delete policy — so clicking Copy link three times on an unchanged plan
   * must not leave three public snapshots behind. The caller owns the cache
   * because only it knows when the plan changed underneath.
   */
  cachedUrl?: string | null;
  onUrl?: (url: string) => void;
};

export default function CopyLinkRow({ trip, onDone, cachedUrl, onUrl }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  // The 1400ms "Copied ✓" hold outlives a fast menu switch: copy on one row,
  // open another within the window, and a timer belonging to an unmounted row
  // would call `onDone` and shut the menu that was just opened.
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const finish = (url: string) => {
    onUrl?.(url);
    capture('itinerary_shared', { via: 'link' });
    navigator.clipboard.writeText(url).then(
      () => {
        setState({ kind: 'copied' });
        timer.current = window.setTimeout(() => { setState({ kind: 'idle' }); onDone?.(); }, 1400);
      },
      () => setState({ kind: 'manual', url }),
    );
  };

  const run = async () => {
    if (state.kind === 'working') return;
    if (cachedUrl) { finish(cachedUrl); return; }
    setState({ kind: 'working' });
    const { id } = await createShare(trip).catch(() => ({ id: null }));
    if (!id) { setState({ kind: 'error' }); return; }
    finish(`${window.location.origin}/i/${id}`);
  };

  if (state.kind === 'manual') {
    return (
      <div style={{ padding: '10px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
          Copy this link
        </div>
        <input
          readOnly
          value={state.url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Itinerary link"
          style={{ width: '100%', padding: '8px 10px', fontSize: 12, fontFamily: 'inherit', borderRadius: 8, border: '2px solid var(--sand-200)', background: 'var(--cream)', color: 'var(--ink)', boxSizing: 'border-box' }}
        />
      </div>
    );
  }

  return (
    <button type="button" onClick={run} style={SHARE_MENU_ROW} disabled={state.kind === 'working'}>
      <Link size={14} />
      <span>
        {state.kind === 'working' ? 'Creating link…'
          : state.kind === 'copied' ? 'Copied ✓'
          : state.kind === 'error' ? "Couldn't create a link — try again"
          : 'Copy link'}
      </span>
    </button>
  );
}
