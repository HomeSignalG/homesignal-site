#!/usr/bin/env bash
# Refuse a CI push that would leave an open pull request with no checks.
#
# WHY. A push made with the workflow's GITHUB_TOKEN does not start other workflows. When a
# job commits to a branch that already has an open PR, that bot commit becomes the PR's
# head and none of the PR's checks run on it; the PR page then reads "pending" and looks
# like slow CI, not CI that will never start. It happened on #407 (CLAUDE.md, "A BOT-PUSHED
# HEAD MEANS CI NEVER RAN") and again on #714 on 2026-10-19, where the arming builder's
# report-only receipts refresh became the head of an open PR and 0 check runs appeared.
# Each time it was caught by a person noticing, after the fact. This makes it a refusal.
#
# WHAT. Exit 0 when the push is safe: the target is main (no PR has main as its head), or
# no open PR has this branch as its head. Exit 3 when an open PR does: the job must not
# push there (ci_commit_and_push.sh lands on its per-run fallback branch instead). Exit 4
# for the same refusal when the run was itself started by a push (GITHUB_EVENT_NAME=push):
# the author's own push to the PR started it, its output is in the run's artifact, and a
# red check would block the very PR the guard protects, so the calling step ends green with
# a warning. Exit 1 when the check itself fails: not knowing is unsafe, never "no PR".
#
# Workflow call shape (pinned by tests/test_bot_push_guard.py):
#   GH_TOKEN=... bash .../guard_bot_push.sh <ref> || { [ $? -eq 4 ] && exit 0; exit 1; }
#
# Usage:  GH_TOKEN=<token> scripts/guard_bot_push.sh <branch>   (copy of homesignal-ingest scripts/guard_bot_push.sh)
#         (GITHUB_REPOSITORY is set by Actions; the default token can read pull requests
#          only if the workflow grants `pull-requests: read`.)
set -uo pipefail

branch="${1:-${GITHUB_REF_NAME:-}}"
if [ -z "$branch" ]; then
  echo "::error::guard_bot_push: no branch given"
  exit 1
fi
if [ "$branch" = "main" ]; then
  exit 0
fi
repo="${GITHUB_REPOSITORY:-}"
if [ -z "$repo" ] || [ -z "${GH_TOKEN:-}" ]; then
  echo "::error::guard_bot_push: GITHUB_REPOSITORY or GH_TOKEN is not set, so the open-PR check cannot run; not pushing to '$branch'"
  exit 1
fi
owner="${repo%%/*}"

body=$(curl -fsS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$repo/pulls?state=open&per_page=10&head=$owner:$branch")
if [ $? -ne 0 ]; then
  echo "::error::guard_bot_push: could not ask GitHub whether '$branch' has an open PR; not pushing there"
  exit 1
fi

prs=$(printf '%s' "$body" | python3 -c 'import json,sys
d=json.load(sys.stdin)
if not isinstance(d, list): sys.exit(2)
print(" ".join("#%s" % p.get("number") for p in d))')
if [ $? -ne 0 ]; then
  echo "::error::guard_bot_push: unexpected answer from GitHub for '$branch'; not pushing there"
  exit 1
fi

if [ -n "$prs" ]; then
  echo "::notice::'$branch' is the head of open PR $prs. A push from this job would become that PR's head commit, and none of its checks would run on it. Not pushing there."
  echo "To land this job's output: run it on a branch with no open PR (or after the PR merges), or push the change yourself."
  if [ "${GITHUB_EVENT_NAME:-}" = "push" ]; then
    echo "::warning::This run was started by a push to '$branch'; its output is in the run's artifact and nothing was pushed."
    exit 4
  fi
  exit 3
fi
echo "guard_bot_push: no open PR on '$branch'; pushing is safe"
exit 0
