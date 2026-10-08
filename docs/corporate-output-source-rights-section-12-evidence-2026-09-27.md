# Section 12 evidence pass — 2026-09-27

Evidence for the blockers in `docs/corporate-output-source-rights-audit-2026-09-27.md` §12. The audit stays the matrix. Its blob on this commit's parent is `c2cc94524ee2d21af47520254703d4a222344c66`. The verdict stays **NOT YET**. No source moves to **CLEARED FOR PAID REPORT**. The paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `06d9381c1da66ac4217dd3c4c6622d8bed741f6d` ("Step 12 (C8): daily data-centre address-check monitor on the one health path (#1405)").

## Blocker status

| §12 | After this pass | Evidence added |
|---|---|---|
| 1. `"Not for resale"` | **OPEN.** Reason still absent from Git. Payload stays **HOLD**. | PR #113 body re-read. It describes the ZIP page and anti-fabrication. It does not mention resale, a license, or a publisher. The code commits that introduce the sentence are still `56a82ff` (#113) and `a439b2f` (#186). |
| 2. Jurisdiction-registry terms | **OPEN.** All 240 stay **HOLD**. | Registry re-counted. No entry has a license or terms field. |
| 3. OSM evidence inside Compute Atlas | **OPEN.** Atlas pins stay **HOLD**. | No written exclusion decision in this pass. |
| 4. ODbL rows together with CC BY rows | **OPEN.** | No professional review in this pass. |
| 5. Geocoder, OpenAddresses, ZCTA, before any distance, pin, or "near" claim | **OPEN** for that claim. The polygon file's publisher text is now quoted below. The claim stays **HOLD** because the point inputs are still uncleared and the polygon page does not grant a paid proximity product. | TIGER/Line 2025 technical documentation chapter 1, Census geocoder API PDF (updated 02/2026), OpenAddresses README, and the current CAPCOG source JSON. |
| 6. Per-publisher and per-jurisdiction news and meetings terms | **OPEN.** | Not collected in this pass. NWS remains the audit's measured exception and is not a property-proximity grant. |
| 7. Scores, outlooks, QoL, predictive prose | **OPEN** as a rule for any future corporate template. | No corporate template exists in this repo. `reports.html` is still the consumer waitlist. Those fields were left on the consumer site. |

## 2. Jurisdiction registry

`supabase/functions/get-address-report/jurisdiction-registry.json` on this SHA: **240** entries (`arcgis` 212, `socrata` 22, `ckan` 3, `csv` 1, `carto` 1, `opendatasoft` 1). Every entry has `registry_id`, `platform`, `dataset_url`, `jurisdiction`, `coverage`, `column_map`, and `status_to_bucket`. None has a license, terms, or copyright field.

`commercial_work_evidence` is present on **30** entries (16 with a `qualifying` work-class list, 14 `unresolved`) and absent on **210**. That field decides whether a permit type is commercial construction work. It is not a redistribution grant. Words such as "license" inside receipts are permit types or publisher names (`copyrightText` values already treated as identity in the audit). `iowa-dot-five-year-program` still records that `serviceDescription` and `copyrightText` are empty.

Empty metadata remains the absence of permission. This count does not clear a portal.

## 5. Geography inputs

### TIGER/Line Shapefiles, the polygon vintage named in Git

`docs/zip-membership-canonical.sql` says `geo.zcta_boundary` is TIGER/Line 2025 (2020 ZCTA delineation). The publisher chapter fetched 2026-09-27 is `https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2025/TGRSHP2025_TechDoc_Ch1.pdf`.

Quoted from that chapter:

- "The boundary information in the TIGER/Line Shapefiles is for statistical data collection and tabulation purposes only. Their depiction and designation for statistical purposes does not constitute a determination of jurisdictional authority or rights of ownership or entitlement and are not legal land descriptions."
- "TIGER/Line® is a registered trademark of the Census Bureau. TIGER/Line cannot be used as or within the proprietary product names of any commercial product including or otherwise relevant to Census Bureau data and may only be used to refer to the nature of such a product." Repackaging should carry a conspicuously placed statement to that effect.
- "Copyright protection is not available for any work of the United States Government (Title 17 U.S.C., Section 105). Thus, you are free to reproduce census materials as you see fit. We would ask, however, that you cite the Census Bureau as the source."
- The files are obtained free of charge from the Census Bureau.

That page is a reproduction statement plus a trademark limit plus a disclaimer that the boundaries are statistical and are not legal land descriptions. It does not say a brokerage may sell point-in-polygon ZIP membership as "near this property." The "statistical purposes only" sentence and the "reproduce as you see fit" sentence are both on the page. This pass does not collapse them into a commercial grant. ZCTA membership in a paid report stays **HOLD — TERMS/RIGHTS NOT ESTABLISHED**. Citing the Census Bureau would be required if a later review clears reproduction of the file. The mark TIGER/Line stays unavailable as a product name.

### Census geocoder

`https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf`, last updated 02/2026, fetched 2026-09-27. The audience line includes the general public. The document describes single-record and batch requests. Batch files have an upper limit of 10,000 records. The PDF contains no copyright grant, no commercial-use grant, and no commercial prohibition. The Census Data API terms remain a different document and are not applied here. Geocoder output stays **HOLD**.

### OpenAddresses

README fetched 2026-09-27 from `https://raw.githubusercontent.com/openaddresses/openaddresses/master/README.md`. The processed data "is not relicensed from the original sources. Individual sources will have their own licenses." Source JSON in that repository is CC0. The processed address points are not.

`docs/dc-geocode-no-match-receipt-2026-09-27.md` says the loaded table holds 8,545 Texas rows (Travis, Bastrop, CAPCOG). The loader stores the collection CSV filename in `national_address_points.source`. Those filenames are not in Git. Current `sources/us/tx/` has no `travis.json` and no `bastrop.json`. `sources/us/tx/capcog.json` was fetched the same day. Its license object is only `"attribution name": "Capital Area Council of Governments"`. It has no license URL. Its note says CAPCOG serves Bastrop, Blanco, Burnet, Caldwell, Fayette, Hays, Lee, Llano, Travis, and Williamson Counties. That file is the current OpenAddresses source record. It is not proof of which file produced the 8,545 stored rows.

A coordinate from `national_address_points` stays **HOLD** until the license of the file that produced that row is recorded.

## Allowlist

Audit §6 is unchanged. A paid artifact may still contain only the buyer-supplied address, HomeSignal-authored clearance text, Epoch AI publisher text fields with attribution, and NWS alert text with attribution. Distance, a pin, and "near this property" stay off that list.

## Still required before a paid report

The seven §12 items above. Items 3 and 4 need a written decision this pass does not make. Item 6 needs per-publisher and per-jurisdiction terms. Item 1 needs the reason for the resale sentence from someone who can supply it. Item 2 needs each portal's own terms, one jurisdiction at a time, before that portal's records are shown.
