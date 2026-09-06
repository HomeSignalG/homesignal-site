# VERDICT — BLOCKED-ON-PERMISSION

Task 1 could not verify pg_stat_activity visibility for other sessions, so per Task 1 this run
stopped before Task 2. Gate 9 was not re-run and has no verdict.

## The exact permission missing

Membership in the built-in role **`pg_read_all_stats`** (or superuser) for the role the Gate 9
harness runs as. Measured 2026-09-06 17:45Z:

```
pg_has_role('anon','pg_read_all_stats','member')          false
pg_has_role('authenticator','pg_read_all_stats','member') false
anon rolsuper                                             false
```

Probe run as `anon` — the only role the harness ever authenticates as — over 47 other sessions:

| column | sessions where it is visible |
|---|---:|
| application_name | 40 |
| **query** | **0** (all 47 return the literal `<insufficient privilege>`) |
| **state** | **0** |
| **wait_event** | **0** |
| **query_start** | **0** |
| **xact_start** | **0** |

Task 2a requires all seven of those columns; five are invisible. Task 2e's
BLOCKED-ON-ENVIRONMENT rule requires matching other sessions' `query` against
`app_projects_for_zip` / `app_zip_projects_markers`, which the harness cannot read at all — so
the verdict rule is not evaluable by the instrument that is supposed to evaluate it.

## Why the application_name tagging in Task 1 has nothing to attach to

`scripts/verify-map1-zip-states.mjs` has **no Postgres connection**. It drives Chromium against
`https://homesignal.net`, and every database read is an HTTP request the page's own supabase-js
anon client makes to PostgREST. A repo-wide search for a Postgres client (`require('pg')`,
`from 'pg'`, `new Client(`) returns zero files, and the repo ships no `package.json`. PostgREST
names its own pooled backends: the only distinct `application_name` across them is `postgrest`.

The two ways to create a taggable connection are both decisions this task does not authorize:
granting `pg_read_all_stats` to the public `anon` role would let any anonymous caller read every
session's SQL, and giving the harness its own Postgres connection requires a database credential
that does not exist as a CI secret today. Per the standing rule on secrets, I stopped rather than
create or relocate one.

## Evidence

`artifacts/gate9/task1_permission_probe.json`

Not produced, because Task 1 says do not proceed to Task 2:
`pgstat_pre_<runid>.json`, `timings_<runid>.csv`, `pgstat_fail_<runid>.json`.

## What was verified by reading, not re-derived

| claim | measured |
|---|---|
| registry 12,722 = 12,013 boundary_complete + 706 not_measured + 3 | confirmed; the 3 (94128, 95219, 99128) carry **no status row at all** rather than status `pending` |
| 64-row repair fingerprint | `161ba702caee12bab4d0b1fd783cdf8a` reproduced from the DB with `collate "C"` pinned |
| `app_zip_geography_cutover` | **12,077 rows, 12,013 enabled / stamped** — not "12,077 all enabled and stamped"; the 64 read `enabled=0, stamped=0` |
| open item 2 (10015 / 78711 return 0 via authoritative branch; 01004 returns 90 legacy rows) | **no longer reproduces** — all three return `UNAVAILABLE:not_measured` as `anon`. Repaired earlier in this session and reported at the time, not silently. |

Rule 5 (run `34044240308`) and the ZCTA instrument (run `34043878981`) were not re-proven.

## Handoff

`docs/handoff/app_zip_geography_cutover.md`

## Nothing was modified

`app_zip_geography_cutover`, `app_projects_for_zip`, `statement_timeout`, the shipped function,
and the harness retry logic are all untouched by this run. No gate was added.

Branch `claude/homesignal-zip-forensics-13xkmw` at `8daf4dc` — ahead of the `0fa2194` named in the
brief, which is an ancestor of it.
