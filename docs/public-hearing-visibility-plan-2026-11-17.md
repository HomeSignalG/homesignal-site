# Public hearing visibility — audit and implementation plan (2026-11-17)

Status: **PLAN ONLY.** Nothing here is built, applied or deployed. No production database change and no
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

## 4. Implementation plan

Design principle: **one hearing record, one reconciliation decision, one presentation function.** Extend
`public.meetings`; do not add a parallel hearings table or a second page-side classifier.

### 4.1 Database (SQL of record, parked in `docs/public-hearings.sql`, NOT applied)
Additive and nullable, on `public.meetings`:
- `confirmation_state` (`official` default, `provisional`) and `source_tier` (`government_body`, `advisory_committee`).
- `hearing_status` (`scheduled` default, `cancelled`, `postponed`, `superseded`, `held`).
- `announced_on`, `notice_published_on`, `decision_date`, `decision_outcome`. `meeting_date` stays the hearing date.
- `comment_deadline`, `comment_instructions`, `participation_url`, `participation_note` (verbatim from the source).
- `public.is_cancelled` stays the one cancelled decision, now `hearing_status = 'cancelled'` OR the existing title test.

New append-only tables:
- `meeting_reconciliation` (provisional row, official row, kind: `confirmed_by`, `rescheduled_to`, `cancelled_by`,
  `duplicate_of`; rule version; evidence quote and URL; time).
- `meeting_project_link` (meeting, project key such as `source_key|seq` or a dossier key, basis: case number, parcel,
  named in notice, reviewer; evidence; grade).
Display views exclude `superseded` and `duplicate_of` rows. RLS on, no visitor writes. A disposable-Postgres suite
proves the rules and 10 or more deliberate breaks fail it.

### 4.2 Ingest (homesignal-ingest)
- `build_payload`: fill the new date and participation fields where the source states them; never default a date from
  a posting date (an undated hearing stays undated).
- Parsers: extract comment deadline, instructions and participation link in `adapters/notice_list.py` shared helpers.
- `data/hearing_sources.json`: the recognized advisory committees, per `jurisdiction_slug`, each with a reason and
  its own-site URL. Data, not code. Only these may write `provisional`.
- `scripts/reconcile_hearings.py` (set-based, runs after each ingest and daily): match provisional to official by
  body, hearing date and case number or normalized title; record the decision; detect reschedules (same case number,
  new date) and cancellations. Unmatched provisional rows expire per section 5, never silently.
- CI gate `scripts/check_hearing_policy.py`: no provisional row without a source link and label, none from an
  unlisted source, none after expiry; no hearing with a decision date equal to a notice date by construction.
- Health check `hearing_reconciliation` in `pipeline_health_tick()` (same splice discipline as earlier checks).

### 4.3 Site (homesignal-site)
- `lib/templates.js`: ONE presentation function for a hearing (status chip, "Official confirmation pending", the
  four dates by their own names, comment instructions, participation link, deadline countdown).
- `lib/data.js`: read hearings first, outside the 24-row cap; drop superseded and duplicate rows.
- `lib/community-page.js`: a "Public hearings" block above routine meetings; the same text prints in the build-time
  document (`scripts/gen_zip_pages.py`), reading the same stored data, so crawlers see it.
- `scripts/development_pages.py` and `lib/map1-project-panel.js`: show linked hearings on a project with no pin.
- Email: `digest.py` (ingest) lists hearings with their deadlines; the Delivery session owns that file (Rule #0a).

### 4.4 Tests
`test/public_hearings_pg` (SQL), `test/public-hearings.test.mjs` (presentation, one function), a browser test on a
real generated ZIP document with a provisional, an official, a cancelled and a rescheduled hearing, and the CI gate.

### 4.5 Order of work
0. This plan and the CLAUDE.md policy (docs only).
1. Read-only measurements (section 6). Founder reviews them.
2. SQL file and its disposable-Postgres suite. **Apply needs founder approval.**
3. Ingest changes, gated by the new check.
4. Site presentation.
5. Association (project link) and dossier / Map 1 panel.
6. Neskowin / ZIP 97149 only as a test case, after the Tillamook work lands.

## 5. Decisions where I have set a default (founder may change)
- **D1 Cancelled:** keep the 2026-10-19 ruling (visible, badged, not actionable).
- **D2 Recognized advisory committee:** a registry the founder approves entry by entry; none assumed.
- **D3 Provisional expiry:** shown until the day after the hearing date; if the hearing date is unknown, 30 days
  from the announcement. Afterwards it reads "Not found in official notices" and leaves the upcoming list.
- **D4 Comment contact details:** official government addresses stated on the source page may be shown verbatim;
  a private person's details never.

## 6. Measurements to take before any apply (UNVERIFIED today)
Through `db-read.yml` (read only), each beside its control: stored meetings with `is_public_hearing` (total, upcoming,
cancelled by title); pairs of rows with the same body and case number but different dates; hearing notices in `alerts`
with no matching `meetings` row; sources that set no event date.

## 7. Do not touch (active Tillamook session)
`supabase/functions/get-address-report/sources/county-cases.ts`, the `county_cases` entries of
`jurisdiction-registry.json`, `test/county-cases-fixture.test.ts`, the County Land-Use Cases section of CLAUDE.md,
and in ingest the `civicplus_land_use_cases` parser, `gov-tillamook-*` feeds and the `claude/tillamook-*` branches.
Origin branches checked 2026-11-17: site `tillamook-case-fixes`, `tillamook-hold-cases`, `tillamook-validate`,
`tillamook-source-audit` (scratch); ingest `tillamook-hearings`, `tillamook-planning-feed`, `tillamook-permits`.
No change in this plan edits those files.
