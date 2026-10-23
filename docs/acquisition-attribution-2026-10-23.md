# Acquisition attribution — Phase 1 built, Phase 2 proposed (2026-10-23)

Follows the 2026-10-23 Acquisition Dashboard audit. The dashboard (`acquisition.html`) is the existing one; nothing new was created.
SQL of record: `docs/acquisition-attribution.sql`. Proof: `test/acquisition_attribution_pg/e2e.sql` (live schema, always rolled back)
and `test/acquisition-attribution.test.mjs` (browser half).

## Canonical truth path
`browser (lib/data.js HS.attr)` → `record_first_touch()` → `acquisition_touch` (subject `visitor`) → sign-in `claim_first_touch()`
(subject `account`) → `hs_acq_channel_report()` → `acquisition.html` "Channels" card.
Decision owner for "which channel": `public.classify_channel()`. The browser sends only what it saw (utm values, the referring HOST,
the landing PATH); it never classifies (pinned by test).

## What each requirement became
| # | Requirement | Where |
|---|---|---|
| 1 | First-touch visitor attribution, unknown ≠ direct | `HS.attr.capture/send`; `record_first_touch` (first touch wins on the unique key); `classify_channel` |
| 2 | Registrations = distinct authenticated users; digest separate; exclude admin/test | `auth.users` counted via account touches; digest from `public.users` by distinct email; `analytics_exclusion` (user ids only) |
| 3 | Reports = stored snapshots, linked to a user and source | `report_snapshot` rows; user via the brokerage's single active member (`_report_account`); channel from that account's touch |
| 4 | `acquisition_touch` writer | `record_first_touch` (anon, validated) and `claim_first_touch` (signed in); subject types widened to `visitor`, `report` kept for later |
| 5 | Page views, returns, sessions | `page_view` event with `visitor_id` + `visit_session_id` (30 min idle); returns computed at read time |
| 6 | Daily / weekly by channel | `hs_acq_channel_report` → "Channels" card (existing tab) |
| 7 | Pierce ZIP filter | `zip_set` `pierce_wa` = 65 ZIPs computed in the database; county overlap **not evaluated** (no ZCTA–county shares file in the repo) and the card says so |
| 8 | America/Los_Angeles | day/week buckets in LA time; storage stays `timestamptz` UTC; weeks start Monday |
| 9 | Old and new domain | `host` stored per touch/event; the server accepts both; `homesignal.net` rows are never rewritten |
| 10 | Controlled end-to-end proof | `e2e.sql`, see below |

## Channels
`google_organic`, `bing_organic`, `other_search`, `bluesky_pierce_auto` (`bluesky/pierce-zip`), `bluesky_maps_auto` (`bluesky/maps`, what the
generator emits today), `bluesky_engagement` (`bluesky/profile`, `bluesky/engage*`), `bluesky_other_tagged`, `bluesky_untagged`
(bsky.app, no tag), `saleshandy`, `other_referral`, `other_tagged`, `direct`, `unknown`, `not_collected`, `not_attributed`.
- `direct` only for a home-page landing with no referrer and no UTM. A deep landing with no referrer is `unknown`. This is a heuristic.
- `mail.google.com` is a referral, not Google search. Google/Bing organic is read from the referring domain only.
- A browser that already held our storage before this shipped, arriving without a UTM, is `not_collected` (its true first touch is unknown).
- An account is credited to a visit only if the visit came before the account existed; an older account signing in later is `not_collected`.

## Unavailable or gapped (shown, not estimated)
- Visitors, sessions and channel exist only from `tracking_started_at` (the first `page_view` with a visitor id). Earlier `alert_view`
  rows used a permanent per-browser id and are not comparable.
- Registrations, digest rows and reports before this shipped: `not_collected` / `not_attributed`. Nothing was backfilled.
- **Who made a report is not recorded** by `brokerage_report_issue` / `evaluation_report_issue`. A report is credited to a person only when its
  brokerage had exactly one active member at generation time (true of every account today). With several members it is `not_attributed`.
  Recording the creator is a report-system change and was not made.
- A first visit directly to `development-activity-reports.html` is not captured (that page is standalone by design and loads no shared code).
  Point Saleshandy links at `development-activity.html` or the home page.
- Revenue by source: nothing to attribute (billing off; `payment_event` has 2 rows). The dashboard's old "paid" tile still reads the legacy
  `subscriptions` table.
- County overlap for the Pierce ZIP set is not evaluated.

## Isolation decisions
- The report page is **unchanged**. Its isolation tests (no extra RPC, no extra storage) stay as they were. Two structure tests that list the SQL
  files allowed to name the brokerage/evaluation tables gained `docs/acquisition-attribution.sql`, with pins that it is read-only there.
- New tables have RLS on and no grants. The only anon-executable writer is `record_first_touch`.
- Nothing stores an email, an address, a query string, a fragment, or report content. Page paths are stripped of `?` and `#` in the database.
- No third-party analytics were added.

## Production state
Applied 2026-10-23 as three migrations (`acquisition_attribution_phase1_20261023`, `..._classify_maps_auto_20261023`,
`..._derive_reports_at_read_20261023`). Every function body was compared with this repo's file by `md5(prosrc)` (8 of 8 equal).
Retired but still present, inert: `attribute_report()` (all grants revoked) and the empty `report_attribution` table. A `DROP` of either
hung through the MCP connection, so they were neutralised; drop them from the SQL editor when convenient.
Seeded: `zip_set` pierce_wa = 65 ZIPs (equals `data/seo-focus-areas.json`'s expected 65); `analytics_exclusion` = 4 user ids
(1 dashboard admin, 3 known test signups). No existing row was changed or deleted.

## Phase 2 — marketing campaign tags (proposals; nothing changed in the automations)
1. **Pierce automated Bluesky posts.** The generator (homesignal-ingest `bluesky/lib/maps-draft-contract.mjs`) emits `utm_campaign=maps`, pinned
   by the database guard `hs_maps_universal_violations`. Without any change, Pierce posts are already isolated: they are `bluesky_maps_auto`
   visits that landed on a Pierce ZIP. Emitting `pierce-zip` needs a generator change, a guard migration (the guard compares the exact string),
   and a recompose of existing drafts. Recommended only if you want the tag itself; the channel is defined and ready.
2. **Bluesky profile and engagement links** (manual): `?utm_source=bluesky&utm_medium=social&utm_campaign=profile` for the profile link;
   `...&utm_campaign=engage-wa&utm_content=<account-or-topic>` for replies to Washington news and government accounts.
3. **Saleshandy:** `?utm_source=saleshandy&utm_medium=email&utm_campaign=<campaign-id>&utm_content=<template-or-step>`, landing on
   `/development-activity.html` or `/`. Email clients often strip referrers, so the UTM is the only reliable signal; first-party landing
   attribution is sufficient and click tracking is not required. Opens without a click are invisible by design.
4. **Google / Bing organic:** nothing to tag. The referring domain is read; a hidden referrer shows as `unknown`, so watch the unknown share.
5. **Test traffic:** use `utm_campaign=audit-test-<n>` (or `utm_content=audit-test-<n>`); the database marks those visits internal.
