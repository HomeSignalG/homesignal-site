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

## Why not the existing repo convention

This repo already hit this class of defect on this exact column on 2026-08-02, in the
`get-address-report` socrata connector, and adopted a different instrument: a `recency_expr`
that rebuilds a sortable key out of `substring` calls
(`docs/source-registry.md`, `test/socrata-text-date-recency.test.ts`). That expression is
live in `supabase/functions/get-address-report/jurisdiction-registry.json` for
`nyc-dob-permit-issuance`:

```
(substring(issuance_date,7,4)||substring(issuance_date,1,2)||substring(issuance_date,4,2)) >= '{cutoff_compact}'
```

It was not reused here, because it assumes the column holds one format and the column no
longer does. Measured on NB/DM/AL/FO, whole view:

| | rows | admitted by `substring` | admitted by the cast | actually in the window |
|---|---|---|---|---|
| `MM/DD/YYYY` | 734,132 | 2,736 | 2,736 | 2,736 |
| `YYYY-MM-DD…` | 17,237 | **12,621** | 0 | **0** |
| neither pattern | 0 | — | — | — |

On the `MM/DD/YYYY` rows the two agree exactly. On the 17,237 ISO-formatted rows the
substring positions land in the wrong place and produce a key that usually sorts *above* the
cutoff, so stale rows are admitted as recent:

```
'1994-06-10' -> substring key '6-10194-'   '6-10194-' >= '20250928' -> true
'2004-09-21' -> substring key '9-21204-'   '9-21204-' >= '20250928' -> true
'2005-12-30' -> substring key '2-30205-'   '2-30205-' >= '20250928' -> false
```

Not one of those 17,237 rows is genuinely dated inside the window. The cast admits none of
them and fails on none of them: of 751,369 non-null values, the number that are text but
null once cast is **0**. It reads both formats and invents nothing.

So the two surfaces are wrong in opposite directions. This report was silently
*under*-including — 0 of 161. The `get-address-report` registry entry is silently
*over*-including 12,621 permits from 1993–2006 as recent.

That second finding is recorded here and is **not** fixed here. `get-address-report` is
**EXCLUDE** from the sold report and its output is not part of this allowlist, so changing
its window would be an uninstructed change to a consumer surface. It is written down beside
the audit rather than routed around, and the call on it belongs to the founder.

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
