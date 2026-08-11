# Phase 7 §1 — legacy Del Valle facility/company identity audit

**2026-08-10.** The mandatory pre-migration inventory. **No migration was performed.**
Measured live; every number below is from a query run this session.

## Inventory

| Object | Count | Notes |
|---|---:|---|
| `property_company_roles` (ZIP 78617) | **13** | roles: `Operator`, `Property Owner`; tiers: `authoritative_filing`, `identifier_backed` |
| `property_company_roles` `project_id IS NULL` in **78617** | **0** | see correction below |
| `property_company_roles` `project_id IS NULL` (all ZIPs) | 48 | none of them Del Valle |
| `company_parents` | **8** | 1 `verified`, 6 `unverified_candidate`, 1 `not_yet_asked` |
| `project_facility_refs` | 33 | |
| `identity_conflicts` | 4 | columns are `stronger_company` / `weaker_company` **text**, no entity refs |
| `company_facilities` | 754 | |
| `frs_org_affiliations` | **41** | |
| `frs_affiliation_role_map` | **39** | the declarative map the architecture audit praised |
| `evidence.ev_entity` kind='facility' | **0** | nothing migrated yet |

## Validation cases confirmed present

- **BFI `110005052085`** — exactly 2 FRS rows, as the brief predicts:
  `OPERATOR -> BFI WASTE SYSTEMS OF TEXAS LP` and `OWNER -> BROWNING-FERRIS INDUSTRIES INC`.
- **Verified parent** — `Martin Marietta Materials Southwest, LLC -> Martin Marietta Materials, Inc.`
  is the **only** row with `verification='verified'`.
- **Candidates already correctly unpromoted** — TXI Operations LP, BFI Waste Systems of Texas LP,
  Neuralink, Neuralink Corporation, River Bottoms Ranch, River Bottoms Ranch LLC all carry
  `unverified_candidate` with a **NULL `parent_name`**. Cinco J., Inc. is `not_yet_asked`.

## ⚠️ Three corrections to the brief's assumptions

1. **§32's premise does not apply to Del Valle.** The brief says to be careful with
   `property_company_roles` rows where `project_id IS NULL`. In ZIP 78617 there are **zero**
   such rows; all 48 are in other ZIPs and therefore out of this phase's scope.
2. **The FRS historical roles the brief names do not exist in the data.** Distinct
   `affiliation_type` values present are exactly:
   `BILLING CONTACT | MAILING ADDRESS | OPERATOR | OWNER | OWNER/OPERATOR | PARENT OWNER`.
   There is **no** `FORMER OWNER`, **no** `FORMER OPERATOR`, and **no** `PARENT COMPANY`.
   So §9's `FORMER OPERATOR` mapping and §17/§30's "at least one historical affiliation" have
   **no real row to migrate** — they require a regression fixture, which §30 permits.
3. **Two FRS affiliation types are not company roles at all.** `BILLING CONTACT` and
   `MAILING ADDRESS` must be excluded from role mapping entirely: promoting them would both
   invent a company relationship and risk surfacing contact/mailing data, which the evidence
   schema's privacy posture forbids. `PARENT OWNER` is a **candidate**, never a verified parent.

## Migration readiness

The Phase 1–6 schema already supports everything Phase 7 needs with **no new core table**:
`ev_facility` (thin core, unused), the `ev_identifier_kind_guard` trigger (blocks an FRS id on a
parcel), `ev_entity_resolution` (candidates that never merge), `ev_claim` + `ev_claim_relation`
(competing claims that both survive), and `ev_source_role_map` (declarative per-source role
semantics). New predicates needed: `facility_owner`, `operates_facility`, `former_operator`,
`parent_company`, `facility_located_on_parcel`, `regulated_customer_of`.

**Not started:** the migration itself, the facility/company read model, and the
track-record / ESG eligibility proofs.
