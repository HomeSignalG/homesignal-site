-- ============================================================================
-- UNIT B — authoritative production read cutover for the 346 boundary-complete ZIPs.
-- APPLIED 2026-09-03 AND ROLLED BACK THE SAME HOUR. Production is on its pre-Unit-B
-- body, verified byte-for-byte: read_path_md5 = ec1b01ae4485ad2c59b9f946c9d565b6.
--
-- WHY IT WAS ROLLED BACK — a serviceability blocker, not a correctness one.
-- The authoritative branch resolves each membership row's descriptive fields with
--   join lateral (select p.* from public.app_projects p
--                  where p.source_key = m.source_key and p.record_kind='development'
--                  order by p.last_seen_at desc nulls last, p.id asc limit 1)
-- and public.app_projects has NO index on source_key — its four indexes are on id and
-- on (zip, ...). Measured live on the cut-over function:
--     06390,  7 records -> 2.13 s
--     01001, 12 records -> 3.89 s          (~0.3 s per record)
--     one source_key lookup -> 312 ms      (seq scan, 3,208,854 rows / 4,264 MB)
-- A dense ZIP (06226, 76 records) would be ~25 s. Rewriting the lateral as a set-based
-- join does NOT fix it: the same 76-record ZIP measured 18.5 s that way. The client
-- (lib/data.js::rpcAllRows) retries once and then returns complete:false, so the page
-- would refuse to render rather than render wrongly — safe, but not servable.
--
-- The correctness gates never got to run, so nothing about the cutover's ANSWERS is
-- claimed here. What was proven is the rollback: every pre-cutover fingerprint was
-- reproduced exactly afterwards (see the receipts at the foot of this file).
--
-- TWO WAYS FORWARD, both outside Unit B's authorization:
--   (A) add an index on public.app_projects (source_key, record_kind). Additive,
--       reversible with DROP INDEX, ~150-200 MB estimated against 3,686 MB free.
--       Simplest, and helps any future source_key-keyed read.
--       NOT MEASURED — no index was created, so "this fixes it" is an engineering
--       expectation, not a receipt.
--   (B) carry the chosen descriptive row's app_projects.id in
--       geo.zip_authoritative_membership and join on the PRIMARY KEY instead of
--       source_key. No production DDL at all; needs a Unit A amendment plus a
--       fail-closed guard for the case where the stored id no longer exists, so a
--       stale id can never silently drop a record.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- THE CUTOVER BODY AS APPLIED (migration app_projects_for_zip_authoritative_cutover_unit_b).
-- Parked verbatim so the next attempt starts from what actually ran, not a paraphrase.
-- SECURITY DEFINER is a deliberate change from the 2026-08-18 body: that body's argument
-- for INVOKER was "no elevated rights are needed", which stops being true once the read
-- needs geo.zip_authoritative_membership — a schema anon/authenticated have no USAGE on
-- and must not be granted. Definer is the minimum change that keeps geo private.
/*
create or replace function public.app_projects_for_zip(p_zip text, p_kind text)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare cut boolean; want int; got int; res jsonb;
begin
  if p_kind not in ('development', 'facility') then return '[]'::jsonb; end if;
  if p_kind = 'development' then
    select (s.status = 'boundary_complete' and s.cutover), s.membership_rows
      into cut, want from geo.maps_zip_geography_status s where s.zip = p_zip;
    cut := coalesce(cut, false);
  else
    cut := false;                          -- facilities are never on the authoritative path
  end if;
  if cut then
    select count(*) into got from geo.zip_authoritative_membership m where m.zcta5 = p_zip;
    if got <> want then
      raise exception 'AUTHORITATIVE READ FAIL-CLOSED: zip % declares % authoritative rows, membership holds %', p_zip, want, got;
    end if;
    select coalesce(jsonb_agg(x.j order by x.k_date desc nulls last, x.k_id), '[]'::jsonb) into res
    from (select to_jsonb(a.*) || jsonb_build_object('zip', p_zip, 'lat', m.lat, 'lng', m.lng) as j,
                 a.submitted_at as k_date, a.id as k_id
            from geo.zip_authoritative_membership m
            join lateral (select p.* from public.app_projects p
                           where p.source_key = m.source_key and p.record_kind = 'development'
                           order by p.last_seen_at desc nulls last, p.id asc limit 1) a on true
           where m.zcta5 = p_zip) x;
    return res;
  end if;
  -- LEGACY PATH - the 2026-08-18 body, for facilities always and for every ZIP not cut over.
  select coalesce(jsonb_agg(s.j order by s.k_date desc nulls last, s.k_name asc nulls last, s.k_id), '[]'::jsonb) into res
  from (select to_jsonb(p) as j,
               case when p_kind = 'facility' then null else p.submitted_at end as k_date,
               case when p_kind = 'facility' then p.name else null end       as k_name,
               p.id as k_id
          from public.app_projects p
         where p.zip = p_zip and p.record_kind = p_kind and p_kind in ('development','facility')) s;
  return res;
end $fn$;
*/
-- read_path_md5 of that body, measured: 5e2320b55af1cc25102ee24facb16c05
-- Signature, return type, config and ACL were identical to the old body:
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

-- ---------------------------------------------------------------------------
-- THE ROLLBACK, applied as migration
-- app_projects_for_zip_unit_b_rollback_to_2026_08_18_body:
create or replace function public.app_projects_for_zip(p_zip text, p_kind text)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(s.j order by s.k_date desc nulls last, s.k_name asc nulls last, s.k_id), '[]'::jsonb)
  from (
    select to_jsonb(p) as j,
           case when p_kind = 'facility' then null else p.submitted_at end as k_date,
           case when p_kind = 'facility' then p.name else null end       as k_name,
           p.id                                                          as k_id
    from public.app_projects p
    where p.zip = p_zip
      and p.record_kind = p_kind
      and p_kind in ('development', 'facility')
  ) s
$function$;

-- ---------------------------------------------------------------------------
-- ROLLBACK RECEIPTS, 2026-09-03. Every one measured BEFORE the cutover and reproduced
-- AFTER the rollback, byte for byte:
--   read_path_md5                        ec1b01ae4485ad2c59b9f946c9d565b6   restored
--   language / security                  sql / INVOKER                      restored
--   88 non-cutover ZIPs, development     6341c689fa56291002269c22d447e362   identical
--   88 non-cutover ZIPs, facilities      456f4f1de08fb0812d573dccd502b1cc   identical
--   346 cutover ZIPs, facilities         5d262e27ead2f016ab3d40083e3f045f   identical
--   346 cutover ZIPs, dev row counts     e93f26cd2b2b321647a7758a5426e7fc   identical
--   15,298 development rows / 1,876 + 6,946 facility rows                   identical
--
-- FROZEN CUTOVER SET (kept — it is shadow data, not a production read):
--   geo.maps_zip_geography_status.cutover = true on exactly 346 ZIPs
--   set md5 4887f9ff8751163103e68bda7c56c554, 5,842 membership rows,
--   0 not_measured included, 18 boundary_complete ZIPs deliberately out of scope.
