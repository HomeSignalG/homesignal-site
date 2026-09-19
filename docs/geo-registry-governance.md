# Geography registry governance (Phase 3, 2026-09-19)

## The invariant

> **No registry exists in HomeSignal ingest without an explicit, evidence-backed geography
> disposition. There is no silent third state.**

Enforced by `scripts/check-geo-registry-parity.mjs` + `.github/workflows/check-geo-registry-parity.yml`.

## Two questions, two authorities, no duplication

| question | authority | why it is authoritative |
|---|---|---|
| Does this registry exist in ingest? | **`jurisdiction-registry.json`** | imported directly into the deployed engine at `get-address-report/index.ts:72`; the connectors' own comments say adding a jurisdiction is "a jurisdiction-registry.json edit, never code here" |
| What is its geography disposition? | **`docs/geo-registry-classification.json`** | new in this phase; reviewable in Git |
| Is it eligible to be processed right now? | **`geo.n5_accepted_source`** | read as a gate by `n5_acquire_registry.py:46-51` and joined by `n5_shard.py:653` |

The classification file deliberately does **not** duplicate `projects`/`pairs` — those are
snapshot-derived counts the runtime table owns. Duplicating them would create a second drift
surface for no benefit.

## ⚠️ PRESENCE IS NOT ELIGIBILITY — two exclusion mechanisms, verified in code

This was modelled wrongly at first and the gate itself caught it. They are not the same:

- **ABSENT from `geo.n5_accepted_source`** → excluded at the INNER JOIN (`n5_shard.py:653`);
  `n5_acquire_registry.py:49` raises *"STOP: no row in geo.n5_accepted_source"*.
  **UNCLASSIFIED.** This is how a **governance hold** is enforced.
- **PRESENT with a non-processable treatment** → carried into `geo.n5_frozen`, then matched by
  **neither** association branch — `n5_shard.py:540` takes `treatment='PROVEN'`, `:543` takes
  `treatment='RECOVERY'`; `n5_acquire_registry.py:50` refuses anything not `RECOVERY`.
  **CLASSIFIED-AND-EXCLUDED.**

Both fail closed. They differ in whether the exclusion is **recorded**. So a recorded treatment
must have a row; a governance hold must have none. **The gate adds no enforcement code** — the
pipeline already fails closed both ways. It makes the decision explicit and visible.

## 🔴 How classification reaches production — THE REAL GAP

**`geo.n5_accepted_source` cannot be reproduced from this repository.** Every one of the 10 repo
references is a READ (`join` / `select`); there is no `INSERT`, and `n5_verify_snapshot.py:28`
states outright that the table "is never written".

Migration `20260902174009 n5_accepted_baseline` created the **table** (DDL captured in the
ledger) but **not the rows**. The table's own comment says why:

> *"…assembled by a **non-atomic per-source loop** on 2026-09-02 ~14:41Z and **not reproducible
> as a single database state**. **Reconciliation target only** — compare against
> `geo.n5_snapshot`, never the reverse."*

So the 234 classification rows were written by undocumented manual SQL. **The table
self-describes as a reconciliation target while functioning as the production eligibility
authority**, and it has not been updated since 2026-09-02 — a second frozen artifact, the same
shape as the root cause this workstream exists to fix.

**Consequences, stated plainly:** classification changes are not reviewable in Git today, there
is no rollback path, and the repo cannot rebuild the table. `docs/geo-registry-classification.json`
is the first half of the fix (the decision is now in Git). The second half — a reviewable
migration that reconciles the table **from** the file, on the `feeds.csv` → `public.feeds`
pattern already proven in `homesignal-ingest` — is deliberately **not** done in Phase 3, which is
governance-only and forbids production geography mutation.

⚠️ **Only the `postgres` role can read this table.** Measured: `anon`, `authenticated` **and**
`service_role` all have `can_select = false` and no `USAGE` on schema `geo`. An ordinary CI job
cannot verify the DB half, which is why the gate prints `DB parity: NOT VERIFIED` unless a
postgres-privileged job supplies `--catalogue`. It never reports that half as passing.

## Dispositions — 240 registries, all explicit

| disposition | n | meaning |
|---|---:|---|
| PROVEN | 145 | geometry is the row's own stored point |
| RECOVERY | 78 | geometry acquired from the publisher |
| NOAUTH | 7 | recorded, not processable |
| BLOCKED_NO_RECORDS | 6 | **governance hold** — 0 live rows, nothing to classify |
| IDENT_UNRESOLVED | 2 | recorded, not processable |
| PENDING_REVIEW | 1 | **governance hold** — evidence recorded, approval deferred |
| HIST_UNRECOVERABLE | 1 | recorded, not processable |

145 + 78 + 7 + 6 + 2 + 1 + 1 = **240**.

**Parity is not eligibility:** 240 ingest registries → 240 explicit decisions, of which **223**
are processable. The 7 formerly-unclassified registries are now explicit holds, still excluded.

`(null)` is a **sentinel, not a registry** — geo joins use `coalesce(registry_id,'(null)')`, so
records with a NULL `registry_id` map to that literal (classified NOAUTH). Exempt from the
ingest-parity check, by name.

## Adding a registry from here

1. Add it to `jurisdiction-registry.json` (ingest).
2. CI **fails** with `FAILURE A` until a disposition exists. It will not assign one.
3. Add an entry to `docs/geo-registry-classification.json` with evidence. A governance hold is a
   legitimate answer and requires a stated reason.
4. Only a **recorded treatment** needs a row in `geo.n5_accepted_source`; a hold must have none.
