# Atlas coordinate validation — national dry-run receipt (2026-09-25)

`dc-atlas-dryrun.yml` run **36078120976**, job 107893954044, head `37c2209`, conclusion **success**.
Production was only read (one read-only SELECT per session, 2 s lock timeout). Everything else ran on a
disposable replica on production's own image (`supabase/postgres:17.6.1.127`).

**Nothing in this receipt is applied.** Phase A is `docs/dc-atlas-validation-apply.sql`, the evidence
acquisition. Phase D simulates the one-line admission switch on the replica only.

## Parity (the replica is production)
```
7/7 definitions fingerprint as main (f9d1326), on production and on the replica
PRODUCTION_POSTGIS_VERSION_PARITY PASS: 17.6, POSTGIS 3.3.7 / GEOS 3.14.1 / PROJ 9.7.1
REPLICA_SCHEMA_PARITY PASS: 121 signature rows equal on both sides
registry ZIP pages checked: 12722
production 1814 rows md5 f687efb08ff443e279ccbba8baa5494f
replica    1814 rows md5 f687efb08ff443e279ccbba8baa5494f
baseline (main's own resolvers on the replica): ENTITIES_MINTED 0, OBSERVATIONS_RELINKED 0, ROWS_WRITTEN 0; 1814 vs 1814
```

## Queue and ladder (measured)
```
main queue: 0   branch queue: 763   (admitted|not admitted: 0|763)
derived 763 of 763 queued address(es) through the production ladder: {"range_interpolated":624,"failed":139}
DCG_TIMING addresses=763 total_s=407.7 ladder_ms_p50=202 p95=414 max=1458 pacing_ms=300
```

## Report (verbatim)
```
C01 TOTAL_CURRENT_ATLAS_RECORDS|2187
C02 HAS_PUBLISHED_ADDRESS|876
C03 GEOCODABLE_SITE_ADDRESS|776
C04 BLANK_ADDRESS|1311
C05 NO_HOUSE_NUMBER|91
C06 HOUSE_NUMBER_RANGE|4
C07 NO_LOCALITY|5
C08 OTHER_INPUT_REJECTION|0
C09 DISTINCT_GEOCODABLE_QUERIES|763
RC_C RECONCILES (C03+C05+C06+C07+C08 = C02, C02+C04 = C01)|true
D01 QUEUED (geocodable records)|776
D02 ACCEPTED_SINGLE_MATCH|627
D03 REJECTED_NO_MATCH|143
D04 REJECTED_MULTIPLE_MATCH|6
D05 FAILED (other rejection or not derived)|0
RC_D RECONCILES (D02..D05 = D01)|true
V01 ACCEPTED_DERIVED_POINTS|627
V02 WITHIN_UNCERTAINTY (publisher site point <= derived bound)|559
V03 BEYOND_UNCERTAINTY|48
V04 PUBLISHER_NON_SITE|19
V05 PUBLISHER_UNUSABLE|1
V06 NO_PUBLISHER_POINT|0
RC_V RECONCILES (V02..V06 = V01)|true
V07 SAME_ZIP (site pairs; diagnostic)|580
V08 CROSS_ZIP (site pairs; diagnostic)|27
V09 SAME_ZIP_BUT_BEYOND_UNCERTAINTY (a bad point a ZIP test would have passed)|30
V10 SITE_PAIR_DISTANCE_M p50/p95/max|115 / 3310 / 69221
G00 ATLAS_ENTITIES|2187
G PUBLISHER_UNUSABLE_OR_NONE|34
G PLACED_BY_DERIVED_ADDRESS|20
G NO_DERIVED_EVIDENCE|1190
G CONFLICT|48
G CORROBORATED|559
G PUBLISHER_NON_SITE|336
RC_G RECONCILES (G buckets = G00)|true
M00 REGISTRY_ZIP_PAGES_CHECKED|12722
M01 ROWS before / phaseA / phaseD|1814 / 1814 / 1790
M02 ZIP_PAGES_WITH_A_MARKER before / phaseA / phaseD|758 / 758 / 746
M03 FACILITIES before / phaseA / phaseD|1814 / 1814 / 1790
M04_PHASE_A_ROW_DELTA_ZERO|0
M05_PHASE_A_GEOGRAPHY_DECISION_DELTA_ZERO|0
M06 ADDED|1
M07 REMOVED|25
M08 MOVED|0
M09 ZIP_CHANGED|0
M10 UNCHANGED|1789
RC_M RECONCILES (M06..M10 = union of facilities)|true
P00 PUBLISHED_ATLAS_FACILITIES_BEFORE|969
P01 PCT_UNCHANGED|97.42
P02 PCT_CORROBORATED|48.81
P03 PCT_NO_USABLE_DERIVED_EVIDENCE|48.61
P04 PCT_WITHHELD_FOR_CONFLICT|2.58
P05 PCT_PUBLICATION_CHANGES|2.58
Z01_MANUAL_DECISIONS_ZERO|0
Z02_SOURCE_NAME_AUTHORITY_ZERO|0
Z03_PROVIDER_ZIP_MEMBERSHIP_ZERO|0
Z04_CENTROID_MEMBERSHIP_ZERO|0
Z05_RADIUS_MEMBERSHIP_ZERO|0
Z06_NEAREST_ZIP_MEMBERSHIP_ZERO|0
Z07_SECOND_GEOCODER_ZERO|0
Z07b PROVIDERS|census_onelineaddress=654 none=165
Z08_SECOND_MAP1_READER_ZERO|0
Z09_IDENTITY_CHANGES_FROM_DERIVED_GEOGRAPHY_ZERO|0
Z10_PUBLISHER_EVIDENCE_OVERWRITTEN_ZERO|0
R01 EPOCH_RECORDS|630
R02 EPOCH_IDENTITY_STATES|AUTO_CONFIRMED_DISTINCT=576 AUTO_CONFIRMED_MATCH=4 IDENTITY_UNRESOLVED=50
R03_EPOCH_ENTITY_GEOGRAPHY_CHANGED_ZERO_UNLESS_LISTED|0
R04 LANCASTER_SHAPE (entities DERIVED_ADDRESS_BEYOND_UNCERTAINTY before) still withheld|1 of 1
R05 RULE_VERSIONS|2=182 5=3348
DRY RUN COMPLETE: every bucket reconciles; every required-zero receipt is 0. Production was only read.
```

## Every changed facility (Phase D, if Atlas were admitted)

| kind | facility | publisher address | publisher point [class] | derived point | distance m | before ZIP | after |
|---|---|---|---|---|---:|---|---|
| ADDED | Google Michigan City Data Center | 402 Royal Road, Michigan City, IN 46360 | 41.7075394,-86.8950297 [PUBLISHER_NON_SITE] | 41.717084348036,-86.840728684241 | – | – | 46360, RESOLVED/DERIVED_ADDRESS_POINT |
| REMOVED | Renaissance Park and Innovation Data Center Campus | 411 Swedeland Road, King of Prussia, PA | 40.092,-75.347 [PUBLISHER_SITE] | 40.07659394336,-75.334790005078 | 2003 | 19406 | SOURCES_DISAGREE |
| REMOVED | Centeris South Hill Campus (SH1/SH2) | 1023 39th Avenue SE, Puyallup, WA 98374 | 47.136,-122.272 [PUBLISHER_SITE] | 47.154727386193,-122.275807001754 | 2102 | 98374 | SOURCES_DISAGREE |
| REMOVED | Centersquare Shakopee (MSP1 Campus) | 4450 Dean Lakes Blvd., Shakopee, MN 55379 | 44.7965,-93.482 [PUBLISHER_SITE] | 44.780724719737,-93.464181156315 | 2248 | 55379 | SOURCES_DISAGREE |
| REMOVED | Atlas Agro Richland Data Center Campus | 2100 Horn Rapids Road, Richland, WA | 46.36,-119.325 [PUBLISHER_SITE] | 46.351118572037,-119.296569957584 | 2395 | 99354 | SOURCES_DISAGREE |
| REMOVED | LightEdge Chaska (fka Stream Data Centers Minneapolis I) | 1708 West Creek Lane, Chaska, MN 55318 | 44.828,-93.635 [PUBLISHER_SITE] | 44.806140935721,-93.634758967921 | 2431 | 55318 | SOURCES_DISAGREE |
| REMOVED | TierPoint Omaha - Bellevue Data Center | 1001 North Fort Crook Road, Bellevue, NE 68005 | 41.153,-95.925 [PUBLISHER_SITE] | 41.176828667585,-95.926408470456 | 2652 | 68005 | SOURCES_DISAGREE |
| REMOVED | TierPoint Allentown TekPark | 9999 Hamilton Boulevard, Breinigsville, PA 18031 | 40.5384,-75.6288 [PUBLISHER_SITE] | 40.543122693409,-75.659851731482 | 2676 | 18031 | SOURCES_DISAGREE |
| REMOVED | Chantilly Premier | 4151 Auto Park Circle, Chantilly, VA | 38.8943,-77.4311 [PUBLISHER_SITE] | 38.903635117676,-77.461641203282 | 2840 | 20151 | SOURCES_DISAGREE |
| REMOVED | Volo Data Center | 300 S Fish Lake Road, Volo, IL 60073 | 42.3486,-88.1382 [PUBLISHER_SITE] | 42.322728934111,-88.145119600015 | 2932 | 60073 | SOURCES_DISAGREE |
| REMOVED | Amazon AWS Gilroy Data Center | 8050 Camino Arroyo, Gilroy, CA 95020 | 36.997,-121.541 [PUBLISHER_SITE] | 37.019140860381,-121.560262452679 | 2998 | 95020 | SOURCES_DISAGREE |
| REMOVED | TierPoint Omaha - Midlands Data Center | 11425 South 84th Street, Papillion, NE 68046 | 41.11,-96.046 [PUBLISHER_SITE] | 41.137543481737,-96.042858912916 | 3074 | 68046 | SOURCES_DISAGREE |
| REMOVED | AiNET CyberNAP | 7900 Ritchie Highway, Glen Burnie, MD 21061 | 39.169,-76.612 [PUBLISHER_SITE] | 39.140551069735,-76.603054030982 | 3256 | 21060 | SOURCES_DISAGREE |
| REMOVED | Aligned ORD-03 | 50 NW Point Blvd., Elk Grove Village, IL 60007 | 42.0039,-87.9703 [PUBLISHER_SITE] | 42.03298906593,-87.981765186992 | 3370 | 60007 | SOURCES_DISAGREE |
| REMOVED | Farmington Technology Park (Tract) | 2830 W. 220th St., Farmington, MN | 44.606,-93.152 [PUBLISHER_SITE] | 44.630562067787,-93.121323316717 | 3654 | 55024 | SOURCES_DISAGREE |
| REMOVED | Lunavi Cheyenne Data Center | 340 Progress Circle, Cheyenne, WY 82007 | 41.11,-104.78 [PUBLISHER_SITE] | 41.129558738323,-104.740605814875 | 3952 | 82007 | SOURCES_DISAGREE |
| REMOVED | Digital Realty Moores Chapel Data Center Campus | 12899 Moores Chapel Road, Charlotte, NC | 35.2422,-80.9562 [PUBLISHER_SITE] | 35.251900171126,-81.00145397022 | 4249 | 28214 | SOURCES_DISAGREE |
| REMOVED | Expedient CMH3 (Lewis Center) | 281 E. Powell Road, Lewis Center, OH 43035 | 40.1533067,-82.9614584 [PUBLISHER_SITE] | 40.156950823306,-83.014315705643 | 4510 | 43035 | SOURCES_DISAGREE |
| REMOVED | T5@Silicon Valley | 39800 Eureka Drive, Newark, CA 94560 | 37.5461,-122.0312 [PUBLISHER_SITE] | 37.509477757706,-122.000283428112 | 4901 | 94560 | SOURCES_DISAGREE |
| REMOVED | CoreSite DE3 | 4900 Race Street, Denver, CO 80216 | 39.7392,-104.9903 [PUBLISHER_SITE] | 39.785256104963,-104.963415884781 | 5613 | 80202 | SOURCES_DISAGREE |
| REMOVED | Wagner Road Data Center Campus | 1161 Wagner Road, Petersburg, VA | 37.2279,-77.4019 [PUBLISHER_SITE] | 37.197461342258,-77.337059561172 | 6665 | 23803 | SOURCES_DISAGREE |
| REMOVED | Aligned Data Centers ATL-01 | 1551 N River Road, Lithia Springs, GA 30122 | 33.7943,-84.6602 [PUBLISHER_SITE] | 33.725558558874,-84.616438620282 | 8648 | 30122 | SOURCES_DISAGREE |
| REMOVED | Segra Charlotte Data Center (International Airport Drive) | 3100 International Airport Drive, Charlotte, NC | 35.22722,-80.84306 [PUBLISHER_SITE] | 35.193346413091,-80.937840590495 | 9399 | 28202 | SOURCES_DISAGREE |
| REMOVED | PointOne Lower Moncure Road Data Center (Lee County) | 4079 Lower Moncure Road, Sanford, NC | 35.48778,-79.17833 [PUBLISHER_SITE] | 35.557653910558,-79.092497822968 | 10987 | 27330 | SOURCES_DISAGREE |
| REMOVED | Aligned Data Centers IAD-04 Frederick | 5601 Manor Woods Road, Adamstown, MD 21703 | 39.263,-77.387 [PUBLISHER_SITE] | 39.347706064134,-77.493911402858 | 13166 | 20842 | SOURCES_DISAGREE |
| REMOVED | Segra Raleigh Data Center (Garner Station Boulevard) | 2100 Garner Station Boulevard, Raleigh, NC 27603 | 35.85417,-78.76194 [PUBLISHER_SITE] | 35.723682396734,-78.662406504118 | 17062 | 27607 | SOURCES_DISAGREE |

Every REMOVED row: before `RESOLVED/PUBLISHER_POINT`, after `GEOGRAPHY_UNRESOLVED/SOURCES_DISAGREE` flagged
`DERIVED_ADDRESS_BEYOND_UNCERTAINTY`; `derived_verdict=ACCEPTED`, `derived_uncertainty_m=2000`. **No
facility moved to its derived point.** The job log (lines 766–966) carries every row with its full flag
set and entity id.

## Engineering validation of the 25 (not adjudication: nothing here is a per-facility decision)
- **21 of 25 carry Atlas's own `PUBLISHER_APPROXIMATE` flag.** The publisher itself labels these points
  approximate. The 4 without it are Moores Chapel, Gilroy, IAD-04 and CoreSite DE3. 3 also carry
  `COARSE_COORDINATES` (2 decimal places): Lunavi, Atlas Agro and TierPoint Midlands.
- **Some publisher points coincide with city-centre coordinates and carry no note saying so.**
  CoreSite DE3's 39.7392,-104.9903 is the conventional downtown Denver coordinate, and the address (4900 Race Street, 80216) is 5.6 km north. Segra Charlotte's
  35.22722,-80.84306 is uptown Charlotte, and the address is on the airport road 9.4 km west. That is
  the centroid shortcut arriving through source data, caught only because the address is checked.
- **The distances are not geocoder noise.** The smallest is 2,003 m against the 2,000 m bound (the
  measured maximum was 1,801 m). The median is 3,370 m (13th of 25), and 7 exceed 5 km.
- **The rate matches the calibration.** 559 of 607 publisher site pairs (92%) sit inside the bound, and
  the p50 of 115 m matches the calibration's 120 m. 48 conflicts nationally (the other 23 were not
  published before), of which 25 are published: **2.58% of published Atlas facilities**. That is not an
  implausibly large change set.
- **Same ZIP is not proof, measured:** 30 pairs lie beyond the bound while sitting in the SAME ZCTA
  (V09). A ZIP test would have passed every one of them.

## Coverage limit, stated
Of 969 published Atlas facilities, **48.81% are corroborated** by their own address and **48.61% carry
no usable derived evidence**, i.e. no street address (1,311 of 2,187 records are blank). Those keep
today's behaviour: absence of an address is never evidence against a point. This change validates every
Atlas facility that states an address, not every Atlas facility.

## Schedule
The whole national queue (763 addresses) derives in **407.7 s** (ladder p50 202 ms, p95 414 ms, max
1,458 ms, plus 300 ms pacing). The writer's batch is 400 (~3.6 min, against a 30-minute timeout).
The queue drains in two daily runs, and each load (one transaction) lands long before the :25 / :35
resolvers. A partial drain is safe: an underived address is absent evidence and removes nothing.
