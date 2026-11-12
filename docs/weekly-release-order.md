# Weekly Report (Tab 20): release files and application order

Every file below is **prepared, not applied to production**. Each is one transaction and is safe to apply twice.
Re-applying an earlier file after a later one changes nothing.

| # | File | What it installs | Needs |
|---|---|---|---|
| 1 | `docs/weekly-1-base.sql` | Helpers; the research request, pasted answer and engine run tables | `alert_topic_catalog` |
| 2 | `docs/weekly-2-topic-queue.sql` | The topic queue: leads, editions, lead events, eight admin functions | 1, `_hs_is_admin` |
| 3 | `docs/weekly-3-workbench.sql` | Research processing and the editorial workbench (sources, findings, library, scripts, approvals, lessons, costs). **This file dispatches the ingest workflows.** | 1, `_hs_is_admin`, vault, `pg_net` |
| 4 | `docs/weekly-4-source-copy.sql` | Source copies; both private storage buckets and their one read policy. **Incomplete work, paused.** | 1, 3, Storage |
| 5 | `docs/weekly-5-titles.sql` | Title versions and their three decisions | 1, 3 |
| 6 | `docs/weekly-6-doc-cues.sql` | Document-evidence cues | 1, 3, 4 |
| 7 | `docs/weekly-7-topic-queue-gate.sql` | The version-to-edition link and the approval gate | 1, 2, 3 |
| 8 | `docs/weekly-8-edition-sequence.sql` | The edition's video: an ordered sequence of approved script segments, its digest-bound approval, and the render export. An entry must belong to this edition (7) and be of a topic it covers; every lead of the edition needs a disposition. A published or closed edition's sequence, approvals and content are locked (two triggers on `weekly_scripts` and `weekly_script_approvals`) | 1, 2, 3, 6, 7 |
| 9 | `docs/weekly-9-edition-topics.sql` | An edition may cover several topics, and a published edition refuses new assignments, research requests, dispositions, topics and links. GENERATED from 2 and 7 (`build_edition_topics_sql.py`); replaces five of their functions. **Proposed to the topic-queue session; not to be adopted without its agreement.** | 1, 2, 3, 7 |
| 10 | `docs/weekly-10-edition-render.sql` | The private review render of an approved edition: a render job table, the private bucket `weekly-media` (dashboard admins read, service role writes), a request function that dispatches homesignal-ingest `weekly-render.yml` on main, and the worker's claim, finish and fail functions. **This file dispatches.** Apply it only after `weekly-render.yml` is on homesignal-ingest `main`. | 1, 2, 3, 6, 7, 8, vault, `pg_net`, Storage |

## The queue-only release: files 1 and 2

This is what Tab 20 (`acquisition.html`, `HS.acqWeeklyTopics.load`) uses. It installs six tables
(`weekly_runs`, `weekly_research_requests`, `weekly_research_answers`, `weekly_editions`, `weekly_topic_leads`,
`weekly_topic_lead_events`) and eight admin functions (`hs_weekly_lead_save`, `hs_weekly_edition_create`,
`hs_weekly_lead_assign`, `hs_weekly_lead_send_to_research`, `hs_weekly_lead_disposition`, `hs_weekly_edition_close`,
`hs_weekly_edition_publish`, `hs_weekly_topic_queue`).

It cannot dispatch a workflow, queue an engine run, save an answer or touch storage: no function in files 1 and 2
does any of those (`test/weekly_stage2_pg/queue_only.sql`, check K03).

- "Send to research" here **prepares** a research request: one row in `weekly_research_requests`, linked to the lead and
  edition, that a person can copy. Nothing submits it for processing. The lead's status stops at `queued_for_research`,
  which Tab 20 shows as "Research request prepared".
- `weekly_research_answers` and `weekly_runs` are installed because the queue **reads** them to derive a lead's research
  status. Nothing in files 1 and 2 writes them.
- The read model reports what is installed: `capabilities.version_linking` (file 7) and
  `capabilities.answer_processing_installed` (file 3). Installed is not the same as operational: research processing
  also needs the two homesignal-ingest workflows, which the database cannot see.

## Before applying files 1 and 2: the read-only preflight

`docs/weekly-preflight-queue-only.sql` is one SELECT that changes nothing. It checks the prerequisites (the admin
helper and its admin list, the topic catalog, its `(stream, topic)` key and the report categories, the three roles) and
reports any object files 1 and 2 would create that already exists: tables, sequences, indexes, functions, types,
constraints and triggers. The object list is generated from a disposable database (`build_preflight.py`), never typed.
It prints names and counts only. Run it through `db-read.yml` when approved; it has not been run against production.

## What is not separable

Files 4, 5 and 6 are separate files, but **file 3 calls their functions at run time** (`hs_weekly_overview`,
`hs_weekly_export`, `weekly_run_claim`, `weekly_version_status`). Apply 3, 4, 5 and 6 together. Only the topic queue
is independent of them. Shared pieces stay in the file that owns the table: the run kinds (file 1), a source's copy
columns and guard and `weekly_without_visuals` (file 3).

Do not apply file 3 before `weekly-research-ingest.yml` and `weekly-script-run.yml` are on homesignal-ingest `main`:
a pasted answer would queue a run nothing picks up.

## Tests (disposable Postgres only)

- `test/weekly_stage2_pg/run_queue_only.sh`: files 1 and 2 alone; then files 1-7 applied on top, with every queue row unchanged.
- `test/weekly_stage2_pg/run.sh` and `run_topic_queue.sh`: files 1-7, applied twice, with their mutation checks.
- The order lives in one place: `test/weekly_stage2_pg/config.sh`.

## Read-only checks around the application of files 1 and 2

All three are single SELECTs, generated from a disposable database (never typed), run through `db-read.yml`:

| When | File |
|---|---|
| Immediately before file 1 | `docs/weekly-preflight-queue-only.sql` |
| After file 1, and immediately before file 2 | `docs/weekly-verify-after-1.sql` |
| After file 2 | `docs/weekly-verify-after-2.sql` |

The two verification files compare every weekly object in production (definitions, function body checksums, what anon
and authenticated can reach) with the list the release files produce, and require every weekly table to be empty. They
are built and tested by `test/weekly_stage2_pg/build_verify.py`, which also proves each fails on a tampered database.

## Files 8 and 9: the edition's video (prepared, not applied)

- **Re-apply hazard.** File 9 replaces `_wk_lead_assign`, `weekly_lead_request_text`, `hs_weekly_lead_send_to_research`,
  `hs_weekly_lead_disposition` (file 2) and `hs_weekly_edition_link_version` (file 7). Re-applying file 2 or 7 after 9
  restores their own versions of those five, which also drops the publication lock; re-apply 9 after any re-application of 2 or 7. `run_release_1_9.sh` shows both halves.
- **Tests.** `run_edition_sequence.sh` (files 8 and 9, with their mutations); `run_release_1_9.sh` (the catalog delta
  1-7 -> 1-9 object by object, idempotence, the upgrade over seeded rows, the re-apply hazard, negative controls); and
  the three existing runners with `WEEKLY_WITH_VIDEO=1`, which run their unchanged checks on files 1-9.
- **Changing a published report** is refused, not supported: a separate, explicitly authorized revision workflow would be
  needed and does not exist. A follow-up topic in a later edition is the way forward.
- **Test data.** The Water Quality script in these tests is the Air Quality demonstration with its topic renamed: a
  technical fixture for ordering, topics and gates, not Water reporting.

## File 10: the private review render (prepared, not applied)

- A person asks for a render of the sequence they reviewed (`hs_weekly_edition_render(edition, digest)`). It is refused for an
  unapproved, closed or published edition, or a digest other than the current approved one (40001). One render per edition
  runs at a time; asking again for content already rendered returns that render instead of rendering twice.
- The worker (`weekly-render.yml` -> `weekly_slice/render_job.py`) claims it. The claim re-checks the approval: if the
  content changed after the request, the render is failed there and nothing is handed out. The worker then recomputes
  every hash and the digest itself (`edition_bundle.export`) before rendering.
- Files go to `weekly-media/<edition>/<render>/`. A render is recorded as done only with a video, captions and a thumbnail,
  each present in the bucket with the stated size. Nothing is published, and the edition's `video_url` is never written.
- The bucket's per-file limit is 50 MB, the project's upload limit. A longer video that exceeds it is refused before
  any upload and recorded as failed; raising it is a project setting.
- Tests: `test/weekly_stage2_pg/run_edition_render.sh` (files 1-10 on a disposable database; 35 checks; 25 mutations,
  each caught). The CI job `edition-video` in `weekly-stage2-suite.yml` runs it with the files 8-9 suites.
