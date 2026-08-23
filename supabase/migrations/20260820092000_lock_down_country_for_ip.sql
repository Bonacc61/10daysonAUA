-- country_for_ip was reachable by anon. Closing it.
--
-- 20260820091000 created it SECURITY DEFINER on the reasoning that a table with
-- no policies is unreachable by a caller. That reasoning is wrong, and was
-- verified wrong against production today: PostgREST publishes every function
-- in the `public` schema as an RPC endpoint, Postgres grants EXECUTE to PUBLIC
-- by default, and SECURITY DEFINER makes the body run as the owner — so
-- `POST /rest/v1/rpc/country_for_ip` with the public anon key answered 200.
--
-- It returned null only because ip_country is still empty. Once loaded it would
-- have answered with the country, i.e. a free geo-IP service on our database.
--
-- The same mistake would have been far worse in stats_summary, which returns
-- the whole analytics summary; that function is locked down the same way in
-- 20260820093000. Any future SECURITY DEFINER function in `public` needs this
-- revoke — being unreachable through RLS is not the same as being unreachable.

revoke execute on function public.country_for_ip(inet) from public;

revoke execute on function public.country_for_ip(inet) from anon;

revoke execute on function public.country_for_ip(inet) from authenticated;

-- collect calls it with the service role, which must keep its grant explicitly:
-- the only EXECUTE it had was the one PUBLIC handed out above.
grant execute on function public.country_for_ip(inet) to service_role;
