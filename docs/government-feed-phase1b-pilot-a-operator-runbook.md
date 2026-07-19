# Phase 1B Pilot A — Operator Runbook

**Pilot:** Wake County, NC  
**feed_id:** `wake-county-nc-granicus-meetings`  
**batch_id:** `pilot-a-staging`  
**Plan (canonical execution order):** `docs/government-feed-phase1b-pilot-a-plan.md`  
**Prerequisite:** Section 2 of `docs/government-feed-phase1b-pilot-a-staging-execution-plan.md` complete (P0 DDL applied)

**Phase 1A base steps:** `docs/government-feed-onboarding-operator.md`  
**County label rule:** Use `"Wake County"` consistently (yields canonical `feed_id`).

Capture `<WAKE_COUNTY_ROOT_UUID>` once:

```sql
select id from public.communities where slug = 'wake-county-nc' and level = 'county';
```

---

## Phase 0 — Registry bootstrap

> **Order (corrected):** the registry row enters at `state = 'discovered'` —
> the **entry state** of `transition-spec.v1.json` — which presupposes a
> completed discovery run. Run the **Phase 1 discovery command first** to
> produce `results/gov-feed-discovery.json` and confirm the top candidate is
> the Wake Board of Commissioners; **then** bootstrap the row below. Phase 1
> afterwards applies the `discovered → discriminated → validated →
> title_gate_verified` transitions against this row.

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator |
| **Inputs** | Discovery JSON (`results/gov-feed-discovery.json` — produced by the Phase 1 discovery command, run first), `<WAKE_COUNTY_ROOT_UUID>` |
| **Outputs** | `feed_candidates` row at `state = 'discovered'` |
| **Evidence** | SQL insert receipt; screenshot of row |
| **Approvals** | None |
| **Go/No-Go** | **Go** if row inserted with correct `feed_id`, `vendor`, `source`, `batch_id` |

**Action — insert registry row** (Supabase SQL editor):

```sql
insert into public.feed_candidates (
  community_id, feed_id, vendor, source, source_type,
  state, batch_id, confidence, discovery_artifact_path,
  schema_version, transition_spec_version
)
values (
  '<WAKE_COUNTY_ROOT_UUID>',
  'wake-county-nc-granicus-meetings',
  'granicus',
  'https://wake.granicus.com/ViewPublisherRSS.php?view_id=18&mode=agendas',
  'rss',
  'discovered',
  'pilot-a-staging',
  0.950,
  'results/gov-feed-discovery.json',
  1,
  1
)
on conflict (feed_id) do nothing;
```

**Verify:**

```sql
select feed_id, state, batch_id, lock_version from public.feed_candidates
where feed_id = 'wake-county-nc-granicus-meetings';
```

**No-Go:** Row missing or `feed_id` mismatch.

---

## Phase 1 — Discovery

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator |
| **Inputs** | `wake-hints.json`, county root UUID |
| **Outputs** | `results/gov-feed-discovery.json`; registry → `discriminated` → `validated` → `title_gate_verified` |
| **Evidence** | Discovery JSON artifact; CI artifact if using workflow |
| **Approvals** | Operator confirms top candidate is Wake Board of Commissioners |
| **Go/No-Go** | **Go** if `feed_id` in JSON = `wake-county-nc-granicus-meetings` |

> **Note:** the discovery command below runs **before** the Phase 0 registry
> insert (it produces the artifact Phase 0 records). Phase 1's remaining work
> is the human candidate review and the three registry transitions.

**Command (CLI):**

```bash
node scripts/gov-feeds/discover-county-vendor.mjs \
  --county "Wake County" --state NC \
  --community-id "<WAKE_COUNTY_ROOT_UUID>" \
  --hints scripts/gov-feeds/examples/wake-hints.json \
  --out results/gov-feed-discovery.json
```

**Or workflow:** `discover-gov-feed` with same inputs.

**Registry transitions** (after gate checks in application layer):

| From | To | Event | Gate |
|------|-----|-------|------|
| `discovered` | `discriminated` | `discriminate` | `scope_discriminator` |
| `discriminated` | `validated` | `validate` | `validation_prerequisites` |
| `validated` | `title_gate_verified` | `title_gate_pass` | `scope_discriminator` |

**CLI gate validation (offline):**

```bash
node scripts/gov-feeds/transition-candidate.mjs \
  --from discovered --to discriminated --event discriminate --gate scope_discriminator
```

**Apply each transition via RPC** (update `lock_version` from row after each call).

**Human review:** Sample titles in discovery output must reference Wake County Board of Commissioners / county commission — not a sub-committee.

**No-Go:** Wrong board, 0 candidates, or `feed_id` drift from canonical slug.

---

## Phase 2 — Registry (pre-insert gate)

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator |
| **Inputs** | Validated discovery JSON |
| **Outputs** | Registry at `title_gate_verified`; scope discriminator recorded |
| **Evidence** | `status_reason` on row; audit log entries |
| **Approvals** | Operator sign-off on human title review (Phase 1A Step 3) |
| **Go/No-Go** | **Go** if state = `title_gate_verified` and Granicus `view_id=18` confirmed |

**Verify scope discriminator:**

```bash
node scripts/gov-feeds/transition-candidate.mjs \
  --from validated --to title_gate_verified --event title_gate_pass --gate scope_discriminator
```

**No-Go:** Proceeding to insert without `title_gate_verified`.

---

## Phase 3 — Insert

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator |
| **Inputs** | Discovery JSON |
| **Outputs** | `docs/candidates/wake-county-nc-insert.sql`; `public.feeds` row (`active=false`); registry → `inserted` |
| **Evidence** | Committed SQL file; insert workflow run URL; DB row query |
| **Approvals** | PR review for committed SQL (no `--activate`) |
| **Go/No-Go** | **Go** if feed row exists with `active = false` |

**Generate SQL (no `--activate`):**

```bash
node scripts/gov-feeds/build-candidate-sql.mjs \
  --in results/gov-feed-discovery.json \
  --out docs/candidates/wake-county-nc-insert.sql
```

**Commit** SQL to `homesignal-site`.

**Apply via workflow:** `insert-gov-feed-candidate` with `sql_file=docs/candidates/wake-county-nc-insert.sql`.

**Verify DB:**

```sql
select feed_id, active, source, community_id, target_table
from public.feeds
where feed_id = 'wake-county-nc-granicus-meetings';
```

**Registry transition:**

```sql
select public.transition_feed_candidate(
  'wake-county-nc-granicus-meetings',
  'title_gate_verified', 'inserted', 'insert',
  'operator', 'insert-gov-feed-candidate workflow success', <lock_version>
);
```

**No-Go:** `active = true` in INSERT SQL; workflow grep failure; row missing.

---

## Phase 4 — Dry Run

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator |
| **Inputs** | Discovery JSON or committed fixture |
| **Outputs** | Probe pass; registry `dry_running` → `dry_run_pass` |
| **Evidence** | CLI stdout / workflow log; sample titles |
| **Approvals** | Operator human review (Phase 1A Step 3) |
| **Go/No-Go** | **Go** if probe exit `0` and titles match county commission |

**Registry:** `inserted` → `dry_running` (`start_dry_run`)

> **Pre-insert probe vs registry dry run:** in Phase 1A the probe ran *before*
> insert (operator Steps 2–3). The implemented Phase 1B machine models the dry
> run **after** insert (`inserted → dry_running → dry_run_pass`); only this
> registry-tracked run satisfies gate G7. An additional **pre-insert probe is
> optional** — same command, no registry transition — useful to fail fast
> before generating SQL, but it does not substitute for this phase.

**Command:**

```bash
node scripts/gov-feeds/probe-candidate.mjs \
  --candidate results/gov-feed-discovery.json
```

**Or workflow:** `dryrun-gov-feed`

**On pass:** `dry_running` → `dry_run_pass` (`dry_run_pass`)

**On fail:** `dry_running` → `dry_run_failed` (`dry_run_fail`) → **No-Go** — see Rollback Checklist § Failed dry run.

**No-Go:** Exit code 1; wrong-board titles.

---

## Phase 5 — feeds.csv authoring + sync

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator |
| **Inputs** | INSERT SQL fields |
| **Outputs** | Matching `feeds.csv` row in `homesignal-ingest` (`active=false`) |
| **Evidence** | Ingest PR / commit SHA |
| **Approvals** | Ingest repo merge |
| **Go/No-Go** | **Go** after sync check exit `0` |

**Action:** Add row to `homesignal-ingest/feeds.csv` — all fields must match DB INSERT.

**Sync check:**

```bash
FEEDS_CSV=../homesignal-ingest/feeds.csv \
SUPABASE_URL=https://qwnnmljucajnexpxdgxr.supabase.co \
SUPABASE_SERVICE_ROLE_KEY="<key>" \
node scripts/gov-feeds/sync-feeds-config.mjs --live
```

**Or workflow:** `sync-feeds-config` (with ingest checkout).

**No-Go:** Exit 1 (drift). Activation blocked until resolved.

---

## Phase 6 — Golive

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator |
| **Inputs** | `feed_id`, ingest `feeds.csv` row |
| **Outputs** | Meetings in `public.meetings`; registry `dry_run_pass` → `goliving` |
| **Evidence** | `golive-feed` workflow run URL; meeting count query |
| **Approvals** | Operator confirms scoped ingest only (`ONLY_FEED`) |
| **Go/No-Go** | **Go** if ≥ 1 meeting row for feed's `community_id` with expected titles |

**Registry:** `dry_run_pass` → `goliving` (`start_golive`)

**Ingest workflow:** `golive-feed` with `ONLY_FEED=wake-county-nc-granicus-meetings`

**Verify:**

```sql
select count(*) as meeting_count,
       max(created_at) as newest
from public.meetings
where community_id = '<WAKE_COUNTY_ROOT_UUID>'
  and source like '%wake.granicus.com%';
```

**Increment registry:**

```sql
update public.feed_candidates
set golive_attempts = golive_attempts + 1, updated_at = now()
where feed_id = 'wake-county-nc-granicus-meetings';
```

**No-Go:** 0 meetings after golive; ingest workflow failure.

---

## Phase 7 — Title Verification

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator |
| **Inputs** | `community_id`, `feed_id` |
| **Outputs** | L2 pass; `title_verified_at` set; registry `goliving` → `title_verified` |
| **Evidence** | Verify workflow log; match ratio ≥ 0.8 |
| **Approvals** | Operator confirms feed-scoped L2 (not legacy host scope) |
| **Go/No-Go** | **Go** if verify exit `0` |

**Command:**

```bash
SUPABASE_URL=https://qwnnmljucajnexpxdgxr.supabase.co \
SUPABASE_SERVICE_ROLE_KEY="<key>" \
node scripts/gov-feeds/verify-candidate-titles.mjs \
  --community-id "<WAKE_COUNTY_ROOT_UUID>" \
  --feed-id "wake-county-nc-granicus-meetings"
```

**Or workflow:** `verify-gov-feed-candidate`

**On pass — set timestamp and transition:**

```sql
update public.feed_candidates
set title_verified_at = now(), updated_at = now()
where feed_id = 'wake-county-nc-granicus-meetings';

select public.transition_feed_candidate(
  'wake-county-nc-granicus-meetings',
  'goliving', 'title_verified', 'title_verify_pass',
  'operator', 'L2 feed-scoped title verify pass', <lock_version>
);
```

**On fail:** `goliving` → `title_verify_failed` → **No-Go** — Rollback Checklist § Failed title verification.

**No-Go:** Ratio < 0.8; wrong-board pattern match.

---

## Phase 8 — Activation

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator (execution); Founder (approval) |
| **Inputs** | Candidate row JSON, feed row JSON, sync diff JSON |
| **Outputs** | `public.feeds.active = true`; registry `title_verified` → `activating` → `active` |
| **Evidence** | Activation gate report; founder sign-off; audit log |
| **Approvals** | **Founder Go/No-Go required** |
| **Go/No-Go** | **Go** only if all activation gates pass AND founder approves |

**Pre-flight — export staging rows to JSON files** (for CLI/workflow):

Query candidate + feed rows; save as repo paths (e.g. `results/pilot-a-candidate.json`, `results/pilot-a-feed.json`).

**Set operator claim** (required for `valid_claim` gate):

```sql
update public.feed_candidates
set claimed_by = '<operator_id>',
    claim_expires_at = now() + interval '24 hours',
    updated_at = now()
where feed_id = 'wake-county-nc-granicus-meetings';
```

**Activation gate pre-flight:**

```bash
node scripts/gov-feeds/activate-feed-candidate.mjs \
  --feed-id wake-county-nc-granicus-meetings \
  --candidate-json results/pilot-a-candidate.json \
  --feed-json results/pilot-a-feed.json \
  --sync-json results/pilot-a-sync.json
```

**Or workflow:** `activate-gov-feed-candidate` (gates only — does **not** activate).

**Gates checked:** `title_verified_at`, `feed_active_false`, `sync_pass`, `circuit_closed`, `valid_claim`

**Producing `--sync-json`:** `sync-feeds-config.mjs` emits a **text** report
(`--out-report`), not JSON — the sync JSON is a small file the operator writes
from the authoritative sync run. Immediately before activation, run the live
sync (G10): on exit `0`, record `{ "has_drift": false }` as
`results/pilot-a-sync.json`; on drift, record `{ "has_drift": true }` so the
gate fails. If `--sync-json` is omitted the CLI **assumes no drift**, so the
CLI's `sync_pass` gate is only as truthful as this file — **G10 (live
`sync-feeds-config` exit `0` at activation time) remains the authoritative sync
gate**; the CLI gate is a pre-flight mirror of it.

**Registry:** `title_verified` → `activating` (`start_activation`)

**Activate feed** (only after gates pass + founder approval):

```sql
update public.feeds
set active = true, updated_at = now()
where feed_id = 'wake-county-nc-granicus-meetings'
  and active = false;
```

**Set `active=true` in `feeds.csv`**; re-run sync (exit 0).

**Registry:** `activating` → `active` (`activate`)

```sql
update public.feed_candidates
set activated_at = now(), updated_at = now()
where feed_id = 'wake-county-nc-granicus-meetings';
```

**No-Go:** Any gate failure; sync drift; founder withholds approval.

---

## Phase 9 — 48-hour soak

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator (monitoring); Founder (sign-off at end) |
| **Inputs** | Active feed, community pages |
| **Outputs** | Soak log; 0 wrong-board findings |
| **Evidence** | Hourly/daily check notes; meeting freshness query |
| **Approvals** | Founder sign-off before rollback drill |
| **Go/No-Go** | **Go** to rollback drill if 48h clean |

**Checks (minimum 2× daily):**

```sql
-- Feed still active
select feed_id, active, updated_at from public.feeds
where feed_id = 'wake-county-nc-granicus-meetings';

-- Registry state
select state, activated_at, title_verified_at from public.feed_candidates
where feed_id = 'wake-county-nc-granicus-meetings';

-- Meeting freshness
select count(*), max(meeting_date) from public.meetings
where community_id = '<WAKE_COUNTY_ROOT_UUID>';
```

**Page check:** `https://homesignal.net/community.html?zip=27601` — Meetings tile shows Wake county commission items.

**No-Go for Pilot B authorization:** Wrong-board content; feed silently inactive; registry state ≠ `active`.

---

## Phase 10 — Rollback drill

| Field | Detail |
|-------|--------|
| **Responsible actor** | Operator |
| **Inputs** | Active pilot feed |
| **Outputs** | Registry `superseded`; feed `active=false`; drill evidence |
| **Evidence** | Full audit log chain; rollback CLI output |
| **Approvals** | Founder witnesses drill completion |
| **Go/No-Go** | **Go** if chain completes without illegal transitions |

**Validate chain (offline first):**

```bash
node scripts/gov-feeds/rollback-feed-candidate.mjs --from active --event open_circuit
```

**Or workflow:** `rollback-gov-feed-candidate`

**Execute registry transitions in order:**

1. `active` → `open_circuit` (`open_circuit`)
2. `open_circuit` → `circuit_halting` (`start_circuit_halt`)
3. `circuit_halting` → `circuit_halted` (`circuit_halted`)
4. `circuit_halted` → `rollback_running` (`start_rollback`)
5. `rollback_running` → `rolled_back` (`rollback_complete`)

**Deactivate feed:**

```sql
update public.feeds
set active = false, updated_at = now()
where feed_id = 'wake-county-nc-granicus-meetings';
```

**Set `active=false` in `feeds.csv`**; sync pass.

**Terminus:**

```sql
select public.transition_feed_candidate(
  'wake-county-nc-granicus-meetings',
  'rolled_back', 'superseded', 'supersede',
  'operator', 'Pilot A rollback drill complete', <lock_version>
);
```

**No-Go:** Illegal transition error; feed still active after drill.

---

## Evidence bundle (submit at Pilot completion)

| # | Artifact |
|---|----------|
| 1 | P0 DDL apply timestamps + verification query outputs |
| 2 | Discovery JSON + dry-run log |
| 3 | Insert SQL commit SHA + workflow URL |
| 4 | Sync check output (pre- and post-activation) |
| 5 | Golive workflow URL + meeting count query |
| 6 | Title verify output (match ratio) |
| 7 | Activation gate JSON (`ok: true`) |
| 8 | Founder activation approval (email/ticket) |
| 9 | 48h soak log |
| 10 | Rollback drill audit log export |
| 11 | `feed_candidate_audit` full history for Wake feed |

---

## Quick reference — Phase 1A workflows

| Workflow | When |
|----------|------|
| `discover-gov-feed` | Phase 1 |
| `dryrun-gov-feed` | Phase 4 |
| `insert-gov-feed-candidate` | Phase 3 |
| `sync-feeds-config` | Phase 5, 8, 10 |
| `verify-gov-feed-candidate` | Phase 7 |
| `activate-gov-feed-candidate` | Phase 8 (gates only) |
| `rollback-gov-feed-candidate` | Phase 10 (validate) |
| `golive-feed` (ingest) | Phase 6 |
