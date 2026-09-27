# Seattle building permits — one registry publisher (2026-09-27)

This classifies `seattle-building-permits` only. The other registry entries were not reclassified, including `seattle-land-use-permits`. The audit verdict remains **NOT YET**. A paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `5c084409947f87082330daf84ba6580d12195b03`.

Canonical audit blob `docs/corporate-output-source-rights-audit-2026-09-27.md` is `c2cc94524ee2d21af47520254703d4a222344c66` on this SHA.

## Decision

| Registry id | Dataset | Publisher status | Paid property report |
|---|---|---|---|
| `seattle-building-permits` | `data.seattle.gov` `76t5-zqzr` | **CLEARED WITH ATTRIBUTION** | **HOLD** |

Publisher rights are cleared with attribution. Paid property-report use remains **HOLD**. This is not **CLEARED FOR PAID REPORT**.

## Registry entry on this SHA

From `supabase/functions/get-address-report/jurisdiction-registry.json`:

- `registry_id`: `seattle-building-permits`
- `platform`: `socrata`
- `domain`: `data.seattle.gov`
- `dataset_id`: `76t5-zqzr`
- `dataset_url`: `https://data.seattle.gov/Built-Environment/Building-Permits/76t5-zqzr`
- `jurisdiction`: City of Seattle
- `coverage`: state `WA`, county `King`
- Git stores column maps, status buckets, `extra_where` `permittypemapped in ('Building','Demolition','Grading')`, `recency_days` `365`, and a wiring `_receipts` note. The entry has no license field. `extra_where` is a row filter. It is not a redistribution grant.

## Publisher identity

View metadata fetched 2026-09-27 from `https://data.seattle.gov/api/views/76t5-zqzr.json`:

- name: Building Permits
- description: "All building permits issued or in progress within the city of Seattle."
- attribution: City of Seattle
- attribution link: `http://www.seattle.gov/sdci`
- department: Seattle Department of Construction & Inspections
- publisher in the custom metadata: `data.seattle.gov`
- contact: `open.data@seattle.gov`
- provenance: official
- `license.name`: "Public Domain"
- `licenseId`: `PUBLIC_DOMAIN`
- the license object has no `termsLink`

The Socrata label is the city's selected license name. The grant used here is the city's own policy and the portal terms, not the platform enum by itself.

## What the city says

Portal terms, story "Seattle Open Data Terms of Use," `https://data.seattle.gov/stories/s/Data-Policy/6ukr-wvup`, story JSON fetched the same day (`updatedAt` 2024-03-07). The portal home links to that story. Quoted:

- "By using data made available through this site the user agrees to all the conditions stated in the following paragraphs."
- "To the extent the data consists of a list of individuals or can be readily sorted, filtered, or configured as a list of individuals, it is not to be used for a commercial purpose."
- The City "makes no claims as to the completeness, accuracy, timeliness, or content" and disclaims warranty and fitness for a particular use. "The data contained in the site is used at one's own risk."
- "Unless otherwise indicated, data on this site does not require specific attribution."
- "The City of Seattle reserves the right to discontinue providing any or all datasets and associated data products, visualizations, etc. at any time without prior notice."
- The story points to the Open Data Policy PDF.

Open Data Policy V1.0, February 1, 2016, fetched the same day from `https://www.seattle.gov/Documents/Departments/SeattleGovPortals/CityServices/OpenDataPolicyV1.pdf`. It defines the Open Data Portal as `Data.seattle.gov`. Quoted:

- "Datasets on the Open Data Portal shall be made available without registration requirement, license requirement or restrictions on their use provided that the department may require a third party providing to the public any public data set, or application utilizing such data set, to explicitly identify the source and version of the public data set, and a description of any modifications made to such public data set."
- "An open license on a dataset signifies there are no restrictions on copying, publishing, further distributing, modifying or using the data for a noncommercial or commercial purpose."
- If the program finds data "being used in ways that violate privacy, puts the public at risk, or contravene the Program’s goals," the City may "take any action necessary to mitigate these risks."

`https://seattle.gov/tech/data-privacy/privacy-statement` is a website privacy statement about personal information collected when someone communicates with the City. It does not add a redistribution rule for this view.

## Publisher-data rights

This view is on `data.seattle.gov`, provenance official, published for the Seattle Department of Construction & Inspections. The policy's portal definition and the portal terms both reach it. The view description does not add a use limit. The license field marks the view Public Domain and does not point at a different instrument.

The policy states commercial copying, publication, further distribution, and modification with no use restriction, and it allows the department to require source, version, and a description of modifications. This view indicates the source as the City of Seattle and SDCI. HomeSignal's `column_map` selects and renames permit class, description, status, dates, address, coordinates, permit number, ZIP, and record link, and `extra_where` drops other permit types. That selection is a modification and has to be described with the records, together with dataset `76t5-zqzr` and the version retrieved.

The portal terms add one commercial limit: to the extent the data is a list of individuals, or can be configured as one, it is not for a commercial purpose. The published columns include `contractorcompanyname` ("The contractor(s) associated with this permit"). That field can carry the limited extent. The registry map does not select it. The limit is a ban on using the rows as a commercial list of people. It does not withdraw the commercial grant for the permit records.

The warranty disclaimer is an accuracy disclaimer. The right to discontinue providing a dataset is a right to stop publishing it. The mitigation sentence is tied to privacy harm, public risk, or the program's goals. None of those sentences is a general ban on redistribution.

`seattle-building-permits` is **CLEARED WITH ATTRIBUTION** as a publisher dataset.

## Paid property-report eligibility

This dataset stays **HOLD** inside a paid property-proximity report.

- It would reach customers through `get-address-report`. That success payload still carries `"Not for resale"`, and that sentence still has no reason in Git. The publisher grant does not erase HomeSignal's own note.
- A pin, a distance, or "near this property" still uses the Census geocoder or OpenAddresses and a ZCTA test. Those inputs stay **HOLD**.

## Scope of this file

`seattle-building-permits` is **CLEARED WITH ATTRIBUTION** as a publisher dataset and **HOLD** for a paid property report. The other registry entries were not reclassified. The overall verdict remains **NOT YET**. Nothing in this file is **CLEARED FOR PAID REPORT**. The paid Future Surroundings Report was not started. The canonical audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.
