# MAPS Data Center Theme — the draft population, and why 64165 cannot be captured

**Read-only investigation. Nothing was written to any row, no draft was approved, no capture
was dispatched, no migration was applied.** Every figure below comes from `db-sql.yml` runs
against production, with the run id and its controls stated beside it.

## 0. What this corrects — my own framing

I reported this population, in session, as **"20 of 26 Data Center drafts blocked on missing
screenshots"** and as **"a queue-drain rate problem — the next capture run should clear
them."** Both halves are wrong, and the second is wrong in the reassuring direction: it
predicts the number falling on its own, which is exactly the reading that stops anyone
looking. That framing was never in the repo; this file is where it gets corrected, so a
future session inherits the measurement instead of the claim.

## 1. The population, measured

Run [35632866150](https://github.com/HomeSignalG/homesignal-site/actions/runs/35632866150),
`HTTP 201`. **Controls: MAPS drafts total 55 · MAPS rows NOT `draft` 0** (so every statement
here is about drafts, and that is measured rather than assumed).

| Data Center Theme drafts (`evidence.theme = 'datacenter'`) | 26 |
|---|---:|
| …with an image (`visual.state = REAL_MAP_VISUAL`) | **7** |
| ……of those 7, carrying `capture_policy` | 4 |
| …no image, **ABSENCE post** (no `evidence.project_id`) | **18** |
| …no image, **PROJECT-BACKED** | **1** — ZIP 64165 |

**7 + 18 + 1 = 26, exact.** Second control: non-DC MAPS drafts **29**, and 26 + 29 = 55.
`visual.state` on the 19 imageless rows is `CAPTURE_INELIGIBLE ×19`; on the 7 imaged rows
`REAL_MAP_VISUAL ×7`.

## 2. Why "blocked" was the wrong word for 18 of the 19

1. **They are absence posts, and #1263 exempts an absence post from the mandatory-image
   gate.** Such a post describes no project, so there is nothing to photograph and no image
   is owed. They are approvable now. Calling them blocked invents a blocker and hides that
   they are waiting on a human, not on a job.
2. **It is not a drain rate.** All 19 carry `CAPTURE_INELIGIBLE` — a refusal **recorded on
   the row**, not a queue position not yet reached. `scripts/maps-social-image.mjs` returns
   exactly that at its first gate (*"the draft carries no project_id, so there is nothing to
   photograph"*), every time, so the count cannot fall with more runs. **A drain reading
   predicts the number decreasing; the measured state predicts it never does.** The two are
   distinguishable by reading `visual.state`, and I did not distinguish them.

## 3. Reconciling absence posts 2 → 18 (Rule #0a — named, not absorbed)

`docs/maps-dc-capture-policy-2026-09-21.md` §3 records **`absence posts (unaffected) | 2`**,
measured earlier the same day. It was right when taken. Measured cause of the delta, by
creation date:

```
2026-09-20:  absence  2 / project-backed 7
2026-09-21:  absence 16 / project-backed 1
```

**16 absence posts were created today**, between 2026-09-20 18:08:39Z and 2026-09-21
14:56:50Z, across **18 distinct ZIPs for 18 rows** — one per ZIP, no duplication. The §3
table is left exactly as taken; only this reading is newer.

📌 **OPEN, deliberately not closed by guess: project-backed DC drafts read 8 here and that
doc's merge-time re-measure read 9.** Two candidate causes and I have evidence for neither:
that re-measure may have counted on a different field (the `source_id` column rather than
`evidence.project_id` — a trap this repo's own Supabase section records me falling into), or
a project-backed row may have gone in today's orphan archive-and-delete. **Do not quote
either as the cause.**

## 4. ZIP 64165 — the one project-backed imageless draft

Its refusal, read verbatim off `evidence.visual` rather than recalled:

```
state           CAPTURE_INELIGIBLE
status          NO_PROJECT_SPECIFIC_VISUAL
attempts        0
failure_reason  the project is not in the ZIP's authoritative development set (30 markers there)
next_attempt_at 2026-09-21T20:47:58.165Z
```

Project `70c74c56-cb9e-4925-bf48-43f7650f5d3b`, source key
`arcgis:kcmo-development-cases:CD-CPC-2026-00142`, `record_kind` `development`,
`Development / Proposed`, lat/lng `39.3201689806401,-94.5762390223065`, `source_ref` not
null, `app_projects.zip` = **64165**.

**It is not a missing record URL and not the residential gate.** Measured (runs
[35633134277](https://github.com/HomeSignalG/homesignal-site/actions/runs/35633134277),
[35633456010](https://github.com/HomeSignalG/homesignal-site/actions/runs/35633456010),
[35633610846](https://github.com/HomeSignalG/homesignal-site/actions/runs/35633610846)):

- ZIP 64165's geography **is** established — `status boundary_complete`, `mode
  authoritative`, **29 projects / 30 markers**.
- The project is absent from **both** `projects[]` and `markers[]`, and from
  `geo.zip_authoritative_membership` **under every `zcta5`**.
- **Controls that make that absence readable rather than a wrong-key zero:** a named sibling
  (`CD-CPC-2026-00097`) *is* in membership under `64165/development`; **13**
  `kcmo-development-cases` refs are in this ZIP's set; **0** of its `projects[]` entries have
  a null `source_ref`; membership holds **901,465 rows across 7,996 ZCTAs**.

### The 117-vs-29 gap, and which half of it is a defect

`app_projects` places **117** development rows (**116** distinct source keys — one key
appears twice) in ZIP 64165; the authoritative membership holds **29**.

- **84 of the absent rows are in membership under a NEIGHBOURING ZCTA** — 64155 ×68,
  64164 ×9, 64156 ×8, 64154 ×5, 64166 ×2. **This is not a defect.** `app_projects.zip` is a
  source-stated value; membership is computed from real ZCTA geography, and `FIX 29` in
  `lib/zip-authoritative.js` exists precisely because proximity and a stated ZIP are not
  membership. The authoritative set reassigning them is the invariant working.
- **5 are in no membership row anywhere — and 5 of 5 were created AFTER that ZIP's
  membership was computed (2026-09-04 18:57:04Z); 0 before.** Named:
  `CD-CPC-2026-00142` (this draft's project) and `CD-CPC-2026-00128` @ 2026-09-15,
  `CLD-FnPlat-2026-00004`, `CLD-FnPlat-2026-00001`, `CLD-FnPlat-2023-00028` @ 2026-09-19.
  The 0-before is what makes this a mechanism rather than a correlation.

## 5. The cause is the serving generation's watermark — ALREADY OWNED, NOT A NEW FINDING

⚖️ **Concurrency verdict (CLAUDE.md concurrency check): ALREADY IMPLEMENTED. Nothing about
generation currency is recorded here as new work, and no competing record of it was
written.** `#1275` (merged `4e7e402`, earlier the same day) owns the N5 geography generation
lifecycle and states the condition in its own terms: the generation serving production is
`ACTIVE_LEGACY` — *"the generation that is serving production TODAY, which predates this
contract and was never gate-proven"* — with **`CURRENT = NO`, watermark 2026-09-01
13:39:55Z, 20.13 days**. My consumer-side measurement corroborates it and adds nothing to it.

🔑 **AND IT CORRECTS MY OWN INSTRUMENT.** I measured the WRITE clock — every
`maps_zip_geography_status.completed_at` falls in 2026-09-03 → 09-05, all 12,719 rows on one
`generation_id` (`legacy-phase1-2026-09-01`) — and called the staleness ~16 days.
`docs/n5-generation-contract.sql` says in as many words why that is the wrong field:
*"`cutoff` is the SOURCE WATERMARK … Freshness is `now() - cutoff`, NEVER `now() -
computed_at` — the phase1 generation wrote rows on 2026-09-05 carrying data as of
2026-09-01, so the write clock understated staleness by 4.3 days."* **The repo already named
the exact error I then made.** Quote the cutoff, never `completed_at`.

**Consequence for this draft, stated plainly:** 64165 retries at 20:47:58Z and will refuse
again, and would keep refusing indefinitely, because the blocker is upstream in `geo` and no
retry from the capture path can clear it. The unblock is a newer generation reaching `ACTIVE`,
which `n5_generation_activate()` makes dispatch-only, and #1275 records
`CONSUMER_CUTOVER_AUTHORIZED = NO`. **So this draft is correctly stuck, its fallback is
honest (the external link card, explicitly *"NOT a project-specific map preview"*), and
nothing in the capture path should be changed to chase it.**

## 6. What I did NOT measure

⛔ **The national count of development records ingested after their ZIP's generation cutoff,
and therefore absent from Map 1's ZIP mode, is NOT MEASURED.** It needs a join across
`app_projects`' ~3M rows, and CLAUDE.md §5 is explicit that these are not free reads — one
careless fan-out already took residents' pages down once. **Do not estimate it by scaling the
5-in-one-ZIP figure**: 64165 is one ZIP chosen because a draft pointed at it, not a sample.

## 7. Two instrument notes, because both cost real time

- ⚠️ **GitHub's job-status API served stale state repeatedly.** A run that had completed at
  17:35:12Z still read `in_progress` on three subsequent polls. I reported one query as
  *"running 5.5 minutes"* and cancelled it on that reading; it had in fact run **85 seconds**.
  **The log becoming fetchable is the reliable completion signal; the job's `status` field is
  not.** Cancelling a dispatch also abandons only the HTTP request — it does not cancel the
  server-side query.
- ⚠️ **A CTE wrapping an expensive function must be `as materialized`.** Referencing the
  `app_zip_projects_markers` CTE four times let Postgres inline it, so the RPC ran four times
  (85s). The same query with `as materialized` ran in **7 seconds**.
