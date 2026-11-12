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

### 4.3 Close G1: keep history apart from what is displayed now (design; needs its own review)
*Revised 2026-11-12 (founder correction 5): an older assertion is not automatically current.*
- **History** never changes: every observation of every edition stays, as today.
- **Current display** is a separate, explicit rule per case, not "newest run wins" and not "keep
  everything forever":

  | case | history | displayed now |
  |---|---|---|
  | record absent from a newer edition of the same source | kept, with `last_seen_edition` | still shown, labelled "not in the publisher's latest edition (last seen <edition date>)"; never shown as closed |
  | publisher states cancelled / withdrawn / decommissioned | kept | the stated status, with its edition |
  | field changed in a newer edition | both values kept | the newer edition's value, dated to that edition |
  | field missing in a newer edition (absent, not stated as null) | prior value kept | prior value, labelled with the edition that stated it |
  | verified correction from a primary record | Atlas value kept as a superseded assertion | the primary value, with its evidence and the reason |
  | another source lacks the facility | nothing | unchanged; absence elsewhere is never evidence |

- Whether a record absent for many editions should eventually be hidden is a founder decision, not a default.
- Proof: replica dry run (§7.11 shape) with a synthetic smaller edition: 0 records lost from history,
  every display change attributable to one row of the table above.

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

## 4b. Revision 2 (2026-11-12, after the approved read-only inventory A1 and documentation research A2)

### Stored Atlas history (A1, `dc_acquisition_run`, read-only)
- 53 Atlas runs: 47 `SUCCESS_COMPLETE`, 6 `FETCH_FAILED`. The 47 complete runs stored **37 distinct
  files** (distinct `artifact_sha256`), each with its own publisher edition timestamp, from edition
  2026-09-21 (release 1.34.0, 2,087 records) to edition 2026-11-05 18:24 UTC (release 1.35.1,
  3,025 records, 8,764,907 bytes, sha256 `724a6259ed4b…`, read 2026-11-06 09:45:01 UTC, run 2675).
- Record counts mostly grow, but not always: the 2026-09-27 edition has 2,241 against 2,242 the day
  before, and two consecutive pairs have equal counts with different bytes (2,879 / 2,879 and
  2,923 / 2,923). The stored history already contains absences and in-place edits to test on, with no
  new capture.

### Citations in the current Atlas set (A1)
- 3,025 records, all with at least one citation: **9,544 citations, 2,410 distinct domains, 0 without a URL.**
- Publisher's own `kind`: press 4,715 · other 2,994 · osm 691 · permit 473 · filing 440 · subsidy 218 · iso_queue 13.
- By publisher type (domain rules, approximate: two commercial `.us` domains, dcmap.us 24 and edged.us 7, fell
  in the government bucket):

  | type | citations | facilities |
  |---|---:|---:|
  | news, operator and other web | 6,038 | 2,560 |
  | state and local government | 875 | 641 |
  | commercial aggregators (Baxtel 408, DataCenterMap 43, Cleanview 55, others) | 794 | 707 |
  | OpenStreetMap / Nominatim | 691 | 680 |
  | hosted ArcGIS maps | 324 | 320 |
  | PeeringDB | 232 | 226 |
  | press wires | 196 | 160 |
  | SEC | 152 | 115 |
  | EIA / DOE / FERC / EPA | 90 | 66 |
  | utilities | 86 | 65 |
  | ISO / RTO | 8 | 8 |

- 795 facilities cite at least one government record (SEC, federal, state, local or ISO).
- 188 cite only aggregators, OpenStreetMap or PeeringDB.
- Largest state and local domains: puc.sd.gov 30, dceo.illinois.gov 28, maps.puco.ohio.gov 26, mn.gov 26,
  le.utah.gov 20, dwee.nebraska.gov 19, gis.franklincountyohio.gov 19.

### Geography (A1)
- Every record has a state and a point. **44 have no county** (38 of them data centres). They are reported,
  not filled in.
- Types: data_center 2,303 · power_generation 494 · crypto_mining 228.

### Access and licences (A2 and GitHub-hosted files only: the official sites are still refused by the cloud environment's network policy, which allows only jodytracks.com and three phoenix.gov hosts besides package registries)
- **Compute Atlas, read from the publisher's own GitHub files:**
  - The final open edition is frozen at older commits.
  - The live site reads the publisher's database.
  - README: dataset files are "free for students, educators and academics, and by subscription for
    everyone else".
  - `LICENSE-DATA`: CC BY 4.0, "for any purpose, even commercially", with "Attribution — You must give
    appropriate credit, provide a link to this license, and indicate if changes were made… not in any way
    that suggests Compute Atlas endorses you".
  - It also says underlying sources "remain the property of their respective publishers".
  - The `/api/*` routes are admin-only.
  - The subscription terms and robots.txt are UNVERIFIED.
- **PeeringDB** (its Acceptable Use Policy template in its own repository): no reproduction or storage
  "without prior permission"; operational use "would not include… any other commercial application".
  **Not usable without permission.** The 232 Atlas citations to it stay Atlas's compilation; we do not
  refresh them from PeeringDB.
- **OpenStreetMap** (copyright page text in its own repository): share-alike confirmed. It stays a separate layer.
- **UNVERIFIED** (the pages could not be read): Epoch AI, EIA, SEC EDGAR fair access, ERCOT, FERC,
  Good Jobs First, EPA ECHO, and the commercial aggregators.
- **No suitable free replacement has been verified within the research completed so far.** The
  strategy is additive either way.

### Atlas credit: what we change (for review; nothing is changed yet)
- **Stored unchanged:** the original file (sha256-addressed) and every record's `raw_payload`.
- **Our own transformations:**
  - facility type → our classification;
  - matching records across sources into one facility;
  - location checks (geocoding the stated address; withholding town-centre, multi-site or contradicted points);
  - status → our map stages;
  - ZIP assignment;
  - hiding an OpenStreetMap pin that duplicates an Atlas building;
  - choosing which fields to show.
- Current credit strings (`compute_atlas.py` `ATTRIBUTION`, `dc_source.source_name` / `licence`) do not
  say that changes were made.
- Proposed wording, for review only: "Facility data from Compute Atlas by Edward Kubiak
  (compute-atlas.com), edition of November 5, 2026, licensed CC BY 4.0 (link to the licence). Jody Tracks
  has modified it: we classify facility types, combine records from several sources, check and sometimes
  withhold locations, map statuses to our stages and assign ZIP codes. Compute Atlas does not endorse
  Jody Tracks."

### Decision history: what survives a re-run (resolves the contradiction between the two reports)
Both reports were half right.
- **Entities survive.** `dc_canonical_entity` rows are never deleted. A merged entity gets `superseded_by`
  set (step 3A, around line 1189). But `superseded_by` and `supersede_reason` are single columns,
  overwritten when the target changes.
- **Links are overwritten.** `dc_entity_observation` has one row per observation (unique index). A relink
  updates `canonical_entity_id`, `link_rule_key` and `linked_at` in place (around line 1176). Where evidence
  splits back out, no supersession records where it was linked before.
- **Matching decisions are overwritten.** `dc_identity_decision` is upserted on
  `(observation_a, observation_b, candidate_rule_key)`, replacing `decision_state`, `rule_version`,
  `evidence` and `decided_at` (around line 1242).
- **Location decisions are overwritten.** `dc_entity_geography` has one row per entity, upserted
  (step 3B, around line 635).
- **Concrete case:** the Atlas address-check admission (2026-09-26) rewrote **2,240** location rows in place.
  26 entities went from published points to `SOURCES_DISAGREE`, and 22 moved to derived address points. The
  earlier values exist only in that day's one-off snapshots and the receipt
  (`docs/dc-atlas-admission-receipt-2026-09-26.md` §3), not in a history table.
- **Append-only today:** runs, observations, artifacts and `dc_address_geocode`.
- **Proposed fix (needs schema approval):** append-only history tables written by the same statements
  (link, decision, geography), each row carrying rule version and time. Nothing existing changes shape.

### Editions and change events (design)
- **File identity** stays the exact `artifact_sha256`. It is never replaced and no source field is dropped.
- **Content fingerprint v1 (new, versioned separately):**
  - parse the file;
  - sort records by `publisher_record_id` (`collate "C"`);
  - canonical JSON per record: object keys sorted, arrays kept in publisher order.
- **Arrays:** an array may be re-keyed only by a declared rule. `sources[]` is keyed by `url`, and if a
  `url` appears twice its original order is kept. `statusHistory[]` keeps its order. All other arrays are
  order-sensitive.
- **Edition** = a distinct content fingerprint. A repeat download of identical content is the same edition.
- **Field changes** between consecutive editions are computed per record.
  - Volatile fields (`lastUpdated`, `sources[].retrievedAt`, top-level `asOf`) are kept and shown, but
    counted as timestamp-only changes, never as substantive.
  - A record missing from an edition becomes "absent from edition", never a closure.
  - Only `SUCCESS_COMPLETE` runs take part.
- **Four times, never merged:**
  - publisher edition time (`asOf`);
  - our acquisition time (run);
  - event time, only from an explicit dated field such as `statusHistory[].date` or `announcedDate`,
    **otherwise unknown**;
  - when we first observed it (the first edition that carries it).

### Pilot counties (A1 counts are Atlas data-centre records; feeds from the repos)

| county | Atlas DC records | location resolved | our permit sources | gov notices / meetings feeds |
|---|---:|---:|---|---|
| **Maricopa, AZ** (recommended) | 43 | 38 | Phoenix, Mesa, Gilbert, Scottsdale, Tempe, Peoria + ADOT | 1 / 7 |
| **Loudoun, VA** (recommended contrast) | 45 | 44 | residential permits only, plus VDOT | 1 / 7 |
| Clark, NV (alternate) | 32 | 31 | Henderson ×2, Las Vegas planning, Clark active projects + NDOT | 1 / 1 |
| Cook, IL (alternate) | 47 | 43 | Chicago permits, Cook highway program | 1 / 7 |

- **Maricopa** tests updates and discovery where our own permit records are densest.
- **Loudoun** is the densest data-centre county with almost no matching permit coverage. It tests that
  Atlas-only facts survive untouched, and discovery through Board of Supervisors meetings and notices.
- Franklin and Licking, Ohio (23 and 20 records) have no active government feeds, so they are not first.

### Retain / consolidate / close (recommendation; no action taken)

| PR | content | recommendation |
|---|---|---|
| ingest #1105 | Atlas only: a failed read exits 3; a dry run still exits 0 | close, superseded by #1108 |
| ingest #1108 | Atlas and Epoch: a failed read exits 3 after recording; a dry run that would fail exits 3; the probe stops requesting `/api/` | retain |
| site #2832 | freshness reader `map1_datacentre_freshness` + panel, **plus the indexing-pilot baseline** | split: the pilot baseline goes to its own PR, owned by the pilot work; the freshness half closes as superseded by #2838 |
| site #2838 | `dc_source_freshness` reader, three separate dates, popup line | retain |
| site #2844 / ingest #1109 | this plan and the CLAUDE.md rule | plan-only; keep separate from deployable PRs |

#2832 and #2838 edit the same files (`homesignalmap.html`, `lib/dc-freshness.js`), so only one can merge.
Note for approval: with #1108 merged, the Atlas workflow shows red every day while the 404 lasts.

### Acceptance tests (revised; all on disposable databases, each shown failing on today's code where a gap exists)
1. Two identical files → one edition, zero changes.
2. Same records, reordered or reformatted → one content fingerprint, zero substantive changes; both
   files' sha256 kept.
3. Only `lastUpdated` / `retrievedAt` differ → timestamp-only change, zero substantive; values retained.
4. A failed or partial run → zero changes, zero absences, displayed set unchanged.
5. A record missing from a newer edition → "absent from edition", not closed; still displayed with its label.
6. A newer edition stating `cancelled` → displayed status changes; the prior status stays in history.
7. A field present before and absent now → prior value displayed with its edition; never null or zero.
8. An incoming null, blank or "unknown" from another source → never replaces an Atlas value; never stored as 0.
9. A verified primary-source value → displayed under the field rule; the Atlas value stays as a superseded
   assertion with its evidence and the recorded reason.
10. Two disagreeing sources → both stored; the choice and its reason recorded.
11. One field updated → other fields keep their Atlas edition date; no record-level "verified" date.
12. A re-run that changes a match or location → the prior decision is readable in history.
13. An event with no explicit date → event time unknown, never the edition or acquisition time.
14. An application or permit record → displayed as an application or a permit, never as approved,
    built or operating.

## 5. Not authorized by this plan
Retiring, hiding or clearing Atlas data; a wholesale replacement; a destructive migration; merging the
open PRs named at the top; applying any SQL; deploying; changing an ingestion schedule or an alert.
