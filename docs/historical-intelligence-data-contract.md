# HomeSignal Historical Intelligence Data Contract

**Status:** Founder-governed architectural contract  
**Scope:** Development, regulatory, environmental, infrastructure and related longitudinal data  
**Governing rule:** Current product state may change. Historical evidence must survive.

This contract defines the minimum information HomeSignal must preserve so today's product data can become a durable, auditable, multi-year historical intelligence asset. It is intentionally broader than any current report or UI. A field not displayed today may still be required here because future historical analysis, entity resolution, licensing, acquisition diligence or new products may depend on it.

This document does **not** authorize stronger factual claims, new source licenses, new customer copy, or automatic cross-source merges. Existing source-rights, evidence, identity and decision rules still govern.

---

## 1. The asset HomeSignal is preserving

The target model is not a permit table. It is an evidence-backed historical graph:

~~~text
Canonical Project
├── Organizations and roles
├── Parcels / sites
├── Applications
├── Entitlements / zoning decisions
├── Permits
├── Infrastructure / utility dependencies
├── Environmental / regulatory events
├── Construction events
└── Completion / withdrawal / supersession

Every node and relationship:
Observation → Change → Evidence → Date → Source → Rule/Version
~~~

The value is the **time dimension plus the connections**: what HomeSignal observed, when it observed it, what changed, what source supported the change, and how separate records were proven to concern the same real-world development.

---

## 2. Non-negotiable preservation rules

1. **Raw/source-native evidence survives.** Preserve source-native identifiers, values and evidence needed to reconstruct the observation. A normalized value never replaces the publisher's value.
2. **Observations are immutable history.** A later observation may supersede the current view but must not rewrite what HomeSignal previously observed.
3. **Change events are append-only.** Preserve before/after facts and the fields that changed.
4. **Retrieval is not real-world change.** Collection timestamps, parser changes, classifier changes, ZIP rematerialization and technical metadata changes are not development events.
5. **Absence is not a status.** A missing record, failed source, outage or source retirement is not withdrawal, cancellation, completion or deletion unless the publisher provides evidence for that event.
6. **Archive is a product state, not data destruction.** An inactive/removed project may disappear from customer-facing current views while its history remains preserved.
7. **Identity is evidence-backed.** Never merge records into one real-world project merely because names, addresses, coordinates, owners or timing look similar. Record the evidence and decision.
8. **Identity decisions are reversible without deleting evidence.** Correct a wrong merge/split through supersession or decision history, not destructive edits.
9. **Derived classification is versioned.** Preserve the rule/version that produced HomeSignal Type, lifecycle, event class or other derived facts.
10. **Source rights travel with the data.** Do not detach data from its source-rights and redistribution status.
11. **No cleanup may sacrifice longitudinal value.** If a storage, archive, dedupe or migration proposal would collapse or delete historical evidence, STOP and surface the conflict.

---

## 3. Required object types

HomeSignal must be able to represent these objects separately even when today's product collapses them into one card or marker.

### 3.1 Canonical project

A HomeSignal-minted immutable identifier for the real-world development **once sufficient evidence exists to establish that identity**.

Required minimum fields:

- canonical project ID
- created_at
- current canonical state
- superseded_by / split_from / merge decision references when applicable
- identity confidence/state
- identity rule/version
- first observed date
- last observed date
- active/inactive/archive product state
- source-record membership count
- project Type history reference
- lifecycle history reference

A source record ID is **not** the canonical project ID.

### 3.2 Source record

One publisher-defined record that can persist across acquisitions.

Required minimum fields:

- source family / registry ID
- publisher record ID or durable HomeSignal source key
- key basis
- source-native title/name
- source-native Type/class
- source-native status/stage
- source-native event/date fields
- source-native address / parcel / site identifiers when available
- source URL / record URL
- source observation timestamp
- raw or reproducible evidence reference
- rights metadata reference
- parse/version metadata

### 3.3 Organization

An organization may play different roles over time: owner, applicant, developer, architect, engineer, general contractor, subcontractor, operator, parent company, utility, and lender/financing counterparty where publicly supported.

Required relationship fields:

- organization identity
- project/source-record identity
- role
- valid/observed time
- evidence
- source
- relationship rule/version
- confidence/state

Do not overwrite one organization with another when the role changes; preserve both relationships and dates.

### 3.4 Parcel / site

Required when the source provides parcel or site evidence:

- parcel/APN/source parcel identifier
- address
- geometry or coordinates with source/precision
- acreage when stated
- jurisdiction
- project relationship
- observed/valid dates
- evidence/source

Parcel assemblage must be representable as a sequence over time, not only a current parcel list.

### 3.5 Applications, entitlements and zoning

Preserve distinct records/events such as rezoning applications, variances/special exceptions, site-plan applications, subdivision/plat applications, planning commission actions, published staff recommendations, governing-body decisions, appeals, conditions, extensions/expirations, and explicit denials/withdrawals.

Required facts include source-native case number, status/stage, filing date, decision date, conditions and the relationship to the canonical project where proven.

### 3.6 Permits

Preserve the permit lifecycle, not merely the latest permit status:

- application
- review/revision
- issuance
- amendment
- suspension/revocation
- inspection
- certificate of occupancy / equivalent
- closeout/completion

Required facts include permit ID, permit class/type, source-native status, dates, scope, valuation/size when stated, address/parcel/site relationship, organizations and evidence.

### 3.7 Infrastructure / utilities

Where publicly available and rights permit, preserve project-linked evidence such as electric interconnection requests, substation/transmission upgrades, water service/capacity, wastewater/sewer capacity, road/intersection improvements, fiber/telecom infrastructure, gas/pipeline infrastructure, and other enabling infrastructure.

Store the infrastructure record as its own object and link it to the project only when the relationship is evidenced.

### 3.8 Environmental / regulatory

Environmental/regulatory records are first-class historical objects, not decorative map overlays.

Preserve, where sourced and permitted:

- environmental permit applications/issuances
- air permits and emissions-related actions
- water discharge / NPDES records
- stormwater permits/actions
- wetlands-related actions
- hazardous-waste records
- spills/releases
- soil/groundwater/water contamination findings
- inspections
- violations/notices
- formal enforcement
- fines/penalties
- remediation
- resolution/closure
- water withdrawal/use records where relevant

Required facts:

- regulator/source
- regulatory/facility identifier
- event/record identifier
- source-native event type/status
- event date
- pollutant/media/program where stated
- amount for penalties where stated
- facility/site/project relationship
- evidence URL/reference
- observation timestamp
- rights metadata
- relationship evidence and rule/version

**Proximity alone does not prove that an environmental event belongs to a project.**

### 3.9 Construction / completion

Preserve sourced evidence for groundbreaking, construction started, inspections/progress milestones, phased construction, temporary/final occupancy, completion, partial completion, explicitly evidenced abandonment/withdrawal, and restart.

Do not infer 'construction started' from an approval or permit unless the source itself supports that claim.

---

## 4. Required observation envelope

Every retained observation should be able to answer:

| Question | Required field/concept |
|---|---|
| What did we observe? | source-native facts / evidence reference |
| Which publisher record? | source + durable record identity |
| Which real-world entity? | canonical entity/project link, if proven |
| When did the publisher say it happened? | publisher event/date field |
| When did HomeSignal observe it? | observed/retrieved timestamp |
| Where did it come from? | source/record URL and source registry |
| What are we allowed to do with it? | rights/licensing metadata reference |
| How was it parsed? | parser/schema/version |
| How was it classified? | derivation rule/version |
| What changed from the prior observation? | prior/new facts + changed fields |
| Why are two records linked? | identity/relationship decision + evidence |

If one of these is unavailable, store **unknown/not provided**, not an invented value.

---

## 5. Required change-event contract

A historical event must preserve:

- stable source-record identity
- canonical project/entity ID when established
- event type
- material/non-material classification
- prior facts
- new facts
- changed fields
- previous fingerprint
- new fingerprint
- observed_at
- publisher event date/type
- source ID
- evidence reference
- derivation version
- facts/schema version
- run/acquisition reference
- rights reference

Current dev_change_event is the existing Development Activity foundation. This contract extends the preservation requirement; it does not redefine that table's current event vocabulary.

### Stronger event vocabulary

Events such as approved, permit_issued, construction_started, completed, withdrawn, violation, fine or remediation_complete may be introduced only when a reviewed source-specific mapping or direct publisher evidence supports the claim.

No generic keyword guess may create a stronger historical event.

---

## 6. Identity and lineage contract

HomeSignal needs two different identity layers:

### Layer A — durable source-record identity

Answers: **Is this the same publisher record we observed before?**

Examples: publisher case number, permit number, regulator facility ID, source-controlled project number.

### Layer B — canonical real-world project identity

Answers: **Do these separate source records concern the same real-world development?**

Potential evidence includes source-provided parent/child/case references, exact parcel identifiers, explicit permit-to-application references, official project/case numbers reused across agencies, explicit site-plan/permit links, uniquely identifying site address plus corroborating evidence, and source-provided organization/project relationships.

Rejected as sufficient **by themselves**:

- same or similar project name
- nearby coordinates
- same ZIP
- same developer
- similar timing
- same street without corroboration

Every canonical-link decision must preserve:

- records/entities considered
- decision state
- evidence
- decision rule key
- rule version
- decision timestamp
- superseding decision if later corrected

A wrong merge must be repairable without deleting either record's observations.

---

## 7. Project scope history

The historical asset must preserve scope changes, not only lifecycle changes.

When sourced, retain residential units, square footage, floors/stories, acreage, building count, land-use mix, MW/capacity, project valuation/investment, parking, domain-specific scale such as rooms/beds/seats, and start/end/completion estimates.

A change from 800 units to 1,200 units is a historical event even if the lifecycle stage did not change.

---

## 8. Failure, delay and dormancy

Keep explicit publisher evidence distinct from HomeSignal-derived inactivity.

Publisher-evidenced events may include denied, withdrawn, revoked, expired, appealed, stopped, cancelled and restarted.

Derived analytical states may include no observed publisher change for N months, no new permit activity observed, or likely dormant.

Derived states must be labeled as HomeSignal analysis, versioned, and must never overwrite or masquerade as publisher facts.

---

## 9. Source-rights and provenance contract

Every source family should have a durable rights/provenance record containing, where available:

- source/publisher name
- owning agency/company
- source URL
- terms/license URL
- access method
- date terms were reviewed
- commercial-use status
- redistribution status
- bulk/API restrictions
- attribution requirements
- raw-data retention status
- transformed/derived-data status
- internal legal/review notes
- current rights classification

If rights are unclear, store **UNCLEAR/HOLD** or the governing existing classification. Do not infer permission from public accessibility.

Historical data must remain traceable to the rights state under which it was acquired and used.

---

## 10. What must remain private by default

Unless a deliberate product/licensing decision says otherwise, do not expose the full internal asset through the public site or unauthenticated API.

Private-by-default components include:

- complete historical observation warehouse
- canonical project graph
- cross-source identity decisions
- matching heuristics/rules
- classification mappings
- confidence/evidence internals
- bulk historical exports
- proprietary derived scores/models
- source-by-source internal rights analysis

Customer-facing products may expose selected facts, events, reports, alerts or licensed extracts without exposing the internal methods or complete historical graph.

---

## 11. Retention and archive contract

### Permanent-history class

Unless a specific legal/source-rights obligation requires removal, preserve indefinitely:

- historical observations
- change events
- identity decisions
- canonical IDs and supersession history
- relationship history
- source provenance
- rule/version metadata

### Operational/current-state class

May be replaced or regenerated when safe:

- current materialized views
- page caches
- ZIP copies
- derived current-state indexes
- report renderings

A cleanup may delete a regenerable current-state object **only when** the permanent-history representation is proven intact.

---

## 12. Backup / disaster-recovery requirement

Treat longitudinal history as harder to replace than the website.

The production design should support:

1. normal database backup;
2. periodic immutable/offsite snapshots of permanent-history tables;
3. documented restore testing;
4. schema/version inventory;
5. row-count and integrity reconciliation after restore;
6. preservation of source-rights/provenance metadata with the restored history.

The exact provider, cadence and retention period are operational decisions, but a backup strategy that can restore current product state while losing years of longitudinal observations is insufficient.

---

## 13. Current implementation mapping

Existing pieces that already satisfy part of this contract:

- dev_change_project — current durable Development Activity source-record state
- dev_change_event — append-only before/after Development Activity change history
- dev_change_run — observation-run audit
- dev_change_zip_cursor / dev_change_tick — national observation mechanism
- data-center dc_source_observation — immutable source observations
- data-center dc_canonical_entity — HomeSignal-minted canonical entity
- data-center dc_entity_observation — observation-to-entity evidence
- data-center dc_identity_decision — auditable identity decisions

Known gaps this contract intentionally exposes:

- universal canonical project ID across Development Activity
- cross-record lineage from application → approval → permit → construction
- generalized organization/project relationship history
- parcel-assemblage history
- project-linked infrastructure history
- project-linked environmental/regulatory event lineage
- stronger source-supported lifecycle event vocabulary
- formal immutable/offsite historical-backup policy

These are gaps to build deliberately; they are **not permission to shortcut evidence or identity rules**.

---

## 14. Acceptance test for every future data change

Before approving a schema, ingest, cleanup, archive, dedupe or migration, answer all of these:

1. Can we still reconstruct what the source said at an earlier observation?
2. Can we distinguish publisher facts from HomeSignal-derived facts?
3. Can we explain exactly what changed?
4. Can we trace the change to evidence and a source?
5. Can we identify the rule/version that produced a classification or relationship?
6. Can we undo a wrong identity decision without deleting evidence?
7. Does customer-facing archival leave historical lineage intact?
8. Are source rights/provenance still attached?
9. Does this preserve future ability to connect project → organizations → parcels → applications → entitlements → permits → infrastructure → environmental/regulatory events → construction → completion?
10. If the current product database disappeared tomorrow, would the irreplaceable longitudinal history still be recoverable?

If any answer is **no**, the change is not compliant with this contract. STOP and surface the conflict.

---

## 15. Governing principle

> **Collect for the historical asset, not only for today's screen.**

A future developer must not omit durable identity, source-native evidence, dates, relationships, provenance or versioning merely because the current UI does not display them.

**Current product state may change. Historical evidence must survive.**
