-- ============================================================================
-- GEOGRAPHY HEALTH INTEGRATION — EXECUTABLE INSTALL ARTIFACT
--
-- PARKED. NOT APPLIED. Applies after the passive core, the reconciler and
-- docs/geo-health-model.sql; it is the LAST step of the passive installation.
--
-- ⚠️ IT SPLICES THE LIVE BODY AND MUST NOT REPLAY A DATED ONE. Phase 6B (dedb7db)
-- recorded pipeline_health_tick at md5 258df595490b81c3dfcc7086cf9f8c39. THAT IS
-- NO LONGER THE LIVE VALUE: measured 2026-09-20 it is c51e56b4158453184d966f00ef28cbb2,
-- because the other session (Rule #0a) added the local_news_registry heartbeat
-- check at lines 136-153. Replaying the baseline body would DELETE that check
-- while looking like a clean install. The pin below is the CURRENT live value and
-- the splice is purely additive to it.
--
-- WHAT IT ADDS: exactly one more `insert into _eval` immediately before the
-- existing flush into public.pipeline_health_check. Every existing check keeps
-- its name, its ok expression, its alertable flag and its detail text byte for
-- byte - asserted after the splice by counting `insert into _eval` and by the
-- excision proof.
--
-- 🔑 WHY IT REPORTS NOT_ACTIVATED AND NOT HEALTHY. An idle worker produces an
-- empty queue, and an empty queue is indistinguishable from a healthy one if the
-- check keys on "no pending work". geo.geography_health_state (accepted at
-- dedb7db) therefore returns NOT_ACTIVATED whenever geo.geography_activation
-- carries no activation row, regardless of queue depth. This integration
-- propagates that verbatim: `ok` is true for NOT_ACTIVATED so the tick does not
-- page while the system is deliberately off, and `alertable` is FALSE, which the
-- existing renderer at line 185 displays as UNMEASURED rather than as a pass.
-- That is the same convention the file already uses for github_credential's
-- UNKNOWN state - an absence of evidence is never rendered as evidence.
--
-- The probe is wrapped so that a missing or failing geo.geography_health_probe
-- degrades to an explicit UNMEASURED row instead of aborting the whole tick.
-- A health monitor that takes itself down when one component is absent stops
-- reporting the nine checks that still work.
-- ============================================================================

begin;

do $mig$
declare
  _src text; _out text; _back text;
  _md5_before text; _md5_after text; _n int;
  _expect_before constant text := 'c51e56b4158453184d966f00ef28cbb2';
  _find constant text :=
$f$
  insert into public.pipeline_health_check as c (check_name, ok, alertable, detail, since, updated_at)
  select e.c_name, e.c_ok, e.c_alertable, e.c_detail, _now, _now from _eval e
$f$;
  _repl constant text :=
$r$
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
$r$;
  _evals_before int; _evals_after int;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'geo' and p.proname = 'geography_health_probe') then
    raise exception 'DEPENDENCY MISSING: geo.geography_health_probe. Apply docs/geo-health-model.sql first.';
  end if;

  _src := pg_get_functiondef('public.pipeline_health_tick()'::regprocedure);
  _md5_before := md5(_src);
  if _md5_before <> _expect_before then
    raise exception
      'PRECONDITION FAIL / CONCURRENT DRIFT: pipeline_health_tick md5 is %, expected %. '
      'The other session amends this function; re-capture it, re-confirm the anchor is '
      'unique, re-fingerprint and have the diff re-reviewed. DO NOT replay a dated body.',
      _md5_before, _expect_before;
  end if;

  _evals_before := (length(_src) - length(replace(_src, 'insert into _eval', '')))
                   / length('insert into _eval');

  _n := (length(_src) - length(replace(_src, _find, ''))) / length(_find);
  if _n <> 1 then
    raise exception 'ANCHOR NOT UNIQUE: the pipeline_health_check flush occurs % time(s), expected 1.', _n;
  end if;

  _out  := replace(_src, _find, _repl);
  _back := replace(_out, _repl, _find);
  if md5(_back) <> _md5_before then
    raise exception 'EXCISION PROOF FAILED: reversing the splice did not reconstruct the original.';
  end if;

  -- ⚠️ +2, NOT +1, AND THE REASON IS LOAD-BEARING. The replacement carries TWO
  -- `insert into _eval` statements: the normal path and the exception fallback
  -- that degrades to UNMEASURED. A +1 assertion here is WRONG and would abort a
  -- correct apply - measured read-only against the live body on 2026-09-20,
  -- which returned evals 10 -> 12. The first draft of this file asserted +1.
  _evals_after := (length(_out) - length(replace(_out, 'insert into _eval', '')))
                  / length('insert into _eval');
  if _evals_after <> _evals_before + 2 then
    raise exception 'EXPECTED THE TWO geography_progression branches: insert-into-_eval went % -> %.',
      _evals_before, _evals_after;
  end if;
  if (length(_out) - length(replace(_out, 'geography_progression', '')))
     / length('geography_progression') <> 2 then
    raise exception 'The geography check did not land as exactly two branches.';
  end if;

  -- EVERY PRE-EXISTING CHECK MUST SURVIVE, and the list is COMPUTED, never
  -- transcribed (rule 7): it is read from the rows the live tick maintains, so a
  -- check added by another session after this file was written is still covered.
  declare _missing text;
  begin
    select string_agg(c.check_name, ', ')
      into _missing
      from public.pipeline_health_check c
     where position(c.check_name in _out) = 0;
    if _missing is not null then
      raise exception 'SPLICE WOULD DROP EXISTING CHECK(S): %. Refusing.', _missing;
    end if;
  end;

  execute _out;

  _md5_after := md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure));
  if pg_get_functiondef('public.pipeline_health_tick()'::regprocedure) <> _out then
    raise exception 'POST-APPLY: server-rendered body differs from the text applied.';
  end if;
  raise notice 'pipeline_health_tick spliced: md5 % -> %', _md5_before, _md5_after;
  raise notice 'geography_progression will report NOT_ACTIVATED until the worker is armed.';
end $mig$;

commit;
