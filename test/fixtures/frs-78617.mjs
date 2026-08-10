// Live Del Valle (ZIP 78617) FRS + identity payloads, copied verbatim from
// public.v_app_project_identity on 2026-08-10. Shared so the regression tests and the
// render harness read the SAME records — a fixture that drifts from the page it is meant
// to prove is worse than no fixture.
const FRS_URL = 'https://ofmpub.epa.gov/frs_public2/fii_query_detail.disp_program_facility?p_registry_id=';
const frsRow = (o) => Object.assign({
  verification: 'HIGH_CONFIDENCE', evidence_tier: 'frs_affiliation',
  source_system: 'EPA_FRS', source_file: 'state_combined_tx.zip / TX_ORGANIZATION_FILE.CSV',
  source_version: '2026-08-06 archive file date',
  retrieved_at: '2026-08-10T00:21:31.294450+00:00',
  start_date: null, end_date: null, duns: null, ein: null, state_business_id: null,
  entity_type: null, suppressed_reason: null
}, o);

// ── Live Del Valle fixtures, copied from public.v_app_project_identity ──────────────────

// POSITIVE CONTROL. 110005052085 — the only pilot facility whose FRS rows name BOTH an
// owner and an operator, and they are different companies. HomeSignal resolved nothing
// here from TCEQ, so this is the gap-fill case.
const BFI = {
  id: 'facility-110005052085', name: 'BFI WASTE SYSTEMS OF TEXAS LP',
  registry_id: '110005052085',
  identity: [],
  frs: {
    current: [
      frsRow({
        name: 'BROWNING-FERRIS INDUSTRIES INC', role: 'Facility Owner',
        affiliation_type: 'OWNER', program: 'RCRAINFO', program_id: 'TXD052648169',
        interest_type: 'UNSPECIFIED UNIVERSE', entity_type: 'PRIVATE',
        start_date: '23-OCT-06', registry_id: '110005052085',
        source: 'EPA Facility Registry Service — OWNER affiliation reported by RCRAINFO',
        url: FRS_URL + '110005052085'
      }),
      frsRow({
        name: 'BFI WASTE SYSTEMS OF TEXAS LP', role: 'Operator',
        affiliation_type: 'OPERATOR', program: 'RCRAINFO', program_id: 'TXD052648169',
        interest_type: 'UNSPECIFIED UNIVERSE', entity_type: 'PRIVATE',
        start_date: '23-OCT-06', registry_id: '110005052085',
        source: 'EPA Facility Registry Service — OPERATOR affiliation reported by RCRAINFO',
        url: FRS_URL + '110005052085'
      })
    ],
    history: [], parent_candidates: []
  }
};

// NEGATIVE CONTROL. 110070182593 — TCEQ resolved the operator by identifier chain
// (CN606114726 → RN106540172) and FRS publishes NO organization row for this registry id.
// The card must be byte-for-byte what it was before the FRS pilot.
const GARFIELD = {
  id: 'facility-110070182593', name: 'TXI - GARFIELD SAND & GRAVEL',
  registry_id: '110070182593',
  identity: [{
    role: 'Operator', name: 'Martin Marietta Materials Southwest, LLC',
    legal_name: 'Martin Marietta Materials Southwest, LLC',
    entity_type: 'limited liability company', verification: 'VERIFIED',
    evidence_tier: 'identifier_backed', evidence_date: '2023-04-13',
    source: 'TCEQ Central Registry — regulated entity RN106540172, customer CN606114726',
    url: 'https://data.texas.gov/resource/msah-s2rv.json?ref_num_txt=RN106540172',
    parent: {
      verification: 'verified', name: 'Martin Marietta Materials, Inc.',
      source: 'SEC Exhibit 21.01 to the FY2025 Form 10-K, filed 2026-02-19',
      url: 'https://www.sec.gov/Archives/edgar/data/916076/000119312526059193/mlm-ex21_01.htm',
      attribution: 'parent_company'
    }
  }],
  frs: { current: [], history: [], parent_candidates: [] }
};

// 110034344494 — CEMEX INC., a DIFFERENT FRS registry id at the same street address as
// Garfield. It is not in the pilot facility set and must never reach a Garfield card.
const CEMEX = {
  id: 'facility-110034344494', name: 'CEMEX CONSTRUCTION MATERIALS LP',
  registry_id: '110034344494',
  identity: [],
  frs: {
    current: [frsRow({
      name: 'CEMEX INC.', role: 'Facility Owner', affiliation_type: 'OWNER/OPERATOR',
      program: 'TX-TCEQ ACR', program_id: 'RN104315775', interest_type: 'STATE MASTER',
      entity_type: 'PRIVATE', ein: '0', state_business_id: '17202965004',
      registry_id: '110034344494',
      source: 'EPA Facility Registry Service — OWNER/OPERATOR affiliation reported by TX-TCEQ ACR',
      url: FRS_URL + '110034344494'
    })],
    history: [], parent_candidates: []
  }
};

// 110008975804 — the arbitration case. A TCEQ FILING (authoritative_filing) resolves City
// of Austin as operator;
// FRS carries one row that AGREES, three that CONFLICT, and (on registry id 110071161706)
// three PARENT OWNER candidates with real reporting periods.
const SARWWTP = {
  id: 'facility-110008975804', name: 'SOUTH AUSTIN REGIONAL WASTEWATER TREATMENT PLANT',
  registry_id: '110008975804',
  identity: [{
    role: 'Operator', name: 'City of Austin', legal_name: 'City of Austin',
    entity_type: 'municipality', jurisdiction: 'TX',
    verification: 'HIGH_CONFIDENCE', evidence_tier: 'authoritative_filing',
    evidence_date: '2014-07-28',
    source: 'TCEQ Central Registry — the only open non-construction affiliation for this '
      + 'regulated entity (air new source review, from 2014-07-28)',
    url: 'https://data.texas.gov/resource/msah-s2rv.json?re_phys_loc_addr_zip=78617',
    parent: { verification: 'not_yet_asked' }
  }],
  frs: {
    current: [
      frsRow({
        name: 'CITY OF AUSTIN', role: 'Operator', affiliation_type: 'OPERATOR',
        program: 'RCRAINFO', program_id: 'TXR000081546', interest_type: 'VSQG',
        start_date: '30-AUG-13', registry_id: '110008975804',
        source: 'EPA Facility Registry Service — OPERATOR affiliation reported by RCRAINFO',
        url: FRS_URL + '110008975804', suppressed_reason: 'agrees'
      }),
      frsRow({
        name: 'TIC - THE INDUSTRIAL COMPANY', role: 'Operator', affiliation_type: 'OPERATOR',
        program: 'TX-TCEQ ACR', program_id: 'RN105651897', interest_type: 'STATE MASTER',
        entity_type: 'PRIVATE', ein: '760032594', state_business_id: '17600325942',
        start_date: '19-NOV-08', registry_id: '110008975804',
        source: 'EPA Facility Registry Service — OPERATOR affiliation reported by TX-TCEQ ACR',
        url: FRS_URL + '110008975804', suppressed_reason: 'conflict'
      }),
      frsRow({
        name: 'AUSTIN ENERGY', role: 'Facility Owner', affiliation_type: 'OWNER',
        program: 'NPDES', program_id: 'TX0124362', interest_type: 'ICIS-NPDES MAJOR',
        start_date: '04-MAR-19', registry_id: '110008975804',
        source: 'EPA Facility Registry Service — OWNER affiliation reported by NPDES',
        url: FRS_URL + '110008975804'
      })
    ],
    history: [],
    parent_candidates: [
      frsRow({
        name: 'AUSTIN ENERGY CORP', role: 'Parent company', affiliation_type: 'PARENT OWNER',
        program: 'E-GGRT', program_id: '1000669', interest_type: 'GREENHOUSE GAS REPORTER',
        start_date: '01-JAN-19', end_date: '31-DEC-22', registry_id: '110071161706',
        source: 'EPA Facility Registry Service — PARENT OWNER affiliation reported by E-GGRT',
        url: FRS_URL + '110071161706'
      })
    ]
  }
};

// A synthetic FORMER-role record. No pilot facility carries one, so the history path is
// exercised deliberately rather than left untested until a state that does have them.
const FORMER = {
  id: 'facility-former', name: 'TEST FORMER ROLES', registry_id: '110000000001',
  identity: [],
  frs: {
    current: [],
    history: [
      frsRow({
        name: 'OLDCO OPERATING LLC', role: 'Operator', affiliation_type: 'FORMER OPERATOR',
        program: 'RCRAINFO', program_id: 'TXD000000001', interest_type: 'LQG',
        start_date: '01-JAN-99', end_date: null, registry_id: '110000000001',
        source: 'EPA Facility Registry Service — FORMER OPERATOR affiliation reported by RCRAINFO',
        url: FRS_URL + '110000000001'
      })
    ],
    parent_candidates: []
  }
};

export { FRS_URL, frsRow, BFI, GARFIELD, CEMEX, SARWWTP, FORMER };
