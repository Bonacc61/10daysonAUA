-- 12-month retention for contact submissions (GDPR data minimisation).
-- Enables pg_cron and schedules a daily purge of rows older than 12 months,
-- matching the retention period stated in the Privacy Policy.
-- cron.schedule upserts by job name, so re-running this is safe.
create extension if not exists pg_cron;

select cron.schedule(
  'purge-old-contact-submissions',
  '20 3 * * *',
  $$delete from public.contact_submissions where created_at < now() - interval '12 months'$$
);
