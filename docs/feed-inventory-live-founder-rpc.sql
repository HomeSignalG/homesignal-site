-- feed_inventory_live is internal (feed/coverage inventory). The Acquisition Dashboard reads it through this
-- founder-gated function instead of selecting the view directly.
-- STEP 1 (applied 2026-10-23, migration hs_feed_inventory_live_founder_rpc_20261023): create the function.
-- STEP 2 (apply AFTER the acquisition.html change is deployed, or the live panel goes blank):
--   revoke select on public.feed_inventory_live from authenticated;
-- Rollback: grant select on public.feed_inventory_live to authenticated;

create or replace function public.hs_feed_inventory_live()
returns setof public.feed_inventory_live
language plpgsql
security definer
set search_path = public
as $$
declare caller_email text := auth.jwt() ->> 'email';
begin
  if caller_email is null
     or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query select * from public.feed_inventory_live order by sort;
end $$;
revoke all on function public.hs_feed_inventory_live() from public, anon;
grant execute on function public.hs_feed_inventory_live() to authenticated, service_role;
