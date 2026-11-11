# The weekly release files, in application order (docs/weekly-release-order.md). Sourced by the suite runners.
# shellcheck shell=bash
WEEKLY_DOCS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../docs" && pwd)"
# The queue-only release: files 1 and 2.
WEEKLY_QUEUE_ONLY=(weekly-1-base.sql weekly-2-topic-queue.sql)
# Everything prepared so far.
WEEKLY_FULL=(weekly-1-base.sql weekly-2-topic-queue.sql weekly-3-workbench.sql weekly-4-source-copy.sql weekly-5-titles.sql
             weekly-6-doc-cues.sql weekly-7-topic-queue-gate.sql)
# weekly_combine <out> <dir> <file>...   one file holding the named files of <dir>, in the order given
weekly_combine() { local out="$1" dir="$2"; shift 2; : > "$out"; local f; for f in "$@"; do cat "$dir/$f" >> "$out"; printf '\n' >> "$out"; done; }
