-- STAND-IN for public.app_refresh_zip(text): ONLY its development-statement `provenance` expression is real, copied verbatim from the live
-- pg_get_functiondef (read-only, 2026-11-19, md5 50d92579...). Everything else is omitted. The migration under test splices THIS body by the same anchor rule.
create schema if not exists public;
create or replace function public.app_refresh_zip(_zip text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare _refreshed text := '2026-11-19T12:00:00Z'; _vintage text := 'v-test'; el jsonb;
begin
  select e into el from site_in s, lateral (select s.site as e) q limit 1;
  return (select
      nullif(jsonb_strip_nulls(jsonb_build_object(
        'src',            nullif(el->>'src',''),
        'jurisdiction',   nullif(el->>'jurisdiction',''),
        'source_class',   nullif(el->>'source_class',''),
        'case_number',    coalesce(nullif(el->>'case_number',''), nullif(el->>'project_no','')),
        'url_precision',  nullif(el->>'record_url_precision',''),
        'geo_precision',  nullif(el->>'geo_precision',''),
        'canonical_addr', nullif(el->>'canonical_addr',''),
        'refreshed_at',   _refreshed,
        'source_vintage', _vintage,
        -- THE SOURCED DECISION (2026-09-20 contract, sources/decision.ts). Carried whole
        'decision',       el->'decision'
      )), '{}'::jsonb))::text;
end
$function$;
