# Recovery posture for the ZIP-geography migration (K12)

**Status: K12 CLEARED with a documented limitation — founder decision, 2026-09-01.**

This is the migration/preservation record of the backup decision. It is referenced from
`docs/preservation-baseline-protection.sql` and governs every phase of the geographic
migration.

---

## The decision

**Point-in-Time Recovery will NOT be enabled at this time.**

Verified by the founder in the Supabase dashboard, 2026-09-01:

| | |
|---|---|
| Plan | **Pro** |
| Scheduled physical database backups | **active** |
| Daily backups | **available** |
| Backups visible in the dashboard | **2026-08-25 through 2026-09-01** |
| Point-in-Time Recovery | **NOT enabled**, and remains disabled for now |

Founder ruling, verbatim in scope: *"I accept daily physical backups as the platform
recovery mechanism for this migration."*

**The documented limitation, stated so no later session mistakes it for PITR:**
recovery granularity is the set of available scheduled physical backups — **not**
arbitrary point-in-time recovery.

---

## What was independently established from the database, read-only

Taken 2026-09-01 against project `qwnnmljucajnexpxdgxr`. These readings are consistent
with the dashboard and are recorded so the two halves of the evidence sit together:

```
archive_mode      = on
archive_command   = /usr/bin/admin-mgr wal-push %p >> /var/log/wal-g/wal-push.log 2>&1
archive_timeout   = 120s
wal_level         = logical      wal_compression = zstd
pg_stat_archiver  = 3,209 segments archived, 0 failures
last archived     = 0000000100000192000000D1 at 2026-09-01 14:21:22Z
pg_is_in_recovery = false        replication slots = 0
database size     = 6,382 MB     (of which schema `preservation` = 1,132 MB
                                   -- 951 MB heap + 180 MB indexes)
```

⚠️ **`archive_mode = on` is NOT evidence that PITR is available.** Supabase archives WAL
on projects generally; PITR is a separate paid retention add-on, and the dashboard is the
authority on whether it is enabled. It is not. A future session reading `archive_mode`
alone and concluding "we have PITR" would be wrong.

---

## What this means for how the migration must be built

**A restore is a catastrophe backstop, not an undo button.** Two properties make that
concrete, and both are engineering constraints rather than commentary:

1. **Granularity.** The nearest recovery point can be up to roughly a day before the
   mistake. There is no "restore to 30 seconds ago".
2. **Blast radius.** A physical restore is **whole-database**. Restoring to undo a
   mistake in the `preservation` schema would also discard every legitimate production
   write since that backup — and this database writes continuously:
   `dev_refresh_tick(8, 20)` every 2 minutes, `app_refresh_sweep()` and
   `epa_frs_probe_tick()` every 15 minutes, plus the hourly digest dispatch and health
   monitor. Using a restore to fix a small error would cost real content.

**Therefore every phase of the migration must be independently reversible without a
restore.** The operative rules, which the absence of PITR tightens rather than relaxes:

- Every new object is **additive** and independently droppable. Rollback is always
  "stop reading the new thing", never "restore the old thing".
- **No deletion, overwrite, destructive reassignment, deduplication, or replacement** of
  the existing development corpus or of legacy ZIP associations is authorized.
- The **Phase-1 preservation baseline** (`preservation`, snapshot `phase1-2026-09-01`)
  and its database protections **remain required**. The baseline is the in-database
  rollback reference precisely because the platform one is coarse.
- The four layers of protection against catastrophic loss, in order:
  **(1)** scheduled daily physical backups · **(2)** the preservation baseline ·
  **(3)** repository / audit evidence · **(4)** deliberate administrative controls
  (`docs/preservation-baseline-protection.sql`).

**The absence of PITR does not relax any migration safety requirement.**

---

## Residual risk that remains open, and is accepted

`DROP` and destructive DDL against the `preservation` schema cannot be prevented in the
database — `postgres` is not a superuser here, so `CREATE EVENT TRIGGER` is unavailable
and there is no interception point. See the header of
`docs/preservation-baseline-protection.sql`. With PITR off, the recovery from such an
event is the most recent daily physical backup, with the granularity and blast radius
described above. **The baseline must never be described as technically undeletable.**
