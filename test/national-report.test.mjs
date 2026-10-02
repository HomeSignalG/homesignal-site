// THE NATIONAL DEVELOPMENT ACTIVITY REPORT — the assembly module (Development Activity plan, Order G).
// supabase/functions/_shared/national-report.ts composes answers that other things own (the spatial read, the Type and
// lifecycle authority, the change ledger's reader, the rights registry) and keeps the customer's address out of the
// permanent report. This file proves the composition and the split. Fixtures have the shape of real production rows
// (the WSDOT rows are read from public.dev_change_project, 2026-09-29); every expectation is written out by hand.
// Run: node test/national-report.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const throws = (fn) => { try { fn(); return null; } catch (e) { return String((e && e.message) || e); } };
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const M = await import('../supabase/functions/_shared/national-report.ts');
const S = await import('../supabase/functions/_shared/report-snapshot.ts');

const NOW = new Date('2026-09-29T12:00:00Z');
const RIGHTS_NONE = { version: 1, cleared: [] };
const RIGHTS_A = { version: 1, cleared: [{ registry_id: 'wsdot-project-delivery-plan-proposed', cleared_on: '2026-09-29', audit_ref: 'test fixture', attribution: 'Data: WSDOT' }] };
const RIGHTS_AB = { version: 1, cleared: [
  ...RIGHTS_A.cleared,
  { registry_id: 'austin-site-plan-cases', cleared_on: '2026-09-29', audit_ref: 'test fixture', attribution: '' },
] };

// ---- fixtures ---------------------------------------------------------------------------------------------
const row = (k, d, extra = {}) => ({ source_key: k, feature_id: 'pt:1', registry_id: 'wsdot-project-delivery-plan-proposed', provenance: 'proven_stored_point', distance_mi: d, geometry_type: 'Point', has_more: false, ...extra });
const proj = (k, extra = {}) => ({
  source_key: k, registry_id: 'wsdot-project-delivery-plan-proposed', record_kind: 'development',
  name: 'I-5/NB Ravenna Blvd. Bridges - Seismic Retrofit', type: 'Utility', type_raw: null, status: 'Proposed',
  stage: 'Not Yet Advertised', developer: null, size: null, investment: null, submitted_at: '2029-09-17', date_kind: 'scheduled',
  address: '005 King', source_ref: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/WSDOTProjectDeliveryPlanCurrent/FeatureServer/0', ...extra,
});
const led = (k, extra = {}) => ({ identity_key: k, registry_id: 'wsdot-project-delivery-plan-proposed', comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-09-29T19:00:00Z', last_observed_at: '2026-09-29T19:30:00Z', ...extra });
const ev = (k, extra = {}) => ({ identity_key: k, event_type: 'status_changed', material: true, observed_at: '2026-09-25T10:00:00Z', prev_facts: { status: 'Proposed', stage: 'Not Yet Advertised' }, new_facts: { status: 'Approved', stage: 'Advertised' }, changed_fields: ['status', 'stage'], publisher_event_type: 'issued', publisher_event_date: '2026-09-24', ...extra });
const SUBJECT = { address: '742 Evergreen Terrace, Springfield, OR 97477', matched_address: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477' };
const run = (o = {}) => M.assemble({
  now: NOW, view: 'customer', zip_supported: true, radius_mi: 1, rights: RIGHTS_A, subject: SUBJECT,
  rows: [], projects: [], ledger: [], events: [], health: [], ...o,
});
const body = (r) => S.snapshotBodyOf(r.intelligence);
const ids = (list) => list.join(',');

// ---- 1. the rights gate: nothing is cleared, and an unlisted family never appears ------------------------
{
  const projects = [proj('k1'), proj('k2', { registry_id: 'austin-site-plan-cases', name: 'Menchaca Apartments' })];
  const rows = [row('k1', 0.2), row('k2', 0.4, { registry_id: 'austin-site-plan-cases' })];
  const none = run({ rights: RIGHTS_NONE, rows, projects });
  ok(none.intelligence.projects.length === 0, '1a the shipped state (nothing cleared): a customer report carries no project at all');
  ok(none.coverage_state === 'LIMITED_COVERAGE', '1a and it says LIMITED COVERAGE, not "no activity"', none.coverage_state);
  ok(none.intelligence.coverage.limitations.some((l) => l.code === 'NO_INCLUDED_SOURCE'), '1a naming the limitation NO_INCLUDED_SOURCE');

  const a = run({ rights: RIGHTS_A, rows, projects });
  ok(ids(a.intelligence.projects.map((p) => p.project_id)) === 'k1', '1b one family cleared: only its project is in the report');
  ok(!body(a).includes('Menchaca'), '1b the excluded family\'s content appears nowhere in the permanent body');
  ok(a.intelligence.coverage.limitations.some((l) => l.code === 'SOURCES_NOT_INCLUDED'), '1b and the exclusion is disclosed as a coverage limitation');
  ok(a.intelligence.projects[0].source.attribution === 'Data: WSDOT', '1b the cleared family\'s attribution rides with its record');

  const ab = run({ rights: RIGHTS_AB, rows, projects });
  ok(ids(ab.intelligence.projects.map((p) => p.project_id)) === 'k1,k2', '1c both cleared: both appear, sorted by project id');
  ok(ab.intelligence.projects[1].source.attribution === null, '1c an empty attribution is null, not an empty string');

  const nullFam = run({ rights: RIGHTS_A, rows: [row('k3', 0.1, { registry_id: null })], projects: [proj('k3', { registry_id: null })] });
  ok(nullFam.intelligence.projects.length === 0, '1d a record with no source family is never cleared');

  const internal = run({ view: 'internal', rights: RIGHTS_NONE, rows, projects });
  ok(internal.intelligence.projects.length === 2 && internal.intelligence.projects.every((p) => p.rights === 'HOLD'), '1e the internal view shows uncleared records, each labelled HOLD');
  ok(internal.storage_blockers.includes('INTERNAL_VIEW') && internal.storage_blockers.includes('CONTAINS_UNCLEARED_SOURCE'), '1e and can never be stored as a customer snapshot', internal.storage_blockers);
  ok(a.intelligence.projects.every((p) => !('rights' in p)), '1e the customer view carries no rights label at all');

  const leak = /rights|cleared|clearance|hold\b|audit|allowlist|not for resale|verdict/i;
  const texts = [none, a, ab].flatMap((r) => r.intelligence.coverage.limitations.map((l) => l.text));
  ok(texts.length === 2 && texts.every((t) => !leak.test(t)), '1f customer limitation text never uses the internal rights vocabulary', texts);

  const bad1 = (x) => throws(() => M.validateRights(x));
  ok(bad1({ version: 1, cleared: [{ registry_id: 'a*', cleared_on: '2026-09-29', audit_ref: 'x', attribution: '' }] }) !== null, '1g a wildcard registry_id is refused');
  ok(bad1({ version: 1, cleared: [RIGHTS_A.cleared[0], RIGHTS_A.cleared[0]] }) !== null, '1g a duplicate is refused');
  ok(bad1({ version: 1, cleared: [{ registry_id: 'a', cleared_on: '2026-09-29', audit_ref: '', attribution: '' }] }) !== null, '1g an entry with no audit reference is refused');
  ok(bad1({ version: 1, cleared: [{ registry_id: 'a', cleared_on: '2026-02-30', audit_ref: 'x', attribution: '' }] }) !== null, '1g an impossible clearance date is refused');
  ok(bad1({ version: 1, cleared: [{ registry_id: 'a', cleared_on: '2026-09-29', audit_ref: 'x' }] }) !== null, '1g a missing attribution is refused (use "" if none is required)');
  ok(bad1(null) !== null && bad1({ cleared: [] }) !== null && bad1('all') !== null, '1g a registry that is not { version, cleared[] } is refused');
  ok(throws(() => run({ rights: { version: 1, cleared: 'everything' } })) !== null, '1g assemble fails on a malformed registry, it never falls back to "all cleared"');
}

// ---- 2. "recent official activity": what HAPPENED, inside a bounded window ----------------------------------
{
  const at = (kind, date, extra = {}) => run({ rows: [row('k1', 0.2)], projects: [proj('k1', { date_kind: kind, submitted_at: date, status: 'Approved', ...extra })] });
  const inList = (r) => r.intelligence.sections.recent_official_activity.includes('k1');
  ok(inList(at('issued', '2026-09-10')), '2a an issued event 19 days ago is recent official activity');
  ok(inList(at('issued', '2026-07-01')), '2a the window edge: exactly 90 days ago (2026-07-01) is IN');
  ok(!inList(at('issued', '2026-06-30')), '2a 91 days ago is OUT');
  ok(inList(at('filed', '2026-09-29')), '2a today is IN');
  ok(!inList(at('filed', '2026-09-30')), '2a tomorrow is OUT (not an event that has happened)');
  for (const d of ['1900-01-01', '1969-12-31', '2099-02-12', '9999-09-09']) {
    ok(!inList(at('issued', d)) && !inList(at('decided', d)), '2b the sentinel date ' + d + ' is never an event');
  }
  ok(!inList(at('scheduled', '2026-09-10')) && !inList(at('estimated', '2026-09-10')), '2c a scheduled or estimated date is a plan, not an event');
  ok(!inList(at('constructor', '2026-09-10')) && !inList(at('__proto__', '2026-09-10')) && !inList(at(null, '2026-09-10')), '2d an inherited or null date kind is never an event');
  ok(!inList(at('issued', '2026-02-30')) && !inList(at('issued', '09/10/2026')) && !inList(at('issued', null)), '2e an impossible, differently-formatted or missing date is never an event');
  ok(!inList(at('issued', '2026-08-00')) && !inList(at('issued', '2026-08-32')) && !inList(at('issued', '2026-09-10T00:00:00Z')) && !inList(at('issued', ' 2026-09-10')),
    '2e including dates that would sort INSIDE the window as text but are not calendar days (2026-08-00, 2026-08-32, a timestamp, a padded string)');
  for (const k of ['filed', 'issued', 'decided', 'awarded', 'completed', 'hearing']) {
    ok(inList(at(k, '2026-09-10')), '2f the publisher event kind "' + k + '" counts');
  }
  const ev1 = at('issued', '2026-09-10').intelligence.projects[0].publisher_event;
  ok(ev1.kind === 'issued' && ev1.label === 'Issued' && ev1.date === '2026-09-10', '2g the event carries the publisher\'s own kind and date, verbatim', ev1);

  const opNo = at('scheduled', '2026-09-10', { status: 'Operating' });
  ok(opNo.intelligence.projects.length === 0, '2h an operating record with no event in the window is not a standing inventory (R3)');
  const opYes = at('issued', '2026-09-10', { status: 'Operating' });
  ok(opYes.intelligence.projects.length === 1, '2h an operating record WITH an event in the window is listed');
}

// ---- 3. Type and lifecycle come from the canonical authority, not from this module -------------------------
{
  const ptSrc = readFileSync(join(root, 'lib/project-type.js'), 'utf8');
  const sandbox = { window: {} };
  runInNewContext(ptSrc, sandbox);
  const AUTH = sandbox.window.HS;
  const cases = [
    { type: 'Residential', name: 'Oak Grove Townhomes' }, { type: 'Commercial', name: 'Riverside Retail Center' },
    { type: 'Utility', name: 'SR 520/Albert D. Rosellini Bridge - Weather Station Replacement' }, { type: 'Industrial', name: 'Pennhurst Data Centers' },
    { type: 'Data center', name: 'Hyperscale Campus' }, { type: 'Development', name: 'Mixed-Use Building' }, { type: '', name: '' },
    { type: 'Civic/Public', name: 'Fire Station 12' }, { type: 'Roads', name: 'Highway 99 Widening' },
  ];
  const statuses = ['Proposed', 'Approved', 'Operating', 'Active', 'Decided', 'On file', 'built', '', null, 'Some New Word'];
  let same = true, count = 0;
  for (const c of cases) for (const s of statuses) {
    const out = run({ rights: RIGHTS_A, rows: [row('kx', 0.2)], projects: [proj('kx', { ...c, status: s, date_kind: 'issued', submitted_at: '2026-09-10' })] });
    const p = out.intelligence.projects[0];
    const wantT = AUTH.canonicalProjectType({ type: c.type, name: c.name });
    const wantL = AUTH.canonicalLifecycle({ status: s });
    count++;
    if (!p) { same = false; continue; }
    if (JSON.stringify(p.type) !== JSON.stringify(wantT ? { key: wantT.typeKey, label: wantT.label } : null)) same = false;
    if (p.lifecycle.key !== wantL.key || p.lifecycle.label !== wantL.label) same = false;
    if (p.publisher_status !== s) same = false;
  }
  ok(same && count === 90, '3a Type and lifecycle equal the source authority (lib/project-type.js) on 9 types x 10 statuses = 90 records; the publisher status is carried verbatim', count);
  const dec = run({ rows: [row('kd', 0.2)], projects: [proj('kd', { status: 'Decided', date_kind: 'decided', submitted_at: '2026-09-10' })] }).intelligence.projects[0];
  ok(dec.lifecycle.key === 'proposed' && dec.lifecycle.label === 'Proposed' && dec.publisher_status === 'Decided',
    '3b "Decided" is lifecycle proposed (a decided application is a historical proposal, CLAUDE.md §7.05) with the publisher status "Decided" kept verbatim beside it');
  const decGroups = run({ rows: [row('kd', 0.2), row('kp', 0.3)], projects: [
    proj('kd', { status: 'Decided', date_kind: 'decided', submitted_at: '2026-09-10' }), proj('kp', { status: 'Proposed' })] }).intelligence.sections.by_lifecycle;
  ok(ids(decGroups.proposed) === 'kd,kp' && decGroups.unknown.length === 0,
    '3b2 a Decided project is listed with the Proposed group, and nothing lands in unknown because of it', ids(decGroups.proposed) + ' / unknown ' + decGroups.unknown.length);
  const lc = run({ rows: [row('ka', 0.2), row('kb', 0.3), row('kc', 0.4)], projects: [
    proj('ka', { status: 'Approved' }), proj('kb', { status: 'Proposed' }), proj('kc', { status: 'On file' })] }).intelligence.sections.by_lifecycle;
  ok(ids(lc.approved) === 'ka' && ids(lc.proposed) === 'kb' && ids(lc.unknown) === 'kc' && lc.operating.length === 0, '3c lifecycle groups are exactly the four canonical keys');
}

// ---- 4. change intelligence: a HomeSignal-detected change only where the ledger proves one ----------------
{
  const base = { rows: [row('k1', 0.2)], projects: [proj('k1', { status: 'Approved', date_kind: 'issued', submitted_at: '2026-09-24' })] };
  const proven = run({ ...base, ledger: [led('k1')], events: [ev('k1')] });
  ok(ids(proven.intelligence.sections.what_changed_recently) === 'k1', '4a a change-ready record with a material event in the window is under What Changed Recently');
  ok(proven.intelligence.sections.recent_official_activity.length === 0, '4a and not also under Recent Official Activity');
  const ch = proven.intelligence.projects[0].homesignal_detected_changes;
  ok(ch.length === 1 && ch[0].changes.length === 2 && ch[0].changes[0].field === 'status' && ch[0].changes[0].from === 'Proposed' && ch[0].changes[0].to === 'Approved',
    '4a the change states what changed, from and to, taken from the event', ch);
  ok(proven.coverage_state === 'LIMITED_COVERAGE' ? false : true, '4a a proven change with a cleared family is not limited');
  ok(proven.coverage_state === 'CHANGE_READY', '4b coverage is CHANGE_READY when a change-ready record is in the report', proven.coverage_state);

  const notReady = run({ ...base, ledger: [led('k1', { change_ready: false, observation_count: 1 })], events: [ev('k1')] });
  ok(notReady.intelligence.sections.what_changed_recently.length === 0 && ids(notReady.intelligence.sections.recent_official_activity) === 'k1',
    '4c a record that is not change-ready is never labelled a detected change: it falls back to Recent Official Activity');
  ok(!('homesignal_detected_changes' in notReady.intelligence.projects[0]), '4c and carries no detected-change block');
  ok(notReady.coverage_state === 'REPORT_READY', '4c coverage is REPORT_READY, not CHANGE_READY', notReady.coverage_state);

  const nonMaterial = run({ ...base, ledger: [led('k1')], events: [ev('k1', { material: false })] });
  ok(nonMaterial.intelligence.sections.what_changed_recently.length === 0, '4d a non-material event (a technical edit) is never a brokerage-facing change');
  const old = run({ ...base, ledger: [led('k1')], events: [ev('k1', { observed_at: '2026-06-01T10:00:00Z' })] });
  ok(old.intelligence.sections.what_changed_recently.length === 0, '4e an event older than the window is not "recent"');
  const future = run({ ...base, ledger: [led('k1')], events: [ev('k1', { observed_at: '2026-10-05T10:00:00Z' })] });
  ok(future.intelligence.sections.what_changed_recently.length === 0, '4e an event dated after today is not shown');
  const noLedger = run({ ...base, ledger: [], events: [ev('k1')] });
  ok(noLedger.intelligence.sections.what_changed_recently.length === 0, '4f an event for a record with no ledger row is not shown');
  const first = run({ ...base, ledger: [led('k1')], events: [ev('k1', { event_type: 'first_detected', prev_facts: null, new_facts: { status: 'Approved' }, changed_fields: [] })] });
  ok(ids(first.intelligence.sections.what_changed_recently) === 'k1' && first.intelligence.projects[0].homesignal_detected_changes[0].event_type === 'first_detected',
    '4g a first detection is reported as a first detection, with no invented from/to');
  const obs = proven.intelligence.projects[0].homesignal_observation;
  ok(obs.first_observed_at === '2026-09-29T19:00:00Z' && obs.observation_count === 2, '4h HomeSignal\'s own observation times are labelled as observations, not as publication dates');
}

// ---- 5. coverage states: only what the inputs support, and it says which ----------------------------------
{
  const out = M.assemble({ now: NOW, view: 'customer', zip_supported: false, radius_mi: 1, rights: RIGHTS_A, subject: { ...SUBJECT, zip: '00000' }, rows: [], projects: [], ledger: [], events: [], health: [] });
  ok(out.coverage_state === 'OUTSIDE_COVERAGE' && out.intelligence === null && out.privateContext === null && out.engineInputs === null, '5a a ZIP outside the 12,722 yields no report, no private context and nothing to store');
  ok(out.storage_blockers.length === 1 && out.storage_blockers[0] === 'OUTSIDE_COVERAGE', '5a and says why', out.storage_blockers);

  const base = { rows: [row('k1', 0.2)], projects: [proj('k1', { status: 'Approved', date_kind: 'issued', submitted_at: '2026-09-10' })] };
  const more = run({ rows: [row('k1', 0.2, { has_more: true })], projects: base.projects });
  ok(more.coverage_state === 'LIMITED_COVERAGE' && more.intelligence.coverage.area_truncated === true && more.intelligence.coverage.limitations.some((l) => l.code === 'AREA_TRUNCATED'),
    '5b a truncated spatial answer is LIMITED and disclosed (never inferred from the row count)');
  const fail = run({ ...base, health: [{ registry_id: 'wsdot-project-delivery-plan-proposed', fetch_failures_24h: 2, blocked_24h: 0, truncated_24h: 0 }] });
  ok(fail.coverage_state === 'LIMITED_COVERAGE' && fail.intelligence.coverage.limitations.some((l) => l.code === 'SOURCE_NOT_FULLY_READ'), '5c an included source that failed to read in the last 24 hours makes coverage LIMITED');
  const other = run({ ...base, health: [{ registry_id: 'some-other-family', fetch_failures_24h: 9, blocked_24h: 9, truncated_24h: 9 }] });
  ok(other.coverage_state === 'REPORT_READY', '5d a failure in a family that is not in the report does not limit it', other.coverage_state);
  const empty = run({ rows: [], projects: [] });
  ok(empty.coverage_state === 'REPORT_READY' && empty.intelligence.projects.length === 0, '5e a cleared source that returns nothing is a valid, ready result: no activity is not no coverage');
  ok(empty.intelligence.coverage.assessment_basis === 'records_returned_for_this_radius', '5f the report states the basis of its coverage assessment (it cannot see what a source should have covered)');
  ok(empty.intelligence.coverage.source_families_in_report.length === 0, '5f and lists the families that contributed (none)');
}

// ---- 6. the split, and the boundary on the engine's OWN output (contract §8.1, §8.2, §8.4) -----------------
const SUBJECTS = [
  { address: '742 Evergreen Terrace, Springfield, OR 97477', matched_address: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477', label: 'Homer client' },
  { address: '1600 Pennsylvania Ave NW, Washington, DC 20500', matched_address: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500', lat: 38.89768, lng: -77.03653, zip: '97477' },
  { address: '31 Spooner Street Quahog RI', matched_address: '31 SPOONER ST, QUAHOG, RI, 97477', lat: 41.83452, lng: -71.41255, zip: '97477', label: 'Griffin, Peter' },
  { address: '4 Privet Drive, Little Whinging, Surrey', matched_address: '4 PRIVET DR, LITTLE WHINGING, SURREY, 97477', lat: 51.34567, lng: -0.61234, zip: '97477' },
  { address: '221B Baker Street', matched_address: '221B BAKER ST, LONDON, 97477', lat: 51.52377, lng: -0.15854, zip: '97477' },
  { address: '9 1/2 Elm Street Apt 4', matched_address: '9 1/2 ELM ST APT 4, SPRINGWOOD, OH, 97477', lat: 40.12345, lng: -82.98765, zip: '97477' },
];
const FIELD = {
  rows: [row('k1', 0.21), row('k1', 0.19, { feature_id: 'pt:2' }), row('k2', 0.77), row('k3', 0.93)],
  projects: [
    proj('k1', { status: 'Approved', date_kind: 'issued', submitted_at: '2026-09-24', name: 'Ravenna Bridge Retrofit', address: '005 King' }),
    proj('k2', { status: 'Proposed', date_kind: 'filed', submitted_at: '2026-09-12', name: 'Weather Station Replacement', address: '520 King' }),
    proj('k3', { status: 'Operating', date_kind: 'completed', submitted_at: '2026-09-02', name: 'Bridge 520/8', address: '90 Somewhere Rd' }),
  ],
  ledger: [led('k1'), led('k2', { change_ready: false, observation_count: 1 })],
  events: [ev('k1')],
};
{
  const outs = SUBJECTS.map((s) => run({ subject: s, ...FIELD }));
  ok(outs.every((o) => o.storage_blockers.length === 0), '6a six subject addresses that are not project sites all yield a report with NO storage blocker', outs.map((o) => o.storage_blockers));
  const bodies = outs.map(body);
  ok(new Set(bodies).size === 1, '6b THE SPLIT: the permanent body is byte-identical for six different subjects in the same area (it cannot depend on the address or the point)');
  const priv = SUBJECTS.flatMap((s) => [s.address, s.matched_address, s.label].filter(Boolean));
  const norm = (t) => String(t).toLowerCase().replace(/[\s,.]+/g, ' ').trim();
  ok(priv.every((p) => !norm(bodies[0]).includes(norm(p))), '6c no whole private value (address, matched address, label) is in the body');
  const frag = SUBJECTS.flatMap((s) => [norm(s.address.split(',')[0]), norm(s.address).split(' ').slice(0, 2).join(' ')]).filter((f) => f.length >= 5);
  ok(frag.length >= 8 && frag.every((f) => !norm(bodies[0]).includes(f)), '6d no FRAGMENT of any address (street line; house number + street word) is in the body (contract §8.4)', frag.length);
  ok(SUBJECTS.every((s) => !bodies[0].includes(String(s.lat)) && !bodies[0].includes(String(s.lng))), '6e no coordinate of any subject is in the body');
  ok(S.subjectRelativeKeys(JSON.parse(bodies[0])).length === 0, '6f no subject-relative key (distance, offset, bearing) is anywhere in the body');
  ok(outs[0].renderOnly.distances_mi.k1 === 0.19 && outs[0].renderOnly.distances_mi.k2 === 0.77 && outs[0].renderOnly.distances_mi.k3 === 0.93, '6g distances exist only in the response-only block, the nearest instance per project', outs[0].renderOnly);
  ok(!('distances_mi' in outs[0].intelligence) && !JSON.stringify(outs[0].intelligence).includes('0.77'), '6g and not in the intelligence');

  const shuffled = run({ ...FIELD, rows: [...FIELD.rows].reverse(), projects: [...FIELD.projects].reverse(), ledger: [...FIELD.ledger].reverse(), events: [...FIELD.events].reverse() });
  ok(body(shuffled) === bodies[0] && sha(body(shuffled)) === sha(bodies[0]), '6h the body and its hash do not depend on the order the database returned rows in');
  ok(JSON.stringify(outs[0].intelligence.sections.recent_official_activity) === JSON.stringify(['k2', 'k3']) && JSON.stringify(outs[0].intelligence.sections.what_changed_recently) === JSON.stringify(['k1']),
    '6i the sections are what the fixture implies: k1 changed (ledger-proven), k2 is a filing, k3 (operating, completed 27 days ago) is an event', outs[0].intelligence.sections);

  const pc = outs[0].privateContext;
  ok(pc.address === SUBJECTS[0].address && pc.normalized_address === SUBJECTS[0].matched_address && pc.latitude === 44.04612 && pc.longitude === -122.98123 && pc.label === 'Homer client',
    '6j the private context carries exactly what the customer entered and what derives from it', pc);
  ok(Object.keys(pc).sort().join(',') === 'address,label,latitude,longitude,normalized_address', '6j and nothing else (no client name, email or phone field exists)', Object.keys(pc));
  ok(JSON.stringify(outs[0].engineInputs) === JSON.stringify({ engine: 'development-activity-national-2', zip: '97477', radius_mi: 1, recent_days: 90, stage_rule_version: 'stage-evidence-1', rights_registry_version: 1, cleared_families: 1 }), '6k the engine inputs hold the ZIP, radius and versions, and no private value', outs[0].engineInputs);

  // the hand-off through the real module: what would be sent to the database
  const sent = [];
  const rpc = async (fn, args) => { sent.push({ fn, args }); return { data: [{ report_id: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', generated_at: '2026-09-29T12:00:00Z', private_context_id: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d' }], error: null }; };
  const env = await S.issueSnapshot(rpc, outs[0].intelligence, outs[0].privateContext, { reportVersion: M.REPORT_VERSION, engineInputs: outs[0].engineInputs });
  const a = sent[0].args;
  ok(a.p_private.address === SUBJECTS[0].address && !a.p_body.includes('Evergreen') && !JSON.stringify(a.p_engine_inputs).includes('Evergreen'),
    '6l issued through the real snapshot module: the address travels only as the private argument; the body and the engine inputs do not contain it');
  ok(a.p_content_hash === sha(a.p_body) && env.content_hash === a.p_content_hash, '6l and the hash is the SHA-256 of the exact body stored');
  ok(!JSON.stringify(env).includes('Evergreen'), '6l and the envelope handed back holds no private value');
}

// ---- 7. the boundary check itself: each leak is found, by name, and no finding repeats the value --------------
{
  const ctx = { address: '742 Evergreen Terrace, Springfield, OR 97477', normalized_address: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', latitude: 44.04612, longitude: -122.98123, label: 'Homer client' };
  const clean = { zip: '97477', projects: [{ name: 'Ravenna Bridge' }] };
  const F = (intel) => M.boundaryFindings(intel, ctx);
  ok(F(clean).length === 0, '7a a clean body has no finding');
  const cases = [
    ['ADDRESS_IN_BODY', { ...clean, note: 'Subject 742 Evergreen Terrace, Springfield, OR 97477 reviewed' }],
    ['NORMALIZED_ADDRESS_IN_BODY', { ...clean, note: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477' }],
    ['ADDRESS_FRAGMENT_IN_BODY:street_line', { ...clean, note: 'near 742 Evergreen Terrace' }],
    ['ADDRESS_FRAGMENT_IN_BODY:house_number_and_street', { ...clean, note: 'at 742 Evergreen' }],
    ['LABEL_IN_BODY', { ...clean, note: 'for Homer client' }],
    ['COORDINATE_IN_BODY', { ...clean, note: 'point 44.04612' }],
    ['SUBJECT_RELATIVE_KEY:$.projects[0].distance_mi', { ...clean, projects: [{ name: 'x', distance_mi: 0.4 }] }],
    ['SUBJECT_RELATIVE_KEY:$.bearing_deg', { ...clean, bearing_deg: 90 }],
    ['SUBJECT_RELATIVE_KEY:$.east_mi', { ...clean, east_mi: 0.1 }],
  ];
  for (const [want, intel] of cases) {
    const f = F(intel);
    ok(f.includes(want), '7b leak found by name: ' + want, f);
    ok(!/evergreen|homer|44\.046|springfield/i.test(f.join(' ')), '7c and the finding does not repeat the private value: ' + want, f);
  }
  ok(F({ ...clean, note: 'ZIP 97477 area, 44.0 lat' }).length === 0, '7d a ZIP and a coarse (fewer than five decimals) number are not findings');
  ok(M.boundaryFindings({ zip: '97477', note: '742 Evergreen' }, null).length === 0, '7e with no private context there is nothing to leak (subject-relative keys are still checked)');
  ok(M.boundaryFindings({ zip: '97477', distance_mi: 1 }, null).length === 1, '7e including with no context');
  const fr = M.addressFragments('742 Evergreen Terrace, Springfield, OR 97477');
  ok(fr.length === 2 && fr[0].text === '742 evergreen terrace' && fr[1].text === '742 evergreen', '7f the fragments derived from an address are its street line and its house number + street word', fr);
  ok(M.addressFragments('Main').length === 0 && M.addressFragments('1 A').length === 0, '7f a value too short to be a fragment yields none');

  // a subject that IS a record's address must fail closed for storage, not silently pass
  const site = run({ subject: { ...SUBJECT, address: '005 King Street, Seattle, WA 98103', matched_address: '5 KING ST, SEATTLE, WA, 98103' }, ...FIELD });
  ok(site.storage_blockers.some((b) => b.startsWith('BOUNDARY:ADDRESS_FRAGMENT_IN_BODY')), '7g a subject whose street line is a record\'s own address is flagged as not storable (fail closed, contract §8.3)', site.storage_blockers);
  ok(!site.storage_blockers.join(' ').includes('005 king'), '7g and the blocker does not repeat the address');
}

// ---- 8. shape, order and refusals -------------------------------------------------------------------------
{
  const r = run({ rows: [row('kb', 0.2), row('ka', 0.3)], projects: [proj('kb', { status: 'Approved' }), proj('ka', { status: 'Approved' }), proj('kc', { source_ref: '' }), proj('kd', { source_ref: null }), proj('ke', { record_kind: 'facility' })].map((p) => p), });
  ok(ids(r.intelligence.projects.map((p) => p.project_id)) === 'ka,kb', '8a projects are sorted by project id; a project not in the spatial answer is not added', ids(r.intelligence.projects.map((p) => p.project_id)));
  const r2 = run({ rows: [row('kc', 0.2), row('kd', 0.2), row('ke', 0.2)], projects: [proj('kc', { source_ref: '' }), proj('kd', { source_ref: null }), proj('ke', { record_kind: 'facility' })] });
  ok(r2.intelligence.projects.length === 0, '8b a record with no source URL, or that is not a development record, is not in the report');
  ok(r.intelligence.product === 'HOMESIGNAL DEVELOPMENT ACTIVITY' && r.intelligence.report_version === 'development-activity-national-2' && r.intelligence.as_of === '2026-09-29', '8c product name, version and as-of day', [r.intelligence.product, r.intelligence.report_version, r.intelligence.as_of]);
  ok(M.parseRadius(0.5) === 0.5 && M.parseRadius('2') === 2 && M.parseRadius(3) === null && M.parseRadius('') === null && M.parseRadius(null) === null && M.parseRadius('x') === null, '8d only the four canonical radii parse');
  ok(throws(() => run({ radius_mi: 3 })) !== null && throws(() => run({ view: 'staff' })) !== null && throws(() => run({ subject: { ...SUBJECT, zip: '9747' } })) !== null && throws(() => run({ subject: { ...SUBJECT, address: '  ' } })) !== null
    && throws(() => run({ subject: { ...SUBJECT, lat: NaN } })) !== null, '8e a bad radius, view, ZIP, blank address or non-finite point is refused');
  ok(M.RECENT_DAYS === 90 && JSON.stringify(M.ALLOWED_RADII) === '[0.5,1,2,5]', '8f the window is 90 days and the radii are 0.5, 1, 2, 5');
  ok(JSON.stringify(Object.keys(M.EVENT_KINDS)) === '["filed","issued","decided","awarded","completed","hearing"]', '8f the event kinds are exactly the six that record something that happened');
}

// ---- 9. the Stage dimension and the map's directions (100526 plan, step 2) ----------------------------------------
{
  const named = Object.keys(M.STAGE_EVIDENCE);
  ok(named.length === 17 && named.every((k) => M.stageEvidence(k) && M.stageEvidence(k).kind === M.STAGE_EVIDENCE[k]), '9a every named publisher stage is evidence of its own kind', named.length);
  const as = (v) => (M.stageEvidence(v) || {}).kind || null;
  ok(as('05_Construction') === 'under_construction' && as('5. ISSUED') === 'permit_issued' && as('UNDER CONSTRUCTION') === 'under_construction'
    && as('  Permit   Issued ') === 'permit_issued' && as('Under Construction') === 'under_construction' && as('Construction Started') === 'under_construction',
    '9b a leading phase number, case and spacing do not change the answer (production spellings)');
  const notEvidence = ['Construction Work Program', 'In the 2026 county construction program', 'Design and Construct', 'CO Issued', 'C of O Issued',
    'Certificate of Occupancy Issued', 'TCO Issued', 'Construction Completed', 'Decision Issued', 'To Be Issued', '05_Construction (Pending)',
    'Approved for Permitting', 'PHASED PERMITTING', 'New Building', 'Phased Construction', 'Permit Printed', 'Underway', 'Close Out', 'Advertised', '', null, 7];
  ok(notEvidence.every((v) => M.stageEvidence(v) === null), '9c plans, finished work, decisions, permit classes and unclear words are NOT evidence', notEvidence.filter((v) => M.stageEvidence(v) !== null));
  ok(M.presentationStage('approved', 'Under Construction') === 'permitted' && M.presentationStage('unknown', 'Issued') === 'permitted'
    && M.presentationStage('approved', 'Advertised') === 'approved' && M.presentationStage('approved', null) === 'approved'
    && M.presentationStage('proposed', 'Issued') === 'proposed' && M.presentationStage('proposed', null) === 'proposed'
    && M.presentationStage('operating', 'Construction') === null && M.presentationStage('unknown', 'On file') === null,
    '9d one assignment: evidence makes an approved or unknown record Permitted; approved without it is Approved; proposed stays Proposed; operating and quiet unknown have no stage');
  ok(JSON.stringify(M.STAGE_LABELS) === JSON.stringify({ approved: 'Approved / Coming', proposed: 'Proposed / Under Review', permitted: 'Permitted / Under Construction' })
    && !('permitted' in { proposed: 1, approved: 1, operating: 1, unknown: 1 }) && JSON.stringify([...M.LIFECYCLE_ORDER]) === '["approved","proposed","operating","unknown"]',
    '9e the three stage labels are the plan\'s, and the lifecycle keys are still exactly four (ruling 2)');

  // the 84302 shape, read from production 2026-10-02 (app_projects, udot-active-projects-lines): two under construction, one closed out
  const UDOT = 'udot-active-projects-lines';
  const R = { version: 1, cleared: [{ registry_id: UDOT, cleared_on: '2026-10-02', audit_ref: 'test fixture', attribution: '' }] };
  const SUB = { address: '20 N Main St, Brigham City, UT 84302', matched_address: '20 N MAIN ST, BRIGHAM CITY, UT, 84302', lat: 41.51090028281, lng: -112.015646109683, zip: '84302' };
  const urow = (k, d, mlat, mlng) => ({ source_key: k, feature_id: k + '#1', registry_id: UDOT, provenance: 'recovered_authoritative', distance_mi: d, geometry_type: 'ST_MultiLineString', has_more: false, marker_lat: mlat, marker_lng: mlng });
  const uproj = (k, status, stage, name) => ({ source_key: k, registry_id: UDOT, record_kind: 'development', name, type: 'Utility', type_raw: 'Traffic and Safety', status, stage,
    developer: null, size: null, investment: null, submitted_at: '2024-08-26', date_kind: 'filed', address: 'SR-13', source_ref: 'https://data-uplan.opendata.arcgis.com/datasets/udot-projects-points' });
  const out = M.assemble({ now: new Date('2026-10-02T12:00:00Z'), view: 'customer', zip_supported: true, radius_mi: M.REPORT_RADIUS_MI, rights: R, subject: SUB,
    rows: [urow('u:22248', 0.1217, 41.5128578810083, -112.015662896203), urow('u:22250', 0.3195, 41.50607192187, -112.015813250643),
      urow('u:22013', 0.4068, 41.5168505941753, -112.015583906049), urow('u:p', 0.2, 41.5109, -112.0100), urow('u:nm', 0.3, null, null)],
    projects: [uproj('u:22248', 'Approved', 'Under Construction', 'SR-13 (Main St) & 100 North'), uproj('u:22250', 'Approved', 'Under Construction', 'SR-13 (Main St) & 200 South'),
      uproj('u:22013', 'Operating', 'Close Out', 'SR-13 (Main Street) & 300 North'), uproj('u:p', 'Proposed', 'Concept', 'A proposed road'), uproj('u:nm', 'Approved', 'Advertised', 'No marker')],
    ledger: [], events: [], health: [] });
  const I = out.intelligence;
  ok(JSON.stringify(I.sections.by_stage) === JSON.stringify({ approved: ['u:nm'], proposed: ['u:p'], permitted: ['u:22248', 'u:22250'] }),
    '9f 84302: the two Under Construction records are Permitted / Under Construction, the Advertised one is Approved / Coming, the closed-out one is in no section', I.sections.by_stage);
  ok(JSON.stringify(I.sections.by_lifecycle.approved) === '["u:22248","u:22250","u:nm"]' && I.projects.every((p) => p.lifecycle.key !== 'permitted'),
    '9g the canonical lifecycle is untouched: Permitted records are still lifecycle approved');
  const pp = Object.fromEntries(I.projects.map((p) => [p.project_id, p]));
  ok(JSON.stringify(pp['u:22248'].stage) === JSON.stringify({ key: 'permitted', label: 'Permitted / Under Construction', evidence: 'Under construction' })
    && JSON.stringify(pp['u:nm'].stage) === JSON.stringify({ key: 'approved', label: 'Approved / Coming' }) && pp['u:22248'].publisher_stage === 'Under Construction',
    '9h each record carries its stage, the evidence that put it there, and the publisher\'s own stage word', pp['u:22248'].stage);
  const all = Object.values(I.sections.by_stage).flat();
  ok(all.length === new Set(all).size, '9i a project is in at most one stage section');
  ok(I.stage_rule_version === 'stage-evidence-1' && out.engineInputs.stage_rule_version === 'stage-evidence-1' && I.radius_mi === 0.5, '9j the report says which stage rule judged it, and that it is 0.5 mile');
  const B = out.renderOnly.bearings_deg;
  ok(B['u:22248'] === 0 && B['u:22250'] === 181 && B['u:p'] === 90 && !('u:nm' in B) && !('u:22013' in B),
    '9k map directions: north 0, a hair west of south 181 (the real 200 South point), east 90; none for a record with no display point or not in the report', B);
  ok(S.subjectRelativeKeys(JSON.parse(S.snapshotBodyOf(I))).length === 0 && !JSON.stringify(I).includes('bearing'), '9l directions are response-only: nothing subject-relative is in the permanent report');
  ok(M.bearingDeg(1, 1, 1, 1) === null && M.bearingDeg(NaN, 0, 1, 1) === null, '9m no direction from a point to itself, or from a non-finite point');
  ok(JSON.stringify(out.renderOnly.review) === '["u:22248","u:p","u:nm"]' && M.REVIEW_LIMIT === 3,
    '9n Things to Review: the three nearest projects in a stage section (0.12, 0.2, 0.3 mi; a missing map point does not matter); the fourth, at 0.32 mi, is left out', out.renderOnly.review);
  const tie = M.assemble({ now: new Date('2026-10-02T12:00:00Z'), view: 'customer', zip_supported: true, radius_mi: 0.5, rights: R, subject: SUB,
    rows: [urow('t:a', 0.2, 41.52, -112.0156), urow('t:b', 0.2, 41.52, -112.0156), urow('t:c', 0.2, 41.52, -112.0156), urow('t:d', 0.1, 41.52, -112.0156)],
    projects: [uproj('t:a', 'Proposed', null, 'A'), uproj('t:b', 'Approved', 'Issued', 'B'), uproj('t:c', 'Approved', null, 'C'), uproj('t:d', 'Operating', 'Close Out', 'D')],
    ledger: [], events: [], health: [] });
  ok(JSON.stringify(tie.renderOnly.review) === '["t:b","t:c","t:a"]', '9o a tie in distance goes to the stronger stage (Permitted, Approved, Proposed); a record in no stage section is never listed', tie.renderOnly.review);
  ok(!JSON.stringify(out.intelligence).includes('review'), '9p the review list is response-only: it is measured from the subject');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
