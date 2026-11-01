# National source eligibility and report rights: audit and plan (2026-11-01)

**Status: PROPOSAL FOR REVIEW. Nothing here is implemented, deployed or applied.** No production data, no edge
function, no rights file, no test and no registry entry was changed to write this document. It is read-only work
against `main` at `1dfdcbc` plus the open PRs named in §1.4.

**Scope: national.** No state, county or city is special-cased anywhere in the proposed model. Washington, Oregon,
Denton, Douglas County and the rest appear only as measured examples of the current behaviour.

---

## 1. Current state and root cause

### 1.1 What exists

| Piece | File | What it does |
|---|---|---|
| Source connectors | `supabase/functions/get-address-report/jurisdiction-registry.json` | 250 entries. Each one is a connector config: platform, URLs, `column_map`, `status_to_bucket`, coverage, `_receipts`. **No entry holds any rights field** (no licence, no terms URL, no verified date). Measured: the 49 distinct keys used across the 250 entries contain none. |
| Report allowlist | `supabase/functions/_shared/report-rights.json` (version 2) | `cleared[]`, one object per `registry_id`: `cleared_on`, `audit_ref`, `attribution`. 250 entries, all `cleared_on: 2026-10-04`, all `audit_ref: …ruling-r7… §2`. 3 carry a publisher credit line (NYC DOB ×2, Seattle). |
| Generator | `scripts/build-report-rights.mjs` | Builds `report-rights.json` and the R7 ruling's §2 block **from the registry**: every registry id becomes a cleared entry. `PUBLISHER_ATTRIBUTION` holds the 3 credit lines. |
| R7 gate | `test/report-rights-r7.test.mjs` (in the required `unit` check) | 1a/1b: the rights file and ruling block are byte-equal to the generator output. 2a: the registry has exactly `EXPECTED_IDS` (250). 2b: the cleared list equals the registry exactly. 2c: md5 of the ids equals a hard-coded constant. 2d: every entry is dated 2026-10-04 and points at R7 §2. |
| Evidence gate | `test/report-rights-evidence.test.mjs` | Every cleared entry is backed by either a publisher evidence record (the template's seven labelled lines and a quotation) or the R7 ruling (which must quote the founder and say it is a risk acceptance). Shown able to fail on synthetic defects. |
| Runtime | `_shared/national-report.ts` `validateRights` + `assemble` | Used by `get-development-activity-report`, `follow-development-report`, `run-property-watch`. A project whose `registry_id` is not in `cleared` is **dropped from the customer view** and counted in `excluded.no_rights`; the report then carries the limitation `SOURCES_NOT_INCLUDED` ("Some official sources for this area are not included in this report."). The internal view keeps it, marked `HOLD`. |
| Rights audit | `docs/corporate-output-source-rights-audit-2026-09-27.md` | Verdict NOT YET. All jurisdiction-registry sources are HOLD for paid outputs ("no recorded commercial-use grant; empty publisher terms are not permission"). NDDOT `rcrs_dynamic` is EXCLUDE (publisher text forbids commercial use and systematic compilation). |
| Ruling R7 | `docs/development-activity-founder-ruling-r7-2026-10-04.md` | The founder accepted the risk of every registry source appearing in a paid report. Explicitly not a publisher grant; no HOLD is reinterpreted. |

### 1.2 The runtime is already decoupled. The block is in CI.

The edge functions do the right thing: **an uncleared source is simply left out of reports, the report says so, and
the map and ZIP pages are unaffected**. Nothing at runtime would break if a new source were on the map but not in
`report-rights.json`.

The block comes entirely from how R7 was encoded:

1. **R7 was implemented as an identity, not a policy.** The generator defines "cleared" as "is in the registry".
   There is no way to express "this source is on the map but held from reports". Test 2b fails on any difference
   in either direction.
2. **The fingerprint is a hand-maintained constant** (2a, 2c). Adding a registry id changes the md5, so `unit`
   fails until someone edits the constant. The test's own comment says that edit is "a decision ... in a new ruling",
   so every map-source PR needs a founder approval to pass CI.
3. **Removal is coupled too.** Retiring Round Rock (2026-10-20, #2094) needed the fingerprint changed even though
   it cleared nothing.

So: adding a map source = clearing it for paid reports, and the only way to get CI green is a per-source founder
approval. That is the bottleneck, and it is technical coupling, not a rights requirement.

### 1.3 Measured cost

- Since 2026-10-04, **24** commits on `main` changed the registry; **6** of them also had to change
  `report-rights.json` and the R7 test with an in-session founder approval (#1921 Denton ×7, #2094 Round Rock
  removal, #2125 Douglas CO, #2166 Skagit, #2169 WA Ecology SEPA, #2175 Spokane). `git log origin/main`.
- **Open now:** #2487 (Oregon, five sources) edits `report-rights.json` and `test/report-rights-r7.test.mjs`.
  Draft #1846 (Frisco proposed zoning) is titled "not activated, not rights-cleared": a map source that cannot
  merge without a report clearance nobody has decided.

### 1.4 Defects in the current audit trail (found while auditing; not fixed here)

1. **Wrong clearance dates.** 10 sources approved on 2026-10-14 (7 Denton), 2026-10-21 (Douglas CO) and
   2026-10-22 (Skagit, SEPA, Spokane) carry `cleared_on: 2026-10-04` and `audit_ref: R7 §2`. Test 2d forces this.
   Their real approval date and wording exist only in a code comment in `test/report-rights-r7.test.mjs`.
2. **The "dated record, not edited afterwards" ruling has been edited 6 times.** Its §2 block was regenerated by
   each of the commits above. Its header and test 4a say it is fixed; its contents say otherwise.
3. **No per-source terms evidence exists for 247 of 250 sources.** Only NYC DOB ×2 and Seattle have a recorded
   publisher grant. The other 247 rest on R7 or a session approval, which is a risk acceptance, not terms.
4. **Consumer outputs have no recorded eligibility at all.** Map 1, ZIP pages, MAPS/Bluesky posts, email and
   development dossiers display every registry source. The rights audit classifies MAPS and email as HOLD; nothing
   records a decision for the free map. Not changed by this plan (see §5), but recorded.

### 1.5 Protections that are correct and must stay

- Reports are **closed by default**: unlisted = excluded.
- No wildcard and no pattern can clear anything.
- A HOLD is never reinterpreted as cleared; a founder risk acceptance is recorded as one, never as a grant.
- Publisher credit lines travel with the record.
- Stored report snapshots are permanent; property watch reads the rights list *now*, so it follows changes both ways.
- The NDDOT-type exclusion: a publisher that forbids commercial use or systematic compilation is never wired for
  paid use.
- Generated, never typed: the allowlist must never be hand-listed (rule 7/8 of the ingest claims discipline).

---

## 2. Proposed national eligibility model

### 2.1 Principle

Separate three things that are currently one file:

1. **Connector config**: how to read a source (`jurisdiction-registry.json`, unchanged).
2. **Rights evidence**: what the source's own terms say, captured with a date and a hash.
3. **Eligibility decision per use**: computed from (2) by a versioned policy, or recorded by a person.

`report-rights.json` stays exactly where it is, with exactly the shape the three edge functions read today. It
becomes a **generated output** of (2) + (3), so the runtime and its rollback do not change.

### 2.2 Uses (decided separately)

| Use | Meaning | Gate today |
|---|---|---|
| `map_display` | Map 1, ZIP pages, development feeds, linking to the official record | none |
| `report_web` | Paid Development Activity Report on the web, shared report link | `report-rights.json` |
| `report_pdf` | The downloadable / printed report | same file |
| `consumer_reprint` | Email digests, MAPS/Bluesky posts | none (audit: HOLD) |
| `api`, `white_label` | Not built | must default DENY |

Phase 1 **enforces only `report_web` / `report_pdf`**, exactly as now. The others are recorded so the decisions
exist, but not enforced (enforcing `map_display` would change what residents see and is an owner decision, §6).

### 2.3 Per-source rights record

One file per source, `data/source-rights/<registry_id>.json` (one file each so parallel expansion PRs never
conflict on a shared list). Shape:

```json
{
  "registry_id": "seattle-building-permits",
  "publisher": "City of Seattle, SDCI",
  "evidence": [
    {
      "kind": "dataset_license | portal_terms | publisher_grant | publisher_statement | none_found",
      "url": "https://data.seattle.gov/...",
      "captured_on": "2026-09-27",
      "method": "runner fetch | founder email | manual read",
      "text_sha256": "…",
      "verbatim": "the publisher's own words",
      "license_id": "PDDL-1.0 | CC-BY-4.0 | US-PD-17USC105 | NONE_STATED | CUSTOM"
    }
  ],
  "attribution": "City of Seattle, Seattle Department of Construction & Inspections (data.seattle.gov, dataset 76t5-zqzr).",
  "flags": ["prohibits_commercial", "prohibits_systematic_compilation", "prohibits_redistribution", "requires_attribution"],
  "decisions": [
    { "use": "report_web", "decision": "ALLOW", "basis": "publisher_grant",
      "decided_on": "2026-09-27", "decided_by": "evidence", "ref": "docs/corporate-output-seattle-building-permits-2026-09-27.md §…" }
  ]
}
```

A missing file is legal and means **no evidence**: the source is map-eligible as today and report-HELD.

### 2.4 The evaluator (one function, no jurisdiction branches)

`scripts/source-eligibility.mjs::evaluate(record, use, policy) → { decision, basis, reasons[] }` where decision is
`ALLOW`, `HOLD` (excluded, not yet reviewed), `DENY` (excluded, terms forbid) or `REVIEW` (excluded, a person must
look). Order, first match wins:

1. **Recorded human decision for this use** (publisher grant or founder ruling) → that decision. A recorded
   decision is never overridden by a later rule silently; a contradiction goes to step 6.
2. **Any prohibition flag** that covers the use (`prohibits_commercial`, `prohibits_systematic_compilation`,
   `prohibits_redistribution`) → `DENY`. Fixes the NDDOT class generically.
3. **Conflicting evidence** (e.g. an open dataset licence plus portal terms that restrict use; two captures of the
   same terms with different hashes and different meaning) → `REVIEW`.
4. **Stale evidence** (newest capture older than `policy.max_evidence_age_days`) → `REVIEW` for report uses.
5. **A licence on the policy's allow list** (e.g. CC0, PDDL, CC-BY / ODC-BY with attribution, US federal works
   under 17 U.S.C. 105) → `ALLOW`, with attribution required where the licence requires it. **Only licences the
   owner approves in the policy file are on this list** (§6, decision 2).
6. **No terms stated at all** → the policy's default for that use: `map_display` ALLOW (today's behaviour);
   report uses **HOLD** unless the owner adopts a standing class policy (§6, decision 1).
7. Anything else → `REVIEW`.

"Public government record" alone never produces ALLOW (the audit's rule: *"Do not treat 'public record' or an
empty copyright field as a commercial license."*).

The policy is `data/source-rights/policy.json`, versioned, with an id per rule so every computed decision names the
rule and policy version that produced it.

### 2.5 What makes onboarding hands-off

- A new registry entry with **no** rights file passes CI and goes on the map; reports leave it out and say so.
- A runner job (read-only, dispatch and on PR) harvests the machine-readable licence fields every platform already
  publishes: ArcGIS item `licenseInfo` / `accessInformation`, Socrata dataset `license` and `attribution`, CKAN
  `license_id`, OpenDataSoft `license`. It writes the evidence block (verbatim + sha256 + date) and lets the
  evaluator decide. Where the licence is on the approved list it becomes `ALLOW` automatically; prohibitions become
  `DENY`; silence becomes `HOLD`; contradictions become `REVIEW`.
- Only `REVIEW` items, and only if the owner wants them in reports, need a person. They are listed in a generated
  queue (`docs/source-rights/review-queue.md`) with the evidence beside each.

### 2.6 Audit trail

- `decisions[]` is append-only in review (a CI check refuses edits to an existing decision; a change is a new row).
- `cleared_on` in the generated `report-rights.json` becomes the **real** date of the decision that allowed it, and
  `audit_ref` points at that decision (`data/source-rights/<id>.json#decisions[n]` or the evidence doc).
- Each generator run prints a **decision diff**: sources that entered or left report eligibility and the rule or
  decision responsible. A PR that changes the eligible set shows exactly why.
- Dated ruling documents are left exactly as written. New rulings are new files.

### 2.7 Future sources beyond the jurisdiction registry

The same record and evaluator take any source key, so EPA FRS/ECHO, TCEQ, TDLR, Compute Atlas, Epoch, OSM,
government notices and Local News can be added later by key prefix (`registry:`, `dc:`, `epa:`…) without new code.
Phase 1 covers only the jurisdiction registry, because that is all the report reads (development only).

---

## 3. Migration of existing sources

The migration must change **nothing a customer sees**. The test is: the generated set of report-eligible ids equals
today's 250 exactly (fingerprint `ae89c23c9d47ef1ea20eb40732cbb4d4`, sorted in code-point order), and the
credit lines are unchanged.

1. **Grandfather every current clearance as a recorded decision, with its real basis and date:**
   - 3 sources: `basis: publisher_grant`, the existing evidence docs, attribution unchanged.
   - 230 sources in R7's original 240: `basis: founder_ruling`, ref R7 §2, `decided_on: 2026-10-04`.
   - 7 Denton (2026-10-14), Douglas CO (2026-10-21), Skagit, WA SEPA, Spokane (2026-10-22):
     `basis: founder_approval`, `decided_on` the real date, `ref` a new dated record that moves the wording now
     kept only in the test comment into a doc (verbatim, not reinterpreted).
   - Records are **generated** from the current rights file and the test comment, never typed (rule 7); the
     generated set is fingerprinted against the current file (rule 8, `collate "C"`-equivalent code-point order).
2. **Founder rulings are recorded per use:** R7 covered paid reports. It is recorded as `report_web` + `report_pdf`
   ALLOW only. Nothing is inferred for API or white-label.
3. **Harvest evidence for all 250 (read-only, runner).** The evaluator runs, but a grandfathered decision wins
   (step 1 of §2.4). Any source where harvested terms **contradict** the grandfathered ALLOW (e.g. a newly found
   "non-commercial" clause) is listed for the owner. **It is not removed automatically** in the migration; whether a
   contradiction auto-revokes is an owner decision (§6, decision 3).
4. Sources left out by the founder (none today) or retired (Round Rock) need no record.

---

## 4. Implementation plan

Each step is its own PR. None deploys an edge function unless the eligible set changes, and the migration steps
are built so it does not.

| Step | Change | Files | Customer-visible change |
|---|---|---|---|
| 0 | Wait for #2487 (Oregon) to land; then fetch `main` again. It edits the same two files. | none | none |
| 1 | Schema, policy file, evaluator, generator **in new files**, plus a parity check that the new generator reproduces today's `cleared` ids and credit lines exactly. Old generator and R7 test untouched. | `data/source-rights/policy.json`, `scripts/source-eligibility.mjs`, `scripts/build-source-rights.mjs`, `test/source-eligibility.test.mjs` | none |
| 2 | Generate the 250 grandfathered records + the dated record of the 10 later approvals. | `data/source-rights/*.json`, `docs/source-rights-grandfathered-approvals-2026-…md` | none |
| 3 | Cut over: `build-report-rights.mjs` reads the records instead of "every registry id". Replace R7 tests 2a–2d with: generated file = generator output; every cleared id is a registry id; a registry id without a record is report-held and **never fails CI**; the eligible-set fingerprint is computed, and a change prints the decision diff. Keep evidence-test rules for publisher grants. `cleared_on` takes the real dates. | `scripts/build-report-rights.mjs`, `test/report-rights-r7.test.mjs` (replaced by `test/source-eligibility-*.test.mjs`), `report-rights.json` (regenerated: same ids, corrected dates/refs) | none (runtime reads only `registry_id` and `attribution`; verified on a fixture by `assemble` output equality before and after) |
| 4 | Read-only licence harvester on a runner; writes evidence blocks on a branch PR. | `scripts/harvest-source-terms.mjs`, `.github/workflows/harvest-source-terms.yml` (dispatch-only, no secrets) | none |
| 5 | Generated review queue + a daily check that fails when a `REVIEW` item is older than N days or evidence is stale. | `docs/source-rights/review-queue.md` (generated), workflow | none |
| 6 | Owner decisions in §6 applied as policy changes, each its own PR with its decision diff. | `policy.json` | **yes**, and the diff names every source affected |

### 4.1 Tests

Each case uses real captured terms text where one exists, and every rule is proven load-bearing by a mutation that
must fail it (exit code, not FAIL-line count).

- **Allowed:** an approved open licence (CC-BY with required attribution → ALLOW and the credit carried; CC0 →
  ALLOW, no credit); a recorded publisher grant (the Seattle and NYC records reproduce today's credit lines).
- **Restricted:** non-commercial text, systematic-compilation prohibition (the NDDOT quotation), no-redistribution
  → DENY; a DENY source is never in `report-rights.json`.
- **Unknown:** no record → map yes, report HOLD, CI green; `none_found` evidence → HOLD; stale evidence → REVIEW.
- **Conflicting:** open dataset licence + restrictive portal terms → REVIEW; recorded ALLOW contradicted by new
  evidence → listed, not silently changed; two decisions for one use with no later supersession → refused.
- **Structural:** no wildcard or pattern can clear; no jurisdiction, state or `registry_id` literal in the evaluator
  (grep test with positive control); `report-rights.json` passes the unchanged `validateRights`; generated output
  is byte-stable across runs; one-file-per-source means two PRs adding different sources never touch the same file.
- **Parity (migration):** eligible set fingerprint = `ae89c23c…` and credits unchanged at step 3; `assemble` on a
  fixture gives identical customer output before and after.
- **Runtime:** existing `national-report`, `follow-report` and `property-watch` mutant suites still pass.

### 4.2 Rollback

- Steps 1, 2, 4, 5 add files only: revert the PR.
- Step 3: the runtime artifact keeps its shape, so a revert of the PR restores the old generator, the old test and
  the old file. Since the eligible set is unchanged, no edge-function redeploy is needed either way.
- Step 6 (any change to the eligible set): revert the policy PR and redeploy the three functions that import
  `report-rights.json` (`get-development-activity-report`, `follow-development-report`, `run-property-watch`), as
  in R7 §4. Stored snapshots are permanent and are not recalled; property watch follows the file at its next run.

---

## 5. Impact

- **Maps, ZIP pages, development feeds:** no change. They have no rights gate today and none is added in phases
  1–5. `map_display` decisions are recorded but not enforced.
- **Paid reports and property PDFs:** same 250 sources through the migration. After it, a newly onboarded source is
  automatically included **only** if its evidence passes the policy; otherwise it is left out and the report already
  says "Some official sources for this area are not included".
- **Existing report snapshots:** untouched.
- **Property watch:** follows the generated file as now.
- **Geographic expansion work (WA/OR):** after step 3, registry PRs no longer need to touch `report-rights.json` or
  the R7 test. Before step 3, nothing changes for them.
- **Email, MAPS/Bluesky, dossiers, Map 1 data centres:** unchanged; their HOLD status in the audit is recorded, not
  resolved.

---

## 6. Decisions that need the owner

1. **Standing class policy for sources whose terms say nothing (the main one).** Without it, automation can only
   clear sources with an approved open licence or a publisher grant, so most new municipal permit layers will be
   report-HELD by default. Options: (a) keep R7 as a one-time list; new silent sources are HELD until reviewed;
   (b) a new ruling (R8) that accepts the same risk as R7 **as a class rule** ("government development records
   where the publisher states no terms and no prohibition, from the publisher's own host"), which makes them
   auto-eligible; (c) (b) only after a minimum evidence step (terms page fetched and hashed). This is a legal-risk
   decision, as R7 was; counsel was recommended then and that advice stands.
2. **Which licences are on the allow list**, and whether an attribution-required licence is acceptable in the PDF.
3. **What happens when new evidence contradicts an existing clearance:** auto-hold (safer, can shrink reports
   without notice) or flag-and-keep until reviewed.
4. **Whether `map_display` and `consumer_reprint` decisions should ever be enforced** (that would remove records
   from the free map, email or Bluesky where terms prohibit it).
5. **Evidence freshness** (`max_evidence_age_days`) and how often terms are re-harvested.
6. **Whether to correct the 10 misdated clearances in the generated file** (recommended: yes, it changes no
   customer output) and record their approvals in a dated doc.
