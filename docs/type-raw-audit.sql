-- THE DENOMINATOR INSTRUMENT for `app_projects.type_raw`.
-- Applied to production 2026-08-19 as migration `type_raw_audit_denominator`.
--
-- `type_raw` is NON-RETROACTIVE: a row carries it only once its ZIP has been re-cached through
-- the engine deployed 2026-08-19 AND re-materialized by app_refresh_sweep. Until every ZIP has
-- turned over, ANY count of type_raw is a partial picture — and a partial picture that does not
-- state its denominator reads exactly like a complete one.
--
-- So the audit is a FUNCTION, not a query someone re-derives. It always returns the coverage
-- block, it reads the deploy timestamp from the database rather than accepting one from the
-- caller (a caller-supplied date is a caller-supplied answer), and it stamps `complete: false`
-- with a plain-language caveat naming the outstanding ZIP count until the turnover finishes.
--
-- Read it with:  select jsonb_pretty(public.type_raw_audit());

-- ── 1. where the deploy timestamp lives ──────────────────────────────────────────────────
-- One row per non-retroactive engine change, so the next one does not re-invent this.
create table if not exists public.engine_deploy_marks (
  mark        text        primary key,
  deployed_at timestamptz not null,
  note        text
);
comment on table public.engine_deploy_marks is
  'When a non-retroactive engine change went live. Read by audit functions so a coverage '
  'denominator is measured against a RECORDED deploy time rather than one typed into the query. '
  'Internal ops only — RLS on with no policies, so anon/authenticated cannot read it.';
alter table public.engine_deploy_marks enable row level security;

-- ── 2. the audit ─────────────────────────────────────────────────────────────────────────
create or replace function public.type_raw_audit()
returns jsonb
language plpgsql
stable
as $fn$
declare
  _at timestamptz;
  _zips_total int; _zips_refreshed int; _zips_materialized int; _zips_pending int;
  _rows_total bigint; _rows_with bigint;
  _oldest timestamptz;
begin
  select deployed_at into _at from public.engine_deploy_marks where mark = 'type_raw';
  if _at is null then
    -- Fail CLOSED and say so. An audit that quietly assumed "the beginning of time" would
    -- report 100% coverage on day one, which is the precise failure this function exists to
    -- prevent.
    return jsonb_build_object(
      'complete', false,
      'error', 'no engine_deploy_marks row for mark=type_raw — the deploy time is unrecorded, '
             || 'so no coverage figure can be trusted. Record it before reading any type_raw count.');
  end if;

  select count(*),
         count(*) filter (where refreshed_at >= _at),
         min(refreshed_at)
    into _zips_total, _zips_refreshed, _oldest
    from public.development_reports;

  select count(*) filter (where updated_at >= _at)
    into _zips_materialized
    from public.app_community_meta;

  _zips_pending := _zips_total - _zips_refreshed;

  select count(*), count(*) filter (where type_raw is not null)
    into _rows_total, _rows_with
    from public.app_projects
   where record_kind = 'development' and registry_id is not null;

  return jsonb_build_object(
    'deployed_at', _at,
    'measured_at', now(),
    -- THE DENOMINATOR. Always present, always first.
    'coverage', jsonb_build_object(
      'zips_total',                  _zips_total,
      'zips_refreshed_since_deploy', _zips_refreshed,
      'zips_not_yet_refreshed',      _zips_pending,
      'pct_refreshed',               round(100.0 * _zips_refreshed / nullif(_zips_total, 0), 2),
      'zips_materialized_since_deploy', _zips_materialized,
      'oldest_cached_report',        _oldest),
    'rows', jsonb_build_object(
      'connector_development_rows', _rows_total,
      'rows_with_type_raw',         _rows_with,
      'rows_without_type_raw',      _rows_total - _rows_with),
    'complete', _zips_pending = 0,
    'caveat', case when _zips_pending = 0 then null else
      _zips_pending || ' of ' || _zips_total || ' ZIPs have NOT been re-cached since the '
      || to_char(_at, 'YYYY-MM-DD HH24:MI') || 'Z deploy. Their rows carry type_raw = NULL '
      || 'because they predate the field, NOT because their publisher stated no type. Any '
      || 'grouping by type_raw is a partial picture until this reaches 0.' end
  );
end $fn$;

comment on function public.type_raw_audit() is
  'Coverage-first audit of app_projects.type_raw. ALWAYS returns the not-yet-refreshed ZIP count '
  'so a partial turnover can never read as complete; returns complete=false with an explicit '
  'error when no deploy mark is recorded.';

revoke all on function public.type_raw_audit() from public;
