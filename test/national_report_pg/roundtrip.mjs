// THE ENGINE'S OWN OUTPUT, THROUGH THE REAL WRITER (Development Activity plan, Order G).
// Until this file, the split was proven against the legacy engine's data and hand-made fixtures. Here the national engine
// assembles reports for six subject addresses, the real snapshot module stores them, and every assertion is about what the
// disposable DATABASE holds afterwards. The module's rpc is a psql session, so nothing in the path is a stand-in except the
// data the engine is handed.
//   Run through: bash test/national_report_pg/run.sh   (it prepares the database and refuses anything not named disposable)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const M = await import('../../supabase/functions/_shared/national-report.ts');
const S = await import('../../supabase/functions/_shared/report-snapshot.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function psql(query, vars = {}) {
  const args = ['-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', k + '=' + v);
  const r = spawnSync('psql', [...args, '-f', '-'], { input: query, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const one = (q, v) => { const r = psql(q, v); if (!r.ok) throw new Error('psql: ' + r.err); return r.out; };

/** The snapshot module's rpc, backed by the real database. An error is returned the way the API returns it. */
const rpc = async (fn, a) => {
  if (fn !== 'report_snapshot_issue') throw new Error('unexpected rpc ' + fn);
  const r = psql("select row_to_json(t) from public.report_snapshot_issue(:'b', :'h', :'v', :'i'::jsonb, nullif(:'p', '')::jsonb) t;",
    { b: a.p_body, h: a.p_content_hash, v: a.p_report_version, i: JSON.stringify(a.p_engine_inputs), p: a.p_private === null ? '' : JSON.stringify(a.p_private) });
  if (!r.ok) return { data: null, error: { message: (r.err.match(/ERROR:.*/) || [r.err])[0] } };
  return { data: [JSON.parse(r.out)], error: null };
};

// ---- the engine's inputs: real-shaped rows, six subjects that are not project sites ---------------------------------------
const NOW = new Date('2026-09-29T12:00:00Z');
const RIGHTS = { version: 1, cleared: [{ registry_id: 'wsdot-project-delivery-plan-proposed', cleared_on: '2026-09-29', audit_ref: 'round-trip fixture', attribution: 'Data: WSDOT' }] };
const row = (k, d, x = {}) => ({ source_key: k, feature_id: 'pt:1', registry_id: 'wsdot-project-delivery-plan-proposed', provenance: 'proven_stored_point', distance_mi: d, geometry_type: 'Point', has_more: false, ...x });
const proj = (k, x = {}) => ({ source_key: k, registry_id: 'wsdot-project-delivery-plan-proposed', record_kind: 'development', name: 'I-5/NB Ravenna Blvd. Bridges - Seismic Retrofit', type: 'Utility', type_raw: null, status: 'Proposed', stage: 'Not Yet Advertised', developer: null, size: null, investment: null, submitted_at: '2026-09-12', date_kind: 'filed', address: '005 King', source_ref: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/WSDOTProjectDeliveryPlanCurrent/FeatureServer/0', ...x });
const led = (k, x = {}) => ({ identity_key: k, registry_id: 'wsdot-project-delivery-plan-proposed', comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-09-29T19:00:00Z', last_observed_at: '2026-09-29T19:30:00Z', ...x });
const FIELD = {
  rows: [row('k1', 0.21), row('k1', 0.19, { feature_id: 'pt:2' }), row('k2', 0.77), row('k3', 0.93)],
  projects: [
    proj('k1', { status: 'Approved', date_kind: 'issued', submitted_at: '2026-09-24', name: 'Ravenna Bridge Retrofit' }),
    proj('k2', { name: 'Weather Station Replacement', address: '520 King' }),
    proj('k3', { status: 'Operating', date_kind: 'completed', submitted_at: '2026-09-02', name: 'Bridge 520/8', address: '90 Somewhere Rd' }),
  ],
  ledger: [led('k1'), led('k2', { change_ready: false, observation_count: 1 })],
  events: [{ identity_key: 'k1', event_type: 'status_changed', material: true, observed_at: '2026-09-25T10:00:00Z', prev_facts: { status: 'Proposed' }, new_facts: { status: 'Approved' }, changed_fields: ['status'], publisher_event_type: 'issued', publisher_event_date: '2026-09-24' }],
  health: [],
};
const SUBJECTS = [
  { address: '742 Evergreen Terrace, Springfield, OR 97477', matched_address: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477', label: 'Homer client' },
  { address: '1600 Pennsylvania Ave NW, Washington, DC 20500', matched_address: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500', lat: 38.89768, lng: -77.03653, zip: '97477' },
  { address: '31 Spooner Street Quahog RI', matched_address: '31 SPOONER ST, QUAHOG, RI, 97477', lat: 41.83452, lng: -71.41255, zip: '97477', label: 'Griffin, Peter' },
  { address: '4 Privet Drive, Little Whinging, Surrey', matched_address: '4 PRIVET DR, LITTLE WHINGING, SURREY, 97477', lat: 51.34567, lng: -0.61234, zip: '97477' },
  { address: '221B Baker Street', matched_address: '221B BAKER ST, LONDON, 97477', lat: 51.52377, lng: -0.15854, zip: '97477' },
  { address: '9 1/2 Elm Street Apt 4', matched_address: '9 1/2 ELM ST APT 4, SPRINGWOOD, OH, 97477', lat: 40.12345, lng: -82.98765, zip: '97477', label: "O'Brien; unit #4" },
];
const assemble = (s) => M.assemble({ now: NOW, view: 'customer', zip_supported: true, radius_mi: 1, rights: RIGHTS, subject: s, ...FIELD });
const opts = (o) => ({ reportVersion: M.REPORT_VERSION, engineInputs: o.engineInputs });

// ---- 1. six real reports, stored by the real module through the real writer ----------------------------------------------------------
const outs = SUBJECTS.map(assemble);
const envs = [];
for (let i = 0; i < SUBJECTS.length; i++) envs.push(await S.issueSnapshot(rpc, outs[i].intelligence, outs[i].privateContext, opts(outs[i])));
ok(outs.every((o) => o.storage_blockers.length === 0), '1a the engine reports NO storage blocker for any of the six subjects');
ok(envs.length === 6 && new Set(envs.map((e) => e.report_id)).size === 6, '1b the database minted six distinct report_ids');
ok(new Set(envs.map((e) => e.content_hash)).size === 1, '1c and ONE content_hash: six customers, one area, the same permanent report (the split holds in the database, not only in the engine)');
ok(one('select count(*) from public.report_snapshot') === '6' && one('select count(distinct content_hash) from public.report_snapshot') === '1', '1d the table holds six snapshots and one distinct hash');
ok(one("select count(*) from public.report_snapshot where content_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex')") === '6', '1e for every row the database\'s own SHA-256 of the stored body equals the stored content_hash');
ok(envs.every((e, i) => e.content_hash === sha(S.snapshotBodyOf(outs[i].intelligence))), '1f and equals the hash the module computed outside the database');
ok(one("select count(*) from public.report_snapshot s where s.body = :'b'", { b: S.snapshotBodyOf(outs[0].intelligence) }) === '6', '1g the stored body is the engine\'s text, byte for byte');

// ---- 2. nothing private is in the permanent table ---------------------------------------------------------------------------------------
const norm = (t) => String(t).toLowerCase().replace(/[\s,.]+/g, ' ').trim();
const privateValues = SUBJECTS.flatMap((s) => [s.address, s.matched_address, s.label].filter(Boolean));
const fragments = SUBJECTS.flatMap((s) => M.addressFragments(s.address).map((f) => f.text));
let leaks = [];
for (const v of [...privateValues, ...fragments]) {
  const c = one("select count(*) from public.report_snapshot where position(:'v' in regexp_replace(lower(body || ' ' || engine_inputs::text), '[\\s,.]+', ' ', 'g')) > 0", { v: norm(v) });
  if (c !== '0') leaks.push(privateValues.includes(v) ? '(whole value #' + (privateValues.indexOf(v) + 1) + ')' : '(an address fragment)');
}
ok(privateValues.length === 15 && fragments.length >= 8, '2a (control) the scan covers 15 whole private values (6 addresses, 6 matched forms, 3 labels) and at least 8 address fragments', [privateValues.length, fragments.length]);
ok(leaks.length === 0, '2b NONE of them is anywhere in the stored body or engine inputs (whole values and fragments), asked of the database itself', leaks);
ok(SUBJECTS.every((s) => one("select count(*) from public.report_snapshot where position(:'a' in body || engine_inputs::text) > 0 or position(:'b' in body || engine_inputs::text) > 0", { a: String(s.lat), b: String(s.lng) }) === '0'), '2c no subject coordinate is in the stored text');
ok(one("select count(*) from public.report_snapshot where body ~* '\"(distance|dist|bearing|east|north|south|west)[a-z_]*\"\\s*:'") === '0', '2d and no distance-like KEY is (radius_mi, the report\'s own radius, is not one)');
ok(one("select count(*) from public.report_snapshot where body like '%\"radius_mi\":1%'") === '6', '2d (control) the pattern would have matched: the radius key is in every body');
ok(SUBJECTS.every((s, i) => one("select address || '|' || coalesce(normalized_address, '') || '|' || latitude::text || '|' || longitude::text || '|' || coalesce(label, '') from public.report_private_context c join public.report_snapshot r on r.private_context_id = c.context_id where r.report_id = :'id'", { id: envs[i].report_id })
  === [s.address, s.matched_address, s.lat, s.lng, s.label ?? ''].join('|')), '2e what the customer entered, and only that, is in the private layer, reachable from its report');
ok(one("select count(*) from public.report_private_context where state = 'active'") === '6' && one("select count(*) from public.report_private_context_need where closed_at is null") === '6', '2f each report holds one open need on its context, in the same transaction that stored it');

// ---- 3. purging the customer's context leaves the permanent report intact ------------------------------------------------------------
{
  const id = envs[0].report_id, ctx = envs[0].private_context_id;
  const before = one("select md5(row_to_json(s)::text) from public.report_snapshot s where report_id = :'id'", { id });
  const purged = one("select public.report_private_context_purge(:'c'::uuid, 'verified_privacy_request')", { c: ctx });
  const after = one("select md5(row_to_json(s)::text) from public.report_snapshot s where report_id = :'id'", { id });
  ok(purged === 't', '3a a verified privacy request purges the context at once, with the report\'s need still open');
  ok(before === after, '3b the permanent snapshot row is byte-identical after the purge');
  ok(one("select (content_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex'))::text from public.report_snapshot where report_id = :'id'", { id }) === 'true', '3c and still verifies against its hash');
  ok(one("select coalesce(address, 'NULL') || '|' || state from public.report_private_context where context_id = :'c'::uuid", { c: ctx }) === 'NULL|purged', '3d the address is gone from the private layer (state purged)');
  ok(one("select count(*) from public.report_snapshot where private_context_id = :'c'::uuid", { c: ctx }) === '1', '3e the foreign key still resolves to the tombstone');
  ok(one("select count(*) from public.report_private_context where state = 'active'") === '5', '3f no other customer\'s context was touched');
}

// ---- 4. the layers: a regression in the engine is caught by name, and by the database where it can see -------------------------------------
{
  const s = SUBJECTS[1];
  const good = outs[1];
  const count = () => one('select count(*) from public.report_snapshot') + '/' + one('select count(*) from public.report_private_context');
  const base = count();

  // (i) the whole address in the body: the engine's boundary names it AND the database refuses it, atomically
  const whole = { ...good.intelligence, note: 'Subject ' + s.address };
  ok(M.boundaryFindings(whole, good.privateContext).includes('ADDRESS_IN_BODY'), '4a a body that carries the whole address: the engine\'s boundary check names it');
  let e1 = null; try { await S.issueSnapshot(rpc, whole, good.privateContext, opts(good)); } catch (e) { e1 = String(e.message); }
  ok(e1 !== null && /23514/.test(e1), '4a and the database refuses it (23514)', e1);
  ok(count() === base, '4a atomically: nothing was left behind (snapshots/contexts unchanged)', [base, count()]);

  // (ii) a distance in the body: the module refuses before the database is asked
  const dist = { ...good.intelligence, nearest: { distance_mi: 0.19 } };
  ok(M.boundaryFindings(dist, good.privateContext).some((f) => f.startsWith('SUBJECT_RELATIVE_KEY')), '4b a body with a distance from the subject: the engine\'s boundary check names it');
  let e2 = null; try { await S.issueSnapshot(rpc, dist, good.privateContext, opts(good)); } catch (e) { e2 = String(e.message); }
  ok(e2 !== null && /measurements taken from the subject/.test(e2) && count() === base, '4b and the snapshot module refuses it before any write');

  // (iii) THE NAMED LIMIT: only the street line. The database cannot see a fragment (contract §9, report_snapshot_pg X07b),
  // so the engine's own check is the control, and this proves both halves of that sentence on the real path.
  const frag = { ...good.intelligence, note: 'near ' + s.address.split(',')[0] };
  const finds = M.boundaryFindings(frag, good.privateContext);
  ok(finds.includes('ADDRESS_FRAGMENT_IN_BODY:street_line'), '4c a body with only the street line: the engine\'s boundary check names the fragment');
  let e3 = null, env3 = null; try { env3 = await S.issueSnapshot(rpc, frag, good.privateContext, opts(good)); } catch (e) { e3 = String(e.message); }
  ok(e3 === null && env3 && /^[0-9a-f-]{36}$/.test(env3.report_id), '4c and the DATABASE ACCEPTS it: the fragment limit is real, which is why the engine\'s check exists and must run before any store');
  ok(!finds.join(' ').toLowerCase().includes('pennsylvania'), '4c (and the finding does not repeat the address)');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
