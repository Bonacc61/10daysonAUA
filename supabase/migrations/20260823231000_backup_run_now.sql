-- Runs the backup once at migration time so the table is not empty until the
-- first 23:50, and so the copy is proven against real rows rather than assumed.
-- Identical body to the scheduled job; `on conflict do nothing` makes running it
-- twice a no-op.
insert into public.web_events_backup (
  id, created_at, name, visitor_day_hash, path, referrer_host, campaign,
  country, device, product_code, destination_host, milestone
)
select id, created_at, name, visitor_day_hash, path, referrer_host, campaign,
       country, device, product_code, destination_host, milestone
from public.web_events
on conflict (id) do nothing;
