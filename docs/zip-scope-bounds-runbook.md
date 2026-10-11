# ZIP polygon-bbox scope — preflight, apply, rollback, canary (2026-10-11)

**STATUS (2026-10-11).** Done and verified by their own approvals: PR #1794 merged (main `409f6ac` at the time of writing),
`public.zip_scope_bounds` applied (§1–§2), `get-address-report` v269 deployed with the rollout switch OFF. **Not done:**
`public.zip_scope_members` (§1b) is written and tested but NOT applied; no ZIP has been canaried; no refresh has been run
with the scope on; national scope is not enabled. Every remaining step needs explicit approval.
Design and evidence: `docs/geographic-coverage-audit-2026-10-10.md`.

> **What changed after the first draft of this file.** Widening the fetch to the polygon bounding box *by itself* stores
> neighbouring ZIPs' records on this ZIP (the box is a prefilter, not the boundary). The engine now widens a source **only
> together with a polygon-membership function**: records the legacy scope already returned are untouched, records added
> *solely by the box* are tested against the canonical polygon in one bounded batch call, members are kept and the rest are
> excluded and counted. If membership cannot be **known**, that source uses the legacy scope. Apply §1b **before** any canary.

## 1. Production preflight (read-only, run 2026-10-11, BEFORE `zip_scope_bounds` was applied — kept as the dated record)

| check | result |
|---|---|
| `public.zip_scope_bounds` already present | **0** functions at the time (applied afterwards, own approval) |
| canonical boundary authority | `geo.zip_membership_boundary(p_zip text) → geometry`, one overload, owner `postgres`, `search_path=geo, public, pg_temp`, body md5 `dcdbc1c1af024be35041d045070342ff` |
| coordinate system | `geo.zcta_boundary.geom` = `geometry(MultiPolygon, 4269)` (NAD83), 33,791 rows; function output SRID 4269. NAD83 ≈ WGS84 to ~1 m; the scope box is a *prefilter* with the legacy square unioned in, so that offset cannot change membership (membership stays polygon-based downstream) |
| PostGIS schema | `public` (so `ST_XMin…` resolve under the wrapper's `search_path = geo, public, pg_temp`) |
| wrapper body evaluated as a plain SELECT for 76247 | 1 row (works) |
| bounds, production vs the test fixtures | 76258 `-97.0372, 33.288322, -96.815242, 33.449421`; 76247 `-97.419356, 33.005089, -97.226825, 33.179387`; 76227 `-97.123906, 33.188336, -96.863538, 33.357867` — **identical to `test/zip-scope-box.test.mjs` fixtures**; `'00000'` → null (no row) |
| privilege model | default function ACL in `public` grants EXECUTE to **anon, authenticated, service_role directly** (`pg_default_acl`). So a new function is open to anon until revoked **by name**. `geo.zip_membership_boundary` itself has `acl = null` (PUBLIC execute) and `service_role` has no `USAGE` on schema `geo`; the wrapper is `SECURITY DEFINER` owned by `postgres`, so the engine does not need `geo` access |

`docs/zip-scope-bounds.sql` revokes `public`, `anon`, `authenticated` by name, grants `service_role`, and its `DO` block
aborts the whole migration unless: anon/authenticated cannot execute, service_role can, 76247's box equals the
canonical boundary's, and `'00000'` yields no row.

## 1b. `public.zip_scope_members` — widened-only polygon containment (NOT APPLIED)

`docs/zip-scope-members.sql`: `zip_scope_members(p_zip text, p_pts jsonb) → table(ord int, verdict text)`. A batch wrapper
over the **one** existing predicate (`geo.zip_membership_boundary` once per call, `geo.zip_point_membership_in` per point;
boundary-inclusive). Input `[[lat,lng],…]`, at most 1000 per call (the engine sends ≤ 500). One output row per input element,
in input order (`ord` = 1-based position). A malformed *element* → `no_coordinates` for that element only; a malformed
*call* (bad ZIP, not an array, > 1000, null) raises `22023`, which the engine treats as "membership unknown". A ZIP with no
boundary → `not_measured` for every element (never a guessed geometry). `SECURITY DEFINER`, `search_path = geo, public,
pg_temp`, revoked from `public`/`anon`/`authenticated` **by name**, granted to `service_role`; the file's `DO` block aborts the
migration if the privileges or the correspondence/malformed-element behaviour are wrong.

Proof: `test/zip_scope_members_pg/run.sh` (disposable PostGIS; 22 checks incl. an irregular L-shaped polygon, boundary edges,
neighbour edge, centroid-proximity-is-not-membership, equality with the canonical predicate over a grid, privileges, and a
1000-point batch in ~8 ms) + six prohibited mutations, all killed. CI: `zip-scope-members-suite.yml`.

Deploy-order safety: with the function **absent**, a widened attempt gets an RPC error, falls back to the legacy scope for
that source and reports `scope_membership.legacy_fallback = "membership_error"`. So deploying the engine before applying
this SQL is safe (it behaves as OFF), but a canary run then proves nothing — apply and read back first (same procedure as §2,
function name `zip_scope_members`; rollback `drop function if exists public.zip_scope_members(text, jsonb);`).

### Eligible source configurations (re-derived 2026-10-11 from `jurisdiction-registry.json`)

`spatial_zip_radius_mi` is declared by **180** entries: **172 ArcGIS, 7 Socrata, 1 CSV** (Socrata: chicago, cambridge ×3,
mesa, new-orleans, austin-zoning-cases; CSV: san-diego-approved-permits) — matches the documented cohort, no discrepancy.
Carto/CKAN/OpenDataSoft entries have none and are untouched. Two ArcGIS entries use `spatial_latlng_cols` (attribute-bbox
mode); the containment path reads those attributes.

### Run-report fields (per source, only when the widened scope ran)

`scope_membership`: `widened_candidates` (records added solely by the box and tested) = `members_recovered` +
`outside_excluded` + `unresolved_excluded`; `no_point_kept` (returned by the widened query with no resolvable point; kept as
the legacy query would have); `rpc_calls`, `rpc_failures`; `rows_scanned`; `capacity_truncated`; `legacy_fallback`
(`null` | `membership_error` | `candidate_limit` | `scan_limit` | `capacity_overflow`). **Polygon exclusion is
`outside_excluded` — it is correct, raises no truncation, no quarantine and no `scope_widened_rows_dropped`.**
`scope_widened_rows_dropped` (CSV) now means *only* "members dropped by the `max_rows` cap". `scope_fallback` is
`legacy_after_overflow` (kept rows exceeded `max_rows`) or `legacy_after_membership_error`. Neither fallback quarantine
starts with `fetch failed:`, so the source-failure guard (`docs/dev-refresh-source-failure-guard.sql`) is not engaged by them.

Bounds: widened-only candidates per fetch ≤ 10,000; rows *scanned* ≤ 4 × `max_rows`; kept rows ≤ `max_rows`. Excluded records
never consume `max_rows`, so they cannot hide in-polygon records behind the cap (control in the test: without filtering the
same fixture truncates at the cap).

## 2. Apply `zip_scope_bounds` — DONE; the same procedure applies to `zip_scope_members` (§1b)

Additive: creates one function, touches no table. Per `CLAUDE.md` §7.11, **do not** run `begin; DDL; rollback;` against
production as a "dry run" — apply once, for real, as a single migration so the in-file post-conditions are the gate:

1. `mcp__Supabase__apply_migration` with the *exact* contents of `docs/zip-scope-bounds.sql` (name `zip_scope_bounds`).
   One implicit transaction; if any post-condition raises, nothing is created.
2. Read back (read-only): `has_function_privilege` for anon / authenticated (must be false) and service_role (true);
   `select * from public.zip_scope_bounds('76247')` equals the §1 row; `('00000')` → no row; the stored function text
   equals the file.
3. Through the API with the public key, `rpc/zip_scope_bounds` must return HTTP 401/`42501`; an unknown function
   returns 404 `PGRST202` (control, proving the 401 is the privilege and not routing).

Applying changes **no behaviour**: the engine ignores the function until deployed *and* the policy turns it on.

### Rollback

```sql
drop function if exists public.zip_scope_bounds(text);
```

Safe at any time: with the function gone `zipScopeBounds` returns `{bounds:null}` (RPC error → legacy scope), so the
engine degrades to today's behaviour with no deploy. Already-stored recovered rows are *not* deleted by this (see §4).

## 3. Deploy — v269 DEPLOYED (switch OFF); a redeploy is needed for the containment code and needs its own approval

`deploy-edge-functions.yml` ships whatever `main` is. With `ZIP_SCOPE_BOUNDS_MODE` unset the deployed code issues the
legacy query string byte for byte and makes **no** bounds call (pinned by `zip-scope.handler.test.ts`). Before deploying,
confirm the secret is unset/`off` so the rolling refresh (240 ZIPs/h) does not start a national re-fetch.

Rollback of the deploy: redeploy the previous commit; or set the mode secret to `off` (read per request).

## 4. Canary — 76258, then 76247, then 76227 (each gate must pass before the next)

Enable per ZIP only through the server secrets: `ZIP_SCOPE_BOUNDS_MODE=allowlist`, `ZIP_SCOPE_BOUNDS_ZIPS=<one ZIP>`.
No request parameter can do this. Refresh only the listed ZIP (targeted refresh path), not a sweep.

**Freeze first** (read-only, before the refresh): `app_projects` rows for the ZIP's registry, N5 serving membership
fingerprint, `email_deliveries` and `social_posts` counts, `app_changes` count, `development_reports` row bytes and
`refreshed_at`, and the Rule D plane entry for the ZIP. Record `max(created_at)` / row counts of shared tables (Rule #0a).

Per-ZIP gates — **all** must pass:

1. **Honest recovery accounting.** Read the Denton source run report for the refresh. Read
   `scope_membership` first: recovery is claimed only if `legacy_fallback` is `null`, `rpc_failures = 0`,
   `unresolved_excluded = 0` (or explained), `capacity_truncated = false` and `members_recovered > 0`. If the report carries
   `scope_fallback`, `truncated_at_max_rows`, `scope_widened_rows_dropped`, or a `fetch failed:` quarantine, the run did
   **not** recover the polygon-only records; report it as "fell back / truncated / failed", never as recovered. A large
   `outside_excluded` is *correct* (neighbouring ZIPs' records) and is not a defect.
2. **Exact source-key recovery.** The recovered set = (source records inside the ZIP polygon) − (keys already stored).
   Compare by `source_key`, not by counts. Expected pilot figures from the audit (polygon members absent from
   `app_projects`): 76258, 76247, 76227 — re-measure; do not copy numbers from this file.
3. **Canonical identity.** `count(distinct source_key) = count(*)` for the registry in the ZIP; no duplicate entities.
4. **Publication eligibility.** Recovered rows pass the same `status_to_bucket`/rights rules; the `Decided` (withdrawn/
   denied) subset is counted apart and does not enter open-proposal counts.
5. **Polygon membership.** After the next serving generation, every added served row is inside the polygon
   (`served ⊆ polygon`); box-only neighbours are stored but not served for this ZIP.
6. **Cache safety.** `dev_refresh_collect` did not preserve a stale row because of a failure (no `dev_failed_sources`
   entry); `development_reports.sites` is not smaller than before except by dedupe; `facilities_refreshed_at` untouched.
7. **Zero unintended alerts.** `email_deliveries`, `social_posts`, `app_changes` (development, non-point scope) counts
   unchanged; the newest recovered record date is checked against `RECENCY_DAYS = 45` / the 365-day data-centre window.
8. **Fetch caps.** Pages fetched and rows vs `max_rows` (20,000); largest pilot box ≈ 11.6k; `rows_scanned` ≤ 4 × `max_rows`.
9. **Elapsed time, payload size.** Wall time of the report call; row bytes (precedent: 75068 ≈ 6.8 MB text); must stay
   within the edge worker budget.
10. **Production error rates.** `get-address-report` 4xx/5xx and `57014` counts in `query_logs` for the window, against
    the pre-change hour; Rule D plane and `indexable` for the ZIP unchanged unless listed and explained.

11. **Collection is verified for THIS request, not inferred.** HTTP 200, or unrelated successful `dev_refresh_tick` runs,
    prove nothing. Record the request id of the canary fire and require: that request id's response was collected (the ZIP's
    `last_collected_response_id` advanced to or past it), `development_reports.refreshed_at` advanced after the fire,
    the recovered `source_key`s are persisted in `app_projects`, and no `dev_failed_sources` / failure-guard rejection was
    recorded for it. See `docs/dev-refresh-collector-incident-2026-10-11.md`.
12. **Historical-recovery protection** (once PR B is applied): the recovered keys are classified as recovery, not new
    development — zero `first_detected` reportable events for them, zero alerts/watch/social items. Until PR B is
    applied and verified, **do not canary a ZIP that has ledger observations enabled** without an explicit decision.

Stop on the first failed gate: set the mode secret back to `off`, report. Do not proceed to the next ZIP.

### Rolling back a canary — what actually happens to recovered rows (read from the live `app_refresh_zip`, 2026-10-11)

**Mode → `off` does NOT preserve recovered data.** It only makes *later fetches* legacy-scope. On the next refresh of the ZIP:

1. `dev_refresh_collect` stores the legacy-scope result as `development_reports.sites` (a complete legacy result is a normal,
   successful refresh — the failure guard only protects against *failed* sources).
2. `app_refresh_zip` rebuilds `app_projects` from those sites and then **deletes every `app_projects` row of the ZIP whose
   `(source_key, source_seq)` is not in that refresh's expected set**, except rows referenced by `property_company_roles`,
   `project_facility_refs` or `identity_conflicts` (live function, lines `delete from public.app_projects p where p.zip=_zip and
   not exists (select 1 from unnest(_dk || _fk, _ds || _fs) …)`). Recovered rows are therefore **removed** by the first
   legacy refresh + materialization; referenced ones persist and are reported by the function as "kept".
3. `app_changes` for the ZIP is deleted and rebuilt, so recovered rows leave the page's change list.
4. Map 1 / the ZIP page read the **serving N5 generation**, which was built from `app_projects`. Recovered rows keep being
   served until the next daily generation is activated; after that they disappear. (This is expected lag, not preservation.)
5. Re-enable → the next expanded refresh re-fetches and re-stores them; identity (`source_key`) is unchanged.

So the honest description of OFF is: *"future fetches use the legacy scope; recovered records lapse at the next refresh"*,
never *"recovered data is kept"*. Deleting is done by the existing materializer, not by this change; nothing here archives or
re-adds rows. A rollback that must **retain** recovered rows is not offered by the current materializer — if it is ever
required it needs its own, separately approved design (archive-first).

**Universal operational policy (no per-ZIP exceptions).** (a) Enable/disable only through the two server secrets. (b) Before
disabling a ZIP that has been serving recovered rows, decide deliberately: disabling *is* a data reduction on that ZIP's next
refresh. (c) After any enable or disable, re-measure that ZIP's `app_projects` count, N5 served count and
`scope_membership` counters rather than assuming. (d) A recovered record that vanished because the mode went OFF is **not**
"unverified" or "stale-but-current": it is absent; nothing keeps it looking current.

## 5. Not part of this change

National enablement (`ZIP_SCOPE_BOUNDS_MODE=all`), the other 177 radius-scoped configurations, ring-based (non-box)
scoping, and Denton source freshness (newest record 2023-06-09: restoring geography does not create currency).
