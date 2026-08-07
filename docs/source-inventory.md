# Source inventory — every source searched across the Maps / development-tracker project

**Generated 2026-08-07 by reading `supabase/functions/get-address-report/jurisdiction-registry.json`,
`scripts/source-monitor-targets.json`, `docs/source-monitor-report.md` and `docs/source-registry.md`,
plus a live read of `app_projects`. Nothing here is reconstructed from memory.**

## Method, and what this document does NOT claim

- **Table 1 (WIRED) is COMPLETE and exact.** It is the registry file joined to a live
  `app_projects` aggregate (`record_kind='development'`, the canonical measure per QUEUE.md —
  *not* `registry_id <> 'epa-frs'`, which counts the EPA facilities floor as coverage).
- **Table 3 (BARRIERS) is COMPLETE and exact.** It is the nightly monitor's own `reprobe[]` list.
- ⚠️ **Table 2 (REJECTED) is a SUBSET, and saying so is the point.** It is every pipe-table row in
  `docs/source-registry.md` that carries one of the structured disqualifier codes. Rejections
  recorded only in prose are NOT in the table — there are **70 further code-bearing prose lines**,
  and some of those are policy discussion rather than a per-source verdict. Parsing them into rows
  would mean inventing structure the source does not have. The count of what is missing is stated
  rather than the gap being hidden.
- The **enumeration vs guess** column is DERIVED, not quoted: a row counts as `enumeration` when it
  names a denominator (*N items / datasets / rows / services / layers*) or says "enumerated";
  `unreachable/guess` when the receipt is a 404 / DNS / token / 403 with no denominator. Where a
  row states neither it is marked as such rather than guessed at.

---

## 1. WIRED — 183 registry entries

175 carry live development records; **8 are DORMANT** (wired and correct, but placing nothing —
listed at the end of the table with the reason).

| registry_id | jurisdiction | platform | records | ZIP pages |
|---|---|---|---:|---:|
| `dekalb-county-building-permits` | DeKalb County, Georgia | arcgis | 290,204 | 61 |
| `overland-park-building-permits` | City of Overland Park, Kansas | arcgis | 159,115 | 38 |
| `brunswick-county-permits` | Brunswick County, North Carolina | arcgis | 154,978 | 14 |
| `sioux-falls-building-permits` | City of Sioux Falls, South Dakota | arcgis | 108,379 | 11 |
| `phoenix-building-permits` | City of Phoenix | arcgis | 95,653 | 79 |
| `massdot-highway-projects` | Massachusetts Department of Transportation | arcgis | 92,315 | 624 |
| `huntsville-building-permits` | City of Huntsville, Alabama | arcgis | 91,468 | 25 |
| `cleveland-issued-building-permits` | City of Cleveland | arcgis | 90,655 | 39 |
| `chicago-building-permits` | City of Chicago | socrata | 87,091 | 135 |
| `topeka-building-permits` | City of Topeka, Kansas | arcgis | 84,077 | 23 |
| `san-jose-permits` | City of San Jose, California | arcgis | 73,874 | 45 |
| `arlington-issued-permits` | City of Arlington | arcgis | 73,338 | 30 |
| `missoula-addresses-with-permits` | City of Missoula, Montana | arcgis | 72,261 | 10 |
| `nyc-dobnow-approved-permits` | New York City (DOB NOW) | socrata | 62,054 | 213 |
| `austin-zoning-cases` | City of Austin Planning Department | socrata | 55,928 | 83 |
| `little-rock-permits` | City of Little Rock, Arkansas | arcgis | 48,953 | 14 |
| `memphis-dpd-building-permits` | City of Memphis Division of Planning & Development | arcgis | 48,944 | 40 |
| `minneapolis-ccs-permits` | City of Minneapolis (CCS) | arcgis | 46,641 | 34 |
| `loudoun-county-residential-permits` | Loudoun County, Virginia | arcgis | 45,618 | 18 |
| `durham-building-permits` | City & County of Durham | arcgis | 41,027 | 15 |
| `charleston-county-permits` | Charleston County, South Carolina | arcgis | 37,919 | 30 |
| `new-hanover-county-building-permits` | New Hanover County, North Carolina | arcgis | 37,234 | 10 |
| `miami-building-permits` | City of Miami | arcgis | 34,907 | 24 |
| `chattanooga-permits-archive` | City of Chattanooga / Hamilton County, Tennessee | arcgis | 32,053 | 26 |
| `bentonville-catalyst-permits` | City of Bentonville, Arkansas | arcgis | 31,632 | 11 |
| `dallas-specific-use-permits` | City of Dallas | arcgis | 30,978 | 164 |
| `cabarrus-county-plan-reviews` | Cabarrus County | arcgis | 30,462 | 10 |
| `txdot-projects-info-all` | Texas Department of Transportation | arcgis | 27,089 | 666 |
| `denton-county-dev-permits` | Denton County | arcgis | 26,336 | 28 |
| `san-diego-approved-permits` | City of San Diego | csv | 23,288 | 62 |
| `ctdot-project-work-areas` | Connecticut Department of Transportation (CTDOT) | arcgis | 22,774 | 288 |
| `aurora-building-permits` | City of Aurora, Colorado | arcgis | 22,171 | 16 |
| `charlotte-land-dev-commercial-projects` | City of Charlotte | arcgis | 19,853 | 32 |
| `fairfax-recent-building-permits` | Fairfax County Land Development Services | arcgis | 19,066 | 64 |
| `slo-county-planning-permits` | San Luis Obispo County Department of Planning & Building | arcgis | 18,564 | 26 |
| `cambridge-building-permits-addition-alteration` | City of Cambridge | socrata | 16,950 | 24 |
| `detroit-trades-permits` | City of Detroit | arcgis | 15,103 | 32 |
| `nyc-dob-permit-issuance` | New York City (DOB BIS legacy) | socrata | 15,097 | 202 |
| `columbus-building-permits` | City of Columbus | arcgis | 14,423 | 49 |
| `chattanooga-building-permits` | Chattanooga-Hamilton County Regional Planning Agency | arcgis | 14,422 | 30 |
| `louisville-active-construction-permits` | Louisville Metro, Kentucky | arcgis | 14,259 | 36 |
| `virginia-beach-building-permits` | City of Virginia Beach | arcgis | 14,109 | 9 |
| `denver-commercial-construction-permits` | City and County of Denver | arcgis | 14,041 | 25 |
| `fort-worth-development-permits` | Fort Worth | arcgis | 13,877 | 37 |
| `kcmo-development-cases` | City of Kansas City, Missouri | arcgis | 13,367 | 65 |
| `burlington-vt-building-permits` | City of Burlington, Vermont — Department of Permitting & Inspections | arcgis | 13,280 | 6 |
| `new-orleans-permits` | City of New Orleans | socrata | 13,056 | 26 |
| `pierce-county-pals-permits` | Pierce County (PALS) | arcgis | 12,960 | 63 |
| `denver-residential-construction-permits` | City and County of Denver | arcgis | 12,743 | 30 |
| `tucson-residential-building-permits` | City of Tucson | arcgis | 11,869 | 29 |
| `henderson-residential-permits` | City of Henderson, Nevada | arcgis | 11,788 | 14 |
| `austin-site-plan-cases` | City of Austin | socrata | 11,715 | 46 |
| `philadelphia-li-permits` | City of Philadelphia | carto | 10,973 | 48 |
| `columbia-mo-permits` | City of Columbia, Missouri | arcgis | 10,095 | 4 |
| `knoxville-building-permits` | City of Knoxville / Knox County, Tennessee | arcgis | 9,755 | 31 |
| `lexington-row-permits` | Lexington-Fayette Urban County Government | arcgis | 8,802 | 16 |
| `adams-county-building-permits` | Adams County, Colorado | arcgis | 8,159 | 10 |
| `albuquerque-building-permits` | City of Albuquerque, New Mexico | arcgis | 8,012 | 24 |
| `new-castle-county-permits` | New Castle County, Delaware | arcgis | 7,975 | 44 |
| `bend-or-permit-applications` | City of Bend, Oregon | arcgis | 7,928 | 4 |
| `fairfax-active-site-construction` | Fairfax County Land Development Services | arcgis | 7,864 | 47 |
| `nashville-building-permits-issued` | Metro Nashville-Davidson County | arcgis | 7,809 | 36 |
| `centre-county-pa-building-permits` | Centre County, Pennsylvania | arcgis | 7,692 | 34 |
| `clv-planning-cases` | City of Las Vegas | arcgis | 7,653 | 36 |
| `mdot-stip-projects` | Michigan Department of Transportation | arcgis | 7,410 | 292 |
| `worcester-building-permits` | City of Worcester, Massachusetts | arcgis | 7,283 | 9 |
| `anne-arundel-subdivision-activity` | Anne Arundel County, Maryland — Office of Planning and Zoning | arcgis | 7,148 | 37 |
| `desoto-county-permits` | DeSoto County, Mississippi | arcgis | 7,105 | 10 |
| `spokane-county-building-planning-permits` | Spokane County, Washington | arcgis | 6,737 | 29 |
| `montgomery-county-residential-permits` | Montgomery County | socrata | 6,685 | 44 |
| `sheridan-county-building-permits` | Sheridan County, Wyoming | arcgis | 6,492 | 12 |
| `wake-county-building-permits` | Wake County | arcgis | 6,438 | 37 |
| `montgomery-county-pa-act247-proposals` | Montgomery County Planning Commission | arcgis | 6,113 | 64 |
| `portland-building-permits` | City of Portland | arcgis | 6,052 | 39 |
| `raleigh-building-permits` | City of Raleigh | arcgis | 5,968 | 19 |
| `detroit-building-permits` | City of Detroit | arcgis | 5,919 | 32 |
| `seattle-building-permits` | City of Seattle | socrata | 5,836 | 29 |
| `canyon-county-building-permits` | Canyon County, Idaho | arcgis | 5,663 | 15 |
| `johns-creek-building-permits` | City of Johns Creek, Georgia | arcgis | 5,557 | 8 |
| `tacoma-accela-permits` | City of Tacoma | arcgis | 5,245 | 17 |
| `delaware-county-pa-subdivisions-land-developments` | Delaware County, Pennsylvania | arcgis | 5,243 | 40 |
| `lee-county-fl-development-orders` | Lee County, Florida | arcgis | 4,851 | 35 |
| `pittsburgh-pli-permits` | City of Pittsburgh | ckan | 4,781 | 27 |
| `asheville-accela-permits` | City of Asheville | arcgis | 4,628 | 9 |
| `austin-subdivision-cases` | City of Austin | socrata | 4,515 | 45 |
| `henderson-commercial-permits` | City of Henderson, Nevada | arcgis | 4,449 | 17 |
| `fdot-active-construction-projects` | Florida Department of Transportation | arcgis | 4,394 | 357 |
| `allentown-energov-building-permits` | City of Allentown, Pennsylvania | arcgis | 4,038 | 5 |
| `kent-county-de-building-permits` | Kent County, Delaware | arcgis | 4,017 | 19 |
| `salem-structure-permits` | City of Salem, Oregon | arcgis | 3,899 | 9 |
| `burlington-vt-zoning-permits` | City of Burlington, Vermont — Department of Permitting & Inspections (Zoning) | arcgis | 3,888 | 6 |
| `kcmo-building-permits` | City of Kansas City, Missouri | arcgis | 3,716 | 49 |
| `colorado-springs-planning-applications` | City of Colorado Springs | arcgis | 3,702 | 29 |
| `savannah-commercial-building-permits` | City of Savannah / Chatham County | arcgis | 3,550 | 14 |
| `anne-arundel-commercial-site-plans` | Anne Arundel County, Maryland — Office of Planning and Zoning | arcgis | 3,544 | 37 |
| `peoria-az-building-permits` | City of Peoria, Arizona | arcgis | 3,508 | 9 |
| `hartford-building-permits` | City of Hartford | arcgis | 3,486 | 9 |
| `tempe-building-permits` | City of Tempe | arcgis | 3,343 | 4 |
| `boston-approved-building-permits` | City of Boston | ckan | 3,271 | 29 |
| `mesa-building-permits` | City of Mesa | socrata | 3,117 | 25 |
| `cincinnati-building-permits` | City of Cincinnati | socrata | 2,952 | 30 |
| `nvdot-project-boundaries` | Nevada Department of Transportation | arcgis | 2,928 | 139 |
| `wsdot-project-delivery-plan-complete` | Washington State Department of Transportation (WSDOT) | arcgis | 2,634 | 297 |
| `lincoln-residential-new-construction-permits` | City of Lincoln, Nebraska | arcgis | 2,611 | 36 |
| `murfreesboro-building-permits` | City of Murfreesboro, Tennessee | arcgis | 2,598 | 9 |
| `forsyth-county-ga-building-permits` | Forsyth County, Georgia | arcgis | 2,485 | 3 |
| `independence-twp-construction-permits` | Independence Township (Oakland County) | arcgis | 2,475 | 9 |
| `chester-county-pa-act247-plans` | Chester County, Pennsylvania | arcgis | 2,465 | 39 |
| `york-county-pa-planning-subdivisions` | York County, Pennsylvania | arcgis | 2,456 | 46 |
| `madison-planning-projects` | City of Madison | arcgis | 2,427 | 20 |
| `baltimore-county-permits` | Baltimore County | arcgis | 2,319 | 50 |
| `coconino-county-permits` | Coconino County, Arizona | arcgis | 1,930 | 16 |
| `hdot-active-design-projects` | Hawaii Department of Transportation (HDOT) — Active Design Projects | arcgis | 1,848 | 85 |
| `ann-arbor-energov-permits` | City of Ann Arbor | arcgis | 1,831 | 9 |
| `wisdot-highway-program-6yr` | Wisconsin Department of Transportation (WisDOT) — 6-Year Highway Improvement Program | arcgis | 1,822 | 201 |
| `boone-county-ky-planning-board-actions` | Boone County Planning Commission | arcgis | 1,687 | 16 |
| `tucson-commercial-building-permits` | City of Tucson | arcgis | 1,477 | 26 |
| `columbia-mo-capital-projects` | City of Columbia, Missouri | arcgis | 1,439 | 6 |
| `thurston-county-residential-permits` | Thurston County, Washington | arcgis | 1,287 | 12 |
| `east-baton-rouge-building-permits` | City of Baton Rouge / Parish of East Baton Rouge | socrata | 1,254 | 24 |
| `butler-county-ks-permits` | Butler County | arcgis | 1,208 | 15 |
| `boulder-construction-permits` | City of Boulder | arcgis | 1,165 | 5 |
| `naperville-building-permits` | City of Naperville, Illinois | arcgis | 1,088 | 4 |
| `gilbert-energov-permits` | Town of Gilbert | arcgis | 1,036 | 9 |
| `arlington-permit-applications` | City of Arlington | arcgis | 1,033 | 25 |
| `frisco-active-building-permits` | City of Frisco | arcgis | 1,020 | 8 |
| `wsdot-project-delivery-plan-under-construction` | Washington State Department of Transportation (WSDOT) | arcgis | 966 | 238 |
| `udot-active-projects` | Utah Department of Transportation | arcgis | 947 | 109 |
| `bozeman-building-permits` | City of Bozeman, Montana | arcgis | 933 | 2 |
| `akdot-stip-24-27` | Alaska Department of Transportation & Public Facilities (AKDOT&PF) — STIP FFY 2024-2027 (Approved Final) | arcgis | 909 | 28 |
| `clark-county-active-projects` | Clark County, Nevada — Public Works | arcgis | 909 | 62 |
| `arlington-planning-cases` | City of Arlington | arcgis | 860 | 27 |
| `cambridge-demolition-permits` | City of Cambridge | socrata | 857 | 23 |
| `irving-development-permits` | City of Irving | arcgis | 824 | 19 |
| `mdot-sha-project-portal` | Maryland Department of Transportation State Highway Administration (MDOT SHA) — Project Portal | arcgis | 818 | 215 |
| `nj-stip-projects` | New Jersey Department of Transportation | arcgis | 815 | 267 |
| `fort-collins-building-permits` | City of Fort Collins | arcgis | 810 | 5 |
| `anaheim-land-use-cases` | City of Anaheim | arcgis | 796 | 7 |
| `detroit-demolition-permits` | City of Detroit | arcgis | 788 | 28 |
| `wsdot-project-delivery-plan-proposed` | Washington State Department of Transportation (WSDOT) | arcgis | 731 | 253 |
| `marin-county-building-permits` | County of Marin | socrata | 714 | 23 |
| `buffalo-building-permits` | City of Buffalo | socrata | 690 | 17 |
| `adot-tip-fy2026-2030` | Arizona Department of Transportation (ADOT) — adopted FY2026-2030 Transportation Improvement Program | arcgis | 685 | 181 |
| `weld-county-site-plan-review` | Weld County, Colorado | arcgis | 592 | 11 |
| `slc-planning-petitions` | Salt Lake City | arcgis | 570 | 12 |
| `cambridge-building-permits-new-construction` | City of Cambridge | socrata | 528 | 23 |
| `sussex-county-de-conditional-use` | Sussex County, Delaware | arcgis | 461 | 22 |
| `maine-dot-public-projects` | Maine Department of Transportation | arcgis | 444 | 171 |
| `reno-ldc-projects` | City of Reno | arcgis | 442 | 15 |
| `allegheny-county-asbestos-permits` | Allegheny County Health Department | ckan | 421 | 77 |
| `vtrans-project-locations` | Vermont Agency of Transportation (VTrans) | arcgis | 414 | 120 |
| `cook-county-il-highway-construction-program` | Cook County Department of Transportation and Highways | arcgis | 403 | 127 |
| `bellevue-permits` | City of Bellevue | arcgis | 348 | 6 |
| `clark-county-active-dev-permits` | Clark County | arcgis | 347 | 20 |
| `stamford-major-developments` | City of Stamford | arcgis | 347 | 10 |
| `kenton-county-devtracking-permits` | Planning & Development Services of Kenton County | arcgis | 338 | 15 |
| `seattle-land-use-permits` | City of Seattle | socrata | 326 | 26 |
| `san-marcos-planning-cases` | San Marcos | arcgis | 318 | 1 |
| `iowa-dot-bid-projects` | Iowa Department of Transportation | arcgis | 255 | 60 |
| `champaign-il-special-use-permits` | City of Champaign, Illinois | arcgis | 255 | 10 |
| `flathead-county-building-permits` | Flathead County, Montana | arcgis | 253 | 1 |
| `aldot-rebuild-alabama-grant-projects` | Alabama Department of Transportation (ALDOT) — Rebuild Alabama Annual Grant Program | arcgis | 227 | 83 |
| `scottsdale-building-permits` | City of Scottsdale | arcgis | 216 | 13 |
| `provo-planning-applications` | Provo | arcgis | 193 | 4 |
| `prince-georges-county-permits` | Prince George's County | socrata | 185 | 29 |
| `aldot-atrip-ii-projects` | Alabama Department of Transportation (ALDOT) — ATRIP-II | arcgis | 184 | 83 |
| `san-antonio-permits-issued` | San Antonio | arcgis | 167 | 1 |
| `casa-grande-active-development-sites` | City of Casa Grande | arcgis | 85 | 3 |
| `lake-county-il-construction-program` | Lake County, Illinois Division of Transportation | arcgis | 80 | 28 |
| `fort-worth-zoning-cases` | City of Fort Worth Development Services | arcgis | 54 | 43 |
| `round-rock-large-development-projects` | Round Rock | arcgis | 44 | 6 |
| `stlouis-county-mo-subdivisions` | St. Louis County, Missouri (unincorporated) | arcgis | 41 | 17 |
| `summit-county-oh-planning-commission-items` | Summit County Planning Commission | arcgis | 36 | 14 |
| `clarksville-montgomery-final-subdivisions` | Clarksville-Montgomery County Regional Planning Commission | arcgis | 34 | 4 |
| `clarksville-montgomery-preliminary-subdivisions` | Clarksville-Montgomery County Regional Planning Commission | arcgis | 16 | 4 |
| `austin-issued-construction-permits` | City of Austin | socrata | **0** | **0** |
| `harris-county-permits` | Harris County Permits | arcgis | **0** | **0** |
| `harris-county-plats` | Harris County Permits (unincorporated / non-Houston) | arcgis | **0** | **0** |
| `houston-plat-applications` | City of Houston Planning & Development Department | arcgis | **0** | **0** |
| `montgomery-county-commercial-permits` | Montgomery County | socrata | **0** | **0** |
| `montgomery-county-demolition-permits` | Montgomery County | socrata | **0** | **0** |
| `san-antonio-prelim-plan-review` | City of San Antonio | arcgis | **0** | **0** |
| `shelby-county-building-permits` | Shelby County, Tennessee | opendatasoft | **0** | **0** |

**The 8 dormant entries, with why:**

- `austin-issued-construction-permits` — 0 cached records — superseded on TX/Travis pages by austin-zoning-cases / -site-plan / -subdivision. Live-probed 2026-08-07: 200/200 rows carry a real link.url, so the entry is correct, not broken.
- `harris-county-permits` — Harris County has ONE modeled ZIP page (77393), whose centroid is in Conroe ~50 mi north and outside the county. Dormant behind the coverage gate until a Harris ZIP expansion.
- `harris-county-plats` — Same Harris County surface problem.
- `houston-plat-applications` — Same Harris County surface problem.
- `montgomery-county-commercial-permits` — MD/Montgomery — no records placed in the current window.
- `montgomery-county-demolition-permits` — MD/Montgomery — no records placed in the current window.
- `san-antonio-prelim-plan-review` — TX/Bexar — no records placed in the current window.
- `shelby-county-building-permits` — TN/Shelby, the only `opendatasoft` entry — no records placed in the current window.

---

## 2. REJECTED — 39 structured rows extracted from `docs/source-registry.md`

`what was probed` is the nearest non-numeric cell before the verdict — a bare number in these
tables is a page or row count, not an endpoint, so it is rendered `—` rather than passed off as one.

| jurisdiction / target | what was probed | disqualifier | receipt | enum or guess | line |
|---|---|---|---|---|---:|
| Lucas | — | `NO_TEMPORAL_FIELD` | exhausted —  (this section) | stated, no denominator in row | 5605 |
| St. Louis | `AGS_ZoningPetitions` (3,945 rows) | `NO_TEMPORAL_FIELD` | 0 of 3,945 dated, `max(last_edited_date)` null. Also opaque *and* dirty: 62% blank, petition numbers (`32-15`, `44-25`) leaking into the procedure column | enumeration | 5701 |
| St. Louis | `Active_Construction` Points/Lines | `NO_TEMPORAL_FIELD` | no date field in the schema. (Both 404'd on `/0`: `preserveLayerIds: true`, real ids 101/100, and the 404s arrived as HTTP 200 carrying an error object) | unreachable/guess | 5702 |
| St. Louis | `PlanningLocationBasedProto` | `WRONG_RECORD_CLASS` | marijuana/tobacco/liquor/childcare licences | stated, no denominator in row | 5703 |
| Jackson | KCMO BLDS `ntw8-aacc` | `STALE` | , re-probed and unmoved — `max(:updated_at)` = `2025-05-09T20:22:20.907Z`, byte-identical to the 2026-07-17 record over 681,036 rows. Three further months, no movement. S | enumeration | 5705 |
| St. Charles | `Zoning Application` (735), `PUD` (47) | `NO_TEMPORAL_FIELD` | no date field | stated, no denominator in row | 5709 |
| Greene | Springfield org `aOss8CrQf3pARS5q` | `candidates_exhausted` | entity confirmed by name; only redevelopment-area polygons (Ch. 99 / Ch. 353), comprehensive-plan goal layers and `Springfield Subdivisions`. No permit or case ledger | stated, no denominator in row | 5711 |
| Franklin · Jefferson | — | `candidates_exhausted` | no first-party org found. Content-scoped searches returned only cross-state noise (Indiana DNR, Virginia Tech, BLM national) and personal accounts with no `orgId` | stated, no denominator in row | 5713 |
| Madison | `MadisonCounty_DevelopmentChange_1995_2025` | `NO_TEMPORAL_FIELD` | 324 polygons whose entire schema is `LOCALE`, `LOCALE2`, `TYPE`. A 30-year land-use change study, not a filing register | stated, no denominator in row | 5766 |
| Winnebago | Rockford `CIP Web Map` | `NO_TEMPORAL_FIELD` | 90 points, fields are `name`/`TabName`/`description`/`pic_url`/`shortlist_id`/`tab_id`: an Esri Shortlist app data layer with no date of any kind. ⚠️ Corrects the prior " | enumeration | 5767 |
| Champaign | layer 19 `Zoning - Planned Developments` | `NO_TEMPORAL_FIELD` | GIS edit stamps only | stated, no denominator in row | 5770 |
| Kane | Aurora org (217 services) | `WRONG_RECORD_CLASS` | `AFD_FirePrev_Permits_Dates` — fire-prevention inspections, | enumeration | 5774 |
| AK | — | `NO_TEMPORAL_FIELD` | 🚫 | stated, no denominator in row | 5992 |
| WV | — | `candidates_exhausted` | 🚫 | enumeration | 5993 |
| Rochester | Monroe | `NO_TEMPORAL_FIELD` | 🚫 | stated, no denominator in row | 6324 |
| Albany | Albany | `candidates_exhausted` | 🚫 | stated, no denominator in row | 6326 |
| Orange | AGO title search 5 items · OC org (`UXmFoWC7yDHcDN5Q`) scoped `permits | `candidates_exhausted` |  | enumeration | 6589 |
| Alameda | county DCAT 163 datasets → 1 zoning polygon, 0 permits · Berkeley Socr | `candidates_exhausted` |  | enumeration | 6590 |
| Contra Costa | AGO search 8 items → 0 · county server `INTERNET` folder → 1 base-data | `candidates_exhausted` |  | enumeration | 6591 |
| Sonoma | AGO org 118 items → septic + coastal-commission jurisdiction · AGO sea | `WRONG_RECORD_CLASS` |  | enumeration | 6592 |
| Ventura | AGO search 35 items · county server `DataDownloads` → 22 services, onl | `STALE` |  | enumeration | 6593 |
| San Mateo | AGO search 28 items → 0 · AGO search 131 items → only the county CIP · | `NO_TEMPORAL_FIELD` |  | enumeration | 6594 |
| `INDOT Projects` (`services5…/INDOT_Projects`) | — | `SUB_THRESHOLD` | 3 rows. Owner `arcgis_svc`, modified 2016. . | enumeration | 7307 |
| `TIP_Point` / `TIP_Links` | — | `SUB_THRESHOLD` | 4 rows. Owner `MinaeiN_cdmsmith` — CDM Smith, a private consultancy, not INDOT.  + not first-party. | enumeration | 7308 |
| Indianapolis `data.indy.gov` (651 datasets) | — | `WRONG_RECORD_CLASS` | 31 permit/zoning-titled candidates, and every one is a historical zoning ORDINANCE document — the 1948 county ordinance, amendments `67-AO-1`, `75-AO-2`, `97-AO-11` … — w | enumeration | 7311 |
| AK | — | `NO_TEMPORAL_FIELD` | 🚫 | stated, no denominator in row | 7454 |
| RI | — | `NO_TEMPORAL_FIELD` | 🚫 | stated, no denominator in row | 7455 |
| WV | — | `candidates_exhausted` | 🚫 | stated, no denominator in row | 7457 |
| Prince George's MD | 36 / 36 / 17 | `STALE` | 🚫  — a real 12,231-row ledger that stopped in 2024 | stated, no denominator in row | 7677 |
| Harford MD | 20 / 18 / 16 | `candidates_exhausted` | 🚫  — 203 org items, 0 ledgers | stated, no denominator in row | 7678 |
| Frederick MD | 33 / 15 / 14 | `candidates_exhausted` | 🚫  — 207 org items, 0 ledgers | stated, no denominator in row | 7680 |
| Howard MD | 21 / 16 / 11 | `NO_GEOGRAPHY` | 🚫  — 61,857 real permits, no address, no coords | stated, no denominator in row | 7681 |
| NY | Monroe (Rochester) | `NO_TEMPORAL_FIELD` | rejected | stated, no denominator in row | 7861 |
| Indianapolis (Marion IN) | — | `candidates_exhausted` | 🚫 | enumeration | 7965 |
| Providence (RI) | — | `STALE` | 🚫 | stated, no denominator in row | 7966 |
| Omaha (Douglas NE) | — | `WRONG_RECORD_CLASS` | 🚫 | stated, no denominator in row | 7967 |
| Oklahoma City | — | `EDGE_EGRESS_BLOCKED` | 🚫 | unreachable/guess | 7968 |
| WV statewide (2nd try) | — | `WRONG_RECORD_CLASS` | 🚫 | stated, no denominator in row | 7972 |
| Honolulu | — | `STALE` | 🚫  by the publisher's own statement | stated, no denominator in row | 8019 |

---

## 3. BARRIERS — 17 hosts on the nightly reprobe (neither wired nor rejected)

These are blocked by **infrastructure** (WAF / SSL / DNS / dead host) or **stalled publishing**,
not by a disqualifier. `source-monitor.yml` re-probes every one nightly at 07:00 UTC and
auto-wires anything that recovers AND passes the fail-closed gate. Latest run
`2026-08-07T08:13:08Z`: 18 re-probed, 44 catalogs walked, **195 candidates evaluated,
auto-wired: none**, 141 flagged for connector work.

| target | jurisdiction | endpoint probed | recorded failure mode |
|---|---|---|---|
| `denton-county-dev-permits` | Denton County | `https://gis.dentoncounty.gov/arcgis/rest/services/DEV_Permits/MapServer/0` | 2026-07-13: frozen archive — newest record Jun 2023 (source-registry.md) |
| `mckinney-underconstruction` | McKinney | `https://services1.arcgis.com/B8MwidgHpU2dWUmv/arcgis/rest/services/UnderConstruction/FeatureServer/0` | 2026-07-13: stale — newest IssueDate Sep 2023 (source-registry.md) |
| `frisco-active-building-permits` | Frisco | `https://geo.friscotexas.gov/arcgis/rest/services/Layers_External/MapServer/77` | 2026-07-13: host blocks external IPs (TLS handshake timeout) — feed exists but unreachable |
| `frisco-active-zoning-sup-cases` | Frisco | `https://geo.friscotexas.gov/arcgis/rest/services/Layers_External/MapServer/73` | 2026-07-13: host blocks external IPs (TLS handshake timeout) |
| `allen-current-development-projects` | Allen | `https://gismaps.cityofallen.org/arcgis/rest/services/CommunityDevelopment/Current_Development_Projects/FeatureServer/0` | 2026-07-13: POLYGON geometry with intersection-style locations — no point/ZIP path without new connector code |
| `el-paso-new-commercial` | El Paso | `https://gis.elpasotexas.gov/arcgis/rest/services/Planning/NewCommercial/MapServer/0` | 2026-07-13: broken attributes — blank statuses, year values in non-year fields |
| `el-paso-accela-building-permits` | El Paso | `https://gis.elpasotexas.gov/dev/rest/services/OpenData_Accela/BuildingPermits/FeatureServer/0` | 2026-07-13: OpenData_Accela extract probed during the max-coverage pass; did not pass the gate |
| `dallas-building-permits-e7gq` | Dallas | `www.dallasopendata.com` | 2026-07-13: frozen — dataset not updated for years |
| `dallas-building-permits-6ik7` | Dallas | `www.dallasopendata.com` | 2026-07-13: frozen — dataset not updated for years |
| `denton-city-portal` | Denton (city) | `data.cityofdenton.com` | 2026-07-13: portal dead (404) |
| `plano-portal` | Plano | `dashboard.plano.gov` | 2026-07-13: catalog only federates OTHER cities' datasets (Orlando/NOLA/NYC); no first-party permit resource |
| `aurora-open-data` | Aurora | `https://data.auroragov.org/api/feed/dcat-us/1.1.json` | 2026-07-14: DNS does not resolve (ENOTFOUND) during the CO pass |
| `douglas-co-dcat` | Douglas County CO | `https://data-dougco.opendata.arcgis.com/api/feed/dcat-us/1.1.json` | 2026-07-14: HTTP 500 CONT_0001 Item does not exist or is inaccessible |
| `stpaul-approved-building-permits` | Saint Paul | `https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Approved_Building_Permits/FeatureServer/0` | 2026-07-15: STALLED snapshot - max ISSUEDATE 2025-06-30 (>12 months). Right shape (point, STATUS, FOLDER_TYPE Building/Demolition); wire if the city resumes publishing. |
| `worcester-building-permits` | Worcester | `https://services1.arcgis.com/j8dqo2DJE7mVUBU1/arcgis/rest/services/Building_Permits/FeatureServer/0` | 2026-07-15: STALLED snapshot - newest Permit_License_Issued_Date 2025-09-09 (10 months; verified by order-by-desc — LIKE counts on this hosted table are unreliable). Right shape otherwise (5 |
| `syracuse-permit-requests` | Syracuse | `https://services6.arcgis.com/bdPqSfflsdgFRVVM/arcgis/rest/services/Permit_Requests/FeatureServer/0` | 2026-07-15: STALLED snapshot - newest Issue_Date 2025-08-16 (11 months). Right shape (47,902 points, Permit_Number/Full_Address/Issue_Date/Permit_Type/LAT/LONG; no status column -> status_co |
| `howard-county-permits` | Howard County | `opendata.howardcountymd.gov` | 2026-07-16: STALLED — newest issue_date rows Nov 2025, rowsUpdatedAt 2025-12-04 (recon receipts, DB-outage recon night); also no status/point columns (would be status_const + zip-only) |

**Plus the edge-egress class, which is NOT on the reprobe list and cannot be settled by probing:**
El Paso (145 pages) · Miami-Dade (80) · Hillsborough/Tampa (58) = **283 pages**. Each was diagnosed
*specifically because* pg_net gets 200 while the Supabase edge runtime gets 403 or times out, so a
200 from the sandbox or a CI runner is the expected reading in BOTH the broken and the fixed state
(Rule 13). ⚠️ **El Paso was additionally re-probed 2026-08-07 and reclassified BARRIER → SUPPLY**:
its live, fresh `Planning/NewCommercial` layer passes every structural check, but max `ISSUEDATE`
among rows carrying a status is **2019-10-31** and **100% of in-window rows are blank-status**, so
it emits 0 at any sane window and the WAF is irrelevant to the outcome.
