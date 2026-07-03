-- Fire the contact-notify edge function on each new contact submission.
--
-- SECURITY NOTE: the LIVE trigger embeds the real WEBHOOK_SECRET (matching the
-- edge function's WEBHOOK_SECRET env var). That value is applied out-of-band via
-- the Supabase Management API and is intentionally NOT committed here — the
-- placeholder below is redacted. To (re)apply, substitute the real secret
-- (see `supabase secrets list` for the name) in place of <WEBHOOK_SECRET>.

create extension if not exists pg_net;

create or replace function public.contact_submissions_notify()
returns trigger language plpgsql security definer
set search_path = public, net as $fn$
begin
  perform net.http_post(
    url := 'https://mrfblzsihpecockhsnqe.supabase.co/functions/v1/contact-notify',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-webhook-secret', '<WEBHOOK_SECRET>'
    ),
    body := jsonb_build_object('type', 'INSERT', 'record', to_jsonb(new))
  );
  return new;
end;
$fn$;

drop trigger if exists contact_submissions_notify_trg on public.contact_submissions;
create trigger contact_submissions_notify_trg
  after insert on public.contact_submissions
  for each row execute function public.contact_submissions_notify();
