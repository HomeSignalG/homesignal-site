# Brunswick County permits — one registry publisher (2026-09-27)

This classifies `brunswick-county-permits` only. The other registry entries were not reclassified. The audit verdict remains **NOT YET**. A paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `187dce7bb2eec986117fb7806820fdb9165270ca`.

## Decision

| Registry id | Dataset | Publisher status | Paid property report |
|---|---|---|---|
| `brunswick-county-permits` | ArcGIS `Permit_Locations` `FeatureServer/0` | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **HOLD** |

Publisher rights are not cleared. Paid property-report use remains **HOLD**.

## Registry entry on this SHA

From `supabase/functions/get-address-report/jurisdiction-registry.json`:

- `registry_id`: `brunswick-county-permits`
- `platform`: `arcgis`
- `jurisdiction`: Brunswick County, North Carolina
- `coverage`: state `NC`, county `Brunswick`
- `service_url` and `dataset_url`: `https://services1.arcgis.com/W6gamXPYQeLXrdAd/arcgis/rest/services/Permit_Locations/FeatureServer/0`
- Git stores field maps, status buckets, `file_date_kind` `issued`, `spatial_zip_radius_mi` `5`, `recency_days` `730`, and a `_receipts` note about wiring choices (`ProjectType`, `PemitProjectStatus`). The entry has no license, terms, or attribution field. The receipt is a wiring note. It is not a redistribution grant.

## Publisher identity

The live feature service and the ArcGIS item `ffa7fd8c10ae4616b9d87d6beb9bfe35` are owned by the ArcGIS user `brunsco_admin` (user id `3883ebb727da4177a50e5f2c777660aa`) in tenant `W6gamXPYQeLXrdAd`. The public user profile has an empty name and no organization id. The item snippet is "Point layer containing permitting data for Brunswick County."

The same user owns the ArcGIS Hub site item `d068688869af457b83dab71b7b08f852`, title "Brunswick County NC", URL `https://data-brunsco.opendata.arcgis.com`. Brunswick County's GIS download page links to that portal. The county's own server `bcgis.brunswickcountync.gov` does not host this service: `Permitting/Permit_Locations/FeatureServer/0` returned "Service Permitting/Permit_Locations/MapServer not found."

The reviewed endpoint is the hosted FeatureServer in the registry. Esri platform terms are not treated as this publisher's grant. Nothing on the item says those terms govern the dataset.

## What was fetched (2026-09-27)

Feature layer `.../FeatureServer/0?f=json`:

- `name`: "Permit Locations"
- `description`: empty string
- `copyrightText`: empty string (the key is present)
- `serviceItemId`: `ffa7fd8c10ae4616b9d87d6beb9bfe35`
- `hasMetadata`: true

FeatureServer root: `serviceDescription`, `description`, and `copyrightText` are empty. REST `info` names owning tenant `W6gamXPYQeLXrdAd` and token security. It has no license text.

Item `https://www.arcgis.com/sharing/rest/content/items/ffa7fd8c10ae4616b9d87d6beb9bfe35?f=json`, the same fields on the item search, and `iteminfo.xml`:

- `licenseInfo`: null
- `accessInformation`: empty
- `description`: empty
- `license`: absent on the item JSON
- Hub search record for this id: `license` is the string `none`, `source` is null, `listed` is false, `categories` is `/Categories/Authoritative`
- `license: none` is the absence of a selected license. It is not a public-domain dedication.

Layer metadata XML (`.../FeatureServer/0/metadata`, HTTP 200, 12374 bytes, `CreaDate` 20260927) is address-locator configuration. It contains no `copyright`, `license`, `rights`, `constraint`, or `useLimitation` text.

Hub dataset APIs for this item id returned HTTP 404 on `opendata.arcgis.com`, `hub.arcgis.com`, and `data-brunsco.opendata.arcgis.com`. The Hub site config embedded on the portal home page has `licenseInfo` null, an empty consent `policyURL`, and no mention of this item id. The item HTML page is an ArcGIS application shell.

County pages fetched the same day:

- `https://www.brunswickcountync.gov/321/Data-Download` links to the Open GIS portal and lists shapefile downloads: BuildingFootprints, Cemetery, Centerlines, Municipal, ParcelLines, Parcels, Structures, Zoning. Permit Locations is not in that list. The note on that page says: "This data is prepared for the inventory of real property found within this jurisdiction, and is compiled from recorded deeds, plats, and other public records and data. Users of this data are hereby notified that the aforementioned public primary information sources should be consulted for verification of the information contained in this data. Brunswick County assumes no legal responsibility for the information contained in this data."
- `https://www.brunswickcountync.gov/gis` describes GIS maps "in a free online, searchable database or on discs available for purchase." It does not name this layer and does not grant a third party a redistribution right.
- `https://www.brunswickcountync.gov/124/Privacy-Policy` is the website privacy policy. Quoted: "All information contained within the Brunswick County website is public record and is maintained and provided in accordance with the Public Records Law of North Carolina ( N.C.G.S. Chapter 132 )." And: "Brunswick County assumes no responsibility or liability for the future use or accuracy of County data that is extracted or obtained from our website or via other publicly available sources or processes, regardless of how the data is gathered." The page also says website information is provided as a public service, "as is" and without warranties.
- The site footer on `https://www.brunswickcountync.gov/copyright` says: "All content © 2006-2026 Brunswick County, NC and its representatives. All rights reserved." That URL's body is a CivicPlus page titled "Pages," not a dataset license. `/legal` returned the county 404 page.

North Carolina statute, fetched the same day from `https://www.ncleg.gov/enactedlegislation/statutes/html/bysection/chapter_132/gs_132-1.html` and `gs_132-6.html`:

- G.S. 132-1(b): "The public records and public information compiled by the agencies of North Carolina government or its subdivisions are the property of the people. Therefore, it is the policy of this State that the people may obtain copies of their public records and public information free or at minimal cost unless otherwise specifically provided by law."
- G.S. 132-6(a): a custodian "shall permit any record in the custodian's custody to be inspected and examined at reasonable times and under reasonable supervision by any person, and shall, as promptly as possible, furnish copies thereof upon payment of any fees as may be prescribed by law."
- G.S. 132-6(a1) allows an agency to meet that duty by putting records online in a format a person can view and print or save in order to obtain a copy.
- G.S. 132-6(b): "No person requesting to inspect and examine public records, or to obtain copies thereof, shall be required to disclose the purpose or motive for the request."

## Publisher-data rights

Commercial redistribution is not established for this dataset.

The feature service, item, item XML, and layer metadata carry no license URL and no sentence on commercial use, copying, redistribution, republication, derivative use, modification, attribution, sublicensing, or resale. An empty `copyrightText` is not permission. A public FeatureServer is not a license. `license: none` records that no license was selected.

The county privacy policy and G.S. Chapter 132 were checked and are not used as a grant. The privacy policy's public-record sentence is about information on `www.brunswickcountync.gov`. This FeatureServer is on `services1.arcgis.com`, the Hub dataset API does not list this item, and the Hub site config does not mention it. The liability sentence on the privacy policy disclaims responsibility for later use of county data. It does not permit republication or resale. The shapefile note and the GIS "discs available for purchase" sentence do not name this layer.

Chapter 132, as fetched, requires inspection and copies, including an online view-and-save copy, and it bars a custodian from demanding the requester's motive. Those sections do not contain a permission to republish, modify, sublicense, or resell the compilation. Applying them to this hosted layer would still leave commercial reuse unstated. A general access statute is not used here as a commercial license.

No attribution or modification notice was identified, because no grant that would impose one was identified. The website footer reserves rights in site content. That reservation is not a dataset-specific license, and it is not a clearance.

## Paid property-report eligibility

This entry stays **HOLD** inside a paid property-proximity report. The publisher record itself is not cleared, so there is no source clearance to separate into a paid-report exception.

The separate global blockers also remain, and they would keep property-report use on **HOLD** even if a later review found a publisher grant:

- `get-address-report` still attaches `"Not for resale"`, and Git still has no reason for that sentence.
- A pin, a distance, or "near this property" still depends on the Census geocoder or OpenAddresses and a ZCTA test. Those inputs stay **HOLD**.

## Scope of this file

`brunswick-county-permits` is **HOLD — TERMS/RIGHTS NOT ESTABLISHED**. The other registry entries were not reclassified. `nyc-dob-permit-issuance` and `nyc-dobnow-approved-permits` stay where #1410 left them. `chicago-building-permits` stays where #1412 left them. The overall verdict remains **NOT YET**. Nothing in this file is **CLEARED FOR PAID REPORT**. The paid Future Surroundings Report was not started.
