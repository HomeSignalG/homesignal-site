# Local News Routing — Phase B Evidence Report

**Date:** 2026-07-24 · Resolver v1.0.0 · **Phase B is complete and STOPPED here**
per the founder instruction: no page routing, no email routing, `page_target_zip`
and `email_target_zip` remain OFF and will not be enabled without separate
founder approval. All fifteen required evidence items follow, each with its
receipt. Companion documents: `docs/local-news-flags-and-evidence-migration.sql`
(SQL of record), `homesignal-ingest/docs/local-news-hold-report-2026-07-24.md`
(FD-B2 HOLD review snapshot; live surface = `public.v_local_news_hold`).

## 1. Migrations + receipts

| Migration (tracked in supabase_migrations) | Contents | Receipt |
|---|---|---|
| `local_news_geo_evidence_and_flags` | `alerts.geo_evidence jsonb` + `alerts.resolver_version text` (the ONLY approved additions — no routing tables); `app_flags` (3 rows, all OFF, RLS + anon revoke, purpose/owner/updated_at/updated_by); `v_local_news_hold`; `local_news_routing_shadow` (both anon-revoked) | Post-apply probe: universe 105 ZIPs, legacy 105 / proposed 0, hold 0, `flags = email_target_zip=false, page_target_zip=false, resolver_shadow=false` |
| `alerts_geo_scope_vocabulary_v1` | `alerts_geo_scope_chk` extended from `{NULL,address,countywide}` to + `{zip,place,unresolved}` (+ `regional` reserved, unwritten in V1) | Found at go-live: every backfill PATCH 400'd against the old CHECK (first run aborted + cancelled; loop-hardening added). Standing answer recorded: geo_scope is CHECK-constrained — vocabulary changes must extend the constraint |

## 2. Resolver unit-test results

`tests/test_local_news_resolver.py` — **38/38 PASS** (also in CI:
`test-local-news-resolver.yml`). Covers precedence order, FD-B1 negatives
(county mention / provenance never countywide), FD-B3 (out-of-chain routes +
is marked + never expands; ambiguity holds), fail-closed geocoding (incl.
notice_geo's 'countywide' fallback NOT treated as evidence), the full routing-
record contract, determinism (byte-identical re-resolution), stamp-dict
containment (only the approved fields), and `build_ctx` (chain walk, ZIP
universe, place-map normalization, canonical zip_exists, fail-closed None).

## 3. Golden-fixture results

`tests/fixtures/local_news_resolver_golden.json` — **15/15 PASS**: explicit
in-chain ZIP; ZIP beats place; valid out-of-chain ZIP routes marked; non-
canonical 5-digit number → HOLD; digits inside larger numbers never match;
pilot town place → 84337; multi-place union; ambiguous place without/with
context term; county-mention-only → HOLD; two countywide-marker cases;
provenance-only → HOLD; unmodeled place → HOLD with candidate; word-boundary
("Garlanded" ≠ Garland).

## 4. Integration-test results

`tests/test_ingest_resolver_integration.py` — **8/8 PASS**: flag OFF ⇒
`build_payload` output byte-identical to pre-Phase-B (no geo keys); flag ON ⇒
exactly the five approved fields + version added, every pre-existing field
(incl. subtopics) byte-identical; ctx failure ⇒ fail-closed to legacy payload;
flag-lookup error ⇒ flag reads OFF. Live integration = the backfill itself
(item 13): the same resolver + REST path against production, 0 failures.

## 5. HOLD counts by publisher and county

**431 of 597 HOLD (72%).** By county: Summit 137, Utah 69, Box Elder 57,
San Juan 46, Grand 42, Cache 30, Duchesne 27, Uintah 23. By publisher
(hold/total): Moab Times-Independent 88/92 (96%), Vernal Express 50/54 (93%),
Park Record 137/175 (78%), Herald Journal 37/51 (73%), SLTrib 18/29 (62%),
Cache Valley Daily 32/58 (55%), KSL 19/38 (50%), FOX 13 13/29 (45%), ABC4
27/61 (44%), NWS 10/10. Full per-article detail: `v_local_news_hold` + the
HOLD report doc.

## 6–8. Shadow comparison (all 105 news-bearing ZIPs), ZIP counts, density impact

From `local_news_routing_shadow` (14-day window, cap 48 both sides, Phase A
deterministic ordering on the legacy side):

- **Universe 105 ZIPs** (no new ZIPs added by evidence — no out-of-chain hits).
- **Legacy: 105 ZIPs / 3,415 page-rows (avg 32.5/ZIP). Proposed: 45 ZIPs /
  318 page-rows (avg 3.0/ZIP), 202 rows in common.**
- **Common ZIPs 45 · legacy-only 60 · proposed-only 0** — under V1 routing,
  60 of 105 ZIP pages would show no Local News in the current window.
- Density impact by county (legacy → proposed page-rows): Utah 1,344→171
  (−87%), Box Elder 864→29 (−97%), Summit 432→102 (−76%), San Juan 245→0
  (−100%), Duchesne 156→0 (−100%), Cache 152→8 (−95%), Uintah 117→4 (−97%),
  Grand 105→4 (−96%). Pilot 84337 (Tremonton): 48 → 9.
- Method distribution over all 597: place 165 (routed to validated ZIP sets;
  64 single-ZIP), verified countywide 1, explicit-ZIP 0, address 0,
  unresolved 431.

**Reading:** this quantifies FD-B1 exactly as intended — the counties fed by
single-outlet whole-feed publishers lose nearly everything because their only
geographic claim was provenance, and title/summary text rarely names a modeled
place. This is the decision input for Phase C thresholds, and the strongest
argument for the V2 precision items (body-text evidence, cross-chain place
resolution) before any cutover.

## 9. Unsupported countywide-routing count

**0.** Every `geo_scope='countywide'` row (there is exactly one: "Widespread
power outages reported across Box Elder County") carries a non-empty
`countywide_markers` signal. Marker set implemented (documented in the
resolver): `countywide`, `county-wide`, `all county residents`,
`throughout/across <County> County`, `all <County> County residents` —
explicit textual scope claims only; official-action jurisdiction inference is
deferred to a future resolver version, never guessed.

## 10. Out-of-chain routing count + examples

**0 occurrences in the production corpus** — no local_news article in the 597
contained an explicit canonical ZIP or a geocodable street address, so the
out-of-chain path never fired live. The capability is proven by golden
fixtures + unit tests (84041 Davis-County cases: routes to exactly that ZIP
page, `out_of_chain=true`, never expands to the outside county) and will be
measured continuously once new ingest runs stamp evidence.

## 11. Explainability coverage

**597/597 (100%)** stamped rows carry method, status, human-readable reason,
signals, and resolved_at; 0 rows missing any routing-record field. Every HOLD
carries a reason class; candidate places/ZIPs retained where they exist.

## 12. Resolver runtime + DB query performance

- Resolver: **avg 0.9 ms, p95 0.3 ms per article** (backfill run log; pure
  stdlib, no model calls). End-to-end backfill throughput ≈ 7 rows/s,
  dominated by per-row REST PATCH latency, not resolution.
- Shadow view: full 105-ZIP comparison in **103 ms** (EXPLAIN ANALYZE; GIN
  index used for every ZIP→community resolution). HOLD view is a simple
  filtered join. No impact on any hot path — nothing user-facing reads these.

## 13. Backfill runtime + batching evidence

Workflow `backfill-local-news-geo.yml` run 30118297990 (apply, batch=100):
**543 rows in 77.4 s, 0 failures, 0 out-of-chain**, per-batch progress logged
(100/200/300/400/500/543), method tally in-log. The remaining 54 of 597 were
stamped by the first run (30117785922) in its final seconds after the
vocabulary constraint landed; it was then cancelled (its earlier PATCHes had
400'd against the old CHECK — see item 1) and the re-run **skipped all
already-stamped rows (idempotency demonstrated live)**. Batching plan as
approved: pages of 100, one PATCH per row, quarantine-don't-stop, zero-
progress abort guard (added after run 1), version-stamped so re-runs are
no-ops and a version bump re-resolves exactly once.

## 14. Flag-off rollback verification

- All three flags verified OFF in production after all work:
  `email_target_zip=false, page_target_zip=false, resolver_shadow=false`.
- Flag OFF ⇒ ingest payload **byte-identical** to pre-Phase-B (integration
  test, item 4); flag lookup fails safe to OFF on any error/absent row.
- Nothing reads `geo_evidence`/`resolver_version`/the views for delivery, so
  "rollback" of the shadow data is simply ignoring it; columns are nullable
  and additive; views drop with one statement each.

## 15. Subscriber pages and emails unchanged

- `app_changes` Local News surface: **3,509 rows / 105 ZIPs, digest
  `940ae2020959724f62bd5ea6590a4aa0` — byte-identical before and after** the
  entire Phase B (migrations + full backfill).
- `app_refresh_zip` live md5 still `5d840e01cc8f35c2c7071cb893081310` (the
  Phase A body — untouched).
- `digest.py` untouched (no engine delivery change in any Phase B commit);
  `lib/data.js` / `alerts.html` untouched.
- The new surfaces (`app_flags`, both views) are revoked from anon and
  authenticated; `geo_evidence` rides the already-public alerts rows and
  contains only routing metadata (matched place names/ZIPs/reasons — no PII).

## Deliverables shipped (branch `claude/local-news-implementation-audit-uvx551`)

**homesignal-ingest:** `adapters/local_news_resolver.py`; ingest.py flag-gated
stamping; `scripts/backfill_local_news_geo.py` + `backfill-local-news-geo.yml`;
`test-local-news-resolver.yml`; resolver/golden/integration tests;
`docs/local-news-hold-report-2026-07-24.md`.
**homesignal-site:** `docs/local-news-flags-and-evidence-migration.sql` (SQL of
record incl. the vocabulary constraint); `test/local-news-phase-b-flags.test.mjs`
(21 static guards; full site suite 36/36 files green); this report.

## Operational notes for the founder (no action required now)

1. **Live capture is armed but dormant**: new ingest runs will stamp evidence
   only after (a) this branch merges to main (the scheduled ingest runs main's
   code) and (b) `resolver_shadow` is flipped ON — one `update public.app_flags
   set enabled=true, updated_at=now(), updated_by='founder' where
   name='resolver_shadow';`. Until then the backfilled corpus is the shadow
   dataset (it can be re-run any time via the workflow).
2. **V2 resolver candidates surfaced by the data** (logged, not blocking):
   cross-chain place resolution (the Eagle Mountain hold), modeling
   `utah valley` as an alias, body-text evidence for the enrichment-capable
   direct feeds, official-county-action countywide inference.
3. **Phase C threshold decision input**: the 60 legacy-only ZIPs and the
   76–100% per-county density drops in item 6–8 are the numbers the rollback
   thresholds and any cutover decision should be set against.
