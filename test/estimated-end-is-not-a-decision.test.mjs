// An estimated or scheduled END date is not a decision (Florida pre-launch audit, 2026-10-20).
//
// WHY. fdot-active-construction-projects mapped column_map.decision_date to EstEndDate, FDOT's
// ESTIMATED construction end. Two shipped paths then read it as a decision:
//   - sources/decision.ts decisionEvidenceLevel() returned "date_only" ("we can date a decision this
//     source records") for a source that records no decisions at all;
//   - public.app_refresh_zip falls back to decision_date when file_date is empty and stamps
//     date_kind 'decided' (docs/date-kind-migration.sql), so the generated project page printed
//     "Date on record: <estimated end> (decided)".
// Measured on app_projects 2026-10-20 (control: 4,369 FDOT rows): 577 FDOT rows carried
// date_kind 'decided', 390 of them dated in the future (up to 2029-01-23), all on Florida pages.
// The same mapping sat on six more entries (UDOT x2, Clark County NV, Lexington KY, Columbia MO,
// Lake County IL). The fix is the registry: those columns are no longer mapped as decision_date. A row
// with a start date keeps it; a row with none is honestly undated instead of "decided".
// Run: node scripts/run-unit-tests.mjs   (or: node test/estimated-end-is-not-a-decision.test.mjs)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = join(root, 'supabase/functions/get-address-report');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const { decisionEvidenceLevel } = await import(join(fn, 'sources/decision.ts'));
const registry = JSON.parse(readFileSync(join(fn, 'jurisdiction-registry.json'), 'utf8'));
const entries = [];
(function walk(o) {
  if (Array.isArray(o)) { o.forEach(walk); return; }
  if (o && typeof o === 'object') {
    if (o.registry_id && o.column_map && typeof o.column_map === 'object') entries.push(o);
    Object.values(o).forEach(walk);
  }
})(registry);
ok(entries.length >= 200, 'control: the registry walk sees every entry', 'saw ' + entries.length);

const cols = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);
// A column NAMED as an estimate or an end (est_compl_dat, EstEndDate, End_Date, project_end_date …).
const ESTIMATED_OR_END = /(^|_|[a-z])(est|end)(?=[A-Z_]|_|$|date|dat|compl|const|imated)|estimated|end_?date/i;

console.log('\n1) the seven entries no longer map an end date into the decision slot');
const FIXED = ['fdot-active-construction-projects', 'udot-active-projects', 'udot-active-projects-lines',
  'clark-county-active-projects', 'lexington-row-permits', 'columbia-mo-capital-projects',
  'lake-county-il-construction-program'];
for (const id of FIXED) {
  const e = entries.find((x) => x.registry_id === id);
  ok(!!e, id + ' exists');
  if (!e) continue;
  ok(cols(e.column_map.decision_date).length === 0, id + ': no decision_date mapping');
  ok(cols(e.column_map.file_date).length === 1, id + ': its start date is still mapped as file_date');
  ok(decisionEvidenceLevel(e) === 'none', id + ': decision evidence is "none", not "date_only"',
    'got ' + decisionEvidenceLevel(e));
}

console.log('\n2) no entry maps an estimated or end-date column as a decision date');
// Positive control: the pattern catches every column the seven entries used to map.
for (const c of ['EstEndDate', 'est_compl_dat', 'EstConstComplete', 'EstimatedEndDate', 'project_end_date', 'End_Date']) {
  ok(ESTIMATED_OR_END.test(c), 'pattern catches ' + c);
}
// Over-flagging control: real decision columns still in the registry are not caught.
for (const c of ['issueddate', 'APPROVED_DATE', 'FN_APV_DT', 'PCDate', 'EFFECTIVEDATE', 'record_status_date',
  'Status_Date', 'DecisionIssued', 'cc_decision_date', 'RECORDEDDA', 'completeDate', 'FinalDate']) {
  ok(!ESTIMATED_OR_END.test(c), 'pattern leaves ' + c + ' alone');
}
const offenders = entries.filter((e) => cols(e.column_map.decision_date).some((c) => ESTIMATED_OR_END.test(c)))
  .map((e) => e.registry_id + ':' + cols(e.column_map.decision_date).join(','));
ok(offenders.length === 0, 'no estimated/end column in any decision_date mapping', offenders.join(' '));

console.log('\n3) entries that declare a scheduled or estimated date carry no decision date');
const sched = entries.filter((e) => e.file_date_kind === 'scheduled' || e.file_date_kind === 'estimated');
ok(sched.length >= 2, 'control: scheduled/estimated entries exist', 'saw ' + sched.length);
const bad = sched.filter((e) => cols(e.column_map.decision_date).length > 0).map((e) => e.registry_id);
ok(bad.length === 0, 'none of them maps decision_date', bad.join(' '));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
