# Little Rock permits — one registry publisher (2026-09-27)

This classifies `little-rock-permits` only. The other registry entries were not reclassified. The audit verdict remains **NOT YET**. A paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `2c6fe1fb6047ab2bc26b0b8dae94ce9568fcf2b9`.

Canonical audit blob `docs/corporate-output-source-rights-audit-2026-09-27.md` is `c2cc94524ee2d21af47520254703d4a222344c66` on this SHA.

## Decision

| Registry id | Dataset | Publisher status | Paid property report |
|---|---|---|---|
| `little-rock-permits` | `Permits_All` MapServer layer 0 | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **HOLD** |

Publisher rights are not cleared. Paid property-report use remains **HOLD**.

## Registry entry on this SHA

From `supabase/functions/get-address-report/jurisdiction-registry.json`:

- `registry_id`: `little-rock-permits`
- `platform`: `arcgis`
- `jurisdiction`: City of Little Rock, Arkansas
- `coverage`: Arkansas counties Pulaski and Saline
- `service_url` and `dataset_url`: `https://maps.littlerock.gov/server/rest/services/Permits_All/MapServer/0`
- Git stores column maps, `file_date_kind` `issued`, status buckets, and `commercial_work_evidence` on `PermitType` value `BLD`. That field is a construction work-class filter. It is not a redistribution grant. The entry has no license, terms, or attribution field. The `_receipts` note is wiring evidence.

## Publisher identity

Fetched 2026-09-27. The MapServer is on the City host `maps.littlerock.gov`. REST info names owning system `https://maps.littlerock.gov/portal`.

The service description is "City of Little Rock Permitting data as imported from CDR Permitting Database." Service `copyrightText` is `CoLR`. Item info title is "Permit Data." Tags are "City of Little Rock" and "Permits." `accessInformation` is `CoLR`. `licenseInfo` is an empty string on the service item info and null on the portal item.

Portal item `5d0b5345a11b4d85ba8771c89f0c13cc`, owner `LRPORTALADMIN`, type Map Service, access public, URL `https://maps.littlerock.gov/server/rest/services/Permits_All/MapServer`. The item has no `license` field and no documentation URL. The layer has no `serviceItemId`. Layer 0 metadata returned HTTP 404.

Layer 0 name is "All Permits and Inspections." Its `description` is empty and its `copyrightText` is an empty string. Capabilities on the layer and the service are `Map,Query,Data`. That is a technical capability list. It is not a license. An empty layer `copyrightText` is not permission. `CoLR` is a city mark on the service. It is not a grant to copy, redistribute, or resell.

Esri platform terms were not used as this publisher's grant. Nothing on the service says those terms govern the rows.

## What was checked for a reuse grant

City mapping page `https://maps.littlerock.gov/`, fetched the same day, describes the Open Data Portal as displaying "City datasets for use by developers, analysts, residents, and more" and links that sentence to `https://data.littlerock.gov/`. That host returned HTTP 404 for the portal home, for `https://data.littlerock.gov/api/views/inn5-pknq.json`, and for the former policy path `.../City-of-Little-Rock-Open-Data-Policy/inn5-pknq`. The mapping page does not name `Permits_All`. A dead portal link is not a license for this MapServer.

`https://littlerock.gov/government/mayors-office/initiatives/city-of-lr-data/` lists a CSV, "Planning and Development Permits – 2019 to 2026," at a city uploads path. That file is a different publication. It was not classified. The page footer says "Copyright © 2026 - City of Little Rock. All Rights Reserved." That line is the website footer.

`https://littlerock.gov/privacy-policy/` is about information the City collects from visitors to LittleRock.gov, including the sentence "The City does not collect data for commercial or marketing purposes, and the City does not sell, exchange, or otherwise distribute the data collected by LittleRock.gov for commercial or marketing purposes." That sentence is about visitor data on the website. It does not license this MapServer.

City procedure guideline 2050, "Freedom of Information Act Requests," PDF `https://www.littlerock.gov/media/23213/20250205-revised-foia-policy-003-002.pdf`, revised 02/05/2025, says its purpose is a citywide policy "for responding to Freedom of Information Act (FOIA) Requests for Public Records under the Arkansas Freedom of Information Act." It assigns inspection and copying to FOIA staff under the City Attorney. That is a records-access procedure. It is not a commercial redistribution license for this service.

A third-party archive at `https://opendatapolicyhub.sunlightfoundation.com/collection/little-rock-ar-2016-05-03/` reprints a 2016 City open-data resolution. Its Section 4 says datasets published on the Open Data Portal "shall be placed into the public domain" and that this "means that there are no restrictions or requirements placed on use of these datasets." The archive points at `data.littlerock.org`, which did not resolve a policy dataset on this date. The City's own site search for the policy did not return the resolution as a live document attached to this service. Section 4, as reprinted, covers datasets published on the Open Data Portal. This review did not find `Permits_All` on that portal. The resolution is not used as a grant for this MapServer.

A PAgis data-usage PDF was not applied. This service describes CDR permitting data. That agreement's stated subject is planimetric, orthophoto, and addressing data supplied under a signed agreement.

## Publisher-data rights

Commercial use, copying, redistribution, republication, modification, derived products, resale, sublicensing, and API redistribution are not granted on this service. No attribution formula and no modification notice were identified, because no grant that would impose one was identified. No termination clause was found on the service itself. Absence of a prohibition is not permission.

`little-rock-permits` is **HOLD — TERMS/RIGHTS NOT ESTABLISHED**.

## Paid property-report eligibility

This entry stays **HOLD** inside a paid property-proximity report. The publisher record is not cleared.

The separate global blockers also remain:

- `get-address-report` still attaches `"Not for resale"`, and Git still has no reason for that sentence.
- A pin, a distance, or "near this property" still depends on the Census geocoder or OpenAddresses and a ZCTA test. Those inputs stay **HOLD**.

## Scope of this file

`little-rock-permits` is **HOLD — TERMS/RIGHTS NOT ESTABLISHED**. The other registry entries were not reclassified. The overall verdict remains **NOT YET**. Nothing in this file is **CLEARED FOR PAID REPORT**. The paid Future Surroundings Report was not started. The canonical audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.
