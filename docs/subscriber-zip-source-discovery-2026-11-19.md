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
