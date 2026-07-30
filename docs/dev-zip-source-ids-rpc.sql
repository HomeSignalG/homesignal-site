-- dev_zip_source_ids — per-ZIP record evidence for the Live scoreboard.
-- APPLIED to project qwnnmljucajnexpxdgxr as migration `dev_zip_source_ids_readonly_rpc`
-- (2026-07-31). Parked here so the schema stays reproducible (CLAUDE.md §1, source #3).
--
-- WHY: the scoreboard's denominator was the COVERAGE GATE — does a complete registry entry
-- DECLARE this ZIP's county — while workbook row 419's baseline is RECORDS LANDING. They
-- disagree by construction, because declaring a county does not put a permit within three miles
-- of a ZIP centroid. Measured 2026-07-30: UT reads Live on the gate and 35.2% on records.
-- Rows 258/259 warn the gate overstates; row 429 makes fixing it the highest-value queue item.
--
-- WHY AN RPC AND NOT A CLIENT-SIDE READ: development_reports.sites is multi-MB per row
-- (Cleveland 44127 = 5.98 MB / 5,511 sites). Aggregating server-side returns only the ids.
--
-- EPA-FRS IS EXCLUDED BY CONSTRUCTION: facility sites carry a null source_registry_id, so the
-- national floor can never make a state Live. That is row 272's requirement, met structurally
-- rather than by a name filter that could drift.
--
-- SECURITY INVOKER on purpose: development_reports already grants public select under RLS, so
-- the anon key runs this with no privilege escalation. STABLE, read-only, no writes.
--
-- PAGINATION IS LOAD-BEARING, NOT BOILERPLATE: a single un-paginated call returns the first
-- p_limit ZIPs by sort order only. At p_limit=5000 that stopped before NV's 89xxx range, every
-- NV page read as dark, and the resulting 0/158 looked exactly like a real finding. Callers
-- MUST loop on p_after until a short page comes back.

create or replace function public.dev_zip_source_ids(p_after text default '', p_limit int default 1000)
returns table (zip text, source_ids text[])
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select d.zip,
         coalesce(
           (select array_agg(distinct x) filter (where x is not null)
              from jsonb_array_elements_text(
                     jsonb_path_query_array(d.sites, '$[*].source_registry_id')) x),
           '{}'::text[])
  from public.development_reports d
  where d.zip > coalesce(p_after, '')
  order by d.zip
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

revoke all on function public.dev_zip_source_ids(text, int) from public;
grant execute on function public.dev_zip_source_ids(text, int) to anon, authenticated;

comment on function public.dev_zip_source_ids(text, int) is
  'Read-only, keyset-paginated (order by zip, p_after exclusive). Returns each cached ZIP report''s distinct non-null source_registry_id values. Feeds the Live scoreboard''s RECORD-based denominator (workbook rows 419/429). EPA-FRS floor excluded by construction: its sites carry a null source_registry_id.';

-- POSITIVE CONTROL used to accept this (2026-07-31): paginated over all 12,722 cached ZIPs, NV
-- returns 139 of 158 record-backed — reproducing the hand-measured figure behind rows 419/421
-- exactly. The un-paginated version of the same query returned 0, which is why the control
-- exists at all.
