# Coverage-quality matrix — Step 9 (2026-09-27)

This measures which markets can be assembled for a paid Future Surroundings Report from cleared publisher data and cleared geography. It does not start a second market. It does not clear ArcGIS, Census, or OpenAddresses. The audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.

The commercial verdict remains **NOT YET**.

## Decision

| Market | Publisher data | Geography | Assemblable |
|---|---|---|---|
| New York City V1 | AddressPoint `uf93-f8nk` + `ipu4-2q9a` + `rbx6-tga4`, all **CLEARED WITH ATTRIBUTION** | AddressPoint Socrata `the_geom` **CLEARED WITH ATTRIBUTION** | **Yes** — the only closed market |
| Seattle | `seattle-building-permits` `76t5-zqzr` **CLEARED WITH ATTRIBUTION** | Addresses (MAF) `ctqe-m6xd` **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **No** |
| Chicago | `chicago-building-permits` **HOLD** | not opened | **No** |
| Austin | `austin-issued-construction-permits` **HOLD** | not opened | **No** |
| Little Rock | `little-rock-permits` **HOLD** | ArcGIS MapServer **HOLD** | **No** |
| Brunswick County | `brunswick-county-permits` **HOLD** | ArcGIS FeatureServer **HOLD** | **No** |

Nothing in this file is **CLEARED FOR PAID REPORT**.

## New York City — measured usefulness

Live SODA counts from `docs/corporate-output-nyc-pilot-assembly-2026-09-27.md`, 2026-09-27:

| Dataset | Published rows | Publisher coordinates | Allowlisted type and coordinates |
|---|---|---|---|
| AddressPoint `uf93-f8nk` | 967,871 | 967,871 | n/a — this is the property coordinate |
| `ipu4-2q9a` | 3,990,687 | 3,983,266 | 754,011 |
| `rbx6-tga4` | 1,006,422 | 999,963 | 316,643 |

A live report for `1 Centre Street` / `10007` matched AddressPoint `1001387` and returned the 50-row nearby cap. An AddressPoint miss still returns no pin.

## Seattle — next-market attempt

`seattle-building-permits` stays **CLEARED WITH ATTRIBUTION** and **HOLD** for paid property placement (`docs/corporate-output-seattle-building-permits-2026-09-27.md`).

Addresses (MAF) was fetched 2026-09-27 from `https://data.seattle.gov/api/views/ctqe-m6xd.json`:

- name: Addresses (MAF)
- `assetType`: `federated_href`
- `viewType`: `href`
- `displayType`: `federated`
- `columns`: `[]` — not a Socrata table
- provenance: official
- no `license` / `licenseId` fields on the view
- Common Core custom-field "License" is a warranty disclaimer about labeling, dimensions, contours, property boundaries, and placement. It is not the Public Domain grant used for `76t5-zqzr`.
- additional access points include ArcGIS Hub `https://data-seattlecitygis.opendata.arcgis.com/datasets/SeattleCityGIS::addresses-maf` and ArcGIS GeoService `https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/TRANSPO_MAFDAP_PV/FeatureServer/0`

That is the same class as the NYC AddressPoint ArcGIS FeatureServer: a different distribution. ArcGIS stays **HOLD**. Census geocoder and OpenAddresses stay **HOLD**. Seattle therefore cannot be assembled without a HOLD geography input.

The MAF view is not loaded. The FeatureServer is not called. `get-address-report` is not used.

## Other candidates already on file

Chicago, Austin, Little Rock, and Brunswick County remain where their 2026-09-27 publisher files left them: **HOLD — TERMS/RIGHTS NOT ESTABLISHED**. Those files were not reopened.

## Step 9 status

The close condition was: measure a coverage-quality matrix and choose additional pilot markets from cleared, useful coverage.

The matrix exists. The additional-market choice is: **none**. NYC V1 remains the only assemblable market. Step 9 is closed for that measurement. It stays **OPEN** as a standing search — a later market can be added only by a new evidence file that clears both publisher data and geography.

The paid report is still not sold.
