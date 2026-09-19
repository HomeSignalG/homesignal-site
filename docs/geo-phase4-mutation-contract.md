# Phase 4 — source-scoped mutation contract (2026-09-19)

**Nothing was applied to production.** Parked primitive: `docs/geo-source-scoped-reconcile.sql`.
Structural pin: `test/geo-source-scoped-mutation.test.mjs`.

## 1. Destructive-mutation map (complete — searched beyond the two known scripts)

| script / function | table | DELETE scope | INSERT/UPSERT scope | txn boundary | production-capable? |
|---|---|---|---|---|---|
| `n5_unit_a_shadow.py:193` | **`zip_authoritative_membership`** | **`left(zcta5,3) = PFX`** ⚠️ | prefix-scoped select | ONE multi-statement payload = one implicit txn | **YES — resident-facing** |
| `n5_a3_markers.py:130` | **`zip_authoritative_marker`** | **`left(zcta5,3) = PFX`** ⚠️ | prefix-scoped | same shape | **YES — resident-facing** |
| `n5_unit_a_shadow.py:214` | `maps_zip_geography_status` | none | `on conflict (zip) do update` | same txn | yes |
| `n5_boundary_first.py:49` | `n5_boundary_membership` | **none — no removal path at all** | `on conflict (zcta5,source_key) do nothing` | single statement | yes |
| `n5_shard.py:500` | `n5_geom` | **none** | `on conflict (source_key,feature_id) **do nothing**` | per batch | yes |
| `n5_shard.py:642,751` | `n5_frozen` | `z3 = PFX` | per-shard | per statement | scratch |
| `n5_a3_markers.py:90` | `n5_a3_clip_component` | `left(zcta5,3)=PFX` | prefix | same txn | derived |
| `n5_a3_clip_stats.py:92` | clip stats | `left(zcta5,3)=PFX` | prefix | same txn | stats only |
| `n5_recon_population.py:101` | `n5_recon_flat` | **`TRUNCATE` (whole table)** | all | own statement | diagnostic |
| scratch ZCTA tables ×4 | `n5_*_zcta` | `prefix = PFX` | per prefix | per statement | scratch |

**Exactly two prefix-wide deletes touch resident-facing tables.** Everything else is scratch,
derived, or diagnostic.

Two findings that are **not** fixed here and belong to Phase 5:
- `n5_boundary_membership` is insert-only with **no removal path whatsoever**.
- `n5_geom` is `do nothing`, so **changed upstream geometry never updates** — a moved project
  keeps its old feature forever.

## 2. Identities (verified live against `pg_index`)

| layer | identity | multiplicity |
|---|---|---|
| `n5_geom` | `(source_key, feature_id)` | many features per key |
| `n5_boundary_membership` | `(zcta5, source_key)` | many ZCTAs per key |
| `zip_authoritative_membership` | `(zcta5, source_key)` | many ZCTAs per key |
| `zip_authoritative_marker` | `(zcta5, source_key, marker_seq)` | many markers per (ZCTA, key) — production `max(marker_seq)` = 188 |

`record_kind` is carried in the predicates because it is **not** in the membership PK.

## 3. The contract

> For a bounded set of source keys: `NEW − CURRENT → INSERT`, `intersection changed → UPDATE`,
> `CURRENT − NEW → DELETE`, where every DELETE is bounded by `source_key = any(:keys)`.
> **The scope never widens because another project shares a ZIP, ZIP3, registry or batch.**

Phase 5 supplies the keys; the primitive does not know or care how they were discovered.

## 4. Test receipts — real PostgreSQL, temp fixtures, `ON COMMIT DROP`

Run against live PostgreSQL 17.6 temp tables. **No production table is named in the test.**
A deliberate `RAISE EXCEPTION` carries the report *and* forces rollback.

```
memb_deleted=2 memb_upserted=3 mark_deleted=2 mark_upserted=4
PASS C1 move: old ZCTA membership removed
PASS C2 move: new ZCTA membership created
PASS C3 move: obsolete marker removed
PASS A  pure addition inserted
PASS D1 multi-ZCTA: both legitimate ZCTAs kept
PASS D2 multi-ZCTA: only obsolete ZCTA removed
PASS D3 change applied (feature_count 3->4)
PASS E  marker DECREASE, valid marker kept
PASS F  marker INCREASE beside existing
PASS H1 unrelated same-ZIP3 membership BYTE-IDENTICAL (run_id still r0)
PASS H2 unrelated same-ZIP3 markers untouched
failures=0
```
```
OLD ZIP3 method: would DELETE 6 rows (whole prefix 641) and RECREATE them,
                 including 2 rows of UNRELATED projects.
NEW source-scoped: DELETE 2, UPSERT 3, UNTOUCHED 2 unrelated rows.
PASS B  idempotent rerun: deletes=0 upserts=0 fingerprint IDENTICAL
PASS G  rollback after partial mutation: state IDENTICAL to pre-failure
PASS H  unrelated same-ZIP3 rows still run_id=r0 after all of the above
failures=0
```

**The upsert counts are themselves evidence:** 3 of 4 expected membership rows and 4 of 5 markers
were written — the unchanged rows were suppressed by the `is distinct from` guard. That is why
test B reruns to *exactly* 0 deletes and 0 upserts.

## 5. Blast radius, quantified

| | rows deleted | rows recreated/upserted | unrelated rows touched |
|---|---:|---:|---:|
| OLD ZIP3 method | **6** (whole prefix `641`) | 6 | **2** |
| NEW source-scoped | **2** | 3 | **0** |

At national scale the same collapse is the difference between rebuilding **775,459 of 901,465**
membership rows (86%) and touching only the processed keys.

## 6. The enabler — no per-prefix TIGER scratch table is needed

`geo.zcta_boundary`: **33,791 national ZCTA polygons, GiST index `zcta_boundary_geom_gix`**.
Measured read-only: expected-set computation for 3 keys ran in **11.7 ms** via that index
(~3.9 ms/key). The existing scripts load TIGER per prefix only because they are prefix-shaped.

## 7. Deliberately NOT done

No national stale/orphan cleanup. The primitive *can* delete, but Phase 4 does not point it at
the existing orphan population — that remains a separately controlled later phase.

## 8. Production invariants — identical to Phase 0

membership **901,465** · markers **1,004,080** · n5_geom **1,209,747** · boundary **907,297** ·
preservation **3,172,292** · catalogue **234** · RPC md5 **`4037cc5b35113c22869d3cc91fa6e1de`** ·
19475 **34/40** · 64165 **29** · **`new_fns_created = 0`** (the parked functions were not applied).
