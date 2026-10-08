# Chicago building permits — one registry publisher (2026-09-27)

This classifies `chicago-building-permits` only. The other registry entries are unchanged. The two New York City datasets stay where #1410 left them. The audit verdict stays **NOT YET**. A paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `df67c4486868a88afd1289a9c2b83bfb6ec7e3bc`.

## Decision

| Registry id | Dataset | Publisher status | Paid property report |
|---|---|---|---|
| `chicago-building-permits` | `data.cityofchicago.org` `ydr8-5enu` | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | **HOLD** |

## What the dataset says

View metadata fetched 2026-09-27 from `https://data.cityofchicago.org/api/views/ydr8-5enu.json`:

- name: Building Permits
- attribution: City of Chicago
- attribution link: `http://www.cityofchicago.org`
- `license.name`: "See Terms of Use"
- `licenseId`: `SEE_TERMS_OF_USE`
- data owner in the custom metadata: Department of Buildings

The portal home page links "Terms of Use" to `http://www.cityofchicago.org/city/en/narr/foia/data_disclaimer.html`. That page was fetched the same day over HTTPS. Its title is "Data Terms of Use".

## What those terms say

Quoted from that page:

- The City "voluntarily provides the data on this website as a service to the public" and makes it available "as is." It disclaims accuracy, completeness, merchantability, and fitness for a particular purpose.
- "The City may require a user of this data to terminate any and all display, distribution or other use of any or all of the data provided at this website for any reason," including a violation of these terms or other terms set by the department that contributed the data.
- A user that provides a software application, or a secondary or derivative application, using the data must show this disclaimer where the application is accessed: "This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago. The City of Chicago makes no claims as to the content, accuracy, timeliness, or completeness of any of the data provided at this site. The data provided at this site is subject to change at any time. It is understood that the data provided at this site is being used at one's own risk."
- "These Terms of Use do not grant anyone any title or right to any patent, copyright, trademark or other intellectual property rights that the City may have in any of the information, images, software, or processes displayed or used at this website." If the City claims such a right, the page says it will indicate that on the webpage where the material is accessed. The Building Permits view does not add a copyright claim. Its license field points back at these terms.
- The user indemnifies the City for claims arising from use of the data, including secondary or derivative use.

## Why this stays HOLD

The terms regulate display, distribution, and derivative applications. They do not say commercial use is allowed, and they do not say it is forbidden. They withhold an intellectual-property grant, and they let the City stop any distribution for any reason. A paid report cannot treat that as a stable grant. The rows stay **HOLD — TERMS/RIGHTS NOT ESTABLISHED**.

This is not the New York rule. Local Law 11 of 2012 says New York public data sets are available without restrictions on use, with source, version, and modification identified. Chicago's page does not say that. Chicago's terms do not clear Seattle, Austin, or any other registry entry.

HomeSignal's `column_map` for this entry selects and renames permit type, work description, status, issue date, street fields, latitude, longitude, and permit number. If a later review treated an application as permitted, that selection would be a modification and the required City disclaimer would have to appear with it. That condition is not a clearance.

The `get-address-report` note "Not for resale," and placement through the geocoder, OpenAddresses, or ZCTA, remain separate holds. They are not the reason this publisher stays HOLD. The publisher's own terms are the reason.
