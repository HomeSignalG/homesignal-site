# Maps data coverage pass — all 12,722 ZIP pages (2026-07-25)

Full-universe audit of the production materialization feeding Maps (Street /
Satellite / Focus). Renderer untouched (production-complete per
`docs/maps-marker-symbology-audit-2026-07-24.md`). Every claim below carries a
query receipt; nothing sampled where the universe was checkable in SQL.

## 1. Canonical universe

Exactly **12,722** user-facing ZIP pages, confirmed identical across all three
per-ZIP structures: `app_community_meta` (12,722) = `development_reports`
(12,722) = `app_coverage_states` (12,722).

## 2. Final classification (task taxonomy ← app_coverage_states)

| Class | Rule | Count | % |
|---|---|---|---|
| POPULATED | `populated` + `facilities_only` (≥1 valid real map record) | **11,692** | 91.9% |
| HONESTLY_EMPTY | `honestly_empty` (fresh report, all source checks returned 0) | **1,030** | 8.1% |
| UNDER_RETURN (unexplained) | overlay, below | **0** | 0% |
| FAILED | `failed_ingest` + `temporarily_unavailable` | **0** | 0% |
| STALE | `stale_data` (>72 h without failure evidence) | **0** | 0% |

Record totals: **515,719** development · **218,275** regulated facilities ·
**14,983** changes (all coordless → notices/changes LIST; **zero** meeting map
markers exist, so no meeting marker can violate the development-linkage policy —
verified: `app_changes` rows with coordinates = 0 of 14,983).

## 3. UNDER_RETURN overlay (full universe, no sampling)

| Probe | Found | Verdict |
|---|---|---|
| cache dev>0 but app dev=0 | 216 ZIPs / 7,596 cached dev sites | **All by design**: 0 of 7,596 qualify for materialization (`scope='point'` + `record_url`); every one is an area-scope jurisdiction notice (v18 no-fabricated-marker rule). They render in the notices list, never as markers. |
| cache fac>0 but app fac=0 | **0** | — |
| app fac < 50% of cache fac | 11 ZIPs | **Ordering race, converged**: hourly `app-content-refresh` (`40 * * * *`) ran before the 15-min rolling cache refresh the same day (receipt: 17368 app 21:40 vs cache 23:30). Re-materialized all 11 from the current cache → exact convergence (17368 20/20, 20762 35/35, 85201 39/39 + 170 dev, 85203 34/34 + 280 dev, …). Self-heals on every sweep; 0 remaining. |

## 4. The one FAILED ZIP — 84089 (Clearfield UT): root cause + fix

**Signature:** cache frozen 2026-07-11 (11 sites: 9 civic + 2 dev, fac 0),
attempts daily, `failed_ingest`.

**Root cause (proven live):** the engine returns **200 all-zero** for 84089
today — its meetings concluded (left the upcoming window) and notices expired,
and the sole FRS registration in range ("409 THE BLUFF", a residential
subdivision) honestly fails `looksIndustrial`. `dev_refresh_collect`'s
transient-safe guard held that all-empty response **with no time bound**, so a
legitimate decline-to-zero froze the row forever.

**Fix (backbone, evidence-backed):** migration `dev_refresh_collect_chronic_escape`
(SQL of record: `docs/dev-refresh-collect-chronic-escape.sql`) — the holds
protect only FRESH rows (<7 days); after 7 consecutive held days a clean 200 is
accepted as truth. Flaky-night protection intact; permanent freeze impossible.
Post-fix: 84089 re-collected (sites=0 honest), re-materialized → **4 current
government notices → `populated`**. Universe-wide bad states after: **0**.

## 5. 95124 (San Jose/Cambrian) — the logged FRS question, resolved

Live FRS probes at the exact centroid (pg_net, engine-identical URL):
3 mi → process-limit refusal; 2/1.5 mi → refusal; **1 mi → 200 with 499
facilities**; 0.5 mi → 90; 0.25 mi → 14. Faithful offline replay of the
engine's `looksIndustrial` over all 499 real names: **0 pass** — the payload is
residences (57 literal "RESIDENCE" + hundreds of bare street addresses), dry
cleaners, dentists, gas stations, schools, retail, and private individuals; even
the Xilinx entries are office registrations with no industrial token.
**Verdict: HONESTLY_EMPTY — the cached 0 is the designed, honest result, not an
under-return.**

## 6. Verification added (CI)

`scripts/verify-coverage-state.mjs` §3b — coverage-pass gates, run against the
live view on every `verify-coverage-state` run:
- every ZIP classified (view count == meta count);
- **zero FAILED** (`failed_ingest`/`temporarily_unavailable`; empty allowlist —
  any future exception needs a receipt here);
- **zero unintentionally STALE**;
- **meetings-marker policy**: zero coordinate-bearing `app_changes` rows exist,
  so no meeting can ever render as a map marker.

Marker-identity parity across Street/Satellite/Focus for POPULATED ZIPs is
already pinned by `test/maps-focus-completeness.test.mjs` (unit, per-status +
per-shape histograms) and `verify-maps-rollout`/`verify-maps-uncap` (live);
honest empty states by this verifier's §5 rendering walk.

## 7. Re-materializations performed (real records only, no fabrication)

- 11 ordering-race ZIPs → `app_refresh_zip` from current cache (receipts §3).
- 84089 → engine re-fire + fixed collector + `app_refresh_zip` (receipts §4).
- No synthetic data anywhere; every written record came from the live engine.
