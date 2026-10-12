# Runbook — `dev_refresh_collect()` blocked-lookup plan fix (PREPARED, NOT EXECUTED)

Status: **nothing here has been run against production.** Separate founder authorization is required for step 2. Files:
`docs/dev-refresh-collect-blocked-plan-stable.sql` (apply) · `…-reverse.sql` (reversal) · suite `test/dev_collect_plan_pg/` (CI: `dev-collect-plan-suite`).

## Fingerprints (md5 of `pg_proc.prosrc`, never of `pg_get_functiondef`)
| state | md5(prosrc) | chars |
|---|---|---|
| ORIGINAL (production, read 2026-10-12) | `2012877397532a1e8e160b5a7a4c8032` | 15,800 |
| PATCHED (computed separately in Python from the production body + the one block) | `12b3dcc680b322af7d2cd61734be9b4c` | 16,047 |

Production properties read-only 2026-10-12: owner `postgres`, ACL `{postgres=X/postgres,service_role=X/postgres}`, SECURITY DEFINER,
`search_path=public, net`, returns integer, plpgsql, no dependents. The scripts require SECURITY DEFINER / that config / integer / no args
absolutely, and owner, ACL, attributes and dependency fingerprint to be identical before and after.

## 1. Preflight (read-only, any time)
```sql
select md5(prosrc), length(prosrc), prosecdef, proconfig, proowner::regrole, proacl
  from pg_proc where oid = 'public.dev_refresh_collect()'::regprocedure;
```
Must read the ORIGINAL row above. Anything else: **stop** (the apply would refuse anyway). Pick a moment between ticks if possible, but the
script does not depend on it: DDL on a busy database does not get its lock instantly.

## 2. Apply (needs separate authorization)
```
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f docs/dev-refresh-collect-blocked-plan-stable.sql 2>&1 | tee apply-evidence.log
```
The file opens one transaction with `lock_timeout 3s`, `statement_timeout 30s`, `idle_in_transaction_session_timeout 60s`; verifies the
ORIGINAL fingerprint, signature and security properties; recomputes the PATCHED fingerprint from the planned replacement **before** executing;
replaces exactly one expression; re-verifies the PATCHED fingerprint, that reversing the replacement gives back the original body, that the
definition with its body removed is byte-identical, and that owner/ACL/attributes/dependencies are unchanged — then commits. Any mismatch or SQL
error raises, the transaction aborts, and nothing is changed. Evidence lines are `EVIDENCE before: …` / `EVIDENCE after: …` (no secrets).
If it fails with *lock timeout*, nothing changed: wait for a quiet moment and rerun (the cron tick runs every 2 minutes and the function's
own advisory lock is unrelated). Re-running on the patched body is a no-op only on the exact PATCHED fingerprint.

## 3. Reversal (separate file, same discipline)
```
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f docs/dev-refresh-collect-blocked-plan-stable-reverse.sql 2>&1 | tee reverse-evidence.log
```
Requires the exact PATCHED fingerprint; at the ORIGINAL it is a no-op; **any other body is refused and left untouched** (an intervening change
is never overwritten). Restores the ORIGINAL fingerprint; owner/ACL/security preserved.

## 4. 24-hour post-deployment measurement (the collector is not "fixed" until this passes)
Compare the 24 h after apply with the 24 h before, same definitions both times:
1. `cron.job_run_details` job 14: success / failure counts and rate; any `canceling statement due to statement timeout` (120 s) recurrence.
2. Tick latency (`end_time - start_time`) p50 / p95 / max, and specifically ticks that carried a full 16-response batch.
3. Cursor progression: ZIPs whose `last_collected_response_id` advanced per hour; no ZIP stuck behind the same set for >1 tick.
4. Lost responses: `mode='zip'`, status 200 responses that **aged out of the 20-minute window without ever being collected** — the same
   eligibility definition (newest per ZIP, id > cursor) before and after.
5. Accepted/refused behaviour: `dev_refresh_source_failures` rows (`blocked_update` true/false), writes per tick, refused-and-handled count;
   failed sources with stored records must still block.
6. Any new error class in the job log.
Success: 0 timeouts, p95 latency in the seconds range, lost responses ≈ 0, blocked/accepted ratios unchanged. Source-receipt and geographic-
expansion migrations stay blocked until this is demonstrated.
