# Data-centre coverage on Map 1: audit and the classifier fix (2026-11-13)

**Status: the Type fix (order B) is built and in review. Nothing here was applied to production.**
Every number below was read from production through `db-read.yml`, using the read-only role and
the read-only endpoint, on 2026-11-13. The query text is in the appendix. No query reads `auth.*`,
`vault.*` or subscriber data. Names quoted below are public permit or facility records.

Concurrency: this is order B only, the classifier. Order A (Compute Atlas reliability) is owned by
the session behind homesignal-ingest #1105, which merged as `022c6b6`. Orders C–F (the
official-document path) are owned by the session behind homesignal-ingest #1119; that work is
design only for now, and #2861 is unmerged. Both sessions were told about this change and agreed
it does not overlap theirs.

## 1. Why proposed data centres were missing (the five causes)

| # | Cause | Who fixes it |
|---|---|---|
| 1 | The Compute Atlas read has failed 7 of 7 times since 2026-11-06 (the publisher's file returns 404), so Map 1 serves that day's 3,025 records. | #1105 (merged): failures are now visible and turn the run red. The source itself is still down. |
| 2 | A permit that the commercial gate typed `other project` stayed "Other project" even when its own words say it builds a data centre (Memphis COM-ACC-25-000051, "Building a Data Center - Phase 1"). | **This change.** |
| 3 | "super-compute facility" and similar words were not data-centre vocabulary. | **This change**, limited by the power-plant rule (§3). |
| 4 | 208 resolved proposed data centres sit in a Census ZIP area that has no JODY ZIP page (§2). | Not a defect in the map. A ZIP page is added only through the Tab 14 / Gold Master path. |
| 5 | Official-document proposals (air permits, agendas) have no ingestion path. | #1119, PRs 1–6, not yet built. Automatic publication stays off. |

## 2. Audit item 2: 427 vs 212 (measured, exact)

These are the resolved `CONFIRMED_DC` entities that have at least one current `proposed`
observation. Each is counted once, in the first bucket that applies, using Map 1's own reader rules
(the same descriptor ordering as `map1_dc_zip_members`).

| Bucket | Entities |
|---|---:|
| On a JODY ZIP page, shown as Proposed | **212** |
| In a Census ZCTA that has no JODY ZIP page | **208** |
| In no Census ZCTA (outside the US or offshore) | **7** |
| Not a point / invalid coordinates / failed join / shown with another status | **0** |
| **Total** | **427** |

So no join fails and no coordinate is invalid. The 215 that do not appear are outside the
12,746-ZIP page set or outside every ZCTA.

## 3. The Type rule after this change (`lib/project-type.js`)

- **Build scope outranks the terminal type.** A record typed `other project` is a Data center
  when its own words name a data centre AND state building-scope work: build a, construct, new …
  data centre / building, phase N, addition, expansion, core and shell. It also must not name
  equipment inside an existing one: racking, containment, pump, generator, UPS, cabling,
  chillers, CRAH/CRAC, sprinklers, fire alarm, signs, lighting, demolition. Those permits stay
  terminal, so work inside an operating data centre never reads as a new development.
- **Compute facilities.** These count as a named facility: super-compute / supercomputer /
  supercomputing facility, center, campus or building; HPC facility; high-performance computing
  facility; GPU cluster building. "AI factory" and "compute" alone do not count.
- **A standalone power plant is never a data centre** (founder, 2026-11-13).
  - "to power", "powering" and "powers" are serving words.
  - The serving guard also covers the compute words.
  - Turbines, generators, generating units, EGUs and peakers compete with the data centre.
  - A compute facility named beside power equipment counts only when it is joined to it as a
    second facility of the same project ("gas-fired power plant and super-compute facility").
- **Type only.** The lifecycle still comes from the record's own status (test §6). Identity is
  not touched, and linking a power plant to a data centre never retypes it (#1119 §3.6a).

The rule lives in one place. These copies are generated from it or checked against it:

- `supabase/functions/_shared/project-type.generated.js` (`scripts/gen-project-type-module.mjs`);
- the SQL copy in `docs/fix28-datacenter-zip-membership.sql` (`scripts/gen-dc-type-sql.mjs`);
- the Bluesky MAPS port, homesignal-ingest `bluesky/lib/maps-datacenter.mjs` (parity corpus test).

The accepted and refused phrases in `test/datacenter-build-scope.test.mjs` §5 and §5b are the
shared fixture that homesignal-ingest #1119 copies.

Parity:

- JS and SQL agree on all 426 frozen Fix 28 production inputs: 412 true, where it was 411 before.
  The one change is COM-ACC-25-000051.
- The 898-row ingest parity corpus moves exactly that one label.

## 4. Audit item 1: what has to be refreshed

| Consumer | Stores a derived Type? | After merge |
|---|---|---|
| Map 1, ZIP page, development page (`HS.resolveMarker`, `HS.canonicalProjectType`) | No: decided when drawn | Next page load (cache keys bumped) |
| Generated ZIP / project pages (`scripts/gen_zip_pages.py`) | Built at deploy | Next Pages build |
| Rule D SEO plane SSR annotation | Built daily | Next 05:30 UTC refresh |
| Development Activity Report engine (`_shared/national-report.ts`) | New reports only | Needs `deploy-edge-functions` for the report functions. Saved reports are immutable and are not rewritten. |
| Fix 28 trigger (`public.map_site_is_datacenter_type`) | Decides on future writes of `development_reports` | Needs `docs/dc-build-scope-apply-2026-11-13.sql` applied (one transaction, post-checked) |
| MAPS Bluesky posts (`evidence.visual.type_key`) | Stamped at capture | New drafts after homesignal-ingest #1120. Published posts are never rewritten. |
| `app_projects.type` | Source / engine type, unchanged | Nothing (the classifier reads it) |

## 5. Audit item 3: data-centre wording in stored permits (exact, no sample)

The query counts development rows in `app_projects` whose stored name matches `DATACENTER_RE`, by
stored type, run one ZIP range at a time because of the 120-second limit.

| ZIP range | Stored type → rows (records, ZIPs) |
|---|---|
| 0 | Utility 16 (3, 7) · Development 1 (1, 1) |
| 1 | Development 11 (11, 8) · Industrial 4 (4, 2) |
| 2 | Development 2 (2, 2) · Civic/Public 1 (1, 1) · Commercial 1 (1, 1) |
| 3 | Commercial 6 (6, 4) · **other project 6 (2, 5)** |
| 4 | Development 1 (1, 1) |
| 5 | Commercial 1 (1, 1) |
| 6 | Development 49 (13, 37) |
| 7 | unclassified 13 (9, 10) · Development 1 (1, 1) |
| 8 | **other project 40 (11, 16)** · Commercial 10 (10, 6) |
| 90–94 | none |
| 95–99 | Industrial 15 (15, 4) |
| **All** | **178 rows**; **other project 46 rows, 13 records** (ranges 3 and 8 only) |

**What the new rule does to those 13 records** (each one run through `HS.resolveMarker`):

- **1 becomes Data center:** Memphis COM-ACC-25-000051, "Building a Data Center - Phase 1".
- **10 stay Other project:** they describe work inside an existing data centre. Racking (Oppidan,
  Memphis); data hall battery systems (PHX05-3 1A/1B/1C); an office alarm (SC-35); a tenant
  improvement (Iron Mountain SC-31, La Salle T.I.); fire alarm and fire suppression (two
  "HYPERSCALE" permits).
- **3 stay Other project:** bare names that state no work ("SC-33 DATA HALL", "MCDOWELL ROAD DATA
  CENTER", "FL/COMBO THISTLE LANDING DATA CENTER"). The source's own commercial gate said their
  work was not qualifying. The founder's rule needs supporting context, not the keyword alone.

How to read this:

- Rows are ZIP copies. One permit appears on every ZIP page whose circle reaches it.
- Records are counted per range, so a record that falls in two ranges is counted twice.
- The 90–94 zero comes from the same query that returned rows in every other range, so the query
  is not broken. That range simply holds no development name with these words.
- These counts use the data-centre words only, not the new compute-facility words.

Only the `other project` rows were hidden by cause 2. Every other stored type already resolves to
Data center through the name rule, because that rule runs before the type tables.

## Appendix: queries

The query files were run from a scratch branch and are not on `main`; their text is below.

```sql
-- Audit item 2: why 427 resolved "proposed" data centres become 212 on registry ZIP pages.
-- Each entity is put in exactly ONE bucket, in this order, using Map 1's own reader rules.
with p as (
  select distinct e.canonical_entity_id, g.geometry_type, g.lat, g.lng, g.geom
    from public.dc_canonical_entity e
    join public.dc_entity_geography g using (canonical_entity_id)
    join public.dc_entity_observation eo using (canonical_entity_id)
    join public.dc_current_observation o on o.home_signal_observation_id = eo.home_signal_observation_id
   where e.superseded_by is null and e.classification = 'CONFIRMED_DC'
     and g.geography_status = 'RESOLVED' and o.source_native_status = 'proposed'),
d as (  -- the reader's descriptor: displayable status, location authority first, newest
  select p.*, (select x.source_native_status
                 from public.dc_entity_observation eo2
                 join public.dc_current_observation cx on cx.home_signal_observation_id = eo2.home_signal_observation_id
                 join public.dc_source_observation x on x.home_signal_observation_id = eo2.home_signal_observation_id
                 join public.dc_entity_geography ge on ge.canonical_entity_id = eo2.canonical_entity_id
                where eo2.canonical_entity_id = p.canonical_entity_id
                  and (x.source_native_status is null or x.source_native_status in ('operational','under_construction','permitted','proposed'))
                order by (x.source_native_status is not null) desc,
                         (x.home_signal_observation_id = ge.authority_observation_id) desc,
                         x.observed_at desc, x.home_signal_observation_id limit 1) as shown_status
    from p),
z as (
  select d.*, (select count(*) from geo.zcta_boundary b where ST_Covers(b.geom, ST_SetSRID(d.geom::geometry,4269))) as zctas,
              (select count(*) from geo.zcta_boundary b join public.canonical_zip_registry r on r.zip = b.zcta5
                where ST_Covers(b.geom, ST_SetSRID(d.geom::geometry,4269))) as reg_zctas
    from d)
select bucket, count(*) n from (
  select case
    when geometry_type is distinct from 'POINT' then '1 not a point'
    when lat is null or lng is null or abs(lat) > 90 or abs(lng) > 180 then '2 invalid coordinates'
    when zctas = 0 then '3 in no Census ZCTA (outside the US or offshore)'
    when zctas > 1 and reg_zctas > 0 then '4 on a ZIP edge (drawn on both pages)'
    when reg_zctas = 0 then '5 in a ZCTA that has no JODY ZIP page'
    when shown_status <> 'proposed' then '6 on a ZIP page, shown with another source status: ' || shown_status
    else '7 on a ZIP page, shown as Proposed' end as bucket
  from z) q
group by 1 order by 1;

-- §5: one ZIP range per run
select coalesce(type,'(none)') as stored_type, count(*) as rows,
       count(distinct source_key) as records, count(distinct zip) as zips
  from public.app_projects
 where zip >= '<lo>' and zip < '<hi>' and record_kind = 'development'
   and name ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
 group by 1;
```
