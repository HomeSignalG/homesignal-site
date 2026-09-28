# Project identity audit — SEO plan step 11 (2026-09-28)

**Question:** is HomeSignal's project identity stable enough to publish one indexable page per
Development project (step 12)? Measured read-only against production on 2026-09-28. Nothing was
changed. Every figure below names its query shape; sampled figures are estimates and say so.

## Answer

**Yes, on the source key — and no, on anything the site links to today.**

| Identity | Stable? | Why |
|---|---|---|
| `app_projects.id` (what `development.html?id=` and saved projects use) | **No** | A random UUID per **ZIP copy** of a project, minted when that copy is written. One project carries many ids, and an id can vanish while the project survives. |
| `source_key \| source_seq` (Rule D's `base_project_key`, the map's membership key) | **Yes**, with two named exceptions | 98.9% of keys survive 2.7 days; 93.6% survive 27 days, and the losses are records leaving their sources, except one source that was re-keyed by a configuration change. |

So step 12 builds on `base_project_key`, the identity Rule D and the map already use. It must not
build on `app_projects.id`.

## What was measured

### 1. How a project is stored

`public.app_projects` (read from `information_schema` / `pg_indexes`):

- `id uuid default gen_random_uuid()`: a new random id whenever a row is inserted.
- Unique index `app_projects_zip_source_key_uidx (zip, source_key, source_seq)`: **one row per
  ZIP per source record**. There is no uniqueness on `(source_key, source_seq)` alone.

**Copies per project.** Sampled keys (`tablesample system (0.2)`, then every row carrying those keys):
6,069 projects, 60,788 rows; 1,177 have one row, 1,793 have 2–5, 3,099 have 6 or more; max 288.
(The 10.0 average overstates the typical project, because sampling rows favours keys with many
rows. The direction is not in doubt.)

Copies already disagree: **55 of 6,069 (0.9%)** have more than one `name` across their copies and
17 have more than one `status`. **A project's name is not an identity**, and it must not appear
in a URL.

### 2. What source keys are built from

1% row sample of development rows (28,678 rows), `source_key_basis`:

| Basis | Rows | Share | Durable? |
|---|---:|---:|---|
| `source_id:case_number` | 26,451 | 92.2% | Yes: the publisher's own case or permit number |
| `source_id:other` | 2,168 | 7.6% | Yes, as seen: composites of the publisher's ids (Brunswick `permit\|code`, NYC `job\|seq\|work type`) |
| `source_id:row_id` | 52 | 0.18% | **No**: an ArcGIS row number, which can be renumbered when a layer is republished (DeSoto, City of Orange, MDOT SHA, Weld, TxDOT, Cook County IL, …) |
| `source_id:title(MUTABLE)` | 7 | 0.02% | **No**: Austin zoning cases keyed by street address |

0 rows had a null `source_key`.

### 3. Churn over time

Method: take every development key in a map generation, keep the 1/256 whose `md5` starts `00`,
and ask whether today's `app_projects` still has a development row with that exact key.

| Window | Keys sampled | Still present | Gone |
|---|---:|---:|---:|
| 2.7 days (generation `n5-national-2026-09-25`, cutoff 2026-09-25 22:01Z) | 3,421 | 3,398 (99.3%) | 23 (0.7%) |
| 27 days (generation `legacy-phase1-2026-09-01`, cutoff 2026-09-01 13:39Z) | 3,381 | 3,165 (93.6%) | 216 (6.4%) |

Of the 3,398 still present over 2.7 days: 3,382 had **no row re-created** since the cutoff, and 16
had gained new ZIP copies. 0 were wholly re-created.

**Why keys disappear.** Grouped by source, then each source checked for current rows:

- **Records leaving their source** (the usual case): recency windows and dropped statuses. The
  source still has rows, and in the same key shape.
- **A source removed**: `anne-arundel-subdivision-activity`, 0 of 5 keys kept, and no current rows.
- **A source RE-KEYED by a configuration change**: `nashville-building-permits-issued`, **1 of 32
  keys kept (3%)**. On 2026-09-01 its keys were street addresses
  (`…:1010 RIVER OATS DR, NASHVILLE, TN, 37221`); today all 428 sampled rows key on the permit
  number (`…:2024061734`, basis `case_number`). The permits did not change, but every project's
  identity did. **This is the failure mode project pages must be guarded against.**

### 4. Saved projects already show the defect

`app_follows` with `target_type='project'` stores `app_projects.id`: 3 saved projects, created
2026-09-11/12, **1 of 3 no longer resolves** to any row. The count is small, but it is the real
consequence of keying on a copy's random id.

### 5. The dossier page today

`development.html?id=<uuid>` looks the id up among the viewed ZIP's projects, then falls back to
`projectsByIds`. It is `noindex, nofollow`, and links to it are generated from the copy's id
(`lib/templates.js`, `properties.html`, `shell.js`).

## Rules for step 12 (project pages)

1. **Identity = `base_project_key` = `source_key|source_seq`**, the same key Rule D counts and the
   map's membership uses. Never `app_projects.id`.
2. **Only durable keys get a page.** Exclude `source_key_basis` `row_id` and `title(MUTABLE)`
   (about 0.2% of rows). They stay on the map and the ZIP pages; they just don't get a URL.
3. **Only Rule D–publishable projects get a page**: the plane's scorer (named, material, sourced,
   ZIP-authoritative). The site does not re-decide. **Facilities never get a Development page.**
4. **One page per project, not per ZIP.** The page lists every ZIP whose serving membership holds
   the key, and each of those ZIP pages links to the one project page.
5. **URL:** `/project/<registry_id>/<case-slug>-<h8>/`
   - `registry_id`: the source (`phoenix-building-permits`).
   - `case-slug`: the key's case part, lower-cased, with non-alphanumerics collapsed to `-`.
   - `h8`: the first 8 hex digits of `sha256(base_project_key)`. Two cases that differ only in
     punctuation can slug identically; the hash keeps them apart.
   - **No name in the URL**; names drift (section 1).
6. **A key that leaves the plane gets no page** (404), and **is never redirected to another
   project**: a different key is a different record as far as anyone can prove.
7. **Re-key guard (required before step 12 ships).** On every refresh, per source: the share of the
   previous plane's project keys still present. If it falls below a floor while the source still has
   rows, that source's project pages are **held** (not regenerated and not dropped from the
   sitemap), and the run says so. Nashville's 3% is the test case. The floor should be measured
   from normal day-to-day retention, not picked.
8. **Saved projects should move to the base key.** A separate small change (`app_follows` stores a
   copy id today). Not part of step 12, and recorded here so it isn't lost.

## Instrument note (so the next session doesn't repeat it)

A range lookup `source_key >= 'prefix' and source_key < 'prefix~~~~'` returned **0 Nashville rows**
while a 5% sample found 428. Under the database collation, punctuation sorts differently than
codepoint order, so the range can be empty (claims rule 9). An earlier "0 of 23 keys renamed with a
longer suffix" used the same range and is **not relied on here**; the per-source retention check in
section 3 replaced it. Use `like 'prefix%'` on a sample, or `collate "C"`, for prefix questions.
