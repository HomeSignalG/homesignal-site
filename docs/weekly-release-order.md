# Weekly Report (Tab 20): release files and application order

Every file below is **prepared, not applied to production**. Each is one transaction and is safe to apply twice.
Re-applying an earlier file after a later one changes nothing.

| # | File | What it installs | Needs |
|---|---|---|---|
| 1 | `docs/weekly-1-base.sql` | Helpers; the research request, pasted answer and engine run tables | `alert_topic_catalog` |
| 2 | `docs/weekly-2-topic-queue.sql` | The topic queue: leads, editions, lead events, eight admin functions | 1, `_hs_is_admin` |
| 2a | `docs/weekly-2a-publication-lock.sql` | The publication lock: three of file 2's functions, each with one added line. Creates no object | 1, 2 |
| 3 | `docs/weekly-3-workbench.sql` | Research processing and the editorial workbench (sources, findings, library, scripts, approvals, lessons, costs). **This file dispatches the ingest workflows.** | 1, `_hs_is_admin`, vault, `pg_net` |
| 4 | `docs/weekly-4-source-copy.sql` | Source copies; both private storage buckets and their one read policy. **Incomplete work, paused.** | 1, 3, Storage |
| 5 | `docs/weekly-5-titles.sql` | Title versions and their three decisions | 1, 3 |
| 6 | `docs/weekly-6-doc-cues.sql` | Document-evidence cues | 1, 3, 4 |
| 7 | `docs/weekly-7-topic-queue-gate.sql` | The version-to-edition link and the approval gate | 1, 2, 3 |

## The queue-only release: files 1, 2 and 2a

This is what Tab 20 (`acquisition.html`, `HS.acqWeeklyTopics.load`) uses. It installs six tables
(`weekly_runs`, `weekly_research_requests`, `weekly_research_answers`, `weekly_editions`, `weekly_topic_leads`,
`weekly_topic_lead_events`) and eight admin functions (`hs_weekly_lead_save`, `hs_weekly_edition_create`,
`hs_weekly_lead_assign`, `hs_weekly_lead_send_to_research`, `hs_weekly_lead_disposition`, `hs_weekly_edition_close`,
`hs_weekly_edition_publish`, `hs_weekly_topic_queue`).

It cannot dispatch a workflow, queue an engine run, save an answer or touch storage: no function in files 1 and 2
does any of those (`test/weekly_stage2_pg/queue_only.sql`, check K03).

**File 2a, the publication lock.** Once an edition records its published video, the database refuses new assignments,
new research requests and any change of disposition (include, defer, drop) for it, with SQLSTATE 55000, as it already
does for a closed edition. Before 2a only the page hid those actions. 2a is generated from file 2
(`test/weekly_stage2_pg/build_queue_lock_sql.py`, which `--check`s it): each of `_wk_lead_assign`,
`hs_weekly_lead_send_to_research` and `hs_weekly_lead_disposition` is file 2's body plus one line, placed after the
function's closed check, so a closed edition keeps its own message. Owner, privileges, SECURITY DEFINER and search_path
are unchanged. A research request that already exists for a lead in a published edition is still answered as
`existing: true`; nothing is written. File 9, prepared separately, inserts the same line at the same places.
**Re-applying file 2 after 2a removes the lock; re-apply 2a after it.** Files 3-7 do not replace these functions.
Tests: `test/weekly_stage2_pg/run_publication_lock.sh` (publication_lock.sql, checks L00-L11, nine mutations).

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

All four are single SELECTs, generated from a disposable database (never typed), run through `db-read.yml`:

| When | File |
|---|---|
| Immediately before file 1 | `docs/weekly-preflight-queue-only.sql` |
| After file 1, and immediately before file 2 | `docs/weekly-verify-after-1.sql` |
| After file 2, and immediately before 2a | `docs/weekly-verify-after-2.sql` |
| After 2a (the release complete) | `docs/weekly-verify-after-2a.sql` |

The three verification files compare every weekly object in production (definitions, function body checksums, what anon
and authenticated can reach) with the list the release files produce, and require every weekly table to be empty. They
are built and tested by `test/weekly_stage2_pg/build_verify.py`, which also proves each fails on a tampered database.
