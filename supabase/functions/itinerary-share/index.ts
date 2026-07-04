// itinerary-share — user-initiated: receives a JWT bearer token + target email
// address, builds a branded itinerary email, and sends it via TransIP SMTP.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { shareEmailHtml, shareEmailText } from './messages.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // --- Auth: validate the Supabase JWT by calling the auth API ---
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: supabaseKey },
  });
  if (!userRes.ok) return json({ error: 'Invalid token' }, 401);

  const { email: senderEmail } = (await userRes.json()) as { email?: string };

  // --- Parse body ---
  let body: { to?: string; note?: string; itinerary_text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const { to, note, itinerary_text } = body;
  if (!to || !itinerary_text) return json({ error: 'Missing to or itinerary_text' }, 400);

  // --- Send email ---
  const smtpUser = Deno.env.get('SMTP_USER')!;
  const from = `10 Days on Aruba <${smtpUser}>`;
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465');

  try {
    const client = new SMTPClient({
      connection: {
        hostname: Deno.env.get('SMTP_HOST')!,
        port,
        tls: port === 465,
        auth: { username: smtpUser, password: Deno.env.get('SMTP_PASS')! },
      },
    });

    await client.send({
      from,
      to,
      replyTo: senderEmail ?? smtpUser,
      subject: 'Your Aruba itinerary — 10 Days on Aruba',
      content: shareEmailText(note, itinerary_text),
      html: shareEmailHtml(note, itinerary_text),
    });

    await client.close();
    return json({ ok: true });
  } catch (e) {
    console.error('itinerary-share send failed:', e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
