# Compute Atlas stays live; new data-centre sources are additive — research and implementation plan (2026-11-12)

**Status: PLAN ONLY.** This document approves no merge, no SQL apply, no deploy, and no change to an
ingestion schedule or an alert. Open PRs it refers to (homesignal-ingest #1105 and #1108, homesignal-site
#2832 and #2838) remain unapproved.

## 0. The founder rule (2026-11-12), restated

Keep the existing Compute Atlas data live until a replacement has been verified and explicitly approved.
Its age is not a reason to remove it. For now this is an **additive enrichment** project, not a
replacement or migration.

1. **Preserve the live baseline.** Atlas records, map coverage, populated fields, attribution and evidence
   stay available. They are not retired, hidden or cleared because the upstream feed stopped. The
   publisher's edition date and our acquisition date are shown honestly; continuing to show a record does
   not mean it is current.
2. **New sources add, never erase.** New facilities and evidence go through the existing architecture. A
   source that lacks a field never overwrites a populated field with null, blank, zero or "unknown".
   Absence from another dataset never deletes a facility or implies it closed. Atlas is never replaced
   wholesale by a less complete dataset.
3. **Field-level provenance.** Each assertion keeps its source, evidence and dates. A field only Atlas
   states keeps the Atlas value with its attribution and age. One updated field never makes a whole
   record look freshly verified. Inherited Atlas facts are kept visibly separate from newly collected
   evidence.
4. **Updates and conflicts.** A new, verified value may become the displayed value only under an explicit
   field-selection rule. The previous value and its evidence stay in history. Disagreements are not
   silently overwritten: competing assertions are kept, and the reason one is selected is recorded. A
   verified correction may change what is displayed.
5. **No regressions.** Before any source switch or selection-rule change, compare facility and map
   coverage, populated-field coverage (power, water, land area, investment, jobs, subsidies, status,
   location), attribution and evidence, and historical continuity. Tests must show that an incomplete
   incoming record cannot erase richer existing information.
6. **Replacement is a separate decision.** Free alternatives and direct primary-source collection are
   researched as supplements first. A source is not a replacement because it has more records.

## 1. Where things stand (measured 2026-11-12, read-only, production)

| fact | value | receipt |
|---|---|---|
| Atlas current set | run_seq **2675**, **3,025** observations, publisher edition **2026-11-05 18:24 UTC** | `dc_current_observation` grouped by source |
| Atlas reads since | run_seq 2678 … 2693, every one `FETCH_FAILED`, `advanced_observations = false`, 0 observations | `dc_acquisition_run`, newest 10 rows |
| Cause (from #1108, not re-verified here) | publisher commit `47f126d` removed `data/facilities.json` from `main`; the file answers 404 | ingest PR #1108 |
| Epoch current set | data_centers run 2694 (96), timelines run 2695 (575), both 2026-11-12 | same query |
| Live canonical entities | 3,692 (not superseded) | `dc_entity_observation` ⋈ `dc_current_observation` |
| Entities with current observations from two sources | **4** | same |
| …where Atlas states an operator and the other source does not | **0** | same |
| …where the two sources state different statuses | **0** | same |

**Populated fields in the Atlas baseline (3,025 records, non-empty values in `raw_payload`):**

| field | records | field | records |
|---|---:|---|---:|
| name, status, facilityType, location, operator, sources, confidence, lastUpdated, id | 3,025 each | investmentUsd | 561 |
| notes | 2,902 | aiClassification | 548 |
| statusHistory | 2,076 | generation | 488 |
| energy | 1,514 | jobs | 432 |
| capacityMw | 1,496 | subsidies | 249 |
| landAcres | 1,118 | stakeholders | 211 |
| announcedDate | 869 | poweredBy | 206 |
| community | 820 | mining | 160 |
| water | 758 | notRecorded / environmental / emissions | 120 / 33 / 7 |

This table is the field-coverage baseline the comparison gate in §4.5 measures against.

## 2. What already protects the baseline (keep it)

- **A failed read changes nothing.** `dc_current_observation` (`docs/dc-step3a-canonical-identity.sql` §1)
  is the newest run per (source, distribution) that is both `SUCCESS_COMPLETE` and
  `advanced_observations`. All six failed Atlas reads are excluded, so Map 1 still draws run 2675. This
  is why the 404 has removed nothing.
- **The evidence plane is append-only.** `dc_source_observation` rows, and the preserved artifacts, are
  never deleted. Every earlier Atlas edition is still retrievable.
- **Geography authority is field-level and evidence-based** (§7.12, `dc_site_claims_conflict`). A derived
  address corroborates or contradicts; it never moves a publisher's point by a source rank.
- **The identity guard** (§7.10) refuses to re-resolve while a current observation is unlinked, so a new
  Atlas read cannot blank Map 1 between acquisition and resolution.
- **The pending freshness work** (#2838) shows the edition date, our last successful read and our latest
  attempt as separate dataset-level dates and says no facility was individually checked. That matches rule 1
  and rule 3. It stays unapproved.

## 3. Gaps against the rule (what could still remove or hide Atlas information)

| # | gap | today | why it matters |
|---|---|---|---|
| G1 | **Latest complete run replaces the whole Atlas set.** If Atlas comes back (relocated file, new release) with fewer records or fewer fields, the new run becomes the entire current set and every record missing from it leaves Map 1. | Not triggered: no Atlas run has succeeded since 2675. | Rule 2: absence must not delete; a less complete dataset must not replace Atlas wholesale. This is the largest risk. |
| G2 | **The Map 1 descriptor picks ONE whole observation** for name, operator, lifecycle, address and citation (`docs/map1-dc-publication.sql`, ordered by "states a status", then the geography authority, then `observed_at desc`). An entity matched to a newer, thinner record could display that record's null operator. | 0 entities affected (only 4 multi-source entities; none loses an Atlas field). | Rule 2 and rule 3: field-level selection, never a null overwrite. Latent; grows with every new source. |
| G3 | **A geography conflict withholds the pin.** When a new source's site claim disagrees beyond the allowance, the entity becomes `SOURCES_DISAGREE` and leaves Map 1 (the Atlas admission withheld 26 this way on 2026-09-26). | Working as designed for a real contradiction. | Rule 4 allows a verified correction to change the display, and withholding is not overwriting. But it reduces coverage, so every new admission must report it in the comparison gate (§4.5) before it is applied. |
| G4 | **Rich Atlas fields are stored but not presented with provenance.** capacityMw, water, landAcres, investmentUsd, jobs, subsidies live only in `raw_payload`; nothing reads them per field with source and dates. | Not lost (immutable), not shown. | Rule 3 needs a field-level assertion layer before any second source can contribute these fields. |
| G5 | **No per-record "last seen in edition" date.** Everything carries one dataset date. | Fine while Atlas is the only source of a record. | Needed once G1 is fixed, so a record retained from an older edition can say so. |

## 4. Implementation plan (each step is a separate PR; none is approved by this document)

### 4.1 Freeze the baseline as a receipt (no production change)
- Commit `docs/dc-atlas-baseline-2026-11-05.json`: run_seq 2675, edition date, record count, an
  order-independent fingerprint of `publisher_record_id` (rule 9: `collate "C"` or a commutative sum), the
  field-coverage table above, and the national Map 1 row count from `map1_dc_zip_members` over the 12,745
  registry ZIPs, split by source.
- This is the "before" every later comparison uses. Generated by a script from the database, never typed.

### 4.2 Pin today's protections with tests
- Disposable-Postgres test: a run with `FETCH_FAILED`, a truncated run and a schema-refused run each leave
  `dc_current_observation`, the canonical entities and Map 1 byte-identical.
- These pass today; they exist so a later change cannot weaken them quietly.

### 4.3 Close G1: records absent from a newer release stay current (design; needs its own review)
- Change "current" from *newest complete run per distribution* to *each publisher record's newest
  observation from any complete run of that distribution*, keyed on `(source, distribution,
  publisher_record_id)`. This keeps the duplicate-entity protection §1 of step 3A exists for (one current
  observation per record), and a record missing from a later release keeps its last observation.
- Each such record carries `last_seen_edition` and `last_seen_run`, and the page says "not in the
  publisher's latest edition" rather than nothing. Absence never sets a closed or cancelled status.
- A record the publisher explicitly marks cancelled or withdrawn is a stated fact and is shown as such.
- Proof: replica dry run (§7.11 shape: copy out read-only, change a replica, prove parity) with a
  synthetic smaller release: 0 Atlas records lost from Map 1, 0 populated fields lost.

### 4.4 Close G2 and G4: field-level assertions with an explicit selection rule (design)
- One view, `dc_field_assertion` (entity, field, value, source, observation, publisher edition date,
  acquired date, evidence URL), built from current observations. Null, blank, zero-as-missing and
  "unknown" are not assertions and are never emitted.
- One selection function per field, written down in the DDL of record, in this order: a verified
  primary-source record (a permit, a utility or state filing, a water-rights record) → a newer publisher
  edition that states the field → the existing value. Ties and contradictions keep every assertion and
  record the reason one was chosen.
- The Map 1 descriptor, the development dossier and any report read the selected value through this one
  function. No consumer chooses a field itself (the one-truth-path rule).
- Each displayed field shows its own source and dates. Atlas-only fields read "Compute Atlas, edition
  Nov 5, 2026". A record with one newly verified field does not get a record-level "updated" date.

### 4.5 The comparison gate (required before any source switch or selection-rule change)
A script run on a replica of that day's production, reporting baseline vs candidate:
- facilities and Map 1 rows nationally and per state, added / withheld / moved, every change attributed;
- populated-field coverage for every field in §1, at least: power (capacityMw, energy), water, landAcres,
  investmentUsd, jobs, subsidies, status, location;
- attribution and evidence: every displayed record still has a citation and an official link;
- history: every baseline record still reachable with its earlier values.
- It fails on any loss not explained by a verified correction, and lists each correction with its evidence.

**Tests that must exist before §4.3 or §4.4 ships** (all on a disposable Postgres, run in CI):
1. An incoming record with a null operator does not replace an Atlas operator.
2. An incoming record with capacity 0 or "unknown" does not replace Atlas capacityMw.
3. A release missing a facility does not remove it, and does not mark it closed.
4. A release with fewer fields leaves every Atlas field selected with Atlas attribution.
5. A verified primary-source value replaces the Atlas value, the Atlas value stays in history, and the
   reason is recorded.
6. Two sources that disagree both stay stored, and the reason for the choice is recorded.
7. One field updated by a new source leaves the record's other fields dated to Atlas.
Each test must be shown to fail on the current code where the gap exists (G1, G2), so it is not vacuous.

### 4.6 Research, as supplements (no wiring without the usual source review)
- **Atlas itself:** find out where the facilities file went (another path, a release asset, a new repo).
  Read only paths the publisher allows (ingest branch `modest-goldberg-qlbr72` stops requesting
  robots-disallowed `/api/` paths). A relocated Atlas file is still a new run: it passes §4.5 first, and
  with §4.3 in place it can only add.
- **Free alternatives and primary sources to evaluate, each for coverage, field completeness, freshness,
  provenance and fit with the history system:** Epoch AI (already live), OpenStreetMap (already a separate
  layer, ODbL, never merged), EIA-860/860M for on-site generation, state utility-commission dockets and
  large-load interconnection filings, ISO/RTO interconnection queues, state water-rights records (Utah,
  Idaho, Nevada already loaded), county permit and planning records already on Map 1, and public incentive
  and subsidy disclosures. Each needs its licence read before it is wired.
- News and social posts are leads, never evidence.

### 4.7 Replacement is a separate decision
Not proposed. If one is ever proposed, it comes with the §4.5 report showing the candidate matches or
exceeds Atlas on coverage, field completeness, freshness and provenance, and works with the history
system. Record count alone is not a reason.

## 5. Not authorized by this plan
Retiring, hiding or clearing Atlas data; a wholesale replacement; a destructive migration; merging the
open PRs named at the top; applying any SQL; deploying; changing an ingestion schedule or an alert.
