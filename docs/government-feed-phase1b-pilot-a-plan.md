# Phase 1B Pilot A — Plan

**Document type:** Pilot planning document (canonical index for the Pilot A documentation set)
**Status:** Approved (documentation audit, 2026-07-19)
**Pilot county:** Wake County, NC (`wake-county-nc`)
**Canonical feed_id:** `wake-county-nc-granicus-meetings`
**Batch identifier:** `pilot-a-staging`

**Source of truth:** the **implementation**, not the design narrative. The state
machine is `scripts/gov-feeds/spec/transition-spec.v1.json` (**23 states, 41
transitions, 5 gates**, `transition_spec_version: "1.0"`), generated into
`lib/generated/transitions.{mjs,sql}` and applied via the P0 SQL docs
(`docs/gov-feeds-phase1b-p0-*.sql`, manual apply only). Where any document —
including the Phase 1B design doc — disagrees with the spec or the shipped
tooling, the spec and tooling win.

---

## 1. Goal

Prove the Phase 1B governed onboarding path end-to-end on **one** county:
registry-tracked state machine, activation gates, and the implemented rollback
chain — with 100% human review, 100% post-activation audit, and a witnessed
rollback drill. Success authorizes Pilot B (5 counties).

**Non-goals:** production activation without founder sign-off, batch/multi-county
runs, golive job queue, circuit-breaker automation, city councils, Notices, new
vendor adapters, any implementation/SQL/spec/workflow change.

## 2. Pilot A documentation set

| Role | Document |
|------|----------|
| **Plan (this document — canonical index)** | `docs/government-feed-phase1b-pilot-a-plan.md` |
| Staging execution plan (DDL apply + preconditions) | `docs/government-feed-phase1b-pilot-a-staging-execution-plan.md` |
| Operator runbook (step-by-step phases) | `docs/government-feed-phase1b-pilot-a-operator-runbook.md` |
| Go/No-Go checklist (activation gates) | `docs/government-feed-phase1b-pilot-a-go-no-go-checklist.md` |
| Rollback checklist (failure scenarios + drill) | `docs/government-feed-phase1b-pilot-a-rollback-checklist.md` |
| Completion checklist (Pilot B authorization) | `docs/government-feed-phase1b-pilot-a-completion-checklist.md` |
| P0 DDL apply order + regeneration | `docs/gov-feeds-phase1b-p0-README.md` |
| Known P1 debt (non-blocking) | `docs/gov-feeds-phase1b-p0-technical-debt.md` |
| Design background (**state machine superseded** — see notice there) | `docs/government-feed-phase1b-design.md` |
| Phase 1A tool reference (superseded for Phase 1B execution) | `docs/government-feed-onboarding-operator.md`, `docs/government-feed-onboarding.md` |

## 3. Canonical execution order

This ordering is **authoritative** across the Pilot A documents. It follows the
implemented transitions in `transition-spec.v1.json` — in particular, the
registry dry run happens **after** insert (`inserted → dry_running`), and the
registry row is bootstrapped only after a discovery artifact exists
(`discovered` is the spec's entry state).

1. **Staging deployment** — apply P0 DDL per the staging execution plan §2
   (schema → transitions seed [41 rows] → RPC → views → smoke → registry &
   community verification).
2. **Discovery run** — produce `results/gov-feed-discovery.json`; confirm the
   top candidate is the Wake Board of Commissioners.
3. **Registry bootstrap** — insert the `feed_candidates` row at
   `state = 'discovered'` (Operator Runbook Phase 0).
4. **Discovery transitions** — `discovered → discriminated → validated →
   title_gate_verified` via RPC, gates validated in the application layer first.
5. **Human L1 title review** — county commission board, not a sub-committee.
6. **Insert** — committed SQL, `active=false`, `ON CONFLICT DO NOTHING`;
   registry `title_gate_verified → inserted`.
7. **Registry dry run** — `inserted → dry_running → dry_run_pass`
   (`probe-candidate.mjs`). An extra **pre-insert probe is optional** (same
   tool, no registry transition) — see §4.
8. **feeds.csv authoring + sync** — matching row in `homesignal-ingest`
   (`active=false`); live sync exit `0` (**G10 — the authoritative sync gate**).
9. **Golive** — `dry_run_pass → goliving`; `golive-feed` with `ONLY_FEED`.
10. **L2 title verification** — feed-scoped; on pass set `title_verified_at`,
    `goliving → title_verified`.
11. **Activation** — gates pre-flight (`activate-feed-candidate.mjs` /
    `activate-gov-feed-candidate` workflow — gate validation only) + **founder
    written approval**; `title_verified → activating → active`;
    `public.feeds.active = true`; CSV `active=true`; re-sync.
12. **48-hour soak** — monitoring per Operator Runbook Phase 9.
13. **Rollback drill** — the implemented chain (§5), witnessed by the founder.

## 4. Pre-insert probe vs registry dry run

In Phase 1A the probe ran **before** insert (operator Steps 2–3). The
implemented Phase 1B machine models the dry run **after** insert
(`inserted → dry_running → dry_run_pass`); only that registry-tracked run
satisfies the dry-run gate (G7). Running `probe-candidate.mjs` before insert
remains **optional** — a fail-fast convenience with no registry transition —
and does not substitute for the post-insert registry dry run.

## 5. Exit criteria (implemented rollback path)

Pilot A exits green when all of the following hold (evidence per the completion
checklist):

- **Happy path 10/10:** `discovered → discriminated → validated →
  title_gate_verified → inserted → dry_running → dry_run_pass → goliving →
  title_verified → activating → active`, each via RPC with audit rows.
- **48-hour soak** on the active feed with 0 wrong-board findings (100% audit).
- **Rollback drill 6/6** — the implemented chain:
  `active → open_circuit → circuit_halting → circuit_halted → rollback_running
  → rolled_back → superseded`, ending with `public.feeds.active = false`,
  `feeds.csv` `active=false`, sync exit `0`, and registry `superseded`.
- **0** activations without `title_verified_at`; **0** activations with sync
  drift; **0** successful illegal transitions; **0** `legacy_verify` events.
- Evidence bundle (11/11 artifacts) submitted; founder sign-offs recorded.

> The earlier design-doc exit criterion "all states exercised including
> `inactive` → re-queue" is **superseded**: `inactive` and re-queue do not
> exist in `transition-spec.v1.json`. The rollback drill above is the
> implemented equivalent and the required exit.

## 6. Supersession

- The state machine in `docs/government-feed-phase1b-design.md` §2.3
  (`queued`, `pending_review`, `insert_synced`, `activation_queued`,
  `inactive`, …) is **historical** — superseded by `transition-spec.v1.json`
  and this documentation set. It is marked as such in place, not rewritten.
- The design doc's `activate-feed` workflow name was never implemented; the
  shipped workflow is **`activate-gov-feed-candidate`** (gate validation only —
  it does not activate). Rollback validation ships as
  **`rollback-gov-feed-candidate`**.
- For Phase 1B onboarding, the Phase 1A onboarding docs are the **tool
  reference** only; execution authority is this document set.

## 7. Approvals

| Decision | Approver |
|----------|----------|
| Staging DDL apply window | Operator (per staging plan §2) |
| Activation (G18) | **Founder — written approval required** |
| Rollback drill acceptance | Founder |
| Pilot B authorization | Founder (completion checklist) |
