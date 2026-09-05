with done as (select z3::text p from geo.n5_shard where state='done'),
placed_pfx as (select distinct left(zcta5,3) p from geo.n5_boundary_membership),
cand as (select i.zip::text zip, i.source_key, coalesce(i.registry_id,'(null)') rid, a.treatment
  from preservation.app_project_identity i
  join geo.n5_accepted_source a on a.registry_id = coalesce(i.registry_id,'(null)')
  where i.snapshot_id='phase1-2026-09-01' and i.record_kind='development'),
g as (select distinct source_key from geo.n5_geom where outcome=1 and geom is not null),
cls as (select c.zip, c.source_key,
    case when g.source_key is not null then 'adjudicated'
         when c.treatment in ('NOAUTH','IDENT_UNRESOLVED','HIST_UNRECOVERABLE')
           or c.rid in ('cincinnati-building-permits','cook-county-il-highway-construction-program','lake-county-il-construction-program') then 'terminal'
         else 'pending' end k
  from cand c left join g on g.source_key=c.source_key),
per as (select zip,
    count(distinct source_key) filter (where k='adjudicated') adjudicated,
    count(distinct source_key) filter (where k='pending') pending,
    count(distinct source_key) filter (where k='terminal') terminal
  from cls group by zip),
leg as (select distinct zip::text zip, source_key from geo.n5_association),
mem as (select distinct zcta5::text zip, source_key from geo.n5_boundary_membership),
zips as (select zip from per where left(zip,3) in (select p from done)
   union select zip from leg where left(zip,3) in (select p from done)
   union select zip from mem where left(zip,3) in (select p from done)),
agg as (select z.zip, left(z.zip,3) zip3,
    coalesce(per.adjudicated,0) adjudicated, coalesce(per.pending,0) pending, coalesce(per.terminal,0) terminal,
    (left(z.zip,3) in (select p from placed_pfx)) placed_done,
    (select count(*) from mem where mem.zip=z.zip) placed,
    (select count(*) from leg where leg.zip=z.zip) legacy,
    (select count(*) from mem join leg on leg.zip=mem.zip and leg.source_key=mem.source_key where mem.zip=z.zip) confirmed
  from zips z left join per on per.zip=z.zip),
lines as (select zip,
    zip||','||zip3||','
    ||(case when pending=0 then 'ACQUISITION_UNBLOCKED' else 'PENDING' end)||','
    ||adjudicated||','||pending||','||terminal||','
    ||(case when placed_done then 'COMPLETE' else 'NOT_MEASURED' end)||','
    ||(case when placed_done then placed::text else '' end)||','
    ||legacy||','
    ||(case when placed_done then confirmed::text else '' end)||','
    ||(case when placed_done then (legacy-confirmed)::text else '' end)||','
    ||(case when placed_done then (placed-confirmed)::text else '' end) ln
  from agg)
-- ---------------------------------------------------------------------------
-- ARTIFACT: docs/maps-coverage/completed-shards-zip-coverage.csv
--   header: zip,zip3,acquisition_status,adjudicated,pending,terminal,
--           boundary_placement,placed_by_polygon,legacy_membership,
--           confirmed_legacy,over_inclusion_removed,under_inclusion_added
--   body md5 (excluding header, excluding the file's trailing newline):
--     select md5(string_agg(ln, chr(10) order by zip collate "C")) from lines;
--     --> c999fe69662606670996c497663ae00b   (424 rows, 2026-09-03)
--   file side: tail -n +2 FILE | head -c -1 | md5sum
--
-- WHY `legacy` IS geo.n5_association AND NOT THE ADJUDICATED CANDIDATE PAIRS:
--   they are different units and adding them produces a number that closes only
--   against itself. `adjudicated` counts a project under its OWN filed ZIP in the
--   frozen identity snapshot (12,320 pairs). `n5_association` is the legacy 3-mile
--   fan-out (20,170 pairs) — the membership Maps actually reads today, and therefore
--   the only set whose over-inclusion is meaningful. Every adjudicated pair is in the
--   association set; 7,850 association pairs are not adjudicated pairs.
--
-- NOT MEASURED IS NOT ZERO: placed/confirmed/over/under are written EMPTY for any ZIP
-- whose prefix has no boundary-first run. `boundary_placement` says which.
