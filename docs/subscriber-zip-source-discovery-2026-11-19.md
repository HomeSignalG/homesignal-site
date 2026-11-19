# Source discovery for ZIP 07001 (Avenel NJ) and 48854 (Mason MI), 2026-11-19

Discovery only. Nothing here is a connector, a production backfill or a source activation. Method: public web search (approved access); no government host was fetched from the sandbox and no restriction was bypassed. Every item below is UNVERIFIED until fetched by an approved runner and probed (receipt, freshness, geography, record-level keys).

## 07001 Avenel (Woodbridge Township, Middlesex County NJ)
- Governing body: Township of Woodbridge. Its code (eCode360 `WO0861`) establishes a Planning Board and a Zoning Board of Adjustment with application procedures. Township site lists a Building Department and Planning & Development forms; building dept phone is published by third parties only.
- Third-party claim, NOT usable and unverified: a PermitMint page says Woodbridge publishes permits on Socrata. It may concern a different Woodbridge. Treat as a lead; never wire it.
- No official open-data portal, permit API or planning-case list was confirmed. State-level (NJ DCA construction permit data) is aggregate-only per the existing registry notes.
- Next approved step: a runner probe of the township's own Planning/Zoning pages and agendas (board agendas list applications); then a registry entry only if a first-party, record-level, dated list exists.

## 48854 Mason (Ingham County MI; City of Mason, Vevay Township, Alaiedon Township)
- ZIP spans three local governments. City of Mason: building permit page with downloadable PDF applications; Planning Commission packets on its Revize document center (a joint Mason-Vevay Planning Commission posts agendas/packets). Vevay Township: its own building permits (PDF forms, Wix site). Alaiedon Township: building and zoning permits (PDF forms, Wix site). Ingham County Drain Commission / Road Department approvals precede some permits.
- No online permit portal or machine-readable record list was confirmed for any of the three. Meeting packets are the only dated, first-party record trail found, and packets are not a permit inventory.
- Existing repo context: Ingham County Board of Commissioners is already wired (ingest CLAUDE.md "MICHIGAN PRE-LAUNCH"); that is county governance, not local development records.
- Next approved step: runner probe of mason.mi.us planning agendas and the two township sites for dated application lists; record the result as COVERED_BY_MEETING_PACKETS_ONLY or a real source.

## Not established
Whether any official source here publishes a complete record-level development list. Absence of a found source is not evidence of no development in either ZIP; both remain MISSING_COVERAGE / UNVERIFIED.

---
# Update (second research pass): classified, with exact URLs and retrieval status
**Retrieval status for every URL below: NOT retrieved by me.** They are URLs returned by web search (titles and snippets only). I fetched none of them and cannot confirm current content, dates or completeness. Categories: candidate jurisdiction / verified governing authority / candidate official source / confirmed source with qualifying records.

## 07001 Avenel
- Candidate jurisdiction: Township of Woodbridge, Middlesex County NJ (Avenel as a locality of the township is my background knowledge, not verified from a first-party source in this pass). Verified governing authority: NOT verified.
- Candidate official sources (first-party, search-listed, not retrieved):
  - Planning Board agendas: https://www.twp.woodbridge.nj.us/AgendaCenter/Planning-Board-2
  - Zoning Board of Adjustment agendas: https://www.twp.woodbridge.nj.us/AgendaCenter/Zoning-Board-of-Adjustment-4 (example agenda PDF listing variance cases by block/lot/address: https://www.twp.woodbridge.nj.us/AgendaCenter/ViewFile/Agenda/_01082026-1850)
  - Township code (procedures): https://ecode360.com/index/WO0861/V (eCode360 is a code publisher, not the township's own records)
- The host runs CivicPlus AgendaCenter, a platform the repo already has an adapter for. That makes a candidate planning-application source feasible, in the Government/Planning product category, but agendas list cases per meeting, not every building permit. **Confirmed source with qualifying records: none.** Permits: no first-party permit list found. Not to be used: the PermitMint/Socrata claim (third-party, unverified, possibly another Woodbridge); woodbridgelibrary.org appeared in results but is the library, not the township.

## 48854 Mason
- Candidate jurisdictions: City of Mason, Vevay Township, Alaiedon Township (Ingham County MI). Verified governing authority for the ZIP's addresses: NOT verified (the ZIP spans more than one).
- Candidate official sources (not retrieved):
  - City building permit information: https://mason.mi.us/city_departments/community_development_/building_permit_information.php
  - City Planning Commission packets (Revize document center), e.g. https://cms7files.revize.com/masonmi/document_center/Governments/Planning%20Commission/2024%20PC%20Meetings/PC%20Packet%20Final%20for%20web%206.11.24.pdf and 2017-2024 siblings; site plan review applications appear in these packets
  - City M-3 Technology Innovation District (data-center review process): https://www.mason.mi.us/how_do_i_/learn_about/m-3_technology_innovation_district/index.php
  - Vevay Township forms: https://www.vevaytownship.org/residential-building-forms
  - Alaiedon Township documents (PDFs on https://www.alaiedontwp.com)
- Planning packets are a candidate source for site-plan applications only; search showed packets through 2024 and no 2026 agenda, so currency is unknown. No machine-readable permit inventory found for any of the three. **Confirmed source with qualifying records: none.**

Nothing here activates a source or authorizes a backfill. Next permitted step, if you approve runner egress for it: a bounded read-only probe of the two CivicPlus agenda pages and the Mason document center to establish freshness and record shape.
