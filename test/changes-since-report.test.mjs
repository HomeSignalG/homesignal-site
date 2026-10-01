// CHANGES SINCE REPORT — the pure reader (Development Activity plan "Watch This Property"; contract §6 gate 4, §8.5).
// Every expectation is hard-coded. The reports are produced by the REAL engine (`assemble`), so the reader is proven against the
// body the engine really writes, never against a hand-made shape.
// Run: node test/changes-since-report.test.mjs
const M = await import('../supabase/functions/_shared/national-report.ts');
const C = await import('../supabase/functions/_shared/changes-since-report.ts');
const S = await import('../supabase/functions/_shared/report-snapshot.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- the inputs the engine is given ---------------------------------------------------------------------------------------
const FAM = 'wsdot-project-delivery-plan-proposed';
const OTHER = 'a-source-with-no-clearance';
const RIGHTS = { version: 1, cleared: [{ registry_id: FAM, cleared_on: '2026-09-29', audit_ref: 'fixture', attribution: 'Data: WSDOT' }] };
const NOW_REPORT = new Date('2026-09-29T12:00:00Z');
const row = (k, d, x = {}) => ({ source_key: k, feature_id: 'pt:1', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: d, geometry_type: 'Point', has_more: false, ...x });
const proj = (k, x = {}) => ({ source_key: k, registry_id: FAM, record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Proposed', stage: 'Not Yet Advertised', developer: null, size: null, investment: null, submitted_at: '2026-09-12', date_kind: 'filed', address: '005 King', source_ref: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/X/FeatureServer/0', ...x });
const led = (k, x = {}) => ({ identity_key: k, registry_id: FAM, comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-09-20T19:00:00Z', last_observed_at: '2026-09-29T09:00:00Z', ...x });
const ev = (k, x = {}) => ({ identity_key: k, event_type: 'status_changed', material: true, observed_at: '2026-09-25T10:00:00Z', prev_facts: { status: 'Proposed' }, new_facts: { status: 'Approved' }, changed_fields: ['status'], publisher_event_type: 'issued', publisher_event_date: '2026-09-24', ...x });
const SUBJECT = { address: '742 Evergreen Terrace, Springfield, OR 97477', matched_address: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477', label: 'Homer client' };

const FIELD = {
  rows: [row('k1', 0.21), row('k2', 0.77), row('k4', 0.5, { registry_id: OTHER })],
  projects: [
    proj('k1', { status: 'Approved', date_kind: 'issued', submitted_at: '2026-09-24' }),
    proj('k2', { name: 'Weather Station Replacement', address: '520 King' }),
    proj('k4', { name: 'A Project From An Uncleared Source', registry_id: OTHER }),
  ],
  ledger: [led('k1'), led('k2', { change_ready: false, observation_count: 1 }), led('k4', { registry_id: OTHER })],
  events: [ev('k1', { created_at: '2026-09-25T10:05:00Z' })],
  health: [],
};
const assembleFor = (view, rights, f = FIELD) => M.assemble({ now: NOW_REPORT, view, zip_supported: true, radius_mi: 1, rights, subject: SUBJECT, ...f });
const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const ISSUED = '2026-09-29T12:00:05.000Z';
const storedFrom = (out, extra = {}) => ({ report_id: REPORT_ID, content_hash: 'h'.repeat(64), report_version: M.REPORT_VERSION, generated_at: ISSUED, body: S.snapshotBodyOf(out.intelligence), ...extra });

const internalOut = assembleFor('internal', RIGHTS);               // all three projects (k4 is HOLD)
const customerOut = assembleFor('customer', RIGHTS);               // k4 is left out
const NOW = new Date('2026-09-30T08:00:00Z');
const wev = (k, created, x = {}) => ({ ...ev(k, { observed_at: '2026-09-30T06:30:00Z' }), created_at: created, ...x });
const run = (o = {}) => C.changesSinceReport({ now: NOW, view: 'customer', rights: RIGHTS, report: storedFrom(customerOut), ledger: FIELD.ledger, events: [], health: [], ...o });

// ---- 1. the body the engine really writes is readable, and its identities are the ledger's ------------------------------------------------
{
  const parsed = C.parseStoredReport(storedFrom(customerOut));
  ok(same(parsed.projects.map((p) => p.project_id), ['k1', 'k2']), '1a a real customer report parses to its project identities, sorted: k1, k2', parsed.projects.map((p) => p.project_id));
  ok(parsed.generated_at === ISSUED, '1b and carries the issue instant it was given');
  ok(same(C.parseStoredReport(storedFrom(internalOut)).projects.map((p) => p.project_id), ['k1', 'k2', 'k4']), '1c an internal report also carries the HOLD project (k4)');
  const k1 = parsed.projects[0];
  ok(k1.homesignal_detected_changes.length === 1 && k1.homesignal_detected_changes[0].event_type === 'status_changed', '1d k1 already carries the one change the report showed (status_changed on 2026-09-25)');
}

// ---- 2. an event the ledger wrote after the report is a change since it, in the report's own shape ----------------------------------------------
{
  const e = wev('k1', '2026-09-30T06:35:00Z', { prev_facts: { status: 'Approved' }, new_facts: { status: 'Operating' } });
  const r = run({ events: [e] });
  ok(r.changed.length === 1 && r.changed[0].project_id === 'k1', '2a one project changed since the report: k1');
  const c = r.changed[0].changes_since_report;
  ok(same(c, [{ event_type: 'status_changed', detected_at: '2026-09-30T06:30:00Z', publisher_event: { kind: 'issued', date: '2026-09-24' }, changes: [{ field: 'status', from: 'Approved', to: 'Operating' }] }]),
    '2b its change is exactly: status Approved to Operating, detected 2026-09-30T06:30:00Z, with the publisher event', c);
  // the SAME event, shown by the report itself, has the same shape: one rule, one entry shape
  const reportShows = assembleFor('customer', RIGHTS, { ...FIELD, events: [{ ...e, observed_at: '2026-09-29T09:00:00Z' }] });
  const inReport = reportShows.intelligence.projects.find((p) => p.project_id === 'k1').homesignal_detected_changes[0];
  ok(same(inReport, { ...c[0], detected_at: '2026-09-29T09:00:00Z' }), '2c and the report, given the same event, builds the identical entry (only the date differs): the two cannot disagree about what a change looks like');
  ok(r.changed[0].name === 'Ravenna Bridge Retrofit' && r.changed[0].lifecycle_at_report.key === 'approved' && r.changed[0].type.key === 'infrastructure' && r.changed[0].type.label === 'Roads & infrastructure', '2d the project is named and typed as the REPORT said (lifecycle at the report: approved)', [r.changed[0].lifecycle_at_report, r.changed[0].type]);
  ok(r.changed[0].source.url === 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/X/FeatureServer/0' && r.changed[0].source.attribution === 'Data: WSDOT', '2e with its official source link, and the attribution from the rights registry as it stands now');
  ok(r.report.report_id === REPORT_ID && r.report.issued_at === ISSUED && r.as_of === '2026-09-30' && r.through === '2026-09-30T08:00:00.000Z' && r.projects_in_report === 2, '2f the answer names the report, when it was issued, and the instant it is current to');
}

// ---- 3. what is NOT a change since the report ---------------------------------------------------------------------------------------------
{
  const nonMaterial = wev('k1', '2026-09-30T06:35:00Z', { material: false, event_type: 'source_record_updated', changed_fields: ['submitted_at'] });
  ok(run({ events: [nonMaterial] }).changed.length === 0, '3a a non-material event (only submitted_at changed) is not a change');
  const k2 = wev('k2', '2026-09-30T06:35:00Z');
  const r2 = run({ events: [k2] });
  ok(r2.changed.length === 0 && r2.excluded.not_change_ready === 1, '3b a project the ledger has not yet observed twice (k2) is NOT called a change, and the answer counts it so nothing is silently dropped', r2.excluded);
  ok(run({ events: [wev('k9', '2026-09-30T06:35:00Z')] }).changed.length === 0, '3c an event for a project that was not in the report is ignored');
  ok(run({ events: [] }).changed.length === 0 && run({ events: [] }).excluded.not_change_ready === 0, '3d no events: no changes, and nothing is counted as withheld');
  ok(run({ ledger: [], events: [wev('k1', '2026-09-30T06:35:00Z')] }).changed.length === 0, '3e a project with no ledger row at all is not change-ready: no change');
}

// ---- 4. THE BOUNDARY IN TIME: created_at, not observed_at ---------------------------------------------------------------------------------------
{
  // observed (retrieved) BEFORE the report, written to the ledger AFTER it: the report could not have shown it
  const late = wev('k1', '2026-09-30T02:30:00Z', { observed_at: '2026-09-28T23:00:00Z' });
  ok(run({ events: [late] }).changed.length === 1, '4a an event retrieved the evening BEFORE the report but WRITTEN after it is a change since it (observed_at > issued_at would have lost it)');
  // written long before the report
  const old = wev('k1', '2026-09-29T11:30:00Z', { observed_at: '2026-09-29T09:00:00Z' });
  ok(run({ events: [old] }).changed.length === 0, '4b an event written 30 minutes BEFORE the report was available to it: not a change since');
  // straddle: written 5 minutes before the report was issued, so inside the overlap, and NOT in the body
  const straddle = wev('k1', '2026-09-29T11:55:00Z', { observed_at: '2026-09-29T11:54:00Z' });
  ok(run({ events: [straddle] }).changed.length === 1, '4c an event written 5 minutes before the report was ISSUED, that the body does not show, IS a change since (the report read the ledger just before it, and the tick may not have committed yet)');
  // the same straddling instant IS in the body: removed, never double-reported
  const shownAlready = wev('k1', '2026-09-29T11:55:00Z', { observed_at: '2026-09-25T10:00:00Z' });
  ok(run({ events: [shownAlready] }).changed.length === 0, '4d an event inside the overlap that the report ALREADY SHOWED (same project, instant and type) is removed: the overlap cannot double-report');
  ok(run({ events: [wev('k1', '2026-09-29T11:55:00Z', { observed_at: '2026-09-25T10:00:00Z', event_type: 'first_detected' })] }).changed.length === 1, '4e (control) the same instant with a DIFFERENT type is not the same event, so it is shown');
  // the exact overlap edge: 12:00:05 - 10 minutes = 11:50:05
  ok(C.SINCE_REPORT_OVERLAP_MS === 600000 && C.writtenSinceInstant(ISSUED) === '2026-09-29T11:50:05.000Z', '4f the overlap is ten minutes and the ledger read reaches back to 11:50:05 for a report issued at 12:00:05');
  ok(run({ events: [wev('k1', '2026-09-29T11:50:05.000Z')] }).changed.length === 0 && run({ events: [wev('k1', '2026-09-29T11:50:05.001Z')] }).changed.length === 1, '4g the overlap edge is exclusive: written exactly at 11:50:05.000 is out, one millisecond later is in');
  // not yet written / not yet observed
  ok(run({ events: [wev('k1', '2026-09-30T08:00:00.001Z')] }).changed.length === 0 && run({ events: [wev('k1', '2026-09-30T08:00:00Z')] }).changed.length === 1, '4h an event written after "now" is not shown yet; written at exactly now is');
  ok(run({ events: [wev('k1', '2026-09-30T06:35:00Z', { observed_at: '2026-09-30T08:00:01Z' })] }).changed.length === 0, '4i an event whose retrieval instant is in the future is not shown');
  // microseconds, as the database writes them
  const micro = '2026-09-29T11:55:00.123456+00:00';
  const bodyWithMicro = { ...JSON.parse(S.snapshotBodyOf(customerOut.intelligence)) };
  bodyWithMicro.projects[0].homesignal_detected_changes[0].detected_at = micro;
  const stored = { ...storedFrom(customerOut), body: JSON.stringify(bodyWithMicro) };
  ok(run({ report: stored, events: [wev('k1', '2026-09-29T11:55:00Z', { observed_at: '2026-09-29T11:55:00.123456+00:00' })] }).changed.length === 0, '4j an instant with microseconds, as the database writes it, matches the body\'s own entry and is removed');
}

// ---- 5. rights are read NOW ---------------------------------------------------------------------------------------------------------------------------
{
  const e = [wev('k1', '2026-09-30T06:35:00Z')];
  const revoked = run({ rights: { version: 2, cleared: [] }, events: e });
  ok(revoked.changed.length === 0 && same(revoked.excluded.no_rights, { [FAM]: 2 }), '5a a source whose clearance was WITHDRAWN after the report stops appearing: customer answers drop it and count it', revoked.excluded);
  ok(revoked.limitations.some((l) => l.code === 'SOURCES_NOT_INCLUDED'), '5b and say that some sources are not included');
  const internal = run({ view: 'internal', report: storedFrom(internalOut), rights: { version: 2, cleared: [] }, events: e });
  ok(internal.changed.length === 1 && internal.changed[0].rights === 'HOLD' && internal.changed[0].source.attribution === null, '5c the internal view still shows it, labelled HOLD, with no attribution it has no right to');
  const clearedOne = run({ view: 'internal', report: storedFrom(internalOut), events: [wev('k1', '2026-09-30T06:35:00Z'), wev('k4', '2026-09-30T06:36:00Z', { observed_at: '2026-09-30T07:00:00Z' })] });
  ok(same(clearedOne.changed.map((c) => [c.project_id, c.rights]), [['k4', 'HOLD'], ['k1', 'CLEARED']]), '5d internal: a cleared and an uncleared project are each labelled, newest change first (k4 then k1)', clearedOne.changed.map((c) => [c.project_id, c.rights]));
  let threw = null; try { run({ rights: { version: 1, cleared: [{ registry_id: '*', cleared_on: '2026-09-29', audit_ref: 'x', attribution: '' }] } }); } catch (x) { threw = String(x.message); }
  ok(threw !== null, '5e a malformed rights registry fails the answer: never "everything is cleared"', threw);
}

// ---- 6. the answer says what it cannot see ----------------------------------------------------------------------------------------------------------
{
  const r = run({ events: [] });
  ok(r.limitations.length === 1 && r.limitations[0].code === 'NEW_PROJECTS_NOT_COVERED', '6a EVERY answer, even an empty one, says it does not cover projects that appeared near the property after the report');
  const bad1 = run({ health: [{ registry_id: FAM, fetch_failures_24h: 2, blocked_24h: 0, truncated_24h: 0 }] });
  ok(bad1.limitations.some((l) => l.code === 'SOURCE_NOT_FULLY_READ'), '6b a source that failed to be read in the last day: "no change" is a weaker statement, and the answer says so');
  const ok1 = run({ health: [{ registry_id: 'someone-else', fetch_failures_24h: 9, blocked_24h: 9, truncated_24h: 9 }] });
  ok(!ok1.limitations.some((l) => l.code === 'SOURCE_NOT_FULLY_READ'), '6c the health of a source that is not in the answer is not the answer\'s business');
  const blocked = run({ health: [{ registry_id: FAM, fetch_failures_24h: 0, blocked_24h: 1, truncated_24h: 0 }] });
  const cut = run({ health: [{ registry_id: FAM, fetch_failures_24h: 0, blocked_24h: 0, truncated_24h: 1 }] });
  ok(blocked.limitations.some((l) => l.code === 'SOURCE_NOT_FULLY_READ') && cut.limitations.some((l) => l.code === 'SOURCE_NOT_FULLY_READ'), '6d blocked and truncated reads count as well as failed ones');
}

// ---- 7. a report this reader does not understand is REFUSED, never read as "no changes" -------------------------------------------------
{
  const goodBody = JSON.parse(S.snapshotBodyOf(customerOut.intelligence));
  const refuse = (label, report) => {
    let e = null; try { run({ report }); } catch (x) { e = x; }
    ok(e instanceof C.ReportUnreadable, '7 ' + label + ': refused as unreadable', e && e.message);
  };
  const base = storedFrom(customerOut);
  refuse('a body that is not JSON', { ...base, body: 'not json' });
  refuse('another product', { ...base, body: JSON.stringify({ ...goodBody, product: 'SOMETHING ELSE' }) });
  refuse('no project list', { ...base, body: JSON.stringify({ product: M.PRODUCT_NAME }) });
  refuse('a project with no identity', { ...base, body: JSON.stringify({ ...goodBody, projects: [{ name: 'x' }] }) });
  refuse('a project listed twice', { ...base, body: JSON.stringify({ ...goodBody, projects: [goodBody.projects[0], goodBody.projects[0]] }) });
  refuse('an issue time that is not a time', { ...base, generated_at: 'yesterday' });
  refuse('a body that is an array', { ...base, body: '[]' });
  const empty = run({ report: { ...base, body: JSON.stringify({ ...goodBody, projects: [] }) }, events: [wev('k1', '2026-09-30T06:35:00Z')] });
  ok(empty.projects_in_report === 0 && empty.changed.length === 0, '7 (control) a report that genuinely lists no projects is a valid, empty answer: refusal is for what cannot be read, not for emptiness');
  let v = null; try { run({ view: 'public' }); } catch (x) { v = String(x.message); }
  ok(v !== null, '7 an unknown view is refused');
}

// ---- 8. nothing private can be in the answer: the engine's own boundary scan is run over it ---------------------------------------------
{
  const events = [wev('k1', '2026-09-30T06:35:00Z', { prev_facts: { status: 'Approved' }, new_facts: { status: 'Operating' } })];
  const r = run({ events });
  ok(M.boundaryFindings(r, customerOut.privateContext).length === 0, '8a the answer passes the engine\'s own boundary scan against the real customer context: no address, fragment, label or coordinate');
  const text = JSON.stringify(r);
  ok(!/distance|bearing|"east|"north|miles/i.test(text), '8b and carries no distance, bearing or offset from the property (it has no point to measure from)');
  ok(M.boundaryFindings({ ...r, note: 'near ' + SUBJECT.address.split(',')[0] }, customerOut.privateContext).includes('ADDRESS_FRAGMENT_IN_BODY:street_line'), '8c (control) the scan WOULD have caught a street line in it');
  ok(same(run({ events }), run({ events })), '8d the answer is deterministic: the same inputs give the same bytes');
  ok(same(Object.keys(r).sort(), ['answer', 'as_of', 'changed', 'excluded', 'limitations', 'product', 'projects_in_report', 'report', 'through']), '8e and is exactly these keys: no private context, no snapshot internals', Object.keys(r).sort());
}

// ---- 9. ordering --------------------------------------------------------------------------------------------------------------------------------------
{
  const r = run({ view: 'internal', report: storedFrom(internalOut), events: [
    wev('k1', '2026-09-30T06:35:00Z', { observed_at: '2026-09-30T05:00:00Z' }),
    wev('k4', '2026-09-30T06:36:00Z', { observed_at: '2026-09-30T05:00:00Z' }),
  ] });
  ok(same(r.changed.map((c) => c.project_id), ['k1', 'k4']), '9a projects changed at the same instant are ordered by identity (k1 before k4)');
  const r2 = run({ view: 'internal', report: storedFrom(internalOut), events: [
    wev('k1', '2026-09-30T06:35:00Z', { observed_at: '2026-09-30T05:00:00Z' }),
    wev('k1', '2026-09-30T06:36:00Z', { observed_at: '2026-09-30T05:30:00Z', event_type: 'first_detected' }),
  ] });
  ok(same(r2.changed[0].changes_since_report.map((c) => c.detected_at), ['2026-09-30T05:30:00Z', '2026-09-30T05:00:00Z']), '9b within a project, the newest change is first');
  // across projects the order is by each project's NEWEST change: k1 changed at 05:00 and 06:00, k4 at 05:30, so k1 leads (its newest is 06:00)
  const r3 = run({ view: 'internal', report: storedFrom(internalOut), events: [
    wev('k1', '2026-09-30T06:40:00Z', { observed_at: '2026-09-30T05:00:00Z' }),
    wev('k1', '2026-09-30T06:41:00Z', { observed_at: '2026-09-30T06:00:00Z', event_type: 'first_detected' }),
    wev('k4', '2026-09-30T06:42:00Z', { observed_at: '2026-09-30T05:30:00Z' }),
  ] });
  ok(same(r3.changed.map((c) => c.project_id), ['k1', 'k4']), '9c projects are ordered by their NEWEST change, not their oldest: k1 (05:00 and 06:00) before k4 (05:30)', r3.changed.map((c) => c.project_id));
  const r4 = run({ view: 'internal', report: storedFrom(internalOut), events: [
    wev('k1', '2026-09-30T06:40:00Z', { observed_at: '2026-09-30T04:00:00Z' }),
    wev('k4', '2026-09-30T06:42:00Z', { observed_at: '2026-09-30T05:30:00Z' }),
  ] });
  ok(same(r4.changed.map((c) => c.project_id), ['k4', 'k1']), '9d and a project whose only change is older goes after one whose change is newer: k4 (05:30) before k1 (04:00)', r4.changed.map((c) => c.project_id));
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
