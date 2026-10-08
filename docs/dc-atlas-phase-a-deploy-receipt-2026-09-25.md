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

## Hardened proof (PR #1344, run 36176907428 on `6ac7d13`) — PHASE A ZERO-EFFECT PROOF: HARDENED AND PROVEN
Production was only **read**. Every read ran in `BEGIN … READ ONLY`, asserted in-session, then rolled back.
Harness: `scripts/dc-atlas-phase-a-proof.sh`; the one comparator is `scripts/dc_phase_a_proof.py`.

**Question:** given the same production evidence, do OLD (`f9d1326`, whose 7 DDL files are byte-identical to
#1335's merge parent `71659bb`) and NEW (Phase A, Atlas unadmitted) decide identity, geography or Map 1
differently?

### Preconditions, live (19:22:34Z)
- ATLAS_ADMITTED `f`; ATLAS_EVIDENCE_ROWS 0; EPOCH_EVIDENCE_ROWS 31.
- Identity/geography writes after the 15:25/15:35 runs: 0 / 0. Control: 3,923 geography rows at 15:35.
- CODE_DIFFERS: PASS. The admission function exists on NEW only. The geography resolver, evidence view,
  candidate view and derived-point view differ. The Map 1 reader, citation function and current-observation
  view are identical.
- PostGIS 3.3.7 on both sides.

### The true pre-identity state at T = 15:25:00.080497Z
| class | source | boundary | rule |
|---|---|---|---|
| observations, runs | production | run `started_at` < T (from production, by run id) | immutable |
| derived geocodes | production | `derived_at` < T | append-only |
| links, decisions | production | `linked_at` / `decided_at` < T | 0 relinked, 0 re-decided at T |
| entities | production rows `created_at` < T | mutable fields from the 13:43:12Z snapshot | 2,275 modified at T |
| geography | 13:43:12Z snapshot | 0 writes in [S,T) | |

Validated four ways against evidence the reconstruction did not use:
- **V1:** at S it reproduces the snapshot's own Map 1: 1,814 rows, row diff 0.
- **V2:** at 14:52:45Z it reproduces the live measurement: 1,084 rows, `c874ef2a…` on both sides.
- **V3:** the only resolver runs in [S,T) were 14:25 and 14:35. Both ended (14:35:50) before the first
  new input: an acquisition at 14:44:25 and a geocode at 15:04:55. 0 rows carry a write time in [S,T).
  The OLD code those runs executed writes 0 on the S state (minted 0, linked 0, relinked 0, geography rows
  written 0).
- **Step 7:** the NEW replay reproduces production's actual 15:25/15:35 outcome exactly: identity, geography
  (exact floats and EWKB) and Map 1, all row diff 0.

| start state | OLD | NEW |
|---|---:|---:|
| START_FP | `5448f00d…` | `5448f00d…` |
| identity vs snapshot fingerprint `331dd3c3…` | 0 diff | 0 diff |
| observations / current / unlinked | 14,811 / 2,854 / 2,854 | same |
| entities / links / decisions / geocodes / geography | 3,530 / 11,957 / 4,506 / 845 / 3,530 | same |
| identity candidates | 2,340 `c8a078cc…` | 2,340 `c8a078cc…` |
| Phase-A-only derivations read by an admitted observation | 0 (control 58 consumers) | 0 (controls 58 admitted, 803 unadmitted) |

### Result
| | OLD | NEW | diff |
|---|---:|---:|---:|
| minted / newly linked / relinked / superseded | 575 / 2,854 / 0 / 0 | 575 / 2,854 / 0 / 0 | metrics identical |
| entities | 4,105 `d558939f…` | same | 0 |
| links | 14,811 `e113b7dd…` | same | 0 |
| decisions | 6,846 `760de441…` | same | 0 |
| geography decisions (incl. exact geometry) | 4,105 `970d029e…` | same | 0 |
| Map 1 rows / ZIP pages / facilities (all 12,722 ZIPs) | 1,835 / 767 / 1,835 `7cea6025…` | same | 0 added, 0 removed, 0 moved, 0 ZIP-changed |
| Atlas derived evidence in the NEW plane | | 0 | |

- **Geography rows written:** OLD 2,792 and NEW 3,923. NEW restamps `rule_version` 4 → 5 on every resolved
  entity; that is not a decision and is excluded. Every decision column matches.
- **The true pre-#1335 world (6b):** OLD re-run without the 789 geocodes that only Phase A's queue derived
  (56 kept) equals the replay on every table.

### Positive controls — 9 of 9 detected
8 carry an exact expected result. **ADMISSION_END_TO_END does not:** it requires any nonzero difference, and
its magnitudes below are observed, not pinned. The 13/13 mutation score covers the Python comparator only;
the shell harness's own assertions were not mutation-tested.
| control | observed |
|---|---|
| MAP1 (one facility nudged) | row diff 2, moved 1 |
| EQUAL_TOTALS_SWAP | totals 1,835 / 767 / 1,835 equal; moved 2, ZIP-changed 2, row diff 4 |
| IDENTITY (one classification) | entities 2 |
| LINK_AND_DECISION (a link repointed, a decision state) | links 2, decisions 2, entities 0 |
| GEOGRAPHY (one quality flag) | geo 2 |
| ADMISSION (gate) | ATLAS_ADMITTED t, Atlas evidence 650, Epoch 31 unchanged |
| EVIDENCE_LEAK (predicate removed, not admitted) | ATLAS_ADMITTED f, Atlas evidence 650, Epoch 31 |
| ADMISSION_END_TO_END (NEW resolvers re-run with Atlas admitted, disposable replica) | geography 4,428 row diff; Map 1 1,835 → 1,811 (1 added, 25 removed) |
| PARITY_NEGATIVE (replica nudged vs production) | refused |

- Comparator mutation test: **13/13 killed**. Unit suite: 14 tests.

### Found while proving, and fixed (instrument defects, not Phase A effects)
1. **The production URL's pooler drops startup options.** `PGOPTIONS` read-only and timeout settings never
   applied, and a fresh session reads `default_transaction_read_only = off`. Runs 3–5 were read-only only
   because every query was a fixed SELECT of read functions. Enforcement is now in the transaction.
2. **Production's `extra_float_digits = 0` rounds float text to 15 significant digits.** The replicas had
   been built from rounded coordinates: 18 geocoded points moved in the 16th–17th digit. Text comparison of
   lat/lng was blind to it on both sides. Every dump now uses `extra_float_digits = 3`.
   - Two earlier commit messages blamed PostGIS text formatting. That was wrong, and it is corrected.
3. **NULL vs `''` was indistinguishable in CSV.** A `\N` marker is now used throughout.
4. **Controls strengthened after an adversarial review.** The gate controls now require Atlas evidence
   rows > 0. The end-to-end admission control and the link/decision control were added. The
   acquisition-side path (geocodes keyed by address text, above) is bounded by the consumer check and 6b.

### Map 1 dependency closure (live, traced recursively 2026-09-25)
- **Contents:** `map1_dc_zip_members`; `dc_record_citation`; `geo.zip_membership_boundary`;
  `geo.zip_point_membership_in`; `geo.zcta_boundary`; the tables `dc_canonical_entity`,
  `dc_entity_geography`, `dc_entity_observation`, `dc_source`, `dc_source_observation`,
  `dc_acquisition_run`, `national_dc_records`; the view `dc_current_observation`; and PostGIS functions.
- **No Phase A object is in it**, and no function in it uses dynamic SQL.
- **Derived evidence reaches decisions only through three readers, each filtering admission exactly once:**
  - the evidence view (`AND dp.admitted`);
  - identity candidate K3 (`AND d.admitted`);
  - `dc_resolve_geography` (`where dp.admitted`).
- **The only writers of identity and geography** are `dc_resolve_canonical` and `dc_resolve_geography`,
  run by the two cron jobs.

- ⏳ **Dated receipt.** The harness refuses to run once production resolves anything after the 15:25/15:35
  runs it replays.

## Canonical decisions: counterfactual (run 36155723984, PR #1341) — SUPERSEDED
> 🛑 **Superseded by the hardened proof below (PR #1344).** This counterfactual copied production after
> the 15:25Z new-code identity run, so OLD never replayed identity from the pre-resolver inputs. Its
> comparator was also never shown able to detect a nonzero. Its numbers are kept as the dated record,
> not as proof. `dc-atlas-phase-a-counterfactual` is deleted.

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

## Map 1: all 12,722 ZIP pages (counterfactual — superseded, see the hardened proof)
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
- IDENTITY and GEOGRAPHY changes from non-admitted Atlas evidence: 0 (hardened proof).
- MAP1_CHANGES from Phase A: 0 (hardened proof).
- Atlas derived-address authority rows: 0.

## Schedule safety (traced, not assumed)
Production order observed on 2026-09-25 only (no general pattern is claimed):
1. Atlas acquisition 14:44Z (cron `40 9`).
2. Epoch acquisition 15:10Z (cron `10 10`).
3. Writer (cron `45 10`, plus dispatch).
4. Identity resolver at :25.
5. Geography resolver at :35.
6. Map 1, which reads live.

- **Batches cannot starve Epoch.** The queue reads `order by (not admitted), geocoder_query collate
  "C" limit 400`, so every admitted (Epoch) address precedes every Atlas address in every batch. Atlas
  gets a slot only when admitted work is below 400. Admitted queue at both reads today: 0.
- Epoch has 93 records in total. Its per-day address volume has not been measured.
- An address acquired after a writer run is derived on the next run. Absent evidence never
  removes a publisher point, so the only cost is a day of delay.

## Found and NOT fixed (pre-existing, independent of Phase A)
**Map 1 lost its canonical layer** between the Atlas acquisition and the next identity run. This was
observed on 2026-09-25 after the 14:44Z Atlas acquisition and before the 15:25Z identity run. It has not
been measured on other days.

Measured 14:52Z:
- 2,216 / 2,216 Atlas current observations were unlinked.
- canonical rows 969 → 1; rows 1,814 → 1,084; ZIP pages 758 → 365.

It restored after the 15:25 and 15:35 resolvers. Map 1's dependency closure (its reader plus
`dc_current_observation` → `dc_acquisition_run`, `dc_source_observation`) contains none of Phase A's
objects. It is an ordering defect and needs its own change.

## Not done, by design
- **Atlas is not admitted.** Admission needs a POST-Phase-A national dry run.
  - `dc-atlas-dryrun.yml` refuses now that production carries Phase A.
  - `scripts/dc-atlas-phase-a-proof.sh` is the natural base: add the Phase D switch on the NEW replica.
  - The earlier "25 removed / 1 added" is stale; today's data has 2,216 Atlas records.
- **Follow-up, not done here: production-write workflow authorization / human-review gate.**
  `dc-atlas-phase-a-apply.yml` (#1339) writes DDL to production when dispatched from `main` with a typed
  confirmation string. It has no protected `environment:` and no required reviewer. The proof work
  neither reuses nor modifies it.

## Audit corrections (post-merge, same day)
- **The proof workflow held a production-WRITE credential on `pull_request`.** A PR editing the script could
  have run arbitrary SQL against production with it. Fixed: the proof job runs only on manual dispatch from
  `main`; pull requests run the offline comparator alone. A dedicated read-only database role would be
  stronger. It is not created here, because creating it is a production write.
- **The proof is dated.** It is not a PR check, since it will refuse permanently once production resolves
  new evidence.
- **Step 6b's "all by Phase A's queue" is an attribution, not a per-row fact.** `dc_address_geocode`
  records no source. The attribution rests on the Epoch queue being empty at both reads. The binding
  evidence is the consumer count: 0 admitted consumers of a post-snapshot derivation.
- **#1344 was merged onto a main that had moved** (#1342, `app_refresh_zip`) without a re-run of the
  proof. It was checked afterwards: #1342 touches no DC-chain file, and post-merge CI is green.
