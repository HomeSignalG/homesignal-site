# Local News Routing — Phase A Implementation Plan (detailed, pre-approval)

**Date:** 2026-07-24 · **Status: AWAITING FOUNDER APPROVAL — no code written.**
Parent plan: `docs/local-news-routing-implementation-plan.md`. Founder decisions
1–8 (2026-07-24) are incorporated; decision 6 makes Phase A a hard prerequisite:
*"Resolve all nondeterministic ordering before implementing ZIP routing."*

## Objective

Make `app_refresh_zip` **deterministic and replayable** (Addendum Obs 1–3), fix
the SQL-of-record drift against the live function (founder decision 7: live DB
is authoritative), fix the stale monitoring verifier, and deliver the completed
read-only feed-drift audit (decision 8 — done, see
`homesignal-ingest/docs/local-news-feed-drift-audit-2026-07-24.md`).

**Explicitly OUT of Phase A:** resolver, evidence capture, `geo_evidence` /
`resolver_version` columns, the three feature flags (`resolver_shadow`,
`page_target_zip`, `email_target_zip`) and their `app_flags` carrier, any
routing behavior, any email change, any feed-config change. Flags first appear
in Phase B with their first consumer — Phase A ships no dead infrastructure.
Phase A changes **no user-visible filter, window, cap, or category**.

---

## 1. Repository files that change

**homesignal-site** (all on `claude/local-news-implementation-audit-uvx551`)

| # | File | New/Mod | Purpose |
|---|---|---|---|
| F1 | `docs/app-refresh-zip-live-snapshot-2026-07-24.sql` | NEW | Verbatim snapshot of the LIVE production `app_refresh_zip` (captured read-only 2026-07-24). Becomes the rollback baseline and the new SQL of record, replacing the stale one-hop-`_root` body in `app-refresh-zip-local-news-migration.sql` (live body walks the full ancestor chain) |
| F2 | `docs/app-refresh-zip-determinism-migration.sql` | NEW | Migration M1 (full function body + before/after ORDER BY diff table + rollback body reference) |
| F3 | `docs/app-refresh-zip-gin-containment-migration.sql` | NEW | Migration M2 (full function body + equivalence proof query + EXPLAIN receipts) |
| F4 | `test/app-refresh-zip-determinism.test.mjs` | NEW | Static CI guards (no DB): every capped select in the latest SQL of record carries a total-order ORDER BY (details §5, T1) |
| F5 | `test/local-news-materialization.test.mjs` | MOD | Point its migration-file assertions at the new SQL of record; all existing guards (news branch shape, gate-order, `source_url` required, `_root` anchor) must keep passing |
| F6 | `scripts/verify-alerts-categories.mjs` | MOD | Replace the dead `pipeline_type='news_alert'` probes with the live vocabulary (`pipeline_type='news'`, `category='local_news'`) so the P0 "no news" alarm can actually fire |

**homesignal-ingest**

| # | File | New/Mod | Purpose |
|---|---|---|---|
| F7 | `docs/local-news-feed-drift-audit-2026-07-24.md` | NEW (already committed) | Decision-8 deliverable. **No `feeds.csv` change** (decision 8: do not modify feed configuration) |

No other files. `lib/data.js`, `alerts.html`, `digest.py`, `ingest.py`, all
adapters, all workflows, all cron jobs: untouched in Phase A.

## 2. Database objects affected

| Object | Change | Data impact |
|---|---|---|
| `public.app_refresh_zip(text)` | Replaced twice (M1, M2) via `CREATE OR REPLACE` | None at rest; affects only rows the next refresh writes |
| `public.app_changes` / `app_projects` / `app_community_meta` | **No DDL.** Rows for validated ZIPs are rebuilt by running the (normal) refresh during acceptance testing | Self-healing (delete-then-rebuild per ZIP); hourly batch re-covers everything ≤ ~9 h |
| Everything else (`alerts`, `communities`, indexes, cron, RLS, views, Edge Functions) | **Untouched** | — |

No new tables, no new columns, no index changes (`idx_communities_zip_codes_gin`
already exists — M2 only changes the query shape to use it).

## 3. Migrations

### M1 — `app_refresh_zip_determinism_tiebreakers`

Appends a total-order tie-breaker to **all seven** capped selects in the live
body; every other byte of the function is identical to F1. `md5(el::text)` is a
deterministic total key for JSONB site elements (jsonb text form is canonical;
`dev_sites_deduped()` guarantees no exact duplicates); `id` (uuid PK, verified
present) totals the `alerts`/`meetings` selects.

| Branch (cap) | Current ORDER BY (live, verified) | After M1 |
|---|---|---|
| Development → app_projects (48) | `file/decision date desc nulls last` | + `, coalesce(el->>'record_url', el->>'url'), md5(el::text)` |
| Facilities → app_projects (16) | `el->>'label'` | + `, coalesce(nullif(el->>'registry_id',''),''), md5(el::text)` |
| Planning & zoning → app_changes (6) | **none** | `file_date desc nulls last, coalesce(el->>'record_url', el->>'url'), md5(el::text)` |
| Civic → app_changes (6) | **none** | `el->>'label', coalesce(el->>'record_url', el->>'url'), md5(el::text)` |
| Meetings → app_changes (8) | `m.meeting_date asc` | + `, m.id` |
| Gov notices → app_changes (48) | `a.created_at desc` | + `, a.id` |
| **Local News → app_changes (48)** | `a.created_at desc` | + `, a.id` |

Note (founder ack'd): where more rows qualify than the cap and the primary key
ties (the Addendum's dev 48-of-77 / planning 6-of-10 cases), M1 fixes *which*
rows win permanently — the current arbitrary winners may change once, then
never again. Newest-first primary keys are kept exactly as they are today.

### M2 — `app_refresh_zip_gin_containment`

One-line predicate change in the community resolution:
`where _zip = any(zip_codes)` → `where zip_codes @> array[_zip]`
(semantically identical membership test; containment is GIN-eligible —
Addendum Obs 3). Ordering (`level='zip'` > `'city'` > rest) unchanged.

**Sequencing:** M0 (F1 snapshot, repo-only) → M1 → M2, applied via
`mcp__Supabase__apply_migration`, each preceded by a Supabase-branch-DB dry
application. M1 and M2 are separate migrations so each can be rolled back
independently.

## 4. Feature flags

**None in Phase A.** Determinism and the index-shape fix are prerequisites, not
routable behavior — flag-gating them would leave the nondeterminism the flags'
own shadow comparisons depend on. The three approved flags
(`resolver_shadow`, `page_target_zip`, `email_target_zip`) and their one-row
`app_flags` carrier table ship in Phase B/D/E with their first consumers, all
default OFF.

## 5. Tests

| # | Test | Type | Pass criterion |
|---|---|---|---|
| T1 | `test/app-refresh-zip-determinism.test.mjs` | Static, CI, no DB | The SQL of record contains exactly 7 `limit`-capped selects; each has an ORDER BY terminating in `md5(` or `.id`; planning/civic branches no longer lack ORDER BY |
| T2 | `test/local-news-materialization.test.mjs` (updated) | Static, CI | All existing Local News guards pass against the new SQL of record (news branch below meta upsert; `source_url` required; `coalesce(_root,_cid)` anchor; 14-day window; cap 48) |
| T3 | Idempotency (G4.1) — pilot ZIP **84337** | Live, branch DB then production | `app_refresh_zip('84337')` twice back-to-back; diff of `app_changes`+`app_projects`+`app_community_meta` (normalized: minus volatile `id`/`created_at`) is **empty** |
| T4 | Determinism under repetition — a >cap ZIP (dev >48 qualifying, e.g. the Addendum's audited case) | Live, read-only compare | N consecutive runs select the identical row set and order, before source data changes (this is the property M1 creates; it fails today) |
| T5 | Replay (G4.2) — 84337 | Live, read-only | Standalone execution of the function's SELECTs reconstructs the stored page rows exactly (row count + content), immediately after a refresh — "legacy replay baseline established" per the Evidence Packet wording |
| T6 | M2 equivalence proof | Live, read-only | For every candidate ZIP (12,722): community id resolved by the old predicate = new predicate; **zero** mismatches |
| T7 | Performance (G4.3) | Live, read-only | EXPLAIN ANALYZE of the resolution query before/after M2 (index usage recorded); wall-clock of `app_refresh_zip('84337')` and one `app_refresh_batch(1500)` slot before/after — acceptance: no regression beyond the current hourly slot |
| T8 | Verifier fix | Script run | `verify-alerts-categories.mjs` reports live local_news counts instead of the false "0 news_alert" P0 |
| T9 | Rollback drill | Branch DB | Apply F1 snapshot over M2 body; re-run T3/T5; page state identical to pre-M1 capture |

## 6. Rollback procedures

1. **M1 or M2 misbehaves:** `CREATE OR REPLACE` the F1 snapshot body (kept
   verbatim in-repo; the exact drill is T9-tested first). Function rollback is
   instant; no data restore needed — the next hourly batch (or a manual
   per-ZIP refresh) rebuilds pages, ≤ ~9 h for the full universe.
2. **Roll back M2 only:** re-apply the M1 body (kept verbatim in F2).
3. **Verifier/test changes:** `git revert` (repo-only, no production surface).
4. **Validation writes:** none to clean up — T3/T4 writes are the normal
   materializer output for those ZIPs (Evidence Packet cleanup rule satisfied:
   affected rows = `app_changes`/`app_projects`/`app_community_meta` for the
   refreshed ZIPs only, all regenerated on every run).

## 7. Acceptance criteria for Phase A (gate to Phase B)

1. T1–T9 all green (T3/T5 receipts recorded in the migration docs).
2. Live function == repo SQL of record (drift eliminated; decision 7 satisfied).
3. Feed-drift audit delivered (done) — with `feeds.csv` untouched (decision 8).
4. Founder sign-off on the T4/T7 receipts.

## 8. Remaining founder decisions (none block Phase A; FD-2/FD-3 block Phase B design)

| # | Decision | Needed by |
|---|---|---|
| FD-1 | Approve the specific tie-breaker keys in §3-M1 (this document) | Phase A start |
| FD-2 | Resolver precedence step 4, "VERIFIED countywide event": does **single-county-outlet provenance** qualify (Moab Times/Vernal Express/Park Record feeds ingest whole outlets with no in-text place filter — most of their articles have no in-text place evidence and would otherwise HOLD; note Moab Times feeds two counties, so provenance alone is ambiguous for it)? | Phase B |
| FD-3 | HOLD semantics: a held article appears on **no** ZIP page after cutover — until Phase E, does it still ride the (county-scoped) email digest, and is a founder-visible hold queue wanted? | Phase B/D |
| FD-4 | Recommended but independent of routing: one read-only `parity-direct-news.yml` run to confirm the already-executed CVD cutover isn't losing tail articles | Any time |
