# Property-location stack — geocoder, OpenAddresses, ZCTA (2026-09-27)

This resolves the placement stack that still keeps cleared publisher rows out of a paid property-scoped report: the Census geocoder, OpenAddresses, and TIGER/Line ZCTA. `"Not for resale"` was already resolved as product copy. It is not reopened here.

The other registry entries were not reclassified. The audit verdict remains **NOT YET**. A paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `720d3c137113628494bac93e5fd7d8fbd1024ee5`.

Canonical audit blob `docs/corporate-output-source-rights-audit-2026-09-27.md` is `c2cc94524ee2d21af47520254703d4a222344c66` on this SHA.

## Decision

| Input | What the product uses it for | Publisher / file rights | Pin, distance, or "near this property" |
|---|---|---|---|
| Census geocoder `locations/onelineaddress`, benchmark `Public_AR_Current` | Address-mode home coordinate. Census rung of the permit geocode ladder. | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **HOLD** |
| OpenAddresses rows in `national_address_points` | First rung of the permit geocode ladder | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **HOLD** |
| TIGER/Line 2025 ZCTA polygons in `geo.zcta_boundary` | Point-in-polygon ZIP membership | **CLEARED WITH ATTRIBUTION** for reproducing the statistical boundary | **HOLD** |

Nothing in this table is **CLEARED FOR PAID REPORT**.

A cleared New York or Seattle permit coordinate is the publisher's own latitude and longitude. It does not supply the customer's property location. The address-mode property coordinate is the Census geocoder. That coordinate stays **HOLD**, so a paid claim that a cleared permit is near that property stays **HOLD**.

## Where each input sits

Address mode in `supabase/functions/get-address-report/index.ts` places the home with `geocode()`, a direct call to `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` with benchmark `Public_AR_Current`. That call is not the OpenAddresses ladder. `toEN()` then converts that home latitude and longitude and a site latitude and longitude into miles east and north. The arithmetic is HomeSignal's. The claim "near this property" still needs both coordinates to be usable for that claim.

ZIP mode does not read `geo.zcta_boundary`. Its map center is the caller's `lat`/`lng`, or, for ZIP 84302 only, a hardcoded centroid commented as `zipcodes` v3.0.0. This file does not classify that package. `docs/zip-membership-canonical.sql` is the membership rule: a point is in a ZIP when it intersects `geo.zcta_boundary`, which that file names as TIGER/Line 2025 (2020 ZCTA), SRID 4269. That test is "inside this statistical area." It is not a distance.

`supabase/functions/get-address-report/geocode-cache.ts` `productionLadder` is OpenAddresses `national_address_points`, then the same Census onelineaddress service. The Census rung labels every hit `range_interpolated` because `Public_AR_Current` interpolates along an address range. The ladder runs when a permit or facility row has no source coordinates. It does not run for a row that already has latitude and longitude.

`nyc-dob-permit-issuance` maps `gis_latitude` / `gis_longitude`. `nyc-dobnow-approved-permits` maps `latitude` / `longitude`. `seattle-building-permits` maps `latitude` / `longitude`. When those fields are present, the point is the publisher's. A row with those fields empty falls through to the ladder, and that fallback stays **HOLD**.

## Census geocoder

Fetched 2026-09-27.

- API PDF: `https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf`, last updated 02/2026.
- Service home: `https://geocoding.geo.census.gov/geocoder/`. It points readers to that PDF. It does not state a copyright grant or a commercial grant.
- The call the function makes: `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` with `benchmark=Public_AR_Current`.

Quoted from the PDF:

- "This document is intended for application, website, and mobile developers within the U.S. Census Bureau and the general public who want to leverage the Geocoding Services capability."
- "This service is designed for coding a provided address, or file of addresses, to a latitude/longitude coordinate based on data that's been loaded into the geocoding engine from a MAF/TIGER benchmark database."
- "The current Geocoding Services engine requires a structure address be provided. The resulting latitude/longitude is calculated along an address range."
- A benchmark name "could be `Public_AR_Current`." The sample JSON for that name describes it as "Public Address Ranges - Current Benchmark."
- "There is currently an upper limit of 10,000 records per batch file."

The PDF contains no copyright grant, no commercial-use grant, and no commercial prohibition. An audience of "the general public" and a free endpoint are not a redistribution grant. The Census Data API terms are a different document. The geocoder home page does not incorporate them, and they are not applied here. The TIGER/Line reproduction sentence below is about the shapefiles. It is not a term of this API response.

The coordinate returned for the customer's property stays **HOLD — TERMS/RIGHTS NOT ESTABLISHED**.

## OpenAddresses

Fetched 2026-09-27 from `https://raw.githubusercontent.com/openaddresses/openaddresses/master/README.md`.

Quoted from the License section:

"The data produced by the OpenAddresses processing pipeline (available on batch.openaddresses.io) is not relicensed from the original sources. Individual sources will have their own licenses."

"The source JSON in this repo (in the `sources/` directory) is licensed under the CC0 1.0 Universal (CC0 1.0) Public Domain Dedication." The rest of that repository is BSD 3-Clause. `sources/LICENSE` says the copyright of the particular datasets referenced there is not governed by the CC0 dedication. CC0 covers the source JSON. BSD covers the software. Neither is a license for the processed points.

`scripts/load-openaddresses.py` stores the collection CSV filename in `national_address_points.source`. `docs/national-address-points-setup.sql` calls that column a source id. Those filenames are not in Git. `docs/dc-geocode-no-match-receipt-2026-09-27.md` says the loaded table holds 8,545 Texas rows (Travis 6,869, Bastrop 1,554, CAPCOG 122).

Current `sources/us/tx/travis.json` and `sources/us/tx/bastrop.json` return 404. The directory contains other Texas files, including `city_of_austin.json` and `statewide.json`. None of them is identified as the file named in `national_address_points.source`. Their licenses are not applied to the stored rows.

`sources/us/tx/capcog.json`, fetched the same day, has a license object with only `"attribution name": "Capital Area Council of Governments"`. It has no license URL. Its note says CAPCOG serves Bastrop, Blanco, Burnet, Caldwell, Fayette, Hays, Lee, Llano, Travis, and Williamson Counties. The data URL in that file, the CAPCOG address-points FeatureServer, returned "Item does not exist or is inaccessible" on this retrieval. That JSON is the current OpenAddresses source record. It is not proof of which file produced the 8,545 stored rows, and it states no redistribution grant.

A coordinate from `national_address_points` stays **HOLD — TERMS/RIGHTS NOT ESTABLISHED**.

## TIGER/Line 2025 ZCTA

`docs/zip-membership-canonical.sql` names `geo.zcta_boundary` as TIGER/Line 2025 (2020 ZCTA). The 2025 national ZCTA shapefile is `https://www2.census.gov/geo/tiger/TIGER2025/ZCTA520/tl_2025_us_zcta520.zip` (HTTP 200 on 2026-09-27). The legal chapter for that vintage is `https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2025/TGRSHP2025_TechDoc_Ch1.pdf`. Chapter 3 lists ZIP Code Tabulation Areas among the statistical entities in the 2025 shapefiles. Chapter 4.23, `https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2025/TGRSHP2025_TechDoc_Ch4.pdf`, describes the "5-Digit ZIP Code Tabulation Area (ZCTA) National shapefile (2020 Census)." All three PDFs were fetched 2026-09-27.

Quoted from chapter 1:

- "The boundary information in the TIGER/Line Shapefiles is for statistical data collection and tabulation purposes only. Their depiction and designation for statistical purposes does not constitute a determination of jurisdictional authority or rights of ownership or entitlement and are not legal land descriptions."
- "TIGER/Line® is a registered trademark of the Census Bureau. TIGER/Line cannot be used as or within the proprietary product names of any commercial product including or otherwise relevant to Census Bureau data and may only be used to refer to the nature of such a product." Repackaging for distribution should carry a conspicuously placed statement to that effect.
- "Copyright protection is not available for any work of the United States Government (Title 17 U.S.C., Section 105). Thus, you are free to reproduce census materials as you see fit. We would ask, however, that you cite the Census Bureau as the source."
- The files are obtained free of charge from the Census Bureau.

The "statistical purposes only" sentence is the next sentence's subject: the depiction is not a legal boundary. The trademark sentence contemplates a commercial product that includes Census Bureau data and restricts the mark in the product name. "Reproduce census materials as you see fit," with the request to cite the Census Bureau, is the reproduction grant for these shapefiles. Obtaining the file free of charge is not that grant.

Quoted from chapter 3: the 2025 shapefiles contain "current geographic extent and boundaries of both legal and statistical entities (which have no governmental standing)."

Quoted from chapter 4.23:

- "ZCTAs are approximate area representations of USPS 5-digit ZIP Code service areas that the Census Bureau creates using census blocks to present statistical data from censuses and surveys."
- "Users should not use ZCTAs to identify the official USPS ZIP Code for mail delivery."

The polygon file is **CLEARED WITH ATTRIBUTION** for reproduction and for a statistical point-in-polygon test. The citation the Bureau asks for is the U.S. Census Bureau, TIGER/Line 2025, 2020 ZCTA. The mark TIGER/Line is not a product name. A redistribution of the file carries the conspicuous trademark statement. The result is a Census ZCTA. It is not a legal land description, a jurisdictional boundary, or the official USPS ZIP Code.

That clearance does not authorize a pin, a distance, or "near this property." Those claims need a property coordinate. The ZCTA file does not provide one. Using the polygon as if it were the official ZIP Code is the use chapter 4.23 tells the user not to make. ZIP membership in a paid property report therefore stays **HOLD**.

## Publisher rows this does not reopen

`nyc-dob-permit-issuance`, `nyc-dobnow-approved-permits`, and `seattle-building-permits` stay **CLEARED WITH ATTRIBUTION** as publisher datasets. Their own coordinates, when the mapped latitude and longitude fields are present, are part of that clearance. This stack does not take that clearance away, and it does not extend it to a property-proximity claim.

`"Not for resale"` remains product copy. It is not a Census or OpenAddresses term. The sentence is still in the function.

## Paid property-report eligibility

A paid property-scoped report still cannot use the cleared New York and Seattle rows as "near this property." The property coordinate in address mode is Census geocoder output, and that output stays **HOLD**. OpenAddresses stays **HOLD** on the fallback ladder. ZCTA membership stays **HOLD** as a proximity or official-ZIP claim. Other uncleared sources in a report payload are unchanged.

The overall verdict remains **NOT YET**. Nothing in this file is **CLEARED FOR PAID REPORT**. The paid Future Surroundings Report was not started. The other registry entries were not reclassified. The canonical audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.
