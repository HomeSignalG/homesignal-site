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
