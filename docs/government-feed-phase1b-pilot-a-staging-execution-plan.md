# Phase 1B Pilot A — Staging Execution Plan

**Document type:** Operational execution plan (operator-facing)  
**Status:** Approved for staging execution  
**Date:** 2026-07-19  
**Pilot county:** Wake County, NC (`wake-county-nc`)  
**Canonical feed_id:** `wake-county-nc-granicus-meetings`  
**Batch identifier:** `pilot-a-staging`

**Scope boundary:** This document authorizes **staging execution planning and operator procedure only**. It does **not** authorize production activation, schema auto-apply, or unsupervised county onboarding.

**Companion deliverables:**

| Deliverable | Path |
|-------------|------|
| Pilot A Plan (canonical index + execution order) | `docs/government-feed-phase1b-pilot-a-plan.md` |
| Operator Runbook (step-by-step) | `docs/government-feed-phase1b-pilot-a-operator-runbook.md` |
| Go/No-Go Checklist | `docs/government-feed-phase1b-pilot-a-go-no-go-checklist.md` |
| Rollback Checklist | `docs/government-feed-phase1b-pilot-a-rollback-checklist.md` |
| Pilot Completion Checklist | `docs/government-feed-phase1b-pilot-a-completion-checklist.md` |

**Authority chain (unchanged):**

1. `scripts/gov-feeds/spec/transition-spec.v1.json` — state machine (41 transitions, 23 states, 5 gates)
2. `public.feeds` — runtime ingest truth (DB-first)
3. `homesignal-ingest/feeds.csv` — versioned authoring surface
4. `public.feed_candidates` — pipeline orchestration (after P0 DDL applied)

**Pilot A state-machine scope:**

- **Happy path (10 transitions):** `discovered` → `discriminated` → `validated` → `title_gate_verified` → `inserted` → `dry_running` → `dry_run_pass` → `goliving` → `title_verified` → `activating` → `active`
- **Rollback drill (6 transitions):** `active` → `open_circuit` → `circuit_halting` → `circuit_halted` → `rollback_running` → `rolled_back` → `superseded`
- **Excluded:** all `legacy_verify` transitions and `verified → *` shortcuts (8 legacy transitions)

---

## 1. Preconditions

### 1.1 Required commits

All items must be present on `main` before staging execution begins.

| Artifact | Minimum commit / reference | Verification |
|----------|---------------------------|--------------|
| Phase 1B P0 merge | PR #305 merged (`d89e8ad` or later) | `git log --oneline -1 main` |
| Transition spec v1.0 | `scripts/gov-feeds/spec/transition-spec.v1.json` | `node scripts/run-unit-tests.mjs` → 21/21 pass |
| Generated artifacts | `lib/generated/transitions.{mjs,sql}`, `versions.mjs` | Spec sync test green |
| P0 SQL docs | `docs/gov-feeds-phase1b-p0-{schema,functions,views}.sql` | Files exist; not yet applied |
| P0 CLIs | `transition-candidate.mjs`, `activate-feed-candidate.mjs`, `rollback-feed-candidate.mjs` | `--help` / usage exit 2 |
| P0 workflows | `activate-gov-feed-candidate.yml`, `rollback-gov-feed-candidate.yml` | Present on `main` |
| Phase 1A operator base | `docs/government-feed-onboarding-operator.md` | Complete through Step 10 |
| Design reference | `docs/government-feed-phase1b-design.md` §11 Pilot A | County = Wake |

**Local preflight (repo):**

```bash
git fetch origin main
git checkout main
git pull origin main
node scripts/run-unit-tests.mjs
```

**Expected result:** Exit `0`; all gov-feeds unit tests pass.

**Stop condition:** Any test failure or missing P0 file → fix on `main` before staging.

---

### 1.2 Required PRs merged

| PR | Purpose | Required before staging? |
|----|---------|--------------------------|
| #305 Phase 1B P0 | Control plane scaffolding | **Yes — blocking** |
| #306 Technical debt doc | Non-blocking follow-up | No |
| #304 Design doc v2 | Superseded by content on `main` | No |

No open PR may modify `transition-spec.v1.json`, P0 SQL docs, or activation workflows during Pilot A staging execution.

---

### 1.3 Required documentation

Operator must have read and have local copies of:

| Document | Purpose |
|----------|---------|
| `docs/gov-feeds-phase1b-p0-README.md` | DDL apply order |
| `docs/government-feed-onboarding-operator.md` | Phase 1A tooling steps |
| `docs/gov-feeds-migration-to-ingest.md` | Two-repo CI checkout |
| `docs/state-notice-portals.md` | Wake Granicus wire reference |
| `scripts/gov-feeds/examples/wake-hints.json` | Discovery hints |
| This execution plan + four companion checklists | Staging authority |

---

### 1.4 Required staging environment

| Requirement | Detail |
|-------------|--------|
| **Supabase project** | `qwnnmljucajnexpxdgxr` (authorized staging window) |
| **Environment label** | Treat as **staging execution** until Pilot A completion sign-off |
| **DDL state** | P0 tables/functions/views **not yet applied** at start; applied per Section 2 |
| **Data isolation** | Wake County candidate only; no batch/multi-county runs |
| **Production feed check** | Pre-flight query confirms whether `wake-county-nc-granicus-meetings` already exists in `public.feeds` |
| **Community rows** | `wake-county-nc` county root must exist (`level = 'county'`) |
| **GitHub Actions** | `homesignal-site` workflows enabled; `homesignal-ingest` checkout available for sync/golive |
| **Network** | Operator workstation or CI runner can reach Supabase REST, Granicus RSS, GitHub |

**Pre-flight environment query:**

```sql
select feed_id, active, source, updated_at
from public.feeds
where feed_id = 'wake-county-nc-granicus-meetings';
```

| Result | Action |
|--------|--------|
| 0 rows | Proceed with full happy path |
| 1 row, `active = false` | Proceed; registry must reflect existing row at `inserted` |
| 1 row, `active = true` | **Stop** — founder approval required before Pilot A re-run (supersede or alternate staging feed) |

---

### 1.5 Required secrets

| Secret | Where | Used for |
|--------|-------|----------|
| `SUPABASE_ACCESS_TOKEN` | GitHub Actions | `insert-gov-feed-candidate` |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions + local CLI | Registry read, sync, title verify |
| `SUPABASE_URL` | Local CLI | `https://qwnnmljucajnexpxdgxr.supabase.co` |
| `INGEST_REPO_TOKEN` | GitHub Actions (optional) | Checkout `homesignal-ingest` in CI |

**Never** commit secrets. **Never** use service-role key in browser-side code.

---

### 1.6 Required repositories

| Repo | Branch | Role |
|------|--------|------|
| `homesignal-site` | `main` @ P0 merge | Discovery, probe, SQL gen, sync, verify, P0 CLIs |
| `homesignal-ingest` | `main` (or agreed pilot branch) | `feeds.csv`, `golive-feed`, ingest adapters |

Both repos checked out side by side. `FEEDS_CSV` points at `homesignal-ingest/feeds.csv`.

---

### 1.7 Required permissions

| Actor | Permission |
|-------|------------|
| **Operator** | Supabase SQL editor (DDL + DML), GitHub workflow dispatch, both repos write |
| **Founder / approver** | Go/No-Go at activation gate and rollback drill sign-off |
| **CI service account** | Read repos; `insert-gov-feed-candidate` token scope only where needed |

---

## 2. Staging deployment sequence

Apply P0 DDL **manually** in the Supabase SQL editor during an authorized staging window. **Do not** use migration auto-apply. **Do not** modify the SQL files during this sequence.

**Global stop condition:** Any step returns an error → halt sequence, capture error text, do not proceed to Wake County execution (Section 3).

**Global DDL rollback (staging only):** Reverse order — drop views → drop functions → drop transition seed table → drop registry tables. **Destructive.** Only on isolated staging or with explicit founder approval. See `docs/government-feed-phase1b-pilot-a-rollback-checklist.md` § Registry corruption.

---

### Step 2.1 — Apply schema

| Field | Value |
|-------|-------|
| **Action** | Execute full contents of `docs/gov-feeds-phase1b-p0-schema.sql` in Supabase SQL editor |
| **Command** | Copy/paste SQL file (no CLI auto-apply) |
| **Expected result** | `feed_candidates`, `feed_candidate_audit`, `feed_batch_circuit` created (or already exist idempotently) |

**Verification query:**

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('feed_candidates', 'feed_candidate_audit', 'feed_batch_circuit')
order by 1;
```

**Expected:** 3 rows.

**Stop conditions:**

- Any `CREATE TABLE` error (permissions, name collision with incompatible schema)
- Fewer than 3 tables present after apply

**Rollback procedure:**

```sql
drop table if exists public.feed_candidate_audit cascade;
drop table if exists public.feed_batch_circuit cascade;
drop table if exists public.feed_candidates cascade;
```

Re-run Step 2.1 only after rollback confirmed.

---

### Step 2.2 — Apply generated transitions

| Field | Value |
|-------|-------|
| **Action** | Execute `lib/generated/transitions.sql` **or** the transition seed block inside `docs/gov-feeds-phase1b-p0-functions.sql` (lines marked `BEGIN lib/generated/transitions.sql`) |
| **Command** | Copy/paste SQL |
| **Expected result** | `feed_candidate_transitions` table populated with legal transitions |

**Verification query:**

```sql
select count(*) as transition_count
from public.feed_candidate_transitions;
```

**Expected:** `transition_count = 41`.

> `feed_candidate_transitions` carries **no version column** — its columns are
> `from_state`, `to_state`, `event`, `requires_gate` (see
> `lib/generated/transitions.sql`). The spec version is asserted from the repo
> (`transition-spec.v1.json`, `transition_spec_version: "1.0"`) and stamped
> per-candidate on `feed_candidates.transition_spec_version` (integer `1`) —
> verified in Step 2.6.

**Spot-check (Pilot A happy path):**

```sql
select from_state, to_state, event
from public.feed_candidate_transitions
where (from_state, to_state) in (
  ('discovered', 'discriminated'),
  ('title_verified', 'activating'),
  ('activating', 'active')
)
order by from_state;
```

**Expected:** 3 rows.

**Stop conditions:**

- Count ≠ 41
- Missing happy-path transitions above
- `ON CONFLICT` errors indicating incompatible prior seed

**Rollback procedure:**

```sql
drop table if exists public.feed_candidate_transitions cascade;
```

Re-apply Step 2.2 after schema intact.

---

### Step 2.3 — Apply RPC (functions)

| Field | Value |
|-------|-------|
| **Action** | Execute `docs/gov-feeds-phase1b-p0-functions.sql` (includes `transition_feed_candidate`, `feed_candidate_can_activate`) |
| **Command** | Copy/paste SQL |
| **Expected result** | Functions created/replaced without error |

**Verification query:**

```sql
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('transition_feed_candidate', 'feed_candidate_can_activate')
order by 1;
```

**Expected:** 2 rows.

**Smoke RPC (no row required — expect exception):**

```sql
select public.transition_feed_candidate(
  'nonexistent-feed', 'discovered', 'discriminated', 'discriminate', 'operator', 'smoke test'
);
```

**Expected:** Exception `feed_candidate not found or lock mismatch` (proves RPC is live and enforces row existence).

**Stop conditions:**

- Function creation fails
- Illegal transition not rejected when row exists (test with fixture row in Step 2.5)

**Rollback procedure:**

```sql
drop function if exists public.transition_feed_candidate(text, text, text, text, text, text, integer);
drop function if exists public.feed_candidate_can_activate(text);
```

---

### Step 2.4 — Apply views

| Field | Value |
|-------|-------|
| **Action** | Execute `docs/gov-feeds-phase1b-p0-views.sql` |
| **Command** | Copy/paste SQL |
| **Expected result** | Three views created |

**Verification query:**

```sql
select table_name
from information_schema.views
where table_schema = 'public'
  and table_name in (
    'v_feed_candidates_funnel',
    'v_feed_candidates_stuck',
    'v_active_meetings_feeds'
  )
order by 1;
```

**Expected:** 3 rows.

```sql
select * from public.v_feed_candidates_funnel;
```

**Expected:** Empty or zero-count rows (no error).

**Stop conditions:**

- View creation error
- `SELECT` from any view fails

**Rollback procedure:**

```sql
drop view if exists public.v_active_meetings_feeds;
drop view if exists public.v_feed_candidates_stuck;
drop view if exists public.v_feed_candidates_funnel;
```

---

### Step 2.5 — Smoke tests (offline + online)

| Field | Value |
|-------|-------|
| **Action** | Run repo unit tests and P0 CLI validators locally |
| **Command** | See below |
| **Expected result** | All exit `0` |

**Commands:**

```bash
# Repo unit tests (offline)
node scripts/run-unit-tests.mjs

# Transition validator — happy-path samples
node scripts/gov-feeds/transition-candidate.mjs \
  --from discovered --to discriminated --event discriminate --gate scope_discriminator

node scripts/gov-feeds/transition-candidate.mjs \
  --from title_verified --to activating --event start_activation --gate activation_gates

# Rollback chain validator
node scripts/gov-feeds/rollback-feed-candidate.mjs --from active --event open_circuit

# Activation gates (offline smoke — minimal passing rows)
mkdir -p results
cat > results/smoke-candidate.json <<'EOF'
{ "state": "title_verified", "title_verified_at": "2026-07-19T00:00:00Z",
  "claimed_by": "operator", "claim_expires_at": "2099-01-01T00:00:00Z" }
EOF
cat > results/smoke-feed.json <<'EOF'
{ "feed_id": "wake-county-nc-granicus-meetings", "active": false }
EOF
node scripts/gov-feeds/activate-feed-candidate.mjs \
  --feed-id wake-county-nc-granicus-meetings \
  --candidate-json results/smoke-candidate.json \
  --feed-json results/smoke-feed.json
```

**Expected:** the activation smoke prints `"ok": true` and exits `0`.

**Notes:**

- `fixtures/gov-feeds/activation-gate-fixtures.json` is a unit-test case
  **array** consumed by `run-unit-tests.mjs` — it is **not** valid CLI input
  (passing it makes every gate read undefined fields and fail). Use single-row
  JSON files as above, or exported staging rows (Operator Runbook § Activation).
- `--sync-json` is omitted here, which the CLI treats as "no drift". That is
  acceptable for an offline smoke only — **G10 (live `sync-feeds-config` exit
  `0`) remains the authoritative sync gate** at real activation time (see
  Operator Runbook Phase 8).

**GitHub Actions smoke (optional):**

- `rollback-gov-feed-candidate` with defaults (`from_state=active`, `event=open_circuit`)
- `activate-gov-feed-candidate` with exported staging row JSON (Operator Runbook Phase 8) — not the unit-test fixture array

**Stop conditions:**

- Any command exits non-zero
- `rollback_chain_ok: false` in rollback validator output

**Rollback procedure:** No DB rollback needed for CLI failures. Fix tooling on `main` before continuing DDL-dependent steps.

---

### Step 2.6 — Registry verification

| Field | Value |
|-------|-------|
| **Action** | Confirm empty registry baseline (pre-Wake) or document existing pilot rows |
| **Command** | SQL queries below |
| **Expected result** | Known baseline before Wake County execution |

**Verification queries:**

```sql
-- Empty baseline (preferred)
select count(*) as candidate_rows from public.feed_candidates;

select count(*) as audit_rows from public.feed_candidate_audit;

-- Transition spec version on any existing rows
select feed_id, state, transition_spec_version, schema_version
from public.feed_candidates
where batch_id = 'pilot-a-staging';
```

**Expected (fresh staging):** `candidate_rows = 0`, `audit_rows = 0`.

**If prior partial pilot rows exist:** Document each `feed_id` and `state`. **Stop** if any row is `active` without completion sign-off.

**Stop conditions:**

- Unexpected `active` candidate for Wake without authorization
- `transition_spec_version` mismatch with repo (`1`)

**Rollback procedure:** Delete pilot rows only (staging):

```sql
delete from public.feed_candidate_audit where feed_id = 'wake-county-nc-granicus-meetings';
delete from public.feed_candidates where feed_id = 'wake-county-nc-granicus-meetings';
```

---

### Step 2.7 — Community verification

| Field | Value |
|-------|-------|
| **Action** | Confirm Wake County root exists and resolves |
| **Command** | SQL + optional page check |
| **Expected result** | County root UUID captured for all subsequent steps |

**Verification query:**

```sql
select id, name, slug, level, state,
       array_length(zip_codes, 1) as zip_count
from public.communities
where slug = 'wake-county-nc'
  and level = 'county';
```

**Expected:** Exactly 1 row. Record `id` as `<WAKE_COUNTY_ROOT_UUID>`.

**ZIP resolution spot-check:**

```sql
select id, name, level, slug
from public.communities
where '27601' = any(zip_codes)
order by case level when 'zip' then 1 when 'city' then 2 when 'county' then 3 end
limit 3;
```

**Expected:** Most-specific row is a `level = 'zip'` page; county root appears in chain.

**Page check (operator browser):**

`https://homesignal.net/community.html?zip=27601`

**Expected:** Wake ZIP page loads; government topics include `County Commission & county business`.

**Stop conditions:**

- 0 county rows for `wake-county-nc`
- County root missing `government_topics`

**Rollback procedure:** Community data issues are **out of scope** for Pilot A DDL rollback. Escalate to communities build runbook; do not proceed with feed onboarding.

---

## 3. Wake County execution checklist

Full step-by-step detail with commands, evidence templates, and timing estimates: **`docs/government-feed-phase1b-pilot-a-operator-runbook.md`**.
Canonical execution order (authoritative across all Pilot A docs): **`docs/government-feed-phase1b-pilot-a-plan.md`** §3.

Summary map (in execution order):

| Phase | Registry state(s) | Phase 1A step |
|-------|-------------------|---------------|
| Discovery run (artifact) | — (pre-registry) | Steps 1, 3 |
| Registry bootstrap | row inserted at `discovered` | New — `feed_candidates` INSERT (Runbook Phase 0) |
| Discovery transitions | `discovered` → `discriminated` → `validated` → `title_gate_verified` | New — RPC |
| Insert | `title_gate_verified` → `inserted` | Steps 4–5 |
| Dry Run (registry) | `inserted` → `dry_running` → `dry_run_pass` | Step 2 tooling, run **post-insert** |
| feeds.csv + sync | no transition — **G10 sync gate** | Steps 6–7 |
| Golive | `dry_run_pass` → `goliving` | Step 8 |
| Title Verification | `goliving` → `title_verified` | Step 9 |
| Activation | `title_verified` → `activating` → `active` | Step 10 |
| 48-hour Soak | `active` | Monitoring |
| Rollback Drill | `active` → … → `superseded` | P0 rollback chain |

**Order notes (implemented behavior — reconciled with Runbook + Go/No-Go):**

- The registry row is bootstrapped **at `discovered`, after the discovery run
  produces its artifact** — `discovered` is the spec's entry state, and the
  discovery transitions are applied by RPC against that row. (An earlier draft
  showed the row inserted at `title_gate_verified`; that was wrong.)
- The registry **dry run follows insert** (`inserted → dry_running` in
  `transition-spec.v1.json`). Phase 1A's pre-insert probe (same
  `probe-candidate.mjs` tool) remains **optional** and involves no registry
  transition — it does not satisfy the dry-run gate (G7).

---

## 4. Go / No-Go gates

Printable checklist: **`docs/government-feed-phase1b-pilot-a-go-no-go-checklist.md`**.

---

## 5. Rollback playbook

Printable checklist: **`docs/government-feed-phase1b-pilot-a-rollback-checklist.md`**.

---

## 6. Post-Pilot review

Printable checklist: **`docs/government-feed-phase1b-pilot-a-completion-checklist.md`**.

---

## 7. Deliverables

| # | Deliverable | Location | Status |
|---|-------------|----------|--------|
| 1 | Phase 1B Pilot A Staging Execution Plan | This document | Delivered |
| 2 | Operator Runbook | `docs/government-feed-phase1b-pilot-a-operator-runbook.md` | Delivered |
| 3 | Go/No-Go Checklist | `docs/government-feed-phase1b-pilot-a-go-no-go-checklist.md` | Delivered |
| 4 | Rollback Checklist | `docs/government-feed-phase1b-pilot-a-rollback-checklist.md` | Delivered |
| 5 | Pilot Completion Checklist | `docs/government-feed-phase1b-pilot-a-completion-checklist.md` | Delivered |

**Explicit non-deliverables (out of scope):**

- Production activation without founder sign-off
- SQL file modifications
- `transition-spec.v1.json` changes
- Workflow changes
- Automated migration apply
- Pilot B/C execution

---

## Appendix A — Transition matrix coverage (Pilot A)

| Class | Count | Pilot A action |
|-------|-------|----------------|
| Happy path | 10 | Execute end-to-end |
| Rollback drill | 6 | Execute once after soak |
| Failure paths | 16 | Observe only if naturally triggered; do not force in staging |
| Legacy excluded | 8 | **Do not use** |
| Reserved | 1 (`active` → `supersede` via rollback drill terminus) | Via rollback drill |

**Legacy transitions barred in Pilot A:**

- `title_gate_verified → verified` (`legacy_verify`)
- `inserted → verified` (`legacy_verify`)
- `dry_run_pass → verified` (`legacy_verify`)
- `title_verified → verified` (`legacy_verify`)
- `verified → dry_running` (`start_dry_run`)
- `verified → goliving` (`start_golive`)
- `verified → activating` (`start_activation`)
- `verified → active` (`activate`)

---

## Appendix B — Registry transition RPC reference

After `feed_candidates` row exists, apply transitions via SQL editor:

```sql
select public.transition_feed_candidate(
  p_feed_id         => 'wake-county-nc-granicus-meetings',
  p_from_state      => '<CURRENT_STATE>',
  p_to_state        => '<TARGET_STATE>',
  p_event           => '<EVENT>',
  p_actor           => 'operator',
  p_status_reason   => '<human-readable reason>',
  p_lock_version    => <lock_version from row>
);
```

**Gate enforcement:** Application layer must validate gates **before** calling RPC (P0 design). Set `title_verified_at` via `UPDATE` before `title_verified` / activation transitions.

Audit trail:

```sql
select feed_id, from_state, to_state, event, actor, status_reason, created_at
from public.feed_candidate_audit
where feed_id = 'wake-county-nc-granicus-meetings'
order by created_at;
```
