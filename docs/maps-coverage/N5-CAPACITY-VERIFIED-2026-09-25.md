# N5 capacity — VERIFIED physical disk (2026-09-25)

**Status: production N5 migration (`docs/n5-generation-publish.sql`) and any generation run remain
BLOCKED. The provisioned disk is being increased first.** Nothing was applied, run or activated.

## Authoritative figures (Supabase dashboard, read by the founder, 2026-09-25)

| | value |
|---|---|
| Provisioned database disk | **18 GB** |
| Disk utilization | **81%** |
| Database | 11.3 GB |
| WAL | 2.7 GB |
| System | 206.1 MB |

These are the platform's own figures. They **replace every assumption that the physical disk is
11,607 MB.** That number was always a constant in the N5 drivers (`DISK_TOTAL_MB`), never a
reading of provisioned capacity, as `N5-NATIONAL-DISK-FLOOR-STOP.md` and
`N5-NATIONAL-BATCH-03-EVIDENCE.md` already recorded.

Corroboration (read-only SQL, same day): `pg_database_size()` = 11,268 MB at 13:38 UTC and 11,367 MB
at 14:41 UTC, agreeing with the dashboard's 11.3 GB. ⚠️ **The database grew ~99 MB in that hour**;
the growth rate is not established and must be measured before any cutover.

## Free space

- By utilization: 18 GB × (1 − 0.81) ≈ **3.4 GB free**.
- By components: 18 − (11.3 + 2.7 + 0.2) ≈ 3.8 GB. The ~0.4 GB gap is rounding or usage the three
  components do not name. **The conservative 3.4 GB is the figure of record.**

## What N5 needs (from the merged #1336 measurements, 2026-09-25)

| component | MB | basis |
|---|---:|---|
| Migration net (new generation-keyed indexes − old primary keys dropped) | +72 | ~448 estimated − 376 measured |
| Migration temporary peak (Part B, before Part C frees the old keys) | ~900 | ~448 indexes + ~450 WAL, estimated; the gate reserves 950 |
| Second generation — serving tables + indexes | ~1,251 | 803 measured heap + ~448 estimated |
| Second generation — new frozen snapshot | ~1,453 | today's snapshot, measured (946 heap + 507 index) |
| Second generation — geometry for new projects | ~100 | estimate |
| **Persistent addition, migration + retained second generation** | **~2,876** | |
| WAL during a generation build | 0 → ~1,300 | WAL is **measured** at 2.7 GB today; `max_wal_size` is 4 GB, so the conservative worst case is ~1.3 GB more. This is a checkpoint target, not proof of consumption |
| Safety floor | 2,048 | unchanged |

⚠️ **Correction to #1336:** its "a second national generation adds ≈1.25 GB" counted only the four
serving-plane tables. Opening a generation also writes a new snapshot into
`preservation.app_project_identity` (~1.45 GB), so the real figure is ~2.8–2.9 GB.

## Verdict

- **Migration alone:** it needs 2,998 MB free (floor + 950), against ~3.4 GB free. That is about
  0.4 GB above the floor. It is marginal, and growth of ~0.1 GB/hour would erase that margin.
- **Migration + retained second generation + floor:** it needs 2,876 + 2,048 ≈ **4.9 GB free** with no
  WAL growth, and ≈ **6.2 GB** with the conservative WAL allowance, against ~3.4 GB free.
  **INSUFFICIENT at 18 GB.**
- **Minimum provisioned disk to do it within the floor:** about 14.6 GB used today + 2.9 + 1.3 + 2.0
  ≈ **20.8 GB**, before any allowance for ongoing database growth. Size the increase above that.

Do not lower the 2,048 MB floor to make any of this fit.
