# ZIP scope recovery — blocking-review response (2026-10-11)

Scope: PR #1829 (`docs/dev-change-recovery.sql`, NOT applied, NOT merged). Nothing here touched production
except read-only queries.

## 1. Product tradeoff: first sightings of widened-only records (rule_version 2)

**Before:** a widened-only first sighting was suppressed as "historical" when `submitted_at` was more than 45 days old.
That used a filing/issue/scheduled/estimated/decided date as evidence of *when HomeSignal first learned of it*.
It is the wrong evidence: delayed government publication makes a genuinely new record look old, and an undated or
future-dated one escapes the rule.

**Now:** no date decides anything. A first sighting whose identity carries `scope_origin='polygon_member'` is
`coverage_recovered`: recorded in `dev_change_recovery` (outcome, date kind and state `dated|undated|future`,
observation clock, cache generation, rule version), written as a baseline-style first-detected row, and never
announced. Unstamped records (inside the legacy scope) keep today's behaviour exactly. A *later* change to a recovered
record is a genuine change and is announced as usual.

**Cost, stated plainly:** a genuinely new filing that first appears in the widened-only ring *at the same moment the
ring is first read* is not announced as "new". The ledger cannot distinguish "new to the publisher" from "new to us"
because per-source scope mode per generation is not persisted. This is deliberate: a wrong announcement
("new project near you") is worse than a quiet first sighting that appears on the page. To announce those, we would
need per-generation scope-mode evidence per source. That is a separate, approvable change, not made here.

## 2. Synchronisation (`dev_change_recovery_probe`)

One STABLE SQL statement = one snapshot. Synchronised only when the cache clock exists, every development row's
`provenance.refreshed_at` parses and **equals** the cache clock (a completed materialisation rewrites every row),
every requested key is present in that generation, and an empty materialisation is not hiding a non-empty cache.
Otherwise the ZIP is **deferred**: nothing written, the tick does not advance, the reason is returned
(`zips_deferred`). No second state authority: it reads `development_reports.refreshed_at` and the existing provenance.
Tests: one current + stale rows, empty materialisation (3 cases), invalid/missing/impossible timestamps, cache newer or
rewound, null clock, no cache, unmatched key, a concurrent collector write during the probe (C01/C02) with a
volatile-helper positive control (C03).

## 3. Nationwide performance

Evidence and model (not a production measurement of the new function, which is not applied):
- The probe runs only on a ZIP with ≥1 new comparable non-conflict identity (lazy; pinned by P18 and the
  `probe_on_every_observation_not_lazy` / `stamps_scanned_with_no_keys` mutations). Ordinary runs observe ≤ ~1,860
  new-identity ZIPs (≤ ~15% of 12,722).
- Barrier (clock + row equality) reads only that ZIP's rows: typical ~1–3 ms; a dense ZIP ~45 ms warm. The stamped
  scan runs only when synchronised and keys were requested, restricted to those keys: dense ZIP ~0.2–0.4 s.
- Nightly budget: ~84 calls × 60 s ≈ 5,040 s at ~170 ZIPs/call. Upper bound for the added work: 1,860 × ~3 ms +
  ~1% dense (~19 ZIPs) × ~0.5 s ≈ 15 s, i.e. ~0.3% of the budget. Deferral rate ≈ 15% × 3.9% (observed one-generation
  lag) ≈ 0.6% of observations, versus ~4% under an unconditional barrier.
- NOT measured: the exact probe statement on production dense ZIPs (it cannot be installed). A read-only inline run of
  the statement text is the next measurement step if wanted.

## 4. Records vs distinct real-world projects (item 5)

The ZIP tile counts permit/application **records**; one real-world project routinely files many records. Measured
read-only on `app_projects` (development kind), 2026-10-11:

| ZIP | records | distinct addresses |
|---|---:|---:|
| 76258 | 275 | 208 |
| 76247 | 341 | 244 |
| 76227 | 418 | 306 |
| 78617 | 570 | 347 |
| 10025 | 792 | 402 |

Distinct address is an upper-bound proxy for projects (one address may host several projects, one project several
addresses). **Proposed smallest universal correction (NOT implemented, needs approval):** label the tile count
"Development records" wherever it is shown, and show the distinct-address figure only where a canonical project
identity exists. No new identity inference.

## 5. Unsupported assumptions

- Rows retained by roles outside the expected set could keep a ZIP deferred persistently; prevalence not measured nationally (visible via `zips_deferred`).
- Dedupe/stamp equivalence: twins of one identity never differ in `scope_origin`.
- `ZIP_SCOPE_BOUNDS_MODE` is believed unset; secrets cannot be read, so "off" is unverified.
- The ~4% one-generation lag is observed, its cause (sweep latency) not isolated.
