# Seattle land use permits — one registry publisher (2026-09-27)

This classifies `seattle-land-use-permits` only. `seattle-building-permits` stays where #1416 left it. The other registry entries were not reclassified. The audit verdict remains **NOT YET**. A paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `dcc6ba9b121342046b41cfef6cd31e6eec600d95`.

Canonical audit blob `docs/corporate-output-source-rights-audit-2026-09-27.md` is `c2cc94524ee2d21af47520254703d4a222344c66` on this SHA.

## Decision

| Registry id | Dataset | Publisher status | Paid property report |
|---|---|---|---|
| `seattle-land-use-permits` | `data.seattle.gov` `ht3q-kdvx` | **CLEARED WITH ATTRIBUTION** | **HOLD** |

Publisher rights are cleared with attribution. Paid property-report use remains **HOLD**. This is not **CLEARED FOR PAID REPORT**.

## Registry entry on this SHA

From `supabase/functions/get-address-report/jurisdiction-registry.json`:

- `registry_id`: `seattle-land-use-permits`
- `platform`: `socrata`
- `domain`: `data.seattle.gov`
- `dataset_id`: `ht3q-kdvx`
- `dataset_url`: `https://data.seattle.gov/Permitting/Land-Use-Permits/ht3q-kdvx`
- `jurisdiction`: City of Seattle
- `coverage`: state `WA`, county `King`
- Git stores column maps, status buckets, `type_map`, `incremental_field` `applieddate`, `recency_days` `365`, and a wiring `_receipts` note. The entry has no `extra_where` and no license field. The `_receipts` note says this view succeeded the dead id `uyyd-8gak`. That dead id is not classified here.

## Publisher identity

View metadata fetched 2026-09-27 from `https://data.seattle.gov/api/views/ht3q-kdvx.json`:

- name: Land Use Permits
- description: "Land Use permits that are in progress or that have been issued in Seattle."
- attribution: City of Seattle
- attribution link: `http://www.seattle.gov/sdci`
- department: Seattle Department of Construction & Inspections
- publisher in the custom metadata: `data.seattle.gov`
- contact: `open.data@seattle.gov`
- category: Built Environment
- provenance: official
- `rowsUpdatedAt`: 2026-09-27T00:26:19Z
- `license.name`: "Public Domain"
- `licenseId`: `PUBLIC_DOMAIN`
- the license object has no `termsLink`

The Socrata label is the city's selected license name. The grant used here is the city's own policy and the portal terms, not the platform enum by itself.

## Terms that govern this view

Open Data Policy V1.0, February 1, 2016, PDF `https://www.seattle.gov/Documents/Departments/SeattleGovPortals/CityServices/OpenDataPolicyV1.pdf`, fetched 2026-09-27. The policy defines the Open Data Portal as Data.seattle.gov. Quoted:

- "Datasets on the Open Data Portal shall be made available without registration requirement, license requirement or restrictions on their use provided that the department may require a third party providing to the public any public data set, or application utilizing such data set, to explicitly identify the source and version of the public data set, and a description of any modifications made to such public data set."
- "An open license on a dataset signifies there are no restrictions on copying, publishing, further distributing, modifying or using the data for a noncommercial or commercial purpose."
- The privacy-harm sentence is about deciding which data elements to release. It is not a downstream ban. The mitigation sentence in the same policy is an annual program review, not a right to stop any display for any reason.

Portal terms, story "Seattle Open Data Terms of Use," `https://data.seattle.gov/stories/s/Data-Policy/6ukr-wvup`, story JSON fetched the same day (`updatedAt` 2024-03-07). Quoted:

- "By using data made available through this site the user agrees to all the conditions stated in the following paragraphs."
- "To the extent the data consists of a list of individuals or can be readily sorted, filtered, or configured as a list of individuals, it is not to be used for a commercial purpose."
- "Unless otherwise indicated, data on this site does not require specific attribution."
- "The City of Seattle reserves the right to discontinue providing any or all datasets and associated data products, visualizations, etc. at any time without prior notice."
- The accuracy paragraph is a warranty disclaimer. The privacy paragraph says new datasets are reviewed before publication on `data.seattle.gov`. It does not add a redistribution rule.

`https://seattle.gov/tech/data-privacy/privacy-statement` is the website privacy statement linked from those terms. It is about personal information collected when someone communicates with the City. It does not add a redistribution rule for this view.

## Analysis

This view is on `data.seattle.gov`, provenance official, published for the Seattle Department of Construction & Inspections. The policy's portal definition and the portal terms both reach it. The view description does not add a use limit. The license field marks the view Public Domain and does not point at a different instrument. The building-permits clearance is not this view's license. The same policy covers this view because this view is on the portal the policy names.

The policy states commercial copying, publication, further distribution, and modification with no use restriction, and it allows the department to require source, version, and a description of modifications. This view indicates the source as the City of Seattle and SDCI. HomeSignal's `column_map` selects and renames permit type, description, status, permit class, dates, address, coordinates, permit number, ZIP, and record link. That selection is a modification and has to be described with the records, together with dataset `ht3q-kdvx` and the version retrieved. There is no `extra_where` on this entry.

The portal terms add one commercial limit: to the extent the data is a list of individuals, or can be configured as one, it is not for a commercial purpose. The published columns include `contractorcompanyname` ("The contractor(s) associated with this permit"). That field can carry the limited extent. The registry map does not select it. The limit is a ban on using the rows as a commercial list of people. It does not withdraw the commercial grant for the land-use permit records.

The right to discontinue providing a dataset is a right to stop publishing it. It is not a general downstream takedown.

`seattle-land-use-permits` is **CLEARED WITH ATTRIBUTION** as a publisher dataset.

## Paid property-report eligibility

The publisher coordinates on this view, when `latitude` and `longitude` are present, are part of that publisher clearance. A paid claim that one of these permits is near a property still needs the customer's property coordinate. That coordinate is the Census geocoder, which stays **HOLD — TERMS/RIGHTS NOT ESTABLISHED**. OpenAddresses stays **HOLD** on the fallback ladder. ZCTA membership stays **HOLD** as a pin, a distance, or "near this property."

This dataset stays **HOLD** inside a paid property-proximity report.

## Scope of this file

`seattle-land-use-permits` is **CLEARED WITH ATTRIBUTION** as a publisher dataset and **HOLD** for a paid property report. `seattle-building-permits` was not reclassified. The other registry entries were not reclassified. The overall verdict remains **NOT YET**. Nothing in this file is **CLEARED FOR PAID REPORT**. The paid Future Surroundings Report was not started. The canonical audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.
