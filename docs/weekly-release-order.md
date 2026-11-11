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
