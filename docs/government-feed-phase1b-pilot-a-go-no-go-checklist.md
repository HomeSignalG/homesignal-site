# Phase 1B Pilot A — Go/No-Go Checklist

**Pilot:** Wake County, NC · `wake-county-nc-granicus-meetings`  
**Use:** Complete every gate before **activation** (Operator Runbook Phase 8).  
**Master plan:** `docs/government-feed-phase1b-pilot-a-staging-execution-plan.md`

---

## Approval table (all gates before activation)

| # | Gate | Evidence required | Owner | Pass criteria | Blocking severity |
|---|------|-------------------|-------|---------------|-------------------|
| G0 | P0 on `main` | `git log` + unit tests `21/21` | Operator | PR #305 merged; tests green | **BLOCK** |
| G1 | Staging DDL applied | Section 2 verification queries | Operator | 41 transitions; 3 views; RPC live | **BLOCK** |
| G2 | Community root exists | SQL: `wake-county-nc` county row | Operator | 1 county row; UUID captured | **BLOCK** |
| G3 | No unauthorized active feed | SQL: `public.feeds` preflight | Operator / Founder | 0 rows OR `active=false` only | **BLOCK** |
| G4 | Discovery complete | `gov-feed-discovery.json` artifact | Operator | `feed_id` = canonical; exit 0 | **BLOCK** |
| G5 | Scope discriminator | Granicus `view_id=18` in source URL | Operator | `title_gate_verified` state | **BLOCK** |
| G6 | Human title review (L1) | Operator sign-off note | Operator | County commission board, not sub-committee | **BLOCK** |
| G7 | Dry run pass | `dryrun-gov-feed` or probe exit 0 | Operator | `dry_run_pass` state | **BLOCK** |
| G8 | INSERT applied | `insert-gov-feed-candidate` URL | Operator | Row in `public.feeds`; `active=false` | **BLOCK** |
| G9 | feeds.csv authored | Ingest commit SHA | Operator | Row matches DB field-for-field | **BLOCK** |
| G10 | Sync zero drift | `sync-feeds-config` exit 0 | Operator | `has_drift: false` for Wake feed | **BLOCK** |
| G11 | Golive produced meetings | `golive-feed` URL + SQL count | Operator | ≥ 1 meeting; correct `community_id` | **BLOCK** |
| G12 | L2 title verify | `verify-gov-feed-candidate` exit 0 | Operator | Match ratio ≥ 0.8; feed-scoped | **BLOCK** |
| G13 | `title_verified_at` set | SQL on `feed_candidates` | Operator | Non-null timestamp | **BLOCK** |
| G14 | Registry state | SQL: `state = 'title_verified'` | Operator | Matches happy path | **BLOCK** |
| G15 | Operator claim valid | `claimed_by` + `claim_expires_at` | Operator | Claim not expired | **BLOCK** |
| G16 | Activation gates CLI | `activate-feed-candidate` JSON `ok: true` | Operator | All 5 gates pass | **BLOCK** |
| G17 | Circuit closed | `feed_batch_circuit` for `pilot-a-staging` | Operator | `circuit_status != 'halted'` | **BLOCK** |
| G18 | Founder activation approval | Ticket / email / signed checklist | **Founder** | Explicit written Go | **BLOCK** |
| G19 | No legacy shortcut used | Audit log review | Operator | 0 `legacy_verify` events | **BLOCK** |

---

## Pre-activation operator checklist (printable)

### Staging foundation

- [ ] **G0** — `main` at P0 merge; `node scripts/run-unit-tests.mjs` exit 0
- [ ] **G1** — P0 schema, transitions (41), RPC, views applied and verified
- [ ] **G2** — `<WAKE_COUNTY_ROOT_UUID>` recorded
- [ ] **G3** — Preflight `public.feeds` check documented

### Discovery → insert

- [ ] **G4** — Discovery artifact saved; canonical `feed_id`
- [ ] **G5** — Registry reached `title_gate_verified`
- [ ] **G6** — Human L1 title review signed off
- [ ] **G7** — Dry run pass; registry `dry_run_pass`
- [ ] **G8** — INSERT workflow green; `active=false` confirmed
- [ ] **G9** — `feeds.csv` row committed in ingest repo

### Pre-activation

- [ ] **G10** — Sync check exit 0 (attach output)
- [ ] **G11** — Golive produced meetings (attach count query)
- [ ] **G12** — L2 title verify exit 0 (attach ratio)
- [ ] **G13** — `title_verified_at` set in registry
- [ ] **G14** — Registry state = `title_verified`
- [ ] **G15** — Operator claim set and unexpired
- [ ] **G16** — `activate-feed-candidate.mjs` reports `"ok": true`
- [ ] **G17** — Batch circuit not halted
- [ ] **G19** — Audit log has no `legacy_verify` transitions

### Founder gate

- [ ] **G18** — Founder written approval to activate

---

## Decision record

| Field | Value |
|-------|-------|
| Date | |
| Operator | |
| Founder | |
| Decision | ☐ **GO** — Proceed to activation  ☐ **NO-GO** — Halt (reason: _____________) |
| Gates failed (if No-Go) | |

---

## No-Go actions

| Failed gate(s) | Action |
|----------------|--------|
| G4–G7 | Do not insert; fix discovery/dry-run or abandon candidate |
| G8–G10 | Do not golive; reconcile INSERT/CSV |
| G11–G14 | Do not activate; re-golive or re-discover |
| G15–G17 | Fix claim/sync/circuit; re-run gate CLI |
| G18 | Wait for founder; feed stays `active=false` |
| G19 | Halt; document audit anomaly; escalate |

**Hard rule:** If any **BLOCK** gate fails, activation is forbidden.
