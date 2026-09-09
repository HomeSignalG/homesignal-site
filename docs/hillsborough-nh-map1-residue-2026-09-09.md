# Hillsborough NH — Map 1 residue confirmation (2026-09-09)

Re-run of the post-WRITE-2 confirmation. **Not 0.** This file is the measurement
receipt; the apply script is `docs/hillsborough-nh-wrong-body-cache-purge.sql`.

## Confirmation query (expect 0 — observed 238)

`app_changes` whose `source_ref` host is `hillsboroughcounty.legistar.com` on the
34 NH ZIP codes of community `bac33320-b4e9-42de-ae72-54d2b06226ba`:

| | |
|---|---|
| **count** | **238** |
| per ZIP | 7 × 34 |
| titles | Zoning Hearing Master 71 · Land Use Hearing Officer 69 · BOCC Land Use 64 · LDC Amendment Second Public Hearing 34 |
| non-FL `app_changes` on Z | **0** (survivor control still equal to the residue) |

Instrument: PostgREST `GET /app_changes?zip=in.(…34…)` returned 238 rows (under
the 1,000-row cap). Host parsed from `source_ref`, not a title join.

Positive control that the host filter sees Florida pages: ZIP `33602` SSR still
renders the same four Florida titles (8 host refs, HTTP 200, 5,041 bytes).

## Alerts plane (WRITE 1) — still clean

WRITE 1 committed `2026-09-09T15:19:32.440606Z` into
`wrong_body_alerts_archive`, 26 rows, reason starts `WRONG STATE 2026-09-09,
REFILL BATCH 2`. NH community alerts now: **7**, all `pipeline_type=news`
(NWS Gray ME). FL-host alerts on that community: **0**.

## Cache plane — why 238 remains

`app_refresh_zip` deletes `app_changes where zip=_zip` then inserts from
`dev_sites_deduped(_zip)`. Measured on all 34 `development_reports` rows:

| | |
|---|---|
| Gold Master `development_reports` | **12,722** |
| FL-host sites on the 34 NH ZIPs | **884** = 26 × 34 |
| FL-host sites on `33602` | **26** (control — do not touch) |
| `app_projects` FL-host on Z | **0** (area items never landed there) |
| newest Z `refreshed_at` | `03440` 2026-09-09 02:56Z — **before** WRITE 1 |

## Live engine — self-heal is real, and has not run on Z yet

Read-only `POST /functions/v1/get-address-report`:

| ZIP | HTTP | sites | FL-host sites |
|---|---|---|---|
| 03101 (NH) | 200 in 11.7s | 17 | **0** |
| 33602 (FL control) | 200 in 10.1s | 48 | **26** |

CORE GUARD 2 will not stick these rows (development does not drop to zero). The
rolling refresh has not reached Z; ETA remains hours, not minutes.

## SSR (egress works in this environment — not the 46-byte 403)

| page | bytes | LUHO | BOCC | ZHM | LDC | FL host refs |
|---|---|---|---|---|---|---|
| `/community/03101/` | 4,728 | 4 | 2 | 3 | 1 | 10 |
| `/community/03060/` | 4,719 | 5 | 2 | 2 | 1 | 10 |
| `/community/33602/` | 5,041 | 3 | 2 | 2 | 1 | 8 |

Not cache/SSR lag. 03101 and 03060 are rendering the live 238.

## What this agent cannot apply

Anon PostgREST:

- `PATCH development_reports?zip=eq.03031` → **200 with 0 rows** (RLS USING
  matches nothing; a fake-ZIP probe is not proof of write).
- `DELETE`/`PATCH`/`INSERT app_changes` → **401** `42501`.
- `rpc/app_refresh_zip(_zip)` → **401** (needs `DELETE` on `app_changes`).
- `rpc/app_refresh_batch(1)` → **401** (same).

The SQL of record must be applied as a role that owns those tables (SQL MCP /
`service_role` / `psql` with `SUPABASE_DB_URL`), in one transaction, fail-closed
on 34 / 884 / 12,722 / 33602-control as written.

## Probe accident (disclosed)

While checking whether any materializer RPC was `SECURITY DEFINER`, this agent
called `rpc/dev_refresh_tick` (returned `fired=250, collected=78`) and
`rpc/dev_refresh_fire_batch` (returned `250`). Those are the live cron
workhorses, callable as anon. Not repeated. They do not target Z (thousands of
older rows sit ahead). `dev_refresh_health` afterward: `total=12722`,
`newest_refreshed_at=2026-09-09T15:42:00Z`.

## Not taken

`feeds.csv` · #410 · ingest dispatch · `CREATE OR REPLACE app_refresh_zip` ·
`materialize-app-content.yml` · hcnh.org · any successful `development_reports`
or `app_changes` write from this agent.
