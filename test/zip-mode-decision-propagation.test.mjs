#!/usr/bin/env node
// MAP 1 ZIP MODE CARRIES A SOURCED DECISION TO THE CARD (2026-11-13).
//
// The defect: app_zip_projects_markers returns each project with its stored status and provenance, but
// HS.zipAuthSiteFromMarker built the site without `decision`, `decided` or `decision_evidence`. A denied or
// withdrawn project therefore stayed under Proposed (correct) with no outcome note, read "Application on file",
// and HS.isActiveUndecided counted it as a live proposal. The older decision suites passed because they attach a
// decision to a hand-made site; none of them went through the ZIP-mode builder. This one does: every fixture is a
// marker + project in a payload, passed through the REAL HS.zipModeSites, then through the existing helpers
// (HS.decisionOf, HS.decisionNotation, HS.currentStatusLine, HS.isActiveUndecided, HS.activeUndecidedCount).
//
// The builder can only show what the incoming provenance carries. Until docs/decision-provenance-migration.sql is
// applied and ZIPs are refreshed, production provenance has no `decision` key, so nothing here proves production.
//
// Run: node test/zip-mode-decision-propagation.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { console };
ctx.window = ctx; ctx.HS = {};
vm.createContext(ctx);
for (const f of ['lib/project-type.js', 'lib/residential-qualify.js', 'lib/map.js', 'lib/n5-radius.js', 'lib/zip-authoritative.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
}
const HS = ctx.HS;

let fails = 0;
const ok = (c, m) => { if (c) console.log('PASS — ' + m); else { fails++; console.log('FAIL — ' + m); } };

// A fixture is a project row as app_zip_projects_markers returns it (to_jsonb of app_projects + project_ref).
let n = 0;
function fixture(over) {
  n++;
  const ref = 'src|' + n;
  const project = Object.assign({
    project_ref: ref, name: 'Fixture Plaza ' + n, type: 'Commercial', type_raw: 'Conditional use',
    status: 'Proposed', source_ref: 'https://records.example.gov/case/' + n, registry_id: 'fixture-reg',
    submitted_at: '2026-01-05', date_kind: 'filed', provenance: {}
  }, over);
  return { ref, project };
}
function sitesFor(fixtures) {
  const payload = {
    status: 'boundary_complete',
    projects: fixtures.map((f) => f.project),
    markers: fixtures.map((f, i) => ({ project_ref: f.ref, marker_seq: 0, lat: 30.1 + i / 1000, lng: -97.7, marker_rule: 'POINT' }))
  };
  return HS.zipModeSites([], payload, [], [], []);   // the real ZIP-mode assembler
}
// The page's decisionSubject (homesignalmap.html), pinned structurally below.
const subject = (s) => { const r = String((s && (s.type_raw || s.permit_class)) || '').trim(); return (!r || r.length > 48) ? 'Application' : r + ' application'; };
const note = (s) => HS.decisionNotation(HS.decisionOf(s), subject(s));
const line = (s) => HS.currentStatusLine(HS.decisionOf(s), s.decision_evidence || 'none');

const denied = fixture({ status: 'Decided', provenance: { decision: {
  outcome: 'denied', outcome_label: 'Denied', status_raw: 'Denied', decided_on: '2026-03-02', basis: 'source_status',
  source_url: 'https://records.example.gov/case/denied', source_precision: 'record', later_disposition_verified: false } } });
const withdrawn = fixture({ status: 'Decided', provenance: { decision: {
  outcome: 'withdrawn', outcome_label: 'Withdrawn by applicant', status_raw: 'Withdrawn', decided_on: '2026-04-09', basis: 'source_status',
  source_url: 'https://records.example.gov/case/withdrawn', source_precision: 'record', later_disposition_verified: false } } });
const undated = fixture({ status: 'Decided', submitted_at: '2026-01-05', provenance: { decision: {
  outcome: 'denied', outcome_label: 'Denied', status_raw: 'Denied', decided_on: null, basis: 'source_status',
  source_url: 'https://records.example.gov/case/undated', source_precision: 'record', later_disposition_verified: false } } });
const decidedBare = fixture({ status: 'Decided', provenance: {} });
const unsourced = fixture({ status: 'Decided', provenance: { decision: { outcome: 'denied', outcome_label: 'Denied', decided_on: '2026-03-02', basis: 'source_status', source_url: '' } } });
const badOutcome = fixture({ status: 'Decided', provenance: { decision: { outcome: 'expired', outcome_label: 'Expired', decided_on: '2026-03-02', basis: 'source_status', source_url: 'https://records.example.gov/x' } } });
const cancelled = fixture({ status: 'Decided', provenance: { decision: { outcome: 'cancelled', outcome_label: 'Canceled', decided_on: '2026-03-02', basis: 'source_status', source_url: 'https://records.example.gov/y' } } });
const pending = fixture({ status: 'Proposed', provenance: { source_vintage: '2026-10' } });
const pendingNoProv = fixture({ status: 'Proposed', provenance: undefined });

const all = [denied, withdrawn, undated, decidedBare, unsourced, badOutcome, cancelled, pending, pendingNoProv];
const sites = sitesFor(all);
const by = (f) => sites.find((s) => s.zip_project_ref === f.ref);
ok(sites.length === all.length && all.every((f) => by(f)), 'every fixture reaches the map through HS.zipModeSites (' + sites.length + ' of ' + all.length + ')');

// 1. denied + source + date
const d = by(denied);
ok(HS.decisionOf(d) && HS.decisionOf(d).outcome === 'denied', 'denied: the decision survives the builder and validates');
ok(note(d) === 'Conditional use application denied on 2 Mar 2026.', 'denied: note reads "' + note(d) + '"');
ok((d.decision || {}).source_url === 'https://records.example.gov/case/denied', 'denied: the supporting source link is carried');
ok(line(d) === 'Denied on the record · Any later appeal or re-filing is not verified.', 'denied: status line is the decision line, not "Application on file"');
ok(HS.isActiveUndecided(d) === false, 'denied: not an active undecided proposal');

// 2. withdrawn + source + date
const w = by(withdrawn);
ok(note(w) === 'Conditional use application withdrawn by the applicant on 9 Apr 2026.', 'withdrawn: note reads "' + note(w) + '"');
ok(HS.isActiveUndecided(w) === false, 'withdrawn: not an active undecided proposal');
ok(line(w).indexOf('Withdrawn by applicant on the record') === 0, 'withdrawn: status line names the withdrawal');

// 3. valid decision, no date: explicit wording, never the filing date
const u = by(undated);
ok(note(u) === 'Conditional use application denied · date not stated by the source.', 'undated: note reads "' + note(u) + '"');
ok(note(u).indexOf('2026-01') === -1 && note(u).indexOf('Jan 2026') === -1, 'undated: no filing-date fallback in the note');
ok((u.decision || {}).decided_on === null && u.file_date === '2026-01-05', 'undated: decided_on stays null; the filing date stays in file_date only');
ok(HS.isActiveUndecided(u) === false, 'undated: not active');

// 4. Decided without valid evidence: no invented outcome, but never counted as live
for (const [name, f] of [['no decision object', decidedBare], ['decision with no source URL', unsourced], ['outcome "expired"', badOutcome], ['outcome "cancelled"', cancelled]]) {
  const s = by(f);
  ok(HS.decisionOf(s) === null && s.decision === undefined, 'Decided + ' + name + ': no decision carried, no note');
  ok(note(s) === '', 'Decided + ' + name + ': no outcome text');
  ok(line(s) === 'Application on file · Current decision status not verified.', 'Decided + ' + name + ': honest "not verified" line, no denial or withdrawal claimed');
  ok(HS.isActiveUndecided(s) === false, 'Decided + ' + name + ': still not counted as an active proposal');
}

// 5. ordinary pending proposal unchanged
for (const f of [pending, pendingNoProv]) {
  const s = by(f);
  ok(s.decision === undefined && s.decided === undefined && s.decision_evidence === undefined, 'pending: no decision keys added');
  ok(HS.isActiveUndecided(s) === true && note(s) === '', 'pending: still active, no note');
}

// 6. every decided fixture stays in Proposed
for (const [name, f] of [['denied', denied], ['withdrawn', withdrawn], ['undated', undated], ['decided-bare', decidedBare], ['unsourced', unsourced]]) {
  const s = by(f);
  ok(s.bucket === 'proposed' && s.type === 'proposed', name + ': stays in the Proposed bucket');
}

// 7. counts: the active count over the whole set is the two pending records only
ok(HS.activeUndecidedCount(sites) === 2, 'active proposal count over all ' + sites.length + ' sites is 2 (the two pending), got ' + HS.activeUndecidedCount(sites));
ok(sites.filter((s) => s.bucket === 'proposed').length === all.length, 'the Proposed set still holds all ' + all.length + ' (decided records are not removed)');


// 9. the page renders through the same helpers (structural: nothing here re-decides)
const page = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
ok(/function decisionSubject\(s\)\{[^}]*type_raw \|\| s\.permit_class/.test(page), 'the page subject helper reads permit_class, which the builder carries from type_raw');
ok(/function decisionNoteHTML\(s, cls\)\{\s*var d = decisionOf\(s\);/.test(page), 'the page renders the note from decisionOf(site)');

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nAll ZIP-mode decision propagation checks passed.');
process.exit(fails ? 1 : 0);
