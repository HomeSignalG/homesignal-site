-- REGULATED FACILITY — KIND ISOLATION.  STATUS: APPLIED TO PRODUCTION 2026-09-06.
--
-- Two migrations, applied in this order against project qwnnmljucajnexpxdgxr:
--     regulated_facility_kind_isolation
--     regulated_facility_zero_is_not_measured
-- The SQL below is the record of what ran. It is idempotent: re-running it is a no-op
-- (each DO block detects its own marker and returns), so it doubles as the reproduction.
--
-- WHY THIS EXISTS
-- ---------------
-- The whole-ZIP Regulated facility population reuses the N5 machinery: EPA FRS physical
-- points become rows in geo.zip_authoritative_membership / geo.zip_authoritative_marker
-- keyed 'epa_frs:<RegistryId>', and public.app_zip_projects_markers(zip,'facility',true)
-- serves them. That reuse is correct and is not reopened here.
--
-- Those two relations carried NO NOTION OF KIND, so the function's p_kind argument had no
-- effect on the geography half at all. Measured on production immediately before applying
-- (2026-09-06, 12-ZIP national panel — 02138 10001 19103 33101 48226 55401 60601 78617
-- 80202 84302 89101 98101, spanning 10 states):
--
--   p_kind='development' -> membership_count 4010 · markers 4227 · projects 4005
--   p_kind='facility'    -> membership_count 4010 · markers 4227 · projects 0
--
-- and on ZIP 84302 the two marker arrays were BYTE-IDENTICAL, md5
-- 52bf9b52666f3603a7963cd711b9603d, with 0 rows on either side of the symmetric difference.
-- A caller asking for FACILITY geography was handed DEVELOPMENT geography, in full, on
-- 11 of the 12 panel ZIPs (the twelfth, 33101, holds no membership at all).
--
-- Nothing a resident saw was wrong, because the shipped page calls this RPC only with
-- p_kind:"development" (homesignalmap.html, the one call site). That is why the defect had
-- to be repaired BEFORE the facility population runs, not after: the moment a facility read
-- goes live, the leak becomes what residents see.
--
-- ── WHAT THE FIRST DRAFT OF THIS FILE GOT WRONG, KEPT AS THE LESSON ────────────────────
-- Drafted 2026-09-05, it spliced on the anchors '     where mm.zcta5 = p_zip)' and
-- '   where k.zcta5 = p_zip;'. By 2026-09-06 the function body had been restructured (a
-- `join lateral` replaced the earlier subselect) and the FIRST anchor occurred ZERO times —
-- so the draft would have raised 'membership anchor is not unique' and changed nothing.
-- That is the fail-closed design working, and it is the reason the anchors are re-asserted
-- against pg_get_functiondef at apply time instead of trusted from a file. A crude
-- position('record_kind' in body) probe ALSO reported the fix was already present: it was
-- matching `p.record_kind = p_kind` on public.app_projects in the legacy branch. A substring
-- is a lead, not a fact — the body was read before anything was written.

-- ══ MIGRATION 1 — regulated_facility_kind_isolation ════════════════════════════════════

-- kind becomes a column, defaulting to what every existing row already is. A non-volatile
-- default is recorded in the catalogue rather than rewritten into the heap, so this is
-- metadata-only on both relations and holds ACCESS EXCLUSIVE for milliseconds.
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
      add constraint zip_auth_membership_kind_ck check (record_kind in ('development','facility'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'zip_auth_marker_kind_ck') then
    alter table geo.zip_authoritative_marker
      add constraint zip_auth_marker_kind_ck check (record_kind in ('development','facility'));
  end if;
end $$;

-- The reads are (zcta5 = one ZIP) then kind, so the existing primary keys already do the
-- selective work and no new index is created. A column is not a reason for an index.

-- Splice the THREE filters into the LIVE function, never a retyped copy (claims-discipline
-- rule 7). Read pg_get_functiondef, assert each anchor occurs EXACTLY once, replace,
-- execute, then re-read and prove the change took against the catalogue.
do $$
declare
  d text; d2 text; before_md5 text;
  a1 constant text := '   where mm.zcta5 = p_zip;';                                    -- projects membership read
  a2 constant text := '   where k.zcta5 = p_zip;';                                     -- marker read
  a3 constant text := 'geo.zip_authoritative_membership mm where mm.zcta5 = p_zip)';   -- membership_count
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_zip_projects_markers';
  if d is null then raise exception 'app_zip_projects_markers not found'; end if;
  before_md5 := md5(d);

  if position('mm.record_kind = p_kind' in d) > 0
     and position('k.record_kind = p_kind' in d) > 0 then
    raise notice 'kind isolation already present (md5 %) - nothing to splice', before_md5;
    return;
  end if;

  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 then
    raise exception 'projects-membership anchor is not unique in the function body'; end if;
  if (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'marker anchor is not unique in the function body'; end if;
  if (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1 then
    raise exception 'membership_count anchor is not unique in the function body'; end if;

  d2 := replace(d,  a1, '   where mm.zcta5 = p_zip and mm.record_kind = p_kind;');
  d2 := replace(d2, a2, '   where k.zcta5 = p_zip and k.record_kind = p_kind;');
  d2 := replace(d2, a3, 'geo.zip_authoritative_membership mm where mm.zcta5 = p_zip and mm.record_kind = p_kind)');

  execute d2;

  select pg_get_functiondef(p.oid) into d2
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_zip_projects_markers';
  if position('mm.record_kind = p_kind' in d2) = 0
     or position('k.record_kind = p_kind' in d2) = 0 then
    raise exception 'splice did not take'; end if;
  if md5(d2) = before_md5 then
    raise exception 'function body unchanged after execute'; end if;
  raise notice 'kind isolation applied: md5 % -> %', before_md5, md5(d2);
end $$;

-- APPLIED RECEIPT (migration 1)
--   function md5 953e236e3bd2551ea631da7aae077f86 -> 3d9a98850f4f659d6bd3945ea2895eb4
--   body length 4452 -> 4535, i.e. EXACTLY +83 characters, which is
--   len(' and mm.record_kind = p_kind') 28 + len(' and k.record_kind = p_kind') 27 + 28 = 83.
--   Three insertions, zero collateral movement — the arithmetic is the proof, not the diff.
--
--   development payload: UNCHANGED.  12-ZIP panel fingerprint
--     md5(zip||'='||md5(payload) joined, order by zip collate "C")
--     = d0336e0646daaa0674f108f3bf33417d  BEFORE and AFTER
--   and 84302's development marker array md5 52bf9b52666f3603a7963cd711b9603d before and after.
--   That "unchanged" is TOTAL over all 12,013 boundary_complete ZIPs, not a sample, because
--   every pre-existing row is record_kind='development' (measured after: 901,465 membership
--   rows and 1,004,080 marker rows, 0 non-development on either), so the added predicate is
--   a tautology in the development direction.
--
--   facility payload: 4010 membership / 4227 markers -> 0 / 0 across the same panel.

-- ══ MIGRATION 2 — regulated_facility_zero_is_not_measured ══════════════════════════════
--
-- A FACILITY ZERO MUST NOT WEAR A "MEASURED" STATUS.
--
-- Migration 1 leaves a subtler defect in the leak's place. `status` still comes from
-- geo.maps_zip_geography_status, which has no notion of kind, so a facility read in a ZIP
-- whose DEVELOPMENT boundary is complete returned
--     status 'boundary_complete', markers [], membership_count 0
-- and lib/zip-authoritative.js rule 1 reads empty ARRAYS under 'boundary_complete' as a
-- MEASURED ZERO — "no regulated facilities in this ZIP". No facility geography has been
-- populated anywhere yet, so that is a claim the data cannot support, on every ZIP.
--
-- Returning development markers was visibly wrong. Returning a measured zero looks correct,
-- which is worse. Until facility membership exists for a ZIP, the facility direction reports
-- the honest not-measured shape the consumer already understands: status 'not_measured',
-- projects null, markers null — never empty arrays, per that file's rule 1.
do $$
declare
  d text; d2 text; before_md5 text;
  a constant text := '  if v_status is distinct from ''boundary_complete'' then';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_zip_projects_markers';
  if d is null then raise exception 'app_zip_projects_markers not found'; end if;
  before_md5 := md5(d);

  if position('facility geography for this ZIP does not exist yet' in d) > 0 then
    raise notice 'facility not-measured guard already present (md5 %)', before_md5;
    return;
  end if;

  -- Fails closed: this REQUIRES kind isolation to be live, because without it the guard
  -- would be reasoning about a marker set that is not kind-scoped in the first place.
  if position('mm.record_kind = p_kind' in d) = 0 or position('k.record_kind = p_kind' in d) = 0 then
    raise exception 'kind isolation is not applied - apply regulated_facility_kind_isolation first';
  end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
    raise exception 'status anchor is not unique in the function body';
  end if;

  d2 := replace(d, a,
    '  -- facility geography for this ZIP does not exist yet: say so, never a measured zero.'
    || chr(10) ||
    '  if p_kind = ''facility'' and not exists ('
    || chr(10) ||
    '       select 1 from geo.zip_authoritative_membership mm'
    || chr(10) ||
    '        where mm.zcta5 = p_zip and mm.record_kind = ''facility'') then'
    || chr(10) ||
    '    v_status := ''not_measured'';'
    || chr(10) ||
    '  end if;'
    || chr(10) || chr(10) ||
    a);

  execute d2;

  select pg_get_functiondef(p.oid) into d2
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_zip_projects_markers';
  if position('facility geography for this ZIP does not exist yet' in d2) = 0 then
    raise exception 'splice did not take'; end if;
  if md5(d2) = before_md5 then
    raise exception 'function body unchanged after execute'; end if;
  raise notice 'facility not-measured guard applied: md5 % -> %', before_md5, md5(d2);
end $$;

-- APPLIED RECEIPT (migration 2)
--   function md5 3d9a98850f4f659d6bd3945ea2895eb4 -> 4037cc5b35113c22869d3cc91fa6e1de
--   body length 4535 -> 4834.
--   development panel fingerprint STILL d0336e0646daaa0674f108f3bf33417d, markers still 4227.
--   facility direction, all 12 panel ZIPs: status 'not_measured', markers JSON null.
--   84302 facility payload verbatim:
--     {"zip":"84302","mode":"authoritative","status":"not_measured","markers":null,"projects":null}
--
--   ⚠️ The first pass at that check asked `j->'markers' is not null`, which is TRUE for a
--   JSON null, and reported 12 ZIPs "returning arrays". jsonb_typeof is the right instrument,
--   and the corrected probe carries its own positive control: the SAME query shape over the
--   DEVELOPMENT direction returns 'array' 12/12 and 'boundary_complete' 12/12, so the
--   facility 12/12 'null' + 'not_measured' is a reading rather than an artefact.

-- ══ 3. THE PRODUCER CHANGES THAT MUST LAND BEFORE ANY FACILITY ROW IS WRITTEN ══════════
--
-- STILL NOT APPLIED, deliberately, and they are the gate on the population step:
--
-- scripts/n5_unit_a_shadow.py, POPULATE:
--     - delete from geo.zip_authoritative_membership where left(zcta5,3) = {PFX};
--     + delete from geo.zip_authoritative_membership
--     +  where left(zcta5,3) = {PFX} and record_kind = 'development';
--   and the INSERT names record_kind explicitly as 'development' rather than relying on the
--   column default, so the writer states its kind instead of inheriting it.
--
-- scripts/n5_a3_markers.py, BUILD: the same two edits on geo.zip_authoritative_marker.
--
-- Both are provably no-ops today — 0 rows carry a non-development kind — so they can land
-- safely at any time. Their whole purpose is what happens the day AFTER: without them, a
-- per-prefix rebuild DELETES every facility row under that prefix and never regenerates it,
-- silently, because the rebuild's own verification counts development rows and a missing
-- facility row looks like nothing at all.
--
-- ⚠️ The N5 national development build is INCOMPLETE (7,996 of 12,719 ZIPs carry membership
-- as of 2026-09-06) and idle — no writer, and no write to any of the three relations for
-- 23h 03m at the time these migrations were applied (newest computed_at 2026-09-05 21:23Z,
-- 0 non-idle backends other than the measuring one). That idleness is what made the ACCESS
-- EXCLUSIVE lock safe to take; it is NOT evidence the build is finished, and the prefix
-- rebuild can resume at any time. Land the two producer edits before writing facility rows.
