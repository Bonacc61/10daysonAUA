import { useState } from 'react';

// Desktop share affordance: a read-only link field with Copy, plus WhatsApp and
// email quick-links. Rendered anchored above the itinerary action bar.
export default function SharePopover({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the field is selectable as a fallback */ }
  };

  const wa = `https://wa.me/?text=${encodeURIComponent(`My 10 days on Aruba — ${url}`)}`;
  const mail = `mailto:?subject=${encodeURIComponent('My Aruba itinerary')}&body=${encodeURIComponent(url)}`;

  return (
    <div
      role="dialog"
      aria-label="Share link"
      className="chunky"
      style={{
        position: 'absolute', bottom: 'calc(100% + 12px)', left: '50%', transform: 'translateX(-50%)',
        width: 320, maxWidth: '90vw', background: 'var(--cream)', color: 'var(--ink)',
        border: '2px solid var(--ink)', padding: 16, zIndex: 30, textAlign: 'left',
      }}
    >
      <button
        type="button" aria-label="Close" onClick={onClose}
        style={{ position: 'absolute', top: 6, right: 10, background: 'transparent', border: 'none', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: 'var(--ink)' }}
      >×</button>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Share this itinerary</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          readOnly value={url}
          onFocus={(e) => e.currentTarget.select()}
          style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: '2px solid var(--ink)', borderRadius: 6, fontSize: 13, background: '#fff' }}
        />
        <button type="button" className="btn-red" onClick={copy} style={{ padding: '8px 12px', fontSize: 13, whiteSpace: 'nowrap' }}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 14, fontWeight: 700 }}>
        <a href={wa} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>WhatsApp</a>
        <a href={mail} style={{ color: 'var(--ink)' }}>Email</a>
      </div>
    </div>
  );
}
