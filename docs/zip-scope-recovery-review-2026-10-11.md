# ZIP scope recovery — blocking-review response (2026-10-11, revision 2)

Scope: PR #1829 (`docs/dev-change-recovery.sql`, NOT applied, NOT merged). No production change was made; the only
production access was read-only `EXPLAIN ANALYZE` / `SELECT`.

## 1. The rule (rule_version 3) — baseline once, then ordinary news

Revision 1 of this PR (rule_version 2) treated every `scope_origin = polygon_member` first sighting as
`coverage_recovered` forever. That is a permanent blind spot: months after a ZIP's expanded coverage is established, a
genuinely new filing in the ring would still be silent. Corrected:

| situation, per **ZIP x source (registry_id)**, evaluated by the ledger's one writer | outcome of a NEW comparable stamped identity |
|---|---|
| pair not READY, generation clean | `coverage_recovered` — the baseline: non-material, audited, never announced |
| pair READY, generation clean | ordinary `first_detected`: material, reportable (a genuine arrival after the verified baseline) |
| generation NOT clean (source `fetch_failed` / `truncated` in that same collector tick) | **HELD**: not observed at all this time; a later clean generation classifies it. Nothing is inferred |
| unstamped (legacy scope) | untouched, byte for byte |

**No date decides anything.** Nor does the ledger claim "new to HomeSignal" = "newly filed": the baseline is silence
(no claim), the audit records the publisher date/kind descriptively.

**Readiness evidence** — one new row per ZIP x source, `public.dev_change_scope_ready`, written only by the ledger's
one writer. A pair becomes READY at a **synchronised** observation that (a) shows >= 1 stamped record of that source
(a stamp is itself proof the widening was on for that source in that generation) and (b) is **clean**: no
`dev_refresh_source_failures` row of kind `fetch_failed`/`truncated` for the source whose `seen_at` equals the cache
clock — `dev_refresh_collect` writes both with `now()` of one transaction, so this is an exact match, not a window.
Existing authorities reused: canonical refresh (`development_reports.refreshed_at`), source health
(`dev_refresh_source_failures`), cache-generation/materialisation evidence (`app_projects.provenance.refreshed_at`),
and the change ledger. No second state authority: readiness is derived-and-cached evidence, lapsed or rebuilt from them.

**Lapse** — a synchronised observation that shows **no** stamped record anywhere in the ZIP while readiness rows exist
means the widening is no longer evidenced (mode off, RPC fell back to the legacy scope): all the ZIP's readiness lapses.
When coverage returns the ring is re-baselined silently; known identities are never re-announced (absence is never an
event); records that appeared during the gap are not claimed as genuine.

**Product tradeoff, stated plainly.** HomeSignal will not manufacture "new development" alerts from historical backfill,
and will announce genuinely new arrivals once a source's expanded coverage is verified. The price: the *first*
widened record of a ZIP x source with no stamp at expansion time, a record that first appears in a source whose fetch is
persistently truncated/failing, and records published during an un-observed disable window, are not announced.

## 2. Synchronisation (`dev_change_recovery_probe`) — answers to the review

One STABLE SQL statement = one snapshot, reading in that snapshot: the cache clock, every development row's generation
(equality with the clock, never max/>=), requested-key binding, the stamped elements, and the same-tick failure rows.
Concurrency is *executed*, not argued (`run.sh` C01–C05): a collector write (C01) or a failure-row commit (C04) landing
**during** the probe is invisible to it and visible to the next; a positive control (C03) swaps in the volatile-helper
shape and the same scenario then splits the snapshot, proving the check can fail. The observation itself runs under the
ledger's advisory lock and one transaction; readiness is read and written by that same writer.

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

## 5. Remaining unsupported assumptions

- Cleanliness is only as good as the failure record: an incomplete fetch the refresh did not record is invisible.
- The first widened record of a pair with an empty ring at expansion is silent once (no per-generation scope-mode evidence
  is persisted; adding it needs an Edge Function change, out of this PR's boundary).
- A disable/enable that falls wholly between two observations of a ZIP is not seen, so readiness survives it.
- A source that is truncated on every refresh never reaches readiness; its ring records are held (visible as
  `coverage_held` and as failure rows), not announced.
- Duplicate twins of one identity never differ in `scope_origin`.
- `ZIP_SCOPE_BOUNDS_MODE` is believed unset; secrets cannot be read.
- Whether `dev_refresh_collect` writes failure rows and the cache clock in one transaction was read from the SQL of record
  (`refreshed_at = now()`, `seen_at default now()`), not observed live (no widened ZIP exists yet).
