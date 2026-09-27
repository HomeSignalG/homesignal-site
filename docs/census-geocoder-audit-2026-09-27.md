# U.S. Census geocoder audit: ingest and placement health

**Date:** 2026-09-27
**Scope:** Read-only. No production data, migration, deploy, or re-geocode was changed or run in the session that first measured these facts, and none was changed in this write-up.
**This file:** the durable receipt for the Census ingest/placement health audit. Live cache counts below were **re-read on 2026-09-27 at 22:32 UTC**. Code claims were re-checked against the trees named in §4–5. Findings that were not re-run in this write-up session (Census HTTP probes, the local mocked `resolveGeocode` test, the 20-row full-address re-probe, and the ZCTA fence-exposure scan) are labeled **inherited** and keep the original session's UTC window (00:43–00:5x).

**Concurrency (required before this file):** `origin/main` fetched 2026-09-27 22:32 UTC. No open or recently merged PR writes a Census *health* receipt. Related but different work: PR [#1418](https://github.com/HomeSignalG/homesignal-site/pull/1418) records geocoder / OpenAddresses / ZCTA *rights*; `docs/dc-geocode-no-match-receipt-2026-09-27.md` (PR #1385) is the Data Center C4 no-match probe only. **Verdict: GENUINE GAP.**

## 1–3. Verdicts

| | Verdict | Why |
|---|---|---|
| A | **CENSUS SOURCE RELIABILITY UNVERIFIED** | The original session's 28 of 28 `pg_net` probes returned HTTP 200. No availability history is recorded anywhere in HomeSignal. This write-up did not send more Census requests. |
| B | **GEOCODE PLACEMENT QUALITY DEGRADED** | 40.0% of cached addresses are stored as failures (41,111 / 102,758 at 22:32 UTC). Development accepts Census's first candidate even when there are several. Inherited: 318 ZIPs are large enough that the 25-mile rule can reject a correct point. Texas TABS points skip the shared fence. Accepted points that were compared to their ZIP polygon were sound (inherited: 99.25% inside). |
| C | **GEOCODE CACHE DEGRADED** | A failure is cached for good. An equal-quality point can never replace a stale one. Nothing re-evaluates old results. Re-measured: 0 of 41,111 failed rows have `updated_at > geocoded_at`. |

## 4–9. Code, endpoints, ladder

- **4. homesignal-site** `720d3c137113628494bac93e5fd7d8fbd1024ee5` — `origin/main` at write-up, "Merge pull request #1417". Working tree clean before this file. The brief's SHA `504934490b81d55404ae2cc53cbba1592a397f09` is still in history; geocode files were not the subject of the commits between those tips.
- **5. homesignal-ingest** `f262bde7c900f58724339e7d6be5f9261e265a58` — `origin/main` at write-up, "Merge pull request #624". The brief's SHA `307a7b12d299fab907f9284322c30fb00d9d2284` is superseded.
- **6. Git vs live (inherited, 00:43 window; not re-diffed here):**
  - `geocode_quality_rank` and `upsert_geocode_if_better` in production do the same thing as `docs/txgio-geocode-tables.sql`. The md5s differ only because the Git copy has comments. **No functional conflict.**
  - `get-address-report` v254 was deployed 2026-09-25 from the site repo. The only later commit touching that function's files (#1329) did not touch the geocode files.
  - ⚠️ `geocode-address` v3 was deployed through the MCP tool on 2026-07-17, not from a repo. Its deployed source was not compared with Git.
  - ⚠️ A stray `get-address-report-v19check` function is live, with source not in either repo.
  - ⚠️ homesignal-ingest still carries an undeployed copy of `get-address-report` that has its own Census call (`homesignal-ingest/supabase/functions/get-address-report/index.ts:126`). Present on the ingest SHA above.
- **7. Endpoint:** `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress`, with `benchmark=Public_AR_Current&format=json`.
  - There are **six separate Census call sites**, re-confirmed by grep on both current trees:
    1. the ingest ladder, `censusRung` in `supabase/functions/get-address-report/geocode-cache.ts`;
    2. address mode in `get-address-report` (same function, uses the ladder);
    3. `geocode-address`, the resident's add-your-home box (`supabase/functions/geocode-address/index.ts:24`);
    4. ingest `adapters/notice_geo.py`, used by `ingest.py` for notices and Local News;
    5. ingest `scripts/build_address_map.py`;
    6. ingest `scripts/phase0_land_use_yield.py`.
  - `verify-geocodes` uses a different endpoint, the reverse `geographies/coordinates` lookup.
- **8. Production ladder:** `productionLadder()` in `geocode-cache.ts:215` is OpenAddresses (`national_address_points`) then Census. It is the only ladder, used by both Development and Data Center.
- **9. Timeout:** 15 s (`AbortSignal.timeout(15000)`) in the ladder.
  - `geocode-address` sets no timeout at all (`fetch(u)` at `geocode-address/index.ts:26`).
  - `notice_geo.py` uses 12 s (`geocode_notice(..., timeout: int = 12)`).

## 10–18. The cache (`public.geocodes`)

Two measurements. The original session's 00:43 UTC figures are kept. This write-up re-read the same columns at **2026-09-27 22:32:10 UTC**.

| Item | 00:43 UTC (inherited) | 22:32 UTC (this file) |
|---|---:|---:|
| 10. Total rows | 102,732 | **102,758** |
| 11. `census_onelineaddress` / `none` / `openaddresses` | 61,620 / 41,111 / 1 | **61,646 / 41,111 / 1** |
| 12. `range_interpolated` / `failed` / `parcel_centroid` / `rooftop` | 61,620 / 41,111 / 1 / 0 | **61,646 / 41,111 / 1 / 0** |
| 13. `needs_review = true` | 102,732 of 102,732 | **102,758 of 102,758** |
| 14. Cached failures, all null coordinates | 41,111 (40.0%) | **41,111 (40.0%)** |
| 18. Failed rows with `updated_at > geocoded_at` | 0 | **0** |

Failure age at 22:32 UTC (clock-relative, so the buckets moved):

| Age | 00:43 UTC | 22:32 UTC |
|---|---:|---:|
| under 1 day | 150 | **0** |
| 1–7 days | 202 | **351** |
| 7–30 days | 146 | **146** |
| over 30 days | 40,613 | **40,614** |

The 26 new rows since 00:43 are Census successes. The failed population did not shrink. That is the sticky-failure design showing up in the numbers: new full addresses can succeed; old failures stay.

- **OpenAddresses is not national.** Re-measured: `national_address_points` holds **8,545** rows, all `state='TX'` (travis.csv 6,869 · bastrop.csv 1,554 · capcog.csv 122), loaded once between 2026-07-10 23:12:43 and 23:13:51 UTC.
- The cache began filling at 2026-07-10 18:26:43 UTC, five hours before that load. `upsert_geocode_if_better` never replaces a stored result with one of equal or lower quality, so only 1 cache row has ever come from OpenAddresses. For everyone else, Census is the geocoder.
- `provider_vintage` is blank on 102,757 rows; 1 row reads `regeocode 2026-07-10`.
- `geofence_status` is populated on 1 row (`inside_zip`). It is a reserved column nothing in Git writes.
- Cache span at 22:32 UTC: 2026-07-10 18:26:43 to 2026-09-27 15:54:10 UTC.
- `geocode_usage` is empty (0 rows).
- `dev_refresh_source_failures` has 158,536 rows and **0** whose kind or reason mentions geocode or geofence.

**Census denominator.**
- 102,758 addresses were sent to the ladder. 102,757 of them reached Census (the one OpenAddresses hit never needed to).
- 61,646 resolved; 41,111 failed.
- Inherited (00:43): in Development's cache, 22,287 distinct geocoded points (32,312 placements) are published, against about 2.89 million placements that carry the source's own coordinates. Geocoded points are about 1.1% of the Development point plane. About 10,476 placements are demoted to area level (Overland Park alone is 7,080). Those cannot be split into geocode failure, fence rejection, or missing address, because nothing records which it was.

## 19–21. Core findings

**19. STICKY TRANSIENT FAILURE: confirmed in code. Production still shows zero retries.**

`resolveGeocode` returns a cached row on any hit, including `match_type='failed'`, unless `forceRefresh` is set (`geocode-cache.ts:107–110`). A miss that throws or returns null becomes a persisted `failed` row (`geocode-cache.ts:112–148`). The comment at line 146 says this is intentional: *"Persist even a failure … so we don't re-hit a dead address every refresh."*

- Re-measured: **0 of 41,111** failed rows have ever been updated after insert.
- Grep of site functions and scripts: `forceRefresh` is used only by the `{regeocode:[…]}` request mode and by the Data Center batch (new addresses). No workflow or script schedules `{regeocode:[…]}`.
- Inherited (local mocked run, 00:5x): a timeout was cached as `failed`; the next normal call returned that cached failure with zero new Census calls; only `forceRefresh` recovered it.
- Inherited (20-row re-probe of cached full-address failures): 0 of 20 recovered; all 20 were genuine no-matches. Every hour in which 95% or more lookups failed (8 hours, 1,407 rows) was 100% bare-street input. So there is no evidence yet that an outage is sitting in the cache. The design defect is real; its current cost is not shown.
- Data Center has the same queue shape. `dc_geocode_queue` excludes any address that already has a derivation, so its 314 `failed` derivations never requeue until `ladder_version` changes. Re-measured: `dc_address_geocode` is still 1,336 rows (1,022 Census `range_interpolated`, 314 failed).

**20. SOURCE-HEALTH AMBIGUITY and AMBIGUOUS-FIRST-MATCH RISK: both confirmed in code.**

`censusRung` never checks `r.ok` (`geocode-cache.ts:165–171`). A timeout, an HTTP 503, and a genuine no-match can all become the identical `failed` row with reason "no geocoder rung resolved this address".

The resident-facing `geocode-address` *does* separate an outage from a no-match: `if (!r.ok) return … 502` (`geocode-address/index.ts:27`). Only the ingest path cannot tell them apart.

Development accepts the first of several candidates (`const m = matches[0]` at `geocode-cache.ts:172`). The candidate count is recorded on `diag` and then dropped by `supabaseStore` (`geocode-cache.ts:62–63`).

Inherited probes (00:48): `3250 S Locust Grove Rd, Kuna, ID` returned 2 candidates in two ZIPs (83634 and 83642). `3400 W 500 N, IN` returned 22.

Data Center rejects the same inputs. `dc_derived_point_verdict` returns `REJECTED_AMBIGUOUS` when the candidate count is not 1. Re-measured candidate counts on `dc_address_geocode`: 1 → 1,015 · 2 → 5 · 3 → 1 · 22 → 1 · null (the failures) → 314.

The two planes apply **different quality rules to the same Census output.**

**21. Provider diagnostics are not persisted for Development.**

`supabaseStore` drops `diag`. They survive only in `dc_address_geocode` (1,336 rows). For Development, nothing durable records the candidate count, why a lookup failed, when it was last tried, or which record and connector sent the address. Connector `geocode_failures` counters and quarantine lists exist only in the HTTP response. → **NOT INSTRUMENTED.**

## 22–24. Fence and boundaries

- **22–23. ZIP-mismatch and over-25-mile rejection counts: NOT INSTRUMENTED nationally.** The rejections are never stored. Inherited: in the 42 live responses readable at 00:44 UTC (38 ZIPs), the count was 0; that is a small window, not a national figure.
- **24. Compared against `geo.zcta_boundary` (inherited, 00:5x; not re-run here):**
  - **FALSE-REJECTION RISK: confirmed as exposure.** In 318 of 12,016 ZIPs measured, the polygon reaches more than 25 miles from the report centroid (57 reach beyond 50 miles; the maximum is 99503 at 281.9 miles). Separately, 737 report centroids lie outside their own ZIP's polygon.
  - **FALSE-ACCEPTANCE: small.** Of 22,287 distinct accepted points, 22,119 are inside their own ZIP (99.25%). 168 are outside it, only 1 of them by more than a mile. 7,086 points carry no record ZIP and were compared with the report ZIP instead.
  - Map 1 membership is decided by the boundary test in N5. This audit did not re-trace it path by path.
  - Ingest `notice_geo.py` takes Census's matched ZIP as the notice's ZIP, with no boundary check.

## 25–27. Development, Data Center, source geometry

**25. Development.**

Re-measured against `jurisdiction-registry.json` on the site SHA above: **240** entries; **211** have a mapped `address` column; **8** have `geocode_assemble: true`; **203** send the bare column value.

The eight flagged entries, pinned by `.github/workflows/verify-edge-function.yml` (exactly this set, Boulder unflagged):

`bellevue-permits`, `cincinnati-building-permits`, `clark-county-active-dev-permits`, `columbus-building-permits`, `fort-worth-development-permits`, `pierce-county-pals-permits`, `prince-georges-county-permits`, `virginia-beach-building-permits`.

`cityFromJurisdiction` still returns null for a county jurisdiction (`geo-input.ts:60–68`). The unit test `pierce.no_city` requires `"1128 104TH ST E, WA 98444"` — city-less on purpose, because a guessed city once fenced out a correct Pierce match.

Failure rate by input shape, re-measured 22:32 UTC with this classifier (a trailing `, ST 12345` is "full"; a trailing 5-digit ZIP without that comma-state pair is "ends ZIP, no state"; a trailing `, ST` is "ends state, no ZIP"; a line that does not start with a digit is "no house number"; otherwise "bare street"):

| Input shape | Rows | Failed | Fail % |
|---|---:|---:|---:|
| Full, ending in `, ST ZIP` | 50,048 | 9,615 | 19.2 |
| Ends in ZIP, no `, ST` pair | 10,510 | 353 | 3.4 |
| Ends in state, no ZIP | 277 | 72 | 26.0 |
| **Bare street** | 41,780 | **30,930** | **74.0** |
| No house number | 143 | 141 | 98.6 |

The original 00:47 classifier split the first two rows differently (56,813 full / 3,722 ZIP-only). Bare-street is the load-bearing finding and agrees: ~74% fail, ~31,000 rows.

Inherited: by state, WA fails 6,876 of 8,771 (78%), dominated by Pierce County inputs of the form "…, WA 98442". That was not re-aggregated here (Postgres POSIX `\b` is not a word boundary; do not invent a WA count from a broken regex).

Inherited: the cache key is the input text alone, so a bare street line is one key nationwide. 10,821 bare-street keys resolved to a single national first match and are reused for any jurisdiction that sends the same text.

Inherited placements by connector (all range-interpolated, all `needs_review`, all on the map): Virginia Beach 16,762 · Worcester 8,005 · Hartford 3,796 · Boulder 1,215 · Naperville 1,051 · Anaheim 880.

TABS (Texas) does not use the shared fence. Its only check is that the address text contains the ZIP. Inherited: 5 points, all from OpenAddresses.

**26. Data Center.** Re-measured 22:32 UTC: 1,336 derivations; 1,022 Census `range_interpolated`; 314 failed. Candidate counts as in §20. Queue is empty. None of it came from OpenAddresses. See also `docs/dc-geocode-no-match-receipt-2026-09-27.md`: rewriting the 314 failed lines recovers nothing; those streets are absent from Census ranges.

**27. Source geometry wins.** All five open-data connectors use the source's coordinates first and geocode only when they are missing (`arcgis.ts:451–453`, `socrata.ts:531–533`). No case of a geocode overwriting a source point was found.

## 28–31. Retry, freshness, monitoring

- **28. NO AUTOMATIC CENSUS REEVALUATION.** `provider_vintage` is informational only; nothing reads it. `forceRefresh` is used only by the unused `regeocode` request mode and by the Data Center batch (new addresses only). When Census improves its data, nothing tries old addresses again.
- **29. Never-downgrade guard.** The SQL and TypeScript rankings agree (3/2/1/0/0/−1). Because the guard needs a *strictly* better tier, an equal-tier result is thrown away. Inherited local test: a new range-interpolated point was discarded. With OpenAddresses absent outside three Texas counties, every one of the 61,646 Census points is frozen as first written.
- **30. `verify-geocodes`: MONITORING NOT VERIFIED.** Re-checked on GitHub: the last success is run **#42**, 2026-07-23 15:35:13Z (`https://github.com/HomeSignalG/homesignal-site/actions/runs/30021228689`). The last five stored runs are all `failure`; the newest is 2026-08-06 15:55:39Z. The schedule and push trigger have been commented out in `.github/workflows/verify-geocodes.yml` since 2026-08-06 (quota; the job had not finished green). The workflow is dispatch-only. Its own rule counts a failed reverse lookup as "skipped (not a failure)".
- **31. Instrumentation gaps:** no Census request, error, or latency log; failures not tied to a record or connector; no last-attempt time; candidate count dropped for Development; fence rejections never stored; `geofence_status` and `geocode_usage` unused.

## 32–33. Most affected (inherited except the registry flag count)

- **ZIPs:** Overland Park KS (34 ZIPs, 7,080 records demoted to area); Pierce County WA 98442 / 98445 / 98444 / 98438; Virginia Beach 23451–23456 (1,217 demoted plus 16,762 range-interpolated points); Worcester 01602–01607.
- **Sources:** bare-street entries (Worcester, Hartford, Naperville, Boulder, Anaheim, Philadelphia, Austin); Pierce County PALS (city-less input by design); Overland Park.

## 34. Competitor-CTO attacks that succeeded

| Claim | Result |
|---|---|
| 1. A timeout is distinguishable from a no-match | False (ingest `censusRung` does not read `r.ok`; `geocode-address` does) |
| 2, 3. Transient failures retry and cannot become permanent | False (0 of 41,111 retried at 22:32 UTC) |
| 4. The first candidate is unambiguous | False (inherited probes: 2 and 22 candidates; DC still holds a 22-candidate row) |
| 5. Census coordinates are "exact" | False: all interpolated, 0 rooftop |
| 6. The fence cannot reject a valid rural address | False (inherited: 318 ZIPs) |
| 10. Every connector uses the shared fence | False (TABS) |
| 11. Connectors send enough address context | False (203 of 211 address-column entries bare; 74% bare-street failure) |
| 12. The cache records enough diagnostics | False |
| 13. Equal-tier stale points can refresh | False (inherited test) |
| 14. `provider_vintage` triggers reevaluation | False (1 non-null row, nothing reads the column) |
| 15. `verify-geocodes` monitors nationally | False (last success #42, 2026-07-23; off since 2026-08-06) |
| 16. Development and Data Center use the same quality rules | False |
| 17. There is one Census implementation | False (six) |
| 19. Census health is observable over time | False |
| 20. No population is silently left out of the health numbers | False: fence rejections are gone |

- **Attack 7 (wrong point under 25 miles):** partly succeeded. Inherited: 168 accepted points are outside their own ZIP, all but one within a mile of it.
- **Attack 18 ("geocoded" means "published"):** not a defect. Geocode success and publication are separate here, with the fence and N5 in between.

## 35. Single highest-priority fix

**Send Census a complete address.** Bare-street and missing-locality inputs cause about 31,000 of the 41,111 failures (~75%), and they also create the nationwide key collision. A changed input produces a new cache key, so fixing the input does get re-tried, which is why input comes first.

The helper already exists (`buildGeocodeInput` in `geo-input.ts`) and is **opt-in** per registry entry. Turning it on is gated: it changes what residents see (new cache keys, more points, fewer area demotions), and `cityFromJurisdiction` must keep omitting a city for county sources. The eight current flags are locked by `verify-edge-function.yml`. Widening the set is a founder decision, not this receipt.

The cached-failure and no-retry design is the next target, because until it changes those failures never heal. Distinguishing `r.ok` from a no-match in `censusRung` is the smallest code change that stops an outage from being stored as a permanent miss.

### Evidence summary

| OBJECT | RESULT | UTC | INTERPRETATION |
|---|---|---|---|
| `public.geocodes` | 41,111 failed / 61,646 Census / 1 OpenAddresses / 0 rooftop | 2026-09-27 22:32 | Census is effectively the sole geocoder; 40.0% failure; +26 Census hits since 00:43, 0 failures recovered |
| `national_address_points` | 8,545 rows, all TX | 22:32 | "National" rung covers three counties |
| Failed rows updated after insert | 0 | 22:32 | No retry path runs |
| Failure by input shape | bare street 74.0% (30,930 / 41,780); full `, ST ZIP` 19.2% | 22:32 | HomeSignal input defect, not Census |
| `geocode_assemble` | 8 of 211 address-column entries | 22:32, Git | Helper exists; 203 entries still send the bare column |
| Probe (`pg_net`, 8 then 20 more) | inherited: 28 of 28 HTTP 200; counts include 22 and 2 | 00:48–00:5x | Ambiguity is real; this write-up sent 0 Census requests |
| Re-probe of 20 cached full-address failures | inherited: 0 of 20 recovered | 00:5x | No sign of cached outages that day |
| Local mocked test | inherited: outage cached; 503 = no-match; equal tier discarded | 00:5x | Sticky failure and frozen equal tier confirmed in code + test |
| `geo.zcta_boundary` vs centroid | inherited: 318 of 12,016 ZIPs reach past 25 mi | 00:5x | Fence can reject valid points |
| Accepted points vs own ZIP boundary | inherited: 22,119 of 22,287 inside | 00:5x | Accepted placements are sound |
| `verify-geocodes` runs | last success #42, 2026-07-23; last stored run 2026-08-06 failure | 22:32, GitHub | No active monitor |
| `dc_address_geocode` | 1,336 / 314 failed / candidates 1,015·5·1·1 | 22:32 | Same Census output, stricter DC rules |
| `geocode_usage` / geo rows in `dev_refresh_source_failures` | 0 / 0 of 158,536 | 22:32 | Development failures are not instrumented |

**What was touched**

- Original measuring session: 28 read-only GET requests to Census through `pg_net` (sandbox proxy 403s Census; the database's own HTTP path does not). Those rows land in `net._http_response` and are purged automatically. One scratch test file, reset afterwards.
- This write-up: read-only SQL listed above; GitHub Actions metadata for `verify-geocodes`; grep of both repos. **No Census request. No production write. No code, migration, deploy, or re-geocode.**

## 36. Health plan (this session)

Implement in this order. Cross a step off only when the code, the offline tests, and the commit for that step are done. Then start the next step. Do **not** national-load OpenAddresses. Do **not** re-enable `verify-geocodes` until it can finish green. Do **not** force-refresh the 41,111 cached failures in one batch.

Concurrency at kickoff (2026-09-27): `origin/main` fetched; no other open PR implements Census *health*. This branch is PR #1420. **GENUINE GAP.**

| # | Step | Why | Done |
|---|---|---|---|
| 1 | Distinguish Census transport errors from no-match; do not cache transients | `censusRung` ignores `r.ok`. A timeout, HTTP 503, and a genuine miss all become the same sticky `failed` row. | [x] |
| 2 | Retry cached `failed` rows after a 7-day TTL | 0 of 41,111 failed rows have ever been updated. A success outranks `failed` (−1) and will upgrade; a re-fail must bump `updated_at` so the TTL does not re-hit Census on every refresh. | [x] |
| 3 | Assemble complete addresses for bare-street connectors | ~31,000 of 41,111 failures are bare-street input (74% fail). New assembled keys heal on first use. City-safe; county stays city-less (Pierce); Boulder stays unflagged (address already concatenates city+state). Wire the same opt-in into ckan/carto/csv. | [ ] |
| 4 | Prefer the filed-ZIP Census candidate when several matches exist | Development takes `matches[0]`. Data Center rejects the same input as `REJECTED_AMBIGUOUS`. Prefer the candidate whose matched ZIP equals the trailing ZIP on the input. | [ ] |
| 5 | Persist fence outcome and failure class | `geofence_status` is unused; `diag` is dropped; fence rejections vanish. Write failure class on `review_reason`. Write `geofence_status` (`inside_zip` / `zip_mismatch` / `too_far`) on the cache row. | [ ] |
| 6 | Apply the shared fence to TABS | TABS is the one geocoding source that skips `fenceGeocode`. Point-scope TABS still quarantines (never synthesizes) when the fence rejects. | [ ] |
