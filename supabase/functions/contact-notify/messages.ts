// Pure email body builders for contact-notify. No I/O — deterministic, so the
// content (and the HTML-escaping of visitor-supplied text) is unit-testable
// without touching SMTP.

export type Submission = {
  name: string;
  email: string;
  phone?: string | null;
  comment?: string | null;
  created_at?: string | null;
};

const SITE = 'https://10daysonaruba.com';
const PARROT = `${SITE}/parrot.png`;
const WORDMARK = `${SITE}/logo-horizontal.png`;
const FROM_NAME = '10 Days on Aruba';

// The visitor's name is rendered into HTML — escape it so a name can never
// inject markup into the email.
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function firstNameOf(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

// Internal notification to the site owner (plain text; Reply-To set to the
// visitor by the caller so a reply goes straight back to them).
export function notificationEmail(s: Submission): { subject: string; text: string } {
  const when = s.created_at ? new Date(s.created_at).toUTCString() : 'just now';
  return {
    subject: `New contact message from ${s.name}`,
    text: [
      `Name:  ${s.name}`,
      `Email: ${s.email}`,
      `Phone: ${s.phone || '—'}`,
      ``,
      `Message:`,
      s.comment || '(no message)',
      ``,
      `Submitted: ${when}`,
    ].join('\n'),
  };
}

// Branded acknowledgement to the visitor (HTML + plain-text alternative).
export function autoReplyEmail(s: Submission): { subject: string; text: string; html: string } {
  const first = firstNameOf(s.name);
  return {
    subject: 'Thanks for reaching out — 10 Days on Aruba',
    text: [
      `Hi ${first},`,
      ``,
      `Thanks for your message! We've received it and someone from the 10 Days on Aruba team will get back to you shortly.`,
      ``,
      `In the meantime, feel free to keep exploring and building your itinerary: ${SITE}`,
      ``,
      `Warm regards,`,
      `The ${FROM_NAME} team`,
    ].join('\n'),
    html: autoReplyHtml(escapeHtml(first)),
  };
}

// Email-safe (table + inline styles) branded HTML. Parrot + wordmark are hosted
// images so the brand renders regardless of email font support.
function autoReplyHtml(safeFirst: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#d9d5c8;padding:24px 12px 40px;font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;">
      <tr><td style="background:#FFD23F;border:2px solid #1A1A1A;border-bottom:none;border-radius:20px 20px 0 0;padding:30px 24px 22px;text-align:center;">
        <img src="${PARROT}" width="112" alt="10 Days on Aruba parrot mascot" style="display:block;margin:0 auto 14px;width:112px;height:auto;" />
        <img src="${WORDMARK}" width="272" alt="10 Days on Aruba" style="display:block;margin:0 auto;width:272px;max-width:82%;height:auto;" />
      </td></tr>
      <tr><td style="background:#FFFBF0;border:2px solid #1A1A1A;border-top:none;border-radius:0 0 20px 20px;padding:34px 34px 30px;box-shadow:6px 6px 0 #1A1A1A;">
        <h1 style="font-family:Caprasimo,Georgia,'Times New Roman',serif;font-size:27px;line-height:1.15;color:#1A1A1A;margin:0 0 18px;">Thanks for reaching out!</h1>
        <p style="font-size:16px;line-height:1.6;color:#1A1A1A;margin:0 0 14px;">Hi <strong>${safeFirst}</strong>,</p>
        <p style="font-size:16px;line-height:1.6;color:#1A1A1A;margin:0 0 14px;">Thanks for your message! We&rsquo;ve received it and someone from the 10&nbsp;Days on Aruba team will get back to you shortly.</p>
        <p style="font-size:16px;line-height:1.6;color:#1A1A1A;margin:0 0 8px;">In the meantime, feel free to keep exploring and building your itinerary.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr>
          <td style="background:#E63946;border:2px solid #1A1A1A;border-radius:13px;box-shadow:4px 4px 0 #1A1A1A;">
            <a href="${SITE}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:700;color:#FFFBF0;text-decoration:none;letter-spacing:-0.2px;">Plan your trip &rarr;</a>
          </td>
        </tr></table>
        <p style="font-size:16px;line-height:1.6;color:#4a463b;margin:24px 0 0;">Warm regards,<br />The ${FROM_NAME} team</p>
      </td></tr>
      <tr><td style="text-align:center;padding:20px 14px 0;font-size:12px;line-height:1.6;color:#8a8474;">
        10&nbsp;Days on Aruba &middot; your Aruba trip, hand-planned<br />
        <a href="${SITE}" style="color:#8a8474;text-decoration:underline;">10daysonaruba.com</a><br /><br />
        You received this because you contacted us. To request removal of your data, reply to this email.<br />
        <a href="${SITE}/privacy" style="color:#8a8474;text-decoration:underline;">Privacy Policy</a>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
