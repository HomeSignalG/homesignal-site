# Public hearing visibility — audit and implementation plan (2026-11-17)

Status: **PLAN v3 (2026-11-19), FOUNDER-APPROVED; implementation in draft PRs, nothing applied.** Direction approved 2026-11-19 with the modifications in section 4; the section 6
measurements are taken and reported in section 5. **PLAN ONLY:** nothing here is built, applied or deployed. No production database change and no
deployment happens without founder approval. Policy text of record: CLAUDE.md, section "PUBLIC HEARINGS ARE
VISIBLE BEFORE THEY ARE DECIDED" in both repos.

Evidence rule: every statement below about code was read from `origin/main` of both repos on 2026-11-17.
Anything about production DATA is marked UNVERIFIED and has a measurement listed in section 6.

## 1. What exists today (read from code)

**Ingest (homesignal-ingest).**
- A hearing is a `meetings` row. `ingest.py::build_payload` writes `meeting_date`, `meeting_time`, `meeting_type`,
  `is_public_hearing` (from `is_public_hearing(item)`), `location`, `attendance_mode`, `agenda_summary`,
  `dedupe_key`, `feed_id`, `source_url`, `category`.
- `dedupe_key` = `community_id | date | normalized title` (+ location only for generic titles)
  (`meetings_dedupe_key`). The date is part of the key.
- Already-stored rows are skipped by `source_url`. `meeting_refresh_patch` may update only
  `agenda_summary, location, attendance_mode, meeting_type`, and only if title and date are unchanged.
  Title and date are never sent.
- The meeting date is `event_start or published_at` (`build_payload`). Vendor adapters set `event_start`;
  `generic_rss` is dated from the title (`date_meetings_from_title`); a source with neither stores its posting
  date as the meeting date.
- Cancelled: `public.is_cancelled(public.meetings)` reads the TITLE (migration `20261019190000`). Founder ruling
  2026-10-19: cancelled meetings stay visible with a "Cancelled" badge.
- Window: meetings are held to 730 days past and future (`drop_out_of_window_meetings`). Government notices
  (`alerts`) are held to 365 past / 730 future (`drop_out_of_window_gov_notices`); undated records are kept.
- Enrollment gate: a meetings row for an enrolled community must carry one of the 6 canonical topics
  (`CANONICAL_MEETING_TOPICS` + DB CHECK). Anything else is `[REJECT]`ed.
- Source policy: first-party only (wiring rule 0). Newspaper-association aggregators (e.g.
  washingtonpublicnotices.com) are not used.

**Site (homesignal-site).**
- Meetings are read LIVE, never materialized (`lib/data.js`: `meetings` + `is_cancelled`, `gte(cutoff)`,
  `limit(24)`, plus "last met" per body). A correction takes effect at once.
- Government notices are materialized: `app_refresh_zip` writes `app_changes`, and an `app_changes` row, once
  written, is never re-evaluated (CLAUDE.md, 2026-09-05 date-window section). A cancelled or superseded NOTICE
  therefore cannot leave a page by itself.
- A ZIP page reads the county plus every city covering part of its land (`zip_government_bodies`), so a city
  hearing reaches the ZIP page through the chain.
- Development dossiers allow a reviewed `government_record` link with role `hearing`
  (`development_link_role_allowed`). Reviewer-only; it does not scale to every hearing.
- `county_cases` (Tillamook) keeps the county's own hearing status verbatim and `status_history`, but quarantines
  any case it cannot pin to named tax lots in the ZIP.

## 2. Gaps against the eight rules

| # | Rule | Gap |
|---|---|---|
| 1 | Confirmed hearings on the ZIP pages | Shown as ordinary meetings, in a list capped at 24, mixed with routine agendas. `is_public_hearing` is stored but nothing prioritizes it. Hearings published only as `alerts` notices depend on a 14-day materializer window. |
| 2 | Advisory-committee hearings, "Official confirmation pending" | No such state. No registry of recognized committees. |
| 3 | Auto-reconcile provisional with official | No mechanism. A provisional row and the later official row would be two rows. |
| 4 | Separate announcement, publication, hearing, decision dates | Only `meeting_date` and `created_at` exist. A source with no event date stores its posting date as the hearing date. No decision date on meetings. |
| 5 | Comment instructions, links, deadlines | Not stored for meetings. Only `agenda_summary` free text. |
| 6 | Association with projects without a Map pin | No meeting-to-project link. `county_cases` drops unpinnable cases. |
| 7 | No duplicate, cancelled, superseded, outdated | A reschedule changes the date, therefore the `dedupe_key`: the old row stays upcoming next to the new one. Title and date are never refreshed. Cancelled is read from a title. No superseded state. Materialized notices never age out. |
| 8 | Nationwide | The pieces are generic, but nothing enforces it. |

## 3. Conflicting rules found, and how the policy resolves each

1. **Cancelled meetings stay visible (founder 2026-10-19)** versus rule 7. Resolution: both hold. A cancelled
   hearing is kept and badged "Cancelled", is never listed as upcoming or actionable, and carries no participation
   prompt. A superseded or duplicate row is not shown.
2. **"A stored row is invisible to every future run" (ingest CLAUDE.md, classifier-backlog section).** Reschedule and
   cancellation need rows to change. Resolution: status changes go through the reconciliation step, which is
   append-only and audited; `meeting_refresh_patch`'s four-field rule is not loosened.
3. **First-party only (wiring rule 0).** A committee announcement counts only on the committee's or government's
   own site. Aggregators and newspaper-association notice sites stay barred.
4. **Enrollment and 6-topic gate.** A hearing for an unenrolled community, or with a non-canonical topic, is
   rejected today. Resolution: hearings reuse the same gate; enrolling is part of arming, as now.
5. **Materialized notices never age out.** Resolution: hearings are carried by `meetings` (live read), not by
   `app_changes`. A hearing notice in `alerts` may remain as the source document.
6. **Map 1 anti-fabrication and "a pin needs a verified location" (county_cases).** Resolution: a hearing needs no
   pin. The pin rules for Map 1 are unchanged. Association is by evidence (case number, named parcel, named
   project), never by guess.
7. **Permanent historical intelligence.** Hearings and every reconciliation decision are kept; nothing is deleted.
8. **Rule #0b (design closed).** This is a later founder ruling and governs; it adds no second source of truth.
9. **No Zaps, no Google News, no per-community code.** Unchanged. Advisory-committee sources are data rows.

## 4. Founder decisions of 2026-11-19 (these replace the earlier defaults)

- **D1 cancelled:** approved. Visible, badged "Cancelled", never listed as upcoming or actionable, no participation prompt.
- **D2 recognized committees:** nationwide, evidence-based criteria; no individual approval of each committee (criteria in 7.2).
- **D3 provisional expiry:** an expired provisional hearing leaves the upcoming list and stays in historical intelligence;
  reconciliation against official sources continues for confirmation, cancellation or rescheduling (7.3).
- **D4 contact details:** approved. Official government details on the source page may be shown verbatim; a private person's never.
- **Additional requirements.** Each is answered in section 7:
  1. no Map 1 pin is needed where geographic relevance is verified;
  2. comment deadlines and upcoming hearings come first;
  3. confirm the six-topic gate does not exclude relevant development hearings;
  4. coordinate with the Delivery session so subscribers get hearing, reschedule, cancellation and comment-deadline notices
     with no duplicates;
  5. never infer a hearing date from a publication date;
  6. permanent historical intelligence and source evidence are preserved.

## 5. Measurements taken 2026-11-19 (read only, through `db-read.yml`, runs 44593999235 and 44594265859)

Each number sits beside its control. A "lead" is a number that points at something but is not proof of it.

| Question | Result | Control / what it means |
|---|---|---|
| Stored meetings | 27,387 (newest row created 2026-11-19 17:06Z) | the query read the live table |
| Rows with `is_public_hearing` | **1,384 true**, 26,003 false (5.1%) | the flag is the only hearing marker |
| Hearings by time | **107 upcoming**, 658 in the last 90 days, 1,384 in all; upcoming ones sit in 42 communities | the national upcoming list is small |
| Hearings cancelled by title | 11 in all, **0 upcoming** | `is_cancelled` is title-based, as designed |
| Hearings whose title says "hearing" but flag is not true | 0 | the flag follows the title; a hearing described another way (for example "public notice") is not measured |
| Hearings with a stated start time | 29 of 1,384 (`meeting_time` null on 1,355) | times are almost never captured |
| Hearings with `comment_period_open` true | **1** | the column exists and is almost never filled |
| Recent (90 days) government notices whose title says "hearing" | 693; **0 carry `alerts.comment_deadline`** | comment deadlines are not captured as data anywhere |
| Upcoming hearings whose summary mentions comment / submit / testimony | 15 of 107 | deadline text exists in prose for about 14% |
| Of those 693 notices, no matching `meetings` row (same url) | **183 (26%)**: 109 county business, 56 planning and zoning, 10 water, 6 taxes, 2 safety | a quarter of hearing-titled notices never became a meeting. Lead: not every one is a future public hearing |
| Hearings linked to a notice (`alert_id`) | 0 of 1,384 | no meeting-to-notice link exists |
| Hearings with `geo_scope` set | 9 of 1,384 (6 address, 3 countywide); `zip` set on 6 | geographic relevance today is the community chain only |
| Same community, same title, different dates | 105 groups, 47 within 60 days; sample titles are recurring bodies ("hearing examiner meeting", "boe hearing") | **lead only**: titles cannot find reschedules |
| Same community and case number in the title, different dates | 3 groups | case numbers are rarely in titles |
| Meetings created in the last 60 days whose date is the same UTC day as creation | 527 of 13,860 (3.8%); hearings 22 | **lead only**: same-day meetings are also normal. Top feeds: Marion IN 51, Nye NV 36, Hennepin 36, Miami-Dade 19 |
| `meeting_date` | `timestamptz`, **NOT NULL** | an undated hearing cannot be stored as null today |
| Hearings by topic | county business 898, planning and zoning 324, taxes 150, elections 6, safety 4, water 2 | all six canonical; none outside |
| Upcoming meetings per community | 239 communities; **51 have more than 24**, maximum 155 | the page reads 24 rows, so routine agendas can push a hearing out in those 51 |
| Hearing rows with no `feed_id` | 180 | older rows cannot be traced to a source |
| `event_key` | set on all 1,384 hearings | already the Delivery session's key for pairing a notice with its meeting twin, per community |

**Not measured, and why.** (a) The six-topic gate's rejections: a rejected row is never stored, so only the ingest run logs show
it. I did not read those logs here. (b) Which adapters set a real event date: the table has no column for it; that is an ingest
code audit (done in the next phase). (c) Whether the 183 unmatched notices are upcoming public hearings: needs the notice text.

## 6. What the measurements change in the plan

1. **Date handling (requirement 5).** `meeting_date` is NOT NULL, so an undated hearing is stored today with its posting date.
   Recommended, additive: a `date_basis` column (`vendor_event`, `stated_in_notice`, `stated_in_title`, `posting_date_fallback`,
   `unknown_legacy`). A row on `posting_date_fallback` is never listed as upcoming, never sorted by that date, never notified, and
   reads "Hearing date not stated". The alternative (drop NOT NULL) is non-additive and needs your approval; I recommend against it.
   The 1,384 existing hearings start as `unknown_legacy` and are classified by the adapter audit.
2. **Comment deadlines (requirement 2).** No structured source exists today (0 of 693; 1 of 1,384). The priority order can only use
   deadlines the parsers extract, so the first release will rank mostly by hearing date. Extraction is new parser work and is
   stated as such, not assumed.
3. **Reschedule and cancellation detection.** Titles cannot do it (leads above). Matching keys, in priority: a vendor event id,
   then a case or file number from the notice body, then body plus date window plus normalized title. The third is low confidence
   and may only flag, never supersede.
4. **Hearings published only as notices.** About a quarter of hearing-titled notices have no meeting row. They need a hearing row
   (or a link to one) so they appear; `alert_id` is the link column and is unused today.
5. **The 24-row read.** 51 communities exceed it. Hearings are read first and outside the cap.
6. **Geography (requirement 1).** 9 of 1,384 hearings carry any geography. Verified relevance has two levels, neither needing a pin:
   government reach (the county or city covers the ZIP, the existing `zip_government_bodies` rule) and a named place resolved to a ZIP
   by the canonical ZCTA boundary test. A hearing with only government reach reads as county-wide and says so.
7. **Six-topic gate (requirement 3).** From stored data the gate excludes nothing it could be measured to exclude: all 1,384
   hearings carry a canonical topic, and 324 are under Planning, zoning and development. But topic is a weak development signal:
   898 (65%) sit under County business, where a commission hearing on a rezone files. So: keep the six topics unchanged; add a
   separate `hearing_subject` attribute (development and land use, budget and tax, other) derived from title and notice text,
   used for prioritization and notices. Verify rejections by counting `[REJECT]` lines for hearing-shaped titles in recent
   ingest run logs before approval of the build; I have not done that.
8. **Delivery (requirement 4).** `event_key` and `email_deliveries` already prevent the same event reaching one person twice across
   notices and meetings. Hearing events reuse them (7.6).

## 7. Revised implementation plan

Design principle unchanged: **one hearing record, one reconciliation decision, one presentation function.** Extend
`public.meetings`; no parallel hearings table, no second page-side classifier.

### 7.1 Database (SQL of record parked in `docs/public-hearings.sql`; NOT applied; apply needs your approval)
Additive and nullable, on `public.meetings`:
- `confirmation_state` (`official` default, `provisional`), `source_tier` (`government_body`, `advisory_committee`),
  `hearing_status` (`scheduled` default, `cancelled`, `postponed`, `superseded`, `held`), `hearing_key` (stable identity across
  reschedules: community, body and a vendor id or case number when present, else null), `hearing_subject`.
- `date_basis` (6.1), `announced_on`, `notice_published_on`, `decision_date`, `decision_outcome`, `comment_deadline`,
  `comment_instructions`, `participation_url`, `participation_note`.
- Expiry is **derived, never stored**: a function `hearing_display_state(meeting)` returns `upcoming`, `provisional_expired`,
  `held`, `cancelled`, `superseded` or `date_not_stated`. Nothing is deleted when a row expires.
- `public.is_cancelled` stays the one cancelled decision: `hearing_status = 'cancelled'` or the existing title test.
Append-only tables (no update or delete, RLS on, no visitor writes):
- `meeting_reconciliation`: provisional row, official row, kind (`confirmed_by`, `rescheduled_to`, `cancelled_by`, `duplicate_of`),
  match key used, rule version, evidence quote and url, time.
- `meeting_project_link`: meeting, project key, basis (case number, named parcel, named project, reviewer), evidence, grade.
- `hearing_source_evidence`: for each recognized committee, each criterion in 7.2, pass or fail, evidence url and quote, rule version,
  checked time. Suspensions and re-admissions are rows too.
- `hearing_notification_event` (the interface to Delivery, 7.6): `hearing_key`, event type, effective value, a unique event hash.
A disposable-Postgres suite proves the rules; at least 10 deliberate breaks must fail it.

### 7.2 D2: nationwide, evidence-based recognition of advisory committees
Evaluated by code, per `jurisdiction_slug`, stored in `data/hearing_sources.json` with the evidence, re-checked monthly. A committee
may write `provisional` rows only while **all** hold:
- **E1 government-created.** The jurisdiction's own site names the instrument that created it (ordinance, charter, resolution or
  statute). Evidence: that page and the quoted line.
- **E2 land-use remit.** Its own published remit covers development, land use, zoning, permits or comparable review.
- **E3 first-party publication.** The announcement is on the committee's or government's own domain, or on a meeting system the
  government's own site links to. Never an aggregator, a newspaper-association notice site, a social post, a private group or an
  individual (wiring rule 0).
- **E4 dated or specific.** The announcement names the body and a place or case, and either states a date or is a legitimate
  undated provisional announcement (`undated_but_specific`). An undated one shows "Hearing date not announced".
- **E5 track record, continuing.** Five reconciled outcomes start an accuracy *assessment*, never a suspension. Automatic
  suspension needs at least **20 independently resolved outcomes** and accuracy **below 80%**. Only an official notice that
  contradicts an announcement counts against a committee; missing confirmation, legitimate cancellations and reschedules do
  not. Suspended committees are still monitored passively. Reinstatement: a rolling window of at least 20 independently
  resolved outcomes at 80% or better, or a verified root-cause correction followed by 10 successful independent validations.
  Code: `hearings.committee_status`.
E1 to E4 are the entry test; E5 is the continuing test. A failed criterion is a logged row, not a silent skip.

### 7.3 D3: reconciliation and expiry
- A provisional row stays on the upcoming list until the day after its hearing date, or 30 days after its announcement when no date
  is stated. Then `provisional_expired`: it leaves the upcoming list, stays in history, and reads "Not found in official notices".
- Reconciliation keeps running on unresolved provisional rows for 365 days after the hearing date (the Government Notices past
  window), then marks them `unresolved` and keeps them.
- A late official notice that confirms a past provisional hearing records it as held, not upcoming. One that carries a **future**
  date (a reschedule) creates or updates the official row, which is upcoming; the provisional row is marked `rescheduled_to`.
- With no hearing date, reconciliation is anchored to the announcement date for the same 365 days. A passed date never
  implies the hearing occurred (`past_unconfirmed` until an official notice says `held`).
- Every transition is an appended `meeting_reconciliation` row. Source evidence is never overwritten.

### 7.4 Ingest (homesignal-ingest)
- `build_payload`: set `date_basis`; never turn a posting date into a hearing date; fill the new fields where the source states
  them. The existing generic dating of non-hearing meetings is unchanged.
- Parsers: extract comment deadline, instructions and participation link, and case or file number, in shared `notice_list` helpers.
- `scripts/reconcile_hearings.py` (set-based, after each ingest and daily) and `scripts/evaluate_hearing_sources.py` (E1 to E5).
- CI gate `scripts/check_hearing_policy.py`: no provisional row without a source link and label; none from a source not passing
  E1 to E4; none past expiry on the upcoming list; no hearing date equal to its posting date unless `date_basis` says it was stated.
- Health check `hearing_reconciliation` in `pipeline_health_tick()`, same splice discipline as earlier checks.

### 7.5 Site (homesignal-site)
- `lib/templates.js`: ONE hearing presentation function: status chip, "Official confirmation pending", the four dates by name,
  comment instructions, participation link, deadline countdown.
- `lib/data.js`: read hearings first, outside the 24-row cap, drop superseded and duplicate rows. Order: open comment deadline
  soonest, then upcoming hearing date ascending, then everything else.
- `lib/community-page.js` and `scripts/gen_zip_pages.py`: a "Public hearings" block above routine meetings; the build-time document
  prints the same text from the same stored data.
- `scripts/development_pages.py` and `lib/map1-project-panel.js`: show linked hearings on a project with no pin.

### 7.6 Delivery coordination (final; Rule #0a: `digest.py` and the notification path belong to the Delivery session)
The interface is written in homesignal-ingest `docs/hearing-delivery-handoff-2026-11-19.md` and implemented as pure decisions in
`hearings.py` (`reminder_events`, `lifecycle_events`, `event_hash`). Summary: existing Upcoming Meetings stream, no parallel
system; four event types; reminders at 7 and 2 days before a verified comment deadline, with catch-up and no expired reminders,
independent of the hearing date; one event per (person, `hearing_key`, type, effective value); a reschedule is one event.
Identity uses jurisdiction, body, stage, normalized details and a vendor id when present; dates and a bare case number never
establish identity; ambiguous or low-confidence matches suppress nothing; sequential hearings for one project stay distinct.
`digest.py` is not edited by this work.

### 7.7 Tests
`test/public_hearings_pg` (SQL), `test/public-hearings.test.mjs` (presentation, one function), a browser test on a generated ZIP
document with a provisional, an official, a cancelled, a rescheduled and an undated hearing, the CI gate, and a notification test
with duplicate, reschedule and cancel cases against the Delivery session's contract.

### 7.8 Order of work (each apply or merge step waits for your approval)
0. This plan and the policy text (docs only; the PRs stay drafts).
1. Your approval of section 5 and the numbers marked as proposals (E5 thresholds, reminder days).
2. SQL file and its disposable-Postgres suite. **Apply needs your approval.**
3. Ingest adapter audit for `date_basis`, then ingest changes behind the new CI gate.
4. Site presentation. 5. Project association and the dossier / Map 1 panel. 6. Delivery coordination and notifications.
7. Neskowin / ZIP 97149 only as a test case, after the Tillamook work lands.

## 8. Six-topic gate audit (recorded, not re-run)
The targeted audit of actual gate rejections was completed on 2026-11-19. The available ingest run-log evidence is insufficient
to claim validated hearing recall: a rejected row is never stored, so logs are the only trace and they do not identify
hearing-shaped candidates reliably. **No recall claim is made.** The six canonical topics stay; a separate `hearing_subject`
attribute is added so relevant development hearings are preserved whatever topic they file under. The audit mechanism is
`ingest_rejected_candidates` (homesignal-ingest migration `20261119180000`, prepared and NOT applied): truncated title, url,
feed, reason code only; RLS on, no visitor grants, 180-day purge.

## 9a. Build status (2026-11-19)
Built, offline-tested, nothing applied or merged: `hearings.py` + `tests/test_hearings.py` (25 checks), `docs/public-hearings.sql`
+ `test/public-hearings-sql.test.mjs`, the rejected-candidates migration, the Delivery handoff. Not built yet (each needs the SQL
applied first): wiring `date_basis` and fields into `ingest.py`, parsers for comment deadlines, `reconcile_hearings.py`,
site presentation, project-link panel, and the CI gate `check_hearing_policy.py`. Ingest is not wired on purpose: writing columns
that do not exist would fail every meetings insert.

## 9. Do not touch (active Tillamook session)
`supabase/functions/get-address-report/sources/county-cases.ts`, the `county_cases` entries of `jurisdiction-registry.json`,
`test/county-cases-fixture.test.ts`, the County Land-Use Cases section of CLAUDE.md, and in ingest the `civicplus_land_use_cases`
parser, `gov-tillamook-*` feeds and the `claude/tillamook-*` branches. No change in this plan edits those files.

## 10. Step-2A isolation check (separate issue, referred)
The red `step2a-isolation-db` check on homesignal-ingest PR #1142 is live-database drift from `docs/official-documents-map-gate.sql`
(site PR #2893): four unclassified `dc_*` objects, and `dc_current_observation` recreated at line 137 without
`security_invoker = true` (line 305 of the same file uses it). Referred to the Official Document Development Ingestion session on
that PR with the required classification, access rules and a regression test. The check is not bypassed or weakened.
