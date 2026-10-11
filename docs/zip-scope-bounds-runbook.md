# ZIP polygon-bbox scope — preflight, apply, rollback, canary (2026-10-11)

**STATUS: NOTHING IN THIS FILE HAS BEEN EXECUTED.** SQL not applied, engine not deployed, no ZIP refreshed, national
scope not enabled. Every step needs explicit approval. Design and evidence: `docs/geographic-coverage-audit-2026-10-10.md`.

## 1. Production preflight (read-only, run 2026-10-11)

| check | result |
|---|---|
| `public.zip_scope_bounds` already present | **0** functions — not applied |
| canonical boundary authority | `geo.zip_membership_boundary(p_zip text) → geometry`, one overload, owner `postgres`, `search_path=geo, public, pg_temp`, body md5 `dcdbc1c1af024be35041d045070342ff` |
| coordinate system | `geo.zcta_boundary.geom` = `geometry(MultiPolygon, 4269)` (NAD83), 33,791 rows; function output SRID 4269. NAD83 ≈ WGS84 to ~1 m; the scope box is a *prefilter* with the legacy square unioned in, so that offset cannot change membership (membership stays polygon-based downstream) |
| PostGIS schema | `public` (so `ST_XMin…` resolve under the wrapper's `search_path = geo, public, pg_temp`) |
| wrapper body evaluated as a plain SELECT for 76247 | 1 row (works) |
| bounds, production vs the test fixtures | 76258 `-97.0372, 33.288322, -96.815242, 33.449421`; 76247 `-97.419356, 33.005089, -97.226825, 33.179387`; 76227 `-97.123906, 33.188336, -96.863538, 33.357867` — **identical to `test/zip-scope-box.test.mjs` fixtures**; `'00000'` → null (no row) |
| privilege model | default function ACL in `public` grants EXECUTE to **anon, authenticated, service_role directly** (`pg_default_acl`). So a new function is open to anon until revoked **by name**. `geo.zip_membership_boundary` itself has `acl = null` (PUBLIC execute) and `service_role` has no `USAGE` on schema `geo`; the wrapper is `SECURITY DEFINER` owned by `postgres`, so the engine does not need `geo` access |

`docs/zip-scope-bounds.sql` revokes `public`, `anon`, `authenticated` by name, grants `service_role`, and its `DO` block
aborts the whole migration unless: anon/authenticated cannot execute, service_role can, 76247's box equals the
canonical boundary's, and `'00000'` yields no row.

## 2. Apply (when approved)

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

## 3. Deploy (when approved)

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

1. **Honest recovery accounting.** Read the Denton source run report for the refresh. If it carries
   `scope_fallback`, `truncated_at_max_rows`, `scope_widened_rows_dropped`, or a `fetch failed:` quarantine, the run did
   **not** recover the polygon-only records; report it as "fell back / truncated / failed", never as recovered.
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
8. **Fetch caps.** Pages fetched and rows vs `max_rows` (20,000); largest pilot box ≈ 11.6k.
9. **Elapsed time, payload size.** Wall time of the report call; row bytes (precedent: 75068 ≈ 6.8 MB text); must stay
   within the edge worker budget.
10. **Production error rates.** `get-address-report` 4xx/5xx and `57014` counts in `query_logs` for the window, against
    the pre-change hour; Rule D plane and `indexable` for the ZIP unchanged unless listed and explained.

Stop on the first failed gate: set the mode secret back to `off`, report. Do not proceed to the next ZIP.

### Rolling back a canary

Mode → `off` returns subsequent fetches to the legacy scope. Rows already written by a canary refresh are real source
records inside the polygon; removing them is a destructive data change and is **not** part of any automatic rollback —
it needs its own approval and an archive-first migration.

## 5. Not part of this change

National enablement (`ZIP_SCOPE_BOUNDS_MODE=all`), the other 177 radius-scoped configurations, ring-based (non-box)
scoping, and Denton source freshness (newest record 2023-06-09: restoring geography does not create currency).
