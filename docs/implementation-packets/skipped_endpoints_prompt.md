# Claude Code: Wire 4 Skipped Endpoints

## Objective
Wire 4 endpoints that were skipped in Phases 1-4 due to missing geometry or special handling needs. These require geocode_assemble or address-based geometry fallbacks.

## Rules
- Implementation ONLY. Do NOT research new sources.
- Read docs/implementation-packets/claude_code_implementation.json → phase4_special_handling for endpoint details.
- Registry file: supabase/functions/get-address-report/jurisdiction-registry.json
- Branch name: claude/skipped-endpoints-geocode
- If any endpoint fails, skip it and document in PR description.

## Endpoints (4 total, 428 ZIPs)

### 1. NJ Statewide Socrata (359 ZIPs) — HIGHEST PRIORITY
- **URL:** https://data.nj.gov/resource/w9se-dmra.json
- **Connector:** socrata
- **Type field:** permittypedesc
- **Status field:** permitstatusdesc
- **Date field:** permitdate
- **Problem:** No lat/long point geometry. Has municipality_code, block, lot fields.
- **Solution:** Use geocode_assemble flag. The endpoint has municipality text that can be geocoded. Add `geocode_assemble: true` and configure column_map with street_address fields (municipality + block + lot → approximate address). Add to the geocode_assemble allow-list in verify-edge-function workflow (currently 7 entries, this would be the 8th).
- **Note:** This is the single largest remaining wireable source (359 ZIPs). Worth extra effort.

### 2. Milwaukee WI CKAN (36 ZIPs)
- **URL:** https://data.milwaukee.gov/api/3/action/datastore_search?resource_id=828e9630-d7cb-42e4-960e-964eae916397
- **Connector:** ckan
- **Type field:** Permit Type
- **Status field:** Status
- **Date field:** Date Issued
- **Problem:** No point geometry. Text address only.
- **Solution:** Use geocode_assemble with address text. Street address is in a text field that can be geocoded.

### 3. Sussex County DE (22 ZIPs)
- **URL:** https://map.sussexcountyde.gov/trdserver/rest/services/Permit_Points/MapServer/0
- **Connector:** arcgis
- **Type field:** (check recon files from Phase 1)
- **Status field:** (check recon files from Phase 1)
- **Problem:** Was skipped in Phase 1 — likely had a field mapping issue or data quality concern.
- **Solution:** Re-probe the endpoint. It HAS point geometry (esriGeometryPoint). Check if the issue was field names, stale data, or something else. If it's just a field name issue, fix and wire it.

### 4. Arlington VA JSON API (11 ZIPs)
- **URL:** https://datahub-v2.arlingtonva.us/api/RealEstate/Permit
- **Connector:** json_api (custom)
- **Type field:** permitCode
- **Date field:** permitActivationDate
- **Problem:** No point geometry. Parcel-joinable.
- **Solution:** Use geocode_assemble with address fields from the JSON response. Check if the API returns parcel/address fields that can be geocoded.

## Verification
1. Run unit tests (58/58 must pass)
2. Run verify-development workflow
3. Update geocode_assemble allow-list in verify-edge-function if adding new geocoded entries
4. Document in PR: which ZIPs flip from blocked to live
