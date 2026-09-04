# occurred_at full-set measurement — 12,722 canonical ZIP pages

**Measured 2026-09-04 14:09:06 UTC.** Read-only throughout: every statement was a `select`.
No function was altered, no production row written, no migration applied, no deploy.

> **Result: both corrections hold across the full page set, with zero residual defects.**
> W3 (Government Notices) — **70,260 of 70,260** displayed rows agree with the installed
> expression. W2 (Upcoming Meetings) — `window_closes_at` is carried by **exactly** the
> 1,245 public hearings and nothing else, and `occurred_at` equals `meeting_date` on all
> 20,318 rows. The ZIP 18042 positive control passes exactly.

*(This supersedes the halt report of 2026-09-04 01:51Z, which stopped correctly on a stale
whole-function fingerprint. That gate has been replaced — see §Scoped gate.)*

## Scoped gate — replacing the brittle whole-body fingerprint

The prior gate hashed the entire `app_refresh_zip` body, so seven unrelated projects/markers
migrations broke it. It is replaced with **statement-scoped** checks: the function body is
split on `insert into public.app_changes` and each candidate closed at its own terminating
semicolon — a real statement boundary, not a byte offset.

⚠️ **A first attempt used byte-offset windows and its own controls caught it**: the W2 window
reached back into the preceding `dev_sites_deduped` insert (so an unrelated edit *would* have
broken it — the exact failure being designed out), and the W3 window did not contain its own
`INSERT`. Recorded because a fingerprint that looks scoped but is not is worse than an
obviously brittle one.

**Controls on the final extraction — all PASS:** 6 `app_changes` statements found; W2 and W3
each contain **no** `app_projects`, `dev_sites_deduped` or `zip_centroids` (so projects edits
cannot perturb them); W2 reads `public.meetings` and not `public.alerts`, W3 the reverse.

### The three semantic checks (reusable by future scheduled measurements)

| # | check | live source text required | result |
|---|---|---|---|
| 4 | W2 `occurred_at` derives from the meeting date | `m.meeting_date::date, m.source_url, 'High',` | **PASS** |
| 5 | W2 window gate is public-hearing only | `case when m.is_public_hearing then m.meeting_date::date end` | **PASS** |
| 6 | W3 bounded `published_at` + `created_at` fallback | `case when a.published_at >= date '2000-01-01'` · `and a.published_at < now() + interval '2 years'` · `then a.published_at::date end,` · `a.created_at::date), a.source_url, 'High', a.comment_deadline` | **PASS** |

**Scoped fingerprints — reuse these, not the whole-body hash:**

```
W2 statement md5 : 5c754c5eb65315876f6ddd6c2274941e   (704 chars)
W3 statement md5 : 94b6d97cf5cfa80b80629bd7d17c5ac0   (900 chars)
```

Whole-body `app_refresh_zip` md5 `4a18ca4e20e906bbc7230b7383f4dd87` is recorded **for
concurrency attribution only** and must not be used as a gate.

## Propagation gate — reconfirmed, not carried forward

| measure | value |
|---|---|
| canonical denominator | **12,722** |
| canonical distinct ZIPs | **12,722** |
| refreshed since the W2/W3 boundary (`>= 2026-09-03 18:37:07+00`) | **12,722 / 12,722** |
| non-canonical rows in `app_community_meta` | **0** |
| duplicate ZIPs in `app_community_meta` | **0** |
| oldest page `updated_at` | 2026-09-04 07:16:33Z |

Measurement population: the **full 12,722**. No sampling; no population redefinition.

## W2 — Upcoming Meetings

20,318 displayed rows across 3,954 ZIP pages.

| measure | value |
|---|---:|
| rows carrying `window_closes_at` **before** the gate (ungated ⇒ every row) | 20,318 |
| rows carrying `window_closes_at` **after** the gate | **1,245** |
| rows that are genuinely `is_public_hearing` | **1,245** |
| **defect** — window on a non-hearing | **0** |
| **defect** — hearing missing its window | **0** |
| **defect** — `occurred_at` ≠ `meeting_date` | **0** |
| ZIP pages that lost every comment-window pill | 3,289 |
| ZIP pages retaining at least one pill | 665 |
| rows with NULL `occurred_at` (order regression) | **0** |
| rows dated in the past (order regression) | **0** |

`1,245 = 1,245` is the whole finding: the pill is now carried by precisely the public
hearings. The 3,289 pages that lost every pill lost pills that were **never correct** — a
comment window was previously asserted on every meeting, including routine business.

### Positive control — ZIP 18042: PASS

Eight W2 rows; exactly one carries a pill:

| date | pill | title | `is_public_hearing` |
|---|---|---|---|
| 2026-11-06 | — | Board of Elections – Mail-In/Absentee Ballot Challenge | false |
| 2026-11-11 | — | Prison Oversight Board | false |
| **2026-11-12** | **2026-11-12** | **Board of Elections – Provisional Ballot Challenge Hearing** | **true** |
| 2026-11-16 | — | Board of Elections – First Signing of the Returns | false |
| 2026-11-18 | — | Retirement Board Meeting | false |
| 2026-11-18 | — | 3rd Wednesday County Commissioners' Meeting | false |
| 2026-12-02 | — | 1st Wednesday County Commissioners' Meeting | false |
| 2026-12-02 | — | Salary Board Meeting | false |

Exactly as specified: the pill on the 2026-11-12 Provisional Ballot Challenge Hearing, and
on nothing else.

## W3 — Government Notices

70,260 displayed rows across 5,293 ZIP pages (7,429 canonical ZIPs carry no W3 row;
5,293 + 7,429 = 12,722 ✓).

| measure | value |
|---|---:|
| rows whose displayed date **moved** vs the old `a.created_at::date` | **67,742** (96.4%) |
| … moved **earlier** | 46,387 |
| … moved **later** | 21,355 |
| unchanged | 2,518 |
| ZIP pages with at least one move | 5,256 of 5,293 |
| shift **p50** | **76 days** |
| shift **p90** | **330 days** |
| shift **max** | 5,921 days |

### Age distribution of displayed rows — before vs after

| bucket | before | after |
|---|---:|---:|
| future | **0** | **7,098** |
| today | 79 | 476 |
| 1–7 days | 12,231 | 11,904 |
| 8–30 days | **57,950** | 12,272 |
| 31–90 days | 0 | 8,778 |
| 91–365 days | 0 | 24,042 |
| 1–3 years | 0 | 3,837 |
| over 3 years | 0 | 1,853 |
| **total** | **70,260** | **70,260** |

**This is the defect and its repair in one table.** Before, 70,181 of 70,260 rows sat in the
1–30 day bands — because `created_at` is *when HomeSignal ingested the notice*, not when the
government published it, so every notice looked days old whatever its real date. After, the
dates spread across the range the underlying notices actually occupy.

### Residual defect test

Recomputing the installed expression and comparing against what is stored:

| measure | value |
|---|---:|
| rows checked | 70,260 |
| **agree with the installed expression** | **70,260** |
| **residual defect rows** | **0** |
| residual defect ZIP pages | **0** |
| stored dates outside the `[2000-01-01, now+2y)` bound | **0** |

### Legitimate exceptions

- **117 rows** carry a `published_at` outside the bound and correctly fell back to
  `created_at::date`. That is the fallback doing its job, not a defect.
- **0 rows** have a NULL `published_at`.

### Two properties inside the installed semantics — flagged for a ruling, not defects

Both satisfy the bound as installed, so neither is a residual defect. Both are behaviour
changes a founder may wish to rule on:

- **7,098 future-dated rows on 1,801 ZIP pages** (0 before). Future dates are legitimate for
  government notices — an agenda published ahead of its meeting — and the bound permits up to
  `now + 2 years`. **472 rows are more than a year out**, newest **2028-01-25**.
- **1,853 rows older than three years on 254 ZIP pages**, oldest **2010-06-08** (that is the
  5,921-day maximum shift). Inside the `>= 2000-01-01` bound by design.

### Comparison to the original scheduled expectation

The scheduled check-in asked for direction, shift percentiles, before/after age distribution,
future-dated counts and zero-row pages. All are supplied above at full-set scale. It did not
state an expected numeric outcome, so nothing is scored against a prediction; the substantive
expectation — that the corrections remain effective after full propagation — **holds**, with
0 residual defects on both writers.

`zip_pages_zero_displayed_rows_any_category` = **2,446**.

## Scope

`OUT-OF-SCOPE — OTHER WORKSTREAM`: site `main` moved `50575348…` → `36b5ebee…` during this
window, and seven projects/markers migrations landed on 2026-09-03 between 19:45 and 20:46.
Noted for concurrency attribution only. **Not investigated, not re-proven, not modified** —
the scoped gate exists precisely so that work cannot block this measurement.
