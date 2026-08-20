import { useState } from 'react';
import { useCatalog } from '../data/useCatalog';
import { answersToTags } from '../data/answerTags';
import { resolveSlotEntry } from '../data/activitySource';
import { useAuth } from '../lib/auth';
import { createShare } from '../lib/shares';
import { capture } from '../lib/analytics';
import type { TripState } from '../lib/tripState';
import type { Slot, SlotEntry, CardEntry, MatchTag } from '../types';

/**
 * "Share via email" — one dialog, two surfaces.
 *
 * It began life inline in the Dashboard's Itineraries panel. The Itinerary page
 * now opens the same dialog from its "Share itinerary" button, and a traveller
 * who meets the same words on two pages should meet the same window: copying
 * eighty lines of JSX to achieve that would have guaranteed the two drifted.
 *
 * The trip travels in as a prop rather than being read from context, because
 * the Dashboard opens this from a LIST — the row it was opened from is the trip
 * it must send, not whichever one happens to be active.
 */

/** The itinerary as plain text for the email body. */
export function buildShareText(
  trip: TripState,
  resolveEntry: (e: SlotEntry, slot?: Slot) => CardEntry | null,
): string {
  const lines: string[] = [`Your ${trip.answers.days}-day Aruba itinerary`, ''];
  for (const day of trip.plan) {
    lines.push(`Day ${day.day}${day.title ? ` — ${day.title}` : ''}`);
    const slots: [string, Slot, typeof day.morning][] = [
      ['Morning',   'morning',   day.morning],
      ['Afternoon', 'afternoon', day.afternoon],
      ['Evening',   'evening',   day.evening],
    ];
    for (const [label, slot, cards] of slots) {
      for (const card of cards) {
        const entry = resolveEntry(card.entry, slot);
        if (!entry) continue;
        if (entry.kind === 'activity') {
          const cost = entry.activity.cost ?? '';
          lines.push(`  ${label}: ${entry.activity.title} (${entry.activity.duration}${cost ? ', ' + cost : ''})`);
        } else {
          const price = entry.bestSeller.price_usd === 0 ? 'Free' : `$${entry.bestSeller.price_usd}`;
          lines.push(`  ${label}: ${entry.bestSeller.title} (${entry.bestSeller.duration}, ${price})`);
        }
      }
    }
    lines.push('');
  }
  lines.push('Built with 10 Days on Aruba — https://10daysonaruba.com');
  return lines.join('\n');
}

export default function ShareEmailModal({ trip, onClose }: { trip: TripState; onClose: () => void }) {
  const { catalog } = useCatalog();
  const { session } = useAuth();
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!session) return;
    setSending(true);
    setError(null);
    try {
      // The trip's OWN answers decide which item each card resolves to — the
      // same rule the Map's tabs follow. Sharing a trip must not describe it
      // using whatever the questionnaire happens to say today.
      const tags = answersToTags(trip.answers) as Set<MatchTag>;
      const text = buildShareText(trip, (e: SlotEntry, slot?: Slot) =>
        resolveSlotEntry(e, catalog, tags as never, slot));
      // Create a share link so the email includes a direct "Book your activities" URL.
      // If it fails we still send the email — the button falls back to the homepage.
      const { id: shareId } = await createShare(trip).catch(() => ({ id: null }));
      const itinerary_url = shareId ? `${window.location.origin}/i/${shareId}` : null;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/itinerary-share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ to: to.trim(), note: note.trim(), itinerary_text: text, itinerary_url }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || `Error ${res.status}`);
      }
      capture('itinerary_shared', { via: 'email' });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="chunky" style={{ width: '100%', maxWidth: 440, padding: '28px 28px 24px', background: 'var(--cream)', position: 'relative' }}>
        {sent ? (
          <>
            <p style={{ fontSize: 28, margin: '0 0 10px' }}>✓</p>
            <h3 className="font-display" style={{ fontSize: 22, margin: '0 0 10px', color: 'var(--ink)' }}>Sent!</h3>
            <p style={{ fontSize: 14, color: 'var(--sand-700)', margin: '0 0 20px' }}>Your itinerary is on its way to <strong>{to}</strong>.</p>
            <button className="btn-red" onClick={onClose} style={{ padding: '9px 18px', fontSize: 14 }}>Close</button>
          </>
        ) : (
          <>
            <h3 className="font-display" style={{ fontSize: 22, margin: '0 0 4px', color: 'var(--ink)' }}>Share via email</h3>
            <p style={{ fontSize: 13, color: 'var(--sand-500)', margin: '0 0 20px' }}>Send your itinerary as a branded 10 Days on Aruba email.</p>
            <label style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6, color: 'var(--ink)' }}>
              Recipient email
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="friend@example.com"
                style={{ display: 'block', width: '100%', marginTop: 6, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', borderRadius: 10, border: '2px solid var(--sand-200)', outline: 'none', boxSizing: 'border-box', background: 'var(--cream)' }}
              />
            </label>
            <label style={{ display: 'block', fontWeight: 700, fontSize: 13, margin: '14px 0 6px', color: 'var(--ink)' }}>
              Personal note <span style={{ fontWeight: 400, color: 'var(--sand-400)' }}>(optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Hey! Here's our Aruba plan…"
                rows={3}
                style={{ display: 'block', width: '100%', marginTop: 6, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', borderRadius: 10, border: '2px solid var(--sand-200)', outline: 'none', resize: 'vertical', boxSizing: 'border-box', background: 'var(--cream)' }}
              />
            </label>
            {error && (
              <p style={{ fontSize: 13, color: 'var(--red)', margin: '10px 0 0' }}>{error}</p>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button
                onClick={handleSend}
                disabled={sending || !to.trim()}
                className="btn-red"
                style={{ flex: 1, padding: '10px 18px', fontSize: 14, opacity: (sending || !to.trim()) ? 0.6 : 1, cursor: (sending || !to.trim()) ? 'not-allowed' : 'pointer' }}
              >
                {sending ? 'Sending…' : 'Send itinerary'}
              </button>
              <button
                onClick={onClose}
                style={{ padding: '10px 18px', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', borderRadius: 10, border: '2px solid var(--sand-200)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
