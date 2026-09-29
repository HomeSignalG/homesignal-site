// DURABLE REPORT SNAPSHOTS — the engine-agnostic module (Development Activity plan, Order F + F2).
// supabase/functions/_shared/report-snapshot.ts turns permanent report intelligence into a stored
// snapshot with two different identifiers, and keeps the customer-entered street address OUT of the
// permanent record: the engine hands over the intelligence and the private context as two separate
// things, and the address travels only in `p_private`. The database half is proven in
// test/report_snapshot_pg and test/report_private_context_pg. This file proves the half that runs in the
// edge function, against a stand-in database that enforces the same rules the real one does.
// The legacy NYC engine is used as REAL DATA: its full report is shown to leak, and the same data, split
// at the boundary, is shown to issue cleanly.
// Run: node test/report-snapshot.test.mjs
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return String(e && e.message || e); } };
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const norm = (t) => String(t ?? '').toLowerCase().replace(/[\s,.]+/g, ' ').trim();

const S = await import('../supabase/functions/_shared/report-snapshot.ts');
const API = await import('../supabase/functions/get-future-surroundings-report/allowlist.ts');
const V1 = require('../lib/nyc-v1-report.js');

// ── a stand-in for the database: the rules public.report_snapshot_issue enforces (hash check, id minting, the
//    private layer's validation, and the containment trigger). The real ones are proven in the pg suites. ─────
const PRIVATE_KEYS = ['address', 'normalized_address', 'latitude', 'longitude', 'property_keys', 'label'];
function fakeDb() {
  const snapshots = [];
  const contexts = [];
  const calls = [];
  const rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fn !== 'report_snapshot_issue') return { data: null, error: { message: 'unknown function ' + fn } };
    const p = args.p_private;
    if (p !== null && p !== undefined) {
      if (typeof p !== 'object' || Array.isArray(p)) return { data: null, error: { message: 'the private context must be a JSON object' } };
      const extra = Object.keys(p).find((k) => !PRIVATE_KEYS.includes(k));
      if (extra) return { data: null, error: { message: 'unknown field "' + extra + '"' } };
      if (!String(p.address ?? '').trim()) return { data: null, error: { message: 'an address is required' } };
    }
    if (sha(args.p_body) !== args.p_content_hash) return { data: null, error: { message: 'report_snapshot_hash_matches_body' } };
    if (p) {
      const scale = (x) => (String(x).split('.')[1] || '').length;
      const fields = [['address', p.address], ['normalized_address', p.normalized_address], ['label', p.label],
        ['latitude', p.latitude != null && scale(p.latitude) >= 5 ? String(p.latitude) : null],
        ['longitude', p.longitude != null && scale(p.longitude) >= 5 ? String(p.longitude) : null],
        ...(p.property_keys || []).map((k) => ['property_key', k])];
      const hay = [norm(args.p_body), norm(JSON.stringify(args.p_engine_inputs))];
      for (const [f, v] of fields) {
        const nv = norm(v);
        if (nv.length >= 3 && hay.some((h) => h.includes(nv))) return { data: null, error: { message: 'report_snapshot_no_private_values: contains the private context\'s ' + f } };
      }
    }
    const cid = p ? randomUUID() : null;
    if (p) contexts.push({ context_id: cid, ...p });
    const row = { report_id: randomUUID(), generated_at: new Date().toISOString(), private_context_id: cid, ...args };
    snapshots.push(row);
    return { data: [{ report_id: row.report_id, generated_at: row.generated_at, private_context_id: cid }], error: null };
  };
  return { snapshots, contexts, calls, rpc };
}

// ── NYC fixtures (small copies of the ones test/nyc-v1-report.test.mjs uses) ──────────────────────────────────
const centre = {
  the_geom: { type: 'Point', coordinates: [-74.003758107366, 40.712980288068] },
  addresspointid: '1001387', house_number: '1', street_name: 'CENTRE', full_street_name: 'CENTRE ST', zipcode: '10007', boroughcode: '1'
};
const issuanceNear = { permit_type: 'NB', permit_status: 'ISSUED', issuance_date: '03/01/2026', house__: '2', street_name: 'CENTRE',
  gis_latitude: '40.7132', gis_longitude: '-74.0039', job__: 'JOB1', zip_code: '10007' };
const input = (over) => Object.assign({
  address: '1 Centre Street', zip: '10007', radius_mi: 0.5, address_points: [centre],
  issuance: [issuanceNear], dobnow: [], filings: [],
  versions: { addresspoint: 'v1', issuance: 'v1', dobnow: 'v1', filings: 'v1' },
  row_cap_per_dataset: 5000, retrieved_at: '2026-09-28T00:00:00.000Z', generated_at: '2026-09-28T00:00:00.000Z'
}, over || {});

// The boundary, applied to the legacy report: what an engine built for this product would hand over.
function splitLegacy(report) {
  const { buyer, property, nearby, report_id, generated_at, ...rest } = report;
  const intelligence = { ...rest, nearby: nearby.map(({ distance_mi, east_mi, north_mi, ...record }) => record) };
  const privateContext = {
    address: buyer.address,
    normalized_address: property.house_number + ' ' + property.full_street_name,
    latitude: property.lat, longitude: property.lng,
    property_keys: [property.addresspointid, 'nyc:' + property.addresspointid],
    label: 'Acme Realty test listing',
  };
  return { intelligence, privateContext };
}
const PRIVATE_NEEDLES = ['1 Centre Street', '1 CENTRE ST', '40.712980288068', '-74.003758107366', '1001387', 'Acme Realty'];
const leaks = (text) => PRIVATE_NEEDLES.filter((v) => norm(text).includes(norm(v)));

const apiReport = await API.assembleReport(input());
const pageReport = await V1.assembleReport(input());

// ── 1. the HASH is still the old fingerprint algorithm: the deterministic concept is retained ─────────────────────────
const hash = await S.contentHashOf(apiReport);
ok(/^[0-9a-f]{64}$/.test(hash), '1a content_hash is a SHA-256 hex string');
ok(hash === apiReport.report_id,
  '1b over the WHOLE legacy report it equals the fingerprint that engine has always printed as report_id (the algorithm is retained; that full report is not issuable — see section 2)', { hash, legacy: apiReport.report_id });
ok(hash === pageReport.report_id && await S.contentHashOf(pageReport) === pageReport.report_id,
  '1c and the legacy page engine agrees, so the page, the API and the snapshot layer fingerprint the same data identically');
const body = S.snapshotBodyOf(apiReport);
const parsedBody = JSON.parse(body);
ok(!('report_id' in parsedBody) && !('generated_at' in parsedBody) && !('content_hash' in parsedBody) && !('private_context_id' in parsedBody),
  '1d the stored body carries none of the identity fields: content is hashed, identity is not');
ok(sha(body) === hash, '1e the hash is exactly the SHA-256 of the stored body text, so the database can check it');
ok(await S.contentHashOf(await API.assembleReport(input({ generated_at: '2027-01-01T00:00:00.000Z' }))) === hash,
  '1f unchanged data issued later has the same content_hash (so it is a fingerprint, and cannot be an issuance id)');
ok(await S.contentHashOf(await API.assembleReport(input({ issuance: [] }))) !== hash,
  '1g a record leaving the radius changes the content_hash');
ok(await S.contentHashOf({ ...apiReport, report_id: 'attacker', content_hash: 'attacker', private_context_id: 'attacker' }) === hash,
  '1h fields a caller puts in the identity slots do not change the content_hash');

// ── 2. the measured problem: the legacy report shape puts the customer's address in the permanent body ───────────────
ok(leaks(body).length === 5 && ['1 Centre Street', '1 CENTRE ST', '40.712980288068', '-74.003758107366', '1001387'].every((v) => leaks(body).includes(v)),
  '2a MEASURED: the legacy report body — exactly what Order F alone would have stored immutably and forever — contains the typed address, the normalized address, both exact property coordinates and the address-point id', leaks(body));
const rel = S.subjectRelativeKeys(parsedBody);
ok(rel.length >= 3 && rel.some((k) => /distance_mi$/.test(k)) && rel.some((k) => /east_mi$/.test(k)) && rel.some((k) => /north_mi$/.test(k)),
  '2b and every nearby record carries distance, east and north offsets measured from the property', rel);
{
  const r = parsedBody.nearby[0];
  const homeLat = r.lat - r.north_mi / 69.0;
  const homeLng = r.lng - r.east_mi / (69.0 * Math.cos((homeLat * Math.PI) / 180));
  const metres = Math.hypot((homeLat - centre.the_geom.coordinates[1]) * 111000, (homeLng - centre.the_geom.coordinates[0]) * 111000 * Math.cos((40.7 * Math.PI) / 180));
  ok(metres < 1,
    '2c MEASURED: those offsets alone recover the property from ONE record to within a metre (0.73 m here; they are rounded to 0.001 mile) — so removing the address string is not enough', { homeLat, homeLng, metres });
}

// ── 3. the compliant path: the same data, split at the boundary ────────────────────────────────────────────────────────
const { intelligence, privateContext } = splitLegacy(apiReport);
ok(leaks(JSON.stringify(intelligence)).length === 0 && S.subjectRelativeKeys(intelligence).length === 0,
  '3a the split intelligence contains none of the private values and none of the subject-relative keys', leaks(JSON.stringify(intelligence)));
const db = fakeDb();
const opts = { reportVersion: 'nyc-v1', engineInputs: { radius_mi: 0.5, zip: '10007' } };
const e1 = await S.issueSnapshot(db.rpc, intelligence, privateContext, opts);
const a = db.calls[0].args;
ok(JSON.stringify(Object.keys(a)) === JSON.stringify(['p_body', 'p_content_hash', 'p_report_version', 'p_engine_inputs', 'p_private'])
   && db.calls.every((c) => c.fn === 'report_snapshot_issue'),
  '3b the module calls the one writer with exactly five named arguments — none is an id or a timestamp', Object.keys(a));
ok(leaks(a.p_body).length === 0 && leaks(JSON.stringify(a.p_engine_inputs)).length === 0 && leaks(a.p_report_version).length === 0 && leaks(a.p_content_hash).length === 0
   && leaks(JSON.stringify(a.p_private)).length === PRIVATE_NEEDLES.length,
  '3c the private values travel in p_private ONLY: they are absent from the body, the engine inputs, the version and the hash, and present in p_private (so the scan can find them)', leaks(a.p_body));
ok(leaks(JSON.stringify(e1)).length === 0 && /^[0-9a-f-]{36}$/.test(e1.private_context_id),
  '3d the envelope handed back carries an opaque private_context_id and none of the private values', leaks(JSON.stringify(e1)));
ok(db.snapshots.length === 1 && leaks(db.snapshots[0].p_body + JSON.stringify(db.snapshots[0].p_engine_inputs)).length === 0
   && db.contexts.length === 1 && db.contexts[0].address === '1 Centre Street' && db.contexts[0].context_id === db.snapshots[0].private_context_id,
  '3e what was stored permanently has none of them; the customer context was stored separately and the snapshot points at it');
ok(e1.report_id === db.snapshots[0].report_id && e1.report_id !== e1.content_hash && e1.report_id !== apiReport.report_id,
  '3f the report_id is the one the database minted, and it is not a content fingerprint');
ok(e1.content_hash === await S.contentHashOf(intelligence) && sha(JSON.stringify(e1.report)) === e1.content_hash && JSON.stringify(e1.report) === db.snapshots[0].p_body,
  '3g the hash is over the address-free body, and the returned report is the stored text byte for byte');
const e2 = await S.issueSnapshot(db.rpc, intelligence, privateContext, opts);
ok(e2.report_id !== e1.report_id && e2.private_context_id !== e1.private_context_id && e2.content_hash === e1.content_hash && db.snapshots.length === 2,
  '3h the same content issued twice is two snapshots: two report_ids, two private contexts, one content_hash');
const noSubject = await S.issueSnapshot(db.rpc, { ...intelligence, nearby: [{ address: '9 ELM', distance_mi: 1 }] }, null, opts);
ok(noSubject.private_context_id === null && db.contexts.length === 2,
  '3i a report with no subject address takes a null context and creates none (and is not held to the subject-relative rule: there is no subject)');
const e3 = await S.issueSnapshot(db.rpc, { ...intelligence, report_id: 'attacker-chosen' }, privateContext, opts);
ok(e3.report_id !== 'attacker-chosen' && !db.snapshots[db.snapshots.length - 1].p_body.includes('attacker-chosen'),
  '3j an id supplied inside the intelligence is never used and never stored');

// ── 4. verifying what was delivered ─────────────────────────────────────────────────────────────────────────────────────
ok(await S.envelopeMatchesItsHash(e1) === true, '4a an envelope as delivered matches its content_hash');
const tampered = JSON.parse(JSON.stringify(e1));
tampered.report.nearby = [];
ok(await S.envelopeMatchesItsHash(tampered) === false, '4b an edited report no longer matches');
ok(await S.envelopeMatchesItsHash({ ...e1, content_hash: 'x' }) === false && await S.envelopeMatchesItsHash(null) === false,
  '4c a wrong hash and a missing envelope do not match');

// ── 5. fail closed ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const calls0 = db.calls.length;
const stored0 = db.snapshots.length + '/' + db.contexts.length;
const refusedByModule = {
  'the unsplit legacy report with a private context': await throws(() => S.issueSnapshot(db.rpc, apiReport, privateContext, opts)),
  'an array as the private context': await throws(() => S.issueSnapshot(db.rpc, intelligence, [], opts)),
  'an array that carries an address property': await throws(() => S.issueSnapshot(db.rpc, intelligence, Object.assign([], { address: '1 A St' }), opts)),
  'a private context with no address': await throws(() => S.issueSnapshot(db.rpc, intelligence, { label: 'x' }, opts)),
  'a blank address': await throws(() => S.issueSnapshot(db.rpc, intelligence, { address: '   ' }, opts)),
  'an empty version': await throws(() => S.issueSnapshot(db.rpc, intelligence, privateContext, { ...opts, reportVersion: '  ' })),
  'array engine inputs': await throws(() => S.issueSnapshot(db.rpc, intelligence, privateContext, { ...opts, engineInputs: [] })),
  'an array report': await throws(() => S.issueSnapshot(db.rpc, [], privateContext, opts)),
  'a null report': await throws(() => S.issueSnapshot(db.rpc, null, privateContext, opts)),
};
ok(Object.values(refusedByModule).every((m) => typeof m === 'string') && db.calls.length === calls0,
  '5a invalid input — including the unsplit legacy report — throws BEFORE the database is called', refusedByModule);
ok(/subject property/.test(refusedByModule['the unsplit legacy report with a private context']),
  '5a2 and the unsplit report is refused for the right reason: it carries measurements taken from the subject property');
const leakyButNoOffsets = JSON.parse(body);
leakyButNoOffsets.nearby = leakyButNoOffsets.nearby.map(({ distance_mi, east_mi, north_mi, ...r }) => r);
const dbLeak = fakeDb();
const leakErr = await throws(() => S.issueSnapshot(dbLeak.rpc, leakyButNoOffsets, privateContext, opts));
ok(/no_private_values/.test(leakErr || '') && dbLeak.snapshots.length === 0 && dbLeak.contexts.length === 0,
  '5b the backstop: with the offsets removed but the typed address and exact point still in the body, the DATABASE refuses it — nothing is stored, no context is left behind', leakErr);
const clientErr = await throws(() => S.issueSnapshot(dbLeak.rpc, intelligence, { ...privateContext, client_name: 'Jane Doe' }, opts));
ok(/unknown field "client_name"/.test(clientErr || '') && dbLeak.snapshots.length === 0,
  '5c a client name (or email, or phone) cannot travel in the private context: the writer refuses the field and nothing is stored', clientErr);
const inputsErr = await throws(() => S.issueSnapshot(dbLeak.rpc, intelligence, privateContext, { ...opts, engineInputs: { address: '1 Centre Street' } }));
ok(/no_private_values/.test(inputsErr || '') && dbLeak.snapshots.length === 0,
  '5d the engine inputs are checked too: the typed address cannot be smuggled into them', inputsErr);

const rows = (data) => async () => ({ data, error: null });
const goodRow = () => ({ report_id: randomUUID(), generated_at: new Date().toISOString(), private_context_id: randomUUID() });
const refusals = {
  'a database error': await throws(() => S.issueSnapshot(async () => ({ data: null, error: { message: 'boom' } }), intelligence, privateContext, opts)),
  'no row': await throws(() => S.issueSnapshot(rows([]), intelligence, privateContext, opts)),
  'two rows': await throws(() => S.issueSnapshot(rows([goodRow(), goodRow()]), intelligence, privateContext, opts)),
  'a malformed id': await throws(() => S.issueSnapshot(rows([{ ...goodRow(), report_id: 'not-a-uuid' }]), intelligence, privateContext, opts)),
  'a content hash used as the id': await throws(() => S.issueSnapshot(rows([{ ...goodRow(), report_id: hash }]), intelligence, privateContext, opts)),
  'no generated_at': await throws(() => S.issueSnapshot(rows([{ ...goodRow(), generated_at: undefined }]), intelligence, privateContext, opts)),
  'no confirmation of the private context': await throws(() => S.issueSnapshot(rows([{ ...goodRow(), private_context_id: null }]), intelligence, privateContext, opts)),
  'a malformed private context id': await throws(() => S.issueSnapshot(rows([{ ...goodRow(), private_context_id: 'nope' }]), intelligence, privateContext, opts)),
  'a context the caller never asked for': await throws(() => S.issueSnapshot(rows([goodRow()]), intelligence, null, opts)),
};
ok(/boom/.test(refusals['a database error']),
  '5e a database error is surfaced with the database\'s own message, not swallowed into a generic one', refusals['a database error']);
const errAndRow = await throws(() => S.issueSnapshot(async () => ({ data: [goodRow()], error: { message: 'late failure' } }), intelligence, privateContext, opts));
ok(typeof errAndRow === 'string' && /late failure/.test(errAndRow),
  '5f an error wins even when a well-formed row came back beside it: nothing is returned', errAndRow);
ok(Object.values(refusals).every((m) => typeof m === 'string' && /issueSnapshot/.test(m)),
  '5g a database error, no row, two rows, a malformed id, a hash in the id slot, a missing time, and an unconfirmed / malformed / unrequested private context each throw — no envelope is ever built', refusals);

// ── 6. the module cannot reach anything but the rpc it is handed, and touches the private context in one way ───────────
const SRC = read('supabase/functions/_shared/report-snapshot.ts');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, '')).join('\n');
ok(!/^\s*import\b/m.test(CODE) && !/\brequire\s*\(/.test(CODE),
  '6a the module imports nothing: no client library, no other module');
ok(!/Deno\.env|process\.env|\bfetch\s*\(|createClient|SUPABASE_/.test(CODE),
  '6b it reads no environment, makes no request and holds no credential');
ok(!/randomUUID|gen_random_uuid|Math\.random|crypto\.getRandomValues/.test(CODE),
  '6c it mints no identifier of any kind: the report_id and the private context id can only come from the database');
ok(!/\b(nyc|new york|manhattan|brooklyn|queens|bronx|staten|socrata|dob|tucson|phoenix|denver)\b/i.test(CODE),
  '6d it names no city, market or source: it is engine-agnostic');
ok((CODE.match(/rpc\(/g) || []).length === 1 && /rpc\('report_snapshot_issue'/.test(CODE),
  '6e it makes exactly one database call, to the one writer');
const touches = [...CODE.matchAll(/privateContext\.(\w+)/g)].map((m) => m[1]);
ok(touches.length > 0 && touches.every((f) => f === 'address') && (CODE.match(/p_private:\s*privateContext/g) || []).length === 1,
  '6f the module reads exactly ONE field of the private context (the address, to check it is not blank) and forwards the object untouched, once, as p_private — it never copies a private value anywhere else', touches);

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
