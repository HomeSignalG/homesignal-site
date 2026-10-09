# Jody migration — status (the ONE status document)

Updated in the same PR as each step. Do not create a second status file. HomeSignal remains the only active public identity.

| Step | Status | Evidence |
|---|---|---|
| 1 Brand contract | DONE, merged | site #1734 -> `a64df39`; artifact byte-identical (82 files); no push-triggered Pages run |
| 2 Dual-domain compatibility | DONE, deployed | site #1736 -> `11fd3d3`; ingest #653 -> `b074f81`; guard migration applied; see "Step 2 deployment record" |
| 3 Jody staging site | IN PROGRESS (PR open) | brand overlay + tests + manual staging workflow; nothing deployed |
| 4 SEO migration | not started | |
| 5 Zero-cost redirect | not started | |
| 6 Integration + rehearsal | not started | |
| 7 Cutover | needs founder GO LIVE | |
| 8 Email + Bluesky | not started | |
| 9 Search transition + monitoring | not started | |

## Step 2 — what "supported" means, decided from the inventory (2026-10-09)
Supported = the backend accepts the Jody origin where it ENFORCES an origin. Nothing is activated.

| Component | Finding | Decision |
|---|---|---|
| Site edge functions (Development Activity, reports, billing, watch, share) | one allowlist: `_shared/admin-gate.ts` | DONE in this PR: derived from the contract (`scripts/gen-brand-origins.mjs`) |
| Site public-read functions (`get-address-report`, `geocode-address`, ...) | `Access-Control-Allow-Origin: *`, no allowlist | no change needed |
| Outbound email/report links (`BILLING_PAGE`, `SHARE_PAGE`, `INVITE_PAGE`, `WATCH_*`) | emit homesignal.net | unchanged until Step 8 (pinned by test) |
| Shipped runtime (`lib/share-text.js` host check, `gen_zip_pages.py`/`page_semantics.py` `BASE`, `indexnow.py` `HOST`) | single-origin, change public bytes | Steps 3-4 (build-time brand); changing them now would alter the live artifact |
| Ingest edge functions (`submit-public-form`, `social-approve`, `fetch-youtube-transcript`) | origin allowlists | DONE: ingest #653, deployed 2026-10-09 |
| Ingest DB Map 1 destination guard | pins `https://homesignal.net/homesignalmap.html?zip=` | DONE: migration applied 2026-10-09 |
| Bluesky URL generation (`generate-maps.mjs`, `generate.mjs`) | emits homesignal.net | Step 8, after the DB guard accepts both |

Deploy note: edge functions deploy only by manual dispatch of `deploy-edge-functions.yml`; merging does not deploy them.

## Step 2 deployment record (2026-10-09)

- **DB guard**: `public.hs_maps_universal_violations` body md5 `0d73e1b8...` -> `eb97581d5f8c49db49942b2b83c9c188` (applied through the drift-guarded migration; volatility stable, not security definer, unchanged). Checked live on a real MAPS row: homesignal.net accepted, jodytracks.com accepted, `jodytracks.com.evil.io`, another path and `http://` each refused; all 98 stored MAPS rows still 0 violations. Rollback body: ingest `tests/dual_origin_guard_pg/live_body_0d73e1b8.txt`.
- **Edge functions redeployed** (only ones whose last deploy was after every other pending change, so the deploy shipped this change alone): `development-activity-trial` v14, `manage-billing` v10, `view-shared-report` v10 (site); `fetch-youtube-transcript` v12, `social-approve` v12, `submit-public-form` v20 (ingest). Deployed source read back with the three-origin list.
- **Deliberately NOT redeployed**: `follow-development-report`, `manage-property-watch`, `manage-shared-report`, `run-property-watch`, `get-development-activity-report` have other merged-but-undeployed changes (#1640, #1703, #1704, #1706, #1717); deploying them now would ship those unreviewed for release. They pick up the Jody origin on their next normal deploy. No browser on jodytracks.com exists until Step 3, so nothing is blocked.
- Not verifiable from the build sandbox: live CORS preflights (the agent proxy has no egress to Supabase; probes returned 403 for every origin including the control, so they are not evidence). Verification was by deployed-source read-back.

## Step 3 - Jody staging build (2026-10-09)

**How:** one rewrite step over the artifact `stage_site.py` already produces - `scripts/brand_stage.py`, driven by the brand contract. The source tree and the live `pages.yml` are untouched (pinned: the live deploy does not call it). `--identity homesignal` is a verified no-op (byte-identical).

**What it rewrites for Jody:** public origin (canonicals, og, sitemaps, JSON-LD), shipped host allowlists, the display name (including the two-tone `Home<span>Signal</span>` wordmark -> `Jo<span>dy</span>`), the tagline "Know what's coming." (home title, og/twitter title, footer).

**What it deliberately keeps:** file paths (identical-path migration, Step 4); `@homesignal.net` mailboxes (no Jody mailbox until Step 6); `did:web:homesignal.net`; the Supabase project; repo/CSS/storage identifiers. Share/invite link validators accept BOTH origins, because the server still emits homesignal.net links until Step 8.

**Staging safety (`--staging`):** every page noindex, `robots.txt` = Disallow all, no sitemaps, no `CNAME`, no IndexNow key, and the old domain's Google verification file is dropped. Built by `.github/workflows/jody-staging.yml` (manual, uploads an artifact, deploys nothing).

**Proof:** `test/brand-stage.test.mjs` (38 checks incl. negative controls: an unclassified `HomeSignalFoo` fails, a tree with nothing to rewrite fails; 6 mutations killed) and `test/jody-staging.browser.test.mjs` (Chromium: Jody title/canonical/noindex, no visible "HomeSignal", footer tagline, no added page error versus the unrewritten tree).

**A defect the proof caught:** the first noindex injection matched `<header` as if it were `<head`, writing a meta tag into the shared header. Fixed and pinned (2e1).

**Not done / by design:** no legal entity is named anywhere (none invented); footer legal text is as before. Visual design review of the Jody wordmark/logo mark is a founder item (the SVG mark is unchanged). Full per-ZIP document generation is exercised in the Step 4 parity run, not here.
