import { Check, Plus } from './Icons';

// The one control for keeping an activity. Lifted out of Explore on 2026-08-05
// when the ♥ was retired everywhere: Explore, My Aruba > Shortlisted, and both
// Surprise surfaces now show this same button, so "saved" looks and behaves the
// same wherever a traveller meets it. Clicking "Added" is also the way back out.
export default function AddButton({ added, onAdd, fill }: { added: boolean; onAdd: () => void; fill?: boolean }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={added ? 'Remove from shortlist' : 'Add to shortlist'}
      style={{ ...(fill ? { flex: 1 } : null), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px', borderRadius: 12, border: '2px solid var(--ink)', fontWeight: 700, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', background: added ? 'var(--green)' : 'var(--yellow-bg)', color: added ? 'var(--cream)' : 'var(--ink)', boxShadow: '3px 3px 0 var(--ink)' }}
    >
      {added ? <><Check size={13} /> Added</> : <><Plus size={13} /> Add</>}
    </button>
  );
}
