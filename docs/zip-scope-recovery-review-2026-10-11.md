# ZIP scope recovery — final integration record (2026-10-11, revision 3)

Scope: PR #1840 (`docs/dev-source-receipt.sql`, connectors) and PR #1829 (`docs/dev-change-recovery.sql`). **Nothing here is applied,
deployed or scheduled.** The only production access was read-only (`pg_proc` fingerprints, one `EXPLAIN ANALYZE` of a geometry digest).

## 1. The chain, and who owns each link

```
official source response → successful source completion → ACCEPTED cache generation → materialisation → comparable ledger observation → notification
```

| link | owner | where |
|---|---|---|
| source completion (scope that ran, version, complete) | the connectors | `sources/scope-receipt.ts` → `scope_receipt` in the response payload |
| which response produced which cache generation | **#1840** | an `AFTER UPDATE` trigger on the cache row (§2) |
| durable per ZIP × source continuity | **#1840** | `public.dev_source_continuity` (§3) |
| historical classification, readiness, event eligibility | **#1829** | `dev_change_observe_zip` splice, `dev_change_scope_ready` |
| health reporting | both | `dev_source_continuity_state` (#1840), `dev_change_scope_health` + `dev_monitoring_coverage` (#1829) |

## 2. Exact accepted-response attribution

The previous revision polled `net._http_response` from a second job and *inferred* acceptance from `refreshed_at >= response.created`.
That does not prove the selected response produced the cache, and a lost or doubly-evaluated response left no trace.

The live collector's step (d) is **one row update** that sets `refreshed_at = now()` **and** `last_collected_response_id = resp.rid`, only for a
response it accepts. Step (e) moves the cursor alone for a response it evaluated and refused. The row update therefore *is* the proof:

| row update seen by the trigger | recorded as | continuity |
|---|---|---|
| cursor ↑ **and** clock ↑ in the same update | `accepted` (response id, payload read in the same transaction) | advanced per source |
| cursor ↑, clock unchanged | `refused` | **untouched** — the cache still describes the previous generation |
| clock ↑, cursor not moved | `unattributed` | every source breaks |
| clock ↑, cursor names an unreadable / other-ZIP response | `unreadable` | every source breaks |
| cursor ↓ (the restart heal) | nothing | — |

* **Atomic.** It runs inside the collector's transaction: a rolled-back cache write rolls back its receipt and continuity step (test A14, I11).
* **No second writer, no job, no cursor of its own, no polling.** `dev_refresh_collect` is not modified (live md5 `2012877397532a1e8e160b5a7a4c8032`
  was re-read from production on 2026-10-11 and is unchanged); there is nothing to schedule and nothing that can lag or die separately.
* **Never blocks the collector.** If the trigger itself fails it records the generation as having no evidence (every existing source row breaks) and
  the cache write proceeds (A20, A21). Evidence missing ⇒ the ledger holds.
* **Idempotent.** A step applies only if its tick is newer than the row's last tick (A22); a re-run of an evaluated response changes nothing (A11); an older
  response arriving after a newer one was evaluated is never applied (A12).
* The existing guards are preserved and exercised through the real collector: the source-failure guard (I14b), the reduction guard (I05), shape-withholding.

## 3. Durable continuity (no retention window)

`dev_source_continuity` is one row per ZIP × source, updated in place: `gen_seq` (accepted generations processed), `break_seq` (the generation of the latest read
that was **not** an unbroken, comparable, complete continuation), the current gap's `impaired_since`, `gaps_total`, `gap_seconds_total`, `last_restored_at`.
A ledger baseline taken at generation *s* is continuous iff `s >= break_seq` and the scope version is unchanged. That is a comparison of two integers: it needs no
receipt history, so **a seven-day prune cannot turn a continuously monitored source into a "broken" one** (C02, C03, C04, G03, I20), and **a later successful refresh
cannot erase an unresolved gap** (`break_seq` only moves forward; only a baseline taken at or after it clears the obligation).

`dev_refresh_generation` (7-day, one row per event) is diagnostic only — it answers "which response produced this cache row" and feeds no decision.

Failed HTTP attempts and lost accepted generations are different things: a failed/never-evaluated fetch never reaches the cache (no generation exists, nothing
breaks, the cache simply ages — `collection_delayed`); an accepted generation can no longer be "lost" because the receipt commits with the write. What remains is an
accepted write with no usable evidence, which is a break (`unattributed` / `unreadable`).

## 4. Source and geographic version

`scopeVersion()` is now `v2:<envelope>:r<radius>:g<polygon md5>:c<source configuration signature>`.

* **Polygon identity** `public.zip_geom_sig(zip)` = md5 of the canonical geometry from the same single boundary authority (`geo.zip_membership_boundary`). Read **once per ZIP
  build** (never per record); measured **≈ 3.5 ms on the largest ZCTA polygon** (read-only `EXPLAIN ANALYZE`). A shape edit that keeps the bounding box moves it (`test/zip_geom_sig_pg` Z02/Z03).
  It is a *new* function; the deployed `zip_scope_bounds` signature is untouched. Without it (older database) no version can be built and the ledger holds.
* **Source configuration** `sourceConfigSignature(entry)` = FNV-1a-64 of the canonical JSON of the registry entry **minus** an explicit non-material list
  (labels, coverage gating, audit notes, projection/paging). Everything else is **material by default**: endpoint/dataset, filters, type/status maps, recency, identity mapping,
  spatial options, completeness caps. A key added later moves the signature (a safe re-baseline) instead of being silently ignored. Tokens and timestamps are not in the entry.
* A version change is a **break** in continuity and the ledger additionally refuses a baseline taken under a different version (defence in depth: I15, I15b, I15c).

## 5. Health

`dev_change_scope_health` lists every expected ZIP × source — derived from the continuity and readiness rows, **no parallel registry** — with a `monitoring_state`:
`complete_verified`, `initial_baseline_pending`, `rebaseline_in_progress`, `monitoring_restored` (within 7 days), `suspended` (a baseline existed; cause in `continuity_state`),
`failed_or_incomplete`, `legacy_scope_fallback`, `source_not_reported`, `no_accepted_generation_evidence`, `scope_version_changed`, `collection_delayed` (cache untouched 72 h),
`legacy_scope`, `retired`. It carries the open gap's start, the number and total duration of past gaps, and per-source counts of held observations and quiet re-baselines.
`dev_monitoring_coverage` counts them and adds the ZIPs holding a cache with no accepted-generation evidence at all. "Delayed receipt processing" no longer exists as a
state: there is no receipt processing to delay.

## 6. Policy (unchanged in substance, now enforced from durable evidence)

First verified expanded baseline: historical discoveries are recorded silently. Subsequent comparable complete observation: new records remain eligible for first detection.
Incomplete / unproven: new observations are **held**. A proven break: **quiet re-baseline** (records that arrive across a coverage gap cannot be told from backfill; the cost —
a genuine arrival inside a gap is quiet — is visible in the gap duration and the held/re-baselined counts). Source dates are evidence of publisher activity, never of first
observation. No date decides anything.

## 7. Tests (all disposable Postgres; actual SQL of record)

See the PR descriptions for the run results. Layers: connector tests (`test/source-scope-receipt.test.mjs`), receipt SQL against the **live collector** rebuilt from the committed
chain and fingerprinted to production (`test/dev_collect_harness`, `test/source_receipt_pg`), polygon identity (`test/zip_geom_sig_pg`), the ledger/recovery suite on the real
receipt SQL (`test/dev_change_recovery_pg`) and the full-stack integration (`test/dev_integration_pg`: real collector + #1840 SQL + ledger + #1829 SQL; only the materialiser is a stand-in).

## 8. Records versus distinct projects (unchanged, independent of this work)

The ZIP tile counts permit/application **records**; distinct address is only an upper-bound proxy for projects and is not implemented as a count. Proposed, not implemented, needs
approval: label the tile "Development records" and show a distinct-project figure only where a canonical project identity exists.

## 9. Remaining risks / unsupported assumptions

* Nothing exists in production: the receipt SQL, the trigger, `zip_geom_sig` and the connector change are all undeployed. Until then there are no receipts and every stamped record is held (fail closed). The receipt starts empty, so the first complete expanded read of each source is a baseline, never news.
* The materialiser (`app_refresh_zip`) is not reproduced in the integration test; its observable contract (rows keyed by `app_source_key`, `provenance.refreshed_at` = the cache generation) is mirrored and is what the probe's synchronisation check reads.
* EPA helpers (`dev_epa_write_refused`, `dev_echo_merge_facility_sites`) are stubs in the harness: the receipt never reads them.
* The national collector's recorded timeout incident (`docs/dev-refresh-collector-incident-2026-10-11.md`) is **not** addressed here; the trigger adds the measured work in the PR description to it.
* `ZIP_SCOPE_BOUNDS_MODE` is believed unset; secrets cannot be read.
