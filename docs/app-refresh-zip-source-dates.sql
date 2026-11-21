-- app_refresh_zip carries the record's SOURCE DATES into app_projects.provenance (report-accuracy-universal, 2026-11-19).
-- STATUS: PROPOSED, FOR REVIEW. NOT APPLIED. Written from a read-only pg_get_functiondef of the live function (2026-11-19); nothing was executed against production.
--
-- WHAT IT CHANGES: exactly one thing. The development statement's `provenance` jsonb_build_object gains
--     'source_dates', el->'source_dates'
-- (jsonb_strip_nulls already drops it when a site has none, so a record without source dates has byte-identical provenance to today).
-- `el` is one element of development_reports.sites, which already carries `source_dates` when the connector emitted it (arcgis.ts `...sourceDatesField`; the
-- engine's site mapping spreads the record: index.ts `{ ...s, url, e, n, lat, lng }`). The facility statement has no such block and is untouched.
--
-- READ-ONLY EVIDENCE (live, 2026-11-19): public.app_refresh_zip md5(pg_get_functiondef) 50d925795f2c4d11804551a54947e4e6, 27,398 chars; the anchor below occurs exactly
--   once; the "write only changed rows" compare list includes app_projects.provenance, so a row whose provenance gains source_dates is rewritten ONCE on its ZIP's next
--   refresh (last_seen_at then moves for that row; no other column). The ledger does not read provenance: public.dev_change_facts (md5 4ddb04fd...) names 14 columns and
--   no provenance, so no change event can follow. dev_sites_deduped / app_site_parties do not mention provenance.
--
-- SAFETY: spliced from the LIVE body inside one transaction; refuses unless (1) the live body still has the md5 above, (2) the anchor occurs exactly once,
--   (3) the new body contains the new line exactly once and, with it cut back out, reproduces the old md5. Never a retyped replay (CLAUDE.md claims rule 7).
-- ROLLBACK: docs/app-refresh-zip-source-dates.rollback.sql (same shape, reverse splice). Rows already rewritten keep a provenance.source_dates key; nothing reads it
--   except the report (record-dates.ts), which ignores it harmlessly, and the next refresh rewrites provenance without it.
begin;
do $splice$
declare
  _expect constant text := '50d925795f2c4d11804551a54947e4e6';
  _anchor constant text := $a$'decision',       el->'decision'$a$;
  _add    constant text := E',\n        ''source_dates'',   el->''source_dates''';
  _def text; _new text; _n int;
begin
  select pg_get_functiondef(p.oid) into _def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip' and p.pronargs = 1;
  if _def is null then raise exception 'app_refresh_zip(text) not found'; end if;
  if md5(_def) <> _expect then raise exception 'app_refresh_zip changed since review (md5 %, expected %): re-review before applying', md5(_def), _expect; end if;
  _n := (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor);
  if _n <> 1 then raise exception 'anchor occurs % times (expected 1)', _n; end if;
  _new := replace(_def, _anchor, _anchor || _add);
  if (length(_new) - length(replace(_new, _add, ''))) / length(_add) <> 1 then raise exception 'splice did not insert exactly once'; end if;
  if md5(replace(_new, _add, '')) <> _expect then raise exception 'cutting the insertion out does not reproduce the reviewed body'; end if;
  execute _new;
end
$splice$;
commit;
