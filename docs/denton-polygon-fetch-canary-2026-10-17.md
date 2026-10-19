# Denton: re-audit, miss probe and polygon-fetch canary, 2026-10-17

Companion to `denton-acceptance-matrix-2026-10-14.md` (see its 2026-10-16 section). Read-only measurements except the canary, which the founder approved.

## Re-audit (run 39039436258)
Identical to 2026-10-16: PASS 5 / UNKNOWN 15 / FAIL 12. The "serving generation lag" hypothesis is refuted. Verdict stays NO-GO on data currency.

## Cause of the 12 FAILs (probe on sampled missing permits)
All 5,298 missing records are `denton-county-dev-permits` permits that are inside the ZIP polygon but outside the 3-mile square around the ZIP centroid (`spatial_zip_radius_mi: 3`). Page membership was already polygon-based; only the FETCH step was radius-based. Records outside the square were never fetched.

## Fix
The existing polygon-bounds fetch (PR #1794, #1826, #1840; runbook `docs/zip-scope-bounds-runbook.md`), staged OFF. Scope = legacy square UNION the ZIP polygon bbox, widened candidates tested against the polygon by `public.zip_scope_members`; falls back to the legacy scope on any failure. Controlled by function secrets `ZIP_SCOPE_BOUNDS_MODE` (off|allowlist|all) and `ZIP_SCOPE_BOUNDS_ZIPS`.

Applied to production this session (founder-approved): `public.zip_scope_members`, `public.zip_scope_bounds`, `public.zip_geom_sig` (service_role only).

## Canary: ZIP 76258 (allowlist mode, request fired 17:13Z)
- Recovered 257 candidates; county stored rows 252 -> 412.
- Gates 1-4 and 6-11 pass.
- Pending: gate 5 (served half; needs the next serving generation) and gate 12 (change ledger; needs the overnight observation). Baselines: reportable events 94,961 total / 20,298 county, newest 2026-10-17 08:55Z; 76258 serving 314 records, fingerprint afa9141e1c032dead9db17493d89f364.

## Approved national ramp (founder, 2026-10-17)
76258 -> 76247 -> 76227 -> wider batch (~25 ZIPs, other states and sources) -> `ZIP_SCOPE_BOUNDS_MODE=all`. Each step only if ALL prior gates pass. On any failed gate the founder sets mode `off` and widening stops. Note: mode `off` does not keep recovered rows; the next refresh deletes them.

## Not approved / not done
- Removing the legacy 3-mile square from the fetch.
- Any backfill outside the ramp.
- Making Denton data current: the county layer is frozen at 2023-06, so recovered permits are 2009-2023. Current data must come from City of Denton sources.
- `docs/denton-acceptance-evidence.json` (no measured evidence exists).
