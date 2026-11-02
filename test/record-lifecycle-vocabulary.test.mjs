// The national record stage and activity vocabulary (lib/project-type.js HS.recordLifecycle).
// Run: node test/record-lifecycle-vocabulary.test.mjs
//
// Plan: docs/lifecycle-classification-audit-2026-11-01.md §4 and founder decisions D1–D8
// (2026-11-01). Nothing reads this vocabulary yet (release gate §10); these tests pin the rules
// it must carry before any surface is switched to it.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let failures = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { failures++; console.error('FAIL — ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
};
function load(files) {
  const win = { HS: {} };
  for (const f of files) new Function('window', 'document', read(f))(win, undefined);
  return win.HS;
}
const HS = load(['lib/project-type.js']);
const L = HS.recordLifecycle;
ok(!!L, '0: HS.recordLifecycle is defined');

// ── 1. The four columns are unchanged ───────────────────────────────────────────────
ok(JSON.stringify(HS.projectType.LIFECYCLE_KEYS) === JSON.stringify(['proposed', 'approved', 'operating', 'unknown']),
  '1a: LIFECYCLE_KEYS is exactly the four existing columns');
const cols = new Set();
for (const c of L.RECORD_CLASSES) for (const s of L.RECORD_STAGES) for (const p of [null, 'proposed', 'approved', 'operating', 'unknown']) {
  const col = L.stageColumn(c, s, p); if (col !== null) cols.add(col);
}
ok([...cols].every((c) => HS.projectType.LIFECYCLE_KEYS.indexOf(c) !== -1),
  '1b: every stage, class and prior column maps into one of the four columns (or is not shown)', [...cols]);
ok(L.stageColumn('building_permit', 'invalid_record', null) === null, '1c: invalid_record is not shown');
ok(L.stageColumn('building_permit', 'nonsense', null) === null, '1d: a stage outside the vocabulary fails closed (null)');

// ── 2. Operating now needs operation evidence (D3) and never comes from an entitlement ──
const operatingStages = new Set();
for (const c of L.RECORD_CLASSES) for (const s of L.RECORD_STAGES) {
  if (L.stageColumn(c, s, null) === 'operating') operatingStages.add(s);
}
ok(operatingStages.size === 1 && operatingStages.has('operation_established'),
  '2a: with no prior column, only operation_established reaches Operating now', [...operatingStages]);
for (const c of L.ENTITLEMENT_CLASSES) {
  ok(L.stageColumn(c, 'operation_established', null) === 'unknown',
    '2b: an entitlement class (' + c + ') never reaches Operating now');
}
ok(L.stageColumn('building_permit', 'operation_established', null) === 'operating', '2c: a building permit with operation evidence is Operating now');

// ── 3. Completed work keeps a previously verified column, else Lifecycle unknown (D3) ──
ok(L.stageColumn('demolition_permit', 'work_completed', null) === 'unknown', '3a: completed demolition with no history is Lifecycle unknown');
ok(L.stageColumn('transport_project', 'work_completed', 'approved') === 'approved', '3b: completed resurfacing keeps an observed Approved');
ok(L.stageColumn('demolition_permit', 'work_completed', 'bogus') === 'unknown', '3c: a prior value outside the columns is ignored');
ok(L.stageColumn('building_permit', 'filed', 'operating') === 'proposed', '3d: a known stage ignores the prior column');

// ── 4. "Closed" (D5) and pre-application (D1) ────────────────────────────────────────
ok(L.stageColumn('zoning_change', 'closed_unspecified', null) === 'unknown', '4a: ambiguous Closed is Lifecycle unknown');
ok(L.stageColumn('preliminary_contact', 'preliminary_identified', null) === 'proposed', '4b: an identified pre-application is Proposed');
ok(L.stageColumn('preliminary_contact', 'preliminary_unidentified', null) === 'unknown', '4c: an unidentified pre-application is Lifecycle unknown');
ok(L.recordStageLine('preliminary_contact', 'preliminary_identified') === 'Pre-application — formal application not verified.',
  '4d: the founder wording for an identified pre-application, exactly');

// ── 5. The evidence ladder: strongest first, never invented ─────────────────────────
ok(JSON.stringify(L.historicalStage({ observed: 'permitted', term: 'filed', classEntry: 'filed' })) === JSON.stringify({ stage: 'permitted', basis: 'observed' }),
  '5a: an observed stage wins');
ok(JSON.stringify(L.historicalStage({ term: 'filed', classEntry: 'permitted' })) === JSON.stringify({ stage: 'filed', basis: 'term' }),
  '5b: the term rung beats the dataset rung');
ok(JSON.stringify(L.historicalStage({ classEntry: 'programmed' })) === JSON.stringify({ stage: 'programmed', basis: 'class_entry' }),
  '5c: the dataset rung is used last');
ok(JSON.stringify(L.historicalStage({})) === JSON.stringify({ stage: 'not_established', basis: 'none' }),
  '5d: no evidence gives not_established, never a guess');
ok(L.historicalStage({ observed: 'invalid_record', term: 'made_up', classEntry: 'filed' }).basis === 'class_entry',
  '5e: an invalid or unknown rung value is skipped, not trusted');
ok(L.stageColumn('building_permit', L.historicalStage({}).stage, null) === 'unknown',
  '5f: a record with no evidence lands in Lifecycle unknown');

// ── 6. One active predicate (D1, D6, D8, inactive) ──────────────────────────────────
const active = { activity: 'active', stage: 'filed' };
ok(L.isActiveRecord(active) === true, '6a: an active filed application is active');
for (const a of ['paused', 'inactive', 'undetermined']) {
  ok(L.isActiveRecord({ activity: a, stage: 'filed' }) === false, '6b: ' + a + ' is not active');
}
ok(L.isActiveRecord({ activity: 'active', stage: 'preliminary_identified' }) === false, '6c: a pre-application is not a formal active application');
ok(L.isActiveRecord({ activity: 'active', stage: 'filed', decision: { outcome: 'denied' } }) === false, '6d: a decided record is not active');
ok(L.isActiveRecord({ stage: 'filed' }) === false, '6e: a record with no activity field fails closed');
ok(L.isActiveRecord(null) === false, '6f: null is not active');

// ── 7. The effective date: only a verified publisher date ────────────────────────────
const today = '2026-11-01';
ok(L.verifiedEffectiveDate('2026-03-12', { today }) === '2026-03-12', '7a: a real past day is verified');
ok(L.verifiedEffectiveDate('2026-03-12T00:00:00Z', { today }) === '2026-03-12', '7b: a timestamp is cut to its day');
ok(L.verifiedEffectiveDate('2026-11-02', { today }) === '2026-11-02', '7c: today + 1 is allowed (time zones)');
const refused = {
  'future date': ['2026-11-03', { today }],
  'before filing': ['2026-01-01', { today, filedOn: '2026-02-01' }],
  'sentinel 1900-01-01': ['1900-01-01', { today }],
  'sentinel 1970-01-01': ['1970-01-01', { today }],
  'year 2199 placeholder': ['2199-09-09', { today }],
  'impossible day': ['2026-02-30', { today }],
  'not a date': ['Expired', { today }],
  'missing value': [null, { today }],
  'no clock given': ['2026-03-12', {}],
};
for (const [name, [v, o]] of Object.entries(refused)) {
  ok(L.verifiedEffectiveDate(v, o) === null, '7d: refused — ' + name);
}

// ── 8. The activity line: exact term, verified date, "date not verified" ────────────
ok(L.activityLine({ activity: 'inactive', term: 'Withdrawn', effectiveDate: '2026-03-12' }) === 'INACTIVE AS OF Mar 12, 2026 · Withdrawn',
  '8a: INACTIVE AS OF a verified date, with the government term');
ok(L.activityLine({ activity: 'inactive', term: 'Permit Expired due to inactivity', effectiveDate: null }) === 'Inactive — date not verified · Permit Expired due to inactivity',
  '8b: no verified date says so, and keeps the exact term');
ok(L.activityLine({ activity: 'paused', term: 'Stop Work Order', effectiveDate: '2026-10-05' }) === 'PAUSED AS OF Oct 5, 2026 · Stop Work Order',
  '8c: PAUSED, never INACTIVE, for a pause');
ok(L.activityLine({ activity: 'paused', term: 'On Hold' }) === 'Paused — date not verified · On Hold', '8d: undated pause');
ok(L.activityLine({ activity: 'undetermined', term: 'Aborted' }) === 'Status on the record: Aborted — meaning not stated by the agency',
  '8e: an undocumented term is shown as the agency wrote it, never as cancelled');
ok(!/cancel|inactive/i.test(L.activityLine({ activity: 'undetermined', term: 'Void' })), '8f: undetermined is never labelled inactive or cancelled');
ok(L.activityLine({ activity: 'active', term: 'Issued' }) === '', '8g: an active record carries no activity line');
ok(L.activityLine({ activity: 'inactive', term: 'Withdrawn', category: 'withdrawn' }).indexOf('withdrawn') === -1,
  '8h: the category is never shown in place of the term');

// ── 9. Card stage lines and link labels ─────────────────────────────────────────────
for (const s of L.RECORD_STAGES) {
  if (s === 'invalid_record') continue;
  ok(L.recordStageLine('building_permit', s, 'Demolition permit finaled').length > 0, '9a: stage ' + s + ' has a card line');
}
ok(L.recordStageLine('demolition_permit', 'work_completed', 'Demolition permit finaled') === 'Completed work on the record: Demolition permit finaled.',
  '9b: completed work is described in the publisher words');
ok(L.recordStageLine('zoning_change', 'entitled') === 'Zoning change recorded — project construction status unknown.',
  '9c: a zoning approval says construction status is unknown');
ok(!/application on file/i.test(Object.values(L.RECORD_STAGES).map((s) => L.recordStageLine('transport_project', s, 'x')).join(' ')),
  '9d: no stage line claims "Application on file"');
ok(L.recordLinkLabel('record') === 'View official government record', '9e: an individual record link');
ok(L.recordLinkLabel('dataset') === 'Official government dataset', '9f: a dataset link never claims to be a record');
ok(L.recordLinkLabel('agency') === 'Government agency information', '9g: an agency page link');
ok(L.recordLinkLabel(undefined) === '' && L.recordLinkLabel('url') === '', '9h: unknown precision gets no label');

// ── 10. No state, county or source is named in the vocabulary ───────────────────────
const src = read('lib/project-type.js');
const start = src.indexOf('THE NATIONAL RECORD STAGE AND ACTIVITY VOCABULARY');
const end = src.indexOf('HS.recordLifecycle = RECORD_LIFECYCLE;');
ok(start > 0 && end > start, '10a: the vocabulary section is found (positive control)');
const section = src.slice(start, end).replace(/^\s*\/\/.*$/gm, '');
ok(!/portland|austin|texas|oregon|arizona|nvdot|txdot|registry_id/i.test(section),
  '10b: the vocabulary code names no state, place or source');

// ── 11. The engine copy carries the same vocabulary ─────────────────────────────────
const gen = read('supabase/functions/_shared/project-type.generated.js');
ok(gen.indexOf(src) !== -1, '11: _shared/project-type.generated.js contains lib/project-type.js byte for byte');

if (failures) { console.error('\n' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('\nALL PASS');
