# N5 APPLIED STATE OF RECORD — production as it already is

> ## ⛔ THIS DESCRIBES SQL ALREADY APPLIED TO PRODUCTION BY A PARALLEL SESSION.
> ## IT MUST NOT BE RE-EXECUTED AS PART OF PR #1016, OR AT ALL.
>
> This file is a **receipt**, not a migration. It is deliberately a `.md` and deliberately
> **not** in any migrations path, because a committed runnable migration that re-describes
> already-applied production SQL is a loaded gun: a future session or CI job that "just ran
> the migrations" would re-insert 718,278 rows and re-derive a partition that already exists.
> Every SQL block below is fenced prose. There is nothing here for a runner to pick up.
>
> Its purpose is **reproducibility and provenance**. Until this file existed, the statements
> that produced the current canonical point/reject partition existed in **no repository ref**
> — `git log --all -S"distinct_coords"` returned zero commits. That was the hole.

Written 2026-09-03. Production reads are metadata + aggregates only; **zero production writes
were made to produce this record.**

---

## 1. WHAT IS EXACT vs WHAT IS RECONSTRUCTED

Three different evidentiary grades appear below. They are never mixed.

| grade | meaning | applies to |
|---|---|---|
| **EXACT RECOVERED SQL** | byte-recoverable from a commit in this repository | the schema half (§3) |
| **SEMANTICALLY RECONSTRUCTED SQL** | not recoverable; re-derived so that it provably reproduces the measured end state | the materialization half (§4) |
| **MEASURED PRODUCTION RECEIPT** | read directly from production on 2026-09-03 | §2, §5 |

**The materialization SQL is NOT recovered and this file does not pretend otherwise.** No ref in
this repository contains it. What is proven is its *effect*, its *snapshot*, its *population*
and its *rules* — each from durable evidence, itemised in §5.

---

## 2. ORIGIN — MEASURED PRODUCTION RECEIPT

Two writers acted on `geo.n5_*` on 2026-09-02. This session (PR #1016) was one; it wrote
nothing to production. The other applied both halves below.

| time (UTC) | event | evidence |
|---|---|---|
| 23:17:28 | `8e3da30` — PR #1016's first commit (PR opened 23:18Z) | git |
| **23:47:51** | **`f7c4b79`** — parallel session commits `docs/n5-provenance-and-key-migration.sql` on branch **`origin/claude/homesignal-zip-forensics-13xkmw`** | git |
| 23:48:35 | `87e9147` — same session edits `docs/n5-spatial-read-rpc.sql` | git |
| ~23:48–23:50 | **schema half applied to production** (§3) | production schema matches `f7c4b79`; `n5_association` comment is **byte-identical**, md5 `2dbf59142328b70d9a5fa3f3270ea8fb`, 462 chars, on both sides |
| **23:50:51.752805** | **5,171 reject rows written — a single instant, i.e. one set-based statement** | `min(rejected_at) = max(rejected_at)` |
| **23:51:27.92 → 23:53:02.17** | **718,278 canonical points written (95 s)** | `min/max(recovered_at)` on `provenance='proven_stored_point'` |

Neither `f7c4b79` nor any other ref contains the materialization. It was ad-hoc SQL.

**This is Rule #0a in action, not misconduct.** PR #1016's safety receipts ("migration not
applied / no verdict populated / no sweep") were true **of this session** and remain true. They
read as statements about the database; they were statements about one writer. That is the
reporting defect this file closes.

---

## 3. SCHEMA HALF — EXACT RECOVERED SQL

Source of truth: **`git show f7c4b79:docs/n5-provenance-and-key-migration.sql`** (123 lines).
Read it there rather than trusting a copy. The load-bearing statements, verbatim:

```sql
-- 1. provenance  (add nullable -> backfill -> assert 0 NULL -> CHECK -> NOT NULL, no DEFAULT)
alter table geo.n5_geom add column if not exists provenance text;
update geo.n5_geom set provenance = 'recovered_authoritative' where provenance is null;
-- (DO block asserting 0 NULL, omitted here for brevity - see the commit)
alter table geo.n5_geom drop constraint if exists n5_geom_provenance_ck;
alter table geo.n5_geom add constraint n5_geom_provenance_ck
  check (provenance in ('recovered_authoritative','proven_stored_point'));
alter table geo.n5_geom alter column provenance set not null;

-- 2. point reject ledger
create table if not exists geo.n5_point_reject (
  source_key   text        not null,
  registry_id  text,
  reason       text        not null,
  detail       jsonb,
  rejected_at  timestamptz not null default now(),
  primary key (source_key, reason)
);
alter table geo.n5_point_reject enable row level security;
alter table geo.n5_point_reject add constraint n5_point_reject_reason_ck
  check (reason in ('NO_REGISTRY_VERDICT','NULL_COORD','NULL_ISLAND',
                    'OUTSIDE_JURISDICTION','INVALID_COORD','MULTI_COORD_UNRESOLVED'));

-- 3. association key correction, by TABLE SWAP (not by constraint replacement)
create table geo.n5_association_new (
  source_key text not null, zip char(5) not null, evidence smallint not null,
  primary key (source_key, zip));
insert into geo.n5_association_new select source_key, zip, evidence from geo.n5_association;
-- (DO block asserting rowcount equality)
drop table geo.n5_association;
alter table geo.n5_association_new rename to n5_association;
alter index geo.n5_association_new_pkey rename to n5_association_pkey;
```

Confirmed applied: production carries all of it, and **no leftover `n5_association_new`** (0),
so the swap completed cleanly.

---

## 4. MATERIALIZATION HALF — SEMANTICALLY RECONSTRUCTED SQL

⚠️ **NOT RECOVERED.** This is a re-derivation that provably reproduces the measured end state
(§5). Its shape — rejects first, then points, each one set-based statement — follows from the
timestamp evidence. Column-level details it cannot recover are named in §6.

```sql
-- ⛔ RECONSTRUCTION. ALREADY APPLIED. DO NOT RUN.
with src as (
  select i.source_key, coalesce(i.registry_id,'(null)') registry_id, i.lat, i.lng
    from preservation.app_project_identity i
   where i.snapshot_id = 'phase1-2026-09-01' and i.record_kind = 'development'),
verdict_reg as (select registry_id from geo.n5_accepted_source where treatment = 'PROVEN'),
proven as (select distinct s.source_key, s.registry_id from src s
            where exists (select 1 from verdict_reg v where v.registry_id = s.registry_id)),
-- DISTINCT OBSERVED PAIRS: both values non-null on the SAME row, so a latitude from one row
-- can never be paired with a longitude from another.
pairs as (select distinct source_key, lat, lng from src
           where lat is not null and lng is not null),
pc  as (select source_key, count(*) ncoord from pairs group by source_key),
cnt as (select p.source_key, p.registry_id, coalesce(pc.ncoord, 0) ncoord
          from proven p left join pc using (source_key)),
sel as (select pr.source_key, pr.lat, pr.lng
          from pairs pr join cnt c using (source_key) where c.ncoord = 1)

-- (a) 23:50:51Z — rejects, one statement
insert into geo.n5_point_reject (source_key, registry_id, reason, detail)
select c.source_key, c.registry_id,
       case when c.ncoord > 1 then 'MULTI_COORD_UNRESOLVED'
            when c.ncoord = 0 then 'NULL_COORD' end,
       jsonb_build_object('snapshot','phase1-2026-09-01','distinct_coords', c.ncoord)
  from cnt c where c.ncoord <> 1;

-- (b) 23:51:27–23:53:02Z — canonical points, one statement
insert into geo.n5_geom (source_key, registry_id, feature_id, outcome, geom, provenance)
select s.source_key, c.registry_id, 'pt:1', 1,
       ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4269), 'proven_stored_point'
  from sel s join cnt c using (source_key)
on conflict (source_key, feature_id) do nothing;
```

`first_z3` and `invalid_reason` are absent from the insert lists because production has them
**NULL on all 718,278 rows**; `outcome` is `1` on all of them; `registry_id` is a real value on
all of them (0 NULL, 0 `'(null)'` sentinel).

---

## 5. MEASURED PRODUCTION RECEIPT — why the reconstruction is trusted

All read 2026-09-03, read-only. **723,449 is measured here, never used as a rule.**

| measure | value |
|---|---:|
| snapshots with rows in `preservation.app_project_identity` | 1 (`phase1-2026-09-01`) |
| dev source_keys in that snapshot | 925,463 |
| **B** authoritative PROVEN source_keys | **723,449** |
| **A** canonical `proven_stored_point` source_keys | **718,278** |
| A ∩ B | 718,278 |
| **A − B** | **0** |
| **B − A** | **5,171** |
| reject rows / distinct source_keys / keys with >1 reason | 5,171 / 5,171 / **0** |
| `718,278 + 5,171` | **723,449 — exact** |

Applying the **current approved rules** read-only to the same snapshot:

| expected verdict | count | production |
|---|---:|---|
| ELIGIBLE | 718,278 | = canonical points |
| MULTI_COORD_UNRESOLVED | 4,877 | = reject reason count |
| NULL_COORD | 294 | = reject reason count |
| INVALID_COORD / NULL_ISLAND / NO_REGISTRY_VERDICT | 0 | none present |

Eight independent difference measures, **all zero**: canonical−eligible 0 · eligible−canonical 0
· ineligible−rejects 0 · rejects−ineligible 0 · reason mismatch 0 · eligible-carrying-a-reject 0
· coordinate mismatch beyond 1e-9 **0 of 718,278** · non-point-or-null geometry 0. SRID 4269.

Namespace: `feature_id='pt:1'` on **all 718,278**; other `pt:*` 0; non-`pt:` proven 0; source_keys
with >1 proven geometry 0; recovered rows squatting `pt:*` 0.

Snapshot attribution is **recorded in the rows, not inferred**: every one of the 5,171 rejects
carries `detail = {"snapshot":"phase1-2026-09-01","distinct_coords":N}`, with N=2 on
MULTI_COORD_UNRESOLVED and N=0 on NULL_COORD — i.e. `distinct_coords` *is* `ncoord`, which proves
the **global** multi-coordinate rule was applied rather than a shard-local one. Rejects span 61
of the 145 PROVEN registries.

---

## 6. WHAT THIS RECORD CANNOT RECOVER — stated, not glossed

1. **The literal statement text.** Formatting, CTE names and whether it ran as one statement or
   two are not recoverable. Only the semantics are.
2. **Whether the legacy run had `INVALID_COORD` / `NULL_ISLAND` / `NO_REGISTRY_VERDICT`
   branches.** The corpus contains **zero** rows in those classes under current rules, so those
   branches are unexercised and therefore unobservable either way.
3. **Whether `ON CONFLICT DO NOTHING` was present.** The `n5_geom` table comment (from
   `f7c4b79`) asserts the writer uses it, and no duplicate `pt:1` exists — consistent, not
   conclusive.
4. **The exact session/run.** No workflow run, no artifact and no log ties the ad-hoc SQL to a
   run id. Author identity beyond "the `f7c4b79` session" is not established, and is not needed.
5. The `n5_geom` table comment matches `f7c4b79` to within 2 characters (842 vs 844); the delta
   is attributable to unescaping in the comparison method and is treated as evidence of nothing.
   The `n5_association` comment matches **byte-for-byte**, which is what carries the attribution.

---

## 7. CONSEQUENCE FOR PR #1016

`#1016` must NOT create what already exists, and must NOT re-run §4. Object-by-object
responsibility is in **`docs/n5-object-ownership.md`**. In one line: production already holds the
**correct S1 verdict materialization**; what it lacks is the **attribution column**
(`verdict_snapshot_id`) and the newer reject-table shape. That is what #1016 owns.
