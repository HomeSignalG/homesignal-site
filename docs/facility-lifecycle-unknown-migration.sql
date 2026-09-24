-- docs/facility-lifecycle-unknown-migration.sql
--
-- REMOVE THE UNSOURCED "Operating" FROM EVERY EPA FACILITY ROW (2026-09-24).
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────────────
-- public.app_refresh_zip wrote the LITERAL 'Operating' into app_projects.status for every
-- record_kind='facility' row. Nothing upstream supports it: EPA FRS (the only facility
-- producer, get-address-report sources/epa-frs.ts) returns no lifecycle field at all, and an
-- FRS registration is not evidence that a facility operates. Measured before this change:
-- 197,991 facility rows across 11,315 ZIPs, 197,991 carrying 'Operating' (100%). Cromby
-- Generating Station (ZIP 19475, FRS 110000584868) was one of them while EPA's own ICIS-Air
-- program lists it "Permanently Closed" and its NPDES permit is issued to "FORMER CROMBY
-- GENERATING STATION".
--
-- ── WHAT THIS DOES — AND DELIBERATELY DOES NOT ───────────────────────────────────────
-- It writes the canonical UNKNOWN value this function already writes for a development row
-- whose source states no lifecycle: 'On file' (the `else` of the development CASE). Map 1's
-- lifecycle contract reads 'On file' as `unknown` ("Lifecycle unknown"; lib/map.js
-- statusTier, lib/n5-radius.js n5BucketFromStatus). No new vocabulary, no new column.
--
--   * It does NOT infer Closed. There is no Closed lifecycle, and an EPA program or permit
--     status (Permanently Closed / Terminated / Effective / Admin Continued …) is regulatory
--     evidence about a PROGRAM, not a documented physical lifecycle. Those facts stay exactly
--     where they are (facility_env.epa.permits[] etc.), untouched.
--   * It does NOT read the element's `type`. The producer stamped type='built' on every FRS
--     element; that stamp is not lifecycle evidence either.
--   * It changes NOTHING ELSE: not the development branch (which also contains an
--     'Operating' literal — 'operating' bucket → 'Operating' — and must keep it), not Type,
--     geography, facility_env, provenance, membership or keys.
--
-- ── SAFETY ───────────────────────────────────────────────────────────────────────────
-- Spliced from the LIVE body (never a retyped CREATE OR REPLACE of ~19,000 characters that
-- other sessions also edit). Fails closed unless the facility anchor appears EXACTLY once.
-- The anchor includes the facility insert's own `coalesce(nullif(el->>'src',''),'Public
-- registry')`, which the development branch does not carry, so the similarly worded
-- development literal cannot be matched. After execute it proves: the old anchor is gone,
-- the new fragment is present once, the development CASE fragment is still present exactly
-- once, and — the strongest check — reversing the one replacement on the NEW body reproduces
-- the OLD body's md5 byte for byte, i.e. nothing else in the function moved.
--
-- Rows change as each ZIP is rematerialized by the existing supported path
-- (cron `app-content-refresh` → public.app_refresh_sweep(), oldest-first; a full cycle was
-- measured at ~10.8 h, 1,176 ZIPs/hour, on 2026-09-24).
--
-- Applied 2026-09-24 as migration `facility_lifecycle_unknown_20260924`; md5 before
-- 6591d7f79f9a6cd0b476bbcfc2065b9a (19,428 chars). The after-md5 is in the PR receipt.

do $mig$
declare
  _def    text;
  _before text;
  _after  text;
  _old    text := $old$      'Operating', coalesce(nullif(el->>'src',''),'Public registry'),$old$;
  _new    text := $new$      -- LIFECYCLE UNKNOWN (2026-09-24): EPA FRS states no lifecycle; registration is not operation.
      'On file', coalesce(nullif(el->>'src',''),'Public registry'),$new$;
  _devfrag text := $dev$when 'proposed' then 'Proposed' when 'operating' then 'Operating'$dev$;
  _n int;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';
  if _def is null then
    raise exception 'app_refresh_zip not found — refusing to guess at its body';
  end if;
  _before := _def;

  -- Idempotent: already applied means nothing to do.
  if position(_new in _def) > 0 and position(_old in _def) = 0 then
    raise notice 'facility lifecycle already unknown — nothing to do (md5 %)', md5(_def);
    return;
  end if;

  -- FAIL CLOSED ON THE ANCHOR.
  _n := (length(_def) - length(replace(_def, _old, ''))) / length(_old);
  if _n <> 1 then
    raise exception 'facility anchor found % time(s), expected exactly 1 — re-derive it, do not loosen it', _n;
  end if;
  -- The development literal must be present exactly once BEFORE, so its survival AFTER means something.
  _n := (length(_def) - length(replace(_def, _devfrag, ''))) / length(_devfrag);
  if _n <> 1 then
    raise exception 'development lifecycle fragment found % time(s) before splice, expected 1', _n;
  end if;

  execute replace(_def, _old, _new);

  select pg_get_functiondef(p.oid) into _after
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';

  if position(_old in _after) > 0 then
    raise exception 'splice did not take — the facility ''Operating'' literal is still present';
  end if;
  if (length(_after) - length(replace(_after, _new, ''))) / length(_new) <> 1 then
    raise exception 'new facility fragment not present exactly once after splice';
  end if;
  if (length(_after) - length(replace(_after, _devfrag, ''))) / length(_devfrag) <> 1 then
    raise exception 'development lifecycle fragment changed by the splice';
  end if;
  -- NOTHING ELSE MOVED: undo the one replacement on the stored body and require the old md5.
  if md5(replace(_after, _new, _old)) <> md5(_before) then
    raise exception 'reversal does not reproduce the pre-change body — something besides the facility literal changed';
  end if;

  raise notice 'app_refresh_zip md5 % -> % (len % -> %)', md5(_before), md5(_after), length(_before), length(_after);
end
$mig$;
