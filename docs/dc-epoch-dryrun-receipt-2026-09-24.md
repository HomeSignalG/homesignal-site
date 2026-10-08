# Epoch automatic canonical geography: final read-only production receipt (2026-09-24)

**Source:** `dc-epoch-dryrun` run `36057392400`, job `107827697479`, head `d3d8fee`, 20:49–20:55Z.

**Production was only read.** Checked at 20:57Z:
- 0 `psql` sessions on production;
- 0 blocked backends;
- `dc_address_geocode` absent, so the change has not been applied;
- Map 1 reader md5 `b143605c…`, unchanged.

Production writes during the dry run: **0**.

## Proof infrastructure

| receipt | result |
|---|---|
| `PRODUCTION_POSTGIS_VERSION_PARITY` | **PASS**: the replica is `supabase/postgres:17.6.1.127`, production's own database build. Byte-identical on both sides: `17.6` · `POSTGIS="3.3.7 a0c7967"` · `GEOS="3.14.1-CAPI-1.20.5"` · `PROJ="9.7.1"` |
| `REPLICA_PARITY_POSITIVE_CONTROL` | **PASS**: Map 1 over all 12,722 registry ZIPs: production 1,815 rows `d92910249028dac0e1eaa7b198178b5f` = replica, the same |
| `REPLICA_PARITY_NEGATIVE_CONTROL` | **PASS**, executed in the offline proof (see below) |
| `REPLICA_SCHEMA_PARITY` | **PASS**: 84 catalog signature rows equal on both sides (see below) |
| `PRODUCTION_WRITES_DURING_DRYRUN` | **0**: every production read goes through one `prod_select` line, in a READ ONLY transaction |

**The negative control, in order:**
1. A matching copy is accepted.
2. A replica tampered with (one published point moved 50 m, on the local replica only) is refused at
   parity, and no after-state is produced.
3. The restored copy is accepted again.

Running it exposed a real defect: a mismatch used to exit silently, because `diff | head` under
`set -e` + `pipefail` stopped the script before it printed the refusal. Fixed.

**What the schema parity covers:**
- every column, default, constraint, trigger and index of the four tables the resolvers write;
- every `dc_%` view and function, the Map 1 reader and the `geo.zip_*` functions.

**What the replica leaves out, listed rather than hidden:**
- 51 columns on the read-only evidence tables that the chain never names.
- 11 production objects the chain does not use: the evidence write-guards
  (`dc_acquisition_run_guard`, `dc_evidence_commit_guard`, `dc_source_observation_guard`,
  `dc_source_contract_stamp`, `dc_mark_run_advanced`), `dc_complete_acquisition`, four self-tests
  and `dc_resident_lineage_ledger`. The chain writes no evidence table, so no guard on one can
  change its result.

## Lancaster, measured, then decided by the general rule

| field | value |
|---|---|
| `LANCASTER_ATLAS_EPOCH_DISTANCE_M` | **4,374** |
| Atlas evidence | `compute_atlas\|facilities\|coreweave-lancaster-pa`; 40.0379, −76.3055; 4 dp; precision `exact`; no location notes (basis `UNSTATED`); **its own street: "216 Greenfield Road"**; polygon ZCTA **17602**, **5 m** from its edge; citation CoreWeave investor release |
| Epoch evidence | `epoch_ai\|data_centers\|name:CoreWeave Lancaster Greenfield site`; address "216 Greenfield Rd, Lancaster, PA"; query is the same text; matched "216 GREENFIELD RD, LANCASTER, PA, 17601"; `range_interpolated`; 1 candidate; 40.048690, −76.256090; uncertainty 2,000 m; provider ZIP 17601 (diagnostic only); polygon ZCTA **17601**, 481 m from its edge; same citation |
| `ATLAS_EVIDENCE_CLASS` | `PUBLISHER_SITE` |
| `EPOCH_EVIDENCE_CLASS` | `DERIVED_ADDRESS` |
| `ATLAS_POSITIONAL_AUTHORITY` | highest class present; no quantified error |
| `EPOCH_POSITIONAL_AUTHORITY` | second class; calibrated error 2,000 m |
| relationship | the pair is 4,374 m apart, beyond the derived point's calibrated allowance (2,000 m). Calibration: 200 Atlas records' own addresses against their own site points, p50 120 m, p95 396 m, max 1,801 m |
| `CANONICAL_GEOGRAPHY_RESULT` | `GEOGRAPHY_UNRESOLVED` · `SOURCES_DISAGREE` · `DERIVED_ADDRESS_BEYOND_UNCERTAINTY` |
| identity | `AUTO_CONFIRMED_MATCH` for both records, unchanged |
| `CANONICAL_ZIP_RESULT` | none (no canonical point) |
| `MAP1_RESULT` | removed from 17602; drawn on no page |

Atlas's point and the geocode of **Atlas's own street address** are farther apart than any honest
address/site pair in the calibration. The address and the point do not describe the same place,
and no evidence says which one is wrong, so the entity fails closed. No person decided this; no
facility literal exists on the authority path.

## National receipt: 12,722 ZIP pages, before → after

| receipt | before | after |
|---|---:|---:|
| MAP1_ROWS | 1,815 | 1,814 |
| MAP1_ZIPS | 759 | 758 |
| CANONICAL_ENTITIES | 970 | 969 |
| ATLAS_BACKED | — | 969 |
| EPOCH_BACKED | — | 1 |
| EPOCH_ONLY | — | 0 |
| ROWS_ADDED | — | 0 |
| ROWS_REMOVED | — | 1 |
| DUPLICATE_PHYSICAL_FACILITIES | — | **0** |
| OUTSIDE_ZIP_ROWS | — | **0** |
| AMBIGUOUS_ZIP_EDGE_WITHHELD | — | 0 |
| GEOGRAPHY_UNRESOLVED (live entities) | — | 1,551 |
| SOURCES_DISAGREE | — | 1 |

**Every changed row:**
- **REMOVED**, ZIP 17602, CoreWeave Lancaster Data Center.
  - Before: `RESOLVED` `PUBLISHER_POINT` at 40.0379, −76.3055, lifecycle Proposed, CoreWeave
    citation.
  - After: `GEOGRAPHY_UNRESOLVED` `SOURCES_DISAGREE` + `DERIVED_ADDRESS_BEYOND_UNCERTAINTY`.
  - Authority observation: unchanged (Atlas).
  - Reason: as above.

There are no other added, removed or changed rows.

## Identity · geography · shortcuts

| Identity | | Geography | | Shortcuts (all must be 0) | |
|---|---:|---|---:|---|---:|
| CURRENT_EPOCH_RECORDS | 92 | MULTI_OBSERVATION_GEOGRAPHY_ENTITIES | 1 | PROVIDER_ZIP_USED | 0 |
| AUTO_MATCHED | 4 | CONSISTENT_OBSERVATIONS | 0 | CENTROID_USED | 0 |
| AUTO_DISTINCT | 56 | LOWER_AUTHORITY_DISAGREEMENTS | 1 | NEAREST_ZIP_USED | 0 |
| IDENTITY_UNRESOLVED | 32 | PEER_AUTHORITY_CONFLICTS | 0 | RADIUS_MEMBERSHIP_USED | 0 |
| WRONG_SIBLING_MERGES | 0 | GEOGRAPHY_UNRESOLVED | 1,551 | SOURCE_NAME_AUTHORITY_RULES | 0 |
| RUN_CHURN_DUPLICATES | 0 | MANUAL_GEOGRAPHY_DECISIONS | 0 | | |
| MANUAL_IDENTITY_DECISIONS | 0 | | | | |

The corpus reconciles: 4 + 0 + 32 + 56 + 0 = 92.

**What Atlas's `exact` label means in practice** (717 current points labelled `exact`):
- 592 are site-class;
- **110 carry the publisher's own town/area statement**;
- 15 have ≤ 1 decimal place.

## Tests

| suite | checks | mutations |
|---|---|---|
| geography (`test/dc_geography_pg`) | 19/19 | 17/17 killed |
| Epoch zero-human (`test/dc_epoch_geography_pg`) | 38/38 | 44/44 killed |
| Map 1 publication | 14/14 | 11/11 killed |
| ZIP membership | 25/25 | 4/4 killed |
| offline node | 248/248 | — |

The geography mutations G1–G13 are all among those killed. The G14 and G15 structural pins each
catch an injected exception. Browser tests run in CI only.

## Competitor-CTO audit

| attack | answer |
|---|---|
| A publisher labels a bad point `exact` and wins? | **No.** The label only breaks ties inside a class (G3 killed; geography G17). |
| A Census interpolation suppresses a real site point? | **No,** not inside its calibrated error (G6 killed; Epoch E34). |
| Two contradictory high-authority site points publish arbitrarily? | **No:** `SITE_CLAIMS_CONFLICT` (G13 killed; geography G14, G16). |
| A source name decides authority? | **No** (G1 killed; GX11 = 0; G15 pin). |
| ZIP agreement influences authority? | **No** (G8, G8b killed; Epoch E35). |
| The provider ZIP influences membership? | **No** (G9 killed; G07 = 0). |
| A facility exception creeps in? | **No** (G14 pin: no facility, place or coordinate literal). |
| The uncertainty disk becomes radius membership? | **No:** the disk can only withhold (GX12 = 0; N09 = 0). |
| Identity changes because geography conflicts? | **No:** Lancaster stays `AUTO_CONFIRMED_MATCH` (E36). |
| PostGIS version skew hides a production-only difference? | **No:** production's own image, byte-identical engine string. |
| The replica claims parity after being changed? | **No:** negative control executed, tampered copy refused. |
| Omitted replica schema changes the result? | **No:** 84-row signature equal; the omissions are listed and are never read or written by the chain. |
| Lancaster passes only because its name is in code? | **No:** it is decided by class + calibrated error; G14. |

**Residuals, stated rather than buried:**
1. Atlas's own street addresses are not geocoded by the ingest, so the same internal inconsistency
   can exist undetected on an Atlas-only facility. Lancaster was caught only because Epoch brought
   the address to the geocoder.
2. The replica runs amd64 while production runs aarch64. Same build, same library versions, and the
   Map 1 parity is byte-identical, but the CPU architecture itself is not matched.

---

*Earlier receipt (run `36045839184`, head `5140c89`, same day), retained as the dated record:*

# Epoch automatic canonical geography: production dry-run receipt (2026-09-24)

**Source:** `dc-epoch-dryrun` run `36045839184`, job `107789045508`, head `5140c89`, 19:07–19:12Z.

**Production was only read.** Every read went through `prod_select`: a READ ONLY transaction, a
2 s `lock_timeout`, one `SELECT` per session. Checked while the run was going: no client backend
held a lock above ROW EXCLUSIVE, no backend was blocked, and no dry-run session was open at the
19:11Z check.

## Replica = production (preconditions)

| check | production | replica |
|---|---|---|
| 4 replaced definitions (prosrc md5) | = main@58aeb8c | = main@58aeb8c |
| Map 1 output, all 12,722 registry ZIPs | 1,815 rows `d92910249028dac0e1eaa7b198178b5f` | 1,815 rows `d92910249028dac0e1eaa7b198178b5f` |

**Rows copied into the replica:**

| table | rows |
|---|---:|
| `dc_source_observation` | 11,957 |
| `dc_canonical_entity` | 3,530 |
| `dc_entity_observation` | 11,957 |
| `dc_identity_decision` | 4,375 |
| `dc_entity_geography` | 3,530 |
| `national_dc_records` | 1,824 |
| `canonical_zip_registry` | 12,722 |
| ZCTA polygons (within 0.2° of any point) | 16,857 |

**Geocoder queue:** 56 addresses.

⚠️ The replica runs PostGIS 3.5 and production runs 3.3.7. Parity proves the **before** state
only; the after state runs new SQL on 3.5.

## Gate 21: the required counts

| receipt | value |
|---|---:|
| CURRENT_EPOCH_RECORDS | 92 |
| STABLE_EPOCH_SOURCE_IDENTITIES | 92 |
| AUTO_CONFIRMED_MATCH | 4 |
| AUTO_CONFIRMED_DISTINCT | 56 |
| IDENTITY_UNRESOLVED | 32 |
| GEOGRAPHY_UNRESOLVED (of the auto-distinct) | 56 |
| EPOCH_ONLY_PUBLISHABLE | **0** |
| EPOCH_ONLY_WITHHELD | 88 |
| MANUAL_IDENTITY_DECISIONS_REQUIRED | **0** |
| MANUAL review objects on the path | **0** |

## Gate 22: the corpus reconciles

| bucket | records |
|---|---:|
| R1 auto-matched to an existing entity | 4 |
| R2 auto-distinct, new entity | 0 |
| R3 identity unresolved | 32 |
| R4 geography unresolved | 56 |
| R5 other canonical withhold | 0 |
| **total** | **92 = I01** |

Every record's disposition is printed in the job log under `EPOCH DISPOSITIONS`, and every
still-open pair under `OPEN PAIRS`.

## Gates 23–25: lifecycle, identity, geography

**Lifecycle**
- Epoch states a lifecycle for **0** records.
- 1 matched entity takes its lifecycle from Atlas.
- 0 Epoch-only entities are withheld for lifecycle, and 0 are published.

**Identity**
- WRONG_SIBLING_MERGES **0** · RUN_CHURN_DUPLICATES **0** · NOT_AN_AUTOMATIC_STATE **0**.
- 182 run-churn entities are superseded: live Epoch data-centre entities go from 270 to 92.

**Geography**
- PROVIDER_ZIP_USED **0** · CENTROID_FALLBACK **0** · NEAREST_ZIP **0**.
- Geocoding: 58 attempted, 31 accepted, 27 rejected; 34 addresses are not geocodable by the input
  rule.
- **30 of the 31 accepted points are held as `IDENTITY_UNRESOLVED`,** because each lies near an
  Atlas data centre that could be the same facility. Examples: Google Council Bluffs, Meta Kuna,
  Colossus 2, Vantage TX1. Proximity never merges, so these points stay held until both sources
  state one exact address.

## Gate 26: the 12,722 pages, before → after

| receipt | before | after |
|---|---:|---:|
| Map 1 rows | 1,815 | 1,814 |
| ZIP pages with a data-centre row | 759 | 758 |
| canonical entities | 970 | 969 |
| DUPLICATE_PHYSICAL_FACILITIES | — | **0** |
| OUTSIDE_ZIP_ROWS | — | **0** |
| rows added | — | 0 |
| rows removed | — | **1** |

**The one removal:**
- ZIP **17602**, **CoreWeave Lancaster Data Center** (Atlas, Proposed, Atlas precision "exact" at
  40.0379, -76.3055).
- It is auto-matched by exact site address to Epoch's "CoreWeave Lancaster Greenfield site, 216
  Greenfield Rd, Lancaster, PA".
- The geocoder accepted Epoch's address, and the geography resolver found the two sources'
  points disagree (`SOURCES_DISAGREE`). The entity is therefore withheld rather than placed on
  one source's word.
- The distance between the two points is **UNVERIFIED**: the dry run does not print the derived
  coordinate, and the address is not in `national_address_points`.

## Gate 27: adversarial (CTO) review — what this does NOT prove

1. **Epoch adds no Map 1 coverage today.** 0 Epoch-only markers are published, and the net change
   is −1. Epoch's value right now is automatic, duplicate-safe identity, and evidence that can
   withhold a contradicted point. It is not new pins.
2. **The one change a resident would see is a removal.** Whether a contradicted "exact" Atlas point
   should be withheld (current rule: fail closed) or kept is a policy question. No per-facility
   override was added. Not changed here.
3. **PostGIS version skew** (3.5 replica, 3.3.7 production) means the after state has not been run
   on production's geometry engine.
4. **The Map 1 parity refusal was never triggered**, offline or live. It passed live, but no test
   shows it refusing.
5. **The replica is built from test fixtures for the Step-2A tables.** It reproduces only the
   columns the chain reads. Loading fails loudly if production lacks a column, but production
   columns the fixture omits are invisible to the dry run.

## Gate 29: apply gate

| condition | status |
|---|---|
| ZERO_HUMAN_END_TO_END | PASS (suite 35/35, mutations 35/35) |
| MANUAL_IDENTITY_DECISIONS_REQUIRED | 0 |
| WRONG_SIBLING_MERGES | 0 |
| RUN_CHURN_DUPLICATES | 0 |
| PROVIDER_ZIP_MEMBERSHIP | 0 |
| SECOND_MAP1_READER | 0 (structural suite) |
| production dry-run corpus reconciles | yes |

**Every automatic condition holds.** Merge, apply and the production geocoder all remain
**NOT DONE**: they are gated on the founder, who stopped them, and the Lancaster removal (item 2
above) is the decision to put in front of them.
