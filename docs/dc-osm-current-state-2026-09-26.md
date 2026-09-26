# OpenStreetMap in the data-centre pipeline — current state, licensing architecture, contribution evidence (2026-09-26)

OpenStreetMap is an approved, active HomeSignal data-centre source (founder, 2026-09-26). This file
records **exactly how it works today**, before any pipeline change, so C3 of the address-check plan
starts from measured facts. Every figure was read from production (read-only) on 2026-09-26
between 20:40 and 21:30 UTC, or from a named file in this repo. Nothing here changes production or
Map 1.

## 1. How OSM works today

| | |
|---|---|
| **What** | OpenStreetMap features tagged `telecom=data_center`, licence ODbL (`docs/national-dc-plane.sql`, header) |
| **Ingestion** | A **one-time load** on 2026-09-15 (PRs #1227/#1232–#1234). `imported_at` = `last_seen_at` = 2026-09-15 18:46:03 UTC on every row: no refresh since. **No recurring acquisition.** The table was created by migration `national_dc_records_v1`; **the load itself is not in either repo or in the migration ledger** (0 insert statements across the 6 OSM/national migrations) — how it was loaded is UNVERIFIED. |
| **Storage** | `public.national_dc_records`: 1,824 rows · 1,384 `map_eligible` · 440 excluded, each with a reason ("no source-supplied project name"; never a placeholder). Full OSM tags kept in `raw_tags`. Service-role only. **Not in `dc_source`, not in any `dc_*` canonical table.** |
| **Attribution** | Every OSM row leaving `map1_dc_zip_members` carries `source_licence = 'ODbL, © OpenStreetMap contributors'` (migration `map1_dc_publication_osm_licence_text`, 2026-09-22) and its own `source_name`. `homesignalmap.html` (`NATIONAL_SOURCES`, ~line 1213) renders the data-centre credit from the rows' own `source_name`, so a load returning no OSM rows shows no credit. This is separate from Leaflet's basemap tile credit, which an earlier test mistook for it. |
| **De-duplication** | Inside `map1_dc_zip_members` only (`docs/map1-dc-publication.sql`, CTE `osm_kept`): an OSM row is dropped only when **exactly one** published canonical point sits within **1 m** and the match is one-to-one. Anything looser is not a match. Nothing is written anywhere. |
| **Presentation** | `publication_basis = 'legacy_osm_compat'`, same lifecycle map as canonical rows. **846 markers** on Map 1 today (751 approximate campus area, 95 precise) — 47% of the 1,817. |
| **Retirement condition (site CLAUDE.md §7.09)** | OSM onboarded as a `dc_source` through `dc_evidence_writer` with a recurring acquisition; its records then arrive as `canonical` and the `osm` CTE is deleted. |

**The approved data-centre sources**, measured: `dc_source` holds exactly two — Compute Atlas
(`compute_atlas/facilities`, CC BY 4.0, ACTIVE, daily 09:40 UTC, 2,242 current records) and Epoch AI
(`epoch_ai/data_centers` 93 + `epoch_ai/timelines` 545, CC BY 4.0, ACTIVE, daily 10:10 UTC). OSM is
the third, held outside the registry in its own table.

## 2. Licensing architecture — the finding that must be decided first

**Today, by design, the layers are independent.** OSM rows sit in their own table, are never
written into a canonical table, keep their own source and licence on every row, and are combined
with canonical rows only at read time for display. The canonical database (`dc_canonical_entity`,
`dc_entity_geography`) is built from Atlas and Epoch observations only.

**But the canonical database already contains OSM-derived data, through Atlas:**

- **552 of the 2,242** current Compute Atlas records mention OpenStreetMap in their own payload, and
  **498** carry evidence typed `osm` (Atlas's source vocabulary includes `osm`,
  `docs/dc-canonical-contract-step2.md` §evidence_kind).
- **267** canonical data-centre facilities sit within 1 m of an OSM record; **261 of those 267**
  trace to an Atlas record that cites OSM. The coordinates were very likely copied from OSM upstream.
- Atlas publishes these under **CC BY 4.0**. Whether OSM-derived content can be relicensed that way
  is an upstream question about Atlas, and it already reaches HomeSignal's canonical tables and Map 1
  (all 971 canonical markers are credited "Compute Atlas (Edward Kubiak)", CC BY 4.0).

**What the planned C3 route would change.** Onboarding OSM as a `dc_source` puts OSM observations
into the same identity and geography resolvers as Atlas and Epoch: OSM records would merge into
canonical facilities and could become a facility's location authority. The canonical tables would
then be a database built from ODbL and CC BY inputs together. That is a change to the licensing
architecture, so **it is not made here.** Three ways forward, none chosen:

1. **Keep OSM a separate layer** and check OSM pins against OSM addresses without merging OSM into
   canonical facilities (the check would still use the one geocoder and the one conflict rule; the
   identity merge is what it avoids).
2. **Onboard OSM as a canonical source**, accepting whatever obligations a combined ODbL/CC BY
   database carries, with provenance kept per observation (it already is).
3. **Get a licensing review first** — including the Atlas-cites-OSM finding, which exists today
   regardless of this plan.

No legal conclusion is drawn here.

## 3. Contribution and overlap evidence (diagnostic)

Canonical facilities by the sources they draw on (current, not superseded):

| Sources | Facilities | Confirmed data centres |
|---|---:|---:|
| Compute Atlas only | 2,238 | 1,723 |
| Epoch timelines only | 545 | 0 |
| Epoch data centres only | 89 | 87 |
| Atlas + Epoch data centres | 4 | 4 |
| **OSM** | **0 — not in the canonical pipeline** | — |

Map 1 today: 971 canonical markers (all credited Compute Atlas) + 846 OSM compatibility markers.

**OSM against the canonical pipeline.** Each of the 1,384 eligible OSM records, by distance to the
nearest resolved, confirmed canonical data-centre point (1,411 such points):

| Nearest confirmed canonical point | OSM records | of which precise |
|---|---:|---:|
| ≤ 1 m (today's de-duplication rule) | 266 | 35 |
| 1–100 m | 112 | 17 |
| 100–500 m | 287 | 20 |
| 500 m – 2 km | 299 | 19 |
| > 2 km | 420 | 58 |
| **total** | **1,384** | 149 |

⚠️ **Distance is a diagnostic, not the identity decision.** Whether an OSM record is the same
facility as a canonical one is decided only by the canonical identity resolver (Step 3A), and
"Vantage WA12/WA13" (166 m apart, same operator, two buildings) is the documented reason proximity is
not a match. So **"420 OSM records have no confirmed canonical facility within 2 km" is an upper
bound on net-new facilities, not a count of them**, and the 266 at ≤ 1 m are overwhelmingly the same
OSM data re-entering through Atlas (261/267 cite OSM).

**The authoritative figures** — OSM records the resolver merges into existing facilities, net-new
canonical facilities, and the resulting Map 1 change — require the C3 replica dry run: OSM loaded as
a source **on a disposable replica only**, run through the real identity and geography resolvers,
compared against production. That is the next step, and it changes nothing in production.

## 4. Address-check relevance

Of the 846 OSM markers on Map 1, **460** carry `addr:housenumber` + `addr:street`; 437 of those also
carry a city or postcode and 2 are house-number ranges, so roughly **435 are geocodable** under the
one policy. 386 carry no house-number address (378 no address tags at all).
