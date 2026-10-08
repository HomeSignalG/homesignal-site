# Source clearance — evidence record (TEMPLATE)

Copy this file to `docs/source-clearance-<publisher>-<YYYY-MM-DD>.md` when a publisher **answers in writing**, fill in every line
from the answer itself, and only then add the source to `supabase/functions/_shared/report-rights.json`. **A drafted request is not a
pending one, and silence is not consent** (`docs/corporate-output-utah-clearance-2026-10-02.md` §5). `test/report-rights-evidence.test.mjs`
refuses a registry entry whose evidence record is missing, is not a section of that file, does not name the source, or leaves any
line below empty.

The registry line that points here (one per `registry_id`, never a wildcard):

```json
{ "registry_id": "<exactly as app_projects.registry_id spells it>", "cleared_on": "YYYY-MM-DD", "audit_ref": "docs/source-clearance-<publisher>-<YYYY-MM-DD>.md §1", "attribution": "<the credit line the publisher requires, or an empty string>" }
```

## 1. Evidence record — <registry_id>

**Source (registry_id):** `<registry_id>` — one record per registry id; name every id the answer covers on its own line.

**Answered by:** <full name>, <role>, <organisation>

**Date and channel:** <YYYY-MM-DD>, <email / letter / call> — <where the original is kept>

**Verbatim grant:**

> <paste the publisher's own words. Not a summary. If the answer is a refusal, paste that and do NOT add a registry entry.>

**Covers:** <which datasets or layers are named; whether storing records in a delivered report is included; whether keeping a history of what was published is included; whether sharing by private link, print or PDF is included; whether a daily check that emails the customer is included; any term, fee or revocation right>

**Attribution:** <the exact credit line required, or "none required">

**Reconciliation:** <where the publisher's own posted terms say something different, how the two are squared; or "the posted terms say nothing different">

## What this record does not do

It clears only what **Covers** says. Anything not named there stays a HOLD (founder ruling R4). If the publisher later withdraws the
grant, remove the registry line the same day and record the withdrawal here with its date.
