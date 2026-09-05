-- geo.maps_zip_export — the per-ZIP Maps workbook input. DDL of record.
--
-- WHY IT EXISTS: the founder's workbook (0070Maps IngestFeedInventory.xlsx) is not in
-- this repo, and the geography build must not wait on it. This table carries everything
-- a workbook refresh needs so the refresh is a paste, never a re-derivation of geography.
--
-- ONE ROW PER CANONICAL ZIP PAGE, ALWAYS 12,722. Rebuilt whole by
-- geo.refresh_maps_zip_export() after every production cycle - never appended, because a
-- stale row is indistinguishable from a fresh one.
--
-- THE SIX BUCKETS ARE EXCLUSIVE AND MUST SUM TO 12,722:
--   A_authoritative_with_projects   cut over, >=1 authoritative Development project
--   B_authoritative_measured_zero   cut over, ZCTA existed, exact boundary test RAN,
--                                   result genuinely zero. AN ANSWER.
--   C_measured_not_yet_cut_over     measured, cutover pending
--   D_not_measured_no_zcta          no usable pinned TIGER2025 ZCTA. NOT a zero - the
--                                   ABSENCE of a measurement. Never fold into B.
--   E_no_shard_zero_dev_in_freeze   frozen corpus carries zero Development projects for
--                                   the prefix, so no acquisition is needed at all
--   F_pending_acquisition           still awaiting acquisition
--
-- THREE RAISING CONTROLS inside the refresh, because a plausible-looking export is the
-- failure mode this file exists to prevent:
--   1. row count must equal public.canonical_zip_registry exactly
--   2. no ZIP may be left unbucketed
--   3. the four state flags may never co-occur on one ZIP
--
-- WARNING: `coalesce(s.status,'')` is LOAD-BEARING, not tidiness. A NULL status makes
-- `s.status = 'boundary_complete'` evaluate to NULL rather than false, so the
-- measured_zero flag came out NULL for every unmeasured ZIP on the first build. The
-- NOT NULL column caught it; without that column it would have shipped as a silent
-- "not a measured zero" that is really "unknown". Same three-valued-logic trap as the
-- meetings CHECK constraint's `category is not null` clause in the ingest repo.

create table if not exists geo.maps_zip_export (
  zip                           char(5) primary key,
  geography_bucket              text not null,
  production_geography_verified boolean not null,
  authoritative_projects        integer not null,
  authoritative_markers         integer not null,
  measured_zero                 boolean not null,
  not_measured                  boolean not null,
  frozen_zero_no_acquisition    boolean not null,
  pending_acquisition           boolean not null,
  blocker                       text,
  has_development_report        boolean not null,
  report_refreshed_at           timestamptz,
  report_facilities             integer,
  report_development            integer,
  report_sites                  integer,
  report_sourced_sites          integer,
  facilities_unavailable        boolean,
  materialized                  boolean not null,
  indexable                     boolean,
  data_quality                  text,
  meta_updated_at               timestamptz,
  served_development_rows       integer,
  served_facility_rows          integer,
  refreshed_at                  timestamptz not null default now()
);
alter table geo.maps_zip_export enable row level security;
-- No anon/authenticated grant. geo stays unreachable from the browser; this is an
-- operator/export surface only. See the applied body of geo.refresh_maps_zip_export().

-- Reading, 2026-09-03 after cutover group 3 (12,722 rows, controls passed):
--   A 443 (6,516 projects / 13,895 markers) . B 301 . C 0 . D 76 . E 445 . F 11,457
--   all 12,722 carry a development_reports row and an app_community_meta row;
--   11,698 indexable.
