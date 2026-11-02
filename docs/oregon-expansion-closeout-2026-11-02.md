# Oregon Development Map expansion: close-out (2026-11-02)

The Oregon source expansion ends here. It is the record of #2487 (five sources) and #2492 (registry receipts). No further Oregon expansion work is open in this session.

## Measured result (Map 1 snapshot `n5-national-2026-11-01b`, ACTIVE since 2026-11-02 08:55:10Z)

Unit: Oregon ZIP pages (the 200 `level=zip` communities with `state` OR), counting `geo.zip_authoritative_membership` rows with `record_kind = 'development'`. "Local" means a source other than the two statewide ODOT layers, `oregon-dot-stip-projects` and `oregon-dot-stip-projects-lines`.

Control: the same query on the previous snapshot, `n5-national-2026-11-01`, reproduces the Nov 1 baseline exactly (97 / 53 / 16,763).

| Oregon ZIP pages (200) | Before (`2026-11-01`) | After (`2026-11-01b`) | Change |
|---|---:|---:|---:|
| ZIP pages showing development | 97 | **104** | +7 |
| ZIP pages with a local source | 53 | **67** | +14 |
| Development memberships | 16,763 | **17,162** | +399 |

| New source | Memberships | ZIPs |
|---|---:|---:|
| tigard-or-active-building-permits | 190 | 2 |
| portland-neighborhood-contact-applications | 108 | 24 |
| beaverton-or-site-development-permits | 47 | 5 |
| eugene-or-current-capital-projects | 38 | 6 |
| tigard-or-active-planning-cases | 17 | 2 |
| **total** | **400** | |

The existing sources moved by -1 over the same day: Jackson building -2, Jackson land use +2, Salem -1. 400 - 1 = 399.

**ZIP pages that went from no development to records:** 97006 (9), 97007 (9), 97008 (7), 97225 (5), all from Beaverton; 97208 (1, Portland neighborhood contacts); 97404 (3) and 97405 (12), both from Eugene.

**ZIP pages that went from ODOT road projects only to local records:** 97005, 97223, 97224, 97401, 97402, 97403, 97408. The pre-merge estimate (66) missed 97403.

**Live reader check, 10:01Z.** `public.app_zip_projects_markers(zip, 'development', true)` is what Map 1 calls. Every ZIP below returned `boundary_complete`:
- 97006: Beaverton 9.
- 97224: Tigard building 94, Tigard planning 8, ODOT 6.
- 97405: Eugene 19.
- 97211: Portland building 39, Portland neighborhood contacts 3, ODOT 4.
- 97232: Portland building 3, Portland neighborhood contacts 5, ODOT 4.

### The membership query

```sql
with z as (select distinct unnest(zip_codes) zip from communities where level='zip' and state in ('OR','Oregon')),
m as (select m.generation_id g, m.zcta5::text zip, split_part(m.source_key,':',2) src
      from geo.zip_authoritative_membership m join z on z.zip = m.zcta5::text
      where m.record_kind = 'development'
        and m.generation_id in ('n5-national-2026-11-01','n5-national-2026-11-01b'))
select g, count(distinct zip) zips_dev,
       count(distinct zip) filter (where src not in ('oregon-dot-stip-projects','oregon-dot-stip-projects-lines')) zips_local,
       count(*) recs
from m group by g order by g;
```

## For the national lifecycle session: issues found, NOT fixed here

That session owns lifecycle and stage classification, preliminary-versus-formal filings, stage wording and source-link labels. Nothing below was changed in this session.

### 1. Portland neighborhood contacts reach the map as plain "Proposed"

- **Source.** `portland-neighborhood-contact-applications` (portlandmaps MapServer/1298) lists neighborhood contacts. A developer files one *before* a land-use or building application exists, so these are early notices, not applications and not approvals.
- **Stored correctly.** The registry gives every row `status_const` "Neighborhood contact filed before a land-use or building application" and the bucket `proposed`. In `app_projects` all 108 records have `status = 'Proposed'`, with that sentence in `stage`.
- **Lost in the live map read.** `app_zip_projects_markers` returns each project's `status`, `date_kind` and `submitted_at`, but **no `stage`**. Checked on 97232, 2026-11-02 10:01Z, for example record 410 "HT Townhome Project", which came back `status Proposed`, `date_kind filed`. So on Map 1 a neighborhood contact looks like any other proposed application.
- **The 108 records.** Portland OBJECTID 305 to 412, filed 2023-11-03 to 2026-09-30. Reproduce them with:

  ```sql
  select split_part(source_key,':',3) object_id, min(name) name, min(address) address,
         min(submitted_at) filed, min(status) status, min(stage) stage
  from app_projects
  where record_kind = 'development'
    and split_part(source_key,':',2) = 'portland-neighborhood-contact-applications'
  group by 1 order by object_id::int;
  ```

  Fingerprint `md5(string_agg(object_id, ',' order by object_id collate "C"))` = `5e9a409b4312c2e8d0f7d38671cce7d5` (n = 108, measured 2026-11-01).
- **Repeat filings of one project.** The city records each contact as its own row, so one project shows as several "Proposed" pins:

  | Project | Filings |
  |---|---|
  | Katherine Townhomes | 365, 378, 379 |
  | Lombard Street Apartments | 320, 321 |
  | Skidmore and Vancouver Condos | 375, 376 |
  | French International School | 311, 315 |
  | 1963 NW Kearney | 366, 404 |
  | 7881 N Fessenden | 338, 339 |
  | 6409 SE 83rd | 361, 362 |
  | HT Townhome Project | 408, 410 |
  | PSU New Housing | 392, 393 |
  | Cleveland High School | 371, 372 |

- **Blank name.** OBJECTID 312 (5115 SE Woodstock Blvd) has an empty name in the source, and it is stored and shown as the text "None".

### 2. Two sources link to a raw data service, not a readable page

- **Beaverton.** All 47 `beaverton-or-site-development-permits` records link to `https://services.arcgis.com/mpOrhWpH9jj0z4rU/arcgis/rest/services/SD_Permits_Data/FeatureServer/0`. The source has no per-record link column.
- **Portland.** All 108 `portland-neighborhood-contact-applications` records link to `https://www.portlandmaps.com/od/rest/services/COP_OpenData_PlanningDevelopment/MapServer/1298`.
- **Effect.** Both are ArcGIS REST endpoints (`record_url_precision: dataset`). A resident who clicks sees the service's machine page, which is worse than a general city page.

For comparison, the other three sources:

| Source | Records | Link |
|---|---:|---|
| Tigard building permits | 192 | One Tigard EnerGov page per record |
| Tigard planning cases | 21 | One Tigard EnerGov page per record |
| Eugene capital projects | 26 | 24 link to a project page (6 distinct pages, shared across segments); 2 fall back to the city's general Current Projects page |

## Outstanding refresh failures (measured 2026-11-02 ~09:00Z)

| ZIP | Last stored | Last attempt | Cause |
|---|---|---|---|
| 97232 | 2026-10-31 16:20Z | 2026-11-01 18:15Z | portlandmaps.com connection reset (Portland building permits) |
| 97267 | 2026-10-29 10:26Z | 2026-10-31 15:32Z | portlandmaps.com connection reset |
| 97525 | 2026-10-30 07:36Z | 2026-11-01 12:42Z | Jackson County layer timeout |
| 97537 | 2026-10-30 07:36Z | 2026-11-01 12:40Z | Jackson County layer timeout |
| 97539 | 2026-10-30 11:42Z | 2026-11-01 16:48Z | Jackson County layer timeout |

The refresh guard keeps each page's previously stored records, so none of these pages went empty.

portlandmaps.com resets connections when several ZIPs query it at the same moment (recorded in `docs/source-registry.md`). A per-host concurrency limit in the report engine would address it. That is engine work and is not opened here.

## Remaining Oregon gaps (unchanged)

- 96 Oregon ZIP pages still show no development, and 37 show only ODOT road projects. Both counts are derived from the table above (200 − 104; 104 − 67).
- No usable official per-record source was found for rural Lane, Clackamas, Yamhill, Benton, Hood River, or the small Marion towns.
- Gresham's layer is stale, and Salem land use is not wired. The rejections with their reasons are in `docs/source-registry.md`, "OREGON EXPANSION".
