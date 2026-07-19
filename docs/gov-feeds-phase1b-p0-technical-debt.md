# Phase 1B P0 — Technical Debt Follow-Up

**Created:** 2026-07-19  
**Context:** Post-merge of PR #305 (`d89e8ad`) — architectural verification approved  
**Target:** P1 registry migration (not Pilot A, not Phase 1C)

Non-blocking improvements identified during P0 architectural verification. None block Pilot A prep; address during P1 control-plane hardening.

---

## 1. Complete state coverage tests

**Gap:** 16 of 23 P0 states do not appear as string literals in test source files. Runtime coverage exists via `gov-feeds-spec-sync.test.mjs` (all 41 transitions), but static/state-explicit tests are incomplete.

**Action:** Add a generated or fixture-driven test that asserts every entry in `STATES` (`lib/generated/transitions.mjs`) appears in at least one legal transition as `from` or `to`.

**Acceptance:** `node scripts/run-unit-tests.mjs` fails if a new state is added to the spec without a corresponding transition reference test.

---

## 2. Operator pass/fail tests for `valid_claim` activation gate

**Gap:** `checkActivationGates()` enforces `valid_claim` for `actor: 'operator'`, but `activation-gates.test.mjs` runs all fixtures with `actor: 'ci'`, which bypasses the claim check. No dedicated failing test for expired/missing claims.

**Action:** Add fixtures:

- **Pass:** `claimed_by` set, `claim_expires_at` in the future, `actor: 'operator'`
- **Fail:** missing `claimed_by`, or expired `claim_expires_at`, `actor: 'operator'`

**Acceptance:** Both fixtures asserted in `test/activation-gates.test.mjs`.

---

## 3. Route activation gate validation through `validateTransition()` where appropriate

**Gap:** `activate-feed-candidate.mjs` calls `checkActivationGates()` and `isLegalTransition()` separately. Transitions with `requires_gate: 'activation_gates'` in the spec are not validated via `validateTransition({ gates: { activation_gates: true } })`.

**Action:** When the target transition carries `requires_gate: 'activation_gates'`, require `validateTransition()` to pass with `gates.activation_gates === true` only after `checkActivationGates().pass === true` (single cohesive gate path).

**Acceptance:** `activate-feed-candidate.mjs` uses `validateTransition` for gated activation transitions; unit test covers gate rejection when `checkActivationGates` would fail.

---

## 4. Retire legacy Phase 1A activation SQL path during P1 registry migration

**Gap:** `build-candidate-sql.mjs --activate` and `candidateToActivateSql()` emit `UPDATE public.feeds SET active = true` with no state-machine or gate enforcement. This is intentional Phase 1A backward compatibility.

**Action (P1):** Once `feed_candidates` registry and `transition_feed_candidate` RPC are live:

- Remove `--activate` from `build-candidate-sql.mjs` (or gate behind explicit `--legacy-activate` with deprecation warning)
- Route all activations through `activate-gov-feed-candidate` workflow + registry transition to `active`
- Update operator runbook to remove manual activate SQL path

**Acceptance:** No repo path generates `active = true` SQL without passing activation gates and transition validation.

---

## 5. Dedicated unit tests for `rollback-feed-candidate.mjs`

**Gap:** Rollback chain validation runs only via `.github/workflows/rollback-gov-feed-candidate.yml` workflow dispatch. No `test/rollback-feed-candidate.test.mjs`.

**Action:** Add offline unit test importing `isLegalTransition` / rollback chain logic (or spawn CLI) asserting:

- `active → open_circuit → circuit_halting → circuit_halted → rollback_running → rolled_back` chain is legal
- Broken chain members are rejected

**Acceptance:** `test/rollback-feed-candidate.test.mjs` in `scripts/run-unit-tests.mjs` suite.

---

## References

- P0 merge: PR #305, commit `d89e8ad`
- Transition spec: `scripts/gov-feeds/spec/transition-spec.v1.json`
- P0 SQL (manual apply only): `docs/gov-feeds-phase1b-p0-README.md`
