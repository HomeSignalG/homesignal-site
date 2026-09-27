# NYC V1 pilot assembly — AddressPoint placement and allowlist (2026-09-27)

This assembles the first commercial pilot configuration. It classifies one New York City public data set as the property-location input, and it decides the proximity claims that #1418 left HOLD because the Census geocoder and OpenAddresses stayed HOLD.

The other registry entries were not reclassified. Seattle stays where #1416 left it. Census geocoder, OpenAddresses `national_address_points`, and ZCTA proximity stay where #1418 left them. The paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `dcc6ba9b121342046b41cfef6cd31e6eec600d95`.

Canonical audit blob `docs/corporate-output-source-rights-audit-2026-09-27.md` is `c2cc94524ee2d21af47520254703d4a222344c66` on this SHA.

## Decision

| Object | Classification | Paid NYC V1 use |
|---|---|---|
| NYC AddressPoint `data.cityofnewyork.us` `uf93-f8nk` | **CLEARED WITH ATTRIBUTION** as a publisher dataset | **APPROVED** as the property coordinate when the buyer-supplied address matches a published point |
| `nyc-dob-permit-issuance` (`ipu4-2q9a`) | Unchanged: **CLEARED WITH ATTRIBUTION** | **APPROVED** when the mapped publisher latitude and longitude are present |
| `nyc-dobnow-approved-permits` (`rbx6-tga4`) | Unchanged: **CLEARED WITH ATTRIBUTION** | **APPROVED** when the mapped publisher latitude and longitude are present |
| Distance, pin, "near this property", and property-area inclusion | HomeSignal arithmetic and wording over two NYC Open Data coordinates | **APPROVED** only inside the NYC V1 allowlist below |
| Census geocoder `Public_AR_Current` | Unchanged: **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **HOLD**. Not in the allowlist. |
| OpenAddresses `national_address_points` | Unchanged: **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **HOLD**. Not in the allowlist. |
| TIGER/Line 2025 ZCTA as official ZIP or proximity | Unchanged | **HOLD**. Not in the allowlist. |
| NYC Geoclient / Geosupport API | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **HOLD**. Registration and app keys are a different instrument from the published AddressPoint table. |
| AddressPoint ArcGIS FeatureServer / nycmaps-nyc hub | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **HOLD**. Different distribution from the Socrata view. |
| Property Address Directory `bc8t-ecyu` | Not classified | Not used. |

Nothing in this file is **CLEARED FOR PAID REPORT** as a national product stamp. The NYC V1 allowlist is the first configuration that can be assembled entirely from cleared publisher data and cleared geography.

`get-address-report` is not that configuration. It still mixes HOLD sources and still ends its success `note` with `"Not for resale."`

## Why New York City is the first pilot

`nyc-dob-permit-issuance` and `nyc-dobnow-approved-permits` are already **CLEARED WITH ATTRIBUTION** (#1410). Their own coordinates, when present, are part of that clearance (#1418). What blocked a paid property-scoped use was the customer's property coordinate: address mode still calls the Census geocoder.

A useful first report answers what is changing around a New York City property from those two Department of Buildings ledgers. It does not need the other 238 registry entries, Atlas, OSM, Local News, meetings, scores, or outlooks.

## NYC AddressPoint

Fetched 2026-09-27 from `https://data.cityofnewyork.us/api/views/uf93-f8nk.json`:

- name: AddressPoint
- `assetType`: dataset
- attribution: Office of Technology and Innovation (OTI)
- category: City Government
- provenance: official
- Agency in custom metadata: Office of Technology and Innovation (OTI)
- no `license` field
- no `licenseId` field
- description: "Address points were developed to supplement the address information supplied by the CSCL centerline."
- `the_geom` is a point column; cached non-null count 967,871; cached null count 0
- `rights` is `['read']` — the Socrata public-audience flag. It is not a license. The two DOB views carry the same flag.
- other published fields include `addresspointid`, `house_number`, `house_number_suffix`, `street_name`, `full_street_name`, `zipcode`, `boroughcode`, `bin`, `address_status`
- match keys on this date: `house_number`, `street_name`, `full_street_name`, and `boroughcode` each have 967,871 non-null values; `zipcode` has 4 nulls

The cleared fetch path is this NYC Open Data view, `https://data.cityofnewyork.us/api/views/uf93-f8nk.json` and its SODA table `https://data.cityofnewyork.us/resource/uf93-f8nk.json`. It is not the ArcGIS FeatureServer named in OpenAddresses, and it is not `https://nycmaps-nyc.hub.arcgis.com/datasets/nyc::address-point/about` (linked from the view description). Those two distributions stay **HOLD**.

The older OpenAddresses path `g6pj-hd8k` ("NYC Address Points") returned HTTP 404 on this date. Current OpenAddresses `sources/us/ny/city_of_new_york.json` now names this view: website `https://data.cityofnewyork.us/City-Government/AddressPoint/uf93-f8nk`, data `https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/AddressPoint_view/FeatureServer/0`. That JSON is CC0 source metadata. It is not a relicense of the points. HomeSignal's loaded `national_address_points` table is still the 8,545 Texas rows recorded earlier. Those rows are not this view.

PAD `bc8t-ecyu` was fetched the same day. It is a DCP file blob (`pad.zip`), not the point table used here. It is not classified.

A buyer-supplied "1 Centre Street" matches a published point on this date: `addresspointid` 1001387, `house_number` 1, `street_name` CENTRE, `full_street_name` CENTRE ST, `zipcode` 10007, `boroughcode` 1, `the_geom` `[-74.003758107366, 40.712980288068]`. That is a field match. It is not a Geoclient call.

## The statute

This is the same instrument #1410 applied to the two DOB views. AddressPoint is an official public data set on `data.cityofnewyork.us`, maintained by or for a City agency.

Local Law 11 of 2012, Administrative Code § 23-502(d):

"Such public data sets shall be made available without any registration requirement, license requirement or restrictions on their use provided that the department may require a third party providing to the public any public data set, or application utilizing such data set, to explicitly identify the source and version of the public data set, and a description of any modifications made to such public data set."

§ 23-501(b) defines data and says the term "shall include geographic information system data." AddressPoint `the_geom` is that class. The same sentence excludes image files (designs, drawings, maps, photos). This table is a point dataset, not a scanned map.

§ 23-501(g) defines a public data set and excludes withheld portions, deliberative material, and "materials subject to copyright, patent, trademark, confidentiality agreements or trade secret protection."

§ 23-504(a) is a warranty disclaimer. It is not a commercial ban.

The Technical Standards Manual, fetched the same day from `https://opendata.cityofnewyork.us/wp-content/uploads/NYC_OpenData_TechnicalStandardsManual.pdf`, says that upon publication to NYC Open Data, "datasets become a public resource available to anyone, without restriction or licensing requirements." That sentence restates the statute. It is not a second grant.

`https://www.nyc.gov/main/terms-of-use` remains the NYC.gov website notice. #1410 did not apply it to the DOB views. It is not applied here.

## What attribution requires

A paid NYC V1 artifact that uses AddressPoint identifies:

- the source: New York City Office of Technology and Innovation, on NYC Open Data
- the dataset and version: `uf93-f8nk`, and the version actually retrieved
- modifications: any selection or rename of `the_geom`, `addresspointid`, `house_number`, `street_name`, `full_street_name`, `zipcode`, or `boroughcode`, and any match of a buyer-supplied address string to those fields

A paid NYC V1 artifact that uses a DOB row keeps the #1410 credit: New York City Department of Buildings, dataset `ipu4-2q9a` or `rbx6-tga4`, version retrieved, and the `column_map` selection as a modification.

## Property-proximity claims

#1418 left pin, distance, and "near this property" HOLD because the address-mode home coordinate was Census geocoder output. That Census hold stands. This file does not reopen it.

The NYC V1 property coordinate is a published AddressPoint `the_geom` that matches the buyer-supplied address. The project coordinate is the publisher latitude and longitude already mapped on the two cleared DOB entries. HomeSignal's `toEN()` arithmetic between those two points is HomeSignal's. Both inputs are NYC Open Data public data sets.

| Claim | NYC V1 decision | Required inputs | Rejected substitutes |
|---|---|---|---|
| Pin at the buyer-supplied address | **APPROVED** | AddressPoint `the_geom` for that address | Census geocoder; OpenAddresses; Geoclient; a guessed rooftop |
| Distance from the property | **APPROVED** | AddressPoint point and a DOB publisher point | Census or OpenAddresses on either end |
| "Near this property" | **APPROVED** | The same two points, with the measured distance stated | A ZIP, a ZCTA, or an uncleared geocode |
| Property-area inclusion | **APPROVED** as "publisher-reported ZIP equals the buyer-supplied ZIP" or "AddressPoint `zipcode` equals the buyer-supplied ZIP" | Buyer-supplied ZIP plus publisher `zip_code` / AddressPoint `zipcode` | TIGER/Line ZCTA membership as an official USPS ZIP |

A DOB row whose mapped latitude or longitude is empty stays **HOLD**. It would fall through to the OpenAddresses / Census ladder. That ladder is not in the allowlist. The row may be listed without a distance or a pin, using only publisher text fields, or it is omitted.

An AddressPoint miss is a miss. It is not filled from Census, OpenAddresses, or Geoclient.

## NYC V1 Corporate Output Source Allowlist

A first paid Future Surroundings Report for New York City may contain only:

1. The buyer-supplied address and ZIP, as the buyer typed them.
2. The matching AddressPoint record from `uf93-f8nk`, with attribution.
3. Rows from `nyc-dob-permit-issuance` and `nyc-dobnow-approved-permits` whose mapped publisher coordinates are present, with attribution.
4. HomeSignal distance, pin, and "near this property" statements derived only from items 2 and 3.
5. HomeSignal-authored clearance text that names what this allowlist excludes.
6. The source, version, and modification notices required above.

It may not contain:

- `get-address-report` as a payload, cache, or embed
- Census geocoder output
- OpenAddresses `national_address_points`
- ZCTA / TIGER/Line membership as official ZIP or proximity
- NYC Geoclient or Geosupport API output
- the ArcGIS AddressPoint FeatureServer or the nycmaps-nyc hub page
- EPA FRS / ECHO, TCEQ, TDLR/TABS
- any other `jurisdiction-registry.json` entry
- Compute Atlas, OpenStreetMap, or Epoch placement
- Local News, meetings, government notices, email, or MAPS posts
- scores, outlooks, Quality of Life scoring, predictive `sowhat` prose, or "Effect at this address"

NWS alert text remains **CLEARED WITH ATTRIBUTION** as national attributed text. It is not in this property-proximity allowlist.

## Usefulness of this market

Live SODA counts, 2026-09-27:

| Dataset | Published rows | Rows with publisher coordinates | Allowlisted type and coordinates |
|---|---|---|---|
| AddressPoint `uf93-f8nk` | 967,871 | 967,871 (`the_geom` nulls: 0) | n/a — this is the property coordinate |
| `nyc-dob-permit-issuance` `ipu4-2q9a` | 3,990,687 | 3,983,266 | 754,011 (`permit_type` in NB/DM/AL/FO) |
| `nyc-dobnow-approved-permits` `rbx6-tga4` | 1,006,422 | 999,963 | 316,643 (`work_type` in General Construction, Structural, Foundation, Earth Work, Full Demolition) |

A first paid report that answers what Department of Buildings activity is changing around a New York City property can be built from those counts without Census, OpenAddresses, ZCTA, Atlas, OSM, Local News, or any other registry entry.

## What this does not do

HomeSignal does not currently load AddressPoint. This file clears the dataset as a candidate input. It does not load it, wire it, or change `get-address-report`.

`"Not for resale"` remains product copy and remains in the function. The allowlist does not call that function.

Seattle building permits stay **CLEARED WITH ATTRIBUTION** and **HOLD** for property placement. Seattle address points were not opened. #1422, if merged, does not change this file.

## Step 2 status

The Step 2 close condition was: at least one useful pilot market assembled entirely from cleared publisher data and cleared geography, with attribution defined and no HOLD or EXCLUDE leakage.

That condition is met for **New York City V1** as defined above.

Step 2 remains **OPEN** for every other market. The Census geocoder, OpenAddresses, Atlas, OSM, and the uncleared registry entries are unchanged. The overall commercial verdict remains **NOT YET**: Step 3 (unsupported prediction claims) and Step 4 (build the report from this allowlist) have not started. Nothing here starts the paid report.
