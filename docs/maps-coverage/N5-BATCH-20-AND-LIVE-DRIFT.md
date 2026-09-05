# Batch 20, and the live-drift fault it uncovered

**Date:** 2026-09-04 · **Snapshot:** `phase1-2026-09-01`

## 1. Batch 20 pipeline — 57 prefixes, 1,776 ZIPs

Selected ascending by `evidence=1` volume (what actually drives membership and marker
rows) to a budget inside the measured 409 MB headroom.

| stage | result |
|---|---|
| boundary (run `33881896480`) | 57/57 prefixes, 713.6 s, 314.2 bytes per membership row |
| Unit A (`33883137561`) | `boundary_complete` 8,505 → 10,069 · memberships +127,897 |
| `not_measured` derivation | 337 → 549 (+212), pre-existing set fingerprinted and preserved |
| markers (`33883986730`) | +144,044 |

**Quality gates over the batch, every one stated so the healthy answer is 0:**
127,897 memberships · 144,044 markers · **0** membership without a marker · **0** duplicate
memberships · **0** duplicate markers · **0** orphan markers · **0** markers without a point
· **0** memberships without a point.

The 212 ZIPs that got no status row have no pinned TIGER2025 ZCTA, so they are
`not_measured`. Calling them zero is the error §6 exists to prevent.

⚠️ **A gate I invented was wrong, and the control caught it.** I checked
membership-point against marker-point for single-marker projects and got 373 disagreements
against a required zero. The control — the identical query over the already-serving
population — returned **977** (2.06% there versus 0.30% here). Production has served that
shape for weeks. The real gate is producer-output versus relation, and the marker rule
(`D_M 1000 / MIN_LINE_M 250 / MIN_AREA_M2 1000`) legitimately puts a component's point
somewhere the union's representative point is not.

## 2. The marker guard fired, correctly

`STOP: PREFIXES names prefixes with no zip_authoritative_membership rows: 753,885`

Both are genuine measured-zero, verified before excluding them: **753** has 1
`boundary_complete` ZIP declaring 0 membership plus 51 no-ZCTA; **885** is all 77 no-ZCTA;
both have `evidence=1 = 0` across 18,282 and 7,089 associations. The marker prefix list was
then recomputed **inside the database** rather than hand-edited.

## 3. 🔴 THE FAULT: the authoritative producer cannot survive the live refresh

`geo.zip_authoritative_membership` is derived from the **frozen** phase-1 baseline.
`public.app_authoritative_projects_for_zip` joins it to **live** `public.app_projects` with
an INNER join and raises when any membership fails to resolve:

```
AUTHORITATIVE INVARIANT: zip 11004 returned 286 projects for 295 memberships
```

`public.app_projects_for_zip` has **no exception handler and no fallback** — read from the
shipped definition, not assumed: *"there is deliberately no legacy fallback here."* So the
raise reaches the caller and that ZIP page's development query **errors**.

**Caught in the act.** `pg_stat_activity` at the moment of the second failure showed
`public.dev_refresh_tick(8, 20)` and `public.app_refresh_sweep()` running. Those jobs
rewrite `app_projects` on a schedule. Every removal breaks every enabled ZIP the project
belonged to, silently, until something calls the producer.

**It is not transient.** All 19 rolled-back ZIPs remain unresolvable, 85331 included.

**It defeats a preflight.** Run 3's preflight was clean — 0 failing against a control of
139,211 memberships — and chunk 34 raised 40 minutes later. A one-shot check cannot hold
against a table being rewritten underneath it.

**Rolled back to legacy (19):** 11004, 20912, 21204, 28027, 28715, 58501, 58503, 58504,
68523, 70714, 70791, 70802, 86004, 89439, 85331 + 4 more. Re-checked after: **0 enabled
ZIPs failing, control 137,229 memberships.**

### Why this is the founder's call, not mine

Three options, and each changes something the standing rules protect:

- **(a) Tolerate a missing descriptive row.** `geo.n5_shadow_projects_for_zip` already does
  exactly this — `left join lateral` plus `attributes_missing` — so the design anticipated
  it. But it changes what a resident sees on a card, which is gated.
- **(b) Re-derive membership from live `app_projects`.** Abandons the preservation basis the
  whole model rests on.
- **(c) Keep rolling back after every refresh.** Coverage decays on a schedule.

## 4. Two corrections to my own reading

Both were confidently wrong and are recorded because the wrong version was more convincing.

**A timeout does not prove rollback — in either direction.** I read the cutover table
straight after a client-side timeout, saw the rollback had not applied, and moved on. It
committed afterwards. The rule already had a receipt in this series for the case where the
write *did not* land; this is the case where it lands *after you look*.

**I called the drift transient on two empty UPDATE results.** It is not. The updates
returned nothing because the timed-out statement had already disabled those ZIPs.

## 5. State

| | |
|---|---|
| shards done / left | **539 / 5** |
| enabled ZIPs | 9,745 |
| `production_geography_verified` | **8,363** |
| rolled back on live drift | 19 |
| memberships / markers (relation) | 204,746 / 296,148 |
| authoritative projects | 178,379 |
| free disk | 2,354 MB (floor 2,048) |
| per-ZIP export | 12,722 rows, refreshed 16:03:07Z |

Buckets close exactly on 12,722: A 5,101 · B 3,262 · C 1,706 · D 549 · E 445 · F 1,659.
F splits **1,508 acquired, awaiting downstream** (41 prefixes) and **151 awaiting
acquisition** (5 prefixes).
