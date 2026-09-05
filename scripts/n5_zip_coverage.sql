-- ============================================================================
-- MAP 1 ZIP-PAGE GEOMETRY COMPLETENESS  —  the SEO-readiness gate
-- ----------------------------------------------------------------------------
-- WHAT A MAP 1 ZIP PAGE MUST SHOW: every development whose AUTHORITATIVE GEOMETRY
-- intersects that ZCTA polygon. In ZIP mode there is no saved address, so
-- centroid/radius placement is structurally impossible — a ZIP centroid is a page
-- anchor, never a home. Radius stays valid ONLY in address mode.
--
-- THE OPERATIONAL DEFINITION, so SEO-readiness is a GATE and not a judgement call.
-- For each ZIP page, every candidate development falls in exactly one class:
--
--   adjudicated  the project HAS authoritative geometry, so the polygon test has
--                already decided it — placed on this page or correctly absent.
--   pending      the project COULD have geometry and does not yet: a RECOVERY
--                project not yet acquired, or a PROVEN project rejected into
--                geo.n5_point_reject (MULTI_COORD_UNRESOLVED / NULL_COORD).
--                Waiting CAN change these. They are what blocks the page.
--   terminal     the project can NEVER have geometry: NOAUTH, IDENT_UNRESOLVED,
--                HIST_UNRECOVERABLE, or a permanently excluded registry.
--                Waiting cannot change these, so they must NOT block the gate —
--                a page held forever on an unfixable row is a gate nobody can pass.
--
--   FULLY_POPULATED  ==  pending = 0        <- the SEO gate
--   INCOMPLETE       ==  pending > 0
--
-- `placed` is measured separately, and only where the boundary-first pass has run.
-- IT CAN EXCEED `adjudicated`, and that is the under-inclusion signal made visible
-- per page: geometry landing inside this ZCTA for projects the legacy 3-mile method
-- never associated with it. 89011 is the worked case — 3,754 placed against 1,611
-- legacy candidates.
--
-- RESIDUAL UNCERTAINTY, stated rather than hidden: the candidate set is the frozen
-- legacy association set, because that is the only enumeration of "projects
-- plausibly near this ZIP". A project with no geometry AND no legacy association to
-- a ZIP is invisible to this metric in both directions.
-- ============================================================================
with cand as (
  select i.zip::text zip, i.source_key, coalesce(i.registry_id,'(null)') rid, a.treatment
  from preservation.app_project_identity i
  join geo.n5_accepted_source a on a.registry_id = coalesce(i.registry_id,'(null)')
  where i.snapshot_id = 'phase1-2026-09-01' and i.record_kind = 'development'),
g as (select distinct source_key from geo.n5_geom where outcome = 1 and geom is not null),
cls as (
  select c.zip, c.source_key,
    case when g.source_key is not null then 'adjudicated'
         when c.treatment in ('NOAUTH','IDENT_UNRESOLVED','HIST_UNRECOVERABLE')
           or c.rid in ('cincinnati-building-permits',
                        'cook-county-il-highway-construction-program',
                        'lake-county-il-construction-program') then 'terminal'
         else 'pending' end k
  from cand c left join g on g.source_key = c.source_key),
per as (
  select zip,
         count(distinct source_key) filter (where k = 'adjudicated') adjudicated,
         count(distinct source_key) filter (where k = 'pending')     pending,
         count(distinct source_key) filter (where k = 'terminal')    terminal
  from cls group by zip),
plc as (select zcta5::text zip, count(*) placed from geo.n5_boundary_membership group by 1),
probed as (select distinct left(zcta5,3) p from geo.n5_boundary_membership)
select coalesce(per.zip, plc.zip)                       as zip,
       case when probed.p is null then '' else coalesce(plc.placed,0)::text end as placed_by_polygon,
       coalesce(per.adjudicated,0)                      as adjudicated,
       coalesce(per.pending,0)                          as pending,
       coalesce(per.terminal,0)                         as terminal,
       case when coalesce(per.pending,0) = 0 then 'FULLY_POPULATED' else 'INCOMPLETE' end as status,
       case when probed.p is null then 'NOT_PROBED' else 'PROBED' end as boundary_first
from per
full outer join plc    on plc.zip = per.zip
left join probed on probed.p = left(coalesce(per.zip, plc.zip),3)
order by 1;
