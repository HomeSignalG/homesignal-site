# Phase 1B Pilot A — Pilot Completion Checklist

**Purpose:** Determine whether Pilot A succeeded enough to **authorize Pilot B** (5 counties).  
**Pilot:** Wake County, NC · `wake-county-nc-granicus-meetings`  
**Master plan:** `docs/government-feed-phase1b-pilot-a-staging-execution-plan.md`

---

## Completion prerequisites

Pilot A is **not complete** until ALL of the following are true:

- [ ] Staging deployment sequence (Plan Section 2) finished
- [ ] Happy path executed through activation (or documented equivalent with founder waiver)
- [ ] 48-hour soak completed on active feed
- [ ] Rollback drill executed to `superseded`
- [ ] Evidence bundle submitted (Operator Runbook)

---

## 1. Technical metrics

| Metric | Target | Evidence | Pass |
|--------|--------|----------|------|
| Transition spec coverage (happy path) | 10/10 executed | `feed_candidate_audit` export | ☐ |
| Rollback chain | 6/6 executed | Audit log + CLI `rollback_chain_ok` | ☐ |
| Illegal transitions attempted | 0 succeeded | No RPC errors bypassed | ☐ |
| Legacy shortcuts used | 0 | Audit log: no `legacy_verify` | ☐ |
| Activation without `title_verified_at` | 0 | SQL + gate JSON | ☐ |
| Activation with sync drift | 0 | Sync output at activation time | ☐ |
| Wrong-board findings (post-activation audit) | 0 | 100% audit sample reviewed | ☐ |
| `feed_candidate_transitions` row count | 41 | Staging verification query | ☐ |
| Unit tests on `main` | 21/21 | CI / local run URL | ☐ |
| L2 feed-scoped verification | Used (not `--legacy-host-scope`) | Verify command log | ☐ |
| Meetings ingested for Wake | ≥ 1 during golive | SQL count at golive time | ☐ |
| Community page resolves | `?zip=27601` loads | Screenshot or CI verify | ☐ |

**Technical pass:** All rows checked.

---

## 2. Operational metrics

| Metric | Target | Evidence | Pass |
|--------|--------|----------|------|
| Operator time (end-to-end) | Document actual (baseline ~30–60 min Phase 1A + registry overhead) | Operator log | ☐ |
| Stuck state > 3 days | 0 for Wake candidate | `v_feed_candidates_stuck` query | ☐ |
| Unresolved BLOCK gate failures | 0 at completion | Go/No-Go checklist | ☐ |
| Evidence bundle complete | 11/11 artifacts | Operator Runbook § Evidence bundle | ☐ |
| Rollback drill witnessed | Founder sign-off | Ticket / email | ☐ |
| 48h soak incidents | 0 SEV-1 | Soak log | ☐ |
| Post-drill feed state | `active=false`, `superseded` | SQL | ☐ |
| Post-drill legacy feed state (Plan §8) | `wake-nc-granicus-agendas` still `active=true` | SQL | ☐ |

**Operational pass:** All rows checked.

> **Evidence note (coexistence exception, Plan §8):** metrics that touch
> meeting data ("Meetings ingested for Wake", wrong-board audit, soak) are
> evidenced by **workflow logs (`golive-feed` `ONLY_FEED`), L2 title
> verification, and feed-specific execution** — not total meeting counts, which
> the concurrently-active legacy feed makes unattributable.

---

## 3. Documentation updates required

| Document | Update needed | Done |
|----------|---------------|------|
| `docs/government-feed-onboarding-operator.md` | Append Pilot A learnings to the existing "Phase 1B P0 + Pilot A staging" section | ☐ |
| `docs/government-feed-phase1b-design.md` §11 | Mark Pilot A exit criteria met | ☐ |
| `docs/gov-feeds-phase1b-p0-README.md` | Note staging apply date + environment | ☐ |
| `docs/state-notice-portals.md` | Wake receipt if new evidence | ☐ |
| `CLAUDE.md` scaling gaps | Government feed Pilot A status | ☐ |
| Hints registry | Confirm `wake-hints.json` still accurate | ☐ |

---

## 3a. Post-Pilot cleanup (logged, non-blocking)

| Item | Owner | Trigger | Done |
|------|-------|---------|------|
| **Supersede the legacy feed `wake-nc-granicus-agendas`** (deactivate in `public.feeds` + `feeds.csv`, sync exit 0) | **Founder decision** | **Only after** a governed Wake feed is **permanently adopted** for production — the same change that permanently activates the governed feed retires the legacy row, so Wake coverage is never interrupted. Not a Pilot A step; Pilot A ends with the pilot feed `superseded` and the legacy feed still active (Plan §8). | ☐ |

---

## 4. Lessons learned (capture before Pilot B)

| Question | Answer |
|----------|--------|
| What took longer than expected? | |
| Which gates produced false failures? | |
| CLI vs workflow preference? | |
| Registry RPC ergonomics? | |
| Claim/lock model sufficient for Pilot B? | |
| Any P1 debt items blocking 5-county scale? | (`docs/gov-feeds-phase1b-p0-technical-debt.md`) |
| Golive queue needed for Pilot B? | Per design §P1 — expected **yes** |

---

## 5. Required approvals

| Approval | Approver | Date | Pass |
|----------|----------|------|------|
| Pilot A staging execution complete | Operator lead | | ☐ |
| Technical metrics pass | Engineering | | ☐ |
| Operational metrics pass | Operator lead | | ☐ |
| Rollback drill accepted | Founder | | ☐ |
| Documentation updates merged or ticketed | Engineering | | ☐ |
| **Pilot B authorized** | **Founder** | | ☐ |

---

## Pilot B authorization decision

**Pilot B scope (from design):** 5 NC counties; golive queue; circuit breaker test; ~1 week.

| Decision | ☐ **AUTHORIZE Pilot B** | ☐ **HOLD** — remediate items below |
|----------|-------------------------|-------------------------------------|

**Hold reasons (if any):**

1. 
2. 
3. 

**Remediation tickets:**

| Ticket | Owner | Due |
|--------|-------|-----|
| | | |

---

## Post-pilot SQL snapshot (attach to completion record)

```sql
-- Registry summary
select state, count(*) from public.feed_candidates
where batch_id = 'pilot-a-staging' group by state;

-- Wake audit trail
select from_state, to_state, event, actor, created_at
from public.feed_candidate_audit
where feed_id = 'wake-county-nc-granicus-meetings'
order by created_at;

-- Feed final state
select feed_id, active from public.feeds
where feed_id = 'wake-county-nc-granicus-meetings';

-- Funnel view
select * from public.v_feed_candidates_funnel;
```

---

## Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Operator | | | |
| Engineering | | | |
| Founder | | | |
