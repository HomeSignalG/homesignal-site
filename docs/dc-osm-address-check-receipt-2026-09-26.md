# OpenStreetMap address check — measured results (C3b, 2026-09-26)

C3a (#1367) was applied to production at 21:53 UTC (run 36274352481). The 482 queued OSM addresses
were geocoded by the one production writer in two manual runs, 36275580735 (400) and 36275581856
(82), dispatched at 22:14 UTC. Every queued row was unadmitted, so the runs wrote evidence only and
changed no decision. By 22:26 UTC the queue was **0** and `map1_dc_zip_members` still had md5
`9fc1c9f51375f25db5658a14ca36937c` (unchanged). All figures below were read from production,
read-only, at 22:26–22:35 UTC.

## All 1,384 map-eligible OSM records (`dc_osm_address_check where map_eligible`)

| outcome | records |
|---|---:|
| CORROBORATED — own address within the calibrated 2 km of the pin | **527** |
| SOURCES_DISAGREE | **2** |
| UNCHECKED_REJECTED_NO_MATCH — geocoder returned no clean match | 195 |
| UNCHECKED_BLANK — no house-number address tags | 575 |
| UNCHECKED_NO_LOCALITY — no city/state/postcode (mostly Canadian) | 84 |
| UNCHECKED_NO_HOUSE_NUMBER | 1 |
| **total** | **1,384** |

Before any geocoding, 164 of the 527 already read CORROBORATED. Those addresses had already been
geocoded for Atlas records, which often carry the same OSM-derived addresses (see
`docs/dc-osm-current-state-2026-09-26.md` §2).

## The 846 OSM markers on Map 1 today (`publication_basis = 'legacy_osm_compat'`, every canonical ZIP)

| outcome | markers | ZIP pages |
|---|---:|---:|
| CORROBORATED | **303** | 152 |
| SOURCES_DISAGREE | **1** | 1 |
| UNCHECKED_REJECTED_NO_MATCH | 127 | 40 |
| UNCHECKED_BLANK | 386 | 134 |
| UNCHECKED_NO_LOCALITY | 28 | 15 |
| UNCHECKED_NO_HOUSE_NUMBER | 1 | 1 |
| **total** | **846** | |

The totals match the 846 OSM markers counted in `docs/dc-osm-current-state-2026-09-26.md`.

## The two disagreements

| record | on a Map 1 ZIP page | pin | its own address → geocode | distance |
|---|---|---|---|---:|
| `osm:way/1425043213` QTS NAL 2 DC2 (campus outline) | **yes, 43054** | 40.0531, -82.7566 | 675 Beech Road SW, New Albany, OH 43054 → 40.0729, -82.7539 | 2,214 m |
| `osm:way/671838900` Rice Data Center (campus outline) | no: its ZIP 77025 is not one of the 12,722 registry ZIP pages | 29.6581, -95.4433 | 1160 Main Street, Houston, TX 77025 → 29.7558, -95.3659 | 13,182 m |

⚠️ I first recorded Rice Data Center as the one on Map 1. That was wrong. The per-ZIP read shows
`map1_dc_zip_members('77025')` returns it, but 77025 is not in `canonical_zip_registry`, so no
page shows it. The marker counted among the 846 is QTS, on 43054. Checked by querying both ZIPs'
registry membership.

Both were judged by the shared rule (`dc_site_claims_conflict`: a site claim against a derived
address with a 2,000 m calibrated bound). No threshold was chosen for OSM.

## What this changes

Nothing on Map 1 yet: OSM is not admitted, and the Map 1 reader does not read the check. C3c (steps 5–7)
rehearses the reader change on a replica: flag the CORROBORATED pins, withhold the SOURCES_DISAGREE
pin, and never move a pin. The change is gated by automated checks.

The 127 UNCHECKED_REJECTED_NO_MATCH markers are step 8 (C4) work: group them by cause and fix only
in the shared policy.
