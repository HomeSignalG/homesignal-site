# STEP 2 CONTRACT V2 — red-teamed. Minimum = 4 tables.

**CONTRACT DELTA + EVIDENCE ONLY. Nothing applied. No producers. No Map 1 / MAPS / geography change.**
Supersedes the Step-2 v1 contract (`docs/dc-canonical-contract-step2.md`), which is retained as the
dated record of what was proposed and why 14 of its 18 objects were removed or deferred.

## 0. Concurrency gate (re-fetched, not trusted from the brief)

`CURRENT_SITE_MAIN_SHA   = 15043be1c98d06e5f3842c021259cdb117bb6616`
`CURRENT_INGEST_MAIN_SHA = 0aa7fb17c0572deb1f857245156ee3faf7bccc78`
Both match the founder's audit exactly.

`dc_source_observation` / `dc_acquisition_run` / `dc_facility` / `dc_observation_entity_link` /
`dc_entity_attribute` / `dc_source_citation`: **0 files on site main, 0 files on ingest main.**
Ingest main also has 0 files matching `compute-atlas`, `computeatlas`, `epoch.ai`, `epoch_ai`,
`national_dc`. Every remote branch scanned for those symbols: only `claude/zen-keller-evppx7`
(this session's own contract doc). Eight most-recent branches diffed against main for
`map.js|homesignalmap|app_zip_projects_markers|national_dc|geo|datacenter|get-address-report`:
seven touch none; `claude/exciting-keller-xoef2q` touches `test/maps-datacenter-theme.test.mjs`
only — a MAPS theme test, not DC architecture.

**CONCURRENCY_VERDICT = GENUINE GAP.**

## 1. CURRENT_DC_TRUTH_PATH — measured, and it is already TWO paths

**Map 1** (`homesignalmap.html`) merges **three** populations **in the browser**:

```
homesignalmap.html:2381
sites: HS.zipAuthMergeSites(row.sites||[], authSites).concat(natlSites)
         ^ development_reports        ^ app_zip_        ^ national_dc_for_zip
           cached centroid-radius       projects_         (p_radius_mi: 5)
           engine output                markers
```

`natlSites` is built at `homesignalmap.html:2347` and stamps **`type:"datacenter"` in the
browser**, which `lib/map.js` then accepts through `DATACENTER_TYPE_EXACT`. The national plane
therefore **never passes `statedDataCenter`** — it declares itself.

**MAPS** (`homesignal-ingest/bluesky/generate-maps.mjs`) reads **`app_projects` directly over
PostgREST** (`app_projects?select=${PROJECT_COLUMNS}`, lines 405 / 1024) and classifies with the
pinned port `bluesky/lib/maps-datacenter.mjs::dataCenterTheme`. It has **no reference to
`app_zip_projects_markers` and no reference to `national_dc_for_zip`.**

⇒ **A data centre that reaches a resident on Map 1 through `national_dc_for_zip` is invisible to
MAPS.** Two production answers to "does a data centre exist in this ZIP" already exist. Within
MAPS the split goes further: `scripts/maps-social-image.mjs:250` screenshots through
`app_zip_projects_markers` while `generate-maps.mjs` decided through `app_projects` — the picture
and the decision come from different reads.

## 2. CANONICAL_RESULT_OWNER = `public.app_zip_projects_markers` — with two prerequisites

Evidence for:
* **B — consumes authoritative geography.** `lib/zip-authoritative.js:1-14` states the invariant
  ("must NEVER use a centroid, a ZIP center, a representative point, an invented coordinate, a
  3-mile radius") and Map 1 already consumes the RPC at `homesignalmap.html:899/2262`.
* **D — Map 1 can consume it without browser merging.** It already consumes it; the merge exists
  only because two *other* planes are still fetched beside it.
* **E — MAPS can consume the same structured result.** `scripts/maps-social-image.mjs:242-250`
  already does, for the capture.
* **A — record kinds.** Parameterised `p_kind` ('development'); already carries marker-grain with
  `project_ref` fan-out (`lib/zip-authoritative.js` rule 4: 522 markers over 500 project_refs
  on 78617).

⚠️ **C is NOT satisfied today, and this is the finding that matters.** The projection in
`HS.zipAuthSiteFromMarker` (`lib/zip-authoritative.js`) emits `type: bucket` — the **lifecycle**
bucket — and carries the source class as `use_type: project.type`, with `permit_class:
project.type_raw` **deliberately renamed**, its own comment saying: *"Deliberately NOT named
`type_raw`: that name is read by the data-centre classifier and by Rule 5, and neither may
widen."* So on this path `type` (the field `isCanonicalDataCenterType` reads exclusively) holds a
lifecycle word and `type_raw` is withheld from the classifier **by design**.

⇒ **The same project can classify differently depending on which plane delivered it.** That is a
live, measurable second classification path, and it is the concrete work of the cutover — an
**additive** projection change to the RPC + `zipAuthSiteFromMarker`, not a new resident API.

**No new DC-specific resident API is justified.** `app_zip_projects_markers` is the extension
point; it needs a projection that carries the classifier's declared inputs, and the other two
planes need to move behind it.

## 3. CANONICAL_CLASSIFICATION_OWNER = `lib/map.js::statedDataCenter` (+ its pinned port)

`bluesky/lib/maps-datacenter.mjs` is a byte-verified port with a parity corpus (898/898 agreement
recorded in its header) — one decision, two runtimes, measured rather than asserted.

**It is not the sole owner today.** Two bypasses, both measured:
1. `homesignalmap.html:2350` stamps `type:"datacenter"` on national records in the browser.
2. The RPC projection withholds `type_raw` (§2), so the classifier sees different evidence per plane.

📌 **Observed, not a second path, flagged not fixed:** `lib/map.js:775` `KEYWORD_RULES` still
carries `/data\s*center|hyperscale|server\s*farm/i`. It runs on TYPE FIELDS ONLY
(`lib/map.js:1290-1300`), with a pattern **strictly narrower** than `DATACENTER_RE`, over the same
fields, **strictly later** than the PRECEDENCE-1.5 class-field branch — so it is structurally
subsumed and cannot fire where `statedDataCenter` has not already fired. It is a latent duplicate
of the same class #1046 deleted from `NAME_RULES`; deleting it is separate work.

## 4. Red-team of v1 — 18 objects in, 4 out

| object | classification | why |
|---|---|---|
| `dc_source` | **REQUIRED BEFORE FIRST PRODUCER** | the capability flags are what stop Epoch acquiring an id/geometry/status; nothing else can |
| `dc_acquisition_run` | **REQUIRED BEFORE FIRST PRODUCER** | "only SUCCESS_COMPLETE advances" has no other home; a failed run must be a row |
| `dc_source_observation` | **REQUIRED BEFORE FIRST PRODUCER** | the immutable evidence the whole architecture rests on |
| `dc_source_record_state` | **REQUIRED BEFORE FIRST PRODUCER** (new in v2) | §3 — mutable knowledge (`last_seen`, not-seen) must leave the immutable observation |
| `dc_observation_delta` | **DERIVABLE — DO NOT STORE** | two immutable observations + a diff function; storing it is a cache with its own staleness |
| `dc_source_citation` | **DERIVABLE — DO NOT STORE (2B)** | Atlas `sources[]` is inside `raw_payload`; Epoch `Selected Sources` is a column. `jsonb` + GIN is queryable — "not flattened into unqueryable JSON" is satisfied without a second copy. Normalize when it is actually joined |
| `dc_observation_attribute` | **DERIVABLE — DO NOT STORE (2B)** | same: a normalization of `raw_payload`. Storing it before identity resolution freezes a normalization we will redo |
| `dc_construction_evidence` | **REMOVED — it IS an observation** | each Epoch timeline row is one record of source `epoch_ai_timelines`. A separate table was a second shape for the same thing |
| `dc_source_health` | **DERIVABLE — DO NOT STORE** | a view over `dc_acquisition_run`. v1 called it a view and then listed it as an object; it is not a table and not 2A |
| `dc_observation_succession_candidate` | REQUIRED BEFORE IDENTITY RESOLUTION (2B) | |
| `dc_party` (was `dc_operator`) | REQUIRED BEFORE IDENTITY RESOLUTION (2B) | renamed: Ellendale proves role ≠ operator |
| `dc_facility` · `dc_campus` · `dc_project` | REQUIRED BEFORE IDENTITY RESOLUTION (2B) | |
| `dc_observation_entity_link` | REQUIRED BEFORE IDENTITY RESOLUTION (2B) | |
| `dc_lifecycle_assertion` | REQUIRED BEFORE IDENTITY RESOLUTION (2B) | |
| `dc_entity_attribute` | REQUIRED BEFORE RESIDENT CUTOVER (2D) | |
| `dc_derived_geometry` | REQUIRED BEFORE GEOGRAPHY (2C) | |
| `dc_building` · `dc_parcel` | **SPECULATIVE — REMAIN REMOVED** | no measured source supplies either grain |

## 5. Contract errors corrected from v1

1. **"canonical JSON changes on any source byte"** — false. Key reordering and whitespace do not
   move a canonical fingerprint. Three hashes now, named for what they actually cover.
2. **Atlas `publisher_id` ⇒ `CONFIRMED_MATCH`** — removed. An Atlas id establishes **same Atlas
   record**, never **same real-world facility**. No automatic rule may confirm canonical identity,
   **including via publisher id**.
3. **Mutable columns on an immutable table** — `last_seen_at`, `not_seen_state`, `superseded_by`
   moved to `dc_source_record_state`. An observation is now genuinely append-only.
4. **"permanent, 3 rows"** — removed. `dc_source` is an extensible registry (OSM, local/government
   evidence, future approved sources) driven by declared capabilities, not source names.
5. **`centroid` in `derivation_method`** — removed from canonical geometry entirely. Centroids are
   candidate retrieval / diagnostics / reconciliation only.
6. **`dc_operator`** → **`dc_party` + evidence-backed role edge**. Ellendale: Atlas says Applied
   Digital, Epoch says CoreWeave — a *role* difference, not a conflict to resolve.
7. **Lifecycle vocabulary not frozen.** Tested and NOT adoptable as proposed — see §7.

## 6. STEP 2A — the minimum, four tables

Schema `public`, `dc_*`. **RLS ENABLED, no `anon`, no `authenticated` grant, `service_role` only.**
Readers in 2A: `service_role` + review tooling. **Zero resident-facing readers.**

### 6.1 `public.dc_source`
Extensible source registry. Declared capabilities drive behaviour; source names never do.

`source_key text PK` · `publisher text NOT NULL` · `distribution_url text NOT NULL` ·
`licence text NOT NULL` · `supplies_publisher_record_id boolean NOT NULL` ·
`supplies_geometry boolean NOT NULL` · `supplies_lifecycle_status boolean NOT NULL` ·
`supplies_release_identity boolean NOT NULL` · `preserves_record_bytes boolean NOT NULL` ·
`geocoding_enabled boolean NOT NULL DEFAULT false` · `expected_schema_fingerprint text` ·
`expected_min_records int NOT NULL DEFAULT 1` · `not_seen_vocabulary text NOT NULL` ·
`schedule_cron text` · `active_state text NOT NULL DEFAULT 'NOT_ACTIVE'` ·
`created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`

CHECK `not_seen_vocabulary IN ('SOURCE_RECORD_NOT_SEEN','NOT_OBSERVED_IN_CURRENT_RELEASE')` ·
`active_state IN ('NOT_ACTIVE','ACTIVE')` · `active_state='NOT_ACTIVE' OR schedule_cron IS NOT NULL`.
INDEX: PK only. RETENTION permanent, mutable (a registry). WRITE migration + founder. READ service_role.
Seed: atlas `(true,true,true,true,true)`, epoch ×2 `(false,false,false,false,true)`, both NOT_ACTIVE,
`geocoding_enabled=false`.

### 6.2 `public.dc_acquisition_run`
Every attempt. Only `SUCCESS_COMPLETE` may advance observations.

`id uuid PK DEFAULT gen_random_uuid()` · `source_key text NOT NULL FK→dc_source` ·
`run_seq bigint GENERATED ALWAYS AS IDENTITY` · `trigger text NOT NULL` ·
`started_at timestamptz NOT NULL DEFAULT now()` · `completed_at timestamptz` ·
`request_url text NOT NULL` · `request_method text NOT NULL DEFAULT 'GET'` · `http_status int` ·
`transport_error text` · `artifact_bytes bigint` · **`artifact_sha256 text`** ·
`artifact_media_type text` · `artifact_ref text` · `source_release_identity jsonb NOT NULL DEFAULT '{}'` ·
`source_release_key text` · `content_release_key text` · `parser_key text NOT NULL` ·
`parser_version text NOT NULL` · `schema_fingerprint text` ·
`records_seen`/`records_parsed`/`records_rejected int` · `completeness_state text NOT NULL` ·
`failure_detail jsonb` · `source_declared_freshness timestamptz` · `observed_freshness timestamptz` ·
`advanced_observations boolean NOT NULL DEFAULT false` · `notes text`

`completeness_state ∈ {SUCCESS_COMPLETE, SUCCESS_ZERO, PARTIAL, TRUNCATED, SCHEMA_CHANGED,
PARSE_FAILED, FETCH_FAILED, STALE_SOURCE}`.

CHECK · `<>'SUCCESS_COMPLETE' OR (http_status=200 AND artifact_sha256 IS NOT NULL AND records_seen>0
AND records_parsed=records_seen AND schema_fingerprint IS NOT NULL)` · `<>'SUCCESS_ZERO' OR records_seen=0`
· `<>'FETCH_FAILED' OR (http_status IS NULL OR http_status>=400)` ·
**`advanced_observations=false OR completeness_state='SUCCESS_COMPLETE'`** ·
`completed_at IS NULL OR completed_at>=started_at`.
UNIQUE `(source_key, run_seq)`. INDEX `(source_key, started_at DESC)`,
`(source_key, completeness_state, completed_at DESC)`, `(source_key, artifact_sha256)`.
IMMUTABLE once `completed_at` is set (trigger). RETENTION append-only, permanent.
WRITE acquisition worker. READ service_role.

### 6.3 `public.dc_source_observation` — IMMUTABLE
What the publisher said in that complete acquisition. Nothing on this row ever changes.

`home_signal_observation_id uuid PK DEFAULT gen_random_uuid()` · `source_key text NOT NULL FK` ·
`acquisition_run_id uuid NOT NULL FK` · `publisher_record_id text` ·
**`raw_record_sha256 text`** · **`semantic_observation_fingerprint text NOT NULL`** ·
`source_row_ordinal int` · `raw_payload jsonb NOT NULL` · `raw_payload_ref text` ·
`source_native_name text` · `source_native_type text` · `source_native_status text` ·
`source_native_operator text` · `source_native_operator_confidence text` ·
`source_native_address jsonb` · `source_native_geometry geography(Point,4326)` ·
`source_native_precision text` · `source_timestamps jsonb` · `normalization_version text NOT NULL` ·
`observed_at timestamptz NOT NULL DEFAULT now()`

UNIQUE `(source_key, semantic_observation_fingerprint)`.
TRIGGER (reads `dc_source`): `supplies_publisher_record_id=false ⇒ publisher_record_id IS NULL` ·
`supplies_geometry=false ⇒ source_native_geometry IS NULL` ·
`supplies_lifecycle_status=false ⇒ source_native_status IS NULL` ·
`preserves_record_bytes=false ⇒ raw_record_sha256 IS NULL`.
TRIGGER: INSERT only when the run is `SUCCESS_COMPLETE`. **TRIGGER: `BEFORE UPDATE` RAISES
unconditionally — the whole row is immutable.** TRIGGER: no `DELETE` grant for any role.
CHECK every `source_native_*` text `<> ''` (absence is NULL; unknown stays unknown).
INDEX `(source_key, publisher_record_id)`, `(source_key, observed_at DESC)`,
GIN `raw_payload`, GIN `source_native_address`.
RETENTION append-only, permanent. WRITE acquisition worker. READ service_role.

**Each Epoch timeline row is one observation of `epoch_ai_timelines`** — no separate table.

### 6.4 `public.dc_source_record_state` — MUTABLE, Atlas-keyed only
HomeSignal's evolving knowledge about a *source record*, kept off the immutable evidence.

`id uuid PK` · `source_key text NOT NULL FK` · `publisher_record_id text NOT NULL` ·
`current_observation_id uuid NOT NULL FK→dc_source_observation` ·
`first_seen_run_id uuid NOT NULL FK` · `last_seen_run_id uuid NOT NULL FK` ·
`last_seen_at timestamptz NOT NULL` · `not_seen_state text` ·
`not_seen_since_run_id uuid FK` · `updated_at timestamptz NOT NULL DEFAULT now()`

UNIQUE `(source_key, publisher_record_id)`.
🔒 TRIGGER: INSERT refused unless `dc_source.supplies_publisher_record_id = true`.
**Epoch has no row here, ever — and no synthetic chain key is invented for it.** Epoch succession
is 2B evidence reasoning (`dc_observation_succession_candidate`), not a state row.
🔒 TRIGGER: `not_seen_state` may be written only by a run with `completeness_state='SUCCESS_COMPLETE'`,
and only with this source's declared `not_seen_vocabulary` value.
RETENTION permanent, mutable. WRITE acquisition worker. READ service_role.

## 7. Lifecycle vocabulary — TESTED, NOT ADOPTED

Atlas's closed set, measured on the 2,025-record snapshot: `operational 963 · proposed 514 ·
under_construction 283 · permitted 154 · cancelled 111`. **No `announced`, `planned`, `completed`
or `withdrawn` exists in Atlas.**

The existing local plane (`app_projects.status`) uses a *different* set — `Operating · Approved ·
Proposed · Active · Decided` — and **`Operating` is a FACILITY state living in a PROJECT column**,
which is precisely the collapse §9 forbids. Adopting the proposed vocabulary now would either
invent four Atlas values that do not exist or silently re-map the local plane.

⇒ **Lifecycle vocabulary is a 2B deliverable with its own measurement** (a full crosswalk of
Atlas × `app_projects.status` × the local connector registries). Nothing is frozen here.
`conflict` is a *state of the assertion set*, not a member of either vocabulary.

## 8. Migration order · rollback (2A)

ORDER: 1 `dc_source` + seed → 2 `dc_acquisition_run` → 3 `dc_source_observation` (+ 4 triggers) →
4 `dc_source_record_state` (+ 2 triggers) → 5 RLS enable + `service_role`-only grants.

ROLLBACK: `DROP TABLE public.dc_source_record_state, public.dc_source_observation,
public.dc_acquisition_run, public.dc_source CASCADE;` — total, because 2A has **zero readers** and
nothing outside `dc_*` references anything inside it. Pinned by CI invariant M10.

## 9. Mutation tests (each must FAIL; a no-op must not make them green)

| # | mutation | must |
|---|---|---|
| M1 | Epoch observation with a non-NULL `publisher_record_id` | RAISE |
| M2 | Epoch observation with `source_native_geometry` set while `supplies_geometry=false` | RAISE |
| M3 | Epoch observation with `source_native_status` set while `supplies_lifecycle_status=false` | RAISE |
| M4 | Epoch row inserted into `dc_source_record_state` | RAISE |
| M5 | `PARTIAL` / `TRUNCATED` / `FETCH_FAILED` / `PARSE_FAILED` / `SCHEMA_CHANGED` / `STALE_SOURCE` / `SUCCESS_ZERO` run inserts an observation (7 cases) | RAISE ×7 |
| M6 | Any of those 7 writes `not_seen_state` | RAISE ×7 |
| M7 | `UPDATE dc_source_observation SET anything` | RAISE |
| M8 | `DELETE FROM dc_source_observation` | no grant / RAISE |
| M9 | A rule writes a CONFIRMED canonical identity **including from an Atlas publisher id** | 2B; the 2A schema has no entity table, so it is unreachable by construction |
| M10 | Any resident-facing file references a `dc_*` symbol (grep `lib/`, `*.html`, `supabase/functions/`, ingest `bluesky/`) | CI FAIL |
| M11 | Any `dc_*` object carries an `anon` or `authenticated` grant | CI FAIL |
| M12 | Any `dc_*` column named `zip`/`zcta`/`postal_code_5`, or any reference to `geo.zip_authoritative_membership` | CI FAIL |
| M13 | `derivation_method='centroid'` appears in any canonical geometry contract | CI FAIL (2C guard, pinned now) |
| M14 | `national_dc_for_zip` still fetched by `homesignalmap.html` after cutover | CI FAIL (armed at 2D) |
| M15 | Map 1 concatenates two DC populations in the browser (`.concat(natlSites)` or equivalent) | CI FAIL (armed at 2D) |
| M16 | MAPS reads `app_projects` directly for DC existence after cutover | CI FAIL (armed at 2D) |

**POSITIVE CONTROLS (a no-op cannot pass):** a well-formed Atlas observation from a
`SUCCESS_COMPLETE` run **must insert**; a well-formed Epoch observation with
`publisher_record_id=NULL` **must insert**; a second complete Atlas run **must move
`last_seen_run_id`**; an Atlas record absent from a later complete run **must** receive
`SOURCE_RECORD_NOT_SEEN`. The 7 measured wrong-sibling pairs stay frozen fixtures for 2B, pinned
in both directions (must produce `POSSIBLE_MATCH`, must still reach the right record on the
control set).

## 10. Future convergence path · old-path retirement

`2A` acquisition + immutable observation → `2B` identity (party/roles, project/campus/facility,
link states, succession, lifecycle crosswalk) → `2C` geography (derived geometry with evidence;
membership still decided **only** by the authoritative geography architecture) → `2D` resident
cutover.

**2D is the only step that touches residents, and it is a REPLACEMENT, not an addition:**
1. `app_zip_projects_markers` projection extended (additively) to carry the classifier's declared
   inputs, so one classification decision serves every plane.
2. National DC evidence flows **into** that RPC's population instead of being fetched beside it.
3. `homesignalmap.html` drops the `national_dc_for_zip` fetch and the `.concat(natlSites)` merge —
   **`national_dc_for_zip` is retired, not fixed.**
4. `generate-maps.mjs` stops reading `app_projects` for DC existence and consumes the same result,
   closing the Map-1-sees-it / MAPS-does-not split measured in §1.
5. `lib/map.js:775` duplicate keyword DC rule deleted (subsumed today; a latent overturn).

**STEP_2_CONTRACT_V2 = READY** — minimum persistence contract only. READY authorizes nothing.
