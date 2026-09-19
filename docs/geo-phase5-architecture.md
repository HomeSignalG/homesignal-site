# Phase 5 — steady-state architecture decision (2026-09-19)

## A. Architecture comparison

| option | verdict | evidence |
|---|---|---|
| **Global watermark on `created_at`** | **REJECT** | needs a ~145–200 MB index (Phase 2); `created_at` has only **7,361 distinct values** over 3.2M rows so a strict `>` skips boundary-batch rows; **updates don't move `created_at`**; it cannot see DELETES, treatment changes, or coordinate changes; and `n5_geom` is not a valid completion ledger (878,460 geom keys → 875,907 boundary → 872,227 membership; **6,233 keys have geometry but no membership**). A fast INSERT detector that cannot maintain geography is not an architecture. |
| **Rolling ZIP sweep keyed on `app_projects.zip`** | **REJECT as specified** | has a **proven blind spot** — see §4. |
| **Registry sweep** | **REJECT** | no `registry_id` index on `app_projects`; enumeration would seq-scan 2,899 MB per registry. |
| **Queue / change log** | **REJECT** | requires triggers on the hottest table in the system (`*/2` upserts, currently degraded). Operational cost unjustified when an index-backed enumeration already exists. |
| **Hybrid: two-source key-space sweep over a 5-digit unit** | **ACCEPT** | the only option with no blind spot, and it runs on existing indexes. |

## Chosen architecture

**Unit of work: a 5-digit code `C`. Unit of mutation: the source key.**

```
keys(C) =  { source_key : app_projects.zip = C, eligible }        -- new + changed
        ∪  { source_key : zip_authoritative_membership.zcta5 = C } -- orphans + moves
        ∪  { source_key : n5_boundary_membership.zcta5 = C }
```

Then reconcile `keys(C)` with the Phase 4 primitive. ZIP3 (or any partition of `C`) remains a
batching label only.

**Why the union is required, not belt-and-braces:** each source alone is blind to what the other
sees. `app_projects` cannot see a key whose project row was deleted (the stale-sweep orphan
population, measured 3.9% of membership rows in the 27xxx band). Membership cannot see a brand-new
project that has no geometry yet — **which is exactly today's 53,610-key defect**.

## 4. Proof there is no ingest-ZIP / boundary-ZCTA blind spot

Measured, bounded, no national scan:

1. **`not_measured` ZIPs carry real work.** All 12 sampled `NO_ZCTA_IN_TIGER_2025` ZIPs hold
   eligible pinned development rows (50–512 each) and **0 membership rows**.
2. **Their geometry lands in `boundary_complete` ZCTAs.** Projects ingested at ZIP `01014`
   (a Chicopee MA P.O. ZIP, `not_measured`) intersect ZCTA **`01040`**, which is
   `boundary_complete` — and they are **already members there** (`already_member = 1`).
3. **Therefore the existing build is ZCTA-driven from geometry, not ingest-ZIP-driven.** A sweep
   keyed on `app_projects.zip` and restricted to the 12,013 `boundary_complete` ZIPs would never
   visit `01014` and would never discover those keys. **That is the blind spot, and it is real.**
4. **The union closes it** by enumerating over ZCTAs as well as ingest ZIPs, and by iterating
   **every** ZIP present in `app_projects` — including the 706 — since discovery is by ingest ZIP
   while mutation is by computed ZCTA.

⚠️ **Residual, stated rather than assumed away:** a key present in `n5_geom` but in neither
`app_projects` nor any membership/boundary row is invisible to this sweep. It is not
resident-facing (no membership ⇒ no card), so it is orphan *geometry*, not orphan coverage. It
needs its own sweep and is **not** solved here.

## 9/10. Geometry and boundary lifecycles — DESIGNED, NOT IMPLEMENTED

Both are stated honestly as **not done in Phase 5**:

- **`geo.n5_geom` is `ON CONFLICT (source_key, feature_id) DO NOTHING`** (`n5_shard.py:500`), so a
  changed feature never updates and an obsolete feature is never removed — a moved project keeps
  stale geometry forever. Reconciling it needs the same algebra at `(source_key, feature_id)`.
  **Publisher feature-ID instability is the open question**: if a publisher renumbers features,
  `CURRENT − NEW` deletes every old id and inserts every new one, which is correct but rewrites
  the whole key. Whether that is acceptable, or whether identity should be geometry-hash-based,
  is a design decision this phase does not have the evidence to settle.
- **`geo.n5_boundary_membership` is `ON CONFLICT DO NOTHING` with no removal path at all**
  (`n5_boundary_first.py:49`). The `A→B`, `A+B→B`, `A→none` transitions are unrepresentable today.

Neither is implemented because both require acquisition-path changes that belong with a tested
apply, not a parked comment — the *"a parked migration that is mostly comments is not a migration"*
trap this repo has already paid for once.

## 12. Completion invariant

**Completion is state equality, not a flag.** For a processed key, reconciliation succeeded iff
actual == expected at **every** layer: eligibility, geometry, boundary intersections, authoritative
membership, markers.

**No ledger is proposed.** A ledger recording "key K processed at T" is precisely the failure this
workstream exists to undo: it can report success after only an upstream stage completed, which is
how 6,233 keys came to have geometry but no membership while every shard read `done`. The only
honest completion test recomputes expected and compares — which is what the reconcile already does,
so the reconcile *is* the check.

## 13. Failure / transaction model

- **Acquisition is outside the transaction.** Publisher I/O happens first and its result is
  materialised; no database transaction is held open across a network call.
- **Transaction unit = one bounded key batch**, as one multi-statement payload (one implicit
  transaction under the simple-query protocol) — the guarantee `n5_unit_a_shadow.py` already
  relies on. Proven by Phase 4 test G: a failure after a partial mutation left state byte-identical.
- **Retry is safe because reconcile is idempotent** — Phase 4 test B reran to exactly 0 deletes and
  0 upserts with an identical fingerprint. A retry after either a network or a DB failure recomputes
  expected and converges.
- **No resident-visible half-move**: the delete and the upsert are in the same statement, so a ZCTA
  is never observed empty. This removes the hazard `select_prefixes()`'s own docstring describes —
  *"a prefix under rebuild momentarily has zero membership rows … those live ZIP pages ERROR for the
  width of the rebuild."*

## 16. Performance — DEFERRED under §J

`dev-reports-rolling-refresh` has **not** recovered (18:00Z hour: 1 failure, avg 53.5 s against a
5–8 s healthy baseline from 10:00–15:00). §J says stop rather than add load, so no load testing was
done and **no national cycle estimate is claimed**.

What is known from plan shape alone (`EXPLAIN`, no execution): both reconcile statements are fully
index-driven, zero Seq Scans, GiST on `zcta_boundary`, and both DELETEs index-scoped by `source_key`.

⚠️ **A supporting index is probably required and is deliberately NOT created.**
`zip_authoritative_membership` PK is `(zcta5, source_key)`, so the reconcile's
`source_key = scope.source_key` binds only the **second** column. §H permits "narrowly proven
supporting indexes" — this one is not yet *proven*, and adding write amplification while ingest is
degraded is what constraint 8 forbids. **Phase 6/7 blocker.**
