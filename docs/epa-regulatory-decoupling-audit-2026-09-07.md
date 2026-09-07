# EPA / Regulatory decoupling — dependency audit (2026-09-07)

**Status: AUDIT (2026-09-07). PHASE 1 HAS SINCE SHIPPED — see §11 at the end.**
The findings below describe the state at audit time and are retained verbatim as the dated
receipt; §1 and §2 are now FIXED, §3-§6 are not. Do not read §9's verdict table as current
without reading §11.

Founder architecture decision: Map 1 has **two independent data planes** — a required
**core project plane** and an optional **regulatory overlay plane** (EPA / FRS / ECHO /
state-linked records, purple `R` markers). This document is the measured inventory of every
place the two are currently coupled, ranked by severity, each finding paired with the
evidence that proves it and the numbered rule it violates.

Every count below was produced by a query run against production
(`qwnnmljucajnexpxdgxr`) on 2026-09-07, and every count is stated next to its control.

---

## 0. Headline

**EPA FRS was DOWN at the moment of this audit**, which turned the audit into a live
experiment rather than a code reading. Both probe targets, newest resolved row each:

| target | ok | status | error | resolved_at |
|---|---|---|---|---|
| `atlanta-dense` (r=1) | **false** | — | `Failure when receiving data from the peer` | 2026-09-07 14:00:00Z |
| `sheridan-rural` (r=3) | **false** | `429` | — | 2026-09-07 14:00:00Z |

So `dev_refresh_collect`'s `epa_ok` evaluated **false** for this window, and the coupling
was observable in production rather than inferred:

> **In the last 60 minutes: 51 ZIP refreshes were refused outright by the EPA-facilities
> clause. 46 of those 51 had project data in hand. 6,532 core project records were fetched
> from first-party permit/planning sources and discarded because EPA did not answer.**

Control that makes those numbers readable: 239 ZIP responses landed in the same window,
239 of 239 carried an `epa` key, 56 reported `epa.ok=false`, and 202 carried project
records — so the failure is partial and density-dependent, exactly as documented, and the
51 is a real subset rather than a total outage artifact.

**Structural exposure:** 11,565 of 12,722 cached ZIP reports (**90.9%**) carry
`counts.facilities > 0`, which is the precondition for that clause to fire. **10,344 of
them also carry project records.** An EPA outage of any length can therefore freeze the
core project plane on nine out of ten Map 1 pages.

---

## 1. CRITICAL — an EPA facility count can pause the core refresh cron nationally

**Where:** `public.epa_recovery_proof_check(text)` and `public.epa_recovery_step2(text)`
(SQL of record: `docs/epa-recovery-rpcs.sql`; driver:
`.github/workflows/epa-recovery-watch.yml`).

Both call `cron.alter_job(... jobname='dev-reports-rolling-refresh' ...)` — **the core
project refresh job (jobid 14, `*/2 * * * *`)** — on an EPA-only signal:

```sql
-- epa_recovery_proof_check: the proof is a FACILITY COUNT for one ZIP (82801)
_pass := _after >= _want;      -- _after = counts.facilities after a probe refresh
if not _pass then
  perform cron.alter_job((select jobid from cron.job where jobname='dev-reports-rolling-refresh'),
                         active := false);          -- ← pauses ALL core project refresh
end if;
```

```sql
-- epa_recovery_step2: refuses to RESUME the core refresh until EPA is healthy
if not _ok then
  raise exception 'EPA has not recovered on the latest resolved probe — refusing to start step 2';
end if;
```

One ZIP's EPA facility count is the gate on the national project-refresh job, in both
directions. **Violates rules 6, 7, 8.**

Current state: job 14 is `active=true`, so the switch is not thrown today. The defect is
that the switch exists and is wired to EPA. `.github/epa-recovery-armed` is present and
`epa-recovery-watch.yml` carries a live `schedule: cron '17 * * * *'`, so the path is
armed, not dormant. (Note also that the workflow's own header comment states the schedule
"is deliberately commented out"; it is not. That comment is stale and misleading about the
one fact a reader most needs.)

---

## 2. CRITICAL — an EPA failure refuses the ENTIRE core project write for a ZIP

**Where:** `public.dev_refresh_collect()`, final `and not (...)` clause of the single
`UPDATE public.development_reports`. SQL of record:
`docs/dev-refresh-epa-probe-guard.sql`, `docs/dev-refresh-per-report-epa-guard.sql`.

```sql
and not (
  (not (epa_ok and coalesce((j->'epa'->>'ok')::boolean, true))   -- EPA unhealthy
   or d.refreshed_at >= now() - interval '7 days')
  and coalesce((j->'counts'->>'facilities')::int, 0) = 0
  and coalesce((d.counts->>'facilities')::int, 0) > 0
);
```

The guard's *intent* is right and must be preserved: a failed EPA read must never be
stored as an authoritative zero. Its *blast radius* is wrong. There is **one UPDATE
statement writing both planes at once** —

```sql
update public.development_reports d set
  counts = j->'counts',        -- development AND facilities
  sites  = j->'sites',         -- project records AND facility records, one jsonb array
  refreshed_at = now(), ...
```

— so refusing the regulatory half refuses `sites`, `counts.development` and
`refreshed_at` with it. That is the mechanism behind the headline measurement: 6,532
project records discarded in one hour. **Violates rules 6, 7, 9.**

### 2a. And the refusal then makes the ZIP look stale in *core* coverage reporting

A refused write leaves `refreshed_at` untouched (this is already noted in
`docs/dev-refresh-fair-ordering.sql`), and `app_coverage_states` reads that timestamp:

```sql
when r.refreshed_at < now() - interval '72 hours'
     and r.last_refresh_attempt_at > r.refreshed_at ...  then 'temporarily_unavailable'
when r.refreshed_at < now() - interval '72 hours'        then 'stale_data'
```

Measured, with control:

| measure | count |
|---|---:|
| cached reports (control) | 12,722 |
| `refreshed_at` older than 72h | 3,706 |
| …of those, carrying cached facilities > 0 | **3,656 (98.7%)** |
| attempted in last 48h but not written | 2,563 |
| …of those, carrying cached facilities > 0 | **2,533 (98.8%)** |

The near-perfect correlation between "write refused" and "has cached facilities" is the
signature of this clause. **Violates rule 8.**

---

## 3. HIGH — EPA facilities decide `data_quality = 'pass'` and `indexable`

**Where:** `public.app_refresh_zip(text)`.

```sql
_nf  := count of app_projects where record_kind='facility'    -- EPA overlay records
_nfc := count of report sites whose relevance is NOT 'development' and NOT 'civic'  -- EPA floor

data_quality := case when (_nd + _nf + _nc) > 0 then 'pass' else 'coverage_coming' end;
indexable    := ((_nd + _nf + _nc) > 0 and (_ndp > 0 or _nfc >= 3));
```

`_nf` and `_nfc` are the regulatory plane. They appear directly in the completion marker
and in the SEO/advertisement gate. Three or more EPA facilities makes a ZIP **indexable
with zero project records**. Measured, control 12,722 meta rows:

| measure | count |
|---|---:|
| ZIPs at `data_quality='pass'` | 12,444 |
| ZIPs `indexable` | 11,708 |
| **`pass` ONLY because of EPA facilities** (0 development records, 0 civic changes) | **766** |
| **`indexable` with 0 development records** (rests on `_nfc >= 3`) | **1,004** |

**Violates rules 1 and 8.** Also rule 5 in a minor form: the same `_nfc` feeds a
`regulated facilities` component of `growth_pressure`, an overlay input to a core metric.

---

## 4. HIGH — `facilities_only` is a *core* coverage state, and it maps to `pass`

**Where:** `public.app_coverage_states` (`docs/coverage-state-model.sql`), asserted by
`scripts/verify-coverage-state.mjs` and `.github/workflows/verify-coverage-state.yml`.

```sql
when coalesce(c.dev_markers,0) > 0 or coalesce(ch.changes,0) > 0 then 'populated'
when coalesce(c.fac_markers,0) > 0                               then 'facilities_only'
else 'honestly_empty'
```

`fac_markers` is `record_kind='facility'`, i.e. the overlay. CI then *pins* the coupling:

```js
ok('legacy: populated/facilities_only => pass',
   rows.every(r => !['populated','facilities_only'].includes(r.coverage_state)
                   || r.data_quality === 'pass'));
```

Under the two-plane model, a ZIP with no qualifying projects is
`no_qualifying_projects_found` in the **core** plane regardless of how many EPA facilities
sit nearby; the facility count belongs in a separate overlay-coverage state. Today one
enum mixes them and CI enforces the mix. **Violates rules 1 and 8.**

Downstream consumer: `lib/community-page.js` branches on
`cov.coverage_state === 'facilities_only'` to choose the coverage banner, so the copy a
resident reads is also driven by the merged state.

---

## 5. MEDIUM — one `sites` array carries both planes (the schema-level coupling)

`get-address-report` emits a single `sites: []` mixing EPA facility records (`scope:"point"`,
`registry_id`, `src:"EPA FRS · registry …"`) with project records, and `development_reports`
stores it in one jsonb column with one `counts` object holding both `facilities` and
`development`.

This is what makes §2 possible: there is no way to accept one plane's write and refuse the
other's, because they are one value. It is also the direct obstacle to **rule 11** —
removing or replacing EPA today means changing the payload shape, the `app_refresh_zip`
facility insert branch, and the guards that read `counts.facilities`.

**Mitigating fact, worth knowing before any redesign:** at the *materialized* layer the
planes are already separable by a column — `app_projects.record_kind ∈ {'development',
'facility'}`, plus `registry_id` and `facility_env`. So the read side is largely ready; the
coupling is concentrated in the payload and in the decision logic above.

---

## 6. MEDIUM — EPA latency is on the critical path of every report

`index.ts` (both ZIP and address mode):

```js
const [devRaw, facResult] = await Promise.all([devSites(...), facilitySites(...)]);
```

`facilitySites` → `frsFacilities()` walks a back-off of `[3, 2, 1.5, 1, 0.5, 0.25]` miles,
i.e. **up to six sequential HTTP requests to a service that is failing**, before the report
can be assembled. The report cannot return until EPA gives up. On a worker with a CPU/wall
budget this converts an EPA slowdown into a core-plane timeout. **Rule 6 (blocking), and a
latent rule 7.**

---

## 7. What is ALREADY compliant — do not redo this work

| area | evidence |
|---|---|
| **Map 1 render/filter** | `siteVisible()` = `FILTER[bucket] && HS.categoryVisible(...)`. No EPA state in project visibility. `HS.visibleSignal` gates the purple `R` **only**; a project carrying a regulatory record is never hidden when the switch is off. |
| **Regulatory overlay control** | Founder ruling 2026-09-06 already moved `facility` out of the Type row into its own `HS.REGULATORY_LEGEND` switch (`HS.regulatoryVisible()`), satisfying **rule 12**. `HS.allTypeCategoriesOff()` correctly excludes it. |
| **Pin colour / shape** | `resolveTrackerMarker` takes lifecycle colour from the project's own stage; the regulatory fact rides as a subordinate `signal`. **Rule 5 holds on the map.** |
| **Engine EPA failure handling** | `sources/epa-frs.ts` never throws — every path returns `{ok:false, rows:[]}`. **Rule 7 holds inside the engine**; the propagation is entirely in the DB guard (§2). |
| **Live scoreboard** | `FLOOR_SOURCE_IDS = {'epa-frs','EPA-FRS','epa_frs'}` — EPA is tracked but explicitly never counts toward Live. Already two-plane. |
| **`dev_refresh_fire_targets`, `dev_refresh_health`** | No EPA reference. Ordering and health are core-only (though §2a makes `dev_refresh_health` *report* EPA-caused staleness). |
| **`homesignal-ingest` repo** | EPA appears only in two standalone workflows (`echo-violation-cache.yml`, `build-address-map.yml`) writing a cache file. **No coupling into Local News or Government Notices pipelines.** |
| **`verify-development.mjs`** | Reports the facility count; does not assert on it. Its only coupling is reading the EPA-contaminated `indexable` flag (§3). |

---

## 8. Tests and docs that currently ENCODE the coupling

These pass today and would need to move with any fix — they are the reason a fix cannot be
a quiet edit:

- `scripts/verify-coverage-state.mjs` — `legacy: populated/facilities_only => pass`, and
  the `facilities_only` rendering sample (`wantPass: true`, "still being wired" copy).
- `test/coverage-state-news-not-coverage.test.mjs` — asserts the same legacy mapping.
- `test/dev-refresh-epa-probe-guard.test.mjs`, `test/dev-refresh-per-report-epa-guard.test.mjs`
  — pin the **shape** of the write-refusal clause in §2, including its all-or-nothing scope.
- `test/epa-recovery-arming.test.mjs` — pins the arming contract and permission scopes of
  the workflow that can pause the core cron (§1).
- `test/facilities-unavailable-copy.test.mjs`, `test/epa-result-semantics.test.mjs` — pin
  the honest-unknown copy. **These stay valid under the two-plane model** and should be
  preserved: "EPA said nothing" must still never render as "0 facilities".
- Docs of record to amend in the same change: `docs/coverage-state-model.sql`,
  `docs/dev-refresh-epa-probe-guard.sql`, `docs/dev-refresh-per-report-epa-guard.sql`,
  `docs/epa-recovery-rpcs.sql`, and the Map 1 sections of `CLAUDE.md` (which still describe
  the EPA floor as "the national baseline — every ZIP ships at least a facilities view",
  i.e. as core coverage).

---

## 9. Rule-by-rule verdict

| # | rule | verdict | finding |
|---|---|---|---|
| 1 | EPA must not determine ZIP-page completeness | ❌ **FAIL** | §3, §4 |
| 2 | EPA must not determine whether a project record is created/retained/displayed/refreshed | ❌ **FAIL** (refresh) | §2 — refreshes refused wholesale |
| 3 | EPA must not determine project Type | ✅ pass | `resolveTrackerMarker` |
| 4 | EPA must not determine Lifecycle Status | ✅ pass | stage comes from the project record |
| 5 | EPA must not determine pin colour/shape/confidence/counts | ⚠️ **partial** | map is clean; `growth_pressure` uses `_nfc` (§3) |
| 6 | EPA must not block core refresh / monitor / coverage / import / deploy / CI | ❌ **FAIL** | §1, §2, §6 |
| 7 | EPA failures must never fail a core pipeline | ❌ **FAIL** | §1, §2 (engine itself is clean, §7) |
| 8 | EPA failures must never make a ZIP look incomplete/stale/failed | ❌ **FAIL** | §2a — 2,533 of 2,563 unwritten rows |
| 9 | EPA must not be required to render the project map | ✅ pass | render path is EPA-free |
| 10 | EPA must not be required to load/filter/search/interact with project pins | ✅ pass | `siteVisible()` |
| 11 | EPA removable/replaceable without schema migration or core refactor | ❌ **FAIL** | §5 — one `sites` array, one `counts` |
| 12 | EPA separately filterable via the Regulatory Records control only | ✅ pass | shipped 2026-09-06 |

**4 of 12 rules already hold cleanly on the map/render plane. The failures are concentrated
in three places: the refresh guard (§2), the completion/indexable markers (§3, §4), and the
recovery cron switch (§1).**

---

## 10. Shape of the fix (proposed, NOT implemented)

Recorded so the next session does not re-derive it. Each item is a separate reviewable unit.

1. **Split the write.** `dev_refresh_collect` issues two statements: a core write
   (`sites` filtered to project records, `counts.development`, `refreshed_at`) guarded only
   by `dev_failed_sources` / the development-reduction guards; and a regulatory write
   (facility records, `counts.facilities`, `facilities_unavailable`) guarded by `epa_ok` and
   `j->'epa'->>'ok'`. The EPA guard keeps its exact semantics — it just stops reaching the
   core columns. Requires a column-level or array-partitioned representation (§5).
2. **Separate completion states.** `core_project_scan_status` /
   `no_qualifying_projects_found` on the core side; `zip_regulatory_overlay_coverage` with
   its own status and freshness on the overlay side. Retire `facilities_only` from the core
   enum. Recompute `data_quality` and `indexable` from `_nd`/`_ndp`/`_nc` only —
   **note this will move 766 ZIPs out of `pass` and 1,004 out of `indexable`**, which is a
   truthfulness correction, not a regression, and needs to be stated as such in the same
   change so the sitemap/robots delta is not read as an outage.
3. **Cut the cron switch.** `epa_recovery_*` must operate on a regulatory-overlay refresh
   job, never on `dev-reports-rolling-refresh`.
4. **Take EPA off the critical path.** Give `facilitySites` its own hard deadline
   independent of the report, or move the overlay to its own refresh entirely.
5. **Move the tests with the model** (§8), preserving the honest-unknown copy pins.

⚠️ Item 2 changes what residents and crawlers see on ~1,000 pages, and item 1 changes a
guard the founder previously approved twice. Both are founder decisions, not autonomous
work under the §3 standing grant.


---

## 11. PHASE 1 SHIPPED (2026-09-07) — what this audit still describes correctly

Founder authorised Phase 1 only: **A** (remove the EPA-controlled core-refresh switch) and
**B** (split the core project write from the EPA facilities write). Phase 2 —
completion-marker, coverage-state, sitemap, robots, indexing and eligibility changes — was
explicitly deferred and has NOT been done.

| finding | state |
|---|---|
| §1 EPA can pause the core cron | ✅ **FIXED** — `docs/epa-decouple-phase1a-core-cron-switch.sql` |
| §2 EPA refusal blocks the entire core write | ✅ **FIXED** — `docs/epa-decouple-phase1b-split-write.sql` |
| §2a EPA failure renders as core staleness | ✅ **FIXED** — `refreshed_at` is now unconditional on an accepted core write |
| §3 `data_quality` / `indexable` count EPA | ⛔ **OPEN — Phase 2** (766 `pass`-only-by-EPA, 1,004 `indexable` with no projects) |
| §4 `facilities_only` is a core coverage state | ⛔ **OPEN — Phase 2** |
| §5 one `sites` array carries both planes | ⛔ **OPEN** — mitigated in the write (composed per plane), not in the schema |
| §6 EPA latency on the report critical path | ⛔ **OPEN** |

**Rule verdicts that moved:** rule 6, 7 and 8 now hold for the refresh path and the cron path.
Rule 8 still FAILS through §3/§4 (an EPA-only ZIP is still reported `pass`). Rules 1, 5
(partial) and 11 are unchanged and remain Phase 2.

**The measurements in §0 were taken during a real FRS outage and are what justified the fix.**
EPA recovered at 14:15Z the same day (both probes 200), so the post-apply verification exercised
the freshness limb of the same code path; the EPA-down limb is pinned deterministically by
`test/dev-refresh-plane-split.test.mjs`, which is proven load-bearing by three mutations
(reintroduce a facilities predicate into the core WHERE → fails; ungate the overlay clock →
fails; restore an executable `alter_job` in Phase 1A → fails).

Frozen cohort receipt: `public.epa_split_probe_20260907` (80 responding ZIPs, captured before
the first split run).


---

## 12. REVIEW OF PR #1102 — three defects found in the Phase 1 change itself, and fixed

Phase 1 was reviewed at head `d9dfdd8` before merge. The review found one blocking defect and
two required fixes **in the Phase 1 work itself**. All three are corrected; the corrections are
in this branch, and none of them touches production (the migrations are parked, not applied).

### 12.1 BLOCKING — the parked Phase 1B migration was not replayable

`docs/epa-decouple-phase1b-split-write.sql` carried, as *executable* SQL, only the column, the
backfill and `dev_epa_write_refused()`. **Step (d) — the split itself — existed solely as a
commented reproduction**; the only non-comment mention of `dev_refresh_collect` was inside a
`comment on function` string literal.

Replaying that file therefore produced exactly the hazard the file documents: the column
present, the backfill done, and `dev_refresh_collect()` still the OLD all-or-nothing body —
advancing `refreshed_at` without ever maintaining the new clock, and still letting EPA block
core writes. The 67-second window became unbounded, and the replay silently did not deliver
Phase 1B while appearing complete. It also broke CLAUDE.md §1 row 3, whose whole purpose is that
`docs/*.sql` stays reproducible. (Phase 1A never had this problem — both its function bodies are
executable.)

**Fixed:** the file is now a complete, executable, atomic migration — column, backfill,
predicate, the FULL `create or replace function public.dev_refresh_collect()` body, the retained
scoped repair, and post-apply invariant checks, in one script. There is no ordering in which the
column exists while the old body runs.

🔑 **Standing answer: a parked migration that is mostly comments is not a migration.** Park
executable SQL, and make the structural tests read executable statements rather than the prose
around them.

### 12.2 REQUIRED — a malformed `sites` payload could kill the whole refresh batch

The split iterates `j->'sites'`. `jsonb_array_elements` raises `22023: cannot extract elements
from a scalar` on anything that is not an array, which aborts the ENTIRE statement — every ZIP in
the 20-minute window — and re-fails every 2 minutes until the bad response ages out. The
pre-split code assigned `sites = j->'sites'` without iterating, so **this failure mode was
introduced by the split**. The repo has precedent for the blast radius: `commercial_fire_batch`
records collect() exceeding its statement timeout and failing 6 consecutive shared ticks.

**Fixed:** `and jsonb_typeof(j->'sites') = 'array'` at the write eligibility boundary. A
malformed row is withheld — no core write, no facility write, no freshness advanced, no facility
data zeroed — and every other row in the batch proceeds. `jsonb_typeof(NULL)` is NULL and
`NULL = 'array'` is NULL, so a missing `sites` key is withheld too. Deliberately NOT applied to
`d.sites`: steps (a) and (c) already iterate the stored array, so a malformed STORED value is a
pre-existing condition this guard neither creates nor claims to fix.

### 12.3 REQUIRED — the freshness limb cleared `facilities_unavailable` over a stale count

The first Phase 1B build kept the pre-split `facilities_unavailable` expression. That expression
had only ever run on rows where BOTH planes wrote; under the split it also runs on REFUSED rows.
On the **freshness limb** — EPA healthy, legitimately returns 0, row < 7 days old, cached count
> 0 — it evaluated to **false** while the stale cached count was preserved, so the page asserted
as confirmed fact a count EPA had just contradicted. Pre-split the row was not written at all, so
the flag kept its prior "unknown".

Verified by evaluating the shipped predicate and the shipped flag expression on synthetic inputs:
`refused=true, flag_written=false, stored_count = preserved 5`. Measured **0 rows** in that state
at review time (all 90 held rows carried the flag true), but reachable the moment EPA recovers for
a recently-refreshed ZIP.

**Fixed:** the refusal branch now LEADS the expression — if the facility plane took no trusted
write, the stored result is not current and renders as UNKNOWN, never as fact. Reversion is still
a side-effect of the repair: once a refresh stores a real count, `refused` is false and the flag
clears.

### 12.4 What the review verified as already correct

Re-measured during a second live FRS degradation: **299 ZIPs refreshed their core plane in 60
minutes while EPA was unhealthy**, 95 holding the overlay; 0 overlay clocks ahead of core, 0 null
clocks, 0 held-and-zeroed, 0 `counts.facilities` mismatches, 73 core-source failures still
blocking. Composition fidelity on stored data: across 12,444 rows with sites, **0 interleaved, 0
where facilities are not a contiguous suffix, 0 duplicated (zip, registry_id) pairs**. Cron: an
exhaustive scan of ALL non-system schemas found **no function anywhere** that can mutate the core
job. Phase 2 unchanged: `app_refresh_zip` md5 `0cc790b942d391da6de5b37c7ade86a6`, coverage view
md5 `eeb571d626bdaa595fbdfc8dc034718a`, 12,444 pass / 11,708 indexable / 12,722 total.

### 12.5 Logged, NOT fixed

- **The plane discriminator is a convention, not a constraint.** `index.ts:297` is the sole
  emitter of a site-level `registry_id`; core connectors emit `source_registry_id`. If a connector
  ever emitted `registry_id`, its core records would silently migrate into the overlay plane and be
  frozen with EPA. The invariant that catches it — `counts.facilities` = count of registry_id
  sites — held on 0 mismatches of 12,722 but is enforced nowhere.
- **CI cannot detect parked-vs-deployed drift.** The suite drives a JS model and reads parked SQL;
  no assertion touches the deployed function, because CI has no database. Mitigated by recording
  normalized MD5s in the parked file, not eliminated.
- **EPA remains on the report critical path** (`Promise.all`) — Phase 2.


---

## 13. PHASE 1 IS APPLIED IN PRODUCTION — implementation evidence

§11 above was written while the reviewed Phase 1B file was still PARKED. It has since been
applied. This section is the completion record; §11 and §12 stand as the dated account of how
it got here.

### What is live

| item | evidence |
|---|---|
| **A — cron decoupling** | migration `epa_decouple_phase1a_core_cron_switch`. **0** functions in any non-system schema can `alter_job` / `cron.schedule` / `cron.unschedule` the core job. `dev-reports-rolling-refresh` **active**, `*/2 * * * *`. |
| **B — write split** | migration `epa_decouple_phase1b_reviewed_apply_from_bcc0a65`, version `20260907162032`, applied **16:20:32Z**. `dev_refresh_collect` md5 **`bccdb1149f85cc71d31f5e949cb9e47e` → `6fe77ceeb720f3a99a3866734feafc73`** (9,596 → 10,697 chars). |
| **parity with the reviewed file** | the live body, normalized (comments/blank lines stripped, whitespace collapsed), is **`1d2020c1ba7d78bc50d50c53f34c87b9` / 141 lines** — identical to the parked definition in `docs/epa-decouple-phase1b-split-write.sql`. |
| **overlay clock** | `development_reports.facilities_refreshed_at` present; backfilled to `refreshed_at`. |
| **EPA-only recovery still fail-closed** | `epa_recovery_step2` still raises "refusing to start step 2" while EPA is failing; `epa_recovery_proof_check` still records its verdict; `epa_recovery_repair` still raises without a passed proof. None of them touches scheduling. |

### Behaviour observed in production under the applied body

One scheduled cron tick immediately after the apply wrote **69 rows**:

- **57 healthy** — both planes advanced together, 50 carrying facilities, all 57 with
  `facilities_unavailable = false`;
- **12 refused** — all 12 held the overlay clock, retained non-zero facility counts, and kept
  `facilities_unavailable = true`;
- 57 + 12 = 69, exact. **1 tick since apply, 0 failed, no error messages.**

Table-wide at that point (control 12,722 rows): `counts.facilities` disagreeing with the stored
facility-site count **0**; overlay clock ahead of core **0**; null overlay clocks **0**; refused
rows retaining facilities **162 of 162**, zeroed **0**, flag true **162 of 162**.

### Tests

`test/dev-refresh-plane-split.test.mjs` — **62 assertions**, all passing inside the full offline
suite. Mutation-proved: removing the SQL shape guard, removing the model shape guard, reverting
the SQL flag expression, reverting the model flag, commenting out the parked function,
**restoring the old shared gate** (an EPA facilities predicate back in the core `WHERE`), and
**restoring the job-control linkage** (an executable `alter_job` on the core job) each fail the
suite; a clean tree passes.

### ⛔ PHASE 2 IS PENDING PRODUCT / SEO APPROVAL — not started

No completion-marker, coverage-state, sitemap, robots, indexing or eligibility semantics have
changed at any point in Phase 1. Verified against production after the apply: `app_refresh_zip`
still computes `data_quality` as `(_nd+_nf+_nc)>0` and `indexable` as
`… and (_ndp > 0 or _nfc >= 3)`; `app_coverage_states` still carries `facilities_only`;
distribution unchanged at **12,444 `pass` / 11,704 `indexable` / 12,722 total**.

Still open, and each one requires product/SEO sign-off before any work begins:

- **§3** `data_quality` / `indexable` count EPA facilities — correcting this moves roughly
  **1,000 pages out of `indexable`**, a visible sitemap and robots delta.
- **§4** `facilities_only` is a core coverage state and CI pins it to `⇒ pass`.
- **§5** one `sites` jsonb still carries both planes, so rule 11 ("removable without a schema
  migration") is not yet met. Mitigated in the write, not in the schema.
- **§6** EPA remains on the report critical path via `Promise.all([devSites, facilitySites])`.

---

## 14. PHASE 2 · UNIT 1 — BUILT AND PARKED (2026-09-07)

Branch `claude/epa-phase2-unit1-core-completion-markers`. SQL of record:
`docs/epa-decouple-phase2-unit1-core-completion-markers.sql` (executable, atomic, **not
applied**). Pins: `test/epa-phase2-core-markers.test.mjs`, 41 assertions.

**Nothing outward-facing has moved.** Production still stamps `data_quality` as
`(_nd+_nf+_nc)>0` and `indexable` as `… and (_ndp > 0 or _nfc >= 3)`; the sitemap, robots
directives and coverage states are untouched. This unit is a reviewable artifact, exactly
as Phase 1B was between PR #1102 and its authorized apply.

### 14.1 ⚠️ §10 ITEM 2 IS SUPERSEDED ON ITS `data_quality` HALF — the recommendation was wrong

§10.2 says to *"recompute `data_quality` and `indexable` from `_nd`/`_ndp`/`_nc` only"*. The
`indexable` half is right. **The `data_quality` half would cause a product regression, and
it is not recorded anywhere else in this audit, so it would have been implemented.**

`data_quality` is not only a completeness claim. It is the **layout gate** for the community
page — `lib/community-page.js`:

```js
// DATA-QUALITY GATE: only render the full page when the ZIP has real, sourced data.
var status = await HS.data.coverageStatus(zip);   // 'pass' | 'coverage_coming' | null
...
if (status !== 'pass') {   // renders coverage copy + local news ONLY
```

The non-`pass` branch renders neither Development nor the *"Regulated facilities nearby"*
section. So dropping `_nf` from `data_quality` does not merely retitle those pages — it
**stops them rendering real, sourced EPA facility records they hold today**, replacing them
with *"Coverage for this ZIP is being wired."* That is a page that has public records and
claims it has none: the exact class of dishonesty this workstream exists to remove, arrived
at from the other direction.

**Measured from the stored stamps** (one self-consistent read of `app_community_meta`;
`_ndp`, `_nc`, `_nfc` are the values the materializer itself wrote):

| | ZIPs |
|---|---:|
| `app_community_meta` rows | 12,722 |
| `data_quality = 'pass'` | 12,444 |
| `pass` with stamped `_ndp = 0` **and** `_nc = 0` | **766** |
| ... of those, carrying `_nfc > 0` | **766 / 766** |

⚠️ **Instrument note, because two correct numbers disagree.** Recomputing the same question
LIVE from `app_projects` / `app_changes` returns **303**, not 766 — and a third read returns
something else again, because `app_changes` is deleted and reinserted per ZIP refresh and
`_ndp` (parcel-precise) is stricter than `_nd` (all development records). The stamped read is
the stable one and is what is quoted; the live recount measures a moving table. **Name the
instrument with the number.** An earlier statement of "766" in this workstream was taken from
the stamps and is correct as such; it is not interchangeable with a live recount.

### 14.2 What Unit 1 does instead

**`indexable` drops the EPA limb, and nothing else changes.**

```
before   ((_nd+_nf+_nc)>0 and (_ndp > 0 or _nfc >= 3))
after    ((_nd+_nc)>0 and _ndp > 0)
```

Measured from the stored stamps:

| | ZIPs |
|---|---:|
| `indexable` before | 11,704 |
| `indexable` after | 10,699 |
| **leaving the advertised set** | **−1,005** |
| ... sole cause the `_nfc >= 3` limb | **1,005 / 1,005** |
| entering the advertised set | **0** |
| of the 1,005, carrying a `development_reports` row | **1,005 / 1,005** |

*(The audit's earlier "~1,000 / 1,004" was an estimate. **−1,005** is the exact figure, and
the change is strictly a removal — no page is newly advertised by it.)*

**And core completeness gets its own EPA-free markers**, which is what §10.2 was reaching for
and what the founder's own spec named:

| column | values | reads |
|---|---|---|
| `app_community_meta.core_project_scan_status` | `not_scanned` · `projects_found` · `no_qualifying_projects_found` | `_has_report`, `_nd` |
| `app_community_meta.core_records_present` | boolean | `_nd`, `_nc` |

Neither reads `_nf` or `_nfc`. `no_qualifying_projects_found` is a **complete** result, not a
failed one — rule #8 in one value.

🔑 **`_nd`, not `_ndp`, decides the scan status.** A ZIP with area-scope development records
HAS projects; it just has none precise enough to pin. Reporting
`no_qualifying_projects_found` there would be a false negative, and the pin-precision bar
belongs to `indexable`, which is a different question. Pinned by test case 4.

### 14.3 What this changes for residents and crawlers

- **Community / Alerts pages: nothing.** Their robots directive and their sitemap entries
  come from **Rule F** at build time (`scripts/gen_zip_pages.py`), not from `indexable` —
  `gen_zip_pages.py` fetches the column and never reads it (`dev_indexable` is assigned at
  line 227 and referenced nowhere).
- **Map 1 / development pages: 1,005 stop being advertised.** They remain real, reachable
  pages, keep every record they render today including their facilities, and flip to
  `noindex` (`homesignalmap.html` reads the flag live) and out of the sitemap's development
  half (`scripts/gen_sitemap.py::fetch_index_zips`, which `reconcile_sitemap` deliberately
  leaves alone).
- **No rendering changes anywhere**, because `data_quality` is untouched.

### 14.4 Deliberately NOT in this unit

- `data_quality` and its `_nf` limb — §14.1.
- `app_coverage_states.facilities_only` and the CI pin
  `legacy: populated/facilities_only => pass` (`scripts/verify-coverage-state.mjs:64`).
  That assertion stays **true by construction** here, because `data_quality` does not move.
  Reworking the state is **Unit 2**. *(This is why the two cannot be swapped in order: doing
  §3's `data_quality` half first would break that pin by construction.)*
- The single `sites` jsonb carrying both planes — **Unit 3**, rule 11.
- `Promise.all([devSites, facilitySites])` — **Unit 4**.

### 14.5 Six comment sites describe the CURRENT rule and must be corrected in the same change as the apply

Left untouched on purpose: each states what production does today, and editing them before
the apply would make the repo describe behaviour that does not exist yet.

`scripts/gen_sitemap.py:6` · `scripts/gen_sitemap.py:124` · `scripts/verify-development.mjs:140`
· `scripts/gen_zip_pages.py:383` · `homesignalmap.html:1089` · `lib/community-page.js:70`.

### 14.6 Verification

- Offline unit suite: **161 files, all pass** (`node scripts/run-unit-tests.mjs --offline`).
- The new suite is **proven load-bearing by six mutations**, each failing it and each
  restored clean: restoring the EPA limb in the spliced value (2 failures) · deleting one
  anchor-uniqueness check (3) · deleting the reversibility check (2) · moving the backfill
  out of the writer's migration (3) · letting the model read `_nfc` again (2) · reintroducing
  an unreachable draft statement (2).
- The splice is anchored on three strings, **each verified to occur exactly once** in the
  live body (`app_refresh_zip`, md5 `6591d7f79f9a6cd0b476bbcfc2065b9a`, length 19,428), and
  the script refuses to run if any anchor count is not 1. It also proves the splice is
  reversible before executing, and re-reads the stored body afterwards to prove it took.
