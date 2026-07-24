# Local News Evidence-Based Geographic Routing — Implementation Plan

**Date:** 2026-07-24 · **Status: PLAN ONLY — no code changed, no migration applied, nothing deployed.**
Branch: `claude/local-news-implementation-audit-uvx551` (both repos).

---

## 0. Governing constraint — what this plan is allowed to rely on (READ FIRST)

The mission brief named four source-of-truth documents. **Two of them do not exist**
(founder-confirmed 2026-07-24): the *Local News Architecture & Implementation
Specification* and *ADR-001* itself were never written, and the *Phase A Evidence
Report* exists only as its Addendum. The available authority is therefore:

1. **The mission statement** — "replace county-wide Local News replication with
   evidence-based geographic routing while preserving all existing subscriber
   functionality until cutover," with the engineering requirements: deterministic
   materialization, replayability, explainability, idempotency, shadow-mode
   validation, rollback capability, page/email routing parity, auditability
   ("every routing decision must be explainable from stored evidence").
2. **ADR-001 Phase A Evidence Packet** (process contract: VERIFIED/UNVERIFIED/
   INFERRED tagging, G4 materialization-safety and G5 schema-carrier scopes).
3. **Phase A Addendum (Final)** — 5 VERIFIED findings (all re-confirmed live, §2).
4. **Fresh evidence gathered 2026-07-24** for this plan: both repos read in full
   (read-only), live Supabase schema/functions/data inspected (read-only).

Everything below is tagged either **[EVIDENCE]** (with its receipt) or
**[PROPOSAL]** (a design choice the missing spec would have made — requires
founder approval before implementation). **No [PROPOSAL] item is settled.**
Per the mission rules, no code will be written until this plan is approved.

---

## 1. Executive Summary

**Current behavior [EVIDENCE — live `app_refresh_zip` body captured 2026-07-24]:**
Local News is ingested per county (`alerts` rows tagged to the county-root
`community_id`, `pipeline_type='news'`, `category='local_news'`). The page
materializer `app_refresh_zip` copies the county root's newest 48 news alerts
(14-day window, `source_ref`-deduped, `source_url` required) into `app_changes`
for **every ZIP under that root** — county-wide replication. Live scale: 12,722
ZIP pages; 3,528 materialized Local News rows across 105 ZIPs, fed by 592
`local_news` alerts from 8 Utah counties (Summit 170, Utah 145, Box Elder 79,
Cache 52, Grand 46, San Juan 46, Duchesne 27, Uintah 27).

**The geographic evidence that routing needs already exists at ingest time but is
discarded [EVIDENCE]:** the ingest geo gate (`@adapter:box_elder_local_geo` etc.)
matches place anchors (towns) in the article title/summary blob, but stores only
the boolean outcome (keep/drop). No matched-place evidence, no ZIP, no scope
verdict is persisted: 0 of 592 local_news alerts have `zip`/`geo_lat`/`geo_lng`;
`geo_scope` is NULL (576) or `'countywide'` (16).

**The carrier fields already exist [EVIDENCE]:** `alerts.zip`, `alerts.geo_scope`,
`alerts.geo_lat`, `alerts.geo_lng`, index `alerts_community_zip (community_id,
zip)`, and `app_changes.zip/lat/lng/confidence`. The one concept with **no**
existing carrier is structured routing evidence (which anchors matched, from
which text) — see Database Plan §4.

**Plan shape:** six phases — (A) determinism + performance prerequisites the
Addendum recorded, (B) evidence capture at ingest (additive, invisible),
(C) shadow-mode routing comparison (no user-visible change), (D) page cutover
behind a flag, per-county pilot first, (E) email routing parity (its own
founder-gated cutover), (F) cleanup. Every phase has an acceptance gate and a
rollback. User-visible behavior changes **only** at Phase D flag-flip and only
after founder review of shadow metrics.

---

## 2. Repository & System Audit (what exists, what must change)

### 2.1 Addendum findings — all five re-verified live, 2026-07-24

| Addendum finding | Re-verification receipt |
|---|---|
| 1. Non-deterministic top-N (dev 48/77, planning 6/10) | Live body: development `order by …file_date… desc nulls last limit 48` (NULL-heavy key); planning insert `limit 6` with **no ORDER BY at all**; civic `limit 6` no ORDER BY; facilities `order by label limit 16` (ties possible) |
| 2. Replay drift, two causes | Confirmed by 1 + 4 |
| 3. GIN exists, bypassed | `idx_communities_zip_codes_gin` exists; live body resolves via `where _zip = any(zip_codes)` |
| 4. Async cadence | pg_cron: `app_refresh_batch(1500)` hourly at :40 (full 12,722-ZIP sweep ≈ 9 h, oldest-first); ingest every 2 h; digest 5 PM CT |
| 5. No triggers on app_changes/app_projects/app_community_meta | Not re-checked this session (read of pg_trigger not repeated) — carried as VERIFIED per Addendum |

### 2.2 Production↔repo drift found during this audit (must be resolved in Phase A)

1. **`app_refresh_zip` SQL-of-record is stale.** `homesignal-site/docs/
   app-refresh-zip-local-news-migration.sql:47-49` resolves `_root` as a
   **one-hop** `parent_id`; the **live** function uses a full `with recursive`
   ancestor walk. The live body is newer than the doc of record. (Two later
   migration docs, `maps-full-rollout-migration.sql` / `maps-dedup-migration.sql`,
   record diffs only.) Any function edit must start from a fresh snapshot of the
   live body, and the snapshot must be committed as the new SQL of record.
2. **`feeds.csv` is stale vs `public.feeds` (the DB-first live config).** Live:
   all 6 `be-localnews-direct-*` `news_html` rows are **ACTIVE** and their 6
   legacy RSS pairs are **inactive** — the Box Elder direct-news cutover **has
   executed in production**. `feeds.csv` says all 6 direct rows are
   `active=FALSE`, and `docs/box-elder-direct-news-cutover-plan.md` says cutover
   is blocked (CVD proven not at parity). CVD is still producing via the direct
   path (8 items in last 14 days, newest 2026-07-23), but whether the tail
   articles the parity doc flagged are being lost is **UNVERIFIED** from here —
   the `parity-direct-news.yml` workflow can answer. **Founder question Q1.**
3. **Stale verifier:** `homesignal-site/scripts/verify-alerts-categories.mjs`
   keys on `pipeline_type='news_alert'`, a value the live pipeline never writes
   (live: `'news'`). It would report "0 news" regardless of reality.

### 2.3 Current end-to-end flow [EVIDENCE — file:line receipts]

```
public.feeds row (category=local_news; live: 20 active rows, 7 communities)
  → ingest.py fetch_items → parse_feed (RSS) | adapters/news_html.py (direct, Box Elder)
  → apply_filter (ingest.py:1173-1181) — boolean geo gate:
      @adapter:box_elder_local_geo / utah_county_local_geo match place anchors
      in the title+summary blob
      (adapters/box_elder_local_geo.yaml; news_html adds fail-closed body
       enrichment on gate miss: news_html.py:677-783)
  → normalized-title cross-source dedup (ingest.py:1211-1233)
  → build_payload (ingest.py:1599-1650) — stamps community_id, title, source_url,
      published_at, pipeline_type, category, impact_level, agency_name,
      geographic_reference, subtopics.  NO zip / geo_scope / geo_lat / geo_lng.
  → upsert alerts ON CONFLICT (community_id, source_url)
  → classify_news_subtopics.py (--apply --all, every 2h run)
PAGE: pg_cron app_refresh_batch(1500) hourly → app_refresh_zip(_zip):
  delete app_changes/app_projects for zip → rebuild → Local News branch copies
  root-community alerts (14d, newest 48) into app_changes(category='Local News')
  AFTER the meta upsert (never feeds data_quality/indexable)
  → lib/data.js news() reads app_changes .eq(zip).eq('Local News') → alerts.html tab
EMAIL: digest.py Local News tier — community_id-scoped (digest.py:513-514),
  subtopic-intersection vs subscriber follows; user zip used for display only.
```

### 2.4 Repositories that must change

| Repo / system | Changes |
|---|---|
| `homesignal-ingest` | Evidence capture at gate + payload (Phase B); shadow report script + workflow (C); digest ZIP-parity branch behind flag (E); tests; `feeds.csv` re-sync note |
| `homesignal-site` | `app_refresh_zip` migrations (A: determinism/GIN; D: routed branch behind flag) committed to `docs/*.sql`; test updates; shadow verifier script; fix/retire stale `news_alert` verifier |
| Supabase (project `qwnnmljucajnexpxdgxr`) | Migrations of §5; no RLS change; no new Edge Function |
| NOT changed | `lib/data.js` read path, `alerts.html`, subscriptions/signup, Edge Functions, sitemap, RLS, cron schedules |

---

## 3. File-by-file Implementation Plan

**homesignal-ingest**
| File | Phase | Change |
|---|---|---|
| `homesignal_pipeline` / `ingest.py` (`apply_filter`, `adapter_item`, `build_payload`, upsert) | B | Gate returns evidence (matched anchor list + matched-text source: title/summary/body-enriched) instead of bare boolean, for `category='local_news'` only; `build_payload` stamps `geo_scope`, `zip` (when unambiguous), `geo_evidence` (if Q2 approved). Additive: non-news paths byte-identical |
| `adapters/box_elder_local_geo.yaml`, `utah_county_local_geo.yaml`, other local gate YAMLs | B | No rule change. Anchors gain an optional `place:` normalization label only if needed for place→community matching (Q4) |
| `adapters/news_html.py` | B | `_enrich_on_geo_miss` already re-runs the gate on enriched blob; record that the evidence came from body enrichment (provenance field) |
| `scripts/shadow_local_news_routing.py` (NEW) | C | Read-only: computes routed vs replicated set per ZIP from stored evidence; emits comparison JSON + the G4.4 metrics |
| `.github/workflows/shadow-local-news.yml` (NEW) | C | Manual + daily during shadow window; uploads artifact; no writes |
| `digest.py` (`_fetch_news_tier`) | E | Behind flag only: additionally filter Local News tier by subscriber ZIP's routed set, mirroring the page rule exactly (parity by construction) |
| `tests/` (new: `test_local_news_evidence.py`, `test_routing_shadow.py`; extend digest render test) | B–E | See §6 |
| `feeds.csv` | A | Re-sync to `public.feeds` truth (direct rows active) — documentation fix, founder-visible |

**homesignal-site**
| File | Phase | Change |
|---|---|---|
| `docs/app-refresh-zip-snapshot-2026-07.sql` (NEW) | A | Verbatim snapshot of the LIVE `app_refresh_zip` body (rollback baseline; fixes SQL-of-record drift) |
| `docs/app-refresh-zip-determinism-migration.sql` (NEW) | A | Total-order tie-breakers on every capped insert; `= any` → `@>` |
| `docs/local-news-routing-migration.sql` (NEW) | D | Flag-guarded routed Local News branch (see §5 M6); flag OFF ⇒ byte-identical legacy branch |
| `test/local-news-materialization.test.mjs` | A, D | Extend static guards: assert tie-breakers present; assert flag-off path preserves legacy SQL shape |
| `scripts/verify-local-news-routing.mjs` (NEW) | C–D | Live check: for sample ZIPs, every routed row's evidence names a place covering that ZIP (explainability audit) |
| `scripts/verify-alerts-categories.mjs` | A | Fix `news_alert` → live vocabulary (or retire the check) — currently a false-negative alarm |

---

## 4. Database Plan — G5-style carrier mapping

Rule applied (per Evidence Packet G5): reuse unless proven impossible.

| Needed concept | Existing field | Verdict | Evidence |
|---|---|---|---|
| Story→community anchor | `alerts.community_id` | **REUSE** | Populated on all 592 rows; unique key `(community_id, source_url)` |
| Geographic scope verdict | `alerts.geo_scope` | **REUSE + vocabulary extension (Q3)** | Exists; live vocabulary `{NULL, 'countywide'}` (news), `'address'` (notice_geo.py). Proposed: `'place'` for town-level news evidence |
| Single resolvable ZIP | `alerts.zip` | **REUSE** | Exists, indexed (`alerts_community_zip`), currently always NULL |
| Coordinates | `alerts.geo_lat/geo_lng` | **REUSE (optional)** | Exist; news items rarely carry a geocodable address — populate only when true |
| Place→ZIP mapping | `communities` rows under the root | **REUSE (Q4)** | City rows carry `zip_codes`; ZIP rows are named `"<place> (<ZIP>)"` — the gate's town anchors are resolvable against community names/ZIP arrays with no new dataset |
| Page-side carrier | `app_changes.zip/lat/lng/confidence` | **REUSE** | All exist |
| Email-side subscriber ZIP | `users.zip_code` | **REUSE** | Already read by `digest.py::_format_place` |
| **Structured routing evidence** (matched anchors + provenance, for explainability/audit) | none | **NEW — `alerts.geo_evidence jsonb NULL` (Q2)** | Proven no carrier: `build_payload` stamps 10 columns; `geographic_reference` is static per-feed config (overloading clobbers live semantics); `subtopics` is the topic array; no jsonb column exists on `alerts`. The Addendum's G5 clarification anticipated exactly this: full-model schema needs were UNVERIFIED/out of audited scope |
| Routing feature flag | none | **NEW — `app_flags(name pk, enabled bool, note, updated_at)` (Q5)** | No DB flag infra exists (verified; site `config.js` gates are client-only, engine `data/autopost.json` is git-side and unreadable from a SQL function) |

**Why reuse is impossible for the two NEW items** (mission requirement): evidence
must be queryable by the SQL materializer *and* auditable per routing decision —
no existing `alerts` column can carry a structure without destroying its current
meaning; a SQL-function flag must be readable in-database — no such object exists.
Both are additive and nullable/off-by-default; neither touches existing rows' meaning.

**Everything explicitly NOT proposed:** no new tables for routing itself, no
per-ZIP duplication of `alerts` rows (impossible anyway under
`UNIQUE(community_id, source_url)` — a load-bearing constraint that forces
routing to live in materialization, not in row multiplication), no change to
`app_changes` shape, no RLS changes, no new Edge Function, no new cron job.

---

## 5. Migration Plan (ordered; each additive & reversible)

| # | Migration | Phase | Contents | Rollback |
|---|---|---|---|---|
| M0 | *(repo only)* live-body snapshot | A | Commit live `app_refresh_zip` verbatim as SQL of record | n/a (doc) |
| M1 | `app_refresh_zip_determinism` | A | Append total-order tie-breaker (`, id` / `, source_ref`) to all 7 capped selects; no filter/cap change | Re-apply M0 snapshot |
| M2 | `app_refresh_zip_gin_shape` | A | `_zip = any(zip_codes)` → `zip_codes @> array[_zip]` (same rows; GIN-eligible). EXPLAIN ANALYZE before/after recorded | Re-apply M1 body |
| M3 | `alerts_local_news_geo_backfill` | B | One-time: `geo_scope='countywide'` where `category='local_news' and geo_scope is null` (codifies current verified semantics — the gate proved county relevance only). Affected row IDs captured to a log table per Evidence Packet cleanup discipline | Reset captured IDs to NULL |
| M4 | `alerts_geo_evidence` *(needs Q2)* | B | `alter table alerts add column geo_evidence jsonb` (nullable) | Column retained empty (non-destructive) or dropped |
| M5 | `local_news_routing_shadow` view *(needs Q2/Q4)* | C | Read-only view: per ZIP, the routed set derived from evidence vs the current replicated set + divergence counts | `drop view` |
| M6 | `app_refresh_zip_routed_local_news` *(needs Q4/Q5 + shadow pass)* | D | Flag-guarded branch: flag OFF ⇒ legacy insert byte-identical; flag ON ⇒ include a story on a ZIP page iff `geo_scope='countywide'` (root-wide, current behavior) OR evidence places it in that ZIP (`alerts.zip` / place→ZIP via communities). Same window/cap/ordering/dedupe | Flip flag OFF (instant); or re-apply M2 body |
| M7 | cleanup *(post-cutover, founder-approved)* | F | Remove legacy branch + shadow view; drop flag row | n/a (end state) |

No pg_cron changes at any phase. `app_refresh_batch`/`app_refresh_all` untouched.

---

## 6. Testing Plan (mapped to the eight required categories)

1. **Unit (ingest):** gate evidence extraction — anchor matched in title vs
   summary vs enriched body; no match ⇒ item dropped exactly as today; evidence
   payload shape; place→ZIP resolution incl. unknown-place ⇒ `unresolved` (fail
   to countywide, never guess). Offline fixtures (existing `fixtures/direct_news/`).
2. **Unit (site, static guards):** extend `test/local-news-materialization.test.mjs`
   — tie-breakers present in every capped select; flag-off SQL shape identical to
   legacy; routed branch requires `source_url`; news stays below the meta upsert.
3. **Integration:** `dryrun`-style single-feed ingest (existing dry-run path)
   asserting alerts rows carry evidence; then `app_refresh_zip` on the pilot ZIP
   asserting page rows match the shadow view for that ZIP.
4. **Replay:** after M1/M2, reconstruct pilot-ZIP page from source tables and
   diff against materialized page — target byte-identical modulo the documented
   cadence drift (Addendum Obs 4). Establishes the "legacy replay baseline" the
   Evidence Packet defines; repeat with flag ON in shadow.
5. **Idempotency (G4.1):** run `app_refresh_zip(pilot)` twice, diff full page
   state — empty diff required at every phase (delete-then-rebuild + determinism
   makes this provable rather than probabilistic).
6. **Performance (G4.3):** EXPLAIN ANALYZE of `app_refresh_zip` before/after M2
   and after M6 (routed branch joins evidence); budget: no regression of the
   hourly 1,500-ZIP batch beyond its current slot (measure, don't assume).
7. **Shadow-mode comparison (Phase C gate):** across all 105 news-bearing ZIPs —
   per-ZIP density delta, % stories routed narrower than countywide,
   unresolved-place rate, page/email divergence (routed page set vs what the
   digest would send). These are the G4.4 metrics; **thresholds are founder
   decisions (Q7), not invented here.**
8. **Migration & rollback tests:** apply M1–M6 on a Supabase branch DB first;
   rollback drill = re-apply archived body + flag flip, then re-run tests 4–5 and
   diff pilot page against the pre-migration capture.

---

## 7. Deployment Plan (dependencies & order)

1. **Phase A (prereqs):** M0→M1→M2 + verifier fix + `feeds.csv` re-sync. No
   user-visible change intended; determinism does change *which* rows fill
   overfull dev/planning sections (Addendum Obs 1 made stability impossible
   otherwise) — founder informed (Q9), pilot-ZIP before/after diff attached.
2. **Phase B (evidence, invisible):** engine PR (gate evidence + payload) after
   M3/M4. Rides existing 2-hourly `ingest.yml`. Wait ≥14 days so the whole
   materialization window carries evidence (the 14-day window is the natural
   coverage clock).
3. **Phase C (shadow):** M5 + shadow workflow. Run ≥7 days. Founder reviews the
   G4.4 metric readout and sets thresholds (Q7). **Gate: no Phase D until this
   review happens.**
4. **Phase D (page cutover):** M6 with flag OFF, verify byte-identical pages;
   founder flips flag for the pilot county (Q6, proposed Box Elder / ZIP 84302);
   `verify-local-news-routing.mjs` green; then remaining counties.
5. **Phase E (email parity):** digest flag ON only after ≥1 clean week of Phase D
   — page is the reference implementation; email mirrors the same routed set (Q8).
6. **Phase F (cleanup):** remove shadow + legacy branch; update both repos' docs
   (CLAUDE.md wiring notes, SQL of record) in the same commits.

Cross-repo ordering rule (same discipline as the original Local News ship):
site migration lands **before** the engine change that depends on it, and each
phase is independently shippable and revertible.

## 8. Rollback Plan

- **Phase D/E:** flip `app_flags` row OFF / digest flag OFF — instant, no deploy,
  next hourly batch / next digest rebuilds legacy output. This is the primary
  rollback and is tested before cutover.
- **Any function regression:** re-apply the archived prior body (M0 snapshot and
  each migration keep the full body verbatim — the current docs-drift failure
  mode is what M0 exists to prevent). Delete-then-rebuild means one batch sweep
  (≤ ~9 h) fully restores pages; a manual `app_refresh_zip` restores any single
  ZIP immediately.
- **Data:** M3 backfill reversible via captured row IDs; M4 column nullable —
  ignore or drop; no destructive migration exists anywhere in the plan.
- **Rollback triggers (G4.4):** metrics = page-density drop, replay mismatch,
  page/email divergence, unresolved-place rate, materialization runtime.
  **Thresholds require founder approval (Q7) — deliberately not invented.**

## 9. Risk Register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Determinism fix changes which rows appear on overfull dev/planning pages | Med | Pilot before/after diff; founder ack (Q9); required prerequisite regardless (Addendum 1/2) |
| R2 | Prod↔repo drift (live function ≠ SQL-of-record; `public.feeds` ≠ `feeds.csv`; cutover-plan doc contradicts live state) | **High (already live)** | M0 snapshot first; feeds re-sync; Q1 parity re-run for CVD |
| R3 | Evidence precision: gate reads title+summary only (RSS path) — a story about a town that names it only in the body would route as countywide (over-broad) or, post-cutover, be under-routed | High | Shadow metrics quantify before any flip; body-enrichment exists on the direct path (`news_html`) and its extension is a logged follow-up, not a silent change |
| R4 | Page/email divergence window (page sweep ≈ 9 h eventual-consistency vs digest 5 PM CT) | Med | Already true today; parity defined at the routing-rule level, measured in shadow (G4.4 metric) |
| R5 | Multi-county outlets (Moab Times → Grand + San Juan; SL outlets → BE + UC): same story exists as one alert per county | Med | Routing stays within each alert's own `community_id` chain — cross-county leakage structurally impossible; asserted in tests |
| R6 | Unresolved place names (unincorporated places not modeled in `communities`) | Med | Fail to `countywide` (today's behavior), count in unresolved-rate metric — never guess a ZIP |
| R7 | 12,722-page perf: routed branch adds evidence predicates | Med | G4.3 EXPLAIN ANALYZE gate at M2 and M6; hourly-batch runtime budget |
| R8 | Stale `news_alert` verifier masks real monitoring | Low | Fix in Phase A |
| R9 | Email ZIP-scoping changes subscriber content (some will see fewer, more-local stories) | High (product) | Own phase (E), own flag, founder decision Q8 — never bundled with page cutover |
| R10 | Inactive counties (Cache/Davis/Tooele/Weber feeds off) — routing ships against 7 active communities only | Low | Scope note; reactivation is data (feeds), not code (Q10) |

## 10. Questions requiring founder decisions (nothing proceeds past Phase A without Q2–Q6)

| # | Question | Proposed default (evidence-based) |
|---|---|---|
| Q1 | **Immediate, independent of this project:** Box Elder direct-news cutover has executed in prod while the parity doc says CVD wasn't ready. Re-run `parity-direct-news.yml` to confirm no CVD coverage loss, and re-sync `feeds.csv`? | Yes — verification is read-only |
| Q2 | Approve the single new column `alerts.geo_evidence jsonb` (nullable, additive) as the explainability carrier? | Yes — §4 proves no existing carrier |
| Q3 | Approve `geo_scope` vocabulary extension: add `'place'` to live `{'countywide','address'}`? | Yes |
| Q4 | Approve the routing rule: countywide-evidence stories → all ZIPs of the county (today's behavior); place-evidence stories → only ZIPs of the matched place(s), resolved via `communities` rows; unresolved → countywide? | This is THE architecture decision the missing ADR would own |
| Q5 | Approve one-row `app_flags` table as the DB-side flag mechanism? | Yes — smallest possible new object |
| Q6 | Pilot county + pilot ZIP ("one agreed pilot ZIP" per the Evidence Packet)? | Box Elder / 84302 |
| Q7 | Rollback-trigger **thresholds** for the G4.4 metrics (density drop %, divergence %, unresolved %, runtime cap)? | Founder sets after seeing the Phase C shadow readout |
| Q8 | Should subscriber **emails** switch from county-wide to ZIP-routed news at Phase E, or keep county-wide email indefinitely? | Founder call — product behavior |
| Q9 | Acknowledge the Phase A determinism fix changes which items fill overfull dev/planning sections (bounded, shown on pilot diff)? | Required prerequisite |
| Q10 | Are the inactive counties (Cache/Davis/Tooele/Weber) in scope for routing go-live, or Box Elder + Utah County + the 5 single-outlet counties only? | Ship against currently active feeds |

---

*Prepared read-only. Sources: live Supabase project `qwnnmljucajnexpxdgxr` (schema,
function bodies, pg_cron, pg_indexes, row counts — 2026-07-24); full-repo audits of
`homesignal-ingest` and `homesignal-site`; ADR-001 Phase A Evidence Packet; Phase A
Addendum (Final). No spec or ADR document exists; all [PROPOSAL] items await founder
approval.*
