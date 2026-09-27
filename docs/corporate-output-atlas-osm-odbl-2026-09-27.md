# Atlas, OSM, and ODbL — one §12 decision (2026-09-27)

This decides blockers 3 and 4 of `docs/corporate-output-source-rights-audit-2026-09-27.md` §12 for the data-centre pins only. The audit verdict stays **NOT YET**. No pin is **CLEARED FOR PAID REPORT**. A paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `53e4771c7b5e37f35ba93799e52f7b45b1f1c5c9`. Production counts below are the 2026-09-26 read in `docs/dc-osm-current-state-2026-09-26.md`. This pass did not re-query production.

## Decision

| Object | Classification | Reason |
|---|---|---|
| Canonical Compute Atlas pin (`publication_basis = canonical`, `dc_source.licence` CC BY 4.0) | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | The customer row cannot show `evidence_kind`. Atlas's own vocabulary includes `osm`. CC BY 4.0 grants only rights the licensor has authority to license. |
| Separate OSM layer pin (`publication_basis = legacy_osm_compat`, licence `ODbL, © OpenStreetMap contributors`) | **HOLD — TERMS/RIGHTS NOT ESTABLISHED** | A paid JSON of those records is a public re-use of ODbL contents. The license does not say that record array is only a Produced Work. |
| Read-time union of those two row types | Share-alike does **not** move the CC BY rows onto ODbL | ODbL 4.5(a), and the SQL does not write OSM into the canonical tables. |

Property placement of either pin ("near this property", distance, ZIP membership) stays **HOLD** for the separate ZCTA reason in the §12 evidence pass. This file does not clear that placement.

## What the customer can see

`public.map1_dc_zip_members` returns `source_name`, `source_licence`, `publication_basis`, and `source_key`. It does not return `evidence_kind`. `HS.map1DcSite` copies `publication_basis` and `source_licence` onto the page object and does not copy `evidence_kind`.

`evidence_kind` lives on `public.dc_source_citation` (`docs/dc-canonical-contract-step2.md` §6). The contract lists Atlas's values as `press`, `other`, `osm`, `filing`, `permit`, `subsidy`, `iso_queue`. That table's read grant in the contract is service role and review tooling.

So a page can tell a separate OSM pin from a canonical pin. It cannot tell which canonical pin rests on an `osm` citation.

## Atlas pins stay HOLD

The 2026-09-26 production read: 498 of 2,242 current Compute Atlas records carry evidence typed `osm`; 261 of 267 canonical facilities within 1 m of an OSM record trace to an Atlas record that cites OSM. Those facilities are inside `dc_canonical_entity` and are described by the current observation. The function credits that observation's `dc_source.licence`. For Compute Atlas that string is CC BY 4.0, publisher "Compute Atlas (Edward Kubiak)".

CC BY 4.0 §1(g), fetched 2026-09-27 from `https://creativecommons.org/licenses/by/4.0/legalcode.txt`: Licensed Rights "are limited to all Copyright and Similar Rights that apply to Your use of the Licensed Material and that the Licensor has authority to license."

Compute Atlas README, fetched the same day from `https://raw.githubusercontent.com/ek33450505/compute-atlas/main/README.md`: data in `data/` is CC BY 4.0, "Reuse freely, including commercially; please attribute." The next sentence is "Third-party data keeps its own terms," and the examples it names are the basemap (ODbL) and Epoch AI figures (CC BY 4.0). It does not mention `evidence_kind = osm`. The `osm` value is Atlas's citation vocabulary in HomeSignal's contract, not a sentence on that README.

ODbL 1.0 §4.4(b), fetched 2026-09-27 from `https://opendatacommons.org/licenses/odbl/1-0/`: "Extraction or Re-utilisation of the whole or a Substantial part of the Contents into a new database is a Derivative Database and must comply with Section 4.4." Citations typed `osm` inside the canonical observation are the path that would be that extraction. The separate-layer union below is a different path.

A sold canonical pin cannot be limited to "not OSM" from the fields the page has. The Atlas family stays **HOLD** until the customer row can exclude `evidence_kind = osm` and the rows that remain are the ones offered.

## The separate OSM layer stays HOLD

OSM rows stay in `public.national_dc_records`. The `osm` CTE in `docs/map1-dc-publication.sql` reads them. `osm_kept` drops an OSM row when exactly one canonical point is within 1 m and the match is one-to-one. That drop does not copy OSM fields onto the canonical row. `pool` is `canon union all osm_kept`. Each OSM row leaves with `source_licence = 'ODbL, © OpenStreetMap contributors'` and `publication_basis = 'legacy_osm_compat'`. The founder decision in `docs/dc-osm-current-state-2026-09-26.md` §5 keeps OSM a separate layer and does not admit it to the canonical tables.

ODbL definitions, same fetch:

- "Collective Database" — this Database in unmodified form as part of a collection of independent databases. A Collective Database will not be considered a Derivative Database.
- "Produced Work" — a work (such as an image, audiovisual material, text, or sounds) resulting from using the Contents via a search or other query.
- §4.5(a) — you are not required to license Collective Databases under ODbL; ODbL still applies to the ODbL database inside the collection.
- §4.5(b) — using the Database to create a Produced Work does not create a Derivative Database for §4.4.
- §4.2 — publicly conveying the Database requires the ODbL notice. §4.3 — publicly using a Produced Work requires a notice and does not require the §4.2 notice.

The `union all` matches the Collective Database shape: the OSM table is not modified, and the CC BY rows are an independent database. §4.5(a) answers the contagion question. Share-alike does not require the CC BY rows to be offered under ODbL because they were displayed beside an unmodified OSM extract.

The OSM rows themselves are not cleared. A paid response that returns project name, operator, and coordinates from `national_dc_records` makes those contents available to a customer. The license's Produced Work examples are an image, audiovisual material, text, or sounds. A record array is the Contents. This pass does not call that array a Produced Work. The rows stay **HOLD** until a later record decides whether the paid payload is conveyance of the database under §4.2 or a Produced Work under §4.3, and then meets that section's notice.

## What this does not decide

Epoch AI text fields stay where the audit left them. NWS stays where the audit left them. The other five §12 blockers are unchanged. `"Not for resale"`, the 240 registry sources, the geocoder, OpenAddresses, and ZCTA are not this decision.
