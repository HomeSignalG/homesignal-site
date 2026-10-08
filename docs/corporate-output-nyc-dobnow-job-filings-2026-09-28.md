# NYC DOB NOW job filings — one registry publisher (2026-09-28)

This classifies `DOB NOW: Build – Job Application Filings`, `data.cityofnewyork.us` `w9ak-ipjd`, and adds it to the New York City V1 allowlist. No other registry entry was reclassified. Cambridge stays **HOLD** (`docs/corporate-output-cambridge-pilot-attempt-2026-09-28.md`). The audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.

The overall verdict remains **NOT YET**. Signed paid pilots remain 0.

## Decision

| Registry id | Dataset | Publisher status | NYC V1 paid use |
|---|---|---|---|
| `nyc-dobnow-job-filings` | `data.cityofnewyork.us` `w9ak-ipjd` | **CLEARED WITH ATTRIBUTION** | **APPROVED** when the publisher latitude and longitude are present |

Nothing in this file is **CLEARED FOR PAID REPORT**.

## Why this dataset

The product question includes what is coming next. The two datasets already in the allowlist are both downstream of approval: `ipu4-2q9a` is issued permits and `rbx6-tga4` is approved permits. A job application filing is the earliest public record that work is proposed at an address.

The older BIS filings view `ic3t-wcy2` was measured the same day and rejected: its most recent `latest_action_date` is 2020-05-21, and it has zero rows in 2024 or later. It is not added.

## Publisher identity

View metadata fetched 2026-09-28 from `https://data.cityofnewyork.us/api/views/w9ak-ipjd.json`:

- name: DOB NOW: Build – Job Application Filings
- `assetType`: dataset, `viewType`: tabular
- attribution: Department of Buildings (DOB)
- provenance: official
- category: Housing & Development
- Agency in custom metadata: Department of Buildings (DOB); Update Frequency Daily; Date Made Public 6/28/2016
- no `license` field
- no `licenseId` field
- `rights` is `['read']` — the Socrata public-audience flag, the same flag AddressPoint and the two cleared DOB views carry. It is not a license.

## The statute

This is the same instrument #1410 applied to `ipu4-2q9a` and `rbx6-tga4`, and the AddressPoint assembly applied to `uf93-f8nk`. This view is an official public data set on `data.cityofnewyork.us`, published by a City agency.

Local Law 11 of 2012, Administrative Code § 23-502(d):

"Such public data sets shall be made available without any registration requirement, license requirement or restrictions on their use provided that the department may require a third party providing to the public any public data set, or application utilizing such data set, to explicitly identify the source and version of the public data set, and a description of any modifications made to such public data set."

§ 23-504(a) is a warranty disclaimer, not a commercial ban. `https://www.nyc.gov/main/terms-of-use` is the NYC.gov website notice and was not applied to the DOB views in #1410; it is not applied here.

`w9ak-ipjd` is **CLEARED WITH ATTRIBUTION**.

## What attribution requires

A paid artifact using this view identifies the source as the New York City Department of Buildings, on NYC Open Data; the dataset `w9ak-ipjd` and the version retrieved; and the modifications: selection of `job_type`, `filing_status`, `filing_date`, `house_no`, `street_name`, `latitude`, `longitude`, `job_filing_number`, and `postcode`; retention of New Building and Full Demolition rows with publisher coordinates inside the stated radius; and the drop of rows the publisher marks `Filing Withdrawn`.

## Measured usefulness

Live SODA counts, 2026-09-28:

| Measure | Count |
|---|---|
| Published rows | 962,558 |
| Rows with publisher `latitude` and `longitude` | 957,926 |
| New Building or Full Demolition with coordinates, all time | 63,748 |
| The same, filed in the last 365 days, with `postcode` | 19,356 |
| New Building or Full Demolition with coordinates in ZIPs 10007 / 10013 / 10038, last 365 days | 133 |

Filing statuses present on those rows include Approved, Objections, Permit Entire, Plan Examiner Review, LOC Issued, Full Demolition Signed-off, and Filing Withdrawn. The status is reproduced verbatim on every row.

## Which ZIP field is the job site

The view publishes both `zip` and `postcode`. They are not the same field. `zip` sits beside `applicant_street_name`, `city`, and `state`, and on sampled rows it carries the applicant's ZIP: filing `B00505340-S4` is at 740 Hinsdale Street, Brooklyn, with `zip` 11050, which is Port Washington. `postcode` on sampled rows matches the job location.

The allowlist scopes this view by `postcode`. Using `zip` would scope by the applicant's mailing address and is a defect, not an alternative.

`latitude` and `longitude` on this view are text columns, so a SoQL `between` bounding box returns HTTP 400. The query scopes by the AddressPoint `within_circle` ZIP group, then applies HomeSignal distance arithmetic, which is the same pattern already recorded for `ipu4-2q9a`.

## Withdrawn filings

A row the publisher marks `Filing Withdrawn` is dropped rather than listed as work near the property. That is a suppression of a publisher-resolved record, consistent with the existing decision-history contract (`docs/decision-history-contract-2026-09-20.md`), not a prediction. It is stated in the attribution modifications and in the report's own exclusions. Every other status is listed verbatim with its stage.

## Effect on the NYC V1 allowlist

The allowlist is now four NYC Open Data views: `uf93-f8nk`, `ipu4-2q9a`, `rbx6-tga4`, `w9ak-ipjd`. Each nearby row carries a `stage` of `Permit issued`, `Permit approved`, or `Filed`, so a filing is never presented as an issued permit.

Census geocoder, OpenAddresses, ZCTA proximity, Geoclient, ArcGIS, Atlas, OSM, and every other registry entry stay **HOLD** or **EXCLUDE**. `get-address-report` is still not the allowlist.

## Scope

`nyc-dobnow-job-filings` is **CLEARED WITH ATTRIBUTION** and approved inside the NYC V1 allowlist. The other registry entries were not reclassified. The overall verdict remains **NOT YET**. The report is still not sold.
