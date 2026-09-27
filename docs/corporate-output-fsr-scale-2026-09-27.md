# Future Surroundings Report scale — Steps 10–13 (2026-09-27)

This instruments use, adds a listing-level summary, stores a durable portfolio, and publishes a canonical allowlist JSON API. Every surface derives from NYC V1 report objects only. No customer is invented. The audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.

The commercial verdict remains **NOT YET**. `signed_paid_pilots` is **0**.

## What shipped

| Step | Piece | File |
|---|---|---|
| 9 | Coverage-quality matrix | `lib/fsr-scale.js` `coverageMatrix()`, `docs/corporate-output-coverage-matrix-2026-09-27.md` |
| 10 | Use instrumentation | `recordUse` / `usageSummary`; page Usage view |
| 11 | Listing-level summary | `listingSummary(report)` |
| 12 | Portfolio | localStorage `hs_nyc_v1_portfolio` |
| 13 | Canonical JSON API | `supabase/functions/get-future-surroundings-report/` |

`reports.html` remains the Premium waitlist. `get-address-report` is unchanged and is not this API.

## Step 10 — instrument report use

The close condition asked for 3–5 signed paid single-property pilots and instrumentation of actual report use.

Signed paid pilots are **0**. This file does not invent customers, invoices, or brokerage accounts.

What did ship: a local usage log. Kinds recorded on the NYC V1 page are `build`, `print`, `share`, `json`, `listing`, and `portfolio_add`. The summary always reports `signed_paid_pilots: 0` and `verdict: NOT YET`.

Step 10 is **closed for instrumentation** and **open for signed customers**. The overall verdict cannot move off **NOT YET** until a customer is actually sold an allowlisted artifact (Step 15).

## Step 11 — listing-level summary

`listingSummary` accepts only a `version: nyc-v1` Future Surroundings Report. It counts nearby rows by type and source, names the nearest allowlisted row, and repeats the same attribution, exclusions, and investigation sentence. It does not score the listing. It does not write outlooks, Quality of Life, `sowhat`, or "Effect at this address."

An AddressPoint miss produces a listing with `nearby_count: 0` and no pin.

## Step 12 — portfolio

The portfolio stores up to 25 NYC V1 report objects in this browser (`localStorage`, not the session-only recent list). Add and remove are keyed by `report_id`. The summary counts unique AddressPoint ids, ok/miss reports, and nearby totals. The only market key is `nyc-v1`.

A rejected object (wrong product, wrong version, or a `get-address-report` payload) is not stored.

## Step 13 — canonical allowlist JSON API

`get-future-surroundings-report` is a new function. It is not a wrapper around `get-address-report` or `geocode-address`.

| Method | Result |
|---|---|
| GET | Capability document: host `data.cityofnewyork.us`, views `uf93-f8nk`, `ipu4-2q9a`, `rbx6-tga4`, `signed_paid_pilots: 0` |
| POST `{ address, zip, radius_mi }` | The same NYC V1 report object the page assembles |

Rejected request fields include `lat`, `lng`, `geocode`, `census`, `openaddresses`, `arcgis`, `osm`, `score`, `outlook`, `sowhat`, and `impact`. A `market` other than `nyc` / `nyc-v1` is rejected. The function fetches only those three views. ArcGIS, Census, Geoclient, and OpenAddresses URLs are forbidden.

JWT verification stays on for this function. It is not added to the `get-address-report` `--no-verify-jwt` exception.

## Still not sold

No price. No paywall. No signed pilot. Steps 14 and 15 remain standing rules: do not sell on HOLD/EXCLUDE inputs, and keep **NOT YET** until a customer is sold an allowlisted artifact.
