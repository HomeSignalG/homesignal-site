# ZIP scope recovery — blocking-review response (2026-10-11, revision 2)

Scope: PR #1829 (`docs/dev-change-recovery.sql`, NOT applied, NOT merged). No production change was made; the only
production access was read-only `EXPLAIN ANALYZE` / `SELECT`.

## 1. The rule (rule_version 4) — a positive receipt, a per-source baseline, a continuity test

Revision 3 proved a source was monitored by the presence of a stamped record and by the absence of a failure log. Two defects:
(1) an expanded read with an EMPTY ring could not establish a baseline, so the first genuine arrival after it was silent; (2) "no
failure row" was read as completeness. Revision 4 replaces both with a positive **source completion receipt**
(PR #1840: `scope-receipt.ts`, `docs/dev-source-receipt.sql`) — per ZIP x source: the scope that ran (`expanded|fallback|legacy|failed`),
its **scope version** (rule + envelope + radius), and `complete` (no truncation, no failed/unresolved membership test, no
overflow). It is linked to the cache generation by `tick_at = development_reports.refreshed_at`. `dev_refresh_collect` is untouched.

| new comparable stamped identity, per ZIP x source | outcome |
|---|---|
| complete expanded read, CONTINUOUS baseline at the same version | ordinary `first_detected` (material, reportable) |
| complete expanded read, no continuous baseline (first expansion, changed version, or any break) | `coverage_recovered`: the baseline / re-baseline — silent, audited |
| incomplete / fallback / failed / no receipt | HELD: not observed; a later complete read classifies it |
| unstamped (legacy scope) | unchanged |

**Readiness** (`dev_change_scope_ready`, per ZIP x source, bound to a scope version) is established by a complete expanded
receipt **even when the ring is empty**, so the first record to arrive afterwards is news (E01–E03). It is **continuous** only while
every receipt since the baseline's verified generation is also a complete expanded read at the same version, the verified
generation's own receipt is still on record, no response was `lost`, and the row is not suspended. A break the ledger never observed
(G01), a pruned anchor (G03) and a lost response (G04) all break it; an unobserved complete generation does not (G02).

**Per-source independence.** A source that is not a complete expanded read (or is missing from a ZIP that has receipts) suspends
**its own** baseline only and is listed in `public.dev_change_scope_health`; other sources keep theirs (M01–M08, J01–J02). A
persistently incomplete source never reaches readiness, holds its records on every observation, and stays listed (H01).

**Policy for "what happens at the next successful comparable read"** (decided from coverage evidence, not from dates): continuity
intact => normal detection; any break => re-baseline, because records that arrive across a coverage gap cannot be told from
backfill and HomeSignal must not manufacture new-development alerts from them. The cost is that a genuine arrival during a gap is
quiet; the gap itself is visible (`scope_ready_suspended`, `coverage_held`, the health view).

## 2. Synchronisation (`dev_change_recovery_probe`)

One STABLE SQL statement = one snapshot, reading together: the cache clock, every development row's generation (equality, never
max/>=), requested-key binding, the stamped elements, the receipts of that generation and the readiness rows. Concurrency is
*executed* (`run.sh` C01–C05): a collector write (C01) or a receipt commit (C04) landing during the probe is invisible to it and
visible to the next; a positive control (C03) shows the scenario really splits a volatile helper. The observation runs under the
ledger's advisory lock in one transaction.

## 3. Benchmarks (read-only on production; the new function is NOT installed, so these time the exact statements)

Measured 2026-10-11 with `EXPLAIN (ANALYZE)` on the probe's CTEs against production data. The stamp scan finds no stamped
element today (the widening is off), so it measures scan cost, not stamped-row volume.

| ZIP | development rows | barrier (clock + generation + failure read) | stamp scan (dedup + filter) |
|---|---:|---:|---:|
| 76258 (typical) | 275 | **3.0 ms warm** (621 ms cold, 248 heap reads) | not run (same code path, linear) |
| 28451 (largest, 13,846 `app_projects` rows / 13,890 cached sites) | 13,846 | **116 ms warm** (2.8 s cold) | **194 ms** (dedup sort spills 16 MB to disk) |

Warm per-row cost ≈ 0.011 ms barrier + 0.014 ms scan. **Estimate (not a measurement)** for the worst case — the probe
run on *every* ZIP observation of a fully expanded country: ~3.2 M development rows x ~0.025 ms ≈ 80 s per full pass,
against a nightly change-observation budget of ~84 calls x 60 s ≈ 5,040 s (≈1.6%). The probe is lazy before any expansion
(runs only for a ZIP with a new comparable identity, readiness rows, or an already-recovered identity), so today's cost is
zero. The cold number is irrelevant to the marginal cost: the observer reads the same rows first.

## 4. Records versus distinct projects

Unchanged and kept independent of this PR: the ZIP tile counts permit/application **records**. Measured read-only:
76258 275 records / 208 distinct addresses; 76247 341/244; 76227 418/306; 78617 570/347; 10025 792/402. Distinct address is
only an upper-bound proxy for projects and **is not implemented as a count**. Proposed, not implemented, needs approval: label
the tile "Development records" and show a distinct-project figure only where a canonical project identity exists.

## 5. Remaining risks / unsupported assumptions

- Nothing exists in production yet: the receipt SQL, the receipt collect job and the connector change are all undeployed (PR #1840);
  until then there are NO receipts and every stamped record is held (fail closed). The ledger SQL refuses to apply without the receipt tables.
- The receipt collect job links a receipt to its generation through the collector's cursor; a response whose receipt is not recorded
  within the cache's next generation (job down) leaves that generation without evidence (held, listed).
- Receipts are kept 7 days; a baseline older than that cannot prove continuity and is re-baselined (quiet) — a design bound, not a defect.
- A genuine arrival during a coverage gap is baselined silently (stated above).
- Duplicate twins of one identity never differ in `scope_origin`.
- `ZIP_SCOPE_BOUNDS_MODE` is believed unset; secrets cannot be read.
- The ledger test fixture carries the receipt table/view DDL as a copy of PR #1840's; a CI parity check between the two files should
  be added when #1840 merges.
