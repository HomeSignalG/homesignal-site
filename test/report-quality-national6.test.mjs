// national-6 (founder, 2026-11-02): an agency stage that says OCCUPANCY WAS APPROVED is its own stage, "Approved for occupancy — business opening
// not verified". It is never Approved / Coming (construction reached occupancy approval) and never Operating / Built (no record shows a business opened).
// Found on the 3101 Western Ave, Seattle sample: record 7108878-CN, agency status "Approved to Occupy", was shown as Approved / Coming.
// Run: node test/report-quality-national6.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import('../supabase/functions/_shared/national-report.ts');
globalThis.window = globalThis;
await import('../lib/project-type.js');
await import('../lib/da-report-view.js');
const V = globalThis.HS.daReportView;
let fails = 0, total = 0;
const ok = (c, name, detail) => { total++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); } };
const LABEL = 'Approved for occupancy — business opening not verified';

// ---- 1. the rule ---------------------------------------------------------------------------------------------------------------------------------
{
  ok(M.REPORT_VERSION === 'development-activity-national-6' && M.STAGE_RULE_VERSION === 'stage-evidence-3', '1a the report and the stage rule carry new versions');
  ok(M.STAGE_LABELS.occupancy === LABEL, '1b the stage label is the founder\'s wording');
  // the three values measured on production 2026-11-02, in the agencies' own spelling
  for (const v of ['Approved to Occupy', 'TCO Issued', 'Temporary C of O']) {
    ok(M.presentationStage('approved', v) === 'occupancy' && M.presentationStage('unknown', v) === 'occupancy', '1c "' + v + '" (approved or unknown lifecycle) is occupancy approved');
  }
  ok(M.presentationStage('approved', '  APPROVED TO OCCUPY ') === 'occupancy', '1d spacing and case are normalised the same way as every stage word');
  ok(M.presentationStage('operating', 'Approved to Occupy') === null && M.presentationStage('proposed', 'Approved to Occupy') === 'proposed',
    '1e the lifecycle still decides first for operating (no stage) and proposed records');
  ok(M.presentationStage('approved', 'Approved') === 'approved' && M.presentationStage('approved', 'Issued') === 'permitted' && M.presentationStage('approved', 'Approved for permitting') === 'approved',
    '1f controls: plain approval stays Approved / Coming, an issued permit stays Permitted');
  ok(M.stageEvidence('Approved to Occupy') === null, '1g occupancy approval is not issued-permit evidence');
  const fn = M.presentationStage.toString() + M.occupancyEvidence.toString();
  ok(!/seattle|arlington|mesa|zip|Date/i.test(fn), '1h the rule reads no source name, place or clock', fn);
}

// ---- 2. the report ---------------------------------------------------------------------------------------------------------------------------------
{
  const SRC = 'seattle-building-permits';
  const row = (k, d) => ({ source_key: k, feature_id: k + '#1', registry_id: SRC, provenance: 'proven_stored_point', distance_mi: d, geometry_type: 'ST_Point', has_more: false, marker_lat: 47.616 + d / 69, marker_lng: -122.35 });
  const proj = (k, stage, name) => ({ source_key: k, registry_id: SRC, record_kind: 'development', name, type: 'Commercial', type_raw: 'Commercial', status: 'Approved', stage,
    developer: null, size: null, investment: null, submitted_at: '2025-12-18', date_kind: 'filed', address: '2125 1st Ave', source_ref: 'https://services.seattle.gov/portal/customize/LinkToRecord.aspx?altId=' + k });
  const SUB = { address: '3101 Western Ave, Seattle, WA 98121', matched_address: '3101 WESTERN AVE, SEATTLE, WA, 98121', lat: 47.616, lng: -122.354, zip: '98121' };
  const out = M.assemble({ now: new Date('2026-11-02T18:00:00Z'), view: 'customer', zip_supported: true, radius_mi: M.REPORT_RADIUS_MI, attribution: { version: 1, attribution: {} }, subject: SUB,
    rows: [row('7108878-CN', 0.1), row('7000001-CN', 0.2)],
    projects: [proj('7108878-CN', 'Approved to Occupy', 'Commercial Construct initial tenant improvement'), proj('7000001-CN', 'Approved', 'Commercial Construct a new office')],
    ledger: [], events: [], health: [] });
  const I = out.intelligence;
  ok(JSON.stringify(I.sections.by_stage.occupancy) === '["7108878-CN"]' && JSON.stringify(I.sections.by_stage.approved) === '["7000001-CN"]',
    '2a the occupancy record is in its own stage, and the plain approval stays Approved / Coming', I.sections.by_stage);
  const p = I.projects.find((x) => x.project_id === '7108878-CN');
  ok(p.stage.key === 'occupancy' && p.stage.label === LABEL && p.stage.evidence === 'Occupancy approved' && p.lifecycle.key === 'approved' && p.publisher_stage === 'Approved to Occupy',
    '2b the record keeps its lifecycle and the agency\'s own words; only the stage changes', p);

  const response = { status: 'OK', report: Object.assign({}, I, { zip: '98121' }), render: { distances_mi: { '7108878-CN': 0.1, '7000001-CN': 0.2 }, bearings_deg: { '7108878-CN': 90, '7000001-CN': 180 } } };
  const h = V.html(response, { subject: SUB.address });
  const text = (x) => x.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const rec = (h.match(/<section class="da-rv-sec da-rv-sec--records"[\s\S]*?<\/section>/) || [''])[0];
  ok(text(rec).includes(LABEL) && /Source agency status: Approved to Occupy/.test(text(rec)), '2c the card says the occupancy label beside the agency\'s own status');
  const row1 = (rec.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*Construct initial tenant improvement[\s\S]*?<\/tr>/) || [''])[0];
  ok(row1 && !/Approved \/ Coming/.test(text(row1)) && !/Operating/.test(text(row1)), '2d the occupancy row says neither Approved / Coming nor Operating', text(row1).slice(0, 300));
  ok(/data-da-filter="stage" data-da-value="occupancy" aria-pressed="false">Approved for Occupancy <span class="da-rv-chipn">1<\/span>/.test(h), '2e the Stage filter has an Approved for Occupancy chip counting it');
  const svg = (h.match(/<svg class="da-rv-plot[\s\S]*?<\/svg>/) || [''])[0];
  ok(/<g class="da-rv-mk da-rv-mk--occupancy"[^>]*>[\s\S]*?<rect /.test(svg), '2f on the map it is a square (its own hollow style), not a circle');
  ok(/<li class="da-rv-stage--occupancy">[\s\S]*?Approved for Occupancy<\/li>/.test(h), '2g the map legend names it');
  ok(/1 approved for occupancy \(business opening not verified\)/.test(text(h)) && /1 approved \/ coming/.test(text(h)), '2h the briefing counts it on its own', text(h).slice(0, 600));
  // without such a record, the report has no occupancy chip or legend entry (every other report is unchanged)
  const plain = M.assemble({ now: new Date('2026-11-02T18:00:00Z'), view: 'customer', zip_supported: true, radius_mi: M.REPORT_RADIUS_MI, attribution: { version: 1, attribution: {} }, subject: SUB,
    rows: [row('7000001-CN', 0.2)], projects: [proj('7000001-CN', 'Approved', 'Commercial Construct a new office')], ledger: [], events: [], health: [] }).intelligence;
  const hp = V.html({ status: 'OK', report: Object.assign({}, plain, { zip: '98121' }), render: { distances_mi: { '7000001-CN': 0.2 }, bearings_deg: { '7000001-CN': 180 } } }, {});
  ok(!/occupancy/i.test(hp.replace(/<style[\s\S]*?<\/style>/g, '')), '2i a report with no occupancy record shows no occupancy chip, legend entry or briefing words');
  // a report saved before national-6 has no occupancy key at all and still renders
  const old = JSON.parse(JSON.stringify(response)); delete old.report.sections.by_stage.occupancy; old.report.projects.forEach((x) => { if (x.stage && x.stage.key === 'occupancy') x.stage = { key: 'approved', label: 'Approved / Coming' }; });
  const ho = V.html(old, {});
  ok(/Approved \/ Coming/.test(ho) && !/data-da-value="occupancy"/.test(ho), '2j a report saved before national-6 renders as it was saved');
}

console.log(`\n${total - fails} passed, ${fails} failed of ${total}`);
process.exit(fails ? 1 : 0);
