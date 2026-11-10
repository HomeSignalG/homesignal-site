# KCMO occupancy records: lifecycle evidence note (2026-11-10)

**Status: investigation only. Nothing here is authorized for implementation.** The KCMO registry filter,
production classification, reports and deployments are unchanged. This note is input for the lifecycle
classification work (`docs/lifecycle-classification-audit-2026-11-01.md`); it does not amend that plan.

Labels used below:
- **[PUBLISHER]**: a definition the City of Kansas City publishes (column description or permit-type label).
- **[OBSERVED]**: a pattern measured in the records listed here. Not a definition.
- **[ASSUMPTION]**: a reading that neither the publisher nor the measurement establishes.

## 0. Provenance

| item | value |
|---|---|
| Dataset | "City Issued Permits", Socrata `w8jz-wjgn`, data.kcmo.org, attribution "City of Kansas City, Missouri" |
| Endpoints read | `https://data.kcmo.org/api/views/w8jz-wjgn.json` (metadata); `https://data.kcmo.org/resource/w8jz-wjgn.json` (SODA queries below) |
| Access path | Postgres `pg_net` (`net.http_get`) from the production database; the session sandbox has no route to data.kcmo.org. All reads were GET; nothing was written except pg_net's own response queue |
| Data last modified | metadata `rowsUpdatedAt` 2026-11-08 07:14:31Z; SODA `X-SODA2-Truth-Last-Modified` Sun, 08 Nov 2026 07:14:26 GMT; metadata "Update Frequency: weekly" |
| Reads | 2026-11-09 (pg_net requests 3053-3063, 3073); 2026-11-10 00:04:29Z (requests 3212-3216) |
| Jody state read | `public.app_projects`, `registry_id = 'kcmo-building-permits'`, at 2026-11-10 00:03:35Z |
| Reuse terms | Licence field reads "See Terms of Use". The page `https://data.kcmo.org/terms` is drawn by JavaScript; its text was **not read and not verified**. The source is already wired under the 2026-11-01 national source policy; no written restriction was seen |
| Query bounds | `issue_date between '2025-11-08' and '2026-11-09'` (12-month counts); `'2025-11-09'..'2026-11-10'` (building status counts and Work Completed); `'2026-01-01'..'2026-11-10'` (expired TCOs); `'2026-09-01'..'2026-11-09'` (commercial CO sample). The dataset carries impossible dates (issue_date up to 3036, finaled_date up to 2323), so every freshness or count figure is read inside a bounded window |
| Registry entry | `supabase/functions/get-address-report/jurisdiction-registry.json`, `kcmo-building-permits`, as on `main` at 425312b |

### Publisher column definitions [PUBLISHER]
`permit_number` "Unique permit ID" · `application_date` "Date of permit application" · `issue_date` "Date
Permit was issued" · `expiration_date` "Date permit expired" · `last_inspection_date` "Last inspection date
(if applicable)". **No description** for `finaled_date`, `permit_status`, `permit_type`, `work_class`,
`project`, `main_parcel_number`, `main_address_line1/2`. No status value is defined anywhere found.

## 1. Semantic conflict

The two texts, verbatim:

- Lifecycle plan, stage table (`docs/lifecycle-classification-audit-2026-11-01.md`, stage table):
  > `operation_established` | evidence that the facility or development itself operates: a certificate of
  > occupancy or final inspection on a permit to build or add to that structure; "In Service" /
  > "Operationally Complete" on a project that builds a new facility (D3)
- Report engine (`supabase/functions/_shared/national-report.ts`, `STAGE_LABELS.occupancy`, national-6):
  > `occupancy: 'Approved for occupancy — business opening not verified'`

**The conflict.** The plan treats a certificate of occupancy as evidence that the facility *operates* and
places it in the stage that maps to Operating now. The report engine treats the same evidence as an
*authorization* and says operation is not verified. One record would read "Operating now" on Map 1 and
"business opening not verified" in a report.

**What a certificate shows.** A CO or TCO is the city's permission to occupy a permitted scope [PUBLISHER:
the permit-type label "Certificate of Occupancy"]. Nothing in the record states that anyone occupies the
structure, that a business opened, or that a facility runs [OBSERVED: no such field exists].

**Proposed distinction, for the lifecycle owners to decide. This note proposes; it applies nothing, and `operation_established` keeps its approved text until a change is approved:**

| proposed stage | evidence | column | wording |
|---|---|---|---|
| `occupancy_authorized` (new) | a publisher CO/TCO, or an agency status that says occupancy was approved | to be decided by the lifecycle owners (Operating now is not assumed) | "Occupancy approved by the city — use not verified"; a TCO keeps "Temporary" and its expiry |
| `operation_established` (**PROPOSED SEMANTIC CHANGE, requires approval**) | the plan's current text, minus CO evidence: a publisher statement that the facility or development operates ("In Service", "Operationally Complete") | Operating now | as the plan says |

**This would amend the existing meaning of `operation_established`, not keep it.** The plan's text today
names "a certificate of occupancy or final inspection" as evidence for that stage. Moving CO evidence out is
a change to an approved definition and needs the same approval as any other change to the plan.

**Unresolved, for the same decision:** where final-inspection evidence belongs. The plan lists it beside the
CO under `operation_established`. A passed final inspection says the inspected work met code; like a CO it
does not say anything operates. The options are to keep it under `operation_established`, to put it with
`occupancy_authorized`, or to give it its own stage. This note does not choose. (KCMO publishes no field that
states a final inspection passed; see section 2 on `finaled_date`.)

If the lifecycle owners prefer to keep CO under `operation_established`, the report label and the plan must
still be reconciled in one decision; the two current texts cannot both stand.

## 2. Existing classification: KCMO "Closed" and "Work Completed" read as Operating now

**Rule** (registry entry `kcmo-building-permits`, `status_to_bucket`):
`"operating": ["Closed", "Work Completed"]`. The entry keeps only `CPPU - Building (Residential|Commercial)`
and `CPPU - Demolition (Residential|Commercial)` permits, issued in the last 365 days.

**Measured, Jody, 2026-11-10 00:03:35Z:** 3,294 stored KCMO permits; **1,243** stored as Operating, every one
of them reported by KCMO as "Closed": Building (Residential) 795, Building (Commercial) 272, **Demolition
(Residential) 122, Demolition (Commercial) 54** (176 demolitions in all). **All 1,243 come from "Closed".**
"Work Completed" is a separate mapped risk, not a demonstrated contributor to that total: it is mapped to
Operating but appears **0** times in the building subset for
`issue_date 2025-11-09..2026-11-10` (status counts there: Issued 2,407 · Closed 1,182 · Open-Active 54 ·
Cancelled 51 · Hold 24 · Suspended 12 · Voided-City 9 · Expired 6 · Issue-Subject-To-Conditions 2 ·
Extended 1 · Ready For Issuance 1 · Revoked 1). Dataset-wide, "Work Completed" occurs 7,444 times.

**Fixtures** (source rows read 2026-11-10):

| permit | type / work class | status | issue | last_inspection | finaled | Jody shows |
|---|---|---|---|---|---|---|
| CPDC-2026-00159, 4250 St John Ave 64123 | Demolition (Commercial) / Complete Building Demolition | Closed | 2026-10-19 | 2026-10-21 | 2026-10-22 | Operating |
| CPBR-2026-02501, 5304 Cottage Ave 64133 | Building (Residential) / Single Family - Interior Remodel | Closed | 2026-10-07 | 2026-10-15 | 2026-10-16 | Operating |
| CPBC-2026-01085, 701 E 63rd St 100, 64110 | Building (Commercial) / Renovation, project "Ritual Pilates on 63rd Street" | Closed | 2026-10-21 | 2026-10-30 | 2026-10-31 | Operating |
| CPBR-2025-02935, 10135 N Poplar Ave 64156 | Building (Residential) / Single Family - New | Closed | 2025-12-29 | 2026-10-23 | 2026-10-24 | Operating |

The last row matters most: on the same parcel (264883), TCO CITO-2026-00421 has status **Expired**
(expiry 2026-10-28), and no CO was found under that parcel number. A "Closed" permit to build therefore
coexists with a lapsed temporary occupancy [OBSERVED]. No permanent CO was found under the queried parcel
number at read time. That absence is the result of one query; it says nothing about whether the house is
occupied or whether occupancy is authorized by some record the query did not reach.

[OBSERVED] On these four, `finaled_date` falls one day after `last_inspection_date`. On five expired TCOs
(section 3) `finaled_date` falls one day after `expiration_date`. Both are consistent with `finaled_date`
being the date the system closed the record, not an inspection result. [ASSUMPTION] that reading is not
established; the publisher does not define the field.

**Conservative replacement (proposed, separate from any new permit type):** apply the approved founder
decisions already in the plan:
- **D5:** "Closed" with no publisher definition → Lifecycle unknown, activity `undetermined`, the agency's
  word "Closed" shown. The generated mapping audit already proposes exactly this for KCMO
  (`docs/lifecycle-mapping-audit/before-after.csv` row 501: `kcmo-building-permits,MO,Closed,Operating,
  operating,unknown,undetermined,receipt,R09 …,445`).
- **D3:** a closed demolition never reaches Operating now; it keeps its last verified column, else Lifecycle
  unknown, and names the work.
- **"Work Completed":** same treatment as Closed until a definition is found (no publisher definition seen).
  It contributes 0 of the 1,243 today; the change is protective, for when it does appear in the window.
- A future publisher definition of "Closed" (e.g. "final inspection passed") would be a receipt that changes
  this per the plan's 3b; none was found.

## 3. CO/TCO fixtures (all source rows, read 2026-11-09/10)

| # | case | record | fields | label |
|---|---|---|---|---|
| F1 | CO, status Issued | CICO-2026-01123, 405 E 13th St 64106, project "Aiden Hotel Downtown KC", parcel 12918 | Certificate of Occupancy (Commercial); Issued; applied 2026-10-29, issued 2026-10-30; finaled/expiry/inspection null | permit type and issue date [PUBLISHER]; null-field pattern [OBSERVED: all 1,261 COs issued 2025-11-08..2026-11-09 are Issued with those three fields null] |
| F2 | TCO, future expiry | CITO-2026-00523, 12301 NE Sherman Rd 64166, project "New Single Family", parcel 98591 | Temporary CO (Residential); Issued; issued 2026-10-27; expires 2026-12-22 | expiry is "Date permit expired" [PUBLISHER] |
| F3 | TCO, expiry passed, outcome unknown | CITO-2026-00432, 10139 N Poplar Ave 64156, parcel 264882 | Temporary CO (Residential); **Expired**; issued 2026-09-10; expired 2026-11-05; finaled 2026-11-06. The building permit on the same parcel (CPBR-2025-02934) still reads **Issued** | no CO found under that parcel number at read time. **Nothing is assumed** about occupancy after expiry: not vacated, not permanently approved |
| F4 | Later CO that may supersede a TCO | parcel 233563, 6009 NE 120th St 64166 | building permit CPBR-2021-00741 Closed, finaled 2022-07-28; TCO CITO-2022-00368 Closed, finaled 2022-07-28 (expiry 2022-08-16); CO CICO-2022-00848 Issued 2022-07-29 | sequence [OBSERVED]; "the CO replaced the TCO" is an [ASSUMPTION]: no field links them. A voided earlier building permit (CPBR-2020-02422) sits on the same parcel |
| F5 | Accessory scope | CICO-2026-01120 "Riverfront Streetcar Station Canopy", 990 E Riverfront Dr Canopy 64120 (issued 2026-11-06); CICO-2026-01088 "Hudson Pointe Decks", 8803 Crystal Ln 64138 (issued 2026-10-29) | Certificate of Occupancy (Commercial), Issued | a CO can cover a canopy or decks, not a new facility [OBSERVED from the project text] |
| F6 | Named tenant, opening not verified | CICO-2026-01091 "Kay Bee's Market Tenant Finish", 11304 Blue Ridge Blvd 64134, parcel 290496, issued 2026-10-21 | Certificate of Occupancy (Commercial), Issued | `project` names the project; it is not a statement that the market opened [ASSUMPTION if read otherwise] |
| F7 | Multiple permits on one parcel | parcel 98591, 12301 NE Sherman Rd 64166 | 14 records: hauling, plumbing (one voided), excavation, water service (3), electrical (2), pre-demolition and complete demolition (2024), building permit for a new single-family house CPBR-2023-02656, mechanical, plumbing, and TCO F2 | parcel ties records to a place, not to one project [OBSERVED] |
| F8 | Recent certificate, building permit outside the 365-day window | F2 (TCO issued 2026-10-27) with CPBR-2023-02656 (Single Family - New, issued **2024-03-18**, last inspection 2026-10-26, status Issued) | Jody's entry windows on `issue_date` (365 days), so it holds neither record | |

Counts for scale [OBSERVED, `issue_date 2025-11-08..2026-11-09`]: CO Residential Issued 924; CO Commercial
Issued 337; TCO Residential Closed 274, Issued 60, Expired 30, Ready For Issuance 29; TCO Commercial Closed
132, Issued 61, Ready For Issuance 16, Expired 12, Open-Active 2, Cancelled 2. "Ready For Issuance" TCOs carry
a `finaled_date` [OBSERVED]; its meaning is not known.

**Address fields:** `main_address_line1/2` and `main_parcel_number` appear to locate the permitted work
[ASSUMPTION; undefined]. Line 1 can carry a scope suffix ("990 E Riverfront Dr Canopy", "8211 NW Milrey Dr
Club House", "2301 Holmes St FL 1"); line 2 can be wrong ("Kansas City, KS 64126").

## 4. Identity and counting

- **A certificate keeps its own source identity:** `source_key = <connector>:kcmo-building-permits:<permit_number>`
  (e.g. `…:CICO-2026-01123`), its own raw status and dates, unchanged.
Every bullet below except the first is a **PROPOSAL**, not a decision. None is built.

- **A certificate keeps its own identity** (stated above): this is how the connector already keys records.
- **PROPOSAL, milestone storage:** a certificate is not a development. It would be stored as a milestone
  record (record kind to be decided with the lifecycle owners).
- **PROPOSAL, count exclusions:** milestone records would be excluded from development counts and ZIP
  development totals.
- **PROPOSAL, map and MAPS eligibility:** milestone records would not be Map 1 project markers and would not
  be eligible for MAPS posts.
- **PROPOSAL, link candidates only.** Same parcel, compatible dates (certificate after the permit's issue)
  and a permit-to-build work class are **candidate-generation evidence**, not proof of a project link. A
  generic work class such as "New Construction" or "Addition" does not establish that the certificate covers
  the same scope as the permit (F5: a CO for decks or a canopy can sit on a parcel with a new-construction
  permit). Matching candidates would be recorded as candidates, with their basis.
- **PROPOSAL, automatic linking needs a separately reviewed disambiguation rule.** No candidate becomes a
  link automatically until such a rule is written, reviewed against fixtures, and approved on its own. Until
  then every certificate stays unlinked.
- **PROPOSAL, unresolved reasons.** When several permits are candidates (F7), when none is held (F8), or when
  scope disagrees (F5), the certificate is kept, unlinked, with a reason (`ambiguous_parcel`,
  `no_candidate_in_scope`, `scope_mismatch`). No link is inferred from parcel alone, and an unlinked
  certificate never changes a development's stage.
- **PROPOSAL, several certificates for one development** (TCO then CO, F4) remain separate records; the later
  one is not assumed to supersede the earlier.

## 5. Proposed change boundary (staged; each stage needs its own approval)

1. **Classification and label correction (no new records).**
   - Decide section 1 (one occupancy stage meaning across the plan and the report engine).
   - Apply D5/D3 to KCMO "Closed" and "Work Completed" through the lifecycle plan's per-source enablement,
     not a KCMO-only branch.
   - Dependencies: the lifecycle plan's switch (`stage_model`) and its §10 release gate; the reconciled
     report label.
   - Dry run on a replica: before/after counts per column for the 1,243 rows, the ZIPs whose counts move, and
     the change-ledger events (a reclassification must not emit "status changed" or property-follow alerts, D7).
   - **Hypothesis to check, not a guaranteed result:** Operating −1,243 and Lifecycle unknown +1,243. Two
     things can make the dry run differ:
     - **Demolitions (176).** D3 says a closed demolition keeps its **last verified column**, else Lifecycle
       unknown. If Jody holds a verified earlier column for a demolition (for example an observation of it as
       Approved before it closed), that demolition moves to that column, not to Lifecycle unknown, and the
       unknown total is lower than 1,243 by that number. Whether such evidence exists, and what counts as
       "verified" for it, was not measured here; the dry run must report the split (to unknown vs to a
       retained column) for the 176.
     - **Drift.** The figures are a 2026-11-10 reading; the 365-day window and KCMO's status updates move
       rows in and out before any run.
2. **Tests.** Fixtures F1–F8 and the four section-2 rows as a frozen file, asserting:
   Closed/Work Completed never give Operating now; a demolition never reaches Operating now; a CO/TCO gives
   only the occupancy-authorized meaning (if section 1's proposal is approved); an expired TCO gives no conclusion about later occupancy; a tenant
   name never gives "open"; certificates never enter development counts; parcel alone never creates a link.
3. **Optional CO/TCO ingestion expansion (after 1 and 2).**
   - Registry: add `CPPU - Certificate of Occupancy` and `CPPU - Temporary Certificate of Occupancy` to the
     entry's filter **and** a way to carry occupancy evidence from `permit_type` (KCMO records it as the
     type, with status "Issued"; the current occupancy rule reads only status words such as "TCO issued").
     Without that, a CO would display as "Permit issued".
   - Storage: the milestone record kind and its exclusion from counts, map and MAPS (section 4 proposals).
   - Dry run: per-ZIP certificate counts; how many link under the section-4 rule vs stay unresolved; payload
     size of the affected reports; geocode outcomes for suffixed addresses.
4. **PROPOSAL, historical links (only if wanted).** The 365-day window means a recent certificate's building permit is
   often older than Jody holds (F8). Options: a bounded look-back read keyed by parcel for permits to build
   (read-only, not a backfill of developments), or leave such certificates unresolved. Dry run: share of
   recent certificates whose qualifying permit falls outside the window.

**Future observations.** The dataset overwrites status in place and keeps no change log [OBSERVED: no
history field]. Jody can record what it observes from the first ingest onward. The certificate's own issue
date is publisher-stated. Dates Jody first saw a record, or saw a status change, are observation dates.
Jody would still not know when a business opened or closed, or when any earlier status changed, and must
not present observation dates as either.

## 6. Out of scope here

No registry edit, no ingestion, no backfill, no report refresh, no deployment. Coordination with the
lifecycle-classification session was attempted; no other session was reachable, so this file is the handoff.
