-- maps-dc-stale-draft-archive.sql — SQL OF RECORD for removing the stale MAPS ·
-- Data Center Theme draft. APPLIED 2026-09-19 as `archive_stale_maps_dc_draft_64155`,
-- ledger version 20260919153249.
--
-- WHY A DRAFT WAS DELETED RATHER THAN CORRECTED. social_posts 4d653f9f-… carried ZIP 64155:
--   * its evidence.project_id (e25ba178-…) no longer exists in app_projects;
--   * the project survived under a NEW id with the SAME source_key
--     (arcgis:kcmo-development-cases:CD-CPC-2026-00142) on ZIP 64165;
--   * so its published link, homesignalmap.html?zip=64155, pointed a resident at a Map 1
--     page that does not show the data centre the post is about.
-- It could not self-heal: mapsDedupeKey is source_key|source_seq|status|submitted_at and the
-- stored key matched the live row byte for byte, so selectFounderCurated reports
-- `draft_exists` forever, and social_posts is UNIQUE (source_table, source_id) so an insert
-- could not replace it. Nothing was approved or published, so removal is contained.
--
-- FAIL-CLOSED AND FINGERPRINTED (rules 7/8). The row is refused unless it still fingerprints
-- md5 23bd5a14d9131a98a06689973b3c2fb1 AND is still an un-approved, un-scheduled draft; the
-- archive must reproduce that md5; and DELETE … RETURNING must reproduce it a third time.
-- Measured after: target absent, archive 1 row, MAPS 38 -> 37, total 211 -> 210 (−1 exactly,
-- so the delete was surgical), approved/published still 0.
--
-- ⚠️ DELETING IT DOES NOT, BY ITSELF, BRING THE POST BACK. A curated run only looks at the
-- ZIPs in maps_dc_zip_order, and NEITHER 64155 NOR 64165 IS IN THAT LIST (measured: 0 of 10).
-- The national scan does not run while a founder list exists. So the corrected project is
-- unreachable until either 64165 is added to the ordered list or the list is cleared — a
-- founder decision, not an engineering one (Rule #0).
--
-- The archive table is RLS-on with no anon grant, and names its own owner and expiry — a
-- diagnostic table in `public` that is anon-readable is the posture this repo treats as a
-- defect (see the epa_split_probe note in CLAUDE.md §7.1).

create table if not exists public.stale_maps_draft_archive (
  archived_at   timestamptz not null default now(),
  reason        text        not null,
  owner_note    text        not null,
  expires_after date        not null,
  row_json      jsonb       not null
);
alter table public.stale_maps_draft_archive enable row level security;
revoke all on public.stale_maps_draft_archive from anon;
drop policy if exists stale_maps_draft_archive_owner_all on public.stale_maps_draft_archive;
create policy stale_maps_draft_archive_owner_all on public.stale_maps_draft_archive
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'sdsutca@proton.me')
  with check ((auth.jwt() ->> 'email') = 'sdsutca@proton.me');

-- The archive + delete block, and the invariants, are the ones applied in migration
-- 20260919153249. Restore path: re-insert row_json from public.stale_maps_draft_archive.
