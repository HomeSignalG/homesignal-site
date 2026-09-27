# NYC V1 Future Surroundings Report — Steps 4–8 (2026-09-27)

This builds the first report from the NYC V1 allowlist. It does not call `get-address-report`. It does not use the Census geocoder, OpenAddresses, Geoclient, ArcGIS, OSM, or any Step 3 EXCLUDE family.

Measured on `homesignal-site` after the Step 3 close. Audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.

## What shipped

| Piece | File | Step |
|---|---|---|
| Allowlist assembly | `lib/nyc-v1-report.js` | 4 |
| Socrata client (three views only) | `lib/nyc-v1-soda.js` | 4 |
| Report page | `future-surroundings-report.html` | 4–8 |
| SHA-256 `report_id` over the data-state canonical JSON | `assembleReport` | 5 |
| Share query `?address=&zip=&radius_mi=` rebuilds the same inputs | the page | 6 |
| Print / PDF via the browser print stylesheet | the page | 6 |
| Download JSON of the assembled object | the page | 7 |
| Session list of recent report ids and share links | the page | 8 |

`reports.html` remains the Premium waitlist. It still generates nothing.

## Live check

`1 Centre Street`, ZIP `10007`, 0.5 mi, 2026-09-27:

- AddressPoint `1001387`, `1 CENTRE ST`, pin `40.712980288068, -74.003758107366`
- Status `ok`
- 50 nearby allowlisted DOB rows (cap), nearest `49 CHAMBERS STREET` at 0.102 mi (DOB NOW, General Construction, Permit Issued)
- An AddressPoint miss still returns no pin and no nearby rows

BIS `gis_latitude` / `gis_longitude` are text. The issuance query scopes by AddressPoint `within_circle` ZIP strings, then HomeSignal distance. That is publisher ZIP plus arithmetic. It is not a ZCTA test.

## Still not sold

No price, no paywall, no brokerage account, no listing-level summary. The overall verdict remains **NOT YET** until a customer is actually sold an artifact from this allowlist.
