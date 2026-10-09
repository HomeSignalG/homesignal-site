# Jody migration — status (the ONE status document)

Updated in the same PR as each step. Do not create a second status file. HomeSignal remains the only active public identity.

| Step | Status | Evidence |
|---|---|---|
| 1 Brand contract | DONE, merged | site #1734 -> `a64df39`; artifact byte-identical (82 files); no push-triggered Pages run |
| 2 Dual-domain compatibility | IN PROGRESS | see below |
| 3 Jody staging site | not started | |
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
| Ingest edge functions (`submit-public-form`, `social-approve`, `fetch-youtube-transcript`) | origin allowlists | next PR (ingest) |
| Ingest DB Map 1 destination guard | pins `https://homesignal.net/homesignalmap.html?zip=` | next PR (ingest migration, both origins) |
| Bluesky URL generation (`generate-maps.mjs`, `generate.mjs`) | emits homesignal.net | Step 8, after the DB guard accepts both |

Deploy note: edge functions deploy only by manual dispatch of `deploy-edge-functions.yml`; merging does not deploy them.
