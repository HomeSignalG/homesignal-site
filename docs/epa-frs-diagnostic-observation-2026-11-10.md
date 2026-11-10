# EPA FRS diagnostic observation, get-address-report v314 (2026-11-10)

Receipt for the diagnostic-only change #2752 (merge `f12896da`). Aggregate counts only: no response
text, no ZIP lists, no addresses. Draft; not to be merged without the founder's approval.

## What was deployed, and when

| item | value |
|---|---|
| dispatch | 2026-11-10 13:35:38Z, `deploy-edge-functions` run 42825941300, actor HomeSignalG |
| commit the run checked out | `f12896da1c2dc0114a34fbee91557ae93c231109` (the run log's `git log -1`) |
| deployed | 2026-11-10 13:36:07Z, version **314** (313 before) |
| bundle hash | `4c1afe8ebf9660717b6a850541d286f2409159a0754b031b1423e59eb16b877e` (313: `33a8ae98…`) |
| deployed files | 38, each byte-identical to `f12896da` |
| old text-scrubbing code (`sanitizeErrorText`) | 0 occurrences in the deployed files |
| registry table rewrite | 10 rows, fingerprint `d807a5055d04012b2eef7d26e1ae2810` before and after; only `computed_at` moved (2026-11-09 23:33:50Z → 2026-11-10 13:36:09Z) |

Pause variable `EPA_RECOVERY_REPAIR_PAUSED=true`: saved by the founder at **about 2026-11-10 14:24Z**
(user-confirmed; not read back by this session). Observations after it are split at 14:24Z.

## Collection cutoffs (each query, exactly)

| source | window | read at |
|---|---|---|
| edge function logs (`function_edge_logs`, function id `f33bae69…`) | 13:20:00Z – 14:20:00Z | ~14:14Z |
| `net._http_response`, v314 side | `created` ≥ 13:36:07Z and < 14:14:00Z, HTTP 200, ZIP-mode (`"mode":"zip_boundary"`) | ~14:20Z |
| `net._http_response`, v313 comparison | `created` ≥ 13:00:00Z and < 13:36:07Z, same filter | ~14:14Z |

`net._http_response.created` is about when the request was sent, not when it finished. The edge logs give
version per request: version 313 served 63 requests up to 13:34:23Z and version 314 served 169 from
13:38:23Z, with no overlap, so every v314-side response above was served by 314. The earliest v314-side
response row is 13:38:14Z and the latest 14:12:02Z.

## Counts

| | ZIP-mode reads | `epa.ok` false | carrying `diag` |
|---|---:|---:|---:|
| 13:00 – 13:36:07Z (v313) | 141 | 83 | 0 |
| 13:36:07 – 14:14Z (v314) | 143 | 84 | 32 |

No request in either window had a non-200 status. All 84 v314 failures carry `reason: transient`.
No successful read carried `diag`.

## Reconciliation

### 1. "31 TypeError" vs "attempt counts totalling 34"
They count different things. There are **34 diag entries** in **32 reads**:

| entries | name | stage | kind | attempt | reads |
|---:|---|---|---|---|---:|
| 23 | TypeError | fetch | tls | 3 | 23 |
| 8 | TypeError | fetch | tls | 4 | 8 |
| 1 | SyntaxError | parse | invalid_json | 1 | 1 (same read) |
| 1 | SyntaxError | parse | invalid_json | 2 | ⤷ |
| 1 | SyntaxError | parse | invalid_json | 3 | ⤷ |

The attempt distribution (1:1, 2:1, 3:24, 4:8) covers all 34 entries: the 31 TypeError entries plus the
3 SyntaxError entries from one read. 31 + 1 = 32 reads with `diag`. Every entry has the same 8 fields
(`attempt, code, kind, ms, name, os_error, since_prev_ms, stage`); `code` and `os_error` are null on all 34;
the largest `diag` array is 3 entries and 444 bytes (limit 8 / 1,024).

### 2. What the timing statistics describe
The earlier single figures (median 6.5 ms, gap 2,001–5,015 ms) mixed both error names. Split:

| entries | ms (min / median / max) | gap since previous attempt, ms (min / median / max) |
|---|---|---|
| TypeError, attempt 3 (23) | 1 / 10 / 46 | 5,000 / 5,001 / 5,010 |
| TypeError, attempt 4 (8) | 1 / 2 / 5 | 5,001 / 5,003 / 5,015 |
| SyntaxError (3, one read) | 3,196 – 3,418 each | null on attempt 1; 2,001 then 5,008 |

`ms` is the length of the failing attempt; `since_prev_ms` is the time from the end of the previous attempt
to the start of this one.

### 3. Collection cutoffs
Stated above, per query.

### 4. The 52 failed reads with no `diag`
Read from each response's own `epa.failures` array (the engine writes one `<radius>:<what>` string per
failed attempt; `429` there is the HTTP status the engine received), not inferred:

| reads | failure sequence recorded by the engine |
|---:|---|
| 48 | 429 > 429 > 429 |
| 3 | process_limit > 429 > 429 > 429 |
| 1 | process_limit > 429 > 429 > 429 > 429 > 429 |

All 52 ended on HTTP 429. None of them threw an error, which is why none carries `diag`. For comparison,
the 32 reads with `diag` recorded: 23 × `429 > 429 > TypeError`, 8 × `process_limit > 429 > 429 > TypeError`,
1 × `SyntaxError > SyntaxError > SyntaxError`.

## Findings (v314 window only)

- Of the 84 failed reads, 83 had two HTTP 429 replies and then a third attempt on the same search area,
  5 seconds later. That third attempt was refused again with 429 in 52 reads and threw TypeError in 31.
- Every TypeError was thrown in the `fetch` stage (before response headers), within 1–46 ms of the
  attempt starting, and only on an attempt that followed a 5-second wait after a second 429. No TypeError
  appeared on a first or second attempt.
- **`tls` is an inferred category, not a confirmed mechanism.** It means only that the error's message or
  cause contained the word "tls", "ssl", "certificate" or "handshake", and none of the earlier rules
  (timeout, abort, connection reset or refused, DNS) matched. The patch keeps no message text, so the
  actual words are not available, and no error code or OS error number was present.
- The 3 SyntaxError entries are one read whose replies were not JSON on all three attempts (3.2–3.4 s each).
- 3 of the 59 successful reads also recorded at least two 429 entries in their `failures` (not necessarily
  on the same search area).

What this does not show: whether the TypeErrors would otherwise have been 429s, why a request after two
429s fails at connection setup, or whether the server, the network or the runtime is responsible.
Increase observed after deployment; mechanism unknown. These findings narrow the failure pattern (which
stage, how fast, which attempt); they do not establish a TLS mechanism, and they do not authorize a
connection-handling or retry change.

## Diagnostic removal proposal (needs approval)

The diagnostic has answered what it was added to answer: which stage fails (fetch, before headers), how
fast (milliseconds), and on which attempt (only the one after the second 429's 5-second wait). It cannot
say more without keeping message text, which was deliberately excluded.

Draft revert PR: #2770 (head `782da633`), not merged or deployed. Proposed: a revert PR of #2752's three engine files (`sources/epa-frs.ts`, `sources/epa-frs-zip.ts`,
`index.ts`) plus `test/epa-frs-diagnostic.test.mjs`, then one `deploy-edge-functions` dispatch from main
after the same pre-checks used for v314 (tree hashes, registry-table content, version and bundle
read-back, deployed files byte-identical to the commit). Collection does not stop by itself; it continues
until that deploy. Removal is not done until approved.

## Observation schedule

4-hour checks, each inside the ~6-hour `net._http_response` retention, each split at the deploy time
(13:36:07Z) and at the pause time once the variable is set. Each check appends its aggregate counts here.

## Repair pause

- The merged condition (#2756, `a0c7d398`) is on `main`: `.github/workflows/epa-recovery-watch.yml`,
  Step 3, `if: steps.proof.outputs.passed == 'true' && vars.EPA_RECOVERY_REPAIR_PAUSED != 'true'`.
- The two most recent scheduled runs skipped the repair step with the variable unset, because their proof
  did not pass: run 1507 (42823283841, 13:18Z, on `f12896da`) and run 1508 (42832695063, 14:18Z, on
  `a0c7d398`). Step 2a fired the 82801 proof and Step 3 shows `skipped` in both. So no 60-ZIP batch was
  sent at 13:18Z or 14:18Z. Any batch sent by an earlier run is not cancelled by the variable.
- Consequence for verification: a skipped Step 3 does not by itself show the variable is working. That
  needs a scheduled run whose proof PASSED and whose Step 3 is still skipped, read from that run's log.
- Variable set: `EPA_RECOVERY_REPAIR_PAUSED=true`, saved by the founder at about 2026-11-10 14:24Z.
  User-confirmed; this session has no tool that can read repository variables, so it is not read back.
- Verification uses the next naturally scheduled run only (no extra run, no extra EPA request). If that
  run's proof does not pass, it is recorded as: "pause configured; skip reason not independently
  demonstrated by this run."

### First scheduled run after the pause: run 1509 (42842850886)

Scheduled, created 15:17:46Z, on `a0c7d398` (the #2756 condition). Read from that run's own job log; no
extra run and no extra EPA request was made to verify it.

| step | outcome |
|---|---|
| Step 2a, fire the 82801 proof | ran (the normal one proof request this workflow sends each hour) |
| Step 2b, harvest the proof | `proof_passed: true` on the first poll (facilities 61 before, 61 after, at least 40 expected) |
| Step 3, the 60-ZIP repair batch | **skipped** |
| Report | ran; it opened issue #2771, as it does every run |
| Disable step | ran and failed silently (`not a git repository`, then `|| true`), as before; the schedule stays on |

With `steps.proof.outputs.passed == 'true'`, the only other operand in Step 3's condition is
`vars.EPA_RECOVERY_REPAIR_PAUSED != 'true'`, so this run is the first one in which the pause, and not a failed
proof, is what kept the repair batch from being sent. The variable itself is still not read back by this
session. Runs 1507 (13:18Z) and 1508 (14:18Z) had skipped Step 3 because their proof did not pass, so they
show nothing about the pause.
