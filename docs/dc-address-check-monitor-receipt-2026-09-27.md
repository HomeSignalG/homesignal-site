# Step 12 (C8): the daily data-centre address-check monitor — receipt, 2026-09-27

**What ships:** `docs/dc-address-check-monitor.sql`. It adds a daily snapshot and one new row in the existing
health monitor.

- **No second monitor.** `pipeline_health_tick` (pg_cron, hourly at :10, email via `notify-health`, transition
  alerts with 24h re-notify) gains one check, `dc_address_check`.
- It is spliced into the live definition the same way `docs/app-refresh-sweep-migration.sql` and the ingest
  repo's heartbeat checks were:
  - one anchor, `insert into public.pipeline_health_check as c (`, measured to appear exactly once in production;
  - fail closed, idempotent, re-read after.

## Why a daily snapshot, measured

- A full walk of `public.dc_map1_address_check` over 12,722 ZIP pages takes **36.8 s** in production. That is
  too heavy to run inside the hourly monitor, so pg_cron job `dc-address-check-snapshot` takes it once a day
  into `public.dc_address_check_daily`. The job has its own 300 s ceiling (the database default is 120 s).
  - **Corrected 2026-09-29:** that ceiling was set inside the function, where it does nothing (a SET in a running
    statement re-arms no timer; measured on Postgres 16 and on pg_cron 1.6). It never showed, because the snapshot
    takes 44–47 s. The ceiling now lives in the job command; see `dc-resolver-hardening-receipt-2026-09-29.md`.
- **11:50 UTC** is chosen from measurements:
  - it comes after the daily geocode run (10:45);
  - it comes after the 11:25/11:35 resolvers;
  - it is outside every acquisition window. Atlas and Epoch landed daily between **13:35 and 15:11 UTC** on
    2026-09-22..27, so a snapshot never lands inside the marker-loss window measured in step 13.

## What fails the check, and where each threshold comes from

| class | fails when | source of the threshold |
|---|---|---|
| stale | newest snapshot > 26h old | daily job, pg_cron punctual: one missed run pages |
| invariant | any marker is `NO_CHECK_ROW` / `ACCEPTED_NOT_JUDGED` | structurally 0; measured 0 of 1,817 |
| backlog | queue non-empty at both snapshots **and** nothing geocoded for 30h | daily GitHub-scheduled run; measured lateness up to 195 min |
| coverage | markers or CHECKED fall > 5% since the previous snapshot | largest recorded legitimate drop: Atlas admission, 1,814 → 1,790 (1.3%) |
| drift | the admitted set, or the fingerprint of any shared decision function, changes | any change is surfaced; a gated apply pages once and recovers next day |

- **Fingerprinted functions:** `dc_derived_address_admitted`, `dc_derived_point_verdict`,
  `dc_geocodable_site_address`, `dc_geocode_input`, `dc_resolve_canonical`, `dc_resolve_geography`,
  `map1_dc_zip_members`. A vanished function reads `MISSING`.
- **Before the first snapshot** the row reads `UNMEASURED` and is **not alertable**: no evidence is neither a
  pass nor a failure.
- **Not caught, by design:** a slow decline under 5% a day. The snapshot table keeps the history for when that
  question is asked.

## Production state it starts from (read-only)

- Map 1: 1,817 markers (972 canonical + 845 OSM).
- Address check: 796 checked · 229 no clean match · 792 not checkable · 0 pending (coverage 77.7%).
- Geocode queue: 0.
- Admitted: `compute_atlas/facilities` true, `epoch_ai/data_centers` true, `epoch_ai/timelines` false.
- Fingerprints: admission gate `2c05d65a…`, verdict `09bbb34f…`.

## Proof

- `test/dc_address_check_monitor_pg/run.sh`: **18 checks** on the step 11 stand-in, with a stub monitor
  carrying the real anchor and `_eval` shape.
  - Snapshot = view (markers, per state, per reason), 7/7 functions fingerprinted, no `MISSING`.
  - Not alertable with no snapshot.
  - Each failure class fires, and each just-inside case passes (4% fall, geocoded 29h ago, queue new since
    yesterday).
  - Re-apply is a no-op; a missing anchor is refused.
- **Four mutations caught, on exit code:** a 10% coverage floor, tolerating one invariant break, alertable with
  no evidence, and no backlog grace.
- A harness defect was caught while building it: each case first copied the previous case's mutated row. Every
  case now starts from the untouched real snapshot.
- `test/dc-address-check-monitor-structure.test.mjs`: 17 checks.
- Both run in CI in `zip-membership-suite.yml`.

## Applying it

The change is additive:
- one table (RLS on, service-role only);
- one function;
- one pg_cron job;
- one spliced check.

It changes no pin, no resolver and no resident-facing surface. After the apply, one manual snapshot seeds the
baseline, so the check is measured at once rather than at 11:50 tomorrow.

## Applied and verified in production

- **Applied 2026-09-27 19:10:52 UTC** as migration `dc_address_check_monitor` (ledger `20260927191052`), from
  main `06d9381`, after the monitor's own 19:10 run and outside the :18–:45 resolver window.
- **The splice was one clean insertion.** The monitor went from md5 `32d1ed06…` (20,520 characters) to
  `87ac7af3…` (23,964 characters). Cutting the 3,444 inserted characters back out gives `32d1ed06…` byte for
  byte. Grants are still `{postgres=X, service_role=X}`, and SECURITY DEFINER and search_path are unchanged.
- **First snapshot, taken by hand at 19:11:25 (44.6 s):**
  - 1,817 markers (972 canonical, 845 OSM): 796 checked, 229 no clean match, 792 not checkable, 0 pending,
    0 invariant breaks, queue 0.
  - 7/7 decision functions fingerprinted, none missing; admission gate `2c05d65a…`, verdict `09bbb34f…`.
- **First monitor run after it, 20:10:** 15 checks (was 14), all updated. `dc_address_check` ok, reading
  "baseline (no previous snapshot)". 0 failing checks and no alert sent.
- **First scheduled snapshot, 2026-09-28 11:50:00 (47.1 s):** identical to the baseline on every count. The
  monitor reads "definitions and admission unchanged", and no alert has fired since the apply.

**Gap found in use:** no health check watches the resolver jobs themselves. `dc-resolve-geography` was
cancelled by the 120 s statement timeout at 2026-09-28 20:35 and nothing alerted (see the step 13 receipt).
