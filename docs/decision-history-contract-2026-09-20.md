# Decision history — the universal correction (2026-09-20)

**Pennhurst is the regression case that exposed the defect. Nothing in this build is
scoped to it.** There is no Pennhurst branch, no Chester County branch, no ZIP 19475
branch and no data-centre branch anywhere in the change: the fix is one shared decision
plane that every one of the 12,722 canonical ZIP pages, the address view and the
`app_projects`-backed surfaces run.

---

## 1. The defect, measured

| measurement | value | control from the same read |
|---|---:|---|
| denial-shaped raw status values across all 239 registry entries | **294** | emitting buckets carry 681 proposed / 425 approved / 299 operating |
| …of those, in the `exclude` bucket | **294 of 294** | — |
| …of those, in any bucket that EMITS a record | **0** | — |
| `app_projects` development rows with status `Decided` | **0** | 3,000,229 development rows; Operating 1,378,872 · Approved 1,264,479 · Proposed 356,873 · Active 5 |
| `development_reports` sites carrying `decided` (299-ZIP sample) | **0** | 277 area sites, 48,342 sites read across 299 ZIPs |

`exclude` means `continue` in all five connectors. So a genuine proposal a government body
**denied** was not mislabelled — it was **deleted**. The decision plane was empty
everywhere, in the data and in the config alike.

⚠️ **The `Decided` receiver already existed and had never fired.** `public.app_refresh_zip`
has long written `status = 'Decided'` for a site carrying `decided:true`, and
`bluesky/lib/maps-eligibility.mjs` has long refused a status outside `{Proposed, Approved}`.
Both were correct and both were waiting for a signal no connector ever sent. That is why
the social-claims protection needed **no DDL** — see §6.

---

## 2. The contract, as four separations

`supabase/functions/get-address-report/sources/decision.ts` is the one authority.

1. **Browsing category** — `browsingBucketFor()` returns `proposed` for every outcome. A
   denied application is a *historical proposal*: still discoverable where a resident looks,
   never deleted, never relabelled "Canceled", never promoted to Approved. An appeal is a
   *subsequent event*, never an approval.
2. **Decision + history** — `decisionFor()` builds a notation from what the row already
   proves: the publisher's own status word verbatim, its own `decision_date` column, and
   the official record URL the anti-fabrication gate already required. `decided_on` is
   **null** when the source states no date, and the sentence says so.
3. **Current-status verification** — `decisionEvidenceLevel()` / `currentStatusLine()`.
4. **Eligibility** — `isActiveUndecided()`, the one predicate behind every active-proposal
   count, upcoming-decision list, notification and social claim.

**A denied proposal is in the Proposed rail and out of every active count. That gap between
(1) and (4) is the feature.**

### The rule that is easiest to get wrong

**A recent fetch is not proof of a recent decision check.** `refreshed_at` says when we
re-read the publisher's dataset. It says nothing about whether the publisher re-checked the
application, and nothing at all when the dataset has no decision column.
`currentStatusLine()` therefore reads **no clock and no freshness field**, and
`test/decision-history-contract.test.mjs` pins that structurally — a sentence assertion
alone would survive a future edit that started consulting one.

---

## 3. Vocabulary, and what is deliberately excluded

`denied` · `withdrawn`. Each names its actor, because "the body refused it" and "the
applicant pulled it" are different facts and collapsing them is a mislabel in both
directions.

⛔ **Not members: expired · void · cancelled · closed · revoked · tabled.** Those are
administrative lapses, not rulings on the merits. Surfacing them under a decision heading
would assert a ruling nobody made — the same fabrication, reached from the other side.
Adding a member is a founder decision.

---

## 4. Registry enablement — computed, never transcribed

`scripts/enable-decision-buckets.mjs` (claims rule 7 — never hand-reflow a list into a
change). Report-only by default.

```
registry entries read           240
exclude values read (control)   499
entries changed                 53
values moved -> denied          62
values moved -> withdrawn       39
decision-shaped but REFUSED     9   (left in exclude — unchanged behaviour)
moved fingerprint (md5)         2165d90e02bfe05652385c48234c47b4
refused fingerprint (md5)       489cb3d02630ed3578c7d0cbc94df39a
```

Verified against the pre-change file, not eyeballed: **1,907 (entry, status) pairs before
and after · 0 lost · 0 invented · exactly 101 moved · 0 values in two buckets of one
entry.** The file is re-serialised with non-ASCII escaped exactly as the committed file
already does it, so the diff is the 101 values and nothing else — a naive
`JSON.stringify` rewrites 314 unrelated lines (measured) and buries the change.

### The 9 refusals are the honest residual

Ambiguity keeps the pre-existing behaviour and never becomes an asserted outcome:

| value | why it stays excluded |
|---|---|
| `Denied or Expired` · `Placed on File or Denied` | the source states **alternatives**; we cannot tell which happened |
| `ESTIMATED Rejected` · `ESTIMATED Withdrawn` | the publisher itself marks the value an **estimate** |
| `VOIDED - Applicant Withdrew Permit` | leads with an administrative nullification |
| `WITHDRAWN BY COUNTY` | withdrawn by someone other than the applicant — the label would name the wrong actor |
| `Amendment Denied` · `Reconsideration Denied` | a **sub-proceeding** was decided, not necessarily the application |
| `Dept Disapproval` | one department's internal review, not the body's decision |

🔑 **The classifier establishes CANDIDACY before it asks about ambiguity, and the first
draft had that order backwards.** Running the ambiguity rules first made every ordinary
`"Void"` status — never a candidate — report as "decision-shaped but REFUSED". The residual
printed **52** when it was **6**: the instrument's own noise was 88% of its finding, and
that printed number is exactly the one a reader would have quoted as the coverage gap.

---

## 5. What "universal" means here — three separately measured outcomes

### (a) Shared decision-history support across all pages and surfaces

One authority (`sources/decision.ts`), consumed by all five connectors, the engine's
area-notice path, and — through `lib/map.js` — Map 1's 2D/3D/satellite popups and rails,
the community page, `lib/templates.js`, `lib/impact.js` and the N5 radius map. No
jurisdiction, ZIP or project type appears anywhere in it.

⚠️ **`lib/map.js` is a SECOND copy of one contract, and that is pinned rather than
tolerated.** The engine authority is TypeScript the browser cannot import.
`test/decision-vocabulary-parity.test.mjs` loads both and **drives** them over the same
inputs — the vocabulary, the labels, the evidence levels, `sourceCanReportDenial` over
every level plus junk, `isActiveUndecided` over 16 row shapes, and every sentence over 20
combinations. It also asserts the fixture set genuinely splits, so agreement cannot be
vacuous.

**That gate earned its place immediately — it found two real defects before they shipped:**

- **`type` means two different things.** On a connector record it is the lifecycle
  (`"proposed"`); on a marker item from `HS.trackerSiteItem` it is the project category
  (`"Data center"`), with the lifecycle in `lifecycleBucket`/`status`. Reading `type` first
  asked "is a data centre a proposal?" and reported **every live marker as not-active**.
  Precedence is now `bucket → lifecycleBucket → status → type`.
- **Validated vs. present.** The page refused a decision only if it was *renderable*
  (sourced, known outcome); the engine refused on any decision object. A malformed decision
  therefore counted as a live proposal on the page. The page now fails closed like the
  engine — validation is for refusing to *render* an unsourced notation, which is a
  different job.

### (b) Shared protection against unsupported current-status claims

Including — especially — where decision evidence is unavailable. Every record carries its
source's `decision_evidence` level, and `currentStatusLine()` has three branches and no
clock:

| case | what a surface may say |
|---|---|
| a recorded decision | `Denied on the record · Any later appeal or re-filing is not verified.` |
| no decision, source **can** report one | `Application on file · No decision recorded by this source · Current decision status not verified.` |
| no decision, source **cannot** | `Application on file · Current decision status not verified.` |

⚠️ **`date_only` is grouped with `none`, not with `decision`.** A decision-date column says
*when* something was decided, never *that* it was refused. Reading it as denial coverage is
the substitution this whole unit removes. **35 of 240 sources** are in that state.

Two forward-looking surfaces were corrected rather than qualified, because a qualification
underneath a future-tense sentence does not cancel it:

- `lib/impact.js` told a resident **"If approved, nearby homeowners could see added
  pressure on traffic once construction begins"** — and a decided record matched *none* of
  its branches, so it fell through to the generic *"if this project moves ahead"*, the
  worst of them because it sounds measured. A decided application now gets a past-tense
  sentence that asserts no outcome.
- Map 1's Proposed rail sub-line read **"Hearings and notices you can still weigh in on"**
  — an active claim over every row. It now states what the category means, and discloses
  that it includes historical proposals **only when it actually holds one**.

### (c) Measured decision-evidence coverage, by source and by application

`scripts/measure-decision-evidence-coverage.mjs`; dated output in
`docs/decision-evidence-coverage-2026-09-20.json`.

```
registry entries                240
CAN report a refusal             53
CANNOT report a refusal         187
by evidence level               {"decision":53,"none":152,"date_only":35}
```

⛔ **Shared code coverage is not knowledge of every municipality.** Every page runs the
plane — that is (a), and it is a fact about the *code*. Whether Chester County's layer can
tell us a conditional-use application was denied is a different question with a different
answer, and this is it.

**The Pennhurst case, measured:** `chester-county-pa-act247-plans` has **no status column
at all** — every record is the constant `"Submitted for county review"`. It is structurally
incapable of ever reporting a refusal, so it is one of the 187, and every Chester County
record reads the honest qualification. Pennsylvania overall: **1 of 11 sources** can report
a refusal.

**Application-level coverage is deliberately NOT estimated from source coverage.** A source
that *can* report a refusal has not necessarily reported one; presenting capability as
incidence is the same error as presenting code coverage as knowledge. The script prints
`NOT MEASURED` there rather than a number, because a zero and an unrun query are otherwise
indistinguishable.

---

## 6. Why there is no DDL, and what is parked

`app_projects.status = 'Decided'` flows through the materializer's existing branch the
moment a connector stamps `decided`, and the social gate already refuses it. So the
protection lands with no migration.

What `Decided` cannot say is *which* decision, *when*, and *where the record is*. Those
reach a resident today only on Map 1, which reads `development_reports` directly.
`lib/templates.js::browsingStatusLabel` therefore renders `Proposed · decided` on
`app_projects`-backed cards and **refuses to name an outcome** — reading "denied" out of
"decided" would invent the fact this build exists to source.

`docs/decision-provenance-migration.sql` closes that gap by carrying the decision object
into the provenance jsonb the materializer already builds (no new column). It is
**executable, spliced from the live function body, fail-closed on its anchor, idempotent,
and NOT APPLIED** — applying it is separately gated.

---

## 7. Tests, and their mutation receipts

| file | what it pins |
|---|---|
| `test/decision-history-contract.test.mjs` | all four separations; the registry actually carries decisions; the Chester County case by name (51 checks) |
| `test/decision-vocabulary-parity.test.mjs` | engine ↔ page agreement, driven not asserted; `statusTier` may never read a decision (29 checks) |
| `test/decision-connector-emission.test.ts` | the defect end-to-end through the **shipped** `sources/arcgis.ts` (23 checks) |
| `test/decision-page-surfaces.test.mjs` | the notation reaches popup, rail, counter, marker title, and the four other surfaces (24 checks) |
| `homesignal-ingest/tests/test_maps_decided_not_postable.mjs` | the social gate, over all four routes a decision arrives by |

**Proven load-bearing by mutation, measured on EXIT CODE — 10 mutations, 10 killed, clean
baseline 0/4 before and after:** denied browsing as Approved · an undated denial getting a
substituted date · an unsupported "still pending" claim · `date_only` counted as denial
coverage · `isActiveUndecided` no longer refusing a decision · the page vocabulary drifting
· `statusTier` re-bucketing a denied record · the connector dropping denied rows again ·
the registry reverting · `impact.js` resuming its forward-looking claim.

The ingest gate carries its own mutation in-suite: it **adds `Decided` to
`ELIGIBLE_STATUS`** and asserts the row is still refused, so the refusal survives a future
widening of the allowlist.

---

## 8. Not done here — separately gated

- **Edge-function deploy** of `get-address-report`. Until it ships, no production report
  carries a `decision`.
- **Production backfill** — a report gains a decision only when its ZIP is refreshed.
- **`docs/decision-provenance-migration.sql`** — parked, see §6.
- Widening the outcome vocabulary beyond `denied` / `withdrawn` (§3).
- The 9 ambiguous values (§4) — each needs a publisher-specific answer, not a looser rule.
