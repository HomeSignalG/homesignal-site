-- ============================================================================
-- DEVELOPMENT CHANGE LEDGER  (Development Activity plan, Order C — 2026-09-30)
-- The smallest universal durable observation/delta layer. SQL OF RECORD.
--
-- WHAT IT IS
--   An append-only record of what HomeSignal OBSERVED about each development record and
--   when it observed a DIFFERENCE between two comparable observations of the same record.
--   It is national: it reads public.app_projects (the one materialised development layer),
--   keyed on the existing record identity public.app_source_key. It contains no city, no
--   market, no source name and no NYC path.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   publisher connectors -> dev_sites_deduped -> app_refresh_zip -> public.app_projects
--     -> [this ledger, written by dev_change_observe_zip, the only writer]
--     -> the report reader (later units).
--   Decision owners, none duplicated here:
--     identity ............ public.app_source_key / app_source_key_basis
--     Type ................ lib/project-type.js (read time). The ledger stores the raw
--                           `type`, `type_raw` and `status` the materialiser wrote; it adds no
--                           classifier and no lifecycle key.
--     lifecycle ........... lib/project-type.js HS.canonicalLifecycle (read time).
--     denied / withdrawn .. supabase/functions/get-address-report/sources/decision.ts. The
--                           ledger never emits those events; it records a status change as
--                           `status_changed` with the before/after values and leaves the
--                           decision classes to their authority.
--     rights .............. docs/corporate-output-source-rights-audit-2026-09-27.md, enforced
--                           at report time. `rights_class` is stored NULL and never invented.
--
-- RULES THIS ENCODES (each is pinned by test/dev_change_ledger_pg and measured in
-- docs/development-activity-audit-b-identity-lineage-2026-09-30.md and
-- docs/development-activity-change-layer-2026-09-30.md)
--   1. A change is a difference in a DECLARED FACT LIST between two comparable observations.
--      Retrieval fields (provenance.*, last_seen_at, created_at), coordinates and scores are
--      NOT facts, so a re-collection of a ZIP is never a change (measured: every re-collection
--      rewrites every row of the ZIP).
--   2. Observations are ordered by RETRIEVAL time (provenance.refreshed_at), never by the
--      order the ledger sees them. Copies of one project on different ZIP pages are read at
--      different times (46 of 46 disagreeing copies measured); an OLDER copy never moves a
--      project backwards and never emits an event.
--   3. Only a change in the publisher's OWN status (`stage`) or event kind (`date_kind`) is a
--      real-world status change. A change in a derived field (`status`, `type`) with the
--      publisher's fields unchanged is a parser/classifier change: `source_record_updated`,
--      never hero-eligible. Changing the fact list itself (facts_version) re-baselines
--      silently.
--   4. Absence is never an event. A missing row, a failed fetch and a re-appearing row emit
--      nothing; the ledger never deletes and never infers withdrawal/cancellation.
--   5. Comparable means: a durable key basis AND a record that is the only one under its key
--      on its ZIP. Non-comparable records are tracked but never produce events, and stay
--      non-comparable (fail closed). The durable-basis test is the same rule the ingest
--      repo's Development SEO plane uses (NON_DURABLE_BASIS); keep them equal.
--   6. Change readiness is per record: comparable AND at least two comparable observations
--      (Step 3A cold-start rule). Never a city flag.
--   7. Events are append-only (trigger). Nothing is ever updated or deleted.
--
-- ADDITIVE ONLY. Creates three tables and their functions. Alters no existing object and
-- writes no existing table. ROLLBACK: drop the objects listed at the foot of this file.
-- Idempotent: safe to run twice.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------
do $pre$
declare _missing text;
begin
  select string_agg(c, ', ') into _missing
    from unnest(array['zip','record_kind','source_key','source_key_basis','source_seq','registry_id',
                      'name','type','type_raw','status','stage','date_kind','submitted_at','address',
                      'start_date','end_date','developer','size','investment','source_ref','provenance']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'app_projects' and column_name = c);
  if _missing is not null then
    raise exception 'dev_change: public.app_projects is missing column(s): %', _missing;
  end if;
end $pre$;

-- ---- 1. TABLES ----------------------------------------------------------------
create table if not exists public.dev_change_run (
  id                            uuid primary key default gen_random_uuid(),
  baseline                      boolean not null default false,
  started_at                    timestamptz not null default now(),
  finished_at                   timestamptz,
  zips_observed                 integer not null default 0,
  rows_read                     integer not null default 0,
  rows_skipped                  integer not null default 0,
  identities_new                integer not null default 0,
  observations_accepted         integer not null default 0,
  events_written                integer not null default 0,
  detail                        jsonb not null default '{}'::jsonb
);

create table if not exists public.dev_change_project (
  identity_key          text primary key,                 -- = app_projects.source_key
  registry_id           text,
  key_basis             text not null,
  comparable            boolean not null,
  non_comparable_reason text,
  facts_version         smallint not null,
  facts                 jsonb not null,                   -- the CURRENT declared facts
  facts_fp              text not null,
  first_observed_at     timestamptz not null,             -- retrieval instant of the first accepted observation
  last_observed_at      timestamptz not null,             -- newest accepted retrieval instant (monotonic)
  observation_count     integer not null check (observation_count >= 1),
  change_ready          boolean generated always as (comparable and observation_count >= 2) stored,
  zips                  text[] not null default '{}',     -- an ATTRIBUTE, never part of identity
  first_run_id          uuid references public.dev_change_run (id),
  last_run_id           uuid references public.dev_change_run (id),
  updated_at            timestamptz not null default now(),
  constraint dev_change_project_reason check (comparable or non_comparable_reason is not null)
);

create table if not exists public.dev_change_event (
  id                    bigint generated always as identity primary key,
  identity_key          text not null references public.dev_change_project (identity_key),
  event_type            text not null
                        check (event_type in ('first_detected', 'status_changed', 'source_record_updated')),
  material              boolean not null,                 -- hero-eligible: a real-world publisher change
  is_baseline           boolean not null default false,   -- first sighting during a baseline run, not news
  observed_at           timestamptz not null,             -- retrieval instant of the NEW observation
  prev_facts            jsonb,
  new_facts             jsonb not null,
  prev_fp               text,
  new_fp                text not null,
  changed_fields        text[] not null default '{}',
  publisher_event_type  text,                             -- app_projects.date_kind of the new observation
  publisher_event_date  date,                             -- app_projects.submitted_at of the new observation
  source_id             text,                             -- registry_id
  derivation_version    smallint not null,
  facts_version         smallint not null,
  rights_class          text,                             -- deliberately NULL: rights live in the rights audit
  run_id                uuid references public.dev_change_run (id),
  created_at            timestamptz not null default now(),
  constraint dev_change_event_shape check (
    (event_type = 'first_detected'
       and prev_facts is null and prev_fp is null and material = (not is_baseline))
    or
    (event_type <> 'first_detected'
       and prev_facts is not null and prev_fp is not null and prev_fp <> new_fp
       and not is_baseline and cardinality(changed_fields) > 0)
  ),
  constraint dev_change_event_once_per_observation unique (identity_key, observed_at)
);

-- ---- 2. APPEND-ONLY -------------------------------------------------------------
create or replace function public.dev_change_event_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'dev_change_event is append-only (% refused)', tg_op;
end $$;

create or replace trigger dev_change_event_no_update_delete
  before update or delete on public.dev_change_event
  for each row execute function public.dev_change_event_immutable();

create or replace trigger dev_change_event_no_truncate
  before truncate on public.dev_change_event
  for each statement execute function public.dev_change_event_immutable();

-- ---- 3. THE DECLARED FACTS, THE FINGERPRINT, THE RULES ---------------------------
create or replace function public.dev_change_facts_version() returns smallint
language sql immutable as $$ select 1::smallint $$;

create or replace function public.dev_change_derivation_version() returns smallint
language sql immutable as $$ select 1::smallint $$;

-- The facts a change is judged on. Takes the app_projects ROW itself, so only these 14 columns
-- are read (never the wide JSON columns). Publisher evidence: name, type_raw, stage, date_kind,
-- submitted_at, address, start_date, end_date, developer, size, investment, source_ref.
-- Derived by the materialiser: type, status. NOT facts: provenance.*, last_seen_at, created_at,
-- lat, lng, impact_*, scope_text, parties, ids (retrieval and scoring noise).
create or replace function public.dev_change_facts(r public.app_projects) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'name', r.name, 'type', r.type, 'type_raw', r.type_raw,
    'status', r.status, 'stage', r.stage,
    'date_kind', r.date_kind, 'submitted_at', r.submitted_at,
    'address', r.address, 'start_date', r.start_date, 'end_date', r.end_date,
    'developer', r.developer, 'size', r.size, 'investment', r.investment,
    'source_ref', r.source_ref)
$$;

create or replace function public.dev_change_fp(facts jsonb) returns text
language sql immutable as $$ select md5(facts::text) $$;

-- Same rule as bluesky/lib/development-seo-plane.mjs NON_DURABLE_BASIS = /(^|:)row_id$|MUTABLE/i
create or replace function public.dev_change_key_is_durable(basis text) returns boolean
language sql immutable as $$
  select coalesce(basis, '') <> '' and basis !~* '(^|:)row_id$|MUTABLE'
$$;

-- Pure and versioned (derivation_version 1). No row when the facts are identical.
-- material = the PUBLISHER's own status (stage) or event kind (date_kind) changed.
create or replace function public.dev_change_classify(prev jsonb, new jsonb)
returns table (event_type text, material boolean, changed_fields text[])
language sql immutable as $$
  with ch as (
    select coalesce(array_agg(k order by k), '{}'::text[]) as f
      from (select k from jsonb_object_keys(prev || new) k
             where prev->k is distinct from new->k) x
  )
  select case when ch.f && array['stage', 'date_kind'] then 'status_changed'
              else 'source_record_updated' end,
         ch.f && array['stage', 'date_kind'],
         ch.f
    from ch where cardinality(ch.f) > 0
$$;

-- ---- 4. RUNS ------------------------------------------------------------------------
create or replace function public.dev_change_start_run(p_baseline boolean default false, p_detail jsonb default '{}'::jsonb)
returns uuid language sql security definer set search_path = public, pg_temp as $$
  insert into public.dev_change_run (baseline, detail) values (coalesce(p_baseline, false), coalesce(p_detail, '{}'::jsonb))
  returning id
$$;

create or replace function public.dev_change_finish_run(p_run uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.dev_change_run set finished_at = now() where id = p_run and finished_at is null
$$;

-- ---- 5. THE ONE WRITER --------------------------------------------------------------
-- Observes every development row of ONE ZIP. Idempotent: the same observation twice is a
-- no-op. Single-writer (advisory lock); returns {status:'busy'} instead of waiting.
create or replace function public.dev_change_observe_zip(p_zip text, p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _baseline boolean;
  _fv  smallint := public.dev_change_facts_version();
  _dv  smallint := public.dev_change_derivation_version();
  _read integer := 0;   -- development rows on this ZIP
  _seen integer := 0;   -- identities observed (one per record, siblings grouped)
  _rowsok integer := 0; -- rows that were a usable observation
  _new integer := 0;
  _acc integer := 0;    -- identities whose observation was NEWER than the ledger's
  _ev  integer := 0;    -- events written
  _chg integer := 0;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'dev_change_observe_zip: % is not a 5-digit ZIP', p_zip;
  end if;
  select r.baseline into _baseline from public.dev_change_run r
   where r.id = p_run and r.finished_at is null;
  if not found then
    raise exception 'dev_change_observe_zip: run % is not open', p_run;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('dev_change_observe')) then
    return jsonb_build_object('status', 'busy');
  end if;

  create temp table if not exists _dc_obs (
    identity_key text primary key, key_basis text, registry_id text, observed_at timestamptz,
    facts jsonb, fp text, here_comparable boolean, here_reason text,
    date_kind text, submitted_at date,
    is_new boolean, old_facts jsonb, old_fp text, old_comparable boolean, old_reason text,
    old_last_observed_at timestamptz, old_facts_version smallint, n_rows integer
  ) on commit delete rows;
  truncate _dc_obs;

  select count(*) into _read
    from public.app_projects a
   where a.zip = p_zip and a.record_kind = 'development' and a.source_key is not null;

  -- One observation per identity on this ZIP. A row with no parseable retrieval instant, or
  -- one stamped in the future, is not an observation (it could otherwise lock a record out
  -- of every later observation).
  with rows_ as (
    select a.source_key, a.source_key_basis, a.registry_id, a.source_seq, a.date_kind, a.submitted_at,
           case when a.provenance->>'refreshed_at' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
                then (a.provenance->>'refreshed_at')::timestamptz end as observed_at,
           public.dev_change_facts(a) as facts
      from public.app_projects a
     where a.zip = p_zip and a.record_kind = 'development' and a.source_key is not null
  ), usable as (
    select * from rows_
     where observed_at is not null and observed_at <= now() + interval '5 minutes'
  ), g as (
    select u.source_key as identity_key,
           (array_agg(u.source_key_basis order by u.source_seq))[1] as key_basis,
           (array_agg(u.registry_id order by u.source_seq))[1] as registry_id,
           max(u.observed_at) as observed_at,
           (array_agg(u.facts order by u.source_seq))[1] as facts,
           (array_agg(u.date_kind order by u.source_seq))[1] as date_kind,
           (array_agg(u.submitted_at order by u.source_seq))[1] as submitted_at,
           count(*) as n_rows, max(u.source_seq) as max_seq
      from usable u group by u.source_key
  )
  insert into _dc_obs
    (identity_key, key_basis, registry_id, observed_at, facts, fp, here_comparable, here_reason, date_kind,
     submitted_at, is_new, old_facts, old_fp, old_comparable, old_reason, old_last_observed_at,
     old_facts_version, n_rows)
  select g.identity_key, g.key_basis, g.registry_id, g.observed_at, g.facts, public.dev_change_fp(g.facts),
         (public.dev_change_key_is_durable(g.key_basis) and g.n_rows = 1 and g.max_seq = 1),
         case when not public.dev_change_key_is_durable(g.key_basis) then 'non_durable_key_basis'
              when g.n_rows > 1 or g.max_seq > 1 then 'sibling_records' end,
         g.date_kind, g.submitted_at,
         (p.identity_key is null), p.facts, p.facts_fp, p.comparable, p.non_comparable_reason,
         p.last_observed_at, p.facts_version, g.n_rows::integer
    from g left join public.dev_change_project p on p.identity_key = g.identity_key;
  get diagnostics _seen = row_count;
  select coalesce(sum(o.n_rows), 0) into _rowsok from _dc_obs o;

  -- New identities (state first, so events can reference them).
  insert into public.dev_change_project
    (identity_key, registry_id, key_basis, comparable, non_comparable_reason, facts_version, facts,
     facts_fp, first_observed_at, last_observed_at, observation_count, zips, first_run_id, last_run_id)
  select o.identity_key, o.registry_id, o.key_basis, o.here_comparable, o.here_reason, _fv, o.facts,
         o.fp, o.observed_at, o.observed_at, 1, array[p_zip], p_run, p_run
    from _dc_obs o where o.is_new;
  get diagnostics _new = row_count;

  -- First sighting of a comparable record: `first_detected`, never "approved" or "filed".
  insert into public.dev_change_event
    (identity_key, event_type, material, is_baseline, observed_at, prev_facts, new_facts, prev_fp, new_fp,
     changed_fields, publisher_event_type, publisher_event_date, source_id, derivation_version,
     facts_version, run_id)
  select o.identity_key, 'first_detected', not _baseline, _baseline, o.observed_at, null, o.facts, null,
         o.fp, '{}'::text[], o.date_kind, o.submitted_at, o.registry_id, _dv, _fv, p_run
    from _dc_obs o where o.is_new and o.here_comparable
  on conflict (identity_key, observed_at) do nothing;
  get diagnostics _ev = row_count;

  -- A difference between two comparable observations, newer over older, same fact definition.
  insert into public.dev_change_event
    (identity_key, event_type, material, is_baseline, observed_at, prev_facts, new_facts, prev_fp, new_fp,
     changed_fields, publisher_event_type, publisher_event_date, source_id, derivation_version,
     facts_version, run_id)
  select o.identity_key, c.event_type, c.material, false, o.observed_at, o.old_facts, o.facts, o.old_fp,
         o.fp, c.changed_fields, o.date_kind, o.submitted_at, o.registry_id, _dv, _fv, p_run
    from _dc_obs o
   cross join lateral public.dev_change_classify(o.old_facts, o.facts) c
   where not o.is_new
     and o.observed_at > o.old_last_observed_at
     and o.old_facts_version = _fv
     and o.old_comparable and o.here_comparable
     and o.old_fp <> o.fp
  on conflict (identity_key, observed_at) do nothing;
  get diagnostics _chg = row_count;
  _ev := _ev + _chg;

  -- Existing identities: a NEWER observation replaces the current facts; an older or equal
  -- one changes nothing but the ZIP attribute and the (sticky) comparability.
  update public.dev_change_project p
     set facts = case when o.observed_at > p.last_observed_at then o.facts else p.facts end,
         facts_fp = case when o.observed_at > p.last_observed_at then o.fp else p.facts_fp end,
         facts_version = case when o.observed_at > p.last_observed_at then _fv else p.facts_version end,
         last_observed_at = greatest(p.last_observed_at, o.observed_at),
         observation_count = p.observation_count + case when o.observed_at > p.last_observed_at then 1 else 0 end,
         zips = case when p_zip = any(p.zips) then p.zips else p.zips || p_zip end,
         comparable = p.comparable and o.here_comparable,
         non_comparable_reason = coalesce(p.non_comparable_reason, o.here_reason),
         last_run_id = p_run,
         updated_at = now()
    from _dc_obs o
   where not o.is_new and o.identity_key = p.identity_key;
  select count(*) into _acc from _dc_obs o where not o.is_new and o.observed_at > o.old_last_observed_at;

  update public.dev_change_run r
     set zips_observed = r.zips_observed + 1,
         rows_read = r.rows_read + _read,
         rows_skipped = r.rows_skipped + greatest(_read - _rowsok, 0),
         identities_new = r.identities_new + _new,
         observations_accepted = r.observations_accepted + _acc + _new,
         events_written = r.events_written + _ev
   where r.id = p_run;

  return jsonb_build_object('status', 'ok', 'zip', p_zip, 'rows_read', _read, 'rows_skipped', greatest(_read - _rowsok, 0),
                            'identities_seen', _seen,
                            'identities_new', _new, 'observations_accepted', _acc + _new, 'events_written', _ev);
end
$fn$;

-- ---- 6. LOCK-DOWN: system-only, no anon, no authenticated -----------------------------
-- Supabase's default privileges grant every new table and function in `public` to anon and
-- authenticated. Revoke by name and enable RLS with no policy (deny by default).
alter table public.dev_change_run     enable row level security;
alter table public.dev_change_project enable row level security;
alter table public.dev_change_event   enable row level security;

-- service_role is revoked too: the default grant gives it ALL (including DELETE and TRUNCATE),
-- which the ledger must never need. It is then granted back exactly what it uses.
revoke all on public.dev_change_run, public.dev_change_project, public.dev_change_event
  from public, anon, authenticated, service_role;
revoke all on sequence public.dev_change_event_id_seq from public, anon, authenticated;
grant select, insert, update on public.dev_change_run     to service_role;
grant select, insert, update on public.dev_change_project to service_role;
grant select, insert         on public.dev_change_event   to service_role;
grant usage on sequence public.dev_change_event_id_seq to service_role;

-- Every dev_change_ function, computed rather than typed (a list typed here would silently
-- stop covering the next function added).
do $lock$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'dev\_change\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $lock$;

-- ROLLBACK (this file only; touches nothing else):
--   drop function if exists public.dev_change_observe_zip(text, uuid), public.dev_change_finish_run(uuid),
--     public.dev_change_start_run(boolean, jsonb), public.dev_change_classify(jsonb, jsonb),
--     public.dev_change_key_is_durable(text), public.dev_change_fp(jsonb), public.dev_change_facts(public.app_projects),
--     public.dev_change_derivation_version(), public.dev_change_facts_version(),
--     public.dev_change_event_immutable() cascade;
--   drop table if exists public.dev_change_event, public.dev_change_project, public.dev_change_run;
