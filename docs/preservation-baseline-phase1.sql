-- ============================================================================
-- PHASE 1 — PRE-MIGRATION PRESERVATION BASELINE CAPTURE
-- Founder-authorized 2026-09-01. ADDITIVE ONLY.
--
-- Writes ONLY into the `preservation` schema (created by migration
-- preservation_baseline_phase1_schema). Reads production read-only. Performs no
-- DELETE, TRUNCATE, DROP, UPDATE or reassignment against any production table,
-- touches no function, no policy, no cron job, and no read path.
--
-- WHY THIS RUNS ON A RUNNER RATHER THAN THROUGH THE MCP CLIENT
--   The baseline must come from ONE consistent snapshot (founder requirement 1).
--   A single SQL statement is guaranteed one snapshot, so the whole capture is
--   expressed as ONE statement with data-modifying CTEs. Measured cost: a bare
--   count(*) over public.app_projects is 18.4 s cold / 22.2 s warm, and the
--   capture writes ~900 MB (measured: 511,211 rows -> 145 MB, 282 B/row). That
--   cannot fit the 60 s MCP client budget, and chunking it would break the
--   single-snapshot requirement the founder explicitly imposed. db-sql.yml
--   allows 120 s, so the statement is delivered there instead.
--
-- WHY EVERYTHING ELSE IS DERIVED LATER
--   Legacy associations, rollups and fingerprints are computed AFTER this, from
--   the frozen tables below — never from live. They therefore inherit this
--   statement's snapshot by construction, and all totals reconcile to it.
-- ============================================================================

with be as (
  select distinct unnest(zip_codes) as zip
  from public.communities
  where county = 'Box Elder' and state in ('Utah','UT')
),
ins_identity as (
  insert into preservation.app_project_identity
    (snapshot_id, app_project_id, zip, source_key, source_seq, registry_id, record_kind,
     source_ref, submitted_at, lat, lng, identity_hash, content_hash)
  select 'phase1-2026-09-01', p.id, p.zip, p.source_key, p.source_seq, p.registry_id, p.record_kind,
         p.source_ref, p.submitted_at, p.lat, p.lng,
         -- IDENTITY (preservation gate): business key only. Stable across the
         -- every-2-minute upsert refresh. last_seen_at is deliberately excluded.
         decode(md5(coalesce(p.zip,'')||'|'||coalesce(p.source_key,'')||'|'||
                    coalesce(p.source_seq::text,'')||'|'||coalesce(p.record_kind,'')||'|'||
                    coalesce(p.registry_id,'')),'hex'),
         -- CONTENT (diagnostic only): mutable attributes. A change here is NOT data loss.
         decode(md5(coalesce(p.source_ref,'')||'|'||coalesce(p.submitted_at::text,'')||'|'||
                    coalesce(p.lat::text,'')||'|'||coalesce(p.lng::text,'')||'|'||
                    coalesce(p.name,'')||'|'||coalesce(p.status,'')||'|'||
                    coalesce(p.type,'')),'hex')
  from public.app_projects p
  returning 1
),
ins_report as (
  insert into preservation.development_report
    (snapshot_id, zip, sites_count, counts, refreshed_at, sites_hash)
  select 'phase1-2026-09-01', r.zip,
         jsonb_array_length(coalesce(r.sites,'[]'::jsonb)), r.counts, r.refreshed_at,
         decode(md5(r.zip||'|'||jsonb_array_length(coalesce(r.sites,'[]'::jsonb))::text||'|'||
                    coalesce(r.counts::text,'')||'|'||coalesce(r.refreshed_at::text,'')),'hex')
  from public.development_reports r
  returning 1
),
ins_meta as (
  insert into preservation.community_meta (snapshot_id, zip, indexable, data_quality)
  select 'phase1-2026-09-01', m.zip, m.indexable, m.data_quality
  from public.app_community_meta m
  returning 1
),
ins_be as (
  insert into preservation.box_elder_cache_site
    (snapshot_id, zip, source_registry_id, title, case_number, record_url, lat, lng, site_hash)
  select 'phase1-2026-09-01', r.zip, e.site->>'source_registry_id', e.site->>'title',
         e.site->>'case_number', e.site->>'record_url', e.site->>'lat', e.site->>'lng',
         decode(md5(r.zip||'|'||coalesce(e.site->>'source_registry_id','')||'|'||
                    coalesce(e.site->>'title','')||'|'||coalesce(e.site->>'case_number','')||'|'||
                    coalesce(e.site->>'record_url','')||'|'||coalesce(e.site->>'lat','')||'|'||
                    coalesce(e.site->>'lng','')),'hex')
  from public.development_reports r
  join be on be.zip = r.zip
  cross join lateral jsonb_array_elements(coalesce(r.sites,'[]'::jsonb)) e(site)
  returning 1
)
insert into preservation.baseline_run
  (snapshot_id, capture_started_at, capture_finished_at, pg_version, db_collation,
   fingerprint_algo, collation_rule, site_repo_commit, site_branch_commit, ingest_repo_commit,
   migration_ledger_rows, migration_ledger_tip, read_path_md5, app_refresh_zip_md5, notes)
select 'phase1-2026-09-01', now(), clock_timestamp(),
  current_setting('server_version'),
  (select datcollate from pg_database where datname = current_database()),
  'md5 -> bytea(16); identity = business key, content = mutable attrs',
  'COLLATE "C" pinned on every ordered aggregate; order-independent additive checksum at corpus scale',
  '2eca5dbac15a1be3ff2414aba17d5503b9654d41',
  '32706a6e4db3d98d4cfdf86a3ab59e8b953405f9',
  '65f93ceca157f833267d02378027988f1a870930',
  (select count(*)::int from supabase_migrations.schema_migrations),
  (select name from supabase_migrations.schema_migrations order by version desc limit 1),
  'ec1b01ae4485ad2c59b9f946c9d565b6',
  'dfd09ac72c5b6b65e61ad597665570a0',
  'xact='          || pg_current_xact_id()::text ||
  '; identity='    || (select count(*) from ins_identity)::text ||
  '; reports='     || (select count(*) from ins_report)::text ||
  '; meta='        || (select count(*) from ins_meta)::text ||
  '; be_sites='    || (select count(*) from ins_be)::text
where not exists (
  select 1 from preservation.baseline_run where snapshot_id = 'phase1-2026-09-01'
)
returning snapshot_id, captured_at, notes;
