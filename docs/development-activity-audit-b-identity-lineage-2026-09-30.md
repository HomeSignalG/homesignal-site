# Development Activity — Order B audit: national identity and lineage (2026-09-30)

Plan reference: `docs/development-activity-plan-2026-09-30.md`, Immediate Product
Execution Order **B** ("audit national identity/lineage"), graded against Master
**Step 3A** ("Required record identity", "Project lineage and duplicate prevention",
"Change readiness and cold-start rule", "Required change-intelligence fields").

**This audit changes nothing.** It read production (Supabase project
`qwnnmljucajnexpxdgxr`, read-only `SELECT`s) and Git. Every number below was measured
against the live table on **2026-09-29 starting 16:20Z**, and every count carries its
control. Where something was inferred rather than measured it says so.

## 1. Headline

1. **A national project identity already exists and is close to complete** — every one of
   the 3,136,568 `app_projects` rows has a `source_key`, `source_seq` and basis.
2. **It is an identity per source record per ZIP page, not per project.** One project is
   stored about 2.9 times (sample), so any change layer must key on the project, not on
   the row or the ZIP.
3. **There is no national change history.** No first-detected date, no prior value, no
   change event exists anywhere nationally. The only history-shaped table holds 37 rows.
4. **The current "last written" signal is a retrieval event, not a change event.** Every
   re-collection of a ZIP's report rewrites every row of that ZIP, because the row
   comparison includes a retrieval timestamp. Step 3A says a retrieval timestamp change
   must not be a change.
5. **Two identity weaknesses need a contract before any diff:** a content-order tiebreaker
   (`source_seq`) on ~7–8% of rows, and 6,878 rows (0.22%) whose key basis is not durable.
6. **The lifecycle data already separates canonical status from publisher wording**
   (`status` vs `stage`), which is exactly what R2 requires — with one mismatch to resolve
   (`Decided`, §2.6).

## 2. Findings, with evidence

Controls first. `app_projects` **total = 3,136,568**; `record_kind` development
2,925,014 + facility 211,554 = 3,136,568, with **0** rows of any other kind. (`pg_class`
estimate 3,146,101 — the exact count is used everywhere.)

### 2.1 Identity coverage — F1

| check | result |
|---|---|
| `source_key` null | 0 |
| `source_seq` null | 0 |
| `source_key_basis` null | 0 |
| `last_seen_at` null | 0 |
| `provenance` null or `{}` | 0 |
| `registry_id` null | 5 (the 5 `tdlr:project_no` rows) |

Key basis (sums exactly to the 3,136,568 total):

| basis | rows | share |
|---|---:|---:|
| `source_id:case_number` | 2,696,288 | 85.96% |
| `source_id:other` | 221,843 | 7.07% |
| `epa_frs:registry_id` | 211,554 | 6.74% |
| `source_id:row_id` | 6,187 | 0.20% |
| `source_id:title(MUTABLE)` | 691 | 0.022% |
| `tdlr:project_no` | 5 | 0.0002% |

Uniqueness is enforced by `app_projects_zip_source_key_uidx` on `(zip, source_key,
source_seq)`; the primary key is a per-row `uuid` (`id`). The key derivation is one
function, `public.app_source_key(el)`, documented in
`docs/app-projects-stable-key-migration.sql` ("never an address/title hash").

### 2.2 One project, many rows — F2

`id` is per row and per ZIP page. In a **1/32 sample of source keys**
(`abs(hashtext(source_key)) % 32 = 0`; every copy of each sampled key is included):
96,267 rows · 33,643 identities · **2.861 ZIP-page copies per identity on average,
maximum 210** · 76,633 rows (79.6%) belong to an identity on more than one ZIP page.
*(Sample, not exact; the exact grouping over all 3.1M rows exceeds the 60 s tool limit.)*

Consequence: "projects", "source records" and "change events" are three different counts
(Step 3A), and the nearest existing thing to a project count is distinct
`(source_key, source_seq)`, not row count.

### 2.3 `source_seq` is a content-order tiebreaker — F3

The upsert assigns `source_seq` with
`row_number() over (partition by source_key order by md5(el::text))`
(`docs/app-projects-stable-key-migration.sql:279`, `:332`). It is `1` wherever a key is
unique in a ZIP. Measured:

- rows with `source_seq > 1`: **221,167** (7.05% of all rows; 7.56% of development rows;
  all of them development records);
- in the 1/32 key sample, **7,815 of 96,267 rows (8.12%)** share a key with a sibling on
  the same ZIP (316 keys).

**Inference (not measured):** because the order is by the md5 of the record's content,
editing one sibling can change the order and swap `source_seq` between siblings, so a
diff keyed on `(source_key, source_seq)` could report a change on the wrong sibling.
The size of this group is about the size of the `source_id:other` basis (221,843); the
link between the two is plausible and was not verified.

### 2.4 Non-durable key bases — F4

`source_id:title(MUTABLE)` (691 rows): the identity is the title, so a rename is a new
project. `source_id:row_id` (6,187 rows): publisher row numbers can be reassigned. The
ingest repo's Development SEO plane already refuses both as non-durable
(`bluesky/lib/development-seo-plane.mjs:386` `NON_DURABLE_BASIS = /(^|:)row_id$|MUTABLE/i`,
used by `projectKeyBasisDurable`, `:402`). **6,878 rows (0.22%)** fail that standard.

### 2.5 There is no national history, and the write signal is not a change signal — F5

**No history layer.**
- `public.resolved_project_status` (the only table with `first_seen_at`,
  `last_change_at`, `withdrawn_at`) has **37 rows for 2 projects**, all written
  2026-07-06 (`water_rights|pod` 34, `legal|manual` 2, `approval|pmn:1077` 1).
- `public.app_changes` has no first-seen or last-change column (`id, community_id, zip,
  category, title, plain_language, impacts, lat, lng, occurred_at, source_ref,
  confidence, window_closes_at, related_project_id, lens, quiet, created_at`).
- `app_projects.created_at` starts at **2026-08-09 03:40Z**; nothing older can be dated,
  and a delete-and-insert re-ingest resets it (documented in the ingest `CLAUDE.md`,
  6,691 projects re-created after the 2026-09-25 cutoff — cited, not re-measured here).
- The `dc_*` observation tables (`dc_source_observation`, `dc_current_observation`,
  `dc_entity_observation`, `dc_observation_record_key`, `dc_resident_lineage_ledger`) exist
  but are data-centre specific; their contents were **not profiled** here.

**The write signal is a retrieval event.**
- The row upsert writes only when `(24 columns) is distinct from (excluded…)`, and
  `provenance` is one of those columns (read from the live `app_refresh_zip` body).
- `provenance.refreshed_at` equals `development_reports.refreshed_at` **exactly** and is
  a single value across every row of a ZIP. Measured on three ZIPs:

  | ZIP | development rows | distinct `provenance.refreshed_at` | equals report `refreshed_at` | rows' `last_seen_at` |
  |---|---:|---:|---|---|
  | 19475 | 123 | 1 | yes (`2026-09-25 13:40:00.038619`) | one value, `2026-09-25 15:45:17` |
  | 84302 | 41 | 1 | yes (`2026-09-25 10:44:00.061312`) | one value, `2026-09-25 15:45:18` |
  | 97702 | 2,432 | 1 | yes (`2026-09-28 12:46:00.132918`) | one value, `2026-09-28 14:31:06` |

- So every re-collection of a ZIP's report changes `provenance` on **every** row of that
  ZIP, and the "write only changed rows" logic (marker `app_coord_outlier` confirmed
  present in the live function) rewrites all of them. Consistent with the table:
  **1,078,808 rows (34.39%) written in the last 24 h, all 3,136,568 (100%) within 7 days.**
- Table counters since an unknown start (`db_stats_reset` is null): inserts 8,613,
  updates 766,795 (735,029 HOT), deletes 9,787. Updates outnumber inserts ~89 : 1, so
  ids are mostly stable in place; the window is unknown, so the ratio is directional only.

**Conclusion (mechanism established for the 3 ZIPs; extrapolation to all ZIPs is
inferred):** `last_seen_at` and row updates measure "the ZIP's report was re-collected",
not "the project changed". Step 3A: *a new fetch is not a change; a retrieval timestamp
change must not be a change.*

### 2.6 Lifecycle, publisher status and date semantics — F6

Development rows (2,925,014). Stored `status` (sums exactly): `Operating` 1,349,184 ·
`Approved` 1,203,505 · `Proposed` 353,011 · **`Decided` 19,309** · `Active` 5.

- The publisher's own wording is stored separately in `stage`: **579 distinct values,
  0 nulls** ("Submitted for county review", "Permit Issued", "UNDER CONSTRUCTION",
  "Withdrawn", …). This is the R2 split (canonical lifecycle vs publisher status) already
  present in the data; no schema change is needed to honour R2.
- **Mismatch to resolve (Step 5, not changed here):** `HS.canonicalLifecycle` /
  `lifecycleKey` (`lib/project-type.js:535-541`) maps `proposed`→proposed,
  `approved`→approved, `operating|active|built`→operating and **everything else →
  `unknown`, including `Decided`** — so the 19,309 decided (denied/withdrawn) records
  resolve to "Lifecycle unknown". The decision contract says the opposite:
  `browsingBucketFor()` always returns `proposed` (`supabase/functions/get-address-report/
  sources/decision.ts:134`). Three readings of one record (connector bucket = proposed,
  stored status = `Decided`, shared lifecycle function = unknown). R2 forbids `denied` /
  `withdrawn` as lifecycle keys, so the consistent answer is lifecycle **proposed** plus a
  separate decision notation from `decision.ts`. Changing this alters what residents see
  on existing surfaces, so it is flagged, not fixed.
- `date_kind` (development rows; sums exactly to 2,925,014): `issued` 1,887,566 ·
  `filed` 663,025 · **(none) 163,528 (5.59%)** · `scheduled` 136,683 · `decided` 39,232 ·
  `awarded` 18,083 · `estimated` 11,113 · `hearing` 3,119 · `completed` 2,665. Each
  record carries **one** date and its kind, not an event history. `estimated` and
  `scheduled` are not events and must not be presented as ones.
  (All 211,554 facility rows have no date: 163,528 + 211,554 = 375,082 = total null
  `submitted_at`.)

### 2.7 Lineage — F7

No table links the filing, approval, permit and construction records of one project
(only `dc_resident_lineage_ledger`, data-centre specific). Whether individual sources emit
one record per project or one per permit was **not measured**. Until lineage is proven,
Step 3A requires records to stay separate and the uncertainty to be disclosed.

### 2.8 Existing precedents to reuse, not fork — F8

- **Development SEO plane** (ingest repo, `bluesky/lib/development-seo-plane.mjs`,
  `buildProjects` `:485`): a per-project `changed_on` computed by fingerprinting a fixed
  fact list (`PAGE_FACTS` `:452`, `factsOf` `:455`, compared at `:611-615`), with the
  bookkeeping and retrieval fields deliberately excluded (`:450-451`), and a durable-key
  guard. It is the right *shape* — but it covers only **featured** projects (a
  representative on a Rule D ZIP page or a city page), stores **no prior values** (so it
  cannot say what changed from what), is day-granular, and is bounded by an 18 MiB object.
  It cannot be the national baseline.
- **`decision.ts`** stays authoritative for decision classes (plan Step 3A, "Existing
  decision-history authority"). A change layer records decision outcomes *from* it.
- **`docs/multi-source-evidence-architecture.md`** is a proposal, not an implemented
  dependency (plan says so); it was not read for this audit.

## 3. Gap table — Step 3A "Required change-intelligence fields"

| 3A field | today | verdict |
|---|---|---|
| `stable_project_id` / `source_record_id` | `source_key` + `source_seq` (per ZIP copy) | PARTIAL — F2, F3, F4 |
| `source_id` | `registry_id` (5 null) | PRESENT |
| `source_record_key` | `source_key` | PRESENT |
| `publisher_status_raw` | `stage` (579 values, 0 null) | PRESENT |
| `normalized_type` | `type`, `type_raw`; authority `lib/project-type.js` | PRESENT |
| `normalized_lifecycle` | `status` → `HS.canonicalLifecycle` | PARTIAL — `Decided` mismatch (§2.6) |
| `publisher_event_type` / `_date` | `date_kind` + `submitted_at` | PARTIAL — one date; 5.59% none |
| `observed_at` | `provenance.refreshed_at` (retrieval time, per ZIP) | PRESENT, but a retrieval clock |
| `first_detected_at` | none (`created_at` ≥ 2026-08-09, resets on re-create) | **MISSING** |
| `last_observed_at` | `last_seen_at` (ZIP rewrite time) | MISLEADING (§2.5) |
| `previous_status`, `current_status`, `change_event`, `change_detected_at` | none | **MISSING** |
| `official_source_url` | `source_ref`; `provenance.url_precision` says record vs dataset (Chester County sample is dataset-level) | PARTIAL |
| `source_version` / record hash | `provenance.source_vintage` is a text label ("get-address-report ZIP mode"), not a version | **MISSING** |
| `coverage_state` | `app_coverage_states` (per ZIP, not per record) | PARTIAL |
| `source_health_state` | not per record in this table | **MISSING** here (not searched elsewhere) |
| baseline / cold-start fields (`baseline_observation_at`, `comparable_observation_count`, `change_ready`, …) | none | **MISSING** |

`provenance` keys in one ~0.05% page sample (per-key counts of rows carrying the key):
`refreshed_at` 1,659 · `source_vintage` 1,659 · `url_precision` 1,538 · `source_class` 1,538 ·
`geo_precision` 1,538 · `jurisdiction` 1,538 · `case_number` 1,532 · `src` 121.
(Sample-based; shown as counts, not shares.)

## 4. What was not measured

- The cause of the ZIP-wide rewrite was established on **3 ZIPs**; the national share of
  rewrites that are retrieval-only is inferred from the 34.39% / 100% figures.
- Whether real edits reorder `source_seq` siblings (§2.3) — inferred from the code.
- Cross-record lineage inside a source (§2.7).
- Contents of the `dc_*` observation tables; `docs/multi-source-evidence-architecture.md`.
- The Maps workbook (not read); rights classifications (owned by
  `docs/corporate-output-source-rights-audit-2026-09-27.md`, unchanged).
- The exact window of the table counters.

## 5. What this means for C, D and E

1. **Diff over a declared fact list, never over the whole row.** Exclude `provenance`
   retrieval fields (`refreshed_at`, `source_vintage`), `last_seen_at` and `created_at`,
   the way `PAGE_FACTS` does — otherwise every re-collection is a "change" (measured, §2.5).
2. **Key on the project identity, store one observation per identity**, not one per ZIP
   copy (2.86× inflation), and keep the ZIP list as an attribute.
3. **Multi-record keys (~7–8% of rows) are non-comparable until a discriminator that does
   not depend on content is defined** — or the group is diffed as a set. Do not diff by
   `(source_key, source_seq)` for them.
4. **Exclude non-durable bases (6,878 rows, 0.22%) from change claims**, as the SEO plane
   already does.
5. **Cold start is real.** The first observation defines the baseline; `created_at`
   (2026-08-09) is not a first-detected date. Until two comparable observations exist the
   report says **Recent Official Activity**, per Step 3A.
6. **Append-only, before/after values, method version** — none of which the SEO plane
   keeps.
7. **Rights is separate (R4).** Building an internal ledger is not a sale of source
   content; showing "change detected" in a paid report stays HOLD in the rights audit.
8. **Lifecycle comes from `lib/project-type.js` and decisions from `decision.ts`** — the
   ledger stores their outputs and adds no second classifier.

## 6. Proposed truth path for Order C (to confirm before any implementation)

- **Canonical truth path:** publisher connectors → `dev_sites_deduped` → `app_refresh_zip`
  → `app_projects` → *(new)* observation ledger written by the same materializer pass →
  the report reader.
- **Decision owners:** identity `public.app_source_key`; type/lifecycle
  `lib/project-type.js`; decisions `decision.ts`; the change decision — a new single
  function owned by the ledger.
- **Shortcut check:** rejected alternatives are diffing the SEO-plane JSON (featured-only,
  no prior values, ingest-owned) and diffing `app_projects` snapshots on `last_seen_at`
  (a retrieval clock). No second classifier, no per-city path.
- **Gate:** Order C adds a new table, a schema addition — the site `CLAUDE.md` §3 stop
  list requires the founder's approval before it is built.

## 7. Reproducing the measurements

All read-only. Project `qwnnmljucajnexpxdgxr`. (Heavy grouped queries exceed the
60 s tool limit; use a `hashtext` bucket or one scan per query.)

```sql
-- F1 controls and coverage (one scan)
select count(*) total,
       count(*) filter (where source_key is null) source_key_null,
       count(*) filter (where source_seq is null) source_seq_null,
       count(*) filter (where source_key_basis is null) basis_null,
       count(*) filter (where registry_id is null) registry_id_null,
       count(*) filter (where record_kind = 'development') kind_development,
       count(*) filter (where record_kind = 'facility') kind_facility,
       count(*) filter (where last_seen_at >= now() - interval '1 day') seen_1d,
       count(*) filter (where last_seen_at >= now() - interval '7 days') seen_7d
from public.app_projects;

-- F1 basis
select source_key_basis, count(*) from public.app_projects group by 1 order by 2 desc;

-- F2 copies per identity (1/32 sample of keys)
select count(*) rows_, count(distinct (source_key, source_seq)) identities,
       round(count(*)::numeric / count(distinct (source_key, source_seq)), 3) avg_copies
from public.app_projects where abs(hashtext(source_key)) % 32 = 0;

-- F3
select count(*) filter (where source_seq > 1) from public.app_projects;

-- F5 retrieval timestamp equals the report's, per ZIP
select p.zip, count(distinct p.provenance->>'refreshed_at') d,
       max(p.provenance->>'refreshed_at') prov, d.refreshed_at report
from public.app_projects p join public.development_reports d on d.zip = p.zip
where p.zip in ('19475','84302','97702') and p.record_kind = 'development'
group by p.zip, d.refreshed_at;

-- F6
select status, count(*) from public.app_projects where record_kind='development' group by 1;
select date_kind, count(*) from public.app_projects where record_kind='development' group by 1;
select count(distinct stage) from public.app_projects where record_kind='development';
```
