# Multi-source evidence — Phase 1 implementation record

**2026-08-10.** Core evidence foundation + TCAD parcel adapter, validated on
**2200 Caldwell Ln, Del Valle, TX 78617 — TCAD PROP_ID 292354**.
Additive only. No production read path was changed. SQL of record:
`docs/evidence-phase1-migration.sql`. Contract guards: `test/evidence-phase1-model.test.mjs`.

## 0. Two differences from the brief, found before building (§1)

1. **There is no TCAD research in either repo.** The brief refers to an "already-discovered
   public property API"; `grep -rl "TCAD\|292354\|traviscad"` across both repos matches only
   `docs/multi-source-evidence-architecture.md` and `docs/source-key-productionization-status.md`.
   The endpoint was therefore **discovered live this session** and is documented in §2 below so
   the next session does not repeat it.
2. **`tx_parcels` is empty (0 rows)** — confirming the audit's "there is no Texas parcel entity."
   `resolved_project_parcels` holds 93 rows, `property_reports` 1, `source_fetch_cache` 5.

## 1. What was created

`evidence` schema — **22 tables**, all with RLS enabled, plus **one** public function.

| Layer | Objects |
|---|---|
| Source | `ev_source`, `ev_source_coverage`, `ev_source_capability`, `ev_source_authority`, `ev_source_role_map` |
| Raw | `ev_source_record`, `ev_source_check` |
| Identity | `ev_entity`, `ev_identifier_type`, `ev_entity_identifier` (+ kind guard trigger), `ev_entity_resolution` |
| Typed cores | `ev_parcel`, `ev_organization`, `ev_development`, `ev_facility`, `ev_recorded_instrument` |
| Evidence | `ev_predicate`, `ev_claim`, `ev_claim_relation`, `ev_claim_geometry`, `ev_display_precedence` |
| Bridge | `ev_legacy_property_report_link` |
| Read model | `public.ev_parcel_report(id_type, id_value)` — the only object added to `public` |

## 2. The TCAD adapter — discovered, then used (§9)

TCAD's public property portal is a React SPA at `travis.prodigycad.com`; its API is
**TrueProdigy** at `https://prod-container.trueprodigyapi.com`.

- Token: `POST /trueprodigy/cadpublic/auth/token` with `{"office":"Travis"}` → **201**.
  `GET /trueprodigy/officelookup/travis` → `{"url":"travis","office":"Travis"}` confirms the office.
- ⚠️ **The Authorization header takes the RAW token — `Bearer <token>` returns HTTP 500.**
  That one detail cost several probe rounds; it is the single most important thing to carry forward.
- Endpoints used, all keyed on **PROP_ID**, never on an address:
  `/public/property/292354/isvalid` (owner, situs, legal description, tax year) ·
  `/public/property/292354/gis` (geoID, legal acreage, taxing units, classification, **value history**) ·
  `/public/property/292354/deeds` (deed history).
- Geometry comes from a **separate** source and is recorded as such: the City of Austin's
  `EXTERNAL_tcad_parcel` FeatureServer — a **republication** of TCAD parcels, registered with
  `is_first_party=false` and `authority_class='republished'`, matched on `PROP_ID=292354`.

**Refresh path is `PROP_ID → record`.** Address resolution is an acquisition step only; the
adapter never rediscovers the parcel by address.

## 3. Live values ingested (all retrieved, none transcribed from the brief)

| Fact | Live value | Source field |
|---|---|---|
| Owner of record | `RIVER BOTTOMS RANCH LLC` | `ownerName` |
| Situs | `2200 CALDWELL LN, TX 78617` | `situs` |
| Legal description | `ABS 18 NAVARRO J A ACR 36.474` | `legalDescription` |
| Legal acreage | `36.4740` | `propertyInfo.legalAcreage` |
| Appraised land size | `28.4940` | `landInfo.sizeAcres` |
| Geo ID | `0315600221` | `propertyInfo.geoID` |
| Classification | `E1` | `landInfo.stateCd` |
| Taxing units | `03,06,0A,2J,51,68,6R` → 7 separate claims | `propertyInfo.taxingUnits` |
| Tax year | `2026` | `currentTaxYear` |
| Value history | **15 years**; 2026 market `4,274,046`, land `2,917,920`, improvement `1,356,126` | `valueInfo[]` |
| Deed references | **4**, incl. `2021024697` WARRANTY DEED 2021-02-03, buyer RIVER BOTTOMS RANCH LLC | `deeds[]` |

### Differences from the brief's stated values — live data governs (§10)
- **`pAccountID`, `taxOfficeRef` and `ownerID` do not appear in any payload retrieved.** They are
  in the SPA's JS bundle as field names, but not in the three public endpoints. **No identifier
  was invented**: the parcel carries only `tcad.prop_id` and `tcad.geo_id`. `travis.account_id`,
  `travis.tax_office_ref` and `tcad.owner_id` are **registered as identifier types and left
  unpopulated** — the model is ready, the data was not asserted.
- The brief's **"effective acreage 36.980"** was not returned. TCAD returned legal acreage
  `36.4740` and land size `28.4940`. Both are stored as separate `has_acreage` claims
  distinguished by `source_predicate_raw`; neither overwrites the other.

## 4. §16 — what `ownerID` is, semantically

Registered as **`tcad.owner_id`, `uniqueness_scope='authority_dataset'`, identifying an
organization** — a *TCAD ownership-account key*, explicitly **not** a universal company
identifier. It is unpopulated because no retrieved payload contained it. The four sibling
parcels were **not ingested** (§32).

## 5. §21 — the coexistence proof

The same site, two facts, two predicates, zero conflict:

```
LAND         parcel 292354  --property_owner_of_record-->  RIVER BOTTOMS RANCH LLC   [TCAD]
DEVELOPMENT  ATX1           --project_owner_as_filed  -->  Neuralink                 [TDLR TABS2024022676]
```

Measured: **1** `property_owner_of_record` claim (TCAD) · **5** `project_owner_as_filed` claims
(TDLR) · **0** claims with `status <> 'active'` — nothing was arbitrated away at storage ·
**0** `property_owner_of_record` claims from TDLR.

## 6. §20 — the role-semantic fix

Legacy `property_company_roles` still carries 5 rows reading
`role='Property Owner'`, `evidence_source='TDLR TABS project … — OWNER block'`. **It was not
modified.** In the new model those same five filings map to `project_owner_as_filed`, and the
predicate's `explicit_non_meaning` — *"NOT evidence of land ownership"* — is stored in the
database. All four as-filed names are preserved verbatim: `Neuralink`, `Neuralink Corporation`,
`River Bottoms Ranch LLC`, `River Bottoms Ranch`.

## 7. ⚠️ Defect found and fixed in my own ingest (§12)

The first ingest reused an organization entity across sources when the name matched
case-insensitively — so TDLR's *"River Bottoms Ranch LLC"* was bound to the **TCAD** organization.
That silently asserts two sources describe the same legal organization **on a name match alone**,
which is the merge §12 forbids.

Corrected by `evidence_phase1_fix_cross_source_org_merge`: each source's assertion now owns its
organization entity. After: **6 organizations, 0 shared across sources, 0 `ev_entity_resolution`
rows.** Sameness — including whether "Neuralink" and "Neuralink Corporation" are one company — is
left unasserted, exactly as the architecture requires.

## 8. §19 — project → parcel links

All five TDLR filings are linked, because the filed situs resolves to exactly one Travis County
parcel and no competing parcel exists at that situs. The link is labelled honestly:
`evidence_class='resolved_by_match'`, `authority_class='third_party'`,
`source_predicate_raw='Location Address'`, with the note *"TDLR never states a PROP_ID."*
A source naming PROP_ID would be `identifier_backed` — a different, stronger claim.

## 9. §18 — the legacy bridge

`ev_legacy_property_report_link` maps `property_reports.address` →
parcel entity, with basis **coordinate containment in the authoritative parcel polygon**
(`ST_Contains` evaluated against the ingested geometry, not asserted). `property_reports` is
byte-unchanged and still address-keyed; no URL or page behaviour changed.

## 10. §15 — deed references, not verified deeds

Each of the 4 TCAD-reported instruments became an `instrument` entity with a
`travis.instrument_no` identifier, linked by `conveyed_by_instrument` at
`evidence_class='source_reported'`, `authority_class='official_secondary'`, carrying the caveat
*"A reference REPORTED BY an appraisal source is not the recorded instrument itself."*
`ev_display_precedence` already ranks a future County Clerk `recorded_instrument` claim **above**
the appraisal roll, so the Clerk adapter slots in without a schema change.

## 11. §30 — live assertions (13/13 pass)

| # | Assertion | Measured |
|---|---|---|
| 1 | parcel carries multiple identifiers | 2 |
| 2 | TCAD owner → `property_owner_of_record`, exactly one | 1 |
| 3 | TDLR contributes ZERO `property_owner_of_record` | 0 |
| 4 | all 5 TDLR OWNER blocks → `project_owner_as_filed` | 5 |
| 5 | 0 claims arbitrated away at storage | 0 |
| 6 | organizations not merged (resolution rows) | 0 |
| 7 | distinct organization entities | 6 |
| 8 | raw payloads preserved inline | 9 |
| 9 | no raw UUID in consumer read | pass |
| 10 | no internal enum token in consumer read | pass |
| 11 | no owner mailing address in consumer read (§27) | pass |
| 12 | bridge basis contains no company name | 0 |
| 13 | project→parcel link contains no company name | 0 |

Additional live checks: same PROP_ID value coexists under a second county's id_type; a duplicate
`tcad.prop_id` is rejected; an `epa.frs_registry_id` attached to a parcel raises; a recorded
`source_error` leaves the existing owner claim intact.

Repo suite: **95 files green** (94 → 95; the new suite is auto-discovered by the runner).

## 12. §28 — backward compatibility, measured after the change

`property_reports` 1 · `property_company_roles` 66 · `project_facility_refs` 33 ·
`identity_conflicts` 4 · `resolved_project_parcels` 93 · `tx_parcels` 0 ·
`app_projects` 3,027,773 · `development_reports` 12,722 · TABS records at 78617 **5** — all
unchanged. **Zero** new tables in `public`; exactly one new function. Nothing was dropped,
renamed, or re-pointed.

## 13. Deliberately NOT migrated

Legacy identity graph (`property_company_roles`, `project_facility_refs`, `identity_conflicts`),
TCEQ, FRS, ECHO, ESG/WikiRate, company parents/track record, the property card, the source
registry architecture, `app_projects`/`development_reports`, MassDOT, Cabarrus, DeSoto, the
County Clerk adapter, and the sibling parcels under ownerID 1879270.

## 14. Recommended Phase 2

1. **Travis County Clerk adapter** — turns the 4 deed references into `recorded_instrument`
   evidence. The precedence row already exists; this is the cleanest proof that a stronger
   source displaces a weaker one *at display* without deleting the weaker claim.
2. **A second county's assessor** (a non-Texas one) through the same adapter contract — proves
   answer D below with a new adapter rather than a new truth table.
3. **`resolved_fact` + `property_card` materialization** — arbitration output, still parallel.
4. Only then: migrate the legacy identity graph onto `ev_claim`.
