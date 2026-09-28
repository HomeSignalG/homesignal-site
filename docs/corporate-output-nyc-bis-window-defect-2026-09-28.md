# DOB Permit Issuance was on the allowlist and contributing nothing

Date: 2026-09-28
Branch: `cursor/nyc-pilot-geography-rights-dbc1`
Dataset: `ipu4-2q9a`, DOB Permit Issuance, `data.cityofnewyork.us`
Classification: unchanged — **CLEARED WITH ATTRIBUTION** under Local Law 11 of 2012, Admin Code § 23-502(d)

This is not a rights finding. `ipu4-2q9a` was already cleared and already on the NYC V1
allowlist. This is a defect record: the view was being queried in a way that guaranteed
it contributed zero rows to the sold artifact, so the report was quietly thinner than the
allowlist it claims.

## What was wrong

Every nearby row is filtered client-side to the report's recency window:

```
if (!withinDays(r.issuance_date, 365)) return null;
```

The SODA query behind it asked for 200 rows with no `$order`:

```
$where=permit_type in('NB','DM','AL','FO') AND gis_latitude is not null
       AND gis_longitude is not null AND zip_code in(...)
$limit=200
```

The ZIP group around 1 Centre Street has 10,379 matching rows. An unordered SODA window
returns the publisher's oldest rows first, so the 200 rows fetched spanned **1990 to 2022**.
The 365-day filter then dropped all 200. The dataset was named in `data_state.datasets`,
credited in `attribution`, and listed nothing.

The other two record views were never affected, because both already ordered by date
descending: `rbx6-tga4` on `issued_date DESC`, `w9ak-ipjd` on `filing_date DESC`.

## Measured, against the live portal

Same address, same ZIP group, same 0.5 mi radius, same client-side filter:

| | rows fetched | year span of the window | rows listed in the report |
|---|---|---|---|
| Before | 200 | 1990–2022 | **0** |
| After | 161 | 2025–2026 | **55** |

161 NB/DM/AL/FO permits with publisher coordinates were issued in those ZIPs inside the
window. The report was listing none of them.

End to end at 1 Centre Street, 10007, 0.5 mi, the stage histogram moved from
`{"Permit approved":33,"Filed":17}` to `{"Permit approved":30,"Permit issued":7,"Filed":13}`,
and `nearby_matched` moved from 265 to 325.

## Why the date column needed care

On `ipu4-2q9a`, `filing_date`, `issuance_date`, and `expiration_date` are all `text`, not
`calendar_date`. The stored values mix formats — `12/16/2020` and `2004-03-02` both occur —
so a lexical sort on the raw column is meaningless, and `date_extract_y(issuance_date)`
is rejected:

```
HTTP 400 query.soql.type-mismatch; Type mismatch for date_extract_y, is text
```

Reading the column as a timestamp is accepted in both `$where` and `$order`:

```
issuance_date is not null
AND issuance_date::floating_timestamp >= '<window floor>'
$order=issuance_date::floating_timestamp DESC
```

Verified against a 20-ZIP group, the largest the client builds: 932 rows, HTTP 200.

`dobrundate` is the only real `calendar_date` on the view, but it is the DOB extract run
date, not the date the permit was issued. It was not used for the window.

## What changed

- `RECENT_DAYS = 365` is now one named constant, shared by the row filter and by every
  record query, in both the browser library and the edge function. The query window and
  the filter window can no longer drift apart.
- All three record queries are floored to that window and ordered newest first.
- The per-dataset row cap is `ROW_CAP = 200`, named once instead of repeated per query.
- `data_state.window_days` and `data_state.row_cap_per_dataset` are on the report, so the
  window is disclosed rather than implied.
- Each record view's `attribution.modifications` now states the recency filter, which is a
  modification of the publisher's data and so is named under § 23-502(d). The `ipu4-2q9a`
  entry also states that its date column is text and how it was read.
- The page states: *Records dated in the last 365 days. Each dataset is read 200 rows at a
  time, newest first, so this count is a floor and not a census of the radius.* The row cap
  means `nearby_matched` is a floor, and the report no longer implies otherwise.
- The page normalizes the displayed date only. `nearby[].date` still carries the
  publisher's string verbatim.

## Pinned

`test/nyc-v1-report.test.mjs` 6a–6o. The regression itself is pinned by 6c and 6d, which
stub `fetch` and assert the real query text carries the floor and the ordering, and by 6i,
which asserts every record query asks for the window. 6m–6o assert the edge function
applies the same floor, order, and cap as the browser.

## What did not change

No dataset was added or removed. No classification moved. No family became
CLEARED FOR PAID REPORT. `signed_paid_pilots` is 0 and the commercial verdict is
**NOT YET**.
