-- Tab 2 · A FINDING THAT LEAVES THE CURRENT SET IS NOT, BY ITSELF, RECOVERED (2026-11-21). SQL of record. ADDITIVE + READ-ONLY toward source data.
--
-- Before: the recorder set resolved_at on any finding absent from the current set, and the page called every such finding RECOVERED.
-- Measured 2026-11-21: of 5 resolved findings, 3 source-read failures (cleveland, seattle, montgomery) left only because the failure rows aged
-- out of the existing 48-hour window; the failing ZIP had NOT been read again (last_tick_at = the failure's own time), so nothing showed recovery.
-- After: every resolution carries resolution_basis + resolution_evidence.
--   POSITIVE_EVIDENCE        a later successful result exists: the pipeline_health_check is ok again (HEALTH_CHECK|*), or every failing ZIP+source pair
--                            has a later tick with no newer failure (SOURCE_READ|*).
--   CONDITION_CLEARED        a state condition that is recomputed from current data (stale report, missing report, unpublished post, ...) is no longer true.
--   AGED_OUT_UNCONFIRMED     a source failure left the 48-hour window with no later successful read observed. NOT recovered; shown as unconfirmed.
-- An unconfirmed finding is re-checked every run for 7 days and upgraded to POSITIVE_EVIDENCE if the ZIP is read successfully later.
-- No threshold is added or changed; the 48-hour window is the existing one.

alter table public.zip_feed_health_findings add column if not exists resolution_basis text, add column if not exists resolution_evidence jsonb;

create or replace function public._hs_zip_feed_health_resolution(p_key text)
returns table(basis text, evidence jsonb) language plpgsql stable security definer set search_path = public as $$
declare reg text; tot int; later int; ck record;
begin
  if p_key like 'HEALTH_CHECK|%' then
    select h.ok, h.updated_at into ck from public.pipeline_health_check h where h.check_name = substr(p_key, 14);
    if found and ck.ok then return query select 'POSITIVE_EVIDENCE', jsonb_build_object('proof','pipeline_health_check reports ok again','check_updated_at', ck.updated_at, 'as_of', now()); return; end if;
    return query select 'AGED_OUT_UNCONFIRMED', jsonb_build_object('proof','the check is not reported ok','as_of', now()); return;
  elsif p_key like 'SOURCE_READ|%' then
    reg := substr(p_key, 13);
    with lf as (select zip, max(seen_at) at from public.dev_refresh_source_failures
                where registry_id = reg and kind in ('fetch_failed','fire_failed','fire_http_error') and seen_at > now() - interval '7 days' group by zip)
    select count(*), count(*) filter (where c.last_tick_at is not null and c.last_tick_at > lf.at) into tot, later
      from lf left join public.dev_source_continuity c on c.zip = lf.zip and c.registry_id = reg;
    if tot > 0 and later = tot then
      return query select 'POSITIVE_EVIDENCE', jsonb_build_object('proof','every failing ZIP was read again later with no newer failure','failed_zips', tot, 'zips_read_again', later, 'as_of', now());
    else
      return query select 'AGED_OUT_UNCONFIRMED', jsonb_build_object('proof','the failure left the 48-hour window; no later successful read has been observed for every failing ZIP','failed_zips', tot, 'zips_read_again', later, 'as_of', now());
    end if;
    return;
  end if;
  return query select 'CONDITION_CLEARED', jsonb_build_object('proof','the condition is recomputed from current data and is no longer true','as_of', now());
end $$;
revoke all on function public._hs_zip_feed_health_resolution(text) from public, anon, authenticated;

-- splice the recorder's resolving UPDATE (fail closed unless the anchor appears exactly once), and re-check unconfirmed ones
do $$
declare src text; a text; b text; n int;
begin
  select pg_get_functiondef('public.zip_feed_health_record()'::regprocedure) into src;
  a := 'update public.zip_feed_health_findings f set resolved_at = now() where f.resolved_at is null and not exists (select 1 from _f where _f.finding_key = f.finding_key);';
  b := 'update public.zip_feed_health_findings f set resolved_at = now(), resolution_basis = r.basis, resolution_evidence = r.evidence from (select k.finding_key fk, x.basis, x.evidence from public.zip_feed_health_findings k, lateral public._hs_zip_feed_health_resolution(k.finding_key) x where k.resolved_at is null and not exists (select 1 from _f where _f.finding_key = k.finding_key)) r where f.finding_key = r.fk and f.resolved_at is null;';
  select (length(src) - length(replace(src, a, '')))/length(a) into n;
  if n <> 1 then raise exception 'anchor appeared % times', n; end if;
  src := replace(src, a, b);
  a := '    get diagnostics rec = row_count;';
  if (length(src) - length(replace(src, a, '')))/length(a) <> 1 then raise exception 'anchor 2 not unique'; end if;
  src := replace(src, a, a || E'\n    update public.zip_feed_health_findings f set resolution_basis = r.basis, resolution_evidence = r.evidence from (select k.finding_key fk, x.basis, x.evidence from public.zip_feed_health_findings k, lateral public._hs_zip_feed_health_resolution(k.finding_key) x where k.resolved_at > now() - interval ''7 days'' and k.resolution_basis = ''AGED_OUT_UNCONFIRMED'') r where f.finding_key = r.fk and r.basis = ''POSITIVE_EVIDENCE'';');
  execute src;
end $$;

-- backfill the findings already resolved, with the evidence as of now (labelled by as_of)
update public.zip_feed_health_findings f set resolution_basis = r.basis, resolution_evidence = r.evidence
  from (select k.finding_key fk, x.basis, x.evidence from public.zip_feed_health_findings k, lateral public._hs_zip_feed_health_resolution(k.finding_key) x where k.resolved_at is not null and k.resolution_basis is null) r
  where f.finding_key = r.fk;
