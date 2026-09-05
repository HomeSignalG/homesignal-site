-- Unit B — bounded authoritative geography cutover for the exact 346 ZIPs. DDL of record.
-- Applied 2026-09-03. Production Maps DEVELOPMENT geography for these 346 ZIPs is now served
-- from the measured authoritative association/marker model. Facilities are untouched.
--
-- Pre-cutover production read path md5: ec1b01ae4485ad2c59b9f946c9d565b6
-- Post-cutover production read path md5: 4591b67f08db6c76b7445295bca0eae8
-- Cutover set fingerprint (346 ZIPs):    dc2640bf3f8a402198dfeceb61faeee2
-- Authoritative marker fingerprint:      e3a0efeb826befc77a4ec57762cf4a1f (unchanged)

-- 1) THE SWITCH — explicit and reversible. Nothing is inferred from the presence of
--    authoritative data; a ZIP is cut over only if it has an enabled row here.
create table if not exists public.app_zip_geography_cutover (
  zip char(5) primary key, enabled boolean not null default false,
  membership_rows int, marker_rows int, set_fingerprint text,
  frozen_at timestamptz not null default now(), enabled_at timestamptz, note text,
  production_geography_verified_at timestamptz);
alter table public.app_zip_geography_cutover enable row level security;
create policy app_zip_geography_cutover_read on public.app_zip_geography_cutover
  for select to anon, authenticated using (true);
grant select on public.app_zip_geography_cutover to anon, authenticated;
-- Populated from the frozen A3 candidate state, then gated: 346 rows, all
-- boundary_complete, 0 not_measured, 0 noncanonical, memberships 5,842, markers 13,218.
-- Every one of those is a raise-on-failure assertion in the migration, not a comment.

-- 2) THE PRODUCER — fail closed, never falls back to legacy development geography.
--    SECURITY DEFINER because geo is unreachable by browser roles and stays that way.
--    public.app_projects is already anon-readable (policy app_projects_read, using(true)),
--    so definer rights expose no row a resident could not already read.
--    Invariants, all raising: project count = membership count · marker count = relation
--    count · every project has source_key and the card fields · no duplicate source_key in a
--    ZIP · no duplicate (source_key, marker_seq).
--    See the applied body: public.app_authoritative_projects_for_zip(text).

-- 3) THE READ PATH — three cases, only the first changes:
--    A enabled cutover ZIP + p_kind='development' -> authoritative producer
--    B not_measured / unqualified                 -> legacy branch, unchanged
--    C noncanonical / absent                      -> legacy branch, unchanged
--    p_kind='facility' never reaches the authoritative branch, so facilities cannot move.
--    SECURITY INVOKER is preserved so the legacy branch keeps reading under caller RLS.

-- ROLLBACK — one statement, reversible, destroys no authoritative data:
--   update public.app_zip_geography_cutover set enabled = false;
-- Proven in a discarded transaction: with enabled=false all 346 ZIPs returned output
-- byte-identical to the pre-cutover baseline (0 development and 0 facility differences),
-- 01009 back to 79 legacy rows, 06238 to 64, 06390 to 0, while the authoritative relations
-- remained intact (13,221 markers / 5,845 memberships).
--
-- The (source_key, record_kind) index and the authoritative shadow relations are
-- independently safe and deliberately survive a rollback.
