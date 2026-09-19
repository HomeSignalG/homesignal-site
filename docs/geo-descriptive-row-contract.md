# The descriptive-row contract — CANONICAL (settled 2026-09-19, Phase 1)

When authoritative geography places a project on a ZIP page, `geo.zip_authoritative_membership`
supplies the **geography** (`zcta5`, `lat`, `lng`, `point_rule`) but carries **no descriptive
fields**. Name, type, status, date and registry are borrowed from ONE `public.app_projects` row
chosen per `(zcta5, source_key)`. Which row is chosen is the *descriptive-row rule*.

## THE RULE

> **`min(id)` — `order by p.id asc limit 1`, filtered to `record_kind = <the requested kind>`.**
> **`last_seen_at` is NOT a selector. `source_seq` is NOT geographic identity.**

## Evidence — the live production read path, 2026-09-19

Determined from `anon` EXECUTE privilege, because that is what a resident's browser actually
holds. Functions `anon` cannot execute are not the resident-facing path, whatever they contain.

| function | rule in body | `anon` EXECUTE | resident-facing? |
|---|---|---|---|
| `public.app_zip_projects_markers` | **`order by p.id asc`** | **true** | **YES** — `homesignalmap.html:2206` |
| `public.app_authoritative_projects_for_zip` | **`order by p.id asc limit 1`** | **true** | **YES** |
| `public.app_projects_for_zip` | routes to `app_authoritative_projects_for_zip` | **true** | **YES** — `properties.html:149` |
| `geo.n5_authoritative_test_for_zip` | `order by p.id asc limit 1` | false | no — test harness |
| `geo.n5_a3_projects_one_pass` | `order by p.source_key, p.id asc` | false | no — bench |
| `geo.n5_shadow_projects_for_zip` | `order by p.last_seen_at desc nulls last, p.id asc` | false | **no — SHADOW** |

**Every anon-reachable function uses `min(id)`. The `last_seen_at` rule exists in exactly one
live function, and that function has no anon grant** (`proacl` = `postgres=X/postgres`), so it
cannot be reached from the resident-facing client.

## ⚠️ Do NOT "fix" these two files — they are correct, and they are the misread hazard

Neither is a conflicting claim about production. Both correctly describe something that is not
production, which is exactly why they are easy to carry into production by mistake.

- **`docs/n5-unit-a-shadow.sql`** is the DDL of record for `geo.n5_shadow_projects_for_zip`.
  Its `last_seen_at desc, id asc` is **correct for that shadow function**, and its measurement
  (1,791 of 1,875 single-variant; 84 resolved; 0 residual ties) is a dated receipt. The file's
  own header already says it "does not touch `public.app_projects_for_zip`". Leave the rule and
  the measurement exactly as they are.
- **`docs/n5-unit-b-cutover-attempt.sql`** records a cutover **applied and rolled back the same
  hour** on 2026-09-03, parked verbatim on purpose. Its `last_seen_at desc` is the historical
  record of what ran. Leave it.

Both now carry a dated pointer back to this file.

## Correction to the Phase-0 CTO audit

That audit stated the repo carried *"two conflicting rules … an engineer will implement the wrong
one."* **That was imprecise and is corrected here.** The two rules describe *different functions*
and each is right about its own. The real risk is not contradiction but **absence of a
cross-reference**: nothing in the shadow DDL said production differs. That is what this file and
the two pointers fix.

## Why `min(id)` is safe despite `id` being a UUID

`id` is a v4 UUID, so `min(id)` is arbitrary rather than oldest-first — the word "stable" in the
delivery contract means *deterministic*, never *chronological*. It is safe because
`app_projects_zip_source_key_uidx (zip, source_key, source_seq)` is UNIQUE and ingest **upserts
in place**: a status or date change mutates the existing row rather than inserting a competing
one. So the common case has nothing to arbitrate.

Where several rows do share a `(zcta5, source_key)`, they are a multi-feature project — one plan
review or one DOT project with many geometry parts — and the design is deliberately **one card
with many markers** (`zip_authoritative_marker` PK is `(zcta5, source_key, marker_seq)`;
production `max(marker_seq)` = 188). Measured on the real corpus: for such groups the borrowed
attributes are identical anyway (e.g. `cabarrus-county-plan-reviews` key `PRB2025-00660` — 368
rows, one name, one status, one date), so the choice of row is not resident-visible.

## Already correct — no change needed

- `docs/n5-unit-a4-delivery-contract.sql:79` — *"lowest stable id. last_seen_at is not a selector;
  source_seq is not geographic identity."*
- `docs/n5-unit-a3-one-pass-read.sql:9` — *"Descriptive row: deterministic min(id) per source_key.
  last_seen_at is deliberately NOT used."*

## Not the descriptive-row rule — do not confuse

`order by a.submitted_at desc nulls last, a.id` appears in the same functions. That is the
**output card ordering**, not the row selector. Both exist in one function; they answer different
questions.

## Scope

Phase 1 is docs-only. **No function body, no data and no runtime behaviour was changed.** Any
future change to the rule is a resident-visible product change and needs its own authorization.
