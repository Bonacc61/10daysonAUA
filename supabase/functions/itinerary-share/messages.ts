const SITE = 'https://10daysonaruba.com';
const PARROT = `${SITE}/parrot.png`;
const WORDMARK = `${SITE}/logo-horizontal.png`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

export function shareEmailText(note: string | undefined, itineraryText: string, itineraryUrl?: string | null): string {
  const lines: string[] = [];
  if (note?.trim()) {
    lines.push(note.trim(), '');
  }
  lines.push('──────────────────────────────', itineraryText, '──────────────────────────────', '');
  if (itineraryUrl) {
    lines.push(`Book your activities via the platform: ${itineraryUrl}`, '');
  }
  lines.push(`Plan your own trip at ${SITE}`);
  return lines.join('\n');
}

export function shareEmailHtml(note: string | undefined, itineraryText: string, itineraryUrl?: string | null): string {
  const safeNote = note?.trim() ? `<p style="font-size:16px;line-height:1.6;color:#1A1A1A;margin:0 0 20px;font-style:italic;">${escapeHtml(note.trim())}</p>` : '';
  const safeItinerary = escapeHtml(itineraryText).replace(/\n/g, '<br>');
  const bookUrl = itineraryUrl ?? SITE;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#d9d5c8;padding:24px 12px 40px;font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;">
      <tr><td style="background:#FFD23F;border:2px solid #1A1A1A;border-bottom:none;border-radius:20px 20px 0 0;padding:30px 24px 22px;text-align:center;">
        <img src="${PARROT}" width="112" alt="10 Days on Aruba parrot mascot" style="display:block;margin:0 auto 14px;width:112px;height:auto;" />
        <img src="${WORDMARK}" width="272" alt="10 Days on Aruba" style="display:block;margin:0 auto;width:272px;max-width:82%;height:auto;" />
      </td></tr>
      <tr><td style="background:#FFFBF0;border:2px solid #1A1A1A;border-top:none;border-radius:0 0 20px 20px;padding:34px 34px 30px;box-shadow:6px 6px 0 #1A1A1A;">
        <h1 style="font-family:Caprasimo,Georgia,'Times New Roman',serif;font-size:27px;line-height:1.15;color:#1A1A1A;margin:0 0 18px;">Your Aruba itinerary ✈</h1>
        ${safeNote}
        <div style="background:#F5F0E6;border:1.5px solid #D4C9A8;border-radius:12px;padding:20px 22px;font-size:14px;line-height:1.7;color:#1A1A1A;font-family:'Courier New',Courier,monospace;white-space:pre-wrap;word-break:break-word;">${safeItinerary}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 12px;"><tr>
          <td style="background:#22C55E;border:2px solid #1A1A1A;border-radius:13px;box-shadow:4px 4px 0 #1A1A1A;">
            <a href="${bookUrl}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:700;color:#FFFBF0;text-decoration:none;letter-spacing:-0.2px;">Book your activities via the platform &rarr;</a>
          </td>
        </tr></table>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr>
          <td style="background:#E63946;border:2px solid #1A1A1A;border-radius:13px;box-shadow:4px 4px 0 #1A1A1A;">
            <a href="${SITE}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:700;color:#FFFBF0;text-decoration:none;letter-spacing:-0.2px;">Plan your own trip &rarr;</a>
          </td>
        </tr></table>
        <p style="font-size:16px;line-height:1.6;color:#4a463b;margin:24px 0 0;">Warm regards,<br />The 10&nbsp;Days on Aruba team</p>
      </td></tr>
      <tr><td style="text-align:center;padding:20px 14px 0;font-size:12px;line-height:1.6;color:#8a8474;">
        10&nbsp;Days on Aruba &middot; your Aruba trip, hand-planned<br />
        <a href="${SITE}" style="color:#8a8474;text-decoration:underline;">10daysonaruba.com</a>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
