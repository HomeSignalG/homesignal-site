# Government Source Archive — site-side pointer

The archive itself lives in **`homesignal-ingest`**. This file exists so a session working in
`homesignal-site` finds it instead of building a second one.

| | |
|---|---|
| Schema (Supabase) | `homesignal-ingest/supabase/migrations/20260812200000_government_source_archive.sql` |
| Ingestion framework | `homesignal-ingest/gov_archive/` |
| **The contract every new source must follow** | `homesignal-ingest/docs/government-source-integration-contract.md` |
| Admin surface (this repo) | `gov-archive.html` |
| Admin contract test (this repo) | `test/gov-archive-admin.test.mjs` |

---

## What it is

Preservation of authoritative public government evidence, independent of whether the agency's URL
still works later. Six layers, deliberately not collapsed:

```
Acquisition Log      acquisition_runs / acquisition_errors     what WE DID
Source Archive       Storage: government-source-archive        the ARTIFACT
Source Document      source_documents                          its PROVENANCE
Structured Record    gov_actions                               the FACTS
Entity Resolution    gov_subjects / gov_subject_resolutions    WHOM it concerns
Entity Track Record  the Property Card                         the PRESENTATION
```

Storage key: `{agency}/{program}/{year}/{source_record_id}/{sha256}.{extension}`. The filename is
the **hash**, never the agency's own filename — agencies serve `order.pdf` for thousands of
unrelated matters.

---

## The two things a site session most needs to know

**1. `gov-archive.html` is internal.** Allowlisted via `dashboard_admins`, `noindex`, disallowed in
`robots.txt`, absent from `partials/shell.html`. Every read goes through a `gov_archive_*` SECURITY
DEFINER RPC; **no archive table has a grant for `anon` or `authenticated`**, so there is no direct
read to accidentally enable. Do not link it from resident navigation and do not expose raw archive
browsing publicly.

**2. It is the INGESTION layer, not the Property Card layer.** `gov_actions` is the full-fidelity
government record; the Entity Track Record module renders a projection of it. They are separate on
purpose — §1 of the archive brief forbids collapsing them, and the Property Card work was on an
unmerged branch when the archive was built, so the archive deliberately has no dependency on it.

When the Property Card's Entity Track Record work lands, the join is a projection and no new
architecture:

| Archive | Property Card |
|---|---|
| `gov_actions` | the enforcement record rendered in Entity Track Record |
| `source_registry.card_agency_id` | the agency badge (`HS.card.AGENCIES[].id`) |
| `gov_subject_resolutions` where `verification='verified'` | `matched_entity_id` |
| `source_documents.original_url` | "View original government source" |
| `source_documents.archive_storage_key` | "View HomeSignal archived copy" |

**The attribution rule survives that join unchanged.** A `gov_action` belongs to
`gov_actions.named_entity` — the entity the government document named. A verified subsidiary of that
entity did not commit it, and an unverified relationship carries it nowhere. `v_gov_action_attribution`
joins **verified resolutions only**; read attribution through that view.

---

## Statuses: what a disappearance may and may not mean

A record vanishing from a government website means the **website** changed.

- `REMOVED_FROM_SOURCE` / `SOURCE_UNAVAILABLE` — **may** be inferred from an absence.
- `SUPERSEDED` / `VACATED` / `RESCINDED` — **require an affirmative government document**, and the
  database raises if one is set without naming it.

Do not write UI copy that lets the first read as the second.

---

## Do not

- Build a second archive, acquisition log, storage bucket, key layout or entity model.
- Add a Property Card module for a specific agency. FinCEN is a **source**, not a module.
- Put a service-role key in a browser. Privileged writes are server-side, always.
- Render `$0` for a penalty the record does not state, or `0` for a source nobody has run.
