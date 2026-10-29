# Universal project pages: P0 read-only audit (Stratos first)

**Date:** 2026-10-29. **Scope:** P0 of `JODY Universal Project Pages — Updated Implementation Plan (2026-10-29)`.
**What was done:** read-only. Production was queried with `SELECT` only, inside `begin read only … rollback`.
Both repos were read at `origin/main` (site `243491a`, ingest `6290969`). Nothing was written, migrated,
deployed, dispatched or merged.

**What was not done:**
- No live screenshots. The sandbox cannot reach `jodytracks.com` (proxy answers 403 to CONNECT). Every
  statement below about what a visitor sees comes from code plus the data the page reads. It is marked
  **NOT VERIFIED LIVE**, as the plan requires (§3A.7, test 61).
- No Search Console data. None is reachable from here. Google indexing, rankings and SERPs are **not verified**.

---

## 1. Headline findings

1. **Stratos is not one record anywhere. It is four unconnected records, and none of them is a project page.**

   | Record | Where | State |
   |---|---|---|
   | Land assembly `stratos-box-elder` | `resolved_projects` + 83 parcels | anon-readable; drawn on Map 1 for ZIP 84336/84307 |
   | Data-centre entity `fe2068de-…` | `dc_canonical_entity` (Compute Atlas `stratos-box-elder-ut`) | `CONFIRMED_DC`, `GEOGRAPHY_UNRESOLVED` (publisher point 41.5, −113.5, one decimal, "approximate for western Box Elder County") → **on no Map 1 page** |
   | Water filing a55167 | `water_rights_filings` (2 points of diversion) | shown on the 84336 ZIP page's water-rights section |
   | Status/evidence store | `resolved_project_status` (25 Stratos rows) | **not anon-readable; last written 2026-07-06; no writer in either repo** |

   - There is **no `app_projects` row** for Stratos in 84336/84307. Those ZIPs carry 26 rows: 18 EPA
     facilities and 8 UDOT segments. So there is **no `/project/…` page for Stratos** and no Development
     Activity entry.
   - Nothing links the four records together.

2. **a55167 is spatially and by name tied to the Stratos land, but not by any official project document in the DB.**
   - Both diversion points fall **inside** Stratos-assembly parcels owned by BAR H RANCH INC:
     06-006-0041 and 06-006-0030, both `in_anchor`, ZIP 84336.
   - The applicant string "BAR H RANCH INC." equals that parcel owner.
   - That is **(b) supported inference** under §5A.4, not (a) an official direct relationship. The direct
     bridge exists in the ingest video source pack (`video/projects/stratos-water-change-hansel-valley`):
     the Oct 15 change application names O'Leary Digital Utah DC Sub I, LLC as buyer under contract. But
     it lives in a file, not in a reviewed association record.

3. **The plan's description of a55167 needs a correction before any copy is written.**
   - The DB row (`ut_dwr_pending`) says `filing_type = "Application To Appropriate"`, status `Unapproved`,
     and labels 2026-10-15 a **priority date**.
   - The primary-document source pack says it is a **change application** on right 13-2 (point of
     diversion, place of use, nature of use; up to 1,712 acre-feet).
   - These disagree. The dossier must quote the agency's own form title, and the DB label must be
     checked against DWRi before either is shown as the filing type.
   - The stored `record_url` is a search URL (`/search/?q=a55167`), not a per-filing page.

4. **The old Stratos status store would mislead if surfaced as is.**
   - `resolved_project_status` holds 22 water-rights rows linked to Stratos by "diversion point inside a
     project parcel".
   - **8 of them belong to unrelated owners**: BLM, Tesoro, Total Corrosion Solutions, a family trust,
     two named individuals. All are rated `probable`.
   - **14 are the ranch's historic rights**, back to 1904. They are rated `verified` because the OWNER
     matched — not because they concern Stratos.
   - Showing these as "Stratos water rights" is exactly the proximity-as-relationship error §5A.4 forbids.
   - It also names private individuals. It is safe today only because anon cannot read it.

5. **Map 1 has two live Stratos-specific defects (existing code, not this plan's work).**
   - `homesignalmap.html:5222` hard-codes the card title "Stratos data center project — land assembly".
     `v_resolved_project_zip` also returns **ZIP 84005 (Eagle Mountain)**, so Eagle Mountain's Map 1 page
     titles its land card "Stratos data center project". *(From code + data; NOT VERIFIED LIVE.)*
   - The card's four "Government status" tracks read `resolved_projects.mida_county / deq_air_permit /
     water_rights / legal_referendum`. All four are NULL, so they show "unresolved".
   - Meanwhile `resolved_project_status` holds a **verified** MIDA development-agreement action
     (PMN notice 1075195, 2026-04-24) and a verified referendum denial (2026-05-28).
   - So the card tells a resident MIDA approval is "unresolved" while the evidence of approval sits in a
     table the page cannot read.

6. **Development Type tagging is complete, as the founder said.** P0 evidence, run 2026-10-29 on `main`:
   - `test/project-type-authority.test.mjs` ALL PASS
   - `test/community-dev-type-badge.test.mjs` ALL PASS
   - `test/maps-canonical-type.test.mjs` all checks passed

   Nothing in this audit proposes touching `lib/project-type.js`.

7. **Follow is not ready for a durable project identity.**
   - Project follows store `app_projects.id`. Production: **5 project follows, 3 of which no longer
     resolve.**
   - The write path is optimistic and silent. `HS.toggleFollow` flips the label before the write, does not
     await `persistFollow`, and `persistFollow` never reads `res.error` (`shell.js:2635-2650, 2721-2727`).
   - Test 8 of the plan ("DB failure causes a visible error, not a false Following") **fails today**.
   - A Follow does not enable email. That half of the contract already holds.

8. **Published media exists and can be matched by ID, but nothing public can read it yet.**
   - YouTube: `q-phnTGrMRQ` "Kevin O'Leary's Stratos Data Center: What Utah's Water Filing Reveals".
     `match_state=matched` to slug `stratos-water-change-hansel-valley`, `privacy_status=public`,
     `public_verified_at` 2026-10-28 22:26Z.
   - Bluesky via the queue: final job `cancelled`, short2 `scheduled`, short1 rejected in review.
     **0 published.**
   - Bluesky posted by hand: 4 `direct` posts about Stratos in `bsky_post_metrics`, with their at:// URIs.
     They have **no project association**; they are matched only by text.
   - Every one of these tables is anon-revoked. A dossier needs a sanitized public projection; see §5.

9. **The SEO/static machinery can carry dossiers without a new generator.** Last `pages` run on main
   (`40933954520`, 2026-10-29 18:49Z):
   - 12,742 ZIP documents and 12,742 `/map/` documents
   - 21,326 `/project/` pages (147.4 MB; 1,016 no longer tracked)
   - 6,255 project lists and 411 city pages
   - generation 122.8 s; build job ~6 min; whole run ~10 min
   - 47,225 pages in the page-state fingerprint; this run's semantic delta was **7 URLs**

   The plumbing exists (fingerprint, lastmod, IndexNow, index-all audit). What is missing is a data source
   that names a real-world project.

---

## 2. Inventory: deployed vs repo-only vs proposed vs missing

Deployed = the object exists in production (checked in `pg_class`) or the route is built on `main`.

| Asset | Status | Evidence | Reuse? |
|---|---|---|---|
| `lib/project-type.js` Type + lifecycle | **Deployed, COMPLETE** | 3 test files pass | Render only. Do not touch. |
| `/project/<registry_id>/<case>-<h8>/` | **Deployed**, 21,326 pages | `gen_zip_pages.py:460-594, 1282-1393`; key `source_key\|source_seq` | Keep as **source-record** pages. Not a project dossier. |
| `/community/<zip>/projects/` | Deployed, 6,255 | `render_project_list` :1426 | Yes, as a link source |
| `/map/<zip>/` | Deployed, 12,742 | `MapTemplate` :1963; **no links to `/project/`** | Add a link when a dossier exists |
| `development.html?id=` | Deployed, noindex | Keys on `app_projects.id` (unstable, per `docs/project-identity-audit-2026-09-28.md:13`) | Not a dossier base |
| `resolved_projects` / `resolved_project_parcels` | Deployed, 2 projects / 93 parcels, **anon-readable** | Written by ingest `populate_resolved_project.py` (dispatch-only) | Yes, for land |
| `resolved_project_status` | Deployed, 37 rows, **anon-revoked, no writer, frozen 2026-07-06** | — | Only rows re-reviewed one by one; see finding 4 |
| `dc_*` canonical DC identity | Deployed (`dc_canonical_entity` ~8k) | Stratos = `fe2068de…`, GEOGRAPHY_UNRESOLVED | Yes, as the DC **facility** grain; it is not a project registry (`docs/dc-step3a-canonical-identity.sql:40-44`) |
| `dev_change_project` / `dev_change_event` / `_reportable` | Deployed (~1.06M / ~0.94M), anon-revoked | — | Only for `app_projects`-backed records; **holds nothing for Stratos** |
| `water_rights_filings` + observations | Deployed, ~11k; reader `water_rights_for_zip` | a55167 present, 2 points, first seen 2026-10-28 | Yes. Absence from the pending layer ≠ a decision (§5A.2). |
| `app_follows` | Deployed, 30 rows (22 community, 5 project, 2 property, 1 `change`) | RLS self-only | Needs a new target key + a migration |
| `youtube_video_reviews` | Deployed | Header says applied 2026-10-23 | Admin-only today |
| `youtube_channel_videos` | **Deployed** (20 rows), though `docs/youtube-channel-sync.sql:1` says "PARKED, NOT APPLIED" | `pg_class` | The header is stale; the table is live |
| `video_bluesky_jobs` | **Deployed** (8 jobs), though `docs/video-bluesky-queue.sql:2` says "PARKED" | `pg_class` | Same: header stale |
| `bsky_post_metrics` (`kind='direct'`) | Deployed | 4 Stratos direct posts | Only through a reviewed association |
| `social_posts` (MAPS) | Deployed, owner-only RLS | 1 row near Stratos (84307, `skipped`) | No public read |
| Evidence graph (`entity`, `claim`, `relation`, `source_record`) | **Missing**: no such tables | `docs/multi-source-evidence-architecture.md:3` "PROPOSAL … nothing implemented" | Do not build it for this pilot (§5B) |
| Impact Stories Stratos pack | Repo only (ingest `impact/sources/stratos-data-center-water-box-elder`) | News-only, 7 sources; the application itself is `not_examined` | Not evidence for the dossier |
| Video Stratos pack | Repo only (ingest `video/projects/stratos-water-change-hansel-valley`) | Primary DWRi records: change details, the Oct 15 application, the 13-2 listing; 31 PDFs | **Best primary source for the a55167 bridge** |

---

## 3. Stratos source-bridge matrix

| Claim the dossier would make | Evidence in production | Grade (§5A.4) | Gap |
|---|---|---|---|
| 83-parcel land assembly; owners Bar H Ranch Inc, Bar H Land LLC, Murray Hollow LC, Bull Pass Ranch LLC | `resolved_project_parcels` with county source URL and eRecord link for each | (a) official, parcel grain | Assembly ≠ footprint. Label it "associated land". |
| Hansel Valley Lodge LLC owns one parcel | In the roster but **excluded** (1 acre, `in_anchor=false`, "likely name coincidence") | — | Never list it as a party |
| 26 of 83 parcels are in ZIP 84336 only "by adjacency" | `zip_basis='adjacency-ZCTA-gap'` | Method disclosed | Say so on the map legend |
| MIDA adopted the Stratos Project Area / development agreement | `resolved_project_status` approval row, PMN 1075195, 53 matched APNs | (a) official, but stored at meeting grain | Not public-readable; frozen since 2026-07-06 |
| County referendum ruled non-referable (2026-05-28) | `resolved_project_status` legal row, county URL | (a) | Same |
| Lawsuit filed (3rd District) | Same table, plaintiff's site + news, **no docket** | (c) reporting | Show only as reported |
| a55167 by Bar H Ranch Inc on Stratos land | `water_rights_filings` + point-in-parcel | (b) inference | Needs a reviewed edge citing the application's own text (buyer under contract) |
| a55167 is a change application, 1,712 af | Ingest video pack, primary PDF | (a) in a file, not in the DB | Reconcile with the DB's "Application To Appropriate" |
| Developer / sponsor (O'Leary Digital) | Compute Atlas "operator" field + application text | (a) via the application; (c) via Atlas | Not in any reviewed association |
| Engineering consultant (Gensler as designer; hydrology authors) | Atlas notes; news | (c) | Unresolved |
| DEQ air permit | none | — | `deq_air_permit` NULL; say "not found in tracked sources" |
| Facility location | DC entity is GEOGRAPHY_UNRESOLVED | — | Use the parcel assembly, never the Atlas point |
| News coverage (~120 rows, category "Stratos data center project") | `alerts`, 3 county notices + news | (c) | Third-party reporting, not timeline events |

---

## 4. Proposed identity ADR (recommendation only; founder decides)

**Decision needed:** what owns "this is one real-world development" across sources?

| Option | What it is | For | Against |
|---|---|---|---|
| A. Reuse `resolved_projects.project_key` as the dossier key | Existing; 2 rows; land-anchored; anon-readable | No new table. Stratos and Eagle Mountain already exist. | Hand-curated slugs. Its sibling status table is frozen. `dc_step3a` already rejected it as the national DC identity. |
| B. Use `dc_canonical_entity_id` | Existing resolver | Durable, audited | Facility grain, DC only. A non-DC project (stage C) cannot use it. |
| C. New minimal `development_project` + `development_project_link` | One ID table + one edge table holding direction, role, evidence grade, source URL, review state, valid-from/to, revocation | Fits §5A.1/§5B.3 exactly; works for any Type; links source records (`source_key\|source_seq`), parcels, the DC entity, filings and media without merging them | Two new tables; needs a reviewer workflow |
| D. Full evidence graph (`docs/multi-source-evidence-architecture.md`) | Claim-as-row national graph | Most expressive | Explicitly out of scope for the pilot (§5B "do not build a national entity platform") |

**Recommendation: C, scoped to reviewed links only.** Seed `development_project.key` from the existing
`resolved_projects.project_key` (`stratos-box-elder`), so A's rows become the first entries. Do not
auto-create a project from any source row: a project exists only when a reviewer creates it. Every edge
carries one of the five §5A.4 grades. Only grade (a) edges, and (b) edges that state their evidence, render
publicly.

`resolved_project_status` rows enter only as individually reviewed edges. The 8 non-owner-match water
rows are **not** carried over.

**URL coexistence:** the dossier gets its own namespace (proposal: `/development/<state>/<slug>/`).
`/project/…` stays a source-record route, unchanged and indexable. The dossier links to its source records
and the source records link back. Nothing redirects. Stratos has no `/project/` page today, so there is no
collision for the pilot.

**Follow:** add `target_type='development'` keyed on the new project ID. Leave the 5 legacy `project`
follows in place. Publish a read-only mapping report (3 orphans today) before any migration.

---

## 5. Public-read and privacy check

- Anon can read: `app_projects`, `resolved_projects`, `resolved_project_parcels` (parcel owners are LLCs
  only).
- Anon cannot read: `app_follows`, `resolved_project_status`, `dc_*`, `water_rights_*` (the page reads them
  through `water_rights_for_zip`), and every media table.
- A dossier therefore needs **one sanitized, allow-listed projection**, used only at build time, that emits:
  - reviewed edges only;
  - media rows with `privacy_status=public AND public_verified_at IS NOT NULL` (YouTube) or
    `status='published' AND bsky_uri IS NOT NULL` (Bluesky queue);
  - direct Bluesky posts only through a reviewed association.
- Applicant names go through `water_rights_display_applicant` (it returns "BAR H RANCH INC." unchanged for
  a corporation). `resolved_project_status` must never be exposed raw: it names individuals.
- Build-time generation reads with the service key in `pages.yml`, as the Rule D plane does today. Visitors
  never query these tables.

---

## 6. Baseline numbers (all measured 2026-10-29 unless noted)

- ZIP pages 12,742 (registry 12,744; 2 unverified with no page); `/map/` 12,742; `/project/` 21,326;
  project lists 6,255; city 411; guides 4.
- Build: generation 122.8 s; build job 18:49:27–18:55:16Z; deploy 8 s; IndexNow 41 s.
  Artifact 96.5 MB served, 767 MB `_site`.
- Semantic delta per run: 7 URLs (run 40933954520). A Stratos dossier adds 1 page plus changed links on
  ≤3 pages (84336, 84307, `/map/84336/`). The expected fan-out is single digits.
- Production rows (estimates from `pg_class.reltuples`): `app_projects` 3.12M, `dev_change_project` 1.06M,
  `dev_change_event` 0.94M, `water_rights_filings` 11k, `dc_source_observation` 108k.
- Not measured: Core Web Vitals, Search Console, Supabase CPU/IO cost, p95 page latency. None is reachable
  from here. Static pages have no per-view SQL, so build-time SQL is the cost that matters.

---

## 7. Gaps against the plan's tests (now)

| Test | Today |
|---|---|
| 1, 21–23, 26 (one canonical Stratos URL, crawlable facts) | **Fail**: no page exists |
| 3, 31, 79 (a55167 only with a source-backed relation) | Partly met: the ZIP page shows the filing with no project claim. A bridge does not exist yet. |
| 8, 52, 68 (Follow errors visible) | **Fail**: silent optimistic write |
| 9, 41 (legacy follows) | 3 of 5 orphaned; no report yet |
| 10–14 (media visibility) | Data supports it; no public reader |
| 18 (seven Types unchanged) | **Pass** (tests run) |
| 24, 25, 37 (fingerprint, index-all, fan-out) | **Pass** on current routes |
| 35 (pending removal ≠ decision) | Holds: `removed_from_source_at` is only a timestamp |
| 50, 64 (assembly vs footprint legend) | Partial: the Map 1 card says "land assembly" and discloses adjacency per parcel |
| 61 (screenshots) | **Not verified**: no egress |

Also: the water-rights section is client-rendered (`lib/community-page.js:335`, `lib/water-rights.js`), so
a55167 is **not in the crawlable HTML** of `/community/84336/`. The Map 1 land card is also client-only.

---

## 8. Smallest safe next steps (each needs separate approval)

1. **Fix the two Map 1 defects** in finding 5. This is independent of dossiers and small:
   - take the card title from data (the project's own name), not a literal;
   - read government status from the same reviewed source the dossier will use, or hide the tracks until
     that source exists, instead of showing "unresolved" over a recorded approval.
2. **Make Follow honest** (`shell.js`):
   - await the write, check `res.error`, and roll back the label with a visible message;
   - no schema change.
3. **Mark the stale "PARKED" headers** in `docs/youtube-channel-sync.sql` and `docs/video-bluesky-queue.sql`
   as applied (docs only).
4. **After founder approval of the ADR:** P1 non-production prototype of the Stratos dossier from a frozen,
   provenance-labelled fixture built from §3, plus one non-DC example.
5. **Only then:** P2 tables (`development_project`, `development_project_link`) behind a build-time
   projection; the dossier route in `gen_zip_pages.py`; links from `/map/`, the community pages and the
   project lists.

## 9. Questions for the founder

1. Approve option C (minimal project + reviewed-link tables, seeded from `resolved_projects`), or prefer A?
2. Dossier URL namespace: `/development/<state>/<slug>/`, or another?
3. Who may approve a project↔organization or project↔filing link (only you, or a named reviewer)?
4. Should the frozen `resolved_project_status` evidence be re-reviewed row by row into the new link table,
   or left as history?
5. May the Map 1 fixes in §8.1 go ahead now, as a separate small change?
