# HomeSignal Multi-Source Property & Facility Evidence Architecture

**Status: PROPOSAL FOR REVIEW — nothing implemented.** No migration written, no schema changed,
no table populated, no UI touched. This document is an audit plus a proposed architecture.

Audit performed 2026-08-10 against live Supabase project `qwnnmljucajnexpxdgxr` and the
`homesignal-site` / `homesignal-ingest` working trees. Every count in Part 1 is a query result
run during the audit, quoted with the query that produced it.

---

## 0. The one-sentence finding

HomeSignal does not have one property/evidence model with source-specific assumptions leaking
into it — it has **three unconnected truth models**, one per pilot, that share no key, plus a
fourth "truth" (the Del Valle parcel resolution) that lives **only in conversation and has never
been written to the database at all**. The good news is that the discipline the founder wants
already exists in fragments — a role crosswalk, a categorical evidence ladder, an abstention
vocabulary, a rejection log — each built once, for one source, and never generalized. The
architecture below generalizes what already works rather than replacing it.

---

# PART 1 — EXISTING ARCHITECTURE AUDIT

## 1.1 The three parallel models

| # | Model | Tables | Live rows | Built for | Keyed on |
|---|---|---|---|---|---|
| A | **Parcel / project resolution** | `resolved_projects`, `resolved_project_parcels`, `resolved_project_status`, `resolved_project_parcel_reconciliation` | 2 / 93 / 37 / 128 | Utah (Stratos + Eagle Mountain) | `project_id uuid` + `apn text` |
| B | **Record cache + read model** | `development_reports`, `property_reports`, `app_projects`, `app_changes`, `app_community_meta` | 12,722 / 1 / **3,027,784** / 120,426 / 15,677 | National Maps rollout | `zip text` + ephemeral `app_projects.id` |
| C | **Company identity / track record / ESG** | `companies`, `property_company_roles`, `company_parents`, `company_aliases`, `company_facilities`, `company_track_events`, `track_record_checks`, `company_match_rejections`, `project_facility_refs`, `frs_org_affiliations`, `frs_affiliation_role_map`, `identity_conflicts`, `company_esg_*` | 45 / 66 / 8 / **0** / 754 / 61 / 17 / 6 / 33 / 41 / 39 / 4 / 55+94+6 | Texas (78617 + TCEQ operators) | `company_key text` (a normalized name) + `app_projects.id` |

```sql
select 'resolved_project_parcels' t, count(*) n from resolved_project_parcels
union all select 'app_projects', count(*) from app_projects
union all select 'property_company_roles', count(*) from property_company_roles
union all select 'companies', count(*) from companies
union all select 'company_aliases', count(*) from company_aliases
union all select 'tx_parcels', count(*) from tx_parcels;
-- resolved_project_parcels 93 | app_projects 3027784 | property_company_roles 66
-- companies 45 | company_aliases 0 | tx_parcels 0
```

**Model A cannot reference Model C and vice versa.** A `resolved_project_parcels` row has no
company key; a `property_company_roles` row has a `parcel_id` column that is **NULL on every
row**. There is no join between the Utah parcel graph and the Texas identity graph, and no
concept either one could be expressed in.

## 1.2 There is no Texas parcel entity — and the Del Valle parcel is not in the system

`tx_parcels` is **empty (0 rows)**. The authoritative Del Valle parcel identifiers supplied in
this task — `PROP_ID 292354`, `geo_id 0315600221`, `pAccountID 9321348`,
`taxOfficeRef 03156002210000`, deed instrument `2021024697` — appear **nowhere**:

```sql
select
 (select count(*) from property_reports where sites::text like '%292354%' or sites::text like '%2021024697%') pr_hits,
 (select count(*) from development_reports where zip='78617' and (sites::text like '%292354%' or sites::text like '%2021024697%')) dr_hits,
 (select count(*) from source_fetch_cache where body::text like '%292354%') sfc_hits,
 (select count(*) from app_projects where zip='78617' and (source_ref like '%292354%' or provenance::text like '%292354%')) ap_hits,
 (select count(*) from app_projects where zip='78617') ap_78617;
-- pr_hits 0 | dr_hits 0 | sfc_hits 0 | ap_hits 0 | ap_78617 537   (control: 537 proves the ZIP is populated)
```

```
$ grep -ril "292354\|0315600221\|2021024697\|travis central appraisal\|TCAD" homesignal-site homesignal-ingest
homesignal-ingest/docs/utah-meetings-feeds.csv        ← incidental substring, not TCAD
```

**Consequence.** TCAD — the actual register of record for property ownership in Travis County —
has no adapter, no source-registry entry, no cached record, and no place to put its output. The
richest known fact about our richest pilot property (who owns the land, per the county, evidenced
by a recorded warranty deed) is the one fact the system cannot currently hold. That absence, more
than any schema defect, is what shapes this proposal.

## 1.3 The evidence graph is anchored to an ephemeral key — 48 of 66 rows are already orphaned

`property_company_roles.project_id` → `app_projects.id`. But `app_projects.id` defaults to
`gen_random_uuid()`, and the materializer destroys and recreates every row for a ZIP:

```
app_refresh_zip(_zip):
  delete from public.app_projects where zip=_zip;
  delete from public.app_changes  where zip=_zip;
  insert into public.app_projects (...) select ...
```

So every re-materialization mints new UUIDs and silently breaks the graph:

```sql
select count(*) total_roles,
 count(*) filter (where exists (select 1 from app_projects p where p.id=r.project_id)) roles_with_live_project,
 count(*) filter (where not exists (select 1 from app_projects p where p.id=r.project_id)) orphaned_roles
from property_company_roles r;
-- total_roles 66 | roles_with_live_project 18 | orphaned_roles 48
```

**48 of 66 evidence-backed company-role rows (73%) already point at projects that no longer
exist.** The 5 Del Valle "Property Owner" rows happen to still resolve; the 48 orphans are the
TCEQ operator rows. This is not a latent risk — it is present, measured data loss of the join,
and it will recur on every refresh. Fixing it is independent of everything else in this document
and should be done regardless of which architecture is chosen.

## 1.4 Role collapse — three separate instances

**(a) TDLR's project owner is stored as "Property Owner."** All 5 rows:

```sql
select role, company_key, evidence_source, notes from property_company_roles where role='Property Owner';
```
| role | company_key | evidence_source | notes |
|---|---|---|---|
| Property Owner | neuralink corporation | TDLR TABS project TABS2026011928 — OWNER block | "Building owner as stated by the filer to TDLR. Not corroborated against a county deed record." |
| Property Owner | neuralink | TDLR TABS project TABS2024022676 — OWNER block | same |
| Property Owner | river bottoms ranch llc | TDLR TABS project TABS2024016698 — OWNER block | same |
| Property Owner | river bottoms ranch llc | TDLR TABS project TABS2023006449 — OWNER block | same |
| Property Owner | river bottoms ranch | TDLR TABS project TABS2023006483 — OWNER block | same |

The distinction the founder cares about — *project owner as filed* vs *property owner of record* —
**is present, but only as English prose in a `notes` column.** The machine-readable field says
"Property Owner." Any consumer that filters `role='Property Owner'` gets the wrong meaning, and a
future TCAD adapter writing the *real* property owner would collide with these rows under the same
label. Note also the accidental correctness: the TCAD answer (River Bottoms Ranch LLC) matches
3 of these 5 rows — which is exactly the trap, because it makes the collapse look harmless until
a property where the filer is *not* the landowner arrives.

**(b) `app_projects.developer` holds either an owner or a source label.**
The materializer sets it to `coalesce(el->>'owner', el->>'src')`:

```sql
select developer, count(*) n from app_projects where zip in ('78617','60601','85003')
  and developer is not null group by 1 order by n desc limit 3;
-- "EPA FRS · registry 110002595488"  1
-- "EPA FRS · registry 110002601122"  1
-- "EPA FRS · registry 110003063504"  1
```
A column named `developer` is carrying a **source attribution string**. That is a derived field
masquerading as a company fact (Part 17's exact failure mode), in the read model the UI would use.

**(c) Two incompatible role vocabularies.**
`property_company_roles.role` ∈ {Property Owner, Operator}. `app_projects.parties[].role` ∈
{Owner, Contact, Filed By, Design Firm} (verified over 78617/84005/84302/84337). `app_site_parties()`
hardcodes exactly TDLR's four fields (`owner`/`contact_name`/`filed_by`/`design_firm`), so the
"party role" vocabulary is literally TDLR's form layout. `app_project_identity()` then hardcodes a
display order over a *third* list (`'Property Owner','Developer','Applicant','Operator'`), and
`app_attach_parents()` attaches parents only for `('Owner','Developer','Operator')`.

## 1.5 The one correct pattern — built once, for one source

`frs_affiliation_role_map` (39 rows) is a **source-vocabulary → HomeSignal-role crosswalk**, with
exactly the properties this architecture needs:

| affiliation_type | class | hs_role | hs_role_2 | parent_candidate |
|---|---|---|---|---|
| OWNER | current_identity | Facility Owner | — | false |
| OWNER/OPERATOR | current_identity | Facility Owner | Operator | false |
| FORMER OPERATOR | **historical_identity** | Operator | — | false |
| CONTRACTOR | **evidence_detail** | — | — | false |
| PARENT COMPANY | evidence_detail | — | — | **true** |
| POTENTIALLY RESPONSIBLE PARTY | evidence_detail | — | — | false |
| BILLING CONTACT | **not_relevant** | — | — | false |

with notes that are genuinely load-bearing — *"FRS OWNER is an affiliation to a REGULATED FACILITY,
not a deed to the parcel. Labelled Facility Owner so it is never read as real-estate ownership."*
and *"A contractor is not the operator."*

**This table is the seed of the proposed architecture.** TCEQ, TDLR, TCAD, SEC and every county
assessor need one, and none has one — their vocabularies are hardcoded in TypeScript and SQL.

## 1.6 Claims are not first-class — only winners are stored, losers become text

`identity_conflicts` (4 rows) detects TCEQ-vs-FRS operator disagreements. But look at what it stores:

| role | stronger_tier / company | weaker_tier / company |
|---|---|---|
| Operator | authoritative_filing / **City of Austin** | frs_affiliation / **AUSTIN ENERGY** |
| Operator | authoritative_filing / City of Austin | frs_affiliation / **CITY OF AUSTIN DBA AUSTIN ENERGY** |
| Operator | authoritative_filing / City of Austin | frs_affiliation / **TIC - THE INDUSTRIAL COMPANY** |
| Operator | authoritative_filing / City of Austin | frs_affiliation / **T. MORALES COMPANY, L.L.C.** |

The weaker claim exists **only as a denormalized name string inside the conflict row**. "EPA FRS
says AUSTIN ENERGY is the operator" is not a row in any relationship table, has no company row, no
identifier, no temporal window, and cannot be rendered, corroborated later, or promoted if TCEQ is
found stale. **Storage truth and display arbitration are the same thing today** — the loser is
discarded at write time. That is precisely what Part 7 forbids.

(Also note row 2: "CITY OF AUSTIN DBA AUSTIN ENERGY" vs "City of Austin" is flagged as a *conflict*
when it is more likely the same entity under a d/b/a — an entity-resolution question the model has
no way to express.)

## 1.7 Two source-registry regimes, neither in the database

**Declarative** — `supabase/functions/get-address-report/jurisdiction-registry.json`, 12,489 lines,
**183 entries** (155 arcgis + 22 socrata + 3 ckan + 1 csv + 1 carto + 1 opendatasoft). Genuinely
good: `coverage: [{state, county}]`, `column_map`, verbatim `status_to_bucket`, `type_map`,
`record_url_precision`, `recency_days`, `_receipts` on all 155 arcgis entries. Its own README states
the correct principle: *"COVERAGE GROWS BY APPENDING ENTRIES, NEVER BY WRITING CONNECTOR CODE."*

**Hardcoded** — every high-value entity-bearing source is outside it:
- TCEQ: `const isTx = communities.some(c => /^(tx|texas)$/i.test(c.state))` plus a
  `TX_COUNTY_DATASET` object literal in `sources/tceq-cr.ts`.
- TDLR TABS: per-county pinned JSON at `docs/pins/tdlr-tabs-projects.<county>.json`.
- EPA FRS / ECHO / CWA permits: no coverage entry at all (national floor, gated in `index.ts`).

**Neither registry is a database entity.** `development_reports.sites[].source_registry_id` is a
string pointing into a JSON file inside an edge-function bundle. The database therefore cannot
answer *"which sources apply to this property"*, *"when did source X last succeed here"*, or
*"was source X checked and empty, or never checked"* — except through the partial
`dev_refresh_source_failures` log (54,396 rows) and per-report `sources_checked` arrays.

## 1.8 Raw source preservation is partial and inconsistent

| Table | Rows | Scope |
|---|---|---|
| `source_fetch_cache` | **5** | one source only — `select distinct source` → `{tdlr_tabs}` |
| `tceq_affiliations_raw` | 9,617 | TCEQ only, RLS **disabled** |
| `company_esg_raw` | 94 | ESG only |
| `frs_org_affiliations` | 41 | normalized, but carries `source_file` / `source_version` / `retrieved_at` |

The 3.03M `app_projects` rows and 12,722 `development_reports` rows have **no raw payload behind
them** — only `provenance` metadata (`src`, `case_number`, `canonical_addr`, `refreshed_at`,
`source_vintage`). A parser fix cannot be replayed; it requires re-fetching every source.

## 1.9 Texas leaked into the read model

`app_project_track_record()` builds its facility rollup with `'state', 'TX'` **hardcoded as a
literal**, and `company_facilities.state` is `TX` on all 754 rows. The function is national by
name and Texan by construction.

## 1.10 What is already right — preserve all of this

1. **Abstention is real and enforced.** `company_parents.verification` ∈
   `{not_yet_asked, unverified_candidate, verified}`, with a CHECK that makes `parent_name`
   storable **only** on a verified row. Live: 8 rows — 1 verified (Martin Marietta Southwest →
   Martin Marietta Materials, Inc., SEC EX-21.01 accession `0001193125-26-059193`), 6
   `unverified_candidate` **with `parent_name` NULL**, 1 `not_yet_asked`. `app_company_parent()`
   returns `{"verification":"not_yet_asked"}` rather than silence.
2. **A categorical evidence ladder already exists** — `evidence_tier_rank()`:
   `identifier_backed(1) > authoritative_filing(2) > frs_affiliation(3) > candidate(4)`. No numeric score.
3. **Companies are not fuzzy-merged.** "Neuralink", "Neuralink Corporation" and SEC registrant
   "Neuralink Corp." (CIK 0001708503) are **three separate rows**, and the SEC row's note reads
   *"Holds NO role on any 78617 record… Recorded so the search is on the record."*
4. **Negative results are recorded as data**, not absence: `track_record_checks` (17),
   `company_match_rejections` (6), `tceq_rejected_entities` (34), `property_reports.sources_checked`,
   `company_esg_matches.lookup_status` ∈ {checked_no_data 51, ambiguous_rejected 3, matched 1}.
5. **Track-record attribution is already three-level** — `company_track_events.attribution` ∈
   `{direct_company, parent_company}` plus the facility-ref join for *this facility*.
6. **ESG already consumes the resolved identity** (`company_esg_matches.company_key` /
   `parent_of_key` / `attribution`) rather than fuzzy-searching a facility name.
7. **Coverage gating works** and is bidirectionally proven in CI.
8. **The Utah reconciliation table is a proto-conflict model** —
   `resolved_project_parcel_reconciliation` compares our anchor set against MIDA Exhibit A and
   records a founder `ruling` per row: `in_both/apn_exact/verified` 53, `mida_only/candidate` 46
   ruled `reject_anchor`, `mine_only/candidate` 29 ruled `keep`. Two sources, both preserved,
   arbitration explicit and human. **That is the right shape** — it just exists once, for one
   project, for one predicate.

## 1.11 The migration gift: the identity graph has zero UI consumers

```
$ grep -rn "app_project_identity\|app_project_track_record\|app_project_sustainability\|\
app_project_frs_identity\|v_app_project_companies\|v_app_project_identity" \
  --include="*.html" --include="*.js" --include="*.mjs" --include="*.ts" . | grep -v "^./docs/"
(no matches)
```

Only `app_projects.facility_env` (a denormalized blob) renders, in `development.html`, `maps.html`
and `lib/templates.js`. **The entire company/role/track-record/ESG layer can be restructured with
no user-visible blast radius.** This is why the migration in Part 14 can be non-destructive and
still not be slow.

---

# PART 2 — PROBLEMS WITH THE CURRENT ARCHITECTURE

| # | Problem | Evidence | Severity |
|---|---|---|---|
| P1 | Evidence keyed to a regenerated UUID | 48/66 orphans | **Active data loss** |
| P2 | No parcel entity outside Utah; `tx_parcels` empty | 0 rows; TCAD absent | Blocks the whole Property section |
| P3 | Source role vocabularies collapsed into HomeSignal roles at write time | `role='Property Owner'` from a TDLR OWNER block | **Meaning loss, unrecoverable** |
| P4 | Derived/source strings stored in fact columns | `developer = 'EPA FRS · registry …'` | Fabrication-adjacent |
| P5 | Losing claims discarded to text | `identity_conflicts.weaker_company` | Violates "never overwrite evidence" |
| P6 | Company identity keyed on a normalized **name** | `select count(*) from companies where company_key <> app_company_key(canonical_name)` → **0** | Name change = new entity; merges have nowhere to go (`company_aliases` = 0) |
| P7 | Source registry is a file, not data; half the sources aren't even in it | 183 declarative vs 5 hardcoded | Can't answer "what applies here" |
| P8 | Raw payloads kept for 1 of ~190 sources | `source_fetch_cache` = 5 rows | No replay, no audit |
| P9 | Jurisdiction assumptions in shared code | `'state','TX'` literal; `TX_COUNTY_DATASET`; APN as a bare column | Blocks state #2 |
| P10 | Three role vocabularies, none declared | §1.4c | Every new source adds a fourth |
| P11 | Currency inferred from missing end date | FRS `end_date` null ⇒ treated as current | Known-unsafe (stated in the task) |
| P12 | Two entity-resolution questions have no home | "River Bottoms Ranch" vs "…LLC"; "City of Austin" vs "CITY OF AUSTIN DBA AUSTIN ENERGY" | Alias table exists but empty and evidence-only |

**The unifying diagnosis:** the system converts *what a source said* into *what HomeSignal
believes* **at write time**, in adapter code, and throws the input away. Every problem above is a
consequence of that one choice.

---

# PART 3 — PROPOSED CONCEPTUAL MODEL

## 3.1 Principle

> **A source record is an observation. HomeSignal stores observations verbatim, and derives
> beliefs from them at read time under an explicit, inspectable policy.**

Adapters may never write a HomeSignal belief. They write: *this source, at this URL, retrieved at
this time, said this string in this field about this identifier.* Everything else is derived and
recomputable.

## 3.2 The six real-world entity kinds

Typed tables (not one universal `core_entity` with hundreds of nullable columns — Part 28). Each
entity table is **deliberately thin**: a surrogate id, the kind, the jurisdiction, and the minimum
needed to *find* and *place* the thing. Every describable attribute is a claim.

| Entity | Is | Thin core holds | Does **not** hold |
|---|---|---|---|
| `parcel` | A legally/administratively identified piece of land | id, jurisdiction (state+county+authority), display geometry ref | APN, owner, acreage, legal description, situs |
| `development` | A proposed/approved/built/completed development activity | id, jurisdiction | case number, status, applicant, developer, dates |
| `facility` | A physical operating or regulated facility | id, jurisdiction, display point ref | FRS id, RN, operator, programs |
| `organization` | A legal or organizational entity | id, kind (company/government/individual-as-filer) | name(!), parent, jurisdiction of formation |
| `instrument` | A recorded document — deed, easement, lien, plat, covenant | id, recording jurisdiction | instrument number, type, date, grantor/grantee |
| `place` (existing `communities`) | The civic geography backbone | unchanged | — |

**Yes — even the name is a claim.** `organization` has no `name` column. "Neuralink" (TDLR
2024022676), "Neuralink Corporation" (TDLR 2026011928) and "Neuralink Corp." (SEC CIK 0001708503)
become three `organization` entities each carrying `has_name` claims from their own sources, plus
zero, one or two `same_entity_as` resolutions with evidence. That is exactly today's behaviour —
made structural instead of conventional. For rendering, an organization exposes a *preferred
display name*, which is an arbitration output (Part 7), not a stored fact.

## 3.3 Relationships are claims, not columns

Every line in the founder's brief — "occurs on parcel(s)", "project owner as filed", "operates
facility", "corporate parent" — is the same shape:

> **Source S, in record R, states that entity A stands in relation P to entity B (or to literal
> value V), over validity window W, observed at time T.**

One structure carries all of them.

---

# PART 4 — PROPOSED EVIDENCE / CLAIM MODEL

## 4.1 The central decision: one `claim` table, not `relationship` + `relationship_evidence`

**Recommended: the claim is the row.** Two sources asserting "X operates facility F" are **two
claims that corroborate**, not one relationship with two evidence rows.

**Why, concretely.** A `relationship` + `evidence` split forces you to decide *the relationship
exists and these two evidences are about it* before you can store either. But that decision is
itself entity resolution — and §1.6 shows we get it wrong: "City of Austin" and "CITY OF AUSTIN
DBA AUSTIN ENERGY" were filed as a **conflict** when they are plausibly a d/b/a of the same body.
Under `relationship`+`evidence`, that mistake is baked into the primary key. Under claims,
corroboration is a **derived grouping** that can be recomputed the moment entity resolution
improves, without rewriting one byte of evidence.

**Honest tradeoffs.**

| | Claim-as-row (recommended) | Relationship + evidence |
|---|---|---|
| Corroboration | derived, recomputable | structural, cheap to read |
| Wrong resolution | fixable by recompute | requires data migration |
| Row count | higher (one per source assertion) | lower |
| Read cost | needs a materialized read model (Part 13) | direct |
| "What does the county say?" | trivially answerable | needs an evidence join anyway |
| Retracting a source | flip claim status | may orphan a relationship |

The read cost is real and is why Part 13 is not optional. But HomeSignal's *product* is
"every claim traceable to evidence" — the storage model should make that the easy case.

## 4.2 `claim` — proposed shape

```
claim
  claim_id                 uuid pk
  source_record_id         → source_record        NOT NULL   -- every claim has exactly one origin
  subject_entity_id        → entity               NOT NULL
  subject_kind             enum                              -- denormalized for index locality
  predicate                → predicate(key)        NOT NULL   -- HomeSignal's stable vocabulary
  object_entity_id         → entity               NULL       -- for entity→entity claims
  object_value             text                   NULL       -- for entity→literal claims
  object_value_normalized  text                   NULL       -- formatting only (Part 17)
  object_unit              text                   NULL       -- 'acres', 'sqft', 'USD'
  -- what the SOURCE said, verbatim
  source_predicate_raw     text                   NOT NULL   -- 'OWNER/OPERATOR', 'OWNER block', 'PROP_ID'
  source_object_raw        text                   NULL       -- 'RIVER BOTTOMS RANCH LLC'
  -- temporal (Part 11)
  valid_from               date                   NULL       -- as STATED by the source
  valid_to                 date                   NULL       -- as STATED by the source
  currency_basis           enum                   NOT NULL   -- see §8.2
  as_of                    date                   NULL       -- the vintage the source itself claims
  observed_at              timestamptz            NOT NULL   -- when we retrieved it
  -- classification (Part 18 / Part 7) — all categorical, no numeric score
  evidence_class           enum                   NOT NULL
  authority_class          enum                   NOT NULL   -- derived from source_authority at write
  fact_kind                enum                   NOT NULL   -- source | normalized | resolved | derived
  status                   enum                   NOT NULL   -- active | superseded_by_source
                                                             -- | retracted_by_source | rejected_by_homesignal
  status_reason            text                   NULL
  notes                    text                   NULL
```

**Invariants worth enforcing in DDL:**
- exactly one of `object_entity_id` / `object_value` is non-null;
- `fact_kind='derived'` ⇒ `source_record_id` points at a HomeSignal derivation record, never at an
  agency record (this is the schema-level version of "derived facts must never masquerade as
  government-source facts");
- `source_predicate_raw` NOT NULL — you may not write a claim without recording what the source
  actually called it.

## 4.3 `claim_relation` — how claims relate to each other

```
claim_relation(claim_a, claim_b, kind, basis, evidence_note, decided_at, decided_by)
  kind ∈ corroborates | contradicts | supersedes | refines | duplicate_of
```

Conflicts are **derived** (claims sharing subject+predicate+overlapping window with different
objects) and then optionally **ruled** by writing a `claim_relation`. Today's `identity_conflicts`
becomes a view over this, and — crucially — the losing claim is a real claim with a real entity,
a real identifier and a real URL, not a text field.

## 4.4 `evidence_class` — categorical, extending what exists

The current ladder is right but is missing the concept that would have prevented the Part 1.4a bug:

| class | meaning | example |
|---|---|---|
| `register_of_record` | **the** agency whose record legally *is* the fact, for this predicate in this jurisdiction | TCAD for property ownership in Travis Co.; the County Recorder for a deed |
| `identifier_backed` | a source-issued stable identifier ties the claim to a record | TCEQ RN↔CN affiliation |
| `authoritative_filing` | a filing made *to* an agency *by* a private party — authoritative about **what was filed**, not about the world | TDLR TABS OWNER block |
| `regulatory_affiliation` | an agency's administrative association list | FRS org affiliations |
| `published_statement` | an entity's own published document | SEC EX-21.01 |
| `derived` | HomeSignal computed it | geometry centroid, spatial containment |
| `candidate` | surfaced, not established | SEC full-text-search hit |

**`register_of_record` is the missing idea.** It is a property of *(source × predicate ×
jurisdiction)*, not of the source alone — TDLR is `register_of_record` for "this project was filed
and reviewed" and merely `authoritative_filing` for "who owns this land." Encoding that in the
source registry (Part 6) is what makes arbitration principled instead of ad hoc, and it is the
structural fix for the "Property Owner" collapse.

---

# PART 5 — PROPOSED IDENTIFIER MODEL

## 5.1 `identifier_type` — a registry of identifier kinds (this is the part that is usually skipped)

Identifiers are not interchangeable, and the *reason* is not just "different names": they identify
**different entity kinds** and are **unique in different scopes**. `PROP_ID 292354` is unique
within Travis County; `59:030:0008` within Utah County; `FRS 110070182593` nationally.

```
identifier_type
  id_type            text pk        -- 'tcad.prop_id', 'utah.county_parcel_no', 'epa.frs_registry_id',
                                    -- 'tceq.rn', 'tceq.cn', 'sec.cik', 'tdlr.tabs_project_no',
                                    -- 'travis.instrument_no', 'lei', 'ein', 'duns'
  identifies_kind    enum           -- parcel | facility | organization | development | instrument
  issuing_authority  text           -- 'Travis Central Appraisal District', 'US EPA', 'SEC'
  uniqueness_scope   enum           -- global | state | county | authority_dataset
  scope_state        text NULL
  scope_county       text NULL
  normalizer         text NULL      -- named, versioned normalizer ('strip-colons', 'zero-pad-10')
  is_stable          boolean        -- does the authority reuse/recycle it?
  notes              text
```

## 5.2 `entity_identifier`

```
entity_identifier
  entity_id, entity_kind, id_type → identifier_type, id_value, id_value_normalized,
  source_record_id, first_seen_at, last_seen_at, status (active|superseded|rejected)
  unique (id_type, id_value_normalized) WHERE status='active'   -- uniqueness scope lives in the type
```

**This directly answers Part 5's warning.** `PROP_ID 292354` and `FRS 110070182593` cannot be
confused, because `tcad.prop_id.identifies_kind = parcel` and
`epa.frs_registry_id.identifies_kind = facility` — the type declares the entity kind, and a
mismatch is a constraint violation rather than a silent false join.

**Del Valle would carry four parcel identifiers on ONE parcel entity** — `tcad.prop_id 292354`,
`tcad.geo_id 0315600221`, `travis.account_id 9321348`, `travis.tax_office_ref 03156002210000` —
none of them a column, all of them queryable, and each traceable to the source record that stated it.

## 5.3 Entity resolution, kept separate from identity

```
entity_resolution(entity_a, entity_b, kind, basis, evidence_source, evidence_url,
                  evidence_document, decided_at, decided_by, status)
  kind ∈ same_entity | dba_of | successor_of | not_same_entity
```

Two rows are **never merged**. `not_same_entity` is a first-class outcome (today's
`company_match_rejections` / `tceq_rejected_entities` / `company_esg_matches.ambiguous_rejected`
fold in here). "Neuralink" and "Neuralink Corporation" stay two entities with **no** resolution row
until a filing establishes one — identical to today's behaviour, now expressible.

---

# PART 6 — PROPOSED SOURCE-ADAPTER MODEL

## 6.1 The adapter contract

An adapter does exactly five things and **may not** do a sixth:

1. **Fetch** — under a coverage gate it does not itself define.
2. **Persist raw** → one `source_record` per upstream record (or per fetch, for bulk).
3. **Extract identifiers** → `(id_type, raw value)` pairs, using types the source registry declares.
4. **Emit candidate claims** → `(subject id-ref, source_predicate_raw, object id-ref or literal,
   stated window, as_of)`. **In the source's own vocabulary.**
5. **Report** — `checked / found_n / empty / error / truncated` per source per subject.

**Forbidden:** choosing a HomeSignal `predicate`, choosing an `evidence_class`, deciding which
existing entity a record refers to, deciding a conflict, or writing to a read model.

Steps 3→4 are mapped into HomeSignal vocabulary by **data**, not code:

```
source_role_map(source_id, source_vocab_field, source_vocab_value,
                predicate, class, parent_candidate, notes)
  class ∈ current_identity | historical_identity | evidence_detail | not_relevant
```

This is **`frs_affiliation_role_map` generalized**, with `source_id` added. Its 39 rows migrate in
as `source_id='epa_frs'` unchanged. TDLR then gets rows like:

| source | field | value | predicate | class |
|---|---|---|---|---|
| tdlr_tabs | OWNER block | Owner Name | `project_owner_as_filed` | current_identity |
| tdlr_tabs | — | Design Firm | `design_firm` | current_identity |
| tdlr_tabs | — | Filed By | `filed_by` | evidence_detail |
| tdlr_tabs | — | Contact | *(none)* | not_relevant |

and TCAD gets `Owner Name → property_owner_of_record / current_identity`. **The Part 1.4a defect
becomes impossible to reintroduce**, because no code path maps a TDLR field to a property-ownership
predicate.

## 6.2 Adapter families already proven, reused unchanged

`arcgis`, `socrata`, `ckan`, `csv`, `carto`, `opendatasoft` — 183 registry entries and the
connector code stay exactly as they are. They gain an optional `emits` block declaring which
identifiers and predicates a given entry yields; entries without one keep behaving as today
(development records only). **Nothing in the current Maps pipeline needs to change to adopt this.**

---

# PART 7 — CONFLICTS: STORAGE TRUTH vs DISPLAY ARBITRATION

## 7.1 Storage never arbitrates

Every claim is stored. Nothing is overwritten. Disagreement is represented by *two active claims*,
not by one survivor. `claim.status` changes only for reasons **the source or the founder gives**:

| status | means |
|---|---|
| `active` | the source still asserts it as of our last retrieval |
| `superseded_by_source` | the same source now says something else (new vintage) |
| `retracted_by_source` | the source withdrew the record |
| `rejected_by_homesignal` | a human/rule ruled it wrong — **with reason, still queryable** |

## 7.2 Display arbitration is a separate, declarative policy

```
display_precedence(predicate, authority_class, evidence_class, rank, jurisdiction_scope, notes)
source_authority(source_id, predicate, jurisdiction_scope, authority_class)
     authority_class ∈ register_of_record | regulator | filing_receiver | publisher | aggregator
```

Arbitration is then a pure function: `claims → (winner, corroborators, contradictors, rank basis)`.
Because it is a function of data, changing policy re-derives the display without touching evidence,
and the UI can always show *why* this claim won.

## 7.3 The six states the model must express — and how

| State | Representation |
|---|---|
| **Agreement** | ≥2 active claims, same subject/predicate/object, different `source_record_id` |
| **Corroboration** | as above, across different `source_id` — the strongest signal we have |
| **Superseded** | `claim_relation(kind='supersedes')` or `status='superseded_by_source'` |
| **Historical** | `valid_to` in the past, or `source_role_map.class='historical_identity'` (FRS FORMER OWNER) |
| **Unresolved conflict** | ≥2 active contradicting claims, no `claim_relation` ruling |
| **Rejected match** | `entity_resolution(kind='not_same_entity')` or `claim.status='rejected_by_homesignal'` |

**No numerical confidence score.** The evidence *does not* justify one — the existing system
already proves categorical works (`evidence_tier_rank`, `verification`, `match_confidence`,
`geom_status`), and a number would invite arithmetic on incommensurable things. Where the founder
must decide, the decision is stored as a **ruling** (the pattern
`resolved_project_parcel_reconciliation.ruling` already uses: `keep` / `reject_anchor` / `pending`).

---

# PART 8 — TEMPORAL MODEL

## 8.1 Four distinct time fields, never conflated

| field | question | example |
|---|---|---|
| `valid_from` / `valid_to` | when the **source says** the relation held | FRS `START_DATE 2012-08-01` |
| `as_of` | the vintage the **dataset** claims | "Tax_Parcels_07_2025" |
| `observed_at` | when **we** retrieved it | `retrieved_at` |
| `recorded_at` | when the **authority recorded** it | deed `2021024697` recorded 2021-02-03 |

## 8.2 `currency_basis` — the FRS lesson, made structural

Missing `valid_to` must never be read as "still current."

| `currency_basis` | means | may be displayed as current? |
|---|---|---|
| `source_states_current` | the source explicitly marks it open/active | **yes** |
| `source_states_end_date` | closed window, explicit | no — historical |
| `snapshot_only` | source is a point-in-time extract; silence ≠ currency | **no**, unless corroborated at same-or-newer vintage |
| `unknown` | source says nothing about time | **no** |

Every FRS affiliation with `end_date IS NULL` is `snapshot_only`, not current. The existing
`company_facilities.affiliation_open` flag is the right instinct; this makes it a first-class,
per-claim, four-valued property rather than a boolean.

## 8.3 Ownership history falls out for free

A parcel's ownership history is `select … from claim where subject=parcel and
predicate='property_owner_of_record' order by valid_from` — TCAD's current owner, the 2021 deed's
grantee, and any prior deed, each with its own source. No separate history table.

---

# PART 9 — JURISDICTION-AWARE SOURCE DISCOVERY

## 9.1 Source registry as data

```
source(source_id, name, agency, agency_level, platform, domain, access_mode,
       refresh_cadence, licensing, terms_url, is_first_party, status, notes)

source_coverage(source_id, scope_kind ∈ national|state|county|city|custom_geometry,
                state, county, place, geom, effective_from, effective_to)

source_capability(source_id, entity_kind, predicate, id_type, field_availability, notes)
     -- "TCAD yields: parcel identifiers {prop_id, geo_id, account}, predicates
     --  {property_owner_of_record, has_acreage, has_legal_description, has_situs}"

source_authority(source_id, predicate, jurisdiction_scope, authority_class)

source_health(source_id, scope_key, last_attempt_at, last_success_at, last_status,
              consecutive_failures, last_error, records_last_run)
```

Then *"which authoritative sources apply to 2200 Caldwell Ln?"* is one query:
`source_coverage` ⋈ (state='TX', county='Travis') → **TCAD · Travis County GIS · Travis County
Clerk · TDLR TABS · TCEQ CR · EPA FRS · EPA ECHO** — and for a Utah ZIP the same query returns
the county assessor/GIS, the recorder, Utah PMN, Utah DWRi and EPA. No ZIP-specific logic anywhere.

## 9.2 Keeping the JSON file as the editable artifact

The edge function must gate coverage without a DB round-trip, and the repo already has a proven
pattern for exactly this — the ingest repo's Gold Master workbook → generated registry → **CI
parity gate**. Recommend the same here: `jurisdiction-registry.json` stays the human-edited
artifact and CI-enforced source of truth; the `source*` tables are a **generated projection**
checked for parity in CI. This is additive and does not disturb the 183 working entries. The five
hardcoded sources (FRS, ECHO, CWA, TCEQ, TDLR) get first-class registry entries as part of that
work — which is itself worth doing, since today they are invisible to any coverage question.

---

# PART 10 — MULTI-PARCEL / MULTI-FACILITY

All of these are claims; none is a foreign-key column:

| Relation | Predicate | Cardinality |
|---|---|---|
| Development ↔ Parcel | `occurs_on_parcel` | many-to-many |
| Facility ↔ Parcel | `located_on_parcel` | many-to-many |
| Parcel ↔ Instrument | `conveyed_by_instrument`, `encumbered_by_instrument` | many-to-many |
| Organization ↔ Facility | `operates_facility`, `owns_facility` | many-to-many, **over time** |
| Organization ↔ Development | `project_owner_as_filed`, `developer`, `applicant`, `design_firm`, `contractor` | many-to-many **by role** |
| Parcel ↔ Parcel | `split_from`, `merged_into` | lineage (replaces `resolved_projects.apn_lineage`) |

**Address is never a join key.** It becomes `has_situs_address` (a claim) and a search path via
`geocodes`. Note the existing `property_reports` table is keyed on
`address = '2200 CALDWELL LN, DEL VALLE, TX 78617'` — a canonicalized string — which is precisely
the fragile join this replaces. Joins run on identifiers, `entity_resolution`, and spatial
containment (`derived` claims, honestly labelled).

The Stratos parcel `05-007-0002` carrying
`"STRADDLE: physically in ZIP 84307 (Corinne) by geometry; KEPT in anchor"` is the multi-parcel
case already appearing in production. Under the proposed model that note becomes two claims
(`in_zip 84307`, basis `direct-geometry`, `derived`; `part_of_assembly stratos`, basis
`same-owner`, `derived`) instead of prose in a `note` column.

---

# PART 11 — SOURCE FACT vs DERIVED FACT

`claim.fact_kind` — four values, and the boundary is enforced:

| `fact_kind` | definition | Del Valle / Utah example |
|---|---|---|
| `source` | the record literally states it | TCAD `OWNER_NAME = RIVER BOTTOMS RANCH LLC` |
| `normalized` | formatting only, reversible, no new information | → `River Bottoms Ranch LLC`; `59:030:0008` → `590300008` |
| `resolved` | HomeSignal concluded two identities are the same, on permitted evidence | `same_entity` between a TCEQ CN and an SEC registrant |
| `derived` | computed or inferred | polygon centroid; `zip_basis='adjacency-ZCTA-gap'`; spatial containment |

Every claim keeps `source_object_raw` alongside `object_value_normalized`, so the verbatim string
is always recoverable. `derived` claims must cite a **HomeSignal derivation record** (method +
version + inputs) as their `source_record`, never an agency URL — that is the schema-level
guarantee that a derived fact can never present as a government-source fact.

This also fixes §1.4b properly: `"EPA FRS · registry 110002595488"` is not a developer name, it is
a **source attribution**, and in the new model it simply has nowhere to be written as one.

---

# PART 12 — DATA QUALITY / ABSTENTION

Seven states, all distinct, none collapsible:

| State | Where it lives |
|---|---|
| `verified` | claim exists, `evidence_class ∈ {register_of_record, identifier_backed}` |
| `reported` | claim exists, `evidence_class = authoritative_filing` |
| `unresolved` | claims exist; arbitration produced no winner (tie or no precedence rule) |
| `conflicting` | ≥2 active contradicting claims |
| `unavailable` | `source_check(status='error')` — **the source failed, we do not know** |
| `not_checked` | **no `source_check` row at all** for (source, subject) |
| `checked_empty` | `source_check(status='ok', found_n=0)` — genuinely no record |

```
source_check(source_id, subject_entity_id | subject_key, checked_at, status, found_n,
             query_basis, source_url, error, parser_version)
```

This generalizes `track_record_checks` (17 rows) and `property_reports.sources_checked` — both of
which already do this correctly for their own corner. The distinction the founder insists on —
*"not checked" ≠ "no records found"* — becomes the difference between **row absent** and
**row present with `found_n=0`**, which is impossible to blur. Likewise `unverified_candidate`
never becomes `parent company`, because a candidate is a claim with `evidence_class='candidate'`
and no precedence rule promotes it.

---

# PART 13 — CONSUMER ROLE VOCABULARY (`predicate`)

A versioned vocabulary table with a stable key, a consumer-facing label, and — critically — a
**definition** and an **explicit non-meaning**.

| domain | predicate | consumer label | explicit non-meaning |
|---|---|---|---|
| land | `property_owner_of_record` | Property owner | not the project filer, not the operator |
| land | `former_property_owner` | Former owner | — |
| land | `conveyed_by_instrument` | Deed | — |
| development | `developer` | Developer | not the landowner |
| development | `applicant` | Applicant | — |
| development | `project_owner_as_filed` | **Project owner (as filed)** | **not evidence of land ownership** |
| development | `contractor` | Contractor | not the operator |
| development | `design_firm` | Design firm | — |
| development | `filed_by` | Filed by | an individual filer, not a party |
| facility | `facility_owner` | Facility owner | not a deed to the parcel |
| facility | `operates_facility` | Operator | — |
| facility | `former_operator` | Former operator | — |
| corporate | `parent_company` | Parent company | — |
| corporate | `subsidiary_of` | Subsidiary | — |

`project_owner_as_filed` is the predicate that does not exist today and whose absence caused the
only genuine meaning-loss defect in the audit. The vocabulary is **stable across sources**: adding
TCAD adds `source_role_map` rows, not predicates.

---

# PART 14 — TRACK RECORD ATTRIBUTION

Preserved exactly, and made stricter. `company_track_events.attribution ∈ {direct_company,
parent_company}` plus the facility-ref join already gives the three levels. Under the new model:

| level | rule |
|---|---|
| **This facility** | event's facility identifier ∈ the subject facility's `entity_identifier` set |
| **Direct company** | event facility ⟵ `operates_facility`/`owns_facility` claim ⟶ same organization entity, **and the claim's validity window overlaps the event date** |
| **Parent company** | a `parent_company` claim with `evidence_class='published_statement'` (or better) and `verification='verified'` authorizes the inherited label — which travels **with the edge**, exactly as `app_company_parent()` already does via `'attribution','parent_company'` |

Three hard rules, all inheriting today's behaviour:
1. **A property owner, project owner, operator or parent never inherits another entity's history
   without an explicit verified relationship claim** authorizing it.
2. **Temporal gating is new and necessary**: an event at a facility during a *former* operator's
   tenure must not attach to the current operator. Today's model cannot express this because the
   affiliation has no reliable window; `currency_basis` + `valid_from/to` make it checkable.
3. `'state','TX'` comes out of the rollup — it becomes a group-by over the facility entity's
   jurisdiction.

---

# PART 15 — SUSTAINABILITY STAYS DOWNSTREAM

Unchanged in principle, cleaner in mechanism:

```
parcel/development/facility → arbitrated company role (Part 7)
                            → organization entity
                            → verified parent claim (if any)
                            → ESG lookup keyed on the ENTITY, not a name string
```

`company_esg_matches` already carries `company_key`, `parent_of_key`, `attribution`,
`identity_tier` and `lookup_status`; it re-keys from `company_key` to `entity_id` and otherwise
stands. **ESG performs no company resolution** — and under this model it structurally cannot, since
the only handle it receives is an entity id. Direct-vs-parent attribution is carried on the claim,
so a parent's score can never render as the site operator's.

---

# PART 16 — RAW SOURCE PRESERVATION

```
source_record(source_record_id, source_id, source_record_key, url, http_status,
              retrieved_at, parser_version, payload_hash, payload jsonb|text NULL,
              payload_storage ∈ inline|object_store|hash_only,
              superseded_by → source_record, as_of)
```

Every claim FKs to exactly one `source_record`. Re-parsing = new claims from existing records
(no re-fetch); a source correction = a new `source_record` + `superseded_by`, old claims flipped to
`superseded_by_source` — **never deleted**.

**Storage policy is tiered, because the volumes differ by three orders of magnitude:**

| tier | sources | policy | rationale |
|---|---|---|---|
| **Entity-bearing** | assessor, recorder, corporate registry, TCEQ CR, FRS, TDLR | **retain payload inline** | low volume, high value, the facts that need audit |
| **High-volume permits** | the 183 arcgis/socrata/ckan/csv/carto entries | `hash_only` + the normalized projection; re-fetchable | 3.03M `app_projects` rows today; at ~2 KB/payload that is ~6 GB of raw for records already fully projected |
| **Bulk reference** | ZCTA, address points | not stored per-record; pinned dataset vintage | already how `zipcodes v3.0.0` is handled |

Concretely: `source_fetch_cache` (5 rows, `tdlr_tabs` only) is already the tier-1 pattern —
generalize it and give it `parser_version` + `payload_hash`.

---

# PART 17 — DEL VALLE UNDER THE PROPOSED MODEL

Entities are shown with their real, audited data. **Bracketed `[NOT IN SYSTEM]` marks facts stated
in the task brief that this audit confirmed are absent from the database** (§1.2) — they are drawn
to show the model can hold them, not to imply they are stored.

```
ENTITY parcel:P1                         jurisdiction = US/TX/Travis
 ├ entity_identifier
 │   tcad.prop_id          292354            [NOT IN SYSTEM — needs a TCAD adapter]
 │   tcad.geo_id           0315600221        [NOT IN SYSTEM]
 │   travis.account_id     9321348           [NOT IN SYSTEM]
 │   travis.tax_office_ref 03156002210000    [NOT IN SYSTEM]
 │
 ├ CLAIM  has_situs_address "2200 CALDWELL LN 78617"     src TCAD   source           [NOT IN SYSTEM]
 ├ CLAIM  has_acreage       36.474 acres                 src TCAD   source           [NOT IN SYSTEM]
 ├ CLAIM  has_legal_description "ABS 18 NAVARRO J A ACR 36.474"     source           [NOT IN SYSTEM]
 │
 ├ CLAIM  property_owner_of_record → org:RiverBottomsRanchLLC_TCAD
 │          source_predicate_raw "OWNER_NAME"  ·  source_object_raw "RIVER BOTTOMS RANCH LLC"
 │          evidence_class register_of_record  ·  authority_class register_of_record
 │          currency_basis source_states_current  ·  as_of <appraisal year>            [NOT IN SYSTEM]
 │
 └ CLAIM  conveyed_by_instrument → instrument:2021024697                                [NOT IN SYSTEM]

ENTITY instrument:2021024697             jurisdiction = US/TX/Travis (County Clerk)
 ├ entity_identifier  travis.instrument_no 2021024697
 ├ CLAIM  instrument_type "Warranty Deed"          recorded_at 2021-02-03
 └ CLAIM  grantee → org:RiverBottomsRanchLLC_TCAD  evidence_class register_of_record

ENTITY development:D1 "ATX1 - Third Floor Tenant Improvement"       ✅ IN SYSTEM
 ├ entity_identifier  tdlr.tabs_project_no  TABS2026011928
 ├ source_record      https://www.tdlr.texas.gov/TABS/Projects/TABS2026011928
 │                    (app_projects 91e5cdf8-3100-491d-a6ea-08083b897a76)
 ├ CLAIM  project_owner_as_filed → org:NeuralinkCorporation_TDLR
 │          source_predicate_raw "OWNER block / Owner Name"
 │          source_object_raw    "Neuralink Corporation"
 │          evidence_class authoritative_filing   ← NOT register_of_record for land
 │          note "as stated by the filer; not corroborated against a county deed record"
 ├ CLAIM  design_firm → org:Neuralink_TDLR        (raw "Design Firm")
 ├ CLAIM  filed_by    "Kristin Lorentzen"          class evidence_detail
 ├ CLAIM  has_status  "Review Complete"            src TDLR
 └ CLAIM  occurs_on_parcel → parcel:P1             fact_kind derived
            basis "TDLR situs 2200 Caldwell Ln ⟶ TCAD situs"   [derivable once TCAD lands]

ENTITY development:D2 "Barn 2 ACT Office"  TABS2024016698           ✅ IN SYSTEM
 └ CLAIM  project_owner_as_filed → org:RiverBottomsRanchLLC_TDLR   authoritative_filing
    (+ D3 "River Bottoms Ranch Barn 2" TABS2023006449, D4 "Histology Lab" TABS2023006483,
       D5 "ATX1 New Construction" TABS2024022676 — same shape)

ORGANIZATIONS — five, deliberately unmerged (today's behaviour, now structural)
 org:NeuralinkCorporation_TDLR   has_name "Neuralink Corporation"  src TDLR 2026011928
 org:Neuralink_TDLR              has_name "Neuralink"              src TDLR 2024022676
 org:NeuralinkCorp_SEC           has_name "Neuralink Corp."        src SEC  CIK 0001708503
       entity_identifier sec.cik 0001708503 · ein 813312960 · jurisdiction NV
       ⚠ NO claim ties this registrant to any 78617 record  (verbatim from companies.notes)
 org:RiverBottomsRanchLLC_TDLR   has_name "River Bottoms Ranch LLC"
 org:RiverBottomsRanch_TDLR      has_name "River Bottoms Ranch"     (no LLC suffix)

 entity_resolution: ZERO rows. Four candidate pairs, none evidenced.
   company_parents shows 5 of these as verification='unverified_candidate' with parent_name NULL,
   method ∈ {sec_full_text_search, address_co_occurrence} — candidates, correctly not promoted.
```

**What this proves.** Five *different* relationships coexist without collapsing:
`property_owner_of_record` (TCAD, land) · `grantee` (deed, land) ·
`project_owner_as_filed` (TDLR, filing) · `design_firm` · `filed_by`. Today, three of these five
have nowhere to live and two are stored under a label that means something else. And the awkward
truth the model must survive — that TCAD's owner (River Bottoms Ranch LLC) and TDLR's filed owner
(Neuralink Corporation, on the newest filing) **are different companies, both correct** — is
represented as two claims with different predicates rather than a conflict.

## 17.1 Facility / operator / parent edges at 78617 — what is actually supported

The Del Valle facility work in the DB is not about the Caldwell parcel: `project_facility_refs`
holds 29 `EPA_FRS` + 4 `TCEQ_RN` refs for 78617, and the operator claims are TCEQ Central Registry
RN↔CN affiliations across 38 companies. The one **verified** parent edge in the entire database is:

```
Martin Marietta Materials Southwest, LLC  --parent_company-->  Martin Marietta Materials, Inc.
  evidence_class published_statement · verification verified
  SEC EX-21.01 to the FY2025 Form 10-K, filed 2026-02-19, accession 0001193125-26-059193
  quoting: "Martin Marietta Materials Southwest, LLC, a Delaware limited liability company — 100%"
```

and the live unresolved conflict (§1.6) becomes, under the proposal:

```
facility:F_AustinEnergy
 ├ CLAIM operates_facility → org:CityOfAustin_TCEQ     identifier_backed   [active]
 ├ CLAIM operates_facility → org:AustinEnergy_FRS      regulatory_affiliation, snapshot_only [active]
 ├ CLAIM operates_facility → org:CityOfAustinDbaAustinEnergy_FRS   regulatory_affiliation    [active]
 ├ CLAIM operates_facility → org:TICTheIndustrialCompany_FRS       regulatory_affiliation    [active]
 └ CLAIM operates_facility → org:TMoralesCompanyLLC_FRS            regulatory_affiliation    [active]
   arbitration → display "City of Austin" (identifier_backed > regulatory_affiliation),
                 4 contradicting claims retained, each with its own org, URL and vintage;
                 candidate entity_resolution(dba_of) between rows 1 and 3 — expressible now.
```

All five survive. Today, four exist only as text in `identity_conflicts.weaker_company`.

---

# PART 18 — UTAH UNDER THE PROPOSED MODEL

Using a real audited parcel from the 83-parcel Stratos anchor:

```
ENTITY parcel:U1                    jurisdiction = US/UT/Box Elder
 ├ entity_identifier
 │   utah.county_parcel_no  "05-006-0005"   (issuing_authority Box Elder County Assessor,
 │                                            uniqueness_scope county)
 │   boxelder.tax_account   "R0020375"
 │
 ├ CLAIM has_acreage 640.0                       src Box Elder Tax_Parcels_07_2025 · source
 ├ CLAIM property_owner_of_record → org:BarHRanchInc
 │         source_predicate_raw "OWNER"  ·  source_object_raw "BAR H RANCH INC"
 │         evidence_class register_of_record · as_of 2025-07 · currency_basis snapshot_only
 │         source_record https://services2.arcgis.com/QcxW3q3Hq3nqNMhd/.../Tax_Parcels_07_2025_for_Pictometry
 ├ CLAIM has_geometry <polygon>                   src same · source
 ├ CLAIM in_zip "84336"                           fact_kind derived · basis "direct-geometry"
 └ CLAIM part_of_assembly → development:Stratos   fact_kind derived · basis "same owner set"

ENTITY development:Stratos  (resolved_projects b3389164…, project_key 'stratos-box-elder')
 ├ CLAIM occurs_on_parcel → parcel:U1 … ×83   (in_anchor 82; one ruled out)
 ├ CLAIM governed_by → org:MIDA
 │         src Utah PMN public body 1077 · evidence_class register_of_record · verified
 │         basis "Resolution 2026-06 adopted the Stratos Project Area Plan; anchor parcels appear
 │                in the project-area parcel list (notice 1075195)"
 ├ CLAIM has_status "development_agreement"  as_of 2026-04-24
 │         src https://www.utah.gov/pmn/sitemap/notice/1075195.html
 ├ CLAIM has_status "referendum_denied"      as_of 2026-05-28  src Box Elder County Attorney · verified
 ├ CLAIM has_status "suit_filed"             as_of 2026-06-03  src Alliance for a Better Utah · candidate
 └ CLAIM has_water_right "13-4144" approved  as_of 2026-01-27  fact_kind derived
           basis "diversion point inside a project parcel"   src Utah DWRi POD FeatureServer

RECONCILIATION against MIDA Exhibit A → claim_relation rows, not a bespoke table
   53 in_both/apn_exact/verified                 → corroborates
   46 mida_only/within_mida_boundary_third_party → ruling reject_anchor  (founder, retained)
   29 mine_only                                  → ruling keep           (founder, retained)
```

**Cross-state proof.** Nothing above is Texas-shaped and nothing in Part 17 is Utah-shaped. The
model differs only in *which `identifier_type` rows exist* and *which `source_role_map` rows the
adapter uses:

| | Travis TX | Box Elder UT | Utah County UT |
|---|---|---|---|
| parcel id type | `tcad.prop_id` (+3 more) | `utah.county_parcel_no` `05-006-0005` | `utah.county_parcel_no` `59:030:0008` |
| uniqueness scope | county | county | county |
| owner source | TCAD | Box Elder ArcGIS tax parcels | Utah County Land Records NameSearch |
| deed source | Travis County Clerk | Box Elder eRecord (`erecord_url` per parcel) | — |
| governing body | (city/county) | MIDA (PMN 1077) | Eagle Mountain City (PMN 536, `probable`) |
| geometry | TCAD/GIS | ArcGIS polygon → centroid | ArcGIS polygon → centroid |

Two APN formats that cannot share a column (`05-006-0005` vs `59:030:0008`) share one
`identifier_type` with a per-county normalizer — which is exactly what `parcel_num`
(`050060005` / `590300008`) is already doing informally today.

Note also that Eagle Mountain's `governing_bodies` entry carries `confidence: 'probable'` with the
text *"land-use jurisdiction over the UTLCO anchor parcels is UNCONFIRMED — the parcels may be
unincorporated Utah County pending annexation."* Under the proposal that is a claim with
`evidence_class='candidate'` that arbitration will not promote — preserved, visible, not asserted.

---

# PART 19 — EXISTING-TABLE DISPOSITION

Nothing is deleted. Nothing is dropped in any phase of Part 21.

| Table | Rows | Disposition | Why |
|---|---|---|---|
| `communities` | 13,292 | **KEEP** | The civic geography backbone; unaffected |
| `development_reports` | 12,722 | **KEEP (read model)** | Per-ZIP cache; becomes a projection |
| `app_projects` | 3,027,784 | **EVOLVE → read model** | Must gain a **stable natural key** (P1). Otherwise unchanged; UI keeps reading it |
| `app_changes`, `app_community_meta` | 120,426 / 15,677 | **KEEP** | Derived read models |
| `property_reports` | 1 | **EVOLVE** | Re-key from canonical address string to entity id; keep address as a lookup |
| `resolved_projects` | 2 | **EVOLVE → `development`** | `apn_lineage`/`aliases`/`governing_bodies`/`evidence_timeline` jsonb become claims |
| `resolved_project_parcels` | 93 | **EVOLVE → `parcel` + identifiers + claims** | Best existing parcel data; `owner_of_record`, `acres`, `geom`, `zip_basis` → claims |
| `resolved_project_status` | 37 | **EVOLVE → claims** | Already has `confidence`/`match_basis`/`as_of`/`source_url`/`lifecycle_state` |
| `resolved_project_parcel_reconciliation` | 128 | **EVOLVE → `claim_relation` + rulings** | Right shape, wrong scope (one project, one external set) |
| `tx_parcels` | **0** | **DEPRECATE EVENTUALLY** | Empty; superseded by `parcel` before it ever carried data |
| `companies` | 45 | **EVOLVE → `organization` + `has_name` claims** | Keep every row; `company_key` becomes an alternate key, not the identity |
| `company_aliases` | **0** | **DEPRECATE EVENTUALLY** | Superseded by `entity_resolution`; empty, so free |
| `company_parents` | 8 | **EVOLVE → claims** (`parent_company`) | Verification vocabulary + the CHECK migrate as-is; **preserve the CHECK semantics** |
| `property_company_roles` | 66 | **EVOLVE → claims** | Re-predicate the 5 TDLR rows to `project_owner_as_filed`; re-anchor to stable keys |
| `project_facility_refs` | 33 | **EVOLVE → `entity_identifier`** | Already `(ref_system, facility_ref)` — an identifier table in miniature |
| `frs_affiliation_role_map` | 39 | **EVOLVE → `source_role_map`** | Add `source_id`; **this is the template** |
| `frs_org_affiliations` | 41 | **ADAPTER/STAGING** | Source-shaped, correctly so; keeps `source_file`/`source_version` |
| `v_frs_identity_roles` | view | **EVOLVE** | Becomes an adapter-side claim projection |
| `identity_conflicts` | 4 | **EVOLVE → view over contradicting claims** | Stop storing losers as text |
| `company_facilities` | 754 | **EVOLVE → claims** | Drop the implicit TX assumption |
| `company_track_events` | 61 | **KEEP + re-key** | Event rows stay; join to entities not name-keys |
| `track_record_checks` | 17 | **EVOLVE → `source_check`** | Generalize; already correct in intent |
| `company_match_rejections` | 6 | **EVOLVE → `entity_resolution(not_same_entity)`** | |
| `company_esg_matches / _data / _raw / _indicators` | 55/0/94/6 | **KEEP + re-key** | Stays downstream; `company_key` → `entity_id` |
| `esg_*`, `tceq_*_raw`, `tceq_resolved_operators`, `tceq_rejected_entities` | — | **ADAPTER/STAGING** | Correct as source-specific. ⚠ RLS disabled — see Risks |
| `source_fetch_cache` | 5 | **EVOLVE → `source_record`** | Generalize + add `parser_version`, `payload_hash` |
| `geocodes` | 98,098 | **KEEP** | Address→point service, orthogonal |
| `dev_refresh_source_failures` | 54,396 | **EVOLVE → `source_health` / `source_check`** | Already the health log |
| `echo_violation_counts` | 0 | **UNKNOWN** | Superseded by engine-v19 live ECHO; confirm before touching |
| `app_environmental_risk`, `app_properties`, `national_address_points`, `tx_address_points` | 0 | **UNKNOWN** | Empty; determine intent before disposition |

---

# PART 20 — PROPOSED CONCEPTUAL SCHEMA (no migrations)

```
── Source layer ─────────────────────────────────────────────────────────────
source(source_id pk, name, agency, agency_level, platform, access_mode,
       refresh_cadence, licensing, terms_url, is_first_party, status)
source_coverage(source_id, scope_kind, state, county, place, geom, effective_from/to)
source_capability(source_id, entity_kind, predicate, id_type, field_availability)
source_authority(source_id, predicate, jurisdiction_scope, authority_class)
source_health(source_id, scope_key, last_attempt_at, last_success_at, last_status,
              consecutive_failures, records_last_run)
source_record(source_record_id pk, source_id, source_record_key, url, http_status,
              retrieved_at, parser_version, payload_hash, payload, payload_storage,
              superseded_by, as_of)
source_check(source_id, subject_entity_id|subject_key, checked_at, status, found_n,
             query_basis, source_url, error, parser_version)
source_role_map(source_id, source_vocab_field, source_vocab_value, predicate,
                class, parent_candidate, notes)          ← generalizes frs_affiliation_role_map

── Identity layer ───────────────────────────────────────────────────────────
entity(entity_id pk, kind, jurisdiction_state, jurisdiction_county, created_at)
identifier_type(id_type pk, identifies_kind, issuing_authority, uniqueness_scope,
                scope_state, scope_county, normalizer, is_stable)
entity_identifier(entity_id, entity_kind, id_type, id_value, id_value_normalized,
                  source_record_id, first_seen_at, last_seen_at, status)
entity_resolution(entity_a, entity_b, kind, basis, evidence_source, evidence_url,
                  evidence_document, decided_at, decided_by, status)

── Typed entity cores (thin) ────────────────────────────────────────────────
parcel(entity_id pk → entity, display_geometry_claim_id)
development(entity_id pk → entity)
facility(entity_id pk → entity, display_point_claim_id)
organization(entity_id pk → entity, org_kind)
recorded_instrument(entity_id pk → entity, recording_jurisdiction)

── Evidence layer ───────────────────────────────────────────────────────────
predicate(key pk, domain, consumer_label, definition, explicit_non_meaning,
          object_kind, version)
claim(claim_id pk, source_record_id, subject_entity_id, subject_kind, predicate,
      object_entity_id, object_value, object_value_normalized, object_unit,
      source_predicate_raw, source_object_raw,
      valid_from, valid_to, currency_basis, as_of, observed_at,
      evidence_class, authority_class, fact_kind, status, status_reason, notes)
claim_relation(claim_a, claim_b, kind, basis, evidence_note, decided_at, decided_by)
claim_geometry(claim_id pk, geom)         -- PostGIS out of the hot claim table

── Arbitration + read model ─────────────────────────────────────────────────
display_precedence(predicate, authority_class, evidence_class, rank, jurisdiction_scope)
resolved_fact(subject_entity_id, predicate, winning_claim_id, display_value,
              corroborating_claim_ids[], contradicting_claim_ids[], state, computed_at)
property_card(entity_id pk, payload jsonb, computed_at)   -- one row per rendered subject
```

Roughly **20 new objects**, none of which replaces an existing table on day one.

---

# PART 21 — CONSUMER READ MODEL

Evidence integrity is not compromised for rendering — they are simply different tables.

```
claim (normalized, append-only, wide)
   ↓  arbitration function (pure: claims × display_precedence)
resolved_fact (one row per subject × predicate)
   ↓  assembly
property_card(entity_id, payload jsonb)     ← ONE row, ONE RPC, no N+1
   ↓
homesignalmap.html / property.html / maps.html
```

`property_card.payload` carries the sections in Part 24 pre-assembled, each field shaped as
`{ value, source, source_url, retrieved_at, evidence_class, state }` — so the UI renders
provenance **without knowing what TCAD, TCEQ or SEC are**. `app_projects` and
`development_reports` continue to serve Maps unchanged and are regenerated from the graph once the
graph is authoritative for their inputs.

---

# PART 22 — MIGRATION STRATEGY (non-destructive)

| Step | Action | Reversible? |
|---|---|---|
| 1 | **Stable keys first.** Give `app_projects` a deterministic natural key `(source_id, source_record_key)`; make `app_refresh_zip` upsert on it instead of delete+insert | yes — additive column + upsert |
| 2 | Create source + identity + evidence tables **empty**. Nothing reads them | yes — drop |
| 3 | **Dual-write** from adapters: existing path unchanged, plus `source_record` + claims. Feature-flagged per source | yes — flag off |
| 4 | **Backfill** the three existing models into claims (93 Utah parcels, 66 roles, 754 facilities, 61 events, 8 parents, 41 FRS affiliations, 37 statuses, 128 reconciliations) | yes — truncate new tables only |
| 5 | **Validation comparison**: assert the arbitrated `resolved_fact` reproduces today's `app_project_identity()` / `app_project_track_record()` output exactly, except the 5 rows deliberately re-predicated to `project_owner_as_filed` | — |
| 6 | Build `property_card`; UI cutover. **No UI reads the identity graph today (§1.11), so this is cheap** | yes — UI flag |
| 7 | Adapters emit claims natively; compatibility **views** keep `property_company_roles` / `company_parents` readable at their old names | yes |
| 8 | Old tables retained read-only. **No drops in this plan** | — |

**Rollback:** every step is either an additive object or a flag. The Maps experience — 12,722 ZIP
pages served from `development_reports` → `app_projects` — is untouched through step 6.

**Step 1 is worth doing immediately and independently.** It fixes present, measured breakage
(48/66 orphans) and is a precondition for everything else.

---

# PART 23 — PERFORMANCE / SCALING

**Volume estimate, grounded in real counts.** 3.03M `app_projects` rows. If permit records average
~6 claims each (title, status, type, file date, address, case number), that is ~18M claims — a
size Postgres handles routinely with the right indexes; it is roughly 6× the current largest table.

| Concern | Approach |
|---|---|
| Claim lookup | `(subject_entity_id, predicate, status)` btree; partial index `WHERE status='active'` |
| Corroboration/conflict detection | `(predicate, object_value_normalized)` + `(predicate, object_entity_id)` |
| Time queries | BRIN on `observed_at` (append-only ⇒ ideal) |
| Geometry | **out of `claim`** in `claim_geometry` with GiST — keeps the hot table narrow |
| Raw payloads | tiered (Part 16); `hash_only` for the 3M-row permit tier |
| Rendering | never query `claim` from the UI — `property_card` is one row, one RPC |
| Recompute cost | arbitration is per-subject and incremental; only subjects with new claims recompute |
| Partitioning | if claims pass ~50M, partition by `subject_kind` (already denormalized onto the row for exactly this) |
| N+1 | eliminated by construction — the card is assembled server-side, as `development_reports` already is |
| Read-model rebuild | reuse the proven `dev_refresh_*` / `app_refresh_*` batching + `pg_net` machinery |

---

# PART 24 — WHAT MUST **NOT** BE CENTRALIZED

| Stays source-specific | Why |
|---|---|
| Raw EPA / TCAD / TDLR / TCEQ payloads | `source_record.payload` — shape is the source's, not ours |
| Program-specific regulatory fields (NPDES limits, RCRA handler codes, TRI chemicals, air permit conditions) | Domain tables per program, linked to the facility entity. Never nullable columns on a universal table |
| Vendor connector quirks (`extra_where`, `out_fields`, `page_size`, `return_centroid`, `zip_where_template`) | Already correctly in `jurisdiction-registry.json`; keep them there |
| Source status vocabularies (`status_to_bucket`, `type_map`) | Verbatim per entry — the current design is right |
| Geocoding | `geocodes` stays its own service |
| ESG metric catalogs | `esg_indicator_catalog` / `esg_metric_meta` stay downstream |
| Civic alerts / meetings taxonomy | Entirely separate product surface — **not** in scope of this graph |

**Explicit anti-goal:** one enormous `entity` table with hundreds of nullable columns. The typed
cores are thin *because* attributes are claims.

---

# PART 25 — PROPERTY CARD IMPLICATION (no UI redesign)

The card consumes `property_card.payload` and knows nothing about any agency:

| Section | Source of each field |
|---|---|
| **PROPERTY** — parcel id, acreage, owner, ownership history | `resolved_fact` on the parcel entity: `has_acreage`, `property_owner_of_record` (+ prior windows) |
| **DEVELOPMENT** — project, developer, applicant, **project owner as filed**, status | claims on developments linked via `occurs_on_parcel` |
| **FACILITY** — facility, operator, facility owner, regulatory IDs | claims on facilities via `located_on_parcel`; IDs from `entity_identifier` |
| **COMPANY** — direct company, verified parent | arbitrated org roles + `parent_company` (verified only) |
| **TRACK RECORD** — facility / direct / parent | Part 14's three levels, unchanged |
| **SUSTAINABILITY** | Part 15, keyed on entity, attribution carried |
| **SOURCES & VERIFICATION** | every field's `{source, source_url, retrieved_at, evidence_class, state}`, plus `source_check` rows so "not checked" and "checked, empty" render differently |

Critically, the card can render **"Property owner: River Bottoms Ranch LLC (Travis Central
Appraisal District, PROP_ID 292354)"** and **"Project owner as filed: Neuralink Corporation
(TDLR TABS2026011928)"** as two separate, correct, non-conflicting lines. Today it can render
neither correctly.

---

# PART 26 — HOW A NEW DATABASE IS ADDED

Worked example: **a county zoning database discovered next month.**

| # | Step | Artifact | Code? |
|---|---|---|---|
| 1 | Register the source | `source` + `source_coverage(state, county)` + `source_capability` + `source_authority(predicate='has_zoning_designation', authority_class='register_of_record')` | **no** |
| 2 | Declare identifiers | `identifier_type('county.zoning_case_no', identifies_kind='development', uniqueness_scope='county')` | **no** |
| 3 | Map its vocabulary | `source_role_map` rows: `"Applicant" → applicant`, `"Agent" → evidence_detail`, `"Property Owner" → property_owner_as_filed` | **no** |
| 4 | Ingest | If it is ArcGIS/Socrata/CKAN/CSV/Carto → **one JSON entry**, zero code. Otherwise a new adapter implementing the 5-step contract (§6.1) | maybe |
| 5 | Resolve entities | Match on declared identifiers, else spatial containment as a `derived` claim; unresolved → new entity + a candidate `entity_resolution`. **Never a silent merge** | no |
| 6 | Claims appear | Automatically — the claim table has no per-source columns | no |
| 7 | Arbitration | Automatic from `display_precedence`; a new predicate needs one precedence row | no |
| 8 | UI | **No change.** `property_card` gains a field; the zoning line renders in the existing DEVELOPMENT section | **no** |

For the five families already built, adding a database is **config only** — which is exactly the
property the 183-entry registry already delivers for permits, extended to identity and evidence.

---

# PART 27 — RISKS

| Risk | Mitigation |
|---|---|
| **False joins** (wrong parcel↔development, wrong company merge) | Joins only via declared identifiers or explicitly evidenced `entity_resolution`; spatial joins are `derived` and labelled; `not_same_entity` is storable |
| **Address-based joins re-entering** | Address is a claim + a search path, never a key. `property_reports`' canonical-address key is explicitly re-keyed in Part 19 |
| **Historical attribution** (event attached to the wrong operator) | `currency_basis` + validity windows + the Part 14 temporal gate |
| **Missing identifiers** | Entity exists with zero identifiers; claims still attach; resolution stays open rather than guessed |
| **Source outage** | `source_check(status='error')` ⇒ `unavailable`, never `checked_empty`. The existing `dev_refresh_source_failures` guard already refuses to overwrite a good page from a failed fetch — preserve that |
| **Claim volume** | Part 23; tiered raw storage; geometry split out |
| **Arbitration policy churn silently changing displayed facts** | `resolved_fact.computed_at` + policy version; changes are recomputes with a diff, and the losing claims never left |
| **Two-registry drift** (JSON file vs `source` tables) | CI parity gate — the Gold Master pattern already proven in the ingest repo |
| **Backfill loses nuance** | Prose in `note` / `notes` / `match_basis` (e.g. the ZIP-straddle note, the Eagle Mountain annexation caveat) must be *read and converted*, not dropped. Step 5's comparison must include a manual read of all 93 parcel + 66 role notes |
| **PII** | `filed_by` and `Contact` are named individuals ("Kristin Lorentzen", "Jeff Gutknecht"). They are on public filings, but role `filed_by` should be `class='evidence_detail'` and **excluded from the consumer card by default** — a founder decision (Part 29 Q6) |
| **Security, pre-existing** | 21 tables have RLS disabled, including `tceq_affiliations_raw` (9,617 rows), `tceq_resolved_operators`, `esg_lookup_requests`, `dev_refresh_targets`. Anyone with the anon key can read/write them. **Not caused by this proposal, but any new table must ship RLS-on**, and the existing set should be reviewed separately |

---

# PART 28 — THE THREE NON-NEGOTIABLE TESTS

### TEST 1 — DATABASE INDEPENDENCE · **PASS**
If TCAD disappeared, another county assessor or a recorder feeds the same `parcel` entity by
registering a `source` row, an `identifier_type`, and `source_role_map` rows. No core table
mentions TCAD; `identifies_kind` and `uniqueness_scope` carry the semantics. **Proven by
construction in Part 18**: Box Elder ArcGIS tax parcels and Utah County Land Records already feed
the identical structure with different identifier formats and no shared assumption. The current
architecture fails this test — `resolved_project_parcels.apn`/`account`/`erecord_url` are shaped
by the two Utah counties that filled them, and `tx_parcels` was a *third* parallel table that
never got data.

### TEST 2 — SOURCE DISAGREEMENT · **PASS**
Both claims persist as claims (not text), each with its own entity, identifier, URL, vintage and
evidence class. Arbitration selects a display winner from a declarative precedence table and can
show the basis; the loser remains queryable, promotable and corroborable. Demonstrated on the
real live conflict in §17.1 (City of Austin vs four FRS assertions) — where today four of five
claims exist only as strings in `identity_conflicts.weaker_company`.

### TEST 3 — NEW DATABASE · **PASS**
Part 26: for the five existing connector families, config only — no code, no schema change, no UI
change. For a novel platform, one adapter implementing a fixed 5-step contract that **cannot**
introduce a truth table, because adapters may not choose predicates, evidence classes or entity
identity. The existing 183-entry registry is the working proof that this property is achievable
here — the proposal extends it from permits to identity and evidence.

---

# PART 29 — DECISIONS REQUIRING FOUNDER APPROVAL

Only genuine product/architecture calls. Everything else is engineering judgment already
constrained by the audit.

| # | Decision | Recommendation |
|---|---|---|
| **Q1** | Adopt claim-as-row, accepting that rendering requires a materialized read model? | **Yes** — the product promise is traceability; Part 4.1 gives the tradeoff honestly |
| **Q2** | Re-predicate the 5 TDLR "Property Owner" rows to `project_owner_as_filed`? This **changes what a future card would say** about Del Valle | **Yes** — the `notes` column already says it; the schema should |
| **Q3** | Build a **TCAD adapter** (and Travis County Clerk for deeds)? Nothing else makes the Property section real, and it is the single largest coverage gap found | **Yes, first** — it is also the second validation case for database-independence |
| **Q4** | Fix `app_projects` stable keys **now**, ahead of any architecture work? | **Yes** — 48/66 orphans is present breakage, and the fix is independent |
| **Q5** | Retain raw payloads for entity-bearing sources only (not the 3M permit rows)? | **Yes** — Part 16's tiering; re-fetchability covers the rest |
| **Q6** | Are named individual filers (`filed_by`, `Contact`) shown on the consumer card? | **Recommend: no by default** — public record, but a privacy/product call, not an engineering one |
| **Q7** | Does a `snapshot_only` claim with no corroboration ever render as "current"? | **Recommend: no** — the FRS lesson; it renders with its vintage, not as a present-tense fact |
| **Q8** | Confidence: categorical only, no numeric score, permanently? | **Yes** — the evidence does not justify a number and the existing system already proves categorical suffices |

**One open question the audit could not resolve from code or documents:** four tables
(`echo_violation_counts`, `app_environmental_risk`, `app_properties`,
`national_address_points`/`tx_address_points`) are empty and their intended role is not recorded
anywhere I could find — they are marked UNKNOWN in Part 19 rather than guessed.

---

# PART 30 — FINAL ARCHITECTURE DIAGRAM

```
  SOURCES ── registered as DATA, discovered by jurisdiction ────────────────────────
  county assessor · county GIS · county recorder · tax office · cadastral
  permits · planning · zoning · TDLR/TABS      EPA FRS/ECHO/TRI/RCRA/GHGRP/NPDES
  TCEQ · state regulators · CARB · AQMDs       SEC EDGAR · state business registries
  OSHA (attribution permitting)                WikiRate (downstream only)
        │        source · source_coverage · source_capability · source_authority · source_health
        ▼
  RAW SOURCE RECORDS ──────────────────────────────────────────────────────────────
  source_record(url, retrieved_at, http_status, parser_version, payload, payload_hash,
                superseded_by)          source_check(checked / found_n / empty / error)
        │                                        ↑ "not checked" ≠ "none found"
        ▼
  IDENTIFIERS + ENTITY RESOLUTION ─────────────────────────────────────────────────
  identifier_type (declares WHAT KIND each id identifies + its uniqueness scope)
  entity_identifier          entity_resolution (same_entity | dba_of | successor_of
                                                | NOT_SAME_ENTITY)   ← never a silent merge
        │
        ▼
  ENTITIES (thin cores — attributes live as claims) ───────────────────────────────
  PARCEL · DEVELOPMENT · FACILITY · ORGANIZATION · RECORDED INSTRUMENT
        │              (+ communities = civic geography, unchanged)
        ▼
  EVIDENCED CLAIMS ────────────────────────────────────────────────────────────────
  claim(subject, predicate, object, source_predicate_raw, source_object_raw,
        valid_from/to, currency_basis, as_of, observed_at,
        evidence_class, authority_class, fact_kind, status)
  claim_relation(corroborates | contradicts | supersedes | refines)
        │   ▲ source_role_map translates each source's OWN vocabulary → predicate
        │     (frs_affiliation_role_map, generalized to every source)
        ▼
  CONFLICT · TEMPORAL · VERIFICATION LAYER ────────────────────────────────────────
  ALL claims retained. display_precedence(predicate × authority_class × evidence_class)
  → resolved_fact(winner, corroborators, CONTRADICTORS, state, basis)
    states: verified · reported · unresolved · conflicting
            · unavailable · not_checked · checked_empty
        │
        ▼
  NORMALIZED READ MODEL ───────────────────────────────────────────────────────────
  property_card(entity_id, payload jsonb)   ← one row, one RPC, provenance on every field
  app_projects · development_reports        ← existing Maps read models, regenerated
        │
        ▼
  MAPS · PROPERTY CARD · TRACK RECORD · SUSTAINABILITY
  The UI knows predicates and evidence classes. It never knows what TCAD, TCEQ or SEC are.
```

---

# PART 31 — RECOMMENDED IMPLEMENTATION PHASES (exact order)

| Phase | Work | Why here | Blast radius |
|---|---|---|---|
| **0** | **Stable `app_projects` key** — `(source_id, source_record_key)`, upsert instead of delete+insert; re-anchor the 66 role rows | Fixes present breakage (48 orphans); precondition for every later phase | Materializer only; UI unaffected |
| **1** | **Source registry as data** — `source*` tables generated from `jurisdiction-registry.json`, CI parity gate; register the 5 hardcoded sources (FRS, ECHO, CWA, TCEQ, TDLR) | Nothing else can be jurisdiction-aware until "what applies here" is queryable | Additive; read by nothing |
| **2** | **`source_record` + `source_check`** — generalize `source_fetch_cache` (5 rows) and `track_record_checks` (17); dual-write from TDLR and TCEQ first | Raw + abstention must exist before claims reference them | Additive |
| **3** | **Identity layer** — `entity`, `identifier_type`, `entity_identifier`, `entity_resolution`; backfill from `project_facility_refs` (33), `companies` (45), `resolved_project_parcels` (93) | Claims need subjects | Additive |
| **4** | **Claim layer + `predicate` + `source_role_map`** — migrate `frs_affiliation_role_map` (39) as the first source; backfill Utah + Texas models into claims | The core | Additive; old tables still authoritative |
| **5** | **Convert Del Valle + Utah** and run the Part 22 step-5 comparison, including a manual read of all 93 parcel + 66 role prose notes | Proves the model on both validation cases before anything depends on it | Read-only comparison |
| **6** | **Arbitration + `property_card`** — `display_precedence`, `resolved_fact`; UI cutover | Cheap now (§1.11: no UI consumers today) | Flagged |
| **7** | **TCAD + Travis County Clerk adapters** — the first *new* source built natively on the contract | The real test of Test 3, and the biggest product gap (§1.2) | New source only |
| **8** | **Second state parcel source** (a Utah county assessor as a first-class source, not a project-scoped resolution) | Proves Test 1 with a second jurisdiction | New source only |
| **9** | Migrate remaining adapters to native claim emission; retire compatibility views when unused | Cleanup | Views only |

Phases 0–2 are safe to run against production immediately and are useful even if the founder
rejects the rest of the model. Phase 5 is the review gate before anything becomes authoritative.

---

## Appendix — audit method

Every count and quotation above came from a live query run 2026-08-10 against
`qwnnmljucajnexpxdgxr`, or from a `grep` over the two working trees, shown inline. Where the task
brief supplied facts (the TCAD parcel identifiers and deed), the audit searched for them and
reports the search result rather than assuming they were stored — they are not
(§1.2), and they are marked `[NOT IN SYSTEM]` wherever they appear in the Del Valle graph.

Two claims in this document are explicitly **unverified**: the intended purpose of the four empty
tables marked UNKNOWN in Part 19, and whether `echo_violation_counts` is superseded by the engine
v19 live-ECHO path (the CLAUDE.md note says it is near-empty by design; the table read 0 rows).
