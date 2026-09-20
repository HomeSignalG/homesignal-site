-- GENERATED alongside docs/geo-health-integration-install.sql. Regenerate rather
-- than hand-edit: the find/replace text is lifted from that file, not retyped.
--
-- ROLLBACK for the geography health integration. Removes the geography_progression
-- check and asserts the body is md5-identical to the pre-install one, so no
-- half-reverted third version can survive.
--
-- ⚠️ IT REFUSES unless the live body is EXACTLY the post-install one. The other
-- session amends pipeline_health_tick; if it has landed a change since the
-- install, this reversal is not safe and must be re-derived against the new body.
-- Reverting by replaying a dated CREATE OR REPLACE would delete their work.
begin;
do $rb$
declare _out text; _before text;
begin
  _out := pg_get_functiondef('public.pipeline_health_tick()'::regprocedure);
  _before := md5(_out);
  if _before <> 'c98aad2d980a595982638a49e2472223' then
    raise exception 'ROLLBACK PRECONDITION FAIL: live md5 is %, expected the post-install %.',
      _before, 'c98aad2d980a595982638a49e2472223';
  end if;
  _out := replace(_out, $r$
  -- GEOGRAPHY PROGRESSION. While the worker is OFF this reports NOT_ACTIVATED and
  -- is NOT ALERTABLE; it must never read HEALTHY from the absence of executing work.
  begin
    insert into _eval
    select 'geography_progression',
           g.state in ('HEALTHY','NOT_ACTIVATED'),
           g.state <> 'NOT_ACTIVATED',
           g.state || ': ' || coalesce(g.reason,'')
             || ' [pending=' || coalesce(g.pending_keys,0)::text
             || ' oldest='  || coalesce(g.oldest_pending_age::text,'n/a')
             || ' delta='   || coalesce(g.queue_delta,0)::text || ']'
      from geo.geography_health_probe() g;
  exception when others then
    insert into _eval values ('geography_progression', true, false,
      'UNMEASURED: geography health probe unavailable (' || sqlerrm || '). '
      'NOT ALERTABLE - an absent probe is not evidence of health.');
  end;

  insert into public.pipeline_health_check as c (check_name, ok, alertable, detail, since, updated_at)
  select e.c_name, e.c_ok, e.c_alertable, e.c_detail, _now, _now from _eval e
$r$, $f$
  insert into public.pipeline_health_check as c (check_name, ok, alertable, detail, since, updated_at)
  select e.c_name, e.c_ok, e.c_alertable, e.c_detail, _now, _now from _eval e
$f$);
  if md5(_out) <> 'c51e56b4158453184d966f00ef28cbb2' then
    raise exception 'ROLLBACK DID NOT RECONSTRUCT THE ORIGINAL: got %, expected %.',
      md5(_out), 'c51e56b4158453184d966f00ef28cbb2';
  end if;
  execute _out;
  raise notice 'pipeline_health_tick rolled back to %',
    md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure));
end $rb$;
commit;

-- The stale row left behind in public.pipeline_health_check is removed
-- deliberately and separately, so a rollback of the FUNCTION cannot silently
-- delete history a reviewer may still want:
--   delete from public.pipeline_health_check where check_name='geography_progression';
