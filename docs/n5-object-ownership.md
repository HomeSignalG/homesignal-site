# N5 OBJECT OWNERSHIP — who authors what, across two parallel sessions

Written 2026-09-03. **Purpose: stop two sessions independently authoring the same production
objects.** That already happened once — see `docs/n5-applied-state-of-record.md` — and it cost a
migration that could not have applied, because it was written against a pre-state that no longer
existed.

## The two authors

| author | branch | contributed |
|---|---|---|
| **Session P** (parallel) | `origin/claude/homesignal-zip-forensics-13xkmw` | `f7c4b79` — `docs/n5-provenance-and-key-migration.sql`, **applied to production ~2026-09-02 23:48–23:50Z**, plus the ad-hoc materialization at 23:50:51 / 23:51:27–23:53:02Z |
| **Session C** (this one, PR #1016) | `claude/n5-canonical-provenance` | `docs/n5-canonical-geometry-provenance.sql` — **never applied**, plus the publication/sync lifecycle in `scripts/n5_shard.py` and the executable PostGIS suite |

**Proof #1016 has never been applied**, by absence in production: `verdict_snapshot_id` absent ·
`n5_geom_verdict_snapshot_ck` absent · `n5_geom_pt_namespace_ck` absent · `n5_proven_verdict`,
`n5_verdict_manifest`, `n5_association_stage` — 0 of 3 present. `verdict_snapshot_id` appears
**0 times** in Session P's migration; it is unique to #1016.

## Object-by-object

| object | created by | applied in prod | current production shape | #1016 action |
|---|---|:--:|---|---|
| `geo.n5_geom.provenance` | **P** (`f7c4b79`) | **YES** | `text NOT NULL`, no default | **VALIDATE** — confirm shape, do not re-add |
| `n5_geom_provenance_ck` | **P** | **YES** | `check (provenance = ANY (ARRAY['recovered_authoritative','proven_stored_point']))` | **VALIDATE** — definition already correct |
| `geo.n5_geom.verdict_snapshot_id` | **C** | no | **absent** | **CREATE** (nullable, no default) |
| `n5_geom_verdict_snapshot_ck` | **C** | no | absent | **CREATE** — only *after* the backfill, or it fails on 718,278 rows |
| `n5_geom_pt_namespace_ck` | **C** | no | absent | **CREATE** — precondition already satisfied (0 violators) |
| `n5_geom_semantics_ck` | pre-existing | YES | `check (outcome=1 and geom is not null or outcome<>1)` | **LEAVE UNTOUCHED** |
| `geo.n5_geom` 718,278 proven rows | **P** (ad-hoc) | **YES** | `pt:1`, ST_Point, SRID 4269, `first_z3`/`invalid_reason` NULL, `outcome=1` | **ALTER** — attribute only (`verdict_snapshot_id`), never delete/rebuild |
| `geo.n5_geom` 23,284 recovered rows | `recover_shard` | YES | `recovered_authoritative` | **LEAVE UNTOUCHED**, `verdict_snapshot_id` stays NULL |
| `geo.n5_point_reject` (table) | **P** | **YES** | `source_key, registry_id, reason, detail jsonb, rejected_at`; RLS on | **ALTER** — explicit transition, never `create table if not exists` |
| reject PK | **P** | YES | **`(source_key, reason)`** | **ALTER** → `(source_key)` (data permits: 0 multi-reason keys) |
| `n5_point_reject_reason_ck` | **P** | YES | the approved 6-value domain | **VALIDATE** — already correct |
| reject `detail` | **P** | YES | `jsonb`, populated on all 5,171 | **RETAIN** — the only durable snapshot provenance the legacy run left |
| reject `lat` / `lng` | **C** | no | absent | **CREATE** |
| reject `observed_in_z3` | **C** | no | absent | **CREATE** |
| reject `verdict_snapshot_id` | **C** | no | absent | **CREATE** (NOT NULL on the rebuilt current-state table) |
| 5,171 legacy reject rows | **P** (ad-hoc) | **YES** | historical, `phase1-2026-09-01` | **ARCHIVE then REBUILD** — see the migration §5 |
| `geo.n5_point_reject_archive` | **C** | no | absent | **CREATE** |
| `geo.n5_association` PK | **P** | **YES** | **`(source_key, zip)`** via create-copy-drop-rename swap | **VALIDATE** — #1016's §3 becomes a no-op assertion |
| `geo.n5_association` 20,170 rows | shard builds | YES | 20,170 distinct pairs, 0 conflicting, evidence 1/2/3 = 5,592/9,857/4,721 | **LEAVE UNTOUCHED** |
| `geo.n5_proven_verdict` | **C** | no | absent | **CREATE** |
| `geo.n5_verdict_manifest` | **C** | no | absent | **CREATE** |
| `geo.n5_association_stage` | **C** | no | absent | **CREATE** |
| `geo.n5_shard.detail` snapshot attribution | **C** | n/a | `jsonb`; #1016 adds `verdict_snapshot_id` to the payload | **CODE ONLY** — no DDL; 13 shards done, 531 pending |

## Standing rule going forward

1. **Session P owns** the provenance column, its CHECK, the reject-table *base* shape and its
   reason domain, and the association key. #1016 treats all of these as **pre-existing** and only
   validates them.
2. **Session C (#1016) owns** the snapshot-attribution layer: `verdict_snapshot_id` on both
   tables, the biconditional and `pt:` namespace constraints, the reject-table extension and
   archive, and the three publication tables.
3. **Neither session may create an object the other owns.** Before adding DDL to either branch,
   check this table. If an object is not in it, add the row in the same commit.
4. **The pre-state a migration is written against must be re-measured, not remembered** — that
   is the entire lesson of `f7c4b79` landing between #1016's design and its apply.
