# `app_projects` stable source key — repair record

**Applied 2026-08-10.** SQL of record: `docs/app-projects-stable-key-migration.sql`.
Rollback: `docs/app-projects-stable-key-rollback.sql`. Regression guards:
`test/app-projects-stable-key.test.mjs`.

---

## 0. CORRECTION to the brief's premise — the defect is worse than orphaning

The task was scoped from an earlier finding of *"48 of 66 `property_company_roles` rows are
already orphaned."* **That figure was wrong, and so was the mechanism.**

**Why it was wrong.** The orphan test was `where not exists (select 1 from app_projects p
where p.id = r.project_id)`. `project_id` is **NULL** on those 48 rows, and `NOT EXISTS (… =
NULL)` is always true — so the query counted NULLs as orphans. Measured correctly:

```sql
select count(*) total, count(*) filter (where project_id is null) null_project,
  count(*) filter (where project_id is not null
    and not exists (select 1 from app_projects p where p.id=project_id)) true_orphans
from property_company_roles;
-- total 66 | null_project 48 | true_orphans 0
```

**True orphans: 0.** They are structurally impossible — all three FKs are validated:

```sql
select conname, convalidated, confdeltype from pg_constraint … contype='f';
-- property_company_roles_project_id_fkey  t  c
-- project_facility_refs_project_id_fkey   t  c
-- identity_conflicts_project_id_fkey      t  c        (c = ON DELETE CASCADE)
```

**The real defect.** Because the FK is `ON DELETE CASCADE`, `app_refresh_zip()`'s opening
`delete from public.app_projects where zip=_zip` did not orphan evidence — it **destroyed**
it. Proven on the live database inside a transaction that was force-rolled-back:

```
delete from app_projects where zip='78617';
  app_projects 78617      537 -> 0
  property_company_roles   66 -> 53   (13 rows destroyed)
  project_facility_refs    33 -> 0    (33 rows destroyed)
  identity_conflicts        4 -> 0    ( 4 rows destroyed)
```

**50 of the 103 downstream evidence rows would have been deleted by one refresh of one ZIP.**
The 48 NULL-`project_id` rows are a *separate, real* issue — TCEQ operator rows written
ZIP-scoped by `tceq_operators_collect` at `2026-08-10 01:46:41` with no project anchor. They
are unchanged by this repair and are **not** in scope here.

---

## 1. Exact cause of project-ID instability

Two independent causes, both now removed:

1. `app_projects.id` defaults to `gen_random_uuid()`.
2. `app_refresh_zip()` **deleted every row for the ZIP and re-inserted**, so every logical
   record received a brand-new identity on every run — and CASCADE took the evidence with it.

---

## 2–3. Source families and their stable key

Everything in `app_projects` is materialised from one place: `development_reports.sites[]`,
read through `dev_sites_deduped(zip)`. The identity fields available per element:

| Source family | Stable external ID | Field in the site element | Unique? | Nullable? | Key emitted |
|---|---|---|---|---|---|
| **arcgis** (155 registry entries) | platform:entry:record | `source_id` = `arcgis:<registry_id>:<caseNo ?? OBJECTID ?? title>` | mostly | no | verbatim `source_id` |
| **socrata** (22) | `socrata:<domain>:<dataset>:<caseNo ?? :id ?? title>` | `source_id` | mostly | no | verbatim |
| **ckan** (3) | `ckan:<host>:<resource>:<…>` | `source_id` | mostly | no | verbatim |
| **csv** (1) | `csv:<host>:<registry_id>:<…>` | `source_id` | mostly | no | verbatim |
| **carto** (1) | `carto:<host>:<table>:<…>` | `source_id` | mostly | no | verbatim |
| **TDLR TABS** (hand adapter) | agency project number | `project_no` (`TABS##########`) | **yes** | no | `tdlr_tabs:<project_no>` |
| **EPA FRS** (national floor) | FRS Registry ID | `registry_id` | **yes** | no | `epa_frs:<registry_id>` |

The three input fields are **mutually exclusive** — verified 0 overlap across 172,522
elements — so the coalesce ladder is unambiguous.

**The decisive finding: `source_id` already existed and was being discarded.** Every registry
connector emits a fully-namespaced record identity (`sources/arcgis.ts:447`,
`socrata.ts:488`, `ckan.ts:275`, `csv.ts:310`, `carto.ts:277`); the engine's own dedup key
already includes it; the materializer simply never copied it into `app_projects`. Adopting it
verbatim — rather than inventing a key — is what makes this repair small.

**Coverage, measured over the full corpus** (11,817 ZIPs / 3,022,921 qualifying sites, through
the same `dev_sites_deduped` path the materializer reads; control: `app_projects` held
3,027,784 rows, 0.16% apart):

| basis | sites | % |
|---|---:|---:|
| `source_id:case_number` | 2,819,607 | 93.274 |
| `epa_frs:registry_id` | 197,571 | 6.536 |
| `source_id:row_id` | 5,113 | 0.169 |
| `source_id:title` ⚠️ **mutable** | 625 | 0.021 |
| `tdlr:project_no` | 5 | 0.000 |
| **no key** | **0** | **0.000** |

**Fallback hierarchy and what was refused.** The ladder is `source_id` → `tdlr_tabs:project_no`
→ `epa_frs:registry_id` → **NULL**. There is no address, title, company-name or
arbitrary-field-hash fallback; a source with no defensible record id yields NULL and is
excluded from insert (and reported), never disguised. The 625 `source_id:title` rows are the
one **mutation risk**: those connectors fell through `caseNo ?? rowId ?? title`, so a
re-titled upstream record will present as a new one. That is a connector-side fix
(`sources/*.ts`), deliberately **not** made here.

---

## 4. Internal vs external identity

`app_projects.id` (uuid) stays the internal key and **is never rewritten**. `source_key` is
the external source-record identity, stored alongside. This is deliberately the same shape the
multi-source architecture proposal needs (`docs/multi-source-evidence-architecture.md` §5):
`source_key` becomes `entity_identifier.id_value` with the namespace prefix as `id_type`, and
`source_key_basis` becomes the evidence class. **No second project-ID rewrite is required to
get there.**

`app_projects` remains a **per-ZIP read model**, so the key is `(zip, source_key, source_seq)`,
not a global project key — the same upstream permit legitimately appears on several
neighbouring ZIP pages (documented behaviour for overlapping 3-mile circles).

---

## 5. Schema changes

```
app_projects + source_key       text        -- namespaced source-record identity
             + source_key_basis text        -- audit: how it was derived
             + source_seq       smallint    -- ordinal within (zip, source_key), default 1
             + last_seen_at     timestamptz -- refresh watermark
unique index app_projects_zip_source_key_uidx (zip, source_key, source_seq)  -- 95 MB, CONCURRENTLY
function     app_source_key(jsonb), app_source_key_basis(jsonb)  -- IMMUTABLE
```

---

## 6. Materializer changes

`delete-all + insert-all` → **upsert on `(zip, source_key, source_seq)`** with an explicit
lifecycle:

| case | behaviour |
|---|---|
| NEW | INSERT, fresh id |
| UPDATED | `ON CONFLICT DO UPDATE`, **id preserved** |
| UNCHANGED | `ON CONFLICT DO UPDATE`, **id preserved** |
| REMOVED upstream | deleted by the `last_seen_at < _run` watermark sweep |
| **REFERENCED by evidence** | **never deleted**, even when stale or keyless |

The reference guard is the important part: **both** remaining deletes are guarded by
`not exists` against all three evidence tables, so evidence destruction is now structurally
impossible even if a future key derivation is wrong. `app_changes` keeps delete+insert — it
has no downstream references (`related_project_id`: 0 populated rows, measured).

The refresh now **reports** what it did: `stale_removed=N stale_kept_referenced=M`.

---

## 7–9. Downstream references, orphans before/after, TDLR role label

**Every reference to `app_projects.id`** (real FKs + logical + UI):

| Referrer | Kind | Rows | Orphans before | Orphans after |
|---|---|---:|---:|---:|
| `property_company_roles.project_id` | FK CASCADE | 66 (48 NULL) | 0 | **0** |
| `project_facility_refs.project_id` | FK CASCADE, NOT NULL | 33 | 0 | **0** |
| `identity_conflicts.project_id` | FK CASCADE | 4 | 0 | **0** |
| `app_changes.related_project_id` | logical, no FK | **0 populated** | — | — |
| `development.html?id=<uuid>` | UI URL | — | — | — |

**Adoption backfill: 202,299 rows keyed** without a single name/address match — 202,294
facility rows via `epa_frs:<registry_id>`, 5 development rows via `tdlr_tabs:<TABS…>`. All
**39** rows that carry evidence were keyed (verified `NOT_keyed = 0` before the function was
switched), which is what let their ids survive the first upsert run.

**Rows that could not be safely repaired: 0** — there were no true orphans to repair.
The 48 NULL-`project_id` TCEQ rows are untouched and remain an open, separately-scoped item.

**TDLR role label: NOT changed.** The 5 rows still read `role='Property Owner'` sourced from
the TDLR TABS OWNER block. The brief permitted a change only *if reattachment would otherwise
re-assert land ownership* — reattachment here was by `TABS` project number and touched no role
value, so §8's condition never triggered. The semantic fix (`project_owner_as_filed`) stays
with the evidence-architecture phase.

---

## 10. Duplicate-key findings — why NO uniqueness assumption was made blindly

`(zip, source_key)` is **not** unique today: 37,965 duplicate groups covering 354,829 sites
(worst group 3,664 rows). Two genuinely different root causes, both confirmed against real
rows rather than assumed:

**A. Registry `column_map` defect — `brunswick-county-permits`, `desoto-county-permits`.**
`case_number` is mapped to a column that is not a permit number. Four rows sharing key
`arcgis:brunswick-county-permits:1000`:

| case_number | address | file_date |
|---|---|---|
| 1000 | 2820 STOUT RD NW 28420 | 2026-08-06 |
| 1000 | 1544 COLONIST SQUARE SW 28469 | 2026-08-06 |
| 1000 | 6783 E LINDLEY LN SW 28469 | 2026-08-06 |
| 1000 | 998 MINGO DR SW 28469 | 2026-08-06 |

Distinct real permits at distinct addresses. **The source key is insufficient** — a registry
config fix (remap `case_number`, or drop it so `rowId` is used).

**B. Genuinely distinct filings sharing a case number — `nyc-dobnow-approved-permits`**
(10,507 groups, worst 20). Key `socrata:…:rbx6-tga4:M00932693-I1` at 481 8 AVENUE resolves to
4 rows: two work types (Structural / General Construction) × two file dates (2026-04-16 /
2026-03-10). These are real separate filings — the repo's own dedup rule already says so
("same case re-issued on a new date = a distinct real filing, e.g. NYC DOB renewals").
**A composite key is needed** (case + work type + file date), which is a connector change.

**Neither was worked around by deduplicating.** `source_seq` (ordinal within the group, ordered
by the same stable `md5(el::text)` the FD-1 contract already uses) makes the upsert target
unique **without discarding a single row**. Where the key is genuinely unique — 88.3% of sites,
and **100% of evidence-bearing ZIPs bar one** (14 of 15 have zero duplicate groups; 78617 has
9 groups / 21 sites of 537, and all 29 of its facility rows are unique) — `source_seq` is
always 1 and identity is unconditionally stable.

⚠️ **Honest limit:** inside a duplicate group, identity is stable only while group membership
is stable. If a member disappears upstream, later members shift slot. That is bounded to the
already-defective groups above and is strictly better than the previous behaviour, where
*every* row in *every* ZIP got a new identity on *every* run.

---

## 11–13. Validation

**Del Valle (78617), before → after two real refreshes:**

| | before | after run 1 | after run 2 |
|---|---:|---:|---:|
| `app_projects` (78617) | 537 | 537 | 537 |
| ids preserved | — | 39/39 referenced | **537/537** |
| `property_company_roles` (all) | 66 | 66 | 66 |
| `project_facility_refs` | 33 | 33 | 33 |
| `identity_conflicts` | 4 | 4 | 4 |
| true orphans | 0 | 0 | **0** |
| unkeyed rows in ZIP | 503 | 0 | 0 |

Run output: `78617: development=508/508 facilities=29/29 notices=8 news=6 stale_removed=0
stale_kept_referenced=0 quality=pass` — identical on both runs.

**All five mandated TABS records kept the same `project_id`, still attached to the same role:**

| TABS | id unchanged | source_key |
|---|---|---|
| TABS2023006449 | ✅ | `tdlr_tabs:TABS2023006449` |
| TABS2023006483 | ✅ | `tdlr_tabs:TABS2023006483` |
| TABS2024016698 | ✅ | `tdlr_tabs:TABS2024016698` |
| TABS2024022676 | ✅ | `tdlr_tabs:TABS2024022676` |
| TABS2026011928 | ✅ | `tdlr_tabs:TABS2026011928` |

**Non-TDLR families, two refreshes each — 100% id preservation, 0 lost, 0 new:**

| ZIP | family | rows | preserved |
|---|---|---:|---:|
| 60601 | socrata (`chicago-building-permits`) | 1,730 | **1,730** |
| 85003 | arcgis (`phoenix-building-permits`) | 3,635 | **3,635** |
| 28470 | arcgis (`brunswick-county-permits`, incl. the 3,664-row duplicate group) | 19,155 | **19,155** |

**Stale-record policy + guard, proven live (rolled back), with a positive control asserting
both subjects exist** (the first attempt was vacuous — every 78617 facility row is referenced,
so the "unreferenced row removed" check passed trivially on a NULL id; it was re-run against a
real development row):

```
run=[78617: … stale_removed=1 stale_kept_referenced=1 …]
referenced-stale SURVIVED: t (want t)
unreferenced-stale REMOVED: t (want t)
roles=66
```

---

## 14–15. Orphan counts and FK/constraint posture

Before: 66 references, **0 true orphans**, 48 NULL-`project_id` (never attached).
After: 66 references, **0 true orphans**, 48 NULL-`project_id` (unchanged, out of scope).
**Unrepairable rows: 0.**

**Why the database "allowed" the situation:** it didn't. The FKs exist, are validated, and are
`ON DELETE CASCADE` — they worked exactly as declared. The problem was that CASCADE was the
wrong `ON DELETE` behaviour for a table that is destructively rebuilt. **No FK was added or
changed in this repair** (per the brief: constraints only after the lifecycle is proven).

Recommended follow-up, **not done here**: now that refresh no longer bulk-deletes, consider
`ON DELETE SET NULL` for `property_company_roles` (its `project_id` is already nullable) and
`RESTRICT` for `project_facility_refs`. Until that is decided, the in-function reference guard
is what protects the data, and it protects it regardless of FK action.

---

## 16. Performance

| item | measurement |
|---|---|
| new unique index size | **95 MB** (vs pkey 178 MB, existing zip/kind index 516 MB) |
| index build | `CREATE UNIQUE INDEX CONCURRENTLY`, valid, no write lock |
| key derivation cost | zero network; `IMMUTABLE` SQL over jsonb already in memory |
| worst-case refresh | **12.5 s** for 28470 (19,155 rows, incl. a 3,664-row upsert group) |
| typical refresh | 537 rows (78617) and 3,635 rows (85003) both sub-second-to-seconds |
| write pattern | bulk `INSERT … ON CONFLICT` — one statement per record kind, no per-row round trip |
| deletes | now bounded to genuinely-stale rows instead of the whole ZIP every run — **less** write amplification than before |

**Backfill posture:** 227,272 rows are keyed; the remaining 2,800,501 are keyed lazily as
their ZIP refreshes. No 3M-row rewrite was performed, and none is needed — attempting to
backfill registry-connector rows would have required reconstructing the platform prefix
`app_projects` does not store, i.e. guessing.

---

## 17. UI compatibility

`development.html` links to `development.html?id=<app_projects.id>` (lines 110, 122). Ids are
**preserved** by the upsert, so those links are now durable. No redirect/alias map is needed:
under the previous code **every** id changed on **every** refresh, so no such link could ever
have survived — this change strictly improves link stability rather than breaking it. The
one-time transition does mint new ids for previously-unkeyed rows, which is exactly what the
old code did on every run.

---

## 18. Tests

`test/app-projects-stable-key.test.mjs` — 33 assertions, offline (CI has no DB), following the
`app-refresh-zip-determinism` precedent of asserting against the SQL of record. Covers: same
source record → same key; namespace prevents cross-agency collision; **no address/title/company
field is readable by the derivation** (asserted per-field); keyless → NULL not a hash; the
blanket delete is gone; both inserts upsert on the stable key; a keyless site is never
inserted; **every `app_projects` delete is guarded against all three evidence tables**;
watermark-driven stale removal; the refresh reports removals; adoption matches only on
identifiers; the FD-1 ordering contract still holds; `app_changes` stays a projection.

**Full offline suite: 86/86 files pass.**

One test defect was found and fixed during authoring: the structural checks originally counted
a **header comment** (which quotes the old buggy statement) as code and reported a false
failure. The checks now run over comment-stripped SQL.

---

## 19. Rollback

`docs/app-projects-stable-key-rollback.sql`, staged: (A) do nothing — outputs verified
identical; (B) restore the exact pre-change function body, captured from the live database
before the change; (C) drop the columns/index. **Note:** the live function was not
byte-identical to any existing `docs/*.sql` file (they had drifted), which is why the prior
body is reproduced in the rollback file rather than referenced.

---

## 20. Compatibility with the multi-source architecture

`source_key` is the `source_record_key` that proposal calls for; the namespace prefix is the
`id_type`; `source_key_basis` maps onto `evidence_class`. Transition is additive: a future
`source_record` row keys off `(source_id, source_key)`, and `entity_identifier` reads the same
value. **No further project-ID rewrite.**

## 21. Recommended next step

Not the evidence architecture yet. In order:

1. **Fix the two duplicate-key root causes at source** (connector/registry, small and
   contained): remap `brunswick-county-permits` / `desoto-county-permits` `case_number`, and
   composite the NYC DOB NOW `source_id`. That retires `source_seq > 1` for ~354k sites.
2. **Decide the FK `ON DELETE` posture** now that the lifecycle is proven.
3. Then the evidence architecture Phase 1 (source registry as data).

Open, unresolved, and deliberately untouched: the 48 NULL-`project_id` TCEQ operator rows;
the 625 title-derived `source_id` values; and `opendatasoft`, which has a registry array in
`jurisdiction-registry.json` but **no connector in `index.ts`** — a declared source that never
runs.
