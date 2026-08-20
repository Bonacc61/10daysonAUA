import { useState } from 'react';
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

const ROW: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
  background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit',
  fontSize: 13, fontWeight: 600, color: 'var(--ink)', textAlign: 'left',
};

export default function CopyLinkRow({ trip, onDone }: { trip: TripState; onDone?: () => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const run = async () => {
    if (state.kind === 'working') return;
    setState({ kind: 'working' });
    const { id, error } = await createShare(trip).catch(() => ({ id: null, error: 'failed' }));
    if (!id) {
      setState({ kind: 'error' });
      return;
    }
    const url = `${window.location.origin}/i/${id}`;
    capture('itinerary_shared', { via: 'link' });
    try {
      await navigator.clipboard.writeText(url);
      setState({ kind: 'copied' });
      window.setTimeout(() => { setState({ kind: 'idle' }); onDone?.(); }, 1400);
    } catch {
      setState({ kind: 'manual', url });
    }
    void error;
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
    <button type="button" onClick={run} style={ROW} disabled={state.kind === 'working'}>
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
