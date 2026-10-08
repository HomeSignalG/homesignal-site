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

## C3c applied — the Map 1 change (2026-09-26 23:53 UTC)

`dc-osm-map1-apply.yml` run **36280510291**, dispatched from main at 23:47 UTC with the confirm string
`APPLY-OSM-MAP1-C3C`. The `apply` job `needs: [offline, gate]` in that same run.

**The gate, on that moment's production data** (production was only read; the change ran on a replica):

- **Preconditions:** switch md5 `31cb6c9e…` (post-C3a, pre-C3c), Map 1 reader md5 `9fc1c9f5…`,
  queue 0, C3a live.
- **Replica:** production copied read-only. 17,691 observations · 4,676 entities · 1,336 geocodes ·
  1,824 OSM records · 12,722 registry ZIPs.
- **PARITY PASS:** the replica's Map 1 matched production's, **1,817 rows identical**.
- **Steady state after the switch:** ENTITIES_MINTED 0 · OBSERVATIONS_NEWLY_LINKED 0 ·
  OBSERVATIONS_RELINKED 0 · ENTITIES_SUPERSEDED 0 · ROWS_WRITTEN 0.

| check | result |
|---|---|
| G01 before is not empty | 1,817 rows, 846 OSM |
| G02 OSM admitted after | 1,824 checks |
| G03 after == independent prediction | **1,816 predicted / 1,816 after** |
| G04 no row added · G05 no pin moved | true · true |
| G06 every removal an admitted OSM disagreement | **1 removed** |
| G07 every flag an admitted OSM corroboration | **303 flagged** |
| G08 canonical rows byte-identical | 971 canonical rows |
| G09 every other column unchanged | true |
| G10 withheld ≤ disagreements | 1 withheld / 2 SOURCES_DISAGREE |
| G11 rows reconcile | 1,817 = 1,816 + 1 |

`CHANGE|WITHHELD|43054 osm:way/1425043213 QTS NAL 2 DC2`. The flags fall across 172 ZIPs; the largest
are 20147 (36), 20166 (25), 20109 (12) and 95054 (7).

**Live production, verified read-only at 00:14 UTC 2026-09-27:**

- **Switch:** OSM admitted (Atlas still admitted). Switch md5 `2c05d65a…`.
- **Reader:** md5 `2146b68a…`, config `jit=off`. Both are the DDL of record and match the offline
  proof's post-apply fingerprints.
- **43054:** QTS NAL 2 DC2 is **absent**; the ZIP shows 24 OSM markers, 3 of them flagged.
- **Registry-wide Map 1:** canonical 971 markers (495 flagged, unchanged). OSM **846 → 845** markers,
  **303 flagged**, across 291 ZIPs.

## Coverage after C3c (the session's measure of done)

| bucket | markers |
|---|---:|
| CHECKED: canonical (placed by or corroborated by its own address) | 496 |
| CHECKED: OSM (corroborated by its own address) | 303 |
| checkable, no clean geocoder match: canonical | 98 |
| checkable, no clean geocoder match: OSM | 127 |
| not checkable: canonical (publisher states no usable address) | 377 |
| not checkable: OSM, no house-number address | 386 |
| not checkable: OSM, no locality | 28 |
| not checkable: OSM, no house number | 1 |
| **total Map 1 markers** | **1,816** |

**Coverage = checked / (checked + checkable) = 799 / 1,024 = 78.0%.** Before C3 it was 496 / 1,054 =
47.1%. The denominator moved because the earlier OSM "checkable" figure was an estimate from raw tags
(house number + street present: 435). This one applies the one shared policy, which also requires a
locality and a US address.
