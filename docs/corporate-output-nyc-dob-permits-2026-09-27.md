# NYC DOB permit datasets — one registry publisher (2026-09-27)

This classifies two entries in `jurisdiction-registry.json`. It does not classify the other 238. The audit verdict stays **NOT YET**. A paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `33884f7a423d2d758c42302e00631243df13cdc8`.

## Decision

| Registry id | Dataset | Publisher status | Paid property report |
|---|---|---|---|
| `nyc-dob-permit-issuance` | `data.cityofnewyork.us` `ipu4-2q9a` | **CLEARED WITH ATTRIBUTION** | **HOLD** |
| `nyc-dobnow-approved-permits` | `data.cityofnewyork.us` `rbx6-tga4` | **CLEARED WITH ATTRIBUTION** | **HOLD** |

The publisher grant is the City's. The paid-report hold is HomeSignal's other blockers, not a second reading of the City's statute.

## What was fetched

View metadata, 2026-09-27:

- `https://data.cityofnewyork.us/api/views/ipu4-2q9a.json` — name "DOB Permit Issuance", attribution "Department of Buildings (DOB)", category Housing & Development. No `license` or `licenseId` field. The word "license" in that JSON is a permittee-license column, not a dataset license.
- `https://data.cityofnewyork.us/api/views/rbx6-tga4.json` — name "DOB NOW: Build – Approved Permits", same agency attribution, same absence of a license field.

The City's current Open Data page, `https://www.nyc.gov/opendata/get-started/what-is-open-data-`, says open data is the law, that the government has been open by default since 7 March 2012, and that later amendments expanded access. Its payload records `modifyDate` 2026-07-24. It links the current code at `https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-216807`. That code page returned HTTP 403 on this fetch, so the quoted sections below are the enacted text of Local Law 11 of 2012, `https://intro.nyc/local-laws/2012-11`, not a line from a later amendment.

`https://www.nyc.gov/main/terms-of-use` was fetched the same day. It is the NYC.gov website notice, including a DMCA process for material posted on NYC.gov. It is not the open-data statute. It is not applied to these two datasets.

## The statute

Local Law 11 of 2012, Administrative Code § 23-502(d):

"Such public data sets shall be made available without any registration requirement, license requirement or restrictions on their use provided that the department may require a third party providing to the public any public data set, or application utilizing such data set, to explicitly identify the source and version of the public data set, and a description of any modifications made to such public data set."

§ 23-501(g) defines a public data set as data available for public inspection and maintained by or for an agency, and then excludes, among other things, portions that may be withheld under the public officers law or other law, deliberative material, and "materials subject to copyright, patent, trademark, confidentiality agreements or trade secret protection."

§ 23-504(a): public data sets on the portal "are provided for informational purposes." The City does not warrant completeness, accuracy, content, or fitness for any particular purpose. That sentence sits beside § 23-502(d)'s rule of no restrictions on use. It is a warranty disclaimer. It is not read here as a commercial ban.

## What attribution requires

A third party that gives the public these records, or an application that uses them, identifies:

- the source: New York City Department of Buildings, on NYC Open Data
- the dataset and version: `ipu4-2q9a` or `rbx6-tga4`, and the version actually retrieved
- modifications: HomeSignal's `column_map` for `nyc-dob-permit-issuance` renames and selects `permit_type`, `street_name`, `permit_status`, `issuance_date`, `house__`, `gis_latitude`, `gis_longitude`, `job__`, and `zip_code`. That selection is a modification and has to be described with the records.

## What stays HOLD

These two datasets still do not enter a paid property report.

- They reach customers through `get-address-report`. That success payload still carries `"Not for resale"`, and that sentence still has no reason in Git. The publisher grant does not erase HomeSignal's own note.
- A pin, a distance, or "near this property" still uses the Census geocoder or OpenAddresses and a ZCTA test. Those inputs stay **HOLD** under the earlier evidence pass.
- The other 238 registry entries are not this statute. Austin, Seattle, Chicago, and the ArcGIS counties stay **HOLD**. One city's open-data law is not their license.

Rows that the statute excludes from "public data set" — withheld fields, copyrighted attachments, trade secrets — are not in this clearance. The clearance is the tabular public data set the City published at those two view ids.
