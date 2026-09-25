# Atlas coordinate validation — Phase A production deployment receipt (2026-09-25)

Phase A of #1335 is live. **Atlas is NOT admitted.** Every number below was measured against production
at the time shown, or read from the named Actions run.

## Git
| | |
|---|---|
| PR | #1335 |
| TESTED_HEAD | `5c63476150c35fd35327263f8b56ee4267202132` (national dry run 36078120976; re-proven on today's production by run 36144669051, 14:03–14:16Z) |
| MERGE_SHA | `ccd637eef492adf32ee58de0fcfb93025ac52ca0` (merge commit; parents `71659bb` main, `5c63476` tested head) |
| MERGED_TREE | `c3774c0ecf92872ec7ef647731036fe012cf2227`, exactly the predicted merge. Of the PR's files, only `CLAUDE.md` differs from the tested head; main had moved by #1334/#1336/#1329 plus two generated reports, none touching the DC chain |
| POST_MERGE_CI | green on `ccd637e`. The `browser` job failed once on a `locator.count()` race in `community.html`, a file the merge does not touch, and passed on its one re-run |
| Apply tooling | #1339, merged as `b9f8bcb`; post-merge unit-tests green |

## Apply
| | |
|---|---|
| ARTIFACT | `docs/dc-atlas-validation-apply.sql` from merged main, executed through psql `\i` |
| ARTIFACT_MD5 | `2a1623e4eff057787961a481aa433f9d` (sha256 `891bb2101d1f99d5861529953e7f216cdb1d61c64d898d381efee2c0d39ea5a3`) |
| DRIFT_GUARD | passed. The 7 live md5s equal `EXPECT_LIVE`, and the 3 new functions were absent (verified 13:41Z and again at preflight) |
| LOCK_TIMEOUT | `5s`, asserted inside the applying session before `\i`. Backend pid 416084 held before and after, with `lock_timeout_after=5s`. The offline proof shows a held lock failing the apply in 5.05 s with 0 objects committed |
| APPLY_RUNTIME | 2.402 s (run 36149909384, 14:49:47Z). The monitor saw 0 blocked sessions; the apply's own wait was `IO:DataFileRead` |
| DEFINITION_PARITY | 30/30 `dc_%` views, functions and the Map 1 reader equal a replica built from main's DDL of record (signature md5 `ab12e0a1e6b242910d57a7076125f93b`, identical to the offline proof) |
| PARTIAL_APPLY | 0. One transaction; post-checks NEW_FUNCTIONS=3, DERIVED_POINT_HAS_ADMITTED=1, QUEUE_HAS_ADMITTED=1, RESOLVER_RULE_VERSION_5=true |
| First dispatch | run 36149349640 was refused at preflight (UTC minute 44 falls inside the :18–:45 resolver guard) before any database contact; 0 functions present afterwards |

## Admission
| | |
|---|---|
| EPOCH_ADMITTED | true |
| ATLAS_ADMITTED | **false**. Live body: `select (p_source_key, p_distribution_key) in (('epoch_ai', 'data_centers'))` |

## Atlas acquisition (the existing `dc-geocode-observations` pipeline only)
| | |
|---|---|
| ATLAS_CURRENT_RECORDS | 2,216. A scheduled Atlas acquisition at 14:44:25Z raised this from 2,187 |
| ATLAS_ADDRESSES | 904 stating any address: 803 geocodable, 92 with no house number, 4 house-number ranges, 5 with no locality. 1,312 blank |
| DISTINCT_QUERIES | 789 (the dry run had 763 on 2,187 records; the difference is the 29 new records) |
| DERIVED_ACCEPTED | 650 records / 640 queries |
| NO_MATCH | 146 records / 142 queries |
| MULTIPLE_MATCH | 7 records / 7 queries (`REJECTED_AMBIGUOUS`) |
| FAILURES | 0 workflow failures |
| QUEUE_REMAINING | 0 |
| BATCH_COUNT | 2: run 36151293964 took 400 (323 matched, 77 failed) with derive 235 s; run 36151869923 took 389 (324 matched, 65 failed) with derive 221 s |
| TOTAL_RUNTIME | 456 s of derivation; about 8.6 min wall clock across the two jobs |
| Resumability | the queue went 789 → 389 → 0; `dc_address_geocode` went 56 → 456 → 845; 0 duplicate `(geocoder_query, ladder_version)` pairs; 0 pre-existing derivations lost; admitted work queued = 0 at both reads |

## Canonical decisions: counterfactual (run 36155723984, PR #1341)
Production's data moved during the deployment: Atlas acquired at 14:44Z, Epoch at 15:10Z, and the
15:25 and 15:35 resolvers re-linked everything. So Phase A's effect was isolated by resolving **one
read-only copy of production** under the OLD code (main@f9d1326) and under the NEW code.

| | OLD | NEW | Δ |
|---|---:|---:|---:|
| NEW replica vs production Map 1 (parity) | | 1,835 rows `904b8f38…` = production | PASS |
| identity candidates (input) | 2,340 `f990caab…` | 2,340 `f990caab…` | 0 |
| geography evidence (input) | 2,247 `6e985e8d…` | 2,247 `6e985e8d…` | 0 |
| `dc_resolve_canonical` | `ba2a7505…` | `ba2a7505…` | identical |
| geography resolver rows written | 3,923 (re-stamped to rule v4) | 0 (production already equals NEW) | |
| identity rows | 25,762 | 25,762 | 0 |
| geography decisions (8 fields) | 4,105 | 4,105 | 0 |
| Atlas evidence rows | | 0 | |
| Epoch evidence rows | | 31 | (control) |

- **Atlas changes:** 0 identity and 0 geography decisions from non-admitted evidence.
- **Epoch changes:** 0 from this deployment. Epoch site outcomes are 3 RESOLVED/PUBLISHER_POINT and
  1 SOURCES_DISAGREE, the same as before.
- **Lancaster:** GEOGRAPHY_UNRESOLVED / SOURCES_DISAGREE, flags SOURCES_DISAGREE +
  DERIVED_ADDRESS_BEYOND_UNCERTAINTY. It was withheld before and is withheld after.

## Map 1: all 12,722 ZIP pages
| | OLD code | NEW code | Δ |
|---|---:|---:|---:|
| rows | 1,835 | 1,835 | 0 |
| ZIP pages | 767 | 767 | 0 |
| facilities | 1,835 | 1,835 | 0 |
| entities | 989 | 989 | 0 |
| full-row fingerprint | `859efcec…` | `859efcec…` | equal |
| added / removed / moved / ZIP changed | | | 0 / 0 / 0 / 0 |

Production before and after, as observed:
- **Before:** 1,814 rows / 758 ZIPs / 969 entities, md5 `dda04db4…`. This held unchanged through the
  14:25 and 14:35 resolvers.
- **After:** 1,835 rows / 767 ZIPs / 989 entities (+21 facilities, 0 removed, 0 moved, 0 ZIP-changed).
  The whole difference is the day's acquisitions; the counterfactual shows it is not Phase A.

## Architecture zeros (live, 15:53Z)
All of these read 0 or unchanged:
- ATLAS_ADMITTED false.
- MANUAL_DECISIONS 0.
- SOURCE_NAME_GEOGRAPHY_AUTHORITY 0: no source literal in the resolver, conflict, Map 1 or policy
  bodies.
- PROVIDER_ZIP / CENTROID / RADIUS / NEAREST_ZIP membership 0. The Map 1 reader is unchanged (md5
  `9fc1c9f5…`) and is the single polygon authority; this is pinned by the structure test.
- SECOND_GEOCODER 0: 0 SQL provider calls; the writer is the one ladder.
- SECOND_MAP1_READER 0: exactly 1 reader.
- IDENTITY and GEOGRAPHY changes from non-admitted Atlas evidence: 0 (counterfactual).
- MAP1_CHANGES from Phase A: 0 (counterfactual).
- Atlas derived-address authority rows: 0.

## Schedule safety (traced, not assumed)
Actual production order today:
1. Atlas acquisition 14:44Z (cron `40 9`, about 5 h late).
2. Epoch acquisition 15:10Z (cron `10 10`).
3. Writer (cron `45 10`, plus dispatch).
4. Identity resolver at :25.
5. Geography resolver at :35.
6. Map 1, which reads live.

- **Batches cannot starve Epoch.** The queue reads `order by (not admitted), geocoder_query collate
  "C" limit 400`, so every admitted (Epoch) address precedes every Atlas address in every batch. Atlas
  gets a slot only when admitted work is below 400. Admitted queue at both reads today: 0.
- Epoch adds single-digit addresses per day; it has 93 records in total.
- An address acquired after that day's writer run is derived on the next run. Absent evidence never
  removes a publisher point, so the only cost is a day of delay.

## Found and NOT fixed (pre-existing, independent of Phase A)
**Map 1 loses its canonical layer every day** between an Atlas acquisition and the next :25 identity
run.

Measured 14:52Z:
- 2,216 / 2,216 Atlas current observations were unlinked.
- canonical rows 969 → 1; rows 1,814 → 1,084; ZIP pages 758 → 365.

It restored after the 15:25 and 15:35 resolvers. Map 1's dependency closure (its reader plus
`dc_current_observation` → `dc_acquisition_run`, `dc_source_observation`) contains none of Phase A's
objects. It is an ordering defect and needs its own change.

## Not done, by design
- **Atlas is not admitted.** Admission needs a POST-Phase-A national dry run.
  - `dc-atlas-dryrun.yml` refuses now that production carries Phase A.
  - `scripts/dc-atlas-phase-a-counterfactual.sh` is the natural base: add the Phase D switch on the
    NEW replica.
  - The earlier "25 removed / 1 added" is stale; today's data has 2,216 Atlas records.
