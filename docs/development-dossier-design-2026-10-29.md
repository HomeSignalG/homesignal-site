# Development dossiers: schema, ownership, prototype plan

**Status:** PROPOSAL for review. Nothing here is applied. No migration, deployment or merge is made.
**Follows:** `docs/project-dossier-p0-audit-2026-10-29.md` and the founder decisions of 2026-10-29
(Option C approved in principle; URL `/development/ut/stratos-box-elder/`; one named reviewer to start).
**Measured:** read-only queries and repository reads on 2026-10-29 (site `243491a`, ingest `6290969`).

---

## 1. What changes, in one paragraph

A real-world development gets one stable ID and one page. The page is built from things JODY already
stores:
- source records (permits, SEPA records, filings);
- the data-centre entity;
- the land assembly and its parcels;
- government notices and meetings;
- published JODY media.

The connection between them is new. Each connection is one reviewed row, which records:
- the role ("water-rights change application for this project", "landowner of record");
- the evidence grade and the source;
- who approved it and when.

Nothing is merged, re-classified or copied. Development Type and lifecycle come from
`lib/project-type.js`, run on one source record the reviewer marks as the defining record.

## 2. Two core tables, one role table

```sql
-- PROPOSAL ONLY. Not applied. Proposed file: docs/development-dossier.sql
create table public.development_project (
  project_id      uuid primary key default gen_random_uuid(),
  project_key     text not null unique                      -- 'stratos-box-elder'; immutable
                  check (project_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  state           char(2) not null check (state ~ '^[A-Z]{2}$'),
  display_name    text not null,                             -- reviewer-written
  page_state      text not null default 'draft'
                  check (page_state in ('draft','published','withdrawn')),
  merged_into     uuid references public.development_project(project_id),  -- a merge never deletes
  created_by      uuid not null,
  created_at      timestamptz not null default now()
);
-- URL = /development/<lower(state)>/<project_key>/ ; derived, never stored twice.

create table public.development_project_link (
  link_id         uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.development_project(project_id),
  object_kind     text not null check (object_kind in (
                    'source_record','dc_entity','land_assembly','parcel','water_filing',
                    'government_record','organization','document','youtube_video',
                    'bluesky_post','news_report')),
  object_ref      text not null,          -- the object's own stable key (§4); never a copy of its data
  role            text not null,          -- vocabulary §3; checked against object_kind by trigger
  grade           char(1) not null check (grade in ('a','b','c','d','e')),
                    -- a official direct · b supported inference (evidence stated)
                    -- c third-party reporting · d unresolved candidate · e contradicted/retracted
  evidence_url    text not null check (evidence_url ~ '^https://'),
  evidence_quote  text,                   -- the sentence that states the relationship
  evidence_note   text,                   -- for grade b: why the inference holds
  valid_from      date, valid_to date,    -- when the role held, if the source says
  link_state      text not null check (link_state in
                    ('candidate','approved','rejected','revoked','superseded')),
  supersedes      uuid references public.development_project_link(link_id),
  proposed_by     text not null,          -- 'reviewer:<uid>' or 'automated:<job>'
  decided_by      uuid,                   -- reviewer, for approved/rejected/revoked
  decided_at      timestamptz,
  decision_reason text,                   -- required for rejected/revoked
  names_private_person boolean not null default false,
  created_at      timestamptz not null default now()
);

create table public.development_reviewer (     -- role grants only
  user_id     uuid primary key,
  scopes      text[] not null default '{organization,water_filing,parcel,media,government_record,source_record}',
  granted_by  uuid not null, granted_at timestamptz not null default now(),
  revoked_at  timestamptz
);
```

**Rules enforced in the database, not only in code:**
1. **Rows are append-only.** An approval, rejection, revocation or correction inserts a new row with
   `supersedes` pointing at the row it replaces. Corrections never erase history.
2. **Automated jobs can only propose.** An insert with `proposed_by like 'automated:%'` must have
   `link_state='candidate'`. Only `development_link_decide(link_id, decision, reason)` (security definer)
   can create an `approved` row, and only for a caller listed in `development_reviewer` with the object
   kind in `scopes` and `revoked_at is null`.
3. **Only grades a and b can be approved.** Grade b also requires `evidence_note`. Grades c, d and e can
   be stored but never published as fact. News reports are kept as `news_report` links at grade c and
   shown only as "reported by".
4. **A link that names a private person never reaches the public projection.**
   `names_private_person=true` is excluded in the projection's own `WHERE`.
5. **At most one defining record per project:** a partial unique index on `(project_id)` where
   `role='defining_record' and link_state='approved'` and the row is not superseded. The page's Type and
   lifecycle come from that record through the existing classifier.
6. **The role must fit the object kind.** For example, `landowner_of_record` is allowed only for
   `organization` and `water_change_application` only for `water_filing`. A trigger checks this against
   the table in §3.

**Grants:** `anon` and `authenticated` get nothing on any of the three tables. Reads are by the build only,
through §6.

## 3. Relationship vocabulary (roles)

| object_kind | roles | example |
|---|---|---|
| source_record | `defining_record`, `permit_for`, `environmental_review_for`, `land_use_case_for` | Proctor 4 SEPA 202603632 = defining record |
| dc_entity | `defining_record`, `facility_of` | Stratos DC entity `fe2068de…` |
| land_assembly / parcel | `associated_land` (never "footprint" unless an approved site plan says so) | `stratos-box-elder` assembly |
| water_filing | `water_change_application`, `water_appropriation_application` | `ut_dwr:a55167` |
| government_record | `agenda_item`, `adopted_action`, `legal_decision`, `hearing` | PMN 1075195 agenda items 7–11 |
| organization | `landowner_of_record`, `applicant`, `buyer_under_contract`, `master_developer`, `designer`, `consultant`, `governing_body`, `filing_receiver` | Bar H Ranch, Inc. = water-right owner |
| document | `primary_document` | the a55167 change application PDF |
| youtube_video / bluesky_post | `explains` (editorial; never a government event) | `youtube:q-phnTGrMRQ` |
| news_report | `reported_by` (grade c only) | KSL, SL Tribune |

These roles work the same way for residential, industrial, commercial, civic and infrastructure
projects. None of them names a project Type.

## 4. Stable identifiers (`object_ref`)

| kind | key | why this key | owned by (unchanged) |
|---|---|---|---|
| source_record | `source_key\|source_seq` | survives refreshes; `app_projects.id` does not (audit 2026-09-28) | `app_projects` / ingest |
| dc_entity | `canonical_entity_id` (follow `superseded_by`) | the DC resolver's own ID | `dc_*` |
| land_assembly | `resolved_projects.project_key` | existing | `resolved_projects` |
| parcel | `<state>-<county FIPS>:<APN>` e.g. `UT-49003:06-006-0041` | the county's own number | `resolved_project_parcels` |
| water_filing | `<state>_<agency>:<filing_no>` e.g. `ut_dwr:a55167` | the filing, not a diversion point | `water_rights_filings` |
| government_record | `ut_pmn:1075195#item9`; a county page URL | the publisher's notice id | `meetings` / `alerts` |
| organization | `<state>:<name as filed>` (+ registry number when read) | no company registry exists; never merged by similar names | the link row |
| youtube_video | `youtube:<video_id>` | | `youtube_channel_videos` |
| bluesky_post | `bsky:<at:// uri>` | | `video_bluesky_jobs` / `social_posts` / `bsky_post_metrics` |
| document | `https URL` (+ sha256 when fetched) | | none |

## 5. Ownership and reuse — proof the new tables duplicate nothing

| Question | Answered by (existing, unchanged) | New tables add |
|---|---|---|
| What Type / lifecycle is it? | `lib/project-type.js` (`HS.canonicalProjectType`, `HS.canonicalLifecycle`) | only *which* record is defining |
| Is this a data centre and where? | `dc_canonical_entity`, `dc_entity_geography`, `map1_dc_zip_members` | nothing |
| What changed on a permit? | `dev_change_event_reportable` (source-record grain) | nothing; the timeline reads it for linked source records |
| Which parcels, owners, ZIPs? | `resolved_projects`, `resolved_project_parcels`, `v_resolved_project_zip` | nothing |
| Water filings and their history | `water_rights_filings` + observations | nothing; the link says the filing is this project's |
| Government meetings and notices | `meetings`, `alerts` | nothing; the link names the item and its role |
| Is a JODY video public? | `youtube_channel_videos` (`privacy_status`, `public_verified_at`) | only which project it explains |
| Was a Bluesky post published? | `video_bluesky_jobs` (`status='published'`, `bsky_uri`), `bsky_post_metrics` | same |
| Page URL, sitemap, lastmod, IndexNow | `gen_zip_pages.py`, `page_semantics.py`, `indexnow.py`, `audit_index_all.py` | one new path family `development` |
| Who may decide | `dashboard_admins` (whole dashboard) | `development_reviewer` (narrower) |

No existing table models "these different records are one real-world project". The 2026-08-10 proposal
(`docs/multi-source-evidence-architecture.md`, "nothing implemented") is the only other design. These
tables are a strict subset of it and can grow into it later. `resolved_project_status` is not reused as a
live store: it has no writer, it is frozen since 2026-07-06, and it grades proximity as evidence. Its rows
are reviewed one at a time into links (§8).

## 6. How a page is built (reuse, no new pipeline)

1. **Ingest (new, small):** a job reads approved, unsuperseded links through
   `development_dossier_snapshot()` (security definer, `service_role` only). It applies the public filter:
   grades a/b, not private, page `published`, and for media `public_verified_at` / `bsky_uri` present.
   It joins the facts from the owning tables and publishes `email-assets/seo/development-dossiers.json`.
   This is the same public-object route the Rule D plane and project pages already use
   (`pages.yml:191-202`).
2. **Site build:** `gen_zip_pages.py` gets `render_development()`. It reuses `_head`, `_ld_json`
   (BreadcrumbList + WebPage only) and the brand overlay, and writes `/development/<st>/<key>/index.html`.
   It registers the pages in `PageState` (new family `development` in `page_semantics.PATH_RES`) and in a
   `development` family sitemap. `audit_index_all.py` covers the pages with no change, because they are
   public, index-eligible and self-canonical.
3. **Links in:** `/community/<zip>/` and `/map/<zip>/` for each ZIP a linked parcel or record is in;
   `/project/…` source-record pages ("Part of: Stratos data center project"); the project lists.
   **Links out:** each linked `/project/` page. No redirects.
4. **Fan-out:** one dossier change touches the dossier and its linked ZIP, map and project pages. For
   Stratos that is about 5 pages. The semantic fingerprint keeps unchanged pages out of lastmod and
   IndexNow.

Every fact and source link is in the HTML the server sends. JavaScript only does three things:
- the Follow button;
- the "Jump to section" menu on mobile;
- the map preview, an optional enhancement over a static outline image and a parcel list.

## 7. Timeline: no new event store

| Row | From | Date shown |
|---|---|---|
| Government action (agenda item, adopted action, legal decision, filing) | the linked record (`meetings.meeting_date`, the filing's own date, the county notice date) | the source's own date, labelled by kind ("Filed", "On agenda", "Decision issued") |
| Permit change on a linked source record | `dev_change_event_reportable` | the event's own date |
| Water filing first seen / removed from pending list | `water_rights_filing_observations` | shown as "JODY first saw it on …" — never as a decision |
| JODY coverage | linked media | in a separate JODY Coverage list; a timeline row may say "JODY explained this" under a government event, never as its own event |

## 8. Historical July rows — individual review (2026-10-29)

| July row | Source re-read | Decision |
|---|---|---|
| MIDA "Development agreement approved / executed" (2026-04-24) | `meetings` row for PMN notice 1075195: the **agenda** lists Res. 2026-06 (adopt Stratos Project Area Plan), 2026-07 (development standards), 2026-08 (development agreement with the master developer), Ord. 2026-01 (energy sales tax), Res. 2026-09 (interlocal with Box Elder County) | **Re-graded.** Grade **a** for "on the 2026-04-24 MIDA Board agenda". **"Approved/executed" is not supported by an agenda.** It needs MIDA minutes or the adopted resolutions; until then show "On the agenda", plus news reports of adoption at grade c. |
| County consent and interlocal (Res. 26-11, 26-12) | PMN notice 1076001: Box Elder County special meeting 2026-05-04 agenda | Grade **a** for "on the agenda"; adoption not yet shown by an official record. |
| Referendum ruled non-referable (2026-05-28) | County News Flash "Box Elder County Attorney Issues Legal Decision on Referendum Applications for Resolutions" (boxeldercountyut.gov/stratosproject, 2026-05-30) | Grade **a** that a legal decision was issued. The outcome ("not referable") so far comes from news (grade c) until the county's decision document is read. |
| Lawsuit (3rd District) | plaintiff's site + news, no docket | Stays grade **c**, "reported". |
| 22 water-rights rows | proximity / owner match | **Not imported**, as decided. 8 belong to unrelated owners and 2 name private individuals. |

## 9. a55167 reconciled against the agency document

Source: Utah Division of Water Rights, *Change Details for a55167*, read 2026-10-28
(`https://www.waterrights.utah.gov/asp_apps/chprint/chprint.asp?chnum=a55167`). Copy kept in ingest at
`video/projects/stratos-water-change-hansel-valley/sources/change_report.pdf`.

- `Change: a55167   Water Right: 13-2` · `Status: Unapproved` · `Changes: Point of Diversion, Place of
  Use, Nature of Use` · `Filed: 10/15/2026` · `Protested: Protested` · no hearing held, no State Engineer
  action.
- Owner `Bar H Ranch, Inc.`; remark `O'Leary Digital Utah DC Sub I, LLC, is under contract to purchase
  this (see application)`.
- Quantity hereafter `4 CFS OR 1712 ACFT`. The application says the water is to "supply a data center
  project (the Project) to be developed by O'Leary Digital Utah DC Sub I, LLC".
- Uses after the change: Power ("Wonder Valley Power … Steam Generation Power Plant, Rated at 7500 MW")
  and Other ("Commercial and Industrial Uses at a Data Center Campus").

**Result:**
- a55167 is a **permanent change application on right 13-2**. It is not an application to appropriate.
- The Stratos link is **grade a**: the agency's own record states the project and the developer.
- "Wonder Valley", listed as unconfirmed in `resolved_projects` since July, appears in the filing as the
  name of the proposed power use.

**Defect found (existing, not fixed here):**
- `water_rights_map_feature` sets `filing_type` from `TYPE_OF_RIGHT`, which is the base right's original
  type (13-2 began as a 1905 application to appropriate).
- Production today: 644 pending Utah filings numbered `a…` and 67 numbered `t…` carry
  "Application To Appropriate".
- ZIP pages therefore show "Application To Appropriate a55167".

**Proposed fix (separate PR, needs approval):**
- take the type from the filing number's prefix, and only for prefixes whose meaning has been read from a
  DWRi record;
- otherwise show no type.

## 10. Draft PR plan (independent, each reversible)

| # | PR | Repo | Production effect when merged | Rollback |
|---|---|---|---|---|
| 1 | Map 1 land card from data, every project per ZIP | site | page JS only | revert commit |
| 2 | Follow waits for the database | site | page JS only | revert commit |
| 3 | Utah water filing type from the filing, not the base right | site SQL | `water_rights_map_feature` + reload | prior body kept in file |
| 4 | `development_project` / `_link` / `_reviewer` + decide function + snapshot function | site SQL | new tables, no readers | `drop` (no dependents) |
| 5 | Snapshot publisher (ingest) | ingest | writes one public JSON | stop job; delete object |
| 6 | `render_development` + family sitemap + links | site | new pages | revert; pages 404 again, nothing else moves |
| 7 | Seed Stratos + Proctor 4 links (reviewer-approved) | data | two pages appear | revoke links (history kept) |
| 8 | Follow target `development` | site + SQL | additive `target_type` | revert UI; rows stay |

PR 4 must merge before 7. PR 6 renders nothing without 5 and 7. PRs 1, 2 and 3 are independent of all
others.

## 11. Tests

- **SQL (disposable Postgres, like `test/state_water_rights_pg`):**
  - an automated insert can only be a candidate;
  - a non-reviewer cannot approve, and a revoked reviewer cannot either;
  - grades c, d and e cannot be approved;
  - a private-person link is never in the snapshot;
  - a revoked link leaves the snapshot, and its history remains;
  - there is at most one defining record;
  - a role must fit its object kind;
  - grants: anon reads nothing.
- **Build (`test/development-pages.test.mjs`):**
  - the page's facts and source links are in the raw HTML;
  - exactly one H1 and one self-canonical;
  - the page is in the `development` sitemap;
  - lastmod is unchanged on a no-change rebuild;
  - `/project/` pages are untouched apart from the new "Part of" link;
  - Type comes from `lib/project-type.js` for the defining record;
  - no Stratos literal is in the renderer;
  - the Proctor 4 fixture renders through the same code.
- **Browser:**
  - checks at 320, 390, 768, 1024 and 1440 px;
  - the page is readable with JavaScript off;
  - the Follow states;
  - jump links.

## 12. Rollback

- Pages: revert PR 6, and the next build drops the family. `/project/` pages are unaffected.
- Data: revoke links; history stays.
- Tables: drop after the renderer is reverted (no other readers).
- Follow: the new `target_type` rows stay readable; nothing deletes legacy follows.

## 13. What the implementation adds to this proposal (2026-10-29, after approval in principle)

Built in `docs/development-dossier.sql`, `scripts/development_pages.py` and homesignal-ingest
`scripts/publish_development_dossiers.mjs`. Three additions, each needed to build the approved page:

1. **Reviewer statements** (`development_project_statement`): the summary, "what changed", "what's next", what is
   known, what is not known yet, and possible effects. These are reviewer-written sentences, not data from an owning
   table, so they need their own rows. The rows are append-only, reviewers only, never automated. A fact-stating kind
   (summary, latest, known, impact) must carry an https source.
2. **One name.** `development_project.display_name` is nullable. A project that links an approved land assembly takes
   `resolved_projects.display_name` (founder, 2026-10-29: no competing authoritative names). A second, different name is
   refused when it is written and again at snapshot time. `name_basis` carries `descriptive`, so the page can say
   "Descriptive label by HomeSignal. No public record names this project."
3. **Follow without a schema change.** `app_follows` has no `target_type` check (measured 2026-10-29), so a development
   follow is `target_type='development'`, `target_id=<project_key>`, written by `HS.toggleFollow` from
   `follow-development.html`. The dossier pages ship no script.

**Not built here:** listing development follows in My Places, alerts for followed developments, `news_report` links on
the page (grade c cannot be approved), following `dc_canonical_entity.superseded_by` (a superseded entity's link is
withheld and counted), and the reviewer UI (reviewers call the `development_*` functions).
