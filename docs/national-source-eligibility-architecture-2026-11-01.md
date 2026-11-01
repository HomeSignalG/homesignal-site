# National source eligibility: removing the per-source approval gates — audit and removal plan (2026-11-01)

**Status: steps 1-4 IMPLEMENTED 2026-11-01 (founder "go").** Step 3 differs from §2.2 in one way: no `geometry` field
was added to the registry. The treatment is read from each publisher's own layer metadata when a generation opens
(`scripts/n5_classify_sources.py`), so a registry PR adds nothing new and the 256 existing entries are untouched. A point
layer defaults to RECOVERY (the build re-reads the publisher's point) rather than PROVEN, because PROVEN for a point
layer was historically granted only after the n2a fidelity comparison. The audit text below is as reviewed (written read-only against `main` `1dfdcbc`).

**This replaces the first version of this document** (same file, same PR #2489, earlier commit). That version proposed
per-source terms evidence, a policy evaluator, a class rule and a review queue. The founder's decision below rules all of
that out; none of it is carried forward.

---

## 0. The national policy, as decided

The founder, 2026-11-01, in session (verbatim):

> I have already removed the following two requirements nationally for JODY:
> 1. Requiring verification that source terms are silent or permissive.
> 2. Requiring verification that nothing prohibits commercial use, bulk copying, or redistribution.
>
> Do not reintroduce either requirement through Option B, Option C, a new class-based approval process, or a manual
> exception queue.

The intended architecture, in the founder's words:

- Official government development records enter the national ingestion pipeline without individual owner approval.
- Eligible records flow automatically into JODY maps, feeds, and Development Activity Reports.
- Adding cities, counties, and states does not require changes to a manually maintained source allowlist.
- Obsolete policy gates are removed consistently across code, tests, documentation, and workflows.
- Factual accuracy, source provenance, and record verification are preserved.
- Removal of internal checks is not permission to disregard independently applicable legal or contractual restrictions.

**What "eligible" means after this change.** A record is eligible for a map, a feed or a report when it passes the
**accuracy and provenance** rules that already exist. Who published it is no longer asked as a separate question:

- it came from a source wired in `jurisdiction-registry.json` (it carries that source's `registry_id`);
- `record_kind = 'development'` (the report is development only);
- it has its official record link (`source_ref`);
- it passes the existing record rules: ZIP membership and distance, the fail-closed `status_to_bucket` and type maps,
  the geocode fence, the standing-inventory rule (R3), date sanity, and so on.

None of these is a rights rule, and none of them names a source.

---

## 1. Audit: where per-source approval still lives

Two separate per-source allowlists exist. Each is maintained by hand (or by a generator that refuses to change without a
recorded approval), and each blocks new sources.

### 1.1 Gate A — paid reports: `report-rights.json` + R7

| Piece | File | What it does today | Why it is obsolete |
|---|---|---|---|
| Allowlist | `supabase/functions/_shared/report-rights.json` | 250 `cleared` entries; reports drop any source not listed | It is a manually maintained source allowlist |
| Generator | `scripts/build-report-rights.mjs` | Writes the allowlist and the R7 ruling's §2 block from the registry; holds the 3 publisher credit lines | Exists only to feed the allowlist (the credit lines are kept; §3.3) |
| R7 gate test | `test/report-rights-r7.test.mjs` | Requires the list to equal the registry (2b), pins the count `EXPECTED_IDS = 250` (2a) and a hand-edited md5 (2c), forces every date to 2026-10-04 (2d) | **This is the check that turns `unit` red on every new source until a founder approval is recorded.** |
| Evidence test | `test/report-rights-evidence.test.mjs` | Every cleared entry must be backed by a publisher grant record or by the R7 ruling | Enforces the per-source clearance requirement itself |
| Runtime: new report | `_shared/national-report.ts` `validateRights`, `assemble` | Drops uncleared families (`excluded.no_rights`), adds limitations `NO_INCLUDED_SOURCE` / `SOURCES_NOT_INCLUDED`, marks `HOLD` in the internal view, stamps `rights_registry_version` and `cleared_families` in the report meta | The rights half of report assembly |
| Runtime: changes since report | `_shared/changes-since-report.ts` (`SOURCES_NOT_INCLUDED_SINCE`, `no_rights`) | Same gate for the follow-up view | same |
| Runtime: handlers | `get-development-activity-report`, `follow-development-report`, `run-property-watch` (`index.ts` imports the JSON; `handler.ts` calls `validateRights`) | Fail the request if the allowlist is malformed | same |
| Comments naming the gate | `_shared/property-watch.ts`, `_shared/change-reads.ts`, and the report view's header comment | Describe the rights gate as a step | Stale once it is gone |
| Workflow | `.github/workflows/report-snapshot-suite.yml` | Runs on changes to `report-rights.json` | Path goes away |
| Tests that pass a rights fixture | `national-report`, `national-report-structure`, `national-report-generation-points`, `national_report_mutants.py`, `changes-since-report`, `follow-development-report-structure`, `follow_report_mutants.py`, `property_watch_mutants.py`, `brigham-city-84302-journey`, `launch-location-structure`, `lib/launch-test-location.mjs`, `development-activity-review` | Feed `RIGHTS_NONE`/`RIGHTS_A` fixtures or check the gate | Need their rights inputs and rights assertions removed; their other assertions stay |
| Tests that only forbid the front end from reading rights | `shared-report-page`, `development-activity-reports` | A regex that the page must not mention `report-rights` / `.cleared` | Harmless; simplify when convenient |

### 1.2 Gate B — Map 1: `geo.n5_accepted_source`

`scripts/n5_shard.py` freezes every project with `coalesce(a.treatment, 'UNCLASSIFIED')` from
`geo.n5_accepted_source`. **A source with no row is `UNCLASSIFIED`, and Map 1 draws none of its records** (outcome
`REGISTRY_UNCLASSIFIED`). Every onboarding therefore also needs a hand-written classification migration, and those
migrations record it as an owner approval:

- `docs/n5-oregon-sources-classified-2026-11-01.sql` (open #2487): *"Founder cleared these five on 2026-11-01."*
- the same pattern in `n5-douglas-co-permits-classified-2026-10-21.sql`, `n5-skagit-county-permits-classified-2026-10-22.sql`,
  `n5-wa-ecology-sepa-register-proven-2026-10-22.sql`, `n5-tx-sources-classified-2026-10-20.sql`.

The **treatment value is a real technical fact** and must stay: `PROVEN` (the stored point is the publisher's own
geometry, or a geocode that passed the fence, §7.12b) or `RECOVERY` (a polygon/line layer whose geometry N5 re-reads).
What is obsolete is that the value is typed per source by hand and that its absence hides the source.

### 1.3 Why these block onboarding

The report runtime was already safe: an unlisted source was simply left out and the report said so. The block was in CI
(Gate A, R7 tests 2a–2c) and in the Map 1 build (Gate B, no row means not drawn). Since 2026-10-04, **6 of the 24**
registry commits on `main` had to carry a report approval (#1921, #2094, #2125, #2166, #2169, #2175), and every
recent onboarding also carried a Gate B migration. Open now: **#2487** (Oregon) edits `report-rights.json`, the R7 test
and adds a Gate B migration. Draft **#1846** (Frisco) is stuck as "not rights-cleared".

### 1.4 Not gates (they stay)

These are accuracy or provenance rules, not approvals, and the policy keeps them:
`status_to_bucket` / `type_map` fail-closed vocabularies, `observed_types_unreviewed`, the coverage gate, the geocode
fence, ZIP polygon membership, date sanity, the residential qualification rule, `record_url` required, the standing-inventory
rule, `source-monitor.yml`'s drift checks, and the record-level dossier review (that verifies which records belong to one
project; it is not a source approval).

`geo.n5_accepted_source` rows `NOAUTH`, `HIST_UNRECOVERABLE` and `IDENT_UNRESOLVED` are **record-quality** outcomes (no
usable geometry or identity) and stay; only "missing row = hidden" goes.

Ingest (`homesignal-ingest`) has no per-source rights gate (`report-rights` appears nowhere there).

---

## 2. What replaces each gate

### 2.1 Reports

`assemble` and `changes-since-report` stop reading an allowlist. A development record from any registry source is
included when it passes the existing record rules (§0). Concretely:

- remove `validateRights`, the `cleared` map, `excluded.no_rights`, the internal `rights: CLEARED/HOLD` marker, and the
  `NO_INCLUDED_SOURCE` / `SOURCES_NOT_INCLUDED` / `SOURCES_NOT_INCLUDED_SINCE` limitations;
- **provenance rule kept explicitly (founder, 2026-11-01):** a development row with no known source family is still
  left out, because it cannot be traced to a wired source. It is counted as `excluded.no_source_family`, and the report
  says so in a limitation that names provenance, not rights. The 5 rows that hit this today are restored, not dropped
  (§4.1);
- report meta: drop `rights_registry_version` and `cleared_families` from new reports and bump `REPORT_VERSION`.
  **Stored snapshots are permanent and keep the old fields;** the report view already ignores them (checked: no front-end
  reader).

### 2.2 Map 1

The treatment comes from the registry entry. It is no longer looked up in a hand-filled table:

- add one connector field per entry, `geometry: "point" | "polygon" | "line" | "none"`. It is declared at onboarding with
  the rest of the connector config (it is how the layer is read, not an approval). Point / none → `PROVEN`; polygon /
  line → `RECOVERY`. Existing rows in `geo.n5_accepted_source` are kept and win where present, so nothing already drawn
  moves;
- `geometry` is a required connector field, checked by the same CI that validates registry entries, so no source has an
  unknown treatment. It is filled for the existing 250 from each layer's own service metadata (`geometryType`), read on a
  runner, never typed;
- `UNCLASSIFIED` stops being an outcome; a test fails if any registry source can freeze as it.

### 2.3 Legal and contractual restrictions (the founder's last bullet)

No verification step, no queue and no class rule is added. What is kept is only what is **already known and on file**,
carried as data on the registry entry:

- **Publisher credit lines.** The 3 recorded requirements (NYC DOB ×2, Seattle) move from `build-report-rights.mjs`
  into `supabase/functions/_shared/source-attribution.json`, each naming its evidence file. (Built as a standalone file,
  not a registry field, so registry PRs from the expansion sessions never touch it.) The report functions import it.
  **Absence means "no credit recorded", never "excluded".**
- **A known written prohibition** (the North Dakota DOT work-zone text) is handled the way it is today: that source is
  not wired. That is an onboarding fact recorded in `docs/source-registry.md`, not a check anyone must run.

### 2.4 Tests that stop the gates coming back

New `test/no-source-allowlist.test.mjs`:

1. No file named `report-rights*.json` exists, and no edge function imports one.
2. `national-report.ts`, `changes-since-report.ts` and the three handlers contain no `cleared`, `no_rights`,
   `validateRights` or `SOURCES_NOT_INCLUDED` (comment-stripped, with a positive control that the stripper keeps code).
3. **Behavioural:** a fixture registry gets a brand-new source id that no other file names; a record from it is in the
   customer report, on the generated Map 1 freeze, and in the changes view. Nothing else is edited to make that happen.
4. A record with no known source family, or no `source_ref`, is still excluded (provenance is preserved); a TABS record reaches the report with family `tdlr-tabs`.
5. The attribution file is generated from the registry and has no entries without a credit line.
7. Each superseded document carries the §4.2 notice, and the policy document it names exists.
8. Mutations that must fail it: re-adding an allowlist lookup, freezing an unrowed source as `UNCLASSIFIED`, dropping the
   provenance exclusion, dropping a credit line.

The existing report suites keep every non-rights assertion; only their rights fixtures and rights assertions go.

---

## 3. Removal plan

Each step is one PR. The order matters because of the open expansion work.

| # | Change | Customer-visible effect |
|---|---|---|
| 0 | **Wait for #2487 (Oregon) and any open WA/OR registry PR to merge.** They edit `report-rights.json`, the R7 test and add Gate B rows; this work deletes or rewrites those. Do not edit their branches. | none |
| 1 | **Measure first (read-only, `db-sql.yml`):** every `registry_id` with development rows in `app_projects` vs the registry and vs the current allowlist; every registry id with no `geo.n5_accepted_source` row. Expected: all wired sources already cleared, so step 2 changes no report. Any difference is listed by name before step 2. | none |
| 2 | **Reports.** Remove the gate from `national-report.ts`, `changes-since-report.ts`, the three handlers and `index.ts` imports; add the provenance limitation; stamp the TABS adapter's family `tdlr-tabs` and refresh 78617 so the 5 unnamed rows are restored (§4.1); move the credit lines to the registry plus generated `source-attribution.json`; delete `report-rights.json`, `build-report-rights.mjs`, `test/report-rights-r7.test.mjs`, `test/report-rights-evidence.test.mjs`; update the fixture tests and mutant suites; add `test/no-source-allowlist.test.mjs`; drop the path from `report-snapshot-suite.yml`. Deploy the three functions. | none at cutover if step 1 found no difference; from then on new sources appear in reports automatically |
| 3 | **Map 1.** Add the `geometry` field to the registry (filled from each layer's own service metadata on a runner, never typed); derive the treatment in `n5_shard.py`; keep existing `accepted_source` rows authoritative; test that no source freezes as `UNCLASSIFIED`. Takes effect with the next N5 generation. | sources wired but never classified start drawing (step 1 lists them) |
| 4 | **Documentation.** New dated record of the 2026-11-01 decision (the quotation in §0), cited as the governing policy. Mark as superseded, without rewriting their dated content: the R7 ruling, `docs/source-clearance-evidence-template.md`, the R4/R5 references in `development-activity-*` docs, `docs/development-activity-launch-gate-2026-10-04.md`. Add the superseded notice in §4.2 to the rights audit, the R7 ruling and the clearance template. Update `CLAUDE.md` and the `docs/source-registry.md` onboarding steps: a new source needs only its registry entry (and `geometry`); no rights file, no approval, no N5 classification migration. Remove "Founder cleared" wording from the onboarding pattern. | none |
| 5 | **Tell the expansion sessions** (through the PR descriptions they read): after step 2, registry PRs no longer touch `report-rights.json` or the R7 test; after step 3, no N5 classification SQL is needed. A branch that still edits a deleted file resolves the conflict by dropping that hunk. | none |

### 3.1 Rollback

- Step 2: revert the PR, which restores the allowlist, generator and tests, then redeploy the three functions (as in R7
  §4). Stored snapshots are untouched either way.
- Step 3: revert; the next N5 generation goes back to table-only treatment. Already-active generations can be rolled
  back with the existing `rollback` path.
- Step 4: documentation only.

### 3.2 Impact

- **Maps, ZIP pages, feeds:** unchanged until step 3; then registry sources that were wired but never classified become
  visible.
- **Reports, PDFs, shared reports, property watch:** same output at cutover if step 1 shows no gap; afterwards every new
  registry source is included with no owner step.
- **Stored reports:** immutable, unchanged.
- **Email, MAPS/Bluesky, dossiers, data centres:** they had no source gate, and nothing changes.

---

## 4. Founder answers (2026-11-01) and what they add to the plan

1. **Rows with no source name: keep them out of reports, and restore their source where possible.** The founder's
   words: *"Every Development Activity Report record needs to be traceable to an official government record. But I
   would also have Claude investigate those five records and restore their source associations wherever possible.
   Exclusion should not mean permanently losing valid data."*
2. **The September rights audit: keep it, marked superseded.** *"Preserve it as historical documentation. Clearly mark
   it as superseded by the November 1 national policy, so future Claude Code sessions don't accidentally revive outdated
   approval requirements."*

### 4.1 The five rows, investigated (read-only, production, 2026-11-01)

`app_projects where record_kind = 'development' and registry_id is null`: **5 rows** (the count still matches R7's 5 from 2026-10-04).
All five are the Texas Department of Licensing and Regulation (TDLR) architectural-barrier project registrations (TABS)
at ZIP 78617, i.e. the Caldwell Lane case study:

| source_key | name | type | status | official record |
|---|---|---|---|---|
| `tdlr_tabs:TABS2023006449` | River Bottoms Ranch Barn 2 | animal-facility | Active | `https://www.tdlr.texas.gov/TABS/Projects/TABS2023006449` |
| `tdlr_tabs:TABS2023006483` | Histology Lab | research | Active | `…/TABS2023006483` |
| `tdlr_tabs:TABS2024016698` | Barn 2 ACT Office | commercial | Active | `…/TABS2024016698` |
| `tdlr_tabs:TABS2024022676` | ATX1 New Construction | industrial | Active | `…/TABS2024022676` |
| `tdlr_tabs:TABS2026011928` | ATX1 - Third Floor Tenant Improvement | commercial | Active | `…/TABS2026011928` |

All five were last seen on 2026-10-30 13:00Z, so they are current.

**Cause.** Every registry connector (`arcgis.ts`, `socrata.ts`, `ckan.ts`, `csv.ts`, `carto.ts`) stamps
`source_registry_id` on each record. `sources/tdlr-tabs.ts` is a separate adapter that sits outside the registry, and
it stamps none, so the materializer stores `registry_id = null`. The records themselves are fully traceable: each one
carries its own TDLR record URL, and that URL is required by the adapter. **The source association was never written.
It was not lost.**

**Restoration (added to step 2).**
- Give the TABS adapter a fixed source family, `tdlr-tabs`, written as `source_registry_id` on every site it emits. It
  is the adapter's own identifier, not an approval.
- The report's provenance rule then reads: *a record must carry a known source family (a registry entry, or one of the
  built-in adapters, each of which declares its family in code) and its official record link.* That is a list of the
  connectors that exist, not an allowlist anyone maintains: adding a registry entry adds a family automatically.
- After the engine deploy, refresh ZIP 78617. Check that the five rows now carry `registry_id = 'tdlr-tabs'` and appear
  in a report there. Re-run the step-1 query; the expected count of development rows with no family is 0.
- Test: a TABS fixture record reaches the report with its family set. A record with no family and no record link is
  still excluded.

### 4.2 Superseded notice on the audit (added to step 4)

At the top of `docs/corporate-output-source-rights-audit-2026-09-27.md`, and of the R7 ruling and the clearance template,
add a notice above the dated content. The dated content is not edited. The notice says:

> **SUPERSEDED — 2026-11-01 national source policy** (`docs/national-source-policy-2026-11-01.md`). This document is
> kept as history. It no longer decides what may appear on maps, feeds or Development Activity Reports. Do not
> reintroduce per-source clearance, terms verification, a class approval or a review queue on the strength of it.

A test (`test/no-source-allowlist.test.mjs`, item 7) checks that each of those documents carries the notice and that
the policy document it names exists, so the notice cannot be lost in a later edit.
