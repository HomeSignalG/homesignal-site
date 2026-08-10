# Source-key quality repair — Brunswick, NYC DOB NOW, and the duplicate long tail

**2026-08-10.** Follows `docs/app-projects-stable-key-repair.md`. Config + connector change:
`supabase/functions/get-address-report/sources/{arcgis,socrata}.ts` (one additive option),
`jurisdiction-registry.json` (2 entries, +9 lines, 0 deletions).
Tests: `test/source-key-quality.test.mjs`.

> ⚠️ **NOT YET IN EFFECT IN PRODUCTION.** The registry/connector fix changes what the *engine
> emits*; it takes effect only after the edge function is deployed **and**
> `development_reports` is re-fetched for the affected ZIPs. Neither was done — see §12.

---

## 1. Re-measured baseline (reproduced, not assumed)

Measured through `dev_sites_deduped` — the exact path the materializer reads — over the full
corpus. **Reproduces the earlier figures exactly**, so the branch has not drifted:

| Metric | Value |
|---|---:|
| ZIPs with ≥1 qualifying site | 11,817 |
| Qualifying sites | 3,022,921 |
| Distinct `(zip, source_key)` | 2,706,057 |
| **Duplicate groups** | **37,965** |
| **Rows in duplicate groups** | **354,829** |
| Worst single group | 3,664 |
| Keyless rows | **0** |

Materialized state (ZIPs key lazily on refresh, so this is a subset by design):
`app_projects` 3,027,773 · keyed 227,272 · `source_seq > 1` **19,085** · 11,234 ZIPs refreshed.

**Top duplicate sources** (all basis `source_id:case_number`):

| # | Source | Dup groups | Rows in dups | Max mult | % of source |
|---|---|---:|---:|---:|---:|
| 1 | `brunswick-county-permits` | 794 | 155,106 | **3,664** | 99.9% |
| 2 | `massdot-highway-projects` | 13,635 | 85,627 | 136 | 92.8% |
| 3 | `nyc-dobnow-approved-permits` | 10,507 | 29,338 | 20 | 47.3% |
| 4 | `cabarrus-county-plan-reviews` | 658 | 28,666 | 368 | 94.7% |
| 5 | `missoula-addresses-with-permits` | 1,784 | 11,094 | 87 | 15.3% |
| 6 | `clv-planning-cases` | 661 | 5,777 | 137 | 75.5% |
| 7 | `desoto-county-permits` | 26 | 4,465 | 1,081 | 62.8% |
| 8 | `charleston-county-permits` | 601 | 4,359 | 146 | 11.5% |
| 9 | `mdot-stip-projects` | 726 | 4,144 | 54 | 55.9% |
| 10 | `minneapolis-ccs-permits` | 1,206 | 3,684 | 8 | 7.9% |

---

## 2. Classification

| Class | Sources | Evidence |
|---|---|---|
| **A — bad source configuration** | `brunswick-county-permits`, `desoto-county-permits` | the mapped case-number column is not an identifier (§3) |
| **B — genuine multi-record base id** | `nyc-dobnow-approved-permits` | one job filing legitimately carries several permits (§4) |
| **C — true publisher duplicates** | residual pairs in Brunswick *and* NYC | byte-identical rows at the publisher (§3, §4) |
| **D — geometry decomposition (NOT an identity defect)** | `massdot-highway-projects`, and probably `mdot-stip-projects` / `fdot-active-construction-projects` | one project = many road segments (§5) |
| **UNRESOLVED — not guessed** | `cabarrus-county-plan-reviews`, `missoula-*`, `clv-planning-cases`, `charleston-*`, `minneapolis-*`, `arlington-*`, `anne-arundel-*`, `slo-county-*` | not probed this pass; reported, untouched (§5) |

---

## 3. Brunswick County — root cause and fix

**Root cause, proven at the source.** `column_map.case_number` → `PermitNumber`, but on this
layer `PermitNumber` is a **per-project sequence counter**, not an identifier. Live groupBy over
all 278,603 features:

```
PermitNumber "1000" n=57543 · "1001" n=46530 · "1002" n=32019 · "1003" n=26189 · "1004" n=22438
```

— a decaying counter distribution, not identifiers. Two captured features confirm it:

| OBJECTID | ProjectNumber | PermitNumber | ParcelAddress |
|---:|---|---|---|
| 346 | 2003052440 | **1000** | 4750 PIGOTT RD SW 28470 |
| 347 | 2003000085 | **1000** | 4688 LONG BEACH RD SE 28465 |

The layer's own `displayField` is **`ProjectNumber`**. The record model is
*project → permits numbered 1000, 1001, …*.

**Fix:** `identity_fields: ["ProjectNumber","PermitNumber"]`. Live groupBy on the composite:
**max multiplicity 3,664 → 2**.

**Why not `OBJECTID`:** it is `isSystemMaintained` and the layer declares `supportsTruncate:true`,
so a truncate-and-reload reassigns it. `ProjectNumber`+`PermitNumber` are agency-issued and
immutable.

**Residual (Class C):** the n=2 pairs are **publisher duplicates** — OBJECTID 18204 and 18205 are
identical on every field except `DateIssued`, which differs by **67 milliseconds**.

---

## 4. NYC DOB NOW — root cause and identity rule

**Root cause.** `case_number` → `job_filing_number`, which is the **job filing**, not the permit.
DOB NOW issues several permits per filing. `M00932693-I1` resolves to **8 rows**, all sharing
`work_permit = M00932693-I1-GC-CX`:

| sequence_number | work_type | filing_reason | issued_date |
|---:|---|---|---|
| 1 | General Construction | Initial Permit | 2025-01-09 |
| 1 | Structural | Initial Permit | 2025-01-09 |
| 2 | General Construction | Renewal Permit with Changes | 2025-03-27 |
| 2 | Structural | Renewal Permit with Changes | 2025-03-27 |
| 3 | General Construction | Renewal Permit Without Changes | 2026-03-10 |
| 3 | Structural | Renewal Permit Without Changes | 2026-03-10 |
| 4 | General Construction | Renewal Permit with Changes | 2026-04-16 |
| 4 | Structural | Renewal Permit with Changes | 2026-04-16 |

**Identity rule: `work_permit | sequence_number | work_type`.**

**Chosen by measurement, in the connector's own scope** (work_type whitelist + 365-day window +
`permit_status in ('Permit Issued','Signed-off')` — Rule 13), not by assumption. Candidates tested:

| candidate | max multiplicity in scope |
|---|---:|
| `job_filing_number` (current) | **20** |
| `job_filing_number + work_type + filing_reason + issued_date` | 5 |
| `work_permit` alone | not unique (identical on all 8 above) |
| `tracking_number` alone | 6 (66,650 rows → 52,741 distinct) |
| **`work_permit + sequence_number + work_type`** | **2** |
| + `issued_date` | 2 (no gain) |
| + `tracking_number` | 2 (no gain) |

The last two add no discriminating power, so they are excluded on **minimality**.

**Residual (Class C):** `B01074825-S3-ST / 2 / Structural / tracking 248682387` returns **2 rows
that are 1 distinct value** — byte-identical on every published field. No composite can separate
them, and none should.

**Sentinel noted:** `work_permit` carries the literal `"Permit is not yet issued"` on ~293 rows
and can be NULL. Those never reach `app_projects` (their `permit_status` is outside the mapped
buckets and fails closed), and the connector's fail-closed rule (§8) would fall back rather than
mint a colliding key.

---

## 5. Other large duplicate sources

**`massdot-highway-projects` (#2, 85,627 rows) is NOT an identity defect.** The layer holds
**24,045 features**, and one `Project` (613571) spans **811 features** — it is a polyline segment
layer: one highway project decomposed into many road segments. Giving each segment a distinct key
would *legitimise* rendering one project as 811 separate cards. The real question is a product
one — collapse to one record per `Project` — which changes what residents see and is therefore
**gated, not done here**. `mdot-stip-projects` and `fdot-active-construction-projects` show the
same DOT-project signature and are very likely the same class (not probed).

The remaining sources in the table are **reported and untouched** per the task's "do not expand
into dozens of tiny source-specific cleanups". `cabarrus-county-plan-reviews` (max 368, on Accela
`B1_ALT_ID`) is the highest-value next candidate and looks like Class A.

---

## 6. Title-derived source IDs — audited, deliberately unchanged

All 625 belong to three entries:

| Source | Sites | Max mult |
|---|---:|---:|
| `austin-zoning-cases` | 578 | 2 |
| `austin-site-plan-cases` | 43 | 2 |
| `sussex-county-de-conditional-use` | 4 | 1 |

**Cause:** not a mis-mapping — `column_map.case_number` is correctly `case_number`. The live
dataset has **6,925 rows, 6,844 with a case number → 81 rows where it is genuinely NULL**. Those
81 land on many ZIP pages via 3-mile spatial scoping, producing 578 site instances. The connector
falls through `caseNo ?? rowId ?? title`; for Socrata `rowId()` reads `:id`, which the connector
does not request, so it lands on `title`:

```
source_id = socrata:data.austintexas.gov:edir-dcnf:21 Rio
source_id = socrata:data.austintexas.gov:edir-dcnf:Holly Street Rezoning
```

**Decision: report, do not patch.** No authoritative record id exists on those rows. Requesting
Socrata's `:id` would supply *an* id, but `:id` is a platform row handle that changes when a
dataset is replaced wholesale — I could not establish its stability for this dataset without
observing an update cycle, and the rule is authoritative-source identity, not a plausible
substitute. Hard-failing them instead would delete 578 real, sourced records from live pages —
worse than the status quo. **Risk accepted and recorded: a renamed zoning case presents as a new
record.** 0.021% of the corpus, max multiplicity 2.

---

## 7. OpenDataSoft — answered by its own documentation

**Category C/B: intentionally staged, connector deliberately not built.** The registry's own
`_opendatasoft_readme` states it verbatim:

> "STATUS: the connector is NOT BUILT YET — sources/ has no opendatasoft.ts and index.ts makes no
> opendatasoftForZip() call, so NOTHING READS THIS ARRAY at runtime. These entries are the staged
> data half; they become live the moment the additive connector lands."

`test/connector-option-surface.test.mjs` already whitelists it
(`KNOWN_NO_CONNECTOR = ['shelby-county-building-permits']`), so the guard knows too. **This
corrects my previous session's framing of it as "a declared source that never runs"** — it is a
documented, guarded, deliberate staging state, not a defect. No source-key impact: it emits nothing.

---

## 8. The source-key contract (unchanged in principle, now enforced in two layers)

1. connector-emitted namespaced `source_id` — **`identity_fields` when declared**, else
   `case_number`, else the platform row id, else title
2. authoritative project/case id with a namespace (`tdlr_tabs:`, `epa_frs:`)
3. defensible immutable composite (declared per entry, never inferred)
4. **fail closed** — NULL, never a fabricated key

Never permitted as identity: address · title (except the accepted, reported Austin residual) ·
company/developer/owner · geocode · arbitrary row number. `source_seq` remains a **safety net for
publisher duplicates**, not an identity.

---

## 9–10. Backfill / re-key and downstream evidence

**A deterministic old→new re-key mapping is impossible for exactly the rows being repaired, and
that is inherent to the defect:** the old key did not identify the record (57,543 Brunswick rows
shared one). There is no correct old→new function; any mapping would be a guess. Address- or
name-based matching is prohibited and would be wrong anyway.

**So id churn at deploy is unavoidable — and provably harmless here:**

```sql
select count(*) rows_from_repaired_sources,           -- 217,355
       count(*) filter (where <referenced by any of the 3 evidence tables>)  -- 0
from app_projects where registry_id in ('brunswick-county-permits','nyc-dobnow-approved-permits');
-- rows_from_repaired_sources 217355 | repaired_rows_carrying_evidence 0
```

**Zero** of the 217,355 rows from the two repaired sources carry any downstream evidence. All 39
evidence-anchored rows are EPA FRS facilities and TDLR filings in 78617 / 76511 / 78634 / 78642 /
78664 / 78729. The re-key therefore cannot detach anything, and the evidence guard in
`app_refresh_zip` protects them regardless.

---

## 11. Two-refresh validation (current state — change still inert)

| ZIP | source | rows | ids preserved | lost | new |
|---|---|---:|---:|---:|---:|
| 78617 (Del Valle, control) | TDLR + FRS + Austin | 537 | **537** | 0 | 0 |
| 28470 (Brunswick) | `brunswick-county-permits` | 19,155 | **19,155** | 0 | 0 |
| 11201 (Brooklyn, NYC DOB NOW) | `nyc-dobnow-approved-permits` | 1,118 | **1,118** | 0 | 0 |

Downstream after: `property_company_roles` 66 · `project_facility_refs` 33 ·
`identity_conflicts` 4 · **0 orphans**. Run output identical across both refreshes for all three.

This proves **no regression** from the connector/registry change. It does **not** yet demonstrate
the duplicate reduction, because the change is inert until deploy (§12).

---

## 12. Before / after

| Metric | Before (measured) | After (measured at source; corpus figure pending deploy) |
|---|---:|---|
| Duplicate source-key groups (corpus) | 37,965 | pending re-cache |
| Rows in duplicate groups (corpus) | 354,829 | pending re-cache |
| Rows with `source_seq > 1` (materialized) | 19,085 | pending re-cache |
| **Brunswick max multiplicity** | **3,664** (corpus) / **57,543** (source) | **2** — live groupBy on the composite |
| **NYC max multiplicity** | **20** (in-scope) | **2** — live groupBy on the composite |
| Title-derived source IDs | 625 | 625 — deliberately unchanged (§6) |
| Keyless / unsupported rows | 0 | 0 |

**I have not written a corpus "after" number, because it cannot be measured without deploying and
re-caching.** The cached `sites` elements carry only what the connector emitted — they do not
contain `ProjectNumber` or `work_permit` — so the new keys are not derivable locally. The source-
level reductions (57,543→2 and 20→2) are live groupBy results against the publishers.

**Remaining after the fix lands:** Class C publisher duplicates (max 2, both sources) and the
Class D / UNRESOLVED long tail in §5.

**Why deploy was not done:** `deploy-edge-functions.yml` is `workflow_dispatch` and deploys from
the dispatched ref, so dispatching this feature branch would put unmerged connector code into
production — a gated act. It also requires re-caching `development_reports` for ~14 Brunswick and
~245 NYC ZIPs.

---

## 13. Performance

`identityFromFields` is a bounded loop over 2–3 already-fetched columns per row: no network call,
no join, no JSON scan, no fuzzy matching. It runs inside the existing per-row normalisation. No
new query, no new column requested from the publisher. Materializer cost unchanged — measured
worst case still **12.5 s for 19,155 rows** (28470), identical to the pre-change measurement.

---

## 14. Tests

`test/source-key-quality.test.mjs` — **22 assertions, all green**, driving the **shipped**
connectors over rows captured verbatim from the live publishers:
Brunswick rows at different addresses no longer share an identity · NYC's 8 legitimate filings get
8 distinct identities · identity stable across calls · fail-closed on NULL/blank fields ·
default-off for the other 181 entries · namespace prevents cross-agency collision · identity is
never a bare ordinal · no address or title text in the key · `case_number` unchanged on both
entries (display preserved) · exactly two entries declare `identity_fields` · Austin deliberately
un-patched. Includes **positive controls** asserting the old key really was identical on the
captured rows.

**Full offline suite: 87/87 files pass** (86 → 87 — this file; the prior repair's suite was
already in the 86).

Registry change asserted **strictly additive** programmatically: 0 keys removed, 0 values
modified, 2 keys added, entry counts unchanged (arcgis 155, socrata 22, …).

---

## 15. Rollback

Fully staged and cheap, because the change is two config keys plus one default-off option:

1. **Config only** — delete the two `identity_fields` blocks from `jurisdiction-registry.json`
   (9 lines). Behaviour returns to `case_number` immediately on next deploy.
2. **Connector** — revert the `identityFromFields` helper and the two `source_id` lines. With no
   entry declaring `identity_fields`, the helper is unreachable, so step 1 alone is sufficient.
3. No schema change, no data migration, nothing to un-write. `app_projects.source_key` and
   `source_seq` from the prior repair are untouched.

---

## 16. Recommended next step

1. **Merge, then deploy** `get-address-report` from `main` via `deploy-edge-functions.yml`, then
   re-cache Brunswick (14 ZIPs) and NYC (245 ZIPs) and re-materialize. Then re-run §12's corpus
   measurement to replace "pending" with real numbers.
2. **Founder decision on MassDOT** (85,627 rows): collapse a highway project's segments to one
   record per `Project`? That changes what residents see.
3. **Then** `cabarrus-county-plan-reviews` (28,666 rows, max 368) — the next likely Class A.
4. Only then the multi-source evidence architecture.

---

## Answers

**A. Brunswick fixed at the source-mapping level, not masked by `source_seq`?**
Yes — `identity_fields: [ProjectNumber, PermitNumber]` on the registry entry, proven against the
live layer (max multiplicity 57,543 → 2). `source_seq` now only covers the 2-row publisher
duplicates. ⚠️ Effective on deploy + re-cache, not yet in production.

**B. NYC's distinct filings represented by deterministic source identities rather than row order?**
Yes — `work_permit | sequence_number | work_type`, all agency-issued immutable fields, chosen by
measuring six candidates in the connector's own scope. The regression test drives the shipped
connector over all 8 real rows of `M00932693-I1` and asserts 8 distinct identities. Row order is
never used.

**C. Did any downstream evidence relationship change or disappear?**
No. 66 roles / 33 facility refs / 4 conflicts before and after, 0 orphans, across three
two-refresh cycles. And 0 of the 217,355 rows from the two repaired sources carry evidence, so
the re-key cannot detach anything.

**D. Is every corrected identity based exclusively on authoritative source fields?**
Yes — `ProjectNumber`, `PermitNumber`, `work_permit`, `sequence_number`, `work_type` are all
publisher-issued. No address, title, company name, geocode or ordinal. The one surviving
title-derived identity (Austin, 625 rows) was **audited and deliberately left alone** rather than
replaced with a synthetic id, and is reported in §6.
