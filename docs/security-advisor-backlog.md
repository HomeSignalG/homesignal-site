# Security-advisor backlog (logged 2026-07-17)

Pre-existing findings from the Supabase security advisor, captured during the
staging-`_*_zips` RLS cleanup (see `docs/staging-zips-cleanup.sql`). **None of
these were introduced by — or belong to — the regulated-facilities-entity PR**;
they are parked here so they get a deliberate pass instead of drive-by fixes.

## 1. ERROR — look at soon

- **`public.feed_inventory_live` is a SECURITY DEFINER view.** A security-definer
  view runs with its owner's privileges, so it bypasses the RLS of every table it
  reads — the advisor flags it because a grant to `anon`/`authenticated` on the
  view silently pierces `feed_inventory`'s RLS. `feed_inventory`'s own comment
  says "read only via owner-run view feed_inventory_live," so this may be the
  intended design — but that intent should be confirmed and documented (who can
  select the view, and is everything it exposes safe for that audience?). If the
  exposure is intended, consider `security_invoker = false` documentation + a
  narrow column list; if not, recreate with `security_invoker = true`.

## 2. WARNs — a deliberate pass, not urgent

- **14 SECURITY DEFINER functions executable by `authenticated`** (7 of them by
  `anon` too): `dev_gate_catchup`, `hs_acquisition_dashboard`, `hs_acquisition_live`,
  `hs_acquisition_metrics`, `hs_approve_social_post`, `hs_social_followers`,
  `hs_zip_behavior`, `incr_geocode_usage`, `is_social_admin`, `signup_complete`,
  `upsert_geocode_if_better`, plus PostGIS's `st_estimatedextent` (×3 overloads).
  Several are the documented RPC pattern (admin-gated inside the function body —
  e.g. the acquisition dashboard / social-approve family); the pass should verify
  each one actually checks its caller and revoke execute where it doesn't need
  public exposure.
- **8 functions with a mutable `search_path`**: `app_refresh_all`, `app_refresh_zip`,
  `apply_status_rows`, `geocode_quality_rank`, `pods_in_project_parcels`,
  `prevent_mutation`, `subscriptions_set_updated_at`, `touch_updated_at`.
  Fix is mechanical: `alter function … set search_path = public` (or pin per body).
- **2 extensions installed in `public`**: `pg_net`, `postgis`. Moving them is
  disruptive (PostGIS especially); standard advice is a dedicated schema for new
  installs — probably accept-and-document.
- **2 always-true RLS policies**: `public.app_premium_waitlist`, `public.events`.
  `events` is the documented anonymous INSERT-only analytics table — likely
  intended; confirm the waitlist table means to allow the same.

## 3. INFOs — mostly intentional, verify then annotate

- **25 `public` + 15 `outreach` tables with RLS enabled and no policies.** In this
  repo that is the documented **service-role-only pattern** (e.g. `source_fetch_cache`,
  `echo_violation_counts`, `feed_inventory`, `geocodes`, `resolved_project_status_audit`) —
  RLS-on with no policies denies `anon`/`authenticated` while the service role
  bypasses RLS. The pass should confirm each table really is service-role-only
  (nothing browser-side reads it) and annotate the intent in a table comment, so
  the advisor noise stops reading as risk. The full `outreach.*` schema (15 tables)
  needs the same one-time confirmation.

## Explicitly out of scope here

- `spatial_ref_sys` RLS-off — PostGIS system table, founder call to leave as-is
  (the one intentional `rls_disabled_in_public` line).
- `_fl_zips` — in-flight Florida batch worklist, secured 2026-07-17; see the
  drop-by note in `docs/staging-zips-cleanup.sql` / DECISIONS.md.
