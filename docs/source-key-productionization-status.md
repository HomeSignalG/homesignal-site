# Source-key repair — productionization status, corpus re-measure, Cabarrus audit

**2026-08-10.** Follows `docs/source-key-quality-repair.md` (commit `6a92a41`).
**No production change was made in this session.** No deploy, no re-cache, no registry change.

---

## 1. Deployment status — all four layers proven separately

| Layer | Status | Proof |
|---|---|---|
| Code merged to `main` | **NO** | `git merge-base --is-ancestor 6a92a41 origin/main` → not an ancestor. `6a92a41` exists only on `origin/claude/homesignal-multisource-architecture-95bolu`. |
| Edge function deployed with `identity_fields` | **NO** | Deployed slug `get-address-report` is **version 197**, `updated_at` **2026-08-09 19:52:15 UTC** — *before* the commit. `grep -c identity_fields` → **0**; `grep -c identityFromFields` → **0**. |
| Brunswick reports refreshed under new code | **NO** | 37,909 cached Brunswick site elements: **0** carry the new composite `source_id` form, 37,909 carry the old form. Cache `refreshed_at` 2026-08-08 00:45 UTC. |
| NYC reports refreshed under new code | **NO** | 1,355 cached NYC site elements: **0** new form. `refreshed_at` 2026-08-08 19:00–23:45 UTC. |

**Positive control on the deploy grep** (so "0 matches" is not "the grep ran over nothing"): the same
file yields matches for `brunswick-county-permits`, `nyc-dobnow-approved-permits` and `source_id`.
The deployed artifact is a real bundle (1.16 MB, registry inlined) — the absence is real.

### What remains, and why I stopped

1. **Merge `6a92a41` to `main`** — founder gate.
2. **Deploy** `get-address-report` via `deploy-edge-functions.yml` (`workflow_dispatch`). It deploys
   **from the dispatched ref**, so dispatching the feature branch would ship unmerged connector code
   to production. Per the hard rule, I did not do this.
3. **Targeted re-cache** — the ZIP lists are derived below, ready to run.
4. Re-materialize those ZIPs, then re-run §2's measurement to fill the "after" column.

### Phase 2 ZIP lists — derived from data, not from memory

| Source | Affected ZIPs | Sites |
|---|---:|---:|
| `brunswick-county-permits` | **14** | 155,319 |
| `nyc-dobnow-approved-permits` | **213** | 62,043 |

Brunswick, complete: `28420, 28422, 28436, 28451, 28452, 28456, 28461, 28462, 28465, 28467, 28468,
28469, 28470, 28479`.

⚠️ **NYC is 213, not the ~245 carried in the brief** — see §11.

---

## 2. Corpus before / after

Same methodology, re-run in full (3 slices over `dev_sites_deduped`, the materializer's own path):

| Metric | Before (2026-08-10 baseline) | After (this session) | Delta |
|---|---:|---:|---:|
| Source-derived sites | 3,022,921 | 3,022,921 | **0** |
| ZIPs | 11,817 | 11,817 | 0 |
| Distinct `(zip, source_key)` | 2,706,057 | 2,706,057 | 0 |
| Duplicate groups | 37,965 | 37,965 | **0** |
| Rows in duplicate groups | 354,829 | 354,829 | **0** |
| Keyless records | 0 | 0 | 0 |
| Worst single group | 3,664 | 3,664 | 0 |
| Materialized `source_seq > 1` | 19,085 | 19,334 | +249 |

**The zero deltas are the expected and correct result** — nothing was deployed or re-cached, so the
corpus cannot have improved. Re-running it proves the baseline has not *drifted* under the daily
`dev_refresh` cron, which is what makes the eventual "after" comparison meaningful.

The `source_seq > 1` delta reconciles exactly: `19,085 + 249 = 19,334`, the 249 being ZIP 11201
(Brooklyn), materialized for the first time at the end of the previous session. `keyed` moves
`227,272 + 1,118 = 228,390` for the same reason.

---

## 3–4. Brunswick and NYC production result

**Expected: no change. Actual: no change.** Both remain exactly at baseline (Brunswick 155,319
records / 1,007 distinct identities / max multiplicity 3,664; NYC 62,043 / 43,212 / max 20) because
the connector fix is not deployed. The predicted post-deploy figures — Brunswick max **57,543 → 2**,
NYC max **20 → 2**, both measured by live groupBy at the publishers — are unchanged predictions,
**not** results, and are labelled as such.

---

## 5. Evidence integrity — clean

FK inventory re-derived (not assumed): exactly **three** validated `ON DELETE CASCADE` FKs to
`app_projects` — `property_company_roles`, `project_facility_refs`, `identity_conflicts`. No
additional referencing table exists. `app_changes.related_project_id` remains 0 populated rows.

| | Before | After two refresh cycles |
|---|---:|---:|
| `property_company_roles` | 66 (48 with NULL `project_id`) | 66 |
| `project_facility_refs` | 33 | 33 |
| `identity_conflicts` | 4 | 4 |
| role orphans / facref orphans / conflict orphans | 0 / 0 / 0 | **0 / 0 / 0** |
| TDLR/TABS roles still attached | 5 | **5** |

All five Del Valle TABS identities intact and correctly keyed —
`tdlr_tabs:TABS2023006449 / …6483 / …2024016698 / …2024022676 / …2026011928`.

**Repaired sources still carry zero downstream evidence:** 217,355 Brunswick+NYC rows, **0** with
evidence. **Cabarrus: 30,264 rows, 0 with evidence** (checked before the audit, per Phase 6).

**Two-refresh stability, this session** (each ZIP refreshed twice, ids compared):

| ZIP | rows | ids preserved | lost | new |
|---|---:|---:|---:|---:|
| 78617 | 537 | **537** | 0 | 0 |
| 28470 (Brunswick) | 19,155 | **19,155** | 0 | 0 |
| 11201 (NYC) | 1,118 | **1,118** | 0 | 0 |

---

## 6. Cabarrus classification — **Class C + Class D. NOT a source-key defect.**

`cabarrus-county-plan-reviews` · layer `Current_Accela_Permits/Plan_Reviews/MapServer/0`, internally
named **`AccelaQuery`** (a database view, ArcGIS 10.91).

**The mapped identity is already correct.** `case_number → B1_ALT_ID`, and `B1_ALT_ID` is the
layer's own **`displayField`**, carrying real permit numbers (`PRB2025-00756`, `PRS2021-00276`).
This is the opposite of Brunswick, where the mapped column was a counter.

**Evidence for the worst group — `PRB2025-00756`, n=891:**

- groupBy `(ReviewType, B1_PER_ID1, B1_PER_ID2, B1_PER_ID3)` → **one group, n=891**. All 891 rows
  share Accela's own record triplet `25CAP / 00000 / 0038P` and ReviewType `Commercial New`.
- groupBy `(StreetAddress, ParcelNum, B6_ADDR_TYPE)` → **one group, n=891**:
  `65120 SAWGRASS LN KANNAPOLIS NC 28027` / `46918500940000` / `Kannapolis`.
- Sampled rows differ **only in OBJECTID** (195111913, 195111914, 195111915 …), and OBJECTIDs near
  195 million on a view named `AccelaQuery` are consistent with a join explosion at the publisher.
- **With geometry:** 195111913/914/915 share one point; 195112280/281 share a *different* point. Our
  cache confirms the consequence — `PRB2025-00639` has **1,104 site instances at 368 distinct
  lat/lng**, with 1 distinct label, 1 date, 1 status.

**So the duplication is two things, neither of them an identity problem:**

- **Class C** — exact publisher duplicates (several identical rows at the same point).
- **Class D** — geometry decomposition: one permit emitted at hundreds of points, the MassDOT
  pattern. This is why `dev_sites_deduped` does not collapse them: lat/lng is in the dedup key and
  the points genuinely differ.

**No candidate field distinguishes these rows, because they are not distinct records.** Accela's
`B1_PER_ID1/2/3` triplet is identical across all 891 — the only varying field is the
system-generated `OBJECTID`, which the rules forbid using without documented durability (and which
is unstable on a rebuilt view).

---

## 7. Cabarrus change — **NONE, deliberately**

Phase 6's gate is "if and ONLY if the evidence conclusively identifies an authoritative
key/composite." The evidence conclusively identifies the **opposite**. Adding an `identity_fields`
composite here would manufacture distinctness for rows that carry none — precisely what the hard
rules forbid ("never force uniqueness just to eliminate `source_seq`").

`source_seq` is the correct handling for the Class C portion. The Class D portion (one permit at 368
points) is the **same product-model question as MassDOT** and is deferred to the founder, unchanged.

---

## 8. Remaining duplicate sources — top 10 (unchanged; fixes not yet live)

| # | Source | Rows in dups | Max mult | % of source | Preliminary class | Action? |
|---|---|---:|---:|---:|---|---|
| 1 | `brunswick-county-permits` | 155,106 | 3,664 | 99.9% | **A — fixed, awaiting deploy** | deploy |
| 2 | `massdot-highway-projects` | 85,627 | 136 | 92.8% | **D** — geometry segments | founder (product) |
| 3 | `nyc-dobnow-approved-permits` | 29,338 | 20 | 47.3% | **B — fixed, awaiting deploy** | deploy |
| 4 | `cabarrus-county-plan-reviews` | 28,666 | 368 | 94.7% | **C + D** (this session) | none |
| 5 | `missoula-addresses-with-permits` | 11,094 | 87 | 15.3% | unclassified | investigate later |
| 6 | `clv-planning-cases` | 5,777 | 137 | 75.5% | unclassified | investigate later |
| 7 | `desoto-county-permits` | 4,465 | 1,081 | 62.8% | suspected **A** (`APBTP`) | **next candidate** |
| 8 | `charleston-county-permits` | 4,359 | 146 | 11.5% | unclassified | low priority |
| 9 | `mdot-stip-projects` | 4,144 | 54 | 55.9% | suspected **D** (DOT) | founder (product) |
| 10 | `minneapolis-ccs-permits` | 3,684 | 8 | 7.9% | unclassified | low priority |

After the two pending fixes land, **~184,000 of the 354,829 duplicated rows (52%) are addressed by
identity**. Of the remainder, the largest blocks (MassDOT 85,627 + Cabarrus 28,666 + MDOT 4,144 =
**118,437, 33% of all duplication**) are **not identity defects at all** — they are the one product
question: *should one project with many geometries be one record or many?*

---

## 9. MassDOT — re-measured, untouched

`92,315` materialized rows · `20,323` distinct identities · `13,635` duplicate groups · `85,627`
rows in groups · max multiplicity `136`. Source layer: 24,045 features; project `613571` spans 811.
**No behavioral change made.** Reported here only as a corpus contribution. It remains a **product
model question**, not a key-quality defect.

---

## 10. Tests

| Suite | Result |
|---|---|
| `source-key-quality` | **PASS** (22 assertions, real captured publisher rows) |
| `app-projects-stable-key` | **PASS** |
| `connector-option-surface` | **PASS** (15 checks) |
| `app-refresh-zip-determinism` | **PASS** |
| **Full offline suite** | **87/87 files pass** |

Two consecutive refreshes on 78617 / 28470 / 11201 → identical output both runs, 100% id
preservation (§5).

---

## 11. Corrections

1. **NYC affected ZIPs: the brief's "approximately 245" is wrong — the measured figure is 213.**
   Derived from the cache by `count(distinct zip)` where the connector actually contributes sites.
   The 245 was the NYC-borough *page* expansion count (`nyc_borough_zip_expansion` added 245
   `level=zip` rows), which is not the same set as the ZIPs this connector reaches. Brunswick's
   "approximately 14" **is** correct (exactly 14).
2. **My own prior-session speculation was wrong.** `docs/source-key-quality-repair.md` §16 called
   `cabarrus-county-plan-reviews` "the next likely Class A" and "highest-value next candidate". It
   is **not Class A** — the mapped column is already the layer's `displayField` and a real permit
   number. It is Class C + D and needs no identity change. That line was a guess from the
   multiplicity shape (max 368) without publisher evidence; this session replaced it with evidence.
   The corrected next Class A candidate is `desoto-county-permits`.
3. No other prior measurement failed re-verification. The corpus figures, evidence counts and
   Brunswick/NYC identity findings all reproduced exactly.

---

## 12. Recommendation

**Source-key quality is NOT yet the blocker — deployment is.** But neither is a reason to hold the
evidence architecture.

**Do not start TCAD / the evidence architecture until `6a92a41` is merged and deployed.** Not
because of key quality, but because the multi-source model will attach evidence to `app_projects`
rows, and re-keying Brunswick/NYC *after* evidence exists would be far more expensive than doing it
now while **0 rows carry evidence**. The window is currently free; it will not stay free.

Recommended order:

1. **Merge + deploy + targeted re-cache** (14 + 213 ZIPs) + re-materialize + re-measure. This is the
   only outstanding item from the repair itself.
2. **One founder decision — the geometry/product question** covering MassDOT, Cabarrus and MDOT
   (118,437 duplicated rows, 33% of all duplication): one project with many geometries = one record
   or many? No identity work can or should answer it.
3. **`desoto-county-permits`** (max multiplicity 1,081 on `APBTP`) — the one remaining plausible
   Class A, ~4,465 rows. Small; can ride alongside the evidence work.
4. **Then** the multi-source evidence architecture and the TCAD parcel adapter.

Items 2 and 3 do **not** block item 4. Item 1 does.
