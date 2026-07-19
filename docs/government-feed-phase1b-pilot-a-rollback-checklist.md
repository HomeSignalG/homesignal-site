# Phase 1B Pilot A — Rollback Checklist

**Pilot:** Wake County, NC · `wake-county-nc-granicus-meetings`  
**Master plan:** `docs/government-feed-phase1b-pilot-a-staging-execution-plan.md`  
**Operator runbook:** `docs/government-feed-phase1b-pilot-a-operator-runbook.md` Phase 10

---

> **Coexistence exception (Plan §8):** every "feed `active` target" below refers
> to the **canonical pilot feed** `wake-county-nc-granicus-meetings` only. The
> intentional pre-Phase-1B legacy feed **`wake-nc-granicus-agendas` must remain
> `active = true`** through every scenario and the drill — each rollback ends
> with a verification that it was not touched.

## Scenario index

| Scenario | Registry end state (target) | Feed `active` target |
|----------|----------------------------|----------------------|
| Failed dry run | `dry_run_failed` or `abandoned` | unchanged (no row or `false`) |
| Failed title verification | `title_verify_failed` or `abandoned` | `false` |
| Failed activation | `activation_failed` or `abandoned` | `false` |
| Vendor outage | `open_circuit` → drill path | `false` |
| Registry corruption | rebuild row or `abandoned` | `false` |
| Sync drift | hold at `title_verified` | `false` |
| Operator error | depends on stage | `false` |

---

## 1. Failed dry run

### Detection

- `probe-candidate.mjs` exit code `1`
- Registry at `dry_running` with failed probe in logs
- Operator observes wrong-board or empty RSS in sample titles

### Immediate response

1. **Do not** insert into `public.feeds`
2. Transition: `dry_running` → `dry_run_failed` (`dry_run_fail`)
3. Save probe stdout/stderr as evidence
4. If unrecoverable: `dry_run_failed` → `abandoned` (`abandon`)

### Recovery

1. Fix hints (`scripts/gov-feeds/examples/wake-hints.json`) or pick alternate vendor hit
2. Re-run discovery from `discovered` (new registry row or reset with founder approval)
3. Or abandon candidate and open new pilot row with new `batch_id`

### Exit criteria

- Feed row does not exist OR remains `active=false`
- Registry in `dry_run_failed` or `abandoned`
- Operator documents root cause

---

## 2. Failed title verification

### Detection

- `verify-candidate-titles.mjs` exit `1`
- Match ratio < 0.8
- Registry transition to `title_verify_failed`

### Immediate response

1. **Do not activate**
2. Transition: `goliving` → `title_verify_failed` (`title_verify_fail`)
3. Keep `public.feeds.active = false`
4. Export failing title sample (SQL):

```sql
select title, meeting_date, source
from public.meetings
where community_id = '<WAKE_COUNTY_ROOT_UUID>'
order by meeting_date desc
limit 20;
```

### Recovery

> **Transition note:** `title_verify_failed` has exactly one legal outbound
> transition — `abandon` (`transition-spec.v1.json`). Any retry below therefore
> proceeds via a **new candidate row** (new `batch_id` or fresh bootstrap) or a
> **founder-approved manual registry reset** to the last good state (see § 5
> Registry corruption, Option A) — never a direct registry transition back to
> `goliving`.

| Root cause | Action |
|------------|--------|
| Golive stale / empty | Re-run `golive-feed`; re-enter the pipeline via a new candidate row or founder-approved manual reset to `dry_run_pass`/`goliving` |
| Wrong `view_id` | Abandon current candidate; re-discover on a new candidate row |
| Pattern too strict | Re-run `verify-candidate-titles.mjs` with an adjusted `--pattern REGEX` (founder approval); there is no stored pattern field to edit |

### Exit criteria

- `title_verified_at` is NULL
- Feed `active=false`
- Registry not in `activating` or `active`

---

## 3. Failed activation

### Detection

- `activate-feed-candidate.mjs` exit `1` (`"ok": false`)
- `activation_failed` state after attempted activate
- SQL `UPDATE` affected 0 rows (feed already active or missing)

### Immediate response

1. **Do not** set `active=true` in `feeds.csv`
2. If partially activated: immediately `UPDATE public.feeds SET active=false`
3. Transition: `activating` → `activation_failed` (`activation_fail`) if applicable
4. Capture gate failure list from CLI JSON (`failures` array)

### Recovery

| Failed gate | Fix |
|-------------|-----|
| `title_verified_at` | Re-run L2 verify; set timestamp |
| `feed_active_false` | Deactivate feed in DB |
| `sync_pass` | Reconcile CSV ↔ DB; re-run sync |
| `circuit_closed` | Reset batch circuit to `closed` |
| `valid_claim` | Set `claimed_by` / extend `claim_expires_at` |

**Retry path depends on the registry state:**

- Registry still at **`title_verified`** (gate pre-flight failed before any
  transition was applied): fix the failed gate(s), re-run the activation gate
  CLI until `ok: true`, and obtain founder re-approval — `title_verified →
  activating` remains legal.
- Registry reached **`activation_failed`**: its only legal outbound transition
  is `abandon` (`transition-spec.v1.json`). Continue via a **new candidate
  row** or a **founder-approved manual registry reset** to `title_verified`
  (see § 5 Registry corruption, Option A) — do not attempt a direct transition
  back from `activation_failed`.

### Exit criteria

- `public.feeds.active = false`
- Sync exit 0
- Registry ≤ `title_verified` or `activation_failed` / `abandoned`

---

## 4. Vendor outage

### Detection

- Granicus RSS timeout or HTTP 5xx during probe/golive
- 0 new meetings over 24h while vendor status page shows incident
- Post-activation: ingest errors in golive logs

### Immediate response

1. If **active**: transition `active` → `open_circuit` (`open_circuit`)
2. Set `public.feeds.active = false` (stop delivery)
3. Set `active=false` in `feeds.csv`; sync
4. Log vendor status URL and timestamp

### Recovery

> **Transition note:** once the registry enters `open_circuit`, the only legal
> path is **forward through the rollback chain** (`open_circuit →
> circuit_halting → circuit_halted → rollback_running → rolled_back →
> superseded`, per `transition-spec.v1.json`) — there is no transition back to
> `active`. Re-onboarding after the outage proceeds on a **new candidate row**
> (or, in staging, a founder-approved manual registry reset — see § 5 Registry
> corruption, Option A).

1. Wait for vendor restoration; confirm RSS returns 200
2. Complete the rollback chain on the current row to `rolled_back` →
   `superseded` (this doubles as the circuit-breaker test if applicable)
3. Bootstrap a new candidate row and re-probe (`dryrun-gov-feed`)
4. Re-golive on the new row if needed
5. Re-verify titles before re-activation on the new row

### Exit criteria

- Feed inactive during outage
- Registry documents `open_circuit` or rollback path
- Re-activation only after L2 re-pass + founder Go

---

## 5. Registry corruption

### Detection

- `transition_feed_candidate` raises `illegal transition`
- `lock_version` mismatch on every RPC call
- `feed_candidates.state` inconsistent with `public.feeds` reality
- Audit log gaps or duplicate conflicting states

### Immediate response

1. **Stop all RPC transitions**
2. Export evidence:

```sql
select * from public.feed_candidates where feed_id = 'wake-county-nc-granicus-meetings';
select * from public.feed_candidate_audit where feed_id = 'wake-county-nc-granicus-meetings' order by created_at;
select * from public.feeds where feed_id = 'wake-county-nc-granicus-meetings';
```

3. Set feed `active=false` if any doubt about production impact
4. Notify founder

### Recovery

**Option A — Row repair (staging):**

1. Manually align `state` and `lock_version` with audit log last good entry (founder approval)
2. Resume from aligned state

**Option B — Row reset:**

```sql
delete from public.feed_candidate_audit where feed_id = 'wake-county-nc-granicus-meetings';
delete from public.feed_candidates where feed_id = 'wake-county-nc-granicus-meetings';
```

Re-bootstrap registry from Operator Runbook Phase 0.

**Option C — Full P0 DDL rollback** (staging only, destructive):

Drop views → functions → transitions → registry tables; re-apply Section 2 of staging plan.

### Exit criteria

- Registry state matches feed reality
- Audit log consistent
- Illegal transition smoke test passes on next transition

---

## 6. Sync drift

### Detection

- `sync-feeds-config.mjs` exit `1`
- `has_drift: true` in sync JSON
- `missing_from_db` or `mismatched` includes Wake `feed_id`

### Immediate response

1. **Block activation** (gate `sync_pass` fails)
2. Do not change registry to `activating`
3. Capture full sync CLI output

### Recovery

| Drift type | Action |
|------------|--------|
| CSV missing DB row | Apply INSERT or fix CSV |
| DB missing CSV row | Add CSV row or remove orphan (founder approval) |
| Field mismatch | Pick authoritative source (DB for runtime); update other side |
| `active` mismatch | Align both to `false` until deliberate activation |

Re-run sync until exit 0.

### Exit criteria

- `sync-feeds-config` exit 0
- `activate-feed-candidate` gate `sync_pass` passes

---

## 7. Operator error

### Detection

- Wrong `feed_id` committed to `feeds.csv`
- Accidental `active=true` before gates
- Used `build-candidate-sql --activate` (workflow refused)
- Called `legacy_verify` transition (Pilot A violation)

### Immediate response

| Error | Action |
|-------|--------|
| Early activation | `UPDATE feeds SET active=false`; fix CSV; sync |
| Wrong feed_id | Stop; do not golive; abandon candidate |
| Legacy shortcut | Halt; document in audit; founder review |
| Duplicate INSERT | Safe (`ON CONFLICT DO NOTHING`); verify no duplicate active meetings feed |

### Recovery

1. Document error in operator log
2. Return registry to last known good state via audit log
3. Re-run gates from that state
4. If unrecoverable: full rollback drill → `superseded`; start fresh candidate

### Exit criteria

- Feed `active=false` unless founder authorized active state
- Sync pass
- Audit log explains correction transitions

---

## Rollback drill (required Pilot A exit)

Execute after 48h soak — full chain:

```
active → open_circuit → circuit_halting → circuit_halted → rollback_running → rolled_back → superseded
```

**Validate before live drill:**

```bash
node scripts/gov-feeds/rollback-feed-candidate.mjs --from active --event open_circuit
```

**Checklist:**

- [ ] Chain validator `rollback_chain_ok: true`
- [ ] Each RPC transition applied in order
- [ ] `public.feeds.active = false` after drill (**canonical pilot feed only**)
- [ ] **Legacy feed `wake-nc-granicus-agendas` still `active = true`** (coexistence exception, Plan §8 — it carries Wake coverage after the drill; if found `false`, restore immediately and document)
- [ ] `feeds.csv` `active=false`; sync exit 0
- [ ] Final state `superseded`
- [ ] Founder witnessed drill

---

## Rollback decision record

| Field | Value |
|-------|-------|
| Scenario | |
| Detected at (UTC) | |
| Operator | |
| Immediate actions taken | |
| Recovery complete (UTC) | |
| Exit criteria met | ☐ Yes ☐ No |
| Founder notified | ☐ Yes ☐ No |
