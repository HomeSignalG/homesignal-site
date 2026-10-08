# Austin issued construction permits — one registry publisher (2026-09-27)

This classifies `austin-issued-construction-permits` only. The other registry entries were not reclassified, including the other City of Austin entries. The audit verdict remains **NOT YET**. A paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `61783fb0f3bfbff9f7ccc403ffa8a87bceb071b6`.

## Decision

| Registry id | Dataset | Publisher status | Paid property report |
|---|---|---|---|
| `austin-issued-construction-permits` | `data.austintexas.gov` `3syk-w9eu` | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **HOLD** |

Publisher rights are not cleared. Paid property-report use remains **HOLD**.

## Registry entry on this SHA

From `supabase/functions/get-address-report/jurisdiction-registry.json`:

- `registry_id`: `austin-issued-construction-permits`
- `platform`: `socrata`
- `domain`: `data.austintexas.gov`
- `dataset_id`: `3syk-w9eu`
- `dataset_url`: `https://data.austintexas.gov/Building-and-Development/Issued-Construction-Permits/3syk-w9eu`
- `jurisdiction`: City of Austin
- `coverage`: state `TX`, county `Travis`
- Git stores column maps, status buckets, `zip_mode` `false`, and a `_receipts` note that ZIP mode is reserved for a later property page. The entry has no license, terms, or attribution field. `zip_mode: false` is a wiring flag. It is not a redistribution grant.

## Publisher identity

View metadata fetched 2026-09-27 from `https://data.austintexas.gov/api/views/3syk-w9eu.json`:

- name: Issued Construction Permits
- attribution: "City of Austin, Texas - data.austintexas.gov"
- owner display name: "Austin Development Services Owners"
- department in the custom metadata: Austin Development Services
- `license.name`: "Public Domain U.S. Government"
- `licenseId`: `USGOV_WORKS`
- `license.termsLink`: `https://www.usa.gov/government-works`
- provenance: official

The description links to the City of Austin Open Data Terms of Use and then states an Austin Development Services disclaimer.

## What those terms say

The terms page `https://data.austintexas.gov/stories/s/ranj-cccq` is the story "City of Austin Open Data Terms of Use." Its story JSON was fetched the same day (`updatedAt` 2026-03-11). Quoted from that story:

- "Data available through the City of Austin Open Data Portal are offered free and without restriction."
- "Data and content created by City of Austin government employees within the scope of their employment are not subject to copyright protection. Unless otherwise noted in metadata, datasets available on the City of Austin Open Data Portal are in the public domain, which means you may link to the City of Austin Open Data Portal at no cost."
- "We ask that proper credit be given when using content, data, documentation, code, and related materials from the City of Austin Open Data Portal ... Please provide attribution to both the City of Austin and the City Department that is the source of the cited data."
- "Data accessed through the City of Austin Open Data Portal do not, and should not, include controls over its end use."
- "The City may require the termination of any and all displays, distribution, or other use of any or all of the data for any reason."
- "This Data Policy is intended only to improve the internal management of information controlled by the City and it is not intended to, and does not, create any right or benefit, substantive or procedural, enforceable at law or in equity, by a party against the City of Austin, its Departments, Agencies, or other entities, its officers, employees, or agents."

The dataset description, fetched with the view metadata, adds: "The data provided are for informational use only and may differ from official department data." It also says Austin Development Services "does not assume any liability for any decision made or action taken or not taken by the recipient in reliance upon any information or data provided."

`https://www.usa.gov/government-works` redirects to `https://www.usa.gov/government-copyright`. That page, fetched the same day, says: "Government work is something created by a U.S. government officer or employee as part of their official duties." It is about federal materials.

The terms incorporate the City of Austin Privacy Notice at `https://www.austintexas.gov/privacy-notice`. That URL returned a page shell. The notice text is loaded by a third-party script and was not in the HTML, so it was not used as a grant.

## Why this stays HOLD

The portal story contains a sentence that the data are offered free and without restriction, and a sentence that portal data should not include controls over end use. The same story says the policy creates no enforceable right against the City, and that the City may require any display, distribution, or other use to stop for any reason. A paid report cannot treat that pair of sentences as a stable grant.

The public-domain sentence's stated consequence is that a user may link to the portal at no cost. The dataset metadata does note a license: `USGOV_WORKS`, "Public Domain U.S. Government," pointing at the USA.gov page. That page describes works of U.S. government officers and employees. This view is City of Austin data, attributed to the City and owned by Austin Development Services. The federal page is not this publisher's commercial redistribution grant.

The view description says the rows are for informational use only. That is a dataset-specific disclaimer on the same record the registry uses. It is not a sentence that permits copying, republication, or resale.

Attribution is requested to the City of Austin and the source department. A request for credit, with the department named Austin Development Services in the view metadata, is not a clearance while the grant itself is not established.

This is not the New York rule. Local Law 11 of 2012 says New York public data sets are available without restrictions on use. Austin's story does not stop at "without restriction." It adds the termination power and the no-enforceable-right sentence, and this view's license field points at a federal-works page.

The other Austin registry entries were not opened. A portal story is not their classification.

## Paid property-report eligibility

`austin-issued-construction-permits` stays **HOLD** inside a paid property-proximity report. The publisher record is not cleared.

The separate global blockers also remain:

- `get-address-report` still attaches `"Not for resale"`, and Git still has no reason for that sentence.
- A pin, a distance, or "near this property" still depends on the Census geocoder or OpenAddresses and a ZCTA test. Those inputs stay **HOLD**.

## Scope of this file

`austin-issued-construction-permits` is **HOLD — TERMS/RIGHTS NOT ESTABLISHED**. The other registry entries were not reclassified. The overall verdict remains **NOT YET**. Nothing in this file is **CLEARED FOR PAID REPORT**. The paid Future Surroundings Report was not started.
