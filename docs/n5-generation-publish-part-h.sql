-- GENERATED from docs/n5-generation-publish-part-d.sql (its D14 block and D12's activate),
-- verbatim - never hand-edited. Part H (Fix 5, 2026-10-08).
-- Regenerate: python3 test/n5_generation_pg/build_part_h.py
--
-- THE PRE-ACTIVATION PROOF. Until now a generation that passed READY was switched onto Map 1
-- in the same tick. READY proves the build is complete; it does not prove the build agrees
-- with what residents see today. After this file, geo.n5_generation_activate refuses a
-- generation unless its NEWEST pre-activation proof (geo.n5_generation_proof) passed, was taken
-- against the generation that is STILL serving, and its data checks still hold now - they are
-- recomputed inside the switching transaction. The proof is recorded by
-- geo.n5_generation_record_proof while the generation is READY: prefix receipts, canonical ZIP
-- reconciliation, no undeclared missing boundary, membership against the serving generation,
-- and the browser parity result the orchestrator measured.
--
-- Additive except activate. Applying it with no proof recorded STOPS the daily automatic switch
-- until the orchestrator records one - that is the point. Map 1 is unchanged.
--
-- ONE transaction. Fail-closed on both sides:
--   before: the live activate must be exactly the previous DDL of record (md5(prosrc) 2ccb4d4d25439d786d66c3dfbc384d30);
--   after:  activate 6e7ce8ade5d6718e06d366f82d5a6f7c, and each new function its DDL-of-record body.
begin;
set local lock_timeout = '10s';
do $h$
declare m text;
begin
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_generation_activate';
  if m is distinct from '2ccb4d4d25439d786d66c3dfbc384d30' then
    raise exception 'part H: live n5_generation_activate is % - not the previous DDL of record; refusing', m;
  end if;
end $h$;

-- ---------------------------------------------------------------------------
-- D14. THE PRE-ACTIVATION PROOF (Fix 5, 2026-10-08). READY says the build is complete; it
--      does not say the build agrees with what residents see today. Before a generation may
--      replace the serving one it must carry a PASSED proof, recorded while it is READY,
--      against the generation serving at that moment. ACTIVATE recomputes every data check
--      below inside the switching transaction (D12), so a proof row is evidence that the
--      browser check ran, never a substitute for the data checks.
--
--      Data checks (geo.n5_generation_preactivation_problems):
--        * prefix receipts: every published prefix's recorded row counts equal the rows the
--          generation holds in that prefix now, and no row sits outside a receipt;
--        * canonical ZIPs: no status row for a ZIP outside the registry, and every
--          boundary_complete status declares exactly the membership rows it holds;
--        * missing boundaries: the canonical ZIPs without a boundary are EXACTLY the declared
--          list (docs/maps-coverage/fix4/no-boundary-zip-classification.csv, passed in by the
--          orchestrator, never transcribed), and no unmeasured ZIP holds a member;
--        * membership against the serving generation: every (ZIP, project) the serving
--          generation shows that the candidate does not is explained - the project moved to
--          another ZIP, carries an unresolved outcome, or left the candidate's capture.
--      Browser check: the orchestrator renders sample ZIPs of both generations through
--      geo.n5_zip_projects_markers_at (the function Map 1 itself reads through) and records
--      the result; geo.n5_generation_record_proof refuses a result that is not a pass for
--      exactly this candidate against exactly the serving generation, over at least 10 ZIPs.
--
--      Measured 2026-10-08 on production, n5-national-2026-10-07 (serving) against its
--      predecessor 2026-10-06: 584 receipts, 0 differing (membership 910,032, markers
--      1,017,251, status 12,722); 12,722 status rows, 0 outside the registry; 706 not_measured,
--      md5 7d1bf19a... = the Fix 4 classification; 1,000 exits over 983 projects = 771 left the
--      capture + 212 POINT_REJECTED, 0 unexplained.
-- ---------------------------------------------------------------------------
create table if not exists geo.n5_generation_proof (
  proof_id                  bigint generated always as identity primary key,
  generation_id             text not null,
  baseline_generation_id    text,
  run_id                    text not null,
  recorded_at               timestamptz not null default now(),
  declared_no_boundary      text[] not null,
  declared_no_boundary_md5  text not null,
  problems                  jsonb not null,
  browser                   jsonb not null,
  passed                    boolean not null
);
create index if not exists n5_generation_proof_gen on geo.n5_generation_proof (generation_id, proof_id);
alter table geo.n5_generation_proof enable row level security;
revoke all on geo.n5_generation_proof from public;
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on geo.n5_generation_proof from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on geo.n5_generation_proof from authenticated';
  end if;
end $grants$;

create or replace function geo.n5_generation_preactivation_problems(
  p_generation_id text, p_baseline_generation_id text, p_declared_no_boundary text[])
returns table (check_name text, n bigint)
language sql stable
set search_path = geo, public, pg_temp
as $$
  with g as (select * from geo.n5_generation where generation_id = p_generation_id),
  decl as (select distinct d.zip from unnest(coalesce(p_declared_no_boundary, '{}'::text[])) d(zip)),
  rec as (select p.z3, p.boundary_rows, p.membership_rows, p.marker_rows, p.status_rows
            from geo.n5_generation_publish p where p.generation_id = p_generation_id),
  m as (select left(zcta5, 3) z3, count(*) n from geo.zip_authoritative_membership
         where generation_id = p_generation_id group by 1),
  k as (select left(zcta5, 3) z3, count(*) n from geo.zip_authoritative_marker
         where generation_id = p_generation_id group by 1),
  s as (select left(zip, 3) z3, count(*) n from geo.maps_zip_geography_status
         where generation_id = p_generation_id group by 1),
  b as (select left(zcta5, 3) z3, count(*) n from geo.n5_boundary_membership
         where generation_id = p_generation_id group by 1),
  -- (ZIP, project) pairs the serving generation shows and the candidate does not
  ex as materialized (
    select o.zcta5, o.source_key from geo.zip_authoritative_membership o
     where p_baseline_generation_id is not null
       and o.generation_id = p_baseline_generation_id
       and not exists (select 1 from geo.zip_authoritative_membership c
                        where c.generation_id = p_generation_id
                          and c.zcta5 = o.zcta5 and c.source_key = o.source_key)),
  ek as materialized (select distinct source_key from ex),
  moved as materialized (
    select distinct c.source_key from geo.zip_authoritative_membership c join ek using (source_key)
     where c.generation_id = p_generation_id),
  unres as materialized (
    select distinct u.source_key from geo.n5_generation_unresolved u join ek using (source_key)
     where u.generation_id = p_generation_id),
  cap as materialized (
    select distinct e.source_key from public.n5_expected_captured((select snapshot_id from g)) e
      join ek using (source_key)),
  checks as (
    select 'declared_no_boundary_empty'::text c,
           case when (select count(*) from decl) = 0 then 1 else 0 end::bigint n
    union all
    select 'declared_no_boundary_not_canonical',
           (select count(*) from decl where not exists (select 1 from public.canonical_zip_registry r where r.zip = decl.zip))
    union all
    select 'undeclared_missing_boundary',
           (select count(*) from geo.maps_zip_geography_status st
             where st.generation_id = p_generation_id and st.status <> 'boundary_complete'
               and not exists (select 1 from decl where decl.zip = st.zip))
    union all
    select 'declared_no_boundary_measured',
           (select count(*) from decl
             where not exists (select 1 from geo.maps_zip_geography_status st
                                where st.generation_id = p_generation_id and st.zip = decl.zip
                                  and st.status <> 'boundary_complete'))
    union all
    select 'status_zip_not_canonical',
           (select count(*) from geo.maps_zip_geography_status st
             where st.generation_id = p_generation_id
               and not exists (select 1 from public.canonical_zip_registry r where r.zip = st.zip))
    union all
    select 'status_declares_wrong_membership_count',
           (select count(*) from geo.maps_zip_geography_status st
             where st.generation_id = p_generation_id and st.status = 'boundary_complete'
               and st.membership_rows is distinct from
                   (select count(*) from geo.zip_authoritative_membership mm
                     where mm.generation_id = p_generation_id and mm.zcta5 = st.zip))
    union all
    select 'member_on_unmeasured_zip',
           (select count(*) from geo.zip_authoritative_membership mm
             where mm.generation_id = p_generation_id
               and not exists (select 1 from geo.maps_zip_geography_status st
                                where st.generation_id = p_generation_id and st.zip = mm.zcta5
                                  and st.status = 'boundary_complete'))
    union all
    select 'receipt_membership_rows_differ',
           (select count(*) from rec left join m using (z3) where rec.membership_rows is distinct from coalesce(m.n, 0))
    union all
    select 'receipt_marker_rows_differ',
           (select count(*) from rec left join k using (z3) where rec.marker_rows is distinct from coalesce(k.n, 0))
    union all
    select 'receipt_status_rows_differ',
           (select count(*) from rec left join s using (z3) where rec.status_rows is distinct from coalesce(s.n, 0))
    union all
    select 'receipt_boundary_rows_differ',
           (select count(*) from rec left join b using (z3) where rec.boundary_rows is distinct from coalesce(b.n, 0))
    union all
    select 'rows_outside_receipts',
           (select count(*) from (select z3 from m union select z3 from k union select z3 from s union select z3 from b) x
             where not exists (select 1 from rec where rec.z3 = x.z3))
    union all
    select 'serving_member_exit_unexplained',
           (select count(*) from ex
             where not exists (select 1 from moved where moved.source_key = ex.source_key)
               and not exists (select 1 from unres where unres.source_key = ex.source_key)
               and exists (select 1 from cap where cap.source_key = ex.source_key))
    union all
    select 'candidate_is_serving',
           case when p_generation_id = p_baseline_generation_id then 1 else 0 end::bigint)
  select c, n from checks where n > 0;
$$;
revoke all on function geo.n5_generation_preactivation_problems(text, text, text[]) from public;

-- Records the proof for a READY generation against the generation serving NOW. A failed proof
-- is recorded too (passed = false) and returned, never raised: the evidence of a refusal is
-- kept. ACTIVATE (D12) accepts only the newest proof, only if it passed, and only against the
-- generation that is still serving.
create or replace function geo.n5_generation_record_proof(
  p_generation_id text, p_run_id text, p_declared_no_boundary text[], p_browser jsonb)
returns geo.n5_generation_proof
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare
  g        geo.n5_generation;
  serving  text;
  probs    jsonb;
  bproblem text[] := '{}';
  decl     text[];
  r        geo.n5_generation_proof;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'proof: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if g.state <> 'READY' then
    raise exception 'proof: generation % is %, not READY', p_generation_id, g.state using errcode = '22023';
  end if;
  if p_run_id is null or p_run_id = '' then
    raise exception 'proof: no run id' using errcode = '22023';
  end if;
  serving := geo.n5_serving_generation_id();
  select coalesce(array_agg(x.d order by x.d collate "C"), '{}') into decl
    from (select distinct d from unnest(coalesce(p_declared_no_boundary, '{}'::text[])) d) x;
  select coalesce(jsonb_object_agg(x.check_name, x.n), '{}'::jsonb) into probs
    from geo.n5_generation_preactivation_problems(p_generation_id, serving, decl) x;

  -- the browser result must be a pass for exactly this candidate against exactly the serving
  -- generation, over a non-trivial sample, with nothing it could not explain
  if p_browser is null or jsonb_typeof(p_browser) <> 'object' then
    bproblem := bproblem || 'browser_result_missing'::text;
  else
    if p_browser->>'candidate_generation_id' is distinct from p_generation_id then
      bproblem := bproblem || 'browser_candidate_differs'::text;
    end if;
    if p_browser->>'baseline_generation_id' is distinct from serving then
      bproblem := bproblem || 'browser_baseline_is_not_serving'::text;
    end if;
    if coalesce(p_browser->>'passed', '') <> 'true' then
      bproblem := bproblem || 'browser_not_passed'::text;
    end if;
    -- at least 10 ZIPs, or every ZIP the generation has a status for if it has fewer
    if coalesce(p_browser->>'zips_checked', '') !~ '^[0-9]+$'
       or (p_browser->>'zips_checked')::int <
          least(10, (select count(*) from geo.maps_zip_geography_status st where st.generation_id = p_generation_id)) then
      bproblem := bproblem || 'browser_sample_too_small'::text;
    end if;
    if coalesce(p_browser->>'mismatches', '') <> '0' then
      bproblem := bproblem || 'browser_mismatches'::text;
    end if;
  end if;
  if array_length(bproblem, 1) is not null then
    probs := probs || (select jsonb_object_agg(x, 1) from unnest(bproblem) x);
  end if;

  insert into geo.n5_generation_proof
    (generation_id, baseline_generation_id, run_id, declared_no_boundary, declared_no_boundary_md5,
     problems, browser, passed)
  values (p_generation_id, serving, p_run_id, decl,
          md5(array_to_string(decl, ',')), probs, coalesce(p_browser, 'null'::jsonb), probs = '{}'::jsonb)
  returning * into r;
  return r;
end $$;
revoke all on function geo.n5_generation_record_proof(text, text, text[], jsonb) from public;


create or replace function geo.n5_generation_activate(p_generation_id text, p_expected_chunks text[])
returns geo.n5_generation
language plpgsql
set search_path to 'geo', 'public', 'pg_temp'
as $function$
declare
  g            geo.n5_generation;
  prev         geo.n5_generation;
  n_chunks     int;
  n_missing    int;
  rc           record;
  integ        record;
  prob         record;
  pf           geo.n5_generation_proof;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'activate: unknown generation %', p_generation_id using errcode = '22023';
  end if;

  if g.state <> 'READY' then
    raise exception 'activate: generation % is %, not READY', p_generation_id, g.state using errcode = '22023';
  end if;

  if p_expected_chunks is null or array_length(p_expected_chunks, 1) is null then
    raise exception 'activate: no expected chunk set declared' using errcode = '22023';
  end if;
  n_chunks := array_length(p_expected_chunks, 1);
  select count(*) into n_missing
    from unnest(p_expected_chunks) c(k)
   where not exists (select 1 from geo.n5_generation_reconcile r
                      where r.generation_id = p_generation_id and r.chunk_key = c.k);
  if n_missing > 0 then
    raise exception 'activate: % of % declared chunks have no reconciliation row', n_missing, n_chunks using errcode = '22023';
  end if;

  -- RECOMPUTED, never trusted: reconcile rows are an ordinary table, so the answer the
  -- switch acts on is derived here, inside the switching transaction.
  select * into rc from geo.n5_reconcile_chunks(p_generation_id, p_expected_chunks);
  if rc.unaccounted > 0 then
    raise exception 'activate: INV-1 violated — % of % expected source_keys have no accounted outcome', rc.unaccounted, rc.expected_keys using errcode = '22023';
  end if;

  if rc.expected_keys = 0 then
    raise exception 'activate: reconciliation covered 0 expected records — refusing a vacuous pass' using errcode = '22023';
  end if;

  for prob in select * from geo.n5_generation_publish_problems(p_generation_id, p_expected_chunks) loop
    raise exception 'activate: generation % is incomplete — % = %', p_generation_id, prob.check_name, prob.n
      using errcode = '22023';
  end loop;

  for integ in select * from public.n5_expected_input_integrity() loop
    if not integ.ok then
      raise exception 'activate: source integrity check % failed — %', integ.check_name, integ.detail using errcode = '22023';
    end if;
  end loop;

  -- D14: the newest pre-activation proof must have passed, against the generation that is
  -- STILL serving, and its data checks must still hold now (recomputed, never trusted).
  select * into pf from geo.n5_generation_proof
   where generation_id = p_generation_id order by proof_id desc limit 1;
  if not found then
    raise exception 'activate: generation % has no pre-activation proof', p_generation_id using errcode = '22023';
  end if;
  if not pf.passed then
    raise exception 'activate: the newest pre-activation proof for % (#%) did not pass — %', p_generation_id, pf.proof_id, pf.problems
      using errcode = '22023';
  end if;
  if pf.baseline_generation_id is distinct from geo.n5_serving_generation_id() then
    raise exception 'activate: the proof for % was taken against %, but % is serving now', p_generation_id,
      coalesce(pf.baseline_generation_id, '(none)'), coalesce(geo.n5_serving_generation_id(), '(none)') using errcode = '22023';
  end if;
  for prob in select * from geo.n5_generation_preactivation_problems(p_generation_id, pf.baseline_generation_id, pf.declared_no_boundary) loop
    raise exception 'activate: pre-activation check failed for % — % = %', p_generation_id, prob.check_name, prob.n
      using errcode = '22023';
  end loop;

  select * into prev from geo.n5_generation
   where state in ('ACTIVE','ACTIVE_LEGACY') and generation_id <> p_generation_id
   for update;

  update geo.n5_generation
     set superseded_from_state = state, state = 'SUPERSEDED', superseded_at = now()
   where state in ('ACTIVE','ACTIVE_LEGACY') and generation_id <> p_generation_id;

  update geo.n5_generation
     set state = 'ACTIVE', activated_at = now(),
         predecessor_generation_id = coalesce(predecessor_generation_id, prev.generation_id)
   where generation_id = p_generation_id
  returning * into g;

  return g;
end
$function$;
revoke all on function geo.n5_generation_activate(text, text[]) from public;

do $h$
declare m text;
begin
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_generation_activate';
  if m is distinct from '6e7ce8ade5d6718e06d366f82d5a6f7c' then raise exception 'part H post-condition failed: n5_generation_activate md5 %', m; end if;
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_generation_preactivation_problems';
  if m is distinct from '95eb269f34b4f719a3b3e659914c740f' then raise exception 'part H post-condition failed: n5_generation_preactivation_problems md5 %', m; end if;
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_generation_record_proof';
  if m is distinct from 'b8164d980fc7b388af6466f40a7ffc7d' then raise exception 'part H post-condition failed: n5_generation_record_proof md5 %', m; end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'geo.n5_generation_proof'::regclass) then
    raise exception 'part H post-condition failed: geo.n5_generation_proof has no row-level security';
  end if;
end $h$;
commit;
