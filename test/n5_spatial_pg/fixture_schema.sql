-- Minimal, self-contained schema for exercising the SHIPPED
-- docs/n5-spatial-read-rpc.sql against a disposable PostGIS.
--
-- WHY SELF-CONTAINED: the N5 lifecycle migration and its executable suite live on
-- the #1016 branch (claude/n5-canonical-provenance); this branch (#1015) must be
-- testable on its own. Only the columns and constraints the RPC actually depends
-- on are reproduced, and they are reproduced with the same names, types and
-- domains as production (verified against production catalog 2026-09-03), so a
-- test passing here is evidence about the real function rather than about a
-- convenient stand-in.
create extension if not exists postgis;
create schema if not exists geo;

drop table if exists geo.n5_geom cascade;
create table geo.n5_geom (
  source_key           text        not null,
  registry_id          text,
  feature_id           text        not null,
  outcome              smallint    not null,
  geom                 geometry,
  invalid_reason       text,
  first_z3             character(3),
  provenance           text        not null,
  verdict_snapshot_id  text,
  recovered_at         timestamptz not null default now(),
  constraint n5_geom_pkey primary key (source_key, feature_id),
  constraint n5_geom_provenance_ck check
    (provenance = any (array['recovered_authoritative','proven_stored_point']))
);
-- the SAME index name and shape the RPC's prefilter is designed around
create index n5_geom_gix   on geo.n5_geom using gist (geom);
create index n5_geom_sk_ix on geo.n5_geom using btree (source_key);

drop table if exists geo.n5_point_reject cascade;
create table geo.n5_point_reject (
  source_key           text not null,
  registry_id          text,
  lat                  double precision,
  lng                  double precision,
  reason               text not null,
  observed_in_z3       character(3),
  verdict_snapshot_id  text,
  rejected_at          timestamptz not null default now(),
  constraint n5_point_reject_pkey primary key (source_key)
);

drop table if exists geo.n5_verdict_manifest cascade;
create table geo.n5_verdict_manifest (
  snapshot_id           text        not null,
  state                 text        not null,
  expected_source_keys  bigint,
  verdict_rows          bigint,
  eligible_rows         bigint,
  reject_counts         jsonb,
  fingerprint           text,
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  canonical_synced_at   timestamptz,
  constraint n5_verdict_manifest_pkey primary key (snapshot_id),
  constraint n5_verdict_manifest_state_ck check (state in ('BUILDING','READY','FAILED')),
  constraint n5_verdict_manifest_sync_ck  check (canonical_synced_at is null or state = 'READY')
);
