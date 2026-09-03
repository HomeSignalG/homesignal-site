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

## 0. A `pg_net` 200 IS NOT EVIDENCE THE ENGINE CAN FETCH A HOST (2026-08-05)

**This leads the doc because it is invisible to every other check in it.**

A `pg_net` 200 proves **Postgres egress** can reach the host. It says **NOTHING** about the **Deno
edge runtime the engine runs on**. For any **NEW host**, the first post-deploy re-cache is a
**DEPLOY VERIFICATION**: read `arcgis_reports[].fetched/emitted` and `quarantined`, **never
`counts`**. A page with 0 development records is indistinguishable from a legitimately empty one.

**Corollary:** `services*.arcgis.com` is proven reachable by dozens of live entries, so an
AGO-hosted candidate carries **materially less risk** than a city-hosted one. **Prefer it when both
exist.**

### Why no amount of recon can catch this

**All recon in this repo is `pg_net`-based** — the sandbox has no egress, so every probe, every
enumeration, every vocabulary count in this document's playbook goes out through Postgres. The
engine does not. An edge-egress block is therefore invisible to recon **by construction**: no number
of green probes can detect it, because the probes never touch the blocked path. Tampa and El Paso
were caught during recon only because their block happened to be an **HTTP 403 that `pg_net` also
received** — that was luck, not method.

### The case that produced this rule — Dayton OH, wired, deployed, reverted the same hour

`dayton-oh-capital-improvement-projects` passed every gate in §3: first-party host derived from the
org's own item URLs, server root enumerated in full, both vocabularies complete and summing exactly,
geometry verified, page lift measured at 22 of 39 before any commit. It merged (#594) and deployed —
and the deploy was the first moment anything touched the real path:

```
fetch failed: error sending request for url (https://maps.daytonohio.gov/.../MapServer/0/query?...):
client error (Connect): Connection reset by peer (os error 104)
```

Identical on **4 of 4** Montgomery ZIPs, `fetched 0 / emitted 0`. **The control is the same URL, byte
for byte** — envelope, `inSR`/`outSR=4326`, `outFields=*`, `resultRecordCount=1000` — returning
**HTTP 200, 413,143 bytes, 212 features** through `pg_net` minutes apart. The error is at **Connect**,
before HTTP, so it is not a query-shape, URL-length or response-size problem: it is a source-IP block
on Supabase edge egress. Reverted in #595; Montgomery OH stayed **0 / 39** with zero residue, because
a fetch that never connected wrote nothing.

**Remove the entry; do not leave it documented in place.** A registry entry whose fetch can never
succeed still declares its `coverage`, and the coverage gate is what the config-based reading of
"Live" keys on — 39 pages marked covered against zero records is the §5 trap exactly.

### `EDGE_EGRESS_BLOCKED` REQUIRES A POSITIVE CONTROL — otherwise it is just "unreachable"

The rule above has an inverse failure mode: concluding "maybe the edge can reach it" about a host
nothing can reach, and wiring it to find out. **Do not.** The verdict `EDGE_EGRESS_BLOCKED` is only
available when a path **demonstrably works** — Dayton had one (`pg_net` returning 200 / 413,143 bytes
/ 212 features on the exact connector URL). A host that fails from every path tested is
**unreachable**, and there is nothing to justify the wire-and-see.

**Read the failure MODE, not just the failure.** They are different verdicts:

| Signature | Class | Wire-and-see justified? |
|---|---|---|
| Another path returns 200 | `EDGE_EGRESS_BLOCKED` | **yes** — the engine is the only untested path |
| `Connection reset by peer` at Connect, with a working control | edge/IP block (Dayton) | yes |
| HTTP **403** from a WAF, all paths | WAF block (Tampa, El Paso) | no |
| DNS fails | dead host | no |
| **TLS handshake never completes** (blackhole) | unreachable | **no** |

**Worked example — St. Louis Regional Data Exchange (`rdx.stldata.org`), re-probed 2026-08-05.**
The 2026-07-17 rejection recorded it as unreachable "from BOTH egress paths (pg_net 30s+60s timeouts
AND GitHub-runner fetch failed ×2)" — and that record **does** name its two paths, so it is more
careful than a "dual egress" summary suggests. Neither path is the Deno edge runtime, so it was worth
re-checking against §0. It reproduces exactly, on all three URLs, and the timing breakdown is the
verdict:

```
Timeout of 60000 ms reached. Total time: 60000.329 ms
  (DNS time: 70.867 ms, TCP/SSL handshake time: 59929.462 ms, HTTP Request/Response time: 0.000 ms)
```

**DNS resolves in 71 ms; the TLS handshake consumes the entire 60 s and never completes; the HTTP
request is never sent.** That is a packet blackhole, not a reset and not a 403. Two independent cloud
egress paths blackhole it and **no path returns anything**, so there is no positive control and the
edge class does not apply. **RDX stays rejected as `unreachable`** — the verdict is unchanged, but it
is now recorded with the mechanism instead of a summary.

**When recording any unreachability, name the exact paths tested and the exact failure mode.**
"Unreachable from both egress paths" reads settled and is not: it does not say *which* two, and it
does not distinguish a blackhole from a reset from a 403 — three different verdicts with three
different next steps.

---

## 0a. AN INVARIANT MUST REPORT THE SIZE OF THE CLASS IT CHECKED. A DENOMINATOR OF ZERO IS NOT A PASS

**Every violation count must be reported next to the population it was counted over.** `0 violations`
is only evidence when the class is non-empty. A zero inside an empty class attests to nothing, and it
reads exactly like a healthy result — which is why this has been the shape of **every instrument
failure in this project**.

> **The rule, operationally:** never report `N violations`. Report **`N violations of M checked`**, and
> treat **M = 0 as an UNKNOWN, not a pass.**

### The worked case — Illinois, 2026-08-05

The standard go-live check is *"0 point-scope records missing coordinates."*
`lake-county-il-construction-program` returned **0** — and it was not healthy. It has **no point-scope
records at all**: all 77 are `scope: "area"`, because the connector could not flatten its
`esriGeometryMultipoint` geometry. The check filtered to `scope='point' AND lat IS NULL`, a filter that
matches nothing when there are no point rows, so it passed vacuously over an empty set. The defect
surfaced only from a *different* query — the scope **distribution** — which showed `point 0 / area 77`
against Cook's `point 289 / area 0` and Champaign's `point 215 / area 0`.

**Same family as the earlier `app_changes` vs `app_community_meta` mistake** (17 LA pages reported as
"never materialized" when they were materialized-but-empty): an instrument must prove it ran over
something before its silence counts as evidence.

### Audit of the standing go-live invariants — which can pass vacuously

| Invariant | Filter | Empty-set risk | Required denominator |
|---|---|---|---|
| **missing `record_url`** | `record_url IS NULL` | **LOW** — counts over ALL records of the entry, so 0 records makes the entry's absence obvious in the same row | total records emitted |
| **point records missing coords** | `scope='point' AND lat IS NULL` | 🔴 **HIGH — this is the one that failed.** Zero point rows ⇒ vacuous 0 | **the scope distribution: point / area counts** |
| **unclassified `use_type`** | `use_type='unclassified'` | **MEDIUM** — vacuous if the entry emitted nothing at all | total records emitted |
| **gate proof** (`rides_only`) | distinct state/county of emitted rows | 🔴 **HIGH** — an entry that emits NOTHING rides nowhere, which reads identically to "correctly scoped" | **record count per entry, asserted > 0** |
| **both-tables parity** | `development_reports` n vs `app_projects` n | **LOW** — a full outer join shows a NULL side, which is what caught Lake | both counts, side by side |

**Two of the five can return a clean 0 over an empty set.** The gate proof is the more dangerous of
the two, because "this source appears on no wrong county's pages" is *exactly* what a source that
fetched nothing looks like — the Dayton edge-block would have produced a perfect-looking gate proof.

**So the go-live measurement must always carry, per entry: records emitted · ZIPs touched · the scope
distribution · then the violation counts.** If records emitted is 0, every downstream invariant is
UNKNOWN, not green.

---

## 0b. The seven disqualifiers — record which one, and whether it came from an ENUMERATION or a GUESS

| # | Disqualifier | Means | Fixable by waiting? |
|---|---|---|---|
| 1 | `NO_GEOGRAPHY` | no ZIP, no address, no coordinates — cannot be scoped or geocoded | no |
| 2 | `STALE` | the dates **stopped** | **yes** — reprobe |
| 3 | `AGGREGATE_NOT_PER_RECORD` | counts/rollups, not filings | no |
| 4 | `NEW_CONNECTOR_FAMILY` | would require connector code, not config | not without a build |
| 5 | `candidates_exhausted` | enumerated every surface, nothing there | only if the publisher adds one |
| 6 | `WRONG_RECORD_CLASS` | live, fresh, per-record, geolocated — and the **wrong ledger** | no |
| 7 | `NO_TEMPORAL_FIELD` | there are **no dates at all** | **no** |
| — | `EDGE_EGRESS_BLOCKED` | reachable from `pg_net`, unreachable from the engine (§0) | **yes** — reprobe |

**6 — `WRONG_RECORD_CLASS`. Mechanical checks all passed; only reading the CONTENT caught it.**
Worked example, Dayton's `AccelaIncidents_UPDATE`: 12,879 rows, genuinely fresh (`RECORD_DATE`
2026-01-02 → 2026-07-01), per-record, point geometry — and `COMPLAINT_TYPE` is **`HOUSING` on every
one of the 12,879 rows**, with statuses `CLOSED 5,072 / OPEN 4,955 / ACTIVE 1,520 / ABATED 965 /
PAID 196 / ABATED-PAID 61 / RESEARCH-UNDER REVIEW 48 / APPEAL-PPC 26 / EXTENSION GRANTED 23 /
NO SERVICE 13` (summing to 12,879). Abatement, payment and appeal outcomes on housing complaints are
a **code-enforcement ledger**; the `development` bucket is *permits, construction filings, planning
notices*. It would also have published complaints against **named private residents' addresses** as
development records. A schema that passes every mechanical check can still be the wrong ledger.

**7 — `NO_TEMPORAL_FIELD`, and it is DISTINCT FROM `STALE`.** Stale means the dates stopped; this
means **there are none**, and only the second is unfixable by waiting. A source where **no** record
can be dated cannot answer *"what is being built now"*, cannot be windowed, cannot age out, and
cannot be reprobed for staleness — it is **permanently unfalsifiable**, because a live register and
an abandoned one are indistinguishable forever.

The bar, stated as the practice this project has actually followed: **every wire shipped here
carries a real date, or an honest null on a MINORITY of records.** Dayton would have been 71 of 264
undated and that was already flagged as a weakness.

Worked example, Toledo's `Vibrancy_Projects` — **REJECTED (founder, 2026-08-05)**: 119 rows on a
known-reachable host, complete vocabularies each summing to 119, current through 2026 (19 rows), and
a measured lift of 16 of 30 Lucas pages. Rejected anyway. **119 of 119 undated is the disqualifier —
not the missing status column.** `Program_Year` is an INTEGER, the same class as Delaware County PA's
integer `Year`; there the entry still had `Entry_Date` to fall back on, **here there is nothing**.

---

## §N5 — ZIP-MODE GEOGRAPHY IS POLYGON MEMBERSHIP, AND THE DISK QUESTION IS CLOSED (2026-09-03)

**THE BUG, RESTATED SO IT IS NOT RE-LITIGATED.** A Map 1 ZIP page must show every development
whose authoritative geometry intersects that ZCTA polygon. **In ZIP mode there is no saved
address, so centroid/radius placement is structurally impossible** — a ZIP centroid is a page
anchor, never a home. Radius remains valid ONLY in address mode (resident-entered home +
0.5/1/2/5 mi). The legacy 3-mile ZIP membership is therefore the wrong instrument for ZIP
mode, and replacing it with polygon intersection is the fix.

### The population, reconciled so it visibly closes

```
PROVEN     718,278 materialised (pt:1)  +  5,171 rejects  =  723,449   national PROVEN
                                           4,877 MULTI_COORD_UNRESOLVED
                                             294 NULL_COORD
RECOVERY   164,185 national
            =  16,450 resident (5 of 78 registries)
            +   2,966 PERMANENTLY EXCLUDED (cincinnati 2,866 · cook 70 · lake 30 —
                       no service_url / row_id identity; can never carry geometry)
            + 144,769 UNRECOVERED but recoverable
geometry-bearing national  =  718,278 + 164,185  =  882,463
resident corpus            =  718,278 +  16,450  =  734,728
13 completed shards        =  20,170 associations in geo.n5_association (untouched)
```

### Per-family rows/project — MEASURED, and which half is complete

| family | rows/project | n | population it was measured on |
|---|---:|---:|---|
| **point (PROVEN)** | **1.0000** | 4,471 | **COMPLETE** — all 718,278 PROVEN points are resident. Exact, no residual. |
| **polygon (RECOVERY)** | **1.002** | 7,715 | extrapolated |
| **polyline (RECOVERY)** | **1.654** | 381 | extrapolated |

⚠️ **THE ASYMMETRY IS THE HEADLINE, NOT A FOOTNOTE.** PROVEN's 1.0000 is measured on a
COMPLETE population and is exact. **EVERY RECOVERY multiplier is extrapolated from 16,450 of
164,185 projects (10.0%), on a RECOVERY corpus that is itself 5 of 78 registries (6.4%).**
Point-family RECOVERY inherits 1.0000 from the PROVEN measurement because the multiplier is a
property of GEOMETRY TYPE under one predicate, not of treatment — that inheritance is an
argument, not a measurement, and is flagged as such.

### National estimate and the closed disk decision

Bytes/row **265.6**, cumulative over three prefix runs (12,921 rows / 3,432,448 B).

```
measured, unprobed point-like      883,132 rows   223.7 MB
measured, unprobed polyline-like   905,908 rows   229.5 MB
WORST CASE (top of every PRIOR multiplier: polygon 1.9, polyline 5.4, unprobed 1.9)
                                   949,175 rows   240.5 MB
```

**DECISION — NO TIER INCREASE. CLOSED; DO NOT RE-DERIVE.** Worst-case permanent additional
**619 MB** = RECOVERY geometry 0.37 GB (high) + membership 0.235 GB + boundaries **0**
(streaming demonstrated on three prefixes: load, probe in ~1 s, drop in the same run). Free
would fall 3,674.7 → **3,055 MB, i.e. 1,007 MB above the 2,048 MB floor — ~5x the 200 MB
"thin" threshold.**

Assumptions the decision rests on, stated so a future reader can invalidate it deliberately:
boundaries are STREAMED per prefix and never persisted · the membership artifact is
PROJECT-grain, not feature-grain · reclamation stays suspended (capacity AND vintage) · the
RECOVERY multipliers hold within the worst-case envelope above.

🔻 **The transient-WAL term of 0.5–1.2 GB that earlier sizing carried is REFUTED BY
MEASUREMENT, not by argument.** Across the 718,278-row PROVEN materialisation WAL moved
**1,124,073,844 → 1,073,742,196 bytes — it FELL.** WAL is checkpoint-bounded and already sits
inside the free figure. Do not re-add a WAL surge term to any N5 sizing.

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

**⚠️ THE FAILURE HAS A SECOND MODE, AND IT IS MORE DANGEROUS: FABRICATION, NOT MISCOUNTING.**
The worked cases above are all *miscounts* — a real artifact counted wrongly, so reconciling
against the artifact finds the truth. A fabricated figure has no artifact behind it at all, and
the tell is different: **it reconciles to nothing, and grepping the repo returns zero hits.**

> Worked case, 2026-08-07 — CARB. An instruction directed shipping "the 4,343 CARB-only
> facilities", excluding "the 55,832 matched ARB IDs", citing a "92.6% overlap", and praised a
> "40m coordinate tolerance with the address control, 12 of 12 manual spot-checks correct."
> **None of it existed.** No such measurement was ever made or reported; the merged record said
> the opposite in as many words — *"CANNOT BE MEASURED, and no number should be quoted"* — and a
> repo-wide grep for `92.6` and `4,343` returned only coincidental digit runs inside ZIP-centroid
> coordinates. Acting on it would have shipped 4,343 records sourced from nothing onto California
> pages: fabricated provenance, self-inflicted, at a larger scale than the Champaign `G:\` defect.
> (The founder confirmed the invention afterwards.)

**Three practical consequences:**
1. **Praise for rigour is not evidence the rigour happened.** A compliment describing methodology
   you do not remember performing is a stronger signal to check than a bare number is.
2. **An instruction that presupposes an artifact is a claim about that artifact.** "Exclude by the
   55,832 matched IDs" asserts a keyed list exists. If it does not, the instruction is not merely
   wrong on a number — it is unexecutable, and saying so is the answer.
3. **Grep is the cheap discriminator.** A real figure appears in a doc, a receipt or a commit. A
   fabricated one appears nowhere. Run the grep before the work, not after.

**This applies to figures from the founder exactly as it applies to figures from a doc, a summary,
or your own earlier message.** Checking is not distrust; it is the only thing that stopped this.

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

### CONCURRENCY IS PART OF A PROBE'S SCOPE (founder rule, 2026-08-03)

Same code, same minute, same ZIP — **different parallelism, opposite results.** This belongs with
Rule 13 and "the role is part of the probe's scope": a probe run at a different concurrency than
production answers a **different question**.

*The case:* ZIP 97215's cached row held **0** Portland permits while the layer held **414**.
Invoked ALONE through the deployed engine it returned `fetched 414, emitted 414, quarantined []`
— which read as "the engine is healthy, the cache is stale." Fired as **10 ZIPs in parallel** (the
shape `dev_refresh_fire_batch` actually uses — default batch **250**), **7 of 10** came back
`fetched 0` with `fetch failed: … Connection reset by peer (os error 104)`. The same ZIPs **2 at a
time** returned 414 / 407 / 136 / 116. A single-request probe could never have found it, and
"works when I run it" would have been recorded as an exoneration.

**So: state the concurrency alongside every fetch finding, and reproduce at production
parallelism before concluding a source is healthy.** The corollary bites in both directions — a
solo probe that SUCCEEDS does not clear a source, and a solo probe that FAILS does not condemn one.

### ESTABLISH THE BACKGROUND RATE BEFORE CLAIMING A SPIKE (founder rule, 2026-08-03)

**An absolute count is not a signal. A count against its own baseline is.** Never assert a
regression from "N rows are bad right now" without the rate that N should be compared to.

*The case (founder's own, recorded because the rule is what matters):* "30 `development_reports`
rows refreshed since 16:00 came back with ZERO sites — something deployed today is emptying pages,
and the blast radius grows every 15 minutes." The instruction that followed was to **revert the
paging fix**. One query disproved it — zero-site rows grouped by hour over 48 h:

| hour (UTC) | refreshed | zero | % |
|---|---|---|---|
| 08-03 03:00 | 58 | 15 | **25.9** |
| 08-03 12:00 | 750 | 101 | **13.5** |
| **08-03 16:00** | **894** | **28** | **3.1** |

Zeros run **2–26 % continuously**, including many hours *before* the deploy; the accused hour was
the **lowest** full-volume rate in the window. All 30 were `data_quality='coverage_coming'`,
`indexable=false`, and **0 of 30 had ever been lit**. Reverting would have restored 200-row
truncation on two entries and fixed nothing. **The real defect was somewhere else entirely.**

Pair it with the rule above: the *actual* failure was invisible to a count of empty rows, because
those pages were never empty — they kept their county planning notices while silently losing 414
permits.

### A CROSS-LANGUAGE COUPLING NEEDS A TEST OR IT ROTS INVISIBLY (founder rule, 2026-08-03)

**When a guard written in one language depends on a message authored in another, nothing checks
the join.** The compiler cannot see it, the linter cannot see it, and the guard keeps running —
producing success-shaped output while silently guarding nothing. It is the same family as
"an instrument must prove it ran," one level up: here the instrument runs perfectly and is simply
pointed at a string that moved.

*The case:* `dev_refresh_collect()` (SQL) identifies a failed source with
`reason like 'fetch failed:%'` against `quarantined[].reason` — a string authored in five
TypeScript connectors. Reword one message and the SQL keeps executing, keeps returning row
counts, and stops refusing anything. Pinned by `test/fetch-failure-reason-contract.test.mjs`,
which asserts the prefixes from **both** sides — the connectors emit them, and the SQL matches
them — plus that every connector's report array is actually read (a missed one is an unguarded
source).

**Where possible, key on a FIELD rather than on prose.** The companion truncation guard keys on
`truncated_at_max_rows` precisely because the prose is *not* uniform: csv words its note "bound
the emit" while the other four say "bound the fetch", so a string match would have silently
missed one connector in five. When only prose is available, the test is not optional.

### A SECOND READER ON A DIVERGED SURFACE — THIRD INSTANCE, SO IT IS A PATTERN (founder rule, 2026-08-03)

**When two surfaces read two tables whose contents have diverged, "the page is correct" is
ambiguous by construction — and every verification that does not name its table inherits the
ambiguity.**

Three instances now, same shape each time: a second reader was added to a surface whose meaning
had moved, and nothing reconciled them.
1. **The coverage-state view** — counted coverage-gate membership, read as record-level coverage.
2. **`app_changes` drift** — materialized rows outliving the semantics that produced them.
3. **`app_projects` vs `development_reports`** (this one) — `app_projects` held **zero**
   saint-paul rows while `development_reports` held **20,000 on a single ZIP**, at the same
   moment. Every "what do residents see" check had been run against `app_projects`;
   `homesignalmap.html:1055` reads `development_reports` **directly**, so residents saw the
   retired data anyway. The divergence is structural — the materializer applies caps
   (`limit 6 / 6 / 8 / 48 / 48`) and filters (`relevance='development' AND scope='point'`) that
   the map page does not.

**The rule: state the TABLE alongside any claim about what residents see, and check the table
that the surface in question actually reads.** A clean materialized layer is not evidence about
a surface that bypasses it. Matrix of surface → table: `QUEUE.md` item 0d.

### WORKED CASE — THE AUTHOR OF THE SURFACE RULE BROKE IT THE NEXT DAY (2026-08-03)

The surface-matrix rule ("state the TABLE, and check the table the surface actually reads") was
written on 2026-08-03. **Within a day I measured the Aurora/Adams window change in
`development_reports` only and reported "−72%" as the result.** `app_projects` had not caught up —
`app_refresh_batch` is an **8.5-hour round-robin** and those 24 pages were queued behind ~11,000
others — so `community.html`, `development.html` and `dashboard.html` were still serving 2011
permits while the map page showed the new window. The founder caught it by measuring the other
table.

**Two operational consequences, both now standard:**
1. **A config change is not measured until BOTH tables are.** After re-caching
   `development_reports`, call `app_refresh_zip` on the affected ZIPs explicitly — never wait for
   the round-robin, and never report a delta from one table alone.
2. **Compare like with like.** `app_projects` filters `relevance='development' AND scope='point'
   AND record_url<>''`, so the comparable figure from `development_reports` is that same filtered
   count, not the raw array length.

### A REMEDIATION SELECTOR IS A MEASUREMENT — ANCHOR IT ON A FIXED SET TOO (2026-08-03)

The anchoring rule was recorded earlier the same day for *measurements*. It bites identically on
*remediation*, and I repeated it: the 24-ZIP re-materialization list was computed from
"ZIPs that currently carry entry X in `development_reports`" **after** the deploy had already begun
rewriting those rows. **80005 had been refreshed by the rolling tick at 22:15, so its Adams records
were already gone from the cache — and the ZIP dropped out of its own remediation selector**,
leaving 9,194 stale `app_projects` rows with `submitted_at` back to 2011-01-04 on a page nobody
would have re-checked.

**The self-correcting form, which is what to use:** select the work from the table you are
*repairing*, compared against the table you are repairing *from* —
`app_projects p JOIN development_reports d USING (zip) WHERE p.created_at < d.refreshed_at`. That
cannot lose a row to the mutation it is meant to cover.

### CONFIRM THE WORKING TREE MATCHES THE PUSHED REF BEFORE COMPARING STATE (2026-08-03)

A container restart rolled the local checkout back to `606aa11` while the remote branch was at
`25fedc7`. Comparing that stale tree against `origin/main` showed **5 merged PRs "missing" from the
branch**, which read as "the deploy I just dispatched reverted the paging fix and `include_types`
in production" — and produced a real (failed, already-completed) cancel attempt on a **clean**
deploy. Against the actual pushed ref, **0 commits on main touched the edge function that were not
in the branch**.

**A restart can silently un-do a working directory while the remote is fine.** Before comparing
branches — and especially before concluding a deploy reverted something — verify `git rev-parse
HEAD` equals `git ls-remote origin <branch>`, and repair with `git reset --hard origin/<branch>`.

### UNMAPPED IS NOT EMPTY — THEY GET OPPOSITE TREATMENT (founder rule, 2026-08-03)

**`unmapped` means WE did not classify what the publisher said. `empty` means the PUBLISHER said
nothing.** They look identical downstream — both land in `unclassified` — and they are opposite
problems.

- **Unmapped is a MAPPING DECISION.** The publisher told us exactly what the record is; we simply
  have no entry for that value. Aurora's `Roofing-RT2` is not unclassifiable — it is *classified by
  the source as a roof replacement*, which is maintenance, not development. The right answer is a
  content judgement: map it, or drop it.
- **Empty is HONEST ABSENCE.** Adams' 21,506 rows with a blank `BuildingUse` are real permits —
  located, dated, filed by the county — about whose USE the publisher recorded nothing. Dropping
  them would discard a record the source asserts exists. The right answer is to KEEP them under
  the generic member (`Development` → the "Other project" shape, the Phoenix precedent) so the page
  renders an honest "we don't know the use" rather than a missing classification.

**That distinction is the line between fabrication and honest-unclassified**, and it is why the two
cannot share a rule. Also recorded: Adams' own `_receipts` claimed its empty value "fails closed."
It does not — only STATUS fails closed; an unmapped/empty TYPE publishes as `unclassified`. 28,555
such rows were cached. A receipt asserting a fail-closed behaviour is worth re-checking against the
connector, not trusted.

### MEASURE A VOCABULARY IN THE WINDOW THE CONNECTOR WILL ACTUALLY ASK (founder rule, 2026-08-03)

A type/status vocabulary measured over **all history** weights the decision by records the entry
will never fetch. Measure it inside the live `recency_days` window — this is Rule 13 applied to the
time dimension, and it is not a refinement, it changes conclusions.

*The case:* Aurora's `Plan Revisions` reads **14,667** all-history and was the hardest call in the
ruling — keep a revision to a real project, or drop it like a roof replacement? In the 365-day
window the connector actually queries it is **6 rows**. The hard call was an artefact of the wrong
scope. (Same probe, same layer, same day; only the window differed.)

### AN IDENTIFIER REGEX CANNOT TELL A COLUMN FROM A STRING LITERAL (2026-08-03)

Deriving a column projection (`out_fields`) by scanning an entry's `column_map` **plus its
`extra_where`** looked mechanical and safe. It produced, for `denton-county-dev-permits`:

```
ADDITION, BARN, BUILDING, COMMERCIAL, DUPLEX, GARAGE, HOME, HOUSE, METAL, MOBILE, SHOP, TO
```

Every one of those is a **value inside** `PermitType IN ('HOUSE','MOBILE HOME','DUPLEX',…)`, not
a column. The same bug hit miami, minneapolis and cleveland — 4 of 28 entries. **Strip quoted
literals before extracting identifiers**, and note the asymmetry that makes this dangerous in
both directions: an *extra* column is usually harmless, but a **missed** column silently drops a
field from every record the entry emits — with nothing failing. Any `out_fields` pass must also
be verified against each layer's live `fields` list before it is written. Caught pre-commit; no
projection was shipped.

### SMALL-n STATISTICS READ AS MEASUREMENTS (2026-08-03)

`percentile_disc(0.95)` over **16 values** returns the maximum. Reading it as a percentile
produced "p95 = 20,000 — most of aurora's ZIPs are truncated." Counting gave **2 of 16**. A
percentile over a handful of rows is not a percentile; when n is small, **count the thing**.

### THE CONNECTOR WAS NOT AT FAULT — DO NOT GO LOOKING FOR A CONNECTOR DEFECT (2026-08-03)

Recorded explicitly so a future session reading "Portland fetch failures" does not hunt for a bug
that never existed. **There was no connector defect.** All five connectors diagnosed the failure
correctly and precisely, per source, at the moment it happened:

```
"fetched": 0, "emitted": 0,
"quarantined": [{ "reason": "fetch failed: error sending request for url (…):
                  client error (Connect): Connection reset by peer (os error 104)" }]
```

The `quarantined: []` reported earlier in that investigation was a **reading error** — the report
was fetched positionally as `arcgis_reports->0`, and for those ZIPs index 0 was a *different*
source. Reading by `registry_id` showed the diagnosis had been there all along. The entire defect
lived in the collect layer, which discarded a correct signal. *(Positional access into an array
of per-source reports is a claims-discipline trap in its own right: index 0 is not "the source
you are thinking about." Filter by `registry_id`.)*

### A FETCH THAT FAILS MUST NOT COLLECT AS AN EMPTY SUCCESS (founder rule, 2026-08-03)

**"No match" and "did not run" must never be indistinguishable — and that applies to a data
pipeline's WRITE path, not just to CI checks.** `fetched: 0` meant both "this source found
nothing" and "this source could not be reached." The refresh wrote the second one to production as
if it were the first.

Two halves, and the second is where it went wrong:
- **The connectors were always right.** All five quarantine a failed fetch with a precise reason
  (`fetch failed: …` / `fetch/parse failed: …`). Nothing upstream needed changing.
- **`dev_refresh_collect()` threw the diagnosis away**, and its transient guard tested the
  **AGGREGATE** `development` count — so a **per-source** collapse hid behind a *different*
  source's contribution. ZIP 97215 emitted `development: 15` from the county's AREA planning
  notices, 15 > 0, guard silent, **414 point permits overwritten by silence.**

**The rule: a guard on a total cannot protect a part.** Any invariant over a multi-source
aggregate must be evaluated per contributing source, or the largest contributor can vanish behind
the smallest.

Fixed by `docs/dev-refresh-source-failure-guard.sql` (migration
`dev_refresh_per_source_failure_guard`): `dev_failed_sources(jsonb)` discriminates a failed fetch
from an honest zero; the refusal is **per source, not per page** (a source that failed but
contributes nothing to that ZIP does not block it); every failure is logged to
`dev_refresh_source_failures` + `v_dev_refresh_source_health` so a refusal is never silent; and
blocked rows keep their old `refreshed_at`, so `dev_refresh_fire_batch` (ordered `refreshed_at asc`)
re-picks them automatically — no new scheduled job. Both directions are pinned:
`test/fetch-failure-reason-contract.test.mjs` proves config errors, truncation notes and
per-record quarantines do **not** block, because a guard that only blocks would freeze every
honestly-emptied page forever.

*It paid for itself on first run:* the very first collect surfaced a **second** silently-darkening
source — `minneapolis-ccs-permits` returning `ArcGIS error: Unable to perform query. Too many
requests.`, blocking 55413 (2,015 cached records) and 55422 (719), while correctly **not** blocking
55119 (0 cached).

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


---

## Rules added 2026-08-04 (PA seam close — Centre + York)

### Rule 13 governs VOCABULARY WIDTH, not just counts — enumerate at the window you WIRE

A source's vocabulary is a **function of the window**, not a property of the layer. York's
use-flag set holds **29** distinct combinations in a 3-year window and **32** in the 5-year
window actually wired; three combinations exist only in the wider one. Enumerating at one
width and wiring at another drops the difference to `unclassified` with nothing failing —
the same silent-nothing class as a wrong `extra_where`. Probe at the exact `recency_days`,
`extra_where` and status field the entry will ship with.

### Characterise a zero in TWO steps: unwindowed control, then windowed

"This page is dark" is not a finding. Both PA pages that ended with no records were honest,
and honest in **different ways** — Centre 16686 returned **0 unwindowed** (true absence: no
permits within 3 mi at all), while York 17372 returned **80 unwindowed / 0 windowed** (80
plans on record, none in the last 5 years). Only the second would change if the window
changed. Report which one it is, or the number is not yet information.

### A joined flag array is NOT an empty `type_source`

`readCol` joins a `column_map` array with a space and keeps every non-empty part, so a
multi-column flag set is wireable as `type_map` keys with **no connector change** — but a
row with every flag `NO` produces `"NO NO NO NO NO NO NO NO"`, a PRESENT value. The
2026-08-03 ruling fills `use_type_const` only on an EMPTY value, so those rows need an
**explicit key**; the constant will never fire on them. A single-column type source with a
genuinely blank cell is the opposite case and does use the constant. One ruling, two
mechanisms — pick by asking what the connector actually reads, not what the publisher meant.

### Before a flag array can be a key, prove the flags are never NULL

The join **drops** null/empty parts, so one NULL flag yields a SHORTER key that silently
misses the map. Probe it explicitly, and give the zero a non-zero control from the same query
shape (York: 0 NULL-flag rows, control `PLAN_TITLE IS NOT NULL` → 1,269).

### A re-fire selector must key on the field that changes AT FIRE, not at collect

Filtering pending work on `refreshed_at` re-fired the same 9 Centre ZIPs twice and never
advanced, because `refreshed_at` only moves when `dev_refresh_collect()` runs. The claim
field is `last_refresh_attempt_at`, set at fire time by `dev_refresh_fire_batch`. This is the
80005 remediation-anchor lesson in the other direction: there the selector moved too fast and
dropped rows that still needed fixing; here it never moved and re-did the same ones.

### `dev_refresh_collect()` returns a GLOBAL count — it is not evidence about your fires

It collects every pending response, including the scheduled rolling refresh's. A return of
"10" after firing 9 of your own says nothing about yours. Measure the target rows directly.

### An in-flight request is not a failed one

18 requests with no `net._http_response` row were read as the `fire_failed` class; they were
still in flight and all landed. `dev_refresh_log_fire_failures()` only inspects requests whose
response has LANDED (`join net._http_response`), so it does not false-positive on in-flight
work — confirmed by reading its definition. When an instrument seems to be firing wrongly,
read it before trusting the alarm; here the reading was the error, not the instrument.

### An opaque code can be decoded on evidence — but say which evidence, and test the decoys

Centre's `Open_Y_N` (C/O/I) carries no `codedValues` domain. It was resolved by three
independent lines — the field NAME, a **recency inversion** (73% open among 2026 permits vs
2.4% across all history), and a **`Close_Date` asymmetry** (31.7% of C rows vs 0.4% of O
rows). A candidate decoder that FAILED is worth recording too: `Percent_Complete` is null on
58,085 of the 58,676 C rows and decodes nothing. The one value with no signal (`I`, n=1) is
DECLARED in `exclude`, not left unmapped. Decoding on evidence is permitted; guessing is not,
and the difference is whether the receipt is in the entry.

### A count pinned in a test is a snapshot; assert the PROPERTY

`test/arcgis-type-const-with-map.test.mjs` asserted "exactly one entry sets both `type_map`
and `use_type_const`". That was true the day it was written and failed on the next honest use
of the pairing, one day later. It now asserts, for EVERY such entry, that the pairing is
explained in its own receipts and that the constant is a GENERIC (non-terminal) bucket. Pin
the invariant, not the inventory.

### `get_check_runs` can serve STALE state — confirm a "hung" job with `list_workflow_jobs`

PR #579's two `unit` checks reported `in_progress` for ~25 minutes and I reported a stuck
runner. **Both had actually completed `success` at 03:46:40 and 03:46:55 — 2m19s and 2m15s,
entirely normal.** The check-runs endpoint was serving state ~25 minutes out of date;
`list_workflow_jobs` on the run id had the truth, including per-step timings.

**But do not over-trust the fallback either — measured the same session.** On the very next
PR (#580) BOTH endpoints froze on identical `in_progress` state for 13+ minutes, returning
byte-identical step timestamps across polls, so `list_workflow_jobs` is not guaranteed live.
What it reliably adds is *per-step* detail — a step with a `started_at` and no `completed_at`,
and a plausible elapsed time, is the only positive evidence of real progress available. When
both endpoints agree on a frozen state, you cannot distinguish slow from stale from the API at
all: say so, and do not report either diagnosis as fact.

Two rules follow. **A long-pending check is a claim about the API, not about CI** — before
concluding a job is hung, queued, or contended, read `list_workflow_jobs` for the run and
look at `completed_at` on the job itself. And **do not report a CI diagnosis from the
check-runs summary alone**; it is a cache, and a cache that lags is indistinguishable from a
job that never finishes. Same family as "an instrument must prove it ran before its silence
counts as evidence" — here the instrument was not silent, it was confidently stale.

---

## Rules added 2026-08-04b — two ways a search lies, and they are not the same

### NEVER suppress stderr on a search you intend to act on — THE PRIMARY RULE

**Founder correction, 2026-08-04: this is the rule, and the tree check below is second-order.**
A missed `QUEUE.md` item — a new fixed-window registry entry shipping unregistered — was written up
as a stale-checkout effect and a tree check was mandated for it. **That diagnosis was wrong.** The
item was present in **every** tree the session ever had
(`git show 606aa11:QUEUE.md | grep -ci "dated constant"` → 1). The mandated fix would not have
prevented what it was written for.

The real cause: the grep ran from the **wrong working directory** with `2>/dev/null`. Every path
argument failed to exist, stderr was discarded, and grep exited **0 with no output**. Reproduced:

```
$ cd /home/user && grep -rn "DATED CONSTANT" docs/*.md QUEUE.md 2>/dev/null
$ echo $?
0
$ cd /home/user && grep -rn "DATED CONSTANT" docs/*.md QUEUE.md
grep: docs/*.md: No such file or directory
grep: QUEUE.md: No such file or directory
```

**A search that read ZERO FILES is byte-identical to a search that found ZERO MATCHES.**
`2>/dev/null` is what makes them indistinguishable; a relative path is what makes it likely.

**So, in order:** confirm `cwd` before any path-scoped search · never suppress stderr on a search
you will act on · prefer absolute paths · when a search returns nothing, confirm it actually read
files before treating the silence as evidence.

This is the sharpest instance of *"an instrument must prove it ran before its silence counts as
evidence"* — the instrument was not silent, it was **confidently empty**.

### Confirm the tree matches `origin/main` before any measurement or grep — SECOND-ORDER

Worth keeping (it caught a real case within the hour of shipping), but note what it is *not*: it
does **not** catch the silent-glob failure above. Three stale checkouts in one session produced a
**false revert alarm** (a restored tree read as "5 merged PRs are missing", nearly cancelling a
clean deploy) and a **wrong test-file count** (78 vs 83). Run `node scripts/check-tree-fresh.mjs`
at session start and after any restart.

It asks *"is `origin/main` an ancestor of HEAD"* — being **ahead** is normal, being **behind** is
the hazard. Its first version alarmed on merely-ahead, which would have trained everyone to ignore
it; that is its own lesson about check design.

### A plausible misdiagnosis costs more than an obvious one — PRECISELY BECAUSE IT SHIPS

"Stale checkout" explained the symptom, matched a pattern that had genuinely occurred twice that
session, and was wrong. It would have shipped a fix (the tree check) that does not prevent the thing
it was written to prevent. **When a cause is inferred from a pattern rather than reproduced, say so
and then reproduce it** — here, one `git show <ref>:FILE | grep -c` against the actual historical
tree falsified it in seconds.

---

## Settled and CLOSED — do not re-propose (founder rulings, 2026-08-04)

### NO test account for the signed-in `property.html` dossier

The rendered signed-in dossier stays **uncovered**. Founder ruling: *"Credentials in CI is a worse
risk than an uncovered surface, and `PARTIAL_SURFACES` naming the residual is the correct handling
— honest about what is not checked rather than implying coverage. Do not revisit."*

So the correct response to "property.html is only partly verified" is **to state the residual**, not
to widen coverage by adding secrets. `verify-property-page` covers the signed-out surface and the
`app_projects` data a dossier reads; `scripts/lib/surface-banner.mjs::PARTIAL_SURFACES` names what
it does not. That is the finished state, not a gap to close.

### NO agricultural member in the `use_type` vocabulary

York's `AG`-flagged plans render as **`Development` → the generic "Other project" circle**, and that
stands. Considered and declined: adding a category to `lib/map.js::TYPE_EXACT` would change what
**every resident sees nationally** — the classifier, renderer, shape legend, popup, sidebar, Street,
Satellite and Focus all read that one table — to sharpen a **240-row** case in one county. Founder
ruling: *"Development rendering as 'Other project' is honest ambiguity."*

The general shape, worth carrying to the next vocabulary question: **a closed global vocabulary is
not extended to express a local nuance.** The generic member is the honest answer when the specific
one would cost a national rendering change.

## §0c — BEFORE ANY COUNTY DISCOVERY: check for a STATEWIDE DOT source

**Standing first move, in this order:**

1. **Grep the registry for that state's existing entries.** If they are **all sub-state scoped**
   (city / township / county), the statewide source has not been tried.
2. **Check whether the state DOT publishes a STIP or equivalent statewide project layer.**
   Every state DOT is federally required to maintain a **STIP** (Statewide Transportation
   Improvement Program), so a candidate essentially always exists on paper — the question is only
   whether it is published as a queryable per-record layer with geometry, status and a date.
3. **If both hold, the statewide source is the play** — wire it *before* starting county-by-county
   discovery.

**Why this is the rule.** Michigan: the registry grep showed all 5 existing MI entries were
city/township scoped, which is what made a statewide source the obvious move rather than another
metro hunt. `mdot-stip-projects` lit **218 pages in one wire** across all 11 modeled counties —
including 8 counties that had **zero** live pages and no wireable city or county source anywhere.
County-by-county would have taken weeks and, on the evidence of the enumerations, would have
returned almost nothing: Oakland's county GIS is district polygons, Ottawa has 0 permit services,
Grand Rapids is stale to 2023, and Flint/Lansing/Macomb/Monroe/Livingston have none at all.

**The same pattern is already proven four times: UDOT · TxDOT · NDOT · MDOT** (plus FDOT and
MassDOT). One connector shape, one registry entry, statewide reach.

⚠️ **State the expected yield honestly — it is NOT uniform.** MDOT took MI to 268/360 (74%), but
UDOT leaves UT at 109/310 (35%). The lift depends on project density and on whether the layer is
points, polylines or polygons. A statewide DOT source is the cheapest *first* wire, never a claim
that the state is finished.

### Measured gap (2026-08-05)

**Statewide entries exist for 6 states:** FL (`fdot-active-construction-projects`),
MA (`massdot-highway-projects`), MI (`mdot-stip-projects`), NV (`nvdot-project-boundaries`),
TX (`txdot-projects-info-all`), UT (`udot-active-projects`).

**11 states have ZERO live pages and no registry coverage of any kind — 2,159 pages, where a
statewide DOT wire is the ENTIRE play:** NJ 359 · ME 273 · NH 247 · IA 225 · VT 212 · WV 212 ·
OK 197 · ND 155 · AK 101 · HI 97 · RI 81.

**33 further states carry coverage but no statewide entry**, led by NY 531 dark · CA 386 ·
CT 268 · AL 237 · IL 218 · PA 210 · AZ 207 · WA 203 · OH 199 · IN 196 · MD 191 · WI 191 · MO 181.

## §0d — THE GITHUB CHECK STATE LIES; WAITING IS ALMOST ALWAYS RIGHT

One rule, three faces:

- **Both `pull_request_read(get_check_runs)` and `list_workflow_jobs` serve STALE state**, for
  tens of minutes. A `unit` job reported `in_progress` for ~20 minutes had in fact completed
  **success in 2:18**. The merge API reads the same state, so `405 … "unit" is in progress` is
  frequently a lie about a job that has already passed.
- **A 404 from `get_job_logs` only proves the job has not finished YET** — logs are published on
  completion. It is not evidence of a hang or a wedged runner.
- **NEVER CANCEL.** Cancelling converts a slow block into `405 … "unit" is cancelled`, which is
  TERMINAL: waiting does not clear it and `rerun_workflow_run` does not reliably replace it. The
  only recovery is **a new commit on the branch**, which mints fresh check runs.

`unit-tests.yml` sets `timeout-minutes: 15`, so a genuinely hung job cannot exceed 15 minutes.
**Wait, and retry the merge periodically.** Two healthy runs were cancelled on a misread, and the
docs PR that followed merged on a later retry with no intervention at all.

### The meta-lesson, which is the part worth keeping

In this same episode a **correct** initial read ("the API is stale, wait") was **revised** to a
wrong one ("the runner is wedged, waiting won't help") on the strength of a 404 that did not
support it — and then had to be corrected back when the merge simply succeeded. **Revising a
correct call on weak evidence is its own failure mode**, and it is harder to spot than the
original error because the revision feels like diligence. Before overturning a working
explanation, ask what the new evidence actually rules out. A 404 on an unfinished job's logs
ruled out nothing.

## §0e — THE NATIONAL FIGURE IS `app_projects`, AND THE TABLE IS PART OF THE NUMBER

**Pinned (founder, 2026-08-05).** The headline coverage number is:

```sql
select count(distinct zip) from public.app_projects where record_kind = 'development';
```

**Because that is what actually renders** — the community pages, the development pages, the
dashboard and the app rails all read the materialized `app_projects` layer.
`development_reports` is the **map page's uncapped cache** and legitimately runs AHEAD of it,
because materialization reaches ZIPs on the round-robin's schedule.

**Both numbers are correct. They answer different questions.** So:

1. **State the table with EVERY national number from here on.** A bare "national 4,9xx" is
   ambiguous and two people will compute it differently — which is exactly what happened.
2. **Emit BOTH in the scoreboard, plus the lag between them.**
3. ⚠️ **A WIDENING GAP IS ITSELF A SIGNAL** that materialization has fallen behind — track it,
   don't just report it.

### ⛔ The filter trap that produced the discrepancy

`app_projects.registry_id` is **NOT** a jurisdiction-registry id on every row. On
`record_kind='facility'` rows it carries the **EPA registry id** — 114,695 distinct values.
So `where registry_id is not null` returns **11,711** ZIPs (the EPA facilities floor, i.e.
nearly every page) instead of 4,937. **Filter on `record_kind='development'`, never on
`registry_id is not null`.**

Measured 2026-08-05 — the worked example:

| metric | value |
|---|---|
| headline — `app_projects`, `record_kind='development'` | **4,937** |
| cache — `development_reports` with `source_registry_id` | 4,973 |
| materialization lag | **36** |
| (wrong filter — `registry_id is not null`) | ~~11,711~~ |

This is the **surface-matrix rule landing on the headline metric itself**: the same question
asked of two surfaces gives two right answers, and naming the surface is part of stating the
fact.

### ⚠️ ACT ON THE LAG — DO NOT JUST EMIT IT. THRESHOLD: ~100.

**If the lag exceeds ~100, run `select public.app_refresh_batch(1500);` — repeat until it drops.
Do not wait for the round-robin.**

A lag of N means **N ZIP pages are live in the cache and INVISIBLE TO RESIDENTS** — the map page
reads `development_reports` and shows them, while the community, development, dashboard and app
rails read `app_projects` and do not. The headline stays healthy-looking the entire time, which is
exactly why this needs a threshold and not a vibe.

**Worked case, 2026-08-05 — the instrument paying for itself two days after it was built.** The
lag sat at exactly **36** across every reading for a whole session, then jumped to **244** when
the round-robin began filling four newly-wired states faster than `app_refresh` materialized.
Nothing else in the readout changed; the headline just climbed more slowly than the cache. Two
`app_refresh_batch(1500)` calls took it **244 → 72 → 32**. Had only the headline been read,
**244 pages would have been serving residents nothing while the coverage number said otherwise.**


## §0f — A POPULATED `net.http_request_queue` DOES NOT MEAN THE REQUESTS WERE NOT SENT

**Measured 2026-08-05, and it inverts the §0-adjacent assumption made earlier the same day.**

Symptom: 24 engine calls fired via `net.http_post`; after 12+ minutes and a `worker_restart()`,
`net.http_request_queue` still held all 24 and `net._http_response` held **zero** of them.

That reads as "the requests never went out." **It was false.** The Supabase **edge-function logs**
showed ~22 `POST | 200 | …/get-address-report` at the current deployment version, execution times
9–33 s, in exactly that window. **The engine received and served the requests. pg_net simply never
recorded the responses.**

### What this changes

1. **The queue is NOT an outbox you can read as "unsent."** A row sitting in
   `http_request_queue` may correspond to a request that has already executed successfully
   upstream. Deleting it does not cancel anything.
2. ⚠️ **CORRECTION to an action taken earlier in this session.** 50 cron-issued re-cache rows were
   deleted from `http_request_queue` on the reasoning that they were "stuck and will re-fire."
   On this evidence they had most likely **already run against the engine**; the deletion removed
   bookkeeping, not pending work. No durable harm — the round-robin re-caches regardless — but the
   stated reasoning was wrong and must not be repeated as precedent.
3. **`dev_refresh_collect()` reads `net._http_response`.** So when response collection fails, the
   engine does the work, the cache is NOT updated, and a go-live measurement taken at that moment
   reports **zero lift** for wires that are perfectly correct. **A zero measured during a pg_net
   response-collection fault is an instrument failure, not a finding** — exactly the §0a shape.

### The instrument that settles it

**`mcp__Supabase__get_logs(service: "edge-function")`.** It is authoritative for "did the engine
run this?", independent of pg_net entirely, and it reports the deployment `version` so you can also
confirm you are looking at post-deploy traffic. Use it before concluding that a host is
unreachable, that a wire produced nothing, or that a queue is wedged.

**Order of diagnosis, cheapest first:** queue depth + `min(id)` moving → `max(id)` in
`_http_response` as a control → **edge-function logs** → only then a claim about the source.

## §0g — NEVER DELETE FROM `net.http_request_queue`, AND RE-CACHE IN BATCHES OF ~24

### The rule is load-bearing, not tidy — an MCP timeout is the only reason 200 live requests survived

⚠️ **Read this first, because it is the one that nearly destroyed work.** A `DELETE` was issued
against 240 of this session's own queued rows, on the reasoning that they were stuck. **The
statement timed out at the MCP layer and did not commit — and 200 of those 240 requests landed
successfully moments later.** Nothing but a transport timeout stood between a routine-looking
cleanup and the destruction of a live, in-flight batch.

The same deletion was attempted **twice in one session, wrongly both times**:

- **First** (50 cron rows): reasoning was "stuck, will re-fire." The **edge-function logs showed
  they had already executed.** The deletion removed bookkeeping, not pending work.
- **Second** (240 own rows): would have discarded a batch that was 83% successful, mid-flight.

**The queue is not an outbox of unsent work** (see §0f) and **is not yours to prune.** A row
sitting there may be already-executed, in-flight, or genuinely waiting — and you cannot tell
which from the queue alone.

**If it looks stuck:** check whether `min(id)` is moving → read `max(id)` in `_http_response` as a
control → read the **edge-function logs** → then simply wait. **`net.worker_restart()` is the only
safe intervention.**

### The engine sheds load above roughly 24 concurrent

| batch | result |
|---|---|
| **24 ZIPs** (×3 separate batches) | **24/24 × 200** every time, 0 errors |
| **240 ZIPs** | 143 × 200, 12 × **503**, **85 timeouts** — 60% |

The `503`s are visible in `get_logs(service: "edge-function")` at ~10 s execution, interleaved
with healthy `200`s at 9–33 s. A large burst does not fail fast and loudly; it produces a slow,
partial, **silently lossy** fill. **Drive manual re-caches in batches of ~24** and let the
round-robin carry the tail — it re-caches every ZIP on its own schedule with no intervention.

## §0h — PROGRAM-CLASS SOURCES: REQUIRE-A-DATE USUALLY BEATS A BACKWARD WINDOW

**For program-class sources — STIP, CIP, capital programs, anything that publishes a multi-year
funded programme — the relevant date is often when a project ENTERS the program, not when it
completes.** A backward `recency_days` window silently deletes the current programme's own
backlog.

**Measure BOTH before choosing.** Measured 2026-08-05 across the four state DOT wires:

| source | date field | rows | 1825-day window | require-a-date |
|---|---|---|---|---|
| **NJ** | `PROJ_RECD` | 264 | **28 (−89%)** | **246 (93%)** |
| **IA** | `CONTRACT_AWARDED` | 362 | 128 (−65%) | **322 (89%)** |
| **ME** | `conbegin_forecast` | 1,109 | 501 | **501 (45%)** |
| **VT** | `ExpectedConstructionStart` | 1,037 | 344 | **337 (33%)** |

New Jersey is the worked case: `PROJ_RECD` is a **receipt** date, so a 1825-day window would have
discarded **89% of a programme that runs through FY2033** — the layer is literally
`Tran_STIP_24_33` with FY_2024…FY_2033 funding columns. The programme is current; only the date
column looks old. **That is a different finding from STALE and must not be recorded as one.**

**So:** default to `extra_where "<date> IS NOT NULL"` with **no** `recency_days`, and state the
resulting ceiling in the receipts. Keep a window only where you have measured that it drops
little (or where the source genuinely accumulates unbounded history). And where the window and
the IS-NOT-NULL test return the SAME count — as with Maine's 501 — the window is a pure no-op and
should be omitted rather than left in as decoration.


## §0i — WHEN THE STATEWIDE PROBE FAILS, ASK WHO THE STATE DELEGATES TO

§0c's statewide-DOT-first is the right **opening move, not a guarantee**. When it fails, there is
one more search to run **before** falling back to county-by-county:

**Does the state delegate its programme to MPOs or regional councils?** Metropolitan Planning
Organizations (NYMTC, CDTC, GBNRTC, SEMCOG, DVRPC, CRTPO, GCLMPO …) and regional planning councils
publish their own TIP/STIP geometry in many states. **That is a different search than
county-by-county, and one MPO often covers several counties at once** — so it sits between the two
in cost and can be worth far more than a single county probe.

**New York is the worked case:** all three statewide candidates failed (see the NEW YORK section
in `docs/source-registry.md`), and the reason is structural — **NY publishes its STIP through
MPOs**, not as one statewide layer. The correct next question there is "what does NYMTC / CDTC /
GBNRTC publish", not "let me re-probe NYSDOT differently".

**Do not keep re-probing the state once it has failed with receipts.** Record the rejection, then
move to the MPO question, then to counties.

## §0j — THE CITY IS WIRED, THE COUNTY IS THE GAP (expect this shape; grep the registry first)

A recurring shape, seen enough times to be a prior rather than a surprise:

| state | wired | still dark |
|---|---|---|
| NY | NYC's five boroughs (DOB), Buffalo (city) | **Erie County**, and every suburban county |
| IL | Chicago, Naperville | Cook's non-Chicago ZIPs, the collar counties |
| OH | Cleveland, Columbus, Cincinnati (cities) | Cuyahoga / Franklin / Hamilton outside those cities |
| MI | Detroit, Ann Arbor, Independence Twp | **Wayne, Washtenaw, Oakland** county-wide |

**Big cities publish permit data; their counties usually do not** — and a state can therefore look
partially covered while every suburban page is dark. **Always grep the registry for the state
first** (now the standard opening move) and read the entries' SCOPE, not just their presence: a
state with entries is not a state with coverage.

## §0k — STANDING DECISION POLICY (founder, 2026-08-05)

**This REPLACES asking the founder for the judgment calls below. Apply it, record the decision in
the receipts, and move on — do not report the decision itself.**

### Wire / reject floor

- A candidate that passes the three-part liveness test and would light **≥ 5 pages: WIRE IT.**
- **< 5 pages: reject as `SUB_THRESHOLD`** — *unless it is the only source in a state at zero, in
  which case wire it.* **The first page in a state is worth more than the fifth in a covered one.**
- **Any of the seven disqualifiers: reject with receipts and move on. Never wire for the count.**

### When to stop searching a geography

**Stop after THREE enumerated layers come back empty with non-zero denominators** — statewide,
then regional/MPO, then county or city as applicable.

**Three empty enumerations is a finding, not a gap in effort.** Record it as **"publishes at a tier
we do not reach"** together with the item counts, and move to the next target. **Do not run a
fourth layer hoping.**

*(New York is the worked case: statewide 3 rejections → MPO 1 sub-threshold layer → county 713
items / 0 dev services. Three layers, all enumerated, all empty.)*

### When to declare a state out of scope

**Declare `MUNICIPAL_TIER_REQUIRED` and stop, without asking**, when the remaining dark pages need
**more than ~5 separate wires** to close **and** each wire lights **< 20 pages**.

**Precedents: Suffolk NY (10 towns) and Lancaster PA.**

Record the **estimated wire count** and the **per-wire yield** so the decision is auditable, then
move to the next state. **This is not abandonment — it is a scoped finding that the work is a
project rather than a pass.**

### Window choice

**Measure BOTH require-a-date and the 1825 default before choosing, always.**

**For program-class sources (STIP, CIP, capital programs) the relevant date is usually programme
ENTRY, so require-a-date normally wins. Record both numbers either way.**

See **§0h** for the worked case: NJ loses **89%** under a backward 1825-day window because
`PROJ_RECD` is a receipt date on a programme running through FY2033.

---

## §0l-b — CROSS-CHECK EVERY STATUS FIELD AGAINST A DATE FIELD THAT IMPLIES STATE

**§0l's inverse, and they belong together.** In §0l a *date* implied a state that had not happened
(WSDOT's `OperComplete` marked 586 not-yet-built projects as built). Here *dates disprove a state
that is claimed*.

**A status vocabulary can pass every structural check and still not be the status.** Populated,
closed, self-describing, summing exactly to the row count — all four, and wrong.

**The worked case — Prince George's MD DPIE permits, 2026-08-06.** `CASE_STATUS_NAME` sums
**exactly** to 12,231 across four perfectly legible values:

```
APPLICATION ON HOLD, CORRESPONDENCE SENT   7,574
REFERRED                                   4,491
COMPLAINT UNDER INVESTIGATION                141
APPLICATION INCOMPLETE                        25
```

Every completeness test this project runs would bless that. It is not the permit status.
**11,857 of 12,231 rows (97%) carry an `ISSUANCE_DATE` and 11,027 carry a `CLOSE_FINAL_DATE`** —
and the crosstab shows those *same issued-and-closed* rows still reading "APPLICATION ON HOLD."
A permit that was issued and then closed is not an application on hold, so the field describes
internal correspondence routing. **`CASE_MODE_NAME` is the lifecycle** (CLOSED 10,696 · PERMITTED
918 · ABANDONED 328 · APPLICATION 146 · EXPIRED 93 · CANCELED 32 · PENDING 18, also summing
exactly). Mapping the first would have published ~12,000 completed permits as pending.

**The check, before mapping ANY status field:** find a date column whose presence implies a state
(`ISSUANCE_DATE`, `CLOSE_FINAL_DATE`, `issued_date`, `final_date`) and crosstab it against the
candidate status. **If rows carrying that date still sit in a pre-decision status, the field is not
the lifecycle** — look for another column before concluding the source is unusable. Where two
candidate status fields are both complete, the one that contradicts a populated decision date is
the wrong one.

---

## §0l — A POPULATED DATE FIELD IS NOT AN ASSERTION THAT THE EVENT HAPPENED

**Before reading a lifecycle stage from a date column, compare it against `CURRENT_TIMESTAMP`
and count BOTH sides.** A publisher populates the date it *plans* as readily as the date it
*records*. `IS NOT NULL` on a completion date does not mean complete; a date column's NAME is
not a claim about tense, and the field description usually will not say.

**This is the highest-consequence error class the maps work has produced**, because it fails in
exactly the direction the anti-fabrication contract exists to prevent: a page that names a real
project and asserts a stage that has not happened. The record is real, the link is real, the pin
is real — and the sentence is false. No downstream invariant catches it. `record_url` is present,
coordinates are present, the vocabulary is complete, the gate passes. Only the comparison catches
it.

**Three cases, all found by measuring rather than reading the field name:**

| source | field | what reading it plainly would have shipped | what measuring showed |
|---|---|---|---|
| **WSDOT** delivery plan | `OperComplete` | `IS NOT NULL` → "Operationally Complete" → operating, on **1,389** rows | `<= now` **803** · `> now` **586**. A SCHEDULED date — **586 not-yet-built projects marked as built** |
| **CTDOT** work areas | `CurrentADVdate` | the max looked sane, so the field looked clean | `min()` = **1900-01-01**, a **sentinel**, 26 rows |
| **CTDOT** work areas | `CurrentADVdate` | same field, other end | 5 rows in the **year 2222** — data-entry artefacts |

The CT pair is why the rule says *both ends*. Checking `max()` alone passed the field as healthy
while a 1900 sentinel sat in it; checking `min()` alone would have missed the year-2222 rows.
**A date field has two ends and a present moment; a single aggregate characterises none of them.**

### What to do about it

- **Split, do not guess.** Where a date pair implies a lifecycle, write one registry entry per
  slice with **disjoint server-side predicates**, and let the server evaluate them
  (`CURRENT_TIMESTAMP`, never a literal baked at wire time — otherwise the buckets rot silently
  as time passes and nothing reports it). WSDOT ships as three entries on one layer.
- **Drop what no predicate matches.** WSDOT's 191 rows carrying neither date are matched by
  nothing and emit nothing. **A row you cannot place in a stage is not a row you place in the
  most likely stage.**
- **Bound both ends in `extra_where`** where sentinels exist, rather than dropping the records or
  silently keeping absurd dates. CTDOT is bounded `>= 1990-01-01 AND <= 2035-01-01`.
- **The arithmetic reconciles or the design is wrong.** WSDOT 366 + 222 + 803 = 1,391 of 1,582,
  191 unmatched. CT 26 + 5 + 2,124 = 2,155 dated of 2,311.

### The corollary — `RPT_URL`, and why 100% populated proves nothing

**A per-row URL column being 100% populated is not evidence of record precision. Compare the
VALUES across rows before claiming it.** ALDOT's `RPT_URL` is populated on every row of both
grant layers and looks like a per-project link — until two different awarded projects return the
**byte-identical** URL (`…/items/3ffc668341094c66a83eaed7fa6879c2/data`). It is the fiscal year's
Awarded Projects **report**, one per year, not one per project. Both entries are wired
`record_url_precision: "dataset"` despite the column never being empty.

Same failure shape as the date rule: **a field's population rate describes the field, not what
the field means.** Presence is not semantics.

### Consistency note, recorded rather than papered over

ALDOT's **CPMS** layer was rejected earlier in the same pass for "no status field" — and WSDOT was
then wired on exactly that basis, a date pair with no status column. The two calls are
inconsistent as stated. **CPMS is on the reprobe list**, to be re-run with the past/future
comparison against `project_completion`; if it splits the way WSDOT's did, it is wireable and the
rejection was wrong.

---

## §0m — AFTER ANY WIRE, CHECK PAGES MOVED AGAINST RECORDS LANDED

**A wire is not verified by "did records land". Verify it by the RATIO: pages newly lit versus
ZIPs carrying records. A large gap is a DEFECT until explained.**

This is the finding of the 2026-08-05 session, and it is worth its own rule because of how it
presented: **nothing errored.** The deploy was green. The re-cache completed 208 of 208. Records
landed — 129 of them, across 68 ZIPs, every one carrying a `record_url`, correct coordinates, a
complete vocabulary and a passing coverage gate. Every invariant this project checks was zero.

**And the wire had lit exactly ONE page.**

The only signal was arithmetic: **+1 page against 68 ZIPs of records.** No log line, no exception,
no red check. A session that asked "did records land?" — the natural question, and the one every
prior pass had asked — would have reported Arizona closed and moved on.

### The check

After deploy and re-cache, before writing any number into a report:

```
pages newly lit   (app_projects distinct ZIPs, record_kind='development', delta)
ZIPs with records (development_reports rows carrying the new source_registry_id)
```

They will never match exactly — some ZIPs were already lit, some records are legitimately
area-scope. **But 1 against 68 is not a rounding difference, it is a defect.** Investigate before
reporting. The specific cause that produced this one is §0n below; the rule stands whatever the
cause turns out to be.

### Why the usual invariants cannot catch it

`0 missing record_url`, `0 missing coordinates`, `0 unclassified`, `0 out-of-coverage` are all
**per-record** checks, and every one of them PASSED on records that were useless for the purpose.
The defect lives one level up — in whether the records qualify for the rail at all. **A per-record
invariant cannot see a whole-source failure.** That is why the ratio is the instrument.

---

## §0n — A NON-POINT-MAPPED ARCGIS ENTRY MUST DECLARE `lat: "__lat"`, `lng: "__lng"`

`sources/arcgis.ts` sets `returnGeometry=true` **unconditionally**, computes `featurePoint(f)` for
every feature, and writes the result into the **synthetic** columns `row.__lat` / `row.__lng`.
Those columns reach the emitted record **only if `column_map` maps them.**

An entry that maps neither a native lat/lng column nor `__lat`/`__lng` therefore emits records
that **still list, still carry a `record_url`, still render in the list view — and never pin on
any of the three map views, and never count as LIVE**, because `app_projects` is point-scope only.
The record silently degrades to `scope:"area"` anchored at the ZIP centroid.

**This is the Austin `spatial_point_col` failure class: config that looks complete, passes every
unit test, and produces records that do not do the job.**

### Measured instances (2026-08-05 audit of all 147 arcgis entries)

| entry | records | pinned | % | cause |
|---|---|---|---|---|
| `adot-tip-fy2026-2030` | 129 | 1 | 0.8% | found at go-live via §0m |
| `pierce-county-pals-permits` | 13,033 | 2,255 | **17.3%** | found by the follow-up audit |
| `butler-county-ks-permits` | 1,194 | 158 | **13.2%** | found by the follow-up audit |

In all three the layer was **innocent** — each is `esriGeometryPoint` or a polyline serving real
geometry, probed directly. The partial pinning in Pierce and Butler came from the **geocode path**
on their `address` column, which is why they looked alive rather than dead: a wholly-broken source
is easier to notice than a 17%-working one.

### THE DISTINGUISHING CHECK IS ONE FIELD — cheaper and safer than any percentage

**Read the layer's `type` before classifying an entry as a geocode path:**

| layer JSON | meaning | verdict |
|---|---|---|
| `"type": "Table"` with `geometryType: null` | genuinely has no geometry; the address column is the only locator | **real geocode path — correct as configured** |
| `"type": "Feature Layer"` with a `geometryType` | every row carries the publisher's own point | **§0n defect if `column_map` maps neither native lat/lng nor `__lat`/`__lng`** |

**Do not infer the class from a pin percentage.** That inference was made once and was wrong on
three of nine entries: `columbus-building-permits` (91.5%), `bellevue-permits` (91.1%) and
`clark-county-active-dev-permits` (75.0%) were all classified as healthy geocode-path entries on
the strength of an `address` column and a good-looking number. **All three are Feature Layers with
`esriGeometryPoint`. They scored well BECAUSE geocoding mostly works — which is exactly what hid
the defect.** A 91% pin rate on a source that should be at 100% is indistinguishable from a 91%
pin rate on a source that can only ever reach 91%, unless you look at the layer.

One field separates them, it costs one metadata request, and it is decisive where a percentage is
merely suggestive.

### The audit, and the trap in "it has lat/lng mapped"

Two classes exist and both must be checked:

1. **Maps neither** → the defect above. 11 arcgis entries map no lat/lng; **nine are the legitimate
   geocode path** (geometry-less tables carrying an address — the Boulder precedent), measured at
   75%–98.4% point-scope and healthy. Two were defective and are fixed.
2. **Maps NATIVE columns on a non-point layer** → *immune for the wrong reason*. WSDOT pinned
   correctly only because it happens to publish `Longitude`/`Latitude` on 1,582 of 1,582 rows;
   had that column been partially null, the null rows would have degraded silently while the entry
   looked correctly configured. **Audited all 26 native-lat/lng entries by measured point-scope
   share: every one ≥95.8%, only two below 99% (overland-park 95.8%, tempe 97.7% — ordinary null
   coordinates at source). No material instance of this class exists today.**

**Measure the class, do not reason about it.** The instrument for both is the same one line:
point-scope share per `source_registry_id` in the live cache. It catches a wrong config, a null
native column, and a geocode ceiling without needing to know in advance which it is.

---

## §0o — A FIELD'S NAME AND POPULATION RATE DESCRIBE THE FIELD, NEVER WHAT IT MEANS

**Compare a column's VALUES ACROSS ROWS before treating it as an identity or as a per-record
link.** `count(*) where x is not null` answers a question nobody asked. So does the column's name.

Two cases in one session, both of which changed a decision:

- **ALDOT `RPT_URL` — 100% populated, and not record precision.** It looks like a per-project link
  on every row, until two different awarded projects return the **byte-identical** URL: it is the
  fiscal year's Awarded Projects *report*, one per year. Wired `dataset` precision despite the
  column never being empty.
- **ADOT `TRACS` — used as an identity, and it is a LIST.** The overlap between the adopted and
  tentative TIP layers measured **52 of 194** on `TRACS` and **146 of 247** on `TIP_ID` — an
  understatement of nearly 3x. `TRACS` holds a comma-separated set of project numbers
  (`"70124, M722401X,70129,70125,70126,70127,70128"`), so string equality compares list membership
  *and order*. The correct number changed the decision from "wire both layers" to "wire one" —
  wiring both would have double-emitted 146 projects with **contradictory stages on the same page**.

Both are the same error: trusting a field's *shape* as evidence of its *semantics*. It is the same
family as §0l's date rule — a populated `OperComplete` is not a claim that construction finished,
and a populated `RPT_URL` is not a claim that the link is per-record.

**Before using a column as a key, a link, or a stage: pull several rows and look at the values.**

---

## §0p — A PRE-WIRE YIELD PROBE ORDERS CANDIDATES; IT DOES NOT SIZE THEM

**A single-ZIP envelope probe samples ONE 3-mile circle inside a county of thousands of square
miles. Treat its output as an ordering signal and a floor test, never as a forecast.** This is a
limit of the instrument, not a failure of it — the probe is still the right tool for deciding
*whether* a source clears the wire floor.

**Measured wrong in BOTH directions, one week apart:**

- **WSDOT over-predicted by ~25%.** Probes said Auburn 98001 = 25; the deployed engine emitted 19.
  The probe counts raw layer features in a bare envelope; the connector then applies its own
  paging, dedup and column projection.
- **ADOT under-predicted, including two false zeroes.** Probes returned **0** at Sierra Vista
  (Cochise) and **0** at Prescott (Yavapai). The wire lit **5 and 7** pages in those counties. The
  county seat simply had no capital project inside its own 3-mile circle.

**A zero at the county seat is not a zero for the county.** Where a probe returns zero but the
source's own county vocabulary shows records in that county, the honest read is "not at this
centroid", and the decision should rest on the vocabulary, not the probe.

---

## §0q — THE SCOREBOARD IS TWO NUMBERS: COVERAGE **AND** COMPLETENESS

## §0y — COVERAGE IS SUPPLY-LIMITED. STOP MUNICIPAL DISCOVERY. (founder ruling, 2026-08-06)

**PROJECT-LEVEL FINDING — inherit this, do not re-test it.**

At **~67% of reachable coverage**, the remaining dark pages are predominantly places whose
**jurisdictions do not publish a per-record development source in machine-readable form.** That is
a fact about American local-government data, not a gap in this work.

**The evidence is three passes, and they converge:**

| pass | targets | wires |
|---|---|---|
| 2 — six ranked thin counties | 6 | 0 |
| 3 — DOT-tier states' capitals + never-probed metro heads | 9 | 0 |
| 4 — six DOT-wired states with a real metro | 7 | 1 |
| **total** | **22** | **2** |

**And both wires came from places already on the board** — Anne Arundel already had a DOT wire and
a modelled county; Burlington's state already had VTrans. **Neither came from unexplored
territory.** Every rejection carries an enumeration receipt: a DCAT/Socrata/CKAN catalog parsed in
full with its dataset count as control, or an `owner:`-scoped enumeration with its total as control.

**Do not run a fourth municipal-discovery pass.** The next session inherits this as settled. If
municipal discovery is ever reopened it needs a *new instrument* — a vendor-level adapter
(Accela/Tyler/OpenGov/CivicPlus portal APIs discovered by pattern rather than per-city catalog
hunting), not another city list.

**What this does NOT say:** it does not say the project is finished, and it does not say the
remaining dark pages are worthless. It says **the marginal municipal source does not exist to be
found by catalog search**, so effort should move to the levers below.

---

### ⭐ THE SCOREBOARD IS THREE NUMBERS, AND THE REACHABLE CEILING LEADS

**Coverage against the total is the number most likely to be misread.** Anyone who sees 52% and
does not also see the ceiling will conclude there is roughly half the project left. There is not.

**Report all three, in this order, on every close from 2026-08-06 onward:**

| # | number | today |
|---|---|---|
| 1 | **coverage against REACHABLE** — the number that says how far along we actually are | **6,667 / ~10,007 = ~66%** |
| 2 | coverage against TOTAL — the pinned national figure, unchanged | 6,667 / 12,722 = **52.41%** |
| 3 | the honest-empty FLOOR — pages no wire can ever reach | **~2,715 (21%)** |

`reachable = 12,722 − floor`. **We are about two-thirds done, not about half.** The 26-point gap
between #1 and #2 is entirely geography, and stating #2 alone has repeatedly invited the wrong
conclusion about how much work remains.

Recompute the floor when the model changes (a ZIP-radius change or a new statewide source moves
it); do not carry these figures forward as constants without re-measuring.

---

### THE FLOOR — a permanent honest-empty population. State it, do not re-discover it.

**~2,700 pages can never be reached by any wire, and that is a correct terminal state, not a
backlog.** Measured 2026-08-06:

| population | pages | why no wire reaches it |
|---|---|---|
| dark pages in counties that ALREADY have a source | **2,240** | the source covers the county; no record falls inside this ZIP's 3-mile circle |
| thin pages in counties that ALREADY have a municipal source | **475** | same — the ledger works, the envelope is empty |
| **total permanent honest-empty floor** | **~2,715 (21% of 12,722)** | |

These are rural and low-density ZIPs whose county is already served. Wiring another source for
that county cannot change them, and **re-wiring the source that already covers them is the exact
mistake the Dane pass made** (Madison was re-wired against 19 rural pages it could never reach).

**Quote the floor whenever you quote coverage.** A future session that sees 47.6% dark and reasons
"there are 6,055 pages to win" will spend a pass rediscovering that 2,240 of them are honest
empties. The reachable ceiling is not 100% — on today's model it is roughly **79%**, and the gap
is geography, not effort.

---

**Report both on every state close, from 2026-08-05 onward.** Page count saturates at ONE record:
a page lit by a single geocoded permit and a page carrying three hundred parcel-precise filings
are indistinguishable in every coverage number this project has ever produced.

That is not a hypothetical. The Pierce fix recovered **11,791 records** from listed-but-unpinned
to pinned and moved the page count by **+2**, because the geocode path was already supplying the
one record each page needed to count as lit. **The coverage metric was never wrong; it was
answering a different question than the one that matters to a resident looking at the map.**

### The two numbers

**COVERAGE** — distinct ZIPs in `app_projects` with `record_kind='development'`, over 12,722.
Unchanged; still the pinned national figure.

**COMPLETENESS** — the distribution of records per lit page:

```sql
with per_page as (
  select zip, count(*) n from public.app_projects
  where record_kind='development' group by zip
)
select count(*) lit_pages,
       percentile_disc(0.5) within group (order by n) median,
       percentile_disc(0.1) within group (order by n) p10,
       count(*) filter (where n = 1)  pages_with_exactly_1,
       count(*) filter (where n < 5)  pages_under_5
from per_page;
```

**National baseline, 2026-08-05:** 5,856 lit pages · 2,770,758 records · **median 62 · p10 2 ·
425 pages lit by exactly ONE record · 1,128 pages under 5 (19.3% of lit pages).**

**Read them together.** Coverage rising while p10 stays at 2 means new pages are being lit at the
thinnest possible margin. A p10 of 2 with a median of 62 is a thirty-fold spread — the state
summaries have been reporting the top of that range and the bottom has been invisible.

### Verify any suspiciously round statistic before reporting it

**A round number at a percentile or boundary is where a silent cap hides.** `p90 = 1000` on records
per page is the shape a materializer limit would take, and it would have been reported as a real
distribution. The check is two counts either side of the round value: 585 pages sit above 1000 and
44 land between 1001 and 1100, so no cap exists and the figure is genuine. **Cheap, and the
alternative is publishing an artefact of the pipeline as a fact about the data.**

*(Control run with the baseline: p90 came back as exactly 1000, which looks like a materializer
cap. It is not — 585 pages sit above 1000 and 44 land between 1001 and 1100. Checked, because a
suspiciously round number at a percentile boundary is exactly where a silent cap would hide.)*

---

## §0u — CHECK THE `owner` BEFORE THE SCHEMA

**A search hit's title tells you what the data is about. Only `owner` tells you who published it.
Read `owner` first — before the schema, before the row count, before the freshness probe.**

**A consultancy-owned copy of a public register is not a first-party source**, and it may be a
snapshot of any vintage: consultancies publish to support a specific study or contract, then stop.
The register it was copied from may have moved, changed schema or been superseded, and nothing in
the copy will say so.

### The worked case — Indiana

A plain `INDOT` search returns **776 items**. Its four most project-shaped hits:

| item | owner | what that is |
|---|---|---|
| `INDOT Projects` | `arcgis_svc` | a service account, 3 rows, last modified **2016** |
| `TIP_Point` / `TIP_Links` | `MinaeiN_cdmsmith` | **CDM Smith** — private engineering consultancy |
| `CR Projects` / `CR_Projects_view` | `ewilder@hntb.com_HNTBCorp` | **HNTB** — private engineering consultancy |
| `Community Crossings 2021 Round 2` | `rmlawson2` | an individual, one grant round |

**Every one ranks highly because the string "INDOT" appears in its metadata.** None is published by
INDOT. INDOT's own account (`*@indot.IN.gov_indot`) publishes 42 services and **not one of them is
a project register** — a fact entirely invisible from the unscoped search, which looks like it
found four candidates.

### This is the ownership sibling of the geography lookalike

The known trap is **geographic**: `Sussex` (NJ) → Sussex County **Delaware**; `Brookhaven` (NY) →
Brookhaven **Georgia**; `Kent` → Delaware/Rhode Island; `chester` (NJ/Morris) →
`Chesterfield_County` **Virginia**; a Calgary `Building_Permits` surfacing for three Washington orgs.
Those are caught by confirming the entity from CONTENTS.

**This one is not geographic at all** — CDM Smith's `TIP_Point` really is Indiana data. It is the
*publisher* that is wrong, and content-confirmation will happily pass it. **Contents confirm the
PLACE; only `owner` confirms the PUBLISHER, and the registry's first-party requirement is about the
publisher.**

### The check, in order

1. **`owner`** — is it the government body itself? A `*@<agency>.<state>.gov_<org>` account, a
   recognised city/county GIS account. Not a consultancy, not a service account, not an individual.
2. **Then** scope the enumeration to that owner or org and read what they actually publish —
   which in Indiana's case is what revealed `NO_DOT_PROJECT_REGISTER`.
3. **Only then** schema, row count, vocabulary, freshness.

**Doing this in the wrong order costs a full evaluation of a source that was never eligible** — and
worse, can end with wiring a consultancy's frozen snapshot as if it were the live public register.

---

## §0v — A ZERO FROM AN EQUALITY TEST ON A STRING COLUMN IS NOT A FINDING UNTIL YOU HAVE TRIED `LIKE`

**Twice now this has hidden a state's largest dark county.** Government string columns are
routinely stored padded, suffixed or qualified, and `=` against the value you expected returns a
clean, confident, completely wrong **zero** — which reads as "this source has nothing here" and
ends the investigation.

| case | the query | returned | the truth |
|---|---|---|---|
| **Box Elder** | `county = 'Box Elder'` | **0** | stored as `'Box Elder County, UT'` — **84** feeds |
| **WisDOT Milwaukee** | `COUNTY = 'MILWAUKEE'` | **0** | stored right-padded to 30 chars — **94** projects |

The WisDOT case is the sharper one: **Milwaukee is the largest dark county in the state**, and that
zero, taken at face value, would have killed the wire for the whole of Wisconsin's biggest metro.
The wire went on to light 36 of 36 Milwaukee pages.

**The rule:** before a zero from a string equality test becomes a finding, re-run it as
`LIKE 'value%'` (or `LIKE '%value%'` when the qualifier may be a prefix). If the two disagree, the
column is padded or qualified and every prior equality test against it is suspect.

**This is the wrong-zero class from the claims-discipline rules, in its most common concrete form.**
A zero is the most dangerous result because it reads as clean and ends the search — and a padded
column produces one indistinguishable from a real absence. Note that it usually affects **RECON
only**: the arcgis connector trims both sides (the Harris County precedent), so production would
have been fine. The damage is entirely to the DECISION about whether to wire.

---

## §0x — A SEARCH WHOSE RESULT COUNT SATURATES HAS RANKED NOTHING

**Check the count before you read the first result. It is cheaper than any result, and it is the
tell.** When a search returns a round ceiling — ArcGIS Online's `total: 10000` is the one this
project hits — the query matched essentially the whole public corpus. The engine then returns
*something* at the top, and that something is **noise wearing the shape of an answer**.

**The worked case, 2026-08-06.** Two unscoped AGO searches in one batch:

```
q="Manchester NH" OR "Nashua NH" building permits   → total: 10000, top hit: Building Permits ~calgary.ca
q="Bismarck" OR "Fargo" building permits            → total: 10000, top hit: Building Permits ~calgary.ca
```

**The same Calgary layer, top-ranked for two different states 1,500 miles apart.** Neither result
had anything to do with the query; the `10000` was visible before either was read. The same batch
returned Wichita's *suburbs* (Goddard, Maize) for "Wichita permits", medical-marijuana
*dispensary* maps for "Tulsa permits", and a personal account for "Omaha permits".

**The rule:** an unscoped keyword search is a **lead generator, never evidence**. A rejection may
only be written from one of two things:

1. an **`owner:` / `orgid:`-scoped enumeration** with its own total as the positive control, or
2. a **machine catalog parsed in full** — DCAT, Socrata `views.json`, CKAN `package_search` —
   with the dataset count reported as the control.

This is the ArcGIS-specific lookalike warning generalised, and hardened: the earlier version said
*scope your query*. This one says **the saturated count is a detectable failure signal you can
read for free**, and a top hit drawn from a saturated result set is worth nothing regardless of
how plausible its title looks.

---

## §0w — `NO_LIFECYCLE_VOCABULARY`: A STATUS COLUMN THAT ENCODES SOMETHING OTHER THAN LIFECYCLE

**A column named `status`, 100% populated, whose values sum exactly to the layer count, can still
carry no status.** This is §0o's sharpest instance: name and population rate describe the field,
not its meaning — and every cheap completeness check passes while the field is unusable.

**The worked case — Rhode Island STIP, 2026-08-06.** All 15 layers carry a status column (9 as
`ProjectStatus`, 6 as `ProjectSta`), every one 100% populated, every one summing **exactly** to its
layer's `returnCountOnly`. Every value is a full English sentence restating the funding year:

```
"This project had been included in the STIP 18-27 for funding in FY2018"   (layer 13, n=31)
"This bridge had been included in the STIP 18-27 within Bridge Group 07,
 funding in FY2026"                                                        (layer 5,  n=40)
```

That is the `FY2018…FY2027` funding columns rendered as prose. There is **no proposed / approved /
operating distinction anywhere in the vocabulary**, so no value can be bucketed without inventing
one. Layer 5 has 153 distinct values and not one of them is a lifecycle state.

**Distinguish it from the neighbouring disqualifiers, because the remedy differs:**

| disqualifier | shape | example |
|---|---|---|
| opaque-coded | legible-to-the-publisher code, meaning unknown to us | San Jose `"30"` on every row |
| `NO_LIFECYCLE_VOCABULARY` | perfectly legible, and still not a lifecycle | RI `"…funding in FY2018"` |

An opaque code might be resolvable from a published domain. A non-lifecycle vocabulary cannot be —
the information simply is not in the dataset.

**The corollary that matters most: this is the test AK and HI actually passed, and it is not
`NO_TEMPORAL_FIELD`.** RI was originally rejected for having zero date-typed fields, citing AK as
precedent. That precedent inverted the same session — AK and HI were both wired with **no
`file_date` at all** (it is optional; five wired entries omit it). Had the date test been the real
one, RI would have been wired on the overturn. It stayed rejected because AK's `Status`
(Approved / Draft / Retired / Archived) and HI's `currentphase` (Design / Construction / Planning /
Right of Way) are real lifecycles and RI's is a funding year. **Same test, three states, two
outcomes.** When a rejection is overturned, re-derive every rejection that cited it as precedent —
the original may have reached the right verdict by the wrong route.

### The instrument that hid it: a pattern search that misses a TRUNCATED column name

The original RI pass concluded "no status column exists" from a schema scan filtering
`name ilike '%stat%'`. Six of the 15 layers name the column **`ProjectSta`** — ArcGIS truncates
field names, and `ProjectSta` does not contain the substring `stat`. The filter returned a
confident, clean **absence** for 6 of 15 layers, and nothing about the result announced that the
pattern rather than the data produced it.

**The rule: when a pattern search over field names returns nothing, the pattern is a suspect before
the data is.** Government schemas truncate (`ProjectSta`, `Municipaliy`, `PRJ_TYPE` vs
`PROJ_TYPE`), abbreviate, and misspell. Enumerate the FULL field list for at least one layer of
each schema family and read it, rather than trusting a substring filter to have found everything.

This is §0v's sibling — the equality-vs-`LIKE` wrong zero — one level up: **§0v is a wrong zero
from the values, this is a wrong zero from the column names.** Both produce success-shaped output
while attesting to nothing, and both end an investigation early.

---

## §0t — A RATIO THAT EXCEEDS ITS OWN DENOMINATOR IS A QUERY DEFECT, NEVER A FINDING

**Re-derive before reporting. The usual cause is a join fan-out.**

A share cannot exceed 100%. When one does, the query has multiplied rows somewhere — typically a
join to a table with more than one row per key, or an aggregate counting the joined rows rather
than the distinct subjects.

**The worked case:** the first `DOT_ONLY` measurement reported **CT at 244% DOT-only** — 254
DOT-only pages against 104 lit. Impossible on its face, and *that impossibility is the only reason
it was caught*. The same fan-out landing at 47% would have published silently and become a stamped
governance fact.

The fix was `distinct` on the ZIP list plus filtering the aggregate to lit pages. Rewritten, CT
came back at **82%** — still a `DOT_ONLY` state, but the number that would have been published was
three times the truth.

**The general form of the risk:** an out-of-range value is a *lucky* defect, because it announces
itself. Assume that for every ratio that visibly breaks its bounds there are others in range and
equally wrong. **Sanity-bound every computed share** — against 100%, against the denominator,
against a known control — as a matter of course, not only when a number looks odd.

---

## §0r — MEASURE THE SYMPTOM ACROSS THE WHOLE POPULATION BEFORE PROBING ANY CANDIDATE'S CONFIG

**When one query can measure the symptom across every member of a class, run that query instead of
inspecting candidates one at a time. It finds causes you did not think to look for.**

The instrument that found all five `__lat`/`__lng` defects was one line — point-scope share per
`source_registry_id` in the live cache. It required no hypothesis about *why* a source might fail:
it catches a missing geometry mapping, a partially-null native column, and a genuine geocode
ceiling identically, as a number, and lets the causes separate themselves afterwards.

The alternative — probing 26 registry entries' metadata endpoints to check their `geometryType` —
would have cost 26 round trips, tested only the one cause already in mind, and **would have missed
Pierce entirely**, because Pierce's config looked fine under every check except the one that
counted what it actually produced.

### A GUESSED ORG ID RETURNS A REAL 200 FOR SOMEONE ELSE'S DATA

**Read the service NAMES before believing a 200 from a host or org id you guessed.** Probing
`services.arcgis.com/hRUr1F8lE8Jq2uJo` as a guess at St. George returned **HTTP 200 with 370 KB of
genuine services** — `Azerbaijan_Buildings`, `Grenada_Buildings`, `DC_3D_Monuments`,
`Coronavirus_Cases`, `Esri_US_Campus_Buildings`. A real organisation, real content, **wrong
entity.**

This is harsher than the known `<guess>.maps.arcgis.com` generic-portal trap, where the 200 is
empty and obviously wrong. Here it is **full and plausible**: a service list of that size reads as
a successful discovery, and the next step — filtering it for permit-shaped names — will happily
return matches from the wrong publisher. **The status code tells you a server answered. Only the
content tells you whose.**

### The corollary, learned the hard way in the same audit

**A healthy-looking percentage is not proof of a healthy mechanism.** The first pass over the
eleven no-lat/lng arcgis entries classified nine as "the legitimate geocode path, 75%–98.4%,
healthy". That was an inference from an `address` column plus a good-looking number, **not a
measurement of the layer** — and it was wrong for three of them. `columbus-building-permits`
(91.5%), `bellevue-permits` (91.1%) and `clark-county-active-dev-permits` (75.0%) are **Feature
Layers with `esriGeometryPoint`**, carrying the publisher's own parcel point on every row. They
scored well *because geocoding mostly works*, which is precisely what hid the config bug.

**The distinguishing check is one field: `"type": "Table"` (`geometryType: null`) is a real geocode
path; `"type": "Feature Layer"` with a `geometryType` is the §0n defect.** Final split of the
eleven: **five defective** (pierce, butler, columbus, bellevue, clark-county-active-dev) · **six
genuine Tables** (virginia-beach, naperville, boulder, worcester, anaheim, hartford).

So: measure the population, then verify the mechanism on every member you are about to clear —
**"it scored well" is a reason to look closer at a class you already know can fail silently, not a
reason to stop.**

---

## §0s — `DOT_ONLY`: A STATEWIDE DOT WIRE BUYS COVERAGE, NOT NECESSARILY DEPTH

### THE STRUCTURAL FACT — read this before anything else in this section

**A DOT wire and a permit wire are not substitutes. They are different products.
Coverage comes from one, completeness from the other.** Measured nationally across the entire
lit population, 2026-08-06:

| dominant source class | lit pages | **median records** | % under 5 records |
|---|---|---|---|
| DOT / transport project register | 3,404 | **8** | 37.9% |
| municipal permit / land-use ledger | 3,202 | **252** | 6.4% |

**A 31× median gap**, and **1,290 of the 1,496 thin pages (86%) are DOT-dominated.** This is not a
discovery problem and not a handful of weak entries — it is a property of what the two source
classes *are*. A state DOT publishes a few hundred to a few thousand programmed projects for an
entire state; a single city publishes tens of thousands of permits a year.

**The operative consequence: THE FIX FOR A THIN PAGE IS NEVER A BETTER DOT ENTRY.** Do not re-probe
the DOT layer, do not widen its radius, do not loosen its status buckets. Add the municipal tier
underneath it. A county sitting at a low median with a DOT layer as its only source is not
under-configured — it is correctly configured and missing a second, different product.

Worked proof, same day: **Anne Arundel MD** was DOT-only (`mdot-sha-project-portal`) at 27/37 pages
lit, **median 2**, 92 records total. Wiring the county's own two planning registers took it to
**37/37 lit, median 254, 10,784 records, 0 pages under 5** — a 127× median gain with the DOT entry
untouched.

---

### The corollary: a COUNTY-level thin count conflates two populations

**Rank municipal-tier targets on the thin pages INSIDE a municipality, never on the county total.**
A county's thin count sums two groups that need different remedies and that a single source can
never both serve.

Worked case — **Dane County WI, 2026-08-06**, which was ranked the #1 thin county at 20 pages under
5 records, and turned out to need no wire at all:

| Dane pages | count | median records | pages under 5 |
|---|---|---|---|
| carrying City of Madison records | 20 | **140** | **2** |
| WisDOT only | 26 | **3** | **19** |

**19 of the 20 thin pages are rural ZIPs outside the city ledger's 3-mile envelope**, and Madison
was *already wired*. Ranking on the county total pointed at a county whose municipal tier was
complete and whose real gap is geographic. Inside the municipality the municipal tier is the answer
and may already be in place; outside it no city ledger can reach, and the remedy is a county- or
township-level source — or honest acceptance that rural pages carry the DOT layer plus the EPA
floor.

---

### NEVER ADD AN ENTRY WITHOUT CHECKING WHAT IS ALREADY FETCHING THAT LAYER

**`registry_id` uniqueness is the WRONG KEY, and asserting it gives false confidence.** It says
nothing about what an entry *fetches*. Two entries on the same `service_url` with overlapping
coverage double-emit every record on every shared page, and **exact-identity dedup cannot save you**
— the copies carry different `source_registry_id` values (the same reason
`houston-plat-applications` layer 0 was rejected as a proven subset of layer 1).

*The case that produced this rule:* a municipal-tier pass added
`madison-current-planning-projects` when `madison-planning-projects` — same URL, same `{WI, Dane}`
coverage — was already in the registry. The additivity script asserted the new id was unique and
passed. The **deploy-verification probe** caught it: two run-reports against the identical
`service_url`, each emitting ~228 records. Reverted before any re-cache; nothing reached production.

**The rule:** two entries may share a `service_url` ONLY when each carries a distinct, non-empty
`extra_where` — i.e. deliberate disjoint slices of one layer (the
`wsdot-project-delivery-plan-{proposed,under-construction,complete}` trio is the legitimate case).
**Enforced** by `test/registry-duplicate-service-url.test.mjs`, which carries a positive control
asserting it still sees a sliced group so it cannot pass vacuously, and which was verified to FAIL
on the exact injected duplicate.

**And the wider lesson: this is why the deploy-verification probe is not optional.** Nothing in the
config, the diff, the additivity assertions or the unit suite showed the defect. Only reading the
connector's own run-report did.

**Reverting is not the end of it — the scheduled refresh does not stop for a deploy.** The first
account of this incident said "reverted before any re-cache, so nothing reached production." That
was reasoned from *no manual re-cache having been run*, which is a different question, and it was
wrong: pg_cron fired during the ~18 minutes the bad entry was live and contaminated 3 cached pages.

Worse, **a response FIRED during the bad window is still poison when COLLECTED after it** —
`dev_refresh_collect()` writes whatever is sitting in `net._http_response`, so one page was
contaminated at the *same timestamp as the fix*. **After reverting a bad registry deploy: flush the
collector, re-check, and only then call it clean.** A single pass reports clean while contaminated
responses are still queued behind it.

---

**A statewide DOT layer is the right first move in a dark state (§0c) and it is not a substitute
for permit sources.** A highway programme touches many ZIPs with a few records each; a city permit
ledger touches fewer ZIPs with hundreds. Both are real; they are not interchangeable, and
**"state closed" has meant two different things depending on which one carried it.**

**Stamp a state `DOT_ONLY` when ≥80% of its lit pages have a DOT layer as their ONLY source**, and
always report its median alongside. The stamp is a statement about **source composition**, not a
verdict — it exists so a future session reads the state correctly instead of inferring depth from
a coverage percentage.

### Measured 2026-08-05 — and the "DOT means shallow" generalisation is only PARTLY true

| state | lit | DOT-only | % | **median** |
|---|---|---|---|---|
| ME | 171 | 171 | **100%** | **2** |
| NJ | 164 | 164 | **100%** | **3** |
| VT | 113 | 113 | **100%** | **2** |
| IA | 60 | 60 | **100%** | **2** |
| MA | 624 | 560 | **90%** | **68** |
| UT | 109 | 93 | **85%** | **3** |
| FL | 378 | 319 | **84%** | **8** |
| MI | 287 | 237 | **83%** | **11** |
| CT | 104 | 85 | **82%** | **76** |
| WA | 338 | 179 | 53% | 20 |
| TX | 666 | 288 | 43% | 75 |
| NV | 139 | 59 | 42% | 28 |
| AZ | 224 | 68 | 30% | 139 |
| AL | 34 | 9 | 26% | 796 |

**`DOT_ONLY` (≥80%): ME · NJ · VT · IA · MA · UT · FL · MI · CT.**

⚠️ **Two corrections the measurement forced, both against the intuition:**

1. **MA (90%, median 68) and CT (82%, median 76) are DOT-dominated AND DEEP.** MassDOT and CTDOT
   are dense programmes in small, dense states, so a 3-mile envelope catches many projects. **DOT
   does not imply shallow** — it implies *project density per unit area*, which is a property of
   the state, not of the source class. ME / VT / IA / UT sit at median 2–3 because their DOTs
   cover huge rural areas thinly.
2. **AL is NOT `DOT_ONLY` — measured 26%, median 796.** It was closed on two ALDOT grant
   programmes, but those added only **9** pages to a state already carried by
   `huntsville-building-permits`. **WA (53%), TX (43%), NV (42%) and AZ (30%) are likewise mixed,
   not DOT-only**, despite the DOT wire being the headline of their pass.

**So do not infer the stamp from "which wire closed the state" — the wire that made the headline is
often not the source carrying the pages. Measure the share.**

### ⚠️ A HIGH MEDIAN ON A LOW LIT COUNT MEANS ONE DEEP CITY, NOT A HEALTHY STATE

**Read the two numbers together or the second one lies as readily as the first.** AL's median of
**796** is the highest in the country and AL is **not** a well-covered state: only **34 of its 262
pages are lit**, and those 34 are Huntsville/Madison, which carry deep municipal permit ledgers.
The median describes *the pages that exist*, so a state with a handful of dense metro pages and
nothing else scores higher than a state with broad, honest, moderate coverage.

Same shape elsewhere: **WI median 140 on 20 lit of 211** and **KS median 2,202 on 76 lit**. Against
that, **OH's median 186 on 136 of 335** is a genuinely deep state, and **MI's median 11 on 287 of
360** is a genuinely broad shallow one.

**So the pair is: coverage says how much of the state exists, completeness says how good the
existing part is — and NEITHER is a summary of the other.** A high median with a low lit count is a
flag to look at *which* pages are lit, not a result to celebrate.

*(This was nearly mis-called: AL's 796 was initially flagged as implausible alongside a genuinely
broken 244% figure in the same query. Distrusting it was right — one of the two numbers WAS a
defect — but the resolution differed: the 244% was a join fan-out, the 796 was real and simply
measuring something other than what was assumed. **Verify a suspicious number; do not assume
suspicion means defect.**)*

### 🔑 THE WORKED CASE — WISCONSIN, WHERE THE DILUTION WAS WATCHED HAPPENING

**Before the WisDOT wire: 20 lit pages, median 140.** All of them Dane County/Madison, carried by a
deep municipal permit source. **After: 198 lit pages, median 6.**

The median did not fall because anything got worse. **178 thin DOT pages joined 20 deep permit
pages and the median moved to where the mass now is.**

- **Coverage alone reads this as an unqualified win** — +178 pages, 9.5% → 93.8%, the largest
  single-state gain of the run. That reading is *correct*.
- **Both numbers say what actually happened** — Wisconsin went from a **one-deep-city state** to a
  **broad-and-shallow `DOT_ONLY` state**, and its next unlock is Milwaukee municipal permits, which
  would raise the **median** far more than the page count.

**Neither reading is wrong; only one is complete.** This is the cleanest demonstration of why the
scoreboard is two numbers, and it is the only case so far where the dilution was *observed as it
happened* rather than inferred from a cross-section of already-closed states.

### The instrument

```sql
-- share of a state's lit pages whose ONLY source is a DOT layer
bool_and(s->>'source_registry_id' in (<dot list>))  -- per zip, over development_reports
```

⚠️ **Write it with `distinct` on the ZIP list and the aggregate filtered to lit pages.** The first
version of this query fanned out on the join and reported **CT at 244% DOT-only** — impossible on
its face, which is the only reason it was caught. A fan-out that lands under 100% would have
published silently. **Any share that can exceed its own denominator is a query to re-derive, not a
finding.**

### What the stamp means for the queue

A `DOT_ONLY` state with a low median is **broad and shallow: correctly closed, not finished.** Its
next unlock is municipal permit sources, and that work will move the **median** far more than the
**page count** — the §0q asymmetry, and the reverse of the Pierce case. A `DOT_ONLY` state with a
high median (MA, CT) needs nothing further on this axis.


---

## §0z — A DRAFTED MAPPING IS A HYPOTHESIS UNTIL EVERY KEY IS BYTE-VERIFIED PRESENT (2026-08-06)

**Rule.** A `type_map` / `status_to_bucket` written from domain knowledge — from what a permit
vocabulary *usually* contains, from a brief, from a plausible zoning lexicon — is a **hypothesis**.
It becomes fact only when **every key** is confirmed present in the live vocabulary, enumerated
from the source itself. Draft freely; commit only what was read.

**Why this class survives, and why it is invisible.** A key that matches nothing is **harmless at
runtime**. It never errors, never warns, never appears in a run report, and never changes a
rendered page. `type_map` is a lookup: a value the source does not emit simply never arrives to be
looked up. So a mapping can be 20% invented and every instrument stays green. **Dead keys are only
ever visible if you go looking for them** — which means the check has to be deliberate, before the
commit, or it does not happen at all.

**The check.** Enumerate the live vocabulary (`groupBy` counts, or `returnDistinctValues`, or
Socrata `$group` paged to exhaustion), then assert **set membership in BOTH directions**:
1. every `type_map` key exists in the live vocabulary → no invented keys;
2. every live value with meaningful volume exists in `type_map` → no silent unclassified mass.
**The arithmetic control that makes it binding: the mapped counts must SUM EXACTLY to the layer
count** (minus explicitly-failed-closed values, named). An exact sum cannot be reached with an
invented key in the set, which is why this project keeps stating sums rather than percentages.

**Precedents in this repo, all real:**
- **Phoenix** — the brief said "250+" `PER_TYPE_DESC` values; the live enumeration returned
  **238**, summing exactly to 70,791. Writing to the brief's number would have shipped invented keys.
- **Mesa** — Socrata group-by is silently truncated by `$limit`; the missing S–Z page carried
  Single Family (Detached) 18,461+12,555. A vocabulary read once, unpaged, is a partial hypothesis
  wearing the costume of a complete one.
- **Burlington (my own)** — the entry's `_receipts` asserted "no bounded vocabulary; free prose."
  Nobody had enumerated the field. `PrimaryLUC` is a 27-value self-describing vocabulary, ~97%
  populated. **An absence claim is a hypothesis too, and this one was wrong for 17,256 records.**
- **York County PA** — the inverse error, made by a CHECK rather than a mapping: a guard asserted
  `type_source` must be a string and flagged York as broken. Its `type_source` is an eight-column
  array that `readCol` JOINS (`arcgis.ts:791`), and its 32 keys are exactly the joined strings
  (`'NO NO NO NO NO NO YES NO'`). **The entry was correct and the instrument was wrong** — caught
  only by opening the entry instead of trusting the failure. A red check is a hypothesis too.

**Corollary — the same standard binds a claim of ABSENCE.** "This layer has no usable type column"
requires the field list, read. `clv-planning-cases` is genuinely typeless (21 opaque application
codes, `"domain": null` on both candidate fields, no published legend) — that verdict is
admissible *because the fields were enumerated*, not because the shape looked familiar.


### §0z-b — A REGISTRY SIZE QUOTED FROM MEMORY IS STALE BY CONSTRUCTION

**Three different registry counts were quoted in a single session — 151, 156, 183 — and only the
last was measured.** The registry grows across passes, so any count carried forward from an earlier
message is describing a file that no longer exists.

- **151** — correct several passes earlier, then repeated after the file had grown.
- **156** — measured, but by a traversal that required `service_url`, so it silently excluded every
  socrata/ckan/csv/carto entry. **Wrong by 27 (15%)** while looking freshly measured, which is worse
  than quoting from memory because it carries a receipt.
- **183** — measured against the current branch, collecting on `registry_id` alone, all platform
  families included.

**Rule.** Never state a registry count, an entry count, or a coverage total without recomputing it
in the same message. And when you do recompute, **key on `registry_id` alone** — any additional
required field is a platform filter in disguise. The traversal that produced 156 is the one to keep
in mind: an instrument can be freshly run and still under-cover, and a bare total is exactly the
shape of result that hides it. Pair every count with a **composition control** (entries by
`platform`, or a non-arcgis subtotal) so under-coverage is visible in the same output.

*This is the counting case of "an instrument must prove it ran over what you think it ran over."*


### §0z-c — A CHECK SATISFIED IN THE WRONG EVENT CONTEXT IS NOT SATISFIED

Branch protection requires a status check **by name AND by the event that produced it**. A green
`unit` from a `workflow_dispatch` run does not satisfy a required `unit` that protection expects
from `pull_request`, even on the identical SHA with identical results.

**The sequence that produced this (2026-08-06), because each step looks reasonable alone:**
1. A commit was pushed **during** a GitHub Actions incident in which the repo created **no workflow
   runs at all** for ~5.7 h. No `pull_request` run was ever created for that SHA.
2. When runners recovered, the gate was confirmed by **dispatching** `unit-tests` manually — the
   correct way to test whether runners were alive, but it registers the check under
   `workflow_dispatch`.
3. **GitHub does not retroactively create the event it skipped.** The missed `pull_request` run
   stays missed.
4. Closing and reopening the PR did **not** fire one either.

**The fix, and the trap inside the fix:** the event must be re-fired by a push — but
`pull_request` triggers here carry `paths:` filters, and **an empty commit touches zero paths, so
it matches no filter and fires nothing.** A `--allow-empty` commit is the instinctive move and it
is inert against a path-filtered workflow. The commit must touch a path the workflow actually
watches.

**Corollary for the recovery runbook:** after any incident in which runs were not created, every
PR whose head was pushed during the window needs its check re-fired by a path-touching commit.
Merging is blocked until then, and the PR will read `mergeable: true, mergeable_state: blocked`
with a green check of the same name visible on the SHA — a state that looks like a GitHub bug and
is not one.

**How to tell a DROPPED event from a DELAYED one, before spending a retry push.** During recovery
both look identical — no run for your SHA — and pushing again into a backed-up pipe just queues
more work behind the same jam. The discriminator is **whether an OLDER SHA's event has since
arrived**:
- Nothing delivered anywhere in the repo → the pipe is **down**. A retry buys nothing. Wait.
- An older SHA's events arrive and yours does not, minutes later → the pipe is **up** and yours was
  **dropped**. Now a retry is the right move.

*Measured 2026-08-06.* The queue drains **in order**, so an older push arriving is proof delivery
resumed: `f72ae4c` (pushed 21:47Z, during the outage) had its `pull_request` runs created at
23:10:45Z — **83 minutes late, and green**. `8b76de1` (pushed 22:54Z) had still produced **zero**
check runs 33 minutes after that, so its event did not survive. Checking `runs?per_page=N` for any
**non-`workflow_dispatch`** event is the cheap test — dispatch runs are created through the API and
keep working throughout, so counting all runs hides the outage entirely.

---

## Rule 17 — when a status WORD and a DATE disagree about whether something happened, the DATE is the better evidence

**A lifecycle bucket derived from a word alone is an unverified claim.** Status vocabularies are
written by permit clerks for permit clerks; they say what stage a *file* is at, not what exists on
the ground. A date says an event occurred. When the two disagree, prefer the date, and treat any
bucket that rests on a word with no corroborating date as provisional.

**Two failure directions, both real:**

- **Word says built, nothing was.** `stamford-major-developments` mapped the verbatim status
  `Under Construction` to `operating` — the "built" band — so 47 records on 9 pages told residents a
  project was finished while its own status said it was still going up. Fixed 2026-08-08 by moving
  that one value to `approved`. *(This was the ONLY instance cache-wide: a scan of every entry's
  `status_to_bucket` for an authorization/in-flight word mapped to `operating` returned exactly
  one.)*
- **Word says not-yet, a date says otherwise.** `phoenix-building-permits` maps `OPEN` to
  `proposed`, and **43,054 of those records on 77 pages carry the city's own `PER_ISSUE_DATE`** — an
  issued permit displayed as merely proposed (`docs/accuracy-audit-2026-08.md` §C2). Same class,
  opposite direction.

**The control to run, and the honest outcome when it cannot be run.** Before trusting or fixing a
word-derived bucket, check whether the affected records carry a completion / issue / C-of-O date
that should override it. On Stamford this control was run and came back **unavailable, not clean**:
`decision_date` is populated on **0 of 47** `Under Construction` records — and on **0 of 84**
`Completed` records too, so the source publishes no completion date at all. The word was the only
evidence available, and it said not-built. **Record "the control could not be applied" rather than
implying it passed.**

**What this does NOT license.** Do not infer a bucket from a date the source did not publish, and do
not let a date override a word that agrees with it. This is a tie-breaker for contradictions, not a
new inference path — the anti-fabrication directive is unchanged.

### Rule 17a — a control with no data is REFUSED, never counted as clean

Rule 17 tells you to check a word-derived bucket against a date. **When that check finds no dates to
check against, the correct output is "could not be applied" — not "passed."** A control run over an
empty column produces success-shaped output while attesting to nothing; counting it as clean is the
vacuous-invariant failure, and it is worse than not running the control at all, because it converts
absence of evidence into a recorded pass.

**The worked case (2026-08-08, the first time this was refused rather than quietly counted).**
Checking `stamford-major-developments`' 47 `Under Construction` records for a completion date that
might legitimately justify the `operating` bucket:

```
Under Construction   n=47   decision_date populated: 0
Completed            n=84   decision_date populated: 0     ← the control's own control
```

The second line is what makes the refusal defensible rather than a guess: **the source publishes no
completion date on ANY record**, including the ones it calls `Completed`. So the control is
unavailable for this source, full stop — the word was the only evidence available, and it said
not-built. The fix shipped on the word; the control was recorded as **UNAVAILABLE**.

**Always pair a control with a positive case.** If the field you are testing is empty on the records
you suspect, check whether it is populated on records you do *not* suspect. If it is empty there
too, the instrument is dark and must say so.
