# Cambridge, MA — second-market attempt (2026-09-28)

This is a Step 9 attempt to open a second assemblable market. It classifies the City of Cambridge address and building-permit datasets only. No other registry entry was reclassified. The NYC V1 allowlist is unchanged. The audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.

The attempt **fails**. Cambridge is **HOLD — TERMS/RIGHTS NOT ESTABLISHED**.

## Decision

| Object | Dataset | Classification |
|---|---|---|
| Master Addresses List | `data.cambridgema.gov` `vup6-kpwv` | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** |
| Cambridge Address Points | `data.cambridgema.gov` `4ftb-8ne5` | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** |
| Building Permits: New Construction | `9qm7-wbdc` | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** |
| Building Permits: Addition/Alteration | `qu2z-8suj` | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** |
| Demolition Permits | `kcfi-ackv` | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** |

Nothing here is **CLEARED FOR PAID REPORT** or **CLEARED WITH ATTRIBUTION**.

## Why Cambridge was tried

Seattle failed at geography: its address layers on the portal are `federated_href` pointers to ArcGIS, and ArcGIS stays **HOLD** (`docs/corporate-output-coverage-matrix-2026-09-27.md`).

Cambridge does not have that defect. Both address datasets are real Socrata tables with publisher coordinates, and the permit tables carry their own publisher latitude and longitude. On the data alone, Cambridge would be assemblable.

Measured 2026-09-28 from `data.cambridgema.gov`:

| Dataset | `assetType` / `viewType` | Rows | Rows with publisher coordinates |
|---|---|---|---|
| `vup6-kpwv` Master Addresses List | dataset / tabular | 20,874 | 20,874 (`latitude` / `longitude`) |
| `4ftb-8ne5` Cambridge Address Points | dataset / tabular | 21,117 | `the_geom` point column |
| `9qm7-wbdc` New Construction | dataset / tabular | 372 | 372 |
| `qu2z-8suj` Addition/Alteration | dataset / tabular | 14,371 | 14,370 |
| `kcfi-ackv` Demolition | dataset / tabular | 339 | 339 |

`9qm7-wbdc` has 67 permits issued in the last 365 days; `qu2z-8suj` has 1,411 with coordinates. A buyer-supplied `795 Massachusetts Ave` matches `address_id` 581 at `42.3670452741779, -71.10575274251`. A nonsense street returns no row.

## The grant that appeared to exist

Every one of the five views carries a Socrata license object:

- `license.name`: "Open Data Commons Public Domain Dedication and License"
- `licenseId`: `PDDL`
- `license.termsLink`: `http://opendatacommons.org/licenses/pddl/1.0/`

The PDDL text, fetched the same day from `https://opendatacommons.org/licenses/pddl/1.0/`, is a public-domain dedication: "Recipients may use this work commercially ... It is not a requirement that recipients provide further users with a copy of this licence or attribute the original creator."

The City repeats that label on its own website. The GIS data dictionary pages for `ADDRESS_AddressPoints` and `ADDRESS_MasterAddressBlocks`, fetched the same day from `https://www.cambridgema.gov/GIS/gisdatadictionary/Address/...`, both end with:

"License This data is made available under the Public Domain Dedication and License v1.0 whose full text can be found at: https://opendatacommons.org/licenses/pddl/1.0/"

## Why it still fails

The same City publishes an express commercial prohibition. `https://www.cambridgema.gov/disclaimer`, fetched 2026-09-28, is scoped to "All documents, files or data accessible on or through this web site (this term includes, but is not limited to, this page, linked pages and sub pages) of the City of Cambridge, its agencies, departments, boards, commissions and offices," and it opens: "By using this City of Cambridge web site, you agree to accept such conditions and qualifications."

Under the heading **"Commercial Use Prohibited"**:

"This web site and the contents are intended only for the individual, non-commercial use of web site users. No user of this web site may resell, republish, print, download or copy any portion of this web site or the contents for commercial use without the prior written consent of the City of Cambridge, except that reasonable copying or printing of its contents for individual, non-commercial use is permitted."

That sentence bans exactly what a paid Future Surroundings Report does: resell and republish, for commercial use, without prior written consent.

The two statements are not reconciled anywhere the City publishes:

- The GIS data dictionary pages that state PDDL are themselves pages on `www.cambridgema.gov`, the site that disclaimer governs.
- The Open Data Program pages, `https://www.cambridgema.gov/departments/opendata` and `.../opendata/policyplanning`, were fetched the same day. Neither contains the words license, PDDL, public domain, commercial, restriction, copyright, or attribution. There is no portal terms-of-use story and no open-data policy document that resolves the conflict.
- `https://data.cambridgema.gov/terms` returns HTTP 404. The data portal's only City link is back to `www.cambridgema.gov/departments/opendata`, which the disclaimer governs.
- The GIS dictionary covers `ADDRESS_AddressPoints` and `ADDRESS_MasterAddressBlocks`. There is no dictionary page for the Master Addresses List `vup6-kpwv`, and the permit tables are Inspectional Services records, not GIS layers, so for those four datasets the PDDL claim rests on the Socrata license field alone.

This is the Austin pattern, not the Seattle pattern. Austin also published a "free and without restriction" sentence and still stayed **HOLD** because a second City sentence pulled the grant back (`docs/corporate-output-austin-issued-permits-2026-09-27.md`). Cambridge is stronger against: the conflicting sentence is an express commercial-use prohibition with a written-consent requirement, not a reserved termination power.

New York is the contrast. Local Law 11 of 2012 § 23-502(d) is a statute that says public data sets are available without restrictions on their use, and no NYC page contradicts it.

## What was not done

No Cambridge dataset was loaded, cached, or added to any allowlist. No ArcGIS or GitHub distribution of the same layers was substituted. Prior written consent was not requested, and this file does not assume it would be granted. A grant can only come from a later evidence record.

## Data-quality note, recorded but not determinative

The permit tables publish two coordinate pairs. `latitude` / `longitude` is described in the column metadata as "latitude from OpenGov"; `mal_latitude` / `mal_longitude` is "latitude of the address from the master address list." On recent rows they disagree by miles — `16 Worcester St` carries `42.36662, -71.099192` against a master-address pair of `42.37593, -71.15273`. Any future Cambridge assembly would have to establish which column the publisher treats as the job site. This is not the reason for the HOLD. The rights conflict is.

## Scope

Cambridge is **HOLD — TERMS/RIGHTS NOT ESTABLISHED**. New York City V1 remains the only assemblable market. The overall verdict remains **NOT YET**. Signed paid pilots remain 0. The paid report is still not sold.
