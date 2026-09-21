# STEP 2 — the database contract for ingesting Compute Atlas AND Epoch AI losslessly

**CONTRACT DESIGN ONLY. NOT APPLIED. NO PRODUCERS. NO MAP 1 / MAPS / GEOGRAPHY CHANGE.**

Deliberately a `.md` and not a `.sql`: `db-sql.yml` dispatches a committed `.sql` path, so a
parked `.sql` is one dispatch away from being applied. The DDL below is inline, verbatim, and
cannot be executed by any existing workflow.

Locked inputs (CTO ruling, source research closed, do not re-derive):
* **ATLAS** = national discovery + physical location + lifecycle + coverage.
* **EPOCH** = AI/hyperscale significance + compute/capacity intelligence + facility evidence + detailed timeline.
* Both are required ACTIVE production ingest feeds (activation is NOT claimed in Step 2).
* **An Epoch observation MUST NOT require a pre-existing Atlas/local/OSM entity.** Epoch may
  create evidence for a CANDIDATE or UNRESOLVED entity. Epoch may NOT promote an entity to a
  resident-facing confirmed facility from mutable Name/Address/Owner alone.

Measured inputs this contract is shaped around (Step 1 receipts):
Atlas 2,025 records / 2,025 unique ids / 2,025 coordinates / 2,025 status / 2,025 confidence /
6,073 typed citations all carrying `retrievedAt` / 1,209 dated statusHistory / 420 non-data-centre
records. Epoch 86 rows / 16 columns / **no id, no coordinates, no status column** / 11 countries /
500 timeline observations over 86 centres / 481 distinct free-prose construction narratives /
Selected Sources 86/86 / Calculations sheet 86/86. Overlap 86 = 11 non-US + 75 US, and the 75 =
64 distinct Atlas match + 5 campus-present-building-absent + 3 absent + 3 unresolved. 7 of 61
automatic assignments picked the WRONG SIBLING.

---

## 0. Placement, ownership, exposure

All tables in `public`, named exactly as the ruling names them (`dc_*`).

* **RLS ENABLED on every table. No `anon` and no `authenticated` grant.** These are not
  resident-facing and must not become so by omission — the `public.page_cache` posture is the
  named anti-pattern in this repo.
* **WRITE OWNER:** `service_role` only, exercised by the (future) acquisition worker and by
  review tooling. Nothing in the browser ever writes here.
* **READERS in Step 2:** `service_role` and the founder review surface. **Zero resident-facing
  readers.** Map 1, MAPS, `app_projects`, `development_reports`, `geo.*` are untouched.
* Alternative considered and rejected: a dedicated `dc` schema outside PostgREST's exposure.
  Safer by default, but it renames every table away from the ruling's literal names. Chosen:
  `public.dc_*` + RLS + no grant, which reaches the same posture explicitly rather than by
  schema accident.

---

## 1. `public.dc_source` — the source registry

**PURPOSE.** One row per external source. Holds the expectations an acquisition run is judged
against, so `SUCCESS_COMPLETE` is a comparison and not an opinion.

| column | type | notes |
|---|---|---|
| `source_key` | `text` PK | `compute_atlas` \| `epoch_ai_data_centers` \| `epoch_ai_timelines` |
| `publisher` | `text NOT NULL` | |
| `distribution_url` | `text NOT NULL` | |
| `licence` | `text NOT NULL` | `CC BY 4.0` on all three |
| `supplies_publisher_record_id` | `boolean NOT NULL` | Atlas true, Epoch **false** |
| `supplies_geometry` | `boolean NOT NULL` | Atlas true, Epoch **false** |
| `supplies_lifecycle_status` | `boolean NOT NULL` | Atlas true, Epoch **false** |
| `supplies_release_identity` | `boolean NOT NULL` | Atlas true (`version`/`asOf`), Epoch **false** |
| `geocoding_enabled` | `boolean NOT NULL DEFAULT false` | gate for §11; **false for both in Step 2** |
| `expected_schema_fingerprint` | `text` | sha256 of the sorted field set last accepted |
| `expected_min_records` | `int NOT NULL DEFAULT 1` | a floor below which a run is PARTIAL, never SUCCESS |
| `not_seen_vocabulary` | `text NOT NULL` | `SOURCE_RECORD_NOT_SEEN` \| `NOT_OBSERVED_IN_CURRENT_RELEASE` |
| `schedule_cron` | `text` | NULL until scheduled |
| `active_state` | `text NOT NULL DEFAULT 'NOT_ACTIVE'` | `NOT_ACTIVE` \| `ACTIVE` |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

* CHECK `not_seen_vocabulary IN ('SOURCE_RECORD_NOT_SEEN','NOT_OBSERVED_IN_CURRENT_RELEASE')`
* CHECK `active_state IN ('NOT_ACTIVE','ACTIVE')`
* CHECK `active_state = 'NOT_ACTIVE' OR schedule_cron IS NOT NULL`
* **RETENTION:** permanent, 3 rows expected. **WRITE:** migration + founder. **READ:** service_role.

Seeded rows are **NOT_ACTIVE**, `geocoding_enabled=false`, `supplies_*=false` for Epoch. The
`supplies_*` flags are the load-bearing half: every "Epoch must not pretend to have an id /
coordinates / a status" rule below is enforced against these flags rather than against a
hard-coded source name.

---

## 2. `public.dc_acquisition_run` — every attempted acquisition

**PURPOSE.** Represent every attempt, successful or not, so that an absence is never
indistinguishable from a failure. **Only `SUCCESS_COMPLETE` may advance source observations.**

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK `DEFAULT gen_random_uuid()` | |
| `source_key` | `text NOT NULL` FK → `dc_source` | |
| `run_seq` | `bigint GENERATED ALWAYS AS IDENTITY` | monotonic ordering independent of clocks |
| `trigger` | `text NOT NULL` | `scheduled` \| `manual` \| `backfill` |
| `started_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `completed_at` | `timestamptz` | NULL while in flight |
| `request_url` | `text NOT NULL` | |
| `request_method` | `text NOT NULL DEFAULT 'GET'` | |
| `http_status` | `int` | NULL = never completed |
| `transport_error` | `text` | verbatim |
| `artifact_bytes` | `bigint` | |
| `artifact_sha256` | `text` | 64 hex |
| `artifact_media_type` | `text` | |
| `artifact_ref` | `text` | storage pointer; the blob is never a column |
| `source_release_identity` | `jsonb NOT NULL DEFAULT '{}'` | Atlas `{"version":"1.33.0","asOf":"…"}`; Epoch `{}` |
| `source_release_key` | `text` | publisher-stated release key, **NULL when none** |
| `content_release_key` | `text` | `= artifact_sha256`; the release identity when the publisher gives none |
| `parser_key` / `parser_version` | `text NOT NULL` | |
| `schema_fingerprint` | `text` | observed field set |
| `records_seen` / `records_parsed` / `records_rejected` | `int` | |
| `completeness_state` | `text NOT NULL` | the 8-value vocabulary |
| `failure_detail` | `jsonb` | |
| `source_declared_freshness` | `timestamptz` | what the publisher says |
| `observed_freshness` | `timestamptz` | newest record date actually seen |
| `advanced_observations` | `boolean NOT NULL DEFAULT false` | |
| `notes` | `text` | |

**`completeness_state` vocabulary (closed):**

| state | meaning | may advance observations |
|---|---|---|
| `SUCCESS_COMPLETE` | fetched, parsed, schema unchanged, record floor met | **YES — the only one** |
| `SUCCESS_ZERO` | fetched and parsed cleanly, publisher returned zero rows | no |
| `PARTIAL` | parsed fewer than `expected_min_records`, or paging stopped early | no |
| `TRUNCATED` | body hit a byte ceiling or a declared count ≠ records seen | no |
| `SCHEMA_CHANGED` | `schema_fingerprint <> expected_schema_fingerprint` | no |
| `PARSE_FAILED` | bytes arrived, parser refused them | no |
| `FETCH_FAILED` | non-2xx or transport fault | no |
| `STALE_SOURCE` | fetched fine, `observed_freshness` past the source's staleness bar | no |

Constraints:
* CHECK `completeness_state IN (…the 8…)`
* CHECK `completeness_state <> 'SUCCESS_COMPLETE' OR (http_status = 200 AND artifact_sha256 IS NOT NULL AND records_seen > 0 AND records_parsed = records_seen AND schema_fingerprint IS NOT NULL)`
* CHECK `completeness_state <> 'SUCCESS_ZERO' OR records_seen = 0`
* CHECK `completeness_state <> 'FETCH_FAILED' OR (http_status IS NULL OR http_status >= 400)`
* CHECK `advanced_observations = false OR completeness_state = 'SUCCESS_COMPLETE'`
* CHECK `completed_at IS NULL OR completed_at >= started_at`
* UNIQUE `(source_key, run_seq)`
* INDEX `(source_key, started_at DESC)`, `(source_key, completeness_state, completed_at DESC)`, `(source_key, artifact_sha256)`

**RETENTION:** append-only, permanent. A run row is never updated after `completed_at` is set
(trigger enforces). **WRITE:** acquisition worker (`service_role`). **READ:** service_role,
health views.

> ⚠️ **The 64,000-byte observation has a home here.** Five independent fetches of
> `data_centers.csv` returned **exactly 64,000 bytes** while `data_center_timelines.csv` returned
> 164,227. `TRUNCATED` exists precisely so that a suspicious round byte count can be recorded and
> refused rather than silently accepted. The Step-3 parser must compare `records_seen` against the
> publisher's own declared count where one exists, and must treat `artifact_bytes` landing on a
> power-of-two-ish ceiling as a TRUNCATED candidate requiring an explicit override.

---

## 3. `public.dc_source_observation` — what a source said, once

**PURPOSE.** One row = one record as published by one source in one complete run. It is a
statement by a publisher, **not** a claim that a facility exists.

The three identities the ruling requires to stay separate:

| identity | column | who owns it |
|---|---|---|
| publisher's own record id | `publisher_record_id` | the publisher; **NULL for Epoch, always** |
| our identity for this observation | `home_signal_observation_id` (PK) | HomeSignal |
| the canonical entity | **not a column here** | `dc_observation_entity_link` (§7) |

> 🔑 **`canonical_entity_id` is deliberately NOT a column on this table.** Putting it here would
> create a second way to answer "which entity is this?" beside the link table — the exact
> shortcut the no-shortcuts rule forbids — and it would force a 1:1 observation→entity
> assumption, which is wrong for the 5 campus-present/building-absent rows and the 3 unresolved
> ones. The separation is achieved by the column's **absence**. Overruleable, but this is the
> reason.

| column | type | notes |
|---|---|---|
| `home_signal_observation_id` | `uuid` PK `DEFAULT gen_random_uuid()` | never rendered, never a facility id |
| `source_key` | `text NOT NULL` FK → `dc_source` | |
| `acquisition_run_id` | `uuid NOT NULL` FK → `dc_acquisition_run` | the run that first produced it |
| `publisher_record_id` | `text` | Atlas `id`; **NULL for Epoch** |
| `observation_fingerprint` | `text NOT NULL` | §4 — identifies the OBSERVATION, nothing else |
| `source_row_ordinal` | `int` | position in the artifact; replay aid, never identity |
| `source_native_name` | `text` | verbatim |
| `source_native_type` | `text` | Atlas `facilityType`; Epoch NULL |
| `source_native_status` | `text` | Atlas `status`; **Epoch NULL** |
| `source_native_operator` | `text` | Atlas `operator`; Epoch `Owner` (marker stripped into `source_native_operator_confidence`) |
| `source_native_operator_confidence` | `text` | Epoch's `#confident`/`#likely`/`#speculative`, verbatim |
| `source_native_address` | `jsonb` | verbatim, **unparsed** |
| `source_native_geometry` | `geography(Point,4326)` | Atlas only; **NULL for Epoch** |
| `source_native_precision` | `text` | Atlas `location.precision`; Epoch NULL |
| `source_timestamps` | `jsonb` | publisher's own dates, verbatim |
| `raw_payload` | `jsonb NOT NULL` | the record exactly as published |
| `raw_payload_ref` | `text` | `artifact_ref` + offset, for byte-level replay |
| `normalization_version` | `text NOT NULL` | bump ⇒ fingerprints change ⇒ new observations |
| `observed_at` | `timestamptz NOT NULL DEFAULT now()` | first seen |
| `last_seen_at` | `timestamptz NOT NULL` | newest SUCCESS_COMPLETE run carrying this fingerprint |
| `last_seen_run_id` | `uuid` FK → `dc_acquisition_run` | |
| `superseded_by` | `uuid` FK → self | §5, Atlas chains only |
| `not_seen_state` | `text` | §13 |
| `not_seen_since_run_id` | `uuid` FK → `dc_acquisition_run` | |

Constraints — these are where "unknown stays unknown" and "Epoch does not pretend" are enforced:

* UNIQUE `(source_key, observation_fingerprint)` — re-observing identical bytes moves
  `last_seen_at`; it does not create a row.
* PARTIAL UNIQUE `(source_key, publisher_record_id) WHERE publisher_record_id IS NOT NULL AND superseded_by IS NULL` — one CURRENT observation per Atlas id.
* CHECK, via a trigger reading `dc_source`: `supplies_publisher_record_id = false ⇒ publisher_record_id IS NULL`. **A future session cannot give Epoch an id without first flipping a registry flag in a reviewed migration.**
* Same trigger: `supplies_geometry = false ⇒ source_native_geometry IS NULL`; `supplies_lifecycle_status = false ⇒ source_native_status IS NULL`.
* CHECK every `source_native_*` text column `<> ''` — an empty string is not a value; absence is `NULL`.
* Trigger: INSERT permitted only when `acquisition_run_id` has `completeness_state='SUCCESS_COMPLETE'`.
* Trigger: `source_native_geometry`, `raw_payload`, `publisher_record_id`, `observation_fingerprint` are **immutable after insert**. A changed publisher record is a NEW observation, never an edit.
* INDEX `(source_key, publisher_record_id)`, `(source_key, last_seen_at DESC)`, GIN on `raw_payload`, GIN on `source_native_address`, `(source_key, not_seen_state) WHERE not_seen_state IS NOT NULL`.

**RETENTION:** append-only, permanent, never overwritten. **WRITE:** acquisition worker.
**READ:** service_role, review tooling.

---

## 4. Observation fingerprint — definition, and what it is forbidden to be

```
observation_fingerprint = sha256(
    source_key            || U+001F ||
    normalization_version || U+001F ||
    canonical_json(raw_payload)         -- keys sorted, no whitespace, NFC
)
```

* It is **deterministic**: the same published bytes always produce the same fingerprint, so replay
  of an archived artifact reproduces the same observation rows.
* It changes when **any** published byte changes. That is the point — it identifies *this
  statement*, not the thing the statement is about.
* ⛔ **It is not, and must never be used as, a publisher ID, a facility ID, a project ID or a
  campus ID.** It is not synthesised from name, coordinates, operator, address or row number
  individually; it is a hash of the *whole published record*, which is why it cannot be mistaken
  for a stable identity: it is maximally unstable by construction.
* CI invariant (§17): no foreign key anywhere may reference `observation_fingerprint`, and no
  entity table may carry a column whose value is derived from it.

---

## 5. Versioning — Atlas chains, Epoch does not

**Atlas.** `publisher_record_id` is the chain key. A new fingerprint under the same id inserts a
new observation and stamps the previous one's `superseded_by`. The chain is queryable, and the
measured behaviour it must reproduce is already known: across v1.32.0 → v1.33.0 → main, **0
records disappeared**, all 60 `cancelled` records survived, and 19 status transitions, 2 name
changes, 1 operator change and 3 coordinate moves all occurred **under a stable id**.

`public.dc_observation_delta` — computed, queryable, never a script:

| column | type |
|---|---|
| `id` `uuid` PK · `source_key` `text` · `from_observation_id` `uuid` FK · `to_observation_id` `uuid` FK |
| `field_path` `text NOT NULL` · `old_value` `jsonb` · `new_value` `jsonb` · `computed_at` `timestamptz` |

UNIQUE `(from_observation_id, to_observation_id, field_path)`. CHECK both observations share
`source_key`. **WRITE:** acquisition worker. **RETENTION:** permanent.

**Epoch.** There is no chain key, so successive releases produce **independent observations** and
nothing asserts they describe the same thing.

`public.dc_observation_succession_candidate` — succession is **proposed**, never inferred:

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK | |
| `source_key` | `text NOT NULL` | |
| `from_observation_id` / `to_observation_id` | `uuid NOT NULL` FK | |
| `basis` | `text NOT NULL` | `name_identical` \| `name_and_owner` \| `address_identical` \| `manual` |
| `basis_evidence` | `jsonb NOT NULL` | the compared values, verbatim on both sides |
| `state` | `text NOT NULL DEFAULT 'PROPOSED'` | `PROPOSED` \| `CONFIRMED` \| `REJECTED` |
| `decided_by` / `decided_at` | `text` / `timestamptz` | |

* CHECK `state IN ('PROPOSED','CONFIRMED','REJECTED')`
* CHECK `state = 'PROPOSED' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)`
* CHECK `basis <> 'manual' OR state <> 'PROPOSED'`
* UNIQUE `(from_observation_id, to_observation_id)`
* **CHECK/CI: a CONFIRMED succession does not, on its own, create or modify any entity link.**
  Two observations being successors means "these are candidates for the same entity"; the entity
  question is then answered in §7 like any other, with its own evidence and its own review.

> This is the exact requirement — *Epoch row changes between releases remain traceable without
> assuming the old and new rows are necessarily the same real-world entity.* Traceability lives in
> the succession table; identity lives nowhere but §7.

---

## 6. `public.dc_source_citation` — provenance, normalized and queryable

**PURPOSE.** Preserve Atlas's 6,073 typed citations and Epoch's Selected Sources + calculation
workbooks **losslessly and queryably**. No flattening into an opaque jsonb blob.

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK | |
| `observation_id` | `uuid NOT NULL` FK → `dc_source_observation` ON DELETE RESTRICT | |
| `citation_ordinal` | `int NOT NULL` | Atlas `sourceIndex` is **positional and load-bearing** |
| `url` | `text` | |
| `publisher` | `text` | Atlas `sources[].publisher` |
| `evidence_kind` | `text NOT NULL` | Atlas verbatim: `press`·`other`·`osm`·`filing`·`permit`·`subsidy`·`iso_queue`; Epoch: `selected_source`·`calculation_workbook` |
| `label` | `text` | Atlas `label`; Epoch markdown link text |
| `citation_text` | `text` | the source-native citation string, verbatim |
| `retrieved_at` | `date` | Atlas 6,073/6,073; **Epoch NULL — it states none** |
| `supports_scope` | `text NOT NULL` | `observation` \| `attribute` \| `timeline_event` |
| `supports_ref` | `text` | attribute key, or timeline event id |

* UNIQUE `(observation_id, citation_ordinal)`
* CHECK `supports_scope IN ('observation','attribute','timeline_event')`
* CHECK `supports_scope <> 'observation' OR supports_ref IS NULL`
* CHECK `url IS NOT NULL OR citation_text IS NOT NULL` — a citation that names nothing is not a citation
* INDEX `(observation_id)`, `(evidence_kind)`, `(url)`

**RETENTION:** permanent, immutable, deleted only with its observation (which never happens).
**WRITE:** acquisition worker. **READ:** service_role, review tooling.

Atlas's `sourceIndex` mechanism survives intact: an attribute row (§10) carries
`citation_ordinal`, which resolves against this table for the same observation — so "which
document backs this specific claim" remains a join, exactly as the publisher intended.

---

## 7. Canonical entity layer — what exists, and what is deliberately NOT created

Every entity id is a HomeSignal `uuid`. **Atlas publisher id ≠ canonical facility id. Epoch Name ≠
canonical facility id.** Neither ever becomes a primary key here.

### Created

**`public.dc_operator`** — a company that operates or develops a site.
*Justified:* Atlas carries an operator on 2,025/2,025, Epoch an owner on 77/86, and the measured
overlap shows the **same facility under different operator strings** (Ellendale ND: Atlas
`Applied Digital`, Epoch `CoreWeave`). An operator must be an entity so that disagreement is
representable rather than a string mismatch.

**`public.dc_facility`** — a named site at one location with an operational state.
*Justified:* the grain both sources primarily describe.

**`public.dc_campus`** — a bounded place holding sibling facilities and their dedicated support.
*Justified by measurement, not by taste:* QTS Richmond 1/2/3 (Atlas has one record, Epoch three),
Microsoft SAT14/SAT40 vs SAT89/SAT90, Vantage TX1 vs TX11/TX22, and Colossus where Atlas splits
the gas-turbine plant from the compute hall. The 5 "campus present, building absent" rows have
nowhere else to attach.

**`public.dc_project`** — a named development effort that may span facilities and campuses and
carries a lifecycle.
*Justified:* Stargate appears as ≥6 distinct US sites in Atlas and 7 rows in Epoch, plus Project
Rainier, Hyperion, Prometheus. A project is not a facility.

### NOT created — and the trigger condition for revisiting

**`dc_building` — DEFERRED.** No source carries a per-building record with its own identity,
location and lifecycle. Epoch mentions "Building 1/2/3" only inside free-prose timeline text.
Creating the table now would be a speculative physical object.
*Revisit when:* a source supplies a per-building identifier with its own location or its own
dated lifecycle. Until then, building-grain statements live as `dc_construction_evidence` (§12)
attached to a facility or campus.

**`dc_parcel` — DEFERRED.** Neither source carries a parcel identifier. Parcels come from county
assessors, i.e. the local/government plane, which is outside Step 2.
*Revisit when:* the local plane supplies an assessor parcel number that a permit record keys on.

### Common shape (all four created tables)

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK `DEFAULT gen_random_uuid()` | |
| `entity_state` | `text NOT NULL DEFAULT 'CANDIDATE'` | `CANDIDATE` \| `CONFIRMED` \| `RETIRED` |
| `created_from_observation_id` | `uuid NOT NULL` FK → `dc_source_observation` | **every entity traces to the observation that caused it** |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `created_by` | `text NOT NULL` | `rule:<key>@<version>` or `manual:<who>` |
| `review_state` | `text NOT NULL DEFAULT 'unreviewed'` | `unreviewed` \| `accepted` \| `rejected` |
| `reviewed_by` / `reviewed_at` | `text` / `timestamptz` | |
| `retired_reason` | `text` | never set from a source disappearance (§13) |

* CHECK `entity_state IN ('CANDIDATE','CONFIRMED','RETIRED')`
* CHECK `entity_state <> 'CONFIRMED' OR review_state = 'accepted'` —
  **an automatic rule can create a CANDIDATE and can never create a CONFIRMED.**
* **A `CANDIDATE` entity is never resident-facing.** That single rule is what makes Epoch-only
  entity creation safe, and it is what satisfies *"Epoch may NOT independently promote that
  entity to a resident-facing confirmed facility solely from mutable Name/Address/Owner fields."*
* Facility-specific: `operational_state text NOT NULL DEFAULT 'unknown'` (§12), plus
  `primary_campus_id uuid` FK → `dc_campus` (nullable, never inferred).
* Project-specific: `lifecycle_state text NOT NULL DEFAULT 'unknown'` (§12).
* `dc_facility_campus_member` / `dc_facility_project_member` are explicit link tables with their
  own evidence and review state — **membership is never a bare FK set by a rule.**

**RETENTION:** permanent; entities are `RETIRED`, never deleted. **WRITE:** review tooling +
(future) candidate-creation rules. **READ:** service_role. **No resident surface in Step 2.**

---

## 8. `public.dc_observation_entity_link` — the ONE place identity is decided

**PURPOSE.** The single answer to "which entity does this observation describe", with its
evidence, its method, its reviewability and its reversibility.

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK | |
| `observation_id` | `uuid NOT NULL` FK → `dc_source_observation` | |
| `entity_kind` | `text NOT NULL` | `facility` \| `campus` \| `project` \| `operator` |
| `entity_id` | `uuid NOT NULL` | polymorphic; integrity enforced by trigger per kind |
| `link_state` | `text NOT NULL` | the 5-value vocabulary below |
| `method` | `text NOT NULL` | `publisher_id` \| `rule` \| `manual` |
| `rule_key` / `rule_version` | `text` | NOT NULL when `method='rule'` |
| `evidence` | `jsonb NOT NULL` | what agreed AND what did not, each with both compared values |
| `evidence_confidence` | `text NOT NULL` | `publisher_asserted` \| `strong` \| `weak` \| `none` — **a vocabulary, never a float** |
| `sibling_ambiguity` | `boolean NOT NULL DEFAULT false` | §9 |
| `created_at` / `created_by` | `timestamptz` / `text` | |
| `review_state` | `text NOT NULL DEFAULT 'unreviewed'` | `unreviewed` \| `accepted` \| `rejected` |
| `reviewed_by` / `reviewed_at` | `text` / `timestamptz` | |
| `superseded_by` | `uuid` FK → self | retirement, never deletion |
| `reversal_of` | `uuid` FK → self | an explicit undo, itself a row |

**`link_state` vocabulary (closed):**

| state | meaning |
|---|---|
| `CONFIRMED_MATCH` | this observation describes this entity |
| `CANDIDATE_ENTITY` | this observation *caused* this entity to be created; identity beyond the observation is unestablished |
| `POSSIBLE_MATCH` | evidence points here, and is insufficient to confirm |
| `UNRESOLVED_IDENTITY` | the observation is preserved and deliberately attached to nothing |
| `REJECTED_MATCH` | examined and refused; retained so the same wrong answer is not re-proposed |

Constraints — this is the load-bearing block:

* CHECK `link_state IN (…the 5…)`
* CHECK `method <> 'rule' OR (rule_key IS NOT NULL AND rule_version IS NOT NULL)`
* 🔒 **CHECK `link_state <> 'CONFIRMED_MATCH' OR method = 'publisher_id' OR review_state = 'accepted'`**
  — **an automatic rule can never write CONFIRMED_MATCH.** This is the schema-level answer to the
  7-of-61 wrong-sibling result.
* CHECK `link_state <> 'CONFIRMED_MATCH' OR sibling_ambiguity = false`
* CHECK `link_state = 'UNRESOLVED_IDENTITY'` ⇒ `entity_kind`/`entity_id` reference the
  observation's own placeholder unresolved entity, so the row is still a real FK and the
  observation is never orphaned.
* PARTIAL UNIQUE `(observation_id, entity_kind) WHERE link_state='CONFIRMED_MATCH' AND superseded_by IS NULL`
* **No destructive merges:** append-only. `superseded_by` retires a link. There is no `DELETE`
  grant on this table for any role, and entity merges are separate reviewed proposals, never a
  rewrite of `entity_id` in place.
* **No hidden transitivity:** CHECK `evidence ?| ARRAY['source_native_name','source_native_operator','source_native_address','source_native_geometry','publisher_record_id','source_native_type','source_timestamps']`
  — every link must cite at least one field of **its own observation**. A link whose only support
  is another link cannot satisfy this, and CI (§17) asserts no producer reads
  `dc_observation_entity_link` as an input to creating one.
* INDEX `(entity_kind, entity_id)`, `(observation_id)`, `(link_state)`,
  `(review_state) WHERE review_state='unreviewed'`.

**RETENTION:** append-only, permanent. **WRITE:** review tooling; rules may write only
non-CONFIRMED states. **READ:** service_role, review tooling.

---

## 9. The wrong-sibling guard — Colossus 1 → `xai-colossus-2`

The measured failure: an automatic matcher assigned Epoch **Colossus 1** to Atlas
`xai-colossus-2-memphis-tn` while `xai-colossus-memphis-tn` (Colossus 1) existed. Six more of the
same shape: four Stargate rows onto `lancium-crusoe-abilene-tx`, `Amazon Madison Mega Site` onto
an Ohio record, `OpenAI Stargate Abilene` onto the adjacent turbine plant. **7 of 61.**

Four independent barriers, any one of which stops it becoming canonical truth:

1. **State.** The rule may only write `POSSIBLE_MATCH`. The CHECK above makes `CONFIRMED_MATCH`
   unreachable without `review_state='accepted'`.
2. **Evidence must record the disagreement.** `evidence` carries what agreed *and what did not*:
   `{"agreed":{"operator":["xAI","xAI"],"state":["TN","TN"],"city":["Memphis","Memphis"]},
     "disagreed":{"name_ordinal":["1","2"]}}`.
3. **`sibling_ambiguity`.** A trigger sets it true when the target entity already has a linked
   observation whose `source_native_name` differs from this one only by a trailing ordinal or
   sibling token (`1`/`2`, `I`/`II`, `A`/`B`, `SAT14`/`SAT40`, `TX1`/`TX11`). A row with
   `sibling_ambiguity=true` is **structurally barred from `CONFIRMED_MATCH`** by CHECK.
4. **CI, in both directions** (§17): the 7 measured pairs are a frozen fixture. Any identity rule
   that emits `CONFIRMED_MATCH` for any of them **fails CI**. And the over-flagging direction is
   pinned too — the rule must still emit `POSSIBLE_MATCH` (not `UNRESOLVED_IDENTITY`) for those 7,
   and must still reach the correct record on a frozen control set of unambiguous pairs.
   Otherwise a rule that matches nothing scores green, which is the failure this repo has already
   recorded twice.

---

## 10. Source-native attributes vs canonical attributes

### `public.dc_observation_attribute` — source-native, long format, nothing derived

| column | type | notes |
|---|---|---|
| `id` `uuid` PK · `observation_id` `uuid NOT NULL` FK | | |
| `attribute_key` | `text NOT NULL` FK → `dc_attribute_key` | **per-source closed vocabulary** |
| `value_text` / `value_numeric` / `value_unit` / `value_jsonb` | | exactly one non-null (CHECK) |
| `citation_ordinal` | `int` | resolves against `dc_source_citation` for the same observation |
| `is_publisher_stated` | `boolean NOT NULL DEFAULT true` | always true at this layer (CHECK) |

UNIQUE `(observation_id, attribute_key)`. **This is what makes "do not force them into a
lowest-common-denominator entity table" structural**: Epoch's `h100_equivalents` and Atlas's
`capacity_mw_operational` are different keys in one long table, neither squeezed into the other.

`public.dc_attribute_key` registers `(attribute_key, source_key, datatype, unit,
is_publisher_estimate, canonical_eligible)` — a closed vocabulary, so a typo is a constraint
violation rather than a silently orphaned attribute.

**Preserved as SOURCE OBSERVATION DATA (and NOT canonical in Step 2):**

| Epoch | Atlas |
|---|---|
| H100 equivalents · power (MW) · capital cost · chip types · users/tenants · investors · construction companies · energy companies · calculation workbook · project label | water/civic fields · subsidies · jobs · emissions · confidence level · location precision · citation set |

*Why Epoch's quantities stay observation-only:* Epoch's own methodology states IT power is
**estimated** from cooling equipment in satellite imagery and that a capacity estimate is accurate
within a factor of 1.4x about 80% of the time. `is_publisher_estimate=true` on every one of those
keys. Promoting a modelled estimate to a canonical attribute would put an estimate on a resident's
map as a fact.

**Eligible to become CANONICAL later (never automatically in Step 2):** name · operator ·
facility type · coordinates + precision · lifecycle status · capacity.

### `public.dc_entity_attribute` — canonical, evidence edge mandatory

| column | type | notes |
|---|---|---|
| `id` `uuid` PK · `entity_kind` `text` · `entity_id` `uuid` | | |
| `attribute_key` | `text NOT NULL` FK → `dc_attribute_key` | must be `canonical_eligible` (CHECK) |
| `value_*` | | as above |
| `derived_from_observation_id` | `uuid **NOT NULL**` FK | **the evidence edge** |
| `derivation_rule` / `derivation_version` | `text NOT NULL` | |
| `conflict_state` | `text NOT NULL DEFAULT 'agreed'` | `agreed` \| `conflict` |
| `decided_at` `timestamptz` · `decided_by` `text` · `superseded_by` `uuid` FK → self | | |

* CHECK `derived_from_observation_id IS NOT NULL` — **a canonical attribute with no evidence edge
  cannot exist.**
* **Multiple live rows for the same `(entity, attribute_key)` are ALLOWED** with
  `conflict_state='conflict'`. There is no "latest wins", no unique constraint forcing a single
  answer, and §17 pins the absence of any `max()`/`ORDER BY` resolution over conflicting values.
  **Conflict remains conflict.**

---

## 11. Lifecycle — three separable things

The ruling forbids reviving "most advanced status wins". Three distinct concepts, three homes:

1. **`dc_project.lifecycle_state`** — closed vocabulary, Atlas's own:
   `proposed` · `permitted` · `under_construction` · `operational` · `cancelled` · `unknown`.
2. **`dc_facility.operational_state`** — a different question:
   `not_operational` · `partially_operational` · `operational` · `unknown`.
3. **`public.dc_construction_evidence`** — where Epoch's 500 timeline observations land:

| column | type | notes |
|---|---|---|
| `id` `uuid` PK · `observation_id` `uuid NOT NULL` FK | | |
| `observed_on` | `date NOT NULL` | Epoch `Date` |
| `status_text` | `text NOT NULL` | **the free prose, VERBATIM, never parsed into a state** |
| `it_power_mw` / `power_mw` / `h100_equivalents` / `buildings_operational` / `water_use_mgd` | numeric / int | publisher-stated only |
| `citation_ordinal` | `int` | the inline citations Epoch embeds (SEC S-1, utility PDFs, WSJ) |

UNIQUE `(observation_id, observed_on, status_text)`.
🔒 **CI invariant: no code path may map `status_text` to a `lifecycle_state` or an
`operational_state`.** Epoch's prose is evidence; it is not a lifecycle vocabulary and it has none.

4. **`public.dc_lifecycle_assertion`** — every claim about lifecycle, from any source:

| column | type |
|---|---|
| `id` `uuid` PK · `entity_kind` `text` · `entity_id` `uuid` · `observation_id` `uuid NOT NULL` FK |
| `assertion_vocabulary` `text NOT NULL` — `atlas_closed` \| `epoch_prose` \| `local_permit` |
| `asserted_value` `text NOT NULL` (verbatim) · `asserted_on` `date` · `conflict_state` `text NOT NULL` |

* CHECK `assertion_vocabulary <> 'epoch_prose' OR asserted_value IS NOT NULL` and a companion
  CHECK that an `epoch_prose` assertion may **never** carry a value drawn from the closed
  `lifecycle_state` vocabulary — the two vocabularies are not interchangeable.
* **No resolution rule in Step 2.** Two assertions disagreeing stays two rows.

---

## 12. Geography — preserved, not solved

**ZIP membership is NOT in this migration.** `geo.zip_authoritative_membership`, `geo.zcta_boundary`
and `geo.n5_generation` are untouched and remain the only owner of ZIP membership.

What the schema preserves so the later geography layer has what it needs:

* **Publisher geometry** — `dc_source_observation.source_native_geometry` (+ `source_native_precision`,
  `source_native_address`), **immutable after insert** (trigger). Never overwritten by anything.
* **Derived geometry — a separate table, never the same column:**

`public.dc_derived_geometry`

| column | type | notes |
|---|---|---|
| `id` `uuid` PK · `observation_id` `uuid NOT NULL` FK | | |
| `geometry` | `geography(Point,4326) NOT NULL` | |
| `derivation_method` | `text NOT NULL` | `geocode` \| `centroid` \| `parcel_join` \| `manual` |
| `derivation_provider` | `text NOT NULL` | |
| `derivation_confidence` | `text NOT NULL` | vocabulary, not a float |
| `derived_at` `timestamptz NOT NULL` · `derivation_version` `text NOT NULL` · `superseded_by` `uuid` FK → self | | |

* 🔒 **Trigger: an INSERT is refused unless `dc_source.geocoding_enabled = true` for that
  observation's source.** Both sources ship `false`. **No coordinates are manufactured for Epoch
  in Step 2**, and a future session cannot do it without a reviewed registry change.
* CI invariant: no `dc_*` table carries a `zip`, `zcta`, `zip_code` or `postal_code_5` column, and
  no `dc_*` producer references `geo.zip_authoritative_membership`.

---

## 13. Disappearance — locked vocabulary

| source | value when a record is absent from a later complete release |
|---|---|
| Atlas | `SOURCE_RECORD_NOT_SEEN` |
| Epoch | `NOT_OBSERVED_IN_CURRENT_RELEASE` |

* Written to `dc_source_observation.not_seen_state` + `not_seen_since_run_id`.
* CHECK, via `dc_source.not_seen_vocabulary`: each source may write only **its own** value.
* 🔒 **Trigger: `not_seen_state` may be set only by a run whose `completeness_state =
  'SUCCESS_COMPLETE'`.** A `PARTIAL`, `TRUNCATED`, `FETCH_FAILED` or `SUCCESS_ZERO` run can never
  mark anything not-seen. *A failed or partial acquisition must NEVER cause records to be
  interpreted as removed.*
* 🔒 **Neither value means `WITHDRAWN`, `CANCELLED` or `DELETED`.** CI invariant: no code path maps
  either string to any value in the `lifecycle_state`, `operational_state` or `entity_state`
  vocabularies; and a trigger refuses any transaction that writes `not_seen_state` and a
  `dc_*.entity_state` / `lifecycle_state` change together.
* Re-appearance is ordinary: a later complete release carrying the record clears `not_seen_state`
  and moves `last_seen_at`. Nothing was destroyed to be restored.

---

## 14. Active-feed readiness — measured, and NOT claimed

`public.dc_source_health` (VIEW, `security_invoker=true`, no anon grant) — per `source_key`:

`last_run_at` · `last_success_complete_run_at` · `last_complete_release_key`
(`source_release_key` when the publisher gives one, else `content_release_key`) ·
`consecutive_failures` · `records_observed_last_complete` · `observed_freshness` ·
`freshness_age` · `staleness_state` · `schedule_cron` · `active_state` ·
`runs_by_completeness_state_30d` (a jsonb tally, so failures are surfaced rather than averaged away).

* CHECK on `dc_source`: `active_state='ACTIVE'` requires `schedule_cron IS NOT NULL`.
* **Both sources are seeded `NOT_ACTIVE`. Step 2 does not call either source ACTIVE** and provides
  no mechanism that could do so implicitly — promotion is a separate reviewed change with the
  health view as its evidence.

---

## 15. Row flows — the five required walkthroughs

### A. ATLAS — `meta-eagle-mountain-ut`

1. `dc_acquisition_run`: `source_key='compute_atlas'`, `http_status=200`,
   `artifact_sha256=…`, `source_release_key='1.33.0'`, `records_seen=records_parsed=2025`,
   `schema_fingerprint` matches → `completeness_state='SUCCESS_COMPLETE'`, `advanced_observations=true`.
2. `dc_source_observation`: `publisher_record_id='meta-eagle-mountain-ut'`,
   `source_native_name='Meta Eagle Mountain Data Center Campus'`, `source_native_type='data_center'`,
   `source_native_status='operational'`, `source_native_geometry=POINT(...)`,
   `source_native_precision='approximate'`, `raw_payload` verbatim, `observation_fingerprint=…`.
3. `dc_source_citation`: one row per `sources[]` entry, `citation_ordinal` = array index,
   `evidence_kind='press'|'filing'|…`, `retrieved_at` from `retrievedAt`.
4. `dc_observation_attribute`: `capacity_mw_operational`, `confidence`, `location_precision`, … each
   with its `citation_ordinal`.
5. `dc_facility` created `entity_state='CANDIDATE'`, `created_from_observation_id=…`.
6. `dc_observation_entity_link`: `link_state='CONFIRMED_MATCH'`, `method='publisher_id'`,
   `evidence_confidence='publisher_asserted'` — permitted without review **only** because the
   publisher itself supplies the record identity. Confirming the *entity* still needs review.
7. Next release, same id, changed status → new observation row, previous stamped `superseded_by`,
   `dc_observation_delta` records `status: under_construction → operational`.

### B. EPOCH, MATCHED — `Meta Eagle Mountain`

1. Run for `epoch_ai_data_centers`: 86/86 parsed, schema fingerprint matches → `SUCCESS_COMPLETE`.
   ⚠️ If `artifact_bytes` is again exactly 64,000 and the parser cannot corroborate 86 against a
   publisher-declared count, the run is `TRUNCATED` and **writes no observations**.
2. `dc_source_observation`: **`publisher_record_id = NULL`**, `source_native_name='Meta Eagle Mountain'`,
   `source_native_status = NULL` (Epoch has no status column — enforced by the registry flag),
   `source_native_geometry = NULL` (enforced), `source_native_address` = the verbatim address string,
   `source_native_operator='Meta'`, `source_native_operator_confidence='#confident'`.
3. `dc_source_citation`: the Selected Sources markdown list exploded into one row per link
   (`evidence_kind='selected_source'`, `retrieved_at=NULL`), plus the Calculations sheet
   (`evidence_kind='calculation_workbook'`).
4. `dc_observation_attribute`: `h100_equivalents=151354`, `power_mw=133`,
   `capital_cost_2025_usd_bn=5.038`, `chip_types='B300'`, `users`, … all with
   `is_publisher_estimate=true`.
5. `dc_construction_evidence`: one row per timeline observation, `status_text` verbatim.
6. `dc_observation_entity_link` → the **existing** `dc_facility` from flow A:
   `link_state='POSSIBLE_MATCH'`, `method='rule'`, `rule_key='op_place_state_v1'`,
   `evidence={"agreed":{"operator":["Meta","Meta"],"state":["UT","UT"],"city":["Eagle Mountain","Eagle Mountain"]}}`,
   `evidence_confidence='strong'`. A reviewer accepts → `CONFIRMED_MATCH`.
   **The rule alone could not have written that.**

### C. EPOCH-ONLY — `Google Columbus` (the required case)

Measured: Atlas's Google-Ohio set is Lima, Lancaster, New Albany, Franklin Furnace. **There is no
Columbus record.**

1. Observation written exactly as in B: `publisher_record_id = NULL`, name `Google Columbus`,
   address `5076 S High St, Columbus, OH 43207`, `power_mw=303`, `h100_equivalents=331986`,
   chips `TPU v5e,v5p,v6e,v7`, its Selected Sources and its timeline rows. **It is preserved in full.**
2. The identity rule finds no Atlas facility satisfying operator + place in the same state.
3. It creates `dc_facility` with `entity_state='CANDIDATE'`, `created_by='rule:op_place_state_v1'`,
   `created_from_observation_id=<this observation>`, `review_state='unreviewed'`.
4. `dc_observation_entity_link`: `link_state='CANDIDATE_ENTITY'`, `method='rule'`,
   `evidence_confidence='none'`, `evidence` citing `source_native_name` + `source_native_address`.
5. **Outcome, against each prohibition:**
   * *does not disappear* — the observation, its 2 citations, its attributes and its timeline rows all persist;
   * *not forced onto another Google Ohio facility* — no link to Lima/Lancaster/New Albany exists, and any such link would have to carry evidence of agreement that does not exist;
   * *no fabricated Epoch ID* — `publisher_record_id` stays NULL, enforced by the registry flag;
   * *not resident-facing* — `entity_state='CANDIDATE'`, and CANDIDATE entities have no reader on any resident surface; geography is absent (`source_native_geometry=NULL`, no derived row permitted), so the later ZIP gate cannot admit it either.
6. If review cannot establish identity, the link is superseded by `UNRESOLVED_IDENTITY` against the
   observation's placeholder entity. **Still preserved, still not resident-facing, still traceable.**

### D. EPOCH POSSIBLE-MATCH — `CoreWeave Ellendale ND`

Atlas has `applied-digital-polaris-forge-1-ellendale-nd`, operator **Applied Digital**. Epoch names
the **tenant**, CoreWeave.

* Link written `POSSIBLE_MATCH`, `evidence={"agreed":{"city":["Ellendale","Ellendale"],"state":["ND","ND"]},"disagreed":{"operator":["CoreWeave","Applied Digital"]}}`, `evidence_confidence='weak'`.
* On review acceptance: `CONFIRMED_MATCH` to the facility, **and** a separate
  `dc_observation_entity_link` of `entity_kind='operator'` recording CoreWeave — because tenant and
  operator are different roles, and collapsing them would destroy the distinction Epoch supplies.
* Until reviewed, the facility keeps Atlas's operator as its canonical attribute and Epoch's sits in
  `dc_observation_attribute` as observation data. **Two answers, both visible, neither overwritten.**

### E. WRONG-SIBLING FAILURE — `Colossus 1` → `xai-colossus-2-memphis-tn`

1. Rule proposes the link. Trigger inspects the target entity's existing linked observations, finds
   `Colossus 2`, detects a trailing-ordinal sibling difference → `sibling_ambiguity = true`.
2. CHECK makes `CONFIRMED_MATCH` **structurally unreachable** for that row.
3. Row lands `POSSIBLE_MATCH`, `evidence.disagreed = {"name_ordinal":["1","2"]}`, surfaced for review.
4. Reviewer rejects → `REJECTED_MATCH` (retained, so the same wrong answer is not re-proposed), and
   accepts a new link to `xai-colossus-memphis-tn`.
5. **Nothing canonical ever moved.** No entity attribute, no lifecycle assertion and no resident
   surface observed the bad candidate, because canonical attributes require an accepted link and
   Step 2 has no resident readers at all.
6. CI (§17) freezes all 7 measured wrong-sibling pairs; a rule that confirms any of them fails.

---

## 16. Migration order and rollback

**ORDER** (each step additive, each independently revertible):

1. `dc_source` + seed 3 rows (`NOT_ACTIVE`, `geocoding_enabled=false`).
2. `dc_acquisition_run` (+ CHECKs, indexes).
3. `dc_attribute_key` + seed the per-source vocabularies.
4. `dc_source_observation` (+ registry-flag triggers, immutability trigger, run-state trigger).
5. `dc_source_citation`, `dc_observation_attribute`, `dc_construction_evidence`.
6. `dc_observation_delta`, `dc_observation_succession_candidate`.
7. `dc_operator`, `dc_campus`, `dc_project`, `dc_facility` + the two membership link tables.
8. `dc_observation_entity_link` (+ sibling-ambiguity trigger, polymorphic-FK trigger).
9. `dc_entity_attribute`, `dc_lifecycle_assertion`.
10. `dc_derived_geometry` (+ `geocoding_enabled` trigger).
11. `dc_source_health` view (`security_invoker=true`).
12. RLS enable + grants: `service_role` only, **no `anon`, no `authenticated`**, on every table
    and the view.

**ROLLBACK.** Every step is `DROP` of objects created by that step and nothing else. Because the
whole subsystem is **additive and has zero readers**, a full rollback is
`DROP TABLE public.dc_* CASCADE` in reverse order + `DROP VIEW public.dc_source_health` — with **no
effect on `app_projects`, `development_reports`, `communities`, `geo.*`, Map 1, MAPS or any
resident page**, because nothing outside `dc_*` references anything inside it. That property is
itself a CI invariant (§17.8).

---

## 17. Tests and CI invariants

**UNIT (offline, no DB):**
1. `observation_fingerprint` is deterministic over key order, whitespace and Unicode form; and
   changes on any payload byte.
2. Atlas→observation normalizer preserves every published field; a round-trip from `raw_payload`
   reproduces the source record byte-for-byte after canonicalisation.
3. Epoch→observation normalizer **never** emits `publisher_record_id`, `source_native_geometry` or
   `source_native_status`.
4. Selected-Sources markdown explodes to one citation row per link, with `retrieved_at=NULL`, and
   an empty list yields zero rows rather than one empty row.
5. Sibling-token detector: fires on `1/2`, `I/II`, `A/B`, `SAT14/SAT40`, `TX1/TX11`, `Richmond 2/3`;
   **does not** fire on genuinely different names (over-flagging pinned).

**INTEGRATION (against a scratch DB, never production):**
6. A `PARTIAL`, `TRUNCATED`, `SUCCESS_ZERO`, `FETCH_FAILED`, `PARSE_FAILED`, `SCHEMA_CHANGED` or
   `STALE_SOURCE` run **cannot** insert an observation (6 cases, each asserted to raise).
7. The same run **cannot** set `not_seen_state` (all 7 non-SUCCESS_COMPLETE states).
8. An Epoch observation with a non-NULL `publisher_record_id` raises.
9. A `dc_derived_geometry` insert for either source raises while `geocoding_enabled=false`.
10. `UPDATE` of `source_native_geometry` raises.
11. `CONFIRMED_MATCH` with `method='rule'` and `review_state='unreviewed'` raises.
12. `CONFIRMED_MATCH` with `sibling_ambiguity=true` raises.
13. A link whose `evidence` cites no observation-owned field raises.
14. Two conflicting `dc_entity_attribute` rows for one `(entity, attribute_key)` are **accepted**
    (conflict is representable), and the Epoch-only flow C produces exactly the state §15.C describes.

**CI INVARIANTS (structural, fail the build):**
15. 🔒 **The 7 measured wrong-sibling pairs are a frozen fixture. Any identity rule emitting
    `CONFIRMED_MATCH` for any of them fails.** Both directions pinned: the rule must still emit
    `POSSIBLE_MATCH` for the 7, and must still reach the right record on the frozen control set.
16. No `dc_*` table carries a `zip`/`zcta`/`postal_code_5` column; no `dc_*` producer references
    `geo.zip_authoritative_membership`.
17. No mapping exists from `SOURCE_RECORD_NOT_SEEN` or `NOT_OBSERVED_IN_CURRENT_RELEASE` to any
    `lifecycle_state`, `operational_state` or `entity_state` value.
18. No `max()` / `ORDER BY` / "most advanced wins" resolution over lifecycle values anywhere in
    `dc_*`.
19. No foreign key references `observation_fingerprint`; no entity table carries a column derived
    from it.
20. No `dc_*` table or view carries an `anon` or `authenticated` grant.
21. **No resident-facing file reads `dc_*`** — grep `lib/`, `*.html`, `supabase/functions/`,
    `homesignal-ingest/` for `dc_source_observation|dc_facility|dc_entity_attribute|…` and assert
    zero hits for the duration of Step 2. This is the invariant that keeps the canonical layer from
    becoming a second truth path before the cutover.
22. No `dc_*` producer reads `dc_observation_entity_link` as an input to creating a link
    (no hidden transitivity).

---

## 18. NO-SHORTCUTS AUDIT

| does this create a second way to determine… | answer |
|---|---|
| **data-center existence?** | **No, today.** `dc_source_observation` is a record of what a publisher *said*, not an existence claim. Existence would be `dc_facility.entity_state='CONFIRMED'` — and Step 2 creates **zero resident-facing readers** of it (invariant 21). Map 1's population is still decided solely by `lib/map.js::statedDataCenter` over `app_projects`. ⚠️ **Condition on READY:** this stays true only while nothing reads `dc_*`. The cutover — Map 1's DC population eventually reading `dc_facility` **through** the existing `HS.resolveMarker` projection contract rather than beside it — must be designed before any producer ships. Named here so it cannot be drifted into. |
| **identity?** | **No.** One path: `dc_observation_entity_link`. `canonical_entity_id` is deliberately absent from the observation table, succession candidates explicitly do not create links, and invariant 22 forbids link-from-link. |
| **lifecycle?** | **No.** `dc_project.lifecycle_state` / `dc_facility.operational_state` are the only canonical answers; everything else is an assertion or evidence, conflict is preserved, and invariant 18 forbids a resolution rule. |
| **ZIP membership?** | **No.** Not solved, not referenced, structurally forbidden (invariant 16). `geo.*` remains the only owner. |
| **resident-facing eligibility?** | **No.** There is no resident-facing eligibility concept in Step 2 at all, and CANDIDATE entities are barred from any resident surface by construction. |

---

## 19. Verdict

**STEP_2_CONTRACT = READY** — subject to the one condition stated in §18: the Map 1 cutover path
must be designed before a producer is written, or the canonical entity layer becomes the second
existence path the rule forbids.
