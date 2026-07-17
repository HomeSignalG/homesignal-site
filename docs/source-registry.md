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
fixture tests (`scripts/carto.fixture-test.ts`), all passing — incl. the bidirectional
gate proof (Allegheny + Utah ZIPs → 0 fetches) and the SQL-error quarantine.

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
