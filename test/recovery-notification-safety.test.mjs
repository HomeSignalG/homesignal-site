// RECOVERY -> NOTIFICATION SAFETY, END TO END (offline). Run: node test/recovery-notification-safety.test.mjs
//
// QUESTION: when a ZIP's scope is widened (docs/zip-scope-members.sql) and the ledger first sees records that were always there, can Property Watch /
// Follow / Changes Since Report tell a customer "New official record"? And does a genuinely new record still produce that line?
//
// WHAT IS REAL AND WHAT IS MODELLED (read this before trusting a green run):
//   REAL    the consumers: national-report.ts (assemble, selectDetectedChanges, materialEvents), changes-since-report.ts (changesForProjects),
//           property-watch.ts (checkWatch, selectForEmail), watch-email.ts (composeWatchEmail) are IMPORTED and run, not re-implemented.
//   PARSED  the two decisions that live in SQL are taken FROM THE COMMITTED SQL TEXT, not retyped here:
//             - docs/dev-change-recovery.sql : the writer's flag expressions for a first_detected row
//               (material = not (_baseline or recovered); is_baseline = (_baseline or recovered)) and the view's WHERE clause;
//             - docs/dev-change-reportable.sql: the view that is LIVE in production today (md5 46e9ec8b..., read 2026-10-14).
//           The WHERE clause is evaluated by a tiny evaluator that REFUSES any predicate it does not know (so a changed view cannot pass by being ignored).
//   MODELLED  the classification of an identity as genuine / recovered / held (a CASE over continuity rows in SQL). It is NOT re-executed here: that is
//           proved by test/dev_change_recovery_pg (114 checks, 40 mutations) on a real PostgreSQL. This test takes the classification as an INPUT and proves
//           that each outcome, written the way the writer writes it, reaches (or does not reach) a customer.
// Env overrides exist only for test/recovery-notification-safety_mutants.py (it feeds mutated COPIES; it never edits a repo file).
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = process.env.RNS_SHARED || join(root, 'supabase/functions/_shared');
const RECOVERY_SQL = process.env.RNS_RECOVERY_SQL || join(root, 'docs/dev-change-recovery.sql');
const REPORTABLE_SQL = process.env.RNS_REPORTABLE_SQL || join(root, 'docs/dev-change-reportable.sql');
const imp = (f) => import(pathToFileURL(join(SHARED, f)).href);
const M = await imp('national-report.ts');
const C = await imp('changes-since-report.ts');
const W = await imp('property-watch.ts');
const E = await imp('watch-email.ts');
const S = await imp('report-snapshot.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS - ' + m); else { bad++; console.log('FAIL - ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

// ---- 0. take the two SQL decisions from the committed text -------------------------------------------------------------------------------
const recoverySql = readFileSync(RECOVERY_SQL, 'utf8');
const reportableSql = readFileSync(REPORTABLE_SQL, 'utf8');

// the view's WHERE clause: the text between the last "where" of the CREATE VIEW statement and its ';'
function viewWhere(sql) {
  const i = sql.search(/create or replace view public\.dev_change_event_reportable/i);
  if (i < 0) throw new Error('view definition not found');
  const stmt = sql.slice(i, sql.indexOf(';', i));
  const w = stmt.match(/\bwhere\b([\s\S]*)$/i);
  if (!w) throw new Error('view has no WHERE');
  return w[1].trim().replace(/\s+/g, ' ');
}
// evaluator: AND of "not r.baseline" / "not e.is_baseline"; ANY other predicate throws (a changed view must not be waved through)
function compileWhere(where) {
  const parts = where.split(/\s+and\s+/i).map((p) => p.trim().toLowerCase());
  const known = { 'not r.baseline': (e, r) => !r.baseline, 'not e.is_baseline': (e) => !e.is_baseline };
  return parts.map((p) => { if (!known[p]) throw new Error('unknown view predicate: ' + p); return known[p]; });
}
const reportableView = (where) => { const preds = compileWhere(where); return (events, runs) =>
  events.filter((e) => { const r = runs[e.run_id]; return !!r && preds.every((f) => f(e, r)); }); };
const NEW_WHERE = viewWhere(recoverySql);          // the view this change ships
const LIVE_WHERE = viewWhere(reportableSql);       // the view live in production today
const NEW_VIEW = reportableView(NEW_WHERE);
const LIVE_VIEW = reportableView(LIVE_WHERE);
ok(LIVE_WHERE === 'not r.baseline', '0a the production view today is exactly "not r.baseline" (parsed from docs/dev-change-reportable.sql)', LIVE_WHERE);
ok(NEW_WHERE === 'not r.baseline and not e.is_baseline', '0b the view the recovery change ships adds "and not e.is_baseline" (parsed from docs/dev-change-recovery.sql)', NEW_WHERE);

// the writer's first_detected flags: material, is_baseline, as expressions over (_baseline, recovered)
function writerFlags(sql) {
  const i = sql.indexOf("select o.identity_key, ''first_detected'',\n         not (");
  const j = i < 0 ? sql.indexOf("select o.identity_key, ''first_detected'',\\n         not (") : i;
  const at = j < 0 ? (() => { throw new Error('recovery first_detected insert not found'); })() : j;
  const seg = sql.slice(at, at + 400).replace(/\\n/g, '\n');
  const m = seg.match(/first_detected'',\s*(not \(_baseline or rc\.identity_key is not null\)),\s*(\(_baseline or rc\.identity_key is not null\))/);
  if (!m) throw new Error('writer flag expressions changed shape: ' + seg.slice(0, 200));
  return { materialExpr: m[1], baselineExpr: m[2] };
}
const F = writerFlags(recoverySql);
// evaluate the two known expression shapes; anything else already threw above
const writerRow = (inRun, recovered) => {
  const rc = recovered;
  const material = F.materialExpr === 'not (_baseline or rc.identity_key is not null)' ? !(inRun.baseline || rc) : (() => { throw new Error('x'); })();
  const is_baseline = F.baselineExpr === '(_baseline or rc.identity_key is not null)' ? (inRun.baseline || rc) : (() => { throw new Error('x'); })();
  return { material, is_baseline };
};
// TODAY'S writer (no recovery): material = not _baseline, is_baseline = _baseline  (docs/dev-change-ledger.sql; the insert the splice replaces)
const todayWriterRow = (inRun) => ({ material: !inRun.baseline, is_baseline: inRun.baseline });

// ---- fixtures shaped like the real view rows ---------------------------------------------------------------------------------------------
const FAM = 'wsdot-project-delivery-plan-proposed';
const RIGHTS = { version: 1, cleared: [{ registry_id: FAM, cleared_on: '2026-09-29', audit_ref: 'fixture', attribution: 'Data: WSDOT' }] };
const row = (k, d) => ({ source_key: k, feature_id: 'pt:1', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: d, geometry_type: 'Point', has_more: false });
const proj = (k, x = {}) => ({ source_key: k, registry_id: FAM, record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Proposed', stage: 'Not Yet Advertised', developer: null, size: null, investment: null, submitted_at: '2026-09-12', date_kind: 'filed', address: '005 King', source_ref: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/X/FeatureServer/0', ...x });
const led = (k, x = {}) => ({ identity_key: k, registry_id: FAM, comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-09-20T19:00:00Z', last_observed_at: '2026-10-13T09:00:00Z', ...x });
const SUBJECT = { address: '742 Evergreen Terrace, Springfield, OR 97477', matched_address: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477', label: 'Homer client' };

// the stored report, issued 2026-10-01, which showed only k1
const ISSUED = '2026-10-01T12:00:05.000Z';
const reportOut = M.assemble({ now: new Date('2026-10-01T12:00:00Z'), view: 'customer', zip_supported: true, radius_mi: 0.5, rights: RIGHTS, subject: SUBJECT,
  rows: [row('k1', 0.21)], projects: [proj('k1', { name: 'Existing Project' })], ledger: [led('k1')], events: [], health: [] });
const original = { generated_at: ISSUED, body: S.snapshotBodyOf(reportOut.intelligence) };

// the area now (2026-10-14): k1, plus
//   kR  a record the publisher filed in 2024 that HomeSignal first reached when the polygon widened (old official date, first observed now)
//   kG  a record filed 2026-10-13, genuinely new, first seen during a complete continuous observation
const NOW = new Date('2026-10-14T08:00:00Z');
const projects = [
  proj('k1', { name: 'Existing Project' }),
  proj('kR', { name: 'Old Widened-In Record', submitted_at: '2024-03-01', date_kind: 'filed' }),
  proj('kG', { name: 'Newly Filed Record', submitted_at: '2026-10-13', date_kind: 'filed' }),
];
const nearby = M.assemble({ now: NOW, view: 'customer', zip_supported: true, radius_mi: 0.5, rights: RIGHTS, subject: SUBJECT,
  rows: [row('k1', 0.21), row('kR', 0.3), row('kG', 0.35)], projects,
  ledger: [led('k1'), led('kR'), led('kG')], events: [], health: [] }).intelligence.projects;
const LEDGER = [led('k1'), led('kR'), led('kG')];

const RUNS = { 1: { id: 1, baseline: false }, 2: { id: 2, baseline: true } };
let id = 100;
// one raw ledger row as the WRITER writes it, then as the VIEW exposes it
const raw = (key, run_id, flags, x = {}) => ({ id: ++id, identity_key: key, event_type: 'first_detected', material: flags.material, is_baseline: flags.is_baseline,
  observed_at: '2026-10-13T20:00:00Z', created_at: '2026-10-13T20:05:00Z', run_id, prev_facts: null, new_facts: { status: 'Proposed', stage: 'Not Yet Advertised' }, changed_fields: [],
  publisher_event_type: 'filed', publisher_event_date: '2026-10-13', ...x });
const recoveredRaw = (key = 'kR') => raw(key, 1, writerRow(RUNS[1], true), { publisher_event_date: '2024-03-01' });   // ordinary run, classified recovery
const genuineRaw = (key = 'kG') => raw(key, 1, writerRow(RUNS[1], false));                                          // ordinary run, genuine arrival
const unprotectedRaw = (key = 'kR') => raw(key, 1, todayWriterRow(RUNS[1]), { publisher_event_date: '2024-03-01' }); // production writer today: no recovery concept

const COLS = ['identity_key', 'event_type', 'material', 'observed_at', 'prev_facts', 'new_facts', 'changed_fields', 'publisher_event_type', 'publisher_event_date', 'created_at'];
const asView = (r) => Object.fromEntries(COLS.map((c) => [c, r[c]]));   // change-reads.ts EVENT_COLUMNS + created_at: all the consumers ever see
const customerSees = (rawEvents, view) => {
  const events = view(rawEvents, RUNS).map(asView);
  const check = W.checkWatch({ now: NOW, rights: RIGHTS, original, nearby, ledger: LEDGER, events, health: [], seen: [] });
  const sel = W.selectForEmail(check.changes);
  const email = sel.listed.length ? E.composeWatchEmail({ selection: sel, partial: check.partial, reportNumber: 1, reportDate: ISSUED }) : null;
  const since = C.changesForProjects({ now: NOW, view: 'customer', rights: RIGHTS, issuedAt: ISSUED, projects: nearby.map((p) => ({ ...p, homesignal_detected_changes: [] })), ledger: LEDGER, events, health: [] });
  const detected = LEDGER.map((l) => M.selectDetectedChanges(l, events.filter((e) => e.identity_key === l.identity_key), () => true)).flat();
  return { check, email, since, detected, eventsShown: events };
};
const names = (c) => c.check.changes.map((x) => x.project_id).sort();
const hasNewRecordLine = (c, who) => !!c.email && c.email.text.includes('New official record') && (who ? c.email.text.includes(who) : true);

// ---- 1. (a) a record recovered from history is NOT presented as a new official record -----------------------------------------------------
{
  const r = recoveredRaw();
  ok(r.material === false && r.is_baseline === true, '1a the writer (flags parsed from the SQL) records a recovered identity as first_detected, material=false, is_baseline=true', r);
  const c = customerSees([r], NEW_VIEW);
  ok(c.eventsShown.length === 0, '1b the shipped view does not expose the recovered event at all', c.eventsShown.length);
  ok(c.check.changes.length === 0 && c.email === null, '1c Property Watch finds no change and composes no email', names(c));
  ok(c.since.changed.length === 0 && c.detected.length === 0, '1d Changes Since Report and the report\'s detected-change rule find nothing either');
  // defence in depth: even on TODAY\'s view (which would still return the row) the consumers refuse it because material=false
  const d = customerSees([r], LIVE_VIEW);
  ok(d.eventsShown.length === 1 && d.check.changes.length === 0 && d.email === null, '1e second wall: even through today\'s view (row returned) a material=false event never reaches Property Watch', d.eventsShown.length);
  // belt: a recovered event that WRONGLY carried material=true is still stopped by is_baseline in the shipped view
  const wrong = { ...r, material: true };
  const w = customerSees([wrong], NEW_VIEW);
  ok(w.eventsShown.length === 0 && w.email === null, '1f third wall: if a recovered row ever carried material=true, "not e.is_baseline" in the view still removes it');
}

// ---- 2. the HAZARD this prevents: production today (no recovery writer) lets the same widened-in record through --------------------------
{
  const u = unprotectedRaw();
  const c = customerSees([u], LIVE_VIEW);
  ok(u.material === true && c.check.changes.length === 1 && hasNewRecordLine(c, 'Old Widened-In Record'),
    '2a NEGATIVE CONTROL: with today\'s writer + today\'s view an old (2024) widened-in record IS emailed as "New official record" - the test can see the hazard', names(c));
  ok(c.email && /Filed 2024-03-01/.test(c.email.text), '2b ...and the email even states the 2024 official date next to "New official record" (the customer-visible contradiction)');
  ok(c.since.changed.length === 1, '2c and Changes Since Report / Follow show it too: every reader inherits the same hole', c.since.changed.length);
}

// ---- 3. (b) a genuinely new qualifying record still produces the change and the email line ---------------------------------------------
{
  const g = genuineRaw();
  ok(g.material === true && g.is_baseline === false, '3a the writer records a genuine arrival as first_detected, material=true, is_baseline=false', g);
  const c = customerSees([g], NEW_VIEW);
  ok(c.eventsShown.length === 1 && names(c).join() === 'kG', '3b the shipped view exposes it and Property Watch reports exactly kG', names(c));
  ok(hasNewRecordLine(c, 'Newly Filed Record') && /Filed 2026-10-13/.test(c.email.text), '3c the email carries "New official record" for it, with the publisher\'s filing event', c.email && c.email.text);
  ok(c.since.changed.length === 1 && c.detected.length === 1, '3d Changes Since Report and the detected-change rule agree');
  ok(c.email.subject === 'HomeSignal: 1 official development change near a property you are watching', '3e subject counts exactly one change', c.email.subject);
}

// ---- 4. both together, and the neighbours that must not move ------------------------------------------------------------------------------
{
  const c = customerSees([recoveredRaw(), genuineRaw()], NEW_VIEW);
  ok(names(c).join() === 'kG' && !c.email.text.includes('Old Widened-In Record') && c.email.text.includes('Newly Filed Record'),
    '4a recovered + genuine in the same window: only the genuine one is announced (a baseline does not hide a real filing)', names(c));
  // a recovered identity that LATER genuinely changes is still news (recovery is not a permanent blind spot)
  const later = raw('kR', 1, writerRow(RUNS[1], false), { event_type: 'status_changed', observed_at: '2026-10-13T22:00:00Z', created_at: '2026-10-13T22:05:00Z',
    prev_facts: { status: 'Proposed' }, new_facts: { status: 'Approved' }, changed_fields: ['status'], publisher_event_type: 'issued', publisher_event_date: '2026-10-13' });
  const d = customerSees([recoveredRaw(), later], NEW_VIEW);
  ok(names(d).join() === 'kR' && d.check.changes[0].entries.length === 1 && d.check.changes[0].entries[0].event_type === 'status_changed' && d.email.text.includes('Official status changed') && !d.email.text.includes('New official record'),
    '4b a recovered record that later really changes status IS reported - as a status change, never as a new record', d.check.changes.map((x) => x.entries.map((e) => e.event_type)));
  // baseline-run events (the national backfill) never reach anyone, on either view
  const b = raw('kR', 2, writerRow(RUNS[2], false));
  ok(b.material === false && b.is_baseline === true, '4c a baseline-run first_detected is non-material and is_baseline');
  ok(customerSees([b], NEW_VIEW).eventsShown.length === 0 && customerSees([b], LIVE_VIEW).eventsShown.length === 0, '4d and both views exclude it (the run rule is unchanged)');
  // an event whose run is unknown fails closed
  ok(customerSees([{ ...genuineRaw(), run_id: 999 }], NEW_VIEW).eventsShown.length === 0, '4e an event naming no known run is not reportable (inner join fails closed)');
  // HELD (incomplete read): the writer writes NO event; nothing to leak
  ok(customerSees([], NEW_VIEW).email === null, '4f a held observation writes no event, so nothing is emailed (control: no events -> no email)');
}

// ---- 5. one stray call: the told-once ledger still dedupes a genuine change ------------------------------------------------------------
{
  const g = genuineRaw();
  const first = customerSees([g], NEW_VIEW);
  const told = W.selectForEmail(first.check.changes).told;
  const events = NEW_VIEW([g], RUNS).map(asView);
  const again = W.checkWatch({ now: NOW, rights: RIGHTS, original, nearby, ledger: LEDGER, events, health: [], seen: told });
  ok(again.changes.length === 0, '5a (control) once told, the same genuine record is not announced again');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
