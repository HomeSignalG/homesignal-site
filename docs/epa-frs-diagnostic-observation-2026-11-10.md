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

## 4-hour check, read 2026-11-10 ~18:16Z

Windows: deploy → pause is `created` ≥ 13:36:07Z and < 14:24:00Z; after pause is ≥ 14:24:00Z and < 18:15:00Z
(`net._http_response`, HTTP 200, ZIP-mode). The pause boundary is the founder's approximate save time.
Edge logs for the same span: version 314 only (205 requests before 14:24Z, 930 after; first 13:38:23Z, last
18:14:23Z). 3 requests returned HTTP 546, between 14:53:19Z and 16:02:54Z; the rest returned 200. The 546
responses carry no body this receipt reads, so their cause is not recorded here.

| | reads | `ok` false | with `diag` | `diag` on a successful read | largest `diag`, bytes |
|---|---:|---:|---:|---:|---:|
| deploy → pause (≈48 min) | 180 | 100 | 38 | 0 | 444 |
| after pause (≈3 h 51 min) | 878 | 332 | 119 | 0 | 443 |

The first row now covers 180 reads, not the 143 in the first check, because the first check stopped at 14:14Z.

Diagnostic entries (name / stage / kind / attempt):

| | deploy → pause | after pause |
|---|---:|---:|
| TypeError / fetch / tls / attempt 3 | 27 | 83 |
| TypeError / fetch / tls / attempt 4 | 9 | 21 |
| SyntaxError / parse / invalid_json / attempt 1 | 2 | 23 |
| SyntaxError / parse / invalid_json / attempt 2 | 1 | 1 |
| SyntaxError / parse / invalid_json / attempt 3 | 1 | 1 |

`code` and `os_error` were null on every entry in both windows. TypeError attempt length was at most 63 ms
(before the pause) and 52 ms (after). The gap before a TypeError was 5,000–5,015 ms before the pause and
2,002–5,015 ms after; the 2,002 ms case is the `process_limit > 429 > TypeError > 429` sequence below.

Failure sequences recorded by the engine in `epa.failures` (failed reads only):

| sequence | deploy → pause | after pause |
|---|---:|---:|
| 429 > 429 > 429 | 50 | 110 |
| process_limit > 429 > 429 > 429 | 11 | 100 |
| 429 > 429 > TypeError | 27 | 73 |
| process_limit > 429 > 429 > TypeError | 9 | 20 |
| SyntaxError > 429 > 429 | 1 | 14 |
| SyntaxError > 429 > TypeError | 0 | 8 |
| process_limit > 429 > TypeError > 429 | 0 | 2 |
| row_ceiling > 429 > 429 > TypeError | 0 | 1 |
| process_limit > process_limit > 429 > 429 > 429 | 0 | 2 |
| process_limit > 429 > 429 > 429 > 429 | 0 | 1 |
| process_limit > 429 > 429 > 429 > 429 > 429 | 1 | 0 |
| SyntaxError > SyntaxError > SyntaxError | 1 | 1 |

What this adds: after the pause, TypeError also appeared once after a single 429 and a 2-second wait (2 reads),
not only after two 429s. Every TypeError still came after at least one 429 on the same search area. More reads
ran after the pause than before it, over a longer window; this receipt does not measure why. Increase observed
after deployment; mechanism unknown.

### Scheduled recovery runs after the pause

| run | created | proof passed? | Step 3 (repair) | disable step |
|---|---|---|---|---|
| 1509 (42842850886) | 15:17:46Z | yes (from its log) | skipped | ran (the condition `steps.proof.outputs.passed == 'true'` held); failed silently |
| 1510 (42853262717) | 16:18:51Z | yes (the disable step, which runs only when the proof passed, ran) | skipped | ran |
| 1511 (42863454488) | 17:17:41Z | yes (same reasoning) | skipped | ran |

So in three scheduled runs since the pause the proof passed and the repair batch was not sent. Each run still
sent its one proof request and opened its report issue; the schedule stays on.

## Missed window: 2026-11-10 18:15Z – 22:15Z (raw responses expired)

The check scheduled for 22:15Z on 2026-11-10 reached this session at 2026-11-11 15:56Z, about 17.5 hours late.
By then `net._http_response` held only rows from 2026-11-11 09:58:00Z onward (0 rows in the window), so the
aggregate counts for 18:15Z–22:15Z, and for 22:15Z–09:58Z, **were not collected and cannot be recovered**.
Only the edge logs, which are kept longer, cover those hours:

| window | v314 requests, HTTP 200 | HTTP 546 | other versions |
|---|---:|---:|---|
| 2026-11-10 18:15Z – 22:15Z | 960 | 6 | none |
| 2026-11-10 22:15Z – 2026-11-11 09:58Z | 2,800 | 1 | none |
| 2026-11-11 09:58Z – 15:56Z | 1,434 | 3 | none |

The 546 responses carry no body this receipt reads; their cause is not recorded here.

**What the retained evidence supports for 2026-11-10 18:15Z – 2026-11-11 09:58Z (about 15 h 43 min):**
- Every `get-address-report` request in the edge logs was served by version 314 (no other version appears).
- The counts above are all requests to the function, address mode and ZIP mode together. They are not
  ZIP-mode EPA reads, and they say nothing about EPA results.

**What cannot be counted for that interval:** ZIP-mode reads, failed EPA reads, reads carrying `diag`,
diagnostic entries by name, stage, kind or attempt, the failure sequences, attempt timings, and whether any
successful read carried `diag`. The responses that held them were deleted by the ~6-hour retention before
they were read.

**What stays unknown for that interval:** how many TypeError (or SyntaxError) entries occurred; whether the
pattern seen before and after it (every TypeError after at least one 429, failing in the fetch stage within
milliseconds) held throughout; whether any new error name, stage or kind appeared; and whether any entry carried
an error code or OS error number. **Missing data is not zero events.** No total in this receipt includes that
interval, and no comparison across it is made.

## Retained window: 2026-11-11 09:58Z – 15:56Z (read 15:56Z)

`created` ≥ 09:58:00Z and < 15:56:00Z, HTTP 200, ZIP-mode. Everything here is after the pause.

| reads | `ok` false | with `diag` | `diag` on a successful read | largest `diag`, bytes |
|---:|---:|---:|---:|---:|
| 1,290 | 452 | 117 | 0 | 283 |

| entry (name / stage / kind / attempt) | count |
|---|---:|
| TypeError / fetch / tls / attempt 3 | 64 |
| TypeError / fetch / tls / attempt 4 | 47 |
| SyntaxError / parse / invalid_json / attempt 1 | 8 |

`code` and `os_error` null on every entry. TypeError attempts at most 48 ms; gap before them 2,001–5,012 ms.

| failure sequence | count |
|---|---:|
| 429 > 429 > 429 | 186 |
| process_limit > 429 > 429 > 429 | 145 |
| 429 > 429 > TypeError | 61 |
| process_limit > 429 > 429 > TypeError | 47 |
| SyntaxError > 429 > 429 | 6 |
| SyntaxError > 429 > TypeError | 2 |
| process_limit > 429 > TypeError > 429 | 1 |
| process_limit > 429 > 429 > 429 > 429 | 1 |
| process_limit > 429 > 429 > 429 > 429 > 429 | 1 |
| process_limit > 429 > 429 > process_limit > 429 > 429 > 429 | 1 |
| process_limit > process_limit > process_limit > 429 > 429 > 429 | 1 |

The pattern is unchanged from 2026-11-10: every TypeError follows at least one 429 on the same search area,
fails in the fetch stage within milliseconds, and no successful read carries `diag`. Increase observed after
deployment; mechanism unknown.

### Recovery runs

`main` moved to `1849b712` with no change to `.github/workflows/epa-recovery-watch.yml` or to the
`get-address-report` / `_shared` folders since `a0c7d398`. The Step 3 condition is still present. Run 1533
(43046903806, 2026-11-11 15:17:40Z) ran its proof, skipped Step 3, and ran the disable step (which runs only
when the proof passed), so its repair batch was not sent. Runs 1512–1532 were not inspected individually.

## Check read 2026-11-11 19:51Z: window 15:56Z – 19:50Z

The window is still retained (oldest row in `net._http_response` at the read: 13:52:01Z). `created` ≥ 15:56:00Z
and < 19:50:00Z, HTTP 200, ZIP-mode; first row 15:56:01Z, last 19:48:01Z. All after the pause.
Edge logs for the same span: version 314 only, 937 HTTP 200 and 1 HTTP 546 (15:59:32Z; cause not recorded here).

| reads | `ok` false | with `diag` | `diag` on a successful read | largest `diag`, bytes |
|---:|---:|---:|---:|---:|
| 882 | 334 | 111 | 0 | 148 |

| entry (name / stage / kind / attempt) | count |
|---|---:|
| TypeError / fetch / tls / attempt 3 | 64 |
| TypeError / fetch / tls / attempt 4 | 40 |
| TypeError / fetch / tls / attempt 5 | 2 |
| SyntaxError / parse / invalid_json / attempt 1 | 5 |

`code` and `os_error` null on every entry. TypeError attempts at most 73 ms; gap before them 2,001–5,014 ms.

| failure sequence | count |
|---|---:|
| 429 > 429 > 429 | 129 |
| process_limit > 429 > 429 > 429 | 94 |
| 429 > 429 > TypeError | 60 |
| process_limit > 429 > 429 > TypeError | 40 |
| SyntaxError > 429 > 429 | 5 |
| process_limit > 429 > TypeError > 429 | 4 |
| 429 > process_limit > 429 > 429 > TypeError | 2 |

New in this window: 2 TypeErrors on attempt 5, both in the sequence `429 > process_limit > 429 > 429 > TypeError`
(a 429, then a refused larger area that split, then two 429s on the smaller area, then the TypeError). Every
TypeError still follows at least one 429 on the same search area. Increase observed after deployment;
mechanism unknown.

### Recovery run

Run 1537 (43085866443), scheduled, created 19:17:51Z, on `c4c0ea20` (no change to the recovery workflow or the
function code since `a0c7d398`). From its log: `proof_passed: true` on the first poll (60 facilities before and
after, at least 40 expected); Step 3 (repair) skipped; the disable step ran and failed silently as before. No
repair batch was sent; the hourly proof request and the report issue (#2809) went out as usual.
