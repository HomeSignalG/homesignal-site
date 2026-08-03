# Maps / ingest go-live governance

**Binding.** Ported from the founder's workbook `0070Maps IngestFeedInventory.xlsx`
Instructions tab (rows 331–344, 346–362, 379–394) so no session depends on an upload being
present. Every item here cost a correction cycle at least once; none of it was written down,
so each new session rediscovered it the expensive way.

**Division of record.** This doc holds the **durable rules**. `QUEUE.md` at repo root holds
**in-flight work** — items, states, gates, dependencies. The workbook remains the founder's
**per-ZIP and per-source measured record** (the `ZIP Code Pages` and `Best_Source_Assignments`
tabs), plus settled outcomes and worked examples. Do not mirror queue items into the workbook:
two queues drift, which is the exact problem `QUEUE.md` exists to end.

Record a finding as established, never while it is still a hypothesis. Writing an unverified
suspicion into the governance record is the failure this whole rule set exists to prevent.

---

## 1. The goal — all states live

**12,722 ZIP pages across 50 states.** LIVE means every ZIP page in the state is modelled,
served, and honest — **not** that every capability is populated.

Live today: **NV 158 · TX 668 · UT 310 = 1,136 pages.** **8,215 remain** — 5,647 across 34
partial states, 2,568 across 13 untouched.

> The remaining count and the total do not sum to 12,722. That is correct: the difference is
> pages already modelled inside the 34 partial states. "Remaining" counts pages left to model,
> not pages in unfinished states.

### LIVE is not COVERED — keep them separate

**Texas is the worked example and the warning: 668/668 pages live, and ZERO
`government_notice` sources across all 22 counties.** A state can be fully live and still have
a whole capability empty.

**When reporting a state, always state both: pages live, and per-capability coverage.** Never
let "live" imply "covered" — that is the same conflation that produced the hardcoded
`app_community_meta.covered` defect.

---

## 2. State completion order — tiers

**Principle: FINISH BEFORE STARTING.** A state at 74% converts to COMPLETE far cheaper than a
state at 0%, and **states-completed is the metric that matters.** This ordering optimizes for
states completed, **not** raw pages added — if the goal changes to maximum page count, NY and
PA move to the top and Tier 1 drops.

Editorial overlay is the data-centre investigative thread (Stratos/Box Elder UT and
Stargate/Abilene TX are already live; Colossus/Memphis TN is not).

| Tier | Contents |
|---|---|
| **Tier 0 — close out live states first** | TX `government_notice` (668 pages, 22 counties, zero sources wired, unscoped ingest build) and the Harris/Bexar expansion (**GATED** — moves the coverage claim). Texas is publicly live with a structural hole; fixing a live state beats widening to a new one. **NV and UT are complete.** |
| **Tier 1 — closeout, ≥55% done, 629 pages, converts SIX states** | Cheapest first: **DE 22** (68%) · **CO 37** (74%) · **OR 89** (56%) · **WA 105** (71%) · **AZ 148** (59%) · **CA 228** (56%). DE is a single session. AZ carries editorial weight (Phoenix data-centre corridor). |
| **Tier 2 — editorial priority + strong base, 40–54%** | **TN 105** (47%) **FIRST** — Memphis / xAI Colossus, the live investigative thread. Then **VA 107** (42%) — Loudoun County, the largest data-centre concentration on earth. Then **OH 178** (47%) — Columbus corridor. Then by cost: NC 85 · MN 99 · MD 165 · MI 177. |
| **Tier 3 — high volume, mid completion** | IL 258 (46%) · **NY 447** (41%) — the single largest prize at 764 total pages. |
| **Tier 4 — mid-low, 25–39%, 1,256 pages** | KY 77 · MT 85 · AR 109 · GA 127 (Atlanta data-centre corridor) · LA 129 · KS 141 · MO 193 · PA 395. |
| **Tier 5 — early stage, <25%, 2,141 pages** | SD 104 · MS 104 · ID 100 · WY 91 · NE 133 · NM 133 · SC 167 · AL 239 · CT 228 · FL 361 · MA 481. **FL and MA are large and early — treat each as its own project, not as closeout work.** |
| **Tier 6 — untouched, 2,568 pages across 13 states** | Cost ascending: RI 81 · HI 97 · AK 101 · ND 155 · OK 197 · IN 198 · WI 211 · WV 212 · VT 212 · IA 225 · NH 247 · ME 273 · NJ 359. NJ is the biggest and densest. |

**Constraints on any new state:** bidirectional coverage gating · no coverage claim without
official public records · honest-empty pages render clean and noindexed · no hand-authored data
in real data paths. ⛔ **LAUNCHING A NEW STATE IS GATED — ask first.**

---

## 3. State go-live playbook — run it in this order

### Phase 1 — Inventory before touching anything
Enumerate the state's ZIPs, counties, and which already have a modelled page. **Record the
starting numbers so the delta is measurable later — capture the baseline BEFORE mutating
anything.** Report: total ZIPs, modelled today, per-county breakdown, and which counties have
any wired source at all.

### Phase 2 — Source discovery, per county and major city
Use the three-state verdict system: `first_party_found` · `verification_blocked` ·
`candidates_exhausted`. ⛔ **`aggregator_locked` is RESERVED FOR HUMAN REVIEW — never assign it
autonomously.**

Prefer first-party government endpoints (Socrata, ArcGIS, CKAN, Carto, CSV). **No
hand-authored data in any real data path, ever.** A county with no first-party source is a
legitimate `candidates_exhausted` outcome, **not a failure** — record it and move on.

### Phase 3 — Registry entry construction
Every status and type key **byte-verified against the live endpoint in the connector's own
scope** (Rule 13: same `extra_where`, same `recency_days`, same field).

**Two-stage probe:** `groupBy` to screen, `returnDistinctValues` to confirm verbatim, because
`groupBy` case-folds.

**Copy strings from the response, never retype** — three defects in one week were invisible
whitespace (Arlington double space, Gilbert double space, New Orleans trailing space).

Classify each type field **before** promising completeness: bounded domain = completable · free
text = **NOT** completable · null-dominant = data absence. **Never substitute a semantically
different column to hit a number.**

### Phase 4 — Wire, dry-run, and measure
Run the full suite plus the golden regression guard before any merge. State acceptance criteria
as numbers before/after, per entry.

**Report PAGE-level deltas, not record-level.** A native ZIP column lands one record on one
page; a spatial radius entry fans one record across every page in range; a `zip_where_template`
entry lands only if the address string matches a modelled ZIP.

**An entry emitting 0 because the county has few modelled ZIPs is coverage-limited and
HONEST — do not widen scope to manufacture records.**

### Phase 5 — Coverage gating and honest empties
Bidirectional coverage gating. No coverage claim without official public records. Honest-empty
pages render clean and are noindexed.

**Coverage fields must be DERIVED from actual feed wiring, never hardcoded** — the
`feed_coverage_check` materialised table exists because `app_community_meta.covered` and
`data_quality` were once constants, making real coverage a small fraction of what the pages
claimed.

### Phase 6 — Verification before the state is claimed live
The Michigan closeout is the template: sitemap drain · page rendering · zero-claims check ·
fail-closed guard. Add a Task 5 invariant on a sample of pages: every
`counts.{proposed,approved,operating,facilities}` equals its array length · 0 missing
`record_url` · 0 point sites missing coordinates.

**Measure on POST-DEPLOY rows** — force the affected ZIPs through the deployed engine rather
than reading cache, because **a pre-deploy cache row looks exactly like a successful
verification.**

### Phase 7 — The founder gate
**Everything in Phases 1–6 is the WORK and is autonomous. The gate is the CLAIM:** publishing
the state to the sitemap, changing the coverage claim, or reporting the state as live.

Stop there and report: **pages modelled vs total · per-capability coverage · per-county source
verdicts · what renders honest-empty and why.** The founder decides whether it ships.

**Report once per state at the Phase 7 gate, not per phase.**

---

## 4. Autonomy envelope for state work

**Proceed without approval on:** inventory and enumeration · source discovery and verdict
assignment (**except `aggregator_locked`**) · registry entry construction where every key is
byte-verified and self-describing · connector wiring for an **already-supported** family ·
dry-runs, suites, golden guards · post-deploy measurement · opening, merging and deploying
**registry-only additive** PRs.

**STILL GATED — stop and ask:**
- publishing a state, or changing a coverage claim or the sitemap
- a **NEW connector family** that needs new code
- any **opaque-coded value**
- anything changing **what a resident sees** on a page
- **spending money**
- **deleting** a registry entry or data
- any finding that **contradicts an established fact**

---

## 5. Before claiming any state — accuracy checklist

- Every completeness claim carries a **probe date and the arithmetic**.
- **No claim rounded up from a partial result** — an unobserved entry means the set is not
  verified; say so.
- **Instrument silence is not evidence:** confirm each check actually **RAN**, not merely that
  it did not fail.
- **Provenance fields record what was actually done; "NOT YET ASKED" is valid and required.**
- A finding that overturns an earlier one is stated as an explicit **SUPERSESSION**.
- **Reconcile any number given in an instruction against the artifact** before acting on it.
- **Scope is fixed at authorization;** new findings become new `QUEUE.md` items.

---

## 6. Queue discipline

### The root cause
Most Claude / Claude-Code round trips were **not disagreements about the work** — they were the
work **queue** being retransmitted as prose every turn. Transmitted that way it gets truncated
in transit, contradicted by a newer message, reordered, and re-derived from scratch. Measured
cost in one sequence: two competing orders of operations circulating at once, a dependency
inversion, four lost instruction blocks, two duplicate reports re-run.

**The queue must be a FILE that both sides read and one side writes.**

### `QUEUE.md` — required format
One file at repo root. Ordered list; each item carries: **ID · title · state
(BLOCKED / READY / IN-PROGRESS / DONE) · gate (NONE, or the specific founder decision needed) ·
depends-on (item IDs) · one-line acceptance criterion.**

**Claude Code owns it:** update it in the same PR as the work, or as a standalone commit when
nothing else changes. **It must never drift from reality.**

### `QUEUE.md` — rules of use
- **Re-read it before starting anything.**
- **If a founder instruction conflicts with it, SAY SO AND ASK** — never silently follow the
  newer one.
- Dependencies are explicit; an item can never be ordered before something it modifies.
- **When handed a sequence, reconcile it against `QUEUE.md` and report any conflict BEFORE
  acting.**

> Worked case: a founder sequence placed `status_unresolved` at step 2 and the #428 merge at
> step 4 — but `status_unresolved` modifies code that lives **in** #428, so step 2 depended on
> step 4. `QUEUE.md` would have caught it; prose did not.

### Rule 14 — supersession must be explicit
When a finding is overturned, state it as an explicit supersession — **"SUPERSEDED: X is false,
because Y"** — never imply it by quietly publishing a new conclusion. **Never ask a question
built on a premise your own prior report already overturned;** re-read your last report before
asking.

> Worked case: the source-monitor case-fold guard was re-raised for decision as though
> `returnDistinctValues` were non-authoritative, one turn **after** that premise had been
> disproved by the same agent's Denver findings.

### Rule 15 — verify counts before asserting
**A number appearing in an instruction is not authoritative.** Reconcile it against the artifact
and **report the discrepancy** rather than working around it or silently complying.

> Worked cases: "five fixture renames" was actually **four** (`tdlr-tabs` imports a nonexistent
> module and cannot be renamed into `test/`) and had to be flagged three times · "52 keys" was
> **56** by a different but equally valid count · "203 affected ZIP pages" was **195**,
> introduced by an incorrect correction of a correct number.

### Rule 16 — scope is fixed at authorization
Once a step is authorized, **do not accept incremental additions to it mid-flight** — new
findings become new `QUEUE.md` items, not extensions of work already in progress.

**This rule binds the FOUNDER as much as the agent; Claude Code should push back by naming the
rule when scope is added mid-step.**

> Worked case: "step 2" was authorized as five file renames and grew to nine items across three
> turns (NUL-byte fix, test-name rewrite, two doc-line corrections), turning a ten-minute task
> into a review cycle.

---

## 7. Environment — known blockers and their established workarounds

**Do not rediscover these. Each one cost time at least once.**

| Blocker | Established workaround |
|---|---|
| **Sandbox egress is 403-blocked** | Probe live endpoints **server-side via `pg_net`**, not from the sandbox. |
| ~~**`pg_net` worker stalls** — clear with `net.worker_restart()`~~ | ⛔ **SUPERSEDED 2026-07-30 — see §7.1. There is no stall.** The observed symptom is a ~31% outbound request failure rate. `worker_restart()` was never the mechanism that cleared it. |
| **`pg_net` + a `User-Agent` header ⇒ HTTP 400 from IIS hosts** | **The 400 is OURS, not their WAF.** pg_net serializes a header name IIS rejects: `HTTP Error 400. The request has an invalid header name.` — a **339-byte** body. Proven same-URL, same-second: with a UA → **400**; **no headers → 200** and full valid RSS. **Omit the User-Agent on pg_net probes.** |
| **`pg_net` stores responses as TEXT and truncates at the first NUL** | PDFs (FlateDecode) and xlsx (zip) are **UNREADABLE**. That is an environment limit, **never evidence a document does not exist** — say so explicitly. |
| **`net._http_response` rows get pruned** | Collect results promptly, or re-fire. |
| **Socrata group-by truncates at `$limit`** | A distinct count from a truncated group-by is a **FLOOR** — report it as such. |
| **Large CSVs have embedded newlines inside quoted fields** | Line-splitting is structurally wrong; use an **RFC-4180 parser**. |
| **Workflows pin Node 20**, which does not strip TS types | Shipped `.ts` helpers **cannot** be imported into a workflow script. |
| **`verify-development` has been RED on `main` since 2026-07-25** | **Never host a new gate there.** |
| **Branch protection requires the `unit` check**, and a file outside every workflow path filter can never register it | This deadlocked a `CLAUDE.md`-only PR. **Add the path, and disclose it.** |
| **GitHub merge can return 502 or "405 merge already in progress"** | **Retry** rather than treating it as a content problem. |
| **Actions budget was once set to $0** (stop-usage) and halted every workflow | Before adding or widening any scheduled job, **state the billing impact** and prefer extending `source-monitor`'s existing nightly `0 7 * * *` run. |

### 7.1 SUPERSEDED — "clear a stalled `pg_net` worker with `net.worker_restart()`"

**SUPERSEDED 2026-07-30. The workaround describes a failure mode that does not exist.** It is
recorded here rather than deleted, because the reasoning error is the reusable part.

**What was recorded:** *"`pg_net` worker stalls (seen twice in one session, 263 queued, 15 min
no completions) — clear with `net.worker_restart()`."*

**What was measured** (last 90 minutes of `net._http_response`, 2026-07-30):

```
1,092 OK · 452 HTTP 503 · 30 request timeouts · 5 DNS timeouts
QUEUE DEPTH: 0
```

**~31% of outbound requests are FAILING**, 452 of them 503s from `get-address-report`. The
worker is not stalled and was not stalled. A 90-second timeout per hung request plus a ~29%
503 rate collapses throughput — which, observed from outside, is **indistinguishable from a
wedged worker.** "263 queued, nothing landing in 15 minutes" is exactly what that produces.

**So `worker_restart()` never cleared anything.** The requests finished timing out and the
queue drained on its own; the restart happened to precede the drain. That is also why a second
restart later the same day appeared to "fail" — restarting was never the mechanism.

**The class of error:** an inference recorded where a measurement belongs — the same failure as
the San Diego receipt's "by construction" clause (§8). Two events correlated, a cause was
inferred, and the inference entered the governance record as established guidance. Both this
doc and the workbook (row 391) carried it, so every session inherited it.

**What to do instead:** do not restart the worker. Measure first — `select status_code,
count(*) from net._http_response where created > now() - interval '90 minutes' group by 1`
alongside `select count(*) from net.http_request_queue`. A **queue depth of 0 with slow
throughput is a request-failure problem, not a worker problem.** The open investigation is
**PGNET-503** in `QUEUE.md`.

**The general rule:** before recording a remedy, establish that it *caused* the recovery. "I did
X and the problem went away" is correlation. A remedy recorded on correlation is worse than no
remedy, because it stops anyone looking for the real cause.

### A concurrent writer is a design constraint, not an accident

**Two sessions have write access to this repo and to `jurisdiction-registry.json`.** Treat that
as normal, because it is.

**Before any registry edit**, check whether another session has touched that entry since your
branch point, and **state the result in your report** — the entry, the commits inspected, the
outcome:

```
git log --since=<branch-point> -S'"registry_id": "<id>"' origin/main
```

**Never resolve a collision by force-push.** Rebase onto the other session's work and commit
only the delta it is missing.

> **Worked case — 2026-07-30, two collisions in one day.** A parallel session wired the TX
> `government_notice` feeds (15:48 / 18:20 UTC) while this session was reporting them as
> unwired; and a parallel session landed the *same* `san-diego-approved-permits` status map in
> `915eaab` while this session was preparing it. The first surfaced as a `stale info` push
> rejection, the second because the remote was read before force-pushing.
>
> Both were caught. **Neither was caught by method** — converging on the same edit twice is
> luck. And the second collision mattered: `915eaab` changed `status_to_bucket` but left
> `_receipts` untouched, so force-pushing would have destroyed the reporting fix, while
> *skipping* the rebase would have left the superseded inference standing next to a bucket that
> contradicted it. Rebasing and committing only the missing `_receipts` delta was the only
> action that preserved both.

**Reading repo state:** `HomeSignalG/homesignal-site` is **PUBLIC** — read PRs, commits and
files directly by URL. **Verify state by reading it, never by relaying a summary.**

**Repo facts a new session needs:** `jurisdiction-registry.json`, `sources/arcgis.ts`,
`sources/socrata.ts` and the engine all live in **`supabase/functions/get-address-report/`**,
NOT in `homesignal-ingest`. `source-monitor.mjs` runs nightly at cron `0 7 * * *`.

---

## 8. Instrument silence is not evidence

**An instrument must prove it ran before its silence counts as evidence.** Instances found in
one sequence — **none by anything firing, all by looking:**

- 5 fixture suites never referenced by any workflow or runner (**0 automated signal since
  birth**) — *closed 2026-08-02: all are in the runner, see the supersession note below*
- #428's green that ran only against a pre-#430 base
- a drift check reading the wrong scope
- `socrata.ts` greppable as **binary** after 2 literal NUL bytes landed, so "no match" and "did
  not run" were indistinguishable — a real near-miss: an `include_types` grep silently skipped
  it and returned the right answer **by luck**
- `CLAUDE.md` outside every path filter

**Corollary: a correct result from a broken method is more dangerous than a wrong one, because
nothing in the output flags it.**

### A receipt may hold BOTH a measurement and an inference — evaluate the whole thing

**Quote and evaluate the WHOLE receipt before superseding any part of it.** Superseding the
*measurement* when only the *inference* is wrong corrupts the record: it discards a sound probe
and makes the entry look less trustworthy than it is.

**When a receipt reasons "by construction" or "by definition", mark that clause as an
INFERENCE — even when the surrounding receipt is a real probe.** A measurement establishes what
the vocabulary *was*; an inference from the dataset's title or name asserts what it *could
never contain*, and only the second kind can be falsified by the vocabulary simply growing.

> **Worked case — `san-diego-approved-permits`, 2026-07-30.** The drift check found
> `Pending Invoice Payment` (11 in-window records) on an entry whose `_receipts` said *"the
> dataset is APPROVED/issued permits by construction (its own title), so no pre-issuance status
> exists in the published domain and `proposed:[]` is the truth."*
>
> Read on its own, that line says the entry was never probed — and the first reading of it
> concluded exactly that. **It was wrong.** The *first half* of the same 1,637-character
> receipt, dated 2026-07-16, is a genuine enumeration: *"max APPROVAL_ISSUE_DATE 2026-07-15
> over 28,515 rows… Vocabulary VERBATIM from the same run: statuses Issued/Closed/Inspecting/
> Inspection Followup/Cancelled… 151 type|status combos enumerated."*
>
> So a measurement existed and found 5 statuses; the 2026-07-27 line layered an inference on
> top of it. **The enumeration was correct when run. The inference — that no pre-issuance
> status could exist — is the only part that was wrong.** The vocabulary grew: this is the
> **expiry, not error** pattern, the same shape as the TX government feeds.
>
> The supersession was worded to overturn the inference alone and to state explicitly that the
> original enumeration is *not* being called incorrect.

**Corollary — expiry is not error.** A claim that was true when written and went stale is
recorded as **EXPIRED / AMENDED**, never as a mistake. Reserve "wrong" for claims that were
false at the time they were made. Conflating the two punishes correct work and destroys the
incentive to record measurements at all.

### A "blocked" verdict must be re-tested on a SECOND channel before it is recorded

**Our probe path produces false negatives, and they look exactly like a hostile source.**

> **Worked case — TX-GOV Phase 2, 2026-07-30.** Four probes across three unrelated hosts
> (`bexar.org` ×2, `newtools.cira.state.tx.us`, `harriscountytx.legistar.com`) returned identical
> ~330-byte 400s. That was recorded as `verification_blocked` and reasoned about as a WAF
> fingerprinting Supabase egress. **It was a `User-Agent` header we were sending.**
>
> Re-run on a GitHub runner (`recon-fetch.yml`, clean egress), **8 of 8 "blocked" targets
> returned 200** — Bexar 313,925 b, Harris Legistar 206,720 b, CIRA 83,411 b, Dallas 56,345 b,
> Tarrant's live system 69,291 b. Controls agreed with pg_net where pg_net worked (Comal
> **78,088 b on both paths, byte-identical**), proving the channel rather than assuming it.

**The rule:** before recording `verification_blocked` — and *never* `candidates_exhausted` — on a
transport failure, re-test on a channel that does not share the failing path. **Always include a
known-good control**, so a channel-wide failure is distinguishable from a per-host one.

**Why it is worth the extra run:** a wrong `candidates_exhausted` writes off real coverage
permanently and nothing downstream ever revisits it. Here it contaminated a whole state's
inventory and the parking decision built on it.

### READ `CLAUDE.md` BEFORE ANY PHASE — it already contains the answer

**Before starting a phase, read `CLAUDE.md`.** Not skim, not rely on the session summary — read
the sections covering the surface you are about to touch. A standing answer is written down
precisely so no future session pays for it twice.

> **Two worked cases, both 2026-07-30, both in a single day:**
>
> 1. **The vendor-adapter conclusion.** `CLAUDE.md` records that per-state portals are the wrong
>    unit and a **civic-agenda VENDOR adapter** is the real unlock, with Granicus / Legistar /
>    CivicClerk / iQM2 / CivicPlus already built. A TX-GOV phase re-derived that from scratch
>    across 19 counties and 8 vendor systems.
> 2. **The NJ DCA dataset.** `CLAUDE.md` records it verbatim as *"aggregate-by-design (no
>    address/ZIP)"* — already rejected. A later phase probed it fresh, pulled the full 46-column
>    field list, and re-established the same rejection. The only thing gained was a sharper
>    reason (it is per-permit and **ungeolocatable**, not aggregate).
>
> Neither re-derivation produced a different decision. Both cost a full phase.

**Why this keeps happening:** re-deriving *feels* like diligence, and it produces real evidence,
so nothing in the output flags it as waste. The tell is that the conclusion matches something
already written down — by which point the cost is already paid.

**The cheap check:** before probing a source or opening a state, grep `CLAUDE.md` and
`docs/source-registry.md` for the jurisdiction, the vendor and the dataset id. A hit means the
question is already answered; verify it still holds rather than starting over.

### SEARCH FIRST, PROBE SECOND — a guessed URL cannot return a verdict

**A negative result from a URL you guessed answers "was my guess right", NOT "does the source
exist."** Recording a guessed 404 as `candidates_exhausted` writes off a jurisdiction that may
have a perfectly good first-party feed.

**Method, in this order:** search for the county's actual agenda/notice page → read what vendor
and identifiers it really uses → *then* probe that exact endpoint. Never invent
`<county>.<vendor>.com/<path>` and treat the response as evidence about the county.

> **Worked case — TX-GOV Phase 2, 2026-07-30.** Twelve guessed probes across the four largest
> uncovered TX counties yielded **zero** usable sources. One search then found Tarrant's real
> Granicus view — `view_id=7` — immediately. **The guess had been `view_id=1`, which 404'd at 16
> bytes.** Recording that 404 as `candidates_exhausted` would have written off **99 ZIP pages**
> that have a live first-party feed.

**This is Rule 13 in a new costume:** the probe answered a different question than the one asked.
Scope errors are not only about `extra_where` and `recency_days` — a wrong *URL* is a wrong
scope too.

**Corollaries, each measured the same day:**

- **A 200 is not a verdict either.** Travis's guessed CivicPlus RSS returned 200 / 30,670 bytes
  and **was not a feed** (0 `<item>`). Check the shape, not the status.
- **Valid RSS with 0 items is `first_party_UNCONFIRMED`, never `first_party_found`.** Tarrant's
  `view_id=7` returns 200, valid RSS, and the correct entity title — and **0 items**, with no
  event dates on its listing page. A *retired* view returns exactly that: Tarrant demonstrably
  retires views and leaves them serving (`view_id=2` is titled **"(NOT IN USE) Commissioners
  Court Archive"**). Two explanations, not separated — so currency must be established against a
  known-good comparison feed before wiring.
- **Name the channel that produced each verdict.** WebSearch and WebFetch are not
  interchangeable here: WebSearch works, **WebFetch is host-dependent** (403 on
  `dallascounty.org`). A transport failure is a **transport** verdict, never a source verdict —
  the same distinction as `verification_blocked` vs `candidates_exhausted`.
- **Watch out for the cross-entity lookalike.** `elpasotexas.granicus.com` is the **City** of El
  Paso; the **County** uses NovusAgenda. A right-looking host for the wrong government is the
  documented trap that once surfaced Calgary and Brampton data for US searches.

### ITEM COUNT IS NOT A LIVENESS SIGNAL

**The feed with the most items can be the worst thing to wire.** Item count is exactly the signal
a reasonable person trusts, and it is the one that fails hardest.

> **Worked case — Tarrant County Granicus, 2026-07-30.** Enumerating every view:
>
> | view_id | items | title |
> |---|---|---|
> | 2 | **0** | `(NOT IN USE) Commissioners Court A…` |
> | 5 | 2 | `(NOT IN USE) Commissioners Court A…` |
> | 6 | **100** | `IFRAME - Commissioners Court Archive` |
> | 7 | 0 | `Public Notice (Agenda Feed)` |
> | 8 | 0 | `Trustee Sales (Agenda Feed)` |
> | 9 | **100** | **`Test View (Agenda Feed)`** |
>
> The two **highest-item** views are an **archive** and a **TEST VIEW**. A "pick the view with
> the most items" heuristic would have wired **test data onto 99 production ZIP pages**,
> presented to residents as county notices — **worse than the empty feed it was trying to
> avoid.**

**Liveness requires all three, together:**

1. **A clean NAME** — reject any title containing `test`, `NOT IN USE`, `archive`, `IFRAME`, or
   similar operator scaffolding.
2. **Recent item DATES** — not merely a non-zero count.
3. **The correct ENTITY** — the county, not the city of the same name (§ search-first).

### The retired-view signature — why 0 items can never stand alone

**`200` + valid RSS + correct entity title + `0` items is INDISTINGUISHABLE from a live-but-quiet
feed.** It is therefore **never** `first_party_found` on its own — mark it
**`first_party_UNCONFIRMED`** and separate the two explanations before wiring.

This is documented, not hypothetical: Tarrant's `view_id=2` is *titled* `(NOT IN USE)` and serves
exactly that response. **The publisher retires views and leaves them serving.** So a feed that
looks perfect and simply has nothing in it today may be a decommissioned endpoint that will never
carry another item.

**To separate them:** enumerate the publisher's other views and compare against a **known-good
control feed** from the same vendor (Denton's `view_id=26` → 101 items). If every live-named view
is empty while archive/test views hold content, the publisher has migrated — find the new system
rather than wiring the corpse.

### A gate that did not FIRE must be distinguishable from a gate that did not RUN

**In the job summary, not only in the log.** A skipped step, a step whose condition never
evaluated, and a step that ran and passed all render the same way in a run's step list — so
"nothing went red" is not evidence that anything was checked.

> **Worked case — `source-monitor` step 8, 2026-07-30.** The drift gate is deliberately the last
> step and fires on a `STATUS_DRIFT=1` marker. On the confirming run it reported **`skipped`**,
> not `success`. That was correct — the marker was never set because nothing gated — but a
> skipped gate and an unevaluated gate are indistinguishable from the summary. The merge went
> ahead only after reading the log for the positive statement:
> `Registry entries checked: 105 · gating: 0 · unreachable: 3` and
> `No in-window unmapped statuses anywhere in the registry. Nothing gates.`

**The same defect one layer down:** that run reported `unreachable: 3` **without naming the
entries**. Every other finding class prints its `registry_id`; unreachables were only counted.
For those 3 entries "unreachable" reads identically to "clean" in every downstream consumer, so
a nightly green stayed compatible with 3 entries never having been read at all — the failure the
check exists to prevent, reproduced inside the check.

**Both fixes are the same rule:** a check must emit a positive statement of what it covered —
counts *and* identities — and a gate must report a distinguishable outcome for "ran, nothing to
report" versus "did not run."

### Provenance fields record what was done
**"NOT YET ASKED" is a valid and required value.**

> Worked case: a first pass wrote *"Queried the publisher's open-data portal and its dataset
> metadata; none published"* into every asked field when **no such query had been run** — a
> fabricated provenance claim inside the field built to hold provenance. Caught before commit
> and rewritten. **Never infer provenance from plausibility.**

### NEVER INFER ELAPSED TIME — COMPUTE IT (founder rule, 2026-08-02)

**Compute `now - started_at` from the API and quote BOTH timestamps.** Never judge how long a job has
been running by how much waiting it *feels* like, and never treat your own background `sleep` polls as
though wall-clock advanced with them.

*What the miscount produced on 2026-08-02, in order:* jobs 1.5 minutes old read as 20–50 minutes → a
**fabricated CI hang** → a **healthy job cancelled at 1.8 minutes**, destroying a valid check → an empty
"re-trigger CI" commit → the invented hang written into a commit message **and** `QUEUE.md` as the
justification for real work. Measured afterwards, the three runs took **2.3, 1.8 (cancelled) and 2.4
minutes**. Nothing was ever wrong.

**Note the compounding, because it is the real lesson.** The same miscount had *already* produced a
"`verify-communities` has been running ~50 minutes" claim earlier the same session (real duration:
22m32s). That was corrected as a **symptom** — the number was fixed, the cause was not investigated —
and it recurred hours later with far more consequence.

> **A corrected symptom with an uninvestigated cause will return.** When you correct a wrong number,
> ask what produced it before moving on. If the answer is "I'm not sure", that is the finding.

### THE ROLE IS PART OF THE PROBE'S SCOPE (founder rule, 2026-08-02)

Rule 13 says probe the question the connector asks. Its missing half: **the identity you probe as is
part of the scope.** Measure in the same **role**, the same **cache state**, and the same **connection**
the job actually uses.

*The miss:* the `source-monitor` scoreboard RPC was measured **as `postgres` on a warm cache**
(1,522 ms cold / 354 ms warm at `p_limit=1000`), a tuned constant was shipped on that evidence, and the
live run **still died on `57014`** — because the job runs as **`anon`**, where RLS applies and
`statement_timeout` is **3 s**, and the scheduled call is **cold**. The measurement was real and the
conclusion was wrong, which is the dangerous combination: it was quoted as evidence.

Two corollaries, both earned the same way:
- **Degrade, don't tune.** A constant picked from one measurement is a guess about every other
  environment. Ship a ladder that shrinks on failure instead of a number that was right once.
- **Never advance a keyset cursor on failure.** Shrinking the page *and* moving `after` skips rows while
  reporting success — silent data loss wearing a green check.

### A DEPLOY IS PART OF AN AUTHORISED CHANGE (founder rule, 2026-08-02)

**When an authorised change requires a deploy to take effect, dispatch it and disclose it in the same
report.** Stopping at the merge is not caution; it produces the exact false-claim shape this repo keeps
correcting.

*The case:* `las-vegas-building-permits` was retired by merge, but the engine deploy is deliberately
manual. Had the deploy been left for a separate approval, the report would have read "Las Vegas retired"
while **51 live pages still served its 3,121 records**. A retirement that is not deployed is a registry
edit that changes nothing. **Deploy is the step that makes an authorised change true.**

### REMOVING A KNOWN CAUSE DOES NOT PROVE THE SYMPTOM IS GONE (founder rule, 2026-08-03)

**After a fix, RE-MEASURE — and keep a control in the same query.** A repaired cause is evidence about
the cause, never about the symptom. The symptom may have had two.

*The case:* `san-antonio-prelim-plan-review` emitted zero because of the `status_const` defect below.
The defect was real, the fix was correct, it was merged and deployed — and the entry **still returned 0**
on both Bexar pages, against a same-service control (`san-antonio-permits-issued`) returning **167** on
one of them. The second, independent reason: it scopes on a native `Zip_Code` column and the layer's own
`returnDistinctValues` holds 29 ZIPs **ending at 78259**, while the only two Bexar pages modelled are
78260/78261. An honest zero, and the `houston-plat-applications` class — correctly wired, zero surface,
unlocked by a ZIP expansion rather than any registry edit.

Without the re-cache, **"defect found and fixed" would have entered the record while the entry still
emitted nothing** — the same false-coverage shape this repo keeps correcting. The control is what makes
the re-measurement mean anything: a zero next to a non-zero control is a finding; a zero alone is a
question.

### A HUB CATALOGUE IS A PUBLISHING CHOICE, NOT AN INVENTORY (founder rule, 2026-08-03)

**Enumerate `/arcgis/rest/services` itself before recording a rejection.** A DCAT/hub catalogue lists
what someone chose to publish there; the server lists what exists.

*The case:* Centre County PA's hub publishes **100 datasets and none of them is its permit layer** — the
only keyword hit is a *page* whose description is the unrendered template literal `{{description}}`, with
no service URL. The server's own root listing carries `Building_Permits` (**60,098 rows**, fresh: 669
dated 2026, 1,745 in 2025). Stopping at the hub yields a confident, wrong rejection.

⚠️ **RETROACTIVE CONSEQUENCE — this invalidates an unknown number of past verdicts.** Several earlier
`candidates_exhausted` / "no permit datasets" rejections were probably reached by reading a hub or DCAT
catalogue alone. **When any previously-rejected county comes up again, first check WHICH SURFACE its
rejection enumerated** — hub-only rejections are non-verdicts and must be re-probed against the server
root before being quoted. Only a rejection that names the server enumeration is conclusive.

### A MECHANISM COMMIT CHANGES BEHAVIOUR FOR EVERY ENTRY ALREADY CARRYING THE OPTION (founder rule, 2026-08-03)

**Implementing a previously-ignored option is not additive — it is a behaviour change for every entry
that already sets it, including entries nobody is currently looking at.** Enumerate them BEFORE the
deploy, and treat any that would behave badly as a PREREQUISITE, not as follow-up work.

*The case:* `include_types` was csv-only and silently ignored elsewhere. Implementing it in arcgis and
socrata was written as a pure mechanism commit — no registry entry touched. But **seven entries already
carried the option**, so the deploy would have started enforcing seven whitelists that had never once
run. Six were fine or improved. The seventh, `columbus-building-permits`, had its whitelist pointed at a
column that provably cannot express the distinction: deploying the mechanism alone would have taken its
49 pages from **42,209 records to 1,598 and sent 10 of them dark**, dropping ~220,000 real permits
including 53,360 New Construction. The re-point was therefore a **precondition of deploying at all**,
not an improvement on the deploy — and that is invisible in the mechanism commit's own diff, which
touches no registry data.

**The check, before deploying any mechanism change:** grep the registry for every entry that sets the
option, and measure what each one will now do. "This commit changes no data files" is not evidence that
it changes no behaviour. The safe orderings are: fix the offenders first and deploy together; strip the
option from the offenders and deploy without them; or do not deploy.

### A RE-CACHE CANNOT SHRINK A PAGE TO EMPTY WITHIN 7 DAYS (founder rule, 2026-08-03)

**`dev_refresh_collect()` REFUSES any update that takes a fresh row's `development` count from >0 to
0.** It is flake protection — a transient source failure must never blank a good page — and it means
**"re-cache and measure" structurally cannot verify an intentional REDUCTION.** A change that correctly
empties a page will look like a failed deploy.

The guard, verbatim from the shipped function:

```sql
and not (
  d.refreshed_at >= now() - interval '7 days'
  and coalesce((j->'counts'->>'development')::int, 0) = 0
  and coalesce((d.counts->>'development')::int, 0) > 0
)
```

**When a change is expected to REDUCE a page:** say so up front, EXPECT the guard to reject those
rows, and verify the intent from the CONNECTOR'S OWN OUTPUT (a live query in the connector's scope)
rather than from the cache. The end state arrives on its own when the 7-day escape clause expires —
the function's own comment explains why: *"Beyond that the 'flake' theory is exhausted (7+ consecutive
holds) and the clean 200 response is the truth."*

**Do NOT hand-write the cache to force it.** The control is doing its job; defeating a safety control
to make a number appear on schedule is never the move.

*The case:* the Columbus `type_source` re-point was expected to empty 5 of 49 pages. All five returned
clean HTTP 200s with `development: 0`, and all five were REJECTED by this guard — 44 of 49 pages
persisted, the 5 kept serving stale MEP/sign records, and the run superficially read as "5 pages failed
to refresh." Nothing failed. They self-empty ~7 days after their last successful refresh.

### `net._http_response` PURGES ARE A DATA-LOSS PATH — VERIFY FROM `refreshed_at`, NEVER FROM THE RESPONSE TABLE (founder rule, 2026-08-03)

**This is not a slow path, it is a DATA-LOSS path.** `net._http_response` can be purged wholesale
between firing a batch and collecting it. **A lost response is indistinguishable from a request that
never returned**, so a purge silently UNDER-REPORTS a re-cache and reads as ordinary transient failure —
the most dangerous shape there is, because the run still looks like it half-worked.

**Every re-cache measurement in this repo uses fire-then-collect, so any batch where a purge fired
would have under-reported.** Past runs reporting "N of M returned 503" may in part have been purges.

**The rule:**
1. Fire in batches small enough to **collect within ~2 minutes**. Never fire a large batch and wait.
2. **Verify completion from `refreshed_at` on the TARGET ROWS**, not from the response table.
   `refreshed_at` lives on the row you are trying to change and **survives the purge**; the response
   table never was an authoritative completion signal.
3. Before concluding a re-cache "did not work," run `select count(*), max(id) from net._http_response`.
   An empty table distinguishes *"the source failed"* from *"the evidence was garbage-collected."*

*Observed 2026-08-03:* the whole table went to **0 rows, max id NULL**, minutes after an 86-request
batch was fired — every response lost, and the only symptom was pages that had not moved. The same day,
a transient outage read of Columbus showed 13,231 records / 39 unclassified where the settled state was
14,466 / 45; splitting by `refreshed_at` resolved it immediately (44 pages post-deploy carrying 14,421
records and **0** unclassified, 5 pages still on pre-deploy timestamps carrying all 45). **The split by
`refreshed_at` is what made the number interpretable — the totals alone were not.**

### ANCHOR A MEASUREMENT ON A FIXED SET, NEVER ON "ROWS THAT CURRENTLY CARRY X" (2026-08-03)

**A query shaped like this reports a SUBSET as a TOTAL:**

```sql
with pages as (select distinct zip from development_reports r, jsonb_array_elements(r.sites) s
               where s->>'source_registry_id' = 'X')          -- ← evaluated AFTER the change
select count(*), sum(...) from pages join development_reports using (zip)
```

The denominator is computed from the post-change data, so **any page the change reduced to ZERO drops
out of its own denominator** and the "total" silently describes only the survivors. It is the
measurement-time twin of the retry-selector bug (selecting "pages still dark" cannot see a page that
should have gone dark), and it fails in the same direction: invisibly.

**Anchor on a set that cannot move:** the pinned pre-change ZIP list, or the entry's declared coverage
(`communities` rows for its state/county). Then a page at zero still appears, as a zero.

*The case:* measuring the include_types enforcement, Columbus and Chester were anchored on fixed
baseline ZIP lists and reproduced exactly under independent verification; Cincinnati, Nashville and the
first Portland pass used the moving shape. Portland's was caught because its coverage is 83 pages while
the moving CTE saw only 12 — a 6x discrepancy too large to miss. Cincinnati's and Nashville's happened
not to distort the totals (no page reached zero), which is precisely why the shape is dangerous: it is
correct until the moment it matters.

### THE COMPLETION SIGNAL IS SOUND — `refreshed_at` CANNOT BE ADVANCED WITHOUT A FETCH (verified 2026-08-03)

Challenged and checked, because the rest of this session's verification rests on it. **`refreshed_at` is
written in exactly ONE place:** `dev_refresh_collect()`'s `UPDATE`, joined to a row in `net._http_response`
with `status_code = 200` and `mode = 'zip'`. No fire path, no retry path, no bulk stamp touches it —
`dev_refresh_fire_batch` writes `last_refresh_attempt_at`, a different column.

⚠️ **A `grep`/`ilike` for `%refreshed_at%` MATCHES `last_refresh_attempt_at` as a substring** and will tell
you the fire path writes it. It does not. (CLAUDE.md: "a count / grep is a LEAD, not a fact" — this is
that rule biting inside the verification of the rule.)

**Identical microsecond timestamps across many rows are EXPECTED, not suspicious.** One `UPDATE` is one
transaction and `now()` is transaction-start time, so a single collect stamps every row it touches with
the same value. 66 pages sharing a stamp means one collect call, not a fetch-less bump. Timestamps spread
out only when collect is invoked repeatedly.

### Measurement discipline
- **Capture the baseline BEFORE mutating what you intend to measure** — a post-deploy refresh
  destroyed the pre-deploy Arlington rows and cost the clean −397 figure.
- **Never report a cache row as verification of a deploy** — force the affected ZIPs through the
  deployed engine instead.
- **Never present a cross-set comparison as a delta.**
- **Do not round a partial result up to a complete one** (e.g. no 105/105 claim while San Diego
  is unobserved).

---

## 9. Decisions already made — do not re-litigate

Settled 2026-07-29/30:

- **`arlington-issued-permits`:** ship the 38 keys; restate the criterion as *"complete among
  rows carrying a `MainUse` value."* **`SUBDESC` REJECTED as a fallback** — it is permit
  subtype, not building use.
- Whether **sign / awning / billboard permits** belong on a development map is an **OPEN PRODUCT
  QUESTION**, not implemented, **founder call**.
- **Cincinnati** `PAID` / `REVIEWED` / `RENEW` / `BILLED` / `APRV_NR` / `CAGIS` / `ADD INS`,
  **San Jose** `PME`, and **Fort Collins** `Issued FF` go to **`status_unresolved`, never to a
  guessed bucket**.
- **Shelby: BUILD the opendatasoft connector, do not drop the entry.**
- **`tdlr-tabs`: investigate before any fix-or-delete.**
- **`dallas-specific-use-permits`' 48 defensive case variants: leave them** — redundant after
  #430, but removing them violates additive-only.
- **The `CLAUDE.md` path filter in `unit-tests.yml`: KEEP it.**
- **`pg_net` watchdog: hygiene priority, not urgent.**
- **New Orleans `"PERMIT CANCELLED "`: use the TRIMMED form** — "verbatim" means verbatim
  **after the connector's own documented normalization**, not raw bytes.
- **Do not re-fire the Arlington ZIPs to force a delta;** let the rolling refresh carry them.
- **`"PILING AFFAVDAVIT"` is stored verbatim INCLUDING the source-side misspelling** —
  correcting a publisher's spelling in a registry key would stop it matching.

### Corrected numbers — earlier figures in chat were wrong
- **195** ZIP pages carried a TX/UT map defect (TX 86 + UT 109). An earlier "203" was an
  **incorrect correction of a right number**.
- **56** keys shipped in PR #432 = 52 live-verified + 4 UDOT latent. **Both 52 and 56 are
  right** — they count different things.
- **Denver NEVER drifted.** The layer stores both cases split by vintage and the engine's
  365-day window sees only Title Case. `returnDistinctValues` **IS** authoritative on casing; it
  was answering a different **SCOPE** question.
- **The five fixture suites never produced a false green** — they produced **NO signal**, having
  never been referenced by any workflow or runner.
  ✅ **SUPERSEDED 2026-08-02 — they are wired.** PR #431 added four to `scripts/run-unit-tests.mjs`
  and #552 added `socrata-text-date-recency.test.ts`; the runner now discovers **73** files and CI
  gates on it. The lesson above stands as history and the finding is closed.

---

## 10. Working cadence with the founder

- **Lead with the answer.** Terse and direct; no repeated caveats.
- Hand back **copyable instruction blocks** rather than prose the founder has to translate.
- **KEEP EACH BLOCK SHORT** — long blocks have been observed **truncating in transit**, which
  silently drops instructions. Several short blocks beat one long one.
- If a report arrives that **has already been acted on**, say so in one line and act only on the
  new material rather than re-running the turn.
- **Resolve ambiguity independently and state the assumption;** do not ask when the answer is
  derivable.
- **Do not report between steps of an authorized sequence** — report once at the end, or on a
  stop condition.

---

## 11. Workbook editing conventions

Applies when editing `00NNMaps IngestFeedInventory.xlsx` itself.

- **Filename format is exactly `00NNMaps IngestFeedInventory.xlsx`** — SPACE between `Maps` and
  `Ingest`, no underscore, no other punctuation. Increment `NN` by 1 for every revision; never
  reuse or skip. Upload paths and file-preview cards may render the name with underscores or
  lowercase — **that is display transformation, not the filename.** When in doubt, ask for the
  exact string rather than inferring it from a path.
- **`ZIP Code Pages` — do not add columns.** It reports through its existing **13**: ZIP Code,
  Community Name, County, State, Page Slug, In Source Registry, Source Count, PR, Merged,
  Production, Live, Verified, Blockers. Status is Yes/No in H–L and a prose string in M.
  **Encode a new dimension of status in the existing columns and extend the Blockers string.
  Adding columns is the single most likely way to get an edit rejected.**
- **Blockers string style (column M):** `'<STATUS> — <detail>. Gaps: <a>; <b>.'` Terse,
  em-dash separated, **no bullet lists, no markdown**. **Extend** the existing sentence rather
  than replacing it when the prior state is still true.
- **Never construct `Font()` or `Alignment()`** — that writes NEW style records, including fonts
  with no typeface name that fall back to a default. Copy an existing comparable cell's style:
  `from copy import copy; cell._style = copy(src_cell._style)`. Reference cells: Instructions
  section header `A282`, `[Label]` row `A283`, wrapped body `B283`; ZIP Code Pages header `M4`,
  data cell `M5`.
- **Verify styles after every save.** Unzip and confirm `xl/styles.xml` counts are UNCHANGED:
  **fonts 12, fills 3, cellXfs 50** (known-good baseline as of 0063). Any increase means new
  style records were written — redo the edit by copying styles. Also confirm `ZIP Code Pages`
  `max_column` is still **13**.
- **Structural facts:** no formulas anywhere, safe to edit programmatically · `ZIP Code Pages`
  rows 1–3 are **MERGED B:M**, so write to **column 2** (the anchor); writing to C–M raises
  *"MergedCell object attribute value is read-only"* · header row is **4**, data begins at
  **5** · Instructions uses column A for labels (bold) and B for content (wrapped, top-aligned);
  ALL-CAPS in A marks a section header, `[Bracketed]` marks an entry · openpyxl drops
  `docProps/custom.xml` on save — an empty Properties element here, so the loss is harmless and
  expected.
- **Publish one file per revision** and delete the prior revision from the output directory.
- **Always APPEND rows, never insert** — rows are referenced by number throughout the
  Instructions tab, in `CLAUDE.md`, and in session handoffs. Inserting shifts every reference.

### `ZIP Code Pages` rows 1–3 — what they are for
Rows 1–3 report **STATE COVERAGE ONLY:** which states have all their ZIP pages modelled (row 1),
which are partially modelled with a done/total and percentage per state (row 2), and which have
none (row 3). **Nothing else belongs in them.** Do not append deployment status, PR numbers,
verification results or defect counts — **"live" in row 1 means the PAGES EXIST**, which is
independent of whether a given page serves a current or a stale cached row. Per-page status
belongs in columns H–M; deployment and sweep history belongs on the Instructions tab.

> **Incident 2026-07-30:** revision 0062 **REPLACED** rows 2 and 3 with deployment narrative
> instead of appending, destroying the in-progress and outstanding state lists. Restored
> verbatim in 0065. Root cause: writing a new subject into a cell whose column-A label names a
> different subject. Two safeguards follow — **(a)** never write to a summary cell without first
> reading its column-A label and confirming the content matches that subject; **(b)**
> **additive-only applies to WORKBOOK cells exactly as it applies to the registry:** extend an
> existing string, never replace one, unless the founder has asked for a correction to that
> specific value.

---

## LIVE MEANS PAGES, MEASURED AFTER DEPLOY AND RE-CACHE (founder, 2026-07-31)

**A state is Live when its ZIP PAGES are record-backed in the database, measured AFTER deploy and
re-cache. Wired + merged + emitting is NOT Live.**

Never declare Live from anything but a post-deploy DB read of the page table. In particular:

- **Connector output is not page coverage.** A source can emit perfectly — correct count, correct
  `scope: point`, coordinates spanning the county's real extent — into `development_reports` while
  every page still serves pre-materialization data. The cache and the pages are different tables
  and they disagree for as long as it takes `app_refresh_zip()` to run.
- **A cache row is not deploy verification** (the mirror of row 344).
- **The pipeline has FOUR steps, and skipping the last one is invisible:** merge → deploy →
  re-cache (`development_reports`) → **materialize (`app_projects`)**. Only the fourth changes what
  a resident sees.

*The case that produced this rule:* Delaware was reported Live at 68/68 on 2026-07-31. Measured
against `app_projects` at that moment it was **46/68 — unchanged**, with **zero** rows from the new
source. The connector had emitted 468 records into the cache and all of them were correct. The
report was still false.

**And the wrong filter that nearly hid it:** in `app_projects` a facility row carries the FRS
facility's OWN id in `registry_id` (e.g. `110054576320`), so filtering `registry_id <> 'epa-frs'`
counts the EPA floor as coverage. That filter reported Sussex **22/22** when the truth was **0/22** —
a plausible, authoritative-looking, wrong non-zero. **Separate development from the floor on
`record_kind`, never on a registry-id name.**

Enforced: `dev_zip_source_ids` now reads `app_projects` with `record_kind = 'development'`, so the
scoreboard cannot be fed cache numbers. Accepted only because it reproduces the row-419 baseline
exactly across ten states, which the cache-based version did not.

