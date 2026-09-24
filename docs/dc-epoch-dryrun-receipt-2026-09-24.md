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
