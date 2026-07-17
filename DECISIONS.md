# HomeSignal Phase 1 — Decisions & Assumptions

> Running log of every non-obvious choice, per build prompt v4. Newest at top of each section.
> Items marked **⚠ NEEDS SIGN-OFF** are the review-gate decisions in `PLAN.md` §9 — I have NOT
> acted on them yet.

## Stack & placement
- **Vanilla HTML/CSS/JS in `homesignal-site`, no framework/build step.** Confirmed by build prompt
  v4 (which explicitly supersedes v3's Next.js). Supabase anon key + RLS from the browser;
  ingestion/scoring in the `homesignal-ingest` Python engine. Matches both repos' CLAUDE.md.
- Design tokens + component CSS come **verbatim** from the mockup's `:root`/`<style>`; shipped as
  `app.css`, no Tailwind, no restyle.

## ⚠ NEEDS SIGN-OFF (review gate — see PLAN.md §9)
- **A — Live-page collisions.** `index.html`, `dashboard.html`, `community.html`, `contact.html`,
  `privacy.html` already exist and serve homesignal.net. *Proposed:* build new/colliding
  homepage+dashboard under an `app/` namespace and swap at sign-off; **extend** `community.html`
  in place additively; **update** `contact.html`/`privacy.html` in place. Not yet done.
- **B — Shell injection method.** Runtime `fetch()`-and-inject `partials/shell.html` vs. a
  build-free generator that inlines it per page. *Proposed:* runtime fetch-and-inject.
- **C — Schema reconciliation.** Live DB is keyed by `community_id uuid` + `zip_codes[]`, not the
  prompt's `community_zip`; live `alerts`/`meetings`/`communities`/`user_subscriptions`/
  `contact_messages` already exist. *Proposed:* additive columns on live `communities`; new tables
  for `projects`/`changes`/`properties`/`follows`/`watchlist_items`/`community_requests`/
  `premium_waitlist`; reuse live `contact_messages`; map `topic_prefs` onto `user_subscriptions`.
- **D — Branch/PR.** Develop on `claude/new-session-f6p7jj` in both repos; no PR until asked.

## Product/UX assumptions (from the prompt, will apply once building)
- **Consent checkbox defaults UNCHECKED** — the Privacy page states sharing is off unless chosen,
  and a pre-ticked consent box is invalid under GDPR; policy wins over the mockup's default.
- **Omit** the modal helper line "Try 78657 (covered) or 90025 (not covered yet)." — mockup
  scaffolding, not product copy.
- **Following multiple properties is free** (no gating on property count).
- **Distances are always computed** from the active property's lat/lng (PostGIS), never stored;
  the mockup's printed distances are the computed value for the default home.
- **Reports render on the fly** from existing data — no `reports` table.
- **Map: real MapLibre tiles are the default** (see the 2026-07-16 decision block below — this
  supersedes the original "schematic SVG only" assumption). The schematic SVG is retained as the
  graceful fallback. Flood/Schools layers stay rendered-but-disabled until that data is ingested.
- **Del Valle 78617 is community #1 through the shared code path** — never special-cased; the
  mockup's Horseshoe Bay content is sample data and is replaced by sourced Del Valle content.
- **No paid keys to run:** no paid map provider, no paid LLM; plain-language text is templated with
  a seam for a self-hostable LLM later.

## Reconciliation notes (live repo realities discovered while planning)
- `topics.js` taxonomy (`government_notice` + universal News/Emerging/Global Best Practices with a
  fixed 12-topic universal list) **differs** from the mockup's topic-picker categories
  (gov / meetings / news / dev). At build time the topic picker will be wired to the **live**
  taxonomy where a category maps (so email matching keeps firing), and any mockup-only category is
  logged here before shipping. Not yet reconciled — pending Decision C.
- Del Valle 78617 already has `docs/del-valle-78617-development-reports-seed.sql` and Texas
  community rows; Travis County real feeds (Granicus/Legistar/CivicClerk/EPA-ECHO/TCEQ) already
  exist in the engine. The seed step will **reuse/cross-check** these rather than invent parallel data.

## LOCKED at the review gate (founder direction) — 2026-07-12
- **A → Option 1, fully staged.** The entire new app lives under `/app`; live root pages
  (`index/dashboard/community/contact/privacy`) are **byte-for-byte unchanged** (verified: 0-line
  diff vs pre-build). Preview at `/app/...`; the canonical-URL `?preview=1` guard + promotion
  (moving `/app/*` to root) is a separate sign-off-gated step. "Website, not an app" confirmed:
  separate real HTML pages navigated by query-params, not an SPA.
- **B → runtime fetch-and-inject** `partials/shell.html` (one injected frame with `#hs-slot`).
- **C → additive + reuse.** `docs/phase1-app-schema.sql` adds score columns to live `communities`,
  new tables for projects/changes/properties/follows/watchlist/requests/waitlist, reuses live
  `meetings`/`contact_messages`, maps `topic_prefs` alongside `user_subscriptions`. **Parked, NOT
  applied to production** (repo convention + "nothing on the live path without sign-off").
- **D → branch only**, no PR (both repos on `claude/new-session-f6p7jj`).

## Minimal-honest-action log (unspecified controls)
Search = client-side filter → dropdown; bell = open-window count → alerts; Follow/Watch/Notify =
persist `follows`, flip label; Noted = persist dismissal; Add-to-calendar = generated `.ics`;
Comment/Read = open `source_ref`; sort segments + dev lenses + data-view = real re-sort/table;
map layers Projects/Impact-radius toggle, Flood/Schools disabled w/ tooltip; Satellite/Street
disabled w/ "Available with live map provider"; Compare = disabled "Coming soon"; Watchlist Edit =
stubbed modal note (persists to `watchlist_items` when wired).

## Maps — real tiles, default view, home pin, scale ceiling (2026-07-16)
Decisions from the "Maps is PARTIAL / schematic" review. Files: `maps.html`, `lib/map.js`.

- **#1 — the tile provider IS wired (label was stale).** MapLibre GL JS + **Esri World Imagery**
  (satellite) + **OpenStreetMap** (street) raster tiles, keyless, already live in `maps.html`/
  `lib/map.js::buildGL`. The old "schematic map, real tile provider not wired" note was inaccurate;
  corrected here and in the file headers.
- **#2 — default view is now the REAL map (Satellite) for covered ZIPs.** On load, a ZIP with real
  points to plot (Del Valle 78617 / Utah pass ZIPs) opens on the Esri satellite map with
  impact-tiered pins + a real geodesic radius. Satellite chosen over Street for aerial recognition
  (matches the development tracker `homesignalmap.html`) — one-line change to prefer Street. The
  impact **diagram** (schematic SVG) is retained as the fallback, not the default.
- **#3 (DECIDED, unchanged behavior) — jurisdiction-wide notices are NEVER plotted as map points.**
  A "Planning Commission Meeting" / "Public Hearing" has no trustworthy parcel coordinate (engine
  v18: area items have no point). They render in the list / notices tiles, never as a
  centroid-stacked pin. Anti-fabrication consistent; this is already how the data flows
  (`app_changes`, no lat/lng → dropped by the map's `lat && lng` filter).
- **#4 (SCALE CEILING — gated on Build C, NOT built) — free tiles aren't production-contracted.**
  OSM's public tile server and Esri's public World Imagery are fine at low volume but carry ToS /
  reliability risk at scale. A contracted provider (Mapbox / MapTiler / Esri paid) is deferred until
  **Build C map-load analytics** can size the plan. Swap seam = `ensureGL` / `HS.buildGL` (one place).
  **Guardrail shipped now (required companion to #2):** repeated tile/source errors (429 rate-limit,
  tile host failure) or a stalled load (9s) **degrade gracefully to the impact diagram + a toast**,
  so a traffic spike degrades to a usable state instead of a broken map.
- **#5 (DECIDED + BUILT) — no "Your home" pin until the resident sets an address.** Only a real
  signed-in resident home (in this ZIP, not the Del Valle sample) is pinned. For everyone else the
  centroid **only centers/zooms the viewport** — nothing is pinned — and a "Set your area to map your
  home & get alerts" nudge shows, doubling as a follow/signup prompt (opens the set-area flow).
  Matches the development tracker's "no home pin until the resident searches"; upholds the never-faked
  rule (a centroid stand-in labeled "Your home" would show a fake location as real).

## Signup wiring restored + strict opt-in consent (2026-07-16, founder-approved)
The /app promotion severed the resident signup path: nothing called `signup_complete`
(the sole writer of users + user_subscriptions), the shell saved only `topic_prefs`
(which digest.py does not read), so new signups never created a deliverable subscriber
(users_total frozen at 2; notify-signup never fired). Restored in `shell.js::persistSignup()`:
the topics-modal Save calls the live RPC with the complete deliverable set — labels from
the LIVE community chain (word-for-word rule; never the seed), anchored at the chain ROOT,
fail-loud (an RPC error shows in the modal; "Alerts saved" only after the write confirms).
- **Consent: STRICT OPT-IN — every alert topic starts UNCHECKED for a new user (founder
  decision, for the record: pre-ticked ≠ valid consent under GDPR/CAN-SPAM; this is the one
  surface with real legal exposure, and "converts better" loses to "honest by default").**
  Consent version '2026-07-16'; the RPC derives marketing_consent from subscriptions
  actually saved, with timestamp + shown copy. The share-consent checkbox stays default-
  unchecked (unchanged).
- **data_licensing_agreed never silently downgrades**: the live RPC overwrites it on every
  upsert (the old page's "does not downgrade" comment was wrong vs the live body), so the
  client passes true if ANY stored category consent is true or the box is checked now.
- **`dev` category picks are app-local only** — no delivery pipeline exists for them; they
  are never sent to signup_complete (honest: no implied emails).
- **Referral stamp rides along**: p_referral_source/p_referral_campaign (additive params,
  first-touch preserved server-side via coalesce). Migration of record:
  `docs/referral-attribution-migration.sql` (now carries the FULL signup_complete
  definition — pulled live via pg_get_functiondef, no longer live-only). The client
  retries without referral args on PGRST202 so deploy order doesn't matter.

## 2026-07-16 — Maps backbone: pins are colored by PERMIT STATUS, never "impact" (founder-directed audit fix)

Audit receipts: the stored `impact_score` decoded to a status->constant table
(facility 30 / Approved 55 / Proposed 72 / Operating 45 — counts matched statuses
1:1), the red "High impact" legend tier was unreachable (max 72 < the 75
threshold), the green "Positive" tier required fields that never render, and all
5,030 `app_changes` rows have no coordinates so the "alerts" the header promised
never plotted. Decisions, applied across ALL map surfaces (maps.html +
dashboard.html via the ONE backbone in lib/map.js):

- **Legend = permit status** (Proposed / Approved / Operating-built; unknown =
  neutral "On file" gray — never a guessed severity). `HS.mapStatus` is the one
  color authority; the impact tiers are deleted. `impact_score` is still written
  by the materializer but nothing on the map interprets it as impact.
- **Area-wide notices are LISTED, never plotted** — they have no honest point;
  inventing one would fabricate a location. Own labeled section ("whole area,
  not one address") under the pin list + counted in the chip.
- **The chip never claims distances it doesn't have**: with a real home in the
  ZIP it counts within-radius across ALL mapped records; without one it says
  "N items mapped" (the old chip showed "0 items within X mi" under a full map).
- **Caps are disclosed** ("latest 16 of N shown") and projects order by RECENCY
  (score-ordering re-starved Approved under the cap — the same bug the
  materializer fixed once on its side).
- **Viewport anchors: real home > ZIP centroid > first record — never hardcoded
  coordinates.** `app_community_meta.lat/lng` added (stamped from the engine's
  USPS-pinned centroid; backfilled 5,462/5,462). The Del Valle literal is gone.
- **Dashboard preview obeys the never-faked rule** (home dot only for a real
  home; the old buildGL always fabricated one) and runs the same guarded
  GL -> Leaflet -> schematic chain (`HS.buildLive`), so a WebGL-off browser gets
  a real map and a map failure can no longer kill the page init.
- **Date sanity in the materializer**: an area-notice file_date outside
  [2000-01-01, today+2y] falls back to current_date (the cache carried a 1986
  date); existing out-of-window rows purged. Migration of record:
  `docs/app-maps-backbone-migration.sql` (applied live as
  `app_maps_backbone_centroids_and_date_sanity`; function body pulled verbatim
  via pg_get_functiondef, additive edits only).

## Regulated facilities as first-class entities (2026-07-17)
- **Facilities got the entity → UI pipeline, not a new table.** The spec's original
  `resolved_facilities` idea was dropped after the repo read: `resolved_projects` is the
  dormant Stratos entity, and facilities are ALREADY `app_projects` rows
  (`record_kind='facility'`). The build enriches that row (`registry_id` + `facility_env`
  jsonb, additive) and renders it — no parallel pipeline, no Stratos work.
- **The dossier reuses `development.html?id=` branching on `record_kind`** (founder call):
  one detail surface, one code path; header/labels read "Regulated facility," never
  development — a facility is an existing condition, not activity. A record-kind-neutral
  rename of development.html is flagged as a possible later cleanup (logged, non-blocking).
- **ICIS-NPDES permit status is fetched (engine v21) because it is the honest core:**
  ECHO's compliance fields alone can't say WHY zeros are meaningful. Statuses are verbatim
  ("Admin Continued", live-verified); tracking_on = {Effective, Admin Continued, Expired}.
  **Enforcement zeros render as a positive signal ONLY while tracking is on** — a
  Terminated/Retired/Pending permit shows the tracking-off caveat instead (the DALFEN
  FRS 110071346495 example). Unknown status → explicit "permit status not yet confirmed",
  never a guess; the UI does not block on backfill.
- **Facilities keep the same coverage gating as projects for free** (rows are ZIP-keyed by
  the same materializer from the same coverage-gated engine cache; no parallel gate added).

## Staging _*_zips RLS cleanup (2026-07-17)
- **Dead scratch is DROPPED, not secured** (13 tables): every completed state's
  `_<st>_zips` worklist is recreated verbatim by its committed seed script (which itself
  starts `drop table if exists`), and `_dfw_zips`/`_den_zips`/`_den_res_dbg` were
  comment-only or unreferenced debug scratch. 0 references in pg_proc / pg_views /
  cron.job for all of them — verified before dropping.
- **`_fl_zips` is KEPT — it's an in-flight Florida batch** (441 ZIPs all cached,
  refreshed 2026-07-17 00:05 UTC, live request_id/status worklist columns; a concurrent
  session owns it). Secured instead: RLS on + anon/authenticated grants revoked + an
  explicit service_role policy. Zero impact on the batch (service-role bypasses RLS).
  The owning session drops it at build end.
- **`spatial_ref_sys` stays RLS-off on purpose** (PostGIS system table — founder call);
  it is the ONE remaining `rls_disabled_in_public` advisory line, expected.
- DDL of record: `docs/staging-zips-cleanup.sql` (applied as migration
  `staging_zips_cleanup_rls`).
