# Local News Routing — Phase B Implementation Plan (resolver + shadow; pre-approval)

**Date:** 2026-07-24 · **Status: AWAITING FOUNDER APPROVAL — no routing code written.**
Prerequisite: Phase A is COMPLETE with all five evidence items green
(`docs/local-news-phase-a-evidence-report.md`). Parent plan:
`docs/local-news-routing-implementation-plan.md`. FD-4 result: the executed Box
Elder direct cutover is not losing articles (`rss_only=0` everywhere; CVD PASS).

## Objective

Capture geographic evidence at ingest for `category='local_news'`, run the
approved resolver in **shadow**, store its verdicts on `alerts`
(`geo_scope`, `zip`, `geo_evidence`, `resolver_version`), and produce the
shadow comparison metrics the founder will use to set rollback thresholds.
**Zero user-visible change:** pages and email keep county-wide behavior;
`app_refresh_zip` and `digest.py` delivery are untouched in Phase B.

## The resolver (founder decision 1, locked)

Precedence, first match wins; evaluated per article against the gate's matched
text (title + summary blob; body-enriched text where the `news_html` path
already fetched it — fail-closed, no new fetching):

| # | Step | Implementation | `geo_scope` written |
|---|---|---|---|
| 1 | Explicit ZIP | 5-digit ZIP in text, validated against the article community's chain ZIP universe (never a bare number match) | `zip` (+ `alerts.zip`) |
| 2 | Address → ZIP | Street-address pattern → existing `adapters/notice_geo.py` Census geocoder (already engine-side; ZIP + lat/lng; county-fenced) | `zip` (+ `alerts.zip`, `geo_lat/geo_lng`) |
| 3 | Place → ZIP set | Gate anchor(s) matched → `communities` rows under the same chain root (city rows' `zip_codes`; ZIP rows named `"<place> (<ZIP>)"`). Multi-place = union. Cross-county anchors are structurally excluded (resolution stays inside the alert's own `community_id` chain) | `place` (ZIP set carried in `geo_evidence`; `alerts.zip` only when the set is a single ZIP) |
| 4 | VERIFIED countywide event | **FD-B1 below — definition needs founder approval.** County mention alone is NOT sufficient (locked) | `countywide` |
| 5 | Regional context | NOT implemented (future only). Vocabulary reserved: `regional` | — |
| 6 | Unresolved | Everything else. **Never defaults to countywide** | `unresolved` (= HOLD at cutover) |

Topic classification (`subtopics`, `classify_news_subtopics.py`) is untouched —
completely independent of routing (locked).

**Explainability contract:** `alerts.geo_evidence` (jsonb, approved) records
`{resolver_version, method (explicit_zip|address|place|countywide|unresolved),
matches:[{anchor, place, zips[], found_in: title|summary|body}], zip_set,
gate_config_sha}` — every routing decision replayable from the stored row.
`alerts.resolver_version` (approved) stamps the resolver release; bumping it
re-resolves only rows stamped older (same idempotency pattern as the grader).

## Files that change

**homesignal-ingest**
| File | Change |
|---|---|
| `ingest.py` | Additive: for `category='local_news'` rows only, and only when the `resolver_shadow` flag is ON, the gate result carries matched-anchor evidence and `build_payload` stamps `geo_scope`, `zip`, `geo_lat/geo_lng`, `geo_evidence`, `resolver_version`. Flag OFF ⇒ byte-identical current payload. Non-news paths untouched |
| `adapters/local_news_resolver.py` (NEW) | The resolver: precedence steps 1–3+6 (and 4 per FD-B1); reads gate YAML anchors + a place→community map built from a `communities` read at run start. Pure function + fixtures |
| `adapters/*.yaml` gate configs | No rule changes. Optional `place:` normalization labels only if an anchor's display name differs from its `communities.name` |
| `scripts/shadow_local_news_routing.py` (NEW) | Read-only: for every ZIP under news-bearing roots, computes routed vs replicated sets from stored evidence; emits JSON metrics (per-ZIP density delta, HOLD rate, method distribution, unresolved examples) |
| `.github/workflows/shadow-local-news.yml` (NEW) | Manual + daily during the shadow window; artifact upload; no DB writes |
| `tests/test_local_news_resolver.py` (NEW) | Fixture-driven resolver tests (see Tests) |

**homesignal-site**
| File | Change |
|---|---|
| `docs/local-news-flags-and-evidence-migration.sql` (NEW) | Migration SQL of record for the two approved columns + `app_flags` (below) |
| `docs/local-news-routing-shadow-view.sql` (NEW) | Read-only `local_news_routing_shadow` view (per-ZIP routed vs current) |
| `test/` | Static guards: flags exist and default OFF; shadow view is a view (no writes); `app_refresh_zip` SQL of record UNCHANGED in Phase B (byte-guard against the Phase A md5) |

## Database changes (reuse-first; only the approved additions)

| Object | Change | Why reuse is impossible |
|---|---|---|
| `alerts.geo_evidence jsonb NULL` | NEW (approved) | No existing column can carry structured evidence without clobbering live semantics (Phase A audit §4) |
| `alerts.resolver_version text NULL` | NEW (approved) | Idempotent re-resolution needs a version stamp; no existing carrier |
| `public.app_flags(name text pk, enabled boolean not null default false, note text, updated_at timestamptz)` | NEW — 3 rows: `resolver_shadow`, `page_target_zip`, `email_target_zip`, **all OFF** | The flags must be readable by the SQL materializer (Phase D), the Python engine, and digest from ONE authority; no DB flag carrier exists. RLS: no anon access (service/definer reads only) |
| `local_news_routing_shadow` view | NEW, read-only | The shadow instrument; dropped at Phase F cleanup |
| `alerts.geo_scope`, `alerts.zip`, `geo_lat/geo_lng` | REUSED (no DDL). Vocabulary becomes `{zip, place, countywide, unresolved}` (+ legacy `address` on notices, `regional` reserved) | — |
| Existing 592 local_news rows | **NOT backfilled.** Pre-resolver rows keep `geo_scope` NULL (=legacy) and age out of the 14-day window naturally — no evidence exists for them, and inventing `countywide` would violate decision 1 | — |

No changes to `app_refresh_zip`, `app_changes`, `digest.py` delivery, cron, or RLS
on existing tables.

## Feature flags (founder decision 3)

`resolver_shadow` (Phase B, gates evidence capture + shadow runs),
`page_target_zip` (Phase D, unused in B), `email_target_zip` (Phase E, unused
in B). All ship OFF; each is flipped by the founder, never by code.

## Tests

1. **Resolver unit fixtures** (offline): explicit-ZIP hit incl. false-positive
   guard (a 5-digit number that isn't a chain ZIP → not step 1); address →
   notice_geo path (mocked Census response); single place → single ZIP
   (Tremonton → 84337); multi-place union; place in ANOTHER county's chain →
   excluded (cross-county leak guard); no match → `unresolved`; county name
   alone → **`unresolved`, not countywide** (locked rule regression test).
2. **Payload additivity**: flag OFF ⇒ `build_payload` output byte-identical to
   today (regression fixture); flag ON ⇒ only the five new fields differ.
3. **Topic independence**: `subtopics` identical with resolver on/off.
4. **Idempotency**: re-running ingest over the same feed produces no new/changed
   rows (existing upsert semantics; resolver adds no nondeterminism — anchors
   and config are stable inputs, stamped with `resolver_version`).
5. **Shadow correctness**: view/script agree on a hand-computed fixture ZIP;
   pilot 84337 routed set explainable row-by-row from `geo_evidence`.
6. **Phase A byte-guard**: `app_refresh_zip` live md5 still
   `5d840e01cc8f35c2c7071cb893081310` at Phase B end (nothing in B may touch it).

## Acceptance criteria (gate to any Phase C/D planning)

1. All tests green; flag-off production behavior verified byte-identical.
2. ≥14 consecutive days of evidence-stamped ingest (the full materialization
   window), across all 7 active news communities.
3. Shadow report delivered to the founder with the G4.4 metrics — per-ZIP
   density delta, HOLD/unresolved rate (overall and per outlet), method
   distribution — plus the pilot 84337 walk-through.
4. Founder sets the rollback thresholds from that report (decision 6 of the
   parent plan) and rules on FD-B1/FD-B2.

## Rollback

Flip `resolver_shadow` OFF (engine stops stamping; nothing reads the fields);
columns are nullable/additive — leave or drop; view dropped with one statement.
No page/email surface exists to roll back in Phase B.

## Founder decisions required before Phase B coding starts

| # | Decision | Options (evidence attached in the drift audit) |
|---|---|---|
| FD-B1 | What qualifies as **VERIFIED countywide event** (resolver step 4)? | (a) explicit textual county-scope markers only ("county-wide", "across Box Elder County", official county-government agency as the story's subject); (b) = (a) + county-government `agency_name` sources; (c) = (b) + single-county-outlet provenance — note the Moab Times feeds TWO counties (Grand + San Juan), so provenance can never apply to it, and under (a)/(b) most single-outlet-county articles will be `unresolved`→HOLD at cutover (their pages would thin dramatically — quantified in the shadow report either way) |
| FD-B2 | HOLD visibility: audit-only in `geo_evidence`, or also a founder-visible hold queue/report for review? | Shadow report lists HOLD examples regardless; a standing queue is optional |
| FD-B3 | Confirm the explicit-ZIP rule (step 1): only ZIPs belonging to the article community's chain count as explicit-ZIP evidence; an out-of-chain ZIP mention is ignored (falls through) | Prevents a Salt Lake ZIP in a statewide story from hijacking routing |
| FD-B4 | Confirm `app_flags` (3-row table, RLS-locked, all OFF) as the flag carrier | Smallest object serving SQL + engine + digest |
