-- ONE-TIME, DATED (founder, 2026-11-11: "i want to remove pierce county zips now"; chosen option
-- "Test sign-ups don't count"). Apply AFTER the 2026-11-11 version of
-- docs/maps-zip-order-subscriber-zips.sql and docs/maps-subscriber-zips-monitor-real-only.sql.
--
-- Takes off the MAPS post list every ZIP whose only map-email sign-ups are test identities
-- (public.bsky_maps_known_test_identity). Measured before writing (2026-11-11, production): the
-- list held 68 ZIPs; 66 are test-only (the 65 Pierce County WA ZIPs, each with one admin_test
-- sign-up, and Bend 97702, a test-manual sign-up); 85083 and 64166 have a real subscriber and stay.
-- The set is computed here, never typed, and the run refuses unless it is exactly the measured set
-- (n = 66, md5 7814c399b9a8ef25101e697e9e755b3c over the ZIPs sorted collate "C"). The test
-- sign-ups themselves are not touched. The remaining ZIPs keep their order and are renumbered 1..n.
do $$
declare n int; fp text; left_n int;
begin
  perform pg_advisory_xact_lock(hashtext('public.maps_zip_order'));
  create temp table _rm on commit drop as
    select o.zip
      from public.maps_zip_order o
      join (select c.zip_codes[1] as zip, bool_or(not public.bsky_maps_known_test_identity(s.user_id)) as has_real
              from public.alert_subscription_state s
              join public.communities c on c.id = s.community_id
             where s.stream = 'maps' and s.subscribed and c.level = 'zip' and cardinality(c.zip_codes) = 1
             group by 1) su on su.zip = o.zip
     where not su.has_real;
  select count(*), md5(string_agg(zip, ',' order by zip collate "C")) into n, fp from _rm;
  if n = 0 then raise notice 'nothing to remove (already applied)'; return; end if;
  if n <> 66 or fp <> '7814c399b9a8ef25101e697e9e755b3c' then
    raise exception 'the test-only set moved (n %, md5 %); re-measure before removing. Nothing removed.', n, fp;
  end if;
  -- keep the remaining ZIPs in their order, renumbered 1..n (positions are the primary key and
  -- must stay >= 1, so the rows are rewritten rather than shifted)
  create temp table _keep on commit drop as
    select o.zip, o.uploaded_at, row_number() over (order by o.founder_position) as rn
      from public.maps_zip_order o where not exists (select 1 from _rm r where r.zip = o.zip);
  delete from public.maps_zip_order where true;
  insert into public.maps_zip_order (founder_position, zip, uploaded_at)
    select rn::integer, zip, uploaded_at from _keep order by rn;
  select count(*) into left_n from public.maps_zip_order;
  if left_n <> 2 or (select string_agg(zip, ',' order by founder_position) from public.maps_zip_order) <> '85083,64166' then
    raise exception 'unexpected list after removal; rolled back';
  end if;
  if public.maps_zip_order_sync_subscribers() <> 0 then
    raise exception 'the list rule put a ZIP back; rolled back';
  end if;
  raise notice 'removed % test-only ZIPs; the list is now 85083, 64166', n;
end $$;
