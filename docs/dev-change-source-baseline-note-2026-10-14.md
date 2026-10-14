# Denton source baseline: operations note (2026-10-14)

SQL of record: `docs/dev-change-source-baseline.sql`. Applied to production 2026-10-14 18:20Z as migration
`dev_change_source_baseline_denton_20261014` (ledger `20261014182054`). The stored statements are the file's executable
statements; the file adds comments only (whitespace-collapsed md5 of both, comments removed: `f8f249e0de3a90165b7ff98ad4fcd449`).
`dev_change_observe_zip` md5 `2f70e4c786ae301d0efe9cdeb333f46d` -> `161d7fd2715eb5627f2c8ef7cdf9ef65`; excising the inserted text
recovers the original.

## What it is
An allowlist (`dev_change_source_baseline`) of the seven `denton-city-projects-*` registry ids. For those families, in an
ordinary run, the FIRST sighting of an identity is written `is_baseline = true`, `material = false`, so
`dev_change_event_reportable` never shows it. Window: until 2026-10-20 00:00Z or `closed_at`. Later real changes to a known
record stay ordinary material events. Every other source is evaluated exactly as before.

## Why not a baseline run, and why not #1829 recovery
A baseline run only marks rows already in `app_projects`, baselines every source's new records on the ZIP that night, and misses
ZIPs the ~53 h refresh sweep reaches later. Recovery (`dev-change-recovery.sql`) classifies only records stamped
`scope_origin = 'polygon_member'`; a new source on an unchanged ZIP is unstamped.

## Verification (after Denton rows reach `app_projects`)
```sql
select count(*) total, count(*) filter (where is_baseline and not material) ok, count(*) filter (where material) bad
  from public.dev_change_event
 where event_type = 'first_detected' and identity_key like 'arcgis:denton-city-projects-%';
```
Expect `bad = 0`. Run after each 02:00-08:59Z tick from 2026-10-15; close the window once every Denton ZIP is observed:
`update public.dev_change_source_baseline set closed_at = now() where registry_id like 'denton-city-projects-%' and closed_at is null;`

Cost: a genuinely new Denton filing first seen inside the window is recorded silently.
Tests: `test/dev_change_source_baseline_pg/run.sh` (22 checks, 4 mutations), workflow `dev-change-source-baseline-suite.yml`.
