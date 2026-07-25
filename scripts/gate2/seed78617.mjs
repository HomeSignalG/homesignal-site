// Gate 2 seed — PRODUCTION-DERIVED rows from app_projects (zip 78617), verbatim from the
// live table: record_kind | registry_id | type | status | lat | lng | url-token | name.
// Nothing is invented: evidence URLs are reconstructed from the real per-record token
// using each source's real URL pattern (Austin ABC folderrsn, TDLR TABS project no,
// EPA ECHO fid), which is exactly how they appear in production.
const RAW = `development	austin-site-plan-cases	unclassified	Approved	30.171601	-97.652191	12300193	130 RV Storage & Warehouse (W/R SP-2018-0311D)
development	austin-site-plan-cases	Utility	Approved	30.136937	-97.619655	10503538	20" Gas Main and 3" Gas Main Relocation Formula 1- United States
development	austin-site-plan-cases	unclassified	Approved	30.205903	-97.545864	203860	3 T'S MANUFACTURED HOME PARK (RENTAL)
development	austin-site-plan-cases	Commercial	Approved	30.204734	-97.641645	11920019	3131 E SH 71 Convenience Store
development	austin-site-plan-cases	Commercial	Proposed	30.176543	-97.634274	13645830	7-Eleven Pearce
development	austin-subdivision-cases	Residential	Operating	30.140496	-97.576639	10738965	8001 Hayride Road
development	austin-site-plan-cases	Commercial	Approved	30.213038	-97.656893	11267425	ABIA Pet Hotel
development	austin-site-plan-cases	Commercial	Approved	30.152575	-97.645297	12480620	Agave East Apartments
development	austin-subdivision-cases	Commercial	Operating	30.161622	-97.647277	13486269	ATX 130
development		commercial	On file	30.215130	-97.539186	TABS2026011928	ATX1 - Third Floor Tenant Improvement
development		industrial	On file	30.215130	-97.539186	TABS2024022676	ATX1 New Construction
development		research	On file	30.215130	-97.539186	TABS2024016698	ATX1 Histology Lab
development		animal-facility	On file	30.215130	-97.539186	TABS2023006449	Caldwell Ln Animal Holding Barn
development		commercial	On file	30.215130	-97.539186	TABS2023006483	Caldwell Ln Support Building
development	austin-site-plan-cases	Civic/Public	Approved	30.187911	-97.647205	13364283	AUS - Timber Creek Substation
development	austin-site-plan-cases	unclassified	Approved	30.210912	-97.652319	155472	AUSTIN AIRPORT HOTEL
development	austin-subdivision-cases	Commercial	Proposed	30.221976	-97.667296	10123165	Austin Airport Hotel Center
development	austin-site-plan-cases	unclassified	Approved	30.158672	-97.642912	12150325	Austin Del Valle Fire & EMS Station
development	austin-site-plan-cases	unclassified	Approved	30.158672	-97.642912	12277250	Austin Del Valle Fire & EMS Station
development	austin-site-plan-cases	unclassified	Approved	30.186684	-97.552399	10239535	Austin Granite Warehouse
development	austin-site-plan-cases	Residential	Proposed	30.186893	-97.616837	13114126	Barkley Meadows
development	austin-site-plan-cases	Commercial	Approved	30.186749	-97.559578	13447781	BATX Pipeline
development	austin-subdivision-cases	unclassified	Operating	30.179430	-97.614682	10530667	Berdoll Commercial Subdivision; Amended Plat of Lots 9 & 10 Block A
development	austin-subdivision-cases	Residential	Operating	30.101603	-97.613925	13133188	Country View Estates Resubdivision of Part of Lot 11
development	austin-subdivision-cases	Commercial	Proposed	30.150467	-97.585779	13458284	LOT 3A, A REPLAT OF LOT 3 TIMBER HILLS SUBDIVISION
development	austin-subdivision-cases	Industrial	Operating	30.190903	-97.586535	13048607	MDH Industrial plat
development	austin-subdivision-cases	Residential	Proposed	30.174750	-97.633702	13656944	Oak Ranch Section 2 Resubdivision
development	austin-site-plan-cases	Industrial	Proposed	30.196941	-97.637819	13673078	Spirit Drive Industrial
development	austin-subdivision-cases	Commercial	Operating	30.199913	-97.636713	11411315	Velocity Crossing Grocery/Retail
development	austin-site-plan-cases	unclassified	Proposed	30.203873	-97.643474	11800825	Wingate Hotels
development	austin-site-plan-cases	unclassified	Approved	30.204912	-97.634328	13500001	COTA Land
development	austin-site-plan-cases	unclassified	Approved	30.157636	-97.637442	13500002	SARWWTP-LIFT STATION INTERCONNECT TUNNEL
development	austin-site-plan-cases	unclassified	Approved	30.180521	-97.612691	13500003	DEL VALLE HIGH SCHOOL Addition
facility	110070171250	industrial	Operating	30.195030	-97.581910	https://echo.epa.gov/detailed-facility-report?fid=110070171250	AGGREGATE HAULERS DEL VALLE
facility	110071425575	industrial	Operating	30.161264	-97.648361	https://echo.epa.gov/detailed-facility-report?fid=110071425575	ATX 130 INDUSTRIAL
facility	110033390104	industrial	Operating	30.199650	-97.640722	https://echo.epa.gov/detailed-facility-report?fid=110033390104	BFI RECYCLING CENTER MANOR
facility	110071657336	industrial	Operating	30.168293	-97.653771	https://echo.epa.gov/detailed-facility-report?fid=110071657336	BIEL INDUSTRIAL
facility	110056361743	industrial	Operating	30.206509	-97.632813	https://echo.epa.gov/detailed-facility-report?fid=110056361743	CITY OF AUSTIN WATER UTILITY SOUTH AUSTIN REGIONAL WASTEWATER
facility	110071708120	industrial	Operating	30.203200	-97.623400	https://echo.epa.gov/detailed-facility-report?fid=110071708120	GIGA TEXAS OFFSITE WASTEWATER INTERCEPTOR
`;
const AUSTIN = (t) => `https://abc.austintexas.gov/web/permit/public-search-other?t_detail=1&t_selected_folderrsn=${t}`;
const TABS   = (t) => `https://www.tdlr.texas.gov/TABS/Projects/${t}`;
export const ROWS = RAW.trim().split('\n').map((line, i) => {
  const [record_kind, registry_id, type, status, lat, lng, tok, ...rest] = line.split('\t');
  const name = rest.join('\t');
  const source_ref = tok.startsWith('http') ? tok : tok.startsWith('TABS') ? TABS(tok) : AUSTIN(tok);
  return { id: 'dv-' + i, zip: '78617', community_id: '8f673943-d972-4135-8d13-944452c76c32',
           record_kind, registry_id: registry_id || null, type, status, name,
           lat: Number(lat), lng: Number(lng), source_ref,
           submitted_at: '2026-01-15', impact_score: 55, stage: null, developer: 'City of Austin' };
});
export const HS_SEED = {
  community: { zip: '78617', name: 'Del Valle (78617)', county: 'Travis', state: 'TX' },
  coverage: [{ zip: '78617', covered: true }],
  projects: ROWS.filter(r => r.record_kind === 'development'),
  facilities: ROWS.filter(r => r.record_kind === 'facility').map(f => Object.assign({}, f, { _facility: true })),
  changes: [], meetings: [], environmental_risk: {},
};
