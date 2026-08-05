# HomeSignal Source Registry
# docs/source-registry.md
#
# THE AUTHORITATIVE LIST of every data source the get-address-report engine uses,
# plans to use, or has evaluated. Read this before writing any source adapter code.
#
# GOVERNANCE (development-tracker-source-of-truth.md):
#   • Every source must have an entry here BEFORE any adapter code is written.
#   • Coverage scope (which states/counties/ZIPs this source applies to) must be
#     declared here before the adapter runs. The engine checks coverage scope before
#     activating any source for a given ZIP — this is what prevents a Utah planning
#     feed from appearing on a Texas page (the bug found in the 78617 case study).
#   • Anti-fabrication: every site emitted by any adapter must carry a record_url
#     pointing to the official public record. A field the source doesn't state is
#     ABSENT on the site — never defaulted, never inferred.
#   • Quarantine, don't stop: a source that errors for one ZIP logs and skips.
#     It never stops the batch and never fabricates to fill a gap.
#   • Additive only: adding a new source never changes existing source behavior.
#
# STATUS VALUES:
#   live      — wired in the engine, running in production
#   planned   — spec complete, adapter not yet built
#   research  — evaluated, useful, needs Step-0 pin before work starts
#   deferred  — valid but lower priority; revisit after higher-priority sources land
#
# COUNTS IN THE sites[] SCHEMA:
#   scope:"point"  facilities  → counts.facilities
#   scope:"point"  development → counts.development  (permits, licenses)
#   scope:"area"   any         → counts.development
#
# CASE STUDY REFERENCE: docs/case-study-78617-caldwell-gap-analysis.md
# The Drey Dossier investigation (youtube.com/watch?v=Lh_0v3nuczE) used sources
# marked [CASE STUDY] below. The 78617 before/after is the acceptance test for
# any source in that set.

---

## TIER 1 — National EPA Floor (live everywhere, free, no coverage scoping needed)

These activate for every ZIP in every state. They are the baseline guarantee:
every ZIP ships at least a facilities view even with zero enrichment sources.

---

### EPA FRS — Facility Registry Service
- **Status:** LIVE
- **What it covers:** The master list of all facilities registered with EPA —
  industrial, energy, logistics, water treatment, and more. Every facility that
  reports to any EPA program appears here. FRS is the canonical source of
  "this facility exists at this address."
- **Why it matters:** National, free, covers every ZIP. The floor that makes
  the "empty is valid, not broken" guarantee possible.
- **API:** EPA EnviroFacts REST
  `https://data.epa.gov/dmapservice/frs.frs_program_facility/zip_code/equals/{zip}/JSON`
  Also queryable by lat/lng bounding box for address mode.
- **Record URL template:** `https://echo.epa.gov/detailed-facility-report?fid={registry_id}`
- **Schema mapping:**
  ```
  label       ← fac_name
  scope       = "point"
  type        = "built"
  layer       ← naics_code / sic_code (classify in facilityType())
  lat         ← latitude83
  lng         ← longitude83
  src         = "EPA FRS · registry {registry_id}"
  record_url  ← echo.epa.gov/detailed-facility-report?fid={registry_id}
  registry_id ← registry_id
  ```
- **Coverage scope:** `{national: true}` — all ZIPs, all states
- **counts bucket:** `facilities`
- **Notes:** Duplicate registry IDs at the same coordinate are real (multiple
  program registrations for one physical site). Cluster same-coordinate markers
  in the UI; do not deduplicate in the engine.

---

### EPA ECHO — Enforcement and Compliance History Online
- **Status:** LIVE (v19 — real per-facility compliance geo-matched onto FRS sites)
- **What it covers:** Compliance inspection history, violations detected,
  enforcement actions, and penalties assessed at EPA-regulated facilities.
  ECHO is the source of the `env.epa` block (and the legacy `viol` count) on each facility.
- **Why it matters:** Turns a facility pin into "1 open water violation (2024)" /
  "6 of last 12 quarters out of compliance (EPA)". The factual, interpreted status
  + link is the legal framing (source-of-truth §10): a fact, not a verdict.
- **API (v19, STEP-0 verified 2026-07-11 via pg_net — reachable + free + no key):**
  ONE `get_facilities → get_qid` pair per report, keyed on lat/lng/radius, returns
  every ECHO facility near the point WITH its compliance summary, keyed on RegistryID.
  `https://echodata.epa.gov/echo/echo_rest_services.get_facilities?output=JSON&p_lat=&p_long=&p_radius=`
  `https://echodata.epa.gov/echo/echo_rest_services.get_qid?output=JSON&qid=&responseset=`
  Rich per-facility drill-down (Permits[] by statute):
  `https://echodata.epa.gov/echo/dfr_rest_services.get_dfr?output=JSON&p_id={registry_id}`
  (Prior EnviroFacts / echo_violation_counts table remains a best-effort fallback.)
- **Record URL template:** `https://echo.epa.gov/detailed-facility-report?fid={registry_id}`
- **Schema mapping (v19):** Enriches existing FRS sites — joins on `registry_id`
  (reuse the `frsRid()` hook) and adds
  `env = { link_type:"geo_matched", epa:{ in_violation:[statute codes currently in
  violation], snc, quarters_nc, inspections, action_year, penalty_count, current_as_of } }`.
  Also keeps the legacy `viol` (= # open violations) for back-compat. Interpreted into
  one plain-language line client-side (the shared env render helper). Never creates rows.
  Absent stays absent (a violation year appears ONLY from a real ECHO action date).
- **Schema mapping (v21 — ICIS-NPDES permit status, STEP-0 verified 2026-07-17 via pg_net):**
  a second, CWA-service `get_facilities → get_qid` pair per report (same lat/lng/radius key)
  `https://echodata.epa.gov/echo/cwa_rest_services.get_facilities?output=JSON&p_lat=&p_long=&p_radius=`
  `https://echodata.epa.gov/echo/cwa_rest_services.get_qid?output=JSON&qid=&qcolumns=1,2,9,11,51,54&responseset=500`
  (qcolumns pinned against `cwa_rest_services.metadata`: CWPName, SourceID, RegistryID,
  Statute, CWPPermitStatusDesc, CWPPermitTypeDesc). Joins on RegistryID and adds, onto
  `env.epa`: `permits:[{npdes_id, statute, status, type}]` (every NPDES permit on the FRS id,
  verbatim), `permit_status` (the most-active status by precedence Effective → Admin
  Continued → Expired → Pending → Not Needed → Retired → Terminated; ECHO's verbatim string
  is "Admin Continued") and `compliance_tracking_on` (true only for Effective / Admin
  Continued / Expired — ECHO still counts Expired as active). An unknown/blank status stamps
  NOTHING. Receipt: DALFEN INDUSTRIAL FRS 110071346495 → CWPPermitStatusDesc "Terminated"
  (NPDES TXR1538KZ). This is the honest core of the regulated-facilities-entity build: a
  Terminated/Retired/Pending permit's zero-violation counts reflect an UNTRACKED permit and
  are never rendered as a verified clean history (the page shows the tracking-off caveat).
- **Coverage scope:** `{national: true}`
- **counts bucket:** enrichment only (no new count)
- **Legal framing (§10, standing answer):** Render the interpreted fact ("N open
  <statute> violation(s)") + the ECHO link. Never "illegal," "criminal," or "dangerous."

---

### TCEQ Central Registry — Texas state environmental records  [CASE STUDY]
- **Status:** LIVE (v19 — RN geo-matched onto FRS/ECHO facilities; TX-coverage-gated)
- **What it covers:** The state analog of EPA ECHO/FRS — every entity TCEQ regulates
  in Texas (its Regulated-Entity number, RN) and the state programs it is registered
  for: stormwater (STORM), petroleum storage tanks (PSTREG), leaking-tank cleanup
  (LPSTRMD/LUST), industrial & hazardous waste (IHW), municipal solid waste (MSW),
  voluntary cleanup (VCP), air (AIRNSR/AQNP), wastewater (WWPERMIT/WQNP), and more.
- **Why it matters:** Adds the state layer a federal-only view misses — an underground
  fuel tank, a voluntary-cleanup enrollment, or a construction stormwater permit
  (a progress milestone). Dedupes onto the FRS facility at the same site so it renders
  ONCE with both the federal (ECHO) and state (TCEQ) badges, never twice.
- **API (STEP-0 verified 2026-07-11 via pg_net — reachable + free + no key):**
  Texas Open Data Portal (Socrata), five regional Central Registry datasets, queryable
  by ZIP/county via SoQL and bulk-downloadable:
  `https://data.texas.gov/resource/{dataset}.json?re_phys_loc_addr_zip={zip}&$limit=2000`
  Datasets: Central Texas `msah-s2rv` (Travis/Austin), North Texas `5eqq-7nad`,
  DFW `t34q-qzi3`, Coastal & East `tzyg-j7q4`, Border & Permian `9iad-hrn8`.
  Fields: `ref_num_txt` (the RN), `reg_ent_name`, full physical address incl.
  `re_phys_loc_addr_county`/`_zip`, `program_code`, `reg_ent_status_txt`.
  **No lat/lng column** → geo-match is NOT by geocoding (no paid service): the adapter
  DEDUPES each RN onto an FRS facility the engine already placed (siteKey = house# +
  street word + ZIP, AND a shared name token — precision over recall, verified against
  real 78617 data to reject same-address false positives like AutoZone↔parkade), and the
  matched site reuses the FRS facility's own coordinate.
- **Record URL:** the RN's official TCEQ Central Registry record. The RN string is
  displayed (directly verifiable) and links to the official CR query
  `https://www15.tceq.texas.gov/crpub/`. *(A byte-exact RN deep-link is a follow-up —
  the crpub app is session/POST-based; a GET deep-link did not resolve in Step 0.)*
- **Schema mapping (v19):** Enriches existing FRS/ECHO sites — adds `tceq_rn`,
  `tceq_url`, and `env.tceq = { programs:[program_code…], status, name }`. Interpreted
  into a plain-language line client-side. Never creates rows. Absent stays absent.
- **Coverage scope:** `{state:"TX"}` — the source never runs for a non-TX ZIP. Widening
  to another TX county = add one `TX_COUNTY_DATASET` entry (pure data); an unmapped TX
  county quarantines with a note (facilities-only is valid), never a guess.
- **counts bucket:** enrichment only (no new count)
- **Legal framing (§10):** Render the factual program on record ("petroleum storage
  tank on record", "enrolled in a state cleanup program") + the RN. Never a verdict.
- **Scope note:** ECHO + Central Registry only for this build. Individual program
  drill-downs (TPDES detail, PST/LUST detail, VCP status pages) are a later build,
  held to the same labeling bar — not wired now.

---

### EPA TRI — Toxics Release Inventory
- **Status:** PLANNED
- **What it covers:** Annual self-reported toxic chemical releases and waste
  management activities at industrial and federal facilities. Covers 650+
  chemicals. Reports quantities released to air, water, land, and underground
  injection, plus off-site transfers. Updated annually (new data published
  ~July each year for the prior calendar year).
- **Why it matters:** The difference between "industrial facility" and "this
  plant releases X lbs of formaldehyde into the air annually." The highest-
  value enrichment layer for residents worried about what's near their home.
  Also catches facilities that don't appear in FRS because they only exceed
  TRI thresholds (not FRS registration thresholds).
- **API:** EPA EnviroFacts REST (same base URL as FRS/SEMS)
  `https://data.epa.gov/dmapservice/tri.tri_facility/zip_code/equals/{zip}/JSON`
  Chemical release detail:
  `https://data.epa.gov/dmapservice/tri.tri_releases/zip_code/equals/{zip}/JSON`
- **Record URL template:**
  `https://enviro.epa.gov/facts/tri/ef-facilities.html?facility_uin={trifid}`
  Or: `https://echo.epa.gov/detailed-facility-report?fid={registry_id}` (if FRS-linked)
- **Schema mapping:**
  ```
  label       ← facility_name
  scope       = "point"
  type        = "built"
  layer       ← classify from primary_naics (same facilityType() logic)
  lat         ← latitude
  lng         ← longitude
  src         = "EPA TRI · {reporting_year}"
  record_url  ← enviro.epa.gov URL above
  # Extension fields (§4.1):
  scope_text  ← top chemicals released, formatted:
                "Released {total_air_releases} lbs to air,
                 {total_water_releases} lbs to water ({reporting_year})"
  ```
- **Coverage scope:** `{national: true}`
- **counts bucket:** `facilities` (if new site not already in FRS);
  enrichment (if FRS-linked — add `tri_releases` sub-field)
- **Step-0 pin:** Confirm the EnviroFacts TRI table names and column schema
  against the live API before building the adapter. Pin the reporting year
  used (most recent available). Data liberation note: TRI data is also
  available as annual CSV bulk downloads — useful for seeding a local cache.
- **Anomaly flag opportunity:** `est_cost` equivalent is `total_releases`
  (lbs/year). Flag outliers (>99th percentile for the facility's NAICS code)
  as a signal for reporters. Same pattern as the TABS cost/sqft flag.

---

### EPA SEMS — Superfund Enterprise Management System
- **Status:** PLANNED
- **What it covers:** Hazardous waste site assessment and remediation data
  from 1983 to present. Includes proposed, current, and deleted National
  Priorities List (NPL) sites — the most contaminated locations in the US —
  plus non-NPL sites being assessed, contaminants recorded at each site,
  responsible parties, and remediation status.
- **Why it matters:** A Superfund site within a mile of someone's home is the
  single most important thing to surface. These are federally designated
  contamination sites, often with decades of history. Non-NPL sites (assessed
  but not listed) are nearly as important and less well-known.
- **API:** EPA EnviroFacts REST
  `https://data.epa.gov/dmapservice/sems.envirofacts_site/zip_code/equals/{zip}/JSON`
  With contaminants join:
  `.../sems.envirofacts_site/left/envirofacts_contaminants/site_id/equals/fk_site_id`
  NPL status filter: add `/npl_flag/equals/Y` for NPL-only
- **Record URL template:**
  `https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.Cleanup&id={sems_id}`
- **Schema mapping:**
  ```
  label       ← site_name
  scope       = "point"
  type        ← npl_status:
                  "FINAL NPL"    → "built" (active cleanup)
                  "PROPOSED NPL" → "proposed"
                  "DELETED NPL"  → "built" (remediated — note in scope_text)
                  non-NPL        → "approved" (under assessment)
  layer       = "superfund"      (new layer value — add to LAYER_LABEL)
  lat         ← latitude
  lng         ← longitude
  src         = "EPA Superfund (SEMS)"
  record_url  ← cumulis.epa.gov URL above
  # Extension fields:
  scope_text  ← contaminants list (verbatim from record, top 5)
  status_text ← npl_status verbatim
  ```
- **Coverage scope:** `{national: true}`
- **counts bucket:** `facilities` (Superfund sites are operating/active real-
  world locations, not development notices)
- **Priority note:** This is the highest-resident-impact source not yet live.
  Build before FAA/NRC/RCRAInfo.
- **Legal framing (§10):** "EPA-designated Superfund site" is a factual
  federal classification, not an editorial claim. Render the NPL status +
  contaminants list verbatim from the record. Never render cleanup prognosis
  or health risk beyond what the official record states.

---

## TIER 2 — Federal Specialized Sources (national, targeted facility types)

These activate for every ZIP but only return results when the relevant
facility type is present. Lower density than Tier 1 but high signal value
for specific story types.

---

### USDA APHIS — Animal Welfare Act Registrations and Inspections  [CASE STUDY]
- **Status:** PLANNED
- **What it covers:** All facilities licensed or registered under the Animal
  Welfare Act — research labs, zoos, breeders, exhibitors, dealers. Includes
  facility registration (name, address, certificate number, license type),
  inspection reports (date, violations, inspected species, full citation text),
  and annual animal use reports (species counts and procedures at research
  facilities). The Drey Dossier used APHIS to confirm Neuralink held 13 rhesus
  macaques and 3 rabbits at 2200 Caldwell Ln as of Feb 2026.
- **Why it matters:** Research labs holding primates, dogs, or cats are
  categorically different from logistics warehouses and should be surfaced as
  such. Inspection violations here are animal welfare failures with full
  citation text — far more reporter-relevant than an EPA paperwork violation.
- **API / Access:**
  Public Search Tool: `https://aphis.my.site.com/PublicSearchTool/s/`
  (Salesforce-based, no documented REST API — scrape or use the Data
  Liberation Project CSV as the ingest source)
  Data Liberation Project bulk data (recommended for initial ingest):
  `https://github.com/data-liberation-project/aphis-inspection-reports`
  CSV fields: customerNumber, certNumber, siteName, inspectionDate,
  violationsCount, species list, citation text, inspectionReportUrl
- **Record URL template:**
  `https://aphis.my.site.com/PublicSearchTool/s/inspection-reports`
  (individual report URLs from the Data Liberation Project `web_reportLink` field)
- **Schema mapping:**
  ```
  label       ← siteName (facility name as registered)
  scope       = "point"
  type        = "built"
  layer       = "animal-facility"
  lat/lng     ← geocode from facility address (no coordinates in the dataset)
  src         = "USDA APHIS · AWA cert {certNumber}"
  record_url  ← web_reportLink (most recent inspection report PDF URL)
  # Extension fields:
  owner       ← customerName
  status_text ← "AWA {licenseType} · {certNumber}"
  scope_text  ← species inspected, e.g. "Rhesus Macaque (13), Rabbit (3)"
  viol        ← sum of directNonCompliant + criticalNonCompliant (most recent inspection)
  violUrl     ← web_reportLink (same as record_url — the inspection report is the source)
  ```
- **Coverage scope:** `{national: true}` — AWA is federal
- **counts bucket:** `facilities`
- **Step-0 pin:** Download the Data Liberation Project CSV and commit a sample
  (Travis County, TX rows) as a fixture. Confirm the address field geocodes
  via the existing Census path. Pin the CSV vintage date.
- **Animal inventory note:** APHIS temporarily removed species counts from
  inspection reports in 2025 during a data review. Annual use reports (the
  source of the 13-macaque figure) are available separately. Monitor for
  reinstatement of inspection-level inventory data.
- **Entity link value:** APHIS certificate numbers and customer numbers are
  stable entity identifiers. A facility that appears in both APHIS (animal
  research) and TABS (construction permits) at the same address is a strong
  entity signal — exactly the Caldwell Lane pattern.

---

### FAA — Airport and Helipad Registrations
- **Status:** RESEARCH
- **What it covers:** All registered aviation facilities in the US including
  private-use airstrips and helipads. Even private, non-commercial pads
  require FAA registration with owner name, address, facility type, and
  coordinates. A large private campus with a helipad is a meaningful signal
  that most public records tools don't surface.
- **Why it matters:** Private helipads and airstrips are rare enough to be
  significant when present. A biotech or research campus with its own helipad
  signals scale and security posture that permits alone don't show.
- **API:** FAA ArcGIS Open Data (free, no auth)
  Airports feature service:
  `https://adds-faa.opendata.arcgis.com/datasets/e747ab91a11045e8b3f8a3efd093d3b5_0/api`
  Query by bounding box:
  `...FeatureServer/0/query?geometry={bbox}&geometryType=esriGeometryEnvelope&f=json`
  FAA Data Portal: `https://data.faa.gov`
- **Record URL template:**
  `https://adip.faa.gov/agis/public/#/airportDetails/{site_number}`
- **Schema mapping:**
  ```
  label       ← fac_name + " (" + type_code + ")"
                type_code: HP = helipad, A = airport, B = balloonport, etc.
  scope       = "point"
  type        = "built"
  layer       = "aviation"      (new layer value)
  lat/lng     ← lat_decimal, long_decimal
  src         = "FAA · {loc_id}"
  record_url  ← adip.faa.gov URL above
  # Extension fields:
  owner       ← owner_name
  owner_addr  ← owner_city + ", " + state_code
  status_text ← "FAA {type_code} · {act_code}" (act_code: O=open, C=closed)
  ```
- **Coverage scope:** `{national: true}` — filter to private-use types
  (type_code: HP, H, UH) and private-use airports; exclude major commercial
  airports (they add noise, not signal, for residential use)
- **counts bucket:** `facilities`
- **Step-0 pin:** Confirm the ArcGIS feature service URL and field names
  against the live endpoint. The FAA publishes the full airport/facility
  directory as a bulk download — may be faster than live queries for national
  coverage.

---

### EPA RCRAInfo — Hazardous Waste Handlers
- **Status:** RESEARCH
- **What it covers:** All generators, transporters, treaters, storers, and
  disposers of hazardous waste who report to state environmental agencies.
  Catches facilities that handle hazardous materials below TRI reporting
  thresholds — smaller operations that still generate regulated waste.
- **Why it matters:** A facility generating hazardous waste near a home that
  doesn't appear in TRI (below the reporting threshold) still appears here.
  Underground storage tanks (USTs) are also tracked — leaking USTs are a
  common contamination source.
- **API:** EPA EnviroFacts REST (same base as FRS/TRI/SEMS)
  `https://data.epa.gov/dmapservice/rcra.rcra_handler/zip_code/equals/{zip}/JSON`
  Also: RCRAInfo Web direct search at `https://rcrainfo.epa.gov/rcrainfoprod/action/secured/login`
- **Record URL template:**
  `https://echo.epa.gov/detailed-facility-report?fid={registry_id}` (if FRS-linked)
  or `https://rcrainfo.epa.gov/rcrainfoprod/...` (RCRAInfo direct)
- **Schema mapping:** Similar to TRI — new facility rows where not already in
  FRS, otherwise enrichment. `scope_text` ← handler activity description.
- **Coverage scope:** `{national: true}`
- **counts bucket:** `facilities`
- **Priority:** Lower than TRI/SEMS/APHIS — significant overlap with FRS.
  Build after those three land.

---

### NRC — Nuclear and Radioactive Materials Licenses
- **Status:** RESEARCH  
- **What it covers:** Licenses for medical, industrial, and academic uses of
  radioactive materials — more than 20,000 active licenses in the US. Research
  labs, hospitals, certain manufacturing facilities, and universities hold
  these. Also covers nuclear power reactors and fuel facilities (much rarer,
  higher impact).
- **Why it matters:** A biotech or neuroscience research facility using
  certain imaging or sterilization equipment may hold an NRC materials license
  that signals the nature of the research. A nuclear facility near a home is
  extremely high-stakes information.
- **API:** NRC ADAMS Public Search API (launched Dec 2025, replaced WBA API)
  Developer portal: `https://adams-api-developer.nrc.gov/`
  Facility locator: `https://ww2.nrc.gov/info-finder`
  Materials licenses by state: `https://www.nrc.gov/info-finder/materials/index`
  Note: NRC also has Agreement States that administer their own materials
  license programs — TX is an Agreement State (Texas Commission on Environmental
  Quality, TCEQ, administers materials licenses in TX).
- **Record URL template:** NRC facility profile URL (varies by facility type)
- **Coverage scope:** `{national: true}` for NRC-administered licenses;
  per-state for Agreement State licenses (TX → TCEQ, etc.)
- **Step-0 pin:** The ADAMS API requires registration. Pin the subscription
  process and confirm address/location query capability before building.
  Agreement State coverage is a separate adapter per state.
- **counts bucket:** `facilities`
- **Priority:** Deferred until APHIS and SEMS land — NRC facilities are rare
  enough that the marginal coverage is low for most ZIPs.

---

### EPA SDWIS — Safe Drinking Water Information System
- **Status:** DEFERRED
- **What it covers:** Public water systems and their violations. Tracks
  contaminant violations, health-based violations, and monitoring failures at
  community water systems, non-transient non-community systems, and transient
  systems.
- **Why it matters:** When a contamination source (Superfund, TRI, RCRA) is
  near a municipal intake or well field, SDWIS closes the loop: does the
  drinking water system serving this ZIP have violations?
- **API:** EPA EnviroFacts / SDWIS
  `https://data.epa.gov/dmapservice/sdw.sdw_viol_by_fac/zip_code/equals/{zip}/JSON`
- **Coverage scope:** `{national: true}`
- **counts bucket:** `development` (violations are active regulatory events)
- **Priority:** Deferred — most valuable in combination with SEMS/TRI
  (contamination source + downstream water impact). Build after those land.

---

## TIER 3 — State/Jurisdiction Permit Sources (per-state enrichment)

These activate only for ZIPs in the covered state/jurisdiction. Each one
requires its own Step-0 pin (interface + vintage). Coverage declaration is
MANDATORY before the adapter runs — this is the structural fix for the
Utah-notice-in-Texas bug.

Rule: `if (!source.covers(zip.state, zip.county)) continue;`
No exceptions. A source without a `covers` declaration does not run.

---

### TX TDLR/TABS — Texas Department of Licensing and Regulation  [CASE STUDY]
- **Status:** LIVE (registry mode, Travis pins). Deployed in `get-address-report` v16
  (2026-07-10); the 78617 live refresh cached all 5 Caldwell filings (counts
  facilities 29 / development 5 / civic 1, tabs_quarantined []), and a UT-ZIP
  spot-check (84302) ran 0 TABS fetches — the coverage gate held.
- **What it covers:** All construction and tenant improvement projects
  requiring architectural barriers compliance review in Texas. Filed by
  project — each record carries owner name, owner address, owner phone,
  contact person, design firm, estimated cost, square footage, scope of work,
  and project status. The entire Drey Dossier investigation ran on this source.
- **Why it matters:** Shows what's being built, by whom, and for what purpose
  — none of which appears in EPA data. The owner phone and contact name fields
  are the entity-linking backbone (River Bottoms Ranch LLC ↔ Neuralink linked
  by shared phone 813-758-6679).
- **Adapter:** `sources/tdlr-tabs.ts` (built, smoke-tested)
- **Runbook:** `docs/tdlr-tabs-adapter-runbook.md`
- **Registry pin:** `docs/pins/tdlr-tabs-projects.travis.json`
  (Travis County seed — 5 verified Caldwell project numbers)
- **API / Access:** Registry mode: fetch individual project pages at
  `https://www.tdlr.texas.gov/TABS/Projects/{project_no}`
  Search mode: TABS public search (Step-0 pin required before use)
- **Record URL template:**
  `https://www.tdlr.texas.gov/TABS/Projects/{project_no}`
- **Schema mapping:** See `sources/tdlr-tabs.ts` — full §4.1 extension fields, plus:
  ```
  filed_by    ← PERSON FILING FORM → Contact Name (fixture-verified section, distinct
                from the OWNER block's Contact Name; a new §4.1 extension field).
                Feeds the entity matcher as kind='filer' — Jeff Gutknecht filed all
                three River Bottoms Ranch permits at 2200 Caldwell Ln.
  ```
- **Coverage scope:**
  ```
  covers:
    - state: TX
  ```
- **counts bucket:** `development`
- **Case study acceptance test:** Refreshing the Travis County registry must
  yield 5 sites at 2200 Caldwell Ln with entity links connecting River Bottoms
  Ranch LLC ↔ Neuralink via phone 8137586679. See runbook §2.

---

### UT PMN — Utah Planning and Zoning Notices
- **Status:** LIVE
- **What it covers:** County-level planning hearing notices in Utah — zoning
  changes, conditional use permits, subdivision approvals, public comment
  windows. Jurisdiction-level (county/city-wide, no fixed address).
- **Why it matters:** The original enrichment source that proved the pattern.
  Area-scope items: listed, not pinned. Synthetic placement with honest
  "representative, not exact" disclaimer.
- **Coverage scope:**
  ```
  covers:
    - state: UT
  ```
  IMPORTANT: This source MUST NOT activate for non-Utah ZIPs. The 78617
  case study found a Travis County, TX civic notice with Box Elder, UT
  coordinates — caused by the engine's geocoder defaulting to Utah. Fix:
  the coverage check prevents this at the source level, regardless of what
  the geocoder returns. If the ZIP is not in Utah, PMN does not run.
- **counts bucket:** `development`
- **Geocoder fix (standing answer):** Area-scope records from jurisdiction
  feeds must have their lat/lng NULLED if the geocoder cannot confidently
  place them within the covered jurisdiction's bounding box. An area record
  with coordinates 859 miles away is worse than no coordinates — null it,
  let the page use synthetic placement.

---

### [TEMPLATE] — Adding a New State Permit Source

Copy this block for each new state. Fill every field before writing code.

```
### {STATE} {AGENCY} — {SYSTEM NAME}
- **Status:** RESEARCH
- **What it covers:** {plain English — what types of records, what fields}
- **Why it matters:** {the reporter or resident use case}
- **API / Access:** {URL, method, auth requirements, rate limits}
  Step-0 pin required: capture interface + vintage into
  docs/pins/{state}-{system}-search.md before search mode activates.
- **Record URL template:** {stable URL pattern per record}
- **Schema mapping:**
  ```
  label       ← {source field}
  scope       = "point" | "area"
  type        = "built" | "approved" | "proposed"
  layer       ← {classification logic}
  lat/lng     ← {source field or geocode path}
  src         = "{STATE} {AGENCY} · {id field}"
  record_url  ← {URL template}
  # Extension fields (§4.1 — only fields the source actually states):
  owner       ← {field}
  owner_phone ← {field}
  ...
  ```
- **Coverage scope:**
  covers:
    - state: {XX}
    - county: {name}   (if county-specific)
- **counts bucket:** development | facilities
- **Step-0 checklist:**
  - [ ] Fetch ≥3 real record pages and commit as fixtures
  - [ ] Run parser against fixtures; all acceptance fields pass
  - [ ] Confirm record URL is stable (doesn't change after status change)
  - [ ] Confirm robots.txt / ToS permits automated access
  - [ ] Pin interface URL + vintage in docs/pins/
  - [ ] Coverage scope declared above (this block) before adapter runs
```

---

## TIER 4 — Entity and Cross-Reference Sources

These don't produce map markers directly. They feed the entity graph
(docs/case-study-78617-caldwell-gap-analysis.md §4.4) and address dossier.

---

### State Corporate Registries — LLC / Corporation Ownership
- **Status:** DEFERRED
- **What it covers:** Registered agents, incorporators, and officers for LLCs
  and corporations. The "River Bottoms Ranch LLC registered in California,
  operated in Texas" thread — the California SOS registry would show the
  registered agent for River Bottoms Ranch LLC, potentially linking it to
  Neuralink officers or addresses.
- **Why it matters:** Entity links through phone/contact/address are strong
  but short-range. Corporate registry links extend the chain: LLC → registered
  agent → parent company.
- **Access:** Varies by state. Most states have a public business search with
  no API. Some states publish bulk data (CA, DE, NY).
  - California SOS: `https://bizfileonline.sos.ca.gov/search/business`
  - Texas SOS: `https://www.sos.state.tx.us/corp/sosda/index.shtml`
  - OpenCorporates (aggregator, coverage 130+ jurisdictions):
    `https://api.opencorporates.com/` (free tier available)
- **Coverage scope:** Per-state; OpenCorporates covers national
- **counts bucket:** entity graph enrichment only — no map markers
- **Priority:** Medium. The entity graph (§4.4) should land first; this
  enriches it. OpenCorporates is the fastest path to national coverage.

---

### OSHA — Workplace Safety Inspections
- **Status:** RESEARCH
- **What it covers:** OSHA inspection records for workplace safety violations
  at industrial, manufacturing, and construction sites. Includes inspection
  date, violation type, penalty amount, and citation text.
- **Why it matters:** A facility with OSHA violations signals operational
  conditions beyond what EPA tracks. Particularly relevant for construction
  sites (TABS records) — a construction project with OSHA safety violations
  is a different story than one without.
- **API:** OSHA Enforcement Data
  `https://enforcedata.dol.gov/views/data_summary.php`
  Bulk data: `https://www.osha.gov/pls/imis/establishment.html`
  Also available via the EnviroFacts-adjacent DOL data API.
- **Coverage scope:** `{national: true}`
- **counts bucket:** enrichment on existing sites (add `osha_viol` count +
  `oshaUrl` field, parallel to `viol` / `violUrl` from ECHO)
- **Priority:** Medium — most valuable as enrichment on TABS/construction
  records. Build after TABS adapter is fully live.

---

## Source Count Summary

| Tier | Source | Status | Coverage | counts bucket |
|------|--------|--------|----------|---------------|
| 1 | EPA FRS | LIVE | National | facilities |
| 1 | EPA ECHO | LIVE | National | enrichment |
| 3 | TCEQ Central Registry | LIVE | TX only | enrichment |
| 1 | EPA TRI | PLANNED | National | facilities |
| 1 | EPA SEMS (Superfund) | PLANNED | National | facilities |
| 2 | USDA APHIS | PLANNED | National | facilities |
| 2 | FAA Facilities | RESEARCH | National | facilities |
| 2 | EPA RCRAInfo | RESEARCH | National | facilities |
| 2 | NRC Materials | RESEARCH | National | facilities |
| 2 | EPA SDWIS | DEFERRED | National | development |
| 3 | TX TDLR/TABS | LIVE | TX only | development |
| 3 | UT PMN | LIVE | UT only | development |
| 4 | State Corp Registries | DEFERRED | Per-state | entity graph |
| 4 | OSHA Inspections | RESEARCH | National | enrichment |

**Build order (recommended):**
1. TX TDLR/TABS — Step-0 fixtures + integration (the case-study proof)
2. EPA SEMS — highest resident-impact, same EnviroFacts API already wired
3. EPA TRI — same API, high reporter value
4. USDA APHIS — Data Liberation Project CSV, fastest new-source ingest
5. FAA — ArcGIS open data, no auth required
6. EPA RCRAInfo — same API, fills in below-TRI-threshold facilities
7. OSHA — enrichment on TABS records
8. NRC — Agreement State complexity, lower density
9. State Corp Registries — entity graph enrichment, OpenCorporates first
10. EPA SDWIS — most valuable in combination with SEMS/TRI

---

## Standing Rules for Claude Code (read before any source work)

1. **Check this registry first.** If a source isn't here, add it before
   writing code. If it's here, read the full entry — especially the
   coverage scope and Step-0 checklist.

2. **Coverage scope is mandatory.** Every source entry must declare `covers`
   before its adapter runs in production. The engine enforces:
   `if (!source.covers(zip.state, zip.county)) continue;`
   No source runs on a ZIP it doesn't cover. No exceptions.

3. **Step-0 before search mode.** Registry mode (committed project/record
   number list) is always available. Search mode (querying the source's
   own search interface) requires the Step-0 pin documented in
   `docs/pins/{source}-search.md`. An adapter throws in search mode until
   the pin exists.

4. **Additive only.** A new source adapter is a new branch in the engine.
   It never modifies how existing sources work. If adding it requires
   changing existing source behavior, that's a §12 stop.

5. **Every site needs a record_url.** No exceptions. A site without one
   fails the anti-fabrication gate in the verifier and is dropped.

6. **Absent fields stay absent.** A field the source doesn't state is not
   on the site object. Never default, never infer, never interpolate.

7. **Quarantine, don't stop.** Any per-record or per-ZIP error: log it to
   the quarantine list, skip the record, continue the batch.

8. **counts bucket is declared here.** Don't invent a new bucket. If the
   right bucket isn't clear, add a note here and ask before building.

---

## ArcGIS FeatureServer (generic connector) — `sources/arcgis.ts`

The Esri twin of the Socrata connector: one connector for every ArcGIS/AGO FeatureServer
permit/case layer; coverage grows by appending a `jurisdiction-registry.json` `arcgis` entry
(see `_arcgis_readme` there for the entry schema). Same five rules, same NormalizedRecord
shape, same run report (`arcgis_reports` in the engine response). Entry-driven `extra_where`
(verbatim SQL, ANDed into every query) scopes out non-development rows at source.
Built + unit-tested offline + deployed 2026-07-13 (get-address-report version 31, via the
deploy-edge-functions.yml CLI workflow).

### slc-planning-petitions — Salt Lake City `Planning_Petition` (LIVE)
- **API:** `https://services.arcgis.com/mMBpeYj0vPFotzbe/arcgis/rest/services/Planning_Petition/FeatureServer/0`
  (Salt Lake City's own AGO org — found via the gis-slcgov site-scoped DCAT + org service
  enumeration; NOTE the lookalike hits "Building_Permits" (Brampton, ON) and SGID
  "Building Permit latest" (Atlanta, GA) are mislabeled foreign data and were rejected).
- **Coverage:** UT / Salt Lake. **counts bucket:** development.
- **What it is:** 3,113 planning petitions (Conditional Use, Zoning Amendment, subdivisions,
  planned developments, demolitions …) with per-parcel POINT geometry, `ZIPCODE` (12 modeled
  SLC ZIPs), and a per-record official Accela link (`aca.slcgov.com … CapDetail.aspx`) = the
  anti-fabrication record_url.
- **Statuses (VERBATIM, queried 2026-07-13):** Active / Additional Information / Accepted /
  Pre-screen / In Progress → proposed; Approved → approved; **Closed → exclude** (carries no
  outcome; mapping it would fabricate one).
- **extra_where:** drops administrative paperwork subtypes (Zoning Verification Letter,
  Administrative Interpretation, appeals, determinations — 658 rows) at source.
- **Verified live end-to-end:** 12/12 SLC ZIPs emit arcgis point records (570 total; e.g.
  84103 = 132), 0 unsourced, 0 quarantined, and the coverage gate held (84302 UT + 78617 TX
  → 0 arcgis fetches). Re-cached through v31; `app_projects` now carries per-parcel Salt Lake
  development rows (448, 100% with coords, each linked to its Accela record).

### provo-planning-applications — Provo `CurrentProjects/Planning Application` (LIVE)
- **API:** `https://gispublicweb.provo.gov/ArcGIS/rest/services/DevServ/CurrentProjects/MapServer/0`
  (Provo City's OWN authoritative ArcGIS Server, folder `DevServ`, service `CurrentProjects` —
  serviceDescription "Current projects for planning and building permits", SR wkid 3566 = Utah
  Central State Plane, confirming Utah. NOTE the lookalike hit `services6.arcgis.com/ONZht79c…/
  Building_Permits` is **Canadian census data** (2016_Census_CD_CSD, Ward_Boundary_2018_2022) and a
  geometry-less Table — rejected. Ogden's `EnerGov` folder exposes only Parcels/AddressPoints, no
  permit-record layer — rejected. West Jordan's AGO org (owner trey.olson) has only parks/trails
  apps — rejected.)
- **Coverage:** UT / Utah (county). **counts bucket:** development. **Layer 0 only** (Planning
  Application, 198 current land-use cases). **Layer 1 (Building Permits) intentionally NOT wired** —
  a 67,002-row historical archive dominated by Closed/Legacy Closed/Expired; wrong signal for a
  "what's changing" view.
- **What it is:** 198 current planning applications (rezones, subdivisions, planned developments,
  conditional uses …) with per-parcel POINT geometry, `PAName` (project name), `PermitNumber`
  (e.g. PLRZ20260221), `Address`, `StatusDescription`, `DateReceived`. Real records verified live:
  "Stadium View Subdivision" (Planning Commission), "Vesper Amphitheater Rezone" (Council),
  "Courtyard at Jamestown Expansion" (Monitoring Conditions) — points at real Provo coords
  (−111.68, 40.26).
- **ZIP scoping — `zip_where_template` (NEW connector capability):** the layer has NO ZIP column,
  but every Address carries "…, UT 84604". The entry sets
  `zip_where_template: "…_Address LIKE '%UT {zip}%'"`, a generic, additive connector option used as
  the ZIP clause instead of `{zip_col}='{zip}'` (the point geometry still supplies the precise
  location). Verified distribution: 84601=82, 84604=72, 84606=40 (194/198). A non-Provo Utah-County
  ZIP (e.g. Lehi 84043) matches 0 rows in Provo's own layer, so the county-scoped entry never leaks
  another city's records — the ZIP-in-address filter IS the city scope.
- **Statuses (VERBATIM, queried 2026-07-13):** Approved / Monitoring Conditions / Awaiting Signatures
  → approved; Open / Complete Application / Incomplete Application / Under Review / Reviews Complete /
  Pending / Waiting for Revisions / Waiting for Submittals / Waiting for Conditions / Waiting for
  Appeal / Planning Commission / Council / Heritage Board → proposed. (The layer holds only CURRENT
  cases — no Closed/Denied to exclude, unlike SLC.)
- **record_url — dataset precision:** no per-record PUBLIC link exists. The CityView
  `cvportal.provo.org/CityViewPortal/Planning/StatusReference?referencenumber=<PermitNumber>` deep
  link is **login-walled** (verified: real + bogus refs both return the identical "Log On" SPA
  shell), so it is NOT used. record_url falls back to the official public
  `https://www.provo.gov/174/Projects-and-Planning` (dataset_url, precision "dataset"). The record
  DATA (name/address/status/date/point) is all from Provo's authoritative public GIS.

## TX metro permit sources (wired 2026-07-13 — Texas depth pass, SLC/Provo recipe)

Three new `arcgis` registry entries, all live-verified via pg_net groupBy before registration
(statuses/types VERBATIM; full receipts in each entry's `_receipts`):

- **round-rock-large-development-projects** — Round Rock's official `Large_Development_Projects_view`
  (roundrockgis org). 190 current land-use cases (Zoning 112, Preliminary Plat 26, PUD 14, …),
  point geometry, fresh (Sep 2026). ZIP scoping via `zip_where_template` on ADDRESS
  ('… ROUND ROCK TX 786xx'). 14 statuses mapped verbatim; REJECTED/CONVERTED excluded.
  Coverage TX/Williamson (modeled ZIPs 78664/78665/78681/78682).
- **san-antonio-permits-issued** — CoSAGIS_Opendata `Permits_Issued`. Fresh (Jul 2026), point
  geometry, Address carries ZIP. NO status column because every record IS an issued permit
  (dataset-level fact): status_raw reads Permit_Type and the 12 INCLUDED construction types
  (Comm/Res New Building, Additions, Shell, Finish Out, Sitework, Pad Site, ADU, Manufactured
  Home, Demolition) map to bucket 'approved'; the other 56 types (Garage Sale, trade permits,
  signs, fences, re-roofs …) are dropped at source via extra_where. Coverage TX/Bexar
  (modeled ZIPs 78260/78261).
- **san-marcos-planning-cases** — City ArcGIS Server `PlanningFeatures/MapServer/15`
  (PlanningCase_Point). Fresh (Jul 2026), point geometry, 11 statuses + 36 case types verbatim.
  No ZIP anywhere, so a constant `zip_where_template` scopes the city feed to its principal ZIP
  78666 (records still place by their OWN per-parcel geometry). Paperwork types
  (Pre-Development Meeting 1689, Zoning Verification 343, rental registrations, …) dropped at
  source. Coverage TX/Hays.

### Rejected in the same pass (anti-fabrication receipts — do not re-derive)
- **Plano**: dashboard.plano.gov's catalog API only federates OTHER cities' datasets (the
  "Permit Applications" hit is Orlando's data.cityoforlando.net; also NOLA/NYC) — Plano
  publishes no first-party permit resource there; /resource/ 404s. No verifiable open feed.
- **Frisco**: geo.friscotexas.gov blocks external IPs (TLS handshake timeout) — feed exists
  ("Active Building Permits"/"Active Zoning and SUP Cases") but is unreachable for the engine.
- **Denton County** DEV_Permits: frozen archive — newest record Jun 2023.
- **Denton city**: data.cityofdenton.com is dead (404).
- **McKinney** UnderConstruction: newest IssueDate Sep 2023 (stale); other datasets are static
  year snapshots (ADR_2023_*).
- **Allen** Current_Development_Projects: POLYGON geometry with intersection-style locations —
  no point/ZIP path without new connector code (deferred, not wired).
- **Houston** (cohgis): only sidewalk-permit ranges 2020-23; no live building-permit layer found.
- **Dallas / Fort Worth / Arlington / El Paso**: their counties have ZERO modeled ZIPs in the
  communities table — wiring them cannot lift any live page today; revisit when those metros
  are modeled.

## CO metro permit sources (wired 2026-07-14 — Colorado readiness pass, TX recipe + spatial ZIP scoping)

Five new `arcgis` registry entries, all live-verified via pg_net groupBy before registration
(statuses/types VERBATIM; full receipts in each entry's `_receipts`). This pass added ONE
additive connector capability — **`spatial_zip_radius_mi`** (sources/arcgis.ts): for point
layers with NO ZIP attribute anywhere (Denver, Colorado Springs), the query carries an ArcGIS
envelope of ±N miles around the ZIP centroid (the engine's standard centroid+radius ZIP
approximation, same shape as the EPA FRS floor). Records still place by their OWN per-parcel
geometry — nothing is guessed. Offline-unit-tested (envelope math, spatial params, WHERE
composition, fail-closed without centroid, classic-path regression).

- **denver-commercial-construction-permits** + **denver-residential-construction-permits** —
  Denver's own AGO Open Data layers (ODC_DEV_*CONSTPERMIT_P, point geometry, fresh Jul 2026,
  2,438 commercial permits/yr). Issued-permit dataset-level fact (San Antonio precedent):
  dev-relevant CLASS values → bucket approved; Repair/Replace, Special Event, remodel and
  legacy-code noise + cancelled rows dropped at source. NOTE the two layers use different
  casing (commercial mixed-case, residential UPPERCASE) — mapped verbatim per layer.
- **boulder-construction-permits** — City of Boulder's BLDS-style permit TABLE (no geometry):
  rows geocode via the full address (geocode-cache-backed) and carry a NATIVE OriginalZip;
  fresh 2026-07-07; 24 statuses + 29 types verbatim; trade noise (Mechanical 71k, Electrical
  66k, …) dropped at source. ~100–240 active rows/yr per Boulder ZIP.
- **fort-collins-building-permits** — FC's 'Current Building Permits' AGO layer (point, native
  ZIP, **per-record Accela CapDetail link** → record-precision record_url). Found via the
  successor hub open-data-fcgov.hub.arcgis.com — the old opendata.fcgov.com Socrata portal is
  DECOMMISSIONED (503 'This site has moved'). Curated current snapshot (2,177 rows, no date
  column → no recency filter; Provo precedent). 'Issued FF' (1 row) left unmapped on purpose.
- **colorado-springs-planning-applications** — the city's own Development Tracker backend
  (gis.coloradosprings.gov Planning/PlanDevTracker_PRO, point geometry, 967 current land-use
  cases, 9 statuses + 15 types verbatim, no trade noise). Spatial ZIP scoping (no ZIP column).

### Rejected in the same pass (anti-fabrication receipts — do not re-derive)
- **Aurora**: data.auroragov.org DNS does not resolve (ENOTFOUND). Monitor re-probes nightly.
- **Douglas County CO**: data-dougco.opendata.arcgis.com DCAT → HTTP 500 CONT_0001.
  ⚠️ **AMENDED 2026-07-30 — the CATALOG 500 was not the whole story, and the source is still
  unusable, for a different reason.** Found SEARCH-FIRST (the catalog 500s; the service does not):
  `services6.arcgis.com/ONZht79c8QWuX759/arcgis/rest/services/Building_Permits/FeatureServer/0`
  answers **200**. But it is **AGGREGATE BY DESIGN** — 684 rows of `Geography × Year × Quarter`
  carrying `Single_Units, Double_Units, Row_Units, Apartment_Units, Total_Units` and
  `Residential_Value / Commercial_Value / Industrial_Value / Institutional_Value /
  NonResidential_Value / TotalPermits_Value`. **`geometryType` is null**; there is no permit
  number, address, status or type. 684 rows are PERIODS, not permits — nothing to pin, classify
  or link. **`candidates_exhausted` for Douglas on this source** (14 ZIP pages, CO's largest
  single gap). Same class as the NJ DCA statewide dataset.
  *Recorded so the catalog-500 note is not read as "unprobed" and re-derived a third time.*
- **Arapahoe / Larimer / Weld counties**: no `data-<name>.opendata.arcgis.com` domain record
  (404 "Domain record(s) not found") — no first-party open-data catalog found at the standard
  Hub pattern; county permit systems not discoverable this pass.
- **Adams County / Jefferson County**: catalogs live (DCAT 200) but the only permit/land-use
  hits are ZONING DISTRICT / SUBDIVISION BOUNDARY polygons (base-map layers, not case/permit
  records) — nothing wireable without fabricating case data from districts.
- **Boulder 'Development Review Cases'** (gis.bouldercolorado.gov plan/DevelopmentReview/0):
  esriGeometryPolygon — deferred with the other polygon-only layers (needs point derivation).
- **Colorado Springs Accela folder**: only AccelaAddressesParcels/webmap/scripting services —
  the record layer is the PlanDevTracker (wired above).
- **data.colorado.gov 'Building Permit Counts in Colorado'**: statewide AGGREGATE counts by
  jurisdiction, not per-permit records — wrong shape (Houston-CKAN class), not wired.

---

## 2026-07-15 — FIVE-STATE DISCOVERY PASS (MI / WA / IL / MN / MA) — RECON ONLY, NOTHING WIRED

Reconnaissance for the "which state to populate next" decision. Method: 41 recon targets
(Socrata catalogs, ArcGIS Hub DCAT feeds, county ArcGIS roots, CKAN portals, 3 known-candidate
socrata resources) run through the source-monitor's fail-closed gate in `--dry-run` on a GitHub
runner (run 29380144863, branch-only target set — NOT added to the nightly monitor), plus
targeted pg_net receipts on the two headline datasets. 222 findings, 131 flagged, 0 auto-wired
(dry-run; the gate requires human column-maps regardless). Every wire decision below still
requires a human pass — this section is the evidence base, not a wiring change.

### Verified-live structured candidates (receipts; NOT wired)
- **Seattle — Building Permits** (Socrata `data.seattle.gov/76t5-zqzr`): max issueddate
  **2026-07-11**, native `originalzip` (receipt row: 98199), `statuscurrent` ("Completed"),
  `permitclass` ("Single Family/Duplex"), latitude/longitude. Existing socrata connector +
  human column-map. Companion **Land Use Permits `ht3q-kdvx`** (found by catalog walk; the old
  `uyyd-8gak` id is DEAD — views API 404). Lift: 47 modeled Seattle ZIPs.
- **Chicago — Building Permits** (Socrata `data.cityofchicago.org/ydr8-5enu`): max issue_date
  **2026-07-13**, latitude/longitude + street_number/street_name; `permit_status` sparse;
  permit types include noise (receipt sample: "PERMIT - SIGNS") → type filter at source.
  **No ZIP column** → needs a socrata-side spatial ZIP scope (within_circle mirror of the
  arcgis `spatial_zip_radius_mi`) or geocode volume. Lift: 84 modeled Chicago ZIPs.
- **Minneapolis — CCS Permits** (ArcGIS Hub `opendata.minneapolismn.gov` → CCS Permits layer):
  **fresh, newest 2026-07-13** (monitor freshness probe), point layer, no address/ZIP columns →
  exactly the Denver `spatial_zip_radius_mi` pattern. Lift: 42 modeled Minneapolis ZIPs.
- **Detroit — Building / Trades / Demolition Permits + Plan Reviews** (ArcGIS Hub
  `data.detroitmi.gov`): point layers with `address`, `submitted_date`/`issued_date`,
  `permit_type`, `zip_code` (native), council_district. Flagged only because the lexicon lacks
  the `issued_date` spelling — human column-map trivially resolves. **Freshness NOT yet
  verified** (probe blocked on the date column) — verify max(issued_date) before any wire.
  Lift: 31 modeled Detroit ZIPs.
- **Cambridge MA — 10 permit datasets** (Socrata `data.cambridgema.gov`): Building Permits
  New Construction `9qm7-wbdc` / Addition-Alteration `qu2z-8suj` / Demolition `kcfi-ackv` etc.,
  all updated **2026-07-13** (daily), `full_address` + latitude/longitude + `status` +
  issue_date. Human column-map only. Lift: 6 modeled Cambridge ZIPs.
- **Bellevue WA — "Bellevue Permits (Pending, Ready to Issue, Issued, Open)"** (ArcGIS Hub
  `data.bellevuewa.gov`, layer on services1.arcgis.com — probe skipped this pass only because
  services1 wasn't on the recon allowlist): named-status permit layer, strong candidate,
  needs the follow-up probe. Lift: 7 modeled Bellevue ZIPs.
- **Pierce County WA — "Permits Pierce County"** (ArcGIS Hub `gisdata-piercecowa`): point
  layer, **no status column** → San Antonio-style dataset-level-status judgment call. Lift:
  subset of 65 Pierce ZIPs (county-issued/unincorporated; bound unknown).
- **Worcester MA — Building/Electrical/Plumbing/Gas/Mechanical Permits** (ArcGIS Hub
  `opendata.worcesterma.gov`): geometry "(none)" = TABLES → Boulder-style geocode path;
  fields/freshness not yet probed. Lift: 15 modeled Worcester ZIPs if usable.
- **DuPage County IL — "Address Points Under Development"** (gis.dupageco.org): point layer
  with MUNICIPALITY + ZIPCODE but no date column, and it records address creation, not permit
  cases — borderline semantics; needs a human judgment before any wire.
- **Boston — "Approved Building Permits"** (CKAN `data.boston.gov`): live and excellent data,
  BUT (a) generic connectors handle ArcGIS + Socrata only (CKAN connector = new code) and
  (b) only **1 modeled Suffolk ZIP** (02212, a P.O. block) — near-zero lift today.

### Rejected / dead / wrong-shape (receipts — do not re-derive)
- **St. Paul MN**: `information.stpaul.gov` Socrata catalog API 404 ("Cannot GET
  /api/catalog/v1") — the domain no longer serves a Socrata catalog. St. Paul open data has
  moved/retired; no first-party permit feed found this pass.
- **Ramsey County MN**: catalog reachable, **0 first-party** q=permit datasets (2 federated
  hits ignored — the Plano trap).
- **MN Geospatial Commons** (`gisdata.mn.gov`): CKAN API path differs from standard
  (`/api/3/action/package_search` → non-success 200) — statewide commons carries aggregate/
  reference layers anyway; not a per-permit source.
- **Rochester MN / Dakota County MN**: `data.rochestermn.gov` ENOTFOUND; `gis.co.dakota.mn.us`
  returns non-JSON 200 (not an open ArcGIS REST root at that path).
- **Evanston IL**: `data.cityofevanston.org` Socrata catalog 404 — portal retired.
- **Naperville IL**: `data.naperville.il.us` Socrata catalog 404 — portal retired.
- **Cook County IL Socrata**: permit-pattern datasets are Assessor/asbestos/solid-waste/rock-
  crusher (county regulatory, no lat/lng/date shape) — no municipal building-permit records
  (suburban permitting is per-municipality; Cook does not publish it).
- **Chicago Socrata (non-building)**: Transportation/CDPH/parking/park-event permit datasets —
  wrong domain (street use, environmental, events), not development.
- **Rockford IL**: `data-rockford.opendata.arcgis.com` — no Hub domain record (404).
- **Champaign IL / Will County IL**: guessed ArcGIS roots 404 (no public REST root at
  `gisportal.champaignil.gov` / `gis.willcountyillinois.com`). **Kane County IL**: ENOTFOUND.
- **Lake County IL**: Hub live but permit-pattern hits are township ZONING polygons/UDO docs —
  no case/permit records.
- **Grand Rapids MI**: Hub live (`grdata-grandrapids`) but the only permit/planning-pattern
  layer is "Planning - Historic Landmarks" — **no permit/case layers published**.
- **Ann Arbor MI**: `data.a2gov.org` DCAT 404 (page exists, no DCAT feed at the Hub path).
- **Oakland County MI**: `gisservices.oakgov.com` root live but planning/land-use hits are
  POLYGON base-maps (Composite Master Plan, Current Land Use, Development Authority districts)
  — no permit records. **Macomb / Kent County MI**: ArcGIS roots 404. **Lansing MI**:
  `data.lansingmi.gov` ENOTFOUND.
- **King County WA Socrata**: 2 first-party q=permit datasets, neither a development-permit
  shape. **King County GIS Hub**: polygons + "Industrial Waste Permits" (enrichment-class, not
  development). Unincorporated-King permit records not found this pass.
- **Tacoma WA**: `geohub.cityoftacoma.org` DCAT path returns non-JSON 200 — Hub exists but the
  standard feed path is wrong; needs a follow-up with the correct DCAT/search path.
- **Bellingham WA**: `data.cob.org` same non-JSON-200 class. **Everett WA**: Hub domain 404.
- **Spokane city/county WA**: guessed roots ENOTFOUND (`gis.spokanecity.org`,
  `gis.spokanecounty.org`). **Clark County WA**: `gis.clark.wa.gov` root 404.
  **Snohomish County WA**: `gis.snoco.org` root 404. **Vancouver WA**:
  `data.cityofvancouver.us` ENOTFOUND. (All are URL-guess failures, not proof the counties
  publish nothing — a second pass with correct portal URLs is warranted before final "no".)
- **Somerville MA**: `Permits (vxgw-vmky)` frozen 2023-05-16; `Applications for Permits and
  Licenses (nneb-s3f7)` fresh 2026-07-14 but **no address / lat/lng / ZIP columns** —
  application ledger, ungeolocatable → unusable under v18 (no fabricated placement).
- **Springfield MA**: no first-party open-data catalog found (guessed Hub domain 404).
- **Minneapolis (non-CCS)**: planning/zoning layers are POLYGON base-maps; "Honey Bee Permits
  2017" is stale/irrelevant.

---

## 2026-07-15 — WASHINGTON WIRE PASS (founder-approved open of WA)

Six first-party feeds live-verified via pg_net (statuses/types VERBATIM via
returnDistinctValues — never groupBy alone) and registered. New ADDITIVE connector option:
**socrata `extra_where`** (twin of the arcgis one; ANDed into `$where`; offline unit-tested)
so noise types drop AT SOURCE on Socrata datasets too.

### Wired (receipts in each entry's `_receipts`)
- **seattle-building-permits** (Socrata 76t5-zqzr): fresh 2026-07-11; native originalzip;
  24 statuses/7 classes verbatim; per-record LinkToRecord url; ECA-exemption + Roof noise
  dropped at source; 365d window (98103 = 12,981 all-time rows).
- **seattle-land-use-permits** (Socrata ht3q-kdvx): fresh 2026-07-13; 19 statuses verbatim;
  Master Use Permit + Early Design Guidance; per-record link. Replaces the DEAD uyyd-8gak.
- **bellevue-permits** (AGO services1/EYzEZbDhXZjURPbP): fresh 2026-07-13, daily ~6AM refresh;
  native ZIPCODE; 25 statuses verbatim (one with source trailing whitespace — connector trims);
  35-code PERMITTYPE whitelist at source (descriptions carry trailing-space variants; codes
  don't); 365d window (98004 = 27,744 all-time).
- **tacoma-accela-permits** (AGO services3/SCwJH1pD8WSn5T5y): fresh 2026-07-13; native zip;
  80 Accela statuses verbatim; permit_type whitelist Building/Land Use/Site; per-record
  Accela link; 365d window (98402 = 8,359 all-time).
- **pierce-county-pals-permits** (AGO services2/1UvBaQ5y1ubjUPmd): fresh 2026-07-09; 18
  statuses + ~250 types verbatim, 53-type development whitelist at source; per-record PALS
  link; NO ZIP column → spatial_zip_radius_mi 3 (own XY points, wkid 2927 → outSR 4326).
- **clark-county-active-dev-permits** (gis.clark.wa.gov/**arcgisfed**/): ACTIVE land-use
  cases, max Received 2026-05-22; 6 statuses + 4 types verbatim; per-record PublicNoticeURL;
  spatial ZIP scoping. **The recon "dead" was a wrong-URL guess** — /arcgis/ and /gisserver/
  404 but /arcgisfed/ serves; found via org-scoped AGO search.

### Corrected-URL retry results — rejections with receipts (do not re-derive)
- **STANDING ANSWER: `<org>.maps.arcgis.com/sharing/rest/search` WITHOUT `orgid:` searches ALL
  of ArcGIS Online** — an unscoped q=permits returned Calgary, ON/AB lookalikes. Always scope
  `q=… orgid:<orgId>` (orgId from `/sharing/rest/portals/self`).
- **Snohomish County**: org is live (43 hits) but "Active Permits" (fresh 2026-07-14) is a
  POLYGON parcel-join with only generalized GrpCategory/GrpStatus fields — no permit numbers,
  addresses, dates, or record URLs (the recon polygon class). "Issued_Permits"/"Points_LDA_D_Issued"
  frozen 2023-10. Nothing wireable without fabricating case identity.
- **King County (unincorporated)**: gismaps.kingcounty.gov root IS live (earlier guess wrong)
  but Accela folder is EMPTY and DLS/Planning folders carry district/zoning MapServers only —
  no permit-record layer published.
- **Spokane (city + county)**: no public AGO org found (cityofspokane/spokanecity portals/self
  → generic portal); data-spokanecity Hub domain = PRIVATE org (401). No first-party feed
  reachable this pass.
- **Vancouver / Everett**: Hub domains exist but orgs are PRIVATE (401 "private org id … not
  accessible").
- **Bellingham**: data.cob.org serves the city WordPress site — no open-data API.
- **Tacoma Socrata** (data.cityoftacoma.org): catalog probe returned empty/unreachable — the
  city's live path is the AGO org (wired above).

---

## 2026-07-15 — MINNESOTA WIRE PASS (founder-approved open of MN)

### Wired
- **minneapolis-ccs-permits** (AGO services.arcgis.com/afSMGVsC7QlRK1kZ CCS_Permits): fresh
  **2026-07-13** (max issueDate; item modified 2026-07-14); point layer, NO ZIP column and NO
  site-address column → the Denver `spatial_zip_radius_mi` pattern, zero new code; 10 statuses
  + 6 permitType values VERBATIM via returnDistinctValues; Mechanical/Plumbing trade noise
  dropped at source; 'Closed' EXCLUDED on purpose (ambiguous finaled-vs-administrative
  semantics — conservative, never fabricates a lifecycle); dataset_url record precision.

### Corrected-URL retry results — rejections with receipts (do not re-derive)
The four first-pass rejections were all URL-guess artifacts; the retries found the REAL
portals and produced substantive receipts. None yielded a wireable feed:
- **St. Paul**: live AGO org FOUND (`9meaaHE3uiba0zr8` "Saint Paul GIS" — the Socrata domain
  is retired). "Approved Building Permits" has the right shape (point, STATUS, ISSUEDATE,
  FOLDER_TYPE Building/Demolition whitelist-able) but is a **STALLED snapshot: max ISSUEDATE
  2025-06-30**, >12 months old (McKinney-class reject). "PAULIE" (item fresh 2026-07) is the
  city's ADDRESS REGISTRY (ADDRESSID/HOUSENUMBER/ZIP5), not permit records. Nothing else
  fresher in the org. Re-probe candidate for the nightly monitor: the ABP layer, in case the
  city resumes publishing.
- **Ramsey County**: live AGO org FOUND (`527XtFVf9JKOTqu5`) but an org-scoped permit search
  returns **0 permit feature services** (the Socrata catalog's 0-first-party receipt stands).
- **Rochester / Olmsted County**: no public AGO org at any tried alias
  (rochestermn / cityofrochester / olmstedcounty); data.rochestermn.gov DNS-dead. No
  first-party structured permit feed found.
- **Dakota County**: live AGO org FOUND (`CfhoRi2v351nuUH7`); "Building Permits (web layer)"
  = gis2.co.dakota.mn.us DCGIS MapServer/32 — an **assessor-style annual extract** (TAXPIN,
  PLAT, THEYEAR smallint, no status/type richness), **max THEYEAR = 2025** and year-granularity
  dates: wrong shape for a what's-changing tracker (v18: no structured status; no real dates).

---

## 2026-07-15 — ILLINOIS WIRE PASS, checkpoint A+B (founder-approved open of IL)

New ADDITIVE connector option — **socrata `spatial_zip_radius_mi` + `spatial_point_col`**
(mirror of the arcgis envelope option): datasets with NO ZIP column but a Socrata Point
column scope via `within_circle(<col>, centroid, radius_m)`; records keep their OWN
per-parcel points; fail-closed without a centroid/point column; offline unit-tested incl.
classic zip-column regression.

### Wired
- **chicago-building-permits** (Socrata data.cityofchicago.org ydr8-5enu): fresh
  **2026-07-13** (max issue_date); 11 types + 7 statuses VERBATIM; construction whitelist at
  source (NEW CONSTRUCTION / RENOVATION-ALTERATION / WRECKING-DEMOLITION / PORCH — the
  Express-program value uses an EN-DASH, captured verbatim); **323,651 NULL-status rows are
  skipped fail-closed** (blank-status rule, never bucketed); spatial scoping on the `location`
  Point column (live within_circle receipt: 8,414 in 3 mi of the Loop since 2025-07);
  365-day window; dataset_url precision (no per-record link column).

### IL checkpoint C — corrected-URL retry results (receipts — do not re-derive)
The retries found REAL portals behind every first-pass URL-guess failure; none wireable:
- **Rockford**: live AGO org (`Fh2bD9911cyi2gO2`) — org-scoped permit search returns **0
  permit feature services**.
- **Champaign**: live AGO org (`tpnvcOxxttZuMwYB`) — "Building_Permit_Data" (item 2019) is a
  MISLABELED subdivision-polygon layer containing **1 row**; "Zoning - Special Use Permits"
  is a zoning-district polygon base map. Nothing wireable.
- **Will County**: real GIS root found at **gis.willcogis.org** (the willcountyillinois.com
  guess was wrong) but it publishes **0 public services**.
- **Kane County**: live AGO org (`oRKmdBXD6EbdmVgJ`) — only adopt-a-highway routes and 2019
  bridge inspections; 0 permit layers.
- **DuPage County**: "Address Points Under Development" FIRM REJECT — an address-assignment
  registry (no date column, no permit status/type; it records address creation, not permit
  cases). The county publishes no permit-record layer on gis.dupageco.org.

---

## 2026-07-15 — MICHIGAN WIRE PASS, checkpoint A+B (founder-approved open of MI)

**Freshness-first verdict on the Detroit BSEED trio: FRESH — wire approved.** The founder's
gate was "verify recent issue dates before wiring; stale → monitor, don't wire." pg_net
max-stat receipts (2026-07-15): `bseed_building_permits` max issued_date **2026-07-14**,
`bseed_trades_permits` **2026-07-14**, `bseed_demolition_permits` **2026-07-10**.

**Why recon had flagged it (now fixed):** the recon note said "the lexicon lacks the
issued_date spelling" — the real gap was the TYPE, not the spelling: `issued_date` was in
the lexicon all along, but Detroit's date fields are **`esriFieldTypeDateOnly`** (the newer
ArcGIS temporal type, serialized as `"YYYY-MM-DD"` strings) and the monitor's field filter
recognized only `esriFieldTypeDate`, so the layers read as "no date column" and the
freshness probe blocked. `source-monitor.mjs` now recognizes both; `arcgisMaxDate` already
parses string dates (`Date.parse`), and the engine's `DATE '…'` recency literal was
live-verified against the DateOnly field (522 building permits city-wide since 2026-06-15).

### Wired (3 entries, one reversible registry entry each; receipts in `_receipts`)
All three: point layers on Detroit's AGO org (services2/qvkbeam7Wirps6zC), native `zip_code`
+ own `latitude`/`longitude` columns, `record_id` (Accela id) as case number, 365-day window
on `issued_date`, dataset-precision record_url (Hub item-id pages from the search API — the
guessed pretty slugs for trades/demolition do NOT resolve; item ids follow the Minneapolis
precedent). **None of the trio has a status column** — they are issuance ledgers (field doc:
"The permit is issued when the permit application is approved"), so this pass adds the
additive connector option **`status_const`**: a dataset-level status applied verbatim to
every row and bucketed through `status_to_bucket` like any live value, guarded by
`issued_date IS NOT NULL` in `extra_where` so the constant never outruns the data (offline
unit test: constant bucketing, unmapped-constant fail-closed, no-option regressions).
- **detroit-building-permits**: 16 permit_type values VERBATIM (returnDistinctValues); kept
  12 (New / New Revision / Addition / Add Addition Use / Add Additional Occupancy-Use /
  Alteration / Alter Revision / Foundation Only / Accessory-Utility Structure / Change of
  Occupancy-Use / Change of Use / Residential Rehab); dropped at source: Correct Violation,
  Fire Insurance Escrow, Fire Repair, Other. Receipt row 48226: BLD2026-00771 "Alteration"
  issued 2026-05-26 (13-story DTE GO Building).
- **detroit-trades-permits**: 7 permit_type values VERBATIM, **all kept — FOUNDER-SPECIFIED**
  (the requested trio explicitly includes Trades; note this differs from the trades-noise
  drop in WA/MN/IL — dropping the one registry entry restores cross-state comparability).
- **detroit-demolition-permits**: single-purpose demolition ledger; NO permit_type column →
  use_type stays unclassified (absent stays absent); title falls back work_description → address.

### MI checkpoint C — corrected-URL retries (2 bonus wires + 4 firm rejections)
The same second-pass that caught Tacoma/Clark (WA). Standing answer reconfirmed: unknown
`<guess>.maps.arcgis.com` subdomains return the GENERIC anonymous portal self (no org id) —
a 200 there is NOT an org; resolve orgs via the Hub domains API or item owners instead.
- **Ann Arbor — BONUS WIRE (`ann-arbor-energov-permits`)**: recon's "data.a2gov.org DCAT 404"
  was true but incomplete — the portal exists (non-Hub) and the city's real permit layer sits
  behind its "Public Permit Map" web map: `egPublicPermit` (Tyler EnerGov) on the org's
  utility.arcgis.com proxy. Fresh (max ISSUEDATE 2026-07-14), verbatim statuses
  Issued / Issued in Trakit, **per-record STREAMURL → stream.a2gov.org self-service
  (record-precision)**, Building types kept / trades dropped at source, spatial ZIP scoping.
  Org's `Development_Pipeline` rejected separately: 27 rows frozen at EditDate 2024-01.
- **"Oakland County" — BONUS WIRE, honestly scoped (`independence-twp-construction-permits`)**:
  the county org hosts no county-wide permit layer; the real find is Independence Township's
  Construction Activity deployment (10,020 rows, fresh 2026-07-09) whose extent bbox covers
  the township only (~Clarkston). Wired with the township named as the jurisdiction; public
  view NULLs Address (rows place by their own points, absent stays absent).
- **Grand Rapids — FIRM REJECT**: org-scoped search (org L81TiOwAPO1ZvU9b via the Hub domains
  API) shows NO building/development permit record layer — "Soil Erosion Permits" MapServer
  exposes only base/utility layers (Municipal Boundaries, Parcels, storm assets; 0 permit
  layers), "Temp Use Permits" is event permits, EPA_4_1/5_x are AGGREGATE BI counters.
- **Macomb County — FIRM REJECT**: gis.macombgov.org is live but serves no public ArcGIS REST
  (404 at /arcgis/rest/services); global AGO search has zero Macomb MI permit items.
- **Kent County — FIRM REJECT**: no public org; gis.accesskent.com does not resolve; every
  "Kent County" AGO permit hit is another state's Kent (DE/RI — the cross-state trap).
- **Lansing — FIRM REJECT**: data.lansingmi.gov and maps.lansingmi.gov both ENOTFOUND; AGO
  search yields only an MS4 stormwater StoryMap and a polling-places map.

---

## 2026-07-15 — MASSACHUSETTS WIRE PASS (founder-approved open of MA, incl. Boston)

Recon (read-only, founder-reviewed before wiring) covered the statewide portals + the four
metros. **No statewide per-record permit source exists**: MassGIS (org hGdibHYSPO59RG1h)
carries MassDEP environmental permits / land-use polygons / EDIP districts, not development
records; data.mass.gov is an ArcGIS Hub, not Socrata (catalog API 404).

### Wired (4 entries; receipts in each entry's `_receipts`)
- **cambridge-building-permits-new-construction / -addition-alteration /
  cambridge-demolition-permits** (Socrata data.cambridgema.gov 9qm7-wbdc / qu2z-8suj /
  kcfi-ackv): all fresh (daily refresh; New Construction max issue_date 2026-07-08).
  Statuses VERBATIM via SODA group-by: Active/Complete only. The `coordinates` column is a
  Socrata `point` → the IL spatial within_circle option scopes them (full_address embeds
  the ZIP but no zip column exists). Dataset-precision record_url.
- **boston-approved-building-permits** — the FIRST `ckan` entry, on the new ADDITIVE
  `sources/ckan.ts` connector (datastore_search_sql, LIMIT/OFFSET paging, same
  coverage-gate/fail-closed/anti-fabrication contract as socrata/arcgis; offline
  unit-tested incl. a bidirectional gate proof). Fresh TODAY (issued_date 2026-07-15T01:47).
  Native `zip` + own lat/lng. Statuses VERBATIM over all 656,762 rows: Open+Issued→approved,
  Closed→operating, Stop Work→exclude. FOUNDER WHITELIST: keep Erect/New Construction,
  Long Form/Alteration, Amendment to a Long Form, Foundation, Use of Premises; DROP Short
  Form Bldg Permit (189k minor jobs) + trades/CO noise. FOUNDER-ACCEPTED dataset-precision
  record_url (no per-row URL column; no verified portal URL pattern — v18 forbids guessing).
  Enabled by the founder-approved **Suffolk 35-ZIP expansion** (Boston/Chelsea/Revere/
  Winthrop `level=zip` pages under the existing suffolk-county-ma root; zipcodes v3.0.0).

### Rejected with receipts (do not re-derive)
- **Worcester — STALLED (the St. Paul class)**: Building_Permits (services1/j8dqo2DJE7mVUBU1)
  is a real 52,108-row ledger (statuses Complete/Active verbatim) but a geometry-less TABLE
  whose newest issuance is **2025-09-09** (10 months stale; verified by ordering on the
  string date column). Added to the nightly monitor's reprobe list — wire if it resumes.
  STANDING ANSWER: this hosted table returned count 0 for `LIKE '%2025%'` despite matching
  rows — LIKE counts on AGO hosted tables are unreliable; order-by-desc is the freshness probe.
- **Springfield**: no first-party source — no Hub domain record (data.springfield-ma.gov
  404), springfieldma.maps.arcgis.com is the generic anonymous portal, no MA-plausible AGO
  items ("Springfield" collides with MO/IL/OH).
- **Boston gisportal**: Permitting/Permits/MapServer → 404 "Service not found" (dead
  reference); the AGO org's own permit layers are street-access/moving-truck/food-truck/
  well only.
- **Somerville** (recon receipt, unchanged): vxgw-vmky frozen 2023-05-16; nneb-s3f7 fresh
  but no address/coords/ZIP — ungeolocatable under v18.
- **Cambridge noise companions**: Roof/Siding/Tent/Mechanical + the deprecated 1-2 Family
  set — dropped at source / not wired.

---

## 2026-07-15 — NEW YORK WIRE PASS (founder-approved four-state run, state 1 of 4)

**Key structural finding:** NY's modeled counties (Suffolk/Westchester/Erie/Nassau/Monroe/
Albany/Dutchess/Saratoga/Rockland/Putnam) did NOT include the five NYC boroughs — so the NYC
DOB feeds had zero page lift until the **five-borough expansion** (Boston precedent, §3
standing authority): migration `nyc_borough_zip_expansion` adds 5 county roots + 245
`level=zip` pages (zipcodes v3.0.0 standard ZIPs; **10470 excluded** — already live as
"Bronx (10470)" under Westchester via the Census crosswalk; one page per ZIP). NY: 519→764
ZIP pages.

### Wired (2 entries; receipts in `_receipts`)
- **nyc-dobnow-approved-permits** (Socrata rbx6-tga4): fresh same-day; native zip + lat/lng;
  Permit Issued/Signed-off verbatim; 21 work_types verbatim, 5 kept (General Construction,
  Structural, Foundation, Earth Work, Full Demolition), 16 noise types dropped at source.
- **nyc-dob-permit-issuance** (Socrata ipu4-2q9a, BIS legacy): still updates daily (legacy
  jobs keep issuing/renewing — complements DOB NOW, no dual-filing); ISSUED/RE-ISSUED/
  IN PROCESS/REVOKED verbatim (11,225 blanks drop fail-closed); NB/DM/AL/FO whitelist drops
  EW (1.79M equipment work), PL, EQ (fences/sheds/scaffolds), SG at source.
  ⚠️ **CORRECTION (2026-08-02): everything above describes the DATASET, and none of it
  reached a page.** This entry placed **zero** records from wiring until 2026-08-02 — its
  recency clause could not match a text MM/DD/YYYY column. The pass's "66,006 dev records"
  is therefore entirely `nyc-dobnow-approved-permits`. Full diagnosis and fix:
  "DEFECT: `nyc-dob-permit-issuance` HAS NEVER PLACED A RECORD" below.

### Rejected with receipts (do not re-derive)
- **Buffalo**: every catalog permit item is a filtered VIEW with restricted rows —
  `e48j-dfaz` ("All permits since 1/1/2018", updated same-day) returns **403 "Cannot read
  rows"**; a datasets-only catalog query returns zero public parents. Not wireable anonymously.
- **Syracuse — STALLED (the St. Paul/Worcester class)**: `Permit_Requests` (services6/
  bdPqSfflsdgFRVVM) is the right shape (47,902 points, Permit_Number/Full_Address/Issue_Date/
  Permit_Type/LAT/LONG) but newest Issue_Date = **2025-08-16** (11 months). Added to the
  nightly reprobe list; its "Building Permits (2013-2019)" companion is stale by name.
- **Rochester**: org (yoz1ZtATTCokO9nU, DataROC) has no permit-record layer; "Demolitions
  Open Data" requires a token (499) — not public.
- **Albany**: no Socrata catalog at data.albanyny.gov (404); the only Albany permits data is
  the state portal's "City of Albany Building Permits Issued 2009-2013" (frozen).
- **NY State (data.ny.gov)**: no per-record building/development permit source — code-report
  aggregates, highway work permits, SPDES facility lists only.
- **Yonkers / Westchester / Nassau / Suffolk County NY**: no Hub domain records (all 404) and
  no first-party permit portals found this pass.

---

## 2026-07-16 — CA / AZ / MD RECON PASS (runner-based probes during the Supabase outage)

The database was down all night (no pg_net), so this recon ran on GitHub runners:
the source-monitor dry-run sweep (31 new discovery targets) + the new `recon-fetch.yml`
(8 probe rounds, receipts printed into job logs — the sandbox cannot reach the artifact
blob store). Every verdict below carries a live receipt from runs 29468575646 /
29468850713 and recon-fetch rounds 1–8 (2026-07-16 03:16–03:42 UTC). NOTHING is wired
yet — wiring, deploy, and the three state batches run when the DB returns (centroid
staging + seed docs are pre-built: docs/{california,arizona,maryland}-development-reports-seed.sql).

### CALIFORNIA (modeled: San Diego, Orange, Santa Clara, Alameda, Contra Costa, Sonoma, Ventura, San Mateo, SLO, Marin)

**Wire candidates (each needs one small, additive piece — none pure-data tonight):**
- **san-diego approvals (CSV, city portal)** — `seshat.datasd.org/development_permits/approvals_issued_*.csv`,
  portal page says "Updated Jul 15, 2026"; per-record APPROVAL_TYPE / APPROVAL_STATUS ("Issued") /
  APPROVAL_ISSUE_DATE / GIS_LATITUDE/LONGITUDE / GIS_ADDRESS / DU counts. NEEDS: a `sources/csv.ts`
  connector + a caching strategy — the issued-2026 file alone is **14.9 MB**, so per-ZIP runtime
  fetches are out; fetch-once-per-refresh (staged or memoized) is the design. Biggest CA county
  (115 modeled ZIPs) — highest-value CA item.
- **anaheim-land-use-cases (ArcGIS table)** — `services3.arcgis.com/hPs600I3X0RTaaaq/.../Open_Data_Land_Use_Permits/FeatureServer/0`,
  fresh (newest Application_Received 2026/06/30, PAZ2026-00384); real planning lifecycle statuses
  (Received / In Review / Hearing Scheduled / Approved / Adopted / Denied / Withdrawn / Void / Revoked);
  types Planning and Zoning / Development Project / CEQA / Advanced Planning. ZIP embedded in
  `Location_Primary_Address` → `zip_where_template: "Location_Primary_Address LIKE '%{zip}%'"`.
  CAVEAT to check at wire time: ALL dates are strings ("2026/06/30") — recency must go through
  `extra_where` string compare (zero-padded yyyy/mm/dd sorts correctly) and the connector's date
  parsing must not fabricate/drop.
- **sonoma-county planning (m689-iiuu) + construction (88ms-k5e7) Socrata** — both updated 2026-07-15,
  clean statuses (construction: Issued 9,174 / Finaled 15,129 / Denied / Expired; planning: Active /
  Approved / Denied lifecycle), types incl. Building Permit With/No Plan Check, Demolition, Grading.
  BUT rows carry bare street addresses (no city), NO zip column, NO coords → cannot scope the query
  at source and cannot geocode reliably. FLAG: needs a fetch-all+geocode mode no connector has.
- **san-jose (CKAN)** — datastore alive (correct RESOURCE id 761b7ae8…; `fd9ceb0c…` is the PACKAGE id —
  standing answer: CKAN package_show's top-level id is NOT the datastore relation). But the
  active-building-permits ledger has NO address/zip column, `gx_location` is blank text, and ISSUEDATE
  is text "4/10/2018 12:00:00 AM" (m/d/yyyy — unsortable). `planningpermits30.csv` (30-day window,
  small) is the viable object → same `sources/csv.ts` bucket as San Diego.

**Rejected with receipts (do not re-derive):**
- Oakland Socrata: only Residential Parking Permit Zones, rowsUpdatedAt 2019-09-03 (stale).
- Alameda County data.acgov.org: catalog HTTP 404 (domain dead).
- San Mateo data.smcgov.org: catalog reachable, 0 first-party q=permit datasets (3 federated ignored — Plano trap).
- Marin data.marincounty.org: HTTP 200 non-JSON (not a Socrata catalog).
- San Diego County gis-public root: 61 services, none permit-pattern. Orange County ocgis.com root: 67 services, none.
- Sunnyvale: no Hub domain (data-sunnyvale 404; data.sunnyvale.ca.gov connect-timeout).
- Contra Costa gis.cccounty.us: polygon zoning layers only. Ventura maps.ventura.org: polygon land-use +
  Communication Facilities stale (newest 2025-01-10). SLO hub: polygon planning layers + a 1965-wells inventory table.
- San Diego city data.json + seshat /api: 404 / AccessDenied — the portal is a static site; CSVs are the interface.

### ARIZONA (modeled: Maricopa, Pima, Navajo, Pinal, Yavapai, Coconino, Mohave, Cochise, Yuma, Santa Cruz)

**Wire-ready:**
- **mesa-building-permits (Socrata dzpk-hxfb)** — updated 2026-07-15 (sample: PMT26-12214, new SFR
  in Hawes Crossing, status_date 2026-07-10); statuses enumerated live (Issued 25,387 / Finaled 82,767 /
  Approved / C of O Issued / C of C Issued / In Review / Under Review / Fees Due …); `type_of_work`
  vocab captured (keep Commercial/Industrial Projects, Com (PJT)/(MFR) project types, Additions,
  Multi-Family Residential, Single Family, Demolition types, ADUs, Renovations/Remodels; DROP
  Electrical/Plumbing/Mechanical/Fire Alarms/Fire Sprinklers at source); GeoJSON `location` point +
  `latitude`/`longitude`, NO zip column → the IL/Cambridge `spatial_zip_radius_mi` + `spatial_point_col`
  pattern, zero new code.

**Candidates:**
- **scottsdale-building-permits (MapServer/12, OpenData_Tabular)** — hosted TABLE, fresh (newest
  IssueDate 2026-07-10, #324234), statuses ACTIVE / FINALLED / PENDING / EXPIRED / WITHDRAWN / REFUND /
  ON HOLD / null (fail-closed handles null), `PermitType`, per-record `Latitude`/`Longitude` COLUMNS but
  NO zip and no geometry → needs a small additive arcgis option (attribute-bbox where on lat/lng columns,
  the Detroit-tables cousin). /13 Cases + /15 Certificates of Occupancy same shape.
- Maricopa County GIO/PermitHistory Permit History (Point): fresh 2026-07-15 but NO status column
  (CaseType/WorkClass/ApplicationDate case-queue) — no status_const semantic fits an application queue; flagged.

**Rejected with receipts:**
- Phoenix CKAN "Phoenix, AZ Building Permit Data": a HUD SOCDS **aggregate export** — org "External Data",
  author U.S. HUD, last_modified 2023-03-24, size 1,034 bytes. Not first-party, not per-record, stale.
  (Phoenix has NO first-party per-record permit dataset on its portal — q=building permit returns only this.)
- Tempe data.tempe.gov / Gilbert data.gilbertaz.gov: Socrata catalogs 404 (dead domains).
- Chandler data.chandlerpd.com DCAT: 404. Pima County gis.pima.gov + gismaps variants: 404.
- Tucson hub: zoning/subdivision/rezoning POLYGONS only, no permit records.

### MARYLAND (modeled: Baltimore County, Montgomery, Anne Arundel, Frederick, Charles, Howard, Harford, Baltimore city, Calvert)

**Wire-ready:**
- **montgomery-county residential (m88u-pqki) / commercial (i26v-w6bd) / demolition (b6ht-fw3x)** —
  `max(issueddate)` = 2026-07-14 (res + com, live receipts); statuses exactly {Open, Issued, Finaled,
  Stop Work} (+ Completed on demolition) → Open→proposed, Issued→approved, Finaled/Completed→operating,
  Stop Work→exclude; native `zip`; nested Socrata `location.latitude/longitude` point (wire-time note:
  readCol is flat-only today — either a dot-path readCol enhancement (additive) or location-type point
  parsing); `worktype` vocab captured (keep CONSTRUCT / ADD / ALTER / BUILD FOUNDATION / DEMOLISH /
  COMMERCIAL CHANGE OF USE; drop RESTORE AND / OR REPAIR re-roofs, INSTALL, REPLACE at source).
  Mechanical/Electrical/Fence/Sign datasets exist and are DROPPED as trades/noise (WA/MN/IL precedent).
- **baltimore-county-permits (bcgisdata …/DevelopmentManagement/ActiveDevelopment/MapServer/4)** —
  POINT geometry, native `ZIP`, newest ISSDATE 2026-07-14 (C25-01091); statuses {ISSUE, OPEN, CLOSED,
  EXPIRED, CANCELLED, BL-EXPIRED} → ISSUE→approved, OPEN→proposed, CLOSED→operating, rest excluded;
  DESCRIPTION_TYPE vocab captured (keep New Structure/Shell, New Dwelling, Addition, Alteration,
  Alteration/Addition, Razing, Grading, Foundation Only; drop Fence/Deck/Pool/Solar/Sign/Sprinkler/
  Tanks/Tents/Antennas noise). Hub layers /5 Electrical /8 U&O = trades/occupancy, dropped.

**Candidate (founder call):**
- **baltimore-city Housing and Building Permits 2019–Present**
  (`baltegis.baltimorecity.gov/mapping/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3`) —
  POINT layer, hub-modified nightly (2026-07-16T00:05), but newest IssuedDate = 2026-05-06 (~2-month
  issuance lag) and it is an issuance ledger with NO status and NO work-type column (only free-text
  Description + IsPermitModification). Wireable via status_const 'Issued' + IssuedDate IS NOT NULL +
  spatial scoping — but with no type column the minor-repair noise cannot be dropped at source
  (sample: "Repair one damaged rafter"). DECISION NEEDED: include-all vs skip (Boston precedent dropped
  Short Form minor jobs; here there is no column to do it with).

**Rejected with receipts:**
- Howard County kvz2-j5cj: STALLED — newest rows Nov 2025, rowsUpdatedAt 2025-12-04; also no
  status/point columns. → added to the nightly reprobe list.
- Anne Arundel gis.aacounty.org: Development Policy Area / land-use-plan POLYGONS only.
- Frederick / Harford: no ArcGIS Hub domains found (guessed hub hostnames 404).
- Baltimore city Socrata (data.baltimorecity.gov catalog): dead — the city moved to ArcGIS Hub (probed above).

### New standing answers from this pass
- **The recon-fetch pattern**: when the DB (pg_net) is down, recon runs on a GitHub runner —
  `recon-fetch.yml` + committed `scripts/recon/roundN.json`; receipts print into the job log
  (`----- BEGIN <id> -----` blocks) because the sandbox cannot reach the artifact blob store.
- **CKAN ids**: `package_show`'s top-level `id` is the PACKAGE id; the datastore relation is
  `resources[].resource_id`/`id` INSIDE the resources array — querying the package id yields
  "relation does not exist" even when `datastore_active: true`.
- **ArcGIS Hub DCAT hosts**: dataset distributions frequently live on a DIFFERENT host than the hub
  (bcgisdata.…, baltegis.…, maps.scottsdaleaz.gov, gis.anaheim.net, gis.slocounty.ca.gov,
  gis.tucsonaz.gov) — pin those hosts in the target allowlist or every candidate is skipped.

---

## 2026-07-16 — CALIFORNIA WIRE PASS (finishing the CA/AZ/MD trio, state 2 of the four-state run)

The DB is back; every recon verdict re-verified LIVE at wire time (pg_net + a runner
`csv_stats` sweep — the new additive recon-fetch aggregate that prints distinct-value
counts + max dates for CSVs far over the 2 MB log cap).

### Wired (2 entries; receipts in each entry's `_receipts`)
- **san-diego-approved-permits** — the FIRST `csv` entry, on the new ADDITIVE
  `sources/csv.ts` connector (published-CSV portals; fetch-ONCE-per-cache-window module
  memo + include_types/recency/column projection applied at parse time; same
  coverage-gate/fail-closed/anti-fabrication contract; offline unit-tested incl. a
  bidirectional gate proof, 18 checks). FRESH SAME-DAY: max APPROVAL_ISSUE_DATE
  2026-07-15 over 28,515 YTD-2026 rows (15.0 MB file; runner receipt run 29508593119).
  Vocab VERBATIM: 151 type|status combos enumerated; kept 10 construction/land-use types
  (Combination Building Permit, Building Permit, Demolition, Grading, Construction
  Change - Building, Conditional Use, Neighborhood Development, Coastal Development,
  Parcel Map, Master Plan Establish); DROPPED at parse: Traffic Control (5,807), No-Plan
  trades combos, Photovoltaic SB 379, Construction Noise, Transportation, ROW permits,
  Electrical/Mechanical/Plumbing, Fire Pmt variants, Sign Pmt + paperwork classes.
  Statuses Issued/Inspecting/Inspection Followup→approved, Closed→operating,
  Cancelled→exclude. NO ZIP column → `spatial_zip_radius_mi: 3` on each row's OWN
  GIS_LATITUDE/GIS_LONGITUDE — which also self-excludes the file's garbage-coordinate
  rows (observed max GIS_LONGITUDE=324108.6; a bad point can never sit near a centroid).
  **RECORD-PRECISION record_url VERIFIED**: the OpenDSD API discriminates real vs bogus
  (ApprovalId 2618042 → full record matching the CSV row; 999999999 → "could not be
  found"), so `opendsd.sandiego.gov/web/approvals/{APPROVAL_ID}` is a real per-record
  official page (the earlier SPA-shell probe alone was NOT sufficient — the API check is
  what verified it).
- **anaheim-land-use-cases** (arcgis, services3/hPs600I3X0RTaaaq
  `Open_Data_Land_Use_Permits/FeatureServer/0`): a GEOMETRY-LESS TABLE → rows geocode via
  `Location_Primary_Address` (Boulder precedent; v20 geofence applies). FRESH: newest
  Application_Received 2026/06/30 (PAZ2026-00384). No ZIP column; every address embeds
  "…, Anaheim, Ca 92xxx" → `zip_where_template` LIKE (receipt: 92805 → 6,333 all-time).
  23 statuses VERBATIM (returnDistinctValues 2026-07-16); 'Modified' left unmapped ON
  PURPOSE; Closed/Complete excluded (MN 'Closed' precedent). **STANDING ANSWER: dates
  here are `yyyy/mm/dd` STRINGS — `recency_days` (which emits an ArcGIS `DATE '…'`
  literal) would fail; recency rides in `extra_where` as a string compare
  (`Application_Received >= '2025/07/01'`, live-verified: 845 of 26,883 rows).**
  'Sex-Oriented Business' type dropped at source (licensing, not development).
  Smoke receipt: 92805 → 40 facilities + 187 dev records through the live engine.

### New standing answers from this pass
- **WORKER_RESOURCE_LIMIT (546) on big-file parse**: the naive per-char `field += ch`
  CSV parse blew the edge worker's CPU budget on the 15 MB San Diego file (37 s → 546).
  `parseCsv` is now SLICE-BASED (indexOf for quoted spans; no string concat churn):
  ~15 MB in <400 ms, behavior unit-test-identical. Any future big-text parsing in the
  engine must be slice-based from the start.
- **recon-fetch `csv_stats`** (additive): a targets entry may carry
  `csv_stats: {group_by: [cols], max: [cols], top: N}` — the runner parses the FULL CSV
  before the 2 MB truncation and prints aggregate receipts (the vocab channel for files
  pg_net can't carry).
- **An SPA shell that returns 200 for real AND bogus ids proves nothing** — check the
  app's underlying API for real-vs-bogus discrimination before accepting a per-record
  URL template (OpenDSD: HTML identical, API discriminates → template VERIFIED).

### Rejected with receipts (do not re-derive)
- **san-jose planningpermits30 (CKAN 711a7de0…, fresh same-day) — FIRM REJECT**: every
  row in the 30-day window carries the single opaque numeric status "30" (no documented
  semantics — nothing to map verbatim; fail-closed), and the type mix is
  paperwork-dominated (Over the Counter 64 / Zoning Verification Letters 32 / Tree
  Removal 32 vs 7 Development Permits). The 60-180-day companion is the same shape.
  Wiring would require guessing what "30" means — v18 forbids it.
- **sonoma m689-iiuu / 88ms-k5e7** (recon verdict stands): bare street addresses, no
  city, no ZIP, no coords → cannot scope at source, cannot geocode reliably.
- **san-diego OpenDSD /web/approvals SPA shell**: identical HTML for real/bogus — only
  the API check above rescued the template (kept here as the receipt for WHY).

---

## 2026-07-16 — ARIZONA WIRE PASS (state 3 of the four-state run)

All recon verdicts re-verified LIVE at wire time (pg_net; fresh-date + verbatim vocab).

### Wired (2 entries; receipts in each entry's `_receipts`)
- **mesa-building-permits** (Socrata data.mesaaz.gov dzpk-hxfb): FRESH — max issued_date
  2026-07-14 (newest row PMT26-12214, new SFR in Hawes Crossing, matches recon). 22
  statuses VERBATIM via SoQL group-by **incl. BOTH hyphen and en-dash "Finaled – C of C
  Required" variants** (both mapped); Closed excluded (MN precedent). ~100 type_of_work
  values enumerated over TWO probe pages — **standing answer: Socrata group-by is capped
  by $limit and silently truncates the vocabulary; page with $offset until exhausted**
  (the A–R page alone was missing Single Family (Detached) 18,461 + 12,555 across the
  dataset's two prefix eras). Kept 47 construction/land-use values; dropped at source:
  Electrical/Plumbing/Mechanical/Fire, Swimming Pool (9,216+5,500), Sign Permits (5,534),
  Use Permits/COO/Records, "Other Commercial" (5,795 — ambiguous), mobile-home/park-model
  classes, "-- Not Selected --" + 12,868 blanks (fail-closed). NO ZIP column → spatial
  within_circle on the native `location` point column (IL/Cambridge pattern, zero new
  code). Smoke receipt: 85201 (Mesa) → 170 fetched / 170 emitted, 0 unmapped.
- **scottsdale-building-permits** (classic ArcGIS Server maps.scottsdaleaz.gov
  OpenData_Tabular/MapServer/12): FIRST consumer of the additive arcgis
  `spatial_latlng_cols` option (geometry-less TABLE with per-record Latitude/Longitude
  COLUMNS → the envelope is AND'd into WHERE; a geometry param is meaningless on a
  table). FRESH: newest IssueDate 2026-07-10 (#324234). 7 statuses verbatim
  (ACTIVE→approved, FINALLED→operating, PENDING/ON HOLD→proposed, rest excluded; nulls
  fail closed). ~190 PermitType values enumerated; 70 construction/development classes
  kept verbatim; TI/signs/pools/fences/patio/solar/water-heater/minimum-charge noise
  dropped at source. **STANDING ANSWER (found live): classic ArcGIS Server on IIS caps
  GET query strings at 2,048 chars (404.15) — a long verbatim type whitelist 404s as a
  GET. `getWithBackoff` now auto-switches to a form-encoded POST when the query URL
  exceeds ~1,900 chars (ArcGIS accepts identical params via POST); behavior-identical
  for short queries (offline-tested).** Re-smoke receipt: 85251 (Scottsdale) → 18/18
  emitted, 0 quarantined.

### Not wired (recon verdicts stand)
- **Maricopa County GIO/PermitHistory**: fresh but an application QUEUE with no status
  column — no status_const semantic fits (an application is not an issuance).
- **Phoenix**: no first-party per-record permit dataset (the CKAN hit is a 1 KB HUD
  SOCDS aggregate, stale 2023). Tempe/Gilbert/Chandler/Pima portals dead or polygon-only.

---

## 2026-07-16 — MARYLAND WIRE PASS (state 4 of the four-state run, closing the trio)

All recon verdicts re-verified LIVE at wire time (pg_net; fresh-date + verbatim vocab).

### Wired (4 entries; receipts in each entry's `_receipts`)
- **montgomery-county-residential/-commercial/-demolition-permits** (Socrata
  data.montgomerycountymd.gov m88u-pqki / i26v-w6bd / b6ht-fw3x): FRESH — max issueddate
  **2026-07-15** (res + com live receipts). Statuses VERBATIM: Open→proposed,
  Issued→approved, Finaled (+Completed on demolition)→operating, Stop Work→exclude.
  worktype vocab VERBATIM (res: CONSTRUCT 84,198 / ALTER 52,593 / ADD 43,607 / BUILD
  FOUNDATION; com adds COMMERCIAL CHANGE OF USE 1,019 + DEMOLISH); RESTORE AND / OR
  REPAIR re-roofs + INSTALL/REPLACE noise dropped at source; blanks fail closed. Native
  `zip`; coordinates ride the nested Socrata `location` column → FIRST consumer of the
  additive **socrata dot-path readCol** (`location.latitude`/`location.longitude`; an
  exact column of that name always wins; offline-tested with flat-ref regression).
  Recency on `addeddate` (not issueddate) so Open applications stay visible
  pre-issuance. Mechanical/Electrical/Fence/Sign companion datasets dropped as
  trades/noise (WA/MN/IL precedent).
- **baltimore-county-permits** (the county's own ArcGIS Server bcgisdata
  DevelopmentManagement/ActiveDevelopment/MapServer/4 — the Hub *distribution* host):
  FRESH — newest ISSDATE **2026-07-15** (R24-07845/R26-03840; esriFieldTypeDate →
  recency_days valid). 6 STATUS values VERBATIM: ISSUE→approved, OPEN→proposed,
  CLOSED→operating, EXPIRED/CANCELLED/BL-EXPIRED excluded. DESCRIPTION_TYPE vocab is
  the "Comm. Permit - X"/"Res. Permit - X" format (the recon note paraphrased — the
  IN-list is byte-exact from the live enumeration): 11 construction/land-use classes
  kept; Sign/Pool/Deck/Fence/Solar/Tanks/COO/Sprinkler/Towers/Temporary/Retaining-Wall/
  Bulkhead/Piers/Moving/Storm-Water/Cranes/Bridge/Access-Point + Env-Health variants
  dropped at source. Native ZIP + per-record LATITUDE/LONGITUDE columns; recency on
  APPL_DATE keeps OPEN applications (ISSDATE null pre-issuance).

### Not wired (unchanged verdicts, receipts above)
- **baltimore-city Housing/Building Permits (baltegis …/FeatureServer/3)** — still the
  recon's DECISION NEEDED: an issuance ledger with NO status and NO work-type column, so
  minor-repair noise ("Repair one damaged rafter") cannot be dropped at source; wiring
  include-all would flood pages with trivial jobs (Boston dropped Short Form for exactly
  this). **Founder call, logged, non-blocking** — wire via status_const + include-all
  only on explicit direction.
- **Howard County kvz2-j5cj**: STALLED (newest rows Nov 2025) → stays on the nightly
  reprobe list. Anne Arundel: polygon layers only. Frederick/Harford: no Hub domains.

## 2026-07-16 — PENNSYLVANIA WIRE PASS (Tier 1 state 1 of 17, founder wire order)

**Two metros wired, one NEW connector built (Carto — the founder-flagged Philadelphia
platform), zero guessed values.** All receipts are live pg_net/recon-fetch pulls from
2026-07-16; nothing wired on training knowledge.

### NEW CONNECTOR — `sources/carto.ts` (Carto SQL API)
Philadelphia's open data runs on **Carto** (`phl.carto.com/api/v2/sql`), a raw
PostgreSQL/PostGIS SQL-over-HTTP API — not Socrata/ArcGIS/CKAN. Built the additive
`sources/carto.ts` mirroring the CKAN connector's contract exactly: registry-driven
(`CartoRegistryEntry`: `sql_url`, `table`, `geom_col`, column_map, verbatim
`status_to_bucket`/`type_map`, `extra_where`, `recency_days`), bidirectional coverage
gate, fail-closed on blank/unmapped status, quarantine-don't-stop on the Carto SQL
`error` array, per-record `record_url` with dataset-precision fallback. Carto-specific
mechanics: geometry extracted in the SELECT (`ST_Y(the_geom) AS __lat, ST_X(the_geom)
AS __lng` — records place by their OWN PostGIS point), **ZIP+4 handled with a prefix
`LIKE '<zip>%'`** (Philly stores `19143-3005`) and the emitted `zip` truncated to 5,
recency as a PostgreSQL interval (`<date> > now() - interval 'N days'`). 16 offline
fixture tests (`test/carto-fixture.test.ts`) — incl. the bidirectional gate proof
(Allegheny + Utah ZIPs → 0 fetches) and the SQL-error quarantine.
**Runner + status:** discovered by `scripts/run-unit-tests.mjs` and executed in the
`unit` CI job; 16/16 pass. Until 2026-07-30 this suite lived at
`scripts/carto.fixture-test.ts`, which **no workflow or runner ever referenced** — the
"all passing" claim previously here attested to nothing, because the suite had never
run in CI since it was written. It passes now, and a regression in it now goes red.

### WIRED — philadelphia-li-permits (Carto, City of Philadelphia L&I)
- **FRESH**: newest `permitissuedate` **2026-07-10** (live receipt; the city loads in
  batches — a ≤1-week lag is its normal cadence, confirmed against its own metadata).
- Table `permits` (L&I permit ledger). Scoped at source with `extra_where`:
  `permittype IN ('Building','Residential Building','Demolition','Zoning')` — drops
  Electrical/Plumbing/Mechanical/Fire-Suppression trades noise (WA/MN/IL precedent) —
  AND `typeofwork` whitelist of 12 kept values from the live scoped enumeration (New
  Construction / Full Demolition / Addition and/or Alteration variants / Foundation
  Only / Shell Only / Change of Use...); re-roof/siding/repair minor classes dropped.
- Statuses VERBATIM from the scoped live enumeration: Issued (9,302)→approved,
  Completed (2,611)→operating, Amendment-in-review variants→proposed;
  Expired/Cancelled/Amendment Denied/Withdrawn/Stop Work/Refused/Denied→exclude.
- Native `zip` (ZIP+4 → prefix LIKE), geometry `the_geom` per record. `record_url`:
  dataset-precision (the SQL endpoint is the machine URL — **OpenDataPhilly is 404/
  retired**, so the Boulder machine-endpoint precedent applies; no per-row URL column
  exists and templating one would be guessing).

### WIRED — pittsburgh-pli-permits (CKAN, WPRDC — connector REUSED, zero new code)
- **FRESH**: newest `issue_date` **2026-07-15**, 63,520 rows (live datastore_search_sql
  receipt). Resource `f4d1177a-f597-4c32-8cbf-7885f56253f6` (PLI Permits) on
  `data.wprdc.org` — the founder's PA note said Pittsburgh=CKAN; confirmed live.
- `extra_where`: `"permit_type" IN ('BUILDING','Building & Development Application',
  'Demolition Permit','Land Operations Permit')` — 14 verbatim permit types enumerated;
  Electrical/Mechanical/HVAC/Fire/Sign/Occupancy noise dropped at source.
- 13 verbatim statuses mapped: Issued→approved, Completed→operating, In Review/Ready
  For Issue/Application Finalization/Applicant Revisions/Amendment-*→proposed,
  Expired/Revoked/Stop Work→exclude. Native `zip_code` + per-record
  `latitude`/`longitude`. `dataset_url` = the WPRDC dataset page (human-linkable).

### Rejections / not wired (receipts)
- **Allegheny County ACCD permits (WPRDC)** — NOT a building-permit ledger: the live
  column set is a stormwater engineering extract (Acres / PreImperv / Dschrg_Pts...),
  no zip, no address, coverage label "2020-2025". Rejected on schema, not URL.
- **OpenDataPhilly.org** — HTTP 404, portal retired; datasets live on phl.carto.com
  directly (hence the machine-endpoint record_url above).
- **Six county-hub URL guesses 404'd** (Bucks/Chester/Lancaster/York/Delaware/Centre +
  allentown domain guesses); **Montgomery County PA DCAT hub live but 0 permit
  datasets** in its catalog. Per the corrected-URL-retry rule these were re-probed
  against their real portals where findable; none exposes a first-party per-record
  permit API. Logged for the nightly reprobe list, non-blocking — their ZIPs ship on
  the EPA facilities floor.

### PA go-live results (2026-07-16, DB-verified)
- **560/560 modeled PA ZIPs cached** (incl. the Philadelphia County expansion —
  migration `philadelphia_county_zip_expansion`: county root + 46 zip pages; PA
  514→560, 0 dup slugs, 0 orphans). Centroids zipcodes v3.0.0, 0 quarantined.
- **551 pass + 9 coverage_coming honest empties; 0 unsourced, 0 count mismatches,
  0 point sites missing coords.**
- **72 of 560 ZIPs dev-backed (13%), 15,246 dev records**: philadelphia-li-permits
  10,490 records / 45 ZIPs; pittsburgh-pli-permits 4,756 records / 27 ZIPs.
- **Bidirectional coverage-gate receipt**: philadelphia-li-permits appears ONLY on
  Philadelphia County pages; pittsburgh-pli-permits ONLY on Allegheny County pages.
- Smoke receipts: 19143 → 430 sites (fac 30 + dev 400; carto emitted 400/405, 0
  unmapped, 0 blank; Expired 3 / Cancelled 2 excluded); 15213 → 283 sites (fac 40 +
  dev 243; ckan emitted 243/246; Revoked 3 excluded).
- **522 pages auto-indexable** under the substance gate (no manual flip);
  nationwide indexable after PA: 4,929.

## 2026-07-16 — FLORIDA WIRE PASS (Tier 1 state 2 of 17, founder wire order)

**Three metros wired (Miami, Orlando, Tampa), all on EXISTING connectors — zero new
code.** All receipts are live pg_net probes from 2026-07-16 (response ids 1413-1447);
nothing wired on training knowledge.

### REJECTED AT SMOKE — miami-building-permits (ArcGIS, City of Miami)
**Wired provisionally, then REJECTED on live-smoke evidence — ENGINE-UNREACHABLE
WITHIN THE WORKER BUDGET (slow host, not a block).** Five smoke rounds with
receipts: the layer's host answers Supabase edge-runtime requests ~30-60s per
request REGARDLESS of size (the identical scoped query returns in seconds from
pg_net), so the report burns its wall/CPU budget on fetch alone — 546 at 3mi
(141s), 546 after the out_fields projection (111s), 546 at 1.5mi (~1,400 rows,
115s), 504 at the gateway wall limit with a single page_size=2000 request. A
**Detroit control report ran 200 with 734 arcgis records mid-investigation**, so
the arcgis path itself is healthy — this is host-specific latency toward edge
egress. Two ADDITIVE connector options shipped from the investigation and stay
(both default-off, existing entries byte-identical): **`out_fields`** (project
mapped columns — dense-metro wide rows at outFields=* are a CPU hazard) and
**`page_size`** (fewer, larger pages for slow hosts). Miami-Dade ships on the
facilities floor; → nightly reprobe list (revisit if host latency or the engine
budget changes).

#### (recon detail, kept for the record)
- **FRESH**: max `IssuedDate` = **2026-07-15** (epoch 1784153820000, live statistics
  probe). Hub-catalog `modified` 2026-07-16.
- `Building_Permits_Since_2014/FeatureServer/0` (services1.arcgis.com/CvuPhqcTQpZPT9qY)
  — point features, one row per permit, Latitude/Longitude + real geometry.
- 5 statuses VERBATIM (returnDistinctValues): Active→approved, Final→operating,
  Hold→proposed (Scottsdale ON HOLD precedent), Expired/Revoked→exclude.
- 22 `ScopeofWork` values enumerated; kept: NEW CONSTRUCTION / DEMOLITION / ADDITION
  AND REMODELING / PHASED PERMIT. Dropped at source: ELECTRICAL/PLUMBING/MECHANICAL/
  FIRE/ELEVATOR/BOILER trades, SIGN, LANDSCAPING, TREE PERMIT, BUILDING ROOFING
  (re-roofs), SPECIAL/TEMPORARY EVENTS, ANNUAL FACILITY, BUILDING RECERTIFICATION,
  SHOP DRAWINGS, COOKIE CUTTER (ambiguous city jargon — dropped, not guessed),
  REMODELING/REPAIRS (minor-repair mix — Boston Short-Form precedent).
- No ZIP column → `spatial_zip_radius_mi: 3` (Denver pattern; records keep their OWN
  parcel points). record_url dataset-precision (no per-row URL column).
- **Smoke fix**: the first smoke on 33127 timed out at 120s — the envelope query
  without a source-side type filter fetched every scope in dense Miami. Added
  `extra_where` with the 4-type ScopeofWork IN filter (noise dropped AT SOURCE, the
  standing rule); scoped citywide count = 11,453 rows/365d, fast.
- **Smoke fix 2 — NEW additive arcgis `out_fields` option (Miami is its first
  consumer)**: even scoped, the report hit the edge worker CPU limit (HTTP 546 —
  the CA WORKER_RESOURCE_LIMIT class). Cause: `outFields=*` on 44-column permit
  rows over a dense central-Miami envelope (~1.3 MB per 1,000-row page). The
  connector now accepts an optional `out_fields: [...]` projection (absent ⇒ `*`,
  every existing entry byte-identical); Miami projects its 6 mapped columns.
  **Standing answer: on dense-metro ArcGIS layers, project the mapped columns —
  never ship outFields=* wide rows through the worker.**

### REJECTED AT SMOKE — orlando-permit-applications (Socrata, City of Orlando)
**Wired provisionally, then REJECTED on live-smoke evidence — ungeolocatable at
source (Somerville precedent).** The dataset is fresh same-day and rich, but:
`geocoded_column` is populated on only **67,257 of 1,104,026 rows (6%)** and just
**6 rows in the last 365 days** — a stale one-time geocode, so `within_circle`
scoping returns ~nothing (smoke on 32801: 3 rows, all geocode-quarantined);
`permit_address` is street-only (no ZIP embedded, receipts: "10084 TIDAL WAVE ST",
"240 S SEMORAN BLVD"); there is no ZIP column. No source-side ZIP scope exists →
per-ZIP pages cannot be honestly filled. Orange County ships on the facilities
floor. Entry removed before go-live; the recon detail below is kept for the
nightly-reprobe record (if the city revives its geocode pipeline, wire it).

#### (recon detail, kept for the record)
- **FRESH same-day**: max `processed_date` AND max `issue_permit_date` = **2026-07-16**
  (live SoQL probe). Dataset ryhf-m453 on data.cityoforlando.net, updated daily.
- 66 `worktype` values enumerated; 19 construction/land-use types kept verbatim (New
  167,170 / Alteration 108,474 / Comm 54,124 / Addition 35,841 / Townhomes / MF / MFHR /
  Duplex / MixedUse / HotelMotel / ADU / Foundation / Construct / ChangeUse / ChangeOccu /
  Conversion / Demo / DEM / SFSubd). Dropped at source: Repair 137,791, Roof 87,196,
  LowVoltage 52,284, Fence, Pool, Irrigation, Solar, FireSupp, ELE/MEC/FIR/GAS trades,
  Dumpster, AlrmStickr; blank worktype (60,150) fails the whitelist closed.
- Statuses VERBATIM: Open→proposed, Finaled/Completed→operating; Void/Stop Work/Hold/
  Hardhold/HardHold→exclude. **`Closed` (385,290 rows) left UNMAPPED ON PURPOSE** — it
  spans completed AND dead applications with no disambiguating column; fail-closed, it
  surfaces in `unmapped_statuses`, never guessed. Note: 25,273 `Open` rows carry an
  issue date (the city keeps status Open post-issuance) — mapped verbatim to proposed
  per the city's own label.
- No zip column → Socrata point col `geocoded_column` + `within_circle` spatial scoping
  (the Chicago pattern, zero new code).

### REJECTED AT SMOKE — tampa-single-family-permits (ArcGIS, City of Tampa)
**Wired provisionally, then REJECTED on live-smoke evidence — ENGINE-UNREACHABLE.**
The city server's WAF returns **HTTP 403 to Supabase edge-runtime egress** while the
IDENTICAL URL returns 200 from pg_net (DB-host egress) — verified byte-for-byte, and
UA variation makes no difference (Deno UA and browser UA both 200 from pg_net), so
it is an IP-range block, not a header rule. The engine runs on the edge runtime, so
the source cannot be fetched at report time; wiring it would cache permanent
quarantines. Layer stays verified live/fresh (receipts below) — revisit only if the
engine's egress path changes. Hillsborough/Tampa ships on the facilities floor.

#### (recon detail, kept for the record)
- **FRESH**: max `LASTUPDATE` = **2026-07-15**; 1,020 rows — a live snapshot of current
  single-family permits on the CITY'S OWN ArcGIS Server
  (arcgis.tampagov.net OpenData/Planning/MapServer/32, Accela-backed).
- **Granularity verified**: one row per `RECORD_ID` (groupBy count = 1 across sample) —
  per-permit, not a task log.
- Native `ZIP` column + per-row geometry. Statuses VERBATIM (the snapshot carries only
  two): Issued→approved, Revision→proposed. APPLICATION_TYPE verbatim include:
  "Residential New Construction and Additions (1 and 2 Family)" + "Residential New
  Construction and Additions".
- Found via the Hub domains API (`orgId IbNXlmt2RVVRCZ6M`) → org-scoped AGO search →
  the item's `url` pointed at the city server (the Hub DCAT only exposed Experience
  Builder apps).

### Rejections / not wired (receipts)
- **Fort Lauderdale Building/Land Use Permits (gis.fortlauderdale.gov MapServer/27)** —
  perfect schema (PERMITTYPE/PERMITSTAT/APPROVEDT/FULLADDR) but **STALLED: max
  LASTUPDATEDATE = 2021-01-05**. → nightly reprobe list. Broward ships facilities-floor.
- **Broward County GeoHub** (corrected URL geohub-bcgis.opendata.arcgis.com, live 200):
  0 permit/construction/demolition datasets in the DCAT — GIS layers only.
- **Hillsborough County GeoHub** (corrected URL gis2017-…-hillsborough, live 200):
  0 permit datasets; the county's permit reports live behind HillsGovHub (Accela app,
  no public dataset). Tampa city covers the metro core.
- **Miami-Dade County hub** (gis-mdc, 200 after a transient 500): 0 permit datasets —
  county GIS only; the CITY ledger above carries the metro.
- **Tampa "Active Residential / Commercial Permits"**: exists only as an Experience
  Builder app; no public Feature Service in the org (org-scoped search receipt) — the
  SF layer is the city's public permits dataset.
- **St. Petersburg**: stat.stpete.org redirects to the city CMS (no Socrata catalog);
  no first-party permit API found. Facilities-floor.
- First-pass 404s (domain-not-found): hub-hillsboroughcounty, open-broward,
  data-fortlauderdale, data-pbcgov, data-ocfl, data-pinellas-egis, data-capegis,
  data-sarasotacounty, hub-colliercountyfl — all re-run against their REAL portals
  above where one exists; Palm Beach/Pinellas/Lee/Sarasota/Collier/St. Johns have no
  first-party per-record permit source found this pass → facilities floor.

### FL go-live results (2026-07-16, DB-verified)
- **441/441 modeled FL ZIPs cached** (zipcodes v3.0.0 centroids, 0 quarantined) across
  10 county roots — **the facilities floor**: 0 permit sources survived smoke.
- **425 pass + 16 coverage_coming honest empties; 0 unsourced, 0 count mismatches, 0
  point sites missing coords; 8,807 EPA facilities.**
- **398 pages auto-indexable** under the substance gate (facilities >= 3); nationwide
  indexable after FL: 5,327.
- All four metro rejections (FTL stalled / Orlando ungeolocatable / Tampa WAF /
  Miami slow-host) + hub no-dataset verdicts are on the nightly reprobe list.

## 2026-07-17 — OHIO WIRE PASS (Tier 1 state 3 of 17, founder wire order)

**Three metros wired (Cincinnati, Columbus, Cleveland), all on EXISTING connectors —
zero new code.** All receipts are live pg_net probes 2026-07-16/17 (ids 1942-1969);
nothing wired on training knowledge.

### WIRED — cincinnati-building-permits (Socrata BLDS, Hamilton County)
- **FRESH same-day**: rowsUpdatedAt 2026-07-16; max issueddate/applieddate 2026-07-14.
- Dataset uhjb-xac9 — a **BLDS-standard ledger** (the Boulder class): native
  `originalzip`, `latitude`/`longitude`, per-record **`link`** column (record
  precision), `statuscurrentmapped` normalized statuses.
- Statuses VERBATIM from statuscurrentmapped: Permit Issued (21,999)→approved,
  Permit Finaled (139,840)→operating, Application Accepted/In Review/Approved→
  proposed; Withdrawn/EXPIRED/DENIED/HOLD/VOIDED/REVOKED/APP_EXP/W-REFUND/XCLOSED→
  exclude; raw-code oddballs surface in unmapped_statuses (fail-closed).
- permittypemapped: **Building 44,298 + Wrecking 5,703 kept**; HVAC (48k)/Plumbing
  (44k)/Signs/Elevator/Fire/Excavation-Fill/Repair/Fences/Parking/Misc/Temp dropped
  at source.

### WIRED — columbus-building-permits (ArcGIS, Franklin County)
- **FRESH**: max ISSUED_DT 2026-07-15; the dataset self-describes nightly updates;
  hub modified 2026-07-16. Found via the Hub domains API (orgId 9yy6msODkIBzkUXU) →
  the DCAT GeoService distribution (org-scoped item search only surfaced the two
  archival "Historic Building Permits" services — the DCAT is the reliable path).
- 4 statuses VERBATIM: Permit Issued→approved, Final Inspection Approved +
  Certificate of Occupancy Issued→operating, Expired Permit→exclude.
- GENERAL_TYPE (12 values): all **New Structure** + **Demolition** classes kept
  (1,2,3 Family / Multi Family / Commercial / Unspecified); "- Other" catch-alls,
  Graphics Permit (signs), Other, null dropped/fail-closed.
- Native `B1_SITUS_ZIP` + per-record **ACA_URL** (Accela) — record precision.

### WIRED — cleveland-issued-building-permits (ArcGIS, Cuyahoga County)
- **FRESH**: max ISSUE_DATE 2026-07-11 — consistent with the dataset's stated
  weekly-Sunday cadence. 197,652 rows, 2015-present. Found via corrected-URL retry:
  the recon guess data-clevelandgis 404'd; the real portal is
  **data.clevelandohio.gov** (ClevelandGIS org, launched 2024).
- An **issuance ledger** (no permit-level status column; CURRENT_TASK_STATUS is
  task-level) → the Detroit **status_const** pattern, guarded by
  `ISSUE_DATE IS NOT NULL` in extra_where.
- PERMIT_TYPE: Building Permit + Construction Project kept (Code Enforcement /
  Historical / Velocity Hall dropped); PERMIT_SUBTYPE: Building / Building Permits /
  Commercial / Residential kept (Elevator, Escalator, Mechanical, Install,
  Amusement Device trades dropped at source).
- Per-record **ACCELA_CITIZEN_ACCESS_URL** + LAT/LON columns; no ZIP column →
  spatial ZIP scoping (3 mi).

### Rejections / not wired (receipts)
- **Cuyahoga County hub** (data-cuyahoga, 200): no permit datasets in the DCAT —
  the CITY ledger above carries the metro (consistent with the meetings-side note
  that Cuyahoga runs bespoke systems).
- **Akron/Summit hub** (data-summitgis, 200): no permit datasets in the DCAT.
- **Hamilton County CAGIS root** (cagis.hamilton-co.org/arcgis): 404 — service root
  not public at that path; Cincinnati's BLDS dataset carries the metro.
- **Franklin/Dayton/Toledo hub URL guesses**: 404 (domain-not-found) — no first-party
  per-record permit source found for Dayton/Toledo this pass → facilities floor;
  nightly reprobe list.


## 2026-07-17 — ENGINE HARDENING: fail-loud communities lookup (founder directive)
**Bug (observed live during the FL verifier walk):** the two communities reads that
GATE content — `resolveCommunityIds` (civic-notices layer) and the `commRows`
state/county read (EVERY connector's coverage gate) — discarded the PostgREST
`error`, so a read that failed under load silently resolved to "no communities" and
closed every gate. Receipts: OH smoke 44114/43215 returned 200 with
`arcgis_reports: []` and dev 0 while the identical ZIPs returned thousands of
records minutes earlier (Cleveland 44113 → 4,566), coinciding with both nationwide
verifier walks hammering PostgREST. A page cached in that window would be wrongly
downgraded to facilities-floor/empty — the exact "plausible but wrong" failure the
anti-fabrication rules exist to prevent.
**Fix (engine, additive):** `mustReadCommunities()` — 3 attempts with backoff, then
THROW; a new top-level handler wrapper converts the throw into an explicit JSON 500.
**A 500 is never collected** (the batch collect requires 200 + a `sites` key) and the
refresh cron's transient-safe upsert never sees it — so no report can ever again be
cached with silently-closed gates. **Standing answer: a gate-critical read NEVER
fails soft — wrong data is worse than no data.**

### Fail-loud fix — LOAD-TEST RECEIPTS (2026-07-17, fix deployed mid-verifier-walk)
Re-ran the exact ZIPs under the same nationwide verifier load that reproduced the bug:
- Cleveland 44113 → 200, dev **4,566** (exact match to pre-load run)
- Cleveland 44114 → 200, dev **3,450** (was WRONGLY 0 under the old code)
- Columbus 43215 → 200, dev **1,706** (was WRONGLY 0 / 504 — the entry fires and
  completes; the earlier Columbus 504 was load contention, NOT the Miami slow-host class)
- Cincinnati 45202 → 1,561 / Philadelphia 19143 → 400 / Pittsburgh 15213 → 243 —
  regression-exact
- Columbus-suburb 43230 → explicit **504 IDLE_TIMEOUT** — the fail-LOUD outcome:
  visible, retryable, never collected. No silent empty anywhere.
**Cache-integrity audit of already-live pages:** the only covered-city zeros are
HONEST — Philadelphia 19110: source-side scoped count = 0 (verified against
phl.carto.com); the 8 Pittsburgh dev-zero 152xx ZIPs: zero rows in the PLI feed at
all (suburb/campus ZIPs outside city jurisdiction; verified against WPRDC SQL).
No cached page was wrongly downgraded.
**Follow-up logged (non-blocking):** the Miami slow-host rejection was measured
while verifier walks were running — the evidence (pg_net fast vs edge slow,
Detroit control passing) still points at the host, but re-test Miami in an idle
window before Florida's next reprobe pass.

## 2026-07-17 — NEW JERSEY WIRE PASS (Tier 1 state 4 of 17, founder wire order)

**Facilities-floor state — no wireable per-record source survived recon** (all
receipts live pg_net/recon-fetch 2026-07-17). NJ is unusual: the STATE mandates
permit reporting, but the mandated dataset is aggregate-by-design.

### Rejections / not wired (receipts)
- **NJ Construction Permit Data (data.nj.gov w9se-dmra, NJ DCA)** — the one
  statewide mandated dataset (N.J.A.C. 5:23-4.5(d)), fresh monthly (data through
  2026-07-07, updated 07-08), 60-month rolling window. **Rejected: no honest ZIP
  scope exists.** The DCA's own description states: "We do not get property
  address, geocoding, owner names, type of work… What we have here is all we get."
  Columns are municipality code + tax block/lot + fees/status/use-group. Mapping
  municipality→ZIP would be guessed geography (USPS city ≠ NJ municipality;
  townships/boroughs overlap ZIPs) — the Orlando/Somerville class. Logged as a
  possible FUTURE muni-level area enrichment if an authoritative muni→ZIP
  crosswalk is ever adopted (founder decision, non-blocking).
- **Jersey City (data.jerseycitynj.gov — real portal found, Opendatasoft not
  Socrata)**: the 36 permit-tagged assets are a planning-application DOCUMENT
  library (per-case PDFs: staff reports, affidavits, notice packages) — no
  structured per-record ledger to map verbatim. Reject on schema.
- **Newark (data.ci.newark.nj.us)**: 503 Cloudflare bot-challenge to non-browser
  clients on repeated probes — engine-unreachable class (the Tampa precedent).
  Newark's **NewGIN** AGO hub (found via corrected-URL retry) carries only
  environmental/zoning layers (TRI/NJDEP facilities, permitted-use zones) — no
  permit ledger.
- **NJ DCA hub (njdca-data-hub-njdca.hub.arcgis.com)**: "Building Permit Data" /
  "Demolition Permit Data" / "Raw Permit Data" are hub DOCUMENTS whose GeoService
  links point back at the same muni-level DCA reporter page — not feature services.
- **NJGIN state catalog** (6.8 MB DCAT): permit-ish titles are NJDEP air-quality
  facility layers (environmental registries, already covered by the EPA floor),
  a 2018 archive, and DOT status layers — no construction-permit ledger.
- **County hub guesses** (Bergen/Morris/Monmouth/Middlesex/Hudson): domain-not-found
  404s; no first-party county hubs located. → nightly reprobe list.

## 2026-07-17 — CONNECTICUT WIRE PASS (Tier 1 state 5 of 17, founder wire order)

**Facilities-floor state** (receipts: recon-fetch run 29547920571 + pg_net
1995-1997). CT's 169-town home rule means no county governments and no
consolidated per-record permit ledgers anywhere we could find.

### Rejections / not wired (receipts)
- **data.ct.gov (state Socrata, live + fresh)**: every permit hit is an AGGREGATE —
  "Monthly Building Permits Issued by Units in Structure", "Annual Housing Permit
  Data By Town, 1990-2024" (DECD survey, town-level annual counts), CAMA/parcel
  assessor extracts, liquor-license availability by town. No per-record source.
- **Hartford (data.hartford.gov)**: the city's Socrata portal is DECOMMISSIONED —
  the domain now returns "Cannot GET /api/catalog/v1" and the central Socrata
  discovery API returns "Domain not found: data.hartford.gov". Third-party guides
  still cite it (stale).
- **Stamford**: recon domain DNS-dead (fetch failed).
- **New Haven**: city site offers PDF permit applications + a city-plan GIS page —
  no structured ledger.
- **Bridgeport / Norwalk / New Haven hub guesses**: domain-not-found 404s.
→ all on the nightly reprobe list.

## 2026-07-17 — MISSOURI WIRE PASS (Tier 1 state 6 of 17, founder wire order)

**Facilities-floor state** (receipts: recon runs 29548344593/29548658065 + pg_net
1998-2004).

### Rejections / not wired (receipts)
- **Kansas City "Permits - CPD Dataset" (data.kcmo.org ntw8-aacc)** — a perfect
  BLDS-class ledger (native originalzip, lat/lng, per-record CompassKC link,
  permittypemapped) but **STALLED: max :updated_at = 2025-05-09** (14 months;
  confirmed in-data, not just catalog metadata). The companion status-change
  dataset stalled 2024-10. **Top of the nightly reprobe list** — if KCMO revives
  the feed it wires in minutes.
- **St. Louis Regional Data Exchange (rdx.stldata.org, CKAN)** — hosts the city's
  building-permits database (updated ~monthly per the city site) but the host is
  **UNREACHABLE from BOTH egress paths** (pg_net 30s+60s timeouts AND GitHub-runner
  fetch failed ×2) — engine could never fetch it. → nightly reprobe list.
  - ✅ **RE-PROBED 2026-08-05 against governance §0 and the verdict is UNCHANGED — now with the
    mechanism rather than a summary.** The two paths named above are `pg_net` and a GitHub runner;
    **neither is the Deno edge runtime the engine runs on**, which is why this was re-opened. It
    reproduces exactly on all three URLs (`/`, `/api/3/action/status_show`,
    `/api/3/action/package_search?q=permit`), 60 s timeout each, and the timing breakdown is the
    answer: **`DNS time: 70.867 ms, TCP/SSL handshake time: 59929.462 ms, HTTP Request/Response
    time: 0.000 ms`**. DNS resolves in 71 ms; the **TLS handshake consumes the whole 60 s and never
    completes**; the request is never sent. That is a packet **blackhole** — not a `Connection reset
    by peer` (Dayton), not a WAF 403 (Tampa/El Paso), not a DNS failure.
  - **This is NOT the `EDGE_EGRESS_BLOCKED` class, and the distinction is the point.** That verdict
    requires a **positive control** — a path that demonstrably works, as Dayton had (`pg_net` 200 /
    413,143 bytes / 212 features on the exact connector URL). Here **no path returns anything**, so
    there is nothing to justify wiring it to test the edge runtime. Class: **`unreachable`**.
- **St. Louis city's own portal (stlouis-mo.gov/data)**: building permits ship as
  a ~monthly 30 MB Microsoft Access ZIP download — no API, not wireable as data.
- **Springfield (gisdata-cosmo hub, live)**: 0 permit/construction datasets in the
  DCAT (GIS base layers only).
- **St. Charles hub**: CONT_0001 item-inaccessible; **Columbia/Boone + both St.
  Louis hub guesses**: domain-not-found 404s.

## 2026-07-17 — TENNESSEE WIRE PASS (Tier 1 state 7 of 17, founder wire order)

**One metro wired (Nashville) on the existing arcgis connector — zero new code**
(receipts: recon run 29551286796 + pg_net 2005-2010).

### WIRED — nashville-building-permits-issued (ArcGIS, Metro Nashville-Davidson)
- **FRESH**: max Date_Issued **2026-07-15**; hub modified 2026-07-16; 28,790 rows.
- **Platform migration found by corrected-URL retry**: Nashville moved Socrata →
  **ArcGIS Hub** (the old data.nashville.gov catalog path now 404s "Cannot GET",
  and the central Socrata discovery API says Domain not found). The Hub DCAT
  exposes `Building_Permits_Issued_2/FeatureServer/0` on services2.arcgis.com —
  the healthy host class. **Standing answer: a "Cannot GET /api/catalog/v1" from
  a former Socrata domain means PLATFORM MIGRATION, not a dead portal — pull the
  domain's Hub DCAT before rejecting.**
- Issuance ledger (no status column) → Detroit **status_const** pattern, guarded
  `Date_Issued IS NOT NULL`. Native **ZIP** + **Lat/Lon** columns.
- 34-value verbatim Permit_Type_Description domain; **12 construction/land-use
  classes kept** (Residential/Commercial New, Addition, Foundation, Shell,
  Structural Frame, Tenant Finish Out + Demolition); Rehab/storm/fire repairs,
  Roofing-Siding, Signs, Tree Removal, U&O, Change-Contractor, Amend, Moving,
  Temporary dropped at source.

### Rejections / not wired (receipts)
- **Memphis (data.memphistn.gov)**: same "Cannot GET /api/catalog/v1" AND the Hub
  retry finds no permit ledger — the central discovery API has no such domain and
  no Hub DCAT answers. No first-party per-record source found.
- **Chattanooga**: recon domain is a dead Pantheon shell ("No Site Detected").
- **Knoxville hub**: GWM_0003 permission error — the AGO org exists but its hub is
  PRIVATE; **Knox County KGIS**: 401 Unauthorized at the REST root.
- **Shelby / Rutherford hub guesses**: domain-not-found 404s.
→ all on the nightly reprobe list. Memphis/Knoxville ZIPs ship facilities-floor.

## 2026-07-17 — OREGON WIRE PASS (Tier 1 state 8 of 17, founder wire order)

**One metro wired (Portland) on the existing arcgis connector — zero new code**
(receipts: recon run 29557291700 + pg_net 3806-3813).

### WIRED — portland-building-permits (ArcGIS, City of Portland)
- **FRESH**: max ISSUEDATE **2026-06-10**; 36,263 rows. Layer lives on the custom
  **portlandmaps.com/od/rest** AGS host (the recon `portlandmaps.com/arcgis/rest`
  root has an empty top-level `services[]` — the `/od/rest/services/
  COP_OpenData_PlanningDevelopment/MapServer/89` tree is the real one, found via
  the PDX Hub search on gis-pdx.opendata.arcgis.com). Standing answer: when a
  city's AGS root looks empty, search its Hub for the dataset's GeoService URL.
- **No ZIP column** (X_COORD/Y_COORD state-plane + Shape point geometry) →
  `spatial_zip_radius_mi: 3` (envelope on geometry, records keep own points),
  with `out_fields` projection (7 mapped cols).
- 7 STATUS values VERBATIM: Issued + Approved to Issue→approved, Final + Under
  Inspection→operating, Application + Fees Due→proposed, Expired→exclude.
- NEWCLASS (construction axis, 6 values): New Construction / Addition /
  Replacement / First / Move kept; Alteration + null dropped at source. NEWTYPE
  (occupancy: Business/Rowhouse/Duplex/Hotel/Mercantile/…) rides in the title.
- Coverage gated to Multnomah/Washington/Clackamas; the spatial envelope
  self-limits to the city footprint regardless.

### Rejections / not wired (receipts)
- **Eugene / Bend / Medford-Jackson / Washington Co / Clackamas Co hub guesses**:
  domain-not-found 404s. **Salem hub**: GWM_0003 permission error (private).
  No first-party per-record permit source located for those → facilities floor.
→ nightly reprobe list.

## 2026-07-24 — WISCONSIN / MADISON CONNECTOR RESTORATION WIRE PASS

**One connector RESTORED as committed, reproducible config (registry-only — zero
adapter/engine code changes): `madison-planning-projects`** (receipts: pg_net
82715-82721, 82973-82978; golden-set SQL in this section).

### Why a "restoration"
The connector existed ONLY in an uncommitted deployed engine (never in git — pickaxe
`--all -S"madison-planning-projects"` = 0 across both repos; not in any PR; not in the
parked bundle). It produced 2,452 cached records across 20 Dane County ZIPs, then
vanished on 2026-07-17 when the engine was redeployed from committed source
(deploy-edge-functions.yml build; classification: accidental regression / build
omission). The 20 ZIPs froze and aged into `failed_ingest`. This pass reconstructs the
entry from forensic evidence and commits it so a rebuild can never drop it again.

### RESTORED — madison-planning-projects (ArcGIS, City of Madison)
- **Upstream ALIVE + schema intact** (re-verified 2026-07-24, HTTP 200): layer 0
  "Current Planning Project Points" of `maps.cityofmadison.com/arcgis/rest/services/
  Planning/Current_Planning_Projects/MapServer`, esriGeometryPoint, 598 features; all
  identified fields present (RECORD_RecordID / RECORD_Status / Project_Description /
  ProjectURL / DATES_SubmittedDate / APO_ADDRESS_PARTIAL_LINE).
- **Field map recovered by matching live features to cached output** (e.g.
  LNDUSE-2015-00037): case_number←RECORD_RecordID, status_raw←RECORD_Status,
  title←Project_Description, record_url←ProjectURL (100% populated upstream, 0 blank;
  equals the `development.cfm?record={case_number}` template on ALL 502 golden cases →
  template kept as insurance, precision "record"), file_date←DATES_SubmittedDate
  (epoch ms), address←APO_ADDRESS_PARTIAL_LINE, geometry←source point (__lat/__lng).
- **NO ZIP column** → `spatial_zip_radius_mi: 3`, recovered EXACTLY from the golden
  set: box-membership fit over 502 projects × 20 centroids gives R ∈ [3.0026, 3.0028)
  → the engine-standard 3 mi. ArcGIS's own envelope intersect at R=3 reproduces
  per-ZIP membership EXACTLY (53703: 231/231, 53562: 48/48, 53598: 1/1; 0 diff).
- **Status policy — every upstream status enumerated, fail closed**: 13 statuses
  mapped VERBATIM from the golden set (proposed: In Process, Application Under Review,
  Additional Info Required, Waiting for Fees; approved: Final Approval Granted,
  Recorded, "Approved, Final Review Pending", "Approved, Under Final Review", Approved
  and Recorded, Approved Preliminary Plat; operating: "Approval Granted, Completed",
  "Approved, Demolished", "Approved, Constructed" — commas exact) + 4 explicit
  exclusions ("Approval(s) expired" AND "Approval(s) Expired" — the source emits BOTH
  casings and returnDistinctValues showed only one (silently truncated distinct — the
  Mesa $limit lesson, spatial variant); Inactive; Placed on File or Denied — all
  lapsed/dead/denied, all 0-in-golden). Any FUTURE status surfaces as unmapped
  (dropped + reported), never silently bucketed.
- **No type_map** (golden = 100% use_type "unclassified"), **no recency filter**
  (planning projects kept regardless of age; golden spans 2015+), Web_Planning_Project
  omitted ('Y' on all 598 rows — a no-op filter).

### Golden-set comparison (run WITHOUT deploying, via pg_net + SQL)
Golden = the 2,452 cached records (20 ZIPs, 502 distinct cases, frozen 2026-07-17):
- **reproduced: 501/502**; **URL mismatches: 0**; **duplicate case rows: 0**;
  **unmapped: 0**; per-ZIP spot membership identical (3 ZIPs, 0 diff both directions).
- **cache-only: 1** — LNDCSM-2026-00010 ("Approved, Under Final Review" at freeze) is
  ABSENT from today's upstream (city-side deletion since 2026-07-17). Explained; kept
  in cache under last-known-good semantics until the next refresh naturally supersedes.
- **new-only: 2** — LNDUSE-2017-00052 (Final Approval Granted), LNDUSE-2025-00023
  ("Approved, Final Review Pending"): real mapped projects, template-true URLs.
  +0.4% = normal upstream drift over 7 days, not false-positive expansion.
- Current upstream: 598 features → 503 pass the mapped set, 95 excluded by the dead
  statuses, 0 unmapped, 0 blank.

### Tests (committed)
- `test/madison-connector.test.mjs` (CI `unit` job): registry contract, status policy
  (17 enumerated, no dual-bucket, fail-closed), normalization vs the committed
  7-real-feature fixture `fixtures/madison/planning-projects-sample.json` (captured
  live 2026-07-24; stable public records, not a full-payload snapshot), edge shapes.
- `test/arcgis-fixture.test.ts` (discovered by `scripts/run-unit-tests.mjs`, executed in
  the `unit` CI job; 31/31 pass — carto/ckan/csv follow the same pattern at
  `test/{carto,ckan,csv}-fixture.test.ts`): the ACTUAL
  `arcgisForZip` with mocked fetch — coverage gate (Dane yes / Milwaukee no / Utah
  no / 0 fetches out of coverage), spatial envelope params, pagination
  (exceededTransferLimit + resultOffset), deterministic source_ids, dedup, empty
  response (honest 0), ArcGIS error object (quarantined fetch failure, never
  0-success), missing-centroid skip.

### Rollback
Remove the single `madison-planning-projects` entry from
`supabase/functions/get-address-report/jurisdiction-registry.json` (and the two test
files), redeploy via `deploy-edge-functions.yml` — the engine is otherwise byte-
identical; no other connector is touched. Cached Madison records persist under the
collector's last-known-good guard (dev>0 rows are never overwritten by an empty
response), exactly as they persisted after the original regression.

## 2026-07-25 — BATCH 4 (corrected-URL discovery: El Paso TX, Fairfax VA, + 9 counties)

**WIRED — `fairfax-active-site-construction`** (VA / Fairfax). `www.fairfaxcounty.gov/mercator/rest/services/LDS/DevelopmentTracker/FeatureServer/1` ("Active Site Construction - Centroid Point", 2,183 rows, point geometry). Corrected-URL find: Fairfax's server is under `/mercator/`, not a `data.`/`opendata.` host. Freshness gate passed BEFORE wiring — max `last_edited_date` 2026-07-25 (same day), `RECORD_STATUS_DATE` 2026-07-22. `LINK_URL` populated on every row (`IS NULL` count = 0) giving **record-precision** Accela ACA deep links. `RECORD_STATUS` verbatim: Approved 1,170 + Revised 871 → approved; Closed 133 → operating; Denied/Expired/Voided/Withdrawn/Revised-Pending Customer → exclude. 9 of 11 `APPTYPEALIAS` plan types kept (Bond Reduction/Bond Extension dropped at source). Spatial ZIP scoping — `ZIP_CODE` NULL on 457/2,183 (21%) and mixes 5-digit with unpunctuated ZIP+4. No `recency_days` on purpose: the county already scopes the layer to active construction; a 365d cut on `SUBMITTED_DATE` would keep only 371 of 2,183. **Production result: 46 of 47 modeled Fairfax ZIP pages, 8,112 records, 0 missing record_url, 0 missing coords, 100% record-precision URLs.**

**REJECTED — El Paso TX `gis.elpasotexas.gov` (WAF blocks the Supabase edge runtime).** Wired and deployed, then **retired the same day** on measured production evidence. The city's own ArcGIS Server (v11.3, `Planning/NewResidential` FeatureServer layer 1, 42,677 rows, 605 in the trailing 365d) answers **pg_net with 200** but returns **HTTP 403 to the edge-function runtime** on the identical query — recorded verbatim in the run report for all 143 El Paso ZIPs: `"fetch failed: HTTP 403 for https://gis.elpasotexas.gov/arcgis/rest/services/Planning/NewResidential/FeatureServer/1/query?..."`. Result was `fetched: 0, emitted: 0` on every ZIP. **This is the Tampa precedent** (FLORIDA WIRE PASS: live + fresh on the city's own server, identical URL 200 from pg_net, WAF 403s edge egress by IP range). The entry was removed so the daily refresh does not fire 143 doomed requests; El Paso goes on the **nightly reprobe list**. Not a schema or config problem — the source is well-shaped and would be wireable if egress were allowed.

**REJECTED — El Paso `Planning/NewCommercial`** (11,322 rows / 524 in 365d): a groupBy over the 365d window returns a **single blank `Record_Typ` group** (n=524) and non-blank `Descriptio` count = **0**. No title source and nothing to classify or whitelist — every record would render as a bare permit number with `use_type: unclassified`. Failed the gate independently of the 403.

**Counties investigated this batch with firm verdicts (9):**
- **Dallas TX** — `gis.dallascityhall.com` + `egis.dallascityhall.com` live (v10.91/10.61). All public folders evaluated: `Pbw_public/ROWMSPermits` is right-of-way work by its own service description ("construction in public right-of-way, including the street, median and parkway") — street cuts, not building development; `sdc_public` carries CityProperty/Zoning/PD_SUP_Search (zoning polygons, no permit ledger); `Crm_public` is geocoders only. **No building-permit layer exposed.**
- **Dallas County TX** — `gis.dallascounty.org` fails TLS ("SSL peer certificate or SSH remote key was not OK").
- **Worcester MA**, **Allegheny PA**, **Orange CA** (`gis.ocgov.com`) — DNS failure on the `gis.` host; `gis.santa-ana.org` 404.
- **Oklahoma City OK** — Incapsula WAF shell.
- **Sedgwick KS (Wichita)** — HTML app shell, no REST root.
- **El Paso TX**, **Fairfax VA** — as above.

**Deferred, not counted as evaluated (2):** Suffolk County NY (`gis.suffolkcountyny.gov` returned 403 "Suffolk County Server Maintenance" — retry later), Westchester NY (GeoHub v2 live; the DCAT feed probe returned no response).

**Leads discovered but not evaluated (next batch):** Fairfax `LDS/PLUSApprovedSiteRecords`, Fairfax `DevelopmentTracker` layer 0 "Data Center Development" (polygon; directly relevant to the data-center tier), layers 3-5 (Recent Building Permits / Certificate of Occupancy).

**Standing answer added: a source that passes every schema gate can still fail on EGRESS.** pg_net reachability does NOT prove edge-runtime reachability — the two use different IP ranges and municipal WAFs block them differently. The recon path (pg_net) and the production path (edge function) must both be proven before a source counts as wireable. El Paso and Tampa are the two known instances.

## 2026-07-25 — BATCH 5 (final corrected-URL batch; campaign concluded)

Scope was restricted to leads already discovered in Batch 4 — no broad discovery of new counties.

**WIRED — `fairfax-recent-building-permits`** (VA / Fairfax). `LDS/DevelopmentTracker/FeatureServer/4` ("Recent Building Permits - Centroid Point", 11,325 rows, point geometry). Same host already proven edge-runtime-reachable by `fairfax-active-site-construction`, so the egress gate that killed El Paso is satisfied. Freshness: `last_edited_date` 2026-07-25 (same day). `LINK_URL IS NULL` = 0 → record-precision Accela **Building** deep links. 7-value `RECORD_STATUS` and 4-value `APPTYPEALIAS` mapped verbatim; `recency_days` 365 (3,964 of 11,325 — unlike layer 1 this IS an issuance ledger reaching back to 2021). Title leads with `APPTYPEALIAS` because `PROJECT_NAME` is blank on 1,921 rows (17%). **Yield note: Fairfax was already 46/47 pages populated by layer 1, so this is a records/completeness gain (P3), not newly populated pages (P1).**

**REJECTED — every remaining Fairfax layer, all POLYGON.** The arcgis connector flattens POINT geometry only (`f.geometry.x/y`), so a polygon layer produces no coordinates, no markers, and degrades every record to area scope: layer 0 `Data Center Development`, layer 2 `Active Site Construction - Parcels` (duplicate of the wired layer 1 in parcel form), layer 5 `Recent Building Permits - Parcels` (duplicate of the wired layer 4), layer 6 `Certificate of Occupancy`, and `LDS/PLUSApprovedSiteRecords`. Layer index 3 does not exist. **Standing answer: a "- Parcels" twin of a "- Centroid Point" layer is the same records in polygon form — never wire both, and never wire the polygon one.**

**REJECTED — Westchester County NY (75 dev-empty ZIPs).** Corrected-URL retry DID find the real server — `giswww.westchestergov.com/arcgis/rest/services` (ArcGIS Server 11.5), after `data.westchestergov.com` and `gis.westchestergov.com` both failed DNS and the Hub DCAT 404'd ("A domain record with hostname = gis-westchestercountygis.opendata.arcgis.com does not exist"). But **both permit-bearing folders are access-restricted**: `Municity5` (the county's Municity permitting system) and `DOH_Permit` each return `{"error":{"code":499,"message":"Token Required"}}`. The public folders carry no permits — `LocalMunicipality` is MS4 viewers / imagery / conservation-area reference maps, `Hosted` is a single Priority Waterbody List. Buffalo precedent (restricted views). → nightly reprobe list.

**REJECTED — Suffolk County NY (107 dev-empty ZIPs).** `gis.suffolkcountyny.gov` still returns HTTP 403 behind a "Suffolk County Server Maintenance" page (unchanged from Batch 4); `gis2.` and `maps.suffolkcountyny.gov` both fail DNS; the ArcGIS Online group search surfaces only unrelated items (a Peconic Estuary education group). → nightly reprobe list.

**CAMPAIGN CONCLUDED.** Batch 5 produced ~0 newly populated ZIP pages against a 20/day and 40/batch threshold; Batch 4 was below the discovery-efficiency threshold. Two consecutive batches below threshold → the corrected-URL ArcGIS campaign is closed. The known-lead pipeline is empty: both deferred counties are firmly rejected and every Fairfax layer is evaluated.

---

## 2026-07-27 — TEXAS DEV-COVERAGE PASS (Collin / Denton / Montgomery / Fort Bend / El Paso)

Scope: the five Texas counties carrying the most facilities-only ZIP pages (El Paso 145,
Denton 32, Collin 28, Montgomery 22, Fort Bend 21). Recon by `pg_net` (the sandbox has no
egress). One source wired; the rest rejected with receipts below.

### WIRED — `frisco-active-building-permits` (Collin + Denton)

City of Frisco's own ArcGIS Server, layer 1 of `Public/External_Planning_and_Zoning`.
**READY — config only, no code change.** Full evidence lives in the entry's `_receipts` in
`jurisdiction-registry.json`; the load-bearing facts:

| Gate | Evidence |
|---|---|
| First-party | `maps.friscotexas.gov` — the city's own server |
| Geometry | `esriGeometryPoint`, returned in wkid 4326 |
| Freshness | newest `Issued_Date` **2026-07-24** (3 days before wiring), oldest 2022-05-04, **86 issued in the trailing 30 days**; layer is the city's **active** working set, 753 rows |
| Status vocabulary | live groupBy → `ISSUED = 753` of 753 (single verbatim value) |
| Type vocabulary | live groupBy → Single Family Residential 503, Commercial 226, Multi-Family Residential 22, School 2 — all four kept, **0 unclassified**, no trade noise to drop |
| `record_url` | per-record eTRAKiT deep link in `Hyperlink` → **record precision** |
| ZIP scoping | `Address` is street-only, no ZIP in the schema → `spatial_zip_radius_mi: 3` (Denver/Minneapolis/Chicago pattern) |

**Two traps avoided, both on existing standing answers.** (1) `Issued_Date` is
`esriFieldTypeString` in `M/D/YYYY`, so `recency_days` is **deliberately absent** — it emits a
`>= DATE 'yyyy-mm-dd'` literal against a string column (the Anaheim standing answer), and
`M/D/YYYY` does not string-compare chronologically either. `isoDay()` already parses `M/D/YYYY`
(`arcgis.ts:541`), so `file_date` normalizes with no code change.

**Measure freshness on the PARSED date, never on a server-side sort of a string date column.**
`orderByFields=Issued_Date DESC` on this layer returns `12/31/2025` — a *lexical* max, since
`"12/…"` sorts above `"7/…"`. The true chronological max is **2026-07-24**, read from the parsed
`file_date` in the live cache. An earlier draft of this receipt quoted the lexical value and
understated the source's freshness by seven months. (2) The AGO search hit pointed
at `mapcache.friscotexas.gov`, which **does not resolve** — the live host was found by walking
the city's own app item → web map → `operationalLayers`, not by guessing a URL.

**New standing answer: a dead host in an AGO search result is not a dead source.** AGO item
`url` fields go stale when a city migrates servers. Walk the owning app/web map to its
`operationalLayers` before rejecting — that is how Frisco was recovered after its search-result
host failed DNS.

**Measured ZIP lift** — all 753 points fetched and run through the connector's own
`envelopeFor(lat, lng, 3)` against `zip_centroids`. 8 pages, every one currently at
`dev_markers = 0`:

| ZIP | Page | County | Permits in envelope |
|---|---|---|---|
| 75035 | Frisco (75035) | Collin | 278 |
| 75034 | Frisco (75034) | Collin | 221 |
| 75036 | Frisco (75036) | Denton | 221 |
| 75078 | Prosper (75078) | Collin | 147 |
| 75056 | The Colony (75056) | Denton | 67 |
| 75024 | Plano (75024) | Collin | 43 |
| 75033 | Frisco (75033) | Denton | 21 |
| 75025 | Plano (75025) | Collin | 13 |

Coverage declares **both** Collin and Denton because the City of Frisco straddles the county
line — confirmed against our own rows (75034/75035 are Collin pages, 75033/75036 are Denton).

### REJECTED — Denton County `gis.dentoncounty.gov` `DEV_Permits` (STALLED)

The county's own server is live (ArcGIS 11.5) and the layer is well-shaped — point geometry,
56,500 rows, `PermitType`/`DateReceiv`/`PermitStat`. It is **frozen**: `max(DateReceiv) =
1686286800000` = **2023-06-09**, on both the MapServer and FeatureServer copies, matching the
layer's own title `Development Permits (1/05-7/23)`. Worcester/KCMO precedent. → nightly reprobe
list. Sibling services (`CityETJPermits_GC`, `ZoningPermits_GC`, `OSSFPermits_GC` septic,
`Floodplain_PermitApp`, `UTILITY_Permits`) are utility/septic/floodplain paperwork, not
development records.

### DECISION NEEDED — McKinney `EnergovRecords` (Collin)

`maps.mckinneytexas.org/mckinney/rest/services/MapServices/EnergovRecords` is live, first-party
Tyler EnerGov (the Ann Arbor precedent), both layers point geometry. Neither layer is wireable
as-is:
- **Layer 0 `Energov Records`** — 328,727 rows and **no date column at all** (`MODULE`,
  `ENT_NUMBER`, `ENT_WORK_CLASS`, `ENT_DESCRIPTION`, `ENT_STATUS`, `ENT_PARCEL`, `ENT_MA1/2`).
  Undated records cannot be honestly dated or aged out. Baltimore-city precedent — a founder
  call, not a config gap.
- **Layer 1 `Active Construction`** — clean vocabulary (`permit_number`, `permit_status`,
  `permit_type`, `description`, `project`, `main_address`) but its only date is
  `last_inspection_date`, which is **not** a filing or issuance date. Presenting it as
  `file_date` would mislabel the record.

Logged, non-blocking. Also carries engineer name/email/phone columns — project them out with
`out_fields` if it is ever wired.

### REJECTED — Fort Bend County (access-restricted)

Org is real (`fbcgis` / `HfQs2ClqmipKpmFK`, "Fort Bend County GIS"). Its **"Fort Bend County
Permitting"** app's web map (`310f18d4ac5246199976396c933a977f`) returns
`{"error":{"code":403,"messageCode":"GWM_0003","message":"You do not have permissions to access
this resource"}}` — Westchester/Buffalo restricted-item precedent. The org's public services
carry no permit records: `Subdivisions`, `All_Subdivisions`, `Subdivision_Alias`,
`Development_Agreement` are boundary/reference layers. The county's own
`arcgisweb.fortbendcountytx.gov` answers `{"status":"error","messages":["Could not access any
server machines"]}`. Sugar Land (`gis.sugarlandtx.gov`) fails DNS. → nightly reprobe list.

### REJECTED — Montgomery County (no first-party source found)

No first-party per-record permit source. `gis.cityofconroe.org` → 404;
`gis-cityofconroe.opendata.arcgis.com` → Hub domain does not exist. The AGO searches surfaced
only third-party lookalikes — a Lee & Associates broker layer ("New Houston Developments") and,
for the generic permit query, `comadmin_comgis` "Permits", which is **Midland, Texas**
(`allowedRedirectUris: https://maps.midlandtexas.gov/portal/`), not Montgomery. Cross-city
lookalike class — the same trap as the Calgary/WA and Kent DE/RI hits.

### STILL BLOCKED — El Paso (unchanged, re-probed)

`gis.elpasotexas.gov/.../Planning/NewResidential/FeatureServer/1` re-probed 2026-07-27: **200
from pg_net** (`currentVersion 11.3`), confirming the source is alive and well-shaped. The
blocker is unchanged and is not ours to fix from config — the WAF 403s the Supabase
edge-runtime IP range. Stays on the nightly reprobe list; still the single largest TX prize at
**145 pages**.

### Also rejected on egress/DNS (URL-guess round, no leads lost)

`gis.plano.gov` DNS · `maps.cityofallen.org` TLS handshake timeout · `data.plano.gov` DNS.
Plano's 43+13 pages are already served by the Frisco entry's envelope.

---

## 2026-07-27 — UTAH / ARIZONA MAPS COVERAGE PASS (5 sources wired)

Scope: complete UT/AZ Maps Page source coverage per the `0032Maps.IngestFeedInventory.xlsx`
research brief. Recon and every receipt below via `pg_net` (the sandbox has no egress — a
`curl` to `arcgis.com` and to `data.mesaaz.gov` both return `000`). Five sources wired, all
first-party, **config only — no connector, engine or schema change.**

### FINDING FIRST — the workbook's "Live" is coverage-gate based, not record based

The brief opens with Utah 65/310 and Arizona 136/364. Those are **county-coverage** counts:
`slc-planning-petitions` declares `{AZ→no, UT/Salt Lake}` so all 36 Salt Lake ZIP pages counted
as Live, and the three Maricopa sources made all 136 Maricopa ZIP pages count. The task defines
Live as *"the Maps Page has actual source data populating the satellite, street, and focus
maps."* Measured that way against `development_reports` (all 674 UT/AZ rows refreshed
2026-07-27, so this is fresh truth, not stale cache):

| | Workbook "Live" | **Actual ZIPs with registry records** |
|---|---|---|
| Utah | 65 / 310 | **16 / 310** (slc 12, provo 4) |
| Arizona | 136 / 364 | **38 / 364** (mesa 25, scottsdale 13, tempe 5; distinct after overlap) |

Query of record: `communities` (level='zip') joined to `development_reports`, counting sites
whose `source_registry_id`/`source_id` is non-null. EPA-FRS facilities are excluded from that
count, per the brief's instruction not to let the facilities floor mark a state complete.

### Existing 5 UT/AZ entries — verified present, endpoints live

No duplicates created; all five were already in `jurisdiction-registry.json` and all five
answer `returnCountOnly` / `$select=count(1)` with HTTP 200:

| registry_id | live record count |
|---|---|
| `mesa-building-permits` (socrata) | 155,543 |
| `scottsdale-building-permits` | 288,061 |
| `tempe-building-permits` | 19,938 |
| `slc-planning-petitions` | 3,113 |
| `provo-planning-applications` | 196 |

### WIRED — the five new sources

Full evidence lives in each entry's `_receipts` in `jurisdiction-registry.json`. Load-bearing facts:

| registry_id | Coverage | Records | ZIP scoping | record_url | Freshness |
|---|---|---|---|---|---|
| `tucson-commercial-building-permits` | AZ/Pima | 4,805 | native `POSTALCODE` (29 ZIPs) | **record** (Tyler EnerGov `CSS_URL`) | ISSUEDATE 2026-07-24 |
| `tucson-residential-building-permits` | AZ/Pima | 19,388 | spatial 3 mi (no ZIP column on this layer) | **record** (`CSS_URL`) | ISSUEDATE 2026-07-24 |
| `gilbert-energov-permits` | AZ/Maricopa | 214,662 | native `AddressZip` | dataset | 362 issued 07-01..07-27 |
| `casa-grande-active-development-sites` | AZ/Pinal | 86 | spatial 3 mi | dataset | Submit_Date 2025-12-12 (see note) |
| `udot-active-projects` | UT statewide | 2,145 (358 active) | spatial 3 mi | dataset | dataLastEditDate 2026-07-27 |

All status and type vocabularies were read from **live groupBy** and copied verbatim; unlisted
values fail closed. Kept-vs-dropped rationale, per-value counts, and the enumeration method are
in each `_receipts`.

**Smoke refresh through the live deployed engine** (8 ZIPs, pg_net → `get-address-report`,
all HTTP 200). Every new source emitted records, and the anti-fabrication + map-render
invariants held across all 2,070 emitted records:

| Source | records | missing `record_url` | missing coords |
|---|---|---|---|
| `tucson-residential-building-permits` | 1,377 | 0 | 0 |
| `tucson-commercial-building-permits` | 423 | 0 | 0 |
| `gilbert-energov-permits` | 204 | 0 | 0 |
| `casa-grande-active-development-sites` | 54 | 0 | 0 |
| `udot-active-projects` | 12 | 0 | 0 |

`development` counts on those ZIPs: 85719 → 1,097 · 85705 → 741 · 85295 → 204 · 85122 → 54 ·
84302 → 34 · 84414 → 18. (84341 Logan and 84770 St. George returned 0 — no UDOT project within
3 mi; honest empties, not failures.) **0 records lack coordinates, which is what makes them
renderable on the satellite, street and focus map views** — all three read the same
`MAP_SITES` dataset, so a point that renders in one renders in all three.

Two evidence-driven corrections made during the pass:
* **UDOT `file_date` `start_dat` → `created_dt`.** `start_dat` is populated on only 43 of the
  358 active projects; the first smoke refresh emitted 11 of 12 records with no `file_date`.
  Live non-null counts over the active set: `created_dt` 358/358, `epm_plan_start_date` 65,
  `start_dat` 43, `advertise_date` 27, `est_compl_dat` 2. `column_map` arrays JOIN values
  rather than falling back (`readCol`, `sources/arcgis.ts`), so a multi-field date fallback is
  not available — one field must be chosen.
* **Tucson `file_date` = `APPLYDATE`, not `ISSUEDATE`.** APPLYDATE is populated pre-issuance,
  so in-review permits keep a date and stay visible; ISSUEDATE rides as `decision_date`.

**Casa Grande freshness, stated honestly:** this is a curated *active-projects roster*, not an
issuance ledger. `Submit_Date` is the application date and the newest is 2025-12-12. Multi-year
site projects legitimately carry older submit dates, so no recency window is applied and no
freshness claim beyond that date is made. It is wired because it is the only wireable
first-party per-record source found for Pinal County.

### Rejections / not wired (receipts)

* **ArcGIS Online `search` with a `bbox` does NOT geo-filter.** Scoped attempts for UT
  (`bbox=-114.1,36.9,-109.0,42.1`) and AZ (`bbox=-115.0,31.3,-109.0,37.0`) returned **identical**
  result sets containing Louisville KY, Charlottesville VA, Oakville Ontario, Kisumu Kenya and
  New Zealand fire permits. This confirms the existing standing answer (unscoped AGO search
  returns cross-org lookalikes) and extends it: **`bbox` is not a substitute for `orgid:` scoping.**
  Discovery was redone against per-portal DCAT catalogs instead.
* **Pima County `Development Permits` / `Development Plans`** (`gisdata.pima.gov/arcgis1/…/LandRecords/MapServer/7` and `/8`,
  1,373 and 5,603 rows, both modified 2026-07-27) — live and first-party, but **`esriGeometryPolygon`**.
  The arcgis connector flattens **point** geometry only (`f.geometry.x/y` → `__lat/__lng`,
  `sources/arcgis.ts`), so polygon rows would carry no coordinates and could not render as map
  markers. Not wired rather than add a `returnCentroid` connector branch; the City of Tucson
  point layers cover the county's population centre. Logged as the candidate if polygon support
  is ever added.
* **Pinal County `Accela` FeatureServer** (`gismaps.pinalcountyaz.gov/webapps/rest/services/Accela/FeatureServer`,
  the documented recon lead) — **DNS failure** from pg_net and from the sandbox. Casa Grande's own
  server was used for Pinal instead.
* **Salt Lake County open data** (`gisdata-slco.opendata.arcgis.com`) — DCAT live; the only
  development-adjacent dataset is "Salt Lake County Subdivisions", **modified 2019-11-21**, no
  permits. Rejected on staleness + wrong shape.
* **UGRC / Utah SGID statewide** (`opendata.gis.utah.gov`, 3.1 MB DCAT) — carries **no** local
  building-permit or planning-application dataset. Its "permit" datasets are environmental
  (DAQ air permits, groundwater, MS4 stormwater, uranium mines). Correctly rejected for this
  capability.
* **UPlan `Permits` service** (`…/Permits/FeatureServer/0`) — only **179** active records
  statewide, and a **data defect**: its `latitude` column repeats the LONGITUDE value
  (observed `latitude: -111.88967`, `longitude: -111.88967` on the same row). Not wired; the
  sibling `All_Projects` layer (2,145 rows, trustworthy point geometry) was wired instead.
* **Yavapai County** `gis.yavapaiaz.gov` — server live, but its only Development-Services
  service (`ServicesDeptDS/DS_OpenGov`) exposes parcels, flood zones, zoning, inspection areas
  and boundaries. **No permit layer.**
* **Chandler / Peoria / Glendale (AZ)** — DCAT catalogs live; the only development-adjacent
  items are boundary/zoning/general-plan polygons and Chandler's "Subdivisions" (2022-05-31).
  No per-record permit dataset. Gilbert was the one Maricopa portal that carried one.
* **Rejected on DNS / 404 (URL-guess round, no leads lost):** `gis.washco.utah.gov` DNS ·
  `gis.ogdencity.com` DNS · `maps.laytoncity.org` DNS · `gis.co.weber.ut.us` DNS ·
  `maps.daviscountyutah.gov` DNS · `gis.loganutah.org` timeout · `gis.yumaaz.gov` DNS ·
  `gis.mohave.gov` 403 · `maps.sgcity.org/arcgis/rest/services` 404 (host is an Experience
  Builder app, `SGCityMaps`, not a REST root) · `gis.flagstaffaz.gov/server/rest/services` 404 ·
  `map-flagstaff.opendata.arcgis.com` DCAT 500 "Item does not exist". **Lehi** (`maps.lehi-ut.gov`)
  resolves and is a real ArcGIS root, but its folders are AssetManagement / Hosted / Utilities /
  Water — no planning or permits. All added to the nightly reprobe list.

### Coverage still open after this pass

Utah remains the harder state: no first-party per-record **building-permit** source was found
for St. George/Washington, Ogden/Weber, Layton/Davis, Logan/Cache, Park City/Summit or Cedar
City/Iron. Those counties are served by `udot-active-projects` (transportation infrastructure)
plus the EPA facilities floor only. Arizona's remaining dark counties — Navajo, Coconino,
Mohave, Cochise, Yuma, Santa Cruz, Apache — likewise have no wireable first-party per-record
source found in this pass. No entry was created for any of them: **an unusable source is
documented, not wired.**

---

## POLYGON / POLYLINE GEOMETRY PASS (2026-07-27) — connector change + 5 sources wired

Scope: the nine polygon/polyline sources in the `0036` workbook, plus the ArcGIS connector
support they need. Before this pass the connector flattened **point geometry only**
(`f.geometry.x` / `f.geometry.y`), so a polygon or polyline layer produced records with no
coordinates — listed, but never pinned on the 2D / satellite / focus views.

### Connector change (`sources/arcgis.ts`) — purely additive

`featurePoint()` resolves a feature's pin from the feature's **own** geometry:

1. point `{x,y}` — the pre-existing path, unchanged (asserted byte-for-byte);
2. the server's polygon centroid, when `returnCentroid` was honored;
3. polygon `rings` → the area-weighted (shoelace) centroid, signed so holes subtract and
   multipart polygons combine;
4. polyline `paths` → the point at half the cumulative length of the longest path — a point
   that lies **on** the line.

No geometry still yields no coordinates: the record stays area-scoped rather than acquiring a
fabricated pin.

**The derived centroid is not an approximation of convenience.** On the two layers that
publish both, it reproduces ArcGIS's own `returnCentroid` to **2.6e-5°(~2.9 m)** and
**8.3e-6°(~0.9 m)** — the residual being planar-degree vs geodesic arithmetic. Receipts:
`clark-county-active-projects` server `{x:-115.15351077017141, y:36.1032081087714}`;
`douglas-county-major-projects` server `{x:-119.82057133657315, y:39.049196864125506}`.

**Standing answer — `returnCentroid` is OPT-IN per entry (`return_centroid`), never derived
from "geometryType is not point".** Live probes found three distinct behaviors:

| behavior | layers (live) | receipt |
|---|---|---|
| **hard 400** | `txdot-projects-info-all` (polyline) | HTTP 200 body `{"error":{"code":400,…"Return geometry centroid is only supported on layer with polygon geometry type."}}` |
| **silently ignored** | Houston PlatTracker 0+1, Harris Plats, Fort Worth zoning, NRH zoning, Washoe Accela | rings returned, **no** `centroid` key |
| **honored** | Clark County Active Projects, Douglas County Major Projects (hosted AGO FeatureServers) | `centroid:{x,y}` alongside the rings |

So the literal rule "if geometryType is not `esriGeometryPoint`, add `returnCentroid=true`"
would have **broken the statewide TxDOT source outright**, and would have pinned only 2 of the
9 sources even where it succeeded. The ring/path derivation is what actually carries them.

Regression: `test/arcgis-geometry.test.mjs` drives the **shipped** connector (imported, not
re-implemented) over `fixtures/arcgis/polygon-centroid-sample.json` — a real captured feature
with its server centroid — plus hole / multipart / winding / degenerate / polyline cases. It
needs Node's type stripping, so `unit-tests` CI moved 20 → 22.

### Wired (5)

| registry_id | layer | geom | rows | status vocab | freshness |
|---|---|---|---|---|---|
| `txdot-projects-info-all` | TxDOT_Projects_Info_All/0 | polyline | 85,422 | 16 `PROJ_STG` verbatim | `LAST_PROJ_UPDATE_DT` 100%, max 2026-07-25 |
| `houston-plat-applications` | PT365_PLAT_MAPPING/1 "Plat Applications by Type" | polygon | 36,774 | 6 `AppStatus` (sums exactly) | `AppSubmitDate` 100%, max 2026-07-27 |
| `harris-county-plats` | Plats_NonHouston_SV/0 | polygon | 573 | 6 `PlatStatus` (padded → trimmed) | 135 received since 2025-01-01 |
| `fort-worth-zoning-cases` | Zoning_case_service/12 | polygon | 96 | `ACTION_` Approved 4 / Denied 1 | max `ZC_DATE` 2026-08-12 (future hearing) |
| `clark-county-active-projects` | Active_Projects/0 | polygon | 236 | 5 `PROSTATUS` (sums exactly) | `EditDate` 2026-07-27 |

All five: no ZIP column → `spatial_zip_radius_mi: 3`; no per-record URL column →
`record_url_precision: "dataset"` on the verified machine endpoint (Boulder/Philadelphia
precedent) rather than a templated guess. `clark-county-active-projects` is the only entry
carrying `return_centroid: true`. Full per-entry evidence lives in each entry's `_receipts`.

**`txdot-projects-info-all` known display characteristic** (documented, not a defect): the
spatial envelope selects any project whose line *intersects* the ZIP, so a long corridor
project can pin at its own midpoint several miles from the ZIP page it appears on. The pin is
a real point on the real published geometry and the record genuinely crosses the ZIP.
`verify-geocodes` does not fence it — source-supplied geometry carries no `match_type`
(`scripts/verify-geocodes.mjs:208`).

### NOT wired — 4 rejections with receipts

- **`HOU-DP` — PT365_PLAT_MAPPING layer 0 "Final Plats" (25,777): a proven SUBSET of layer 1.**
  Wiring both would have emitted ~25,777 Houston plats **twice** on every Houston page — the
  exact duplicate class engine v22 was built to remove, and one its exact-identity dedup would
  **not** catch, because the two entries carry different `source_registry_id`/`source_id`.
  Proof: layer 0's five newest AppIds (93355, 93350, 93342, 93340, 93339) all return from layer 1
  with identical AppNos; both share min AppId 40410; in the window AppId 93000–93500 layer 0 has
  172 rows to layer 1's 361; and layer 1 equals-or-exceeds layer 0 on every shared AppCode
  (C2R 10,880 vs 10,826 · C3F 8,369 vs 8,360 · C2 5,782 vs 5,755 · SP 778 vs 775 · C1 51 vs 46 ·
  VF 15 vs 15) while adding five codes layer 0 lacks.
- **`WSH-BP` — Washoe County `Accela/AccelaWashoe/23`: STALLED at 2016-10-27.** `DATE_` is the
  layer's only date field, populated 265,039/265,039, and its live max is **2016-10-27** — nearly
  ten years stale. Schema was otherwise excellent (51 verbatim `STATUS` values, 139 `TYPE` values,
  a clean 28-value building/land-use whitelist live-verified at 77,662 rows). Rejected on freshness
  alone → nightly reprobe list. *(Fort Lauderdale / Worcester / St. Paul precedent.)*
- **`NRH-PC-001` — North Richland Hills `Zoning/MapServer/0`, live name "Special Use Permit"
  (196): no status column and no date column.** Fields are `CODE, DL, ORD, NAME, NAME2, ANNO,
  CASENUM` only (194/196 carry `ORD` + `CASENUM`). The records are *adopted zoning overlays* from
  the 1990s (live sample: ORD 2244–2621, CASENUM `PZ 97-41` … `PZ 98-30`), not active development
  filings. There is nothing to map to a bucket, and `status_const` would be inventing a status
  string the source never publishes.
- **`DGL-DP` — Douglas County NV Major Projects (39): free-text prose in `Status`, and content
  frozen ~2020.** `Status` is not a vocabulary — live values include *"Tentative Approval for
  Phases 3 and 4 granted by Board of Commissioners- May 5, 2016 \r\n30 lots recorded July 2017
  (Ph 3)"* — ~18 distinct sentences across 33 non-null rows, 6 null. `Type` is null on 20 of 39,
  `YearApproved` is a STRING whose max is the literal `"Multiple"`, and a column named
  `LotsBuiltOutThru062020` dates the content. No verbatim status→bucket mapping is possible
  (San Jose `"30"` precedent). Rejected despite being one of only two layers that honor
  `returnCentroid`.

### `SA-PC` — out of scope by instruction
Not probed and not wired: it is an ArcGIS **Table** (no geometry), so it is not part of this
polygon/polyline pass.

### Live go-live smoke (deployed engine, 2026-07-27)

Deployed via `deploy-edge-functions.yml` (run 30312463714, green), then six cached ZIPs were
re-run through the live function with `net.http_post` — all **HTTP 200** — and persisted with
`dev_refresh_collect()`.

| ZIP | county | sourced records | from the new sources | registry_ids present |
|---|---|---|---|---|
| 76104 | Tarrant | 528 | 41 | `fort-worth-development-permits`, **`fort-worth-zoning-cases`**, **`txdot-projects-info-all`** |
| 76110 | Tarrant | 503 | 38 | `fort-worth-development-permits`, **`txdot-projects-info-all`** |
| 78617 | Travis | 443 | 20 | `austin-site-plan-cases`, `austin-subdivision-cases`, **`txdot-projects-info-all`** |
| 89101 | Clark NV | 369 | 26 | **`clark-county-active-projects`**, `clv-planning-cases`, `las-vegas-building-permits` |
| 89106 | Clark NV | 330 | 15 | **`clark-county-active-projects`**, `clv-planning-cases`, `las-vegas-building-permits` |
| 77393 | Harris | 35 | 35 | **`txdot-projects-info-all`** — page lifted off the facilities floor for the first time |

**The invariant that proves this build did its job: across every record emitted by the three
new sources — 132 TxDOT (polyline), 41 Clark (polygon), 2 Fort Worth (polygon) — there were
0 missing `record_url` and 0 missing coordinates, all `scope: "point"`.** Before this change a
polygon or polyline layer could only ever produce coordinate-less records. Coordinate spreads
are geographically correct (TxDOT lat 30.128–32.792 spanning Austin→Fort Worth; Clark
36.072–36.210 over Las Vegas; Fort Worth 32.714–32.765). Cache-wide for the six ZIPs:
**0 sourced sites missing coords, 0 missing URL.**

`fort-worth-zoning-cases` appears on 76104 and not 76110, as expected — only 5 of its 96 rows
carry a decided `ACTION_`, the rest fail closed.

### ⚠️ Open follow-up — Harris County has ONE modeled ZIP page, so the two Harris sources have no surface

`houston-plat-applications` and `harris-county-plats` are correctly wired but emitted **0**
records in the smoke, and the reason is a **communities-model gap, not a wiring bug** (it is
explicitly *not* the Arlington/`harris-county-permits` missing-ZIP-scoping class, which
quarantined at 0 everywhere):

- Harris County has exactly **1** `level=zip` community with a cached report — **77393** — whose
  pinned centroid is **30.329, −95.4635**: Conroe, roughly 50 miles north of Houston and outside
  Harris County altogether (it is a P.O.-type ZIP). A 3-mile envelope there legitimately contains
  no Houston plats. For comparison Tarrant has 99, Travis 86, Clark 76.
- Both entries return real data over real Houston/Harris geography. Live envelope probes:
  **5,542** plat applications within ±3 mi of downtown Houston (29.7604, −95.3698), and **61**
  Harris plats in the wider county box — both `esriGeometryPolygon` with rings, and with statuses
  from the mapped vocabulary (`Action Form Completed`, `Historical Plat`, `Pre-Recordation Plat`).

The unlock is a **Harris County ZIP expansion** — the same structural fix already applied for the
NYC boroughs, Boston/Suffolk and Philadelphia County. Until then both entries sit dormant and
cost nothing (the coverage gate keeps them off every non-Harris page). Logged, not blocking.

---

## POLYGON WIRE PASS #2 (2026-07-27) — NDOT · Dallas SUPs · Henderson ×2 (registry 81 → 85)

Config only. All four are polygon layers riding the `featurePoint()` centroid path shipped in
the previous pass — no connector, engine or schema change.

| registry_id | coverage | rows | status vocab | type vocab |
|---|---|---|---|---|
| `nvdot-project-boundaries` | statewide NV | 563 | `status_const` (Record_Type is a data-format descriptor) | 26 `Project_Type` → Utility |
| `dallas-specific-use-permits` | TX/Dallas | 1,338 | 3 verbatim `STATUS` (2 real + case variant) | **525** `SPECIFICUSE` |
| `henderson-residential-permits` | NV/Clark | 28,391 | 9 verbatim `STATUS` (+null fails closed) | 2 `CASETYPE` → Residential |
| `henderson-commercial-permits` | NV/Clark | 8,490 | 9 verbatim `STATUS` (+null fails closed) | 14 `CASETYPE` |

Every vocabulary was enumerated live and **each set sums exactly to its layer count**.

### Four corrections to the wiring brief, all live-verified

- **NDOT's "`where=1=1` returns HTTP 500" quirk did NOT reproduce.** `where=1%3D1` returned
  **200 / count=563**, and so did the *exact* query shape this connector emits (envelope +
  `outFields=*` + `returnGeometry=true` + `outSR=4326` + `resultOffset`/`resultRecordCount`):
  **200 with 52 features**. **Standing answer:** `extra_where` could not have worked around such
  a failure anyway — `buildWhere()` always prefixes the spatial zipClause `1=1` and ANDs
  `extra_where` after it, so the connector sends `1=1 AND (OBJECTID>0)` either way. The
  `OBJECTID>0` guard is kept (live-verified identical result) in case the 500 is intermittent.
- **Henderson `groupBy` works and returns real counts** (the brief expected 0), which surfaced
  values the brief missed: layer 1 STATUS has **10** values incl. `Awaiting Final Review` (3)
  and CASETYPE has **2**, not 1 (`BLDG - Multi-Fam Residential`, 157); layer 2 STATUS has **10**
  incl. `Awaiting Application` (4) and CASETYPE has **14**, adding `BLDG - Retail Sales` (46) and
  `BLDG - Medical/24HR Care` (14). Layer 2's live name is **"Other Permits"**, not "Commercial".
- **Dallas STATUS** — the 3 rows the brief calls `"None"` are JSON `null`. Explicit mapping was
  used rather than `status_const`: STATUS is a real status column (CLAUDE.md forbids overriding
  one) and explicit mapping correctly fails the 4 null/whitespace rows closed.
- **Dallas `type_map` deliberately deviates from the brief's keyword list.** Those rules would
  have defaulted ~100 values to `Commercial` that plainly are not — `Electrical Substation`,
  `Power Plant`, `Sewage Treatment Plant`, `Quarry`, `Mining Operation`, `Meat Packing`,
  `Salvage Yard`, `Multifamily`, `Retirement housing`, `College`, `Kindergarten`, `Convent`,
  `Government Installation`, `Airport`, `Zoo`, `YMCA`, `Nursing Home`. **`use_type` drives the pin
  SHAPE**, so shipping that would have been a visible misclassification. The added keywords are
  listed verbatim in the entry's `_receipts`. A small tail of one-off free-text values still
  lands in the documented `Commercial` default — keyword classification over uncontrolled free
  text has a tail, and the tail is the default rather than a guess.

Henderson is wired **`https://`** (the workbook says `http://`) — the repo's own
`test/official-links.test.mjs` guard caught it, and https was live-verified to return the
identical count from the identical path (28,391 / 8,490). A scheme upgrade, not a new source.

### Live go-live smoke (deployed run 30314664115, green)

Seven ZIPs re-run through the live engine — **all HTTP 200** — then persisted with
`dev_refresh_collect()`.

| ZIP | sourced (was → now) | new sources present |
|---|---|---|
| 75201 Dallas | 0 → 397 | `dallas-specific-use-permits`, `txdot-projects-info-all` |
| 75202 Dallas | 0 → 419 | `dallas-specific-use-permits`, `txdot-projects-info-all` |
| 89002 Henderson | 1 → 4,400 | `henderson-residential`, `henderson-commercial`, `nvdot` |
| 89011 Henderson | 0 → 3,933 | both Henderson, `nvdot`, `clark-county-active-projects` |
| 89012 Henderson | 0 → 4,888 | both Henderson, `nvdot` |
| 89101 Las Vegas | 369 → 420 | `nvdot` (+ existing Clark sources) |
| 89501 Reno | 65 → 137 | `nvdot`, `reno-ldc-projects` |

**Across all 14,028 records emitted by the four new sources: 0 missing `record_url`, 0 missing
coordinates, 100 % `scope:"point"`.** Unclassified: 0 for Dallas (all 525 values mapped) and 0
for both Henderson layers; **2** for NDOT — exactly the two rows whose `Project_Type` is null,
which `type_map` cannot key and which are logged rather than guessed. Coordinate spreads are
geographically correct: Henderson 35.965–36.130, Dallas 32.734–32.846, NDOT 35.827–39.600 (Las
Vegas → Reno, i.e. genuinely statewide). Cache-wide on the seven ZIPs: 0 sourced sites missing
coords, 0 missing URL.

**Bidirectional coverage-gate proof** (cache-wide, live): `dallas-specific-use-permits` rides
**only** TX/Dallas pages; `henderson-residential-permits` and `henderson-commercial-permits`
**only** NV/Clark; `nvdot-project-boundaries` **only** NV pages (Clark 4 + Washoe 1) — statewide
as declared, and never outside NV.

### ✅ RESOLVED — Henderson row size, fixed with `recency_days: 1095` (2026-07-27)

The three Henderson pages had been the largest rows in the cache — **89012 = 4.68 MB / 4,910
sites**, 89002 = 4.18 MB / 4,408, 89011 = 3.72 MB / 3,937 — because both layers carried the full
permit history back to **2002** with no recency window.

**Fix: `recency_days: 1095` (3 years) on both entries.** Nothing else changed —
`spatial_zip_radius_mi` stays 3, `type_map` and `status_to_bucket` untouched (proven by diffing
the parsed registry against HEAD: exactly two entries differ, only in `recency_days` +
`_receipts`; the socrata/ckan/csv/carto lists are byte-identical).

Verified live BEFORE applying, so the value was chosen from data rather than assumed:

| check | residential | commercial |
|---|---|---|
| `APPLICATIONDATE` type | `esriFieldTypeDate` | `esriFieldTypeDate` |
| populated | 28,391 / 28,391 (100 %) | 8,490 / 8,490 (100 %) |
| `ISSUEDATE` populated (rejected) | 27,280 / 28,391 | 8,490 |
| data span | 2002-01-04 → 2026-07-24 | 2002-02-07 → 2026-07-26 |
| `APPLICATIONDATE >= DATE '2023-07-28'` | 9,098 (32 % kept) | 2,033 (24 % kept) |

Because `APPLICATIONDATE` is a true `esriFieldTypeDate`, the connector's `DATE '<cutoff>'`
literal applies directly — no string-compare workaround (the Anaheim case). `APPLICATIONDATE`
was chosen over `ISSUEDATE` deliberately: it is when the permit process **started**, which is
what "what's happening near me" means, it is 100 % populated where ISSUEDATE is not, and it is
already the column mapped to `file_date`, so `buildWhere()` picks it up with no other change.

**Result after deploy + live re-run + `dev_refresh_collect()`:**

| ZIP | before | after | sites |
|---|---|---|---|
| 89002 | 4.18 MB | **1.30 MB** | 4,408 → 1,410 |
| 89011 | 3.72 MB | **1.54 MB** | 3,937 → 1,677 |
| 89012 | 4.68 MB | **1.00 MB** | 4,910 → 1,093 |

All three now sit far below the 3.5 MB mark. The window is exact: the oldest Henderson
`file_date` on the refreshed pages is **2023-07-28** (89002, 89012) and 2023-07-31 (89011) —
precisely the 1,095-day cutoff — while the newest is 2026-07-23…25, so the pages stay current.
**0 missing coordinates, 0 missing `record_url`** on every refreshed page. Control ZIPs confirm
no collateral effect: 75201 Dallas 397 sourced / 0.38 MB and 89101 Las Vegas 420 sourced /
0.38 MB, both byte-for-byte the same counts as before the change.

### ⚠️ New open follow-up — CLEVELAND is the real row-size ceiling, not Minneapolis

Removing Henderson from the top of the cache surfaced that the **3.5 MB / 3,160-site Minneapolis
55407 high-water mark quoted throughout these docs was already stale**. The largest rows cache-wide
are Cleveland: **44127 = 5.98 MB / 5,511 sites**, 44104 5.90 MB, 44115 5.70 MB, 44102 5.61 MB,
44103 5.09 MB, 44113 5.06 MB.

Recency is **not** the lever there — `cleveland-issued-building-permits` is already windowed to
365 days (44127's records span 2025-07-27 → 2026-07-25, and it supplies 5,471 of that page's
5,511 sites on its own). The size is raw permit density inside a 3-mile circle over Cleveland's
core. The available levers would be a smaller `spatial_zip_radius_mi` or an `out_fields`
projection (the Miami/Columbus CPU-hazard pattern). **Not touched here** — this pass was scoped to
the Henderson entries, and changing Cleveland's radius changes what residents see. Logged with
numbers so the ceiling claim in these docs is no longer wrong.

---

## AUSTIN ZONING CASES (2026-07-28) — `austin-zoning-cases` wired (registry 85 → 86)

Socrata, City of Austin's own portal, dataset `edir-dcnf` "Zoning Cases" (category *Building and
Development*). 6,919 rows, fresh — `data_portal_update` on the sampled row 2026-07-27. Config
only; no connector change.

### Standing answer — a Socrata spatial entry MUST carry `spatial_point_col`

The wiring brief specified `spatial_zip_radius_mi: 3` with no point column, because the dataset
has no ZIP field. **That combination emits ZERO records.** The socrata connector quarantines it:

```ts
if (spatial && (!deps.zipCentroid || !entry.spatial_point_col)) {
  report.quarantined.push({ reason: "spatial_zip_radius_mi set but no zipCentroid/spatial_point_col — skipped" })
```

This is the same failure class as the Arlington / `harris-county-permits` missing-ZIP-scoping bug
— config that looks complete, passes every unit test, and silently produces nothing.

Live probing found the dataset **does** publish a Socrata Point column named **`location`**,
alongside the flat `latitude`/`longitude` strings that the brief mapped. The exact SoQL the
connector emits was verified *before* wiring: `within_circle(location, 30.2672, -97.7431, 4828)`
→ **2,201 rows** around downtown Austin, returning real per-record coordinates and links. Same
option pair as `chicago-building-permits`, `mesa-building-permits`, `new-orleans-permits`.

### Vocabularies — both complete, both summing to exactly 6,919

**22 `detailed_status` values** (`$group`, complete — the response carried all 22). Every one is
mapped and none appears twice:

| bucket | rows | values |
|---|---|---|
| operating | 5,386 | Closed |
| exclude | 902 | Withdrawn 448 · Expired 267 · Denied 166 · Aborted 8 · VOID 7 · Cancelled 6 |
| approved | 337 | Approved 275 · Recommended for Approval 50 · Reading Approved 5 · Approved and Released 5 · Partial Approval 2 |
| proposed | 294 | Scheduled for Hearing 75 · In Review 74 · Pending 69 · Scheduled for Council Hearing 39 · Notice Sent 17 · Case Assigned 9 · Awaiting Update 4 · Postponed 4 · Notice/Hearing Determination 2 · Notice Requested 1 |
| **total** | **6,919** | ✅ |

**12 `sub_type` values**, also complete and summing to 6,919 → **0 unclassified**:
Zoning/Rezoning 5,029 · Amended Neighborhood Plan 559 · Historical 505 · Capital View Corridor
Height 281 · PUD 230 · Restrictive Covenant Amendment 106 · Restricted Covenant Termination 77 ·
PDA 64 · MUD 55 · New Neighborhood Plan 7 · Ordinance Zoning Text Amendment 3 · TND 3.

### Field population (live)

| field | populated | use |
|---|---|---|
| `link` | 6,919 / 6,919 (100 %) | `record_url_precision: "record"` — a real per-case `abc.austintexas.gov` detail URL, never a template |
| `site_address` | 6,919 | `address` (embeds a ZIP, but there is no ZIP *column* — hence spatial, not `zip_where_template`) |
| `application_start_date` | 6,914 (99.9 %) | `file_date` |
| `case_name` | 6,917 | `title` |
| `approval_date` | 1,538 (22 %) | `decision_date`, absent on the rest — absent stays absent |
| `latitude`/`longitude` | 5,900 (85 %) | per-record point |

**Correction to the brief's expectation about the 1,019 coordinate-less rows.** The brief
anticipated they would "list but not pin." Under spatial scoping they do neither — a row with no
`location` can never satisfy `within_circle`, so it is excluded at source. That is why the live
result below shows **100 % of emitted records pinned** rather than an 85/15 split. Nothing is
fabricated either way; the difference is only *where* those rows drop out.

### Live go-live smoke (deployed run 30316761128, green)

Three Austin ZIPs re-run through the live engine, all HTTP 200, persisted via
`dev_refresh_collect()`.

| ZIP | sourced (was → now) | `austin-zoning-cases` | pinned | no `record_url` | unclassified | buckets |
|---|---|---|---|---|---|---|
| 78701 | 451 → 2,318 | 1,818 | **1,818 (100 %)** | 0 | 0 | 3 |
| 78702 | 682 → 2,489 | 1,753 | **1,753 (100 %)** | 0 | 0 | 3 |
| 78704 | 907 → 2,416 | 1,448 | **1,448 (100 %)** | 0 | 0 | 3 |

Cached rows land at 2.18 / 2.35 / 2.28 MB — under the 3.5 MB working ceiling (and far under the
Cleveland 5.98 MB outlier). **0 sourced sites missing coordinates and 0 missing `record_url`
across all three pages, counting every source on the page, not just this one.**

**Coverage-gate proof** (cache-wide, live): `austin-zoning-cases` appears on **TX / Travis pages
only** — 3 ZIPs, 5,019 records, nothing outside Travis County.

---

## PHOENIX BUILDING PERMITS (2026-07-28) — `phoenix-building-permits` wired (registry 86 → 87)

ArcGIS, the City of Phoenix Planning & Development Department's **own** MapServer:
`https://maps.phoenix.gov/pub/rest/services/Public/Planning_Permit/MapServer/1` (layer 1,
"Permits"). **70,791 rows** (live `returnCountOnly`), `esriGeometryPoint`, `maxRecordCount`
2000, `advancedQueryCapabilities.supportsPagination: true`. Config only — **no connector,
engine or schema change**. Live receipts throughout are recon-fetch runs `30317981665`
(round 1), `30318114268` (round 2), `30318327760` (round 3) and `30318842763` (round 4),
plus deploy runs `30318596568` / `30318695983`.

### ⚠️ Correction to the ARIZONA WIRE PASS

That pass recorded *"**Phoenix**: no first-party per-record permit dataset (the CKAN hit is a
1 KB HUD aggregate)"* — true of the **CKAN catalogue**, false of the city. Phoenix publishes
its permit ledger on its own ArcGIS Server at `maps.phoenix.gov`, which no catalogue lists.
**Standing answer: an empty open-data catalogue is not evidence that a city publishes
nothing — probe the city's own GIS host before recording a rejection.**

### Freshness + field receipts

| fact | value | how |
|---|---|---|
| rows | 70,791 | `where=1=1&returnCountOnly=true` |
| geometry | `esriGeometryPoint`, `spatialReference {wkid:4326}` on the query response | layer metadata + 3 sampled features |
| `PER_ENT_DATE` | **100 % populated** (70,791 / 70,791), max **2026-07-24** | `outStatistics` count + max |
| `PER_ISSUE_DATE` | 65,980 / 70,791 (4,811 null), max 2026-07-24 | same |
| `PER_NUM` | 70,791 / 70,791, **0 blank** | `PER_NUM IS NULL OR PER_NUM = ''` → `{"count":0}` |
| `PERMIT_NAME` | 2,650 null (3.7 %) | `PERMIT_NAME IS NULL` |
| date type | both `esriFieldTypeDate` → the connector's `DATE '<cutoff>'` literal is valid | field list; `PER_ISSUE_DATE >= DATE '2026-06-28'` → `{"count":996}` |
| `MOD_DESC` | a single value `"Building"` — **not** used as `type_source` | `returnDistinctValues` |

`file_date` is **`PER_ENT_DATE`** (when the permit process started) rather than the brief's
suggested `PER_ISSUE_DATE`, for two reasons: it is 100 % populated where the issue date is
93.2 %, and `buildWhere()` applies `recency_days` to `firstCol(column_map.file_date)` — so the
recency window and the displayed filing date are guaranteed to be the same column.

### Status vocabulary — 4 values, summing to EXACTLY 70,791

`DONE 42,488` + `OPEN 28,222` + `EXPR 64` + `VOID 17` = **70,791**. Bucketed as the brief
specifies: `OPEN → proposed`, `DONE → operating`, `EXPR`/`VOID` → excluded.

### Type vocabulary — 238 values (not "250+"), summing to EXACTLY 70,791

Enumerated **three independent ways that agree exactly**: `groupBy` ordered `n DESC`, `groupBy`
ordered `n ASC` (the Mesa/Gilbert `$limit`-truncation defence), and `returnDistinctValues` —
238 values each time, identical sets, no nulls, counts summing to 70,791. **0 unclassified.**

| use_type | values | rows |
|---|---|---|
| Civic/Public | 97 | 23,400 |
| Development | 46 | 18,949 |
| Utility | 23 | 10,548 |
| Commercial | 22 | 10,464 |
| Residential | 12 | 5,389 |
| Industrial | 38 | 2,041 |

**Standing answer — the brief's "Other" bucket is written as `Development`.** `use_type` is a
**closed six-value vocabulary** across all 87 registry entries (Industrial · Development ·
Residential · Utility · Commercial · Civic/Public), and `lib/map.js`'s `TYPE_EXACT` table is
likewise closed. An off-vocabulary `"Other"` would miss `TYPE_EXACT` entirely and fall through
to keyword guessing on the record's title. `'development'` is precisely the generic member —
`TYPE_EXACT['development'] = cat('other')` → the **"Other project"** circle — so writing
`Development` produces exactly the rendering the brief asked for, inside the existing
vocabulary. It also matches how every other entry maps demolition (Tucson, Gilbert, SLC).

**Two upstream string quirks are preserved VERBATIM** and pinned by a unit test, because
normalising either would silently unclassify thousands of rows: `'SIGN  PERMIT'` (double
space, 3,685 rows) and `'UTILITY TRENCHING CI VIL PERMIT'` (a mid-word space in "CIVIL",
622 rows).

### Self-describing values — the Dallas rule, applied with evidence

The brief's keyword rules leave ~60 values to a default. Per the POLYGON WIRE PASS #2 standing
answer (*never let a keyword default swallow a value that names what it is*), each was
resolved against **the layer's own `PER_TYPE` department code**, obtained from a live
`PER_TYPE × PER_TYPE_DESC × SCOPE_DESC` crosstab (242 pairs, summing to 70,791):

* **`F####` is the Fire Department code range.** 136 of the 238 values (25,723 rows) are
  purely `F####`, and **63 of them are not `FP `- or `FIRE`-prefixed** — e.g.
  `DEDICATED FUNCTION MONITORING` (F175, `SCOPE_DESC` "DEDICATED FUNCTION MONITORING"),
  `PRE-ACTION SYSTEM` (F107), `SMOKE CONTROL OR EXHAUST` (F116),
  `PRIVATE FIRE FLOW TEST` (F810, "PRIVATE FIRE HYDRANT FLOW TEST >3000 GPM"). The brief's
  `FP `-prefix rule would have dropped all of them into the generic bucket; they are
  `Civic/Public` **on the layer's own department code**, not on a guess.
* **Where the fire code permits an INDUSTRIAL subject, the subject wins** — `INDUSTRIAL OVEN`,
  `WRECKING YARDS, SALVAGE, AND JUNK YARDS`, `HIGH PILE(D) COMBUSTIBLE STORAGE`,
  `TIRE REBUILDING OPERATION`, `PLANT EXTRACTION SYSTEM`, `LUMBER & MULCH YARDS`,
  `SPRAYING DIPPING & POWDER COATING OPS`, `MOBILE FLEET FUELING SITE OPERATION`,
  `COMM LIQ CLASS IIIB BIOFUELS STORE/USE`, `WOOD PRODUCTS, PALLETS`,
  `COMBUST DUST OR FIBER PRODUCING INSTALL`/`OP`, `OUTSIDE COMBUSTIBLE MATS STORAGE & USE`,
  `FLAMM/COMBUST PIPELINE MODIFICATION`, `FIRE OUTDOOR COMBUSTIBLE STORAGE` → **Industrial**.
* **Solar is an energy install, not a fire inspection** — `SOLAR PHOTOVOLTAIC SYSTEM`,
  `… SYSTEM OTC`, `… /BATTERY SYSTEM`, `… /BATTERY SYSTEM OTC` (F193/F194/F209/F800, 5,558
  rows) → **Utility**, consistent with the brief's own `BATTERY → Utility` rule.
  `COMMERCIAL STREET LIGHT` (STL, `SCOPE_DESC` "STREET LIGHT INSTALLATION") → **Utility**.
* **`AVIATION FACILITY`** (F360) → **Civic/Public**, matching `dallas-specific-use-permits`,
  where `Airport → Civic/Public`. **`DEVELOPMENTALLY DISABLED GRP HOME INSP`** (F424,
  `SCOPE_DESC` "GROUP HOME FIRE INSP") → **Civic/Public**, matching
  `tucson-residential-building-permits`, where `Residential Care Facility → Civic/Public`.
* **`REPAIR GARAGE`** (F204) and **`SHELL - STRUC/ELEC/PLMB/MECH`** (BLDS, `SCOPE_DESC`
  "COMMERCIAL SHELL"/"COMMERCIAL NEW") → **Commercial**.
* **Trade combos with no `OTC` prefix** (`MECH/ELEC`, `PLMB/ELEC`, `PLMB/MECH`,
  `PLMB/MECH/ELEC`) → **Utility**, the same split the brief defines for their `OTC` twins.

One deliberate asymmetry, recorded rather than smoothed: `FP INDUSTRIAL OVENS` is
`Civic/Public` while `INDUSTRIAL OVEN` is `Industrial`. The brief lists the `FP ` rule ahead of
the hazmat rule, and that ordering is preserved.

### record_url — dataset precision, NOT "none"

The brief asked for `record_url_precision: "none"`. **That value does not exist**: the
connector's type is `"record" | "dataset"`, and the anti-fabrication gate requires every
emitted site to carry a `record_url` (`verify-development.mjs` fails CI otherwise). Both
candidate per-record URL patterns were probed live and **neither discriminates**:

* `apps-secure.phoenix.gov/pdd/search/permits/1500027` → HTTP 200 but the body is
  `<title>P&amp;D Online - Error</title>` — a real permit number renders the error page.
* `…/pdd/search/permits?permitNumber=1500027` → HTTP 200, 49,163 bytes — byte-for-byte the
  same search shell as the bare `…/pdd/search/permits` (48,822 bytes); the parameter is ignored.

Templating either would be guessing (the San Diego "the SPA shell alone did NOT discriminate"
rule). So `record_url_precision: "dataset"` with `dataset_url` = the city's own permit search
at `https://apps-secure.phoenix.gov/pdd/search/permits` — the Boston / Philadelphia precedent.

### ⚠️ recency_days is **365**, not the brief's 1095 — the 3.5 MB ceiling was measured

The brief set the ceiling ("if any Phoenix ZIP exceeds 3.5 MB, apply `recency_days: 1095`").
`1095` was deployed first and **measured live** via `pg_net` (deploy run `30318596568`), with
nothing persisted:

| ZIP | `recency_days: 1095` | `recency_days: 365` |
|---|---|---|
| 85003 | **7.16 MB** / 9,375 records | **2.84 MB** / 3,705 |
| 85008 | **4.74 MB** / 6,168 | **1.80 MB** / 2,333 |
| 85015 | **4.65 MB** / 6,095 | **1.79 MB** / 2,342 |
| 85032 | **3.62 MB** / 4,747 | **1.51 MB** / 1,974 |

Every probe ZIP was over the ceiling at 1095, so the brief's named contingency could not
satisfy the brief's own constraint; 365 was chosen as the smallest change to the same lever.
The window is exact — the oldest surviving `file_date` is **2025-07-28**, the 365-day
boundary, and the newest is 2026-07-24, the layer max.

**The choice is verified against every Maricopa ZIP, not a sample.** Round 4 ran the exact
connector query shape (3-mile envelope, `PER_ENT_DATE >= DATE '2025-07-28'`,
`PERMIT_STAT IN ('OPEN','DONE')`) for **all 136 modelled Maricopa ZIP pages**: the maximum is
**85006 at 3,954 records**, and its live cached row measures **3.21 MB**. `0 of 136` rows
exceed 3.5 MB.

Two levers were considered and rejected: `out_fields` does not help (it trims the *fetch*, not
the emitted record count that drives row size — it is set anyway, as the Miami/Columbus CPU
guard), and reducing `spatial_zip_radius_mi` was rejected because radius changes what residents
actually see.

### Go-live results (DB-verified)

Re-cached all 136 modelled Maricopa ZIPs through the live engine (`pg_net` → `dev_refresh_collect`;
4 transient 503 cold-starts retried, the documented pattern):

* **Maricopa ZIP pages carrying real source records: 40 → 96** (+56 lifted off the EPA
  facilities floor). **77 pages carry Phoenix records**, totalling **95,585** — the 59 that do
  not are Mesa / Chandler / Gilbert / Scottsdale-east / far-west-valley ZIPs outside Phoenix
  city limits, which correctly return 0 from a Phoenix-only layer.
* **Anti-fabrication + map-render invariants across all 95,585 Phoenix records: 0 missing
  `record_url`, 0 missing coordinates, 0 `unclassified`, 0 non-`point` scope.** Coordinates are
  what make a record renderable, and all three map views read the same `MAP_SITES` dataset, so
  a pinned record renders in 2D, satellite and focus alike.
* Rows with no geometry never reach the page: spatial ZIP scoping filters on the geometry
  itself, so a geometry-less row cannot satisfy the envelope (the San Diego
  garbage-coordinate precedent). Hence 100 % pinned rather than a listed/pinned split.
* **Heaviest row 85006 at 3.21 MB; 0 rows over 3.5 MB.**

**Known characteristic, recorded not hidden:** `title` is `PERMIT_NAME` exactly as the brief
specifies, and that column is null on 3.7 % of the layer — **4,063 of the 96,352 cached records
(4.2 %) carry a blank `title`**. None of them is label-less: `0 of 96,352` have a blank `label`,
because the connector falls back to the permit number (`label = title || case_number ||
"Development record"`). So those pins read as their real permit number rather than a
description — an honest fallback, not a gap.

**Bidirectional coverage-gate proof, live:** `85701` (Tucson, AZ/Pima) and `85122`
(Casa Grande, AZ/Pinal) both returned **0 Phoenix records** through the deployed engine, and
`test/phoenix-connector.test.mjs` asserts the stronger unit-level fact — an out-of-coverage ZIP
**never fetches** the Phoenix layer at all.

### CI verifier status — read this before re-investigating

**`verify-development` (run 30319267075, 3 h 32 m) FAILED — no Phoenix page is in the failure
list.** 390 failure lines over 165 distinct ZIPs, of which the only Arizona-range entries are
**85724 and 85745, both `Tucson (…)` / Pima County** (DB-confirmed; served by
`tucson-*`, untouched here). **0 of the 136 Maricopa ZIPs failed**, including all 78 carrying
Phoenix records. This is pre-existing: the previous run (30305825744, *before* this change) had
**8 failing 85xxx ZIPs — 85641, 85704, 85735, 85742, 85746, 85748, 85749, 85750, every one
Tucson/Pima** — so Arizona failures went **8 → 2**. The 97 → 390 growth is entirely `75xxx`
(Dallas, 72 ZIPs), `89xxx` (NV, 44) and `92xxx` (San Diego, 18) — the PR #413/#414/#415 sources.
385 of the 390 lines are the `counts.* !== rendered <band> rail` class already red on `main`
(last three completed runs: failure at 2:54:54, 3:27:04, 3:12:42); the other 5 are substance-gate
`robots="index, follow"` lines on AL/OK/ID ZIPs. Neither class is a function of adding a registry
source, and `claude/verify-development-fa…` is already open against it.

**`verify-geocodes` (run 30319270760) was CANCELLED at 6:00:18 — GitHub's hard 6-hour job cap**,
not a failure and not a verdict (the workflow declares no concurrency group, so nothing cancelled
it externally). **It would have had nothing to check here anyway: all 96,352 Phoenix records are
`geo_precision:"point"` with `geocode_source` null on every one — 0 geocoded.** The geofence
applies to GEOCODED points only; source-supplied geometry is never fenced.

The equivalent containment check was therefore run directly against the data. Emitted Phoenix
pins span **lat 33.2907–33.8892, lng −112.3078–−111.7597**, versus the publisher's own declared
layer extent (metadata `extent`, EPSG:3857 → WGS84) of **lat 33.2905–33.8929, lng −112.3044–−111.7589**
— i.e. inside on three sides, with **exactly 2 records of 96,352** sitting ~315 m west of the
declared western edge. Both were inspected and are **real, not bad coordinates**: case 26007590
"BLDG D - TCO" and 26007591 "BLDG E - TCO", `11580 W INDIAN SCHOOL RD`, ZIP 85392, filed
2026-05-21. Longitude −112.3078 is ≈115th Ave (Phoenix's origin is Central Ave at −112.074;
115 blocks ÷ 8 per mile ≈ 14.4 mi ≈ 0.24°), which matches that address. **Standing answer: an
ArcGIS layer's declared `extent` is cached/rounded metadata, not a containment guarantee — do not
treat a small overshoot as a geocoding defect.**

### Regression cover

`test/phoenix-connector.test.mjs` (new, offline) drives the **shipped** connector over a real
captured query response committed at `fixtures/phoenix/planning-permit-layer1-sample.json`.
It pins the vocabulary completeness, the closed use_type set, the two verbatim string quirks,
the spatial-envelope query shape, the absence of `returnCentroid` on a point layer, and the
coverage gate in both directions. Full suite: **58 unit test files green.**

---

## PHASE 1 STANDARD ARCGIS WIRE PASS (2026-07-28) — 26 of 27 endpoints wired (registry 86 → 112, arcgis 62 → 88)

Source brief: `docs/implementation-packets/claude_code_phase1_prompt.md` +
`claude_code_implementation.json` → `phase1_standard_arcgis` (27 endpoints, 570 ZIPs).
**Config only — no connector, engine or schema change.** Branch
`claude/phase1-standard-arcgis-gos1pi`.

Every `type_map` and `status_to_bucket` value below is **VERBATIM live groupBy output**, never
guessed. Seven `recon-fetch` rounds (the sandbox has no egress; the runner is the probe channel):
**30369196972 / 30369206672 / 30369213992** (r1 type/status/sample), **30369593803** (r2 enlarged
samples + timeout retries + description fields), **30370026584** (r3 better fields, coded-value
domains, New Hanover narrowed scan), **30370252139** (r4), **30370572544** (r5 ZIP-predicate
proof), **30370755906** (r6 Spokane + volume sizing), **30370939582** (r7 date-literal proof).
Target lists are committed under `scripts/recon/p1-*.json`.

### Standing answer — map keys must be the TRIMMED value

`sources/arcgis.ts` trims **both** sides before lookup: the type value at l.268
(`String(readCol(...)).trim()`) and the status value at l.232, and `buildBucketLookup` trims each
configured status at l.595. Several of these layers ship padded or trailing-space values
(`'D-NEW '`, `'LEGACY '`, `'COO   '`, `'BSD-Building (Residential New) '`). **A map key written with
the untrimmed string silently never matches** — it is not a parse error, the value just falls
through to `unclassified` / unmapped-status. Every key in this pass is stored trimmed, and a
validator asserted all 26 entries' keys against the live vocabularies (0 mismatches, 0 status value
in two buckets).

### Two packet errors corrected on evidence

1. **Adams CO `date_field` does not exist.** The packet gives `ApplicationDate`; the live layer
   answers `{"error":{"code":400,...["'Invalid field: ApplicationDate' parameter is invalid"]}}`
   (run 30370939582). The real column is **`CaseOpened`**. Left uncorrected this would have been
   written into `incremental_field` → `orderByFields=ApplicationDate DESC` → **every query for that
   entry fails** and the entry quarantines. Both `file_date` and `incremental_field` use
   `CaseOpened`.
2. **Lancaster NE `Issued` is a STRING date.** `Issued >= DATE '2024-07-28'` returns HTTP 400
   "Unable to complete operation" (run 30370939582), matching the packet's own note that it is
   `MM/DD/YYYY` text. **`recency_days` is deliberately not set there** — the option emits a
   `>= DATE '...'` literal (the Anaheim string-date standing answer).

### Verified rather than assumed

- **The exact ZIP predicate the connector emits** — `{zipCol}='{zip}'`, l.534 — was run against all
  7 native-ZIP endpoints (run 30370572544): `Zip='23451'` 15,981 · `ZIPCODE='28401'` 51,232 ·
  `ZIPCODE='40202'` 231 · `ZipCode='65201'` 14,806 · `ZIP='68502'` 10 · `PropertyZip='72201'` 6,100 ·
  `Site_Zip='99201'` **0**.
- **The Spokane 0 is real coverage, not a broken mapping.** `Site_Zip` is `esriFieldTypeString` and a
  groupBy over it (run 30370755906) shows the layer holds **no 99201/99202/99203/99204/99207 rows at
  all** — those are City of Spokane ZIPs and this is the **County** ledger. 28 of the packet's 46
  Spokane ZIPs do appear (99208 751 · 99223 619 · 99218 569 · 99224 544 · 99005 431 …); the rest will
  honestly render 0 county permits.
- **Every date column used for `recency_days` provably accepts a `DATE` literal** (run 30370939582) —
  which is exactly how the two failures above surfaced.

### Field deviations from the packet, each on evidence

The packet names a `type_field`/`status_field` per endpoint. Seven were overridden because the named
column is opaque codes, free text, or a near-constant — the same layer publishes a readable twin:

| Endpoint | Packet field | Used instead | Why |
|---|---|---|---|
| Brunswick NC | `PermitType` / `PermitStatus` | `ProjectType` / `PemitProjectStatus` | `PermitType` is a 224-value inspection/fee ledger; `PermitStatus` is 96 percent the single value `Active` (267,495 / 276,775) |
| DeKalb GA | `workType` | `WorkTypeDescription` | 59 opaque codes (`W-COMB`, `D-ALT`, `M-R+`) vs readable twin |
| Saint Paul MN | `FOLDER_TYPE` | `SUB_TYPE` | `FOLDER_TYPE` is a TRADE split; `SUB_TYPE` is the building-use classifier |
| Lincoln NE | `ClassCode` | `UseType` | `ClassCode` is bare digits `101/102/103/104` (needs an external codebook); `PermType` probed and rejected — single value `New` |
| Little Rock AR | `PermitType` | `BldUseDesc` | `PermitType` is 3-letter TRADE codes (ELE/PLU/MEC/BLD) |
| Topeka KS | `case_type` | `case_type_desc` | `BLDR-` codes vs readable twin |
| Kent DE | `PermitStatus` | `StatusDesc` | 2-letter codes (`AP`/`CL`/`CO`) vs readable twin |

**Kent's TYPE stayed on the coded `StructureType`**: `StructureDesc` was probed as the obvious
candidate and **rejected — it is free-text project narrative** ("12x16 deck", "10x12 screened
porch"), 334+ values almost all count=1. The layer publishes no coded-value domain, so only
unambiguous codes are mapped and the rest (RAPD 13,115 · ACCE 6,412 · PWP 5,737 · RARM 4,773 …)
**fail closed to `unclassified` rather than be invented**.

### Wired (26)

| registry_id | Coverage | type values | use-types | status values | ZIP scoping | recency_days |
|---|---|---|---|---|---|---|
| `kent-county-de-building-permits` | DE/Kent | 29 | 5 | 10 | spatial 5 mi | 730 |
| `virginia-beach-building-permits` | VA/Virginia Beach | 4 | 3 | 10 | native `Zip` | 365 |
| `durham-building-permits` | NC/Durham | 4 | 2 | 9 | spatial 5 mi | 730 |
| `cabarrus-county-plan-reviews` | NC/Cabarrus | 2 | 1 | 34 | spatial 5 mi | 730 |
| `new-hanover-county-building-permits` | NC/New Hanover | 56 | 5 | 18 | native `ZIPCODE` | 730 |
| `brunswick-county-permits` | NC/Brunswick | 4 | 3 | 7 | spatial 5 mi | 730 |
| `dekalb-county-building-permits` | GA/DeKalb | 34 | 5 | 5 | spatial 5 mi | 730 |
| `forsyth-county-ga-building-permits` | GA/Forsyth | 3 | 3 | 19 | spatial 5 mi | 730 |
| `savannah-commercial-building-permits` | GA/Chatham | 1 | 1 | 3 | spatial 5 mi | — |
| `louisville-active-construction-permits` | KY/Jefferson | 23 | 4 | 1 | native `ZIPCODE` | — |
| `kenton-county-devtracking-permits` | KY/Kenton | 9 | 4 | 2 | spatial 5 mi | — |
| ~~`saint-paul-approved-building-permits`~~ **RETIRED 2026-07-28** | MN/Ramsey | 21 | 6 | 6 | spatial 5 mi | 730 |
| `sioux-falls-building-permits` | SD/Minnehaha | 2 | 2 | 11 | spatial 5 mi | 730 |
| `bozeman-building-permits` | MT/Gallatin | 19 | 5 | 4 | spatial 5 mi | — |
| `missoula-addresses-with-permits` | MT/Missoula | 10 | 4 | 18 | spatial 5 mi | 730 |
| `columbia-mo-permits` | MO/Boone | 20 | 4 | 22 | native `ZipCode` | 730 |
| `overland-park-building-permits` | KS/Johnson | 2 | 2 | 3 | spatial 5 mi | — |
| `topeka-building-permits` | KS/Shawnee | 12 | 2 | 10 | spatial 5 mi | — |
| `lincoln-residential-new-construction-permits` | NE/Lancaster | 10 | 5 | 2 | native `ZIP` | — |
| `little-rock-permits` | AR/Pulaski | 6 | 2 | 5 | native `PropertyZip` | — |
| `bentonville-catalyst-permits` | AR/Benton | 35 | 4 | 17 | spatial 5 mi | 730 |
| `adams-county-building-permits` | CO/Adams | 6 | 3 | 18 | spatial 5 mi | — |
| `canyon-county-building-permits` | ID/Canyon | 13 | 3 | 5 | spatial 5 mi | — |
| `san-jose-permits` | CA/Santa Clara | 39 | 6 | 42 | spatial 5 mi | — |
| `salem-structure-permits` | OR/Marion | 13 | 4 | 1 | spatial 5 mi | — |
| `spokane-county-building-planning-permits` | WA/Spokane | 47 | 4 | 10 | native `Site_Zip` | — |
### NOT wired — 1 rejection with receipts

**`DE/Sussex` — `map.sussexcountyde.gov/.../Permit_Points/MapServer/0` (826,857 rows, 22 ZIPs).**
Its `pt_a_type_desc` column is a perfectly good readable type source, but the **status vocabulary is
undecodable**: `a_status` holds padded 4-char codes — `'C   '` 721,538 · `'O   '` 98,000 · `'CO  '`
3,898 · `'NO  '` 1,680 · `'E   '` 1,339 · `'OO  '` 287 · `'HIST'` 94 · `'BEAC'` 26 · `'PERM'` 20 ·
`'FLR '` 15 — and three independent attempts to find an authoritative decode all came back empty:
the layer metadata publishes **no coded-value domain** (`fields[].domain` is null), there is **no
paired description column** in the schema, and the MapServer **legend has a single unlabeled symbol**
(run 30370252139). A cross-tab of `a_status` x `a_project_shdesc` confirms the codes are orthogonal
to project type (`BEAC`, `CO`, `NO` all appear under `ACC. STRUC`), so context does not decode them
either. **`'C'` alone is 87 percent of the layer** — guessing it wrong (Closed vs Cancelled vs
Current) would mis-bucket the entire dataset. Skipped per the packet's own "if any endpoint fails,
document and skip" rule. Wiring it needs a codebook from Sussex County, not more probing.

### Honest shape limits (not defects)

The packet asks for "at least 3 use-types" and "at least 2 buckets" per entry. Several entries cannot
reach that **because the source vocabulary genuinely does not contain it**, and inventing categories
to hit a target is exactly what the anti-fabrication rule forbids:

- **1 use-type:** `cabarrus-county-plan-reviews` (`Building`/`Site`/`NA` only),
  `savannah-commercial-building-permits` (layer 0 is commercial-only; the residential companion is
  layer `/1` and is not in the packet).
- **2 use-types:** `durham-building-permits`, `sioux-falls-building-permits`,
  `overland-park-building-permits`, `topeka-building-permits` (every value is residential),
  `little-rock-permits`.
- **1 bucket:** `louisville-active-construction-permits` (status is `Issued` on all 23,297 rows) and
  `salem-structure-permits` (`Issued` on all 832) — the Frisco single-`ISSUED` precedent.
- **`kenton-county-devtracking-permits` publishes only ~59 of 1,622 rows**: `PROJECT_ST` is blank on
  1,563 (96 percent), and the connector drops a blank status (`blank_status`, l.233). Fail-closed by
  design, recorded rather than papered over.

### Two previously-rejected jurisdictions REOPENED

- **Saint Paul MN** — the MINNESOTA WIRE PASS recorded "St. Paul's org is live but its permits layer
  STALLED at 2025-06-30". This is a **different service** (org `9meaaHE3uiba0zr8`,
  `Approved_Building_Permits`) and it is current: 29,703 rows carry `ISSUEDATE >= 2024-07-28`.
- **San Jose CA** — the CALIFORNIA WIRE PASS rejected `planningpermits30` because every row carried
  the opaque status code `30`. This is a **different service** (`PLN_PermitsAndComplaints` layer 8)
  with a real 45-value vocabulary and the richest `type_map` in this pass (all six use-types).

### New Hanover — recovered, not skipped

Every full-table groupBy against `gis.nhcgov.com/.../BuildingPermits/FeatureServer/0` **aborted at
the 30 s probe timeout across two rounds** (482,334 rows). It is not an unusable source: narrowing
the scan to `ISSUE_DATE > 2025-01-01` returned both vocabularies cleanly (74 types, 18 statuses), and
the **runtime query is ZIP-scoped so it never runs a full-table scan** either. Caveat recorded: the
vocabularies were captured from that narrowed window, so a value occurring only in the
2024-07 → 2025-01 slice of the `recency_days: 730` window would log as unmapped rather than
mis-bucket.

### `recency_days` — added beyond the packet, with measured justification

The packet does not mention `recency_days`. It is set on 13 entries where a ZIP/envelope pull would
otherwise approach or exceed `max_rows` (20,000) — `ZIPCODE='28401'` alone returns **51,232** rows.
`max_rows` truncation is newest-first, so it is a safe backstop, but the cached-row size is the real
constraint (the CLEVELAND 5.98 MB ceiling). Measured trailing-2-year counts drove each choice, e.g.
New Hanover 51,232 → 5,328 · Boone 14,806 → 3,189 · Brunswick 276,775 → 91,704.
**Virginia Beach gets the tightest window (365 days)** because it is the one geometry-less endpoint:
every row it returns must be geocoded, and 23451 alone holds 15,981 rows all-time vs 2,646 in the
trailing year.

### Virginia Beach — the one geometry-less endpoint

`has_geometry: false` in the packet, confirmed live: the layer serves attributes only, with no
`esriGeometryPoint` and no lat/lng columns. So the packet's blanket "use `spatial_point_col`
= `geometry`" does not apply — records place through the engine's **geocode path** (Anaheim/Boulder
precedent) with `geocode_assemble: true`, since `StreetAddress` is street-only. ZIP scoping is native
(`Zip`), so no `spatial_zip_radius_mi`.

### Not yet live — deploy is the remaining step

`jurisdiction-registry.json` is a static import bundled into the edge function
(`index.ts:69`, `import jurisdictionRegistry from "./jurisdiction-registry.json"`). These 26 entries
therefore do **nothing** until `deploy-edge-functions.yml` runs for `get-address-report`, and the
affected ZIP pages carry no records until the cache refreshes (`dev_refresh_fire`, daily 09:00 UTC).
All **558** ZIP pages in the 26 covered counties were measured at **0 development-backed sites** —
every one is on the bare EPA facilities floor today.

---

## PHASE 2 ARCGIS NO-STATUS WIRE PASS (2026-07-28) — all 12 endpoints wired (arcgis 88 → 100, registry 112 → 124)

Source brief: `docs/implementation-packets/claude_code_phase2_prompt.md` +
`claude_code_implementation.json` → `phase2_arcgis_no_status` (12 endpoints, 247 ZIPs).
**Config only — no connector, engine or schema change.** Branch `claude/phase2-arcgis-no-status`.
Vocabularies are VERBATIM live groupBy output; four `recon-fetch` rounds — **30380143920**,
**30380342906**, **30380564556**, **30380718707** (targets under `scripts/recon/p2-*.json`).

### STANDING ANSWER — `status_const` does NOT bypass `status_to_bucket`

The Phase 2 brief says to set `status_const: "operating"` and *"set `status_to_bucket` to null or
omit"*, "to bypass status_to_bucket entirely". **That is wrong and would have emitted ZERO records
from all 12 endpoints.** The connector applies the constant as the row's `status_raw`
(`arcgis.ts:232`) and then buckets it through the same lookup as a live value (`l.218`); its own
docstring says so — *"Applied verbatim as each row's status_raw and bucketed through
status_to_bucket like any live value"* (`l.79`). With the map omitted the lookup is empty, every row
counts as an unmapped status, and `continue` drops it. `status_to_bucket` is also a **required**
field on the interface (`l.51`), so omitting it would make `buildBucketLookup` throw.

Every Phase 2 entry therefore pairs `status_const: "operating"` with
`"operating": ["operating"]` — the shape `nvdot-project-boundaries` already uses.

⚠️ **Pre-existing defect noticed while confirming this** (NOT touched by this PR, flagged for the
owner): **`san-antonio-prelim-plan-review`** sets `status_const: "proposed"` but has **all four
buckets empty**, so by the same mechanism it emits **zero records**. It needs
`"proposed": ["proposed"]`.

### Two packet data errors corrected on evidence

1. **Aurora's `date_field` is a corrupted literal** — the packet gives `"(2021-07-26"`. The real
   column is **`IssueDate`** (verified: 41,327 rows `>= 2024-07-28` of 164,091).
2. **Loudoun's ZIP column is NUMERIC.** The connector's default predicate `ZI_ZIP='20147'` returns
   HTTP 400 *"Unable to complete operation"*; unquoted `ZI_ZIP = 20147` returns **7,915**. Wired via
   `zip_where_template`, the documented escape hatch — `column_map.zip` would have silently failed.

### Charleston — scope corrected by measurement, then wired

`energov_history` is not a building-permit layer; it is **every** Energov case. A live `MODULENAME`
groupBy: **InspectionManagement 229,975** · PermitManagement 111,000 · PlanManagement 33,533 ·
CodeManagement 3,784 · ProjectManagement 3,139 · RequestManagement 2,315 · BusinessLicenseEntity 128
· IndividualLicense 40 · ApplicationManagement 13 = 383,927. **60% of the layer is inspections** —
which is also why the packet's `WORKCLASS` is blank on 239,354 rows (62%): an inspection has no work
class. `extra_where: "MODULENAME = 'PermitManagement'"` drops inspections, licences and code cases
**at source** (the Seattle/Chicago precedent), leaving real permits.

### Field deviations from the packet, each on evidence

| Endpoint | Packet field | Used instead | Why |
|---|---|---|---|
| Huntsville AL | `TypeOfWork` | `OccupancyType` | `TypeOfWork` is a work class (New Construction / Alteration / Addition) |
| Knoxville TN | `PERMITTYPE` | `LANDUSE` | opaque abbreviations with no domain — `CO` could be Commercial or Certificate of Occupancy |
| Aurora CO | `FolderDesc` | `SubDesc` | `FolderDesc` is permit-PROCESS categories (Counter Permit 71,480) — how it was filed, not what was built |
| Albuquerque NM | `TypeofWork` | `TypeofStructure` | work class vs building use |
| Thurston WA | `BPTYPE` | `BPTYPE_Desc` | `SF`/`MH`/`DEMOB` codes vs readable twin |

### Sheridan WY — wired, with a recorded limitation

`Type_of_Bu` is **free text**, not a controlled vocabulary: hundreds of values, **285 of the 363
parsed occur exactly once**, inconsistent casing and leading spaces (`" single family dwelling"`,
`" garage"`, `"Change of Use - Oil field service business"`), and the response was still truncated.
A *complete* type_map is impossible. Only unambiguous high-frequency values are mapped (keys stored
**trimmed**, which merges the leading-space variants); the long tail fails closed to `unclassified`
rather than be invented. Records still emit with their own coordinates and `record_url`.

### Thurston WA — the coordinate trap

`X`/`Y` look like coordinate columns but are **state-plane** (wkid 102749). `column_map` reads the
flattened geometry (`__lat`/`__lng`), which the connector reprojects to 4326 — mapping `X`/`Y` would
have placed every marker in the wrong hemisphere.

### Wired (12)

| registry_id | Coverage | type values | use-types | ZIP scoping | recency_days |
|---|---|---|---|---|---|
| `new-castle-county-permits` | DE/New Castle | 3 | 2 | spatial 5 mi | 730 |
| `loudoun-county-residential-permits` | VA/Loudoun | 6 | 1 | `zip_where_template` | — |
| `charleston-county-permits` | SC/Charleston | 41 | 4 | spatial 5 mi | 730 |
| `huntsville-building-permits` | AL/Madison | 6 | 2 | spatial 5 mi | — |
| `chattanooga-permits-archive` | TN/Hamilton | 2 | 2 | spatial 5 mi | 730 |
| `knoxville-building-permits` | TN/Knox | 19 | 6 | spatial 5 mi | 730 |
| `desoto-county-permits` | MS/DeSoto | 4 | 2 | spatial 5 mi | — |
| `flathead-county-building-permits` | MT/Flathead | 6 | 3 | spatial 5 mi | — |
| `aurora-building-permits` | CO/Adams + CO/Arapahoe | 44 | 6 | spatial 5 mi | 730 |
| `sheridan-county-building-permits` | WY/Sheridan | 16 | 2 | spatial 5 mi | — |
| `albuquerque-building-permits` | NM/Bernalillo | 26 | 4 | spatial 5 mi | 730 |
| `thurston-county-residential-permits` | WA/Thurston | 5 | 2 | native `ZIP5` | 730 |
### Honest shape limits and scope notes

- **`loudoun-county-residential-permits` has ONE use-type** — it is a residential-only layer
  (`UNIT_TYPE` is entirely single-family/multi-family/group-quarters).
- **`chattanooga-permits-archive` is a FROZEN ARCHIVE** — the layer is literally named
  `Chatt_permits_to_12_31_2025` and spans 2006-01-01 → 2025-12-31; it will not gain new permits.
- **`flathead-county-building-permits` is layer `/1`, "Current Year Permits" — 243 rows.** Layer
  `/0` holds prior years and is not in the packet, so it is not wired.
- **`aurora-building-permits` declares BOTH Adams and Arapahoe** — Aurora straddles the line,
  confirmed against our own rows (80010/80011/80019 Adams; 80012–80016 Arapahoe).
- Two hosts were flaky during recon and needed retries: Charleston (`fetch failed` ×2) and Knox
  (HTTP 503 ×2). Both succeeded on retry; neither is an unusable source.

### Not yet live — deploy is the remaining step

Same as Phase 1: `jurisdiction-registry.json` is a static import bundled into the edge function
(`index.ts:69`), so these 12 entries do nothing until `deploy-edge-functions.yml` runs for
`get-address-report` and the cache refreshes (`dev_refresh_fire`, daily 09:00 UTC).

---

## PHASE 4 SPECIAL-HANDLING WIRE PASS (2026-07-28) — 3 of 6 endpoints wired (registry 125 → 128), 3 rejected with receipts

Source brief: `docs/implementation-packets/claude_code_phase4_prompt.md` +
`claude_code_implementation.json` → `phase4_special_handling` (6 endpoints, 533 ZIPs).
**Config only — no connector, engine or schema change.** Branch `claude/phase4-special-handling`.
Every vocabulary below is VERBATIM live output; four `recon-fetch` rounds — **30384902474**,
**30385163406**, **30385461375**, **30385625756** (targets under `scripts/recon/p4-*.json`).

### STANDING ANSWER — on **socrata**, `status_const` DOES bypass `status_to_bucket` (the opposite of arcgis)

The Phase 2 standing answer above ("`status_const` does NOT bypass `status_to_bucket`") is an
**arcgis** fact and does not carry to the socrata connector. `sources/socrata.ts` assigns the
constant to *both* sides directly — `statusRaw = entry.status_const; bucket = entry.status_const;`
(l.283-285) — and never consults the lookup, so a socrata `status_const` entry keeps all four
buckets **empty** (the `east-baton-rouge-building-permits` / `marin-county-building-permits`
shape), while an arcgis one must echo the constant into its bucket. Wiring either connector with
the other's shape emits zero records. Both new socrata entries here use the empty-bucket form; the
one new arcgis entry has a real status column and no constant at all.

### Wired (3)

| registry_id | platform | jurisdiction | special handling | live receipt |
|---|---|---|---|---|
| `buffalo-building-permits` | socrata | City of Buffalo (NY/Erie) | no status column → `status_const` | 14214 → **67** rows, 14216 → **92** on the exact query the connector builds |
| `prince-georges-county-permits` | socrata | Prince George's County (MD) | no geometry → `geocode_assemble`; **numeric ZIP** | 20772 → **33**, 20740 → **13**, 20785 → **7** |
| `butler-county-ks-permits` | arcgis | Butler County (KS) | no jobsite ZIP → `spatial_zip_radius_mi` | envelope smoke returns real Butler points, lat 37.67–37.76 |

### Coverage strings verified against the live `communities` table

The coverage gate matches `communities.state`/`county` verbatim (trim + lowercase), so a wrong
county string is a silent no-op — the `harris-county-permits` failure class. Queried live:
**NY/`Erie` → 72 ZIP pages**, **MD/`Prince George's` → 36**, **KS/`Butler` → 19** — each exactly the
ZIP count the packet lists for that endpoint, so all three entries have a real surface the moment
the function is deployed. (The rejected three would have had one too: NJ's ten counties hold 359 ZIP
pages, VA/Arlington 11, WI/Milwaukee 36 — their blockers are the datasets, not our coverage.)

Every vocabulary is complete — each set sums **exactly** to its row count: Buffalo 27 `aptype`
values = 275,572; Prince George's 3 `permit_category` = 461,508 (and 115 `permit_type` = 461,508);
Butler 9 `open_closed` + 1 null = 911.

### Prince George's — `zip_code` is a NUMBER (the connector's default predicate 400s)

The socrata connector's default ZIP clause is `upper(zip_code)='20772'`, which the portal rejects:
`HTTP 400 query.soql.type-mismatch — "Type mismatch for upper, is number"` (verified live, run
30385461375). `zip_numeric: true` switches it to `zip_code=20772`, which returns rows. This is the
`east-baton-rouge-building-permits` option and the second time it has been needed; **check the ZIP
column's TYPE before wiring any socrata entry** — the failure is a hard 400, not an empty result,
so it would have surfaced only after deploy.

### Butler KS — the packet's boolean type flags are "No" on 100% of rows

The brief specifies a custom `type_map` over `buildingpermit` / `solarpermit` /
`buildingsiteonlypermit` ("all Yes/No strings", *"If `buildingpermit = "Yes"` → Residential or
Commercial … If `solarpermit = "Yes"` → Utility"*). **A groupBy over all three fields returns
exactly ONE combination:** `{buildingpermit:"No", buildingsiteonlypermit:"No", solarpermit:"No"}`,
`n=911` — there is no `Yes` anywhere in the layer. Their field *aliases* explain why: "Building
Permit **Complete**", "Solar Permit **Complete**", "Building Site Only Permit **Complete**" — they
are workflow-completion checkboxes (`defaultValue: "No"`), not permit-type flags. A `type_map` over
them would classify every record identically and carry zero information.

The only other candidate, `zoning` (16 verbatim values summing to 911 — RURAL RESIDENTIAL DISTRICT
363, AGRICULTURAL DISTRICT 40 192, AGRICULTURAL DISTRICT 80 133, URBAN JURISDICTION 126, …), is the
**parcel's** zoning district, not the permit's use; mapping it would invent a classification the
source never states. The entry therefore ships with **no `type_map`** and every record is
`use_type:"unclassified"` (logged) — the fail-closed outcome the registry rules prescribe, not a
guess. **Standing answer: a boolean-flag "type" field must be proven to vary before a `type_map` is
built on it — a single groupBy combination means the field is a workflow checkbox, not a classifier.**

Butler's other trap: the layer's only ZIP field is `cama_zip`, the CAMA landowner's **mailing** ZIP
(ZIP+4, frequently out of state — 01801 MA, 15317 PA, 30068 GA observed), **not** the jobsite. It is
not mapped; scoping is `spatial_zip_radius_mi: 5` on the layer's own point geometry.

### NOT wired — 3 rejections with receipts

1. **NJ statewide (`data.nj.gov` `w9se-dmra`) — unscopable and unplaceable.** The dataset has **no
   ZIP column, no street-address column and no geometry**: the 36 columns are comu/treasurycode/
   muniname/munitype/county/recordid/**block**/**lot**/permitno/status/permitstatusdesc/permitdate/
   certdate/permittype/permittypedesc/certtype/certtypedesc/certcount/…fees…/usegroup/usegroupdesc/
   censusnumber/censusdesc/public/source/sourcedesc/version/processdate/pk. The socrata connector
   needs either a ZIP column or `spatial_point_col` + radius; it has neither, so the entry would be
   quarantined ("no zip column mapped — statewide dataset skipped") and emit nothing. There is also
   nothing to geocode — block/lot is not an address, and the packet's fallback ("municipality
   centroid lookup") would place every permit in a town at one fabricated point, which the
   anti-fabrication directive forbids. Other findings while confirming: the row count is
   **2,755,796**, not the packet's 99,808; `permitstatusdesc` has only 2 values (Permit 1,418,735 /
   Certificate 1,337,061); and `permitdate` ranges **1113-11-11 → 2925-08-15** (unusable dates).
2. **Arlington VA (`datahub-v2.arlingtonva.us/api/RealEstate/Permit`) — no connector, and no
   scopable field.** `platform: "json_api"` does not exist: `sources/` holds arcgis, socrata, ckan,
   csv, carto (+ tceq-cr, tdlr-tabs) only, and `index.ts` calls exactly those. Even with a
   connector, the response has **no ZIP, no address and no geometry** (permitKey, provalLrsnId,
   realEstatePropertyCode, permitNbr, permitActivationDate, permitCode, permitCostEstimateAmt,
   permitCompletedDate, permitCompletedPct, permitNoteText) — records join to parcels by
   `realEstatePropertyCode`, and no parcel endpoint is in scope for this packet. The packet's own
   date field, **`permitActivationDate`, is an empty string on every sampled record**.
3. **Milwaukee WI (`data.milwaukee.gov` CKAN `828e9630-…`) — no ZIP column.** The resource's 10
   fields are `_id`, Date Opened, **Address**, Record ID, Permit Type, Status, Date Issued,
   Construction Total Cost, Use of Building, Dwelling units impact (16,685 rows). `sources/ckan.ts`
   requires a mapped ZIP column and quarantines the resource otherwise ("no zip column mapped —
   resource skipped for ZIP report"); the CKAN connector has no spatial-radius option and no
   `geocode_assemble`, and the Address values are street-only ("2033 S 24TH ST"), the same
   ungeolocatable shape that rejected Somerville MA and Orlando FL.

All three are documented, not wired — an unusable source is documented, never wired.

### ⚠️ Pre-existing defect noticed while confirming this (NOT touched by this PR)

**`cincinnati-building-permits` (socrata) carries `include_types: ["Building","Wrecking"]`, which
the socrata connector never reads.** `include_types` is a **csv-only** option (`sources/csv.ts:61`,
applied at `l.316`); `grep -rn include_types sources/ index.ts` matches csv.ts and nothing else. The
entry's intended noise filter is therefore inert — every Cincinnati permit type is ingested. The fix
is to move the filter into `extra_where` (the socrata equivalent), but that changes what a live
state renders, so it is flagged for the owner rather than changed here.

### Not yet live — deploy is the remaining step

Same as Phases 1–3: `jurisdiction-registry.json` is a static import bundled into the edge function
(`index.ts:69`), so these 3 entries do nothing until `deploy-edge-functions.yml` runs for
`get-address-report` and the cache refreshes (`dev_refresh_fire`, daily 09:00 UTC).

---

## SUSSEX COUNTY DE — RE-EXAMINED AND STILL NOT WIREABLE (2026-07-28)

`map.sussexcountyde.gov/trdserver/rest/services/Permit_Points/MapServer/0` — the one endpoint
skipped in the Phase 1 ArcGIS pass. Re-opened on instruction to hunt for a status codebook.
Branch `claude/skipped-endpoints-geocode`; three `recon-fetch` rounds — **30389940983**,
**30390093619**, **30390265675** (targets under `scripts/recon/sussex-round*.json`).
**Outcome: no registry entry. The blocker is unchanged and is now proven from five independent
angles instead of three.**

Everything else about this layer is good: `esriGeometryPoint` in WGS84, 827,020 rows, a readable
`a_use_desc` type source, and per-row parcel ids. The single blocker is that its lifecycle status
cannot be decoded, and the dominant code covers **87%** of the layer.

### No public codebook exists — five independent probes

1. **Field domains are null.** `a_status` carries `"domain": null` on **both** the MapServer and
   the FeatureServer view of the same layer (`.../FeatureServer/0?f=json`).
2. **`queryDomains` returns nothing.** The service advertises `"supportsQueryDomains": true`, and
   `.../MapServer/queryDomains?layers=[0]&f=json` answers **`{"domains":[]}`**.
3. **No lookup table.** The service root reports exactly one layer and **`"tables":[]`**.
4. **The publisher attached no documentation.** The service's own portal item
   (`serviceItemId 75d84889df3c45c98365e3b5b9619c6c`) carries `"description": null`,
   `"documentation": null`, `"snippet": "."`, `"tags": ["."]`, `scoreCompleteness 35`.
5. **The folders that would hold a companion permits service are not public.** Both
   `/trdserver/rest/services/Community_Development?f=json` and `/Munis?f=json` return
   **`{"error":{"code":499,"message":"Token Required"}}`**. (`Planning_And_Zoning` IS public and
   holds only wetlands + a transportation-improvement-district layer.)

Plus the Phase 1 findings that still hold: the MapServer legend renders a single unlabeled symbol,
and `a_status` × `a_project_shdesc` is orthogonal (`BEAC`, `CO`, `NO` all appear under `ACC. STRUC`).

### The obvious guess is affirmatively WRONG, not merely unproven

The tempting read is "`C` = closed/completed, `O` = open." Live evidence refutes it as a safe
default. `a_status` × count/min/max `pt_p_issue_date`, all 12 values (a groupBy over `1=1`, so the
set is complete by construction and sums to the layer):

| a_status | n | min issue date | max issue date |
|---|---|---|---|
| `C   ` | 721,713 | 1982-06-01 | **2032-02-15** |
| `O   ` | 97,926 | 2004-10-29 | 2026-07-23 |
| `CO  ` | 3,896 | 2012-10-03 | 2026-07-22 |
| `NO  ` | 1,686 | 2020-07-14 | 2026-07-23 |
| `E   ` | 1,339 | 2007-05-16 | 2025-04-29 |
| `HIST` | 94 | 1982-12-10 | 2016-12-09 |
| `FLR ` | 30 | *(null)* | *(null)* |
| `BEAC` | 26 | 2019-11-12 | 2025-04-04 |
| `PERM` | 111 | *(null)* | *(null)* |
| `OO  ` | 170 | *(null)* | *(null)* |
| `PNZ ` | 20 | *(null)* | *(null)* |
| `'    '` | 9 | 2016-10-14 | 2021-07-14 |

**`C` is not an archival marker: 35,515 `C` rows carry an issue date after 2025-01-01, versus
18,271 `O` rows** (`returnCountOnly` on each) — and `C`'s max issue date is **forward-dated to
2032**. So `C` is the normal code for brand-new permits too, and bucketing it as `operating`
("built") would stamp 721,713 records — including 35,515 issued in the last 18 months — with a
lifecycle the source never states. That is the exact failure the registry's "NEVER GUESS THE
BUCKET" rule exists to prevent, at the largest scale it could occur.

**A second undecoded status dimension cross-cuts the first.** `h_mun_stat` (1 char, 8 values)
splits every `a_status`: `C` alone is 691,646 under `h_mun_stat=C`, 17,134 under `W`, 11,702 under
`A`, 925 under `X`, 225 under `D`, 77 under `E`, 4 under `H`. So even a correct decode of
`a_status` would not settle the lifecycle on its own.

Four of the twelve codes (`FLR` 30, `OO` 170, `PERM` 111, `PNZ` 20 — 331 rows) carry **no issue
date at all**, so they would be excluded regardless.

**Standing answer: "map it to the best of your ability" is not available for a status vocabulary.**
`status_to_bucket` is an exact verbatim lookup and an unmapped value fails closed; a partial map
built only from codes we can *guess* would publish a few hundred rows while excluding 826,000+, and
a wrong `C` would mis-bucket the whole layer. Wiring this needs a codebook from Sussex County —
a records request or a published data dictionary — not more probing.

### Bonus finding for whoever wires it later — the layer duplicates each permit per fee module

`pt_a_permit_no` is **not** unique and is **recycled across years**. Permit `158677` returns three
rows: OBJECTID 1 (`pt_f_pifm_key` `FSF`, issued 2021-06-07), OBJECTID 2 (`POT`, same date, all
other mapped fields identical) and OBJECTID 353543 (`HIST`, issued **1996-08-05**). Mapping
`case_number: "pt_a_permit_no"` is therefore the correct choice: `source_id` becomes
`arcgis:<entry>:158677` for the FSF/POT pair, so engine v22's exact-identity dedup collapses them,
while the 1996 row survives as a distinct record because `file_date` is part of the dedup key.
Left unmapped (e.g. falling back to OBJECTID), the same permit would be emitted 2-3× per ZIP page.

Other shape notes for a future wire: no ZIP column and no address column anywhere in the 27 fields,
so ZIP scoping must be `spatial_zip_radius_mi` on the layer's own points; `a_use_desc`
("RESIDENTIAL SINGLE FAMILY", …) is the readable type source; `h_description1`/`h_description2` are
right-padded 60-char fragments of one description.
---

## SAINT PAUL RETIRED FROM THE REGISTRY (2026-07-28) — arcgis 129 → 128

`saint-paul-approved-building-permits` (MN/Ramsey), wired in the Phase 1 ArcGIS pass, is
**removed**. Founder call, on these live receipts from the post-deploy probe of the deployed
function (`get-address-report` v105):

- **It never served a page.** ZIPs 55101 and 55102 each timed out the WHOLE report —
  `Timeout of 90000 ms reached`, and again `Timeout of 150000 ms reached` — so those pages
  returned nothing at all, not even the EPA facilities floor.
- **The layer is stalled.** `max(ISSUEDATE) = 2025-06-30 21:57:20 UTC` (live `outStatistics`),
  so every record it could cache is ≥13 months old.
- **No config combination could rescue it.** `ISSUEDATE > DATE '2025-07-28'` returns **0 rows**
  at both 5 mi and 3 mi, so a 365-day window would have silently zeroed the entry; and at
  730 days the volume is 27,639 rows at 5 mi / 14,898 at 3 mi, which at the measured engine
  ratio (~1,013 bytes of output per record) implies a ~14–19 MB cached row against a ~3.5 MB
  working ceiling. PR #426 landed the `out_fields` + `page_size` projection that fixes the
  fetch time; it could not fix the payload, because the payload is the problem.
- This is the same stall the **MINNESOTA WIRE PASS** recorded before Phase 1 wired it —
  *"St. Paul's org is live but its permits layer STALLED at 2025-06-30"*.

**Ramsey County's 17 ZIP pages fall back to the EPA facilities floor**, which is what they
already display (their cached rows carry 0 sourced sites). No page loses content.

**The layer stays on the nightly reprobe list** — `scripts/source-monitor-targets.json` tracks
it as `stpaul-approved-building-permits`, untouched by this PR, so the monitor will flag it if
Saint Paul resumes publishing. Re-wiring then is one appended registry entry.

**Standing answer: freshness is a wiring gate, not a post-wire discovery.** Check
`max(<date column>)` BEFORE adding an entry — a stalled layer that fits the schema perfectly
still cannot serve a "what's being built near you" page, and a recency window applied to it
produces a silent zero rather than a visible failure.

---

## SUSSEX COUNTY DE — WIRED via CONDITIONAL USE (2026-07-31) — `sussex-county-de-conditional-use` (arcgis 101 → 102)

### First: this does NOT overturn "SUSSEX COUNTY DE — RE-EXAMINED AND STILL NOT WIREABLE (2026-07-28)"

Both records stand. They are **different endpoints on different hosts**, and reading them as
contradictory is the mistake this section exists to prevent:

| | 2026-07-28 — rejected, still rejected | 2026-07-31 — wired |
|---|---|---|
| host | `map.sussexcountyde.gov/**trdserver**/` | `maps.sussexcountyde.gov/**server**/` |
| layer | `Permit_Points/MapServer/0` | `Hosted/Conditional_Use_View/FeatureServer/0` |
| content | building permit POINTS | conditional-use APPLICATIONS |
| rows | 827,020 | 2,566 |
| blocker | `a_status` undecodable — no domain, no `queryDomains`, no lookup table, no publisher docs; `C` is 87% of the layer and forward-dated to 2032, so bucketing it would mis-stamp 721,713 records | none — vocabulary enumerates completely |

The Permit_Points blocker is **unchanged**: it still needs a codebook from the county, not more
probing. Do not wire it. The earlier pass simply never reached this second server — it was hunting
a codebook for the layer it already had.

### Why this county mattered enough to look twice

Sussex is the **only dark Delaware county**: 22 of DE's 68 ZIP pages, with Kent (17/17) and New
Castle (29/29) already carrying their own county source. DE is one county away from the 90% bar.

### Liveness — three-part test, all three pass

Clean NAME (`Conditional_Use_View`, no `test`/`archive`/`NOT IN USE`) · correct ENTITY (Sussex
County DE Planning & Zoning, on the county's own enterprise server) · recent DATES — newest
`application_rcvd_date` **2026-07-27**, three days before wiring. 2,566 rows, POLYGON geometry
riding the shipped `featurePoint()` centroid path.

### Status vocabulary — VERBATIM and COMPLETE

Live groupBy on `cc_decision`, `exceededTransferLimit: false`, **16 values summing to EXACTLY
2,566** — the positive control that makes the enumeration trustworthy:

`Approved` 1864 · `Denied` 238 · `Withdrawn` 187 · *(null)* 172 · `WITHDRAWN` 53 · `APPROVED` 33 ·
`Approval` 7 · `Approved ` 3 · `DENIED` 2 · `Deferred` 1 · `Defered` 1 · `Approved with Conditions` 1 ·
`Approved with revised conditiona` 1 · `WITHDRAWN BY APPLICANT` 1 · `WITHDRAWN BY COUNTY` 1 ·
`8/19/2025` 1

Mapped verbatim; the connector trims both sides, so `Approved ` folds onto `Approved`.
**173 rows stay deliberately UNMAPPED and fail closed:** the 172 nulls (filed, no Council decision
yet) and the single `8/19/2025` — a date typed into a decision field, a publisher data-entry error
with no bucketable meaning. Dropped, never guessed.

### The type field needed a connector change — and the obvious shortcut was WRONG

`proposed_use` is the semantically correct column and is **free prose**: 400+ distinct values over
2,566 rows, overwhelmingly n=1, with typos (`electrial subsation`, `mantenance dispatch office`)
and whole sentences (`operate a food truck for a period exceeding three days`). **Rule 5 terminal**
— no `type_map` can exist.

`current_zoning` **is** a closed vocabulary — 38 values summing to exactly 2,566 — and was
**REJECTED as the type source anyway**, which is the finding worth carrying:

> **A conditional use is BY DEFINITION something the existing zoning does not allow.** Zoning
> describes the PARCEL; `use_type` must describe the PROPOSAL. Mapping `AR-1 → Residential` would
> have labelled an electrical-substation application "Residential" — on 1,987 of 2,566 rows. A
> closed, tidy, live vocabulary can still be the wrong column, and it is more dangerous than a
> missing one because it looks complete.

So `use_type_const` now exists in `sources/arcgis.ts`, mirroring `status_const`, set to
**`Development`** — the generic member of the closed `TYPE_EXACT` vocabulary, rendering the "Other
project" pin and asserting nothing about the use (Phoenix residual-bucket precedent).

### It closed a latent FALSE-LIVE trap

The Live scoreboard's `entryCompleteness()` **already accepted `use_type_const`** as satisfying the
pin-icon requirement — while **no connector implemented it and no registry entry used it**. The
first entry to set it would have been counted toward its state's Live percentage while the
connector emitted `use_type: "unclassified"` and the pages rendered unclassified pins, with nothing
failing anywhere. Setting both a constant and a `type_map` is now a **quarantined config error**
rather than a silent precedence decision.

### Coverage receipts — records land county-wide, not in one cluster

Live envelope probes at the connector's own `spatial_zip_radius_mi: 5` (Rule 13 — same scope the
connector asks), around real ZIP centroids spanning the county:
**19966 Millsboro 452 · 19930 Bethany Beach 284 · 19975 Selbyville 286 · 19973 Seaford 236.**

`record_url_precision: "dataset"` — the layer carries no per-case URL column and Sussex's case
search is not addressable per `application_number`, so templating one would be guessing.


## COVERAGE-EXTENSION PASS (2026-08-01) — 108 dark pages lifted, ~39,000 records, **config only**

No connector, engine or schema change in the entire pass. Every entry below is one or two added
`coverage` elements on an **existing** registry entry, except `coconino-county-permits` and
`bend-or-permit-applications`, which are new entries.

### The method — a straddling-city ranking, computed locally, then probed live

The seam: a city's permit layer does not stop at the county line, but its registry entry usually
declares one county. For every entry carrying `spatial_zip_radius_mi`, compute which **dark** ZIP
pages in **undeclared** counties fall within range of that source's own **lit** ZIP centroids. That
ranking is a *lead list*; every candidate was then probed live against the layer before wiring.

**Probe with the connector's own envelope math, never an equivalent-looking one.** `envelopeFor()` is
`dLat = mi/69`, `dLng = mi/(69·cos(lat))`. A hand-rolled ±0.0724° box (right for latitude, wrong for
longitude at 34.8°N) returned **0** for 35613; the connector's formula returns **133**. The hand-rolled
probe would have dropped a real page and filed it as an honest empty.

### Wired (13 extensions + 2 new sources)

| entry | coverage added | pages | records |
|---|---|---|---|
| `kcmo-building-permits` | MO Clay, MO Platte | 17 | 1,414 |
| `dekalb-county-building-permits` | GA Fulton, GA Gwinnett | 16 | 16,105 |
| `coconino-county-permits` *(new)* | AZ Coconino | 15 | 1,873 |
| `fairfax-recent-building-permits` | VA Arlington | 11 | 1,365 |
| `overland-park-building-permits` | KS Wyandotte | 8 | 1,932 |
| `kenton-county-devtracking-permits` | KY Campbell | 7 | 84 |
| `huntsville-building-permits` | AL Limestone | 5 | 2,754 |
| `new-orleans-permits` | LA Jefferson | 5 | 701 |
| `bend-or-permit-applications` *(new)* | OR Deschutes | 4 | 7,864 |
| `new-castle-county-permits` | PA Delaware, PA Chester | 5 | 41 |
| `durham-building-permits` | NC Orange | 3 | 3,049 |
| `minneapolis-ccs-permits` | MN Ramsey | 3 | 1,156 |
| `albuquerque-building-permits` | NM Sandoval | 2 | 191 |
| `denver-residential-construction-permits` | CO Jefferson | 5 | 216 |
| `aurora-building-permits` | CO Douglas | 1 | 342 |
| `chicago-building-permits` | IN Lake | 1 | 1 |

Every one carries a **positive control** measured before wiring and a **bidirectional gate proof**
after (records appear on the declared counties and nowhere else), with `0 missing record_url,
0 missing coordinates, 0 unclassified` across each affected source.

Two are cross-**state** extensions, which the `{state, county}` coverage shape permits and the radius
semantics justify: `new-castle-county-permits` (a Delaware county layer reaching PA ZIPs along the
line) and `chicago-building-permits` → IN Lake.

### Reverted

- **`salem-or-structure-permits` — a DUPLICATE, removed.** `salem-structure-permits` was already wired
  on the **identical `service_url`**. The two entries had different `registry_id`s, so exact-identity
  dedup could not collapse them and every Salem permit cached twice (97310 783 + 404, 97302 692 + 431,
  97301 678 + 406, …). Purged; 0 records remain.
  > **Standing answer — before wiring ANY source, grep the registry for every state in the candidate's
  > coverage AND for the `service_url` host.** The URL match is the decisive check.
- **`adams-county-building-permits` → CO Jefferson — reverted on SIZE.** It produced **80001 at 20,041
  records / 19.65 MB**, the largest page in the cache, and 80002 at 16.26 MB. `denver-residential` kept
  5 of the 6 pages at 0.15/0.10 MB; only 80005 was lost.

### Rejections with receipts — do not re-probe

| candidate | receipt |
|---|---|
| Cass County MO (KCMO) | 0 rows for all 14 Cass ZIPs, with 64155 **4,969** / 64154 **4,106** as controls **in the same query** |
| DeKalb → GA Cobb | all 10 probed ZIPs 0, against DeKalb's 50,170 control |
| `butler-county-ks` → KS Sedgwick | control ZIP 66840 returned **1** record — the layer is empty there |
| `pierce-county-pals` → WA King | control 98303 **6,830** (healthy), but only 1 of 6 King ZIPs non-zero |
| `clark-county-active-dev-permits` → OR Multnomah | all 8 probed ZIPs 0 |
| `fairfax-active-site-construction` → VA Prince William | non-zero ZIPs at 24 / 11 / 8 in-envelope — below the noise floor |
| Birmingham AL (Jefferson, 60 dark) | CKAN portal live, permits **stalled at 2017** (`modified` 2017-06-29) |
| Alameda CA (51 dark) | Berkeley + Oakland Socrata catalogs complete; **neither publishes a permit ledger** |
| St. Louis County MO (63 dark) | host 404s; AGO title search returns St. Louis County **MINNESOTA** |
| Oakland County MI (78) · Oklahoma County OK (52) · Sedgwick KS (50) | hub 404 / 403 WAF / SPA shell, no JSON catalog |
| Lancaster County PA (56) | the layer is a **28-row annual aggregate** (`Year`, `Project_type`, `Units_permitted_by_type`) |
| Snohomish County WA (33) | well-shaped, but **stalled** — 0 rows dated 2026 vs 863 in 2025 |
| Anne Arundel MD (37) | REST live **with an `InspectionsPermits` folder** — `{"code":499,"message":"Token Required"}` |
| Howard County MD (21) | combined permits table → **403 "no row or column access to non-tabular tables"** |
| Westchester NY (75) | REST live; `Municity5` + `DOH_Permit` folders both **Token Required** |
| San Mateo CA (31) | permit datasets are **aggregates** ("PercentOfBuildingPermitsCreatedOnline") |
| San Luis Obispo CA (29) | **water-well** permits + building *footprints* only |
| Contra Costa (43) · Ventura (34) | REST roots live, **no permits folder** |
| Orange County CA (85) | OCGIS live; only county CIP — `Construction_Management_CIP_Projects` **51 rows**, `Future_Construction_Projects` **19** |

### `anaheim` Accela_Building_Permits — a good source, deliberately NOT wired

`services3.arcgis.com/hPs600I3X0RTaaaq/…/Accela_Building_Permits/FeatureServer/0` is **distinct from
the wired `anaheim-land-use-cases`** (`Open_Data_Land_Use_Permits`). Fresh (`modified` 2026-08-01),
**191,375 rows**, property addresses with the ZIP inline, real geometry, and complete vocabularies —
**17 `casestatus`**, **57 `typeofwork`**.

**It lifts zero dark pages.** `address LIKE '%{zip}%'` scoping reaches only Anaheim's own ZIPs, and all
seven are already lit (92805 187 · 92804 142 · 92806 135 · 92801 123 · 92802 113 · 92807 60 ·
92808 24). None of the 85 dark Orange ZIPs is an Anaheim ZIP. The mapping cost is real: `typeofwork`
contains a literal `"NULL"` string (5,111 rows), an empty string (649), and typo variants
(`Phototvoltaic with Micro-Inverters` 1,720 beside `Photovoltaic with Micro-Inverters` 508; six
spellings of tenant improvement) — each unmapped value drops records silently.

> **Standing answer — measure the LIFT before paying the mapping cost.** A source can be fresh,
> first-party, well-formed and complete and still be worth nothing, because every ZIP it reaches is
> already lit.

### ⚠️ Two defects found in EXISTING entries (not introduced by this pass)

- **`las-vegas-building-permits` is scoped and labelled by the OWNER'S MAILING ADDRESS.** `ZIP`, `CITY`,
  `STATE`, `ADDR1` are the `LEGALOWNER`'s address — e.g. `ZIP 92660 / NEWPORT BEACH / CA` on a permit
  whose property is `8526 DEL WEBB BLVD, Sun City Summerlin`. The entry selects on that ZIP and renders
  it as the record address; the true property address sits unused in `STNO`/`PREDIR`/`STNAME`/`SUFFIX`.
  Live: **3,099 records / 51 pages / 1,457 distinct addresses**, with `5795 BADURA AVE STE 180` carrying
  **174 records on one page** and the top 8 (all suite numbers) carrying 30 %. **The selection cannot be
  fixed in config — the layer exposes no property ZIP.** Founder call: retire, accept, or build a
  property-address path.
  - ✅ **RETIRED 2026-08-02, and the deciding measurement is that it costs ZERO pages.** Of the 51 Clark
    County pages carrying its records, **51 keep content from other sources and 0 go dark** — the ZIPs
    are already lit by `clark-county-active-projects`, `clv-planning-cases`,
    `henderson-residential-permits` and `henderson-commercial-permits`. So the choice was never
    "coverage vs correctness": keeping the entry bought no LIVE page and cost 3,121 records asserting a
    locality the source does not support. A resident of 89118 was shown 174 `ProdHome`/`Model` permits
    stacked on one builder's office suite while the homes actually being built appear on no page at all.
  - **Why the third option was closed, with a field inventory rather than an opinion.** Live layer
    metadata (pg_net, 2026-08-02, 436,181 rows): the fields are `APNO, APBLDGKEY, APTYPE, WORKTYPE,
    APPLICANT, APL_ADDRESS, BLDGAPPLSTATUS, ISSDTTM, DECLVLTN, CALCVLTN, STNO, PREDIR, STNAME, SUFFIX,
    POSTDIR, STSUB, SUBDIVCODEADR, PRCLID, SUBDIV, PRCLTYPE, SUBDIVCODEPRCL, BLOCK, LOT, LEGALOWNER,
    NAME, ADDR1, CITY, STATE, ZIP, CONTACTINFO, GALLONS, PUBLICDROPLIST, COMM, RES, MISC_FEES,
    CODE_ANALYSIS, NSCB, ObjectId` — **one ZIP field, the owner's, and no geometry.** Pointing
    `column_map.address` at `STNO/PREDIR/STNAME/SUFFIX` fixes the DISPLAY and leaves the SELECTION
    wrong, i.e. the right address on the wrong page — strictly worse than today. A property-address
    path would need the whole 436k-row layer bulk-geocoded off `PRCLID`/street fields into a ZIP before
    selection: a separate ingest job, not a connector option.
  - **How it comes back.** A City of Las Vegas dataset that exposes a property ZIP or per-record
    geometry, or the bulk pre-geocode pipeline above. The retired entry's full `_receipts` (freshness,
    the 9 verbatim `BLDGAPPLSTATUS` values, the rejected sibling services) are preserved in git history
    at the retiring commit, so re-wiring does not start from zero.
- **Audited whether that defect is systemic — it is NOT.** Records-per-distinct-point *within a single
  page* (the cross-page-duplication-free metric) separates cleanly: `las-vegas-building-permits` 41.2,
  `clv-planning-cases` 32.1, then `brunswick` 6.3 and 100+ others at **≤2.9**. `clv-planning-cases` was
  checked and is **benign** — one project files several distinct application types at one parcel
  (VUE PHASE III → SDR1 · ZON1 · GPA1 · MOD1). No change warranted.

### ⚠️ Correction — the "~3.5 MB working ceiling" quoted throughout this document is STALE

Measured cache-wide 2026-08-01, the real high-water mark is **19.61 MB (80022, 20,067 records)**, with
ten pages ≥18.6 MB. Earlier corrections in this file (3.5 MB → "Cleveland 44127 at 5.98 MB") are also
superseded. **Measure with `length(sites::text)`, not `pg_column_size(sites)`** — the latter reports
1.93 MB for those same rows because of TOAST compression, and the ceiling is a *transfer* figure.

## COVERAGE-EXTENSION PASS #2 (2026-08-02)

A second iteration of the straddling-city ranking, run because **the first pass changed its own
input**: 108 newly-lit pages create centroids that were not in the `lit` set when the ranking was
first computed, so seams open that did not exist before. Config only — `jurisdiction-registry.json`,
7 lines' worth of `coverage` objects, no connector or engine change.

**Method fix worth keeping: the `cov` table is now GENERATED FROM the registry, not hand-typed.**
The first pass used a literal `VALUES` list, which is a snapshot that silently goes stale the moment
an extension merges. Generating it from `jurisdiction-registry.json` means the ranking always reflects
what is actually deployed — and it is what surfaced the ~12 pairs below, none of which the first pass
had probed.

### Wired — 7 extensions, 22 pages, 4,224 records (measured after the refresh, not predicted)

| entry | coverage added | pages | records | in-envelope | control |
|---|---|---|---|---|---|
| `charleston-county-permits` | SC Berkeley | 4 | 2,007 | 2,046 | 2,296 |
| `johns-creek-building-permits` | GA Gwinnett | 2 | 964 | 1,224 | 3,158 |
| `canyon-county-building-permits` | ID Ada | 4 | 717 | 789 | 942 |
| `dekalb-county-building-permits` | GA Henry | 2 | 221 | 249 | 14,409 |
| `fairfax-recent-building-permits` | VA Prince William | 6 | 126 | 129 | 79 |
| `kent-county-de-building-permits` | MD Queen Anne's | 2 | 104 | 104 | 251 |
| `boone-county-ky-planning-board-actions` | OH Hamilton | 2 | 85 | 94 | 759 |

Largest resulting page **1.18 MB** (29486) — nowhere near any ceiling.

**Invariants across all 170,539 records these seven sources place cache-wide:
0 missing `record_url`, 0 point-scope records without coordinates, 0 unclassified.**

**Bidirectional gate proof, live receipts.** Each source appears in its declared counties and
nowhere else — e.g. `charleston-county-permits` → Charleston 25 pages / 19,577 + Berkeley 4 / 2,007
and no third county; `boone-county-ky-planning-board-actions` → Boone KY 8 / 1,438 + Hamilton OH
2 / 85; `fairfax-recent-building-permits` → Fairfax 47 / 17,641 + Arlington 11 / 1,365 +
Prince William 6 / 126.

### Rejections with receipts — do not re-probe

Every control below returned non-zero **in the same batch as the zeros**, so no zero here is a
broken query shape.

| candidate | receipt |
|---|---|
| `minneapolis-ccs-permits` → MN Dakota | 1 of 8 ZIPs non-zero (55120 = 125), control 55407 = **8,213** |
| `kenton-county-devtracking-permits` → OH Hamilton | 1 of 8 (45051 = 231), control 41011 = **923** |
| `pierce-county-pals-permits` → WA Thurston | 1 of 6 (98348 = **2,181**), control 98444 = **82,773** |
| `weld-county-site-plan-review` → CO Larimer | 1 of 3 (80534 = 11), control 80631 = **127** |
| `stamford-major-developments` → NY Westchester | 0 of 2, control 06901 = **44** |
| `cleveland-issued-building-permits` → OH Summit | 0 of 3, control 44127 = **4,518** |
| `denver-residential-construction-permits` → CO Douglas | 0 of 3, control 80211 = **1,014** |

⚠️ **Pierce → Thurston is the rejection to understand rather than revisit.** 98348 alone returns
**2,181** in-envelope records — by volume it is the second-biggest opportunity in this batch. It is
rejected because 1-of-6 is the same shape as the already-rejected `pierce → King`, and applying the
rule only when the volume is small would make the rule meaningless. If the bar is ever changed, change
it deliberately and re-probe both together.

### Two things this pass confirms about method

1. **An envelope count sizes a candidate set; the stored result is a different number.** Predicted
   4,635 across the seven, stored **4,224** — an 9% overshoot, with the gap concentrated where status
   or type mapping drops rows (29492: envelope 10 → stored 5). Close enough to trust the ranking,
   never close enough to report without measuring.
2. **Check for an existing entry on the target county BEFORE editing** (the Salem-duplicate rule,
   extended from "same URL host" to "same county"). Two of these seven targets were already covered —
   GA Gwinnett by `dekalb-county-building-permits`, OH Hamilton by `cincinnati-building-permits` — and
   both were fine, because the incumbent leaves the probed ZIPs dark and the new source is a different
   jurisdiction's records. Fine is the conclusion of the check, not a reason to skip it.

### ⚠️ A coverage extension's yield is NOT measurable at merge time — pass #1 was understated by 10 pages / 9,668 records

Found while sweeping the counties pass #2 had just touched: three Gwinnett pages lit up carrying
`dekalb-county-building-permits` records — an extension wired in **pass #1**, not pass #2. Those pages
had simply never been re-cached after that pass's deploy, so its report was written against a cache
that predated its own change.

Measured properly: **96 dark ZIPs across pass #1's target counties were last refreshed BEFORE that
pass's deploy** (`refreshed_at < 2026-08-01 18:18`, the `deploy-edge-functions` run) and had therefore
never been evaluated against the coverage it added. Re-firing all 96 lit **10 more pages carrying
9,668 records**:

| county | extension | pages gained | records |
|---|---|---|---|
| GA Fulton | `dekalb-county-building-permits` | 5 (30354, 30342, 30334, 30363, 30332) | 5,458 |
| CO Douglas | `aurora-building-permits` | 1 (80138) | 2,307 |
| GA Gwinnett | `dekalb-county-building-permits` | 3 (30071, 30093, 30078) | 1,884 |
| IN Lake | `chicago-building-permits` | 1 (46394) | 19 |

**Two of pass #1's entries change character entirely.** They were recorded as the two most marginal
wirings in the batch:

| entry | pass #1 recorded | actually |
|---|---|---|
| `chicago-building-permits` → IN Lake | 1 page, **1 record** | 2 pages, **20 records** |
| `aurora-building-permits` → CO Douglas | 1 page, **342 records** | 2 pages, **2,649 records** |
| `dekalb-county-building-permits` → GA Fulton + Gwinnett | 16 pages, 16,105 | **25 pages, 23,490** |
| `new-castle-county-permits` → PA Delaware + Chester | 5 pages, 41 | **15 pages, 174** |
| `minneapolis-ccs-permits` → MN Ramsey | 3 pages, 1,156 | **6 pages, 1,951** |
| `new-orleans-permits` → LA Jefferson | 5 pages, 701 | **6 pages, 912** |
| `overland-park-building-permits` → KS Wyandotte | 8 pages, 1,932 | 8 pages, **1,981** |

The rest (KCMO, Durham, Huntsville, Kenton, Fairfax→Arlington, Albuquerque, Denver→Jefferson) were
already fully measured and are unchanged.

**The standing answer:** after wiring a coverage extension, deploying is not the last step and
re-caching the *probed* ZIPs is not either. **Re-cache every still-dark ZIP in the target county whose
`refreshed_at` predates the deploy, then measure.** Otherwise the pass reports whatever fraction the
cron happened to have refreshed since — which is why the two extensions that looked least worth having
were the two most understated. Note this cuts one way only: it understates yield, and it never affects
a *rejection*, because rejections are probed live against the endpoint rather than read from cache.

**Consolidated invariants after both passes** — across all 817,346 records that the 21 sources touched
by pass #1 and pass #2 place over 675 pages: **0 missing `record_url`, 0 point-scope records without
coordinates, 0 unclassified.** Largest newly-lit page 2.06 MB (80138).

**Pass #2 final, fully measured** (was 22 pages / 4,224 before its own county sweep): **25 pages,
4,296 records** — `charleston → SC Berkeley` 5/2,033 · `johns-creek → GA Gwinnett` 2/964 ·
`canyon → ID Ada` 4/717 · `dekalb → GA Henry` 2/221 · `boone → OH Hamilton` 4/131 ·
`fairfax-recent → VA Prince William` 6/126 · `kent-de → MD Queen Anne's` 2/104.

#### The re-cache obligation attaches to a COVERAGE CHANGE, not to cache age — measured

The finding above could have been read as "the cache is generally under-lit and every stale dark page
is hiding records." It is not, and the difference matters because the wide reading implies a
1,762-page sweep that nobody needs to run.

Tested it as a stated hypothesis. **Sample: 200 dark pages in counties NEITHER pass touched**, all
with `refreshed_at` older than the pass-#1 deploy — i.e. stale in exactly the same way, but with
coverage that never changed. Re-fired all 200 through the live engine.

**Result: 193 of 200 were rewritten, and 0 lit up.**

Against the same method on counties whose coverage *did* change: **10 of 96** (pass #1) and **6 of 97**
(pass #2). Same query, same fire path, same collect — so the method demonstrably detects a newly-lit
page, and its silence here is a real negative rather than an instrument that did not run.

**Conclusion: general cache staleness hides nothing.** A dark page stays dark until the *config* that
governs it changes. So the standing answer is narrower and cheaper than it first appeared — re-cache
the target county after a coverage change, and leave the rest of the cache to the cron.

⚠️ **One process note from this measurement, because it nearly became a false clean.** The first
attempt filtered on `refreshed_at > '2026-08-02 01:50'` when the clock read **01:44** — a threshold in
the future. It returned `0 lit_up`, which is exactly the answer the hypothesis predicted, and it was an
artifact of a wrong filter rather than a result. It was caught only by pairing the zero with a control
(`max(refreshed_at)` and a row count in the same window) before believing it. **A zero that agrees with
your hypothesis is the most dangerous zero there is.**

(7 of the 200 were not rewritten — their responses did not land in the collect window. Not the transient
guard, which cannot apply to a page whose cached development count is 0. Reported as 193 measured
rather than 200, so the denominator is the one actually observed.)

## NATIVE-ZIP PASS (2026-08-02) — asking each layer which ZIPs it holds

A third seam, and a different method from the two envelope passes. Those only reach entries with
`spatial_zip_radius_mi`; **57 registry entries scope by native ZIP instead**, and for those the layer
itself can name the ZIPs it holds — no proximity heuristic. Queried `returnDistinctValues` on all 31
ArcGIS native-ZIP entries, mapped the returned ZIPs to modelled pages, kept those whose county the
entry does not declare, then measured each candidate.

### Wired — 6 pairs across 4 entries, **11 pages / 1,503 records** (measured after deploy + re-cache)

| entry | coverage added | pages | records |
|---|---|---|---|
| `columbus-building-permits` | OH Delaware | 4 | 1,095 |
| `nashville-building-permits-issued` | TN Williamson | 3 | 157 |
| `spokane-county-building-planning-permits` | WA Stevens | 1 | 141 |
| `nashville-building-permits-issued` | TN Wilson | 1 | 54 |
| `coconino-county-permits` | AZ Yavapai | 1 | 44 |
| `nashville-building-permits-issued` | TN Rutherford | 1 | 12 |

Each is real geography: Columbus city limits genuinely extend into Delaware County (Polaris 43240 =
491 records, Powell 43065, Lewis Center 43035); Brentwood 37027 and Nolensville 37135 straddle
Davidson/Williamson; 99026 is unincorporated Spokane County land lying in Stevens; Sedona 86336
straddles Coconino/Yavapai. Invariants across all 59,761 records these four entries place over 130
pages: **0 missing `record_url`, 0 point-scope without coordinates, 0 unclassified.**

### ⚠️ A distinct ZIP value is a LEAD, not coverage — the mailing-address class

The decisive rejections, and the reason this method needs a second gate:

| candidate | records in scope |
|---|---|
| `tempe-building-permits` → CA Contra Costa 94804 | **1** |
| `coconino-county-permits` → AZ Yuma 85364 | **1** |
| `coconino-county-permits` → AZ Mohave 86409 | **1** |
| `detroit-building-permits` → MI Oakland 48220 | **3** |
| `louisville-active-construction-permits` → KY Oldham (3 ZIPs) | **8** |
| `tacoma-accela-permits` → WA King 98034 | **9** |

An Arizona city's permit layer carrying a **California** ZIP is an owner mailing address or a typo,
not a building. Wiring these would place records on pages where nothing is being built — the
`las-vegas-building-permits` defect class. **The discriminator is record count in the connector's own
scope plus geographic plausibility, never the presence of the value.** A handful of rows in a distant
county is noise; hundreds in an adjacent one is a city that straddles a county line.

### ⚠️ THREE hypotheses, two falsified, and the answer was in this file the whole time

`coconino → AZ Yavapai` was predicted at **1,492 records over 2 pages** and delivered **44 over 1**.
Worth recording how that was chased, because two plausible explanations were wrong:

1. **"The page clips to `ZIP_RADIUS_MI` (3 mi)."** Falsified — 86336's stored records span up to
   **15.21 mi** from the ZIP centroid (mean 8.17). There is no radius clip on a native-ZIP entry.
2. **"My probe used `LIKE '86336%'`, the connector uses `=`."** Falsified — exact equality also
   returns **1,487**, and `86336` is the only variant of that value in the column.
3. **The actual cause: I probed OUTSIDE the connector's scope while claiming I was inside it.** The
   entry carries `recency_days: 365` **and** a substantial `extra_where` (department whitelist +
   PermitTypeCode exclusions). I noted "coconino: no recency in entry" — which was simply wrong — and
   omitted both. **In the entry's own scope 86336 holds 146 rows, not 1,487**, and 44 published after
   status bucketing.

**The 146 was already written in this entry's own `_receipts` field, by the previous pass, one day
earlier:** *"In the entry's OWN scope (department whitelist + recency_days 365) the ZIP histogram is
… 86336 146 …"*. It was re-derived wrongly instead of read. That is exactly the failure CLAUDE.md
describes — a receipt-carrying doc is *the first place to look and the last place to trust*, and
skipping the look is the same error as over-trusting it. **Read the entry's `_receipts` before
probing that entry.**

The wiring decision itself stands on the corrected number: 146 in-scope rows is real Coconino County
permit activity in a ZIP that genuinely straddles the county line, and the page went 0 → 44. Only the
predicted figure was wrong. 86337 was predicted as a second page and is correctly dark — it does not
appear in the in-scope histogram at all.

### Operational note — post-deploy cold starts

The first re-cache produced **6 × `503 BOOT_ERROR`** plus 1 timeout out of 72 fires, landing four
minutes after the `deploy-edge-functions` run. Those pages read as dark while being merely pending:
`last_refresh_attempt_at` had advanced but `refreshed_at` had not. Re-firing them recovered all four
(43035, 43065, 37064 lit; 86337 genuinely empty). **After a deploy, check the fire/collect result
counts before concluding a page is dark** — 65 of 72 succeeded, and the 7 failures were exactly the
pages that looked like misses.

### Native-ZIP pass, second half — the groupBy retry (3 more pairs, 5 pages / 1,796 records)

Ten ArcGIS native-ZIP entries could not answer `returnDistinctValues` — 8 rejected it outright, and 2
(**Bellevue**, **Baltimore County**) *ignored* it and returned a full page of raw rows, which is the
dangerous failure: it looks like an answer. Retried all ten with **groupBy statistics**, which both
works on those servers and returns counts directly. Eight answered; Bellevue ignored the aggregation
too and remains unresolved by this method.

| entry | coverage added | pages | records | max page |
|---|---|---|---|---|
| `little-rock-permits` | AR Saline | 2 | 1,782 | 0.78 MB |
| `baltimore-county-permits` | MD Harford | 1 | 8 | 0.01 MB |
| `baltimore-county-permits` | MD Howard | 2 | 6 | 0.01 MB |

All straddle the relevant county line (Alexander/Mabelvale across Pulaski/Saline; Whiteford,
Marriottsville and Woodstock bordering Baltimore County). 21043 Ellicott City had 16 in-window rows and
published none — its rows do not survive the entry's own type/status filters. Invariants across all
51,266 records these two entries place over 63 pages: **0 missing `record_url`, 0 point-scope without
coordinates, 0 unclassified.**

Rejected: `gilbert-energov-permits` → AZ Yavapai 85324, **2 rows**, ~80 miles from Gilbert — the
owner-mailing-address class.

#### ✅ A size oracle that works: calibrate against the source's OWN cached pages

`little-rock-permits` carries **no `recency_days`**, so 72002's 10,601 lifetime rows looked like the
~19 MB page that had to be reverted in pass #1. Rather than guess or wire-and-hope, the ratio was
measured on pages that source already serves: **72223 stores 6,033 of 45,585 in-window rows and weighs
5.13 MB** — 13% survive, 0.87 KB each, because `status_to_bucket` publishes only 2 of its statuses and
fail-closes the rest. That predicted **~1,730 records / ~1.1 MB**; the actual is **1,782 / 0.78 MB**.

**A raw row count is a terrible size oracle; an existing page of the same source is a good one.** Use
it before wiring any entry whose row counts look alarming — it costs one query and it is the
difference between shipping and reverting.

#### ⚠️ A wrong extraction manufactured a cross-country coverage claim

The first parse of these groupBy results reported **`little-rock-permits` → NY Westchester**. It was an
artifact, twice over: Baltimore County aliases the count column **`N`** and Little Rock **`n`**, so a
case-sensitive `key='n'` lookup found nothing; and the fallback — "take the first attribute that looks
like a 5-digit ZIP" — read Little Rock's **count of 10601** as a ZIP, which matched a real modelled
Westchester page.

Nothing in the output looked malformed. It was caught only because *Little Rock permits in Westchester,
New York* is absurd on its face. **Key the extraction on the groupBy column name, case-insensitively —
never on value shape.** A count and a ZIP are both five digits.

### Native-ZIP pass, Socrata half — 1 wire, and a modelling defect worth fixing separately

Ran the same "ask the layer which ZIPs it holds" method against the 15 Socrata native-ZIP entries
(SoQL `$group` on the ZIP column, each entry's own recency window). 14 answered.
`nyc-dob-permit-issuance` returned 0 groups against a **guessed** date column (`issuance_date`) — that
is an unverified probe, not a finding, and the entry stays unprobed rather than being recorded as empty.

**Wired: `nyc-dobnow-approved-permits` → NY Nassau — 2 pages, 130 in-scope records**
(11001 Floral Park = 93, 11040 New Hyde Park = 37, measured with the entry's own
`work_type` whitelist and 365-day window). Both ZIPs straddle the Queens/Nassau line, so these are NYC
properties inside a ZIP that contains NYC blocks — the same legitimacy as Columbus → Delaware and
Sedona → Yavapai.

#### ⚠️ DECLINED: `nyc-dobnow` → NY Westchester — because ZIP 10470 is modelled in the wrong county

10470 (Woodlawn) carries **79 in-scope NYC DOB permits** and is a **Bronx** ZIP. This repo already
knows that: the NYC borough expansion deliberately excluded it — *"10470 excluded — already live under
Westchester via the Census crosswalk"* — so its page is parented to **Westchester**.

The coverage gate is **county-granular**, so there is no way to license those 79 real Bronx records
onto 10470 without simultaneously licensing NYC DOB onto every Westchester page — including **10803
Pelham Manor (8 records)**, where NYC DOB has no jurisdiction at all and the rows are data-entry
artifacts. That would put records on a page where nothing is being built, which is the exact defect
class this pass has been rejecting.

**The right fix is to re-parent 10470 from Westchester to Bronx**, after which the existing borough
coverage lights it with no registry change at all. That is a `communities` change and it alters what
residents see, so it is **gated — recommended, not done.** Recorded here so the next session finds the
diagnosis rather than re-deriving it, and so nobody "fixes" it by widening the coverage gate.

#### Declined: `marin-county-building-permits` → CA Sonoma

94952 (Petaluma) returns **8** records in the entry's own scope, against a control of 19 on 94901, a
real Marin ZIP. Petaluma is Sonoma's, Marin County has no permit jurisdiction there, and 8 rows is the
mailing-address noise class.

## 🔴 DEFECT: `nyc-dob-permit-issuance` HAS NEVER PLACED A RECORD — its recency clause cannot match

Found while probing the Socrata native-ZIP entries. **This entry is wired across all five NYC boroughs,
is documented as a live New York source, and places 0 records cache-wide.**

The cause is a type mismatch that fails silently. `sources/socrata.ts::buildWhere` emits
`${dateCol} > '${cutoff}T00:00:00'` from `recency_days`, but this dataset's `issuance_date` is **text in
MM/DD/YYYY**, so the comparison is lexicographic and every value begins with `0` or `1` — always less
than `'2025-…'`. Nothing can ever match. Live proof, three counts on ZIP 11214:

| query | rows |
|---|---|
| `upper(zip_code)='11214'` (control) | **23,761** |
| `… AND issuance_date > '2025-08-02T00:00:00'` (the connector's exact clause) | **0** |
| `… AND issuance_date > '08/02/2025'` (string compare in the column's own format) | 9,893 |

and the cache agrees: `nyc-dobnow-approved-permits` holds 62,388 records over 213 pages while
`nyc-dob-permit-issuance` holds **none**.

**Consequence for a recorded coverage claim.** The NEW YORK WIRE PASS credits both entries with
"210 of 764 ZIPs dev-backed (27%), 66,006 dev records", and describes this dataset as *"still updates
daily for pre-DOB-NOW jobs"*. In fact **every one of those records comes from DOB NOW**, and the entire
BIS-legacy corpus — the pre-2021 jobs DOB NOW does not carry — has never reached a page.

**Audited for blast radius: it is ONE entry, not a class.** All 19 Socrata entries carrying
`recency_days` were sampled for their `file_date` value format. 18 return ISO
(`2025-01-30T00:00:00.000`); only `nyc-dob-permit-issuance` returns `06/17/2020`. Three first-row nulls
(`nyc-dobnow`, both Seattle entries) were **re-probed with `IS NOT NULL` rather than assumed**, and all
three place records in production (62,388 / 5,843 / 331), so their columns work.

**FIXED 2026-08-02 (founder-authorised).** Each candidate repair was measured, not assumed:

| option | verdict |
|---|---|
| (a) use a genuine timestamp column — `dobrundate` is the dataset's only `calendar_date` | **REJECTED.** It is a DOB re-export stamp, not a permit date: **23,212 of 23,761** rows for ZIP 11214 pass `dobrundate > cutoff`. It does not discriminate by permit age at all. |
| (b) freeze the window into `extra_where` as a literal | **REJECTED.** SoQL `substring` + `||` do work (proven below), but an `extra_where` literal is fixed at author time and **silently ages** — a one-year window becomes a six-year window with nothing failing. That is the same class of defect as the one being repaired. |
| (c) drop `recency_days` | **REJECTED.** 11214 alone holds 23,761 lifetime rows. |
| **(d) `recency_expr` — a verbatim predicate whose cutoff is substituted at REQUEST time** | **ADOPTED.** |

The fix is one additive optional field on the socrata connector, `recency_expr`, plus one line in the
registry entry. Entries that do not set it are byte-identical to before. The entry now carries:

```
(substring(issuance_date,7,4)||substring(issuance_date,1,2)||substring(issuance_date,4,2)) >= '{cutoff_compact}'
```

`{cutoff_compact}` is computed from `recency_days` on every request, so **the window keeps rolling** —
that is the whole reason it lives here and not in `extra_where`. Live receipts for ZIP 11214: the
expression returns **391** rows at `>= '20250802'` (vs 437 for the coarser year-only form, correctly
fewer), and **113** in the entry's full scope with its `permit_type` whitelist. Citywide in full scope:
**17,977** records across ~213 pages ≈ 85/page — for comparison `nyc-dobnow` carries 293/page, so this
is well inside the size envelope.

Pinned by `test/socrata-text-date-recency.test.ts`, which **demonstrates the defect first** (the default
path still emits the unmatchable ISO literal) and then proves the fix, that the broken comparison is
gone rather than merely accompanied, that non-opted-in entries are unchanged, and that a blank
`recency_expr` falls back to the default clause rather than silently dropping the window.

### Wired: `philadelphia-li-permits` → PA Montgomery + PA Delaware

The Philadelphia twin of the 10470 problem — and unlike 10470, this one is **safe to wire**, which is
why the two are recorded together. ZIPs **19118** (Chestnut Hill), **19128** (Roxborough) and **19153**
(Eastwick) are physically Philadelphia but modelled under Montgomery/Delaware by the Census crosswalk;
this repo already records that (*"19118/19128 stay Montgomery, 19153 Delaware — Census crosswalk,
most-specific wins"*).

The difference from the NYC case is measured, not assumed: **of every ZIP in Montgomery, Delaware, Bucks
and Chester counties, exactly three appear in Philadelphia's L&I dataset — and all three are those
Philadelphia neighbourhoods.** There is no Pelham-Manor-equivalent, so licensing those two counties
licenses the three real ZIPs and nothing else.

In the entry's own scope (`permittype`/`typeofwork` whitelists + 365 days): **19128 = 198, 19118 = 120,
19153 = 79**, with already-lit Philadelphia ZIPs as magnitude controls in the same query (19119 = 204,
19116 = 100, 19154 = 82).

### Unresolved by this method

- **`bellevue-permits`** — its server ignores `returnDistinctValues` *and* `groupByFieldsForStatistics`
  (returns a full 2,000-row page in both cases, HTTP 200). No aggregation path; the ZIP inventory cannot
  be obtained this way. Low risk regardless — a single city inside its declared county.
- **Boston / Pittsburgh (CKAN) and Shelby (ODS)** answered, and produced **no** out-of-county ZIP on a
  modelled dark page.

---

## ⚠️ A TABLE'S MEANING DRIFTED WHEN A SECOND WRITER STARTED USING IT — 5,734 PAGES OVERSTATED (2026-08-02)

**The most valuable finding of the 2026-08-02 session, and it was on no list.** It was found by chasing
the last failing assertion in `verify-coverage-state` rather than by looking for it.

### What broke

`app_coverage_states` classifies every ZIP page's coverage. Its `populated` branch reads
`dev_markers > 0 OR app_changes > 0`, and at the Phase-2 rollout that definition was verified **byte-for-byte
identical** to the legacy gate `app_community_meta.data_quality` — `legacy1 = legacy2 = 0` over the full
population (`docs/coverage-state-model.sql`).

It could be identical because `app_changes` then held **only civic rows**: `'Government & civic'` and
`'Planning & zoning'` — exactly the set `app_refresh_zip` counts into `_nc` when it stamps `data_quality`.

Then **Local News began materializing into the same table** — 79,424 rows across 9,796 ZIPs. The view
counted that table with **no category filter**. Nothing was edited; nothing failed; the *meaning of the
table changed underneath a reader that was never told.*

### Measured cost (full population, 12,722)

| class | ZIPs | reported | actual |
|---|---|---|---|
| EPA facility floor + news, no development, no civic notices | **5,072** | `populated` | `facilities_only` |
| news and nothing else — zero markers of any kind | **662** | `populated` | `honestly_empty` |

**5,734 pages carried an overstated coverage state.** The resident-visible half is the worse half:
`facilities_only` is the state that renders *"Local government meeting and permit feeds for this area are
still being wired — the EPA-registered facility records below are live public data."* **5,072 residents
were denied that banner** — the one piece of copy that tells them their page is the national EPA floor
rather than real local coverage. The 662 are the ones that made CI red daily, which is the only reason
any of it was found.

**The materializer never drifted.** It counts `_nc` *before* the Local News insert, so `data_quality` has
always been civic-only **by construction**. That asymmetry is why exactly one assertion failed — and why
the instinct to "fix the failing assertion" would have been exactly backwards.

### The fix

`changes` counts civic rows only; `news_items` is reported **additively**, so the news is visible in the
instrument rather than hidden behind the narrower count. Migration
`app_coverage_state_view_civic_changes`. Verified live: all eight invariants 0, including
`legacy1 = legacy2 = 0`. Distribution `populated 5,020 · facilities_only 6,769 · honestly_empty 924`
(was `10,754 / 1,697 / 262`). Pinned by `test/coverage-state-news-not-coverage.test.mjs` — 14 assertions
including a self-test that feeds the classifier the pre-fix unfiltered count and requires the **wrong**
verdict, so a green run proves the narrowing does something.

### 🔴 THE GENERAL RULE — A SHARED TABLE IS AN INTERFACE, AND A NEW WRITER CHANGES IT

> **When a second writer starts putting a new kind of row into an existing table, every reader of that
> table has silently had its question changed. Find them and update them in the same change.**

This class is dangerous precisely because **nothing breaks**: no error, no failed migration, no red
build. Both writers are correct in isolation, and the reader's code is unchanged and still runs. What
changed is what the rows *mean*. The defect surfaces only as numbers that are quietly wrong, and it can
survive indefinitely because a wrong-but-plausible count reads exactly like a right one.

**Operationally, before adding a new row-kind to a shared table:**
1. **Enumerate the readers** — `grep` the table name across views, RPCs, materializers, verifiers and
   front-end queries. A view that aggregates it with no category filter is the signature.
2. **Ask each one whether its question still means the same thing.** "Does this reader want the new rows
   counted?" — a reader that wants them is fine; a reader that is merely *silent* about them is the bug.
3. **Prefer a narrowing filter over a widening one**, and report the excluded set additively (here,
   `news_items`) so the new rows stay visible rather than disappearing behind the fix.
4. **Re-run the equivalence that was true at rollout.** Every cross-definition invariant that once
   measured 0 — here `legacy1`/`legacy2` — is a tripwire for exactly this class. If a doc records "these
   two definitions were verified identical", that is a check to re-run, not a fact to trust.

*Two writers, one table, one reader nobody updated — and 5,072 residents told they had coverage they did
not have.*

---

## ⛔ VENDOR-PATTERN PROBING IS A CLOSED QUESTION — DO NOT RE-RUN IT (2026-08-02)

**Result: 56 Pattern-A roots probed, 4 resolved (7.1 %), 0 wireable (0 %). Zero pages gained.**
Run against the four biggest dark counties — NY Suffolk (all ten Long Island towns), CA Orange,
IL Cook, PA Allegheny. Recorded here so no future session pays for it again.

**The patterns, from all 12 working permit entries:** 7 are jurisdiction-hosted ArcGIS on the
jurisdiction's own domain (`{maps|mapdata|gis}.<domain>/{arcgis|gis|server|pub}/rest/services`) — the
only probe-able shape; 4 are ArcGIS Online orgs behind a **22-char opaque orgId**; 1 is an EnerGov
proxy behind a **32-hex id**. The last two cannot be derived from a jurisdiction name, so they are
reachable only by discovery.

⚠️ **"Accela" and "EnerGov" are NOT URL patterns, and there is no per-vendor hit rate.** They are the
upstream permitting SYSTEMS. What this registry reads is each jurisdiction's own ArcGIS
**republication** of them, and those service names share nothing: `accela_permit_data`,
`Building_Permits`, `PermitsCode`, `Growth_Development_Tables_1`, `External_Planning_and_Zoning`,
`Planning_Permit`, `ConstructionActivity_Public`, `OpenData_Tabular`, `ActiveDevelopment`.

### 🔴 THE FINDING THAT MATTERS: publishes-NOTHING and publishes-PRIVATELY are different frontiers

**Do not read "the pattern failed" as "the data is not there."** Two of the four live roots had the
data sitting exactly where the pattern predicted, and would not serve it:

| root | what the pattern found | verdict |
|---|---|---|
| `gis.cityoffullerton.com` (CA Orange) | an **`EnerGov` folder** | **access-denied** — HTTP 499 `Token Required` |
| `gis.schaumburg.com` (IL Cook) | a **`CommunityDevelopment` folder** (22 folders listed publicly) | **access-denied** — 499 |
| `gis.huntingtonbeachca.gov` (CA Orange) | `Planning` + `Property` enumerated completely | **enumerated** — no permit layer exists |
| `gis.ehamptonny.gov` (NY Suffolk) | `Hosted` holds one service, `BasicTownPolygon` | **enumerated** — nothing public |

Suffolk County's own `Applications` folder fails the same way (499). **Pattern probing cannot reach
the access-denied class at all** — the URL is right, the folder is right, and the server simply
refuses anonymously. A future session that sees this 0 % and concludes "these cities publish nothing"
would be drawing the wrong lesson from the right number. The unlock for that class is a credential or
an open-data request, not a better URL.

### ⚠️ EVERY REJECTION MUST STATE ITS BASIS — enumeration, access-denied, or unreachable

Three distinct verdicts, and only the first two are conclusive:

- **enumerated** — the folder/dataset list was READ and the layer is absent. Conclusive.
- **access-denied** — it exists and is token-gated (HTTP 499 / 403). Conclusive *for anonymous
  access*, and a live lead for any other route.
- **unreachable** — DNS failure, timeout, or a guessed hostname 404. **Provisional, not a verdict.**

"Not found" without one of those three is **not a rejection; it is an un-run probe.** This rule has
now caught **three** false rejections in two sessions:
1. **Suffolk County NY** — filed "no portals found"; its server is live at ArcGIS 11.4 and simply
   carries no permit layer (now *enumerated*).
2. **OCPW / CA Orange** — filed as a timeout; it returns **933 datasets** when probed at 25 s.
3. **Frisco TX** — the "dead host" was a search-result host failing DNS while the real server was
   reachable through the city's own web map.
…and the author of the rule broke it **one message after writing it**, guessing three dataset ids on
the first reprobe pass instead of reading them out of this document. Read the recorded identifier.

> **Standing answer: pg_net's 5 s default timeout is short enough to make a live host look dead.**
> Hub/DCAT feeds are large documents — probe them at **≥20 s** before recording any verdict. Note the
> corollary: an ArcGIS hub **404 `Domain record(s) not found`** is NOT a timeout and a longer timeout
> cannot change it — that hostname is genuinely unregistered, so the retry belongs against the
> jurisdiction's real GIS host, not the same guessed hub subdomain.

---

## 🔑 DEPTH IS NOT COVERAGE — how to value a reprobe hit before you spend on one

**The single most useful thing learned in the 2026-08-02/03 pass, and it changes how the whole reprobe
seam should be valued.**

> **A revival DEEPENS pages that a statewide source has already lit. It only LIFTS pages that nothing
> reaches. Those are different outcomes and they must be estimated separately.**

**The case.** `worcester-building-permits` came back from the reprobe list and was wired — a real hit,
7,191 records across 9 city ZIPs, all invariants clean. **It lifted zero pages.** All 99 Worcester
County pages were **already** dev-backed before the wire, every one carrying 270–404 records from
`massdot-highway-projects`, the STATEWIDE MassDOT layer. What changed is *what those pages show*:
01604 went from 375 highway-project records to 1,936, of which 1,561 are actual city building permits.
A resident of 01604 previously saw state road works and now sees construction on their street. That is
a large quality gain and a **zero** coverage-percentage gain.

**Why this is easy to get wrong.** The recon note said *"Lift: 15 modeled Worcester ZIPs if usable"*,
which reads as a page lift. It was written before a statewide source existed for MA. Only the
**pre-mutation baseline** exposed it — measuring after the re-cache would have shown 9 newly-rich pages
and invited the claim that 9 pages were lifted.

**The valuation rule, for estimating any future reprobe or wire:**

1. **First ask whether a STATEWIDE source already covers the target.** MA has MassDOT; UT has UDOT; TX
   has TxDOT; NV has NDOT. If one does, the candidate buys **depth only** — count it as quality, not
   coverage, and do not put it in a page-lift forecast.
2. **A page-lift forecast is only valid where the target pages are genuinely dark** — i.e. `0` rows in
   `app_projects` with a `source_ref`, not merely "no city source wired".
3. **Both are worth doing.** Depth is not a lesser outcome — highway projects are not what a resident
   asking "what is being built near me" wants. But it must be *named* correctly, or the seam's value
   gets measured against the wrong denominator.

**Applied to the seam itself:** the reprobe list was **1 hit in 3** on its first run (Worcester
revived; St. Paul still stalled at 2025-06-30, Syracuse at 2025-08-16, KCMO at `applieddate`
2025-05-09). That one hit bought **quality on 9 pages and coverage on 0**. Any estimate of what the
remaining reprobe candidates are worth should carry that caveat attached — the seam is cheap and it
works, but on current evidence it mostly deepens rather than lifts.

---

## ✅ DELAWARE COUNTY PA — GO-LIVE MEASURED: 29 dark pages → 0. A real page lift, not depth (2026-08-03)

The first candidate valued under the DEPTH-IS-NOT-COVERAGE rule above, and the first to pass it: PA has
**no statewide DOT-style source** in the registry, so the baseline was taken BEFORE the re-cache and the
29 dark pages were confirmed genuinely dark (`0` rows in `app_projects` carrying any `source_ref`).

**Baseline → after** (`app_projects`, materialized, keyed on the exact `source_ref`
`https://www.delcopa.gov/planning/` — never a name or domain pattern):

| | before | after |
|---|---|---|
| Delaware County PA ZIP pages | 40 | 40 |
| dev-backed | **11** | **40** |
| dark | **29** | **0** |
| pages carrying the county source | 0 | **40** |
| rows from the county source | 0 | **5,180** (39–197 per page) |

**Anti-fabrication + map-render invariants across all its cached records: 0 missing `record_url`,
0 missing coordinates, 0 non-`point` scope, 0 without a `use_type`.** The polygon `featurePoint()`
shoelace-centroid path carried it — `column_map.lat/lng → __lat/__lng` is what makes that true, and its
absence is the `sussex-county-de-conditional-use` defect (records silently land on the ZIP centroid at
scope `area`). **Bidirectional gate proof:** the entry rides **1 county, 0 pages outside PA/Delaware.**

### Two corrections found while measuring, both worth keeping

1. **THE ENTRY EMITTED ZERO ON ITS FIRST WIRE, AND THE SOURCE WAS NEVER THE PROBLEM.** `status_const` in
   `sources/arcgis.ts` is the **RAW** status value, resolved through `status_to_bucket`
   (`arcgis.ts:300-304`); in `sources/socrata.ts` it **IS** the bucket. The socrata idiom (an all-empty
   map) applied to an arcgis entry leaves the constant unmapped, so every row is excluded — silently.
   Full record under the status_const guard; pinned by `test/status-const-must-be-mapped.test.mjs`.

2. **A RETRY SELECTOR MUST ASK "WHAT DID NOT REFRESH", NOT "WHAT IS STILL DARK".** 3 of 40 fires
   returned 503 (normal cold-start). The retry selected pages with **no sourced sites** — which silently
   skipped **19015**, because border-spill rows from `new-castle-county-permits` made it look non-dark
   while its `refreshed_at` was still four hours stale. A page can be non-dark *and* unrefreshed; those
   are different questions and only `refreshed_at` answers the second. Re-fired on `refreshed_at`,
   19015 returned **186** county records — so the apparent "one page the source genuinely doesn't
   reach" was an artifact of my own selector, and the final state is **40 of 40 pages covered**. The
   wrong selector produced a plausible, almost-right number; only checking `refreshed_at` exposed it.

### `new-castle-county-permits` on PA pages is DECLARED, not a gate leak — do not "fix" it

Its coverage is `[{DE,New Castle},{PA,Delaware},{PA,Chester}]` with `spatial_zip_radius_mi: 5`, so real
New Castle County DE permits within 5 miles of a border ZIP centroid legitimately appear on 10 PA
Delaware and 5 PA Chester pages. **The consequence for planning: Chester County's 5 "dev-backed" pages
are EXACTLY those 5 border-spill ZIPs**, so its other 34 pages have nothing of their own — Chester is a
34-page lift candidate, not a 34-page one with partial cover.

---

## 🎯 CHESTER COUNTY PA — SOURCE FOUND AND ENUMERATED, NOT YET WIRED (2026-08-03)

**34 dark pages of 39** (the other 5 are New Castle border spill, above). Same shape as Delaware — the
county's Act 247 plan-review docket — and found the same way: **the recorded "six county-hub URL guesses
404'd" was an UNREACHABLE-BY-GUESS non-verdict, not an enumerated rejection.** Nine further hostname
guesses (`gis.chesco.org`, `arcgis.chesco.org`, `maps.chesco.org`, `gis.co.lancaster.pa.us`,
`gis.lancastercountypa.gov`, `maps.lancastercountypa.gov`, `gis.centrecountypa.gov` ×2,
`maps.centrecountypa.gov`) **all failed DNS — recorded as guesses, and NOT as rejections.** The real host
came from the county's own published GIS hub instead.

**Host:** `gisprodops.chesco.org` (ArcGIS 11.3) · **service:**
`/server/rest/services/Planning_Services/Plan_Act247_AGOL_D/MapServer` · copyright
`Chester County Planning Commission`.

**⚠️ THE MERGED-LAYER TRAP, CLOSED BY ARITHMETIC — WIRE LAYER 5 ONLY.** The service exposes the parts and
their union, and wiring both would double-emit (the `houston-plat-applications` class, uncatchable by
exact-identity dedup across two `source_registry_id`s):

| layer | name | count |
|---|---|---|
| 2 | `PROPOSED_LAND_DEVELOPMENTS` | 1,563 |
| 3 | `PROPOSED_SUBDIVISIONS` | 2,105 |
| 4 | `PROPOSED_CONDITIONAL_USE` | 58 |
| **5** | **`PROPOSED_PLANS_MERGED`** | **3,726** |
| 10 | `Act247_1999_2009` (archive) | 5,471 |

**1,563 + 2,105 + 58 = 3,726 exactly** — layer 5 *is* the union, and the three parts are disjoint and
exhaust it. Positive control closed.

**Liveness, all three parts:** name clean; **entity correct** (the Planning Commission's own Act 247
docket, on the county's own server); **dates fresh** — newest `SUBMIT_DATE` **2026-07-30**
(then 07-28, 07-23).

**Field choices from live non-null counts, not from the schema** (a merged layer populates fields per
subset — the UDOT lesson): `SUBMIT_DATE` **3,726/3,726 (100%)** · `PLAN_TITLE` 3,725 · `PRIMARY_USE`
3,722 · `REVIEW_DATE` 3,708 · `PROJECT_NAME` 3,701. **`SUBMIT_DATE` is a real `esriFieldTypeDate`**, so
unlike Delaware's integer `Year` this carries day precision and `recency_days` applies directly.
Window sizing, measured: **627 rows in 3y · 1,095 in 5y · 2,253 in 10y** of 3,726.

**`PRIMARY_USE` is a closed vocabulary** summing exactly to the layer count: Residential 1,888 ·
Commercial 864 · Institutional 470 · Industrial 280 · Agricultural 220 · null 4 = **3,726**.
Mapping into the CLOSED `use_type` set (`lib/map.js::TYPE_EXACT`): Residential→Residential ·
Commercial→Commercial · Institutional→`Civic/Public` · Industrial→Industrial · **Agricultural→
`Development`** (there is no agricultural member; `Development` is the generic that renders the "Other
project" circle — the Phoenix precedent — rather than forcing it into Industrial) · the 4 nulls carry
**no type at all**, never a guessed one.

**Still to settle before wiring:** no status column → `status_const` (and it MUST be a key in
`status_to_bucket` — see the Delaware defect); polygon geometry → `__lat/__lng`; no ZIP and no address
column → `spatial_zip_radius_mi`; `record_url_precision: "dataset"` — there is no per-plan lookup URL,
and the hub's catalogue separately lists only layer 2, so the honest link for a merged-layer record
needs deciding rather than templating.

**New standing answer: DCAT `modified` is metadata staleness, not data staleness.** Chester's catalogue
entry reads `modified: 2021-08-31` while the layer's newest record is **2026-07-30**. Rejecting on the
catalogue timestamp would have been a false negative on a live, fresh source.

---

## 🎯 YORK COUNTY PA — SOURCE FOUND, LIVE AND FRESH, NOT YET WIRED (2026-08-03)

**47 dark pages of 47** — the largest single-county lift available in PA after Delaware.

**The earlier "York is a real host that does not answer" was the WRONG HOST.** York County has two
GIS estates and only one of them serves planning: `yorkcountypa.gov` (the county portal, which is what
was probed) versus **`arcweb1.ycpc.org` — the York County *Planning Commission*.** The second answers
immediately at a 45 s timeout. Recording the distinction because "the county's host does not answer" is
not the same claim as "the county publishes nothing", and only the second is a rejection.

**Host:** `arcweb1.ycpc.org` (ArcGIS **11.5**) · **layer:**
`/server/rest/services/OPEN_DATA/PLANNING_Subdivisions/FeatureServer/0` ("Subdivisions") ·
**26,879 rows** · **`esriGeometryPoint`** — no centroid derivation needed, unlike Delaware and Chester.

**⚠️ The layer DESCRIPTION is misleading and would have justified a wrong rejection.** It opens *"The
Subdivision GIS Layer represents the geographic boundaries…"*, which reads as a static cadastral layer.
The FIELDS say otherwise — it is a plan-review docket: `DATE_RCVD` (`esriFieldTypeDate`), `PLAN_TITLE`,
plan-type flags `PT_PRELIM` / `PT_FINAL` / `PT_LAND_DEV` / `PT_SUBDIV` / `PT_BLDG_ADD`, use flags
`SF_USE` / `COM_USE` / `IND_USE` / `MF_USE` / `MHP_USE` / `SR_USE` / `AG_USE` / `OTHER_USE`, and
proposal magnitudes `PROP_LOTS` / `PROP_DU` / `PROP_NEW_BLDG_SQFT` / `TOTAL_ACRES`, plus `MCD`
(municipality), `ENGINEER`, `NOTES`, `CONSISTENT`. **Read the schema, not the blurb.**

**Liveness, all three parts:** newest `DATE_RCVD` **2026-07-27** (then 07-20); entity correct (the
Planning Commission's own docket); names are real and specific — *Walmart – Hanover*, *Fairview South
WWTP Expansion*, *Ballpark Commons*, *Glick & Esh*. Window sizing, measured: **727 rows in 3y,
1,267 in 5y** of 26,879 (the bulk is decades of history).

**The wire-design question to settle first — the type is a SET OF FLAGS, not a column.** Use is encoded
as eight independent `YES`/`NO` fields, so `type_map` (which maps one source value) does not apply as-is
and a precedence rule would have to be chosen — e.g. `IND_USE` → Industrial before `COM_USE` →
Commercial before `SF_USE`/`MF_USE` → Residential. That is a real decision with a resident-visible
consequence (`use_type` drives the pin SHAPE), so it is recorded here rather than guessed. Same for
status: there is no status column, so `status_const` applies — and per the Delaware defect it MUST be a
key in `status_to_bucket`. `PT_FINAL` YES/NO is the closest thing to a lifecycle signal and is worth
enumerating before choosing.

### PA county-by-county standing after Delaware (measured from `app_projects`, 2026-08-03)

| county | pages | dev-backed | dark | note |
|---|---|---|---|---|
| Delaware | 40 | **40** | **0** | wired this session |
| Philadelphia | 46 | 45 | 1 | Carto L&I |
| Allegheny | 119 | 27 | 92 | Pittsburgh CKAN; largest remaining |
| Montgomery | 64 | 2 | 62 | |
| Lancaster | 56 | 0 | 56 | host guesses failed DNS — NOT probed |
| Bucks | 50 | 0 | 50 | |
| **York** | **47** | **0** | **47** | **source found, above** |
| Centre | 35 | 0 | 35 | host guesses failed DNS — NOT probed |
| **Chester** | **39** | **5** | **34** | **source found; the 5 are border spill** |
| Dauphin | 30 | 0 | 30 | |
| Lehigh | 34 | 5 | 29 | |

**Lancaster and Centre remain UNPROBED, not rejected** — every hostname tried for them failed DNS, which
is a non-verdict. The Chester and York finds both came from the county's own published hub/planning
host, so that is the route for those two as well.

---

## ⚠️ `san-antonio-prelim-plan-review` — THE status_const FIX WAS REAL BUT IS NOT SUFFICIENT (2026-08-03)

**Do not record this entry as "fixed."** It had TWO independent reasons for emitting nothing, and only
the first is repaired. Correcting my own PR #571 note, which fixed the defect and implied that was all.

1. ✅ **FIXED — the silent-nothing `status_const` defect.** It set `status_const: "proposed"` with an
   all-empty `status_to_bucket` (the socrata idiom in an arcgis entry), so the constant was unmapped and
   every row was excluded. Now `"Scheduled for preliminary plan review"`, present in its own map.

2. 🔴 **STILL ZERO — the source has no rows in either modeled page, and that is an HONEST zero.**
   Re-cached through the deployed fix at **14:07:13Z**, both Bexar pages still return **0** from this
   entry while the same-service control `san-antonio-permits-issued` returns **167** on 78260 — so the
   deploy, the gate and the pages are all fine. The entry scopes on a native `Zip_Code` column, and the
   layer's own `returnDistinctValues` over all 50 rows holds **29 ZIPs: 78023, 78201, 78203, 78204,
   78207, 78209, 78212–78219, 78222, 78224, 78227–78229, 78237, 78242, 78248–78254, 78258, 78259.**
   **78260 and 78261 are not among them** — and those two are the ONLY Bexar ZIP pages we model.

**So this is the `houston-plat-applications` / `harris-county-plats` class: correctly wired, zero
surface.** The unlock is a **Bexar County ZIP expansion** (the NYC-borough / Boston-Suffolk /
Philadelphia-County precedent), not another registry edit. Both modeled Bexar pages sit in far-north
San Antonio while the layer's activity is inner-city and west-side.

**The lesson worth keeping: a fix that removes a KNOWN cause does not prove the symptom is gone.**
Re-measure after the deploy, against a control, before calling it fixed. Had the re-cache not been run,
"defect found and fixed" would have gone into the record while the entry still emitted nothing.

---

## PA REPROBE PASS 3, COMPLETED — Bucks / Lancaster / Centre resolved on ENUMERATION (2026-08-03)

The six PA counties recorded as "county-hub URL guesses 404'd" are now all resolved. **Nine more
hostname guesses failed DNS first** (`gis.chesco.org`, `arcgis.chesco.org`, `maps.chesco.org`,
`gis.co.lancaster.pa.us`, `gis.lancastercountypa.gov`, `maps.lancastercountypa.gov`,
`gis.centrecountypa.gov` ×2, `maps.centrecountypa.gov`) — **the pattern-guessing route is exhausted and
should not be retried.** Every real host below came from the county's own published hub, its planning
commission, or **PASDA** (`mapservices.pasda.psu.edu`, the state's open geospatial portal, which hosts a
per-county MapServer for most PA counties and is a standing route worth trying first).

| county | dark | real host | basis | verdict |
|---|---|---|---|---|
| Delaware | 29 | `gis.delcopa.gov` | enumerated | ✅ **WIRED + MEASURED → 0 dark** |
| **Centre** | 35 | `gissites4.centrecountypa.gov` | enumerated | ✅ **SOURCE FOUND, FRESH** |
| Chester | 34 | `gisprodops.chesco.org` | enumerated | ✅ source found, fully enumerated |
| York | 47 | `arcweb1.ycpc.org` | enumerated | ✅ source found, fresh |
| **Bucks** | 50 | PASDA `BucksCounty` | enumerated | ❌ **REJECTED — STALLED 2023-10-26** |
| **Lancaster** | 56 | `arcgis.lancastercountypa.gov` | enumerated | ❌ **REJECTED — no activity layer exists** |

### ✅ CENTRE COUNTY — `Building_Permits/MapServer/2`, 60,098 rows, FRESH

`https://gissites4.centrecountypa.gov/arcgis/rest/services/Building_Permits/MapServer/2` · polygon ·
**60,098 rows** · freshness by the Worcester string-date technique, with the layer total as a positive
control: **`Issue_Date LIKE '%/2026'` → 669 · `'%/2025'` → 1,745 · `'%/2024'` → 1,833 · `1=1` → 60,098.**

**⚠️ THE HUB DID NOT LIST IT.** Centre's ArcGIS hub (`gisdata-centrecountygov.opendata.arcgis.com`)
publishes **100 datasets and NONE of them is this layer** — its only keyword hit, "Planning & Economical
Development", is a **page** whose description is the unrendered template literal `{{description}}` and
which carries no service URL at all. The permit service appears only in the SERVER's own root listing
(85 services, incl. `Building_Permits` and `CloudPermit_pvcode`). **New standing answer: a hub catalogue
is a PUBLISHING CHOICE, not an inventory — enumerate `/arcgis/rest/services` itself before rejecting.**
Had this stopped at the hub, Centre would have been recorded as another firm rejection.

**Wire notes for whoever writes it:** rich schema (`Permit_Type`, `Type_Description`,
`Construction_Description`, `Estimated_Cost`, `Permit_Number`, `Home_Address`, `Property_Type_Group`,
`Open_Y_N`, `Percent_Complete`) on the assessor's CAMA-linked file (`TAXIDNUM`, `Net_Change_AV`,
`Appraiser_ID`) — still real permits. **EVERY date is an `esriFieldTypeString` in `M/D/YYYY`**, so
`recency_days` (which emits a `DATE` literal) CANNOT apply — this is the `frisco` / `worcester` class,
and `isoDay()` already parses `M/D/YYYY`. **`OBJECTID DESC` is NOT date order here** (sampled: 2022,
2020, 2007, 2013, 2024, 2002), so never read freshness from it on this layer. `Open_Y_N` and
`Permit_Type` both need enumerating before wiring; `FeatureServer` is not enabled (500 "Server object
extension 'featureserver' not found") — use the MapServer.

### ❌ BUCKS — the layer exists and is a real docket, but it STALLED at 2023-10-26

PASDA `pasda/BucksCounty/MapServer/6` "Bucks County - Proposed Developments 202312" — 1,343 polygons,
copyright "Bucks County, Pennsylvania", and genuinely the right shape: `BCPCNumber` (Bucks County
Planning Commission), `Proposal`, `MunicName`, `Applicant`, `ReviewLett`, `GeneralLU`, and a **real
`DateReceiv` `esriFieldTypeDate`**. **But the newest record is 2023-10-26 and only 46 rows fall in the
last three years** — the `202312` in the layer name is an accurate vintage, not a label. Same class as
Fort Lauderdale (2021-01-05) and Denton (2023-06-09). **Reject on staleness → nightly reprobe list.**
Note this was reached on a DIFFERENT SURFACE from the county's own still-unresponsive host, so "Bucks
does not answer" and "Bucks publishes nothing current" are now separately established.

### ❌ LANCASTER — enumerated across THREE surfaces, no development-activity layer exists

- PASDA `pasda/LancasterCounty/MapServer` — **22 layers, 0** (monuments, hydro, road centrelines).
- Its own server `arcgis.lancastercountypa.gov` (live, ArcGIS **11.5**) — **92 root + 37 `Hosted` = 129
  services, 0 activity layers.** The only near-matches are regulatory boundaries: `Zoning`, `PA_Zoning`,
  `Planning_Areas`, `Agricultural_Zoning`.
- Its hub `gis-lancastercountypa.hub.arcgis.com` — **4 datasets, all administrative**: "Paid Data",
  "Past GIS Presentations", "GIS Presentations", "Feedback".

My earlier guess `gis.lancastercountypa.gov` was simply the wrong NAME (the real one is `arcgis.`), which
is why the first pass returned a DNS non-verdict. **This is now a real rejection on enumeration** — and
note Lancaster sells premium layers ("Paid Data"), so this may be publishes-privately rather than
publishes-nothing, which is a different frontier and not reachable by probing.

---

## ✅ CHESTER COUNTY PA — GO-LIVE MEASURED: 34 dark pages → 0 (2026-08-03)

Second PA county wired the same day, and the second to pass the depth-is-not-coverage test (PA has no
statewide DOT-style source, so the dark pages were genuinely dark). Baseline captured BEFORE the
re-cache; measured from `app_projects` on the exact `source_ref`, never a name or domain pattern.

| | before | after |
|---|---|---|
| Chester ZIP pages | 39 | 39 |
| dev-backed | **5** | **39** |
| dark | **34** | **0** |
| pages carrying the county source | 0 | **39** |
| rows | 0 | **2,475** (3–130 per page) |

⚠️ **The "5 dev-backed before" were NOT partial coverage** — they are exactly the 5 ZIPs where
`new-castle-county-permits` spills across the DE border at its declared 5-mile radius. So the lift is
the full 34, and the county had nothing of its own on any page.

**Invariants across all 2,475 cached records: 0 missing `record_url`, 0 missing coordinates, 0
non-`point` scope, 0 without a `use_type`, and 0 without a `file_date`** — the last one is the
improvement over Delaware, whose year-only source deliberately carries none. `SUBMIT_DATE` being a real
`esriFieldTypeDate` is what buys day precision. **Bidirectional gate proof: 39 pages, 1 county touched,
0 records outside PA/Chester.**

Sample of what a resident sees on 19380 (West Chester), newest first — real, dated, specific:
`MP Renovations, LLC` 2026-06-04 Residential · `Fernhill Road ALG.` 2026-05-28 **Industrial** ·
`DePrisco 2-Lot Subdivision` 2026-05-27 · `TRBL Walnut, LLC` 2026-05-07. Note **TRBL Walnut appears
twice, as `SD-05-26-18910` and `LD-05-26-18908`** — a subdivision AND a land-development filing for one
project. Those are two real filings and are correctly kept as two records because `case_number` is part
of the dedup identity (the engine-v22 rule); collapsing them would lose a real filing.

**The retry selector was `refreshed_at`, not "still dark" — and it mattered here.** 2 of 39 fires
returned 503 (19301, 19457), and **19301 is one of the 5 border-spill pages**, so the "which pages are
still dark" selector that failed on Delaware's 19015 would have skipped it a second time. Completion was
verified as **39/39 refreshed, 0 stale** before materializing, rather than inferred from record counts.

### PA standing after both wires (measured from `app_projects`, 2026-08-03)

**PA total: 560 pages · 158 dev-backed · 402 dark.** Delaware and Chester are now the only two fully
covered counties besides Philadelphia (45/46).

| county | pages | dev-backed | dark | status |
|---|---|---|---|---|
| Delaware | 40 | 40 | **0** | ✅ wired today |
| Chester | 39 | 39 | **0** | ✅ wired today |
| Philadelphia | 46 | 45 | 1 | Carto L&I |
| Allegheny | 119 | 27 | 92 | Pittsburgh CKAN; largest remaining |
| Montgomery | 64 | 2 | 62 | no source found yet |
| Lancaster | 56 | 0 | 56 | ❌ enumerated: no activity layer exists |
| **York** | 47 | 0 | **47** | ✅ **source found** — needs the flag-precedence decision |
| Bucks | 50 | 0 | 50 | ❌ enumerated: stalled 2023-10-26 |
| **Centre** | 35 | 0 | **35** | ✅ **source found, fresh** — ready after 2 vocab enumerations |
| Dauphin | 30 | 0 | 30 | not probed |
| Lehigh | 34 | 5 | 29 | not probed |

**Next in this seam: Centre (35) then York (47) = 82 more dark pages with live sources already found.**

---

## 🔬 CONNECTOR OPTION-SURFACE AUDIT — one root class, one LIVE instance worth ~52,000 records (2026-08-03)

Run on the founder's instruction after the `status_const` defect turned out to be live in a second
entry. **The question was whether other options carry the same divergence across connectors. They do,
and one of them is not a latent hazard but a defect already in production.**

### The root class

A registry entry is plain JSON handed to one of five connectors. **A key the receiving connector does
not implement is not an error and not a warning — it is silently ignored.** So an entry can look
complete, pass every other test, and behave nothing like what its author wrote. `status_const` was one
symptom; the class is bigger than that option.

**The dangerous case is a typo.** `recency_day`, `spatial_point_cols`, `max_row` — each is accepted by
the JSON, ignored by the connector, and invisible in review.

### 🔴 THE LIVE INSTANCE — `include_types` is csv-only and SEVEN entries rely on it

`include_types` is implemented **only** in `sources/csv.ts` (`grep -rn include_types sources/` matches
csv.ts and nothing else). Seven arcgis/socrata entries carry it, and **in every one it mirrors that
entry's own `type_map` keys exactly** — so it was plainly meant as a drop-filter. It drops nothing.

**And type does NOT fail closed the way status does.** `arcgis.ts:354` is
`typeHit?.value || entry.use_type_const || "unclassified"` — an unmapped type still PUBLISHES the row,
labelled `unclassified`. (An unmapped *status* is excluded; the asymmetry is deliberate but it is what
makes this silent.)

**Measured in the live cache:**

| entry | records | `unclassified` | % | has an `extra_where` that filters type? |
|---|---|---|---|---|
| `columbus-building-permits` | 42,067 | **40,469** | **96.2%** | none |
| `cincinnati-building-permits` | 10,842 | 7,856 | 72.5% | none |
| `nashville-building-permits-issued` | 9,025 | 3,561 | 39.5% | date-only |
| `portland-building-permits` | 2,329 | 177 | 7.6% | none |
| `cleveland-issued-building-permits` | 92,357 | 644 | 0.7% | ✅ filters `PERMIT_TYPE` |
| `fairfax-active-site-construction` | 8,349 | 0 | 0% | ✅ |
| `fairfax-recent-building-permits` | 19,103 | 0 | 0% | ✅ |

**The collapse to ~0% wherever an `extra_where` happens to duplicate the intent is the tell** — the
filter differs, not the data. **~52,000 records are published beyond what their entries intended**,
40,469 of them from Columbus alone.

⚠️ **This was HALF-KNOWN.** The Cincinnati case was noticed on 2026-07-28 and flagged for the owner
("Pre-existing defect noticed while confirming this"). What that note missed is that it is **7 entries,
not 1**, and it never measured the consequence. *A defect flagged without a magnitude gets triaged as
small.*

**NOT FIXED HERE — it is a gated change** (it removes tens of thousands of records from live pages,
i.e. it changes what residents see). Two options for the founder: (a) move each whitelist into the
connector's `extra_where` — config-only, per-entry, reversible; or (b) implement `include_types` in
arcgis/socrata — one code change, fixes all seven at once and makes the option mean the same thing
everywhere. **(b) is the better fix** precisely because the root class is per-connector divergence.

### The divergence matrix — same NAME, different behaviour

| option | arcgis | socrata | carto | ckan | csv |
|---|---|---|---|---|---|
| `status_const` | **RAW value**, resolved through `status_to_bucket` | **IS the bucket** | — | — | — |
| `include_types` | ignored | ignored | ignored | ignored | **implemented** |
| `recency_days` | `>= DATE '…'` — **breaks on STRING date cols, NO escape hatch** | ISO + **`recency_expr`** escape hatch | `> now() - interval` | `> 'YYYY-MM-DD'` — **STRING compare, silently wrong on `M/D/YYYY`** | parse-time |
| `spatial_zip_radius_mi` | geometry envelope | `within_circle` **and REQUIRES `spatial_point_col`** (else quarantined → emits ZERO) | **not implemented** | **not implemented** | row coords |
| `use_type_const` | only connector that has it; mutually exclusive with `type_map` (guarded, `arcgis.ts:245`) | — | — | — | — |

Two further notes worth carrying:
- **`recency_days` inclusivity is not consistent** — arcgis uses `>=`, ckan and carto use `>`. A
  one-day boundary difference on the same option name.
- **ckan's string comparison is the NYC trap in a different connector.** `nyc-dob-permit-issuance` was
  found on 2026-08-02 to have never placed a record because a lexicographic compare met `MM/DD/YYYY`.
  ckan's `recency_days` has exactly that shape. No live ckan entry hits it today (Boston and Pittsburgh
  both carry ISO dates) — but it is one wire away, and there is no guard.

### What shipped

`test/connector-option-surface.test.mjs` (suite 78 → 79 files). It rejects unknown keys **by default**
rather than reporting them, so a typo cannot pass review; ratchets the 7 known entries so the list may
only shrink; requires each still to carry the option it is excused for (a stale excuse is its own false
record); pins the two load-bearing asymmetries so a future "harmonisation" must face them; and
self-tests that it catches a typo'd `recency_day`.

**`shelby-county-building-permits` declares `platform: "opendatasoft"`, for which no connector exists** —
the entry does nothing at all. Known and queued (QUEUE.md item 8, SHELBY-429).

---

## 🟦 FIVE COLUMBUS ZIPs ARE HONEST-EMPTY **BY DESIGN** — a ruling, not a regression (founder, 2026-08-03)

**If you are reading this because five Columbus pages show only the EPA facilities floor: that is the
intended state. Do not "fix" it.**

`43140` (London) · `43064` (Plain City) · `43082` (Westerville) · `43210` (**OSU campus**) · `43146`
(Orient) carry **no `columbus-building-permits` records** following the `type_source` re-point from
`GENERAL_TYPE` to `B1_PER_SUB_TYPE`.

**Why they are empty, enumerated before the change — this was their ENTIRE content in the connector's
365-day window:**

| ZIP | every record it held |
|---|---|
| 43064 | 3 × MEP |
| 43082 | 2 × Fire Protection, 1 × MEP |
| 43140 | 2 × MEP |
| 43146 | 29 × MEP |
| 43210 (OSU) | 6 × **Sign**, 1 × MEP |

**Zero development by any definition** — HVAC/plumbing/electrical permits and six signs. Columbus issued
no structural, new-construction, major-alteration, addition or demolition permit in any of these five
ZIPs in a year. **Every Columbus page is Columbus-only** (no other registry source covers Franklin
County), so they fall to the national EPA facilities floor rather than to a thinner page.

**The founder's reasoning, recorded verbatim so it is not re-litigated:** *"Those pages currently make a
typed-pin promise the data does not keep; showing HVAC permits and signs on a 'what is being built near
me' map is the fabrication problem in a different costume. The EPA facilities floor is the honest state
for a ZIP where Columbus issued no development permits in a year. Honest-empty over false-typed."*

**Do not widen the whitelist to rescue them.** That was proposed and **measured**: adding
`Minor Alteration` back rescues **ZERO** of the five (none of their records are that class) while adding
64,113 minor jobs to all 49 pages. Withdrawn on the measurement.

**What WOULD legitimately change this:** Columbus actually issuing development permits in these ZIPs
(the pages repopulate on the next refresh with no code or config change — the whitelist is not a
per-ZIP exclusion), or a second Franklin County source being wired. Neither is a reason to touch this
entry today.

### 📅 THEY DO NOT EMPTY UNTIL ~2026-08-09/10 — that delay is a SAFETY CONTROL, not a failed deploy

**Deployed 2026-08-03 15:55Z. All five ZIPs returned clean HTTP 200s with `development: 0` — and all
five were REJECTED by `dev_refresh_collect()`'s transient-safe guard**, which refuses any update taking
a FRESH row's development count from >0 to 0 (flake protection: a momentary source failure must never
blank a good page). So immediately after the deploy:

- **44 of 49 pages persisted** the re-point — 14,421 records, **0 unclassified** (from 40,468).
- **5 pages kept serving their stale MEP/sign records**, and the cache still showed 45 unclassified —
  exactly 3+4+2+29+7, i.e. entirely those five pages' old content.

Their last successful refresh was 2026-08-02/03, so the guard's 7-day escape clause expires around
**2026-08-09/10**, at which point the clean empty response wins and the pages settle to the EPA
facilities floor. **If you are reading this AFTER that date and the pages are empty: that is the
intended end state, arriving on schedule.** If you are reading it BEFORE and they still show HVAC
permits: also expected — do not re-fire them, and do not hand-write the cache to force it.

Full rule: `docs/maps-go-live-governance.md`, "A RE-CACHE CANNOT SHRINK A PAGE TO EMPTY WITHIN 7 DAYS".

---

## ✅ include_types ENFORCEMENT — COLUMBUS MEASURED (2026-08-03), three entries pending a DB outage

Deployed 15:55Z on merge commit `5a4c24a`. Columbus re-cached and materialized the same hour; the other
three were interrupted by a **platform-side Supabase outage** (`FATAL: 57P03 … not accepting
connections, Hot standby mode is disabled`) — unrelated to this change, and any failure inside that
window is an artefact of the outage, not of the wire.

### Columbus — measured vs expected, on the 49 baseline ZIPs

| | expected | measured |
|---|---|---|
| records | 14,445 | **14,466** (14,421 on the 44 pages that persisted) |
| keep rate | 34.2% | **~34.3%** |
| **unclassified** | — | **40,468 → 0** on every persisted page |
| missing `record_url` / coordinates | 0 | **0 / 0** |
| pages emptied | 5 | 0 today, **5 on ~08-09/10** (guard, see above) |

**0.17% variance from prediction** — inside the stop-tolerance (30–38% keep, no sixth page dark), so the
run proceeded. The 45 unclassified still in the cache are exactly the five held pages' old content
(3+4+2+29+7), not a classification miss.

**The point of the whole exercise:** every surviving Columbus record now carries a real `use_type`.
Before the re-point, 96.2% of them rendered as typed pins with no type.

### Two protocol gaps this deploy exposed — both now governance rules

1. **A re-cache cannot shrink a page to empty within 7 days** (the guard above). "Re-cache and measure"
   silently assumes a re-cache can REDUCE a page. It cannot, and an intentional emptying looks
   identical to a failed deploy.
2. **`net._http_response` can be purged between firing and collecting.** An 86-request batch was lost
   when the table went to 0 rows minutes after firing. Fire modest batches, collect within ~2 minutes,
   and check `max(id)` before concluding a re-cache "did not work."

### Pending when the database returns

Re-fire and measure **cincinnati** (expect a large drop — 111,022 trades records dropped at source),
**nashville** (baseline 9,027 / 3,562 unclassified) and **portland** (baseline 2,329 / 177), each
against its pinned pre-deploy baseline. Cincinnati and Nashville will likely hit the same 7-day guard on
any page whose development count reaches zero — that is expected, not a defect.

---

## 🔬 ARCGIS `maxRecordCount` AUDIT — 124/124 entries probed; exactly 2 truncated (2026-08-03)

Run after the server-capped paging defect was found. **Every arcgis entry's layer was probed for
`maxRecordCount`; 0 unresolved.**

| | count |
|---|---|
| healthy (`maxRecordCount ≥ pageSize`) | **122** |
| **truncated** (`maxRecordCount < pageSize`) | **2** |

| entry | layer cap | entry pageSize | pages carrying | cached | pages AT the cap |
|---|---|---|---|---|---|
| `portland-building-permits` | 200 | 1000 | 21 | 1,814 | **5** |
| `colorado-springs-planning-applications` | 200 | 1000 | 29 | 3,237 | **4** |

**Portland's 5 capped pages measured against the source in the connector's own scope: 321 + 313 + 345 +
234 + 351 = 1,564 true vs 1,000 cached — 564 records missing (36%).**

⚠️ **CORRECTING AN OVER-WARNING I ISSUED BEFORE RUNNING THIS AUDIT.** On finding the defect I wrote that
"Columbus, Cincinnati and Nashville totals may be undercounts." **They are not.**
`columbus-building-permits` already carried `page_size: 2000`, exactly matching its layer's
`maxRecordCount: 2000`; `nashville-building-permits-issued` is 1000/1000; `cincinnati-building-permits`
is **socrata**, a different connector entirely. Only Portland among that day's measurements was affected.
*A blast-radius estimate stated before the audit is a guess wearing a number's clothes — this one was
~60x too wide (2 entries, not 124).*

**Coverage, not just volume:** truncation stops the fetch after one page, so a page holding 0 records
stays at 0 — **it cannot darken a page**. The only path by which fixing it could LIGHT a dark page is a
page whose first 200 fetched rows all fail post-fetch filtering; with the type whitelist now pushed down
at source, that requires all 200 to be status-excluded. Measured empirically after the fix deploys
rather than asserted.

### Why this was found at all

An 18% variance on Portland's record total that did not match its expected drop. Chasing it instead of
averaging it away surfaced a defect **older than every change in this session** — silent, and invisible
in any total, because a truncated fetch and a small source look identical unless you notice the count is
a suspiciously round 200.

---

## PA SEAM CLOSED — CENTRE + YORK WIRED AND MEASURED (2026-08-04)

Both counties recorded 2026-08-03 as "SOURCE FOUND, NOT YET WIRED" are now live. With
Delaware (#570) and Chester (#574/#575), **every one of the six PA counties recorded as
"county-hub URL guesses 404'd" is resolved** — 4 wired, 2 rejected with receipts (Bucks
stalled 2023-10-26, Lancaster has no activity layer).

### Measured, both surfaces (the surface-matrix rule)

| county | pages | with records | dark | `development_reports` | `app_projects` pages / rows | worst page |
|---|---|---|---|---|---|---|
| Centre | 35 | **34** | 1 | **7,686** | 35 / 7,879 | 935 |
| York | 47 | **46** | 1 | **2,444** | 47 / 3,060 | 155 |

Across all 10,130 records from both sources: **0 missing `record_url`, 0 missing
coordinates, 0 unclassified.** Bidirectional gate proof, cache-wide over all 12,722 ZIPs:
the query returns exactly two rows — Centre records ride ONLY PA/Centre pages, York ONLY
PA/York. No leakage.

### Both remaining "dark" pages are HONEST — and they are honest in DIFFERENT ways

This is the part worth keeping. A page with no records is not one finding; **characterise
the zero in two steps — unwindowed control first, then windowed:**

- **Centre 16686 (Tyrone)** — unwindowed envelope control **0**. The layer has no permits
  within 3 mi of that centroid at all. Tyrone sits on the Blair County line. True absence.
- **York 17372 (York Springs)** — unwindowed control **80**, windowed **0**. Not absence:
  80 plans are on record, but **none received in the last 5 years**. Honest "no recent
  activity."

Reporting either as simply "dark" would have hidden which one it was, and only the second
would change if the window changed.

### CENTRE — the opaque status code was decoded on EVIDENCE, not guessed

`Open_Y_N` is C 58,676 / O 1,414 / null 7 / I 1 (sums to exactly 60,098) and the layer
publishes **no `codedValues` domain**, so the meaning is stated nowhere in metadata. Three
independent lines establish **C = Closed, O = Open**:

1. the field is named `Open_Y_N`;
2. **recency inverts** — 2026 permits are 487 O / 177 C (73% open) against 2.4% open across
   all history, exactly what "recent permits are still open" predicts;
3. **`Close_Date`** is populated on 31.7% of C rows but **0.4% (6 of 1,414)** of O rows — a
   79× asymmetry.

`Percent_Complete` was **tested as a decoder and REJECTED** (null on 58,085 of 58,676 C
rows). `I` — one row, no `Close_Date`, no signal — is **declared in `exclude`** rather than
left unmapped, per the `delaware-county-pa` defect. Live confirmation on 16801: approved
183 + operating 752 = 935, the O/C split reproduced end to end.

**`Property_Type_Group` was rejected as the type source because it is ITSELF opaque**
(R/C/A/S/T). `Permit_Type` is self-describing and closed.

**Fields chosen from live non-null counts, not the schema — and it mattered.** Over the
4,247 windowed rows, `Home_Address` is populated **0** times and `Type_Description` **0**
times, though both exist in the schema and both read like the obvious title/address choice.
Wiring either would have shipped blank records. `Construction_Description` is 99.6%.

### YORK — use is a SET OF 8 FLAGS, not a column; the design question is settled

There is no single use field anywhere in the schema. `column_map` arrays **JOIN with a
single space and keep every non-empty part** (`arcgis.ts` `readCol`), so `type_source` is
the 8 flag columns **in precedence order** and each `type_map` key is 8 space-joined
`YES`/`NO` tokens. **No connector change was needed.**

Safe ONLY because the flags are never NULL: probed live, **0 rows** with a NULL flag, with a
non-zero control from the same query shape (`PLAN_TITLE IS NOT NULL` → 1,269). A NULL would
have shortened the joined key and silently missed the map. The flags carry the layer's own
`BOOLEAN` domain, so the key space is closed.

**Precedence — the one judgement call, and it is reversible by editing that map alone:**
`IND > COM > MF > MHP > SR > SF > AG > OTHER`. Most intensive use wins, because the question
the page answers is *what is coming near my home*, and a plan flagged both single-family and
agricultural is a subdivision on farmland. Consequence over the window: Residential 752,
Commercial 226, Industrial 137, Development 154, **0 unclassified**.

**⚠️ CORRECTS THE 2026-08-03 NOTE that "`PT_FINAL` YES/NO is the closest thing to a
lifecycle signal." IT IS NOT.** The `PT_*` flags are themselves a multi-flag set, and **323
rows carry `PRELIM+FINAL` together** — they describe plan TYPE, not stage, and cannot order
a lifecycle. Status is therefore a `status_const`, self-describing and a key in its own map,
matching `chester-county-pa-act247-plans` — the same Act 247 mechanism next door.

### THREE NEW STANDING ANSWERS

1. **RULE 13 GOVERNS VOCABULARY WIDTH, NOT JUST COUNTS — enumerate at the EXACT window you
   wire.** York's use-flag set has **29** combinations in a 3-year window and **32** in the
   5-year window actually wired; `SF+SR`, `IND+OTHER` and `MF+SR+OTHER` exist only in the
   wider one. Enumerating at 3y and wiring at 5y would have dropped those rows to
   `unclassified` with nothing failing. A vocabulary is a function of the window.
2. **A JOINED FLAG ARRAY IS NOT AN EMPTY `type_source`, so `use_type_const` CANNOT catch its
   all-`NO` rows.** York's 34 no-flag rows join to `"NO NO NO NO NO NO NO NO"` — a present
   value. The constant fills only on an EMPTY value (the 2026-08-03 ruling), so those rows
   need an **explicit key**. Centre, whose type source is a single column with 1 genuinely
   blank row, is the opposite case and does use the constant. Same ruling, two mechanisms.
3. **A RE-FIRE SELECTOR MUST KEY ON THE FIELD THAT CHANGES AT FIRE TIME, NOT AT COLLECT.**
   Filtering pending work on `refreshed_at` re-fired the *same* 9 Centre ZIPs twice and
   never advanced, because `refreshed_at` only moves when `dev_refresh_collect()` runs. The
   claim field is `last_refresh_attempt_at`, which `dev_refresh_fire_batch` sets AT FIRE.
   Same family as the 80005 remediation-anchor catch, in the other direction: there the
   selector moved too fast, here it never moved at all.

### One instrument cleared of suspicion

18 in-flight requests showed no `net._http_response` row and I read that as the
`fire_failed` class. **That was premature — they were still in flight and all landed.**
`dev_refresh_log_fire_failures()` is sound: it inspects only requests whose response has
LANDED (`join net._http_response`), so an in-flight request is never logged as a failure.
The reading was the error, not the instrument. Also note `dev_refresh_collect()` returns a
GLOBAL count including the scheduled refresh's ZIPs — it is not evidence about your own
fires; measure the target rows directly.

### Wire facts

- **Centre** — `gissites4.centrecountypa.gov/.../Building_Permits/MapServer/2`, polygon
  (shoelace centroid; `return_centroid` NOT set — a classic MapServer silently ignores it),
  60,098 rows, no ZIP column → spatial 3 mi. Every date is an `esriFieldTypeString` in
  `M/D/YYYY`, so `recency_days`' DATE literal cannot apply and — unlike Anaheim's
  `yyyy/mm/dd` — a lexicographic compare has no purchase either. Year-suffix `LIKE` list
  (the `worcester` technique), **with 2027 included preemptively** so the window widens at
  the year turn instead of silently truncating. Rule 13 probes with non-zero controls:
  16801 15,862 → 937; 16803 13,220 → 789.
- **York** — `arcweb1.ycpc.org/.../PLANNING_Subdivisions/FeatureServer/0`, **point**
  geometry (no centroid needed), 26,884 rows at wire time vs 26,879 the day before — the
  layer grew by 5 and the 5-year window moved 1,267 → 1,269 by the same amount. `MCD` was
  deliberately NOT used in the title: it is a coded municipality domain and `readCol` would
  emit the raw code (`"10"`). Rule 13 probes: 17331 1,868 → 102; 17402 2,247 → 111.

---

## ALLEGHENY COUNTY PA — `allegheny-county-asbestos-permits` WIRED; PA dark 322 → 272 (2026-08-04)

The county-wide seam behind Pittsburgh. `pittsburgh-pli-permits` already covered 27 of
Allegheny's 119 ZIP pages; the ~130 suburban municipalities had no county-wide source.
**Config only** — same host (WPRDC) and same connector (`sources/ckan.ts`) as the Pittsburgh
entry, so no connector, engine or schema change.

### Measured, post-deploy, from `development_reports` (not source-side)

| | before | after |
|---|---|---|
| Allegheny live | 27 | **77** |
| Allegheny dark | 92 | **42** |
| PA dark | 322 | **272** |
| national | 4,482 / 12,722 (35.24%) | **4,532 / 12,722 (35.62%)** |

50 pages carry the source · 215 records in `development_reports` · 210 in `app_projects`.
Native `zip_code`, so the page count is EXACT, not a spatial-radius estimate.

**The 215 vs 210 gap is explained, not loss:** exactly 5 records are `scope:"area"` (no
coordinates) and `app_projects` carries only the 210 point records. Verified it is NOT dedup —
all 10 records on 15260 have distinct `case_number`s.

### Discovery — by ENUMERATION, not a guessed hostname

Found via WPRDC CKAN `package_search?q=permit` → 35 packages. **PASDA
(`mapservices.pasda.psu.edu`) was enumerated first and is a DEAD END for activity data in these
counties** — `pasda/AlleghenyCounty/MapServer` 41 layers, `pasda/MontgomeryCounty` 30,
`pasda/DauphinCounty` 2, `pasda/LehighCounty` 7, and **every one is base cartography**
(contours, parcels, building footprints, landslides, hydrology). PASDA carried Bucks only
because Bucks published a planning docket there; it is not a standing route for permits.

Allegheny's own `gisdata.alleghenycounty.us` was also enumerated: folder **`Accela` is EMPTY**
(0 services, 0 folders) — the name is a lure; `OPENDATA` = Address_Points_Test1 + Parcels;
`EGIS` = address/buildings/municipalities/parcels; `LandRecords` = Parcel_Features; `DPW` =
facilities/districts/snow routes.

### Vocabularies — both complete, each summing to EXACTLY 433 (positive control = row total)

`status` (6): `Active - Issued` 185 · `Closed - Completed` 119 · `Approved - Renovation` 80 ·
`Approved - Demolition` 46 · `Closed - Cancelled` 2 · `Issued` 1.
`project_type` (4): `PAA` 307 · `UND` 46 · `DEM` 46 · `RES` 35.

**Type is a constant via `type_map`, and that is the honest choice.** `project_type` is a
permit-CLASS code, not a building-use vocabulary — the 307 `PAA` rows span a sushi restaurant,
West Penn Hospital, Chevron Science Center, a church, a school and Lock 4 of the Allegheny
River. Mapping it to any single use would be fabrication, so all four map to the generic member
`Development` (Sussex / Weld / Phoenix precedent).

⚠️ **`use_type_const` was deliberately NOT used** — it is implemented only in
`sources/arcgis.ts` and is not a field on `CkanRegistryEntry`, so on a ckan entry it is
**silently ignored** (the option-surface class), and `ckan.ts` publishes an unmapped type as
`unclassified` rather than failing closed.

### PUBLISHER SUSPENSION — disclosed, on the reprobe list

The package notes carry a note dated **07/29/2026**: the county identified **undercounting**
after an October 2025 software transition and has **SUSPENDED updates** pending a new solution;
permits in `in progress` status are excluded. What is published is real, dated, addressed and
per-record (max `permit_issue_date` 2026-06-29, oldest 2025-08-11), and undercounting is
incompleteness rather than fabrication — but this entry **will age**. **Do not restate its
coverage as complete county coverage.**

### Rejected alongside, on enumeration

- **`Applications for Development, ACCD`** (resource `f3b9a9aa`) — a genuinely DIFFERENT
  package from the previously-rejected `Implemented Stormwater Control Measures, ACCD`, but
  falls to the same disqualifier, now byte-verified from its real field list: `municipali,
  Feature_ID, Status, App_Date, App_Sort, Acres, LandUse, PreImperv, PostImperv, Dschrg_Pts,
  Max_nonStr` — municipality only, **NO address, NO zip, NO coordinates**; geometry exists only
  in an SHP resource the ckan connector cannot read. **NO_GEOGRAPHY.**
- **Dauphin County (30 dark pages)** — its hub DCAT enumerated in full: **30 datasets, all
  parcels / hydrology / tax roll / zoning / voting. candidates_exhausted.**

### Standing answer — an empty DCAT dataset array is NOT an empty server

Second time this has paid (Centre, then Montgomery). Montgomery PA's hub
`data-montcopa.opendata.arcgis.com` returns a literal `"dataset": []`, while its **server root**
`gis.montcopa.org/arcgis/rest/services` carries **19 folders** including
`Planning/Montgomery_County_Act247_Proposals` — Act 247 is the PA Municipalities Planning Code
provision requiring municipalities to file subdivision and land-development proposals with the
county planning commission, i.e. a county-wide development docket. **Enumerate the server root
before recording a rejection.** ⚠️ `opendata-mcgov-gis` is Montgomery County **MARYLAND**
(already wired) — the cross-state lookalike trap.

---

## DEFECT (FIXED) — the geocode geofence existed in 2 of 5 connectors (2026-08-04)

CLAUDE.md §8 lists the fence among **"the five rules that never bend."** It was implemented in
`arcgis.ts` and `socrata.ts` — each with its OWN copy, socrata's named `GEOCODE_FENCE_MI_GEO` /
`milesBetweenGeo` and commented *"kept in lockstep"* — and **absent from `ckan.ts`, `carto.ts`
and `csv.ts`.** Same divergence class as `status_const` and `include_types`, on a safety rule.

**Live proof**, on the first ckan entry that ever geocoded: `allegheny-county-asbestos-permits`,
ZIP **15202**, `"294 UNION AVENUE"` cached at **lat 42.993118 / lng −74.398022**,
`geo_precision "address"`, `scope "point"`, with
`matched_address "295 UNION AVE EXD, JOHNSTOWN, NY, 12095"` — wrong state, wrong ZIP, wrong
house number, ~300 mi from Pittsburgh. Both fence checks would have rejected it.

**Cache-wide census at the time of the fix: only 2 records geocode at all on those three
connectors** — this one, and a Boston record that matched correctly
(`8D ALLSTATE RD, DORCHESTER, MA, 02125`). Small blast radius, but every future entry on those
connectors would have inherited the unfenced path.

**Fix:** `sources/geo-fence.ts` is now the single implementation, called by all five.
**Semantics unchanged** — the two copies were already identical in every operative detail
(25 mi, same equirectangular distance, same trailing-ZIP regex, same mismatch test, same
null-out, same reason strings); only the identifiers differed, so nothing was reconciled.
`arcgis.ts` re-exports `GEOCODE_FENCE_MI` / `milesBetween`. `ckan.ts` and `carto.ts` gained an
optional `deps.zipCentroid`; `index.ts` passes it to all five. Both halves fail OPEN when their
input is absent, as before.

**Regression:** `test/geocode-fence.test.mjs` DRIVES the fence through all five shipped
connectors in both directions (wrong-state rejected → coords nulled, area scope, record still
emitted with `record_url`, geofence quarantine reason; correct match passes untouched), plus a
guard that every connector reaching `deps.geocode` routes through `fenceGeocode()`, defines no
private copy, and that **all 5 were actually checked**. Suite 85 → 86 files.

⚠️ **The guard's first version matched the old identifiers inside socrata.ts's own explanatory
COMMENT.** It now matches a definition, not a mention — a grep is a lead, not a fact.

---

## MONTGOMERY COUNTY PA — `montgomery-county-pa-act247-proposals` GO-LIVE MEASURED: 62 dark → 0 (2026-08-04)

Third PA Act 247 entry (after Chester and York) and PA's largest remaining dark block.
**Config only.** Baseline captured BEFORE mutating: 64 pages, 2 live, 62 dark, 0 missing cache rows.

| | before | after |
|---|---|---|
| Montgomery live / dark | 2 / 62 | **64 / 0** |
| PA live / dark | 288 / 272 | **350 / 210** (62.50%) |
| national | 4,532 / 12,722 | **4,591 / 12,722 (36.09%)** |

**3,628 records — IDENTICAL in `development_reports` and `app_projects`**, across all 64 pages.
**0 invariant violations**: 0 missing `record_url`, 0 missing coordinates, 0 `unclassified`,
0 non-`point` scope, 0 non-`record` precision. Bidirectional gate proof: **PA/Montgomery ONLY,
64 pages, 0 records on any other county.**

⚠️ **The 2 pages that were already "live" were NOT partial coverage** — they are exactly
`19118` + `19128`, the two physically-Philadelphia ZIPs modelled under Montgomery by the Census
crosswalk, lit by `philadelphia-li-permits` spill. They now carry BOTH sources (19118: 162
sourced = 42 Montgomery + 120 Philadelphia; 19128: 247 = 48 + 199). That is real adjacency
across the city line, not leakage. **A "which pages are still dark" retry selector would have
skipped both**, and they would have silently missed the new source — the retry selector was
`refreshed_at`, the Chester lesson, and it is what caught them.

### The ruling, recorded so it is not re-proposed

`status_const` = `Submitted for county review` → bucket **`proposed`** (founder ruling
2026-08-04). Act 247 requires a municipality to SUBMIT a subdivision or land-development plan
to the COUNTY commission for REVIEW BEFORE the municipality acts, so a row is a filing under
advisory review, not an approval; understating stage is the honest direction. On arcgis,
`status_const` is the RAW value resolved through `status_to_bucket` (unlike socrata, where it
IS the bucket), so the constant is a self-describing string that is also a key — wording
deliberately identical to `chester-county-pa-act247-plans`. Measured after go-live: proposed
3,628 / approved 0 / operating 0.

### Type is a constant — same conclusion as Allegheny, reached the same way

Neither candidate column is a use vocabulary. `Proposal_Type` enumerates EXACTLY against the
layer total as a positive control — Plan Only 5,463 + Ordinance Only 301 + Plan and Ordinance
56 + NULL 1,381 = **7,201** — but it is a FILING CLASS. `Land_Use_1` is a closed 19-value set
whose values are OPAQUE CODES (`T RDE RAE RSA RSD AG RE RM MUN INE RDC INS U RME PO IND C OS`);
the eight R-prefixed residential variants cannot be decoded without the county's legend, and
`use_type` drives the pin SHAPE. `use_type_const: "Development"` (Sussex/Weld/Phoenix).
**Future refinement if the county publishes a Land_Use legend — not chased (founder).**

### The NULL-type problem dissolves inside the window

1,381 of 7,201 NULL layer-wide (19%), but only **4** inside 1,095 days — and those 4 are exactly
the rows with a NULL `Proposal_Name` and NULL `URL_Documents`. Measured: window AND named AND
type IS NULL → **exactly 0**. The `Proposal_Name IS NOT NULL` guard drops 4 unusable rows and
leaves a clean 813 in-scope. In-scope completeness: 817 → 813 named, 813 with URL, **817/817
`MCPC_Number`**.

### ⚠️ Window differs from both siblings — FLAGGED, not silently reconciled

Named-row counts: **365d 253 · 1095d 813 · 1825d 1,396.** Chester and York both use
`recency_days: 1825` on the SAME Act 247 mechanism (plan review is slow-moving). The founder
ruled **1095**, so 1095 is wired (Rule 0 — a founder-set value is not mine to change). The 1,396
figure is recorded so the three PA Act 247 windows can be reconciled deliberately later rather
than by drift.

### Verified rather than assumed

- **Native SR is PA State Plane (wkid 102729 / latestWkid 2272, feet), NOT WGS84.** The
  connector's `outSR=4326` IS honoured by this server — probed live, returned
  `spatialReference {wkid 4326}` with first vertex `[-75.282085, 40.070857]` (Spring Mill Road,
  Montgomery County PA). Had it been ignored, every centroid would have been a State Plane FOOT
  value rendered as a lat/lng. **Check outSR on any layer whose native SR is not 4326.**
- **`return_centroid` deliberately NOT set** — classic ArcGIS Server MapServer silently ignores
  it; the shipped shoelace centroid is the path.
- **`column_map.lat/lng` = `__lat`/`__lng`** — the Sussex defect otherwise lands every record on
  the ZIP centroid at `scope=area`, silently, while still publishing and counting normally.
- **`record_url_precision: "record"`, PROVEN to discriminate** (San Diego OpenDSD standing
  answer): real id 108325 → 5,329 bytes of document listing; bogus id 99999999 → 2,178 bytes
  matching not-found. Stronger than either sibling, both dataset-precision.

### Editorial note
The Norristown page (19401, 86 records) carries **five data-centre filings** in March 2026 —
600 River Road, 411 Swedeland Road, 2100 Renaissance Blvd, 3200 Horizon Drive and Renaissance
Blvd. Relevant to the data-centre thread.

---

## LEHIGH COUNTY PA — CLOSED (2026-08-04): WAF on its own server, hub enumerated clean

The last PA county never probed beyond PASDA. Three surfaces, three verdicts:

- **PASDA `pasda/LehighCounty/MapServer`** — 7 layers, all base cartography (abandoned
  railroads, railroads, road centreline, building footprints, municipal boundary, parcels,
  wards). **candidates_exhausted.**
- **Its own `gis.lehighcounty.org`** — live but behind an **Incapsula/Imperva WAF**: returns a
  212-byte JS challenge page (`_Incapsula_Resource`) to `pg_net`, not JSON. The Tampa class.
  **verification_blocked → nightly reprobe list.**
- **Its hub `open-data-lehighgis.opendata.arcgis.com`** — DCAT enumerated in full: **13
  datasets**, all parcels / assessment / owner / voting precincts / bridges / landuse CODES /
  farmland preservation / COVID testing. **Zero development-activity layers. candidates_exhausted.**

Note the hub here is NOT empty (unlike Montgomery's) — it is populated and genuinely carries no
activity layer, which is a different and firmer verdict than "the hub listed nothing."

## PA SEAM — STANDING AFTER MONTGOMERY (measured 2026-08-04)

**PA: 560 pages · 350 live · 210 dark · 62.50%.**

| county | pages | live | dark | verdict |
|---|---|---|---|---|
| Montgomery | 64 | 64 | **0** | ✅ wired today |
| Delaware | 40 | 40 | 0 | ✅ wired |
| Chester | 39 | 39 | 0 | ✅ wired |
| York | 47 | 46 | 1 | ✅ wired |
| Philadelphia | 46 | 45 | 1 | ✅ Carto L&I |
| Centre | 35 | 34 | 1 | ✅ wired |
| **Allegheny** | 119 | 77 | **42** | ✅ wired; residual is COVERAGE-LIMITED, not unprobed — the asbestos source has no records in those 42 ZIPs |
| **Lancaster** | 56 | 0 | **56** | ❌ enumerated across 3 surfaces: no activity layer exists |
| **Bucks** | 50 | 0 | **50** | ❌ enumerated: PASDA docket STALLED 2023-10-26 |
| **Dauphin** | 30 | 0 | **30** | ❌ enumerated: hub DCAT 30 datasets, all base |
| **Lehigh** | 34 | 5 | **29** | ❌ hub enumerated clean; own server WAF-blocked (reprobe) |

**Every PA county is now either wired or rejected on ENUMERATION.** The 210 remaining dark pages
are not unprobed — 165 are firm rejections (Lancaster 56 + Bucks 50 + Dauphin 30 + Lehigh 29),
42 are coverage-limited inside a wired county, and 3 are single stragglers. **The PA seam is
closed.** The only routes left are a Bucks reprobe (its docket may resume), a Lehigh reprobe (if
the WAF lifts), or municipal-level wiring in Lancaster/Dauphin.

### ACT 247 WINDOW RECONCILED TO 1825 — measured (2026-08-04)

All three PA Act 247 entries now share `recency_days: 1825`. Montgomery shipped at 1095 and was
reconciled the same day (founder ruling): three entries on one mechanism with two windows is
drift, the siblings shipped first, and 1825 is also the more accurate window because Act 247
plan reviews run multi-year.

| | at 1095 | at 1825 |
|---|---|---|
| records (`development_reports` / `app_projects`) | 3,628 / 3,628 | **6,126 / 6,126** |
| pages carrying the source | 64 | **64** |
| oldest `file_date` | 2023-08-08 | **2021-08-05** |
| invariant violations | 0 | **0** |

**The oldest `file_date` is the proof, not the count** — 2021-08-05 is exactly the 1825-day
boundary, so those records could not exist under the old window. **+2,498 page-records from
+583 source rows is spatial fan-out, not inflation**: scoping is 3 mi, and the pages-per-row
ratio is stable across the change (4.46 → 4.39).

⚠️ **Batch size when the refresh cron may be running: 16, not 64.** A 64-wide burst returned
62 × 503 `BOOT_ERROR` while `dev_refresh` was active, moments after the same function answered
a single probe 200. Nothing was corrupted — `dev_refresh_collect` reads only 200s. Batches of
16 ran clean. Measure completion by `refreshed_at` on the TARGET rows; the collect return value
is global and includes the cron's ZIPs.

---

## OHIO — the shape correction, and SUMMIT/AKRON wired (2026-08-05)

### ⚠️ OH is NOT "county seams around the wired metros" — measure before framing

The remaining OH dark pages were described as seams around Columbus/Cincinnati/Cleveland. Measured,
that is wrong in a way that changes the work:

| county | pages | live | dark | |
|---|---|---|---|---|
| **Summit** | 41 | 0 → **14** | **27** | Akron — wired today |
| **Montgomery** | 39 | **0** | **39** | Dayton — UNPROBED |
| **Lucas** | 30 | **0** | **30** | Toledo — UNPROBED |
| Hamilton | 56 | 34 | 22 | Cincinnati ✅ |
| Medina / Warren / Butler | 49 | 0 | 49 | collars — UNPROBED |
| Delaware | 19 | 4 | 15 | Columbus collar |
| Cuyahoga | 52 | 39 | 13 | Cleveland ✅ |
| Franklin | 49 | 45 | 4 | Columbus ✅ |

**159 of the original 213 dark pages (75%) were in counties with ZERO wired source**, three of them
separate metros. The three wired counties were already at 91.8% / 75.0% / 60.7%. Only 54 dark pages
are true seams. **OH is three fresh metro builds plus trim, not a trim job.**

### ⚠️ TRIPLE CROSS-STATE COLLISION ON "MONTGOMERY COUNTY" — the worst one in the dataset

Searching Montgomery County GIS returns, in this order: `montcopa` = Montgomery County
**PENNSYLVANIA** (wired 2026-08-04), `mcgov` = Montgomery County **MARYLAND** (wired earlier), and
PASDA's `MontgomeryCounty` (also PA). Ohio's is **`mcohio.org`**. Three same-named counties, two
already in this registry. Anyone probing Dayton must confirm entity from CONTENTS, not hostname.
`gis.mcohio.org/arcgis/rest/services` returns 404 HTML — the real OH service host is still unfound.

Summit has the same trap: `summitcountyco.gov` and `summitcountypropertyappraiser.org` are not Ohio,
and `maps.summitcounty.org` is a live ArcGIS server carrying only parcel viewers, entity unconfirmed.
Summit OHIO is `summitoh.net`.

### ✅ `summit-county-oh-planning-commission-items` — GO-LIVE MEASURED: 0 → 14 pages

| | before | after |
|---|---|---|
| Summit live / dark | 0 / 41 | **14 / 27** |
| OH live / dark | 122 / 213 | **136 / 199** (40.60%) |
| national | 4,591 | **4,604 / 12,722 (36.19%)** |

**36 records, identical in `development_reports` and `app_projects`**, 14 pages, **0 invariant
violations** (0 missing `record_url`, 0 missing coords, 0 unclassified, 0 non-`point`, 0 non-`proposed`).
Bidirectional gate proof: **OH/Summit ONLY**. 36 page-records from 16 source rows = 2.25x spatial
fan-out at 3 mi.

**The 27 still-dark pages are the documented coverage limit, not a failure**: the county commission
reviews UNINCORPORATED TOWNSHIPS. Akron and the incorporated cities run their own planning
departments. Do not describe this as county-wide coverage.

**Host derived from the hub's OWN dataset accessURLs**, never guessed — `scgis.summitoh.net` and the
AGO org `services3.arcgis.com/3Ukh5HzAdI6WZ3KP`. Entity confirmed from contents (townships Sagamore,
Copley, Springfield, Richfield).

**Enumerated on every surface before wiring**: hub 138 datasets · server root 16 folders / ~100
services · `Admin_and_Planning` / `DOSSS` / `Hosted` folders.

⚠️ **The `tyler` folder is EMPTY — 0 services.** Tyler is the EnerGov permitting vendor, so the
folder NAME promises a permit system and delivers nothing. **Second empty vendor-named folder found**
(Allegheny's `Accela` was the first). **A vendor name in a folder listing is not a source.**
`permitsearch.summitoh.net` is a Bootstrap HTML app with no exposed API.

⚠️ **THE LAYER CHOICE IS LOAD-BEARING — layer 2, not layer 0.** Layer 0 Point (24 rows) is NOT
development: county-wide zoning ORDINANCE TEXT amendments (`Short Term Rentals`, `OH HB 361
Discussion`, `Definitions: RVs`), all `ItemType: Text`. Layer 1 Line is empty. Layer 2 Polygon (16)
is the real per-parcel docket. **Read the rows, not the service name.**

**`SCPCRec` was deliberately REJECTED as the status source.** It is the commission's RECOMMENDATION,
and the commission is ADVISORY to the townships under ORC 303/711 — the same mechanism PA Act 247
encodes. Mapping `Approve` (12 of 16) to the approved bucket would assert a project is approved when
the township that decides has not acted. `status_const` wording and `recency_days: 1825` are
IDENTICAL to the three PA Act 247 entries, so all four read the same.

### ⚠️ METHOD ERROR MADE AND CAUGHT — do not select a re-cache batch by "still dark"

Firing batches selected by `still dark` re-fired the same ZIPs twice: a ZIP that legitimately returns
ZERO records never leaves the dark set, so it is re-picked every round while genuinely-unfired ZIPs
wait. Caught at 21/41 refreshed. **`refreshed_at` is the only correct selector** — this is the Chester
lesson, and it applies to the FIRING selector as well as the retry selector.

---

## 🚫 MONTGOMERY COUNTY OH (DAYTON) — WIRED, DEPLOYED, THEN REVERTED: the host blocks the ENGINE (2026-08-05)

**OUTCOME: NOT WIRED.** `dayton-oh-capital-improvement-projects` was wired (#594), merged, and
deployed — and the deploy proved the source is **unreachable from the Supabase edge runtime**. The
entry was reverted the same hour. Montgomery OH stays **0 of 39**. Everything below is the recon
record, which stands; only the wire is withdrawn.

### ⛔ THE BLOCKER — and the standing answer that comes out of it

The deployed engine reached the entry and failed at the network layer, identically on 4 of 4
Montgomery ZIPs (45402, 45403, 45404, 45410), `fetched 0 / emitted 0`:

```
fetch failed: error sending request for url (https://maps.daytonohio.gov/.../MapServer/0/query?...):
client error (Connect): Connection reset by peer (os error 104)
```

**The control is the strongest available: the SAME URL, byte for byte.** The exact query string the
connector emitted — envelope, `inSR`/`outSR=4326`, `outFields=*`, `resultRecordCount=1000` — returns
**HTTP 200, 413,143 bytes, 212 features** through `pg_net`, minutes apart from the engine's reset.
Two clients, one URL, opposite outcomes. The error is at **Connect**, before HTTP, so it is not a
query-shape, URL-length or response-size problem: it is a source-IP block on Supabase's edge egress.
This is the **Tampa / El Paso class** (there a WAF 403, here a TCP reset).

**No reachable route exists.** Every ArcGIS Online item for this data — `CIP Public Project Points`,
`Active Capital Improvement Project Points`, and the `CIP All Projects Public Webmap` — is a *Map
Service reference* pointing back at `maps.daytonohio.gov`. There is no hosted copy on
`services*.arcgis.com`, so there is nothing to re-point the entry at.

**🔑 NEW STANDING ANSWER — A `pg_net` 200 IS NOT EVIDENCE THE ENGINE CAN FETCH THE HOST.** Recon in
this repo runs on `pg_net` (Postgres egress); the engine runs on the Deno edge runtime (different
egress IPs). **A host can be 100% reachable to every recon probe and 0% reachable to production**, and
because *all* recon is `pg_net`-based, this failure mode is invisible to recon **by construction** —
no number of green probes can detect it. Tampa and El Paso were caught during recon only because
their block happened to be an HTTP 403 that `pg_net` also received. Therefore: **for any NEW HOST,
the first post-deploy re-cache is a DEPLOY VERIFICATION, not a formality — read
`arcgis_reports[].fetched/emitted` and the `quarantined` reasons, never just `counts`.** A page
showing 0 development records looks exactly like a legitimately empty page; only the connector report
distinguishes "fetched nothing" from "could not connect". That check is what caught this, one probe
after deploy and before any coverage was claimed.

**🔁 REPROBE:** Dayton goes on the reprobe list. The data is good and the config is proven correct —
if the block lifts, restoring the entry is a one-object re-add. A future edge-reachability preflight
(a cheap engine-side probe of a candidate host before wiring) is proposed, not built.

---

### Recon record (stands — the wire is withdrawn, the findings are not)

Montgomery was **0 of 39 pages live** — with Lucas (0/30) the largest fully-dark block in Ohio.

**What it is.** The City of Dayton's own ArcGIS Server (`maps.daytonohio.gov/gisservices`),
`CapitalPlanning` folder: the full municipal capital-project register — 264 rows, point geometry,
per-record project names and descriptions. This is the **municipal analogue of the UDOT / TxDOT /
NDOT infrastructure-project precedent**, not a permit ledger. Sample rows: `WF2412` "Midtown Water
Main Improvements — installing approximately 1,100 LF of 8-inch water main in various streets
within the Midtown Area" (Construction), `WF2403` "Belmont Area Water Mains Improvements, Phase 1",
`WF2320` "Ryburn Avenue Water Main Improvements".

**Pre-wire measurement, computed against live `communities` centroids before any commit:
22 of 39 Montgomery pages** fall within 3 mi of at least one of the 264 points.

### ⚠️ WORST NAME COLLISION IN THE REGISTRY — two of the three are already wired

"Montgomery County GIS" returns `montcopa.org` (Montgomery **PA** — WIRED as
`montgomery-county-pa-act247-proposals`), `opendata-mcgov-gis` (Montgomery **MD** — WIRED as the
`montgomery-county-md-*` trio), and PASDA `MontgomeryCounty` (also PA). Ohio's county host
`gis.mcohio.org/arcgis/rest/services` returns **404 HTML** and the real Montgomery County **Ohio**
service host remains unfound. Confirming entity by hostname here would have wired the wrong state's
data onto Ohio pages. Entity is confirmed from **CONTENTS only**: the rows name Midtown, Belmont,
Ryburn Avenue, Merrimac Avenue and Riverside Drive — all City of Dayton, Ohio.

### Discovery — the host was derived from the org's own item URLs, never guessed

The city's eGIS hub DCAT **404s**; its Zoning hub returns **HTTP 200 with an EMPTY dataset array**
— the *third* instance of the empty-DCAT case after Centre PA and Montgomery PA. **An empty DCAT is
not an empty server.** The AGO community `self` endpoint confirmed a real org (`3dDB2Kk6kuA2gIGw`,
urlKey `DaytonOhio`); an orgid-scoped search returned 74 items whose item URLs exposed
`maps.daytonohio.gov/gisservices/rest/services`.

**The server root was enumerated IN FULL before wiring — all 35 folders, not a sample:** Accela,
Accela_UPDATES, AddressEdits, Airport, AsBuiltEditing, AsBuiltProcessManagement, Base, Basemap,
Basemaps, Basemaps_105_1, BuildingServices, CapitalPlanning, CapitalPlanningINTERNAL, COD_Webpage,
COVID19, EmergencyManagement, Engineering, Environmental, FieldMaps, Fire, Hansen, LCRR, OpenData,
Orthos, Planning, Police, PublicWorks, Rhythm, Sustainability, Utilities, Viewer, Water,
WaterReclamation, WPA, WUFO. **There is no permit ledger and no zoning-case ledger anywhere on it.**
BuildingServices holds only `HousingInspectionAreas` + a personal editing service; Planning holds
only cartographic lot-link label layers; OpenData is police-only; `COD_Webpage/Zoning` is a zoning
**district** polygon layer, not cases.

### 🚫 ACCELA REJECTED ON RECORD CLASS — a sixth disqualifier, `WRONG_RECORD_CLASS`

This is **not** the empty-vendor-folder case. Unlike Summit's `tyler` and Allegheny's `Accela`
(both 0 services), this Accela folder holds a real, fresh, per-record, point-geometry layer:
`Accela_UPDATES/AccelaIncidents_UPDATE/MapServer/0`, **12,879 rows**, `RECORD_DATE` spanning
2026-01-02 → 2026-07-01. It is still not development:

- **`COMPLAINT_TYPE` has exactly ONE value across all 12,879 rows — `HOUSING`.**
- `STATUS` enumerates CLOSED 5,072 / OPEN 4,955 / ACTIVE 1,520 / ABATED 965 / PAID 196 /
  ABATED-PAID 61 / RESEARCH-UNDER REVIEW 48 / APPEAL-PPC 26 / EXTENSION GRANTED 23 /
  NO SERVICE 13 — **sums to 12,879**.

Abatement, payment and appeal outcomes on housing complaints are a **code-enforcement** ledger; the
`development` bucket is defined as *permits, construction filings, planning notices*. Publishing
complaints against named addresses as development records would also misrepresent residents'
properties. **New standing answer:** the five recorded disqualifiers (NO_GEOGRAPHY · STALE ·
AGGREGATE_NOT_PER_RECORD · NEW_CONNECTOR_FAMILY · candidates_exhausted) have a sixth sibling —
**`WRONG_RECORD_CLASS`: live, fresh, per-record, geolocated, and still not the thing.** A schema
that passes every mechanical check can still be the wrong ledger; read the vocabulary, not the
field names.

### ⚠️ THE LAYER CHOICE IS LOAD-BEARING AND THE SERVICE NAME IS MISLEADING

`CapitalPlanning` exposes both `Active_Capital_Improvement_Projects` (43 rows) and
`Completed_Capital_Improvement_Projects` (264 rows). **"Completed" is NOT a completed-only archive —
it is the FULL register**, and Active is exactly its `Construction` + `Bidding & Award` subset.

**Proven by identity, not by count:** Active's `PROJPHASE` is Construction 32 + Bidding & Award 11
= 43, and querying Completed for those same two phases returns 43 rows whose `PROJID` set contains
**every one** of Active's 43 (set difference = **0**). Wiring both would double-emit those 43 — the
`houston-plat-applications` subset trap from the polygon pass, which exact-identity dedup cannot
catch across two `source_registry_id`s. **ONE entry is wired: Completed.**

### Vocabularies — complete, each summing to EXACTLY 264

| `PROJTYPE` | n | → `use_type` |
|---|---:|---|
| Water | 153 | Utility |
| Sewer | 61 | Utility |
| Facility | 32 | Civic/Public |
| Stormwater | 18 | Utility |

| `PROJPHASE` | n | → bucket |
|---|---:|---|
| Archive | 211 | operating |
| Construction | 32 | approved |
| Bidding & Award | 11 | approved |
| Planning | 6 | proposed |
| Design | 2 | proposed |
| Survey | 1 | proposed |
| *(null)* | 1 | **unmapped — fails closed** |

`Archive` → `operating` reads a completed capital project as built infrastructure, the same reading
as `Closed - Completed` on Allegheny and `DONE` on Phoenix. **No `status_const` is used** — unlike
Summit and the three PA Act 247 entries, this layer carries a real per-record phase column, so
nothing has to be asserted. Note the register carries **no street/roadway class at all**: Dayton's
CIP is utility-heavy because the city's Department of Water serves the wider region.

### Config decisions, each measured

- **Date field chosen on live non-null counts over all 264 rows — and the semantically correct
  field won.** PROJNAME 264 / PROJDESC 264 / FISCALYR 264 / `created_date` 252 / PROJID 206 /
  `PLANSTART` 193 / ConstructionStrtDate 192 / `PLANEND` 188. `created_date` has better coverage but
  is a **GIS edit timestamp, not a project date**; `PLANSTART` (73%) is the project's own planned
  start and is used as `file_date`, `PLANEND` as `decision_date`. The 71 rows with no `PLANSTART`
  emit with no date — absent fields stay absent, never interpolated. `column_map` arrays JOIN rather
  than fall back (`readCol`), so one field must be chosen.
- **No `recency_days`, deliberately.** A window drops all 71 undated rows purely for lacking a date,
  plus the `Archive` tier the `operating` bucket exists for. Measured page lift: **22 unwindowed /
  17 at 1825 days / 19 at 3650 days**. 264 rows total, so there is no size pressure (contrast
  Henderson's 28,391, where recency was the lever).
- **Geometry** is `esriGeometryPoint`, 264 of 264 rows carrying geometry (verified by pulling every
  feature with `outSR=4326`). `column_map` lat/lng are `__lat`/`__lng`, without which every record
  silently lands on the ZIP centroid at `scope=area` (the Sussex defect).
- **Scoping is spatial at 3 mi** — the layer has no ZIP column and no address column of any kind.
- **`record_url_precision: "dataset"`** — `ProjectPath`, `ConstructionPlansPath`, `AwardedBidPath`
  and `ContractNumber` are all NULL on the sampled Construction rows and are internal file paths
  regardless, so templating a per-record URL would be guessing (Boulder / Philadelphia / Boston
  precedent). `dataset_url` is the city's own **public** Hub site application (AGO item
  `b5f930a7f4754f5ca96a44e81d558403`, `access: "public"`), live-verified **HTTP 200 / 43 KB** with
  the matching title.

### ⚠️ FRESHNESS — the weakest part of this wire, stated plainly

`max(last_edited_date)` is **2025-12-09**, about eight months before wiring, and the companion
public "Active Capital Improvement Projects" dashboard was last modified **the same day** — the two
agree, so that is the register's real vintage and not a stale mirror. `FISCALYR` tops out at **2025
with ZERO FY2026 rows**, so the register is roughly one fiscal cycle behind.

It is wired anyway, and the reasoning is on the record: this is an **annual capital-budget register,
not a daily permit feed**; it still carries a project with `PLANSTART` 2026-03-01; 43 rows are
currently in Construction or Bidding & Award; and the failure mode of staleness here is
**understating** what is being built, which is the honest direction — the same reasoning the founder
endorsed for the Act 247 `status_const`.

**🔁 REPROBE CONDITION (not open-ended):** if `max(last_edited_date)` has still not advanced past
2025-12-09 by the next fiscal cycle, or FY2026 rows never appear, re-evaluate this entry as
**STALE**.

### Coverage limit, stated plainly

These are the **CITY OF DAYTON's** capital projects. Kettering, Huber Heights, Centerville,
Miamisburg, Trotwood, Oakwood, Vandalia, West Carrollton and the rest of Montgomery County run their
own capital programs and are **not** in this layer, so Montgomery pages outside Dayton's 3-mile
reach stay dark on this source. The `coverage` declaration is county-level because that is the
registry contract's granularity — it would not have been a claim of county-wide coverage.

### Why the entry was REMOVED rather than left in place, documented

A registry entry whose fetch can never succeed still declares `coverage: [{state:'OH', county:
'Montgomery'}]`, and the coverage gate is what the config-based reading of "Live" keys on. Leaving it
would have marked all 39 Montgomery pages covered while the database held **zero** records — the
precise trap already recorded as a standing answer ("the workbook's Live column is COVERAGE-GATE
based, not record based"). Measured from the database, which is the source of truth: Montgomery OH
is **0 / 39**, unchanged, and the failed fetches wrote nothing.

---

## 🚫 TOLEDO / LUCAS OH — REJECTED (2026-08-05): `NO_TEMPORAL_FIELD`, a seventh disqualifier

**Nothing wired. Lucas stays 0 of 30.** Both orgs were confirmed by NAME, not hostname — **City of
Toledo** `2snQ88YUjP9CNEbe` and **Lucas County Auditor** `T8dczfwPixv79EgZ` — and both first-party
servers were derived from their own item URLs (the Dayton method), never guessed:
`gis.toledo.oh.gov/arcgis/rest` (10 folders + 43 root services) and
`lcaudgis.co.lucas.oh.us/gisaudserver/rest` (19 folders).

**No permit ledger and no case ledger on either server.**

- Toledo's `Public/PlanningComAppUNC10419` is a **misnomer** — despite reading as "Planning
  Commission Applications", its 8 layers are the plan commission's **basemap**: Official Zoning
  District Map Numbers, 20/20 Comprehensive Plan, Future Land Use, Zoning Districts, City Parcels,
  Jurisdictions, Overlay Districts. All reference polygons. Third instance of **read the layers, not
  the service name** (after Summit layer 0 and Dayton's "Completed").
- Lucas's `Tyler` and `TylerProduction` folders are **not empty this time** — but they hold only
  Parcels, Cadastre_Annotation, Pictometry, Road_Centerlines and Auditor GIS layers, i.e. the
  Auditor's property data. **A vendor-named folder is not a source whether it is empty or full**
  (Summit's `tyler` and Allegheny's `Accela` were empty; this one is full and still not permits).
- `data.toledo.gov` (49 datasets): the two "Toledo-Lucas County Planning Commission" entries and
  "Demolition" are **web APPLICATIONS** (Experience Builder / instant / webappviewer), not data
  layers — their only distributions are app URLs.

### The one real candidate, and why it was rejected anyway

**`Vibrancy_Projects` layer 2** (`services.arcgis.com/2snQ88YUjP9CNEbe`, a **known-reachable** host —
which after the Dayton edge block is a genuine advantage). It had a strong case: 119 rows, point
geometry, real project addresses and descriptions, **both vocabularies complete and each summing to
exactly 119** — `Incentive_Type` Facade Improvement Grant 77 / White Box Grant 32 / Planning Grant
10, and `Program_Year` reaching **2026 with 19 rows**, so genuinely current. **Measured page lift: 16
of 30 Lucas pages.**

**FOUNDER RULING (2026-08-05): REJECTED. `119/119 undated is the disqualifier, not the missing
status column.`**

> *"Every wire this project has shipped carries a real date or an honest null on a MINORITY of
> records — Dayton was 71/264 and that was already flagged. A source where NO record can be dated
> cannot answer 'what is being built now', cannot be windowed, cannot age out, and cannot be
> reprobed for staleness. It would be permanently unfalsifiable — we could never tell a live
> register from an abandoned one."*

`Program_Year` is an **INTEGER**, the same class as Delaware County PA's integer `Year` — but **there
the entry still had `Entry_Date` to fall back on; here there is nothing**. The layer's only other
date-shaped fields are geocoder output columns.

**`NO_TEMPORAL_FIELD` is a seventh disqualifier and is DISTINCT FROM `STALE`.** Stale means the dates
**stopped** — reprobing can fix it. This means there are **none** — waiting cannot. Recorded in
`docs/maps-go-live-governance.md` §0b.

### Also rejected here

**`DemoCandidates`** — 690 rows, point geometry, but **no date, no status, no case number**. Its only
attributes are `Parcel`, `Address` and `Projected_`, a free-text window ("July-December 2024",
already past), and the parent item is titled "Demo Candidates 2022". A **pre-decision candidate list
naming private residential addresses**, not a filing record — `NO_TEMPORAL_FIELD` plus the
`WRONG_RECORD_CLASS` concern that sank Dayton's Accela layer.

---

## OHIO — STATE CLOSED FOR NOW (2026-08-05). 136 / 335 live, 199 dark

Every OH county is now wired, partially wired, blocked, or exhausted on **enumeration** — none is
merely unprobed.

| County | Pages | Live | Dark | Standing |
|---|---:|---:|---:|---|
| Franklin | 49 | 45 | 4 | **wired** (Columbus) |
| Cuyahoga | 52 | 39 | 13 | **wired** (Cleveland) |
| Hamilton | 56 | 34 | 22 | **wired** (Cincinnati) |
| Summit | 41 | 14 | 27 | **partially wired** — county commission reviews UNINCORPORATED townships only; Akron and the incorporated cities run their own planning departments. A documented coverage limit, not a defect. |
| Delaware | 19 | 4 | 15 | seam off Columbus |
| Montgomery | 39 | 0 | 39 | 🔴 **BLOCKED AT THE EDGE** — source found, wired, deployed, reverted. See the Dayton section above. |
| Lucas | 30 | 0 | 30 | **exhausted** — `NO_TEMPORAL_FIELD` (this section) |
| Medina | 19 | 0 | 19 | **exhausted** — org confirmed Ohio from CONTENTS (Hinckley, Granger, Montville, Litchfield, Brunswick Hills, Wadsworth townships). 348 items: utilities, parcels, zoning, floodplain, parks, recycling. No permit or planning-case ledger; the nearest, "Medina Board of Revision Cases", is property-tax valuation appeals. |
| Butler | 15 | 0 | 15 | **exhausted** — see below |
| Warren | 15 | 0 | 15 | **exhausted** — see below |

**Butler + Warren, with receipts.** Plain `"Butler County" AND Ohio` / `"Warren County" AND Ohio`
searches returned 177 and 97 results dominated by cross-state noise (Indiana DNR, Virginia Tech
student orgs, Miami University) — the standing search-lies rule. Two real first-party owners
surfaced:

- **`comgisservice` = the City of Monroe, Ohio** (confirmed from contents: it publishes "Monroe
  Parcels in Butler County" *and* "Monroe Parcels in Warren County" — the city straddles the line).
  Its 50 items are reference cartography plus `Subdivisions`, `Monroe Planning and Zoning` and
  `City of Monroe Annexation Records`. Monroe's population is ~15k, so the achievable page lift is
  negligible; logged, not wired.
- **OKI Regional Council of Governments** `AeX7yhXqx2UBQyL7` — the Cincinnati-area MPO covering
  Butler, Warren, Hamilton and Clermont. Its 312 items are planning studies (bike level-of-stress,
  heat islands, job hubs, watersheds, freight plan). Its one project-shaped layer,
  **`Prioritization_Projects_2026`, is REJECTED**: 62 **polylines** whose only classification is
  `NoteType`, an **opaque SmallInteger**, with `Name`/`Notes` free text, **no status column and no
  project date** (only `created_date`/`last_edited_date` edit stamps). Opaque coded vocabulary with
  nothing to map verbatim is the **San Jose `planningpermits30`** rejection class; combined with the
  missing date this is a map-markup layer, not a project register.

**🔁 REPROBE CANDIDATES, named:** **Dayton** — the only OH county with a *found, verified, correctly
configured* source. Its `_receipts` and this document carry the full config; if the edge-egress block
lifts it is a one-object re-add. Nothing else in OH is waiting on time.

---

## MISSOURI PASS (2026-08-05) — 3 sources wired, every county closed on enumeration

MO opened at **53 / 264 live (20.1%), 211 dark**. Six counties sat at 0% and held 156 of the 211 dark
pages (74%) — the same shape as Ohio: metro builds, not trim. County distribution was measured
**before** probing, per the standing rule.

### WIRED (3)

| Entry | County | Rows | Measured dark-page lift |
|---|---|---:|---:|
| `stlouis-county-mo-subdivisions` | St. Louis | 42 | **18** (native ZIP; 33 by 3-mi spatial) |
| `kcmo-development-cases` | Jackson · Clay · Platte · Cass | 2,675 in-window (23,166 total) | **14** (J+9 · Cl+2 · P+2 · Ca+1) |
| `columbia-mo-capital-projects` | Boone | 370 | **2** |

Full config reasoning, vocabularies and arithmetic in each entry's `_receipts`. Three findings worth
lifting out:

- **The 1825-day window on KCMO is load-bearing, not conventional.** Unwindowed, `STATUS` is dominated
  by `Closed` at 16,370 of 23,166 (71%) — a terminal state with no recorded *outcome*, so it supports
  neither an approved nor an operating claim. Inside 1825 days `Closed` **disappears entirely** and the
  vocabulary is 17 self-describing values summing to exactly 2,675. `Closed` is nonetheless mapped to
  `exclude`, because the window moves: a case filed 2024 and closed 2027 will be both in-window and
  Closed, and that must fail to a decision already made rather than to silence.
- **Native ZIP beat spatial on St. Louis, and the cheaper number was not chosen.** 18 exact pages via
  `PROP_ZIP` over 33 estimated pages via a 3-mi radius — the standing convention that a real ZIP column
  is exact where a radius is an estimate.
- **A fourth vendor-named folder that is not a source.** St. Louis County's own `Accela` folder holds
  only `Accela_Parcels`. The tally is now Summit `tyler` (empty), Allegheny `Accela` (empty), Dayton
  `Accela` (full — housing code enforcement), St. Louis `Accela` (full — parcels). **Content decides.**

### GO-LIVE MEASURED (2026-08-05, post-deploy, both tables)

| | before | after |
|---|---|---|
| MO live / dark | 53 / 211 (20.08%) | **83 / 181 (31.44%)** |
| national | 4,604 (36.19%) | **4,636 / 12,722 (36.44%)** |

**+30 MO pages.** Per-county: St. Louis 0 → **16** · Jackson 32 → **39** · Boone 4 → **6** ·
Clay 11 → **13** · Platte 6 → **8** · Cass 0 → **1**.

**Identical in both tables, 0 invariant violations:** `stlouis-county-mo-subdivisions` 39 records /
16 ZIPs, `kcmo-development-cases` 1,074 / 13, `columbia-mo-capital-projects` 882 / 3 — the same counts
in `development_reports` and `app_projects`, with **0 records missing `record_url`** and **0 point
records missing coordinates**.

**Bidirectional gate proof, live receipts:** `stlouis-county-mo-subdivisions` rides **MO/St. Louis
only** (16 ZIPs); `kcmo-development-cases` rides **only** Jackson 8 / Clay 2 / Platte 2 / Cass 1 — its
four declared counties and nothing else; `columbia-mo-capital-projects` rides **MO/Boone only** (3).

⚠️ **THE NEW-HOST DEPLOY VERIFICATION PASSED — and it was read the right way.** `mapd.kcmo.org` had
never been fetched by the engine. Per governance §0 the first post-deploy re-cache was read from
`arcgis_reports[]`, not from `counts`: `kcmo-development-cases f=838 e=664` on ZIP 64108, alongside
`stlouis-county-mo-subdivisions f=8 e=8` and `columbia-mo-capital-projects f=283 e=283`. Unlike
Dayton, this new host is reachable from the Deno edge runtime. **The first probe fired ~1 minute after
the deploy queued and returned an EMPTY `arcgis_reports` — a pre-deploy response.** Re-probed after
the deploy completed; that is the trap §0 exists for, and it was caught by waiting rather than by
reading a zero as a verdict.

**Measured vs predicted:** St. Louis 16 against a predicted 18 (two of the layer's 18 ZIPs are not
modelled as St. Louis County pages), KCMO 13 against 14, Columbia 3 against 2. Close enough to
confirm the pre-wire method, and the measured number is the one that counts.

### REJECTED, with receipts

| County | Candidate | Verdict |
|---|---|---|
| St. Louis | `AGS_ZoningPetitions` (3,945 rows) | `NO_TEMPORAL_FIELD` — **0 of 3,945** dated, `max(last_edited_date)` null. Also opaque *and* dirty: 62% blank, petition numbers (`32-15`, `44-25`) leaking into the procedure column |
| St. Louis | `Active_Construction` Points/Lines | `NO_TEMPORAL_FIELD` — no date field in the schema. (Both 404'd on `/0`: `preserveLayerIds: true`, real ids **101**/**100**, and the 404s arrived as **HTTP 200 carrying an error object**) |
| St. Louis | `PlanningLocationBasedProto` | `WRONG_RECORD_CLASS` — marijuana/tobacco/liquor/childcare **licences** |
| St. Louis **city** | `rdx.stldata.org` | **UNREACHABLE** — re-probed, TLS handshake blackhole. See its own corrected entry |
| Jackson | KCMO BLDS `ntw8-aacc` | **STALE, re-probed and unmoved** — `max(:updated_at)` = `2025-05-09T20:22:20.907Z`, byte-identical to the 2026-07-17 record over 681,036 rows. Three further months, no movement. Stays on the reprobe list |
| Jackson | `BW_NewCommercial_Permits` | Real but **1 page** of lift (797 rows, only **5 distinct ZIPs**), stale 14 months, and `BW_` + 100 `USER_bldg_type_*` columns mark it a one-off study extract. Recorded, not wired |
| St. Charles | `Conditional Use Permit` (707) | **Free-text prose statuses** — `CC_DECISIO` has ~300 distinct strings (`APPROVAL 05/31/00; BILL#1629; ORD #00`, `DENIAL 8/08/05`, `WITHDRAWN 12-31-97`). Nothing to map verbatim — the **Douglas County NV** class |
| St. Charles | `Board of Zoning Adjustment` (1,110) | Opaque, dirty `VOTE`: `D-OT`, `D-OVERTU`, `D/G`, `G G`, `G/D`, `SeeComme`. Undecodable without a legend — the **San Jose `planningpermits30`** class |
| St. Charles | `Zoning Application` (735), `PUD` (47) | `NO_TEMPORAL_FIELD` — no date field |
| St. Charles | `gis.sccmo.org` | **Cloudflare 403 challenge** on the production host. (`gis-dev.sccmo.org` answers 200 and carries the same service — noted, but the layers there were rejected on content anyway) |
| Greene | Springfield org `aOss8CrQf3pARS5q` | `candidates_exhausted` — entity confirmed by name; only redevelopment-area polygons (Ch. 99 / Ch. 353), comprehensive-plan goal layers and `Springfield Subdivisions`. No permit or case ledger |
| Boone | Columbia org (68 services) | Only the CIP register (wired). No permit or case ledger — the rest is parks, trails, canopy, outages, water |
| Franklin · Jefferson | — | `candidates_exhausted` — no first-party org found. Content-scoped searches returned only cross-state noise (Indiana DNR, Virginia Tech, BLM national) and personal accounts with no `orgId` |

**Cross-state trap avoided:** `wcgis` resolves to **Westchester County GIS (NY)**, not Warren County —
recorded during the OH pass and re-confirmed here. Every MO org was verified by returned `name`, and
St. Louis County MO was further confirmed from **contents** ("St. Louis City Boundary Map", "Promise
Zone Developments") against the St. Louis County **Minnesota** namesake.

**Generic-portal control, worth reusing:** five of six urlKey guesses returned byte-identical
**12,477-byte** responses (the anonymous ArcGIS portal); only the real org differed at 18,684 bytes.
Response size is a cheap discriminator for "this subdomain is not an org".

---

## ILLINOIS PASS (2026-08-05) — 3 sources wired, every county closed on enumeration

IL opened at **139 / 474 live (29.3%), 335 dark** — the largest remaining block. County distribution was
measured **before** probing. Shape matched the OH/MO pattern: seven counties at 0% holding 176 dark
pages, plus a **suburban Cook seam of 85** left over after `chicago-building-permits` covers the city.

**⚠️ CHECK THE REGISTRY BEFORE PROBING.** Two IL entries already existed — `chicago-building-permits`
(Cook/DuPage/Lake) and `naperville-building-permits` (DuPage/Will). Discovery independently
"found" Naperville's two permit tables and measured their lift as ~1 page, because its four main ZIPs
(60540 · 60563 · 60564 · 60565) were **already live at 484 / 480 / 333 / 204 records** from the
existing entry. A registry grep is a two-second step that would have skipped that whole branch.

### WIRED (3)

| Entry | County | Rows | Measured dark-page lift |
|---|---|---:|---:|
| `cook-county-il-highway-construction-program` | Cook | 70 | **78 of 85** |
| `lake-county-il-construction-program` | Lake | 39 | **23 of 31** |
| `champaign-il-special-use-permits` | Champaign | 54 | **9 of 33** |

Three findings worth lifting out of the `_receipts`:

- **A season string is not a date, but an edit-stamp date can be.** Cook DOTH's obvious timing field
  `start` is `Spring 2026` / `Fall 2025` — 70/70 populated and unparseable, the `Program_Year` class.
  The layer nonetheless carries `CreationDate`, a real `esriFieldTypeDate` populated **70 of 70** and
  spanning **2026-04-14 → 2026-06-25**, entirely inside the program year the service is named for.
  That is an honest "entered the 2026 program" date and the UDOT `created_dt` precedent.
  **`NO_TEMPORAL_FIELD` means there are NO dates — not that the best-named field is unusable.**
- **`Conforming` is a compliance state, not a lifecycle state.** Champaign's SUP status is exactly
  `Conforming` / `Expired`. Conforming → **operating** (the permitted use is in effect on the ground),
  not `approved`, which would imply a recent decision. Expired → exclude.
- **Same service, adjacent layer, opposite verdict.** Champaign layer 19 `Zoning - Planned
  Developments` has the same 54-row scale, a Status column and a FolderLink — and its only dates are
  `created_date` / `last_edited_date`, GIS edit stamps. Layer 20 was wired because it carries
  `Effective_`, `Site_Visit` and `Expiration`: dates about the permit, not about the GIS record.

### REJECTED, with receipts

| County | Candidate | Verdict |
|---|---|---|
| Madison | `MadisonCounty_DevelopmentChange_1995_2025` | `NO_TEMPORAL_FIELD` — 324 polygons whose entire schema is `LOCALE`, `LOCALE2`, `TYPE`. A 30-year land-use change study, not a filing register |
| Winnebago | Rockford `CIP Web Map` | `NO_TEMPORAL_FIELD` — 90 points, fields are `name`/`TabName`/`description`/`pic_url`/`shortlist_id`/`tab_id`: an Esri **Shortlist app** data layer with no date of any kind. ⚠️ **Corrects the prior "Rockford org live but 0 permit services"** — a CIP Feature Service *does* exist; it is simply not wireable. Full org enumerated (100 items): wards, hydrants, snow routes, fire stations, neighbourhood associations |
| Kane | `Kane 2020 Transportation Plan Projects` | Integer `COMP_YE` year only (the `Program_Year` class), CSV-join field names, item stale 2023-09-05 |
| McHenry | `Woodstock_OpenGov_Permit` | **1 row**, schema `TOWNSHIP` + edit stamps — a boundary polygon. The name promises a permit register and delivers none |
| Champaign | layer 19 `Zoning - Planned Developments` | `NO_TEMPORAL_FIELD` — GIS edit stamps only |
| Lake | layer 1 `Construction Project Lines` | Companion half of the wired points layer (15 rows). Deliberately **not** wired: emitting the same project under two `source_registry_id`s is the houston-plat class, which exact-identity dedup cannot catch |
| DuPage | county org | Only `Adopted_Highways_and_Trails` / `DuPage_Highways` reference layers |
| Will | — | `willcounty` resolves to a generic **"Hub Community"**, not the county's org |
| Kane | Aurora org (217 services) | `AFD_FirePrev_Permits_Dates` — fire-prevention inspections, `WRONG_RECORD_CLASS` |
| Kendall | Oswego / Yorkville | `Oswego Economic Development`, `2024_Zoning_Map` — web maps and reference zoning |
| LaSalle | — | 1 page; no first-party org found |

**Cross-state trap caught:** a search for Kane County transportation projects returned
`bdavis1@utah.gov_uplan :: Kane County Projects` — **Kane County UTAH**. Lake County was the flagged
risk (it exists in IL, IN, OH, FL, CA and MN); its org returns the name *"Lake County Illinois GIS"*
and its contents are Lake County Illinois routes, so entity was confirmed by name **and** contents.

**Coverage ceilings, stated plainly:** Cook and Lake are **county highway programs** — Cook's 130+
suburbs and Lake's municipalities run their own work and are not in these layers. Champaign is the
**city** only; Urbana, Rantoul, Savoy and unincorporated Champaign County are not.

### ILLINOIS GO-LIVE MEASURED (2026-08-05, post-deploy, both tables)

| | before | after |
|---|---|---|
| IL live / dark | 139 / 335 (29.32%) | **255 / 219 (53.80%)** |
| national | 4,636 (36.44%) | **4,752 / 12,722 (37.35%)** |

**+116 pages** — the largest single-state gain in the run. Per-county: **Cook 131 → 211** (dark 85 → 5) ·
**Lake 0 → 27** (dark 31 → 4) · **Champaign 0 → 9** (dark 33 → 24). All three beat or matched their
pre-wire estimates (78/23/9 predicted; 80/27/9 delivered).

Deploy verification read from `arcgis_reports[]`, not counts:
`cook-county-il-highway-construction-program f=1 e=1` (60453) ·
`lake-county-il-construction-program f=7 e=7` (60085) ·
`champaign-il-special-use-permits f=48 e=36` (61820).

**Gate proof, live receipts:** Cook rides **IL/Cook only** (81 ZIPs) · Champaign **IL/Champaign only**
(9) · Lake **IL/Lake only** (27). **0 records missing `record_url`** across all three.

### ⚠️ DEFECT FOUND AT VERIFICATION — the arcgis connector does not flatten `esriGeometryMultipoint`

`lake-county-il-construction-program` writes **77 records across 27 ZIPs in `development_reports` and
ZERO into `app_projects`**. Cook (polyline) and Champaign (polygon) materialized normally; Lake did
not. Cause, read from the shipped code: `featurePoint()` in `sources/arcgis.ts` resolves a pin from
`g.x/g.y`, then the server `centroid`, then polygon `rings`, then polyline `paths` — **there is no
branch for `g.points`**, the multipoint geometry array. Lake's layer 0 is `esriGeometryMultipoint`, so
every record falls through to no coordinate, is correctly labelled `scope: "area"`, and is anchored at
the report centroid (the established, correct behaviour for area items). `app_projects` carries only
point-scope records, so the rail is empty for Lake.

**The pages are genuinely live and nothing is fabricated** — 77 real, dated, sourced records render in
the list on 27 Lake pages. What Lake does not get is per-project map pins or a rail entry.

⚠️ **AND THE INVARIANT CHECK PASSED VACUOUSLY.** The standard check is "0 point-scope records missing
coordinates". Lake returned **0** — because it has *no point-scope records at all*. A count of
violations among a class that is empty is not evidence the class is healthy. **Always report the scope
DISTRIBUTION alongside the violation count**, which is what surfaced this. Same family as the
`app_changes` vs `app_community_meta` mistake: an instrument must prove it ran over something.

**This is a connector code change (one branch in `featurePoint()`), which is outside the
registry-only autonomy grant — flagged, not made.** Fixing it would convert Lake's 77 area records
into pinned point records and populate the rail; the expected shape is a mean of each feature's
`points` array, exactly as `rings` already degrades to a mean vertex.

## ✅ MULTIPOINT GEOMETRY FIX — `lake-county-il-construction-program` now pins (2026-08-05)

**The defect.** `featurePoint()` in `sources/arcgis.ts` resolved a pin from point geometry,
the server's `centroid`, polygon `rings` and polyline `paths` — but **not
`esriGeometryMultipoint`**. A multipoint layer therefore produced records with **no
coordinates**, which fall through to `scope: "area"`, anchor at the report centroid, and are
**dropped by the point-scope-only `app_projects` materializer**.

Found live the day Illinois closed: Lake had **77 records across 27 ZIPs in
`development_reports` and ZERO in `app_projects`**, while the polyline (Cook) and polygon
(Champaign) entries wired the same day materialized normally. Nothing was fabricated and the
records still rendered in the list — but **27 Lake pages served dated records with no pins**.

**The fix.** One branch, last in the chain: the **mean of the feature's `points` vertices** —
the same degradation the polygon branch already uses when a ring encloses zero area. A
multipoint feature has no interior and no length, so there is no centroid or midpoint to
derive; the mean IS the honest representative point. An empty `points` array still yields
`null` — never a fabricated pin. Because the branch sits after `x/y`, `centroid`, `rings` and
`paths`, **no existing source can change behavior** (asserted by branch-order unit tests).

**PRE-DEPLOY AUDIT — Lake was the ONLY multipoint entry.** Scope distribution by
`source_registry_id` cache-wide: Lake 0 point / 77 area (100%). The other high-area entries
were probed live and all return `geometryType: esriGeometryPoint` —
`butler-county-ks-permits` (86.8% area), `pierce-county-pals-permits` (82.7%),
`clark-county-active-dev-permits` (25.1%); their registry entries carry no lat/lng columns, so
they **geocode**, and their area records are geocode failures. A different cause, correctly
labelled. **Nothing had been degrading silently elsewhere.**

**Verified post-deploy** (deploy run 30965128296, `6bfa082b`, green 01:01:49Z; all 31 Lake rows
`refreshed_at` 01:04Z, i.e. after the deploy — the §0 ordering trap avoided):

| measure | before | after |
|---|---|---|
| Lake records checked | 77 | **80** |
| `scope: "point"` | 0 | **80** |
| `scope: "area"` | 77 | **0** |
| pinned at report centroid | 77 | **0 of 80** |
| pinned at own point | 0 | **80 of 80** |
| missing coordinates | — | **0 of 80** |
| missing `record_url` | — | **0 of 80** |
| `app_projects` rows | **0** | **80 across 28 ZIPs** |

The **centroid-vs-own-point control is what proves it is a real fix and not a relabel**: under
the old code every record carried its report's `home_lat`/`home_lng`. Now 0 of 80 equal the
report centroid, and the pins span lat 42.1638–42.4940 / lng −88.1704 to −87.8273 — which is
Lake County IL (Waukegan, Gurnee, Barrington). Counting "records with a non-null lat" would
have passed **both before and after** and proven nothing.

### ⚠️ STANDING ANSWER — the `pg_net` worker can STALL, and a stall is indistinguishable from a dead host

Mid-session the queue held at **256 requests with `min_id` frozen at 9817** across two
observation windows; `max(id)` in `net._http_response` was 9816, so **nothing was being
collected at all**. Every probe fired in that window would have read as "no response" — i.e.
as an unreachable host — and any `EDGE_EGRESS_BLOCKED` / `UNREACHABLE` verdict recorded from
it would have been fabricated from an instrument failure.

- **The signal is `min(id)` in `net.http_request_queue` not moving**, not the queue depth (a
  deep queue that is draining is healthy — 50 engine calls at a 90 s timeout legitimately
  take minutes).
- **The remedy is `select net.worker_restart();`** — it took the queue 256 → 56 within 60 s.
- **Always pair a queue read with the control** `select max(id) from net._http_response` before
  concluding a host is unreachable. A missing response id is not a host verdict.


## MICHIGAN PASS (2026-08-05) — `mdot-stip-projects` wired; county-level candidates enumerated

**Shape first (the standing rule: measure the county distribution before probing).** MI is
**360 modeled ZIP pages, 50 live, 310 dark**. The registry grep — now the standard opening
move — showed 5 pre-existing MI entries, ALL city/township scoped: `detroit-building-permits`,
`detroit-trades-permits`, `detroit-demolition-permits` (Wayne), `ann-arbor-energov-permits`
(Washtenaw), `independence-twp-construction-permits` (Oakland). No county-level and no
statewide source existed.

| county | ZIP pages | live | dark |
|---|---|---|---|
| Oakland | 87 | 9 | **78** |
| Wayne | 76 | 32 | 44 |
| Macomb | 40 | 0 | 40 |
| Kent | 37 | 0 | 37 |
| Genesee | 26 | 0 | 26 |
| Ingham | 24 | 0 | 24 |
| Ottawa | 19 | 0 | 19 |
| Monroe | 17 | 0 | 17 |
| Livingston | 13 | 0 | 13 |
| Washtenaw | 20 | 9 | 11 |
| Shiawassee | 1 | 0 | 1 |

⚠️ **The state-level framing was again a hypothesis, not a brief.** "310 dark" reads as a
uniform gap; the measurement says Oakland alone is a quarter of it, and 8 of 11 counties have
**zero** wired source rather than partial coverage.

### WIRED — `mdot-stip-projects` (statewide MI)

See the registry entry's `_receipts` for the full evidence. Headline: MDOT's own
`Planning/MdotStip` layer 2 'STIP All Projects (Points)', 3,742 point rows, both vocabularies
complete and each summing exactly to 3,742, `PHASE_SCHD_OBLG_DATE` 3,742/3,742 non-null,
FY2026–FY2029 (current program), all 83 MI counties present, all 11 modeled counties
represented (1,866 rows). Only the point union is wired — layers 1/3/4 are subsets or the same
projects as segments.

### REJECTED, with receipts

- 🚫 **Oakland County's own GIS — `WRONG_RECORD_CLASS`.** Real host recovered as
  `gisservices.oakgov.com` (the guesses `gisrest.oakgov.com` and `gis.oakgov.com` are DNS-dead
  and 404). Its `Enterprise` folder was enumerated in full: 13 MapServices, and the only
  development-sounding layer, `EnterpriseOpenPlanningMapService/2 'Development Authority'`,
  is by **its own description** *"The DevelopmentAuthority polygon feature class identifies
  certain types of entities … Downtown Development Authorities (DDA), Tax Increment Finance
  Authorities (TIFA)"* — **district boundaries, not filings.** The rest are `Current Land Use`,
  `Composite Master Plan` and administrative districts. No per-record permit layer exists.
- 🚫 **Ottawa County — `candidates_exhausted` on enumeration.** Real host `gis.miottawa.org`
  (the `data-miottawa.opendata.arcgis.com` guess 404s "Domain record(s) not found"). Both
  service folders enumerated in full; the only permit-adjacent services are
  `BuildingFootprints`, `Buildings`, `CompleteBuildings` and `MasterPlanZoning` — **0 permit
  services**.
- 🚫 **Grand Rapids / Kent — `STALE`.** The city's AGO org is real (`L81TiOwAPO1ZvU9b`,
  confirmed via `portals/self`, not guessed) and holds 2,008 items. Its only per-record
  construction layer, `CGR_Construction_Projects/FeatureServer/0` (4,488 polygon rows), is
  **frozen**: max `FiscalYear` **2023**, max `ProjectedStartDate` **2022-07-01**, max `EDATE`
  **2017-10-05**. It is also thinly dated — `ProjectedStartDate` non-null on only
  **1,441/4,488 (32%)** and `EDATE` on **172/4,488** — the Dayton 71/264 class. Stale is the
  governing disqualifier; the dating would have been a second flag. `Eng_RoadConstruction`
  (1,114 rows) carries the same schema with shapefile-truncated field names — an older export
  of the same data, not an independent source. The remaining permit-named services in that org
  are **aggregates** (`EPA_4_1_(A) Number of New Dwelling Units Permitted`,
  `Multi_Family_New_Construction_Stats_2011_to_2018_YTD`) or **districts/zoning**
  (`Zoning_All_Types`, `Downtown_Development_Authority_Boundary`,
  `Development_Opportunity_Parcels`). → nightly reprobe list.
- 🚫 **Michigan statewide, non-DOT.** The ArcGIS Hub datasets API over MI returns exactly one
  state permit dataset, EGLE `Groundwater Sanitary Discharge Permits` — an environmental
  authorization for an existing facility, i.e. the `facilities` class, not a development
  filing.

### Method notes added this pass

- **URL-guessing county GIS hosts is not discovery.** All 8 first-pass host guesses failed
  (3 DNS-dead, 4 404, 1 "Invalid URL"); every real host in this pass — `gisservices.oakgov.com`,
  `gis.miottawa.org`, `mdotgis.state.mi.us`, `maps.grcity.us`, `services2.arcgis.com/L81Ti…` —
  was recovered from **item URLs inside AGO search results**, never typed from a pattern.
- **A username suffix is a derived org key, not a guess.** `akaka@grand_rapids.mi.us_grandrapids`
  yields `grandrapids.maps.arcgis.com`, whose `portals/self` returned the real org id. That is
  materially different from typing `<city>.maps.arcgis.com` and reading the generic anonymous
  portal — the standing trap. `lansing.maps.arcgis.com` did exactly that and returned nothing.


## ELEVEN ZERO-COVERAGE STATES — STATEWIDE DOT DISCOVERY PASS (2026-08-05)

Scope: the 11 states with **zero** live pages and no registry coverage of any kind — 2,159 pages
where a statewide DOT wire is the ENTIRE play. **Discovery is complete for all 11; NOTHING IS
WIRED YET** (the wiring, deploy and go-live measurement are the next step, deliberately not
rushed). Every finding below is a live probe receipt.

### Verdicts

| state | pages | verdict | source / reason |
|---|---|---|---|
| **NJ** | 359 | ✅ **WIREABLE** | `NJDOTGIS` `Tran_STIP_24_33`, 264 polyline |
| **ME** | 273 | ✅ **WIREABLE** | `MaineDOT_OpenData` Public Projects Points, 1,109 **multipoint** |
| **IA** | 225 | ✅ **WIREABLE** | `IowaDOT_GIS` PSS Public Bid Point, 362 point |
| **VT** | 212 | ✅ **WIREABLE** | `maps.vtrans.vermont.gov` Project Point Locations, 1,037 point |
| **RI** | 81 | 🟡 **WIREABLE, multi-entry** | `risegis.ri.gov` RI STIP FFY18-27, **15 program-split layers** |
| **AK** | 101 | 🚫 `NO_TEMPORAL_FIELD` | `AKDOT_GIS` STIP 24-27 Final: 2,282 points, real `Status`, but **ZERO date-typed fields** |
| **WV** | 212 | 🚫 `candidates_exhausted` | `owner:WVDOT_Publisher` enumerated — 64 items, **0** project/STIP services |
| **NH** | 247 | 🚫 no first-party source | `owner:NHDOT` → **0 items** (no such org); `NHDOT_Projects` is owned by a personal account |
| **OK** | 197 | 🚫 no source found | 2 query shapes → 0 ODOT project services |
| **ND** | 155 | 🚫 no first-party source | hits are City of Minot (`maps.minotnd.org`) and a consultant, not NDDOT |
| **HI** | 97 | 🚫 no source found | 13 items, 0 project services |

**Wireable total: 1,150 pages (NJ+ME+IA+VT) + RI 81.** Rejected: 1,009 pages across 6 states.

### Per-source evidence

**NJ — `Statewide_Transportation_Improvement_Program_STIP_Project_Locations/0`** (services.arcgis.com,
owner `NJDOTGIS`). Layer 0 = `Tran_STIP_24_33`; the service's own description opens *"Federal
legislation requires that each state develop one multimoda[l]…"* — it is the STIP. 264 rows,
polyline (rides `featurePoint`). Dates: `PROJ_RECD` **246/264 non-null**, max **2023-08-03**;
`DESCRIPTION_UPDATE` max 2023-03-24; `AWARD_DATE` **entirely null**; `UPDATED_DATE` max 2012-10-26
(a decoy — do not pick it). ⚠️ **No usable status**: `CMSSTATUS` is BLANK on **253 of 264**
(blank 253 + "N/A" 8 + "Determination Required" 3 = 264 exact) → needs `status_const`, bucketed
`proposed` per the MDOT `Programmed` precedent. The program is current (FY_2024…FY_2033 funding
columns) even though the date columns lag.

**ME — `MaineDOT_OpenData/MapServer/4` "Public Projects Points"** (gis.maine.gov, owner
`MaineDOT_OpenData`). 1,109 rows, **`esriGeometryMultipoint`** — ⚠️ **this source is only
wireable because of the multipoint fix shipped earlier today**; before it, Maine would have wired
and produced records with NO coordinates, exactly the Lake County IL failure.
⚠️ **Use `reporting_status`, NOT `proj_status_code`.** `proj_status_code` is **opaque numeric
codes** with **no coded-value domain** ("10" 647, "20" 311, "01" 53, "54" 41, "60" 37, "63" 15,
"50" 5 = 1,109 exact) — the San Jose "30" fail-closed class. `reporting_status` on the SAME layer
is **self-describing** and also sums exactly: "2 - Design/Permitting Phase" 503 · "4 - Construction
Complete" 414 · "1 - Awaiting Kick-Off" 117 · "3 - Construction Phase" 75 = **1,109**.
**Never let an opaque field decide when a self-describing one exists on the same layer.**
Dates are thin — best fields are `ko_actual` **503/1,109** and `conbegin_forecast` **501/1,109**
(others: `ko_forecast` 117, `conbegin_actual` 73, `concomp_forecast` 72), so **a majority of rows
are undated**; wire with a window that requires a date and **state the ceiling** (~503 of 1,109).
Layer 5 is the same projects as lines (1,138) — wire points only.

**IA — `Project_Scheduling_Public_Bid_Point_View/0` "PSS Public Bid Point"** (services.arcgis.com,
owner `IowaDOT_GIS`). 362 rows, point, native `COUNTY_NAME`. `STATUS` is a clean 4-value
vocabulary summing EXACTLY: Awarded 206 · Completed 120 · Active 35 · New 1 = **362**.
`CONTRACT_AWARDED` **322/362 non-null**. ⚠️ **The obvious candidate is the WRONG one**: Iowa's
"Five Year Program Projects" (668 rows) is the named STIP equivalent but has **no date-typed
column at all** — only integer `Year2` — i.e. `NO_TEMPORAL_FIELD`, the Toledo class. The Bid Point
layer is smaller but dated and statused. **STALE-but-dated**: content dates stop at
`CONTRACT_AWARDED` 2023-10-02 / `CONSTRUCTION_ACTUAL_START` 2022-08-01 while the edit stamp
`REST_UPDATED` is 2026-01-28 → wire it, state the span, set a reprobe condition.

**VT — `Master/AMP/FeatureServer/10` "Project Point Locations"** (maps.vtrans.vermont.gov).
1,037 rows, point, richest schema of the group (7 date fields, `County`, `Town`).
**FRESH — `PublishDate` max 2026-08-02, three days before this pass**; construction starts run to
2033. ⚠️ Status is sparse: `ProjectStatus` null 636 + ACTIVE 350 + ON HOLD 50 + CANCELLED 1 =
1,037 exact (**39% statused**), and `ConstructionStatus` is WORSE (null 954 = 92%). `County`
populated 795/1,037. So `ProjectStatus` is the field, with a stated ceiling of ~401 emitting rows.
Layer 9 (segments, 588) is the same projects — wire points only.

**RI — `STIPMap_1827_Amend26`** (risegis.ri.gov, owner `DOA_C.DelageBaza` — RI Dept of
Administration administers the RI STIP, so first-party). ⚠️ **Slow host**: pg_net **timed out at
30 s** (29.7 s in the HTTP response phase) and succeeded at **90 s** — a timeout here is NOT a dead
host, and the §0 edge-runtime question is wide open for it. Structure is the blocker: the STIP is
**split across 15 program-specific layers** (Bridge / Pavement / Drainage / Traffic Safety / TAP /
Transit Capital, each × points and lines) rather than one union — so RI is several registry entries
with a subset-identity proof per pair, not one wire. Smallest prize (81 pages); deferred.

### Method notes

- **The generic query out-performed the per-state queries.** `q=STIP transportation improvement
  program` surfaced first-party DOT STIP layers that the targeted `"<State> DOT projects"` searches
  missed — including NJ's real STIP (the per-state search had only found a stale
  `ConstructionMap_2019`) and AK's. It also surfaced leads for LATER states: **NCDOT**
  (`gis11.services.ncdot.gov` NCDOT_STIP), **WisDOT** (`dotmaps.wi.gov` STIP Projects 4-Year),
  **TDOT** (`spatial.tdot.tn.gov` Tennessee STIP Projects), **MDT Montana**. NC/WI/TN are all in
  the "coverage but no statewide entry" list.
- **Third-party copies are not first-party.** NJ, ME, NH and ND all surfaced project layers owned
  by consultants, universities or personal accounts (`ljmarxen_rutgers`, `hk1071`,
  `ulteiginnovation`, `pjacques@vhb.com_VHB`). Only the DOT-owned service counts.
- **A named "STIP" layer is not automatically the right one** — Iowa's is dateless while its
  humbler Bid Point layer is fully dated and statused. Check the fields, not the title.

## 🚫 RHODE ISLAND — REJECTED (2026-08-05): `NO_TEMPORAL_FIELD`, all 15 layers enumerated

**RI is the last of the eleven zero-coverage states, and it closes the pass.**

Source examined: **`risegis.ri.gov/hosting/rest/services/RIDOA/STIPMap_1827_Amend26/MapServer`**
— the RI STIP FFY 18-27 (Amendment #26), owner `DOA_C.DelageBaza`. **First-party**: the RI
Department of Administration administers the state STIP, so provenance was never the issue.

### The structural question turned out to be MOOT — state that plainly

The open design question was whether the 15 program-split layers are **disjoint programs**
(→ separate registry entries, fine) or **a union and its parts** (→ wire the union only and prove
the subset by identity). The enumeration answers it: every layer carries the SAME schema keyed on
**`TIPID`** + **`TIPprogram`**, i.e. they are **disjoint program partitions** of one master TIP
table — Bridge Capital, Pavement Capital, Drainage Capital, Traffic Safety Capital, TAP, Transit,
Maintenance Capital & Operations, Truck Toll Facilities — each published as Points and/or Lines.
So they would have been separate entries.

**But it does not matter, because the source is disqualified before that decision is reached.**
Do not re-open the 15-layer question: it is downstream of a test the source already fails.

### The disqualifier — measured across ALL 15 layers, not a sample

| layers | geometry | date-typed fields |
|---|---|---|
| 0–6 (Truck Toll, TAP-Pts, Transit-Pts, Maintenance, Drainage, Bridge, Traffic Safety-Pts) | point | **0** |
| 7–13 (Transit-Lines, SRTS Details, TAP-Lines, Bridge-Line, Traffic Safety-Lines, Drainage-Line, Pavement) | polyline | **0** |
| 14 (Drainage Capital) | polygon | **0** |

**Zero `esriFieldTypeDate` / `esriFieldTypeDateOnly` fields in any of the 15.** The only temporal
signal is the funding columns **`FY2018` … `FY2027`** — per-fiscal-year dollar amounts, which is
the same class as Iowa's integer `Year2` and Toledo's `Program_Year`: **a programme year is not a
date.** A source where no record can be dated cannot be windowed, cannot age out, and cannot be
reprobed for staleness — permanently unfalsifiable.

**Consistent with the AK ruling in the same pass**: Alaska's STIP has 2,282 points and a real
`Status` column and was still rejected on exactly this test. Rhode Island is the same verdict on
the same evidence.

### Also noted (not the governing reason)

The host is **slow but healthy** — it times out at a 30 s pg_net timeout and answers cleanly at
90 s. That was an acceptable risk given both state DOT hosts (`gis.maine.gov`,
`maps.vtrans.vermont.gov`) verified clean against the edge runtime this same session, so **the
host was never the blocker**. The programme is also FFY **2018-2027** with the only alternative
being `Old_STIP_1827_Amend3` — i.e. no newer published RI STIP map exists to prefer.

**81 pages stay on the EPA facilities floor.** → nightly reprobe list; revisit if RIDOA publishes
a STIP layer carrying real dates.

## NEW YORK — NO STATEWIDE SOURCE EXISTS (2026-08-05). NY must be done county-by-county

**Shape measured first (764 pages, 233 live, 531 dark).** Registry grep: all **12** existing NY
entries are sub-state scoped — `nyc-dobnow-approved-permits` and `nyc-dob-permit-issuance` (the
five boroughs + a Nassau declaration) and `buffalo-building-permits` (Erie). No county-level and
no statewide entry existed, which under §0c makes the statewide DOT the first thing to try.

| county | pages | live | dark |
|---|---|---|---|
| Suffolk | 107 | 0 | **107** *(deferred — needs ten town wires)* |
| Westchester | 74 | 0 | **74** |
| Nassau | 70 | 2 | **68** |
| Erie | 72 | 17 | **55** |
| Monroe | 52 | 0 | **52** |
| Albany | 47 | 0 | **47** |
| Dutchess | 34 | 0 | **34** |
| Saratoga | 27 | 0 | **27** |
| Rockland | 26 | 0 | **26** |
| New York | 100 | 77 | 23 |
| Putnam | 9 | 0 | **9** |
| Kings / Queens / Richmond / Bronx | 146 | 137 | 9 |

**Non-Suffolk dark: 424.**

### 🚫 The statewide play FAILS in New York — three independent rejections

1. **`data.ny.gov` `ygg4-74a7` "Statewide Transportation Improvement Plan"** (Socrata, 2,489 rows)
   — **`NO_GEOGRAPHY` + `NO_TEMPORAL_FIELD`.** Complete column list: `region, mpo, pin, county,
   agency, title, description, fund_types_all, _2026, _2027, _2028, _2029, fa_cost, nfarollup`.
   **No point, no lat/lng, no ZIP** — `county` alone cannot be resolved to a location, and
   `_2026…_2029` are funding amounts, not dates (the RI/AK class).
2. **`data.ny.gov` `rz8t-4kmq` "Transportation Projects in Your Neighborhood"** (Socrata, 1,937
   rows) — **`NO_GEOGRAPHY`.** This one is otherwise excellent: real `contract_award_date` and
   `estimated_or_actual_completed_date` (both `calendar_date`), a real `status`
   ("Completed Project"), `type_of_work`, `public_friendly_description`. But there is **no
   geometry column of any kind**; the only spatial field is `region` ("10 LONG ISLAND"), a DOT
   administrative region. ⚠️ The prose in `project_status` DOES name counties ("…Nassau and
   Suffolk Counties"), which is exactly the trap — **parsing geography out of free text is
   guessing, and the anti-fabrication rule forbids it.**
3. **NYSGIS_GPO** (the NY State GIS Program Office AGO org, **97 items enumerated**) — the only
   project-named services are `Capital District Transportation Authority` (transit-authority
   boundaries), `Regional Economic Development Councils` (regions), and `DEM Projects` (LIDAR
   elevation extents). **Zero per-record development or permit layers.** Also
   `gis.dot.ny.gov/arcgis/rest/services` → **404**.

### The standing answer this produces

⚠️ **§0c's statewide-DOT-first move is the right OPENING, not a guarantee.** New York publishes
its STIP through **MPOs** (NYMTC, CDTC, GBNRTC …) rather than as one statewide geometry layer, so
the state-level shortcut that lit Michigan in a single wire does not exist here. **When the
statewide probe fails, say so with receipts and fall back to county-by-county** — do not keep
re-probing the state.

**NY is therefore a county-by-county state.** Next targets by dark count: Westchester 74 ·
Nassau 68 · Erie 55 (Buffalo already wired; the county is the gap) · Monroe 52 (Rochester) ·
Albany 47 · Dutchess 34 · Saratoga 27 · Rockland 26 · Putnam 9. **Suffolk 107 last** — it needs
ten town wires.

## 🚫 `NO_GEOGRAPHY` — THE CANONICAL WORKED CASE: `rz8t-4kmq` (NYSDOT, 2026-08-05)

**Keep this as the reference example, because it is the most TEMPTING version of the
disqualifier** — everything else about the source is right.

`data.ny.gov` **`rz8t-4kmq` "Transportation Projects in Your Neighborhood"**, NYSDOT, Socrata,
**1,937 rows**, first-party. It has:

- ✅ **Two real `calendar_date` fields** — `contract_award_date`, `estimated_or_actual_completed_date`
- ✅ **A real status** — `status` ("Completed Project"), plus `project_status`, `schedule_performance`
- ✅ **Rich per-record content** — `project_title`, `type_of_work`, `public_friendly_description`,
  `construction_amount`, `contract_number`, `major_pin`
- ✅ **Per-record granularity** — one row per contract

It fails on **one** thing: **there is no geometry column of any kind.** No point, no lat/lng, no
ZIP, no address. The only spatial field is `region` — `"10 LONG ISLAND"`, a DOT administrative
region covering multiple counties.

### ⚠️ The trap, stated explicitly

The free-text `project_status` prose **does** name counties — a real row reads *"…Towns of Oyster
Bay, Islip and Babylon, **Nassau and Suffolk Counties**"*. It is genuinely tempting to regex the
county out of the description and place the record.

**Do not. Parsing geography out of free text is guessing**, and it is exactly what the
anti-fabrication prime directive forbids: every rendered marker must trace to a real record's own
stated location, not to an inference drawn from prose. A county name in a sentence is not a
coordinate, and even if it were, a county is not a ZIP.

**The rule:** a source is `NO_GEOGRAPHY` when it carries no point, no lat/lng pair, no ZIP and no
geocodable street address — **regardless of how good the rest of the schema is, and regardless of
whether place names appear in prose.** Dates and statuses cannot rescue a record that cannot be
placed.

### NEW YORK — the MPO fallback and the county sweep BOTH come up empty (2026-08-05)

Following §0i, after the three statewide rejections the next question was **who New York delegates
to**. Both remaining layers of the search were run. **Neither yields a wireable source.**

**MPO layer — searched NYMTC, CDTC, GBNRTC, GTC.** Result sets: NYMTC 20 items, CDTC 8, GBNRTC 2,
GTC **0**. Exactly one TIP feature service exists in that set:
`services2.arcgis.com/dU6jdOIkCUj2UDe9/…/TIP/FeatureServer/0` "Point Projects", owner
`Putnam_County_NY`. Probed live: **11 rows**, `County` = **PUTNAM** for all 11, `mpoName` =
**MHSTCC** for all 11 (Mid-Hudson South Transportation Coordinating Committee — one sub-regional
council, not the NYMTC region). Point geometry, first-party, real per-record content.
🟡 **Recorded as a MARGINAL candidate, deliberately NOT wired**: 11 records against **9 ZIP pages**,
and its three date-ish fields are all `esriFieldTypeString` (`CreationDa` "DATE ORIGIN", `EditDate`
"DATE EDITED", `Produpdate` "PLAN YEAR" — a year, not a date), so it would need the Anaheim
string-compare treatment. A full wire cycle for 9 pages is poor value while ~415 NY pages have no
source at all. Revisit if NY's other counties open up.

**County sweep — orgs enumerated, not guessed.** Every one returned a real, non-empty result set
and **zero permit or development feature services**:

| county | dark pages | items enumerated | permit/development services |
|---|---|---|---|
| Westchester | 74 | **261** | **0** |
| Erie | 55 | **182** | **0** |
| Albany | 47 | **177** | **0** |
| Dutchess | 34 | **45** | **0** |
| Monroe | 52 | **22** | **0** |
| Nassau | 68 | **26** | **0** |

⚠️ Westchester's only permit-named layer is a **Film Permit** service — `WRONG_RECORD_CLASS`, and a
good reminder that matching the word "permit" is a lead, not a finding.

These are **negatives with stated, non-zero denominators** (§0a): 713 items enumerated across six
counties, none of them a development source.

**Where that leaves NY:** the state has no statewide source, no MPO source beyond an 11-row
Putnam layer, and no county source in its six largest dark counties. The wired coverage that
exists — NYC's five boroughs and Buffalo — is **city-published**, which is §0j's shape exactly.
Remaining NY work is therefore **city-by-city** (Yonkers, White Plains, New Rochelle, Mount
Vernon; Rochester; Albany; Syracuse — noting Syracuse was already rejected STALE 2025-08-16 in the
NEW YORK WIRE PASS), not county-by-county — a different and more granular search than any run so
far.

## 🛑 NEW YORK — CLOSED (2026-08-05): every above-floor candidate rejected. Municipal-tier wiring is its own project.

**Floor set and measured BEFORE probing** (not guessed): count the dark pages each candidate city
could plausibly reach, and reject anything under ~5 rather than wiring for the count. Measured
from `communities`:

| city | county | dark pages | verdict |
|---|---|---|---|
| **Rochester** | Monroe | **25** | 🚫 `NO_TEMPORAL_FIELD` |
| **Buffalo** | Erie | **12** | ✅ already wired — see below |
| **Albany** | Albany | **12** | 🚫 `candidates_exhausted` |
| White Plains | Westchester | 5 | 🚫 **0 items** returned |
| Yonkers | Westchester | 5 | 🚫 no city source |
| Great Neck · Schenectady | Nassau · Albany | 4 | ⬇️ below floor, not probed |
| Mount Vernon · Poughkeepsie · New Rochelle | — | 3 | ⬇️ below floor, not probed |

### The rejections

- **Rochester — `NO_TEMPORAL_FIELD`.** The city's own server is live and its `Open_Data` folder
  fully enumerated (**35 services**). ⚠️ **The prior pass's note "no permit layer; demolitions
  token-required" was incomplete** — there IS a `Planning_Projects_Open_Data` service it missed.
  Probed: **56 rows**, polygon, with `PROJECTNAME`, `PROJECTDESCRIPTION`, `WEBADDRESS`,
  `PROJECTSTATUS`, `FUNDINGSOURCE` — and **zero date-typed fields**; `PROJECTYEAR` is a
  `esriFieldTypeString` year. Same class as AK, RI, Iowa's Five Year Program and Toledo. (Even
  had it passed, 56 rows over 25 pages was marginal.)
- **Albany — `candidates_exhausted`.** 15 items enumerated, **0** city permit/development
  services: zoning, parking signs, cannabis consumption locations, election districts, a
  consultant's "South End Map", an Ulster County water inventory, and a Putnam trailway.
- **Yonkers** — 2 items, both owned by `stalin.espinal_brooklyncollege` (a student project).
  **White Plains** — **0 items**. Neither city publishes.
- **Rochester Socrata** — `data.cityofrochester.gov` returns `Domain not found`. No portal.

### ⚠️ Buffalo is already county-scoped — its 12 dark pages are a WINDOW limit, not a scope gap

`buffalo-building-permits` declares `coverage: [{state: NY, county: Erie}]` with a native `zip`
column and per-record `latitude`/`longitude`, so it already rides **all 72 Erie pages**; 17 carry
records. The 12 dark pages *named* "Buffalo" simply have no permit within `recency_days: 365`.
**Do not re-wire Buffalo or "extend its scope"** — the scope is already county-wide. Widening the
window is a change to an existing entry (gated, non-additive) and was not made.

### The honest conclusion

**NY needs municipal-tier wiring at a scale that is its own project — the same answer as Suffolk's
ten towns, and for the same reason.** The state has:

- **no statewide source** (3 rejections with receipts),
- **no MPO source** beyond an 11-row Putnam layer (below floor),
- **no county source** across its six largest dark counties (**713 items enumerated, 0 dev services**),
- **no city source** at any of the four cities above the 5-page floor.

Its 233 live pages come entirely from **NYC's five boroughs + Buffalo** — two municipal
publishers. Lighting the remaining **531** would mean wiring dozens of small municipalities at
3–5 pages each, which is a different kind of project from the county- and state-tier work that
carried UT→NY so far. **Recorded and stopped, rather than ground down for marginal counts.**

**Reprobe candidates:** Rochester (if `PROJECTYEAR` is ever replaced by a real date) · Syracuse
(STALLED 2025-08-16 per the NEW YORK WIRE PASS) · Putnam TIP (if it grows beyond 11 rows).

### NY DISPOSITION UNDER §0k: `MUNICIPAL_TIER_REQUIRED`

Restating the New York closure in the standing policy's own vocabulary, with the audit figures
§0k requires.

**Stamp: `MUNICIPAL_TIER_REQUIRED`.** Both conditions are met — closing NY needs **far more than
~5 wires**, and **every remaining wire lights well under 20 pages**.

| figure | value | basis |
|---|---|---|
| dark pages remaining | **531** (424 non-Suffolk + 107 Suffolk) | measured |
| largest surviving single-wire yield | **< 5 pages** | the four above-floor cities are all rejected; every remaining place is 3–5 pages |
| estimated wires to close non-Suffolk | **~85–140** | 424 pages ÷ 3–5 pages per municipality |
| estimated wires to close Suffolk | **10** | its ten towns, ~10.7 pages/wire |
| **total estimated wires** | **~95–150** | |

**§0k threshold is >5 wires at <20 pages each. NY is ~95–150 wires at 3–5 pages each — an order
of magnitude past it.**

**Search layers already exhausted (the §0k three-layer stop, all with non-zero denominators):**
statewide → 3 rejections · regional/MPO → 1 sub-threshold layer (Putnam, 11 rows / 9 pages) ·
county → 713 items enumerated across six counties, **0** development services. A fourth layer
(city) was run anyway because Rochester and Albany cleared the page floor; **both rejected**, which
confirms the stop rule rather than contradicting it.

**Applied §0k decisions, recorded not reported:** Putnam TIP → `SUB_THRESHOLD` (11 rows / 9 pages,
string dates) · Great Neck, Schenectady, Mount Vernon, Poughkeepsie, New Rochelle → below floor,
**not probed** · Rochester → `NO_TEMPORAL_FIELD` · Albany, White Plains, Yonkers →
`candidates_exhausted`.

⚠️ **NY is not abandoned.** It carries 233 live pages from NYC + Buffalo, and the reprobe list
stands (Rochester if `PROJECTYEAR` becomes a real date · Syracuse, stalled 2025-08-16 · Putnam TIP
if it grows). It is a scoped finding that the remainder is a **project, not a pass**.

---

## CALIFORNIA PASS (2026-08-05) — 386 dark, ONE county wire live, one reverted, seven counties `MUNICIPAL_TIER_REQUIRED`

**Baseline measured before any probe:** CA has **523 modelled ZIP pages, 137 lit, 386 dark**,
across exactly ten modelled counties. Registry grep first per §0c/§0j: four CA entries existed,
**all city- or county-scoped** — `marin-county-building-permits`, `anaheim-land-use-cases`,
`san-jose-permits`, `san-diego-approved-permits` (the City of San Diego CSV). **No statewide entry.**

### Statewide — REJECTED, and it is a real counter-example to §0c

Caltrans' DCAT catalogue was enumerated in full: **69 datasets, 0 project or programme layers.**
Every one is asset or network inventory — highway network lines, postmiles, bridges, tunnels, rest
areas, park-and-ride, transit stops and routes, airports, rail, districts, traffic counts, climate
risk. `data.ca.gov` answers "Domain not found" to the Socrata catalogue API.

⚠️ **Standing answer: statewide-DOT-first is an opening move, not a guarantee, and California is
the clean counter-example.** UDOT, TxDOT, MDOT, FDOT, MassDOT, NJDOT, MaineDOT, Iowa DOT and VTrans
all publish *projects*. Caltrans publishes *assets*. The disqualifier is
`WRONG_RECORD_CLASS`, decided on the enumerated catalogue rather than on a guessed URL.

### §0i regional fallback — FIRED, FOUND, then REJECTED on the schema

§0i says that when the statewide probe fails, ask who the state delegates to. In California that is
the MPOs, and the probe **worked as a discovery step**: MTC (Metropolitan Transportation Commission,
the nine-county Bay Area MPO) returned 110 items including the 2027 and 2025 Transportation
Improvement Program project layers and the OBAG 3 County Program layers. MTC's footprint is
**185 dark CA pages** — Alameda 51 + Contra Costa 43 + Sonoma 40 + San Mateo 31 + Santa Clara 15 +
Marin 5. It was the largest single-wire prize in the state.

**It fails on the schema, and the failure is systematic across the whole family:**

| layer | rows | date-typed fields | status field |
|---|---|---|---|
| `mtc_tip2027_projects_point` | 251 | **0 of 10 fields** | none |
| `obag3_projects_pt` | — | **0 of 6 fields** | none |
| `Project_Mode` (2025 TIP point) | — | **0** | none |

`mtc_tip2027_projects_point` carries `tip_id, Project_County, sponsor, Project_Cost, Project_Mode,
Project_Name, Project_Description, Geometry_Type, Project_Number` — a complete project record with
**no time and no stage**. `obag3_projects_pt` carries `county, id, sponsor, project, mode_`. Three
enumerated layers, three non-zero denominators, three empties → the §0k three-layer stop.
**`NO_TEMPORAL_FIELD`.** SCAG (30 items) and SANDAG (29 items) were probed too: 0 project layers.

⚠️ Worth keeping: §0i's *first successful use* still ended in a rejection. The rule earned its
place by finding the right layers quickly — the layers themselves were not wireable. A fallback
that surfaces the correct candidate and lets the schema gate kill it is working, not failing.

### WIRED — `slo-county-planning-permits` (San Luis Obispo, 29 pages, 0 lit before)

`gis.slocounty.ca.gov` → `PLN/PLN_EG_SERVICES_DATA/MapServer/79` "Prod1PointHistory", the
production EnerGov case-history point layer (`Dev1*`/`Stage1*` are the non-production twins and are
not wired). **50,969 rows**, `esriGeometryPoint`.

- **Found by enumeration, not guess:** service root → 21 folders → `PLN` → 6 map services → an
  84-layer roster. The AGO title search returned 10 items (non-zero denominator) and surfaced only
  water-well and inspection-zone layers — a weak instrument on a county that publishes properly.
- **Fresh:** `max(ApplicationDate)` = **2026-08-04**, one day before the pass; min 1988-09-27;
  populated on **50,969 of 50,969**.
- **Type vocabulary complete:** `CaseType` = **93 values summing exactly to 50,969**, proven on
  both `n DESC` and `n ASC` (the Mesa/Gilbert `$limit`-truncation defence). **49 kept (33,138
  rows)**; the 44 dropped are records-research (5,638), enforcement (2,187 + cannabis code +
  vehicle abatement), trades MEP (1,389), express/over-the-counter (1,982), septic (920 — the same
  wrong-record-class call made against Sonoma's septic layer) and procedural classes.
  `WorkClass` was measured too (209 values, also exact) and **not** used — `CaseType` is the
  coarser self-describing field.
- ⚠️ **New standing answer — a trailing space in a publisher value is safe here, but only because
  it was MEASURED.** `includeTypesClause` trims values before quoting them into the `IN` list, and
  two `CaseType` values carry a trailing space. Probed live: `IN ('Renewable Energy')` → **3,359**
  and `IN ('Express')` → **1,664**, exactly the groupBy counts of the space-carrying values, so the
  SQL Server ANSI padding semantics hold. An **internal** double space (`Renewable Energy  ASB`)
  survives the trim and stays in the `type_map` key.
- **No status column** → `status_const: "Submitted"` → proposed; approved/operating/exclude
  deliberately empty (NDOT/VTrans precedent).
- **`record_url`:** no per-record column; dataset precision on the county's Tyler EnerGov Citizen
  Self Service portal, **recovered from the county Planning & Building page's own HTML**
  (`sanluisobispocountyca-energovweb.tylerhost.net/apps/selfservice#/search`) rather than templated
  from `CaseId` (Boston/Philadelphia precedent).
- **Placeholder-coordinate check:** three consecutive sample records shared an identical
  13-decimal-place coordinate. Probed rather than assumed — a ~40 m box around that point holds
  **8 of 50,969** records, i.e. a real parcel with eight cases, not a geocoder dump point.

### REVERTED — `san-diego-county-discretionary-permits`: wired, deployed, measured, un-wired (53 dark pages)

`gis-public.sandiegocounty.gov` → `PDS/PDS_Layers/MapServer/20` "Discretionary Permits",
**50,306 rows**, `esriGeometryPoint`, found by enumerating 25 folders → a 122-layer roster.
Layer 19 "Project Review" is a **group layer** (`geometryType` null, `fields` null,
`returnCountOnly` errors 400) — enumerated and skipped, not mistaken for an empty layer.

- **Fresh:** `max(PER_OPEN_DATE)` = **2026-07-24**, populated on **50,306 of 50,306**.
- **Status vocabulary complete:** `PER_STAT` = **11 values summing exactly to 50,306** —
  DIR Approved 18,198 · Approved 11,649 · BOS Approved 7,741 · Open 6,033 · In Review 2,367 ·
  PC Approved 2,141 · Out to Applicant 1,438 · Issued 459 · ZA Approved 225 · Post-Approval 38 ·
  Public Review 17. **40,451 approved + 9,855 proposed = 50,306.**
- **Type:** `PER_TYPE_DESC` = **69 values, also exact**, every one naming a *case class*
  (Major Use Permit, Tentative Map, Rezone, Grading Permit Maj …) rather than a building use — so
  there is nothing to map to the closed `use_type` vocabulary without guessing.
  `use_type_const: "Development"` with **no `type_map`** (the Phoenix precedent: the generic member
  is written `Development`, never an off-vocabulary `"Other"`).
- **`extra_where` drops 10,822 of 50,306**: the Landscape Plan family (9,653 — submittals attached
  to already-approved projects) and the purely procedural classes (time extensions 475, resolution
  amendments 57, appeals 34, verification requests 96, initial consultations 402, planning-historical
  7, subdivision violations 9, miscellaneous 89). **39,484 kept.**
- ⚠️ **The layer HAS a `LINK` column and it is NULL on every row** — `count(LINK)` = **0** against a
  layer count of 50,306. Measured, not assumed; a column's existence is not evidence it is
  populated. Dataset precision on the county's own Accela Citizen Access portal
  (`publicservices.sandiegocounty.gov/CitizenAccess/`, probed live: HTTP 200,
  `<TITLE>Citizen Access</TITLE>`).
- The 53 dark SD pages are the unincorporated and North County ZIPs — Fallbrook 92028, Ramona
  92065, Alpine 91901, Valley Center 92082, Julian 92036, Borrego Springs 92004 — exactly where
  county discretionary permits land, while the 62 lit ones are the City of San Diego CSV's.

⚠️ **IT DOES NOT WORK THROUGH THE ENGINE, AND THE ENTRY WAS REMOVED THE SAME DAY.** Everything
above was verified from pg_net and is correct about the *layer*. It says nothing about whether the
*deployed engine* can fetch it — and it cannot.

**Measured after deploy (get-address-report v171), 20 attempts, 20 failures:**

| instrument | result |
|---|---|
| 19 dark SD ZIPs, batch re-cache | **19/19** `arcgis_reports` → `fetched: 0, emitted: 0, quarantined: "fetch failed: Signal timed out."` |
| 92028 alone, queue empty, no concurrent load | **same** — `fetched: 0`, `"Signal timed out."`, `counts.development: 0` while `counts.facilities: 30` |
| the byte-identical connector query from pg_net | **HTTP 200 in under a second, 59.5 KB** (with `extra_where`) and 70.9 KB (without) |

The gate **failed closed exactly as designed** — 0 emitted, a named quarantine reason, and not one
fabricated record on any page. The 53 pages stayed dark rather than going live with nothing behind
them, which is the whole point of the anti-fabrication contract.

⚠️ **THE CAUSE IS UNDETERMINED, AND I AM NOT ASSERTING THE ONE I FIRST BELIEVED.** The connector
sends a fixed `User-Agent` (`sources/arcgis.ts:742`), so the obvious hypothesis was a WAF rule on
the request signature. A three-way control on ONE URL in ONE window looked like it confirmed that:

| headers | result |
|---|---|
| `Accept: application/json` only | **200, 70,855 bytes** |
| + the connector's exact `User-Agent` | **timed out, 0 bytes — reproduced twice** |
| + `User-Agent: Mozilla/5.0` | **HTTP 400, 339 bytes** |

**That control is not admissible, because the instrument is disqualified.** Earlier the same day,
`services3.arcgis.com` — Esri's own hosted service, which certainly serves User-Agent-bearing
browsers all day — returned **HTTP 400 `Bad Request - Invalid Header. The request has an invalid
header name.`** to a pg_net request carrying a custom `User-Agent`, and **200** to the byte-identical
request without one. Two unrelated hosts rejecting header-bearing pg_net requests is far better
explained by pg_net's header serialisation than by two coincidental WAF rules.

**New standing answer: pg_net custom headers are NOT a valid instrument for testing what a host
does with a header.** Probe bare; if a header-bearing probe fails, suspect the instrument first.
A test whose failure mode is indistinguishable from the thing it is testing proves nothing —
the §0a shape, one level up.

**What IS established, on a clean instrument:** the layer is live and fast from Postgres egress,
and the deployed engine times out on it in 20 of 20 attempts including one with an idle queue.
Whether that is edge-egress blocking (the Tampa / El Paso class) or a request-signature rule
cannot be separated from the sandbox, because the only egress available here is the one just
disqualified.

**Disposition: `EDGE_EGRESS_BLOCKED`, entry reverted, added to the reprobe list.** Leaving it wired
would have cost every one of San Diego County's 115 pages a 30-second timeout on every refresh in
exchange for nothing. The 50,306-record layer and its exact vocabularies stay documented above so a
future session with a working instrument — a GitHub-runner probe, which has neither pg_net's header
handling nor the edge runtime's egress — can settle the cause in one run and re-wire in one commit.

### Window choice — the rule applied uniformly, on measured pages not projections

Per §0k both windows were measured on both entries, and the **densest page was measured directly**
with a 3-mile envelope around its ZIP centroid rather than projected from the county total:

| entry | county-wide 365 / 1095 / 1825 | densest page 365 / 1095 / 1825 | chosen |
|---|---|---|---|
| SLO | 8,319 / 24,119 / 36,386 of 50,969 | Paso Robles 93446 — 218 / 724 / **1,345** | **1825** |
| San Diego | 1,218 / 4,795 / 8,385 of 50,306 | Fallbrook 92028 — — / 205 / **292** | **1825** |

**The rule: take the largest window (capped at 1825) whose worst MEASURED page stays far under the
measured ceiling** — Cleveland 44127 at 5,511 sites / 5.98 MB. SLO's worst is ~875 sites after the
65% type whitelist; San Diego's is 292. `require-a-date` is **vacuous on both** (dates are 100%
populated), which is itself the §0h check working: it filters nothing and would reach back to 1988.

### REJECTED with receipts — the seven remaining dark counties

| county | dark | enumerations run (all non-zero denominators) | disqualifier |
|---|---|---|---|
| **Orange** | 85 | AGO title search 5 items · OC org (`UXmFoWC7yDHcDN5Q`) scoped `permits` 28 items → NPDES/discharge only · scoped `development` 64 items → watershed BMP/aquifer layers only · `gis.ocgov.com` and `ocgis.com` both dead | `candidates_exhausted` |
| **Alameda** | 51 | county DCAT **163 datasets** → 1 zoning polygon, 0 permits · Berkeley Socrata **66 datasets** → 2 zoning polygons · Oakland Socrata → 11 name matches, all zoning / parking-permit zones / affordable-housing counts / workforce | `candidates_exhausted` |
| **Contra Costa** | 43 | AGO search 8 items → 0 · county server `INTERNET` folder → 1 base-data service · `_Authoritative` → 11 boundary layers · `PublicWorks` → **499 Token Required** | `candidates_exhausted` |
| **Sonoma** | 40 | AGO org 118 items → septic + coastal-commission jurisdiction · AGO search 197 items → same · **the county's own server enumerated: 40 folders**, and `AccelaPublic` holds only Parcels + Addresses while `OneStopMapPublic` holds only Parcels + Parks | `WRONG_RECORD_CLASS` |
| **Ventura** | 34 | AGO search 35 items · county server `DataDownloads` → 22 services, only `Permitting` is case-like → 3 layers: Communication Facilities, **Mining Permits 29**, **Oil Permits 393** | **`STALE`** |
| **San Mateo** | 31 | AGO search 28 items → 0 · AGO search 131 items → only the county CIP · `gis.smcgov.org` 404 · the CIP layer itself (210 rows) has **no date and no status field** — every column is `nvarchar(4000)` plus fiscal-year budget integers | `NO_TEMPORAL_FIELD` |
| **Santa Clara** | 15 | `san-jose-permits` already in the registry; `data.sanjoseca.gov` answers "Domain not found" to the Socrata catalogue API | below the wire-for-the-count line |

⚠️ **Ventura's Oil Permits looked wireable and are not.** 393 polygons with a real
`aprv_date` (`esriFieldTypeDate`), a complete 4-value status vocabulary summing exactly to 393
(EXPIRED 249 · ACTIVE 137 · ANNEXED 6 · DENIED 1) and per-permit geometry — everything the gate
asks for except currency. `max(aprv_date)` = **2015-05-14**, eleven years stale. The vocabulary
being perfect is not evidence the layer is alive; **check the max date before enumerating the
vocabulary**, not after.

### Stamp: `MUNICIPAL_TIER_REQUIRED` for the seven

After the two wires, **~304 pages remain dark** across Orange 85, Alameda 51, Contra Costa 43,
Sonoma 40, Ventura 34, San Mateo 31, Santa Clara 15. Every county tier above is exhausted with
receipts, so closing them means city-tier wiring: Orange has ~30 incorporated cities, Contra Costa
19, San Mateo 20, Alameda 14. **§0k's threshold is >5 wires each lighting <20 pages — this is
~80+ wires at a handful of pages each**, an order of magnitude past it.

**California is not abandoned.** It carries 137 pre-existing live pages plus the two new county
wires, and the reprobe list stands (Oakland and Berkeley both run live Socrata portals that simply
have no permit dataset today; OC Public Works publishes 1,499 feature services and could add one).

---

## CONNECTICUT PASS (2026-08-05) — 269 dark, one STATEWIDE wire, six counties lifted off zero

**Baseline measured before any probe:** CT has **288 modelled ZIP pages, 19 lit, 269 dark**.
Registry grep first: **2 CT entries, both city-scoped** — `hartford-building-permits` (9 pages) and
`stamford-major-developments` (10). **No statewide entry**, and **six of eight counties at zero**:
New Haven 41 · Litchfield 40 · New London 33 · Windham 29 · Middlesex 23 · Tolland 16
(Hartford 51 dark of 60, Fairfield 36 of 46).

⚠️ **Connecticut is the state where §0c matters most, for a structural reason: it abolished county
government in 1960.** There is no county tier to wire — only the state, nine Councils of
Governments, and 169 towns. A statewide source is not a convenience here, it is the **only** tier
above the municipality, and its absence would have forced `MUNICIPAL_TIER_REQUIRED` at 169 wires.

### WIRED — `ctdot-project-work-areas` (statewide, all 288 pages in scope)

CTDOT's own hosted AGO layer, `CTDOT_Project_Work_Areas` layer 0. **2,311 rows**,
`esriGeometryPolygon` in wkid 103016 (CT State Plane) — the connector requests `outSR=4326` and
`featurePoint()` derives the shoelace centroid, so this rides the polygon-geometry pass.
`coverage: [{state: 'CT'}]` with no county, per the UDOT statewide precedent.

- **Fresh:** `max(last_edited_date)` = **2026-04-30** — actively maintained.
- **Status vocabulary complete:** `CurrentSchedulePhase` = **9 values summing exactly to 2,311**,
  a numbered lifecycle that buckets itself — 01_Planning 229 + 02_Pre-Design 36 → **proposed 265**;
  03_Final-Design 163 + 04_Contract-Processing 20 + 05_Construction 200 + 05_Construction (Pending)
  10 + Construction (Missing Dates) 318 → **approved 711**; 06_Completed 433 + 06_Completed (Closed)
  902 → **operating 1,335**. 265 + 711 + 1,335 = 2,311. `exclude` deliberately empty — no cancelled
  or abandoned stage exists in this vocabulary.
- **Window — the clean §0h program-class case.** require-a-date keeps **2,155 of 2,311 (93%)**; a
  1825-day backward window on `CurrentADVdate` keeps only **855**. The ~1,300-record gap is almost
  exactly the 1,335 COMPLETED projects, whose advertisement dates are naturally old and which are
  the honest *operating* content on a development page. **require-a-date wins**, as it did for
  NJ / ME / IA / VT. No `recency_days`.
- **Date field chosen on measured population:** `CurrentADVdate` 2,155/2,311 beats
  `EstConstrCompletionDate` 1,421/2,311.
- ⚠️ **Stated ceiling:** **5** of the 2,155 dated rows carry an absurd future `CurrentADVdate`
  (> 2035; the maximum is in the year **2222**) — a publisher data-entry artefact. They are kept
  rather than silently dropped: the record is real, only its date is wrong, and a backward window
  would have kept them anyway. **156** rows carry no ADV date at all and are dropped by `extra_where`.
- **Page yield measured directly, not projected** — a 3-mile envelope around one DARK ZIP centroid
  per uncovered county:

| county | probe ZIP | projects in a 3-mile envelope |
|---|---|---|
| New Haven | 06511 | **196** |
| Middlesex | 06457 | **128** |
| New London | 06320 | **111** |
| Windham | 06226 | **108** |
| Tolland | 06084 | **91** |
| Litchfield | 06759 | **66** |

  Every zero-coverage county has substantial content, and the densest page is two orders of
  magnitude under the measured row-size ceiling.

### Rejected with receipts

- **CT geodata hub (`geodata.ct.gov`) — `AGGREGATE_NOT_PER_RECORD`.** The DCAT catalogue enumerates
  **574 datasets**; four match permit/project/construction by title, and **all four resolve to the
  same layer** — `HousingDashboardDECD_Permits`, whose fields are `Municipality`, `year` (a string),
  `places` and `Shape__Area`. ⚠️ Two of those four ("Permitting - Permits", "Permitting - Demos")
  are **Web Maps, not feature services**; walking their `operationalLayers` (the Frisco precedent)
  showed every one of their eight layers pointing at that same town-polygon aggregate. **A distinct
  catalogue title is not a distinct dataset — resolve the layer before counting it as a candidate.**
- **`CTDOT_Active_Capital_Projects_with_Funding_Type` (18 fields) and `CTDOT_LOTCIP_Projects`
  (16 fields) — `NO_TEMPORAL_FIELD`.** Both carry date-typed fields, and in both cases the ONLY ones
  are `created_date` and `last_edited_date`. ⚠️ **Editor tracking is metadata about the row, never
  the record's own date** — checking field TYPES alone would have passed both. This is the
  check-the-types rule with a second clause: check what the typed field *means*.
- **`data.ct.gov` Socrata catalogue** — both catalogue queries timed out at
  `api.us.socrata.com` and are recorded as **unresolved, not as an absence**; the statewide wire
  landed on the CTDOT layer instead, so this was not pursued further. It stays on the reprobe list.
