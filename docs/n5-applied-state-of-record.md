# N5 applied-state-of-record and object ownership

THIS DESCRIBES SQL ALREADY APPLIED TO PRODUCTION BY A PARALLEL SESSION; IT MUST NOT BE RE-EXECUTED AS PART OF #1016.

This file is a receipt, not a migration. The companion `docs/n5-applied-state-of-record.sql` is inert: it raises if executed. Neither file belongs on a `db-sql.yml` dispatch.

## Settled production receipts (cite, do not re-measure)

| Fact | Receipt |
|---|---|
| Snapshot | `phase1-2026-09-01` (preservation baseline of record) |
| Authoritative PROVEN source_keys | 723,449 |
| Canonical `proven_stored_point` | 718,278 |
| Point rejects | 5,171 = 4,877 `MULTI_COORD_UNRESOLVED` + 294 `NULL_COORD` |
| Partition | 718,278 + 4,877 + 294 = 723,449, closing exactly |
| Canonical − current-rule eligible | 0 |
| Eligible − canonical | 0 |
| Coordinate mismatches | 0 |
| Canonical namespace | 100% `feature_id='pt:1'` |
| Founder-verified | commit `4027754` on `claude/homesignal-zip-forensics-13xkmw`, QUEUE.md |

`git log --all -S"distinct_coords"` = 0 commits. The ad-hoc SQL that materialised the 718,278 / 5,171 partition is not recoverable from any repository ref.

`n5_geom_semantics_ck` appears in 0 commits across both repositories. It is not modelled. If it exists in production, its predicate is unknown and must not be invented.

## What is in production vs what #1016 has applied

Verified against durable refs, not conversation:

- Parallel writer commit: `f7c4b79` on `origin/claude/homesignal-zip-forensics-13xkmw`, file `docs/n5-provenance-and-key-migration.sql`.
- #1016 baseline: `ebc75bc` on `claude/n5-canonical-provenance`, DRAFT PR #1016. **Never applied.**
- Production still lacks (by the pre-state this migration is designed against): `geo.n5_geom.verdict_snapshot_id`, `n5_geom_verdict_snapshot_ck`, `n5_geom_pt_namespace_ck`, `geo.n5_proven_verdict`, `geo.n5_verdict_manifest`, `geo.n5_association_stage`.

## Exact-recovered vs reconstructed vs measured

### Exact-recovered (byte-for-byte from `f7c4b79`)

These statements are in `git show f7c4b79:docs/n5-provenance-and-key-migration.sql`. They have already run. Do not run them again.

1. `geo.n5_geom.provenance` added nullable → existing rows backfilled `recovered_authoritative` → 0-NULL assert → `n5_geom_provenance_ck` → `NOT NULL`, no default.
2. `geo.n5_point_reject` created with PK `(source_key, reason)`, `detail jsonb`, `rejected_at`, reason CHECK, RLS enabled. **No** `lat`/`lng`/`observed_in_z3`/`verdict_snapshot_id`.
3. Association key changed by table swap: duplicate/conflict STOP → `geo.n5_association_new` PK `(source_key, zip)` → copy → count assert → drop → rename → rename pkey index. RLS enabled on the new table.

### Measured production receipt (not SQL)

Commit `4027754`: 718,278 `proven_stored_point` + 8,626 `recovered_authoritative`; rejects 4,877 + 294; partition closes on 723,449. Founder-verified independently.

### Semantically reconstructed (ad-hoc materialisation — no original SQL)

The SQL that wrote the 718,278 points and 5,171 rejects is **not recoverable**. The following is an applied-state-of-record reconstruction of its *semantics*, not a claim of byte-for-byte recovery:

```text
RECONSTRUCTION, NOT AN ORIGINAL MIGRATION — DO NOT EXECUTE.

For each PROVEN source_key on snapshot phase1-2026-09-01:
  ncoord = count of distinct observed (lat,lng) pairs (both non-null on the same row)
  if ncoord = 1 and in-range and not null-island:
      INSERT geo.n5_geom
        (source_key, feature_id='pt:1', provenance='proven_stored_point',
         geom=ST_SetSRID(ST_MakePoint(lng,lat),4269))
      -- no verdict_snapshot_id column existed
  else if ncoord > 1:
      INSERT geo.n5_point_reject
        (source_key, reason='MULTI_COORD_UNRESOLVED',
         detail={"snapshot":"phase1-2026-09-01","distinct_coords":N})
  else:  -- ncoord = 0
      INSERT geo.n5_point_reject
        (source_key, reason='NULL_COORD',
         detail={"snapshot":"phase1-2026-09-01","distinct_coords":0})

The other four reject reasons measured 0 (4027754).
detail payload keys are TIER 3: modelled from narrative; `distinct_coords`
appears in no git ref. #1016 reads only detail->>'snapshot' and preserves
the payload opaquely.
```

## Object ownership

| Object | Originally created by | In production? | Current production shape | #1016 action |
|---|---|---|---|---|
| `geo.n5_geom.provenance` | `f7c4b79` | Y | `text NOT NULL`, no default | VALIDATE / leave |
| `n5_geom_provenance_ck` | `f7c4b79` | Y | allowlist of the two v1 values | VALIDATE / leave |
| `geo.n5_geom.verdict_snapshot_id` | — (#1016) | N | absent | CREATE + backfill proven rows only |
| `n5_geom_verdict_snapshot_ck` | — (#1016) | N | absent | CREATE after backfill |
| `n5_geom_pt_namespace_ck` | — (#1016) | N | absent | CREATE after gate |
| `n5_geom_semantics_ck` | unknown / unverified | unverified | **no durable definition** | leave; do not invent |
| `geo.n5_point_reject` | `f7c4b79` | Y | PK `(source_key, reason)`; `detail`; no lat/lng/observed_in_z3/verdict_snapshot_id | ARCHIVE then EXPLICIT rebuild |
| reject PK | `f7c4b79` | Y | `(source_key, reason)` | REPLACE with `(source_key)` |
| reject `detail` | `f7c4b79` + ad-hoc | Y | jsonb; snapshot / distinct_coords payload | RETAIN through archive + rebuild |
| reject `verdict_snapshot_id` | — (#1016) | N | absent | ADD on rebuild |
| reject `lat` / `lng` | — (#1016) | N | absent | ADD on rebuild |
| reject `observed_in_z3` | — (#1016) | N | absent | ADD on rebuild |
| `geo.n5_point_reject_archive` | — (#1016) | N | absent | CREATE; idempotent PK `(source_key, reason)` |
| `geo.n5_association` PK | `f7c4b79` table swap | Y | `(source_key, zip)` | VALIDATE / leave |
| `geo.n5_proven_verdict` | — (#1016) | N | absent | CREATE; do not populate |
| `geo.n5_verdict_manifest` | — (#1016) | N | absent | CREATE; do not populate |
| `geo.n5_association_stage` | — (#1016) | N | absent | CREATE |
| shard `detail` snapshot attribution | builder (`n5_shard.py`) | N/A (runtime) | written at shard completion | leave (not a migration object) |
| 718,278 canonical points | ad-hoc SQL (no ref) | Y | `proven_stored_point`, `pt:1`, no vsid | KEEP (Option D); stamp vsid only |
| 5,171 rejects | ad-hoc SQL (no ref) | Y | legacy shape + `detail` | archive, then rebuild current-state |

`f7c4b79` owns provenance, the legacy reject table, and the association PK. The ad-hoc run owns the 718,278 / 5,171 partition. #1016 owns attribution, namespace reservation, reject archive/rebuild, and the three new tables. Two sessions must stop authoring the same objects.

## Why the uncorrected #1016 cannot apply

Measured on the production-faithful fixture against `ebc75bc` (unchanged):

1. `n5_geom_verdict_snapshot_ck` is violated by existing `proven_stored_point` rows with NULL `verdict_snapshot_id` → whole transaction ROLLBACK.
2. Even with that hand-patched, `create table if not exists geo.n5_point_reject` no-ops and leaves PK `(source_key, reason)` with no `lat`/`lng`/`observed_in_z3`/`verdict_snapshot_id`.
