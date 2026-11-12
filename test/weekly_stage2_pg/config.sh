# The weekly release files, in application order (docs/weekly-release-order.md). Sourced by the suite runners.
# shellcheck shell=bash
WEEKLY_DOCS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../docs" && pwd)"
# The queue-only release: files 1 and 2.
WEEKLY_QUEUE_ONLY=(weekly-1-base.sql weekly-2-topic-queue.sql)
# Everything prepared so far.
WEEKLY_FULL=(weekly-1-base.sql weekly-2-topic-queue.sql weekly-3-workbench.sql weekly-4-source-copy.sql weekly-5-titles.sql
             weekly-6-doc-cues.sql weekly-7-topic-queue-gate.sql)
# The edition's video (8) and an edition covering several topics (9, proposed to the topic-queue session). The existing
# runners use files 1-7 unless WEEKLY_WITH_VIDEO is set; then they run the combined release 1-9 with the same checks.
WEEKLY_VIDEO=(weekly-8-edition-sequence.sql weekly-9-edition-topics.sql)
WEEKLY_RLS_TABLES=22   # tables with row security in files 1-7 (suite.sql W01b); release_catalog.py checks which ones
if [ -n "${WEEKLY_WITH_VIDEO:-}" ]; then WEEKLY_FULL+=("${WEEKLY_VIDEO[@]}"); WEEKLY_RLS_TABLES=25; fi
# weekly_combine <out> <dir> <file>...   one file holding the named files of <dir>, in the order given
weekly_combine() { local out="$1" dir="$2"; shift 2; : > "$out"; local f; for f in "$@"; do cat "$dir/$f" >> "$out"; printf '\n' >> "$out"; done; }
