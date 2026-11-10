-- DDL of record (site repo: maps_zip_order and its subscriber rule live here,
-- docs/maps-zip-order.sql + docs/maps-zip-order-subscriber-zips.sql).
--
-- The hourly monitor learns to see a development-alert subscriber who is getting no email (2026-11-09).
--
-- WHY. docs/maps-zip-order-subscriber-zips.sql puts every development-alert (stream 'maps')
-- subscriber's ZIP on the MAPS post list. That alone sends nobody an email: a draft still has to be
-- made, approved and published, and a ZIP Map 1 draws no project for can never get a post. The
-- rule's triggers also turn their own errors into a WARNING (a sign-up is never blocked), so a
-- broken rule would look exactly like a working one. Nothing in pipeline_health_tick() read
-- maps_zip_order (read 2026-11-09: the body names it 0 times).
--
-- WHAT IT ADDS: maps_subscriber_zips, alertable. It FAILS when
--   * fewer than 2 of the rule's triggers are installed (user_subscriptions_maps_zip_order,
--     users_maps_zip_order); or
--   * a ZIP with an active maps subscriber (public.alert_subscription_state, stream 'maps',
--     subscribed, the subscription's own level='zip' community) is not on public.maps_zip_order; or
--   * a ZIP has had a non-test maps subscriber for more than 7 days and has no published,
--     un-withdrawn MAPS post (social_posts content_family 'MAPS', status 'published', no
--     social_post_withdrawals row): the MAPS email sends only such posts, so that person has had
--     no email.
-- "Test" means every subscriber on that ZIP carries users.referral_source = 'admin_test'. Those
-- ZIPs are counted in the detail and never page. 7 days is this monitor's own threshold, not a
-- founder parameter: long enough for a draft to be made, approved and posted on the 2-a-day schedule.
--
-- Measured before writing (2026-11-09, production): 68 subscriber ZIPs, 0 not on the list,
-- 45 with no published MAPS post, every one of those 45 test-only except 85083 and 64166, whose
-- real subscribers signed up 2026-11-09 and 2026-11-06 (under 7 days). So the check reads ok today.
--
-- THE SPLICE follows docs/dc-acquisitions-monitor.sql: the live definition is read, never retyped;
-- it refuses unless the body fingerprints to the one it was written against (md5
-- 3ac532673a460298b7cae95e7f21be97, 63,670 characters, read 2026-11-09) or already carries the
-- check; and it proves the change was ONE insertion, that the check name appears exactly twice, and
-- that owner, grants, SECURITY DEFINER, search_path, volatility, arguments and result did not
-- change. Safe to apply twice.
do $mig$
declare
  fn        constant regprocedure := 'public.pipeline_health_tick()'::regprocedure;
  pre_md5   constant text := '3ac532673a460298b7cae95e7f21be97';
  _anchor   constant text := 'insert into public.pipeline_health_check as c (';
  _name     constant text := '''maps_subscriber_zips''';
  _block    constant text := $blk$
  -- MAPS SUBSCRIBER ZIPS (2026-11-09). A development-alert subscriber whose ZIP is not on the MAPS
  -- post list, or who has waited more than 7 days with no published MAPS post (so no email).
  begin
    insert into _eval
    select 'maps_subscriber_zips',
           (m.n_trig = 2 and m.n_missing = 0 and m.n_stale = 0),
           true,
           case when m.n_trig <> 2
                then 'only ' || m.n_trig || ' of the 2 triggers that put a subscriber''s ZIP on the MAPS post list are installed;'
                     || ' re-apply docs/maps-zip-order-subscriber-zips.sql'
                when m.n_missing > 0
                then m.n_missing || ' development-alert subscriber ZIP(s) are not on the MAPS post list: ' || m.missing
                     || '. Run select public.maps_zip_order_sync_subscribers(); and check the trigger warnings'
                when m.n_stale > 0
                then m.n_stale || ' ZIP(s) have had a development-alert subscriber for over 7 days and no published MAPS post,'
                     || ' so those subscribers have had no email: ' || m.stale
                     || '. Create + refresh drafts in All Maps, then approve; a ZIP Map 1 draws no project for cannot get a post'
                else m.n_zips || ' subscriber ZIP(s), all on the post list; ' || m.n_waiting
                     || ' with a subscriber under 7 days and no post yet; ' || m.n_test || ' test-only ZIP(s) not watched' end
      from (select (select count(*) from pg_catalog.pg_trigger t
                     where not t.tgisinternal
                       and t.tgname in ('user_subscriptions_maps_zip_order', 'users_maps_zip_order')) as n_trig,
                   count(*) as n_zips,
                   count(*) filter (where not z.listed) as n_missing,
                   string_agg(z.zip, ', ' order by z.zip collate "C") filter (where not z.listed) as missing,
                   count(*) filter (where z.real_since < _now - interval '7 days' and not z.posted) as n_stale,
                   string_agg(z.zip || ' (since ' || to_char(z.real_since at time zone 'UTC', 'YYYY-MM-DD') || ')', ', '
                              order by z.zip collate "C")
                     filter (where z.real_since < _now - interval '7 days' and not z.posted) as stale,
                   count(*) filter (where z.real_since >= _now - interval '7 days' and not z.posted) as n_waiting,
                   count(*) filter (where z.real_since is null) as n_test
              from (select g.zip, g.real_since,
                           exists (select 1 from public.maps_zip_order o where o.zip = g.zip) as listed,
                           exists (select 1 from public.social_posts p
                                    where p.content_family = 'MAPS' and p.status = 'published' and p.zip = g.zip
                                      and not exists (select 1 from public.social_post_withdrawals w
                                                       where w.social_post_id = p.id)) as posted
                      from (select c.zip_codes[1] as zip,
                                   min(us.created_at) filter (where u.referral_source is distinct from 'admin_test') as real_since
                              from public.alert_subscription_state s
                              join public.communities c on c.id = s.community_id
                              join public.users u on u.id = s.user_id
                              join public.user_subscriptions us
                                on us.user_id = s.user_id and us.community_id = s.community_id
                               and us.stream = s.stream and us.topic = s.topic
                             where s.stream = 'maps' and s.subscribed
                               and c.level = 'zip' and cardinality(c.zip_codes) = 1
                               and c.zip_codes[1] ~ '^[0-9]{5}$'
                             group by c.zip_codes[1]) g) z) m;
  exception when others then
    insert into _eval values ('maps_subscriber_zips', false, true,
                              'the maps_subscriber_zips check could not run: ' || sqlerrm);
  end;

$blk$;
  _src          text;
  _def          text;
  _n            int;
  _attrs_before text;
  _attrs_after  text;
begin
  perform set_config('lock_timeout', '5s', true);

  select p.prosrc into _src from pg_catalog.pg_proc p where p.oid = fn;
  if position(_name in _src) > 0 then
    if (length(_src) - length(replace(_src, _name, ''))) / length(_name) <> 2 then
      raise exception 'pipeline_health_tick: % must appear exactly twice (its insert and its failure row). Not applied.', _name;
    end if;
    raise notice 'pipeline_health_tick: maps_subscriber_zips already present (body md5 %)', md5(_src);
    return;
  end if;
  if md5(_src) <> pre_md5 then
    raise exception 'pipeline_health_tick drifted (body md5 %, expected %). Re-derive this migration. Not applied.',
      md5(_src), pre_md5;
  end if;

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    into _attrs_before from pg_catalog.pg_proc p where p.oid = fn;

  _def := pg_get_functiondef(fn);
  _n := (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor);
  if _n <> 1 then
    raise exception 'pipeline_health_tick: anchor % appears % time(s), expected exactly 1. Not applied.', _anchor, _n;
  end if;

  execute replace(_def, _anchor, _block || '  ' || _anchor);

  select p.prosrc into _src from pg_catalog.pg_proc p where p.oid = fn;
  if md5(replace(_src, _block || '  ' || _anchor, _anchor)) <> pre_md5 then
    raise exception 'pipeline_health_tick: the splice was not one clean insertion (excised body md5 %, expected %). Rolled back.',
      md5(replace(_src, _block || '  ' || _anchor, _anchor)), pre_md5;
  end if;
  if (length(_src) - length(replace(_src, _name, ''))) / length(_name) <> 2 then
    raise exception 'pipeline_health_tick: % must appear exactly twice. Rolled back.', _name;
  end if;
  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    into _attrs_after from pg_catalog.pg_proc p where p.oid = fn;
  if _attrs_after is distinct from _attrs_before then
    raise exception 'pipeline_health_tick: its attributes changed during the splice (% -> %). Rolled back.', _attrs_before, _attrs_after;
  end if;

  raise notice 'pipeline_health_tick: maps_subscriber_zips added (body md5 % -> %)', pre_md5, md5(_src);
end
$mig$;

-- VERIFY AFTER APPLYING: the next hourly tick at :10 fills the row.
--   select ok, alertable, detail from public.pipeline_health_check where check_name = 'maps_subscriber_zips';
