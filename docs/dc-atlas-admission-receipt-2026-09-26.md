# Atlas admission — receipt (stages 8–11, 2026-09-26)

Atlas (`compute_atlas/facilities`) derived-address evidence is **admitted in production** and the
resulting Map 1 change was **verified to equal the reviewed list exactly**. Every figure below was
read from production (read-only) or from a named workflow run; nothing is recalled.

## 1. What was approved (stage 8 → 9)

Admission dry run on a replica of that day's production (run `36253526398`, PR #1356, copy taken
15:54 UTC): Map 1 **1,842 → 1,817 rows, 768 → 757 ZIP pages**; **1 added** (Google Michigan City,
46360, placed at its stated address) and **26 withheld** (`SOURCES_DISAGREE`: the publisher's pin is
2.0–17.1 km from its own stated address; 22 of the 26 are pins the publisher marks approximate).
0 moved. The founder reviewed the list and lifted the session's no-admission / read-only rules for
stage 10.

## 2. What was applied (stage 10)

| | |
|---|---|
| Change | `dc_derived_address_admitted` admits `epoch_ai/data_centers` **and** `compute_atlas/facilities` |
| PR | #1359, merged as `c198216` |
| Artifact | `docs/dc-atlas-admission-apply.sql`, sha256 `2c2c8571…`, generated from the DDL of record |
| Run | `dc-atlas-admission-apply` run `36263746674`, dispatched from main, confirm `ADMIT-ATLAS-STAGE-10` |
| Applied | 2026-09-26 18:48 UTC; production step ~7 s; offline proof + apply jobs both green |
| Guard | refused unless the live switch's `md5(prosrc)` was `cd968b64…` (Phase A, read 18:16 UTC) |

**Live after (read-only, 18:55 UTC):** Atlas admitted `true` · Epoch `true` · any other extraction
`false` · switch `md5(prosrc)` `31cb6c9e…`, **byte-identical** to the DDL of record on main
(recomputed from the file, not inferred from the job's exit code) · 2,242 / 2,242 Atlas derived
points admitted · 658 Atlas `DERIVED_ADDRESS` evidence rows (= the dry run's 658 single-match geocodes).

## 3. What changed (stage 11)

Snapshots taken **before** the first post-admission resolver runs: Map 1 at 18:58 UTC (1,842 rows,
768 ZIPs, fingerprint `620d51e7…`), identity at 18:59 UTC.

- Resolvers: `dc-resolve-canonical` 19:25:00–19:25:20 succeeded; `dc-resolve-geography`
  19:35:00–19:36:33 succeeded.
- **Map 1, 19:38 UTC: 1,817 rows, 757 ZIPs, fingerprint `18944a61…`.** The snapshot minus every row
  of the 26 withheld entities plus `46360:d0dd5a4e…` fingerprints to `18944a61…` — **an exact match**.
  Control: the same ordering rule reproduces the 18:58 fingerprint `620d51e7…`, so the method is
  sound. The 26 removals span 25 ZIPs. Rows with no canonical entity (the national plane) are in
  the fingerprint and are unchanged per ZIP.
- **Identity unchanged:** 4,676 entities, 17,691 links, 9,188 decisions; entity and link
  fingerprints identical before and after.

### What the fingerprint cannot see, measured separately (audit, 19:45 UTC)

The Map 1 check is ZIP membership. A move *inside* one ZIP would pass it, so the geography rows
were checked directly:

- 2,240 `dc_entity_geography` rows were rewritten, **all of them Atlas-linked entities** (2,242 exist).
- **2,127** of them are placed at a publisher point (`PUBLISHER_POINT` 1,788 · `PUBLISHER_AREA_POINT`
  330 · `PUBLISHER_MULTI_SITE` 9), and **0** of those sit anywhere other than their authority
  observation's own point. 587 carry the new `CORROBORATED_BY_DERIVED_ADDRESS` flag.
- **22 are now placed at an Atlas-derived address** (`DERIVED_ADDRESS_POINT`, 2,000 m uncertainty):
  Google Michigan City (added to Map 1) **and 21 more** — 16 `CONFIRMED_DC`, 1 `DC_CANDIDATE`,
  4 `NON_DC`. **None of the 21 is on Map 1, before or after**, because a 2 km address disk that does
  not fit inside one ZIP is not published. These are changed decisions that were not in the
  27-row review list (stage 8 listed Map 1 changes only). They are not resident-visible today.

## 4. Rollback (built after the audit; tested, never applied)

`docs/dc-atlas-admission-rollback.sql` (sha256 `a440713b…`) restores Phase A's deployed Epoch-only
body, taken from `build_apply.py`'s `PHASE_A_REGION` (extracted from git and pinned by the Phase A
artifact's sha256), not retyped. It is refused unless the live switch is the admitted one
(`31cb6c9e…`) and fails in-transaction unless the result fingerprints to `cd968b64…`.
Run it with `dc-atlas-admission-apply` → confirm `ROLLBACK-ATLAS-STAGE-10`. The offline job proves:
rollback succeeds, Map 1 does not move at the rollback itself, **one resolver run restores the
pre-admission Map 1 exactly**, a second rollback is refused, and re-admission afterwards works.
After a real rollback, revert the DDL of record in the same PR series, or the parity check and the
structure pins will (correctly) report the difference.

## 5. Known and accepted

- **Stage 7 was not done first.** The production write used the repository-level
  `SUPABASE_DB_URL` secret through a dispatch-only, main-only, confirm-gated job — not a protected
  GitHub environment with a required reviewer. Any pull request can still edit a workflow and read
  that secret; only the founder can close it.
- **11 ZIP pages lost their only data-centre markers** (768 → 757). Correct by the conflict rule,
  but there is no resident-facing note explaining a withheld facility.
- **The pre-admission instruments refuse cleanly** (checked, not assumed): `dc-atlas-phase-a-proof`
  stops with "Atlas is admitted in production", `dc-atlas-admission-dryrun` with "Atlas is already
  admitted in production", `dc-atlas-dryrun` with "production already carries this change". They are
  retired receipts; no change needed.
