-- REGULATED FACILITY WHOLE-ZIP — KIND ISOLATION (PARKED; NOT APPLIED)
--
-- WHY THIS EXISTS
-- ---------------
-- The whole-ZIP Regulated facility population reuses the N5 machinery: EPA FRS physical
-- points become rows in geo.zip_authoritative_membership / geo.zip_authoritative_marker
-- keyed 'epa_frs:<RegistryId>', and public.app_zip_projects_markers(zip,'facility',true)
-- serves them. That reuse is correct and is not reopened here.
--
-- But those two relations currently carry NO NOTION OF KIND, and three consumers read or
-- write them as if everything in them were development:
--
--   1. app_zip_projects_markers filters PROJECTS by p_kind but reads MARKERS unfiltered:
--          select ... from geo.zip_authoritative_marker k where k.zcta5 = p_zip;
--      Today that is harmless because only development rows exist. The moment facility
--      rows land, every facility marker would ride out inside the p_kind='development'
--      payload. The page happens to drop them (lib/zip-authoritative.js only builds a site
--      when the marker's project_ref matches a hydrated project), so no resident would see
--      a wrong pin — but "the payload is contaminated and a downstream file saves us" is
--      not isolation, it is one refactor away from being a bug.
--
--   2. scripts/n5_unit_a_shadow.py POPULATE:
--          delete from geo.zip_authoritative_membership where left(zcta5,3) = PFX;
--      then re-inserts ONLY from geo.n5_boundary_membership, whose freeze basis is
--      record_kind='development'.
--
--   3. scripts/n5_a3_markers.py BUILD:
--          delete from geo.zip_authoritative_marker where left(zcta5,3) = PFX;
--      then re-inserts from membership x geo.n5_geom.
--
-- (2) and (3) are the serious half: a prefix rebuild DELETES every facility row under that
-- prefix and never regenerates it, silently, because the rebuild's own verification counts
-- development rows and a missing facility row looks like nothing at all.
--
-- THE CORRECTION IS THE SMALLEST ONE THAT MAKES ALL FOUR REQUIRED PROPERTIES TRUE AT ONCE
-- ---------------------------------------------------------------------------------------
-- Kind becomes a PROPERTY OF THE ROW rather than something inferred from a join:
--
--   * facility markers cannot appear as development objects   -> marker read filtered on kind
--   * development markers cannot appear as facility objects   -> same filter, other direction
--   * the p_kind='development' payload is UNCHANGED           -> every existing row defaults
--                                                               to 'development', so the
--                                                               development result set is
--                                                               identical row-for-row
--   * p_kind='facility' returns only facility objects         -> same filter
--
-- Inferring kind from "does a matching app_projects row of this kind exist" was considered
-- and REJECTED: measured 2026-09-05, 6 markers under ZIP3 786 and 3 under 840 have no
-- development app_projects row at all, so a join-inferred filter would silently DROP nine
-- markers that ride in today's development payload. That is a payload change, and the gate
-- requires the development payload to be unchanged. A real column changes nothing.
--
-- APPLICATION STATUS: NOT APPLIED.
-- At the time of writing another session is running the N5 national development build
-- (workflow phase2-b1-zcta, runs 136-139 on 2026-09-05, branch
-- claude/homesignal-zip-forensics-13xkmw) and is actively rebuilding these very relations
-- prefix by prefix. Applying a schema change to tables under an in-flight destructive
-- rebuild, and populating facilities into them while that rebuild still has roughly half
-- the country to go, would be destroyed row by row. This file is the reviewed correction,
-- to be applied once that build completes; the facility population follows it, never
-- before it.

begin;

-- ── 1. kind becomes a column, defaulting to what every existing row already is ──────────
-- A non-volatile default means Postgres records it in the catalogue rather than rewriting
-- the heap, so this is fast on both relations and does not hold a long lock. Existing
-- writers name their columns explicitly and are unaffected.
alter table geo.zip_authoritative_membership
  add column if not exists record_kind text not null default 'development';
alter table geo.zip_authoritative_marker
  add column if not exists record_kind text not null default 'development';

-- Fails closed on a third kind: app_zip_projects_markers already rejects any p_kind outside
-- these two with errcode 22023, so a row carrying anything else could never be read and
-- would be invisible rather than wrong.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'zip_auth_membership_kind_ck') then
    alter table geo.zip_authoritative_membership
      add constraint zip_auth_membership_kind_ck
      check (record_kind in ('development','facility'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'zip_auth_marker_kind_ck') then
    alter table geo.zip_authoritative_marker
      add constraint zip_auth_marker_kind_ck
      check (record_kind in ('development','facility'));
  end if;
end $$;

-- The reads are (zcta5 = one ZIP) then kind, so the existing primary keys already do the
-- selective work and no new index is created. A column is not a reason for an index.

-- ── 2. splice the two filters into the LIVE function, never a retyped copy ──────────────
-- Same technique as the pipeline-health monitor's check insertion: read
-- pg_get_functiondef, assert each anchor occurs EXACTLY once, replace, execute, then
-- re-read and prove the change took. Retyping a 3,452-character function body to change
-- two lines is how a body silently loses something (claims-discipline rule 7).
do $$
declare
  d text;
  d2 text;
  a1 constant text := '     where mm.zcta5 = p_zip)';
  a2 constant text := '   where k.zcta5 = p_zip;';
  before_md5 text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_zip_projects_markers';
  if d is null then
    raise exception 'app_zip_projects_markers not found';
  end if;
  before_md5 := md5(d);

  -- Idempotent: a second application is a no-op rather than a double splice.
  if position('mm.record_kind = p_kind' in d) > 0
     and position('k.record_kind = p_kind' in d) > 0 then
    raise notice 'kind isolation already present (md5 %) — nothing to splice', before_md5;
    return;
  end if;

  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 then
    raise exception 'membership anchor is not unique in the function body';
  end if;
  if (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'marker anchor is not unique in the function body';
  end if;

  d2 := replace(d, a1, '     where mm.zcta5 = p_zip and mm.record_kind = p_kind)');
  d2 := replace(d2, a2, '   where k.zcta5 = p_zip and k.record_kind = p_kind;');

  execute d2;

  -- Prove the splice took, against the catalogue rather than against the string we sent.
  select pg_get_functiondef(p.oid) into d2
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_zip_projects_markers';
  if position('mm.record_kind = p_kind' in d2) = 0
     or position('k.record_kind = p_kind' in d2) = 0 then
    raise exception 'splice did not take';
  end if;
  if md5(d2) = before_md5 then
    raise exception 'function body unchanged after execute';
  end if;
  raise notice 'kind isolation applied: md5 % -> %', before_md5, md5(d2);
end $$;

commit;

-- ── 3. what must be true afterwards ────────────────────────────────────────────────────
-- Run these as the acceptance check; each is a separate fact, and the development one is
-- the one that must be IDENTICAL to its pre-application value.
--
--   select count(*) from geo.zip_authoritative_membership where record_kind <> 'development';
--     -- expected 0 immediately after this migration
--   select count(*) from geo.zip_authoritative_marker where record_kind <> 'development';
--     -- expected 0 immediately after this migration
--   select md5(public.app_zip_projects_markers('84302','development',true)::text);
--     -- expected: unchanged from the value recorded before applying
--   select public.app_zip_projects_markers('84302','facility',true) -> 'markers';
--     -- expected: [] until the facility population runs; never development markers

-- ── 4. THE PRODUCER CHANGES THAT MUST LAND WITH THIS MIGRATION, NOT BEFORE IT ───────────
-- These are deliberately NOT applied to the scripts yet. Both files are being executed
-- right now by another session's national build, against a database where record_kind does
-- not exist; a script referencing the column before the migration lands would fail their
-- runs. They are recorded here so the change is reviewed as one unit.
--
-- scripts/n5_unit_a_shadow.py, POPULATE:
--     - delete from geo.zip_authoritative_membership where left(zcta5,3) = {PFX};
--     + delete from geo.zip_authoritative_membership
--     +  where left(zcta5,3) = {PFX} and record_kind = 'development';
--   and the INSERT names record_kind explicitly as 'development' rather than relying on the
--   column default, so the writer states its kind instead of inheriting it.
--
-- scripts/n5_a3_markers.py, BUILD:
--     - delete from geo.zip_authoritative_marker where left(zcta5,3) = {PFX};
--     + delete from geo.zip_authoritative_marker
--     +  where left(zcta5,3) = {PFX} and record_kind = 'development';
--   likewise for its INSERT.
--
-- Both edits are provably no-ops on the day they land: measured 2026-09-05, both relations
-- contain 0 rows with record_kind <> 'development' (there are none to spare), so the same
-- rows are deleted and the same rows are inserted. Their whole purpose is what happens the
-- day AFTER, when facility rows exist and a prefix rebuild must leave them alone.

-- ── 5. THE MUTATION PROOF, run read-only against production 2026-09-05 ──────────────────
-- The post-population state was simulated in CTEs on ZIP 84302 — its 22 real EPA FRS
-- facilities injected as facility membership and markers beside the live development rows —
-- and both directions measured:
--
--   development membership 34 · facility membership 22
--   development markers, kind-filtered      188   <- identical to the live table's 188
--   facility markers, kind-filtered          22
--   facility rows inside the dev payload      0
--   development rows inside the fac payload   0
--   markers the SHIPPED unfiltered read would return  210  (= 188 + 22)
--
-- The last line is what makes the proof load-bearing rather than decorative: without the
-- filter the development payload gains all 22 facility markers. With it, the development
-- payload is unchanged and neither kind can reach the other.
