-- OFFICIAL-DOCUMENT DEVELOPMENT PROJECTS, PR 1 (site half, evidence contract): the incremental release
-- mode, and the official_documents source registered NOT_ACTIVE. Design: homesignal-ingest
-- docs/official-document-development-ingestion-design-2026-11-13.md §3.4.
--
-- ⛔ NOT APPLIED. Applied only after review, through the replica dry-run rule (CLAUDE.md, "A PRODUCTION DRY
-- RUN RUNS NO DDL IN PRODUCTION"), and BEFORE docs/official-documents-map-gate.sql.
--
-- WHY. dc_source assumes WHOLE RELEASES: the current set is the newest complete run, and a record absent
-- from it reads "not seen". A document family has no release: a run carries only the documents it newly
-- read, so "newest run only" would drop every earlier document, and "absent" would read every one of them
-- as gone. The incremental mode states that once, in the contract, and docs/official-documents-map-gate.sql
-- reads it from the run's FROZEN snapshot (a registry edit can never reinterpret an earlier run).
--   * a record not seen in a run is never inferred removed;
--   * the anti-truncation floor still applies per run (expected_min_records 1: a run that read nothing new
--     is EXIT_NOT_ADVANCED and stores nothing, as the Compute Atlas / Epoch runners already do);
--   * release_mode joins the versioned capabilities, and counts in the fingerprint and the frozen snapshot
--     ONLY when 'incremental' (the preserves_artifact_bytes pattern), so every existing contract fingerprint
--     and every historical snapshot is byte-for-byte unchanged. The file refuses unless that holds.
--
-- WHAT IT DELIBERATELY DOES NOT DO: schedule, activate or acquire anything. official_documents is
-- NOT_ACTIVE with no schedule, and its observations reach no canonical decision until G3 opens
-- (docs/official-documents-map-gate.sql). No place name appears in this file (design T-26).
--
-- SPLICED FROM THE LIVE DEFINITIONS, never retyped: every anchor must occur exactly once and every
-- replacement is re-read to prove it landed, or the whole file raises and nothing is kept.

drop table if exists _od_contract_before;
create temp table _od_contract_before as
select source_key, contract_version, contract_fingerprint from public.dc_source;
drop table if exists _od_snapshot_before;
create temp table _od_snapshot_before as
select id, source_contract_fingerprint, source_contract from public.dc_acquisition_run;

alter table public.dc_source add column if not exists release_mode text not null default 'whole';
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'dc_source_release_mode') then
    alter table public.dc_source add constraint dc_source_release_mode check (release_mode in ('whole', 'incremental'));
  end if;
end $c$;
comment on column public.dc_source.release_mode is
  'Contract capability (official-document design §3.4). whole: a run is a complete release; the current set '
  'is the newest complete run. incremental: a run carries only what it newly read; every advanced complete '
  'run stays current until a later observation supersedes it, and absence is never removal. Counted in the '
  'contract fingerprint and frozen snapshot only when incremental, so no pre-existing contract changes.';

do $mig$
declare
  def text;
  n   int;
  a   text;
  b   text;
begin
  -- ---- 1. dc_source_contract_stamp: version bump + fingerprint (only when incremental) -----------
  def := pg_get_functiondef('public.dc_source_contract_stamp()'::regprocedure);
  if position($p$then 'release_mode=incremental|' else '' end$p$ in def) = 0 then
    a := $a$or (new.preserves_artifact_bytes     is distinct from old.preserves_artifact_bytes);$a$;
    b := $b$or (new.preserves_artifact_bytes     is distinct from old.preserves_artifact_bytes)
            or (new.release_mode                 is distinct from old.release_mode);$b$;
    n := (length(def) - length(replace(def, a, ''))) / length(a);
    if n <> 1 then raise exception 'stamp anchor 1 appears % times', n; end if;
    def := replace(def, a, b);
    a := $a$|| case when new.preserves_artifact_bytes then 'preserves_artifact_bytes|' else '' end$a$;
    b := $b$|| case when new.preserves_artifact_bytes then 'preserves_artifact_bytes|' else '' end
    || case when new.release_mode = 'incremental' then 'release_mode=incremental|' else '' end$b$;
    n := (length(def) - length(replace(def, a, ''))) / length(a);
    if n <> 1 then raise exception 'stamp anchor 2 appears % times', n; end if;
    execute replace(def, a, b);
  end if;
  def := pg_get_functiondef('public.dc_source_contract_stamp()'::regprocedure);
  if position('new.release_mode                 is distinct from old.release_mode' in def) = 0
     or position($p$then 'release_mode=incremental|' else '' end$p$ in def) = 0 then
    raise exception 'stamp splice did not land';
  end if;

  -- ---- 2. dc_acquisition_run_guard: the frozen snapshot carries it (only when incremental) --------
  def := pg_get_functiondef('public.dc_acquisition_run_guard()'::regprocedure);
  if position($p$jsonb_build_object('release_mode', 'incremental')$p$ in def) = 0 then
    a := $a$              then jsonb_build_object('preserves_artifact_bytes', true)
              else '{}'::jsonb end;$a$;
    b := $b$              then jsonb_build_object('preserves_artifact_bytes', true)
              else '{}'::jsonb end
      || case when s.release_mode = 'incremental'
              then jsonb_build_object('release_mode', 'incremental')
              else '{}'::jsonb end;$b$;
    n := (length(def) - length(replace(def, a, ''))) / length(a);
    if n <> 1 then raise exception 'guard anchor appears % times', n; end if;
    execute replace(def, a, b);
  end if;
  if position($p$jsonb_build_object('release_mode', 'incremental')$p$
              in pg_get_functiondef('public.dc_acquisition_run_guard()'::regprocedure)) = 0 then
    raise exception 'guard splice did not land';
  end if;
end
$mig$;

-- ── THE SOURCE, NOT ACTIVE ───────────────────────────────────────────────────────────────────
-- One dataset, one distribution per discovery family (design §3.1). The capabilities are what the checker
-- (PR 3) can state: a record id (the agency case key, else the document passage), a point (a parcel or a
-- stated address), a lifecycle only when the document states one. No release identity: a family has none.
insert into public.dc_source (source_key, publisher, dataset_name, homepage_url, licence, distributions,
    supplies_publisher_record_id, supplies_geometry, supplies_lifecycle_status, supplies_release_identity,
    preserves_record_bytes, expected_min_records, not_seen_vocabulary, schedule_cron, active_state, release_mode)
values ('official_documents', 'Issuing government agencies (named per document)',
        'Official government documents (hearing notices, staff reports, agenda packets, applications, permits)',
        null, 'public record', array['official_listing', 'meeting_packets', 'tx_tceq_air'],
        true, true, true, false, false, 1, 'SOURCE_RECORD_NOT_SEEN', null, 'NOT_ACTIVE', 'incremental')
on conflict (source_key) do nothing;

-- ── NOTHING THAT EXISTED MOVED ───────────────────────────────────────────────────────────────
do $chk$
declare n int;
begin
  select count(*) into n
    from _od_contract_before b join public.dc_source s using (source_key)
   where (s.contract_version, s.contract_fingerprint) is distinct from (b.contract_version, b.contract_fingerprint);
  if n > 0 then raise exception '% existing contract(s) changed version or fingerprint', n; end if;
  select count(*) into n
    from _od_snapshot_before b join public.dc_acquisition_run r using (id)
   where (r.source_contract_fingerprint, r.source_contract) is distinct from (b.source_contract_fingerprint, b.source_contract);
  if n > 0 then raise exception '% historical snapshot(s) changed', n; end if;
  if exists (select 1 from public.dc_source where source_key <> 'official_documents' and release_mode <> 'whole') then
    raise exception 'only official_documents may be incremental at apply time';
  end if;
  if not exists (select 1 from public.dc_source where source_key = 'official_documents'
                  and active_state = 'NOT_ACTIVE' and schedule_cron is null and release_mode = 'incremental') then
    raise exception 'official_documents must be registered NOT_ACTIVE, unscheduled and incremental';
  end if;
end
$chk$;
drop table if exists _od_contract_before;
drop table if exists _od_snapshot_before;
