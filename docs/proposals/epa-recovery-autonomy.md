# PROPOSAL — autonomous EPA-recovery runner (NOT BUILT, NOT SCHEDULED)

Status: **proposed, awaiting approval.** The YAML below is deliberately parked in `docs/proposals/`
and **not** in `.github/workflows/` — a scheduled workflow committed to `main` arms itself
immediately, so putting it there would be shipping it, not proposing it.

Context: the founder does not want to keep checking EPA status by hand. The mechanism must be real
and verifiable, not described. Prior constraint that shapes every choice here: this account was
previously halted at $0, and `verify-geocodes` burned **11 consecutive 6-hour cancellations** before
the Actions cuts — so cost control and hard timeouts are requirements, not hygiene.

---

## 1. Shape: a CHEAP GATE that almost always exits, and an expensive job that almost never runs

The polling step must not pay for Claude Code. Two jobs:

- **`gate`** — one `curl` to PostgREST, no checkout, no Node, no Claude. Reads `epa_frs_probes`,
  emits `recovered=true|false`, exits. This is what runs 99% of the time.
- **`recover`** — `needs: gate`, `if: gate.outputs.recovered == 'true'`. Only this job installs and
  invokes Claude Code headless.

## 2. Cost — measured basis, not a guess

Billing basis: GitHub bills **per job, rounded UP to the whole minute**, Linux runner = 1× on a
private repo.

Measured comparable jobs on THIS repo (2026-08-09 check runs): `verify` **13–17 s**,
`unit` **11–16 s**. The `gate` job is strictly smaller than either — no checkout, no `setup-node`,
one HTTP request — so it lands in the same band and **bills 1 minute**.

| interval | runs/day | billed min/day | billed min/month | verdict |
|---|---:|---:|---:|---|
| every 15 min | 96 | 96 | **~2,920** | ❌ on its own comparable to a whole free-tier allowance |
| every 30 min | 48 | 48 | ~1,460 | ❌ hard to justify for an outage watch |
| **hourly** | **24** | **24** | **~730** | ✅ **recommended** |
| every 4 h | 6 | 6 | ~180 | cheapest, but up to 4 h of dead time on a repair that is already slow |

**Recommendation: hourly**, and — the part that actually bounds the bill — **the workflow disables
its own schedule once recovery has run**. Cost is therefore not `~730/month`; it is
**~1 billed minute per hour of remaining outage**, one recovery run, and then zero. If EPA is down
another 12 hours: **~12 minutes + one recovery run**, total, ever.

`recover` job: hard `timeout-minutes: 45`; realistic 10–20 min → **~20 billed minutes, once.**

**Separate, non-Actions cost:** `recover` consumes Anthropic API tokens against
`ANTHROPIC_API_KEY`. One run, bounded by `--max-turns`.

## 3. The hard limits are STRUCTURAL, not prompt text

A prompt saying "do not touch piece (c)" is a request. These are enforcements:

| limit | how it is actually enforced |
|---|---|
| cannot ship piece (c), the badge change, or the 63-sweep | `permissions: contents: read` — **no write token, so it cannot commit or push at all** |
| cannot run arbitrary SQL | it gets **no service-role key**. It calls two `SECURITY DEFINER` RPCs and nothing else (§4) |
| cannot edit the registry | follows from both of the above |
| cannot loop forever | `timeout-minutes` on both jobs + `--max-turns` |
| cannot pile up | `concurrency: { group: epa-recovery, cancel-in-progress: false }` |
| cannot proceed past a failed proof | the **RPC** refuses (§4), not the model |

The model's judgement is used for the *report*, and for describing anything unexpected. It is not
what stands between us and an unwanted change.

## 4. The 82801 proof is enforced server-side, not by the model

Two `SECURITY DEFINER` functions, granted to the anon role, are the whole API surface:

- **`epa_recovery_probe_state()`** → `{ok, last_ok_at, zeroed_pages}`. Read-only.
- **`epa_recovery_step2()`** → un-pause job 14, re-cache **82801 only**, and return
  `{proof_passed, facilities_before, facilities_after}`. **It re-pauses job 14 and returns
  `proof_passed=false` if 82801 does not come back to its pre-outage 40.**
- **`epa_recovery_repair(_batch int)`** → refuses with an exception unless the 82801 proof row is
  recorded as passed. Fires a bounded batch of the remaining zeroed pages.

So "if the proof fails, stop and report" is a property of the database, not of the prompt. A model
that ignored its instructions still could not repair the 1,721.

## 5. It must NOT sit waiting for the repair

At the measured collection rate the 1,721-page repair takes **hours**. The `recover` job must kick
off a bounded batch, report, and exit — not hold a runner. Progress is picked up by the next
scheduled run, which is why the schedule self-disables on *completion*, not on *start*.

## 6. Proposed workflow

```yaml
name: epa-recovery-watch

# PROPOSED — not scheduled until approved. Watches for EPA FRS recovery and, only then,
# runs the already-approved 5-step gate. It cannot ship code: permissions are read-only.
on:
  workflow_dispatch:
  schedule:
    - cron: '17 * * * *'      # hourly, off the :00 rush

concurrency:
  group: epa-recovery
  cancel-in-progress: false

permissions:
  contents: read              # NO write token — this workflow structurally cannot commit or push
  issues: write               # its only write: opening the report issue

jobs:
  gate:
    runs-on: ubuntu-latest
    timeout-minutes: 5        # bounded after the verify-geocodes 6-hour cancellations
    outputs:
      recovered: ${{ steps.check.outputs.recovered }}
    steps:
      - id: check
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
        run: |
          set -euo pipefail
          # Read-only RPC. No checkout, no node, no Claude — this is the 99% path.
          body=$(curl -fsS -X POST "$SUPABASE_URL/rest/v1/rpc/epa_recovery_probe_state" \
            -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
            -H 'Content-Type: application/json' -d '{}')
          echo "probe state: $body"
          ok=$(printf '%s' "$body" | jq -r '.ok // false')
          echo "recovered=$ok" >> "$GITHUB_OUTPUT"
          [ "$ok" = "true" ] || echo "EPA still down — exiting without cost."

  recover:
    needs: gate
    if: needs.gate.outputs.recovered == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm i -g @anthropic-ai/claude-code
      - name: Run the approved 5-step recovery gate
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
        run: |
          claude -p "$(cat .github/prompts/epa-recovery.md)" \
            --max-turns 40 \
            --allowedTools "Bash(curl:*),Bash(jq:*),Read" \
            --append-system-prompt "You may ONLY call the three epa_recovery_* RPCs. You must NOT
              implement piece (c), the NEW badge change, or the 63-entry sweep — those go to the
              founder regardless of what EPA does. If the 82801 proof returns proof_passed=false,
              STOP and report; do not repair the remaining pages."
      - name: Disable the schedule now that recovery has run
        env: { GH_TOKEN: ${{ github.token }} }
        run: gh workflow disable epa-recovery-watch || true
```

## 7. Honest alternative the founder should see before approving

**Most of this gate does not need an LLM.** Un-pause → re-cache one ZIP → compare a number → fire a
batch → count is deterministic. If §4's RPCs exist, a **12-line `curl`-only workflow** does the
whole recovery with **no `ANTHROPIC_API_KEY`, no token cost, and no model in the write path** — and
the only thing lost is the written report, which the founder gets from this session anyway.

The Claude Code version buys judgement for *unexpected* states (EPA half-up, 82801 returning 38 not
40, the repair stalling). That is worth something, but it should be a deliberate purchase.

**Recommendation: build §4's RPCs first — they are the safety property in BOTH designs — then decide
whether the runner is `curl` or Claude Code.**

## 8. What is still needed before this can be built

- Approval of the interval (hourly) and of the self-disable behaviour.
- Two new repo secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (and `ANTHROPIC_API_KEY` only if the
  Claude Code variant is chosen). **No service-role key is required or wanted in this repo.**
- A ruling on §7: `curl`-only, or Claude Code headless.
