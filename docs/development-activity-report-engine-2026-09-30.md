# The national Development Activity report engine — Order G (2026-09-30)

Plan: `docs/development-activity-plan-2026-09-30.md`, Steps 9 and 10, Order G ("Deploy and production-smoke the canonical
commercial API. Keep JWT/authenticated posture. Do not weaken it into a public anonymous generator").
Founder go, 2026-09-29, under one rule: **no production path may permanently write a brokerage-entered exact address into
the immutable snapshot, and no real customer report is stored until the five gates in
`docs/report-private-context-contract-2026-09-30.md` §6 are closed.**
Code: `supabase/functions/_shared/national-report.ts` (assembly), `supabase/functions/get-development-activity-report/`
(`handler.ts`, `data.ts`, `index.ts`), `supabase/functions/_shared/report-rights.json`, `scripts/gen-project-type-module.mjs`.

## 1. What this is, in one paragraph

An address goes in; a **HOMESIGNAL DEVELOPMENT ACTIVITY** report comes out, for any address in the 12,722-ZIP product
universe, built from the development data HomeSignal already holds. It is a server path behind a signed-in login. It builds
the report as **two separate objects** from the start — the permanent *intelligence* and the customer's *private context* —
so the address is never inside the permanent object. It stores nothing. It shows a source's records to a customer only if
that source is on a written clearance list, and **that list is empty today**, so today every customer report says, honestly,
that no official source is included yet.

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path:** address → `geocode-address` (the one geocoder) → `canonical_zip_registry` (12,722) →
  `public.n5_projects_within_radius` (canonical geometry: which projects are near) → `public.app_projects` (the record's own
  fields, by `source_key`) → `lib/project-type.js` (Type and canonical lifecycle) → `public.dev_change_project` and
  `public.dev_change_event_reportable` (what changed) → `report-rights.json` (may this source appear) →
  `national-report.ts` (composition only) → `report_snapshot_issue` (the one writer; **not called here**).
- **Decision owners — none duplicated:**

  | question | owner | how this engine uses it |
  |---|---|---|
  | is the ZIP in the product? | `public.canonical_zip_registry` | asked per request; not cached, not copied |
  | which projects are near the address? | `public.n5_projects_within_radius` | called with its own parameters; no distance is computed here |
  | what is the project's Type? | `lib/project-type.js` `canonicalProjectType` | called; a generated verbatim copy is loaded (§3.4) |
  | what is its canonical lifecycle? | `lib/project-type.js` `canonicalLifecycle` | called; the publisher's status word is carried separately, verbatim |
  | did it change, and may we call it a change? | `public.dev_change_event_reportable` | the only event read; the raw event table is never read |
  | may this source's content be shown? | `supabase/functions/_shared/report-rights.json`, from the rights audit | closed by default; a HOLD is never cleared (R4) |
  | may this address be stored? | `report_private_context_*` / `report_snapshot_issue` | not called |
- **Shortcut check:** searched `supabase/functions`, `lib/`, `scripts/`, `docs/*.sql` and `test/` for a second geocoder (none: the
  new function calls `geocode-address`), a second Type or lifecycle rule (none: `test/national-report-structure.test.mjs` 1d/1e
  fail if one appears), a second spatial read (none), a second reader of ledger events (none), and any other caller of
  `report_snapshot_issue` (none: 3d). The legacy NYC engine (`get-future-surroundings-report`, `lib/nyc-v1-report.js`) is not
  imported (2g). There is one commercial engine.
- **Concurrency check (2026-09-29 → 30):** no open PR or recent branch builds a national report path; the only branches near it
  are N5 build automation, the landing page and the historical-intelligence contract (#1467, complementary). **GENUINE GAP.**

## 3. What the audit found (measured before any code, 2026-09-29; each with its control)

1. **The plan's "canonical commercial API" was never deployed.** `get-future-surroundings-report` is the NYC-only, Socrata-only
   allowlist API; it is not in the project's function list. Control: the same listing shows 19 functions including the
   JWT-protected `geocode-address` and `edge-probe`, so the listing works. Order G therefore builds the national path; it does
   not deploy the NYC one.
2. **`verify_jwt = true` does not mean "a signed-in user".** The gateway checks that a token is validly signed, and the public
   anon key is a validly signed token that is in every page of the site. `verify_jwt` alone leaves an anonymous generator —
   exactly what the plan forbids. So the handler additionally requires a real user whose email is in `public.dashboard_admins`
   (§5, D-G1). The same weakness exists in the NYC function; it is left alone (R6).
3. **Rights are unpopulated, on purpose.** `dev_change_event.rights_class` is NULL on 922,244 of 922,244 events (the ledger's
   design: rights are enforced at report time). `dev_change_event_reportable` returns **0** rows. The rights audit's verdict is
   NOT YET and its HOLD stands (R4). There was no machine-readable rights registry, so this unit creates one, empty.
4. **The ledger is national:** 932,969 projects, 254,193 of them change-ready (comparable and observed at least twice), 922,244
   events — all from the baseline run, none reportable yet. The registry holds 12,722 ZIPs.
5. **The date vocabulary carries sentinels.** Over `app_projects` (`record_kind = 'development'`), `date_kind` is `issued`
   1,888,854 · `filed` 663,023 · (null) 163,525 · `scheduled` 136,675 · `decided` 39,232 · `awarded` 18,094 · `estimated` 11,113 ·
   `hearing` 3,119 · `completed` 2,666, and the dates include 1900-01-01, 1969-12-31, 2099-02-12 and 9999-09-09. A window bounded
   above by today and below by 90 days excludes every sentinel by construction; `scheduled` and `estimated` are plans, not events.
6. **The spatial read reports truncation explicitly** (`has_more`, never inferable from the row count), and a project has one
   `app_projects` copy per ZIP page, so hydration by `source_key` returns several rows per project.
7. **The five report tables are empty and stay empty:** `report_snapshot` 0, `report_private_context` 0 (control: the ledger
   tables in the same query are populated).
8. **`service_role` can read everything the function touches, and `anon` / `authenticated` cannot read the ledger or
   `dashboard_admins`** (`has_table_privilege`, 2026-09-29), so no other path exposes them.

## 4. What was built

| file | what it is |
|---|---|
| `_shared/national-report.ts` | **pure** composition: `assemble`, `boundaryFindings`, `validateRights`, `recentPublisherEvent`, and (since the Follow change, 2026-10-01) the one change rule: `isChangeReady`, `materialEvents`, `selectDetectedChanges`, `detectedChangeEntries`, `sourcesNotFullyRead`, the `WrittenEvent` type. No environment, no network, no client. |
| `_shared/admin-gate.ts`, `_shared/service-rest.ts`, `_shared/change-reads.ts` | *(moved here from this function's `handler.ts` / `data.ts` by the Follow change, so the two functions share one definition each)* the sign-in and allow-list gate; the PostgREST transport and its fail-closed rules; the ledger SELECTs (projects, reportable events, source health). |
| `_shared/changes-since-report.ts` | the Follow function's pure reader; it uses the change rule above, never a copy. Not used by this endpoint. |
| `_shared/report-rights.json` | the source-family clearance list. `"cleared": []`. |
| `_shared/project-type.generated.js` | `lib/project-type.js`, byte for byte, generated by `scripts/gen-project-type-module.mjs` (`--check`). |
| `get-development-activity-report/handler.ts` | who may ask, what they may ask, what happens next. Everything external is injected. |
| `get-development-activity-report/data.ts` | the reads specific to this endpoint (geocode, spatial read, hydrate), from an injected `fetch`; fails closed. The ledger and health reads now come from `_shared/change-reads.ts`. |
| `get-development-activity-report/index.ts` | wiring only. |
| `supabase/config.toml` | `verify_jwt = true`, pinned. |
| `test/national-report*.test.mjs`, `test/national_report_pg/`, `test/national_report_mutants.py` | the proof (§8). |

### 4.1 The split (contract §8.1–§8.2)

`assemble` returns `intelligence` (permanent), `privateContext` (deletable), `renderOnly` (this response only).
The intelligence holds the ZIP, the radius, the projects and their sections. It holds **no** address, matched address, label,
subject coordinate, distance, offset or bearing. Distances are in `renderOnly.distances_mi` and are never hashed or stored.
The strongest single proof is a property, not a fixture: **the permanent body is byte-identical for six different subject
addresses in the same area**, so nothing subject-specific can be in it (`national-report.test.mjs` 6b), and the same six,
stored in a real Postgres, yield six `report_id`s and **one** `content_hash` (`national_report_pg` 1c).

### 4.2 The boundary check that looks for fragments (contract §8.4)

The database matches whole private values only (contract §9). `boundaryFindings` looks for what it cannot: the street line,
house number + street word, the normalised address, the label, a five-decimal coordinate, and any subject-relative key. Its
findings name the KIND of leak and never repeat the value. `assemble` puts any finding in `storage_blockers`. The defect this
check itself had at first — a value filling a whole JSON string has no space on either side — was found by
`national-report.test.mjs` 7b and fixed (substring match).

### 4.3 The response

```
{ status: "OK" | "ADDRESS_NOT_RESOLVED" | "OUTSIDE_COVERAGE",
  coverage_state: "REPORT_READY" | "CHANGE_READY" | "LIMITED_COVERAGE",
  report: { product, report_version, as_of, zip, radius_mi, recent_days,
            coverage: { zip_supported, state, change_ready, area_truncated, source_families_in_report,
                        assessment_basis: "records_returned_for_this_radius", limitations: [{ code, text }] },
            sections: { what_changed_recently: [project_id], recent_official_activity: [project_id],
                        by_lifecycle: { approved, proposed, operating, unknown } },
            projects: [{ project_id, source_family, name, address, type, lifecycle, publisher_status, publisher_stage,
                         publisher_event, developer, size, investment, source: { url, attribution },
                         homesignal_observation, homesignal_detected_changes? }] },
  render: { distances_mi },            // this response only
  stored: false, report_id: null, storable, storage_blockers }
```

**Added since (2026-10-02).** `report_version` is `development-activity-national-3`. Step 2 of the 100526 build added
`stage_rule_version`, `sections.by_stage`, each project's `stage`, and `render.bearings_deg` / `render.review`. Step 5a added:
- `report.activity: { outcome, label, rule_version }`, the report's outcome (founder ruling R5,
  `docs/development-activity-founder-ruling-r5-2026-10-02.md`):
  - `DEVELOPMENT_SHOWN` ("Development shown");
  - `NO_DEVELOPMENT_ACTIVITY` ("No development activity"), only once HomeSignal can prove its data for the address is coming
    in, which nothing can yet;
  - `NO_DATA_INGESTED` ("No data ingested"), every empty report today.

  `activityOutcome()` decides it, from the number of projects in this report after the rights gate. `activity_rule_version`
  is in the engine inputs.
- `credit: { uses_report, reason, rule_version }` on every report and on `ADDRESS_NOT_RESOLVED` / `OUTSIDE_COVERAGE`. It
  says whether a trial customer's report would use one of the 20 free reports.
  - The one owner is `_shared/credit-rule.ts` `creditDecision()`.
  - This endpoint charges nothing.

`publisher_status` is the publisher's word, verbatim, and is never replaced by the lifecycle. `homesignal_observation` is
HomeSignal's own retrieval times, labelled as observations. `homesignal_detected_changes` exists only where the ledger proves a
change, and states `from` and `to` for each changed field.

## 5. Decisions taken by default (the founder may change any of them)

- **D-G1. Access is a signed-in user in `dashboard_admins`, as an internal diagnostic surface.** The plan permits exactly this
  for a path that "cannot function as an unlimited customer generator" before the account, entitlement and quota units exist.
  Orders H and L replace `isAdmin` with the entitlement check. Rate limiting, idempotency keys and token-replay protection
  (plan Step 9) need state and belong to those orders; they are **not** built here. The comparison is exact-match, the same as
  `public.hs_acquisition_metrics`.
- **D-G2. The rights registry ships empty, and an unlisted family is excluded.** Consequence, stated plainly: until a family is
  recorded as cleared, **every customer report is LIMITED COVERAGE with no records.** Clearing a family is one reviewed edit
  (registry_id, date, audit reference, attribution) plus the pin `national-report-structure.test.mjs` 6a, so the decision is
  visible twice. Nothing here decides which families are cleared.
- **D-G3. An `internal` view exists, admin-only.** It shows uncleared records, each labelled `HOLD`, marked
  `INTERNAL_VIEW` and `CONTAINS_UNCLEARED_SOURCE`, and can never be stored. It exists so the pipeline can be checked against
  real records while the registry is empty; it does not reinterpret a HOLD as cleared.
- **D-G4. "Recent" is 90 days** (the plan's own example), one constant. Recent official activity is a publisher event of kind
  filed, issued, decided, awarded, completed or hearing, inside `[today − 90, today]`. An operating record appears only when it
  carries such an event or a proven change (R3, open decision 2's default).
- **D-G5. "What Changed Recently" requires a change-ready record with a material reportable event inside the window.**
  Anything else that has a recent publisher event is Recent Official Activity, never labelled a detected change (plan Step 4).
- **D-G6. Type and lifecycle come from the authority through a generated copy.** No function imports from outside its own tree
  and the bundle needs the file, so the copy is produced mechanically and proven identical (structural 1a). `Decided` stays
  lifecycle `unknown` with the publisher status kept: that is the known mismatch (open decision 4), and it is not patched here.
  *(Superseded 2026-10-01 by the `Decided` fix: the authority now maps `Decided` to lifecycle `proposed`, the generated copy was
  regenerated, and the publisher status `Decided` is still kept verbatim beside it. National-report test 3b says so. **A deployed
  `get-development-activity-report` carries the copy it was deployed with**, so it read `Decided` as `unknown` until that function was
  redeployed from `main`. **Redeployed 2026-10-01 22:56Z (v3, run `36937982242`, source hash `77f3d344…`); receipt in the follow doc §9b.**)*
- **D-G7. Coverage is assessed on the records returned for the radius, and the report says so.** Step 10's per-ZIP
  source-applicability measurement is not built; this engine cannot see what a cleared source *should* have covered.
- **D-G8. A record with no source URL, or that is not a development record, is not in the report** (Regulatory is an overlay, R1).
- **D-G9. One copy of a project per ZIP page: the newest `last_seen_at`** (the order the N5 shadow read already uses).
- **D-G10. The default radius is 1 mile.** The allowed radii are the four the spatial read accepts.
- **D-G11. Nothing is stored by this endpoint.**

## 6. The five gates after this unit (`report-private-context-contract` §6)

| # | Gate | Was | Now |
|---|---|---|---|
| 1 | the exact address resides only in the deletable layer | enforced; not proven for a real engine | **proven for this engine**, on the real writer: `national_report_pg` stores its output and asks the database what it holds |
| 2 | the permanent snapshot holds no raw address elsewhere | backstop with named limits | **proven for whole values and fragments** on the real path; the fragment case shows the database accepting it and the engine's check catching it (`national_report_pg` 4c) |
| 3 | deleting private context does not damage history | proven | proven again on this engine's reports (`national_report_pg` 3a–3f) |
| 4 | Follow / Changes Since Report works while private context is active | half proven | *(at that time) still open — no Follow surface or reader existed.* **Since built and proven end to end on a disposable Postgres, with stand-ins stated in its doc** (2026-10-01): `docs/development-activity-follow-changes-2026-10-01.md`; deployed 2026-10-01 (refusals and capability verified live; no signed-in call yet) |
| 5 | retention clock and purge testable and auditable | proven; not armed | **still open** — the purge is not scheduled |

**Storing a real customer report stays switched off.** *(When this table was written, two gates were open: 4 and 5. Gate 5 has since been armed and gate 4 built; the open parts of gates 1, 2 and 5 are listed in the contract §6.)* This endpoint does not call the writer.

## 7. What this does NOT do (stated, not hidden)

- **No stored report, no `report_id`.** Order F's writer is untouched and uncalled.
- **No entitlement, quota, idempotency, rate limit or replay protection** (D-G1): Orders H, L, M.
- **No customer-facing content today.** The rights registry is empty (D-G2).
- **No "Things to Review With Your Client" section.** The plan lists it, but "investigation consideration" has no defined rules and
  none was invented. Order I designs the layout after the data contract is proven.
- **No source-applicability model** (D-G7) and **no per-source freshness SLA** (open decision 8).
- **No allow-list of record addresses** for a subject that is itself a project site (contract §8.3): such a report is marked not
  storable (fail closed), `national-report.test.mjs` 7g.
- **Geocoding depends on the Census one-line geocoder** through the existing `geocode-address`. The rights audit lists the
  geocoder's redistribution terms as not established; the address is used to find a point and is not redistributed, but this is
  the audit's item, not settled here.
- **Change intelligence is empty today** (`dev_change_event_reportable` = 0), so every report is Recent Official Activity until a
  recurring observation job exists (open decision 9). That job, the ledger writer question (option (b)), and the `Decided` fix
  are separate changes.
- **Performance on production is not yet measured** for dense 5-mile areas; the smoke test records it.

## 8. Proof

- `test/national-report.test.mjs` — **117** checks on the assembly: the rights gate, the window and its sentinels, Type and
  lifecycle equal to the source authority on 9 types × 10 statuses, change intelligence, coverage states, the split on six
  subjects, and the boundary check by name.
- `test/national-report-function.test.mjs` — **85** checks on the access model and the reads: no token, the anon key, a signed-in
  non-admin, a failing auth or allow-list service, validation after identity, size bounds, fail-closed reads (a refused radius is an
  error and never "nothing nearby"), the row cap, CORS, nothing logged, and the exact requests `data.ts` sends.
- `test/national-report-structure.test.mjs` — **64** pins *(59 when this endpoint deployed; re-pointed at the shared files and extended by the Follow change)*: one classifier, one geocoder, one spatial read, nothing stored, JWT
  pinned, the rights registry closed, the round trip wired to CI.
- `test/national_report_pg/` — **28** checks: the engine's real output through the real snapshot module and the real Postgres
  writer (run in `report-snapshot-suite.yml`, Postgres 17, no Supabase credential).
- `test/national_report_mutants.py` — **109** prohibited mutations *(107 when this endpoint deployed)*, each killed by a named suite. The first run left four
  survivors, and each was a real finding: an invalid date that sorted inside the window as text, a redundant sort, an untested
  default radius, and an inert mutation; a later run found a merge-gate pin that matched the wrong trigger. All fixed.
  (Manual, like the other module mutation loops: CI runs the tests, not the loop.)

## 9. Deployment and smoke

Not deployed when this file was written. The production receipt is recorded as §11 after the deploy and the smoke test, in its own
change, so this file never describes a state it did not measure. **§11 now exists; read it for what is live.**

## 10. Rollback

No database object changed. To remove the endpoint: delete the function (Supabase dashboard or `supabase functions delete
get-development-activity-report`). Nothing else depends on it.

## 11. Production receipt (2026-09-30) — deployed, gates smoked, the signed-in path NOT exercised

**Deployed.** `deploy-edge-functions.yml` run `36648751939` (dispatch from `main`, head `51e495b`, the #1483 merge) succeeded in
under a minute (job 00:07:46–00:08:26Z), every step green, including the unconditional post-deploy `registry_incomplete_entries` recompute (checked beforehand to be a
no-op: md5 `24d72bc484e5c34ab4691fef3d710949` on both sides, 10 rows, registry sha `d9dabc6b…`). Read back with
`list_edge_functions`: slug `get-development-activity-report`, **ACTIVE, version 1, `verify_jwt: true`**, entrypoint the repo path
`supabase/functions/get-development-activity-report/index.ts`. The 20 other functions in the listing all carry an update time
earlier than this function's creation, so the run changed none of them.

**What was exercised in production** (from Postgres through `pg_net`, since the sandbox has no egress; requests 6896–6899):

| probe | answer | what it shows |
|---|---|---|
| POST, no `Authorization` | **401** `UNAUTHORIZED_NO_AUTH_HEADER` | the gateway refuses an unsigned call |
| POST, `Bearer not-a-real-token` | **401** `UNAUTHORIZED_INVALID_JWT_FORMAT` | the gateway refuses a malformed token |
| POST, the public **anon key** as apikey and Bearer | **401** `{"error":"unauthorized"}`, `Cache-Control: no-store` | **the second gate works**: the anon key is validly signed and passes the gateway, and the handler's own answer (it has no signed-in user) is what stops it. This is the case the design exists for. |
| GET, anon key | **200**, `stores_reports: false`, `access: "signed-in internal user only …"`, `Cache-Control: no-store` | the capability answer, and the store switch reads OFF |

**Nothing was stored.** Read straight after: `report_snapshot` **0** rows, `report_private_context` **0** rows (controls in the same
query: `dashboard_admins` 1, `canonical_zip_registry` 12,722). The endpoint never calls the writer (pinned), and none of the four
probes got past authentication, so none reached a data read.

**What was NOT exercised, and must not be read as proven:** the signed-in, allow-listed path (geocode → registry → radius →
hydrate → ledger → events → health → compose). The sandbox holds no admin session token and none was minted or forged, so **no
end-to-end report has been generated in production.** What stands in for it is narrower, and each piece is a read of production:

- **Every column the function selects exists**: 38 of 38 (`app_projects` 16, `dev_change_project` 7,
  `dev_change_event_reportable` 9, `dev_change_source_health` 4, `dashboard_admins.email`, `canonical_zip_registry.zip`). A wrong
  column name would have turned every admin call into a 502; none is wrong.
- **The spatial read answers with the shape the function expects**: `n5_projects_within_radius(lat, lng, radius, limit)` returns
  `source_key, feature_id, registry_id, provenance, distance_mi, geometry_type, marker_lat, marker_lng, has_more`. New Orleans,
  1 mile: 100 rows, 100 distinct projects, nearest 0.111 mi, farthest 0.995 mi, `has_more` false (so the 100 is a real count and
  not a cap). Same point, 5 miles: 1,000 rows, `has_more` **true** — the truncation the report discloses as `AREA_TRUNCATED`.
  Brigham City, 1 mile: 10 rows.
- **The ledger has no events to report yet**: `dev_change_event_reportable` holds **0** rows, against `dev_change_project` 932,969
  and `dev_change_source_health` 237. So today no project can reach **What Changed Recently**; everything a report shows is
  **Recent Official Activity** from the publisher's own dates, and the change section is empty by construction until a second
  observation of the same records exists. That is Order D's recurring observation, which is a separate go.

**Database cost, measured in Postgres only** (the Census geocode and the network are not in these numbers): the 5-mile radius read
at New Orleans, 1,000 rows, **134 ms**; the 1-mile radius read joined to a 25-key hydrate from `app_projects` (an index-only scan,
256 rows) in one plan, **109 ms** in total, so the hydrate alone is less than that. A full 5-mile report reads up to 40 hydrate
chunks, four at a time; the total for a whole request was not measured.

**A limit found while measuring, not fixed here.** A project has one `app_projects` copy per ZIP page it appears on, so a 25-key
chunk returns more than 25 rows. Six dense centres at 5 miles (each 1,000 keys, sorted as the handler sorts them): worst chunk
**572 rows** (Chicago Loop), most copies of one key **38** (Miami), **0 chunks at or over the 1,000-row cap**. `data.ts` refuses a
response that reaches the cap, so a chunk that did reach it would fail the request as `data_unavailable` (502), never return a
short list. That is the safe direction, but the margin at Chicago is under a factor of two. The fix is to split a capped chunk and
retry rather than fail; it is a code change and is **logged, not taken**.

**Still true after deploy:**
- Nothing customer-facing exists: no page, no navigation, no caller. The only callers are a signed-in allow-listed user with a
  hand-built request.
- The rights registry is empty, so every customer-view report is LIMITED COVERAGE with no records; the internal view shows records
  labelled HOLD and reports `storable: false` with its blockers.
- Storing a real customer report stays off until the two open gates in the private-context contract §6 close: the Follow / Changes
  Since Report surface, and arming the purge (a new scheduled job, its own go).
  *(Dated annotation, 2026-10-01: the purge is armed and reading ok — contract §13 — and the Follow / Changes Since Report function is
  built, proven end to end and deployed (2026-10-01, no signed-in production call yet): `docs/development-activity-follow-changes-2026-10-01.md`. The text above is the state at deploy.)*

**Annotation, 2026-10-01 (the Follow change).** This function was refactored onto the shared modules named in §4, and its source-health read
now queries the new narrow view `dev_change_source_fetch_health` (applied to production, migration `20261001220554`; the follow doc §6b has
the measurement: 6.1–6.2 s on the wide view against PostgREST's 8 s timeout, about 0.1–0.2 s on the narrow one). **What is deployed is the
2026-09-30 version recorded above, which reads the wide view** *(superseded 2026-10-01 22:32Z: the refactored function is deployed as v2, reading the
narrow view; follow doc §9 has the run, the smoke and the one thing not exercised, a signed-in call)*. This section's receipt describes the
2026-09-30 code and is left as written.

**Rollback** is §10: delete the function. Nothing depends on it.
