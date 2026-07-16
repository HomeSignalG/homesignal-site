# Source-monitor report (append-only)

Written by `scripts/source-monitor.mjs` — the nightly automated source monitor
(`.github/workflows/source-monitor.yml`, 07:00 UTC, before the 09:00 UTC engine refresh).

Each run appends a dated section below:

- **Sources re-probed** — every source `docs/source-registry.md` rejected as
  dead / stale / frozen / blocked / broken (`scripts/source-monitor-targets.json` `reprobe[]`),
  probed again with the exact endpoint that failed last time.
- **Auto-wired** — candidates that came back to life (or were newly discovered on an official
  first-party catalog) AND passed the fail-closed gate: point geometry, native ZIP column,
  fresh data, live statuses/types mapped ONLY through the human-approved
  `scripts/source-lexicon.json`. Wired = one appended `jurisdiction-registry.json` entry with
  `_wired_by` + `_receipts`; revert = delete that entry (or `git revert` the run's commit)
  and redeploy.
- **Flagged shapes** — live sources the generic connectors (ArcGIS FeatureServer, Socrata)
  do NOT handle: CKAN catalogs, vendor portals (Accela, eTRAKiT, CitizenServe, OpenGov,
  Tyler EnerGov, CivicPlus), polygon-only layers, layers without a native ZIP or with
  statuses/types unknown to the lexicon. These are DESCRIBED, never guessed — each flag says
  what connector or lexicon work it needs.
- **Dev-backed ZIPs snapshot** — distinct ZIPs with ≥1 `app_projects` development record
  (public anon read), so the next run shows the delta a wire produced after the nightly
  deploy + refresh picked it up.

v18 anti-fabrication is absolute throughout: nothing is classified without a real structured
status/type, every emitted row keeps a real source reference, and EPA facilities stay
`record_kind='facility'` — the monitor only ever appends registry entries; it never touches
facility sources or existing entries.

## Run 2026-07-14T00:25:29.855Z

- Sources re-probed: **12** · discovery targets walked: **7** · candidates evaluated: **49**
- Auto-wired: **none**
- Flagged new shapes (connector work needed — never guessed): **21**
- Dev-backed ZIPs snapshot: **103**

| target | result | evidence |
|---|---|---|
| denton-county-dev-permits | still-stale | newest DateReceiv = 2023-06-09 (> 400d old) |
| mckinney-underconstruction | still-stale | newest IssueDate = 2023-09-26 (> 400d old) |
| frisco-active-building-permits | unreachable | HTTP 0 UND_ERR_CONNECT_TIMEOUT |
| frisco-active-zoning-sup-cases | unreachable | HTTP 0 UND_ERR_CONNECT_TIMEOUT |
| allen-current-development-projects | flag | layer "Current Development Projects" is esriGeometryPolygon |
| el-paso-new-commercial | flag | fresh (newest 2026-06-30); lexicon maps 5120/11322 rows; unmapped:   (4165); Revisions Required (2); Hold for Corrections (8); Out for Corrections (4); TCO Issued (67); Inspection (1956) |
| el-paso-accela-building-permits | error | service error 404: Service OpenData_Accela/BuildingPermits/MapServer not found  |
| dallas-building-permits-e7gq | still-stale | rowsUpdatedAt = 2020-08-30 (> 400d old) |
| dallas-building-permits-6ik7 | still-stale | rowsUpdatedAt = 2018-02-09 (> 400d old) |
| fort-worth-development-permits-gate-validation | already-wired | registry entry exists |
| denton-city-portal | still-dead | catalog HTTP 404 <!DOCTYPE html>
<!--[if IE 9]> <html lang="en" class="ie9"> <![endif]-->
<!--[if gt IE 8]><!--> <html lang="en"> <!--<![endif]-->
  <head>
    <meta charset="utf-8" />
      <meta name="generator" con |
| plano-portal | no-candidates | 1 first-party dataset(s) for q=permit but none matched the permit/land-use pattern (or all duplicate/already wired) |
| houston-ckan | flag | CKAN catalog with 4 permit-pattern dataset(s): Combustible Storage Permits (Waste or Dumpster Permits) Sold from May 2012 th...; City of Houston Active Commercial Vehicle Loading Zone Permits; City of Houston Residential Building Permits by Month and Year; All Paid Vehicle Permits 05/01/2011 to 04/3 |
| houston-cohgis → HoustonMap/Landuse/Land Use (Grouped)  | flag | layer "Land Use (Grouped) " is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Towers | still-stale | newest ActionDate = 2001-05-31 (> 400d old) |
| houston-cohgis → HoustonMap/Planning_and_Development/Schools Primary Entrance | still-stale | newest School_Status_Date = 2023-04-06 (> 400d old) |
| houston-cohgis → HoustonMap/Planning_and_Development/Restricted Lot Driveway Access | flag | layer "Restricted Lot Driveway Access" is esriGeometryPolyline |
| houston-cohgis → HoustonMap/Planning_and_Development/Conservation Districts | flag | layer "Conservation Districts" is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Green Corridor | flag | layer "Green Corridor" is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Prohibited Yard Parking Applications | flag | layer "Prohibited Yard Parking Applications" is esriGeometryPolygon |
| houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6556 BEFORE ASSIGNING ADDRESS | flag | layer "CALL 832-393-6556 BEFORE ASSIGNING ADDRESS" is esriGeometryPolygon |
| el-paso-open-data | unreachable | DCAT HTTP 0 ENOTFOUND |
| arlington-open-data | unreachable | DCAT HTTP 0 ENOTFOUND |
| dallas-open-data → Building Permits for Fiscal Year 2017 - 2018 (w2uy-zn9f) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2011 - 2012 (azf5-sdcr) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2013 - 2014 (fs84-rv8z) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2015 - 2016 (rzm4-tcqx) | still-stale | rowsUpdatedAt = 2021-07-29 (> 400d old) |
| dallas-open-data → ROW Permits - Points (bw6g-a3ur) | flag | updated 2026-07-11; columns: the_geom, objectid, jobid, externalfilenum, permittype, commercialorresidential, statusdescription, createddate, issuedate, completeddate, expirationdate, rowrequestedstartdate, rowestimatedcompletiondate, warrantyexpiration, rowreasonforjob… |
| dallas-open-data → Jill SRF 14 08 Permit W Location (4xqw-i3tz) | still-stale | rowsUpdatedAt = 2014-11-04 (> 400d old) |
| dallas-open-data → ROW Permits - Lines (xd3q-ipis) | flag | updated 2026-07-11; columns: the_geom, objectid, jobid, externalfilenum, permittype, commercialorresidential, statusdescription, createddate, issuedate, completeddate, expirationdate, rowrequestedstartdate, rowestimatedcompletiondate, warrantyexpiration, rowreasonforjob… |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Custer West Exhibit | flag | layer "Custer West Exhibit" is (none) |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Craig Ranch Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Honey Creek Investment District Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Huntington Park Land Use Plan Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/MTC Regulating Exhibit | flag | layer "MTC Regulating Exhibit" is (none) |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Stonebridge Ranch Exhibit | flag | layer "Stonebridge Ranch Exhibit" is (none) |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Times 1 | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Origin 1 | error | max(created_date) query failed |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Time Areas 1 | flag | layer "Drive Time Areas 1" is esriGeometryPolygon |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Times 2 | not-a-layer | no fields[] — unrecognized shape |
| denton-county-arcgis → Addresses911Permits_GC/911 Addresses | error | max(created_date) query failed |
| denton-county-arcgis → CityETJPermits_GC/City and ETJ | not-a-layer | no fields[] — unrecognized shape |
| denton-county-arcgis → CityETJPermits_GC/City Labels | flag | layer "City Labels" is esriGeometryPolygon |
| denton-county-arcgis → CityETJPermits_GC/ETJ Labels | flag | layer "ETJ Labels" is esriGeometryPolygon |
| denton-county-arcgis → CityETJPermits_GC/City and ETJ | flag | layer "City and ETJ" is esriGeometryPolygon |
| denton-county-arcgis → ContourPermits_GC/1 Foot Contours - 2017 | flag | layer "1 Foot Contours - 2017" is esriGeometryPolyline |
| denton-county-arcgis → ContourPermits_GC/2 Foot Contours - 2005 | flag | layer "2 Foot Contours - 2005" is esriGeometryPolyline |
| denton-county-arcgis → ContourPermits_GC/2 Foot Contours - LIDAR 2000 | flag | layer "2 Foot Contours - LIDAR 2000" is esriGeometryPolyline |
| denton-county-arcgis → DEV_Permits/Permits | still-stale | newest DateReceiv = 2023-06-09 (> 400d old) |

### Flagged shapes — what connector work each needs
- **allen-current-development-projects** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **el-paso-new-commercial** — statuses unknown to the lexicon: a human to extend scripts/source-lexicon.json with these VERBATIM statuses (only from a human-approved mapping)
- **houston-ckan** — CKAN catalog: a CKAN connector (generic connectors handle ArcGIS + Socrata only) — or wire the dataset directly if a distribution exposes an ArcGIS/Socrata API
- **houston-cohgis → HoustonMap/Landuse/Land Use (Grouped) ** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Restricted Lot Driveway Access** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Conservation Districts** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Green Corridor** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Prohibited Yard Parking Applications** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6556 BEFORE ASSIGNING ADDRESS** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **dallas-open-data → ROW Permits - Points (bw6g-a3ur)** — socrata resource missing: status, type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **dallas-open-data → ROW Permits - Lines (xd3q-ipis)** — socrata resource missing: status, type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **mckinney-arcgis → MapServices/DevelopmentExhibits/Custer West Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/DevelopmentExhibits/MTC Regulating Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/DevelopmentExhibits/Stonebridge Ranch Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Time Areas 1** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/City Labels** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/ETJ Labels** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/City and ETJ** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/1 Foot Contours - 2017** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/2 Foot Contours - 2005** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/2 Foot Contours - LIDAR 2000** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point

## Run 2026-07-14T09:03:51.659Z

- Sources re-probed: **14** · discovery targets walked: **13** · candidates evaluated: **80**
- Auto-wired: **none**
- Flagged new shapes (connector work needed — never guessed): **51**
- Dev-backed ZIPs snapshot: **168** (Δ +65 vs last run)

| target | result | evidence |
|---|---|---|
| denton-county-dev-permits | still-stale | newest DateReceiv = 2023-06-09 (> 400d old) |
| mckinney-underconstruction | still-stale | newest IssueDate = 2023-09-26 (> 400d old) |
| frisco-active-building-permits | unreachable | HTTP 0 UND_ERR_CONNECT_TIMEOUT |
| frisco-active-zoning-sup-cases | unreachable | HTTP 0 UND_ERR_CONNECT_TIMEOUT |
| allen-current-development-projects | flag | layer "Current Development Projects" is esriGeometryPolygon |
| el-paso-new-commercial | flag | fresh (newest 2026-06-30); lexicon maps 5120/11322 rows; unmapped:   (4165); Revisions Required (2); Hold for Corrections (8); Out for Corrections (4); TCO Issued (67); Inspection (1956) |
| el-paso-accela-building-permits | error | service error 404: Service OpenData_Accela/BuildingPermits/MapServer not found  |
| dallas-building-permits-e7gq | still-stale | rowsUpdatedAt = 2020-08-30 (> 400d old) |
| dallas-building-permits-6ik7 | still-stale | rowsUpdatedAt = 2018-02-09 (> 400d old) |
| fort-worth-development-permits-gate-validation | already-wired | registry entry exists |
| denton-city-portal | still-dead | catalog HTTP 404 <!DOCTYPE html>
<!--[if IE 9]> <html lang="en" class="ie9"> <![endif]-->
<!--[if gt IE 8]><!--> <html lang="en"> <!--<![endif]-->
  <head>
    <meta charset="utf-8" />
      <meta name="generator" con |
| plano-portal | no-candidates | 1 first-party dataset(s) for q=permit but none matched the permit/land-use pattern (or all duplicate/already wired) |
| houston-ckan | flag | CKAN catalog with 4 permit-pattern dataset(s): Combustible Storage Permits (Waste or Dumpster Permits) Sold from May 2012 th...; City of Houston Active Commercial Vehicle Loading Zone Permits; City of Houston Residential Building Permits by Month and Year; All Paid Vehicle Permits 05/01/2011 to 04/3 |
| houston-cohgis → HoustonMap/Landuse/Land Use (Grouped)  | flag | layer "Land Use (Grouped) " is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Towers | still-stale | newest ActionDate = 2001-05-31 (> 400d old) |
| houston-cohgis → HoustonMap/Planning_and_Development/Schools Primary Entrance | still-stale | newest School_Status_Date = 2023-04-06 (> 400d old) |
| houston-cohgis → HoustonMap/Planning_and_Development/Restricted Lot Driveway Access | flag | layer "Restricted Lot Driveway Access" is esriGeometryPolyline |
| houston-cohgis → HoustonMap/Planning_and_Development/Conservation Districts | flag | layer "Conservation Districts" is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Green Corridor | flag | layer "Green Corridor" is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Prohibited Yard Parking Applications | flag | layer "Prohibited Yard Parking Applications" is esriGeometryPolygon |
| houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6556 BEFORE ASSIGNING ADDRESS | flag | layer "CALL 832-393-6556 BEFORE ASSIGNING ADDRESS" is esriGeometryPolygon |
| el-paso-open-data | unreachable | DCAT HTTP 0 ENOTFOUND |
| arlington-open-data | unreachable | DCAT HTTP 0 ENOTFOUND |
| dallas-open-data → Building Permits for Fiscal Year 2011 - 2012 (azf5-sdcr) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2017 - 2018 (w2uy-zn9f) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2013 - 2014 (fs84-rv8z) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2015 - 2016 (rzm4-tcqx) | still-stale | rowsUpdatedAt = 2021-07-29 (> 400d old) |
| dallas-open-data → ROW Permits - Points (bw6g-a3ur) | flag | updated 2026-07-11; columns: the_geom, objectid, jobid, externalfilenum, permittype, commercialorresidential, statusdescription, createddate, issuedate, completeddate, expirationdate, rowrequestedstartdate, rowestimatedcompletiondate, warrantyexpiration, rowreasonforjob… |
| dallas-open-data → Jill SRF 14 08 Permit W Location (4xqw-i3tz) | still-stale | rowsUpdatedAt = 2014-11-04 (> 400d old) |
| dallas-open-data → ROW Permits - Lines (xd3q-ipis) | flag | updated 2026-07-11; columns: the_geom, objectid, jobid, externalfilenum, permittype, commercialorresidential, statusdescription, createddate, issuedate, completeddate, expirationdate, rowrequestedstartdate, rowestimatedcompletiondate, warrantyexpiration, rowreasonforjob… |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Custer West Exhibit | flag | layer "Custer West Exhibit" is (none) |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Craig Ranch Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Honey Creek Investment District Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Huntington Park Land Use Plan Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/MTC Regulating Exhibit | flag | layer "MTC Regulating Exhibit" is (none) |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Stonebridge Ranch Exhibit | flag | layer "Stonebridge Ranch Exhibit" is (none) |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Times 1 | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Origin 1 | error | max(created_date) query failed |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Time Areas 1 | flag | layer "Drive Time Areas 1" is esriGeometryPolygon |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Times 2 | not-a-layer | no fields[] — unrecognized shape |
| denton-county-arcgis → Addresses911Permits_GC/911 Addresses | error | max(created_date) query failed |
| denton-county-arcgis → CityETJPermits_GC/City and ETJ | not-a-layer | no fields[] — unrecognized shape |
| denton-county-arcgis → CityETJPermits_GC/City Labels | flag | layer "City Labels" is esriGeometryPolygon |
| denton-county-arcgis → CityETJPermits_GC/ETJ Labels | flag | layer "ETJ Labels" is esriGeometryPolygon |
| denton-county-arcgis → CityETJPermits_GC/City and ETJ | flag | layer "City and ETJ" is esriGeometryPolygon |
| denton-county-arcgis → ContourPermits_GC/1 Foot Contours - 2017 | flag | layer "1 Foot Contours - 2017" is esriGeometryPolyline |
| denton-county-arcgis → ContourPermits_GC/2 Foot Contours - 2005 | flag | layer "2 Foot Contours - 2005" is esriGeometryPolyline |
| denton-county-arcgis → ContourPermits_GC/2 Foot Contours - LIDAR 2000 | flag | layer "2 Foot Contours - LIDAR 2000" is esriGeometryPolyline |
| denton-county-arcgis → DEV_Permits/Permits | still-stale | newest DateReceiv = 2023-06-09 (> 400d old) |
| jeffco-dcat → Zoning | flag | layer "Zoning" is esriGeometryPolygon |
| jeffco-dcat → Subdivision | flag | layer "Subdivision" is esriGeometryPolygon |
| adams-co-dcat → Zoning | flag | layer "Zoning" is esriGeometryPolygon |
| adams-co-dcat → Subdivisions | flag | layer "Subdivisions" is esriGeometryPolygon |
| adams-co-dcat → Advancing Adams Future Land Use 2022 | flag | layer "Advancing_Adams_FLU" is esriGeometryPolygon |
| boulder-city-dcat → BVCP Future Land Use | flag | layer "Future Land Use" is esriGeometryPolygon |
| boulder-city-dcat → BVCP Planning Area (I, II, III) | flag | layer "BVCP Areas" is esriGeometryPolygon |
| boulder-city-dcat → Zoning Districts | flag | layer "Zoning Districts" is esriGeometryPolygon |
| boulder-city-dcat → Development Review Cases | flag | layer "Development Review" is esriGeometryPolygon |
| fort-collins-hub-dcat → Zoning | flag | layer "City Zoning" is esriGeometryPolygon |
| fort-collins-hub-dcat → Current Development | flag | layer "Current Development" is esriGeometryPolygon |
| denver-dcat → South Platte River Glide Sites | flag | fields: OBJECTID, SITE, X_COORDINATE, Y_COORDINATE, STREAM_ID, HABITAT, GLOBALID… |
| denver-dcat → Subdivisions | flag | layer "ENG_SRVSUBDIVISIONS_A" is esriGeometryPolygon |
| denver-dcat → Tree Canopy Assessment 2013 - Land Use | flag | layer "PARK_TREECANOPY2013LU_A" is esriGeometryPolygon |
| denver-dcat → Wastewater Plat Map Index | flag | layer "PWWMD_IDX_PLATINDEX_A" is esriGeometryPolygon |
| denver-dcat → Development Review Areas | flag | layer "ADMN_DEVREVIEW_A" is esriGeometryPolygon |
| denver-dcat → Zoning | flag | layer "ZONE_ZONING_A" is esriGeometryPolygon |
| denver-dcat → Community Planning and Development Plan Areas | flag | layer "PLAN_AREAPLANS_A" is esriGeometryPolygon |
| denver-dcat → Site Development Plans | flag | layer "PLAN_SITEDEVPLANS_A" is esriGeometryPolygon |
| denver-dcat → Existing Land Use | flag | layer "PLAN_EXISTINGLANDUSE_A" is esriGeometryPolygon |
| denver-dcat → Public Works Development Services Projects | flag | fields: OBJECTID, PROJECT_ID, PROJECT_NAME, PROJECT_DESCR, DATE_ENTERED, FULL_ADDRESS, ADDRRESS_ID, GLOBALID… |
| springs-gis-root → GeneralUse/EconomicDevelopment/Foreign Trade Zones | flag | layer "Foreign Trade Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Urban Renewal Areas | flag | layer "Urban Renewal Areas" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Qualified Opportunity Zones | flag | layer "Qualified Opportunity Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Commercial Aeronautical Zones | flag | layer "Commercial Aeronautical Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Enterprise Zones | flag | layer "Enterprise Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/CHIPS Zones | flag | layer "CHIPS Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/PlanningAdmin/Signs | not-a-layer | no fields[] — unrecognized shape |
| springs-gis-root → GeneralUse/PlanningAdmin/Coordinated Sign Plans | flag | layer "Coordinated Sign Plans" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/PlanningAdmin/Electronic Message Centers | flag | layer "Electronic Message Centers" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/PlanningAdmin/Planning Areas | flag | layer "Planning Areas" is esriGeometryPolygon |

### Flagged shapes — what connector work each needs
- **allen-current-development-projects** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **el-paso-new-commercial** — statuses unknown to the lexicon: a human to extend scripts/source-lexicon.json with these VERBATIM statuses (only from a human-approved mapping)
- **houston-ckan** — CKAN catalog: a CKAN connector (generic connectors handle ArcGIS + Socrata only) — or wire the dataset directly if a distribution exposes an ArcGIS/Socrata API
- **houston-cohgis → HoustonMap/Landuse/Land Use (Grouped) ** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Restricted Lot Driveway Access** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Conservation Districts** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Green Corridor** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Prohibited Yard Parking Applications** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6556 BEFORE ASSIGNING ADDRESS** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **dallas-open-data → ROW Permits - Points (bw6g-a3ur)** — socrata resource missing: status, type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **dallas-open-data → ROW Permits - Lines (xd3q-ipis)** — socrata resource missing: status, type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **mckinney-arcgis → MapServices/DevelopmentExhibits/Custer West Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/DevelopmentExhibits/MTC Regulating Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/DevelopmentExhibits/Stonebridge Ranch Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Time Areas 1** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/City Labels** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/ETJ Labels** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/City and ETJ** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/1 Foot Contours - 2017** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/2 Foot Contours - 2005** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/2 Foot Contours - LIDAR 2000** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **jeffco-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **jeffco-dcat → Subdivision** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **adams-co-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **adams-co-dcat → Subdivisions** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **adams-co-dcat → Advancing Adams Future Land Use 2022** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → BVCP Future Land Use** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → BVCP Planning Area (I, II, III)** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → Zoning Districts** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → Development Review Cases** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **fort-collins-hub-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **fort-collins-hub-dcat → Current Development** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → South Platte River Glide Sites** — no date column: a human to identify the temporal column (none of the lexicon date candidates present)
- **denver-dcat → Subdivisions** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Tree Canopy Assessment 2013 - Land Use** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Wastewater Plat Map Index** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Development Review Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Community Planning and Development Plan Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Site Development Plans** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Existing Land Use** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Public Works Development Services Projects** — no date column: a human to identify the temporal column (none of the lexicon date candidates present)
- **springs-gis-root → GeneralUse/EconomicDevelopment/Foreign Trade Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Urban Renewal Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Qualified Opportunity Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Commercial Aeronautical Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Enterprise Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/CHIPS Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/PlanningAdmin/Coordinated Sign Plans** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/PlanningAdmin/Electronic Message Centers** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/PlanningAdmin/Planning Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point

## Run 2026-07-15T09:09:05.841Z

- Sources re-probed: **14** · discovery targets walked: **13** · candidates evaluated: **80**
- Auto-wired: **none**
- Flagged new shapes (connector work needed — never guessed): **51**
- Dev-backed ZIPs snapshot: **245** (Δ +77 vs last run)

| target | result | evidence |
|---|---|---|
| denton-county-dev-permits | still-stale | newest DateReceiv = 2023-06-09 (> 400d old) |
| mckinney-underconstruction | still-stale | newest IssueDate = 2023-09-26 (> 400d old) |
| frisco-active-building-permits | unreachable | HTTP 0 UND_ERR_CONNECT_TIMEOUT |
| frisco-active-zoning-sup-cases | unreachable | HTTP 0 UND_ERR_CONNECT_TIMEOUT |
| allen-current-development-projects | flag | layer "Current Development Projects" is esriGeometryPolygon |
| el-paso-new-commercial | flag | fresh (newest 2026-06-30); lexicon maps 5120/11322 rows; unmapped:   (4165); Revisions Required (2); Hold for Corrections (8); Out for Corrections (4); TCO Issued (67); Inspection (1956) |
| el-paso-accela-building-permits | error | service error 404: Service OpenData_Accela/BuildingPermits/MapServer not found  |
| dallas-building-permits-e7gq | still-stale | rowsUpdatedAt = 2020-08-30 (> 400d old) |
| dallas-building-permits-6ik7 | still-stale | rowsUpdatedAt = 2018-02-09 (> 400d old) |
| fort-worth-development-permits-gate-validation | already-wired | registry entry exists |
| denton-city-portal | still-dead | catalog HTTP 404 <!DOCTYPE html>
<!--[if IE 9]> <html lang="en" class="ie9"> <![endif]-->
<!--[if gt IE 8]><!--> <html lang="en"> <!--<![endif]-->
  <head>
    <meta charset="utf-8" />
      <meta name="generator" con |
| plano-portal | no-candidates | 1 first-party dataset(s) for q=permit but none matched the permit/land-use pattern (or all duplicate/already wired) |
| houston-ckan | flag | CKAN catalog with 4 permit-pattern dataset(s): Combustible Storage Permits (Waste or Dumpster Permits) Sold from May 2012 th...; City of Houston Active Commercial Vehicle Loading Zone Permits; City of Houston Residential Building Permits by Month and Year; All Paid Vehicle Permits 05/01/2011 to 04/3 |
| houston-cohgis → HoustonMap/Landuse/Land Use (Grouped)  | flag | layer "Land Use (Grouped) " is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Towers | still-stale | newest ActionDate = 2001-05-31 (> 400d old) |
| houston-cohgis → HoustonMap/Planning_and_Development/Schools Primary Entrance | still-stale | newest School_Status_Date = 2023-04-06 (> 400d old) |
| houston-cohgis → HoustonMap/Planning_and_Development/Restricted Lot Driveway Access | flag | layer "Restricted Lot Driveway Access" is esriGeometryPolyline |
| houston-cohgis → HoustonMap/Planning_and_Development/Conservation Districts | flag | layer "Conservation Districts" is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Green Corridor | flag | layer "Green Corridor" is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Prohibited Yard Parking Applications | flag | layer "Prohibited Yard Parking Applications" is esriGeometryPolygon |
| houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6556 BEFORE ASSIGNING ADDRESS | flag | layer "CALL 832-393-6556 BEFORE ASSIGNING ADDRESS" is esriGeometryPolygon |
| el-paso-open-data | unreachable | DCAT HTTP 0 ENOTFOUND |
| arlington-open-data | unreachable | DCAT HTTP 0 ENOTFOUND |
| dallas-open-data → Building Permits for Fiscal Year 2017 - 2018 (w2uy-zn9f) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2011 - 2012 (azf5-sdcr) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2013 - 2014 (fs84-rv8z) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2015 - 2016 (rzm4-tcqx) | still-stale | rowsUpdatedAt = 2021-07-29 (> 400d old) |
| dallas-open-data → ROW Permits - Points (bw6g-a3ur) | flag | updated 2026-07-11; columns: the_geom, objectid, jobid, externalfilenum, permittype, commercialorresidential, statusdescription, createddate, issuedate, completeddate, expirationdate, rowrequestedstartdate, rowestimatedcompletiondate, warrantyexpiration, rowreasonforjob… |
| dallas-open-data → Jill SRF 14 08 Permit W Location (4xqw-i3tz) | still-stale | rowsUpdatedAt = 2014-11-04 (> 400d old) |
| dallas-open-data → ROW Permits - Lines (xd3q-ipis) | flag | updated 2026-07-11; columns: the_geom, objectid, jobid, externalfilenum, permittype, commercialorresidential, statusdescription, createddate, issuedate, completeddate, expirationdate, rowrequestedstartdate, rowestimatedcompletiondate, warrantyexpiration, rowreasonforjob… |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Custer West Exhibit | flag | layer "Custer West Exhibit" is (none) |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Craig Ranch Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Honey Creek Investment District Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Huntington Park Land Use Plan Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/MTC Regulating Exhibit | flag | layer "MTC Regulating Exhibit" is (none) |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Stonebridge Ranch Exhibit | flag | layer "Stonebridge Ranch Exhibit" is (none) |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Times 1 | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Origin 1 | error | max(created_date) query failed |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Time Areas 1 | flag | layer "Drive Time Areas 1" is esriGeometryPolygon |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Times 2 | not-a-layer | no fields[] — unrecognized shape |
| denton-county-arcgis → Addresses911Permits_GC/911 Addresses | error | max(created_date) query failed |
| denton-county-arcgis → CityETJPermits_GC/City and ETJ | not-a-layer | no fields[] — unrecognized shape |
| denton-county-arcgis → CityETJPermits_GC/City Labels | flag | layer "City Labels" is esriGeometryPolygon |
| denton-county-arcgis → CityETJPermits_GC/ETJ Labels | flag | layer "ETJ Labels" is esriGeometryPolygon |
| denton-county-arcgis → CityETJPermits_GC/City and ETJ | flag | layer "City and ETJ" is esriGeometryPolygon |
| denton-county-arcgis → ContourPermits_GC/1 Foot Contours - 2017 | flag | layer "1 Foot Contours - 2017" is esriGeometryPolyline |
| denton-county-arcgis → ContourPermits_GC/2 Foot Contours - 2005 | flag | layer "2 Foot Contours - 2005" is esriGeometryPolyline |
| denton-county-arcgis → ContourPermits_GC/2 Foot Contours - LIDAR 2000 | flag | layer "2 Foot Contours - LIDAR 2000" is esriGeometryPolyline |
| denton-county-arcgis → DEV_Permits/Permits | still-stale | newest DateReceiv = 2023-06-09 (> 400d old) |
| jeffco-dcat → Zoning | flag | layer "Zoning" is esriGeometryPolygon |
| jeffco-dcat → Subdivision | flag | layer "Subdivision" is esriGeometryPolygon |
| adams-co-dcat → Zoning | flag | layer "Zoning" is esriGeometryPolygon |
| adams-co-dcat → Subdivisions | flag | layer "Subdivisions" is esriGeometryPolygon |
| adams-co-dcat → Advancing Adams Future Land Use 2022 | flag | layer "Advancing_Adams_FLU" is esriGeometryPolygon |
| boulder-city-dcat → BVCP Future Land Use | flag | layer "Future Land Use" is esriGeometryPolygon |
| boulder-city-dcat → BVCP Planning Area (I, II, III) | flag | layer "BVCP Areas" is esriGeometryPolygon |
| boulder-city-dcat → Zoning Districts | flag | layer "Zoning Districts" is esriGeometryPolygon |
| boulder-city-dcat → Development Review Cases | flag | layer "Development Review" is esriGeometryPolygon |
| fort-collins-hub-dcat → Zoning | flag | layer "City Zoning" is esriGeometryPolygon |
| fort-collins-hub-dcat → Current Development | flag | layer "Current Development" is esriGeometryPolygon |
| denver-dcat → South Platte River Glide Sites | flag | fields: OBJECTID, SITE, X_COORDINATE, Y_COORDINATE, STREAM_ID, HABITAT, GLOBALID… |
| denver-dcat → Subdivisions | flag | layer "ENG_SRVSUBDIVISIONS_A" is esriGeometryPolygon |
| denver-dcat → Tree Canopy Assessment 2013 - Land Use | flag | layer "PARK_TREECANOPY2013LU_A" is esriGeometryPolygon |
| denver-dcat → Wastewater Plat Map Index | flag | layer "PWWMD_IDX_PLATINDEX_A" is esriGeometryPolygon |
| denver-dcat → Development Review Areas | flag | layer "ADMN_DEVREVIEW_A" is esriGeometryPolygon |
| denver-dcat → Community Planning and Development Plan Areas | flag | layer "PLAN_AREAPLANS_A" is esriGeometryPolygon |
| denver-dcat → Zoning | flag | layer "ZONE_ZONING_A" is esriGeometryPolygon |
| denver-dcat → Existing Landuse 2020 | flag | layer "PLAN_EXISTINGLANDUSE2020_A" is esriGeometryPolygon |
| denver-dcat → Existing Landuse 2018 | flag | layer "PLAN_EXISTINGLANDUSE2018_A" is esriGeometryPolygon |
| denver-dcat → City and County of Denver Subdivision Lot Boundaries | flag | layer "ENG_SRVLOTS_A" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Foreign Trade Zones | flag | layer "Foreign Trade Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Urban Renewal Areas | flag | layer "Urban Renewal Areas" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Qualified Opportunity Zones | flag | layer "Qualified Opportunity Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Commercial Aeronautical Zones | flag | layer "Commercial Aeronautical Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Enterprise Zones | flag | layer "Enterprise Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/CHIPS Zones | flag | layer "CHIPS Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/PlanningAdmin/Signs | not-a-layer | no fields[] — unrecognized shape |
| springs-gis-root → GeneralUse/PlanningAdmin/Coordinated Sign Plans | flag | layer "Coordinated Sign Plans" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/PlanningAdmin/Electronic Message Centers | flag | layer "Electronic Message Centers" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/PlanningAdmin/Planning Areas | flag | layer "Planning Areas" is esriGeometryPolygon |

### Flagged shapes — what connector work each needs
- **allen-current-development-projects** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **el-paso-new-commercial** — statuses unknown to the lexicon: a human to extend scripts/source-lexicon.json with these VERBATIM statuses (only from a human-approved mapping)
- **houston-ckan** — CKAN catalog: a CKAN connector (generic connectors handle ArcGIS + Socrata only) — or wire the dataset directly if a distribution exposes an ArcGIS/Socrata API
- **houston-cohgis → HoustonMap/Landuse/Land Use (Grouped) ** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Restricted Lot Driveway Access** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Conservation Districts** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Green Corridor** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Prohibited Yard Parking Applications** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6556 BEFORE ASSIGNING ADDRESS** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **dallas-open-data → ROW Permits - Points (bw6g-a3ur)** — socrata resource missing: status, type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **dallas-open-data → ROW Permits - Lines (xd3q-ipis)** — socrata resource missing: status, type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **mckinney-arcgis → MapServices/DevelopmentExhibits/Custer West Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/DevelopmentExhibits/MTC Regulating Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/DevelopmentExhibits/Stonebridge Ranch Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Time Areas 1** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/City Labels** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/ETJ Labels** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/City and ETJ** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/1 Foot Contours - 2017** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/2 Foot Contours - 2005** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/2 Foot Contours - LIDAR 2000** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **jeffco-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **jeffco-dcat → Subdivision** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **adams-co-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **adams-co-dcat → Subdivisions** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **adams-co-dcat → Advancing Adams Future Land Use 2022** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → BVCP Future Land Use** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → BVCP Planning Area (I, II, III)** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → Zoning Districts** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → Development Review Cases** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **fort-collins-hub-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **fort-collins-hub-dcat → Current Development** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → South Platte River Glide Sites** — no date column: a human to identify the temporal column (none of the lexicon date candidates present)
- **denver-dcat → Subdivisions** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Tree Canopy Assessment 2013 - Land Use** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Wastewater Plat Map Index** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Development Review Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Community Planning and Development Plan Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Existing Landuse 2020** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Existing Landuse 2018** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → City and County of Denver Subdivision Lot Boundaries** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Foreign Trade Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Urban Renewal Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Qualified Opportunity Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Commercial Aeronautical Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Enterprise Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/CHIPS Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/PlanningAdmin/Coordinated Sign Plans** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/PlanningAdmin/Electronic Message Centers** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/PlanningAdmin/Planning Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point

## Run 2026-07-16T09:12:36.881Z

- Sources re-probed: **18** · discovery targets walked: **44** · candidates evaluated: **204**
- Auto-wired: **none**
- Flagged new shapes (connector work needed — never guessed): **151**
- Dev-backed ZIPs snapshot: **unavailable**

| target | result | evidence |
|---|---|---|
| denton-county-dev-permits | still-stale | newest DateReceiv = 2023-06-09 (> 400d old) |
| mckinney-underconstruction | still-stale | newest IssueDate = 2023-09-26 (> 400d old) |
| frisco-active-building-permits | unreachable | HTTP 0 UND_ERR_CONNECT_TIMEOUT |
| frisco-active-zoning-sup-cases | unreachable | HTTP 0 UND_ERR_CONNECT_TIMEOUT |
| allen-current-development-projects | flag | layer "Current Development Projects" is esriGeometryPolygon |
| el-paso-new-commercial | flag | fresh (newest 2026-06-30); lexicon maps 5120/11322 rows; unmapped:   (4165); Revisions Required (2); Hold for Corrections (8); Out for Corrections (4); TCO Issued (67); Inspection (1956) |
| el-paso-accela-building-permits | error | service error 404: Service OpenData_Accela/BuildingPermits/MapServer not found  |
| dallas-building-permits-e7gq | still-stale | rowsUpdatedAt = 2020-08-30 (> 400d old) |
| dallas-building-permits-6ik7 | still-stale | rowsUpdatedAt = 2018-02-09 (> 400d old) |
| fort-worth-development-permits-gate-validation | already-wired | registry entry exists |
| denton-city-portal | still-dead | catalog HTTP 404 <!DOCTYPE html>
<!--[if IE 9]> <html lang="en" class="ie9"> <![endif]-->
<!--[if gt IE 8]><!--> <html lang="en"> <!--<![endif]-->
  <head>
    <meta charset="utf-8" />
      <meta name="generator" con |
| plano-portal | no-candidates | 1 first-party dataset(s) for q=permit but none matched the permit/land-use pattern (or all duplicate/already wired) |
| stpaul-approved-building-permits | flag | fresh (newest 2025-06-30); address field: ADDRESS |
| worcester-building-permits | flag | layer "Building_Permits" is (none) |
| syracuse-permit-requests | flag | fresh (newest 2025-08-16) but no lexicon status column among: Permit_Number, Full_Address, Owner, Issue_Date, Permit_Type, Description_of_Work, LONG, LAT, ObjectId |
| howard-county-permits | flag | updated 2025-12-04; columns: permit_number, category, type, file_date, permit_type, census_tract, issue_date, city, zip, sewer, water… |
| houston-ckan | flag | CKAN catalog with 4 permit-pattern dataset(s): Combustible Storage Permits (Waste or Dumpster Permits) Sold from May 2012 th...; City of Houston Active Commercial Vehicle Loading Zone Permits; City of Houston Residential Building Permits by Month and Year; All Paid Vehicle Permits 05/01/2011 to 04/3 |
| houston-cohgis → HoustonMap/Landuse/Land Use (Grouped)  | flag | layer "Land Use (Grouped) " is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Towers | still-stale | newest ActionDate = 2001-05-31 (> 400d old) |
| houston-cohgis → HoustonMap/Planning_and_Development/Schools Primary Entrance | still-stale | newest School_Status_Date = 2023-04-06 (> 400d old) |
| houston-cohgis → HoustonMap/Planning_and_Development/Restricted Lot Driveway Access | flag | layer "Restricted Lot Driveway Access" is esriGeometryPolyline |
| houston-cohgis → HoustonMap/Planning_and_Development/Conservation Districts | flag | layer "Conservation Districts" is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Green Corridor | flag | layer "Green Corridor" is esriGeometryPolygon |
| houston-cohgis → HoustonMap/Planning_and_Development/Prohibited Yard Parking Applications | flag | layer "Prohibited Yard Parking Applications" is esriGeometryPolygon |
| houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6582 BEFORE ASSIGNING ADDRESS | flag | layer "CALL 832-393-6582 BEFORE ASSIGNING ADDRESS" is esriGeometryPolygon |
| houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6582 BEFORE ASSIGNING ADDRESS | flag | layer "CALL 832-393-6582 BEFORE ASSIGNING ADDRESS" is esriGeometryPolygon |
| houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6556 BEFORE ASSIGNING ADDRESS | flag | layer "CALL 832-393-6556 BEFORE ASSIGNING ADDRESS" is esriGeometryPolygon |
| el-paso-open-data | unreachable | DCAT HTTP 0 ENOTFOUND |
| arlington-open-data | unreachable | DCAT HTTP 0 ENOTFOUND |
| dallas-open-data → Building Permits for Fiscal Year 2011 - 2012 (azf5-sdcr) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2017 - 2018 (w2uy-zn9f) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2013 - 2014 (fs84-rv8z) | still-stale | rowsUpdatedAt = 2020-04-15 (> 400d old) |
| dallas-open-data → Building Permits for Fiscal Year 2015 - 2016 (rzm4-tcqx) | still-stale | rowsUpdatedAt = 2021-07-29 (> 400d old) |
| dallas-open-data → ROW Permits - Points (bw6g-a3ur) | flag | updated 2026-07-11; columns: the_geom, objectid, jobid, externalfilenum, permittype, commercialorresidential, statusdescription, createddate, issuedate, completeddate, expirationdate, rowrequestedstartdate, rowestimatedcompletiondate, warrantyexpiration, rowreasonforjob… |
| dallas-open-data → Jill SRF 14 08 Permit W Location (4xqw-i3tz) | still-stale | rowsUpdatedAt = 2014-11-04 (> 400d old) |
| dallas-open-data → ROW Permits - Lines (xd3q-ipis) | flag | updated 2026-07-11; columns: the_geom, objectid, jobid, externalfilenum, permittype, commercialorresidential, statusdescription, createddate, issuedate, completeddate, expirationdate, rowrequestedstartdate, rowestimatedcompletiondate, warrantyexpiration, rowreasonforjob… |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Custer West Exhibit | flag | layer "Custer West Exhibit" is (none) |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Craig Ranch Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Honey Creek Investment District Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Huntington Park Land Use Plan Exhibit | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/DevelopmentExhibits/MTC Regulating Exhibit | flag | layer "MTC Regulating Exhibit" is (none) |
| mckinney-arcgis → MapServices/DevelopmentExhibits/Stonebridge Ranch Exhibit | flag | layer "Stonebridge Ranch Exhibit" is (none) |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Times 1 | not-a-layer | no fields[] — unrecognized shape |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Origin 1 | error | max(created_date) query failed |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Time Areas 1 | flag | layer "Drive Time Areas 1" is esriGeometryPolygon |
| mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Times 2 | not-a-layer | no fields[] — unrecognized shape |
| denton-county-arcgis → Addresses911Permits_GC/911 Addresses | error | max(created_date) query failed |
| denton-county-arcgis → CityETJPermits_GC/City and ETJ | not-a-layer | no fields[] — unrecognized shape |
| denton-county-arcgis → CityETJPermits_GC/City Labels | flag | layer "City Labels" is esriGeometryPolygon |
| denton-county-arcgis → CityETJPermits_GC/ETJ Labels | flag | layer "ETJ Labels" is esriGeometryPolygon |
| denton-county-arcgis → CityETJPermits_GC/City and ETJ | flag | layer "City and ETJ" is esriGeometryPolygon |
| denton-county-arcgis → ContourPermits_GC/1 Foot Contours - 2017 | flag | layer "1 Foot Contours - 2017" is esriGeometryPolyline |
| denton-county-arcgis → ContourPermits_GC/2 Foot Contours - 2005 | flag | layer "2 Foot Contours - 2005" is esriGeometryPolyline |
| denton-county-arcgis → ContourPermits_GC/2 Foot Contours - LIDAR 2000 | flag | layer "2 Foot Contours - LIDAR 2000" is esriGeometryPolyline |
| denton-county-arcgis → DEV_Permits/Permits | still-stale | newest DateReceiv = 2023-06-09 (> 400d old) |
| jeffco-dcat → Zoning | flag | layer "Zoning" is esriGeometryPolygon |
| jeffco-dcat → Subdivision | flag | layer "Subdivision" is esriGeometryPolygon |
| adams-co-dcat → Zoning | flag | layer "Zoning" is esriGeometryPolygon |
| adams-co-dcat → Subdivisions | flag | layer "Subdivisions" is esriGeometryPolygon |
| adams-co-dcat → Advancing Adams Future Land Use 2022 | flag | layer "Advancing_Adams_FLU" is esriGeometryPolygon |
| boulder-city-dcat → BVCP Future Land Use | flag | layer "Future Land Use" is esriGeometryPolygon |
| boulder-city-dcat → BVCP Planning Area (I, II, III) | flag | layer "BVCP Areas" is esriGeometryPolygon |
| boulder-city-dcat → Zoning Districts | flag | layer "Zoning Districts" is esriGeometryPolygon |
| boulder-city-dcat → Development Review Cases | flag | layer "Development Review" is esriGeometryPolygon |
| fort-collins-hub-dcat → Zoning | flag | layer "City Zoning" is esriGeometryPolygon |
| fort-collins-hub-dcat → Current Development | flag | layer "Current Development" is esriGeometryPolygon |
| denver-dcat → South Platte River Glide Sites | flag | fields: OBJECTID, SITE, X_COORDINATE, Y_COORDINATE, STREAM_ID, HABITAT, GLOBALID… |
| denver-dcat → Subdivisions | flag | layer "ENG_SRVSUBDIVISIONS_A" is esriGeometryPolygon |
| denver-dcat → Tree Canopy Assessment 2013 - Land Use | flag | layer "PARK_TREECANOPY2013LU_A" is esriGeometryPolygon |
| denver-dcat → Wastewater Plat Map Index | flag | layer "PWWMD_IDX_PLATINDEX_A" is esriGeometryPolygon |
| denver-dcat → Sewer Use and Drainage Permit Reviewer Areas | flag | layer "ADMN_SUDPREVIEWAREAS_A" is esriGeometryPolygon |
| denver-dcat → Development Review Areas | flag | layer "ADMN_DEVREVIEW_A" is esriGeometryPolygon |
| denver-dcat → Community Planning and Development Plan Areas | flag | layer "PLAN_AREAPLANS_A" is esriGeometryPolygon |
| denver-dcat → Zoning | flag | layer "ZONE_ZONING_A" is esriGeometryPolygon |
| denver-dcat → Site Development Plans | flag | layer "PLAN_SITEDEVPLANS_A" is esriGeometryPolygon |
| denver-dcat → Existing Land Use | flag | layer "PLAN_EXISTINGLANDUSE_A" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Foreign Trade Zones | flag | layer "Foreign Trade Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Urban Renewal Areas | flag | layer "Urban Renewal Areas" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Qualified Opportunity Zones | flag | layer "Qualified Opportunity Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Commercial Aeronautical Zones | flag | layer "Commercial Aeronautical Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/Enterprise Zones | flag | layer "Enterprise Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/EconomicDevelopment/CHIPS Zones | flag | layer "CHIPS Zones" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/PlanningAdmin/Signs | not-a-layer | no fields[] — unrecognized shape |
| springs-gis-root → GeneralUse/PlanningAdmin/Coordinated Sign Plans | flag | layer "Coordinated Sign Plans" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/PlanningAdmin/Electronic Message Centers | flag | layer "Electronic Message Centers" is esriGeometryPolygon |
| springs-gis-root → GeneralUse/PlanningAdmin/Planning Areas | flag | layer "Planning Areas" is esriGeometryPolygon |
| sandiego-city-dcat | unreachable | DCAT HTTP 404 <html>
<head><title>404 Not Found</title></head>
<body>
<h1>404 Not Found</h1>
<ul>
<li>Code: NoSuchKey</li>
<li>Message: The specified key does not exist.</li>
<li>Key: data.json</li>
<li>RequestId:  |
| sandiego-county-arcgis | no-candidates | 61 services listed; none match the permit/land-use pattern |
| sanjose-ckan | flag | CKAN catalog with 7 permit-pattern dataset(s): Active Building Permits; Expired Building Permits; Last 30 days Planning Permits; Last 30 days building permits; Residential Parking Permit (RPP) Zones |
| santaclara-county-socrata → County of Santa Clara Permitted Body Art Facilities and Permitted Body Art Practitioners (mqx2-w62f) | flag | updated 2026-07-16; columns: facility_name, permit_type, site_address, city, zip, permitexpdate, facility_id, geo_address… |
| santaclara-county-socrata → County of Santa Clara Active Body Art Facilities and Permitted Body Art Practitioners (jwgu-xsep) | still-stale | rowsUpdatedAt = 2018-11-27 (> 400d old) |
| sunnyvale-arcgis-hub | unreachable | DCAT HTTP 0 UND_ERR_CONNECT_TIMEOUT |
| oakland-socrata → Residential Parking Permit Zones (su5x-2u99) | still-stale | rowsUpdatedAt = 2019-09-03 (> 400d old) |
| alameda-county-socrata | still-dead | catalog HTTP 404 <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/catalog/v1</pre>
</body>
</html>
 |
| orange-county-arcgis | no-candidates | 67 services listed; none match the permit/land-use pattern |
| anaheim-dcat → Workforce Development Board | flag | layer "Workforce_Development_Board_Public" is (none) |
| anaheim-dcat → Planning Commission | flag | layer "Planning_Commission_Public" is (none) |
| anaheim-dcat → Housing and Community Development Commission | flag | layer "Housing_and_Community_Development_Commission_Public" is (none) |
| anaheim-dcat → Hotel Permits | flag | layer "Hotel_Permits_Monthly" is (none) |
| anaheim-dcat → Fire Permits Accela | flag | layer "Fire_Permits__Accela_Test" is (none) |
| anaheim-dcat → Utilities Electrical Permits Monthly | flag | layer "Utilities_Electrical_Permits_Monthly_Accela_Test" is (none) |
| anaheim-dcat → Open Data Land Use Permits | flag | layer "Open_Data_Land_Use_Permits" is (none) |
| anaheim-dcat → Zoning | flag | layer "Zoning" is esriGeometryPolygon |
| anaheim-dcat → General Plan Land Use | flag | layer "General Plan Land Use" is esriGeometryPolygon |
| anaheim-dcat → Existing Land Use | flag | layer "Existing Land Use" is esriGeometryPolygon |
| contracosta-county-arcgis → _Authoritative/Zoning/PLA_DCD_Zoning | flag | layer "PLA_DCD_Zoning" is esriGeometryPolygon |
| contracosta-county-arcgis → _Authoritative/Zoning/PLA_DCD_Zoning | flag | layer "PLA_DCD_Zoning" is esriGeometryPolygon |
| sonoma-county-socrata → Sonoma County Planning Permits (m689-iiuu) | flag | updated 2026-07-15; columns: file, status, application_type, started, address, description, parcel, sub_type… |
| sonoma-county-socrata → Sonoma County Rebuilding Permits (652y-5ihx) | flag | updated 2026-06-15; columns: record_id, date_opened, record_type, permit_status, category, permit_description, units, buildings, total_square_feet, situs_address, area_id, supervisors_district, event_title, first_inspection_date, parcel_number… |
| sonoma-county-socrata → Sonoma County Construction Permits (88ms-k5e7) | flag | updated 2026-07-15; columns: file_number, status, application_type, started, issued, address, description, assessors_parcel_number, totfee, value… |
| ventura-county-arcgis → DataDownloads/LandUse/Area plans | flag | layer "Area plans" is esriGeometryPolygon |
| ventura-county-arcgis → DataDownloads/LandUse/General Plan | flag | layer "General Plan" is esriGeometryPolygon |
| ventura-county-arcgis → DataDownloads/LandUse/Zone Designation | flag | layer "Zone Designation" is esriGeometryPolygon |
| ventura-county-arcgis → DataDownloads/LandUse/Area plans | flag | layer "Area plans" is esriGeometryPolygon |
| ventura-county-arcgis → DataDownloads/LandUse/General Plan | flag | layer "General Plan" is esriGeometryPolygon |
| ventura-county-arcgis → DataDownloads/LandUse/Zone Designation | flag | layer "Zone Designation" is esriGeometryPolygon |
| ventura-county-arcgis → DataDownloads/Permitting/Communication Facilities | still-stale | newest created_date = 2025-01-10 (> 400d old) |
| ventura-county-arcgis → DataDownloads/Permitting/Mining Permits | flag | layer "Mining Permits" is esriGeometryPolygon |
| ventura-county-arcgis → DataDownloads/Permitting/Oil Permits | flag | layer "Oil Permits" is esriGeometryPolygon |
| ventura-county-arcgis → DataDownloads/Permitting/Communication Facilities | still-stale | newest created_date = 2025-01-10 (> 400d old) |
| sanmateo-county-socrata | no-candidates | catalog reachable but 0 first-party datasets for q=permit (3 federated hits ignored — the Plano trap) |
| slo-county-dcat → General Plan Land Use Designations | flag | layer "General Plan Land Use Designations" is esriGeometryPolygon |
| slo-county-dcat → Completed Water Well Construction Permit Inventory Since 1965 | flag | layer "Completed Water Well Construction Permit Inventory Since 1965" is (none) |
| slo-county-dcat → Land Use View | no-candidates | no ArcGIS/Socrata distribution |
| slo-county-dcat → Planning Special Study Areas | flag | layer "Planning Special Study Areas" is esriGeometryPolygon |
| slo-county-dcat → Planning Land Use By Parcel | error | service error 404: Layer not found |
| slo-county-dcat → Planning Areas | flag | layer "Planning Areas" is esriGeometryPolygon |
| slo-county-dcat → Planning Area Standards | flag | layer "Planning Area Standards" is esriGeometryPolygon |
| marin-county-socrata | unreachable | catalog HTTP 200 non-JSON response |
| phoenix-ckan | flag | CKAN catalog with 2 permit-pattern dataset(s): Phoenix, AZ Building Permit Data; Proposed Zoning |
| mesa-socrata → Building Permits (RETIRED) (2gkz-7z4f) | flag | updated 2026-01-07; columns: rowid, permit_number, property_address, street_number, street_direction, street_name, street_type, unit_number, council_district, issued_date, issued_year, issued_month, finaled_date, finaled_year, finaled_month… |
| mesa-socrata → Building Permits (dzpk-hxfb) | flag | updated 2026-07-15; columns: rowid, permit_number, property_address, street_number, street_direction, street_name, street_type, unit_num, council_district, fiscal_year, issued_date, issued_year, issued_month, finaled_date, finaled_year… |
| mesa-socrata → Turn Around Time - Permits (fhtq-vpmm) | flag | updated 2026-07-15; columns: record_id, customid, record_type, record_open_date, record_status, statusdate, task, istaskcompleted, assigneddate, taskstatus, duedate, actionbyuser, status_year, status_month, turnaroundtime… |
| mesa-socrata → Temporary Traffic Control (TTC) Permits (822f-avdk) | flag | updated 2026-07-16; columns: rownum, record_id, customid, company, company_name, businessname, address_line1, application_date, review_date, calendardays, days_in_review, plan_review_days, status_date, record_status, received_date… |
| mesa-socrata → Development Services - Permit Submittals and Resubmittals Logged In (kg7m-y6f3) | flag | updated 2026-07-15; columns: row_number, record_id, record_type, type_of_submittal, record_open_date, record_open_date_month, record_open_date_year, record_status, record_status_date, record_status_month, record_status_year, task, task_complete_flag, description, status… |
| mesa-socrata → Planning - Board of Adjustment (BOA) Memos completed (qmv6-zhfq) | flag | updated 2026-07-11; columns: rowid, record_id, record_type, submittal_date, submission_deadline_date, distributed_date, review_consolidation_date, formal_submittal_deadline_date, permit_description, record_open_date, record_status_date, record_status_month, record_status_year, record_status, task… |
| mesa-socrata → DSD - Planning & Zoning and Design Review Memos Completion (u5a9-tj5y) | flag | updated 2026-07-16; columns: rowid, record_id, record_type, permit_description, record_open_date, record_status_date, record_status, submission_deadline_date, distributed_date, formal_submittal_deadline_date, review_consolidation_date, task, task_status, record_status_month, record_status_year… |
| tempe-socrata | still-dead | catalog HTTP 404 <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/catalog/v1</pre>
</body>
</html>
 |
| gilbert-socrata | still-dead | catalog HTTP 404 <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/catalog/v1</pre>
</body>
</html>
 |
| chandler-dcat | unreachable | DCAT HTTP 404 
<!doctype html>
<html lang="en-US">
	<head>
  <meta charset="utf-8">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  < |
| scottsdale-dcat → Planning and Development Plan Reviews | flag | layer "Plan Reviews" is (none) |
| scottsdale-dcat → Planning and Development Encroachment Permits | flag | layer "Encroachment Permits" is (none) |
| scottsdale-dcat → Planning and Development Cases | flag | layer "Cases" is (none) |
| scottsdale-dcat → Planning and Development Case Meetings | flag | layer "Case Meetings" is (none) |
| scottsdale-dcat → Planning and Development Building Permits | flag | layer "Building Permits" is (none) |
| scottsdale-dcat → Planning and Development Code Violations | flag | layer "Code Violations" is (none) |
| scottsdale-dcat → Zoning | flag | layer "Zoning" is esriGeometryPolygon |
| scottsdale-dcat → Subdivisions | flag | layer "Subdivisions" is esriGeometryPolygon |
| maricopa-county-arcgis → GIO/PermitHistory/Permit (Point) | flag | fresh (newest 2026-01-23) but no lexicon status column among: OBJECTID, Name, Description, CreatedDate |
| maricopa-county-arcgis → GIO/PermitHistory/Permit (Line) | flag | layer "Permit (Line)" is esriGeometryPolyline |
| maricopa-county-arcgis → GIO/PermitHistory/Permit (Polygon) | flag | layer "Permit (Polygon)" is esriGeometryPolygon |
| maricopa-county-arcgis → GIO/PermitHistory/Permit History (Point) | flag | fresh (newest 2026-07-15) but no lexicon status column among: OBJECTID, ModuleName, CaseID, CaseNumber, CaseType, WorkClass, ApplicationDate, ProjectID, ProjectName, GISHistoryQueueID, SpatialType, SpatialID |
| maricopa-county-arcgis → GIO/PermitHistory/Permit History (Line) | flag | layer "Permit History (Line)" is esriGeometryPolyline |
| maricopa-county-arcgis → GIO/PermitHistory/Permit History (Polygon) | flag | layer "Permit History (Polygon)" is esriGeometryPolygon |
| maricopa-county-arcgis → GIO/PermitHistory/Permit (Point) | flag | fresh (newest 2026-01-23) but no lexicon status column among: OBJECTID, Name, Description, CreatedDate, SHAPE |
| maricopa-county-arcgis → GIO/PermitHistory/Permit (Line) | flag | layer "Permit (Line)" is esriGeometryPolyline |
| maricopa-county-arcgis → GIO/PermitHistory/Permit (Polygon) | flag | layer "Permit (Polygon)" is esriGeometryPolygon |
| maricopa-county-arcgis → GIO/PermitHistory/Permit History (Point) | flag | fresh (newest 2026-07-15) but no lexicon status column among: OBJECTID, ModuleName, CaseID, CaseNumber, CaseType, WorkClass, ApplicationDate, ProjectID, ProjectName, GISHistoryQueueID, SpatialType, SpatialID, SHAPE |
| tucson-dcat → Zoning - Tucson - Open Data | flag | layer "ZONE_COT" is esriGeometryPolygon |
| tucson-dcat → Redevelopment Plans - Open Data | flag | layer "ZZ_PLAN_REDEV" is esriGeometryPolygon |
| tucson-dcat → Original City Zoning - Open Data | flag | layer "ZONE_OCZ" is esriGeometryPolygon |
| tucson-dcat → Subdivisions - Open Data | flag | layer "SUBDIV" is esriGeometryPolygon |
| tucson-dcat → Rezonings - Open Data | flag | layer "AREA_ZONE_VIEW" is esriGeometryPolygon |
| tucson-dcat → Mapped Planned Land Use - Open Data | flag | layer "PLAN_MAPPED_LAND_USE" is esriGeometryPolygon |
| pima-county-arcgis | unreachable | root HTTP 404 <?xml version="1.0" encoding="iso-8859-1"?>

     



<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http |
| montgomery-county-socrata → Residential Permit (m88u-pqki) | flag | updated 2026-07-16; columns: permitno, status, stno, stname, suffix, postdir, city, state, zip, addeddate, issueddate, finaleddate, buildingarea, declaredvaluation, description… |
| montgomery-county-socrata → Commercial Permits (i26v-w6bd) | flag | updated 2026-07-16; columns: permitno, status, stno, predir, stname, suffix, postdir, city, state, zip, addeddate, issueddate, finaleddate, buildingarea, declaredvaluation… |
| montgomery-county-socrata → Mechanical Permits (ih88-a6aa) | flag | updated 2026-07-16; columns: permitno, status, stno, pre_direction, stname, suffix, postdir, city, state, zip, worktype, usecode, addeddate, issueddate, finaleddate… |
| montgomery-county-socrata → Electrical Building Permits (qxie-8qnp) | flag | updated 2026-07-16; columns: permitno, status, stno, predir, stname, suffix, postdir, city, state, zip, worktype, usecode, addeddate, issueddate, finaleddate… |
| montgomery-county-socrata → Demolition Permits (b6ht-fw3x) | flag | updated 2026-07-16; columns: permitno, status, stno, predir, stname, suffix, postdir, city, state, zip, worktype, usecode, addeddate, issueddate, finaleddate… |
| montgomery-county-socrata → DPS - Antenna/Wireless Permits (djk9-h36c) | flag | updated 2026-07-16; columns: permit_number, permit_status, added_date, issue_date, final_date, tfcg_number, attachment_type, ozah, street_number, pre_direction, street_name, street_suffix, post_direction, city, state… |
| montgomery-county-socrata → Fence Permits (9quz-avmj) | flag | updated 2026-07-16; columns: application_type, permit_number, work_type, user_code, added_date, issue_date, final_date, expired_date, status, building_area, description_of_work, street_number, pre_direction, street_name, street_suffix… |
| montgomery-county-socrata → Sign Permits (piic-h4rw) | flag | updated 2026-07-15; columns: application_type, permit_no, work_type, use_code, added_date, issued_date, final_date, expired_date, status, building_area, description, st_no, pre_dir, st_name, suffix… |
| howard-county-socrata → Office of Consumer Protection Permits And Licenses (9rfk-bak7) | still-stale | rowsUpdatedAt = 2024-12-03 (> 400d old) |
| annearundel-arcgis → Hosted/2040_Land_Use_Changes/LU2040 Consistency Changes | flag | layer "LU2040 Consistency Changes" is esriGeometryPolygon |
| annearundel-arcgis → Hosted/2040_Land_Use_Changes/LU2040 Consistency Changes Dissolved | flag | layer "LU2040 Consistency Changes Dissolved" is esriGeometryPolygon |
| annearundel-arcgis → Hosted/Development_Policy_Area_Overlays_PreliminaryDraft/Development_Policy_Area_Overlays_PreliminaryDraft | flag | layer "Development_Policy_Area_Overlays_PreliminaryDraft" is esriGeometryPolygon |
| annearundel-arcgis → Hosted/Development_Policy_Areas_and_Overlay_Areas_WFL1/Overlay Areas | flag | layer "Overlay Areas" is esriGeometryPolygon |
| annearundel-arcgis → Hosted/Development_Policy_Areas_and_Overlay_Areas_WFL1/Major_Roads | flag | layer "Major_Roads" is esriGeometryPolyline |
| annearundel-arcgis → Hosted/Development_Policy_Areas_and_Overlay_Areas_WFL1/City of Annapolis | flag | layer "City of Annapolis" is esriGeometryPolygon |
| annearundel-arcgis → Hosted/Development_Policy_Areas_and_Overlay_Areas_WFL1/Policy Areas | flag | layer "Policy Areas" is esriGeometryPolygon |
| annearundel-arcgis → Hosted/Development_Policy_Areas_Overlays_12042020/Development_Policy_Areas_Overlays_12042020 | flag | layer "Development_Policy_Areas_Overlays_12042020" is esriGeometryPolygon |
| annearundel-arcgis → Hosted/Development_Policy_Areas/Development Policy Areas | flag | layer "Development Policy Areas" is esriGeometryPolygon |
| annearundel-arcgis → Hosted/GDP_Land_Use_Plan2040_May_2023/GDP_LandUse_Plan_2040_Update2023_04252023 | flag | layer "GDP_LandUse_Plan_2040_Update2023_04252023" is esriGeometryPolygon |
| baltimore-county-dcat → Active Development Search | no-candidates | no ArcGIS/Socrata distribution |
| baltimore-county-dcat → Current CBCA Land Use Designation | flag | layer "Current CBCA Land Use Designation" is esriGeometryPolygon |
| baltimore-county-dcat → Zoning History | flag | layer "Zoning History Cases" is esriGeometryPolygon |
| baltimore-county-dcat → Plumbing Permits | flag | fresh (newest 2026-07-10) |
| baltimore-county-dcat → Gas Permits | flag | fresh (newest 2026-07-15) |
| baltimore-county-dcat → Electrical Permits | flag | fresh (newest 2026-07-15) |
| baltimore-county-dcat → Use and Occupancy Permits | flag | fresh (newest 2026-07-15) but no lexicon status column among: OBJECTID, CASE_NUMBER, CA_TASK_ID, ADDRESSSTREETNUMBER, ADDRESSSTREETNAME, ADDRESSCITY, ADDRESSSTATE, ADDRESSZIP, PEOPLEROLEID, OWNERNAME, OWNERADDRESS1, OWNERADDRESS2, OWNERADDRESS3, OWNERCITY, OWNERSTATE |
| baltimore-county-dcat → Permits | flag | fresh (newest 2026-07-12) |
| baltimore-county-dcat → Proposed Landuse | flag | layer "Proposed Land Use - Smart Code" is esriGeometryPolygon |
| baltimore-county-dcat → Landuse | flag | layer "Landuse" is esriGeometryPolygon |
| frederick-county-dcat | unreachable | DCAT HTTP 404 {"error":"Domain record(s) not found :: A domain record with hostname = data-frederickcountymd.opendata.arcgis.com does not exist :: 404"} |
| harford-county-dcat | unreachable | DCAT HTTP 404 {"error":"Domain record(s) not found :: A domain record with hostname = data-harfordcountymd.opendata.arcgis.com does not exist :: 404"} |
| baltimore-city-dcat → Percent of Commercial Properties with Rehab Permits Above 5,000 | flag | layer "Percent of Commercial Properties with Rehab Permits Above $5,000 - Community Statistical Area" is esriGeometryPolygon |
| baltimore-city-dcat → Percent of Commercial Properties with Rehab Permits Above $5,000 - City | flag | layer "Percent of Commercial Properties with Rehab Permits Above $5,000 - City" is esriGeometryPolygon |
| baltimore-city-dcat → Zoning | skipped | host baltegis.baltimorecity.gov not on the target allowlist |
| baltimore-city-dcat → Planning District | skipped | host baltegis.baltimorecity.gov not on the target allowlist |
| baltimore-city-dcat → Residential Parking Permits | flag | layer "Residential Parking Permits" is esriGeometryPolygon |
| baltimore-city-dcat → Housing and Building Permits 2019-Present | skipped | host baltegis.baltimorecity.gov not on the target allowlist |
| baltimore-city-dcat → Housing and Building Permits  2015 to 2018 | flag | fresh (newest 3201-12-22) but no lexicon status column among: OBJECTID_1, CaseNumber, Description, ExpirationDate, IssuedDate, Address, BLOCKLOT, ExistingUse, ProposedUse, csm_projname, prc_block_no, prc_lot, Neighborhood, Cost, Council_District |
| baltimore-city-dcat → Number of Event Permits Requested per 1,000 Residents | flag | layer "Number of Event Permits Requested per 1,000 Residents - Community Statistical Area" is esriGeometryPolygon |

### Flagged shapes — what connector work each needs
- **allen-current-development-projects** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **el-paso-new-commercial** — statuses unknown to the lexicon: a human to extend scripts/source-lexicon.json with these VERBATIM statuses (only from a human-approved mapping)
- **stpaul-approved-building-permits** — no native ZIP column: a human-crafted zip_where_template (ZIP embedded in a text field is never auto-guessed)
- **worcester-building-permits** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **syracuse-permit-requests** — no status column: a human to map the status semantics (San Antonio-style dataset-level status needs a judgment call)
- **howard-county-permits** — socrata resource missing: status, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **houston-ckan** — CKAN catalog: a CKAN connector (generic connectors handle ArcGIS + Socrata only) — or wire the dataset directly if a distribution exposes an ArcGIS/Socrata API
- **houston-cohgis → HoustonMap/Landuse/Land Use (Grouped) ** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Restricted Lot Driveway Access** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Conservation Districts** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Green Corridor** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → HoustonMap/Planning_and_Development/Prohibited Yard Parking Applications** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6582 BEFORE ASSIGNING ADDRESS** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6582 BEFORE ASSIGNING ADDRESS** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **houston-cohgis → PDD/Permits_Viewer_Verify_Areas/CALL 832-393-6556 BEFORE ASSIGNING ADDRESS** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **dallas-open-data → ROW Permits - Points (bw6g-a3ur)** — socrata resource missing: status, type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **dallas-open-data → ROW Permits - Lines (xd3q-ipis)** — socrata resource missing: status, type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **mckinney-arcgis → MapServices/DevelopmentExhibits/Custer West Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/DevelopmentExhibits/MTC Regulating Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/DevelopmentExhibits/Stonebridge Ranch Exhibit** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **mckinney-arcgis → MapServices/FireStation14PlanningDriveTimes/Drive Time Areas 1** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/City Labels** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/ETJ Labels** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → CityETJPermits_GC/City and ETJ** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/1 Foot Contours - 2017** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/2 Foot Contours - 2005** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denton-county-arcgis → ContourPermits_GC/2 Foot Contours - LIDAR 2000** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **jeffco-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **jeffco-dcat → Subdivision** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **adams-co-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **adams-co-dcat → Subdivisions** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **adams-co-dcat → Advancing Adams Future Land Use 2022** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → BVCP Future Land Use** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → BVCP Planning Area (I, II, III)** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → Zoning Districts** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **boulder-city-dcat → Development Review Cases** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **fort-collins-hub-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **fort-collins-hub-dcat → Current Development** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → South Platte River Glide Sites** — no date column: a human to identify the temporal column (none of the lexicon date candidates present)
- **denver-dcat → Subdivisions** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Tree Canopy Assessment 2013 - Land Use** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Wastewater Plat Map Index** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Sewer Use and Drainage Permit Reviewer Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Development Review Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Community Planning and Development Plan Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Site Development Plans** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **denver-dcat → Existing Land Use** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Foreign Trade Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Urban Renewal Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Qualified Opportunity Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Commercial Aeronautical Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/Enterprise Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/EconomicDevelopment/CHIPS Zones** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/PlanningAdmin/Coordinated Sign Plans** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/PlanningAdmin/Electronic Message Centers** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **springs-gis-root → GeneralUse/PlanningAdmin/Planning Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **sanjose-ckan** — CKAN catalog: a CKAN connector (generic connectors handle ArcGIS + Socrata only) — or wire the dataset directly if a distribution exposes an ArcGIS/Socrata API
- **santaclara-county-socrata → County of Santa Clara Permitted Body Art Facilities and Permitted Body Art Practitioners (mqx2-w62f)** — socrata resource missing: status, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **anaheim-dcat → Workforce Development Board** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **anaheim-dcat → Planning Commission** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **anaheim-dcat → Housing and Community Development Commission** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **anaheim-dcat → Hotel Permits** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **anaheim-dcat → Fire Permits Accela** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **anaheim-dcat → Utilities Electrical Permits Monthly** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **anaheim-dcat → Open Data Land Use Permits** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **anaheim-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **anaheim-dcat → General Plan Land Use** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **anaheim-dcat → Existing Land Use** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **contracosta-county-arcgis → _Authoritative/Zoning/PLA_DCD_Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **contracosta-county-arcgis → _Authoritative/Zoning/PLA_DCD_Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **sonoma-county-socrata → Sonoma County Planning Permits (m689-iiuu)** — socrata resource missing: type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **sonoma-county-socrata → Sonoma County Rebuilding Permits (652y-5ihx)** — socrata resource missing: native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **sonoma-county-socrata → Sonoma County Construction Permits (88ms-k5e7)** — socrata resource missing: type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **ventura-county-arcgis → DataDownloads/LandUse/Area plans** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **ventura-county-arcgis → DataDownloads/LandUse/General Plan** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **ventura-county-arcgis → DataDownloads/LandUse/Zone Designation** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **ventura-county-arcgis → DataDownloads/LandUse/Area plans** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **ventura-county-arcgis → DataDownloads/LandUse/General Plan** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **ventura-county-arcgis → DataDownloads/LandUse/Zone Designation** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **ventura-county-arcgis → DataDownloads/Permitting/Mining Permits** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **ventura-county-arcgis → DataDownloads/Permitting/Oil Permits** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **slo-county-dcat → General Plan Land Use Designations** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **slo-county-dcat → Completed Water Well Construction Permit Inventory Since 1965** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **slo-county-dcat → Planning Special Study Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **slo-county-dcat → Planning Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **slo-county-dcat → Planning Area Standards** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **phoenix-ckan** — CKAN catalog: a CKAN connector (generic connectors handle ArcGIS + Socrata only) — or wire the dataset directly if a distribution exposes an ArcGIS/Socrata API
- **mesa-socrata → Building Permits (RETIRED) (2gkz-7z4f)** — socrata resource missing: type, native ZIP: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **mesa-socrata → Building Permits (dzpk-hxfb)** — socrata resource missing: native ZIP: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **mesa-socrata → Turn Around Time - Permits (fhtq-vpmm)** — socrata resource missing: native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **mesa-socrata → Temporary Traffic Control (TTC) Permits (822f-avdk)** — socrata resource missing: native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **mesa-socrata → Development Services - Permit Submittals and Resubmittals Logged In (kg7m-y6f3)** — socrata resource missing: native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **mesa-socrata → Planning - Board of Adjustment (BOA) Memos completed (qmv6-zhfq)** — socrata resource missing: native ZIP, date: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **mesa-socrata → DSD - Planning & Zoning and Design Review Memos Completion (u5a9-tj5y)** — socrata resource missing: native ZIP, date: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **scottsdale-dcat → Planning and Development Plan Reviews** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **scottsdale-dcat → Planning and Development Encroachment Permits** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **scottsdale-dcat → Planning and Development Cases** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **scottsdale-dcat → Planning and Development Case Meetings** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **scottsdale-dcat → Planning and Development Building Permits** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **scottsdale-dcat → Planning and Development Code Violations** — (none) geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **scottsdale-dcat → Zoning** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **scottsdale-dcat → Subdivisions** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **maricopa-county-arcgis → GIO/PermitHistory/Permit (Point)** — no status column: a human to map the status semantics (San Antonio-style dataset-level status needs a judgment call)
- **maricopa-county-arcgis → GIO/PermitHistory/Permit (Line)** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **maricopa-county-arcgis → GIO/PermitHistory/Permit (Polygon)** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **maricopa-county-arcgis → GIO/PermitHistory/Permit History (Point)** — no status column: a human to map the status semantics (San Antonio-style dataset-level status needs a judgment call)
- **maricopa-county-arcgis → GIO/PermitHistory/Permit History (Line)** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **maricopa-county-arcgis → GIO/PermitHistory/Permit History (Polygon)** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **maricopa-county-arcgis → GIO/PermitHistory/Permit (Point)** — no status column: a human to map the status semantics (San Antonio-style dataset-level status needs a judgment call)
- **maricopa-county-arcgis → GIO/PermitHistory/Permit (Line)** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **maricopa-county-arcgis → GIO/PermitHistory/Permit (Polygon)** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **maricopa-county-arcgis → GIO/PermitHistory/Permit History (Point)** — no status column: a human to map the status semantics (San Antonio-style dataset-level status needs a judgment call)
- **tucson-dcat → Zoning - Tucson - Open Data** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **tucson-dcat → Redevelopment Plans - Open Data** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **tucson-dcat → Original City Zoning - Open Data** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **tucson-dcat → Subdivisions - Open Data** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **tucson-dcat → Rezonings - Open Data** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **tucson-dcat → Mapped Planned Land Use - Open Data** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **montgomery-county-socrata → Residential Permit (m88u-pqki)** — socrata resource missing: type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **montgomery-county-socrata → Commercial Permits (i26v-w6bd)** — socrata resource missing: type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **montgomery-county-socrata → Mechanical Permits (ih88-a6aa)** — socrata resource missing: type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **montgomery-county-socrata → Electrical Building Permits (qxie-8qnp)** — socrata resource missing: type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **montgomery-county-socrata → Demolition Permits (b6ht-fw3x)** — socrata resource missing: type, native ZIP, date, lat/lng columns: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **montgomery-county-socrata → DPS - Antenna/Wireless Permits (djk9-h36c)** — socrata resource missing: status, type, date: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **montgomery-county-socrata → Fence Permits (9quz-avmj)** — socrata resource missing: type, date: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **montgomery-county-socrata → Sign Permits (piic-h4rw)** — socrata resource missing: type, native ZIP: a human column-map (auto-wire requires status+type+ZIP+date+point columns resolvable via the lexicon)
- **annearundel-arcgis → Hosted/2040_Land_Use_Changes/LU2040 Consistency Changes** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **annearundel-arcgis → Hosted/2040_Land_Use_Changes/LU2040 Consistency Changes Dissolved** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **annearundel-arcgis → Hosted/Development_Policy_Area_Overlays_PreliminaryDraft/Development_Policy_Area_Overlays_PreliminaryDraft** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **annearundel-arcgis → Hosted/Development_Policy_Areas_and_Overlay_Areas_WFL1/Overlay Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **annearundel-arcgis → Hosted/Development_Policy_Areas_and_Overlay_Areas_WFL1/Major_Roads** — esriGeometryPolyline geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **annearundel-arcgis → Hosted/Development_Policy_Areas_and_Overlay_Areas_WFL1/City of Annapolis** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **annearundel-arcgis → Hosted/Development_Policy_Areas_and_Overlay_Areas_WFL1/Policy Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **annearundel-arcgis → Hosted/Development_Policy_Areas_Overlays_12042020/Development_Policy_Areas_Overlays_12042020** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **annearundel-arcgis → Hosted/Development_Policy_Areas/Development Policy Areas** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **annearundel-arcgis → Hosted/GDP_Land_Use_Plan2040_May_2023/GDP_LandUse_Plan_2040_Update2023_04252023** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **baltimore-county-dcat → Current CBCA Land Use Designation** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **baltimore-county-dcat → Zoning History** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **baltimore-county-dcat → Plumbing Permits** — no type column: a human to scope noise types (auto-wire requires an at-source type filter)
- **baltimore-county-dcat → Gas Permits** — no type column: a human to scope noise types (auto-wire requires an at-source type filter)
- **baltimore-county-dcat → Electrical Permits** — no type column: a human to scope noise types (auto-wire requires an at-source type filter)
- **baltimore-county-dcat → Use and Occupancy Permits** — no status column: a human to map the status semantics (San Antonio-style dataset-level status needs a judgment call)
- **baltimore-county-dcat → Permits** — no type column: a human to scope noise types (auto-wire requires an at-source type filter)
- **baltimore-county-dcat → Proposed Landuse** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **baltimore-county-dcat → Landuse** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **baltimore-city-dcat → Percent of Commercial Properties with Rehab Permits Above 5,000** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **baltimore-city-dcat → Percent of Commercial Properties with Rehab Permits Above $5,000 - City** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **baltimore-city-dcat → Residential Parking Permits** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
- **baltimore-city-dcat → Housing and Building Permits  2015 to 2018** — no status column: a human to map the status semantics (San Antonio-style dataset-level status needs a judgment call)
- **baltimore-city-dcat → Number of Event Permits Requested per 1,000 Residents** — esriGeometryPolygon geometry: point-derivation (centroid) support in sources/arcgis.ts, or reject: intersection-style locations carry no parcel point
