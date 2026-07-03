// contact-notify — fires on a new contact_submissions row (via a Supabase
// Database Webhook) and sends two emails through TransIP SMTP:
//   1. an internal notification to CONTACT_TO
//   2. a branded acknowledgement to the visitor
//
// The submission row is already durably stored before this runs, so an email
// failure never loses a message — we return non-200 and the webhook retries
// (a rare duplicate email is acceptable).
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { notificationEmail, autoReplyEmail, type Submission } from './messages.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // Only the webhook (holding the shared secret) may trigger a send.
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return json({ error: 'forbidden' }, 403);
  }

  let record: Submission;
  try {
    const payload = await req.json();
    // Webhook sends { type, record, ... }; also accept a bare record (manual test).
    record = (payload?.record ?? payload) as Submission;
    if (!record?.email || !record?.name) return json({ error: 'missing name/email' }, 400);
  } catch {
    return json({ error: 'bad payload' }, 400);
  }

  const user = Deno.env.get('SMTP_USER')!;
  const from = `10 Days on Aruba <${user}>`;
  const to = Deno.env.get('CONTACT_TO') ?? user;
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465');

  const notif = notificationEmail(record);
  const reply = autoReplyEmail(record);

  try {
    const client = new SMTPClient({
      connection: {
        hostname: Deno.env.get('SMTP_HOST')!,
        port,
        tls: port === 465, // implicit TLS on 465; STARTTLS when false (587)
        auth: { username: user, password: Deno.env.get('SMTP_PASS')! },
      },
    });
    // Internal notification — Reply-To the visitor so replying goes straight to them.
    await client.send({
      from, to, replyTo: record.email,
      subject: notif.subject, content: notif.text,
    });
    // Visitor acknowledgement — branded HTML with a plain-text alternative.
    await client.send({
      from, to: record.email,
      subject: reply.subject, content: reply.text, html: reply.html,
    });
    await client.close();
    return json({ ok: true }, 200);
  } catch (e) {
    console.error('contact-notify send failed:', e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
