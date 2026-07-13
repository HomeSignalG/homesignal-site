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
