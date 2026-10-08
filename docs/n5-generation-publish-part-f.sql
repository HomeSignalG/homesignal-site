-- GENERATED from docs/n5-generation-publish-part-d.sql by slicing its D9 function
-- (geo.n5_gen_record_unresolved) verbatim - never hand-edited. Part F (2026-09-27).
--
-- READY refused n5-national-2026-09-25 with INV-1: 17 expected source_keys matched no
-- unresolved class. Two defects, both in this one function:
--   * the catalogue was joined on the RAW registry_id, while the shard's freeze files a
--     registry-less key under '(null)' (graded NOAUTH) - 5 tdlr_tabs keys in 786;
--   * a RECOVERY key whose publisher timed out in its own shard had no class at all - 12
--     kytc-syp-highway-plan / wisdot-highway-program-6yr keys in 410/421/530/532/537.
-- The fix joins the catalogue with the shard's own rule, and reads the shard's persisted
-- recovery report for RECOVERY_PUBLISHER_UNREACHABLE. INV-1 itself is unchanged: a key
-- matching no class still blocks READY.
--
-- ONE transaction. Fail-closed on both sides:
--   before: the live body must be exactly the previous DDL of record (md5(prosrc) 26db5d6c1012b75ce74a27de2d1db50b);
--   after:  it must be exactly the new DDL of record (7264883dd790937bc8060984f4bbd8ba).
begin;
set local lock_timeout = '10s';
do $g$
declare m text;
begin
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_gen_record_unresolved';
  if m is distinct from '26db5d6c1012b75ce74a27de2d1db50b' then
    raise exception 'part F: live n5_gen_record_unresolved is % - not the previous DDL of record; refusing', m;
  end if;
end $g$;

create or replace function geo.n5_gen_record_unresolved(p_generation_id text)
returns jsonb
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare
  g         geo.n5_generation;
  n_unpub   int;
  n_written int;
  n_pref    int;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'unresolved: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if g.state <> 'BUILDING' then
    raise exception 'unresolved: generation % is %, not BUILDING', p_generation_id, g.state using errcode = '22023';
  end if;
  select count(*) into n_unpub from geo.n5_generation_publish_scope(p_generation_id) sc
   where not exists (select 1 from geo.n5_generation_publish p
                      where p.generation_id = p_generation_id and p.z3 = sc.z3);
  if n_unpub > 0 then
    raise exception 'unresolved: % prefix(es) of % are unpublished — an absence is not evidence yet', n_unpub, p_generation_id
      using errcode = '22023';
  end if;
  select count(*) into n_pref from geo.n5_generation_publish p where p.generation_id = p_generation_id;

  delete from geo.n5_generation_unresolved where generation_id = p_generation_id;

  with expected as (
    select e.source_key, min(e.zip) zip, min(e.registry_id) registry_id,
           array_agg(distinct left(e.zip, 3)) z3s
      from public.n5_expected_captured(g.snapshot_id) e
     group by e.source_key),
  missing as (
    select x.* from expected x
     where not exists (select 1 from geo.zip_authoritative_membership m
                        where m.generation_id = p_generation_id and m.source_key = x.source_key)),
  classified as (
    select x.source_key, x.zip,
           case
             when exists (select 1 from geo.n5_geom gg where gg.source_key = x.source_key
                            and gg.provenance = 'recovered_authoritative'
                            and gg.outcome = 1 and gg.geom is not null)
               or exists (select 1 from geo.n5_gen_proven_point pp
                           where pp.generation_id = p_generation_id and pp.source_key = x.source_key)
               then 'NO_INTERSECTION_WITH_GENERATION_ZCTAS'
             when v.verdict in ('NULL_COORD','MULTI_COORD_UNRESOLVED') then 'POINT_REJECTED'
             when exists (select 1 from geo.n5_geom gg where gg.source_key = x.source_key
                            and gg.provenance = 'recovered_authoritative')
               then 'GEOMETRY_INVALID'
             when a.treatment in ('NOAUTH','IDENT_UNRESOLVED','HIST_UNRECOVERABLE')
               then 'REGISTRY_' || a.treatment
             when v.verdict in ('SOURCE_EXCLUDED','RECOVERY_UNSTABLE_IDENTITY',
                                'RECOVERY_NOT_RETURNED','REGISTRY_UNCLASSIFIED')
               then v.verdict
             when a.treatment = 'RECOVERY'
              and exists (select 1 from geo.n5_shard s
                            cross join lateral jsonb_array_elements(
                              case when jsonb_typeof(s.detail->'recovery') = 'array'
                                   then s.detail->'recovery' else '[]'::jsonb end) r
                           where s.generation_id = p_generation_id and s.state = 'done'
                             and s.z3 = any (x.z3s)
                             and r->>'registry_id' = coalesce(x.registry_id, '(null)')
                             and r->>'status' = 'PUBLISHER_UNREACHABLE')
               then 'RECOVERY_PUBLISHER_UNREACHABLE'
           end as reason_code,
           jsonb_strip_nulls(jsonb_build_object(
             'prefixes_probed', n_pref,
             'verdict', v.verdict, 'verdict_detail', v.detail,
             'invalid_reasons', (select jsonb_agg(distinct gg.invalid_reason) from geo.n5_geom gg
                                  where gg.source_key = x.source_key
                                    and gg.provenance = 'recovered_authoritative' and gg.outcome <> 1),
             'registry_id', x.registry_id, 'registry_treatment', a.treatment)) as detail
      from missing x
      left join geo.n5_generation_key_verdict v
             on v.generation_id = p_generation_id and v.source_key = x.source_key
      left join geo.n5_accepted_source a on a.registry_id = coalesce(x.registry_id, '(null)'))
  insert into geo.n5_generation_unresolved (generation_id, source_key, zip, reason_code, detail)
  select p_generation_id, c.source_key, c.zip, c.reason_code, c.detail
    from classified c
   where c.reason_code is not null;
  get diagnostics n_written = row_count;

  update geo.n5_generation set unresolved_recorded_at = now() where generation_id = p_generation_id;
  return jsonb_build_object('generation_id', p_generation_id, 'unresolved_written', n_written,
                            'prefixes_probed', n_pref);
end $$;
revoke all on function geo.n5_gen_record_unresolved(text) from public;

do $g$
declare m text;
begin
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_gen_record_unresolved';
  if m is distinct from '7264883dd790937bc8060984f4bbd8ba' then
    raise exception 'part F post-condition failed: n5_gen_record_unresolved md5 %', m;
  end if;
end $g$;
commit;
