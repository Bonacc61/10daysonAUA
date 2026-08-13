-- 24-month retention for itinerary telemetry (GDPR data minimisation).
--
-- feedback_events has collected one row per swap / approve / add / remove / move
-- since 2026-05-23 with no purge job, so the oldest rows would have been kept
-- forever. This mirrors the contact-submissions cron
-- (20260703180000_contact_retention_cron.sql) and the period stated in the
-- Privacy Policy's "Data we collect" table.
--
-- 24 months rather than the contact form's 12: this is the signal the swap
-- tuning learns from, and a full two seasons is the shortest window that
-- compares a January traveller with a January traveller. Longer than that buys
-- nothing the second year has not already shown.
--
-- No PII is involved either way — the rows carry a random per-browser session id
-- and product codes, and the "why swap?" value is a chip id or the literal 'nl',
-- never the words anyone typed. Retention still applies: pseudonymous behavioural
-- data is personal data under GDPR, and "we did not store a name" is not a
-- retention policy.
--
-- cron.schedule upserts by job name, so re-running this is safe.
create extension if not exists pg_cron;

select cron.schedule(
  'purge-old-feedback-events',
  -- 03:40, twenty minutes after the contact purge, so the two never contend.
  '40 3 * * *',
  $$delete from public.feedback_events where created_at < now() - interval '24 months'$$
);
