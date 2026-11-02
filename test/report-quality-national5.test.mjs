// national-5 (2026-11-02): fixes from the audit of the 3101 Western Ave, Seattle sample, each tested on the records that exposed it and on
// controls that must NOT change.
//   1. a stage word the agency did not publish (a connector's `status_const`) is never shown as the agency's status;
//   2. a date carries the source's own words for what it means when the registry states them (Washington SEPA Register: a publication date);
//   3. "Phase Issued" (Seattle: one phase of a phased permit is issued) is an issued permit;
//   4. Seattle's own "Institutional" permit class is Civic & public, not Commercial;
//   5. Change History shows a record's stage in the same words as its card, and labels HomeSignal's own status as HomeSignal's;
//   6. map markers that would overlap are set apart so every number is readable, each keeping a line to its true spot.
// Run: node test/report-quality-national5.test.mjs
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
const read = (f) => readFileSync(join(root, f), 'utf8');
const reg = JSON.parse(read('supabase/functions/get-address-report/jurisdiction-registry.json'));
const entry = (id) => ['socrata', 'arcgis', 'ckan', 'csv', 'carto'].flatMap((c) => reg[c] || []).find((e) => e.registry_id === id);

// ---- 1. a status the agency did not publish ----------------------------------------------------------------------------------------------------
{
  const sepa = M.publisherOf('wa-ecology-sepa-register');
  ok(sepa.status_const === 'proposed' && entry('wa-ecology-sepa-register').status_const === 'proposed' && !entry('wa-ecology-sepa-register').column_map.status_raw,
    '1a the SEPA Register has no status column; its stored stage is the connector constant, and the report knows the constant', sepa);
  ok(M.agencyStage('proposed', sepa) === null, '1b the constant is not the agency\'s status');
  const sea = M.publisherOf('seattle-building-permits');
  ok(M.agencyStage('Corrections Required', sea) === 'Corrections Required' && M.agencyStage('proposed', sea) === 'proposed' && sea.status_const === null,
    '1c a source with a status column keeps every stage word, even one that looks like a constant');
  ok(M.agencyStage('Plan Review', sepa) === 'Plan Review' && M.agencyStage(null, sepa) === null && M.agencyStage('  ', sepa) === null, '1d only the exact constant is withheld; no stage is no stage');
  const fn = M.agencyStage.toString();
  ok(!/sepa|ecology|seattle|washington|zip|now|Date/i.test(fn), '1e the rule reads no source name, place or clock', fn);
}

// ---- 2. what a date means, in the source's own words -------------------------------------------------------------------------------------------
{
  ok(entry('wa-ecology-sepa-register').file_date_label === 'Published in the SEPA Register' && entry('wa-ecology-sepa-register').column_map.file_date === 'publisheddate',
    '2a the SEPA Register\'s one date is its publication date, and the registry says so');
  ok(M.publisherOf('wa-ecology-sepa-register').date_label === 'Published in the SEPA Register' && M.publisherOf('seattle-land-use-permits').date_label === null,
    '2b the label reaches the report through the generated publisher file only where the registry states it');
  // the rule the label replaces: the stored date kind ('filed') is unchanged, so the change ledger sees no change from this (a date_kind change is material)
  ok(entry('wa-ecology-sepa-register').file_date_kind === 'filed', '2c the stored date kind is untouched: no change event is manufactured by a label');
}

// ---- 3. Phase Issued -------------------------------------------------------------------------------------------------------------------------
{
  ok(M.STAGE_RULE_VERSION === 'stage-evidence-2' && M.stageEvidence('Phase Issued') && M.stageEvidence('Phase Issued').kind === 'permit_issued', '3a "Phase Issued" is an issued permit');
  ok(M.presentationStage('approved', 'Phase Issued') === 'permitted' && M.presentationStage('approved', 'Approved to Occupy') === 'approved'
    && M.stageEvidence('phased permitting') === null, '3b a control: "Approved to Occupy" and "phased permitting" are still not issued-permit evidence');
}

// ---- 4. Seattle's "Institutional" class ------------------------------------------------------------------------------------------------------
{
  for (const id of ['seattle-building-permits', 'seattle-land-use-permits']) {
    const tm = entry(id).type_map;
    ok(tm.Institutional === 'Civic/Public' && tm.Commercial === 'Commercial' && tm.Industrial === 'Industrial', '4a ' + id + ': Institutional is Civic/Public; the other classes are unchanged');
  }
  const t = globalThis.HS.projectType.canonicalProjectType({ type: 'Civic/Public', name: 'Institutional Construct alterations to performing arts building [PHELPS CENTER  PACIFIC NW BALLET] on institutional camp' });
  ok(t && t.typeKey === 'civic', '4b the shared Type authority files the mapped value as Civic & public', t);
}

// ---- 5. Change History, and 6. the map ---------------------------------------------------------------------------------------------------------
{
  const P = (id, name, extra) => Object.assign({ project_id: id, name, type: { key: 'commercial', label: 'Commercial' }, lifecycle: { key: 'approved', label: 'Approved' },
    stage: { key: 'permitted', label: 'Permitted / Under Construction', evidence: 'Permit issued' }, publisher_stage: 'Issued', publisher_status: 'Approved',
    source: { url: 'https://example.gov/r/' + id, attribution: null, agency: 'City of Example', feed_ref: 'data.example.gov, dataset abcd-1234', record_id: id }, scope: { key: 'development' } }, extra || {});
  const projects = [
    P('S1', 'Construct alterations to a commercial building', { homesignal_observation: { first_observed_at: '2026-09-28T07:50:00Z', last_observed_at: '2026-10-31T01:02:00Z', observation_count: 15, change_ready: true },
      homesignal_detected_changes: [{ event_type: 'status_changed', detected_at: '2026-10-30T12:00:00Z', changes: [{ field: 'stage', from: 'Awaiting Information', to: 'Issued' }, { field: 'status', from: 'Proposed', to: 'Approved' }] }] }),
    P('E1', '315 1ST AVE N', { type: { key: 'other', label: 'Other project' }, lifecycle: { key: 'proposed', label: 'Proposed' }, stage: { key: 'proposed', label: 'Proposed / Under Review' },
      publisher_stage: null, publisher_stage_unpublished: true, publisher_status: 'Proposed', record_date: { kind: 'filed', label: 'Published in the SEPA Register', date: '2026-05-14', older_than_a_year: false, verify: null } }),
    P('C1', 'Construct alterations to an office', { lifecycle: { key: 'proposed', label: 'Proposed' }, stage: { key: 'proposed', label: 'Proposed / Under Review' }, publisher_stage: 'Corrections Required', publisher_status: 'Proposed' }),
  ];
  // the eight that crowded the 3101 Western map: five within a few hundredths of a mile of each other, and three on the inner ring's label
  const crowd = { A: [0.42, 316], B: [0.41, 320], D: [0.41, 323], F: [0.40, 326], G: [0.41, 329], H: [0.27, 357], I: [0.27, 1], J: [0.27, 5] };
  for (const k of Object.keys(crowd)) projects.push(P(k, 'Construct building ' + k, { stage: { key: 'proposed', label: 'Proposed / Under Review' }, lifecycle: { key: 'proposed', label: 'Proposed' }, publisher_stage: 'Reviews In Process' }));
  const dist = { S1: 0.1, E1: 0.3, C1: 0.2 }, brg = { S1: 90, E1: 0, C1: 180 };
  for (const k of Object.keys(crowd)) { dist[k] = crowd[k][0]; brg[k] = crowd[k][1]; }
  const ids = projects.map((p) => p.project_id);
  const response = { status: 'OK', report: { radius_mi: 0.5, as_of: '2026-11-02T18:00:00Z', zip: '98121', recent_days: 90, projects, coverage: { source_feed_count: 1, limitations: [], change_ready: true },
    sections: { by_stage: { approved: [], proposed: ids.filter((i) => i !== 'S1'), permitted: ['S1'] }, by_lifecycle: { approved: ['S1'], proposed: ids.filter((i) => i !== 'S1'), operating: [], unknown: [] },
      what_changed_recently: ['S1'], recent_official_activity: [] } },
    render: { distances_mi: dist, bearings_deg: brg } };
  const h = V.html(response, { subject: '3101 Western Ave, Seattle, WA 98121' });
  const text = (x) => x.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const rec = (h.match(/<section class="da-rv-sec da-rv-sec--records"[\s\S]*?<\/section>/) || [''])[0];
  const hist = (h.match(/<section class="da-rv-sec da-rv-sec--history"[\s\S]*?<\/section>/) || [''])[0];
  ok(/The agency publishes no status for this record\./.test(text(rec)) && (text(rec).match(/The agency publishes no status/g) || []).length === 1 && !/Source agency status: proposed/.test(text(rec)),
    '1f the SEPA row says the agency publishes no status, once, and never prints the constant as the agency\'s');
  ok(/Source agency status: Corrections Required/.test(text(rec)), '1g a row whose agency did publish a status still shows it');
  ok(/Official record: Published in the SEPA Register · May 14, 2026/.test(text(rec)) && !/Filed · May 14, 2026/.test(text(rec)), '2d the SEPA date reads as a publication, not a filing');
  ok(/<h3 class="da-rv-title">Construct alterations to a commercial building<\/h3><span class="da-rv-stage da-rv-stage--permitted"[^>]*>[\s\S]*?Permitted \/ Under Construction/.test(hist),
    '5a Change History shows the stage the card shows (Permitted / Under Construction), not the bare lifecycle word', hist.slice(0, 400));
  ok(/HomeSignal status: Proposed → Approved/.test(text(hist)) && /Publisher stage: Awaiting Information → Issued/.test(text(hist)) && !/ Status: Proposed/.test(text(hist).replace('HomeSignal status', '')),
    '5b HomeSignal\'s own status is labelled as HomeSignal\'s, beside the publisher\'s stage');
  // the map: every pair of markers at least a marker apart, every marker inside the plot, and each moved one draws a line to its true spot
  const svg = (h.match(/<svg class="da-rv-plot[\s\S]*?<\/svg>/) || [''])[0];
  const mk = [...svg.matchAll(/<g class="da-rv-mk [^"]*"[^>]*transform="translate\(([\d.-]+) ([\d.-]+)\)">[\s\S]*?>(\d+)<\/text><\/g>/g)].map((m) => ({ x: +m[1], y: +m[2], n: m[3] }));
  let minD = Infinity;
  for (let i = 0; i < mk.length; i++) for (let j = i + 1; j < mk.length; j++) minD = Math.min(minD, Math.hypot(mk[i].x - mk[j].x, mk[i].y - mk[j].y));
  ok(mk.length === projects.length && minD >= 19.5, '6a every marker number stands clear of every other (closest pair ' + minD.toFixed(1) + ' units; a marker is 18 wide)', mk.length);
  ok(mk.every((m) => m.x >= 11 && m.x <= 349 && m.y >= 11 && m.y <= 349), '6b every marker stays inside the plot');
  const ringLab = { x0: 182, x1: 220, y0: 89, y1: 105 };
  ok(mk.every((m) => m.x + 9 <= ringLab.x0 || m.x - 9 >= ringLab.x1 || m.y + 9 <= ringLab.y0 || m.y - 9 >= ringLab.y1), '6c no marker covers the inner ring\'s distance label');
  const leads = [...svg.matchAll(/<g class="da-rv-mklead" data-da-type="(\w+)" data-da-stage="(\w+)"><line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)];
  ok(leads.length >= 5 && leads.every((l) => mk.some((m) => Math.abs(m.x - +l[3]) < 0.11 && Math.abs(m.y - +l[4]) < 0.11)), '6d each moved marker has a line from it to its true spot, carrying the filter hooks', leads.length);
  ok(svg.indexOf('da-rv-mklead') < svg.indexOf('class="da-rv-mk '), '6e the lines are drawn under every marker, so no line crosses a number');
  const lone = V.html(Object.assign({}, response, { report: Object.assign({}, response.report, { projects: [projects[0]], sections: Object.assign({}, response.report.sections, { by_stage: { approved: [], proposed: [], permitted: ['S1'] } }) }) }), {});
  ok(!/da-rv-mklead/.test(lone) && /translate\(203\.0 180\.0\)|translate\(210\.0 180\.0\)/.test(lone), '6f a marker with room is drawn exactly at its spot, with no line', (lone.match(/translate\([^)]*\)/) || [])[0]);
  ok(/Markers that would overlap are set apart; a thin line points to each one’s spot\./.test(h), '6g the map note says markers may be set apart');
  // a record with no stage of its own: Change History falls back to the lifecycle badge, which keeps its word and its own drawing
  const nost = (key, label) => P('N' + key, 'Record without a stage ' + key, { stage: null, lifecycle: { key, label },
    homesignal_detected_changes: [{ event_type: 'status_changed', detected_at: '2026-10-30T12:00:00Z', changes: [{ field: 'status', from: 'Proposed', to: label }] }] });
  const fb = V.html(Object.assign({}, response, { report: Object.assign({}, response.report, { projects: [nost('approved', 'Approved'), nost('proposed', 'Proposed')],
    what_changed_recently: ['Napproved', 'Nproposed'], sections: { by_stage: { approved: [], proposed: [], permitted: [] }, by_lifecycle: { approved: ['Napproved'], proposed: ['Nproposed'], operating: [], unknown: [] },
      what_changed_recently: ['Napproved', 'Nproposed'], recent_official_activity: [] } }) }), {});
  const fbh = (fb.match(/<section class="da-rv-sec da-rv-sec--history"[\s\S]*?<\/section>/) || [''])[0];
  const badge = (k) => (fbh.match(new RegExp('<span class="da-rv-life da-rv-life--' + k + '" data-lifecycle="' + k + '">([\\s\\S]*?)<span class="da-rv-lifetext">([^<]*)</span>')) || []);
  ok(badge('approved')[2] === 'Approved' && badge('proposed')[2] === 'Proposed', '5c with no stage, Change History shows the lifecycle badge with its word', fbh.slice(0, 500));
  ok(badge('approved')[1] && badge('proposed')[1] && badge('approved')[1] !== badge('proposed')[1], '5d and Approved and Proposed are drawn differently there');
  const again = V.html(response, { subject: '3101 Western Ave, Seattle, WA 98121' });
  ok(again === h, '6h the same report draws the same map every time');
}

console.log(`\n${total - fails} passed, ${fails} failed of ${total}`);
process.exit(fails ? 1 : 0);
