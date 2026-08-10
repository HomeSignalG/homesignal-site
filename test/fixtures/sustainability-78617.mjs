// Live Del Valle (ZIP 78617) sustainability payloads, copied verbatim from
// public.v_app_project_identity.sustainability on 2026-08-10. Shared between the regression
// tests and the render harness so the proof and the page read the same records.

const CC = 'Data from WikiRate (wikirate.org), published under CC BY-SA 4.0. Metric designed by ';
const RET = '2026-08-10T01:24:22.365945+00:00';

// GARFIELD — the case the whole re-integration exists for. The identifier-backed OPERATOR has
// no WikiRate record; its SEC-VERIFIED PARENT does. The parent's record may be shown, labelled
// as the parent's, and must never read as a measurement of the pit down the road.
export const GARFIELD = {
  id: 'facility-110070182593', name: 'TXI - GARFIELD SAND & GRAVEL',
  sustainability: { companies: [
    { role: 'Operator', source: 'WikiRate', source_url: 'https://wikirate.org/',
      attribution: 'direct_company', company_name: 'Martin Marietta Materials Southwest, LLC',
      identity_tier: 'identifier_backed', identity_verification: 'VERIFIED',
      lookup_status: 'checked_no_data', parent_of_name: null, external_company_name: null,
      indicators: [] },
    { role: 'Operator', source: 'WikiRate', source_url: 'https://wikirate.org/',
      attribution: 'direct_company', company_name: 'TXI Operations, LP',
      identity_tier: 'identifier_backed', identity_verification: 'VERIFIED',
      lookup_status: 'checked_no_data', parent_of_name: null, external_company_name: null,
      indicators: [] },
    { role: 'Parent company', source: 'WikiRate', source_url: 'https://wikirate.org/',
      attribution: 'parent_company', company_name: 'Martin Marietta Materials, Inc.',
      identity_tier: 'authoritative_filing', identity_verification: 'VERIFIED',
      lookup_status: 'matched', parent_of_name: 'Martin Marietta Materials Southwest, LLC',
      external_company_name: 'Martin Marietta Materials',
      indicators: [
        { kind: 'performance', year: 2022, topic: 'Greenhouse gas emissions',
          label: "Direct greenhouse gas emissions from the company's own operations",
          value: '4,609,000 metric tonnes of CO2 eq', metric_designer: 'Commons',
          metric_name: 'Greenhouse Gas Emissions Scope 1',
          answer_url: 'https://wikirate.org/Commons+Greenhouse_Gas_Emissions_Scope_1+Martin_Marietta_Materials+2022.json',
          attribution_note: CC + 'Commons.', retrieved_at: RET },
        { kind: 'performance', year: 2022, topic: 'Greenhouse gas emissions',
          label: 'Greenhouse gas emissions from the electricity the company buys',
          value: '626,000 tonnes', metric_designer: 'Commons',
          metric_name: 'Greenhouse Gas Emissions Scope 2',
          answer_url: 'https://wikirate.org/Commons+Greenhouse_Gas_Emissions_Scope_2+Martin_Marietta_Materials+2022.json',
          attribution_note: CC + 'Commons.', retrieved_at: RET },
        { kind: 'disclosure', year: 2026, topic: 'Emissions targets',
          label: 'Signed up to the Science Based Targets 1.5°C commitment', value: 'No',
          metric_designer: 'Science Based Targets Initiative (SBTi)',
          metric_name: 'Business Ambition for 1.5°C status',
          answer_url: 'https://wikirate.org/Science_Based_Targets_Initiative_SBTi+Business_Ambition_for_1_5_C_status+Martin_Marietta_Materials+2026.json',
          attribution_note: CC + 'Science Based Targets Initiative (SBTi).', retrieved_at: RET },
        { kind: 'disclosure', year: 2025, topic: 'Water and pollution',
          label: 'Assesses how water pollution from its operations affects surrounding communities',
          value: 'No', metric_designer: 'World Benchmarking Alliance',
          metric_name: 'Identification of societal impacts in water pollution risk assessment',
          answer_url: 'https://wikirate.org/World_Benchmarking_Alliance+Identification_of_societal_impacts_in_water_pollution_risk_assessment+Martin_Marietta_Materials+2025.json',
          attribution_note: CC + 'World Benchmarking Alliance.', retrieved_at: RET }
      ] }
  ] }
};

// ATX1 — a resolved Property Owner (TDLR TABS filing, Reported) with no WikiRate record and no
// verified parent. Republic-Services-style inference is not available here either: nothing in
// the identity graph names a parent for Neuralink.
export const ATX1 = {
  id: 'proj-atx1', name: 'ATX1 New Construction',
  sustainability: { companies: [
    { role: 'Property Owner', source: 'WikiRate', source_url: 'https://wikirate.org/',
      attribution: 'direct_company', company_name: 'Neuralink',
      identity_tier: 'authoritative_filing', identity_verification: 'HIGH_CONFIDENCE',
      lookup_status: 'checked_no_data', parent_of_name: null, external_company_name: null,
      indicators: [] }
  ] }
};

// BFI — both direct companies come from FRS (Reported). Eligible for a lookup under the pilot
// rule, and the UI must keep saying Reported.
export const BFI = {
  id: 'facility-110005052085', name: 'BFI WASTE SYSTEMS OF TEXAS LP',
  sustainability: { companies: [
    { role: 'Operator', source: 'WikiRate', source_url: 'https://wikirate.org/',
      attribution: 'direct_company', company_name: 'BFI Waste Systems of Texas, LP',
      identity_tier: 'frs_affiliation', identity_verification: 'HIGH_CONFIDENCE',
      lookup_status: 'checked_no_data', parent_of_name: null, external_company_name: null,
      indicators: [] },
    { role: 'Facility Owner', source: 'WikiRate', source_url: 'https://wikirate.org/',
      attribution: 'direct_company', company_name: 'BROWNING-FERRIS INDUSTRIES INC',
      identity_tier: 'frs_affiliation', identity_verification: 'HIGH_CONFIDENCE',
      lookup_status: 'checked_no_data', parent_of_name: null, external_company_name: null,
      indicators: [] }
  ] }
};

// A record whose identity layer resolved nothing. The sustainability section must say nothing
// about sustainability here — the missing thing is the company, not the data.
export const UNRESOLVED = { id: 'proj-unresolved', name: 'Garfield Sec 1' };

// A record whose company is known but has not been queried yet.
export const NOT_CHECKED = {
  id: 'proj-notchecked', name: 'Pending lookup',
  sustainability: { companies: [
    { role: 'Operator', source: 'WikiRate', attribution: 'direct_company',
      company_name: 'Ward & Burke Tunneling Inc', identity_tier: 'identifier_backed',
      identity_verification: 'HIGH_CONFIDENCE', lookup_status: 'not_checked',
      parent_of_name: null, external_company_name: null, indicators: [] }
  ] }
};

// A DIRECT company that does have data — the presentation that must stay distinct from the
// parent-company one. Synthetic: no Del Valle direct company matched WikiRate.
export const DIRECT_WITH_DATA = {
  id: 'proj-direct', name: 'Synthetic direct-match record',
  sustainability: { companies: [
    { role: 'Developer', source: 'WikiRate', source_url: 'https://wikirate.org/',
      attribution: 'direct_company', company_name: 'Example Materials, Inc.',
      identity_tier: 'identifier_backed', identity_verification: 'VERIFIED',
      lookup_status: 'matched', parent_of_name: null, external_company_name: 'Example Materials',
      indicators: [
        { kind: 'performance', year: 2024, topic: 'Water use',
          label: 'Water the company reports withdrawing', value: '1,200,000 cubic metres',
          metric_designer: 'Commons', metric_name: 'Water Withdrawal',
          answer_url: 'https://wikirate.org/Commons+Water_Withdrawal+Example_Materials+2024.json',
          attribution_note: CC + 'Commons.', retrieved_at: RET }
      ] }
  ] }
};
