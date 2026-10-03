// PROPERTY WATCH — the pure check (Development Activity build step 9; docs/development-activity-watch-2026-10-03.md).
// Every expectation is hard-coded. The reports and the nearby list are produced by the REAL engine (`assemble`), so the check is proven against
// the shapes the engine really writes, never against a hand-made one. Run: node test/property-watch-changes.test.mjs
const M = await import('../supabase/functions/_shared/national-report.ts');
const C = await import('../supabase/functions/_shared/changes-since-report.ts');
const W = await import('../supabase/functions/_shared/property-watch.ts');
const S = await import('../supabase/functions/_shared/report-snapshot.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = (f, cls) => { try { f(); return false; } catch (e) { return cls ? e instanceof cls : true; } };

// ---- the inputs the engine is given ----------------------------------------------------------------------------------------------------
const FAM = 'wsdot-project-delivery-plan-proposed';
const OTHER = 'a-source-with-no-clearance';
const RIGHTS = { version: 1, cleared: [{ registry_id: FAM, cleared_on: '2026-09-29', audit_ref: 'fixture', attribution: 'Data: WSDOT' }] };
const row = (k, d, x = {}) => ({ source_key: k, feature_id: 'pt:1', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: d, geometry_type: 'Point', has_more: false, ...x });
const proj = (k, x = {}) => ({ source_key: k, registry_id: FAM, record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Proposed', stage: 'Not Yet Advertised', developer: null, size: null, investment: null, submitted_at: '2026-09-12', date_kind: 'filed', address: '005 King', source_ref: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/X/FeatureServer/0', ...x });
const led = (k, x = {}) => ({ identity_key: k, registry_id: FAM, comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-09-20T19:00:00Z', last_observed_at: '2026-09-29T09:00:00Z', ...x });
const ev = (k, x = {}) => ({ identity_key: k, event_type: 'status_changed', material: true, observed_at: '2026-09-25T10:00:00Z', prev_facts: { status: 'Proposed' }, new_facts: { status: 'Approved' }, changed_fields: ['status'], publisher_event_type: 'issued', publisher_event_date: '2026-09-24', ...x });
const SUBJECT = { address: '742 Evergreen Terrace, Springfield, OR 97477', matched_address: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477', label: 'Homer client' };

// the stored report: issued 2026-09-29 12:00:05Z with k1 (Approved, one change already shown) and k2 (seen once: not change-ready)
const NOW_REPORT = new Date('2026-09-29T12:00:00Z');
const ISSUED = '2026-09-29T12:00:05.000Z';
const REPORT_FIELD = {
  rows: [row('k1', 0.21), row('k2', 0.37)],
  projects: [proj('k1', { status: 'Approved', date_kind: 'issued', submitted_at: '2026-09-24' }), proj('k2', { name: 'Weather Station Replacement', address: '520 King' })],
  ledger: [led('k1'), led('k2', { change_ready: false, observation_count: 1 })],
  events: [ev('k1', { created_at: '2026-09-25T10:05:00Z' })],
  health: [],
};
const reportOut = M.assemble({ now: NOW_REPORT, view: 'customer', zip_supported: true, radius_mi: 0.5, rights: RIGHTS, subject: SUBJECT, ...REPORT_FIELD });
const original = { generated_at: ISSUED, body: S.snapshotBodyOf(reportOut.intelligence) };

// the area NOW (2026-10-02): k1 and k2 as before, and k3, a project that was not near the property when the report was issued
const NOW = new Date('2026-10-02T08:00:00Z');
const nowField = (x = {}) => ({
  rows: [row('k1', 0.21), row('k2', 0.37), row('k3', 0.3), row('k4', 0.4, { registry_id: OTHER })],
  projects: [
    proj('k1', { status: 'Operating', date_kind: 'completed', submitted_at: '2026-10-01', stage: 'Complete' }),
    proj('k2', { name: 'Weather Station Replacement', address: '520 King' }),
    proj('k3', { name: 'Fremont Bike Lane Extension', address: '100 Fremont' }),
    proj('k4', { name: 'A Project From An Uncleared Source', registry_id: OTHER }),
  ],
  ledger: [led('k1'), led('k2'), led('k3', { first_observed_at: '2026-09-30T19:00:00Z' }), led('k4', { registry_id: OTHER })],
  events: [ev('k1', { created_at: '2026-09-25T10:05:00Z' }), ev('k1', { observed_at: '2026-10-01T06:30:00Z', prev_facts: { stage: 'Approved' }, new_facts: { stage: 'Complete' }, changed_fields: ['stage'], created_at: '2026-10-01T06:35:00Z', publisher_event_type: 'completed', publisher_event_date: '2026-10-01' })],
  health: [],
  ...x,
});
const nearbyOut = (x = {}) => M.assemble({ now: NOW, view: 'customer', zip_supported: true, radius_mi: 0.5, rights: RIGHTS, subject: SUBJECT, ...nowField(x) });
const NEARBY = nearbyOut().intelligence.projects;
const wev = (k, created, x = {}) => ({ ...ev(k, { observed_at: '2026-10-01T06:30:00Z' }), created_at: created, ...x });
const E_K1 = wev('k1', '2026-10-01T06:35:00Z', { prev_facts: { stage: 'Approved' }, new_facts: { stage: 'Complete' }, changed_fields: ['stage'], publisher_event_type: 'completed', publisher_event_date: '2026-10-01' });
const E_K3 = wev('k3', '2026-10-01T07:00:00Z', { event_type: 'first_detected', observed_at: '2026-09-30T19:00:00Z', prev_facts: null, new_facts: { status: 'Proposed', stage: 'Not Yet Advertised' }, changed_fields: [], publisher_event_type: 'filed', publisher_event_date: '2026-09-12' });
const base = (o = {}) => ({ now: NOW, rights: RIGHTS, original, nearby: NEARBY, ledger: nowField().ledger, events: [], health: [], seen: [], ...o });
const check = (o = {}) => W.checkWatch(base(o));

// ---- 1. nothing happened ----------------------------------------------------------------------------------------------------------------
{
  const r = check();
  ok(r.changes.length === 0 && r.partial === false, '1a no event written after the report: no change, and the sources were read');
  ok(r.nearby === 3, '1b and the nearby list is what a NEW report would show a customer: k1, k2, k3 (k4\'s source is not cleared, so it is not part of it)', r.nearby);
  ok(same(NEARBY.map((p) => p.project_id), ['k1', 'k2', 'k3']), '1c (control) the nearby list the engine built', NEARBY.map((p) => p.project_id));
}

// ---- 2. a change to a project the report held --------------------------------------------------------------------------------------------
{
  const r = check({ events: [E_K1] });
  ok(r.changes.length === 1 && r.changes[0].project_id === 'k1', '2a one change since the report, on k1');
  const e = r.changes[0].entries;
  ok(e.length === 1 && e[0].event_type === 'status_changed' && e[0].detected_at === '2026-10-01T06:30:00Z' && e[0].recorded_at === '2026-10-01T06:35:00Z'
    && same(e[0].changes, [{ field: 'stage', from: 'Approved', to: 'Complete' }]) && same(e[0].publisher_event, { kind: 'completed', date: '2026-10-01' }),
    '2b in the shared entry shape: stage Approved to Complete, found 2026-10-01T06:30:00Z, recorded 06:35:00Z, with the publisher\'s own event', e);
  ok(r.changes[0].source.url === 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/X/FeatureServer/0' && r.changes[0].source.attribution === 'Data: WSDOT', '2c with the official source link and the attribution from the rights registry');
}

// ---- 3. THE POINT OF A WATCH: a project that was not near the property when the report was made -------------------------------------------------
{
  const r = check({ events: [E_K1, E_K3] });
  ok(same(r.changes.map((c) => c.project_id).sort(), ['k1', 'k3']), '3a a project that appeared near the property AFTER the report (k3) is reported by the watch', r.changes.map((c) => c.project_id));
  const k3 = r.changes.find((c) => c.project_id === 'k3');
  ok(k3.entries[0].event_type === 'first_detected' && k3.entries[0].changes.length === 0 && k3.entries[0].publisher_event.kind === 'filed', '3b as a new official record, with the publisher\'s filing event');
  // CONTROL: Changes Since Report, asked over the SAME events, cannot see k3 — it covers the projects IN the report and says so
  const since = C.changesSinceReport({ now: NOW, view: 'customer', rights: RIGHTS, report: { report_id: '11111111-1111-4111-8111-111111111111', content_hash: 'h'.repeat(64), report_version: M.REPORT_VERSION, ...original },
    ledger: nowField().ledger, events: [E_K1, E_K3], health: [] });
  ok(!since.changed.some((c) => c.project_id === 'k3') && since.limitations.some((l) => l.code === 'NEW_PROJECTS_NOT_COVERED') && since.changed.some((c) => c.project_id === 'k1'),
    '3c (control) Changes Since Report, over the same events, reports k1 and not k3 and says new projects are not covered: the watch is what covers them', since.changed.map((c) => c.project_id));
  // the two readers agree about k1 to the byte: ONE implementation of the boundary
  const k1w = r.changes.find((c) => c.project_id === 'k1');
  const k1s = since.changed.find((c) => c.project_id === 'k1');
  ok(same(k1w.entries, k1s.changes_since_report), '3d and about k1 the watch and Changes Since Report give the identical entries: they are one implementation, not two that agree today');
}

// ---- 4. exactly once: what the agent was already told is not told again ---------------------------------------------------------------------------
{
  const told = [{ project_id: 'k1', event_type: 'status_changed', observed_at: '2026-10-01T06:30:00.000000+00:00' }];
  const r = check({ events: [E_K1, E_K3], seen: told });
  ok(same(r.changes.map((c) => c.project_id), ['k3']), '4a a change already told (PostgREST\'s own timestamp text for the same instant) is removed; the other stays', r.changes.map((c) => c.project_id));
  ok(check({ events: [E_K1], seen: told }).changes.length === 0, '4b and when everything has been told there is nothing: the project is dropped, not listed empty');
  const other = check({ events: [E_K1], seen: [{ project_id: 'k1', event_type: 'first_detected', observed_at: '2026-10-01T06:30:00Z' }] });
  ok(other.changes.length === 1, '4c a different EVENT TYPE at the same instant was not told, so it is still reported');
  const later = check({ events: [E_K1], seen: [{ project_id: 'k1', event_type: 'status_changed', observed_at: '2026-10-01T06:31:00Z' }] });
  ok(later.changes.length === 1, '4d a different INSTANT was not told, so it is still reported');
  const elsewhere = check({ events: [E_K1], seen: [{ project_id: 'k2', event_type: 'status_changed', observed_at: '2026-10-01T06:30:00Z' }] });
  ok(elsewhere.changes.length === 1, '4e and a change told for ANOTHER project does not hide this one');
}

// ---- 5. the nearby list\'s OWN current changes must not hide what is new ------------------------------------------------------------------------------
{
  // the engine's own per-project list for k1 NOW already carries the 2026-10-01 stage change (it is in the 90-day window). Using that list as
  // "what was already shown" would erase every new change; the watch uses the STORED report's list instead.
  const k1now = NEARBY.find((p) => p.project_id === 'k1');
  ok(k1now.homesignal_detected_changes.some((c) => c.detected_at === '2026-10-01T06:30:00Z'), '5a (control) the engine\'s current list for k1 DOES contain the new change', k1now.homesignal_detected_changes.map((c) => c.detected_at));
  ok(check({ events: [E_K1] }).changes.length === 1, '5b and the watch still reports it');
  // what the STORED report showed is removed: the same project, instant and type
  const shownEvent = wev('k1', '2026-09-29T12:03:00Z', { observed_at: '2026-09-25T10:00:00Z' });
  ok(check({ events: [shownEvent] }).changes.length === 0, '5c a change the STORED report already showed (k1, 2026-09-25T10:00:00Z, status_changed) is not reported again, even if the ledger wrote it again');
}

// ---- 6. the boundary in time is the report\'s ------------------------------------------------------------------------------------------------------------------
{
  const before = wev('k1', '2026-09-29T11:30:00Z');
  ok(check({ events: [before] }).changes.length === 0, '6a an event the ledger wrote half an hour BEFORE the report was issued is outside the overlap: not reported');
  const inside = wev('k1', '2026-09-29T11:55:00Z', { observed_at: '2026-09-29T11:50:00Z' });
  ok(check({ events: [inside] }).changes.length === 1, '6b one written five minutes before the issue instant (inside the 10-minute overlap) is reported: the report could not have shown it');
  const future = wev('k1', '2026-10-02T09:00:00Z');
  ok(check({ events: [future] }).changes.length === 0, '6c an event recorded after "now" is not reported yet');
  ok(W.lookBackInstant(ISSUED, NOW) === '2026-09-29T11:50:05.000Z', '6d the look-back is the report\'s own boundary (issue minus the overlap) while the report is recent', W.lookBackInstant(ISSUED, NOW));
  ok(W.lookBackInstant(ISSUED, new Date('2026-12-30T00:00:00Z')) === '2026-10-01T00:00:00.000Z', '6e and never further back than 90 days from now, however old the report', W.lookBackInstant(ISSUED, new Date('2026-12-30T00:00:00Z')));
}

// ---- 7. what the watch refuses to call a change --------------------------------------------------------------------------------------------------------------
{
  const notReady = nowField().ledger.map((l) => (l.identity_key === 'k3' ? { ...l, change_ready: false, observation_count: 1 } : l));
  const r = check({ events: [E_K3], ledger: notReady });
  ok(r.changes.length === 0, '7a a project the ledger has seen ONCE (not change-ready) is not reported yet: the report\'s own rule, so a one-sighting blip is never an alert');
  const ready = check({ events: [E_K3] });
  ok(ready.changes.length === 1, '7b (control) the same event, once the project has been seen twice, is reported (the first email may come a day after the project appears)');
  const nonMaterial = wev('k1', '2026-10-01T06:35:00Z', { material: false, event_type: 'source_record_updated' });
  ok(check({ events: [nonMaterial] }).changes.length === 0, '7c a non-material update (a refresh of a field that is not the publisher\'s status) is not a change');
  const uncleared = wev('k4', '2026-10-01T06:35:00Z');
  ok(check({ events: [uncleared], ledger: nowField().ledger }).changes.length === 0, '7d an event on a project from an uncleared source is not reported (the source is not in the customer view)');
  ok(throws(() => check({ events: [{ ...E_K1, created_at: 'not a time' }] }), C.EventRowUnreadable), '7e an event whose time cannot be read is refused, never dropped (a dropped event would read as "no change")');
}

// ---- 8. silence is a weaker answer when a source could not be read -----------------------------------------------------------------------------------------------------
{
  const bad = [{ registry_id: FAM, fetch_failures_24h: 2, blocked_24h: 0, truncated_24h: 0 }];
  ok(check({ health: bad }).partial === true, '8a a source near the property that failed to read in the last day makes the check PARTIAL');
  ok(check({ health: [{ registry_id: 'some-other-family', fetch_failures_24h: 9, blocked_24h: 0, truncated_24h: 0 }] }).partial === false, '8b and health of a family that is not near the property is not this watch\'s business');
  ok(check({ health: bad, events: [E_K1] }).partial === true && check({ health: bad, events: [E_K1] }).changes.length === 1, '8c a partial check still reports what it found');
}

// ---- 9. the list is refused if it cannot be read --------------------------------------------------------------------------------------------------------------------------
{
  ok(throws(() => check({ nearby: [{ name: 'no identity' }] }), W.ReportUnreadable), '9a a nearby project with no identity is refused (a project dropped for its shape would read as "no change")');
  ok(throws(() => check({ nearby: [NEARBY[0], NEARBY[0]] }), W.ReportUnreadable), '9b and so is a project that appears twice');
  ok(throws(() => check({ original: { generated_at: 'never', body: original.body } }), W.ReportUnreadable), '9c and a stored report with no readable issue time');
  ok(throws(() => check({ original: { generated_at: ISSUED, body: '{"product":"something else","projects":[]}' } }), W.ReportUnreadable), '9d and a stored body that is not a Development Activity report');
}

// ---- 10. the email selection: what is listed is exactly what is told -----------------------------------------------------------------------------------------------------
{
  const mk = (i, entries) => ({ project_id: 'p' + String(i).padStart(2, '0'), name: 'Project ' + i, type: { key: 'x', label: 'X' }, source: { url: 'https://example.gov/' + i, attribution: null },
    entries: Array.from({ length: entries }, (_, j) => ({ event_type: 'status_changed', detected_at: '2026-10-01T06:' + String(10 + j).padStart(2, '0') + ':00Z', recorded_at: '2026-10-01T07:00:00Z', publisher_event: null, changes: [] })) });
  const few = W.selectForEmail([mk(1, 2), mk(2, 1)]);
  ok(few.listed.length === 2 && few.told.length === 3 && few.remaining.projects === 0 && few.remaining.entries === 0, '10a a few changes: all listed, all told, nothing left over', [few.listed.length, few.told.length, few.remaining]);
  const many = W.selectForEmail(Array.from({ length: 14 }, (_, i) => mk(i, 2)));
  ok(many.listed.length === W.MAX_PROJECTS_PER_EMAIL && many.listed.length === 10 && many.remaining.projects === 4 && many.remaining.entries === 8 && many.told.length === 20,
    '10b more than ten projects: ten are listed in detail, the other four projects (eight entries) are left for the next email', [many.listed.length, many.remaining, many.told.length]);
  const deep = W.selectForEmail([mk(1, 8)]);
  ok(deep.listed[0].entries.length === W.MAX_ENTRIES_PER_PROJECT && deep.listed[0].entries.length === 5 && deep.remaining.entries === 3 && deep.told.length === 5, '10c one project with eight entries lists five and leaves three', [deep.remaining, deep.told.length]);
  const listedKeys = many.listed.flatMap((c) => c.entries.map((e) => c.project_id + '|' + e.event_type + '|' + Date.parse(e.detected_at))).sort();
  ok(same(listedKeys, many.told.map(W.seenKey).sort()), '10d and `told` is EXACTLY the listed entries, key for key: a cap on the email can never mark a change as told that the email did not carry');
  ok(W.selectForEmail([]).listed.length === 0 && W.selectForEmail([]).told.length === 0, '10e nothing new, nothing selected');
  // the next run, given what was told, sees exactly what was left over
  const FIX = Array.from({ length: 12 }, (_, i) => mk(i, 1));
  const first = W.selectForEmail(FIX);
  const second = W.selectForEmail(FIX.filter((c) => !first.told.some((t) => t.project_id === c.project_id)));
  ok(first.told.length === 10 && second.told.length === 2 && same([...first.told, ...second.told].map((t) => t.project_id).sort(), FIX.map((c) => c.project_id).sort()),
    '10f two emails tell all twelve exactly once between them: nothing lost to the cap and nothing told twice', [first.told.length, second.told.length]);
}

// ---- 11. a source HomeSignal may not name, and an event type nothing may record (added by the mutation loop) ----------------------------------
{
  // k4's source is not cleared. Even handed to the check as a nearby project with a real event, a customer-view check reports nothing about it:
  // the rights decision is the report's own, and the Watch asks it with the CUSTOMER view.
  const k4 = { project_id: 'k4', source_family: OTHER, name: 'A Project From An Uncleared Source', type: null, lifecycle: null, source: { url: 'https://example.gov/k4' }, homesignal_detected_changes: [] };
  const E_K4 = wev('k4', '2026-10-01T07:30:00Z', { event_type: 'first_detected', prev_facts: null, new_facts: { status: 'Proposed' }, changed_fields: [] });
  const r = check({ nearby: [...NEARBY, k4], events: [E_K1, E_K4] });
  ok(same(r.changes.map((c) => c.project_id), ['k1']), '11a a nearby project from a source that is not cleared is never reported, even with a real event (control: k1 beside it is)', r.changes.map((c) => c.project_id));
}
{
  // an event type the told-about table does not accept is never offered: it could not be recorded as told, so it would be sent again and again
  const odd = wev('k1', '2026-10-01T06:36:00Z', { event_type: 'surprise_type' });
  const r = check({ events: [E_K1, odd] });
  const types = r.changes.flatMap((c) => c.entries.map((e) => e.event_type));
  ok(same(types, ['status_changed']), '11b only the three event types the ledger records and the told-about table accepts are offered (an unknown type beside a real one is dropped)', types);
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
