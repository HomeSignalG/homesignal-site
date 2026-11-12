# Universal Project Pages — P0 read-only audit (Stratos first)

**Date:** 2026-10-29 · **Scope:** P0 only, per the 2026-10-29 implementation plan (§6 P0, §10).
**What was done:** read both repos at current `main` (site `3e1c6c6`, ingest `83b9a08`), ran SELECT-only
queries against production, ran the protected classifier tests, read the newest `pages` build log.
**What was not done:** no schema change, no write, no deploy, no workflow dispatch, no change to any
publishing queue, follow, URL or SEO output. Nothing here is approved architecture; §6 is a proposal.

Every production number below is from a query run on 2026-10-29 unless marked otherwise.

---

## 1. Summary

1. **The settled Type/lifecycle authority is intact.** `test/project-type-authority`,
   `community-dev-type-badge`, `maps-canonical-type`, `water-rights-section` and `index-all-audit`
   all pass. Mark it COMPLETE and keep it out of the ADR.
2. **Stratos has no source-record page, and the current page producer cannot make one.**
   `/project/<registry_id>/<case>-<h8>/` pages are keyed on an `app_projects` `source_key|source_seq`.
   Stratos has **0** `app_projects` rows in 84336, 84307, 84313 or 84302. A national name search for
   "stratos" returns a Burlington VT siding permit ("Stratos Siding Repair for Window leaks") —
   proof that name matching cannot be the bridge.
3. **The only deployed whole-project object is `resolved_projects`** (2 rows:
   `stratos-box-elder`, `eagle-mountain`). It is hand-keyed, public-read, and already carries the
   Stratos land assembly. No `entity` / `claim` tables exist; `docs/multi-source-evidence-architecture.md`
   is a proposal ("nothing implemented").
4. **Stratos is held under four unconnected keys:** `resolved_projects.project_key = stratos-box-elder`,
   DC entity `fe2068de-…`, video slug `stratos-water-change-hansel-valley`, Impact slug
   `stratos-data-center-water-box-elder`. Nothing joins them.
5. **Two resident-facing contradictions exist today** (§3.1): the Map 1 Stratos panel says
   "No verified public record yet" for MIDA approval and the referendum while a verified record of
   each sits in a table the page cannot read; and it says water rights are unresolved while the 84336
   ZIP page lists application a55167.
6. **Follow is unreliable now:** 3 of 5 saved projects (and 1 of 1 saved change) no longer resolve,
   and the write path never checks the database answer.

---

## 2. Inventory — deployed / repo-only / proposed / missing

| Asset | State (measured) | Reuse verdict |
|---|---|---|
| `lib/project-type.js` (Type + 4-key lifecycle) | Deployed; 5 test files green | **Reuse unchanged** |
| `resolved_projects` | Deployed, 2 rows, RLS on, anon SELECT | Candidate pilot owner (§6, option A) |
| `resolved_project_parcels` | Deployed, 93 rows (83 Stratos), geometry on all, anon SELECT | Reuse for Map & Land |
| `resolved_project_parcel_reconciliation` | Deployed, 128 rows, anon SELECT | Audit before showing |
| `resolved_project_status` | Deployed, 37 rows (25 Stratos), **no anon access**, **no writer in either repo**, last written 2026-07-06 | Reuse the 3 approval/legal rows only after review; see §3.3 |
| `v_resolved_project_zip`, `v_resolved_project_parcels` | Deployed, public views | Reuse |
| `homesignalmap.html` `loadDevTracker`/`renderAnchor` | Deployed; title hard-coded "Stratos data center project — land assembly" (`:5128`) | Reuse visuals; remove hard-coding later |
| `water_rights_filings` + observations + `water_rights_for_zip` | Deployed; a55167 present (2 points) | Reuse as a source record; no project link exists |
| `dc_canonical_entity` / `dc_entity_geography` | Deployed; Stratos = `fe2068de-…`, CONFIRMED_DC, SITE, 1 source, geography UNRESOLVED | Attach as facility; do not make it the project owner |
| `app_projects` / `/project/…` pages / `development-seo-projects.json` | Deployed; source-record grain | Preserve as is; not usable for Stratos |
| `dev_change_project` / `dev_change_event(_reportable)` | Deployed (1.06M / 939k rows) | Reuse only for app_projects-backed projects; N/A to Stratos |
| `alerts` with category "Stratos data center project" | Deployed; 120 rows (117 news, 3 government notices), 1 community, 2026-06-02 → 2026-10-29 | Reuse as an existing, feed-level association (news ≠ official record) |
| `youtube_channel_videos` | Deployed, 20 rows (doc header says PARKED — stale) | Reuse through a new sanitized reader |
| `youtube_video_reviews`, `video_bluesky_jobs`, `bsky_post_metrics` | Deployed; admin-only | Reuse through a new sanitized reader |
| `app_follows` | Deployed, 30 rows, owner-only RLS | Needs repair before any migration |
| `company_*`, `project_facility_refs`, `gov_actions` | Deployed, no DDL in either repo; `gov_actions` 0 rows | Do not build on until DDL is recovered |
| `entity`, `claim`, `entity_identifier` | **Missing** (proposal only) | Do not create a national platform for the pilot |
| Any public reader of JODY media | **Missing** | New, small, read-only (P4) |
| Any whole-project route | **Missing** | New namespace needed (§5) |

Stale statements found (to correct in a later docs change, not here):
`scripts/page_semantics.py:65` and the identity-audit addendum still say `/community/<zip>/projects/`
is noindex (index-all made it `index, follow`); `docs/youtube-channel-sync.sql` and
`docs/video-bluesky-queue.sql` still say PARKED although both are live.

---

## 3. Stratos — what production actually holds

### 3.1 Current user-facing state
- **Live screenshots: NOT VERIFIED.** The sandbox cannot reach jodytracks.com (proxy refused). The
  newest committed render (`verify/dev-tracker-84336.png`, assertions dated 2026-07-06, local server)
  shows the anchor panel with all four status tracks reading "No verified public record yet —
  unresolved". `verify-dev-tracker.yml` can re-capture on a runner; it commits a screenshot back to
  the branch, so it was not dispatched in this read-only pass.
- The panel reads `resolved_projects.mida_county / deq_air_permit / water_rights / legal_referendum`,
  which are **all null**. The verified records live in `resolved_project_status`, which the page
  does not read and anon cannot read:
  - MIDA development agreement approved/executed, **verified**, 2026-04-24 (PMN notice 1075195, 53 APNs matched in the document)
  - Referendum denied (County Attorney decision), **verified**, 2026-05-28 (boxeldercountyut.gov/666)
  - Lawsuit filed, 3rd District, **probable** (no docket), 2026-06-03 (plaintiff's site)
- Map 1 data-centre layer: **0** pins on 84336 and 84307 (and 84313). Correct by the fail-closed rule:
  Compute Atlas places Stratos at the rounded point 41.5, −113.5 and itself calls it "approximate
  for western Box Elder County". That point is roughly 70–100 km west of the Bar H parcels
  (about −112.66). So the DC entity and the land assembly describe one project from places far apart.
- MAPS posts for these ZIPs: one, `nodc:84307`, skipped.

### 3.2 Land assembly (`stratos-box-elder`, id `b3389164-…`)
83 parcels, 35,626 acres, all with geometry. ZIP 84336: 78 anchor + 1 non-anchor; ZIP 84307: 4
anchor (flagged off-target). Owners of record: BAR H RANCH INC 61 · BULL PASS RANCH LLC 8 ·
MURRAY HOLLOW LC 8 · BAR H LAND LLC 5 · HANSEL VALLEY LODGE LLC 1. "Wonder Valley" stays
unconfirmed (no parcel). All owners shown are organisations, so no person is exposed.

### 3.3 Water rights — a55167 / 13-2
- Production row: 2 points, applicant "BAR H RANCH INC.", right 13-2, status Unapproved,
  `filing_type` "Application To Appropriate", `filed_on` 2026-10-15 with `date_label` **"Priority date"**,
  first seen 2026-10-28, `record_url` = a **search** URL (`waterrights.utah.gov/search/?q=a55167`).
- **Spatial check (new):** both points fall inside Stratos parcels owned by Bar H Ranch Inc. —
  06-006-0030 (which is in the MIDA Stratos Project Area APN list) and 06-006-0041 (which is not).
- **Bridge status: supported inference, not a documentary link.** Same applicant as the parcel
  owner, and inside the assembly. The ingest video project cites the application PDF
  (`docImport/0689/06893380.pdf`) as saying the water is "for the Wonder Valley - Stratos Project"
  and names a buyer, "O'Leary Digital Utah DC Sub I, LLC". That PDF is the documentary bridge; it
  must be reviewed first-hand before the dossier says "associated with Stratos".
- **Semantics conflict to resolve:** the state layer says "Application To Appropriate"; the video
  project calls it a "Permanent Change Application". The date label is "Priority date", not a filing
  date. The dossier must use the state's own words and label the date exactly.
- `resolved_project_status` also holds **22 water-rights rows dated 1904–2026** (point-of-diversion
  history on the parcels: claims, lapsed, certificated). These are rights on the land, not Stratos
  events. Putting them on a Stratos timeline would be wrong.

### 3.4 Organizations (what is evidenced, and how)
| Organization | Role | Evidence held | Grade (§5A.4) |
|---|---|---|---|
| Bar H Ranch Inc. | Landowner of record (61 parcels); water-rights applicant | County parcel layer; state pending-application layer | (a) official, per role |
| Bar H Land LLC, Bull Pass Ranch LLC, Murray Hollow LC, Hansel Valley Lodge LLC | Landowners of record | County parcel layer | (a) for ownership only |
| MIDA | Approving authority | PMN 1075195, verified | (a) |
| Box Elder County Attorney | Referendum decision | County page, verified | (a) |
| O'Leary Digital | Operator per Compute Atlas | Third-party dataset | (c) |
| O'Leary Digital Utah DC Sub I, LLC | Buyer per application | Ingest video sources (not yet in DB) | (b) until the PDF is reviewed |
| Alliance for a Better Utah | Plaintiff | Plaintiff's own site + news | (c), no docket |
No source shows any of the landowner LLCs as developer. None may be labelled "developer".

### 3.5 JODY coverage
- YouTube main video `q-phnTGrMRQ`: public, verified public 2026-10-28, matched and linked to slug
  `stratos-water-change-hansel-valley`. **But the review row for that slug is `status = 'rejected'`.**
  A page must not show a video whose review says rejected until that is reconciled (founder call).
- Bluesky queue: main post cancelled, Short 2 scheduled, Short 1 has no job. **No Stratos queue post
  has a `bsky_uri`.**
- Bluesky direct posts: 4 Stratos posts on 2026-10-28, found only by their text; `utm_content` null.
  Matching by text is exactly what the plan forbids, so these need a reviewed association.
- No anon reader exists for any media table.

### 3.6 Source documents not yet examined first-hand
The video project marks as not examined: the 325 protest letters, Exhibit A (Loughlin study),
13-2's historical record 1905–2011, any air permit, any MIDA land-use filing. The Impact source pack
uses news only and lists the ~200-page application, the protest docket, the MIDA interlocal and
county resolutions 26-11/26-12 as not fetched. 29 of ~31 downloaded PDFs were not read.

---

## 4. Follow

- `app_follows`: community 22, project 5, property 2, change 1. **3 of 5 project follows and the
  change follow point at `app_projects` ids that no longer exist** (ids are per-ZIP-copy UUIDs that
  churn). My Places shows these as "Followed development" cards with nothing behind them.
- `HS.toggleFollow` (`shell.js:2635`) updates the button and localStorage before writing;
  `persistFollow` (`shell.js:2721`) never reads `res.error`, so a failed write still says
  "✓ Following in My Places".
- Following never sets email consent (correct, keep).
- A Stratos follow has no target at all today: there is no `app_projects` id and `target_type` has
  no value for a `resolved_projects` row.

---

## 5. Architectural conflicts and deployment risks

1. **Route namespace.** `/project/…` belongs to source records and must keep its meaning.
   `/development/<zip>` is already forwarded by `404.html` to the dynamic page, so a dossier at
   `/development/<slug>/` would collide with that convention. Any new namespace must be checked
   against `404.html`, `page_semantics.PATH_RES`, `SITEMAP_FAMILIES`, `robots.txt` and the index-all audit.
2. **Owner of project identity.** DC Step 3A explicitly rejects `resolved_projects` as the DC
   *facility* owner. That does not stop it being the *development project* owner, but the two must
   stay separate objects linked by a reviewed edge.
3. **Timeline truth path.** `dev_change_event_reportable` cannot describe Stratos (no source record).
   `resolved_project_status` mixes three kinds of row (agency action, curated legal, parcel water
   history) under one "track" column, has no writer in the repos, and has not changed since
   2026-07-06 — so it would read as current while being three months stale. A55167 (2026-10-15) is
   absent from it.
4. **Generator reach.** Stratos content is not in the Rule D plane, so the static generator has no
   input for it. A dossier needs a second input object to the same build (not a new generator).
   Build today: ~7 min, 12,742 ZIP documents, 18,997 HTML files, 117.5 MB; one extra page does not
   change that. The Stratos read model is tiny (83 parcels, ~25 status rows, 2 water points,
   ~120 news rows), so performance is not the risk for the pilot; national fan-out is not measured.
5. **Hard-coded Stratos panel.** `renderAnchor`'s title and sub-heading are Stratos-specific, which
   breaks the "no project-specific code" rule the plan sets for stage C.
6. **Media approval conflict** (rejected review vs public linked video) and text-only Bluesky matches.
7. **Live state unverified.** No current screenshot, no Search Console data, project-page count not
   measured this session (last receipt: 14,534, 2026-10-03). These are P0 gaps still open.

---

## 6. Proposed identity ADR (for founder decision — not decided)

| Option | What | For | Against |
|---|---|---|---|
| **A. `resolved_projects` is the project owner** (recommended for the pilot) | Dossier key = `resolved_projects.id` (uuid, stable), `project_key` as the URL slug and alias | Already deployed, public-read, holds the land assembly; no new platform | 2 rows only; needs reviewed edges to filings, facility, media |
| B. New thin `development_project` table | Minted id + aliases | Clean grain | A second project store beside `resolved_projects`; the plan says prove the existing one can't first |
| C. DC entity as owner | `dc_canonical_entity` | Deployed resolver | Facility grain, DC-only, cannot serve the non-DC proof |

Under A, the missing piece is **one reviewed association table** (project → source record / facility /
media / document), with the fields §5A.1 requires (typed direction, role, evidence URL, grade,
reviewer, effective dates, supersession). It needs a founder-approved migration in P2.

---

## 7. Recommended sequence

1. **Founder decisions** (below), then P1 design-only.
2. **P0 close-out, still read-only:** dispatch `verify-dev-tracker.yml` on a scratch branch for
   current 84336/84307 screenshots; read the a55167 application PDF and the MIDA notice first-hand;
   measure project-page count and Search Console status for the Stratos ZIPs.
3. **P1 (no production change):** local prototype of the Stratos dossier using only §3 facts with
   their grades, plus one non-DC example chosen from an `app_projects` record that has several
   filings.
4. **First production slice (after approval), smallest safe fix:** make the existing Map 1 panel stop
   contradicting the records — show the three reviewed approval/legal records with dates and
   sources, and link a55167 as a "water-rights application on these parcels" (not "Stratos's"
   until the PDF is reviewed). Separately, fix `persistFollow` to check the database answer.
5. **P2:** the association table and a sanitized public read model for one project.
6. **P3:** dossier page through `gen_zip_pages.py` + `page_semantics.py` (new family, new namespace).
7. **P4:** media reader limited to rows that are public on YouTube, linked, *and* not rejected in review.
8. **P5–P6** as in the plan, one reversible slice at a time.

## 8. Decisions needed from the founder

1. Accept option A (resolved_projects as the pilot's project owner)?
2. URL namespace for whole-project pages (not `/project/`, not `/development/`).
3. Stratos video: the review says rejected but the video is public and linked — show it or not?
4. Who reviews organization and media associations, and may 4 direct Bluesky posts be linked by review?
5. Orphaned follows (3 project + 1 change): keep as "no longer tracked" cards, or attempt a mapping?
6. Should the 22 parcel water-history rows ever appear on the dossier (recommendation: no, or only under Map & Land as land history)?
