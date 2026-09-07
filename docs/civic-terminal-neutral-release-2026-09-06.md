# Civic & public — terminal-neutral correction: CLOSED, delivered with one documented exception

Closed 2026-09-07 by founder decision. Read this before touching ZIP 85006, the
`other project` terminal state, or the SLO/Phoenix fire-code mappings — it exists so no
future session re-derives any of it.

## What shipped

Fire-code permits issued *by* a fire department no longer assert a Civic & public identity.
The root defect was Type inferred from the **issuing department** (Phoenix `PER_TYPE` `F####`
= Fire) rather than from what the object is. A sprinkler install, an alarm-dialer swap, a
fireworks retail stand, an event tent, a fire-performer permit and a fire-code deficiency
correction prove fire-code activity at a property; they prove nothing about the property.

Removing the false Civic was only half the fix. `development` / `unclassified` are GENERIC and
deliberately NON-TERMINAL, so a record routed there continues into KEYWORD/NAME inference and
the classifier reads the **property's** name — turning "we proved this is not Civic" into
"therefore it is Residential / Data center". Measured: 236 corpus objects would have moved
that way (119 Residential, 55 Commercial, 46 Industrial, 12 Roads & infrastructure,
4 Data center).

So the correction routes them to the **terminal-neutral** state instead.

* Merge `32f06ce55df1bf3681a732373cf45970d51f8807` (PR #1062)
* Pages run `34047574957` · `get-address-report` **v245 -> v247** (run `34047912941`)

## The terminal-neutral contract

`"other project"` — the value the engine already wrote via
`commercial-eligibility.ts::NON_QUALIFYING_COMMERCIAL_USE_TYPE`. No new concept was invented
and no new resident-facing category exists; it renders as the existing honest neutral circle
("Other project") and carries a `fallbackReason` naming the source decision.

`lib/map.js::classifyProjectType` now calls `terminalNeutral()` **before every inference**.
The one path a terminal value did not previously survive was `statedDataCenter()`, which runs
ahead of the `TYPE_EXACT` loop and reads the record NAME — a pre-existing hole in the
Commercial gate's own mechanism, not something the Civic work created.

⚠️ **Do not move that call below `statedDataCenter`, and do not add `'other project'` to
`GENERIC_EXACT`.** Either change silently re-opens name inference on explicitly unresolved
records. `test/terminal-neutral-type-state.test.mjs` is mutation-proved: reverting the
precedence fails 7 assertions naming the data-centre leak exactly.

`development` / `unclassified` keep their existing NON-TERMINAL meaning — generic name
inference is valuable and is asserted unchanged for every Type.

## State at close (measured 2026-09-07 13:55 UTC)

| | |
|---|---:|
| Corrected and persistent | **28,375 rows / 7,270 identities / 96 ZIPs** |
| Intentionally retained (`AVIATION FACILITY`) | **5 rows / 1 identity** |
| Deferred exception (ZIP 85006) | **1,424 rows, visible on 13 ZIP pages** |

Persistence: those figures were byte-identical across ~17 hours and roughly 68
`app_refresh_sweep` cycles. Zero drift, zero reversion to Civic.

Invariant across every fire-code record in both entries: `other project` 27,476 rows / 96 ZIPs;
**Residential 0 · Commercial 0 · Industrial 0 · Roads & infrastructure 0 · Data center 0.**
No target record acquired a substitute Type from a property name.

## `AVIATION FACILITY` is retained ON PURPOSE

It names an object class, not a fire-code activity, so it sits outside the proven cohort. Its
one production record is `JACKSON JET CENTER`, a private FBO — which is exactly why it was not
re-cased to reach a rounder number. Leave it unless independent evidence resolves it.

## The 85006 exception — founder decision, do not "fix" opportunistically

ZIP 85006 keeps its known-stale Civic value because the **facility half of the source response
is incomplete**, not because the Type correction failed.

`dev_refresh_collect`'s fail-closed guard refuses a write when a fresh response carries
`facilities = 0` while the cached row has facilities > 0. That guard exists to stop a flaky
EPA night blanking good pages, and blanking a real Facilities layer to fix a Type label is a
strictly worse product outcome.

🔑 **Waiting on the EPA health probes will not clear this, and that is the fact most likely to
be re-derived.** Measured 2026-09-06 20:43: 85006 returned `epa.ok=false / facilities=0`
*while both national probes were healthy*. The failure is specific to this ultra-dense downtown
ZIP, not a global FRS outage — 10 failed attempts across three separate windows.

The Type correction is already correct and ready for it: 85006's last engine response carried
**1,442 terminal-neutral sites and 1 Civic** (the retained aviation record). Only the
facilities half fails.

**No background retries, scheduled work, cron jobs or watches are authorized.** The temporary
drain jobs were unscheduled at close (`leftover_cron = 0`) and `dev_refresh_targets` was
restored to 1,463 rows — the other workstream's original set.

## If 85006 is ever addressed

Open a **separate engine-side investigation** into ultra-dense FRS query handling. It must
first produce a design and test plan covering radius back-off, completeness detection,
deduplication, pagination/limits, safe fallback semantics, and production rollout/rollback.
**It must not modify production until separately reviewed and explicitly authorized.**

## Deliberately left alone

1. Shared ZIP `typeLabel` lifecycle defect (`site.type` carries the lifecycle bucket).
2. Latent `KEYWORD_RULES /\bschool\b|education/i` registry-contract violation.
3. Austin zoning mappings.
4. Private/public Civic ontology (private/charter schools, churches, hospitals, nursing homes).
5. Broader Civic source completeness.
6. Memphis: 2 records (`COM-ACC-24-000023`, `COM-ACC-25-000051`) already carrying
   `other project` moved Data center -> Other project. Their upstream `COM` downgrade made
   them terminal; recovery belongs to the Commercial / Data Center workstreams.
7. Two Phoenix permit classes absent from `type_map` (14 rows -> `unclassified`) — vocabulary
   drift, logged only.
